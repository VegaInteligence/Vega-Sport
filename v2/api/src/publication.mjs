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

export function readResponse(req, params, snapshot, data, { pagination, maxBytes = 1024 * 1024, periodKey = null, ttl = 30, stale = null, personal = false } = {}) {
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
  };
  const etag = readEtag(req, params, snapshot, periodKey);
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
