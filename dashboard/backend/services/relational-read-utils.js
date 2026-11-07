import { createHash } from "node:crypto";
import { reject, send } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";

export const finiteSql = (column) =>
  `(${column} IS NOT NULL AND ${column} NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))`;
export const normalizedSql = (column) =>
  `regexp_replace(normalize(lower(coalesce(${column},'')),NFD),'[̀-ͯ]','','g')`;
export const normalizedText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export const likeText = (value) =>
  normalizedText(value).replace(/[\\%_]/g, "\\$&");
export const bindValue = (values, value) => {
  values.push(value);
  return `$${values.length}`;
};

export function parseReadScope(params) {
  const season = params.get("season");
  if (!/^\d{4}(?:\/\d{4})?$/.test(season || ""))
    reject(400, "Saison invalide.");
  let leagueIds = null;
  const raw = params.get("leagues");
  if (raw === "none") leagueIds = [];
  else if (raw && raw !== "all") {
    const ids = raw.split(",");
    if (ids.length > 200 || ids.some((id) => !/^l_[A-Za-z0-9]{6}$/.test(id)))
      reject(400, "Périmètre invalide.");
    leagueIds = [...new Set(ids)].sort();
  }
  const league = params.get("league");
  if (league && league !== "all") {
    if (!/^l_[A-Za-z0-9]{6}$/.test(league))
      reject(400, "Compétition invalide.");
    leagueIds =
      leagueIds === null || leagueIds.includes(league) ? [league] : [];
  }
  const generation = params.get("generation");
  if (generation !== null && !/^\d{1,20}$/.test(generation))
    reject(400, "Publication invalide.");
  return { season, leagueIds };
}

export function scopeWhere(alias, scope, values) {
  return `${alias}.season=${bindValue(values, scope.season)} AND (${bindValue(values, scope.leagueIds)}::text[] IS NULL OR ${alias}.league_id=ANY($${values.length}::text[]))`;
}

/** One statement reads publication metadata and payload from the same snapshot. */
export function publicationSql(scope, values) {
  const predicate = scopeWhere("p", scope, values);
  return `SELECT g.generation::text AS generation,g.published_at,
    s.source_retrieved_at,s.latest_source_retrieved_at,s.start_date,s.end_date,s.partition_count,s.missing_watermarks
    FROM statarena_app.publications g
    CROSS JOIN LATERAL (SELECT CASE WHEN count(nullif(p.retrieved_at,''))=count(*) THEN min(p.retrieved_at) END source_retrieved_at,
      max(nullif(p.retrieved_at,'')) latest_source_retrieved_at,
      min(p.start_date) start_date,max(p.end_date) end_date,count(*)::int partition_count,
      count(*) FILTER(WHERE nullif(p.retrieved_at,'') IS NULL)::int missing_watermarks
      FROM statarena_app.partitions p WHERE ${predicate}) s WHERE g.singleton`;
}

export function checkReadGeneration(params, generation) {
  if (generation == null) reject(503, "Publication indisponible.");
  if (
    params.has("generation") &&
    params.get("generation") !== String(generation)
  )
    reject(409, "Les données ont été actualisées. Rechargez la première page.");
}

function readEtag(req, params, generation, periodKey) {
  const signature = [
    new URL(req.url).pathname,
    [...params].sort(([a], [b]) => a.localeCompare(b)),
    String(generation),
    periodKey,
  ];
  return `W/"compact-v1-${createHash("sha256").update(JSON.stringify(signature)).digest("hex")}"`;
}

/**
 * Use after validating every route parameter. A conditional hit/HEAD needs
 * only the current publication and watermarks, never a player aggregation.
 * A miss still loads its payload and metadata in one SQL snapshot. Routes
 * whose HEAD can return a record-specific 404 must validate that first.
 */
export async function readValidator(
  req,
  params,
  scope,
  read,
  { periodKey = null, ttl = 30 } = {},
) {
  if (req.method !== "HEAD" && !req.headers.get("if-none-match")) return null;
  const values = [];
  const [snapshot] = await read(publicationSql(scope, values), values);
  checkReadGeneration(params, snapshot?.generation);
  const etag = readEtag(req, params, snapshot.generation, periodKey);
  if (
    req.method === "HEAD" ||
    matchesEtag(req.headers.get("if-none-match"), etag)
  )
    return readResponse(req, params, snapshot, null, { periodKey, ttl });
  return null;
}

export function readResponse(
  req,
  params,
  snapshot,
  data,
  { pagination, maxBytes = 1024 * 1024, periodKey = null, ttl = 30 } = {},
) {
  checkReadGeneration(params, snapshot?.generation);
  const meta = {
    generation: String(snapshot.generation),
    publishedAt: snapshot.published_at,
    sourceRetrievedAt: snapshot.source_retrieved_at,
    latestSourceRetrievedAt: snapshot.latest_source_retrieved_at,
    startDate: snapshot.start_date,
    endDate: snapshot.end_date,
    partitionCount: Number(snapshot.partition_count || 0),
    missingWatermarks: Number(snapshot.missing_watermarks || 0),
  };
  const etag = readEtag(req, params, meta.generation, periodKey);
  return send(
    req,
    {
      data,
      meta,
      ...(pagination && {
        pagination: { ...pagination, generation: meta.generation },
      }),
    },
    200,
    { etag, ttl, maxBytes },
  );
}

export function readPageArgs(params, defaultLimit = 20) {
  const page = Number(params.get("page") || 1),
    limit = Number(params.get("limit") || defaultLimit);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    reject(400, "Pagination invalide.");
  return { page, limit, offset: (page - 1) * limit };
}
