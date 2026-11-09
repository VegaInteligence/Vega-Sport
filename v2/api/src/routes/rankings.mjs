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
 *
 * GET /api/rankings/power?kind=players|clubs|nations&season=&limit= — Vega's power
 * rankings (docs/METHODE_CLASSEMENT_BALLON_D_OR.md on main, vega_v2/power.py): players by
 * the role-relative score B (the site's `ballonDorRanking(season)` entries), clubs and
 * national teams by their Elo strength after their last match of the season.
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

const ROLE_LABEL = {
  centre_forward: "Avant-centre", winger: "Ailier / milieu offensif", central_midfielder: "Milieu central",
  defensive_midfielder: "Milieu défensif", full_back: "Latéral / piston", centre_back: "Défenseur central", goalkeeper: "Gardien",
};
const round = (v, d) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

async function powerRanking(read, params) {
  validateParams(params, ["kind", "season", "limit"]);
  const kind = params.get("kind") ?? "players", season = params.get("season"), limitRaw = params.get("limit") ?? "30";
  if (!/^(players|clubs|nations)$/.test(kind) || !/^\d{4}\/\d{4}$/.test(season || "") || !/^[1-9]\d{0,2}$/.test(limitRaw) || Number(limitRaw) > 200)
    reject(400, "Paramètre invalide.");
  const limit = Number(limitRaw);
  if (kind === "players") {
    const rows = await read("SELECT * FROM api.power_players WHERE season=$1 ORDER BY rank, player_id LIMIT $2", [season, limit]);
    if (!rows.length) reject(404, "Donnée indisponible.");
    return {
      season, kind, method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
      rows: rows.map((r) => ({
        rank: r.rank, playerId: r.player_id, name: r.name, imageUrl: r.image_url ?? null, teamId: r.team_id ?? null, team: r.team ?? null,
        teamImageUrl: r.team_image_url ?? null, position: ROLE_LABEL[r.role] ?? r.role, role: r.role, roleRank: r.role_rank,
        score: round(r.score, 1), matches: r.matches, minutes: r.minutes, contribution: round(r.total, 2), rate: round(r.rate, 3),
        contributionPercentile: round(r.total_percentile, 1), ratePercentile: round(r.rate_percentile, 1),
      })),
    };
  }
  const rows = await read("SELECT * FROM api.power_clubs WHERE season=$1 AND scope=$2 ORDER BY rank, team_id LIMIT $3", [season, kind, limit]);
  if (!rows.length) reject(404, "Donnée indisponible.");
  return {
    season, kind, method: { version: rows[0].method_version, computedAt: iso(rows[0].computed_at) },
    rows: rows.map((r) => ({
      rank: r.rank, teamId: r.team_id, name: r.name, imageUrl: r.image_url ?? null, country: r.country ?? null,
      elo: round(r.elo, 1), eloChange: round(r.elo_change, 1), matches: r.matches, lastMatchAt: iso(r.last_match_at),
    })),
  };
}

export function createRankingRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/rankings/power") return respond(req, await powerRanking(read, params));
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
