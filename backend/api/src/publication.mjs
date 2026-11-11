/**
 * Publication snapshot of a read, in the legacy envelope (relational-read-utils.js on
 * main): generation, publication time and the watermarks of the editions in scope.
 * Generation is api.publication (it grows with every published resource version);
 * an edition stands for a legacy partition (season × competition).
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send } from "./http.mjs";

export const bindValue = (values, value) => {
  values.push(value);
  return `$${values.length}`;
};

export function parseReadScope(params) {
  const season = params.get("season");
  if (!/^\d{4}(?:\/\d{4})?$/.test(season || "")) reject(400, "Saison invalide.");
  let leagueIds = null;
  const raw = params.get("leagues");
  if (raw === "none") leagueIds = [];
  else if (raw && raw !== "all") {
    const ids = raw.split(",");
    if (ids.length > 200 || ids.some((id) => !/^l_[A-Za-z0-9]{6}$/.test(id))) reject(400, "Périmètre invalide.");
    leagueIds = [...new Set(ids)].sort();
  }
  const league = params.get("league");
  if (league && league !== "all") {
    if (!/^l_[A-Za-z0-9]{6}$/.test(league)) reject(400, "Compétition invalide.");
    leagueIds = leagueIds === null || leagueIds.includes(league) ? [league] : [];
  }
  const generation = params.get("generation");
  if (generation !== null && !/^\d{1,20}$/.test(generation)) reject(400, "Publication invalide.");
  return { season, leagueIds };
}

/** `alias` must expose `season` (Vega label) and `league_id` (public competition id);
 * with `seasonId`, also `season_id`: the season's id is pinned, so only its partitions
 * are read (the appearance reads). */
export function scopeWhere(alias, scope, values, { seasonId = false } = {}) {
  const season = bindValue(values, scope.season);
  const pin = seasonId ? ` AND ${alias}.season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=${season})` : "";
  return `${alias}.season=${season}${pin} AND (${bindValue(values, scope.leagueIds)}::text[] IS NULL OR ${alias}.league_id=ANY($${values.length}::text[]))`;
}

/** The scope as ids (api.edition_keys, 047): its season's id and its editions. Resolved
 * before the query and bound, so the query filters on indexed ids and the planner prunes
 * the other seasons' partitions at plan time (a subquery only prunes at run time, after
 * planning every season's partitions: 39 s of planning for the Ligue 1 home). */
export const EDITIONS_SQL = `SELECT (SELECT k.season_id FROM api.season_keys k WHERE k.season=$1) AS season_id,
  coalesce((SELECT array_agg(e.competition_season_id ORDER BY e.competition_season_id) FROM api.edition_keys e
    WHERE e.season=$1 AND ($2::text[] IS NULL OR e.league_id=ANY($2::text[]))),'{}') AS ids`;
export async function resolveEditions(read, scope) {
  const [row] = await read(EDITIONS_SQL, [scope.season, scope.leagueIds]);
  return { seasonId: row?.season_id ?? null, ids: (row?.ids || []).map(Number) };
}

/** scopeWhere on resolved ids (resolveEditions): `alias` must expose `season_id` and
 * `competition_season_id`. Every league of the season needs no edition filter. */
export function idScopeWhere(alias, scope, editions, values) {
  const pin = `${alias}.season_id=${bindValue(values, editions.seasonId)}::smallint`;
  return scope.leagueIds === null ? pin : `${pin} AND ${alias}.competition_season_id=ANY(${bindValue(values, editions.ids)}::int[])`;
}

export function publicationSql(scope, values) {
  const predicate = scopeWhere("p", scope, values);
  return `SELECT g.generation::text AS generation,g.published_at,
    s.source_retrieved_at,s.latest_source_retrieved_at,s.start_date,s.end_date,s.partition_count,s.missing_watermarks
    FROM api.publication g
    CROSS JOIN LATERAL (SELECT CASE WHEN count(p.retrieved_at)=count(*) THEN min(p.retrieved_at) END source_retrieved_at,
      max(p.retrieved_at) latest_source_retrieved_at,
      min(p.start_date) start_date,max(p.end_date) end_date,count(*)::int partition_count,
      count(*) FILTER(WHERE p.retrieved_at IS NULL)::int missing_watermarks
      FROM api.editions p WHERE ${predicate}) s`;
}

const DAY = 86_400_000;
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * The version of a read made of a scope's matches: its editions, each with its version
 * (the collector advances it in the transaction that writes a match of the edition) and
 * its published counts and date, in 16 hexadecimal characters. A read that names no
 * publication is validated by it: the publication changes every five minutes while
 * anything is collected, a backfill included, and what a browser or the distribution
 * held was read again each time (on 11 November 2026 the ten editions of the European
 * scope had not changed for twenty hours).
 *
 * A club's name and image are not in it (a club's version advances with every match of
 * every season); the day is, so none stays more than a day. `shape` names the answer's
 * form: a change of it changes the version, so no kept answer of another form is said
 * unchanged.
 */
export async function scopeVersion(read, shape, scope, now) {
  const [row] = await read(
    `SELECT coalesce(json_agg(json_build_array(e.competition_season_id,coalesce(v.version,0),p.retrieved_at,p.match_count,
        p.finished_count,p.collected_count,p.team_count) ORDER BY e.competition_season_id),'[]'::json) AS editions
     FROM api.edition_keys e
     LEFT JOIN api.versions v ON v.resource_kind='competition_season' AND v.resource_id=e.competition_season_id
     LEFT JOIN api.editions p ON p.competition_season_id=e.competition_season_id
     WHERE e.season=$1 AND ($2::text[] IS NULL OR e.league_id=ANY($2::text[]))`,
    [scope.season, scope.leagueIds],
  );
  return sha([shape, scope.season, row?.editions ?? [], Math.floor(now / DAY)]).slice(0, 16);
}

/**
 * What a read validated by its version answers before working anything out: 409 when
 * `v` (the version a first page gave) is no longer the version, and "unchanged" to
 * whoever holds the answer. Gives the answer's validator, and that response if any.
 */
export function versionGate(req, params, version, { ttl = 30 } = {}) {
  const pin = params.get("v");
  if (pin !== null && pin !== version) reject(409, "Les données ont été actualisées. Rechargez la première page.");
  const etag = `W/"versioned-${sha([new URL(req.url).pathname, [...params].sort(([a], [b]) => a.localeCompare(b)), version])}"`;
  const held = req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag);
  return { version, etag, unchanged: held ? send(req, null, 200, { etag, ttl }) : null };
}

/** `v` belongs to a read that names no publication, and is a version. */
export function versionParam(params) {
  const pin = params.get("v");
  if (pin !== null && (params.has("generation") || !/^[a-f0-9]{16}$/.test(pin))) reject(400, "Publication invalide.");
  return !params.has("generation");
}

export function checkReadGeneration(params, generation) {
  if (generation == null) reject(503, "Publication indisponible.");
  if (params.has("generation") && params.get("generation") !== String(generation))
    reject(409, "Les données ont été actualisées. Rechargez la première page.");
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null);

function readEtag(req, params, snapshot, periodKey) {
  const signature = [
    new URL(req.url).pathname,
    [...params].sort(([a], [b]) => a.localeCompare(b)),
    String(snapshot.generation),
    iso(snapshot.published_at),
    iso(snapshot.source_retrieved_at),
    iso(snapshot.latest_source_retrieved_at),
    day(snapshot.start_date),
    day(snapshot.end_date),
    Number(snapshot.partition_count || 0),
    Number(snapshot.missing_watermarks || 0),
    periodKey,
  ];
  return `W/"compact-v2-${createHash("sha256").update(JSON.stringify(signature)).digest("hex")}"`;
}

/** A conditional hit or a HEAD needs only the publication, never the payload query. */
export async function readValidator(req, params, scope, read, { periodKey = null, ttl = 30, stale = null, personal = false } = {}) {
  if (req.method !== "HEAD" && !req.headers.get("if-none-match")) return null;
  const values = [];
  const [snapshot] = await read(publicationSql(scope, values), values);
  checkReadGeneration(params, snapshot?.generation);
  const etag = readEtag(req, params, snapshot, periodKey);
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag))
    return readResponse(req, params, snapshot, null, { periodKey, ttl, stale, personal });
  return null;
}

/**
 * `version` and `etag`: an answer validated by what it is made from (players.mjs,
 * selectionVersion), not by the publication. Its meta gives the version, for the
 * requests that follow to name.
 */
export function readResponse(
  req,
  params,
  snapshot,
  data,
  { pagination, maxBytes = 1024 * 1024, periodKey = null, ttl = 30, stale = null, personal = false, version = null, etag: given = null } = {},
) {
  checkReadGeneration(params, snapshot?.generation);
  const meta = {
    generation: String(snapshot.generation),
    publishedAt: iso(snapshot.published_at),
    sourceRetrievedAt: iso(snapshot.source_retrieved_at),
    latestSourceRetrievedAt: iso(snapshot.latest_source_retrieved_at),
    startDate: day(snapshot.start_date),
    endDate: day(snapshot.end_date),
    partitionCount: Number(snapshot.partition_count || 0),
    missingWatermarks: Number(snapshot.missing_watermarks || 0),
    ...(version && { version }),
  };
  const etag = given || readEtag(req, params, snapshot, periodKey);
  return send(
    req,
    { data, meta, ...(pagination && { pagination: { ...pagination, generation: meta.generation } }) },
    200,
    { etag, ttl, maxBytes, stale, personal },
  );
}

export function readPageArgs(params, defaultLimit = 20) {
  const page = Number(params.get("page") || 1),
    limit = Number(params.get("limit") || defaultLimit);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    reject(400, "Pagination invalide.");
  return { page, limit, offset: (page - 1) * limit };
}

export const normalizedSql = (column) => `regexp_replace(normalize(lower(coalesce(${column},'')),NFD),'[̀-ͯ]','','g')`;
export const likeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\\%_]/g, "\\$&");
export const finiteSql = (column) =>
  `(${column} IS NOT NULL AND ${column}::float8 NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))`;
