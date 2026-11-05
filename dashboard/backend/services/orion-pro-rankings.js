import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";

const representation = "summary-v1-shots-v1";
const maxEditions = 512, maxRows = 4096, maxComponents = 32768, maxBytes = 2 * 1024 * 1024;
const kinds = new Set(["uefa-clubs", "uefa-associations", "fifa-men"]);
const providers = { fifa: "FIFA", uefa: "UEFA", sportsapi: "SportsAPI" };
const routes = new Map([
  ["/api/rankings/index", ["index", []]],
  ["/api/rankings/edition", ["edition", ["kind", "edition"]]],
  ["/api/rankings/associations", ["associations", ["year"]]],
  ["/api/rankings/club", ["club", ["club"]]],
]);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = () => reject(400, "Paramètres de classement invalides.");
const missing = () => reject(404, "Classement non renseigné.");
const pending = () => reject(503, "Classement non vérifié.");
const oversized = () => reject(413, "Classement trop volumineux.");
const yearKey = (year) => /^[0-9]{4}$/.test(year) && year !== "0000";
function calendarDate(day) {
  const t = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day &&
    yearKey(day.slice(0, 4));
}
function editionRole(kind, key) {
  if (!kinds.has(kind) || typeof key !== "string") return null;
  if (kind !== "fifa-men" && key.endsWith(".uefa") && yearKey(key.slice(0, -5))) return "uefa";
  const match = /^(\d{4}-\d{2}-\d{2})\.(fifa|sportsapi)$/.exec(key);
  if (match && calendarDate(match[1]) && (match[2] !== "fifa" || kind === "fifa-men")) return match[2];
  return null;
}
function argumentsFor(path, params) {
  const route = routes.get(path);
  if (!route) return null;
  const [action, fields] = route;
  validateParams(params, [...fields, "v"]);
  const v = params.get("v");
  const pin = v === null ? null : /^pro1\.([1-9][0-9]{0,18})\.([a-f0-9]{64})$/.exec(v);
  if (v !== null && (!pin || BigInt(pin[1]) > 9223372036854775807n)) invalid();
  let kind = null, edition = null, provider = null;
  const club = params.get("club");
  if (action === "edition") {
    kind = params.get("kind");
    edition = params.get("edition");
    provider = editionRole(kind, edition);
    if (!provider) invalid();
  }
  if (action === "associations") {
    const year = params.get("year") ?? "";
    if (!yearKey(year)) invalid();
    kind = "uefa-associations";
    edition = year + ".uefa";
    provider = "uefa";
  }
  if (action === "club") {
    if (!/^t_[A-Za-z0-9]{6}$/.test(club ?? "")) invalid();
    kind = "uefa-clubs";
    provider = "uefa";
  }
  return { action, kind, edition, provider, club, v, buildId: pin?.[1] ?? null };
}

const currentCatalogue = `/*orion:rankingscataloguemeta*/
SELECT c.id::text AS catalogue_id,c.generation::text AS cg,c.manifest_sha256 AS catalogue_digest,p.representation_version
FROM analytics.catalog_publication p
JOIN ingest.dataset_snapshots c ON c.id=p.catalog_snapshot_id AND c.status='sealed'
WHERE p.singleton AND EXISTS (
 SELECT 1 FROM analytics.publication_versions pub
 JOIN analytics.aggregation_builds b ON b.id=pub.build_id AND b.status='ready'
  AND b.competition_season_id=pub.competition_season_id AND b.catalog_snapshot_id=pub.catalog_snapshot_id
  AND b.representation_version=pub.representation_version
 JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
 WHERE pub.catalog_snapshot_id=c.id AND pub.representation_version=p.representation_version
  AND pub.published_to_gen IS NULL
)`;
const pinnedCatalogue = `/*orion:rankingscataloguepin*/
SELECT b.id::text AS build_id,b.competition_season_id::text AS edition_id,b.dataset_snapshot_id::text,
 d.generation::text AS dg,c.id::text AS catalogue_id,c.generation::text AS cg,c.manifest_sha256 AS catalogue_digest,
 b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
 b.metrics_contract_version,b.transform_version
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
WHERE b.id=$1::bigint AND b.status='ready' AND EXISTS (
 SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id
  AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id
  AND p.representation_version=b.representation_version
)`;
async function catalogue(args) {
  const [row] = await (args.buildId ? query(pinnedCatalogue, [args.buildId]) : query(currentCatalogue));
  if (!row || row.representation_version !== representation) pending();
  if (args.buildId) {
    const pin = digest([
      row.build_id, row.edition_id, row.dataset_snapshot_id, row.dg, row.catalogue_id, row.cg,
      row.representation_version, row.code_content_sha256, row.dependencies_sha256, row.environment_sha256,
      row.metrics_contract_version, row.transform_version,
    ]);
    if (args.v !== "pro1." + row.build_id + "." + pin) invalid();
  }
  return row;
}
const active = (alias, g) => `${alias}.recorded_from_gen<=${g}
 AND (${alias}.recorded_to_gen IS NULL OR ${g}<${alias}.recorded_to_gen)
 AND NOT ${alias}.is_deleted`;
const clubIdentitySql = `/*orion:rankingsclubidentitymeta*/
SELECT a.team_id::text AS actor_id,a.recorded_from_gen::text AS alias_generation,
 m.external_id,m.recorded_from_gen::text AS source_generation,m.source_record_id::text
FROM ingest.public_aliases a
LEFT JOIN LATERAL (
 SELECT q.external_id,q.recorded_from_gen,q.source_record_id FROM football.team_source_ids q
 JOIN ingest.sources src ON src.id=q.source_id AND src.code='uefa'
 JOIN ingest.source_records r ON r.id=q.source_record_id AND r.source_id=q.source_id AND r.external_key=q.external_id
 JOIN ingest.source_documents d ON d.id=r.document_id AND d.source_id=q.source_id
 JOIN ingest.source_datasets ds ON ds.id=d.dataset_id AND ds.source_id=d.source_id
 JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=d.id AND sd.snapshot_id=$2::bigint
 WHERE q.team_id=a.team_id AND ${active("q", "$1::bigint")} AND q.external_id ~ '^[0-9]{1,12}$'
  AND ((ds.contract_version='orion-rankings-v1' AND ds.dataset_key='rankings:uefa-clubs'
       AND r.record_kind IN ('ranking_identity_v1','ranking_entry_v1'))
    OR (ds.contract_version='orion-enrichment-v1' AND r.record_kind='enrichment_fact_v1'))
 ORDER BY q.external_id LIMIT 2
) m ON true
WHERE a.route_kind='team' AND a.public_key=$3 AND ${active("a", "$1::bigint")}
ORDER BY a.recorded_from_gen,m.external_id LIMIT 2`;

const utc = (value) => `CASE WHEN isfinite(${value}) THEN
 to_char(${value} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`;
const rankingScope = `latest AS MATERIALIZED (
 SELECT DISTINCT ON (s.system_id,s.edition_key)
  s.id AS snapshot_id,s.system_id,s.subject_kind,s.edition_key,s.official_edition,
  CASE WHEN octet_length(s.period_label)<=1024 THEN s.period_label END AS period_label,
  coalesce(octet_length(s.period_label)>1024,false) AS long_period,
  s.recorded_from_gen AS observed_gen,s.revision,s.base_season_year,s.target_season_year,
  CASE WHEN isfinite(s.effective_on) THEN to_char(s.effective_on,'YYYY-MM-DD') END AS effective_on,
  ${utc("s.retrieved_at")} AS retrieved_at,${utc("s.source_updated_at")} AS source_updated_at,
  ${utc("s.published_at")} AS published_at,
  sys.code AS kind,src.code AS source_code,d.id AS document_id,d.source_id,d.content_sha256,
  CASE WHEN octet_length(d.source_url)<=2048 THEN d.source_url END AS source_url,
  coalesce(s.quality_flags->'ranking_collection_complete'='true'::jsonb,false) AS complete
 FROM football.ranking_snapshots s
 JOIN football.ranking_systems sys ON sys.id=s.system_id AND sys.subject_kind=s.subject_kind
  AND sys.recorded_from_gen<=s.recorded_from_gen AND sys.gender='men'
 JOIN ingest.dataset_snapshots origin ON origin.generation=s.recorded_from_gen AND origin.status='sealed'
 JOIN ingest.source_documents d ON d.id=s.source_document_id
 JOIN ingest.sources src ON src.id=d.source_id
 JOIN ingest.source_datasets ds ON ds.id=d.dataset_id AND ds.source_id=d.source_id
  AND ds.contract_version='orion-rankings-v1' AND ds.dataset_key='rankings:' || sys.code
 JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=d.id AND sd.snapshot_id=$2::bigint
 WHERE s.recorded_from_gen<=$1::bigint
  AND ($3::text IS NULL OR sys.code=$3) AND ($4::text IS NULL OR s.edition_key=$4)
  AND ($5::text IS NULL OR src.code=$5)
  AND ((sys.code='uefa-associations' AND sys.subject_kind='association')
    OR (sys.code IN ('fifa-men','uefa-clubs') AND sys.subject_kind='team'))
  AND ((src.code='uefa' AND sys.authority='UEFA' AND sys.code<>'fifa-men' AND s.edition_key ~ '^[0-9]{4}[.]uefa$')
    OR (src.code='fifa' AND sys.authority='FIFA' AND sys.code='fifa-men'
        AND s.edition_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[.]fifa$')
    OR (src.code='sportsapi' AND sys.authority='SportsAPI'
        AND s.edition_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[.]sportsapi$'))
 ORDER BY s.system_id,s.edition_key,s.revision DESC
), scope AS MATERIALIZED (
 SELECT * FROM latest ORDER BY kind COLLATE "C" DESC,edition_key COLLATE "C" DESC,system_id
 LIMIT ${maxEditions + 1}
)`;
const subjects = [
  { kind: "team", key: "team_id", points: "points" },
  { kind: "association", key: "association_id", points: "coefficient" },
];
const seasonalNumerics = [
  ["value", "totalPoints"], ["national_association_points", "nationalAssociationPoints"],
  ["total_value", "totalValue"], ["total_points_with_bonus", "totalPointsWithBonus"],
  ["factor_bonus_for_title_held", "factorBonusForTitleHeld"], ["factor_total_bonus", "factorTotalBonus"],
];
const seasonalIntegers = [
  ["component_rank", "position"], ["matches_count", "numberOfMatches"],
  ["teams_count", "numberOfTeams"], ["teams_still_playing", "numberOfTeamsStillInPlaying"],
];
const finiteNumeric = (column) => `coalesce(${column}::text NOT IN ('NaN','Infinity','-Infinity'),true)`;
const componentValid = [
  "c.component_period ~ '^[0-9]{4}$' AND c.component_period<>'0000'",
  ...seasonalNumerics.map(([k]) => finiteNumeric("c." + k)),
].join(" AND ");
function componentMetadata({ kind, key }) {
  return `SELECT s.snapshot_id,count(*)::int AS component_count,bool_and(c.valid) AS components_valid,
 count(*) FILTER (WHERE c.actor_id=$6::bigint)::int AS club_component_count
FROM scope s CROSS JOIN LATERAL (
 SELECT c.${key} AS actor_id,${componentValid} AS valid FROM football.${kind}_ranking_components c
 WHERE c.snapshot_id=s.snapshot_id LIMIT ${maxComponents + 1}
) c
WHERE s.subject_kind='${kind}' AND s.complete GROUP BY s.snapshot_id`;
}
function componentBody({ kind, key }) {
  const fields = [
    "'period',c.component_period",
    ...seasonalNumerics.map(([k]) => "'" + k + "',c." + k + "::text"),
    ...seasonalIntegers.map(([k]) => "'" + k + "',c." + k),
  ];
  return `LEFT JOIN LATERAL (
 SELECT jsonb_agg(jsonb_build_object(${fields.join(",")} ) ORDER BY c.component_period COLLATE "C") AS parts
 FROM football.${kind}_ranking_components c
 WHERE c.snapshot_id=s.snapshot_id AND c.${key}=e.${key}
) seasonal ON true`;
}
function entries(subject, body) {
  const { kind, key, points } = subject;
  const select = body
    ? `e.${points}::text AS points,e.earned_points::text,e.previous_rank,p.display_name,p.country_code_source,
  coalesce(seasonal.parts,'[]'::jsonb) AS parts`
    : `r.id IS NOT NULL AND sd.document_id IS NOT NULL AND mr.id IS NOT NULL AND p.id IS NOT NULL
  AND CASE WHEN s.source_code='uefa' THEN r.external_key ~ '^[0-9]{1,12}$'
    ELSE char_length(btrim(r.external_key)) BETWEEN 1 AND 128 AND r.external_key !~ '[[:cntrl:]]' END
  AND char_length(btrim(p.display_name)) BETWEEN 1 AND 512 AND p.display_name !~ '[[:cntrl:]]'
  AND coalesce(char_length(p.country_code_source)<=64 AND p.country_code_source !~ '[[:cntrl:]]',true)
  AND ${finiteNumeric("e." + points)} AND ${finiteNumeric("e.earned_points")} AS valid,
  512 + 2 * (coalesce(octet_length(to_json(p.display_name)::text),0)
      + coalesce(octet_length(to_json(p.country_code_source)::text),0)
      + coalesce(octet_length(to_json(r.external_key)::text),0)) AS row_bytes`;
  const actorFilter = body ? `AND ($3::bigint IS NULL OR e.${key}=$3)` : "";
  return `SELECT s.snapshot_id,e.${key} AS actor_id,e.rank,r.external_key,r.document_id,r.ordinal,
 ${select}
FROM scope s CROSS JOIN LATERAL (
 SELECT e.* FROM football.${kind}_ranking_entries e WHERE e.snapshot_id=s.snapshot_id ${actorFilter}
 ORDER BY e.${key} LIMIT ${maxRows + 1}
) e
LEFT JOIN ingest.source_records r ON r.id=e.source_record_id AND r.source_id=s.source_id AND r.record_kind='ranking_entry_v1'
LEFT JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=r.document_id AND sd.snapshot_id=$2::bigint
LEFT JOIN football.${kind}_source_ids m ON m.${key}=e.${key} AND m.source_id=s.source_id
 AND m.external_id=r.external_key AND ${active("m", "s.observed_gen")}
LEFT JOIN ingest.source_records mr ON mr.id=m.source_record_id AND mr.source_id=m.source_id AND mr.external_key=m.external_id
LEFT JOIN football.${kind}_profile_versions p ON p.${key}=e.${key} AND p.source_id=s.source_id
 AND p.source_record_id=r.id AND p.profile_context='ranking:' || s.kind || ':' || s.edition_key
 AND p.variant_key='source:exact' AND p.is_canonical AND ${active("p", "s.observed_gen")}
${body ? componentBody(subject) : ""}
WHERE s.subject_kind='${kind}' AND s.complete`;
}
const rankingsMeta = `/*orion:rankingsmeta*/
WITH ${rankingScope}, entries AS MATERIALIZED (
 ${subjects.map((s) => entries(s, false)).join("\nUNION ALL\n")}
), facts AS (
 SELECT snapshot_id,count(*)::int AS row_count,
  count(DISTINCT actor_id)=count(*) AND count(DISTINCT external_key)=count(*)
    AND bool_and(coalesce(valid,false)) AS rows_valid,
  bool_or($6::bigint IS NOT NULL AND ((actor_id=$6) IS DISTINCT FROM (external_key=$7::text))) AS club_conflict,
  count(*) FILTER (WHERE actor_id=$6)::int AS club_count,
  sum(row_bytes)::int AS row_bytes,
  sum(row_bytes) FILTER (WHERE actor_id=$6)::int AS club_row_bytes FROM entries GROUP BY snapshot_id
), components AS (
 ${subjects.map(componentMetadata).join("\nUNION ALL\n")}
)
SELECT scope.*,f.row_count,f.rows_valid,f.club_conflict,f.club_count,f.row_bytes,f.club_row_bytes,
 c.component_count,c.components_valid,c.club_component_count
FROM scope LEFT JOIN facts f USING(snapshot_id) LEFT JOIN components c USING(snapshot_id)
ORDER BY scope.kind COLLATE "C" DESC,scope.edition_key COLLATE "C" DESC,scope.system_id`;
const rankingsBody = `/*orion:rankingsbody*/
WITH scope AS MATERIALIZED (
 SELECT s.id AS snapshot_id,s.subject_kind,s.recorded_from_gen AS observed_gen,s.edition_key,
  sys.code AS kind,d.source_id,true AS complete
 FROM football.ranking_snapshots s
 JOIN football.ranking_systems sys ON sys.id=s.system_id AND sys.subject_kind=s.subject_kind
 JOIN ingest.source_documents d ON d.id=s.source_document_id WHERE s.id=ANY($1::bigint[])
), entries AS (
 ${subjects.map((s) => entries(s, true)).join("\nUNION ALL\n")}
)
SELECT * FROM entries ORDER BY snapshot_id,rank,document_id,ordinal NULLS LAST,external_key COLLATE "C"`;

const sourceEndpoints = new Map([
  ["uefa:https://comp.uefa.com/v2/coefficients", ["coefficientRange", "coefficientType", "language", "page", "pagesize", "seasonYear"]],
  ["fifa:https://inside.fifa.com/api/ranking-overview", ["locale", "dateId", "rankingType"]],
  ["fifa:https://api.fifa.com/api/v3/fifarankings/rankings/rankingsbyschedule", ["rankingScheduleId", "language", "count"]],
  ...["fifa-men", "uefa-countries", "uefa-clubs"].map((kind) => ["sportsapi:https://api.sportsapi.app/v2/rankings/" + kind, []]),
]);
function publicSource(row) {
  if (!row.source_url || row.source_url.length > 2048) return null;
  try {
    const u = new URL(row.source_url);
    const fields = sourceEndpoints.get(row.source_code + ":" + u.origin + u.pathname);
    if (!fields || u.username || u.password || u.hash || u.href !== row.source_url ||
        new Set(u.searchParams.keys()).size !== u.searchParams.size ||
        [...u.searchParams].some(([key, value]) => !fields.includes(key) || !/^[A-Za-z0-9_-]{1,128}$/.test(value))) return null;
    return row.source_url;
  } catch { return null; }
}
function editionMeta(row) {
  return {
    kind: row.kind, edition: row.edition_key, provider: providers[row.source_code],
    sourceUrl: publicSource(row), retrievedAt: row.retrieved_at, sourceUpdatedAt: row.source_updated_at,
    period: row.period_label, officialEdition: row.official_edition, effectiveOn: row.effective_on,
    publishedAt: row.published_at,
  };
}
function collectionState(row, args) {
  if (!row.complete || !row.row_count) return "pending";
  if (row.long_period || row.row_count > maxRows || row.component_count > maxComponents ||
      row.row_bytes + 512 * (row.component_count ?? 0) + 8192 > maxBytes) return "too_large";
  if (!row.rows_valid || row.components_valid === false || row.club_conflict ||
      editionRole(row.kind, row.edition_key) !== row.source_code || !row.retrieved_at ||
      (row.source_code === "sportsapi" && row.official_edition !== false) ||
      (["club", "associations"].includes(args.action) && row.official_edition !== true)) return "unverified";
  return null;
}
function admittedEditions(rows, args) {
  if (rows.length > maxEditions) oversized();
  const groups = new Map();
  for (const row of rows) {
    const key = row.kind + ":" + row.edition_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const ready = [], unavailable = [];
  for (const candidates of groups.values()) {
    const [row] = candidates;
    const state = candidates.length > 1 ? "ambiguous" : collectionState(row, args);
    if (state === null) ready.push(row);
    else unavailable.push({ kind: row.kind, edition: row.edition_key, provider: providers[row.source_code], state });
  }
  return { ready, unavailable };
}

function numeric(value) {
  if (value === null) return null;
  if (!/^-?(?:0|[1-9][0-9]*)[.][0-9]{6}$/.test(value)) pending();
  return JSON.rawJSON(value);
}
function rowDto(row, edition) {
  const points = numeric(row.points), earnedPoints = numeric(row.earned_points);
  const value = {
    entityId: edition.source_code + ":" + row.external_key, entityName: row.display_name,
    countryCode: row.country_code_source, position: row.rank, points, earnedPoints,
    previousPosition: row.previous_rank, imageUrl: null,
  };
  if (edition.source_code === "fifa") {
    value.sourceRow = { rankingItem: {
      idTeam: row.external_key, name: row.display_name, countryCode: row.country_code_source,
      rank: row.rank, totalPoints: points, previousRank: row.previous_rank,
    } };
  } else if (edition.source_code === "uefa") {
    value.sourceRow = {
      overallRanking: {
        position: row.rank, totalPoints: earnedPoints,
        baseSeasonYear: edition.base_season_year, targetSeasonYear: edition.target_season_year,
      },
      seasonRankings: row.parts.map((part) => ({
        seasonYear: Number(part.period),
        ...Object.fromEntries(seasonalNumerics.map(([column, key]) => [key, numeric(part[column])])),
        ...Object.fromEntries(seasonalIntegers.map(([column, key]) => [key, part[column]])),
      })),
    };
  }
  return value;
}
function responseOptions(args, state, rows, club) {
  return {
    etag: 'W/"orion-rankings1-' + digest([args, state, rows, club]) + '"',
    ttl: 30,
    maxBytes,
  };
}
async function materialize(ready, state, club) {
  const rows = await query(rankingsBody, [ready.map((r) => r.snapshot_id), state.catalogue_id, club?.actor_id ?? null]);
  const bySnapshot = new Map(ready.map((r) => [r.snapshot_id, []]));
  for (const row of rows) {
    const page = bySnapshot.get(row.snapshot_id);
    if (!page || !row.display_name || !row.external_key || (club && row.external_key !== club.external_id)) pending();
    page.push(row);
  }
  if (rows.reduce((sum, r) => sum + r.parts.length, 0) > maxComponents) oversized();
  for (const edition of ready) {
    const page = bySnapshot.get(edition.snapshot_id);
    if (page.length !== (club ? edition.club_count : edition.row_count)) pending();
    bySnapshot.set(edition.snapshot_id, page.map((row) => rowDto(row, edition)));
  }
  return bySnapshot;
}

export async function orionProRankingsRoute(req, path, params) {
  const args = argumentsFor(path, params);
  if (!args) return null;
  if (!["GET", "HEAD"].includes(req.method))
    return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, { headers: { Allow: "GET, HEAD" } });
  const state = await catalogue(args);
  let club = null;
  if (args.action === "club") {
    const matches = await query(clubIdentitySql, [state.cg, state.catalogue_id, args.club]);
    if (!matches.length) missing();
    if (matches.length !== 1) pending();
    club = matches[0];
  }
  const rows = await query(rankingsMeta, [
    state.cg, state.catalogue_id, args.kind, args.edition, args.provider,
    club?.external_id ? club.actor_id : null, club?.external_id ?? null,
  ]);
  const { ready, unavailable } = admittedEditions(rows, args);
  let index = null;
  if (args.action === "index") {
    if (!ready.length) pending();
    index = {
      schemaVersion: 1, coverage: unavailable.length ? "partial" : "published",
      editions: ready.map((edition) => ({ ...editionMeta(edition), rows: edition.row_count })),
      unavailableEditions: unavailable,
    };
    if (Buffer.byteLength(JSON.stringify(index)) > maxBytes) oversized();
  } else {
    if (unavailable.some((entry) => entry.state === "too_large")) oversized();
    if (unavailable.length) pending();
    if (!ready.length) args.action === "club" ? pending() : missing();
  }
  if (club?.external_id) {
    const budget = ready.reduce((total, edition) => ({
      components: total.components + (edition.club_component_count ?? 0),
      bytes: total.bytes + 256 + Buffer.byteLength(JSON.stringify(editionMeta(edition))) +
        (edition.club_row_bytes ?? 0) + 512 * (edition.club_component_count ?? 0),
    }), { components: 0, bytes: 256 });
    if (budget.components > maxComponents || budget.bytes > maxBytes) oversized();
  }
  const options = responseOptions(args, state, rows, club);
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), options.etag))
    return send(req, null, 200, options);
  if (index) return send(req, index, 200, options);
  if (club && club.external_id === null) return send(req, { rows: null, coverage: "unmapped" }, 200, options);
  const values = await materialize(ready, state, club);
  if (club) return send(req, { rows: ready.map((edition) => ({
    edition: { ...editionMeta(edition), rows: edition.row_count },
    row: values.get(edition.snapshot_id)[0] ?? null,
  })) }, 200, options);
  const [edition] = ready;
  return send(req, {
    ...editionMeta(edition), quality: { duplicateEntityIds: [] }, rows: values.get(edition.snapshot_id),
  }, 200, options);
}
