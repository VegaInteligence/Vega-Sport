/**
 * GET /api/read/player and GET /api/read/club — one actor's matches of a scope, a page
 * at a time: fixtures, the collected matches in the legacy match record, the actor's
 * appearances, the context teams and competitions. Same parameters and same response
 * as relational-actors.js on main.
 *
 * GET /api/read/league — every match of one competition's season (`played=1`: the
 * finished ones), in the summary detail of the club read. A club profile ranks its club against the league's other clubs: it
 * read each of them (twenty reads of the same matches, each match twice); this is the
 * same matches once.
 *
 * Differences with the legacy read, by construction: `metrics` is empty (the
 * partition metric catalogue has no counterpart here; the site has its own labels);
 * a team's `sampleMatches` counts its collected matches of the scope; the match and
 * appearance records are those of match-record.mjs and performance.mjs.
 */
import { reject, validateParams } from "../http.mjs";
import {
  EDITIONS_SQL,
  bindValue,
  checkReadGeneration,
  editionsVersion,
  parseReadScope,
  publicationSql,
  readPageArgs,
  readResponse,
  readValidator,
  scopeVersion,
  versionGate,
  versionParam,
} from "../publication.mjs";
import { assembleMatch, matchRecordColumns } from "../match-record.mjs";
import { fixture } from "./matches.mjs";
import { appearanceRecord } from "./performance.mjs";

const ACTOR = { player: /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/, club: /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/ };

/** The scope and the actor as ids, in one read before the query: the season's id and
 * its editions (publication.mjs EDITIONS_SQL) and the actor's internal id. Bound, they
 * are constants for the planner: one season's partitions, and the indexes on the ids
 * (the same reads on labels took 93 s for a club on 10 November 2026). */
export async function resolveActor(read, kind, scope, actor) {
  const [row] = await read(
    `SELECT e.season_id,e.ids,${kind === "league" ? "NULL::int" : `api.internal_id('${kind === "player" ? "player" : "team"}',$3)`} AS actor FROM (${EDITIONS_SQL}) e`,
    kind === "league" ? [scope.season, scope.leagueIds] : [scope.season, scope.leagueIds, actor],
  );
  return { seasonId: row?.season_id ?? null, ids: (row?.ids || []).map(Number), actorId: row?.actor ?? null };
}

/** `played`: a league's finished matches only (the other kinds take no such filter). */
export function actorQuery(kind, scope, actor, includes, pagination, generation, resolved, { played = false } = {}) {
  const values = [],
    publication = publicationSql(scope, values);
  const fence = generation === null ? "" : ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, generation)})`;
  const season = `${bindValue(values, resolved.seasonId)}::smallint`,
    // Bound only when used: an unused parameter has no type for PostgreSQL.
    actorId = kind === "league" ? null : `${bindValue(values, resolved.actorId)}::int`,
    editions = scope.leagueIds === null ? null : `${bindValue(values, resolved.ids)}::int[]`;
  const pin = (alias) => `${alias}.season_id=${season}`,
    inScope = (alias) => (editions ? `${pin(alias)} AND ${alias}.competition_season_id=ANY(${editions})` : pin(alias));
  const withAppearances = kind === "player" || includes.has("appearances");
  const candidates =
    kind === "league"
      ? `SELECT x.season_id,x.match_id,x.id,x.day FROM api.fixtures x WHERE ${inScope("x")}${played ? " AND x.status='finished'" : ""}${fence}`
      : kind === "player"
      ? // His matches by their ids, then their fixtures: joined to the appearances, the
        // fixtures of the whole season were built first (0.2 s for 14 matches).
        `SELECT x.season_id,x.match_id,x.id,x.day FROM api.fixtures x
         WHERE ${pin("x")} AND x.match_id=ANY(ARRAY(SELECT a.match_id FROM api.player_appearances a
           WHERE a.player_id=${actorId} AND ${inScope("a")}))${fence}`
      : `SELECT x.season_id,x.match_id,x.id,x.day FROM api.fixtures x
         WHERE (x.home_internal_id=${actorId} OR x.away_internal_id=${actorId}) AND ${inScope("x")}${fence}`;
  const limit = bindValue(values, pagination.limit),
    offset = bindValue(values, pagination.offset);
  // The page's matches as an array: one index read per match, where a join against the
  // page would read the season's matches (and, for the appearances, the season's players).
  const paged = (alias) => `${pin(alias)} AND ${alias}.match_id=ANY(ARRAY(SELECT match_id FROM page))`;
  const sql = `WITH publication AS MATERIALIZED (${publication}),
    actor_matches AS MATERIALIZED (${candidates}),
    page AS MATERIALIZED (SELECT * FROM actor_matches ORDER BY day DESC NULLS LAST,id DESC LIMIT ${limit} OFFSET ${offset}),
    f AS MATERIALIZED (SELECT x.* FROM api.fixtures x WHERE ${paged("x")}),
    context_teams AS (SELECT home_internal_id AS id FROM f UNION SELECT away_internal_id FROM f)
    SELECT publication.*,(SELECT count(*)::int FROM actor_matches) AS total,
      (SELECT coalesce(json_agg(row_to_json(f) ORDER BY f.day DESC NULLS LAST,f.id DESC),'[]'::json) FROM f) fixtures,
      (SELECT coalesce(json_agg(r ORDER BY r.day DESC NULLS LAST,r.id DESC),'[]'::json) FROM (
         SELECT f.day,f.id,${matchRecordColumns({ shots: includes.has("shots"), season })} FROM f) r) records,
      ${
        withAppearances
          ? `(SELECT coalesce(json_agg(r ORDER BY r.match_key,r.appearance_id),'[]'::json) FROM (
         SELECT a.*,f.id AS match_key,f.id||':'||api.public_id('player',a.player_id) AS appearance_id,
           api.public_id('player',a.player_id) AS player_key,api.public_id('team',a.team_id) AS team_key
         FROM f JOIN api.player_appearances a ON a.season_id=f.season_id AND a.match_id=f.match_id
         WHERE a.${kind === "player" ? "player_id" : "team_id"}=${actorId} AND ${paged("a")}) r)`
          : "'[]'::json"
      } appearances,
      (SELECT coalesce(json_agg(r ORDER BY r.id),'[]'::json) FROM (
         SELECT k.public_id AS id,k.name,k.image_url,k.country,
           (SELECT array_agg(DISTINCT x.league_id ORDER BY x.league_id) FROM api.fixtures x
             WHERE (x.home_internal_id=k.team_id OR x.away_internal_id=k.team_id) AND ${inScope("x")}) league_ids,
           (SELECT count(*)::int FROM api.fixtures x JOIN api.match_detail_state d ON d.season_id=x.season_id AND d.match_id=x.match_id
             WHERE (x.home_internal_id=k.team_id OR x.away_internal_id=k.team_id) AND d.detail_collected AND ${inScope("x")} AND ${pin("d")}) sample_matches
         FROM api.team_keys k
         WHERE k.team_id IN (SELECT id FROM context_teams)) r) teams,
      (SELECT coalesce(json_agg(c ORDER BY c.id),'[]'::json) FROM api.competitions c WHERE c.id IN (SELECT league_id FROM f)) competitions
    FROM publication`;
  return { sql, values, withAppearances };
}

// The form of each kind's answer (its version names it): to change with it.
const SHAPE = { league: "league-1", club: "club-1", player: "player-1" };

/**
 * The version of an actor's read that names no publication. A league's is its edition's.
 * A club's or a player's is made of the editions of his own matches in the scope (a
 * season's every edition changes with any league's match): where the read finds his
 * matches, the fixtures of a club and the appearances of a player.
 */
function actorVersion(read, kind, scope, actor, resolved, now) {
  if (kind === "league") return scopeVersion(read, SHAPE.league, scope, now);
  const values = [resolved.seasonId, resolved.actorId];
  const editions = scope.leagueIds === null ? "" : ` AND x.competition_season_id=ANY(${bindValue(values, resolved.ids)}::int[])`;
  const matches =
    kind === "player"
      ? `api.player_appearances x WHERE x.player_id=$2::int`
      : `api.fixtures x WHERE (x.home_internal_id=$2::int OR x.away_internal_id=$2::int)`;
  return editionsVersion(
    read,
    [SHAPE[kind], scope.season, actor],
    `SELECT DISTINCT x.competition_season_id AS id FROM ${matches} AND x.season_id=$1::smallint${editions}`,
    values,
    now,
  );
}

export function createActorRoute(read, { clock = Date.now } = {}) {
  return async (req, path, params) => {
    const kind = { "/api/read/player": "player", "/api/read/club": "club", "/api/read/league": "league" }[path];
    if (!kind) return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const actorKey = kind === "player" ? "player" : "team";
    validateParams(params, kind === "league" ? ["season", "league", "generation", "page", "limit", "detail", "played", "v"] : ["season", "leagues", "league", "generation", "v", actorKey, "page", "limit", "include", "detail"]);
    // `played=1`: the finished matches alone. A club profile ranks the league on them; the
    // matches to come were three of the four pages it read in November.
    const played = params.get("played");
    if (played !== null && played !== "1") reject(400, "Filtre invalide.");
    const includes = new Set((params.get("include") || "").split(",").filter(Boolean));
    if ([...includes].some((value) => !["appearances", "shots"].includes(value))) reject(400, "Détail invalide.");
    const detail = params.get("detail") || "full";
    if (!["full", "summary"].includes(detail)) reject(400, "Détail invalide.");
    const scope = parseReadScope(params),
      pagination = readPageArgs(params, 25);
    // A league is read whole in the summary detail only: one competition, no player rows.
    if (kind === "league" && (scope.leagueIds?.length !== 1 || detail !== "summary")) reject(400, "Périmètre invalide.");
    const actor = kind === "league" ? scope.leagueIds[0] : params.get(actorKey);
    if (kind !== "league" && !ACTOR[kind].test(actor || "")) reject(400, "Identifiant invalide.");
    // A read that names no publication is validated by the version of what it is made
    // from: whoever holds it keeps it until a match of its editions changes.
    const versioned = versionParam(params);
    const cached = versioned ? null : await readValidator(req, params, scope, read);
    if (cached) return cached;
    // A league's version needs none of its ids: it is asked before anything else.
    let gate = versioned && kind === "league" ? versionGate(req, params, await actorVersion(read, kind, scope, actor, null, clock())) : null;
    if (gate?.unchanged) return gate.unchanged;
    const resolved = await resolveActor(read, kind, scope, actor);
    if (versioned && !gate) {
      gate = versionGate(req, params, await actorVersion(read, kind, scope, actor, resolved, clock()));
      if (gate.unchanged) return gate.unchanged;
    }
    const request = actorQuery(kind, scope, actor, includes, pagination, params.get("generation"), resolved, { played: played === "1" });
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
          m.coverage = kind === "player" ? {} : { teamStatsReliable: m.coverage.teamStatsReliable };
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
      ...(gate && { version: gate.version, etag: gate.etag }),
    });
  };
}
