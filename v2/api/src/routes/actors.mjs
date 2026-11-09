/**
 * GET /api/read/player and GET /api/read/club — one actor's matches of a scope, a page
 * at a time: fixtures, the collected matches in the legacy match record, the actor's
 * appearances, the context teams and competitions. Same parameters and same response
 * as relational-actors.js on main.
 *
 * Differences with the legacy read, by construction of v2: `metrics` is empty (the
 * partition metric catalogue has no v2 counterpart; the site has its own labels);
 * a team's `sampleMatches` counts its collected matches of the scope; the match and
 * appearance records are those of match-record.mjs and performance.mjs.
 */
import { reject, validateParams } from "../http.mjs";
import { bindValue, checkReadGeneration, parseReadScope, publicationSql, readPageArgs, readResponse, readValidator, scopeWhere } from "../publication.mjs";
import { assembleMatch, matchRecordColumns } from "../match-record.mjs";
import { fixture } from "./matches.mjs";
import { appearanceRecord } from "./performance.mjs";

const ACTOR = { player: /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/, club: /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/ };

export function actorQuery(kind, scope, actor, includes, pagination, generation) {
  const values = [],
    publication = publicationSql(scope, values);
  const fence = generation === null ? "" : ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, generation)})`;
  const actorParam = bindValue(values, actor);
  const withAppearances = kind === "player" || includes.has("appearances");
  const candidates =
    kind === "player"
      ? `SELECT DISTINCT x.season_id,x.match_id,x.id,x.day FROM api.player_appearances a
         JOIN api.fixtures x ON x.season_id=a.season_id AND x.match_id=a.match_id
         WHERE a.player_id=(SELECT id FROM actor) AND ${scopeWhere("a", scope, values)}${fence}`
      : `SELECT x.season_id,x.match_id,x.id,x.day FROM api.fixtures x
         WHERE (x.home_internal_id=(SELECT id FROM actor) OR x.away_internal_id=(SELECT id FROM actor)) AND ${scopeWhere("x", scope, values)}${fence}`;
  const limit = bindValue(values, pagination.limit),
    offset = bindValue(values, pagination.offset);
  // Bound only when used: an unused parameter has no type for PostgreSQL.
  const appearanceScope = withAppearances ? scopeWhere("a", scope, values) : null;
  const teamScope = scopeWhere("x", scope, values);
  const sql = `WITH publication AS MATERIALIZED (${publication}),
    actor AS MATERIALIZED (SELECT api.internal_id('${kind === "player" ? "player" : "team"}',${actorParam}) id),
    actor_matches AS MATERIALIZED (${candidates}),
    page AS MATERIALIZED (SELECT * FROM actor_matches ORDER BY day DESC NULLS LAST,id DESC LIMIT ${limit} OFFSET ${offset}),
    f AS MATERIALIZED (SELECT x.* FROM api.fixtures x JOIN page p ON x.season_id=p.season_id AND x.match_id=p.match_id),
    context_teams AS (SELECT home_internal_id AS id FROM f UNION SELECT away_internal_id FROM f)
    SELECT publication.*,(SELECT count(*)::int FROM actor_matches) AS total,
      (SELECT coalesce(json_agg(row_to_json(f) ORDER BY f.day DESC NULLS LAST,f.id DESC),'[]'::json) FROM f) fixtures,
      (SELECT coalesce(json_agg(r ORDER BY r.day DESC NULLS LAST,r.id DESC),'[]'::json) FROM (
         SELECT f.day,f.id,${matchRecordColumns({ shots: includes.has("shots") })} FROM f) r) records,
      ${
        withAppearances
          ? `(SELECT coalesce(json_agg(r ORDER BY r.match_key,r.appearance_id),'[]'::json) FROM (
         SELECT a.*,f.id AS match_key,f.id||':'||api.public_id('player',a.player_id) AS appearance_id,
           api.public_id('player',a.player_id) AS player_key,api.public_id('team',a.team_id) AS team_key
         FROM f JOIN api.player_appearances a ON a.season_id=f.season_id AND a.match_id=f.match_id
         WHERE a.${kind === "player" ? "player_id" : "team_id"}=(SELECT id FROM actor) AND ${appearanceScope}) r)`
          : "'[]'::json"
      } appearances,
      (SELECT coalesce(json_agg(r ORDER BY r.id),'[]'::json) FROM (
         SELECT k.public_id AS id,k.name,k.image_url,c.country,
           (SELECT array_agg(DISTINCT x.league_id ORDER BY x.league_id) FROM api.fixtures x
             WHERE (x.home_internal_id=k.team_id OR x.away_internal_id=k.team_id) AND ${teamScope}) league_ids,
           (SELECT count(*)::int FROM api.fixtures x JOIN api.match_detail_state d ON d.season_id=x.season_id AND d.match_id=x.match_id
             WHERE (x.home_internal_id=k.team_id OR x.away_internal_id=k.team_id) AND d.detail_collected AND ${teamScope}) sample_matches
         FROM api.team_keys k LEFT JOIN api.team_countries c ON c.team_id=k.public_id
         WHERE k.team_id IN (SELECT id FROM context_teams)) r) teams,
      (SELECT coalesce(json_agg(c ORDER BY c.id),'[]'::json) FROM api.competitions c WHERE c.id IN (SELECT league_id FROM f)) competitions
    FROM publication`;
  return { sql, values, withAppearances };
}

export function createActorRoute(read) {
  return async (req, path, params) => {
    const kind = path === "/api/read/player" ? "player" : path === "/api/read/club" ? "club" : null;
    if (!kind) return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const actorKey = kind === "player" ? "player" : "team";
    validateParams(params, ["season", "leagues", "league", "generation", actorKey, "page", "limit", "include", "detail"]);
    const actor = params.get(actorKey);
    if (!ACTOR[kind].test(actor || "")) reject(400, "Identifiant invalide.");
    const includes = new Set((params.get("include") || "").split(",").filter(Boolean));
    if ([...includes].some((value) => !["appearances", "shots"].includes(value))) reject(400, "Détail invalide.");
    const detail = params.get("detail") || "full";
    if (!["full", "summary"].includes(detail)) reject(400, "Détail invalide.");
    const scope = parseReadScope(params),
      pagination = readPageArgs(params, 25);
    const cached = await readValidator(req, params, scope, read);
    if (cached) return cached;
    const request = actorQuery(kind, scope, actor, includes, pagination, params.get("generation"));
    const [snapshot] = await read(request.sql, request.values);
    checkReadGeneration(params, snapshot?.generation);
    const appearances = (snapshot.appearances || []).map(appearanceRecord);
    const ids = new Map();
    for (const a of appearances) ids.set(a.matchId, [...(ids.get(a.matchId) || []), a.id]);
    const matches = (snapshot.records || [])
      .map((r) => assembleMatch(r))
      .filter(Boolean)
      .map((m) => {
        // As on main: a summary keeps a club's team statistics and its reliability flag only.
        if (detail === "summary") {
          if (kind === "player") m.stats = [];
          m.coverage = kind === "club" ? { teamStatsReliable: m.coverage.teamStatsReliable } : {};
        }
        m.players = ids.get(m.id) || [];
        return m;
      });
    const data = {
      meta: {
        storage: "aws-relational",
        currentSeason: scope.season,
        source: "AWS",
        retrievedAt: snapshot.source_retrieved_at,
        startDate: snapshot.start_date,
        endDate: snapshot.end_date,
        shotsLoaded: includes.has("shots"),
        appearancesLoaded: request.withAppearances,
        actor: { kind, id: actor },
        detail,
        notes: [],
      },
      metrics: [],
      competitions: (snapshot.competitions || []).map((c) => ({
        id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: c.image_url, seasons: c.seasons || [],
      })),
      teams: (snapshot.teams || []).map((t) => ({
        id: t.id, name: t.name, imageUrl: t.image_url, country: t.country ?? null, leagueIds: t.league_ids || [],
        sampleMatches: t.sample_matches, seasons: [scope.season],
      })),
      fixtures: (snapshot.fixtures || []).map(fixture),
      matches,
      appearances,
    };
    const total = Number(snapshot.total || 0);
    return readResponse(req, params, snapshot, data, {
      pagination: { page: pagination.page, limit: pagination.limit, total, pages: Math.max(1, Math.ceil(total / pagination.limit)) },
      maxBytes: 2 * 1024 * 1024,
    });
  };
}
