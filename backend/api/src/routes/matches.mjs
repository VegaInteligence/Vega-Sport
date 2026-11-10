/**
 * GET /api/fixtures and GET /api/matches/{id}/summary — same parameters and same
 * response as fixturePage() and summary() of the previous backend's relational-core.js
 * on main, read from api.fixtures, api.match_sides, api.match_shots and
 * api.player_appearances (021_api_matches.sql).
 *
 * Differences with the legacy read, by construction (listed for the parity
 * comparison):
 * - statuses are the normalized ones (a provider "started" reads "in_play");
 * - team statistics are typed columns: `label` is null (the site has its own labels),
 *   `homeRaw`/`awayRaw` repeat the number, `format` is "double" for xG and "integer"
 *   otherwise, `reliable` is true;
 * - a referee or a stadium is its name, as main returns the source's names (main's
 *   club profile prints them as text);
 * - shot periods are the normalized period names (first_half, second_half, …);
 * - `warnings` and `warningCodes` are empty (data warnings are kept in ops);
 * - an appearance id is `<match id>:<player id>`.
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const MATCH = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/,
  LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/,
  SEASON = /^\d{4}(?:\/\d{4})?$/;
const PAGE_TTL = 30;
const digest = (s) => createHash("sha256").update(s).digest("hex");
const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

export const tag = (req, version) => {
  const url = new URL(req.url);
  return `W/"core-v3-${digest(url.pathname + url.search + "|v2|" + version)}"`;
};

const publication = "SELECT generation::text AS version, published_at FROM api.publication";

export function pageArgs(p, defaultLimit, scope) {
  const raw = p.get("limit") ?? String(defaultLimit),
    limit = Number(raw);
  if (!/^[1-9]\d{0,2}$/.test(raw) || limit > 100) reject(400, "Taille de page invalide.");
  const fingerprint = digest(JSON.stringify([scope, limit]));
  let cursor = null;
  if (p.has("cursor")) {
    try {
      const str = p.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(str)) throw Error();
      cursor = JSON.parse(Buffer.from(str, "base64url").toString());
      if (
        cursor.scope !== fingerprint ||
        !MATCH.test(cursor.id) ||
        !(cursor.day === null || dateOk(cursor.day)) ||
        typeof cursor.generation !== "string" ||
        cursor.generation.length > 80
      )
        throw Error();
    } catch {
      reject(400, "Curseur invalide.");
    }
  }
  return { limit, cursor, fingerprint };
}

export function nextPage(rows, state, args) {
  if (args.cursor && args.cursor.generation !== state.version) reject(409, "La publication a changé. Rechargez la première page.");
  const last = rows[args.limit - 1];
  const nextCursor =
    rows.length > args.limit
      ? Buffer.from(JSON.stringify({ scope: args.fingerprint, generation: state.version, day: last.day, id: last.id })).toString("base64url")
      : null;
  return { limit: args.limit, nextCursor, generation: state.version };
}

function keyset(alias, dayParam, idParam, order = "asc") {
  const comparison = order === "desc" ? "<" : ">";
  return `(${alias}.day ${comparison} ${dayParam}::date OR (${alias}.day IS NULL AND ${dayParam}::date IS NOT NULL)
 OR (${alias}.day IS NOT DISTINCT FROM ${dayParam}::date AND ${alias}.id ${comparison} ${idParam}))`;
}

const FIXTURE_COLUMNS = `f.id,f.season,f.native_season,f.day,f.time_utc,f.status,f.round_name,f.has_playoff,
 f.home_team_id,f.home_name,f.home_image_url,f.away_team_id,f.away_name,f.away_image_url,
 f.league_id,f.league_name,f.league_image_url,f.score_home,f.score_away,f.score_penalty_home,f.score_penalty_away`;

export function fixture(row) {
  const team = (side) => ({ id: row[side + "_team_id"], name: row[side + "_name"], image_url: row[side + "_image_url"] });
  return {
    id: row.id,
    season: row.native_season ?? row.season,
    date: row.day,
    time_utc: row.time_utc,
    status: row.status,
    round_name: row.round_name,
    has_playoff: row.has_playoff,
    home_team: team("home"),
    away_team: team("away"),
    league: { id: row.league_id, name: row.league_name, image_url: row.league_image_url },
    score_home: row.score_home,
    score_away: row.score_away,
    score_penalty_home: row.score_penalty_home,
    score_penalty_away: row.score_penalty_away,
  };
}

function list(p, key, pattern, max) {
  const raw = p.get(key) || "",
    values = raw ? raw.split(",") : [];
  if (values.length > max || values.some((v) => !pattern.test(v))) reject(400, "Identifiants invalides.");
  return [...new Set(values)].sort();
}

export async function fixturePage(req, p, read) {
  validateParams(p, ["league", "leagues", "season", "seasons", "status", "from", "to", "q", "limit", "cursor", "order"]);
  if ((p.has("league") && p.has("leagues")) || (p.has("season") && p.has("seasons"))) reject(400, "Filtres incompatibles.");
  const leagues = list(p, p.has("league") ? "league" : "leagues", LEAGUE, 100),
    seasons = list(p, p.has("season") ? "season" : "seasons", SEASON, 2);
  const status = p.get("status") || "all",
    order = p.get("order") || "asc",
    from = p.get("from"),
    to = p.get("to"),
    q = p.get("q") || "";
  if (
    !["all", "played", "upcoming"].includes(status) ||
    !["asc", "desc"].includes(order) ||
    (from && !dateOk(from)) ||
    (to && !dateOk(to)) ||
    (from && to && from > to) ||
    q.length > 200
  )
    reject(400, "Filtres invalides.");
  const args = pageArgs(p, 50, ["fixtures", leagues, seasons, status, from, to, q, ...(order === "desc" ? [order] : [])]),
    binds = [],
    terms = [];
  const bind = (v) => {
    binds.push(v);
    return "$" + binds.length;
  };
  if (leagues.length) terms.push("f.league_id=ANY(" + bind(leagues) + "::text[])");
  if (seasons.length) {
    const k = bind(seasons);
    terms.push("(f.season=ANY(" + k + "::text[]) OR f.native_season=ANY(" + k + "::text[]))");
  }
  if (status !== "all") terms.push(status === "played" ? "f.status='finished'" : "f.status='not_started'");
  if (from) terms.push("f.day>=" + bind(from) + "::date");
  if (to) terms.push("f.day<=" + bind(to) + "::date");
  if (q) {
    const like = "%" + q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\\%_]/g, "\\$&") + "%";
    terms.push(
      "regexp_replace(normalize(lower(concat_ws(' ',f.home_name,f.away_name,f.league_name)),NFD),'[̀-ͯ]','','g') LIKE " + bind(like),
    );
  }
  if (args.cursor) terms.push(keyset("f", bind(args.cursor.day), bind(args.cursor.id), order));
  if (req.method === "HEAD" || req.headers.has("if-none-match")) {
    const [g] = await read(publication);
    if (!g) reject(503, "Publication indisponible.");
    nextPage([], g, args);
    if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), tag(req, g.version)))
      return send(req, null, 200, { etag: tag(req, g.version), ttl: PAGE_TTL });
  }
  const direction = order.toUpperCase();
  const rows = `SELECT ${FIXTURE_COLUMNS} FROM api.fixtures f ${terms.length ? "WHERE " + terms.join(" AND ") : ""}
 ORDER BY f.day ${direction} NULLS LAST,f.id ${direction} LIMIT ${bind(args.limit + 1)}`;
  const [r] = await read(`SELECT g.*,(SELECT coalesce(json_agg(r),'[]'::json) FROM (${rows}) r) AS rows FROM (${publication}) g`, binds);
  if (!r) reject(503, "Publication indisponible.");
  const pagination = nextPage(r.rows, r, args);
  return send(req, { data: { matches: r.rows.slice(0, args.limit).map(fixture) }, pagination }, 200, {
    etag: tag(req, r.version),
    ttl: PAGE_TTL,
    maxBytes: 2 * 1024 * 1024,
  });
}

// The overview statistics of a summary (legacy keys of team_statistics) and their columns.
// Labels are null as in team-stats.mjs: the provider's titles are not stored.
const SUMMARY_STATS = [
  ["expected_goals", "xg", null, "double"],
  ["total_shots", "shots", null, "integer"],
  ["ShotsOnTarget", "shots_on_target", null, "integer"],
  ["BallPossesion", "possession", null, "integer"],
  ["big_chance", "big_chances", null, "integer"],
  ["corners", "corners", null, "integer"],
];

const summarySql = `WITH f AS MATERIALIZED (SELECT * FROM api.fixtures WHERE match_id=api.internal_id('match',$1))
SELECT g.version||':'||f.revision AS version,row_to_json(f) AS fixture,
 (SELECT json_agg(s ORDER BY s.side DESC) FROM api.match_sides s WHERE s.season_id=f.season_id AND s.match_id=f.match_id) sides,
 (SELECT coalesce(json_agg(json_build_object('id',x.id,'team_id',api.public_id('team',x.team_id),'player_id',api.public_id('player',x.player_id),
   'player_name',x.player_name,'minute',x.minute,'minute_added',x.minute_added,'period',x.period,'xg',x.xg,'is_goal',x.is_goal,'is_own_goal',x.is_own_goal)
   ORDER BY x.shot_no),'[]'::json) FROM api.match_shots x WHERE x.season_id=f.season_id AND x.match_id=f.match_id) shots,
 (SELECT row_to_json(d) FROM api.match_detail_state d WHERE d.season_id=f.season_id AND d.match_id=f.match_id) state,
 (SELECT json_build_object('listed',count(*),'played',count(*) FILTER(WHERE a.minutes>0),
   'rated',count(*) FILTER(WHERE a.minutes>0 AND a.rating IS NOT NULL),'xg',count(*) FILTER(WHERE a.minutes>0 AND a.xg IS NOT NULL),
   'xa',count(*) FILTER(WHERE a.minutes>0 AND a.xa IS NOT NULL))
   FROM api.player_appearances a WHERE a.season_id=f.season_id AND a.match_id=f.match_id) players,
 (SELECT coalesce(json_agg(l ORDER BY l.rating DESC,l.id),'[]'::json) FROM (
   SELECT f.id||':'||api.public_id('player',a.player_id) id,api.public_id('player',a.player_id) player_id,f.id match_id,
   api.public_id('team',a.team_id) team_id,a.team,a.player_name AS name,a.image_url,a.minutes,a.rating,a.goals,a.assists
   FROM api.player_appearances a WHERE a.season_id=f.season_id AND a.match_id=f.match_id AND a.minutes>0 AND a.rating IS NOT NULL
   ORDER BY a.rating DESC,1 LIMIT 5) l) leaders,
 f.referee AS referee,
 f.stadium AS stadium
FROM (${publication}) g,f`;

const camel = (k) => k.replace(/_([a-z])/g, (_, v) => v.toUpperCase());
const camelRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));

export function summaryMatch(r) {
  const f = r.fixture;
  if (!r.state?.detail_collected) {
    const x = fixture(f);
    return {
      state: "pending",
      match: {
        id: x.id,
        leagueId: x.league.id,
        league: x.league.name,
        season: x.season,
        date: x.date,
        timeUtc: x.time_utc,
        status: x.status,
        home: { ...x.home_team, imageUrl: x.home_team.image_url, score: x.score_home },
        away: { ...x.away_team, imageUrl: x.away_team.image_url, score: x.score_away },
        shots: [],
        stats: [],
        coverage: {},
        warnings: [],
      },
    };
  }
  const sides = Object.fromEntries((r.sides || []).map((s) => [s.side, s]));
  const side = (name) => {
    const s = sides[name] || {};
    return {
      id: f[name + "_team_id"],
      name: f[name + "_name"],
      imageUrl: f[name + "_image_url"],
      formation: s.formation ?? null,
      coach: s.coach ?? null,
      score: f["score_" + name],
      xg: s.xg ?? null,
      shots: s.shots ?? null,
      shotsOnTarget: s.shots_on_target ?? null,
      possession: s.possession ?? null,
      lineupConfirmed: s.lineup_confirmed ?? null,
    };
  };
  const stats = SUMMARY_STATS.filter(([, column]) => sides.home?.[column] != null || sides.away?.[column] != null).map(
    ([key, column, label, format]) => ({
      key,
      label,
      home: sides.home?.[column] ?? null,
      away: sides.away?.[column] ?? null,
      homeRaw: sides.home?.[column] ?? null,
      awayRaw: sides.away?.[column] ?? null,
      format,
      reliable: true,
    }),
  );
  const n = r.players || {};
  return {
    state: "ready",
    match: {
      id: f.id,
      season: f.season,
      leagueId: f.league_id,
      league: f.league_name,
      country: f.country,
      date: f.day,
      timeUtc: f.time_utc,
      status: f.status,
      roundName: f.round_name,
      hasPlayoff: f.has_playoff,
      referee: r.referee,
      stadium: r.stadium,
      home: side("home"),
      away: side("away"),
      shots: (r.shots || []).map(camelRow),
      stats,
      coverage: {
        players: Boolean(r.state.player_stats_ok) && n.listed > 0,
        playerStats: n.played > 0,
        ratings: n.rated > 0,
        xg: n.xg > 0,
        xa: n.xa > 0,
        shots: Boolean(r.state.shots_ok),
        teamStatsReliable: Boolean(r.state.team_stats_ok),
        listedPlayers: n.listed ?? 0,
        playedPlayers: n.played ?? 0,
        ratedPlayers: n.rated ?? 0,
        xgPlayers: n.xg ?? 0,
        xaPlayers: n.xa ?? 0,
      },
      warnings: [],
      warningCodes: [],
      detailCollected: true,
    },
  };
}

export async function summary(req, mid, read) {
  if (req.method === "HEAD" || req.headers.has("if-none-match")) {
    const [m] = await read(
      `SELECT g.version||':'||f.revision AS version,d.detail_collected FROM (${publication}) g,api.fixtures f
       LEFT JOIN api.match_detail_state d ON d.season_id=f.season_id AND d.match_id=f.match_id
       WHERE f.match_id=api.internal_id('match',$1)`,
      [mid],
    );
    if (!m) reject(404, "Match introuvable.");
    if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), tag(req, m.version)))
      return send(req, null, 200, { etag: tag(req, m.version), ttl: m.detail_collected ? 15 : 0 });
  }
  const [r] = await read(summarySql, [mid]);
  if (!r) reject(404, "Match introuvable.");
  const { state, match } = summaryMatch(r);
  match.summaryVersion = 1;
  match.leadingPlayers = (r.leaders || []).map(camelRow);
  return send(req, { data: { version: 1, state, match } }, 200, {
    etag: tag(req, r.version),
    maxBytes: 256 * 1024,
    ttl: state === "ready" ? 15 : 0,
  });
}

export function createMatchRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/fixtures") return fixturePage(req, params, read);
    const id = path.match(/^\/api\/matches\/(m_[A-Za-z0-9_]{6,9})\/summary$/);
    if (id) {
      if (!MATCH.test(id[1])) reject(404, "Match introuvable.");
      validateParams(params, []);
      return summary(req, id[1], read);
    }
    return null;
  };
}
