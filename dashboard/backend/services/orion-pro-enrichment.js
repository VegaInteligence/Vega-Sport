import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";
import { cloudFrontObjectUrl, immutableFile } from "./cdn.js";

const representation = "summary-v1-shots-v1";
const maxBytes = 2 * 1024 * 1024, maxHonours = 1000;
const routeFields = new Map([
  ["/api/club-wikidata", ["uefa", "name", "country"]],
  ["/api/coach-portrait", ["name"]],
  ["/api/stadium", ["id"]],
  ["/api/player-honours", ["id"]],
  ["/api/club-links", ["club"]],
]);
const uefaId = /^[0-9]{1,12}$/;
const qid = /^Q[0-9]{1,16}$/;
const validName = (v) =>
  typeof v === "string" && v.length <= 200 && v.trim().length > 0 &&
  !/[\u0000-\u001f\u007f]/u.test(v);
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const unavailable = () => reject(503, "Enrichissement non vérifié.");
const missing = () => reject(404, "Enrichissement non renseigné.");
const invalid = () => reject(400, "Paramètres d’enrichissement invalides.");
const tooLarge = () => reject(413, "Enrichissement trop volumineux.");
const at = (a) =>
  a + ".recorded_from_gen<=$1::bigint AND (" + a +
  ".recorded_to_gen IS NULL OR $1::bigint<" + a + ".recorded_to_gen) AND NOT " + a + ".is_deleted";
const selected = (a) => at(a) + " AND " + a + ".is_canonical";
// Exact Unicode case fold after NFC, without stripping accents or punctuation.
const folded = (sql) =>
  "normalize(casefold(normalize(btrim(" + sql +
  "),NFC) COLLATE pg_catalog.pg_unicode_fast),NFC)";

function argumentsFor(path, params) {
  const fields = routeFields.get(path);
  if (!fields) return null;
  validateParams(params, [...fields, "v"]);
  const v = params.get("v"), id = params.get("id") ?? "",
    club = params.get("club") ?? "", uefa = params.get("uefa"),
    name = params.get("name"), country = params.get("country");
  const pin = v !== null && /^pro1\.([1-9][0-9]{0,18})\.([a-f0-9]{64})$/.exec(v);
  if (v !== null && (!pin || BigInt(pin[1]) > 9223372036854775807n)) invalid();
  if (path === "/api/club-wikidata" &&
      (uefa !== null ? !uefaId.test(uefa) || name !== null || country !== null
        : !validName(name) || !validName(country))) invalid();
  if (path === "/api/coach-portrait" && !validName(name)) invalid();
  if (path === "/api/stadium" && !qid.test(id)) invalid();
  if (path === "/api/player-honours" && !/^p_[A-Za-z0-9]{6}$/.test(id)) invalid();
  if (path === "/api/club-links" && !/^t_[A-Za-z0-9]{6}$/.test(club)) invalid();
  return { path, v, buildId: pin ? pin[1] : null, id, club, uefa,
    name: name?.trim() ?? null, country: country?.trim() ?? null,
    keys: [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
}

const cutoff = (alias) =>
  "CASE WHEN isfinite(" + alias + ".knowledge_cutoff_at) THEN " +
  "to_char(" + alias + ".knowledge_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS cutoff_date," +
  "CASE WHEN isfinite(" + alias + ".knowledge_cutoff_at) THEN " +
  "to_char(" + alias + ".knowledge_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') END AS cutoff";
const catalogueSql = "/*orion:enrichmentcataloguemeta*/\n" +
  "SELECT c.id::text AS catalog_snapshot_id,c.generation::text AS cg,p.representation_version," + cutoff("c") + "\n" +
  "FROM analytics.catalog_publication p JOIN ingest.dataset_snapshots c\n" +
  "  ON c.id=p.catalog_snapshot_id AND c.status='sealed' WHERE p.singleton";
const pinnedCatalogueSql = "/*orion:enrichmentcataloguepin*/\n" +
  "SELECT b.id::text AS build_id,b.competition_season_id::text AS edition_id,\n" +
  " b.dataset_snapshot_id::text,d.generation::text AS dg,b.catalog_snapshot_id::text,c.generation::text AS cg,\n" +
  " b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,\n" +
  " b.metrics_contract_version,b.transform_version," + cutoff("c") + "\n" +
  "FROM analytics.aggregation_builds b\n" +
  "JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'\n" +
  "JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'\n" +
  "WHERE b.id=$1::bigint AND b.status='ready' AND EXISTS (\n" +
  " SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id\n" +
  " AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id\n" +
  " AND p.representation_version=b.representation_version)";
async function catalogue(args) {
  const [row] = await (args.buildId === null ? query(catalogueSql) : query(pinnedCatalogueSql, [args.buildId]));
  if (!row || row.representation_version !== representation) unavailable();
  if (args.buildId !== null) {
    const pin = digest([
      row.build_id, row.edition_id, row.dataset_snapshot_id, row.dg, row.catalog_snapshot_id, row.cg,
      row.representation_version, row.code_content_sha256, row.dependencies_sha256, row.environment_sha256,
      row.metrics_contract_version, row.transform_version,
    ]);
    if (args.v !== "pro1." + row.build_id + "." + pin) invalid();
  }
  return row;
}
const bindings = (state, ...rest) => [state.cg, state.catalog_snapshot_id, ...rest];
const utcTimestamp = (sql) => "CASE WHEN isfinite(" + sql + ") THEN to_char(" + sql +
  " AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') END";

// The planner can push each actor's record key into this typed lineage join.
// No source payload or object path is projected. The exact document must be a
// member of the selected catalogue, even when the record is otherwise valid.
const admitted = (contract) => "admitted AS NOT MATERIALIZED (\n" +
  " SELECT r.id AS record_id,r.source_id,r.external_key,r.record_kind,d.id AS document_id,\n" +
  "   d.content_sha256,d.source_url,d.retrieved_at,ds.dataset_key,s.code AS source_code\n" +
  " FROM ingest.dataset_snapshot_documents sd\n" +
  " JOIN ingest.source_documents d ON d.id=sd.document_id\n" +
  " JOIN ingest.source_datasets ds ON ds.id=d.dataset_id AND ds.source_id=d.source_id\n" +
  " JOIN ingest.sources s ON s.id=d.source_id\n" +
  " JOIN ingest.source_records r ON r.document_id=d.id AND r.source_id=d.source_id\n" +
  " WHERE sd.snapshot_id=$2::bigint AND ds.contract_version='" + contract + "')";
const enrichEvidence = admitted("orion-enrichment-v1");
const evidenceJoin = (row, alias, code) =>
  alias + ".record_id=" + row + ".source_record_id AND " + alias +
  ".source_id=" + row + ".source_id AND " + alias + ".source_code='" + code +
  "' AND " + alias + ".record_kind='enrichment_fact_v1'";

const uefaByIdSql = "/*orion:enrichmentuefameta*/\nWITH " + enrichEvidence + "\n" +
  "SELECT q.team_id::text,q.recorded_from_gen::text,q.source_id::text," +
  " ev.record_id::text AS evidence_id,ev.content_sha256\n" +
  "FROM football.team_source_ids q JOIN ingest.sources s ON s.id=q.source_id AND s.code='uefa'\n" +
  "LEFT JOIN admitted ev ON " + evidenceJoin("q", "ev", "uefa") + " AND ev.external_key=q.external_id\n" +
  "WHERE q.external_id=$3 AND " + at("q") + " ORDER BY q.recorded_from_gen LIMIT 2";

const wikiClubSql = "/*orion:enrichmentwikiclubmeta*/\nWITH " + enrichEvidence + "\n" +
  "SELECT p.id::text AS profile_id,p.team_id::text,p.source_id::text,p.display_name,p.founded_year,\n" +
  " q.external_id AS qid,q.recorded_from_gen::text AS qid_generation,\n" +
  " p.source_record_id::text AS profile_evidence,q.source_record_id::text AS qid_evidence,\n" +
  " pe.content_sha256,pe.source_url," + utcTimestamp("pe.retrieved_at") + " AS fetched_at,\n" +
  " co.revision_id::text AS country_revision\n" +
  "FROM football.team_profile_versions p\n" +
  "JOIN admitted pe ON " + evidenceJoin("p", "pe", "wikidata") + "\n" +
  "JOIN football.team_source_ids q ON q.team_id=p.team_id AND q.source_id=p.source_id\n" +
  " AND q.external_id=pe.external_key AND q.external_id ~ '^Q[0-9]{1,16}$' AND " + at("q") + "\n" +
  "JOIN admitted qe ON " + evidenceJoin("q", "qe", "wikidata") + " AND qe.external_key=q.external_id\n" +
  "LEFT JOIN football.countries co ON co.id=p.country_id AND " + selected("co") + "\n" +
  "WHERE p.profile_context='wikidata_enrichment_v1' AND p.variant_key='source:exact' AND p.team_type='club'\n" +
  " AND " + selected("p") + " AND ($6::timestamptz IS NULL OR p.observed_at<=$6)\n" +
  " AND (($3::bigint IS NOT NULL AND p.team_id=$3) OR ($3::bigint IS NULL\n" +
  " AND " + folded("$5::text") + " IN (" + ["p.country_code_source", "co.iso2", "co.iso3", "co.name"].map(folded).join(",") + ")\n" +
  " AND (" + folded("p.display_name") + "=" + folded("$4::text") + " OR EXISTS (\n" +
  "  SELECT 1 FROM football.team_aliases a JOIN admitted ae ON " + evidenceJoin("a", "ae", "wikidata") + "\n" +
  "  WHERE a.team_id=p.team_id AND a.source_id=p.source_id AND ae.external_key=q.external_id AND " + selected("a") + "\n" +
  "  AND (a.valid_from IS NULL OR (isfinite(a.valid_from) AND a.valid_from<=($6::timestamptz AT TIME ZONE 'UTC')::date))\n" +
  "  AND (a.valid_to IS NULL OR (isfinite(a.valid_to) AND ($6::timestamptz AT TIME ZONE 'UTC')::date<a.valid_to))\n" +
  "  AND " + folded("a.alias") + "=" + folded("$4::text") + "))))\n" +
  "ORDER BY p.team_id,p.id LIMIT 2";

const clubLinksSql = "/*orion:enrichmentlinksmeta*/\nWITH " + enrichEvidence + "\n" +
  "SELECT a.team_id::text,a.recorded_from_gen::text AS alias_generation,q.external_id,\n" +
  " q.recorded_from_gen::text AS mapping_generation,q.source_record_id::text AS mapping_evidence,\n" +
  " p.id::text AS profile_id,p.source_record_id::text AS profile_evidence,p.display_name,p.country_code_source\n" +
  "FROM ingest.public_aliases a\n" +
  "LEFT JOIN LATERAL (\n" +
  " SELECT q.* FROM football.team_source_ids q JOIN admitted ev ON " + evidenceJoin("q", "ev", "uefa") + "\n" +
  "  AND ev.external_key=q.external_id WHERE q.team_id=a.team_id AND " + at("q") + "\n" +
  "  AND q.external_id ~ '^[0-9]{1,12}$' ORDER BY q.external_id LIMIT 2\n" +
  ") q ON true\n" +
  "LEFT JOIN football.team_profile_versions p ON p.team_id=a.team_id AND p.source_id=q.source_id\n" +
  " AND p.profile_context='uefa_enrichment_v1' AND p.variant_key='source:exact' AND p.team_type='club' AND " + selected("p") + "\n" +
  " AND EXISTS (SELECT 1 FROM admitted pe WHERE " + evidenceJoin("p", "pe", "uefa") + " AND pe.external_key=q.external_id)\n" +
  "WHERE a.route_kind='team' AND a.public_key=$3 AND " + at("a") +
  " ORDER BY a.recorded_from_gen,q.external_id LIMIT 2";

const qualifiedCoach = "qualified_coach AS NOT MATERIALIZED (\n" +
  " SELECT c.id,c.revision_id,c.display_name,c.source_id,c.image_asset_id,q.external_id AS qid,\n" +
  "  c.source_record_id,q.source_record_id AS qid_evidence,q.recorded_from_gen AS qid_generation\n" +
  " FROM football.coaches c\n" +
  " JOIN admitted ce ON " + evidenceJoin("c", "ce", "wikidata") + "\n" +
  " JOIN football.coach_source_ids q ON q.coach_id=c.id AND q.source_id=c.source_id\n" +
  "  AND q.external_id=ce.external_key AND q.external_id ~ '^Q[0-9]{1,16}$' AND " + at("q") + "\n" +
  " JOIN admitted qe ON " + evidenceJoin("q", "qe", "wikidata") + " AND qe.external_key=q.external_id\n" +
  " WHERE " + selected("c") + ")";
const coachColumns = "c.id::text AS coach_id,c.revision_id::text AS coach_revision,c.display_name,c.qid,\n" +
  " c.source_record_id::text AS coach_evidence,c.qid_evidence::text,c.qid_generation::text,c.image_asset_id::text,\n" +
  " a.id::text AS asset_id,a.storage_key,a.content_sha256 AS asset_sha,a.content_type,\n" +
  " a.legacy_asset_url,a.author,a.license_code,a.attribution_url,same.alias_count";
const photoJoin = "LEFT JOIN ingest.media_assets a ON a.id=c.image_asset_id\n" +
  "LEFT JOIN LATERAL (SELECT count(*)::integer AS alias_count FROM (\n" +
  " SELECT 1 FROM ingest.media_assets other WHERE other.legacy_asset_url=a.legacy_asset_url LIMIT 2\n" +
  ") matches) same ON a.id IS NOT NULL";
const portraitSql = "/*orion:enrichmentportraitmeta*/\nWITH " + enrichEvidence + "," + qualifiedCoach + "\n" +
  "SELECT " + coachColumns + " FROM qualified_coach c\n" + photoJoin +
  "\nWHERE " + folded("c.display_name") + "=" + folded("$3::text") + " ORDER BY c.id,c.revision_id LIMIT 2";
const tenureSql = "/*orion:enrichmenttenuremeta*/\nWITH " + enrichEvidence + "," + qualifiedCoach + ",\n" +
  "plausible AS MATERIALIZED (\n" +
  " SELECT t.revision_id,t.coach_id,t.source_id,t.source_record_id,t.valid_from,t.valid_to,t.date_precision\n" +
  " FROM football.team_coach_tenures t JOIN admitted te ON " + evidenceJoin("t", "te", "wikidata") + "\n" +
  " WHERE t.team_id=$3::bigint AND t.source_id=$4::bigint AND t.role='head_coach' AND " + selected("t") + "\n" +
  "  AND ($6::timestamptz IS NULL OR t.observed_at<=$6)\n" +
  "  AND ($5::date IS NULL OR t.date_precision<>'day' OR\n" +
  "   ((t.valid_from IS NULL OR NOT isfinite(t.valid_from) OR t.valid_from<=$5)\n" +
  "    AND (t.valid_to IS NULL OR NOT isfinite(t.valid_to) OR $5<t.valid_to)))\n" +
  " ORDER BY t.revision_id LIMIT 2\n" +
  ") SELECT t.revision_id::text AS tenure_revision,t.source_record_id::text AS tenure_evidence,\n" +
  " to_char(t.valid_from,'YYYY-MM-DD') AS valid_from,to_char(t.valid_to,'YYYY-MM-DD') AS valid_to,\n" +
  " coalesce(t.date_precision='day' AND isfinite(t.valid_from) AND isfinite(t.valid_to)\n" +
  " AND t.valid_from<=$5::date AND $5::date<t.valid_to,false) AS verified_interval,\n" +
  coachColumns + "\nFROM plausible t LEFT JOIN qualified_coach c ON c.id=t.coach_id AND c.source_id=t.source_id\n" +
  photoJoin + "\nORDER BY t.revision_id,c.revision_id LIMIT 2";

const stadiumSql = "/*orion:enrichmentstadiummeta*/\nWITH " + enrichEvidence + "\n" +
  "SELECT q.external_id AS qid,q.recorded_from_gen::text AS qid_generation,qe.record_id::text AS qid_evidence,\n" +
  " v.revision_id::text AS venue_revision,ve.record_id::text AS venue_evidence,\n" +
  " ve.source_url," + utcTimestamp("ve.retrieved_at") + " AS fetched_at,\n" +
  " v.name,v.capacity,CASE WHEN isfinite(v.capacity_as_of) THEN to_char(v.capacity_as_of,'YYYY-MM-DD') END AS capacity_as_of,\n" +
  " v.latitude,v.longitude,v.opened_year\n" +
  "FROM football.venue_source_ids q JOIN ingest.sources s ON s.id=q.source_id AND s.code='wikidata'\n" +
  "LEFT JOIN admitted qe ON " + evidenceJoin("q", "qe", "wikidata") + " AND qe.external_key=q.external_id\n" +
  "LEFT JOIN football.venues v ON v.id=q.venue_id AND v.source_id=q.source_id AND " + selected("v") + "\n" +
  "LEFT JOIN admitted ve ON " + evidenceJoin("v", "ve", "wikidata") + " AND ve.external_key=q.external_id\n" +
  "WHERE q.external_id=$3 AND " + at("q") + " ORDER BY q.recorded_from_gen,v.revision_id LIMIT 2";

const honourCohortSql = "/*orion:enrichmenthonourcohortmeta*/\nWITH " + admitted("orion-player-honours-v1") + "\n" +
  "SELECT a.player_id::text,a.recorded_from_gen::text AS alias_generation,\n" +
  " root.record_id::text AS identity_evidence,root.source_id::text,root.document_id::text,root.content_sha256,\n" +
  " root.source_code,root.source_url," + utcTimestamp("root.retrieved_at") + " AS fetched_at\n" +
  "FROM ingest.public_aliases a\n" +
  "LEFT JOIN admitted root ON root.source_code='wikipedia' AND root.record_kind='honours_identity_v1'\n" +
  " AND root.external_key=a.public_key AND root.dataset_key='player-honours:' || a.public_key\n" +
  "WHERE a.route_kind='player' AND a.public_key=$3 AND " + at("a") +
  " ORDER BY a.recorded_from_gen,root.record_id LIMIT 2";
const honourOrder = 'honour_id,team_id NULLS FIRST,edition_key COLLATE "C",revision_id';
const winnerRows = "winners AS MATERIALIZED (\n" +
  " SELECT h.revision_id,h.honour_id,h.team_id,h.edition_key,h.source_record_id,\n" +
  "   d.revision_id AS definition_revision,d.honour_type AS category,d.name AS title,\n" +
  "   t.id AS team_profile,t.display_name AS team,cs.revision_id AS season_revision,\n" +
  "   coalesce(h.season_label,cs.season_key) AS season\n" +
  " FROM football.player_honours h\n" +
  " JOIN ingest.source_records r ON r.id=h.source_record_id AND r.source_id=$3::bigint\n" +
  "   AND r.document_id=$4::bigint AND r.record_kind='enrichment_fact_v1' AND r.external_key=h.edition_key\n" +
  " LEFT JOIN football.honour_definitions d ON d.id=h.honour_id AND " + selected("d") + "\n" +
  " LEFT JOIN football.competition_seasons cs ON cs.id=h.competition_season_id AND " + selected("cs") + "\n" +
  " LEFT JOIN football.team_profile_versions t ON t.team_id=h.team_id AND t.source_id=$3::bigint\n" +
  "  AND t.profile_context='honours_display_v1' AND t.variant_key='source:exact' AND " + selected("t") + "\n" +
  "  AND EXISTS(SELECT 1 FROM ingest.source_records tr WHERE tr.id=t.source_record_id\n" +
  "   AND tr.source_id=$3::bigint AND tr.document_id=$4::bigint AND tr.record_kind='enrichment_fact_v1')\n" +
  " WHERE h.player_id=$2::bigint AND h.source_id=$3::bigint AND h.outcome='winner' AND " + selected("h") + "\n" +
  ' ORDER BY h.honour_id,h.team_id NULLS FIRST,h.edition_key COLLATE "C",h.revision_id LIMIT ' + (maxHonours + 1) + ")";
const honourWitness = "ROW(revision_id,source_record_id,definition_revision,team_profile,season_revision)::text";
const honoursMetaSql = "/*orion:enrichmenthonoursmeta*/\nWITH " + winnerRows + "\n" +
  "SELECT count(*)::integer AS count,bool_or(category IS NULL OR title IS NULL OR btrim(title)='') AS invalid,\n" +
  " coalesce(sum(256::bigint + coalesce(octet_length(to_json(title)::text),0) +\n" +
  "  coalesce(octet_length(to_json(team)::text),0) + coalesce(octet_length(to_json(season)::text),0)),0)::text AS max_body,\n" +
  " array_agg(" + honourWitness + " ORDER BY " + honourOrder + ") AS witnesses FROM winners";
const honoursBodySql = "/*orion:enrichmenthonoursbody*/\nWITH " + winnerRows + "\n" +
  "SELECT honour_id::text,team_id::text,category,title,team,season," + honourWitness + " AS witness\n" +
  'FROM winners w ORDER BY w.honour_id,w.team_id NULLS FIRST,w.edition_key COLLATE "C",w.revision_id';

function one(rows, onMissing = missing) {
  if (!rows.length) onMissing();
  if (rows.length !== 1) unavailable();
  return rows[0];
}
function httpsUrl(value, host) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === host && !u.port && !u.username &&
      !u.password && u.href === value ? u : null;
  } catch { return null; }
}
function publicHttps(value, host, prefix) {
  const u = httpsUrl(value, host);
  return u && !u.search && !u.hash && u.pathname.startsWith(prefix) &&
    u.pathname.length > prefix.length ? value : null;
}
function wikidataAttribution(value, actor) {
  const u = httpsUrl(value, "www.wikidata.org");
  return u && !u.search && !u.hash &&
    ["/wiki/" + actor, "/entity/" + actor].includes(u.pathname) ? value : null;
}
function honourAttribution(value) {
  const host = "en.wikipedia.org";
  if (publicHttps(value, host, "/wiki/")) return { sourceUrl: value, revision: null };
  const u = httpsUrl(value, host);
  if (!u || u.pathname !== "/w/index.php" || u.hash !== "#Honours" ||
      [...u.searchParams.keys()].sort().join(",") !== "oldid,title") return null;
  const title = u.searchParams.get("title"), id = u.searchParams.get("oldid");
  if (!title || !title.trim() || title.length > 512 || /[\u0000-\u001f\u007f]/u.test(title) ||
      !/^[1-9][0-9]{0,18}$/.test(id)) return null;
  const exact = BigInt(id);
  return { sourceUrl: value, revision: exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null };
}
function photoFor(row, mediaBase) {
  if (row.image_asset_id === null) return null;
  const url = publicHttps(row.legacy_asset_url, "upload.wikimedia.org", "/wikipedia/commons/");
  const credit = publicHttps(row.attribution_url, "commons.wikimedia.org", "/wiki/File:");
  const ext = row.storage_key?.split(".").at(-1);
  const mime = new Map([["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]).get(ext);
  if (!url || row.asset_id !== row.image_asset_id || row.alias_count !== 1 ||
      !mime || row.content_type !== mime || !/^[a-f0-9]{64}$/.test(row.asset_sha ?? "") ||
      !immutableFile(row.storage_key) ||
      !(row.storage_key.endsWith("/" + row.asset_sha + "." + ext) ||
        row.storage_key.endsWith("-" + row.asset_sha + "." + ext)) ||
      (row.attribution_url !== null && !credit)) unavailable();
  try { cloudFrontObjectUrl(row.storage_key, mediaBase); }
  catch { unavailable(); }
  return { url, author: row.author, license: row.license_code, sourceUrl: credit };
}

function etagFor(args, state, witness) {
  return 'W/"orion-enrichment1-' + digest([args.path, args.keys, state, witness]) + '"';
}
function response(req, args, state, witness, value) {
  return send(req, value, 200, { etag: etagFor(args, state, witness), ttl: 15, maxBytes });
}
async function clubWiki(req, args, state, mediaBase) {
  let mapping = null;
  if (args.uefa !== null) {
    mapping = one(await query(uefaByIdSql, bindings(state, args.uefa)));
    if (mapping.evidence_id === null) unavailable();
  }
  const profile = one(await query(wikiClubSql, bindings(state, mapping?.team_id ?? null,
    args.name, args.country, state.cutoff)), mapping ? unavailable : missing);
  const tenures = await query(tenureSql, bindings(state, profile.team_id, profile.source_id,
    state.cutoff_date, state.cutoff));
  let coach = null, coachState = "unrecorded";
  if (tenures.length > 1) coachState = "ambiguous";
  else if (tenures.length === 1) {
    const t = tenures[0];
    coachState = "unverified_validity";
    if (t.verified_interval && t.qid && validName(t.display_name)) {
      coach = { id: t.qid, name: t.display_name, validFrom: t.valid_from, validTo: t.valid_to,
        photo: photoFor(t, mediaBase) };
      coachState = "known";
    }
  }
  const founded = profile.founded_year === null ? null : String(profile.founded_year);
  return response(req, args, state, [mapping, profile, tenures], {
    available: true, id: profile.qid, name: profile.display_name, source: "wikidata",
    sourceUrl: wikidataAttribution(profile.source_url, profile.qid), fetchedAt: profile.fetched_at,
    founded, coach, stadium: null, stadiumAlias: null, stadiumId: null,
    coverage: { founded: founded === null ? "unrecorded" : "known", coach: coachState, homeVenue: "unrecorded" },
  });
}
async function portrait(req, args, state, mediaBase) {
  const row = one(await query(portraitSql, bindings(state, args.name)));
  const photo = photoFor(row, mediaBase);
  return response(req, args, state, row, { available: true, id: row.qid,
    name: row.display_name, photo, source: "wikidata",
    coverage: { photo: photo ? "known" : "unrecorded" } });
}
async function stadium(req, args, state) {
  const row = one(await query(stadiumSql, bindings(state, args.id)));
  if (row.qid_evidence === null || row.venue_revision === null || row.venue_evidence === null) unavailable();
  const lat = row.latitude, lon = row.longitude;
  if ((lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
      (lon !== null && (!Number.isFinite(lon) || Math.abs(lon) > 180))) unavailable();
  const complete = lat !== null && lon !== null;
  return response(req, args, state, row, {
    available: true, id: row.qid, name: row.name, source: "wikidata",
    sourceUrl: wikidataAttribution(row.source_url, row.qid), fetchedAt: row.fetched_at,
    capacity: row.capacity, capacityAsOf: row.capacity_as_of,
    opened: row.opened_year === null ? null : String(row.opened_year), created: null,
    coordinates: complete ? { lat, lon } : null, coordinateObservation: { lat, lon },
    plans: null, coverage: {
      coordinates: complete ? "known" : lat === null && lon === null ? "unrecorded" : "partial",
      created: "unrecorded", plans: "unrecorded",
    },
  });
}
async function links(req, args, state) {
  const row = one(await query(clubLinksSql, bindings(state, args.club)));
  if (row.external_id === null) unavailable();
  return response(req, args, state, row, { links: { [args.club]: {
    entityId: "uefa:" + row.external_id, clubName: row.display_name, countryCode: row.country_code_source,
    rankingName: null, method: "typed-source-id",
  } } });
}
async function honours(req, args, state) {
  const root = one(await query(honourCohortSql, bindings(state, args.id)));
  if (root.identity_evidence === null) missing();
  const attribution = honourAttribution(root.source_url);
  if (!attribution || !root.fetched_at) unavailable();
  const values = [state.cg, root.player_id, root.source_id, root.document_id];
  const [meta] = await query(honoursMetaSql, values);
  if (!meta.count) missing();
  if (meta.count > maxHonours || BigInt(meta.max_body) + 4096n > BigInt(maxBytes)) tooLarge();
  if (meta.invalid) unavailable();
  const etag = etagFor(args, state, [root, meta]);
  const options = { etag, ttl: 15, maxBytes };
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag))
    return send(req, null, 200, options);
  const rows = await query(honoursBodySql, values);
  if (rows.length !== meta.count || rows.some((r, i) => r.witness !== meta.witnesses[i])) unavailable();
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.honour_id, row.team_id]);
    if (!groups.has(key)) groups.set(key, { category: row.category,
      team: row.category === "team" ? row.team : null, name: row.title,
      seasons: [], unlabelledCount: 0, editionCount: 0 });
    const group = groups.get(key);
    group.editionCount++;
    if (row.season?.trim()) group.seasons.push(row.season);
    else group.unlabelledCount++;
  }
  for (const group of groups.values()) group.seasons.sort();
  return send(req, { available: true, honours: [...groups.values()], source: "Wikipédia",
    ...attribution, fetchedAt: root.fetched_at }, 200, options);
}

export async function orionProEnrichmentRoute(req, path, params, { mediaBase } = {}) {
  const args = argumentsFor(path, params);
  if (!args) return null;
  if (!["GET", "HEAD"].includes(req.method))
    return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, { headers: { Allow: "GET, HEAD" } });
  const state = await catalogue(args);
  if (path === "/api/club-wikidata") return clubWiki(req, args, state, mediaBase);
  if (path === "/api/coach-portrait") return portrait(req, args, state, mediaBase);
  if (path === "/api/stadium") return stadium(req, args, state);
  if (path === "/api/club-links") return links(req, args, state);
  return honours(req, args, state);
}
