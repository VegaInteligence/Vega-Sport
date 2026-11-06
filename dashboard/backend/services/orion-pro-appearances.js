import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";
import { cloudFrontObjectUrl, immutableFile } from "./cdn.js";
import { packPartition } from "./partition-wire.js";

// An independently versioned adapter over a published V1 build. The four V1
// readers and their response shapes do not change when this capability is added.
const representation = "normalized-season-v1-native31";
const producer = "real_source_core_v2_native31";
const nativeFields = {
  goals: "goals", assists: "assists", shots: "shots", shotsOnTarget: "shots_on_target",
  chancesCreated: "chances_created", bigChancesCreated: "big_chances_created",
  passesAccurate: "passes_completed", passesAttempted: "passes_attempted", passesFinalThird: "passes_final_third",
  defensiveActions: "defensive_actions", interceptions: "interceptions", tackles: "tackles", recoveries: "recoveries",
  duelsWon: "duels_won", duelsLost: "duels_lost", aerialsWon: "aerial_duels_won", aerialDuels: "aerial_duels_attempted",
  touches: "touches", touchesBox: "touches_box", clearances: "clearances", blocks: "blocks",
  dribbles: "dribbles_completed", dribblesAttempted: "dribbles_attempted", saves: "saves",
  xg: "xg", npxg: "non_penalty_xg", xa: "xa", xgot: "xgot", minutes: "minutes_played",
  rating: "provider_rating", goalsPrevented: "goals_prevented",
};
const teamFields = {
  expected_goals: "xg", total_shots: "shots", ShotsOnTarget: "shots_on_target",
  BallPossesion: "possession_pct", accurate_passes: "passes_completed", passes: "passes_attempted",
  touches_opp_box: "touches_box", corners: "corners", duel_won: "duels_won",
  "matchstats.headers.tackles": "tackles", interceptions: "interceptions", keeper_saves: "saves",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const at = (a, g) => `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) => `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const fieldsSql = Object.keys(nativeFields).map((field) => `'legacy_normalized_${field}'`).join(",");
const numericGrammar = "^-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?$";
const absent = Symbol("absent");

class Unavailable extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function unavailable(code, message) { throw new Unavailable(code, message); }

// Number payloads stay text inside SQL result envelopes. Only this strict scalar
// boundary turns them into JSON number tokens; pg's JSON parser cannot round them.
function nativeNumber(raw) {
  if (typeof raw !== "string" || raw.length > 1024 || !new RegExp(numericGrammar).test(raw) || !Number.isFinite(Number(raw)))
    unavailable("NATIVE_NUMBER_INVALID", "Nombre natif non représentable.");
  const [mantissa, power = "0"] = raw.toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const exponent = Number(power) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100000)
    unavailable("NATIVE_NUMBER_INVALID", "Exposant natif invalide.");
  let coefficient = BigInt(whole + fraction);
  let scale = exponent;
  while (coefficient !== 0n && coefficient % 10n === 0n) { coefficient /= 10n; scale++; }
  if (scale >= 0 && coefficient !== 0n && (scale > 16 || coefficient * 10n ** BigInt(scale) > 9007199254740991n || coefficient * 10n ** BigInt(scale) < -9007199254740991n))
    unavailable("NATIVE_NUMBER_INVALID", "Entier natif hors borne sûre.");
  if (typeof JSON.rawJSON !== "function")
    unavailable("NATIVE_NUMBER_INVALID", "Runtime numérique indisponible.");
  return JSON.rawJSON(raw);
}
function scalar(kind, value) {
  if (kind === "absent") return absent;
  if (kind === "null" && value === null) return null;
  if (kind === "number") return nativeNumber(value);
  if (kind === "string" && typeof value === "string") return value;
  if (kind === "boolean" && typeof value === "boolean") return value;
  unavailable("NATIVE31_INCOMPLETE", "État natif invalide.");
}
function count(raw) {
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw) || BigInt(raw) > 9007199254740991n)
    unavailable("PERFORMANCE_COVERAGE_UNAVAILABLE", "Compteur indisponible.");
  return Number(raw);
}

function buildToken(row) {
  return `pro1.${row.build_id}.${digest(JSON.stringify([
    row.build_id, row.edition_id, row.dataset_snapshot_id, row.dataset_generation,
    row.catalog_snapshot_id, row.catalog_generation, row.representation_version,
    row.code_content_sha256, row.dependencies_sha256, row.environment_sha256,
    row.metrics_contract_version, row.transform_version,
  ]))}`;
}
const publicationSql = `/*orion:appearance:publicationmeta*/
SELECT b.id::text build_id,b.competition_season_id::text edition_id,
 b.competition_season_revision_id::text edition_revision_id,
 b.dataset_snapshot_id::text dataset_snapshot_id,d.generation::text dataset_generation,
 b.catalog_snapshot_id::text catalog_snapshot_id,c.generation::text catalog_generation,
 b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
 b.metrics_contract_version,b.transform_version,b.finished_at,
 e.season_key AS season,co.id::text competition_id,co.name AS league_name,
 co.image_asset_id::text competition_asset_id,country.iso2 AS country,
 aliases.keys AS league_keys,totals.matches_count::text match_count
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
JOIN LATERAL (SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id
 AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id
 AND p.representation_version=b.representation_version LIMIT 1) publication ON true
JOIN football.competition_seasons e ON e.id=b.competition_season_id
 AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
JOIN football.competitions co ON co.id=e.competition_id AND ${selected("co", "c.generation")}
LEFT JOIN football.countries country ON country.id=co.country_id AND country.revision_id=co.country_revision_id
 AND ${selected("country", "c.generation")}
LEFT JOIN LATERAL (SELECT array_agg(a.public_key ORDER BY a.public_key COLLATE "C") keys
 FROM ingest.public_aliases a WHERE a.route_kind='competition' AND a.competition_id=co.id
 AND a.public_key ~ '^l_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "c.generation")}) aliases ON true
LEFT JOIN analytics.competition_summary totals ON totals.build_id=b.id AND totals.competition_season_id=b.competition_season_id
WHERE b.id=$1::bigint AND b.status='ready' LIMIT 2`;

// A performance retains the participant revision captured with its facts. Later
// admission can close that participant revision without rewriting those facts.
// Resolve the retained physical anchor by its indexed key; its closing generation
// does not invalidate a selected performance. Native values use that same anchor.
const scopeSql = `WITH x AS (SELECT * FROM jsonb_to_record($1::jsonb) AS c(
 build_id bigint,edition_id bigint,edition_revision_id bigint,dg bigint,cg bigint,competition_id bigint)),
matches AS (
 SELECT s.*,x.dg,x.cg,aliases.public_id
 FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id
 AND m.competition_season_id=x.edition_id AND m.publication_state='published' AND ${selected("m", "x.dg")}
 LEFT JOIN LATERAL (SELECT min(a.public_key COLLATE "C") public_id FROM ingest.public_aliases a
 WHERE a.route_kind='match' AND a.match_id=m.id AND a.public_key ~ '^m_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "x.cg")}) aliases ON true
), sides AS (
 SELECT mt.*,m.dg,m.cg,aliases.public_id AS team_public_id FROM matches m
 JOIN football.match_teams mt ON mt.match_id=m.match_id AND ${selected("mt", "m.dg")}
 LEFT JOIN LATERAL (SELECT min(a.public_key COLLATE "C") public_id FROM ingest.public_aliases a
 WHERE a.route_kind='team' AND a.team_id=mt.team_id AND a.public_key ~ '^t_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "m.cg")}) aliases ON true
), performances AS (
 SELECT s.*,m.dg,m.cg,m.public_id AS match_public_id,m.match_date,
 mp.profile_version_id,mp.is_starter,mp.is_captain,mp.raw_pitch_x,mp.raw_pitch_y,mp.coordinate_frame,
 mp.raw_position_code,mp.raw_position_code_state,mp.raw_position_code_source_number::text,
 mp.shirt_number,mp.shirt_number_state,mp.shirt_number_source_number::text,
 mp.played,mp.position_code,sides.team_public_id,sides.participant_label AS team_label,
 sr.external_key AS performance_id,aliases.public_id AS player_public_id,
 pp.id AS observed_profile_id,pp.image_asset_id,pp.external_profile_version_id,
 pp.display_name AS observed_name
 FROM matches m JOIN football.player_match_stats s ON s.match_id=m.match_id
 AND s.period_code='full_match' AND s.period_definition_version='bootstrap_v1'
 AND s.contract_version='${producer}' AND s.transform_version='${producer}' AND ${selected("s", "m.dg")}
 JOIN football.match_players mp ON mp.match_id=s.match_id
 AND mp.revision_id=s.match_player_revision_id
 AND mp.team_id=s.team_id AND mp.player_id=s.player_id AND mp.source_id=s.source_id
 AND mp.source_record_id=s.source_record_id AND mp.variant_key=s.variant_key
 AND mp.recorded_from_gen<=m.dg AND mp.is_canonical AND NOT mp.is_deleted
 JOIN sides ON sides.match_id=mp.match_id AND sides.team_id=mp.team_id
 LEFT JOIN ingest.source_records sr ON sr.id=s.source_record_id AND sr.source_id=s.source_id AND sr.record_kind='performance'
 LEFT JOIN LATERAL (SELECT min(a.public_key COLLATE "C") public_id FROM ingest.public_aliases a
 WHERE a.route_kind='player' AND a.player_id=s.player_id AND a.public_key ~ '^p_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "m.cg")}) aliases ON true
 LEFT JOIN football.player_profile_versions pp ON pp.id=mp.profile_version_id AND pp.player_id=mp.player_id
 AND NOT pp.is_deleted
), team_members AS (
 SELECT team_id,source_id FROM sides UNION
 SELECT ct.team_id,ct.source_id FROM x JOIN football.competition_teams ct ON ct.competition_season_id=x.edition_id
 AND ct.competition_season_revision_id=x.edition_revision_id AND ${selected("ct", "x.dg")}
), team_candidates AS (
 SELECT p.*,CASE p.profile_context WHEN 'provider_global' THEN 0 WHEN 'legacy_normalized_global' THEN 1 WHEN 'global' THEN 2 END priority
 FROM x JOIN football.team_profile_versions p ON ${selected("p", "x.cg")}
 WHERE EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=p.team_id)
 AND ((p.profile_context='provider_global' AND p.variant_key='provider:exact'
 AND EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=p.team_id AND t.source_id=p.source_id))
 OR (p.profile_context='legacy_normalized_global'
 AND EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=p.team_id AND t.source_id=p.source_id))
 OR (p.profile_context='global' AND p.provenance_kind='manual' AND p.source_id IS NULL))
), team_profiles AS (
 SELECT p.* FROM team_candidates p WHERE p.priority=(SELECT min(c.priority) FROM team_candidates c WHERE c.team_id=p.team_id)
)`;
const context = (r) => JSON.stringify({ build_id: r.build_id, edition_id: r.edition_id,
  edition_revision_id: r.edition_revision_id, dg: r.dataset_generation, cg: r.catalog_generation, competition_id: r.competition_id });
const nativeJoin = `n.match_id=p.match_id AND n.player_id=p.player_id AND n.team_id=p.team_id
 AND n.match_player_revision_id=p.match_player_revision_id AND n.period_code=p.period_code
 AND n.period_definition_version=p.period_definition_version AND n.source_id=p.source_id
 AND n.source_record_id=p.source_record_id AND n.variant_key=p.variant_key AND n.family_code='standard'
 AND n.metric_definition_version='${producer}' AND n.contract_version='${producer}' AND n.transform_version='${producer}'
 AND n.transform_code_sha256=p.transform_code_sha256 AND n.metric_code IN (${fieldsSql}) AND ${selected("n", "p.dg")}`;
const projectionSql = `CASE n.metric_code ${Object.entries(nativeFields).map(([field, column]) =>
  `WHEN 'legacy_normalized_${field}' THEN p.${column}::text::numeric`).join(" ")} END`;
const invalidNumberSql = `n.value_kind='number' AND (n.numeric_value::text !~ '${numericGrammar}'
 OR octet_length(n.numeric_value::text)>1024 OR abs(n.numeric_value)>1.7976931348623157e308::numeric
 OR (trunc(n.numeric_value)=n.numeric_value AND abs(n.numeric_value)>9007199254740991::numeric))`;
const admissionSql = `/*orion:appearance:admissionmeta*/ ${scopeSql},
native_counts AS (
 SELECT p.revision_id,count(n.revision_id) AS states,
 coalesce(bool_or(${invalidNumberSql}),false) AS bad_number,
 coalesce(bool_or(CASE WHEN n.value_kind='number' THEN (${projectionSql}) IS DISTINCT FROM n.numeric_value
 ELSE (${projectionSql}) IS NOT NULL END) FILTER(WHERE n.revision_id IS NOT NULL),false) AS bad_projection
 FROM performances p LEFT JOIN football.player_match_metric_values n ON ${nativeJoin}
 GROUP BY p.revision_id
), coverage AS (
 SELECT m.match_id,c.source_id,c.variant_key,c.observed_row_count,c.collection_state,c.coverage_state,c.is_stale,
 (SELECT count(*) FROM performances p WHERE p.match_id=m.match_id) AS actual_count,
 EXISTS(SELECT 1 FROM performances p WHERE p.match_id=m.match_id AND (p.source_id<>c.source_id OR p.variant_key<>c.variant_key)) AS wrong_source
 FROM matches m LEFT JOIN ingest.match_coverage c ON c.match_id=m.match_id
 AND c.feature_code='normalized_performance' AND ${at("c", "m.dg")} AND c.is_canonical
)
SELECT (SELECT count(*)::text FROM matches) match_count,
 (SELECT count(*)::text FROM matches m JOIN football.player_match_stats s ON s.match_id=m.match_id
 AND s.period_code='full_match' AND ${selected("s", "m.dg")}) selected_performance_count,
 (SELECT count(*)::text FROM matches WHERE public_id IS NULL) bad_match_alias,
 (SELECT count(*)::text FROM performances) performance_count,
 (SELECT count(DISTINCT performance_id)::text FROM performances) unique_performance_count,
 (SELECT count(*)::text FROM performances WHERE performance_id IS NULL OR performance_id='' OR player_public_id IS NULL
 OR team_public_id IS NULL OR (profile_version_id IS NOT NULL AND observed_profile_id IS NULL)) bad_identity,
 (SELECT count(*)::text FROM sides WHERE team_public_id IS NULL) bad_team_alias,
 (SELECT count(*)::text FROM native_counts WHERE states<>31) bad_native,
 (SELECT count(*)::text FROM native_counts WHERE bad_number) bad_number,
 (SELECT count(*)::text FROM native_counts WHERE bad_projection) bad_projection,
 (SELECT count(*)::text FROM coverage WHERE source_id IS NULL OR is_stale OR wrong_source
 OR coverage_state NOT IN ('available','empty_response')
 OR collection_state NOT IN ('present','empty') OR observed_row_count IS DISTINCT FROM actual_count
 OR (collection_state='empty' AND actual_count<>0) OR (collection_state='present' AND actual_count=0)) bad_coverage,
 (SELECT count(*)::text FROM (SELECT team_id FROM team_profiles GROUP BY team_id HAVING count(*)>1) ambiguous) bad_team_profile`;

function mediaValue(asset, base) {
  const ext = asset.storage_key?.split(".").at(-1)?.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(asset.content_sha256 || "") || !asset.storage_key || !immutableFile(asset.storage_key)
    || !asset.storage_key.endsWith(asset.content_sha256 + "." + ext)
    || asset.content_type !== { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" }[ext])
    unavailable("MEDIA_UNAVAILABLE", "Média de profil indisponible.");
  try { return cloudFrontObjectUrl(asset.storage_key, base); }
  catch { unavailable("MEDIA_UNAVAILABLE", "Origine média indisponible."); }
}
async function dependencies(row, base) {
  const assets = await query(`/*orion:appearance:mediameta*/ ${scopeSql}, asset_ids AS (
 SELECT image_asset_id AS id FROM performances WHERE image_asset_id IS NOT NULL
 UNION SELECT image_asset_id FROM team_profiles WHERE image_asset_id IS NOT NULL
 UNION SELECT $2::bigint WHERE $2::bigint IS NOT NULL)
 SELECT i.id::text asset_id,a.storage_key,a.content_sha256,a.content_type
 FROM asset_ids i LEFT JOIN ingest.media_assets a ON a.id=i.id ORDER BY i.id`, [context(row), row.competition_asset_id]);
  const urls = new Map(), fingerprints = [];
  for (const asset of assets) {
    const url = mediaValue(asset, base);
    urls.set(asset.asset_id, url);
    fingerprints.push([asset.asset_id, asset.storage_key, asset.content_sha256, asset.content_type, url]);
  }
  return { urls, fingerprints };
}

function dateOk(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function argumentsFor(params) {
  validateParams(params, ["league", "season", "v", "limit", "cursor", "format"]);
  const version = params.get("v"), token = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/.exec(version || "");
  if (!token || BigInt(token[1]) > 9223372036854775807n || !/^l_[A-Za-z0-9]{6}$/.test(params.get("league") || "")
    || !/^\d{4}(?:\/\d{4})?$/.test(params.get("season") || "")) reject(400, "Édition et version valides requises.");
  const raw = params.get("limit") ?? "25", limit = Number(raw), format = params.get("format");
  if (!/^[1-9][0-9]{0,2}$/.test(raw) || limit > 100 || (format !== null && format !== "columns")) reject(400, "Format ou taille de page invalide.");
  const scope = digest(JSON.stringify([representation, version, params.get("league"), params.get("season"), limit, format]));
  let cursor = null;
  if (params.has("cursor")) {
    try {
      const raw = params.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(raw)) throw Error();
      cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      if (cursor.scope !== scope || cursor.generation !== version || !/^m_[A-Za-z0-9]{6}$/.test(cursor.id)
        || !(cursor.day === null || dateOk(cursor.day))) throw Error();
    } catch { reject(400, "Curseur invalide."); }
  }
  return { version, buildId: token[1], limit, format, scope, cursor };
}
function responseTag(req, args, media) {
  const url = new URL(req.url), params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return `W/"orion-appearance1-${digest(JSON.stringify([representation, url.pathname, params, args.version, media.fingerprints]))}"`;
}
function reply(req, value, args, media) {
  return send(req, value, 200, { etag: responseTag(req, args, media), ttl: 15, maxBytes: 2 * 1024 * 1024,
    headers: { "X-Orion-Representation": args.version, "X-Orion-Appearance-Contract": representation } });
}
function assetUrl(id, media) { return id === null ? null : media.urls.get(String(id)) ?? null; }
function quality(flags) { return typeof flags?.stats_reliable === "boolean" ? flags.stats_reliable : undefined; }

async function contents(row, args, media) {
  const cursor = args.cursor, binds = [context(row), cursor?.day ?? null, cursor?.id ?? null, args.limit];
  const keys = await query(`/*orion:appearance:keys*/ ${scopeSql}
 SELECT match_id::text,public_id AS id,match_date::text AS day FROM matches
 WHERE ($3::text IS NULL OR match_date>$2::date OR (match_date IS NULL AND $2::date IS NOT NULL)
 OR (match_date IS NOT DISTINCT FROM $2::date AND public_id COLLATE "C">$3::text COLLATE "C"))
 ORDER BY match_date NULLS LAST,public_id COLLATE "C" LIMIT ($4::int+1)`, binds);
  const page = keys.slice(0, args.limit), ids = page.map((k) => k.match_id), params = [context(row), ids];
  const [matches, facts, stats, teams] = await Promise.all([
    query(`/*orion:appearance:facts*/ ${scopeSql}
 SELECT m.match_id::text,m.public_id AS id,m.match_date::text AS date,m.kickoff_at,m.status,
 m.home_label,m.away_label,m.home_goals,m.away_goals,m.score_scope,
 home.team_public_id AS home_id,home.participant_label AS home_observed,
 away.team_public_id AS away_id,away.participant_label AS away_observed
 FROM matches m LEFT JOIN sides home ON home.match_id=m.match_id AND home.side='home'
 LEFT JOIN sides away ON away.match_id=m.match_id AND away.side='away'
 WHERE m.match_id=ANY($2::bigint[]) ORDER BY m.match_date NULLS LAST,m.public_id COLLATE "C"`, params),
    query(`/*orion:appearance:native*/ ${scopeSql}
 SELECT p.performance_id,p.match_public_id,p.match_date::text AS date,p.player_public_id,p.team_public_id,p.team_label,
 p.observed_name,p.external_profile_version_id,p.image_asset_id::text,p.is_starter,p.is_captain,
 p.raw_pitch_x::double precision AS raw_pitch_x,p.raw_pitch_y::double precision AS raw_pitch_y,
 p.coordinate_frame,p.raw_position_code,p.raw_position_code_state,p.raw_position_code_source_number,
 p.shirt_number,p.shirt_number_state,p.shirt_number_source_number,p.quality_flags,p.position_code,
 (SELECT json_agg(json_build_array(substring(n.metric_code FROM 19),n.value_kind,
 CASE WHEN n.value_kind='number' THEN to_json(n.numeric_value::text)
 WHEN n.value_kind='string' THEN to_json(n.text_value) WHEN n.value_kind='boolean' THEN to_json(n.boolean_value) ELSE 'null'::json END)
 ORDER BY n.metric_code COLLATE "C") FROM football.player_match_metric_values n WHERE ${nativeJoin}) native
 FROM performances p WHERE p.match_id=ANY($2::bigint[])
 ORDER BY p.match_date NULLS LAST,p.match_public_id COLLATE "C",p.performance_id COLLATE "C"`, params),
    query(`/*orion:appearance:stats*/ ${scopeSql}
 SELECT s.match_id::text,sides.side,s.quality_flags,${[...new Set(Object.values(teamFields))].map((field) => `s.${field}::text AS ${field}`).join(",")}
 FROM sides JOIN football.team_match_stats s ON s.match_id=sides.match_id AND s.team_id=sides.team_id
 AND s.period_code='full_match' AND s.period_definition_version='bootstrap_v1'
 AND ${selected("s", "sides.dg")} WHERE s.match_id=ANY($2::bigint[]) ORDER BY s.match_id,sides.side`, params),
    query(`/*orion:appearance:context*/ ${scopeSql}
 SELECT t.team_id::text,aliases.public_id AS id,p.id::text AS profile_id,p.display_name AS name,p.image_asset_id::text,
 p.country_code_source AS country,(SELECT count(DISTINCT s.match_id)::text FROM sides s WHERE s.team_id=t.team_id) sample_matches
 FROM (SELECT DISTINCT team_id FROM team_members) t CROSS JOIN x
 LEFT JOIN team_profiles p ON p.team_id=t.team_id
 LEFT JOIN LATERAL (SELECT min(a.public_key COLLATE "C") public_id FROM ingest.public_aliases a
 WHERE a.route_kind='team' AND a.team_id=t.team_id AND a.public_key ~ '^t_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "x.cg")}) aliases ON true
 ORDER BY aliases.public_id COLLATE "C"`, [context(row)]),
  ]);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const appearances = facts.map((p) => {
    const result = {
      id: p.performance_id, playerId: p.player_public_id, playerRef: p.external_profile_version_id,
      name: p.observed_name, teamId: p.team_public_id, team: p.team_label,
      matchId: p.match_public_id, leagueId: row.league_id, league: row.league_name,
      country: row.country, season: row.season, date: p.date, starter: p.is_starter, isCaptain: p.is_captain,
      rawPitchX: p.raw_pitch_x, rawPitchY: p.raw_pitch_y, coordinateFrame: p.coordinate_frame,
      imageUrl: assetUrl(p.image_asset_id, media),
    };
    const reliable = quality(p.quality_flags);
    if (reliable !== undefined) result.statsReliable = reliable;
    for (const [from, to] of [["raw_position_code", "positionId"], ["shirt_number", "shirtNumber"]]) {
      const kind = p[from + "_state"], value = scalar(kind, kind === "number" ? p[from + "_source_number"] : p[from]);
      if (value !== absent) result[to] = value;
    }
    for (const [field, kind, raw] of p.native || []) {
      if (!Object.hasOwn(nativeFields, field)) unavailable("NATIVE31_INCOMPLETE", "Champ natif inconnu.");
      const value = scalar(kind, raw);
      if (value !== absent) result[field] = value;
    }
    return result;
  });
  const resultMatches = matches.map((m) => {
    const ownStats = stats.filter((s) => s.match_id === m.match_id),
      homeStats = ownStats.find((s) => s.side === "home"), awayStats = ownStats.find((s) => s.side === "away");
    const reliability = [quality(homeStats?.quality_flags), quality(awayStats?.quality_flags)];
    const teamStatsReliable = reliability.includes(false) ? false : reliability.every((v) => v === true) ? true : null;
    const side = (name) => {
      const id = m[name + "_id"], profile = teamMap.get(id);
      return { id, name: profile?.profile_id ? profile.name : m[name + "_observed"] ?? m[name + "_label"],
        imageUrl: assetUrl(profile?.image_asset_id ?? null, media), score: m[name + "_goals"] };
    };
    return {
      id: m.id, date: m.date, timeUtc: m.kickoff_at, status: m.status, season: row.season,
      leagueId: row.league_id, league: row.league_name, country: row.country,
      home: side("home"), away: side("away"), scoreScope: m.score_scope,
      players: appearances.filter((p) => p.matchId === m.id).map((p) => p.id), shots: [],
      stats: Object.entries(teamFields).flatMap(([key, column]) => {
        const home = homeStats?.[column] ?? null, away = awayStats?.[column] ?? null;
        return home === null && away === null ? [] : [{ key, label: key,
          home: home === null ? null : nativeNumber(home), away: away === null ? null : nativeNumber(away) }];
      }),
      coverage: { teamStatsReliable, normalizedPerformance: "complete", shots: { projection: "lazy", collectionState: "unknown" } },
    };
  });
  const last = page.at(-1);
  return {
    data: {
      meta: { representationVersion: representation, representationToken: args.version, source: "AWS",
        retrievedAt: row.finished_at, currentSeason: row.season, matches: count(row.match_count),
        appearances: row.performance_count,
        projection: { nativeFields: Object.keys(nativeFields), producerVersion: producer, normalizedPerformance: "complete",
          shots: "lazy", structuralFields: "typed-observed-v1", omittedFamilies: ["events", "heatmaps", "shotmap"] } },
      metrics: Object.keys(nativeFields).map((key) => ({ key, label: key })),
      teams: teams.map((t) => ({ id: t.id, name: t.name, imageUrl: assetUrl(t.image_asset_id, media), country: t.country,
        seasons: [row.season], leagueIds: [row.league_id], sampleMatches: count(t.sample_matches) })),
      competitions: [{ id: row.league_id, name: row.league_name, imageUrl: assetUrl(row.competition_asset_id, media),
        country: row.country, seasons: [row.season], season: row.season, sampleMatches: count(row.match_count) }],
      fixtures: resultMatches.map(({ stats, shots, players, ...fixture }) => fixture), matches: resultMatches, appearances,
    },
    pagination: { limit: args.limit, generation: args.version, nextCursor: keys.length > args.limit
      ? Buffer.from(JSON.stringify({ scope: args.scope, generation: args.version, day: last.day, id: last.id })).toString("base64url") : null },
  };
}

async function partition(req, params, options) {
  const args = argumentsFor(params), rows = await query(publicationSql, [args.buildId]);
  if (rows.length !== 1 || buildToken(rows[0]) !== args.version) reject(400, "Version invalide.");
  const row = rows[0];
  if (row.representation_version !== "summary-v1-shots-v1") unavailable("PERFORMANCE_COVERAGE_UNAVAILABLE", "Construction incompatible.");
  if (!row.league_keys?.includes(params.get("league")) || row.season !== params.get("season")) reject(400, "Version hors de cette édition.");
  row.league_id = params.get("league");
  const [admission] = await query(admissionSql, [context(row)]);
  if (!admission || count(admission.match_count) !== count(row.match_count) || count(admission.bad_match_alias)
    || count(admission.bad_team_alias) || count(admission.bad_identity)
    || count(admission.performance_count) !== count(admission.unique_performance_count)
    || count(admission.performance_count) !== count(admission.selected_performance_count) || count(admission.bad_team_profile))
    unavailable("PERFORMANCE_COVERAGE_UNAVAILABLE", "Identités ou périmètre de performance indisponibles.");
  if (count(admission.bad_coverage)) unavailable("PERFORMANCE_COVERAGE_UNAVAILABLE", "Couverture de performances indisponible.");
  if (count(admission.bad_native)) unavailable("NATIVE31_INCOMPLETE", "États natifs incomplets.");
  if (count(admission.bad_number)) unavailable("NATIVE_NUMBER_INVALID", "Nombre natif non représentable.");
  if (count(admission.bad_projection)) unavailable("NATIVE31_INCOMPLETE", "Projection native incohérente.");
  row.performance_count = count(admission.performance_count);
  const media = await dependencies(row, options.mediaBase);
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), responseTag(req, args, media))) return reply(req, null, args, media);
  const body = await contents(row, args, media);
  if (args.format === "columns") body.data = packPartition(body.data);
  return reply(req, body, args, media);
}

/** One existing route, with explicit capability and version admission. */
export async function orionProAppearanceRoute(req, path, params, options = {}) {
  if (path !== "/api/seasons/partition") return null;
  if (!["GET", "HEAD"].includes(req.method)) return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, { headers: { Allow: "GET, HEAD" } });
  try { return await partition(req, params, options); }
  catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    return send(req, { error: { code: error.code, message: error.message } }, 503);
  }
}
