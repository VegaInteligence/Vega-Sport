/**
 * GET /api/standings and GET /api/matchdays — the support and catalogue reads of
 * aws-app.js on main (relational-support.js, relational-catalog.js), same parameters
 * and same bodies, read from api.standing_rows and api.match_rounds (022).
 *
 * Differences with the legacy read, by construction: standings come from the
 * official table when a source publishes one (SportScore), otherwise from Vega's own
 * table (`source: "Vega"`), where the legacy read answered 404 and the site computed
 * the table from the fixtures. Rows carry the team's id and its own name (legacy:
 * SportScore's spelling), and `season` is always given. Validators are content hashes.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/,
  YEAR = /^\d{4}(?:\/\d{4})?$/;
const SHARE_TTL = 60;
// Provider names as the legacy bodies spell them.
const SOURCE_NAMES = { sportscore: "SportScore", vega: "Vega", uefa: "UEFA" };

function validate(p, spec, required = false) {
  validateParams(p, Object.keys(spec));
  for (const [k, v] of p) if (!spec[k].test(v)) reject(400, "Paramètre invalide.");
  if (required && Object.keys(spec).some((k) => !p.has(k))) reject(400, "Paramètre manquant.");
  return Object.fromEntries(p);
}
const missing = () => reject(404, "Donnée indisponible.");

function respond(req, body, family) {
  const etag = `W/"${family}-v1-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: SHARE_TTL });
  return send(req, body, 200, { etag, ttl: SHARE_TTL });
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

export async function standings(req, p, read) {
  const { competition, season } = validate(p, { competition: LEAGUE, season: YEAR });
  if (!competition) reject(400, "Paramètre manquant.");
  return respond(req, await standingsBody(read, competition, season), "support");
}

/** The standings body of a competition (and season), or a 404. */
export async function standingsBody(read, competition, season) {
  // Without a season: the current edition (else the latest one), as the legacy projection.
  // The league's editions by their key, then the rows of the one kept: named by the
  // league's public id, which the view computes for each row, the tables of every edition
  // of the base were built before one was kept (0.15 s on 11 November 2026).
  const rows = await read(
    `WITH edition AS (
       SELECT k.competition_season_id FROM api.edition_keys k
       CROSS JOIN LATERAL (SELECT r.season,r.native_label,r.is_current FROM api.standing_rows r
         WHERE r.competition_season_id=k.competition_season_id LIMIT 1) s
       WHERE k.league_id=$1 AND ($2::text IS NULL OR s.season=$2 OR s.native_label=$2)
       ORDER BY s.is_current DESC,s.season DESC LIMIT 1)
     SELECT r.* FROM api.standing_rows r WHERE r.competition_season_id=(SELECT competition_season_id FROM edition)
     ORDER BY r.stage NULLS FIRST,r.group_name NULLS FIRST,r.position,r.name`,
    [competition, season ?? null],
  );
  if (!rows.length) missing();
  const tables = new Map();
  for (const r of rows) {
    const key = `${r.stage ?? ""}\u0000${r.group_name ?? ""}`;
    // An official table is named by its group, "" without one (legacy); Vega's own by the league.
    if (!tables.has(key)) tables.set(key, { name: r.group_name ?? (r.source === "vega" ? r.league_name : ""), rows: [] });
    tables.get(key).rows.push({
      id: r.id, uefaId: r.uefa_id, imageUrl: r.image_url, name: r.name, wins: r.wins, draws: r.draws,
      losses: r.losses, played: r.played, points: r.points, goalsFor: r.goals_for, goalsAgainst: r.goals_against,
      difference: r.difference, position: r.position,
    });
  }
  const sources = [...new Set(rows.map((r) => SOURCE_NAMES[r.source] ?? r.source))];
  const fetched = rows.map((r) => iso(r.as_of)).filter(Boolean).sort();
  return {
    competition: rows[0].league_name,
    season: season ?? rows[0].native_label ?? rows[0].season,
    source: sources.length === 1 ? sources[0] : sources.join(","),
    fetchedAt: fetched.at(-1) ?? null,
    tables: [...tables.values()],
  };
}

export async function matchdays(req, p, read) {
  const { competition, season } = validate(p, { competition: LEAGUE, season: YEAR }, true);
  const rows = await read(
    "SELECT id,name,playoff FROM api.match_rounds WHERE league_id=$1 AND (season=$2 OR native_season=$2) ORDER BY id",
    [competition, season],
  );
  if (!rows.length) missing();
  return respond(req, { matches: Object.fromEntries(rows.map((r) => [r.id, { name: r.name, playoff: r.playoff }])) }, "catalog");
}

export function createReferenceRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/standings") return standings(req, params, read);
    if (path === "/api/matchdays") return matchdays(req, params, read);
    return null;
  };
}
