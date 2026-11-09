/**
 * The ranking catalogue of main (relational-catalog.js): /api/rankings/index,
 * /api/rankings/edition, /api/rankings/associations, /api/rankings/club and
 * /api/club-links, same parameters and bodies, read from api.ranking_editions,
 * api.ranking_entries, api.ranking_season_points and api.club_links (026).
 *
 * Differences with the legacy read, by construction of v2 (typed tables only):
 * `sourceRow` keeps only the facts the site reads (a UEFA row's overall and per-season
 * points and clubs still in competition), not the provider's whole record; editions carry
 * no file path or checksum; `quality.duplicateEntityIds` is empty (one row per entity).
 * An edition is keyed by what it covers, never by its source (030_neutral_reads.sql): the
 * season's ending year for the UEFA coefficients ("2026", legacy "2026.uefa"), the
 * publication date otherwise ("2025-09-18", legacy "2025-09-18.fifa"); when two sources
 * hold the same edition the official one is served. `kind` names the ranking itself (the
 * UEFA coefficients, the FIFA ranking), whoever supplies it; the supplier stays in the
 * body's `provider`.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const TEAM = /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);

function validate(p, spec) {
  validateParams(p, Object.keys(spec));
  for (const [k, v] of p) if (!spec[k].test(v)) reject(400, "Paramètre invalide.");
  if (Object.keys(spec).some((k) => !p.has(k))) reject(400, "Paramètre manquant.");
  return Object.fromEntries(p);
}

function respond(req, body) {
  const etag = `W/"catalog-v1-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 60 });
  return send(req, body, 200, { etag, ttl: 60 });
}

export const indexEdition = (e) => ({
  edition: e.edition,
  kind: e.kind,
  officialEdition: e.official_edition,
  period: e.period,
  provider: e.provider,
  retrievedAt: iso(e.retrieved_at),
  rows: e.rows,
  sourceUpdatedAt: iso(e.source_updated_at) ?? (e.published_on || null),
  sourceUrl: e.source_url,
});

export function rankingRow(kind, r, seasons = []) {
  const row = {
    entityId: `${kind.startsWith("uefa") ? "uefa" : "fifa"}:${r.provider_key}`,
    entityName: r.entity_name,
    countryCode: r.country_code ?? null,
    position: r.position,
    points: r.points,
    ...(kind.startsWith("uefa") && { earnedPoints: r.earned_points }),
    previousPosition: r.previous_position ?? null,
    imageUrl: r.image_url ?? null,
    ...(kind === "fifa-men" && { confederation: r.confederation ?? null }),
  };
  if (kind.startsWith("uefa"))
    row.sourceRow = {
      overallRanking: { numberOfTeamsStillInPlaying: r.teams_still_playing ?? null },
      seasonRankings: seasons.map((s) => ({
        seasonYear: s.season_year,
        totalPoints: s.points,
        nationalAssociationPoints: s.association_points,
        numberOfTeamsStillInPlaying: s.teams_still_playing,
      })),
    };
  return row;
}

async function editionBody(read, kind, edition) {
  const [e] = await read("SELECT * FROM api.ranking_editions WHERE kind=$1 AND edition=$2", [kind, edition]);
  if (!e) reject(404, "Donnée indisponible.");
  const [rows, seasons] = await Promise.all([
    read("SELECT * FROM api.ranking_entries WHERE edition_id=$1 ORDER BY row_no", [e.edition_id]),
    read("SELECT * FROM api.ranking_season_points WHERE edition_id=$1 ORDER BY row_no,season_year DESC", [e.edition_id]),
  ]);
  const byRow = new Map();
  for (const s of seasons) byRow.set(s.row_no, [...(byRow.get(s.row_no) || []), s]);
  return {
    kind: e.kind,
    edition: e.edition,
    provider: e.provider,
    sourceUrl: e.source_url,
    retrievedAt: iso(e.retrieved_at),
    sourceUpdatedAt: iso(e.source_updated_at) ?? (e.published_on || null),
    period: e.period,
    officialEdition: e.official_edition,
    quality: { duplicateEntityIds: [] },
    rows: rows.map((r) => rankingRow(e.kind, r, byRow.get(r.row_no) || [])),
  };
}

export function createRankingRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/rankings/index") {
      validate(params, {});
      const [editions, [mapping]] = await Promise.all([
        read("SELECT * FROM api.ranking_editions ORDER BY kind DESC,edition DESC"),
        read("SELECT count(*)::int AS linked FROM api.club_links"),
      ]);
      const retrieved = editions.map((e) => iso(e.retrieved_at)).filter(Boolean).sort();
      return respond(req, {
        schemaVersion: 1,
        retrievedAt: retrieved.at(-1) ?? null,
        editions: editions.map(indexEdition),
        errors: [],
        notes: {
          "uefa-associations": "Association club coefficients, not national-team strength.",
          historicalDates: "UEFA period is a season ending year, not a known publication date. SportsAPI updatedAt is a source refresh timestamp, not an official edition date.",
        },
        clubMapping: { linked: mapping.linked },
      });
    }
    if (path === "/api/rankings/edition") {
      const p = validate(params, {
        kind: /^(uefa-clubs|uefa-associations|fifa-men)$/,
        edition: /^\d{4}(?:-\d{2}-\d{2})?$/,
      });
      return respond(req, await editionBody(read, p.kind, p.edition));
    }
    if (path === "/api/rankings/associations") {
      const p = validate(params, { year: /^\d{4}$/ });
      return respond(req, await editionBody(read, "uefa-associations", p.year));
    }
    if (path === "/api/rankings/club") {
      const p = validate(params, { club: TEAM });
      const [link] = await read("SELECT * FROM api.club_links WHERE team_id=$1", [p.club]);
      if (!link) return respond(req, { rows: null });
      const editions = await read("SELECT * FROM api.ranking_editions WHERE kind='uefa-clubs' AND provider='UEFA' ORDER BY edition DESC");
      const rows = await read(
        `SELECT r.* FROM api.ranking_entries r JOIN api.ranking_editions e ON e.edition_id=r.edition_id
         WHERE e.kind='uefa-clubs' AND r.internal_team_id=$1`,
        [link.internal_team_id],
      );
      const byEdition = new Map(rows.map((r) => [r.edition_id, r]));
      return respond(req, {
        rows: editions.map((e) => {
          const row = byEdition.get(e.edition_id);
          return { edition: indexEdition(e), row: row ? rankingRow("uefa-clubs", row) : null };
        }),
      });
    }
    if (path === "/api/club-links") {
      const p = validate(params, { club: TEAM });
      const [link] = await read("SELECT * FROM api.club_links WHERE team_id=$1", [p.club]);
      return respond(req, {
        links: link
          ? { [p.club]: { clubName: link.club_name, countryCode: link.country_code, entityId: link.entity_id, method: link.method, rankingName: link.ranking_name } }
          : {},
      });
    }
    return null;
  };
}
