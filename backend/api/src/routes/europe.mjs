/**
 * The European club pool of the club and player profiles ("Europe · Top 7 + UEFA",
 * "niveau comparable"), from the published rows. It replaces main's local demo
 * (public/demo/europe-clubs.json, scripts/demo-europe-clubs.mjs), in the same shape:
 *
 * - GET /api/clubs/europe?season= — the seven Top 7 leagues, the three UEFA cups, every
 *   club of those leagues (its league, country, five-year UEFA coefficient of the latest
 *   edition, and its level), and `levels`: the level of every club ranked in the season;
 * - GET /api/clubs/europe/matches?season=&league= — the finished, collected matches of
 *   one of those competitions that involve a pool club, with the team statistics the
 *   profiles rank (one read per competition: a whole season is about 6 MB).
 *
 * A club's level is its Elo of the power ranking (agg.team_power, scope clubs) after its
 * last match of the season, fitted on every result, league and European cups alike.
 * The demo's league offsets and association floors are gone.
 */
import { reject, validateParams } from "../http.mjs";
import {
  bindValue,
  checkReadGeneration,
  publicationSql,
  readResponse,
  readValidator,
  scopeVersion,
  versionGate,
  versionParam,
} from "../publication.mjs";
import { TEAM_STAT_KEYS, teamStats } from "../team-stats.mjs";
import { EUROPE_FOCUS } from "../../../../dashboard/shared/competition-scope.js";

export const POOL_LEAGUES = EUROPE_FOCUS.filter((c) => c.country !== "UEFA");
export const POOL_CUPS = EUROPE_FOCUS.filter((c) => c.country === "UEFA");
const SCOPE_IDS = EUROPE_FOCUS.map((c) => c.id).sort();
const LEAGUE_IDS = POOL_LEAGUES.map((c) => c.id);
// The form of a competition's pool matches (scopeVersion): to change with it.
const MATCHES_SHAPE = "europe-matches-1";

// The team statistics the club profiles rank (scripts/demo-europe-clubs.mjs, KEEP).
const KEPT = new Set([
  "expected_goals", "expected_goals_non_penalty", "expected_goals_open_play", "expected_goals_set_play",
  "expected_goals_on_target", "total_shots", "ShotsOnTarget", "shots_inside_box", "shots_outside_box", "big_chance",
  "big_chance_missed_title", "BallPossesion", "passes", "accurate_passes", "opposition_half_passes", "own_half_passes",
  "long_balls_accurate", "accurate_crosses", "touches_opp_box", "dribbles_succeeded", "duel_won", "ground_duels_won",
  "aerials_won", "matchstats.headers.tackles", "interceptions", "clearances", "shot_blocks", "fouls", "yellow_cards",
  "red_cards", "corners", "Offsides", "keeper_saves",
]);
export const POOL_STAT_KEYS = TEAM_STAT_KEYS.filter(([key]) => KEPT.has(key));

const strip = (row) => (row ? Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith("for_")).map(([k, v]) => [k.slice(4), v])) : null);
const num = (v) => (v == null ? null : Number(v));

function season(params) {
  const value = params.get("season");
  if (!/^\d{4}\/\d{4}$/.test(value || "")) reject(400, "Saison invalide.");
  const generation = params.get("generation");
  if (generation !== null && !/^\d{1,20}$/.test(generation)) reject(400, "Publication invalide.");
  return value;
}

// A season's id and the editions of some of its leagues: what core.matches is indexed on.
// Filtered on the season's label and the public league id, which the view computes, the
// fixtures of the whole season were built before the leagues were kept (0.37 s for the
// pool on 11 November 2026, 30 ms through the editions).
const SEASON_ID = (seasonParam) => `(SELECT k.season_id FROM api.season_keys k WHERE k.season=${seasonParam})`;
const inEditions = (alias, seasonParam, leagues) =>
  `${alias}.season_id=${SEASON_ID(seasonParam)} AND ${alias}.competition_season_id=ANY(ARRAY(SELECT e.competition_season_id FROM api.edition_keys e WHERE e.season=${seasonParam} AND e.league_id=ANY(${leagues}::text[])))`;

// The pool: every club with a fixture of a Top 7 league in the season, in the league it
// plays most (a club promoted mid-history keeps one league).
const POOL_SQL = (scopeParam, leagues) => `pool AS MATERIALIZED (
  SELECT DISTINCT ON (team_id) team_id,league_id FROM (
    SELECT x.home_internal_id team_id,x.league_id FROM api.fixtures x WHERE ${inEditions("x", scopeParam, leagues)}
    UNION ALL SELECT x.away_internal_id,x.league_id FROM api.fixtures x WHERE ${inEditions("x", scopeParam, leagues)}) s
  WHERE team_id IS NOT NULL GROUP BY team_id,league_id ORDER BY team_id,count(*) DESC,league_id)`;

export function createEuropeRoute(read, { clock = Date.now } = {}) {
  return async (req, path, params) => {
    if (path !== "/api/clubs/europe" && path !== "/api/clubs/europe/matches") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const matchesRead = path === "/api/clubs/europe/matches";
    validateParams(params, matchesRead ? ["season", "league", "generation", "v"] : ["season", "generation"]);
    const label = season(params);
    const league = matchesRead ? params.get("league") : null;
    if (matchesRead && !SCOPE_IDS.includes(league || "")) reject(400, "Compétition invalide.");
    const scope = { season: label, leagueIds: matchesRead ? [league] : SCOPE_IDS };
    // A competition's matches read without a publication are validated by the version of
    // what they are made from: the competition, and the Top 7 leagues that make the pool.
    const gate =
      matchesRead && versionParam(params)
        ? versionGate(req, params, await scopeVersion(read, MATCHES_SHAPE, { season: label, leagueIds: [...new Set([league, ...LEAGUE_IDS])].sort() }, clock()))
        : null;
    if (gate?.unchanged) return gate.unchanged;
    const cached = gate ? null : await readValidator(req, params, scope, read, { ttl: 300 });
    if (cached) return cached;
    const values = [];
    const publication = publicationSql(scope, values);
    const seasonParam = bindValue(values, label);
    const leagues = bindValue(values, LEAGUE_IDS);
    if (!matchesRead) {
      const [snapshot] = await read(
        `WITH publication AS MATERIALIZED (${publication}), ${POOL_SQL(seasonParam, leagues)},
         uefa AS (SELECT r.internal_team_id team_id,r.points FROM api.ranking_entries r
           WHERE r.internal_team_id IS NOT NULL AND r.edition_id=(SELECT edition_id FROM api.ranking_editions
             WHERE kind='uefa-clubs' AND provider='UEFA' ORDER BY edition DESC LIMIT 1))
         SELECT publication.*,
           (SELECT coalesce(json_agg(json_build_object('id',k.public_id,'name',k.name,'imageUrl',k.image_url,'country',k.country,
              'leagueId',p.league_id,'uefaCoefficient',u.points,'level',w.elo,'levelRank',w.rank) ORDER BY p.league_id,k.name,k.public_id),'[]'::json)
            FROM pool p JOIN api.team_keys k ON k.team_id=p.team_id
            LEFT JOIN uefa u ON u.team_id=p.team_id
            LEFT JOIN api.power_clubs w ON w.team_key=p.team_id AND w.season_id=${SEASON_ID(seasonParam)} AND w.scope='clubs') clubs,
           (SELECT coalesce(json_object_agg(w.team_id,w.elo),'{}'::json) FROM api.power_clubs w WHERE w.season_id=${SEASON_ID(seasonParam)} AND w.scope='clubs') levels,
           (SELECT max(w.computed_at) FROM api.power_clubs w WHERE w.season_id=${SEASON_ID(seasonParam)} AND w.scope='clubs') levels_at
         FROM publication`,
        values,
      );
      checkReadGeneration(params, snapshot?.generation);
      const data = {
        season: label,
        generation: String(snapshot.generation),
        builtAt: snapshot.levels_at instanceof Date ? snapshot.levels_at.toISOString() : snapshot.levels_at ?? null,
        level: { kind: "elo", label: "Elo du classement de puissance", scope: "clubs" },
        leagues: POOL_LEAGUES,
        uefa: POOL_CUPS,
        clubs: (snapshot.clubs || []).map((c) => ({ ...c, uefaCoefficient: num(c.uefaCoefficient), level: num(c.level) })),
        levels: Object.fromEntries(Object.entries(snapshot.levels || {}).map(([id, elo]) => [id, num(elo)])),
      };
      return readResponse(req, params, snapshot, data, { maxBytes: 1024 * 1024, ttl: 300 });
    }
    const leagueParam = bindValue(values, league);
    const [snapshot] = await read(
      `WITH publication AS MATERIALIZED (${publication}), ${POOL_SQL(seasonParam, leagues)},
       f AS MATERIALIZED (SELECT x.* FROM api.fixtures x JOIN api.match_detail_state d ON d.season_id=x.season_id AND d.match_id=x.match_id
         WHERE ${inEditions("x", seasonParam, `ARRAY[${leagueParam}]`)} AND x.status='finished' AND d.detail_collected
           AND (x.home_internal_id IN (SELECT team_id FROM pool) OR x.away_internal_id IN (SELECT team_id FROM pool)))
       SELECT publication.*,
         (SELECT coalesce(json_agg(r ORDER BY r.day,r.id),'[]'::json) FROM (
           SELECT f.day,f.id,row_to_json(f) AS fixture,
             (SELECT to_json(t) FROM api.match_team_sides t WHERE t.season_id=f.season_id AND t.match_id=f.match_id AND t.team_id=f.home_internal_id AND t.period='all') home_stats,
             (SELECT to_json(t) FROM api.match_team_sides t WHERE t.season_id=f.season_id AND t.match_id=f.match_id AND t.team_id=f.away_internal_id AND t.period='all') away_stats,
             (SELECT d.team_stats_ok FROM api.match_detail_state d WHERE d.season_id=f.season_id AND d.match_id=f.match_id) team_stats_ok
           FROM f) r) records
       FROM publication`,
      values,
    );
    checkReadGeneration(params, snapshot?.generation);
    const side = (f, name) => ({ id: f[name + "_team_id"], name: f[name + "_name"], imageUrl: f[name + "_image_url"], score: f["score_" + name] });
    const matches = (snapshot.records || []).map(({ fixture: f, home_stats, away_stats, team_stats_ok }) => ({
      id: f.id, leagueId: f.league_id, date: f.day, timeUtc: f.time_utc, status: f.status,
      home: side(f, "home"), away: side(f, "away"),
      coverage: { teamStatsReliable: Boolean(team_stats_ok) },
      stats: teamStats(strip(home_stats), strip(away_stats), POOL_STAT_KEYS).map(({ key, home, away }) => ({ key, home, away })),
    }));
    return readResponse(
      req,
      params,
      snapshot,
      { season: label, leagueId: league, matches },
      // Validated by its version, it is asked again after 30 s (the publication's answer
      // has another address at each publication, and is kept five minutes).
      { maxBytes: 3 * 1024 * 1024, ...(gate ? { version: gate.version, etag: gate.etag } : { ttl: 300 }) },
    );
  };
}
