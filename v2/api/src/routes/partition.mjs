/**
 * GET /api/seasons/partition — one league season, 25 matches a page, in main's season
 * document (partitionPage of relational-core.js): meta, competitions, teams, fixtures,
 * matches and appearances; `format=columns` packs it with main's own packPartition
 * (partition-wire.mjs). Pages follow the
 * (day, id) order with the cursor of /api/fixtures; `v` is the manifest's sourceDigest of
 * the partition (409 once it changed).
 *
 * GET /api/scouting/routes?player=&team= (up to 8 ids each) — the seasons and leagues of
 * each player and club (scouting() of relational-core.js), which tell the site which
 * partitions to load.
 *
 * Differences with the legacy read, by construction of v2: `metrics` is empty and
 * appearances carry no extra metrics (the site has its own labels); `warnings` are empty;
 * the match and appearance records are those of match-record.mjs and performance.mjs.
 */
import { packPartition } from "../partition-wire.mjs";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { assembleMatch, matchRecordColumns } from "../match-record.mjs";
import { fixture, nextPage, pageArgs, tag } from "./matches.mjs";
import { appearanceRecord } from "./performance.mjs";
import { editionCounts, editionDigest } from "./system.mjs";

const LEAGUE = /^l_(?:[A-Za-z0-9]{6}|v\d{7})$/,
  SEASON = /^\d{4}(?:\/\d{4})?$/;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const EDITION = "(e.season=$1 OR e.native_label=$1) AND e.league_id=$2";
// The edition's page is read on its ids ($1 the season's, $2 the edition's): bound, they
// prune the other seasons' partitions when the query is planned and read the indexes.
const SEASON_ID = "$1::smallint",
  SCOPE = `x.season_id=${SEASON_ID} AND x.competition_season_id=$2::int`;

const ids = (params, key, pattern) => {
  const raw = params.get(key) || "",
    values = raw ? raw.split(",") : [];
  if (values.length > 8 || values.some((v) => !pattern.test(v))) reject(400, "Identifiants invalides.");
  return [...new Set(values)].sort();
};
const group = (rows) => {
  const out = {};
  for (const r of rows) if (r.league_id) ((out[r.id] ??= {})[r.season] ??= []).push(r.league_id);
  return out;
};

// The ids are resolved first and bound: on the ids, a player's appearances and a club's
// matches are index reads; compared inside the query, every appearance of every season
// was read (a timeout on 10 November 2026).
async function scoutingRoutes(req, params, read) {
  validateParams(params, ["player", "team"]);
  const players = ids(params, "player", /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/),
    teams = ids(params, "team", /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/);
  if (!players.length && !teams.length) reject(400, "Précisez les identifiants.");
  const [known] = await read(
    `SELECT (SELECT generation::text FROM api.publication) AS version,
       ARRAY(SELECT api.internal_id('player',k) FROM unnest($1::text[]) WITH ORDINALITY x(k,n) ORDER BY n) AS players,
       ARRAY(SELECT api.internal_id('team',k) FROM unnest($2::text[]) WITH ORDINALITY x(k,n) ORDER BY n) AS teams`,
    [players, teams],
  );
  const etag = tag(req, known.version);
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 30 });
  const keyed = (publicIds, internal) => new Map(publicIds.map((id, i) => [internal[i], id]).filter(([key]) => key != null));
  const playerKeys = keyed(players, known.players),
    teamKeys = keyed(teams, known.teams);
  const [r] = await read(
    `SELECT (SELECT coalesce(json_agg(r ORDER BY r.key,r.season,r.league_id),'[]'::json) FROM (
          SELECT DISTINCT a.player_id AS key,f.season,f.league_id FROM api.player_appearances a
          JOIN api.fixtures f ON f.season_id=a.season_id AND f.match_id=a.match_id
          WHERE a.player_id=ANY($1::int[])) r) players,
       (SELECT coalesce(json_agg(r ORDER BY r.key,r.season,r.league_id),'[]'::json) FROM (
          SELECT x.home_internal_id AS key,x.season,x.league_id FROM api.fixtures x WHERE x.home_internal_id=ANY($2::int[])
          UNION SELECT x.away_internal_id,x.season,x.league_id FROM api.fixtures x WHERE x.away_internal_id=ANY($2::int[])) r) teams`,
    [[...playerKeys.keys()], [...teamKeys.keys()]],
  );
  // In the order of the requested ids, as the query ordered them before.
  const routes = (rows, keys) => group([...keys].flatMap(([key, id]) => rows.filter((row) => row.key === key).map((row) => ({ ...row, id }))));
  return send(req, { routes: routes(r.players, playerKeys), clubRoutes: routes(r.teams, teamKeys) }, 200, { etag, ttl: 30 });
}

export function createPartitionRoute(read) {
  return async (req, path, params) => {
    if (path === "/api/scouting/routes") return scoutingRoutes(req, params, read);
    if (path !== "/api/seasons/partition") return null;
    validateParams(params, ["season", "league", "limit", "cursor", "format", "v"]);
    const columns = params.get("format") === "columns";
    if (params.has("format") && !columns) reject(400, "Format invalide.");
    const season = params.get("season"),
      league = params.get("league");
    if (!SEASON.test(season || "") || !LEAGUE.test(league || "")) reject(400, "Saison ou compétition invalide.");
    if (params.has("v") && !/^[a-f0-9]{64}$/.test(params.get("v"))) reject(400, "Version de partition invalide.");
    const args = pageArgs(params, 25, columns ? ["partition", season, league, "columns"] : ["partition", season, league]);
    const [edition] = await read(
      `SELECT e.*,(SELECT k.season_id FROM api.edition_keys k WHERE k.competition_season_id=e.competition_season_id) AS season_id,
         (SELECT generation::text FROM api.publication) AS version
       FROM api.editions e WHERE ${EDITION} ORDER BY e.season=$1 DESC LIMIT 1`,
      [season, league],
    );
    if (!edition) reject(404, "Partition introuvable.");
    const digest = editionDigest(edition);
    if (params.has("v") && params.get("v") !== digest) reject(409, "La publication a changé. Rechargez le catalogue.");
    const state = { version: edition.version };
    if (req.method === "HEAD" || req.headers.has("if-none-match")) {
      nextPage([], state, args);
      const etag = tag(req, digest + "|" + state.version);
      if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 30 });
    }
    const values = [edition.season_id, edition.competition_season_id, args.limit, league];
    const after = args.cursor
      ? (values.push(args.cursor.day, args.cursor.id),
        ` AND (x.day > $5::date OR (x.day IS NULL AND $5::date IS NOT NULL) OR (x.day IS NOT DISTINCT FROM $5::date AND x.id > $6))`)
      : "";
    const [r] = await read(
      `WITH keys AS MATERIALIZED (SELECT x.season_id,x.match_id,x.id,x.day FROM api.fixtures x WHERE ${SCOPE}${after}
         ORDER BY x.day NULLS LAST,x.id LIMIT ($3::int+1)),
       f AS MATERIALIZED (SELECT x.* FROM api.fixtures x WHERE x.season_id=${SEASON_ID}
         AND x.match_id=ANY(ARRAY(SELECT k.match_id FROM (SELECT * FROM keys ORDER BY day NULLS LAST,id LIMIT $3) k)))
       SELECT (SELECT coalesce(json_agg(json_build_object('id',id,'day',day::text) ORDER BY day NULLS LAST,id),'[]'::json) FROM keys) keys,
         (SELECT coalesce(json_agg(row_to_json(f) ORDER BY f.day NULLS LAST,f.id),'[]'::json) FROM f) fixtures,
         (SELECT coalesce(json_agg(r ORDER BY r.day NULLS LAST,r.id),'[]'::json) FROM (SELECT f.day,f.id,${matchRecordColumns({ season: SEASON_ID })} FROM f) r) records,
         (SELECT coalesce(json_agg(r ORDER BY r.match_key,r.appearance_id),'[]'::json) FROM (
            SELECT a.*,f.id AS match_key,f.id||':'||api.public_id('player',a.player_id) AS appearance_id,
              api.public_id('player',a.player_id) AS player_key,api.public_id('team',a.team_id) AS team_key
            FROM f JOIN api.player_appearances a ON a.season_id=f.season_id AND a.match_id=f.match_id
            WHERE a.season_id=${SEASON_ID} AND a.match_id=ANY(ARRAY(SELECT match_id FROM f))) r) appearances,
         (SELECT coalesce(json_agg(r ORDER BY r.id),'[]'::json) FROM (
            SELECT k.public_id AS id,k.name,k.image_url,k.country,
              (SELECT count(*)::int FROM api.fixtures x JOIN api.match_detail_state d ON d.season_id=x.season_id AND d.match_id=x.match_id
                WHERE (x.home_internal_id=k.team_id OR x.away_internal_id=k.team_id) AND d.detail_collected AND ${SCOPE}
                  AND d.season_id=${SEASON_ID}) sample_matches
            FROM api.team_keys k
            WHERE k.team_id IN (SELECT home_internal_id FROM api.fixtures x WHERE ${SCOPE} UNION SELECT away_internal_id FROM api.fixtures x WHERE ${SCOPE})) r) teams,
         (SELECT coalesce(json_agg(c),'[]'::json) FROM api.competitions c WHERE c.id=$4) competitions`,
      values,
    );
    const pagination = nextPage(r.keys, state, args);
    const appearances = (r.appearances || []).map(appearanceRecord);
    const ids = new Map();
    for (const a of appearances) ids.set(a.matchId, [...(ids.get(a.matchId) || []), a.id]);
    const sample = Number(edition.collected_count);
    const data = {
      meta: {
        ...editionCounts(edition),
        source: "AWS",
        retrievedAt: iso(edition.retrieved_at),
        currentSeason: season,
        startDate: edition.start_date,
        endDate: edition.end_date,
        notes: [],
      },
      metrics: [],
      competitions: (r.competitions || []).map((c) => ({
        id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: c.image_url, seasons: c.seasons || [],
        sampleSeasons: sample ? [season] : [], sampleMatches: sample,
      })),
      teams: (r.teams || []).map((t) => ({
        id: t.id, name: t.name, imageUrl: t.image_url, country: t.country ?? null, sampleMatches: t.sample_matches, seasons: [season], leagueIds: [league],
      })),
      fixtures: (r.fixtures || []).map(fixture),
      matches: (r.records || [])
        .map((m) => assembleMatch(m))
        .filter(Boolean)
        .map((m) => ({ ...m, players: ids.get(m.id) || [] })),
      appearances,
    };
    return send(req, { data: columns ? packPartition(data) : data, pagination }, 200, {
      etag: tag(req, digest + "|" + state.version),
      ttl: 30,
      maxBytes: 2 * 1024 * 1024,
    });
  };
}
