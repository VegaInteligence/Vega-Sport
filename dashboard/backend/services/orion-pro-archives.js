import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";
import { orionProRoute } from "./orion-pro.js";

const contract = "archives-typed-v1";
const buildRepresentation = "summary-v1-shots-v1";
const maxBytes = 2 * 1024 * 1024;
const maxText = 4096;
const maxEditions = 2048;
const maxMatches = 10000;
const maxEvents = 20000;
const maxDocuments = 10000;
const matchId = /^m_[A-Za-z0-9]{6}$/;
const seasonKey = /^\d{4}(?:\/\d{4})?$/;
const competitionKey = /^[\w:-]{1,100}$/;
const versionPattern = /^pro1\.([1-9][0-9]{0,18})\.([a-f0-9]{64})$/;
const rolePrefix = { results: "archive-results", goals: "archive-goals", supplemental: "supplemental" };
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = (a, g) => `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) => `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const pending = () => reject(503, "Archives typées indisponibles.");
const oversized = () => reject(413, "Archive trop volumineuse.");

function argsFor(path, params) {
  const point = /^\/api\/archive\/matches\/([^/]+)$/.exec(path);
  const action = point ? "point" : {
    "/api/archives/index": "index", "/api/archives/season": "season", "/api/supplemental": "supplemental",
  }[path];
  if (!action) return null;
  const fields = action === "index" ? ["kind", "v"] : action === "season" ? ["kind", "season", "v"] : ["v"];
  validateParams(params, fields);
  const role = action === "index" || action === "season" ? params.get("kind") : action;
  const season = params.get("season"), version = params.get("v");
  if ((fields.includes("kind") && !["results", "goals"].includes(role)) ||
    (action === "season" && !seasonKey.test(season ?? "")) || (point && !matchId.test(point[1]))) reject(400, "Paramètre d’archive invalide.");
  const token = version !== null && versionPattern.exec(version);
  if (version !== null && (!token || BigInt(token[1]) > 9223372036854775807n)) reject(400, "Version invalide.");
  return { action, role, season, version, buildId: token ? token[1] : null, mid: point?.[1] ?? null };
}

function tokenFor(r) {
  return `pro1.${r.build_id}.${digest([
    r.build_id, r.edition_id, r.dataset_snapshot_id, r.dg, r.catalog_snapshot_id, r.cg,
    r.representation_version, r.code_content_sha256, r.dependencies_sha256, r.environment_sha256,
    r.metrics_contract_version, r.transform_version,
  ])}`;
}
const publicationsSql = `/*orion:archive-publication-meta*/
SELECT b.id::text build_id,b.competition_season_id::text edition_id,b.dataset_snapshot_id::text,
 b.catalog_snapshot_id::text,d.generation::text dg,c.generation::text cg,b.representation_version,
 b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,b.metrics_contract_version,b.transform_version,
 e.season_key season,co.id::text competition_id,co.slug,country.iso3 country,
 coalesce((SELECT min(a.public_key) FROM ingest.public_aliases a WHERE a.route_kind='competition' AND a.competition_id=co.id
   AND a.public_key ~ '^l_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "c.generation")}),co.slug) public_competition,
 CASE WHEN octet_length(co.name)<=${maxText} THEN co.name END name,
 coalesce(octet_length(co.name)>${maxText},false) oversize
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
JOIN football.competition_seasons e ON e.id=b.competition_season_id AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
JOIN football.competitions co ON co.id=e.competition_id AND ${selected("co", "c.generation")}
LEFT JOIN football.countries country ON country.id=co.country_id AND ${selected("country", "c.generation")}
WHERE b.status='ready' AND ($1::bigint IS NULL OR b.id=$1::bigint) AND EXISTS(
 SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id AND p.competition_season_id=b.competition_season_id
 AND p.catalog_snapshot_id=b.catalog_snapshot_id AND p.representation_version=b.representation_version
 AND ($1::bigint IS NOT NULL OR p.published_to_gen IS NULL))
ORDER BY b.competition_season_id,b.id LIMIT ${maxEditions + 1}`;

async function publications(args) {
  const rows = await query(publicationsSql, [args.buildId]);
  if (!rows.length) {
    if (args.version !== null) reject(400, "Version invalide.");
    pending();
  }
  if (rows.length > maxEditions || new Set(rows.map((r) => r.edition_id)).size !== rows.length) pending();
  if (args.version !== null && (rows.length !== 1 || tokenFor(rows[0]) !== args.version)) reject(400, "Version invalide.");
  const scope = args.season ? rows.filter((r) => r.season === args.season) : rows;
  if (!scope.length) reject(404, "Saison introuvable.");
  return scope.map((r) => ({ ...r, token: tokenFor(r) }));
}
function validatePublication(r) {
  if (r.oversize) oversized();
  if (r.representation_version !== buildRepresentation || !seasonKey.test(r.season) || !competitionKey.test(r.public_competition)) pending();
}
const cx = (rows) => JSON.stringify(rows.map(({ build_id, edition_id, dataset_snapshot_id, dg, cg, season, public_competition }) => ({ build_id, edition_id, dataset_snapshot_id, dg, cg, season, public_competition })));
const contextSql = `x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS b(
 build_id bigint,edition_id bigint,dataset_snapshot_id bigint,dg bigint,cg bigint,season text,public_competition text))`;
const documentsSql = `docs AS (
 SELECT x.build_id,x.dg,doc.id document_id,doc.content_sha256,doc.source_id,ds.id dataset_id,
  src.name source_name,ds.source_url,ds.license_code
 FROM x JOIN ingest.dataset_snapshot_documents sd ON sd.snapshot_id=x.dataset_snapshot_id
 JOIN ingest.source_documents doc ON doc.id=sd.document_id
 JOIN ingest.source_datasets ds ON ds.id=doc.dataset_id AND ds.source_id=doc.source_id
 JOIN ingest.sources src ON src.id=doc.source_id
 WHERE ds.contract_version=$2::text AND ds.dataset_key=$3::text||':'||x.public_competition||':'||x.season
)`;
const publicMatch = (actor, gen) => `(SELECT min(a.public_key) FROM ingest.public_aliases a WHERE a.route_kind='match'
 AND a.match_id=${actor} AND a.public_key ~ '^m_[A-Za-z0-9]{6}$' AND ${aliasAt("a", gen)})`;
const matchesSql = `matches AS (
 SELECT x.build_id,x.dg,x.cg,x.edition_id,m.id match_id,m.revision_id match_revision_id,m.match_date,m.kickoff_at,m.status,m.round_label,m.round_number,m.neutral_venue,
  s.home_team_id,s.away_team_id,s.home_label,s.away_label,s.home_goals,s.away_goals,s.score_scope,
  ${publicMatch("m.id", "x.cg")} public_id
 FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id AND m.competition_season_id=x.edition_id
  AND m.publication_state='published' AND ${selected("m", "x.dg")}
 WHERE EXISTS(SELECT 1 FROM docs d WHERE d.build_id=x.build_id)
)`;
const observationsSql = `observations AS (
 SELECT DISTINCT ON (d.build_id,o.source_record_id) d.build_id,o.*
 FROM docs d JOIN ingest.source_records r ON r.document_id=d.document_id AND r.source_id=d.source_id
 JOIN football.match_observation_details o ON o.source_record_id=r.id AND o.recorded_from_gen<=d.dg
 ORDER BY d.build_id,o.source_record_id,o.recorded_from_gen DESC
), result_rows AS (
 SELECT m.*,o.source_record_id,o.source_match_key,o.source_competition_label,o.source_season_label,o.source_home_label,o.source_away_label,
  o.source_date_text,o.date_note,o.source_time_text,o.source_round_label,o.source_stage_label,o.source_group_label,
  o.source_venue_label,o.attendance,o.attendance_text,o.result_code,o.notes
 FROM matches m JOIN observations o ON o.build_id=m.build_id AND o.match_id=m.match_id AND o.match_revision_id=m.match_revision_id
 WHERE o.resolution_state='resolved'
)`;
const familiesSql = `families AS (
 SELECT m.*,p.source_id,p.feature_code,p.variant_key,p.recorded_from_gen,p.collection_state,p.observed_row_count,
  p.source_record_id parent_record,p.document_id,r.locator parent_locator,n.members,n.invalid,n.distinct_ordinals,n.first_ordinal,n.last_ordinal
 FROM matches m JOIN ingest.match_coverage p ON p.match_id=m.match_id AND p.match_revision_id=m.match_revision_id
  AND p.feature_code='events' AND ${at("p", "m.dg")}
 JOIN docs d ON d.build_id=m.build_id AND d.document_id=p.document_id AND d.source_id=p.source_id
 JOIN ingest.source_records r ON r.id=p.source_record_id AND r.source_id=p.source_id AND r.document_id=p.document_id
 CROSS JOIN LATERAL (
   SELECT count(*)::int members,count(DISTINCT e.source_ordinal)::int distinct_ordinals,min(e.source_ordinal) first_ordinal,max(e.source_ordinal) last_ordinal,
    count(*) FILTER (WHERE e.event_type IS DISTINCT FROM 'goal' OR e.period_code='shootout' OR e.match_revision_id<>m.match_revision_id
      OR leaf.id IS NULL OR leaf.record_kind<>'archive_goal_v1' OR leaf.ordinal IS DISTINCT FROM e.source_ordinal
      OR leaf.locator<>r.locator||'/events/'||e.source_ordinal::text
      OR (e.team_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM football.match_teams mt WHERE mt.match_id=m.match_id
        AND mt.match_revision_id=m.match_revision_id AND mt.revision_id=e.match_team_revision_id AND mt.team_id=e.team_id AND ${selected("mt", "m.dg")})))::int invalid
   FROM football.match_events e LEFT JOIN ingest.source_records leaf ON leaf.id=e.source_record_id AND leaf.source_id=p.source_id AND leaf.document_id=p.document_id
   WHERE e.match_id=p.match_id AND e.source_id=p.source_id AND e.feature_code=p.feature_code AND e.variant_key=p.variant_key AND e.recorded_from_gen=p.recorded_from_gen
 ) n
)`;
const baseSql = `WITH ${contextSql},${documentsSql},${matchesSql}`;
const oversizedObservation = `coalesce(greatest(octet_length(r.source_competition_label),octet_length(r.source_season_label),octet_length(r.source_match_key),
 octet_length(r.source_home_label),octet_length(r.source_away_label),octet_length(r.source_date_text),octet_length(r.date_note),
 octet_length(r.source_time_text),octet_length(r.source_round_label),octet_length(r.source_stage_label),octet_length(r.source_group_label),
 octet_length(r.source_venue_label),octet_length(r.attendance_text),octet_length(r.result_code),octet_length(r.notes)),0)>${maxText}`;

function catalogueMetaSql(role) {
  const results = role !== "goals", goals = role !== "results";
  return `/*orion:archive-catalogue-meta*/ ${baseSql}${results ? ","+observationsSql : ""}${goals ? ","+familiesSql : ""}
SELECT x.build_id::text,
 (SELECT count(*)::int FROM football.matches m WHERE m.competition_season_id=x.edition_id AND m.publication_state='published' AND ${selected("m", "x.dg")}) actual_count,
 (SELECT count(*)::int FROM analytics.match_summary s WHERE s.build_id=x.build_id) summary_count,
 (SELECT count(*)::int FROM matches m WHERE m.build_id=x.build_id) match_count,
 NOT EXISTS(SELECT 1 FROM matches m WHERE m.build_id=x.build_id AND m.public_id IS NULL) aliases_ok,
 (SELECT count(*)::int FROM docs d WHERE d.build_id=x.build_id) document_count,
 (SELECT count(DISTINCT d.dataset_id)::int FROM docs d WHERE d.build_id=x.build_id) dataset_count,
 (SELECT jsonb_agg(jsonb_build_object('id',d.document_id::text,'sha',d.content_sha256,'source',d.source_id::text,'dataset',d.dataset_id::text) ORDER BY d.document_id)
    FROM (SELECT * FROM docs dd WHERE dd.build_id=x.build_id ORDER BY dd.document_id LIMIT ${maxDocuments + 1}) d) documents,
 (SELECT jsonb_build_object('name',d.source_name,'url',d.source_url,'license',d.license_code) FROM docs d WHERE d.build_id=x.build_id ORDER BY d.document_id LIMIT 1) source
 ${results ? `,(SELECT count(*)::int FROM observations o WHERE o.build_id=x.build_id) observed_count,
 (SELECT count(*)::int FROM result_rows r WHERE r.build_id=x.build_id) results_count,
 (SELECT count(DISTINCT r.match_id)::int FROM result_rows r WHERE r.build_id=x.build_id) unique_results,
 (SELECT count(*)::int FROM result_rows r WHERE r.build_id=x.build_id AND r.status IN ('finished','awarded')) played,
 (SELECT count(*)::int FROM result_rows r WHERE r.build_id=x.build_id AND r.date_note IS NOT NULL) unverified_dates,
 EXISTS(SELECT 1 FROM result_rows r WHERE r.build_id=x.build_id AND ${oversizedObservation}) oversize,
 NOT EXISTS(SELECT 1 FROM result_rows r WHERE r.build_id=x.build_id AND r.result_code='not_played' AND r.status IN ('finished','awarded')) results_ok` : ""}
 ${goals ? `,(SELECT count(*)::int FROM families f WHERE f.build_id=x.build_id) family_count,
 (SELECT count(DISTINCT f.match_id)::int FROM families f WHERE f.build_id=x.build_id) unique_families,
 (SELECT coalesce(sum(f.members),0)::int FROM families f WHERE f.build_id=x.build_id) event_count,
 (SELECT count(*)::int FROM families f WHERE f.build_id=x.build_id AND f.members>0) event_matches,
 (SELECT to_char(max(f.match_date),'YYYY-MM-DD') FROM families f WHERE f.build_id=x.build_id AND f.members>0) latest_event,
 NOT EXISTS(SELECT 1 FROM families f WHERE f.build_id=x.build_id AND (
  ((f.collection_state='present' AND f.observed_row_count>0) OR (f.collection_state='empty' AND f.observed_row_count=0)) IS NOT TRUE
  OR f.observed_row_count IS DISTINCT FROM f.members OR f.invalid<>0 OR f.distinct_ordinals<>f.members
  OR (f.members>0 AND (f.first_ordinal<>0 OR f.last_ordinal<>f.members-1 OR f.match_date IS NULL
  OR nullif(btrim(f.home_label),'') IS NULL OR nullif(btrim(f.away_label),'') IS NULL
  OR f.score_scope IS DISTINCT FROM 'final_without_shootout' OR f.home_goals IS NULL OR f.away_goals IS NULL)))) goals_ok` : ""}
FROM x WHERE EXISTS(SELECT 1 FROM docs d WHERE d.build_id=x.build_id) ORDER BY x.build_id`;
}

const resultBodySql = `/*orion:archive-results-body*/ ${baseSql},${observationsSql}
SELECT r.build_id::text,r.public_id,r.status,to_char(r.match_date,'YYYY-MM-DD') date,
 to_char(r.kickoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') kickoff,
 r.round_label,r.round_number,r.neutral_venue,r.home_label,r.away_label,r.source_competition_label,r.source_season_label,
 r.source_home_label,r.source_away_label,r.source_date_text,r.date_note,r.source_time_text,r.source_round_label,r.source_stage_label,
 r.source_group_label,r.source_venue_label,r.attendance,r.attendance_text,r.result_code,r.notes,
 (SELECT jsonb_object_agg(s.score_scope||':'||s.side,s.goals) FROM football.match_scores s
  JOIN football.match_teams mt ON mt.revision_id=s.match_team_revision_id AND mt.match_id=r.match_id AND mt.match_revision_id=r.match_revision_id AND mt.side=s.side AND ${selected("mt", "r.dg")}
  WHERE s.match_id=r.match_id AND ${selected("s", "r.dg")}) scores
FROM result_rows r ORDER BY r.build_id,r.match_date NULLS LAST,r.match_id LIMIT ${maxMatches + 1}`;
const goalBodySql = `/*orion:archive-goals-body*/ ${baseSql},${familiesSql}
SELECT f.build_id::text,f.public_id,to_char(f.match_date,'YYYY-MM-DD') date,f.round_label,
 f.home_label,f.away_label,f.home_goals final_home,f.away_goals final_away,
 e.minute,e.minute_added,e.is_own_goal,e.is_penalty,e.score_home,e.score_away,profile.display_name player,
 CASE WHEN e.team_id=f.home_team_id THEN f.home_label WHEN e.team_id=f.away_team_id THEN f.away_label END team
FROM families f JOIN football.match_events e ON e.match_id=f.match_id AND e.source_id=f.source_id AND e.feature_code=f.feature_code
 AND e.variant_key=f.variant_key AND e.recorded_from_gen=f.recorded_from_gen
LEFT JOIN LATERAL (SELECT p.display_name FROM football.player_profile_versions p WHERE p.player_id=e.player_id
 AND p.source_id=f.source_id AND ${selected("p", "f.cg")} AND ((p.profile_context='provider_global' AND p.variant_key='provider:exact') OR p.profile_context='legacy_normalized_global')
 ORDER BY CASE p.profile_context WHEN 'provider_global' THEN 1 ELSE 2 END LIMIT 1) profile ON true
ORDER BY f.build_id,f.match_date NULLS LAST,f.match_id,e.source_ordinal,e.event_seq LIMIT ${maxEvents + 1}`;

const pointMetaSql = `/*orion:archive-point-meta*/ WITH ${contextSql}
SELECT x.build_id::text,m.id::text match_id,
 (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.feature,k.source,k.variant) FROM (
  SELECT c.feature_code feature,c.source_id::text source,c.variant_key variant,c.recorded_from_gen::text generation,
    c.collection_state state,c.observed_row_count count,c.coverage_state availability
  FROM ingest.match_coverage c WHERE c.match_id=m.id AND c.is_canonical AND ${at("c", "x.dg")}
  ORDER BY c.feature_code,c.source_id,c.variant_key LIMIT 33) k) coverages,
 (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.record) FROM (
  SELECT o.source_record_id::text record,o.recorded_from_gen::text generation,d.id::text document,d.content_sha256 sha,
   src.name,ds.source_url url,ds.license_code license,
   coalesce(greatest(octet_length(o.source_home_label),octet_length(o.source_away_label),octet_length(o.notes)),0)>${maxText} oversize
  FROM ingest.match_coverage c JOIN ingest.source_records r ON r.id=c.source_record_id AND r.source_id=c.source_id AND r.document_id=c.document_id
  JOIN ingest.source_documents d ON d.id=r.document_id AND d.source_id=r.source_id
  JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=d.id AND sd.snapshot_id=x.dataset_snapshot_id
  JOIN ingest.source_datasets ds ON ds.id=d.dataset_id AND ds.source_id=d.source_id JOIN ingest.sources src ON src.id=d.source_id
  JOIN LATERAL (SELECT * FROM football.match_observation_details o WHERE o.source_record_id=r.id AND o.recorded_from_gen<=x.dg ORDER BY o.recorded_from_gen DESC LIMIT 1) o
   ON o.match_id=m.id AND o.match_revision_id=m.revision_id AND o.resolution_state='resolved'
  WHERE c.match_id=m.id AND c.match_revision_id=m.revision_id AND c.feature_code='match' AND c.is_canonical
   AND c.collection_state='present' AND c.observed_row_count=1 AND ${at("c", "x.dg")} LIMIT 2) k) evidence
FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id AND m.competition_season_id=x.edition_id
 AND m.publication_state='published' AND ${selected("m", "x.dg")}
JOIN ingest.public_aliases a ON a.match_id=m.id AND a.route_kind='match' AND a.public_key=$2 AND ${aliasAt("a", "x.cg")}
LIMIT 2`;
const pointBodySql = `/*orion:archive-point-body*/
SELECT source_home_label,source_away_label,source_date_text,source_time_text,source_round_label,date_note,notes
FROM football.match_observation_details WHERE source_record_id=$1::bigint AND recorded_from_gen=$2::bigint`;

function sourceInfo(raw) {
  if (!raw) return { name: null, url: null, license: null };
  let url = null;
  try { const u = new URL(raw.url); if (u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash) url = raw.url; } catch { /* no public URL */ }
  return { name: raw.name, url, license: raw.license };
}
function allSources(metas) {
  const sources = new Map();
  for (const m of metas) { const s = sourceInfo(m.source);sources.set(JSON.stringify(s), s); }
  const values = [...sources.values()];
  return values.length === 1 ? values[0] : { name: null, url: null, license: null, additionalSources: values };
}
function response(req, params, pubs, witness, body) {
  const version = pubs.length === 1 ? pubs[0].token : "archset." + digest(pubs.map((p) => p.token).sort());
  const orderedParams = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const etag = `W/"orion-archive1-${digest([contract, new URL(req.url).pathname, orderedParams, version, witness])}"`;
  const opts = { etag, ttl: 15, maxBytes, headers: {
    "X-Orion-Archive-Contract": contract, "X-Orion-Archive-Generation": version,
    ...(pubs.length === 1 ? { "X-Orion-Representation": version } : {}),
  } };
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, opts);
  return Promise.resolve().then(body).then((value) => send(req, value, 200, opts));
}

const played = (r) => ["finished", "awarded"].includes(r.status);
function scoreObservation(raw, scope) {
  const s = raw ?? {}, h = scope + ":home", a = scope + ":away";
  const haveHome = Object.hasOwn(s, h), haveAway = Object.hasOwn(s, a);
  const pair = [s[h] ?? null, s[a] ?? null];
  return { pair, state: !haveHome && !haveAway ? "absent" : !haveHome || !haveAway ? "partial" : pair.includes(null) ? "null" : "value" };
}
const fieldColumns = {
  Date: "source_date_text", Venue: "source_venue_label", attendance: "attendance_text", Comments: "notes",
  "Team 1": "source_home_label", "Team 2": "source_away_label", Round: "source_round_label", Stage: "source_stage_label",
  Group: "source_group_label", Season: "source_season_label", competition: "source_competition_label", result: "result_code",
};
function resultDto(r) {
  const score = {};
  for (const [key, scope] of [["ht", "half_time"], ["ft", "regulation"], ["et", "after_extra_time"], ["p", "shootout"], ["final", "final_without_shootout"]]) {
    const row = scoreObservation(r.scores, scope);
    if (row.state !== "absent") score[key] = row.pair;
  }
  return { id: r.public_id, date: r.date, time: r.source_time_text, timeUtc: r.kickoff,
    dateNote: r.date_note, round: r.source_round_label ?? r.round_label, stage: r.source_stage_label,
    team1: r.source_home_label ?? r.home_label, team2: r.source_away_label ?? r.away_label,
    status: r.result_code === "not_played" ? "not_played" : r.status, neutralVenue: r.neutral_venue, attendance: r.attendance,
    scoreState: scoreObservation(r.scores, "final_without_shootout").state,
    ...(Object.keys(score).length ? { score } : {}),
    sourceFields: Object.fromEntries(Object.entries(fieldColumns).filter(([, col]) => r[col] !== null).map(([key, col]) => [key, r[col]])) };
}
function goalDto(r) {
  return { id: r.public_id, date: r.date, match: `${r.home_label} vs. ${r.away_label} ${r.final_home}:${r.final_away}`,
    minute: r.minute === null ? null : `${r.minute}${r.minute_added === null ? "" : "+"+r.minute_added}`,
    player: r.player, team: r.team, score: r.score_home === null && r.score_away === null ? null : [r.score_home, r.score_away],
    isOwnGoal: r.is_own_goal, isPenalty: r.is_penalty };
}
function archiveIndex(role, pubs, metadata, source) {
  const seasons = new Map();
  for (const p of pubs) {
    const m = metadata.get(p.build_id);
    if (!seasons.has(p.season)) seasons.set(p.season, role === "goals"
      ? { id: p.season, competitions: 0, matches: 0, events: 0, latestEvent: null }
      : { id: p.season, competitions: 0, matches: 0, results: 0, unplayed: 0, unverifiedDates: 0 });
    const s = seasons.get(p.season);s.competitions++;
    if (role === "goals") {
      s.matches += m.event_matches;s.events += m.event_count;
      if (m.latest_event !== null && (s.latestEvent === null || m.latest_event > s.latestEvent)) s.latestEvent = m.latest_event;
    } else {
      s.matches += m.match_count;s.results += m.played;s.unplayed += m.match_count-m.played;s.unverifiedDates += m.unverified_dates;
    }
  }
  return { schemaVersion: 1, source, seasons: [...seasons.values()].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0) };
}
function grouped(rows, pubs, metadata, expected) {
  const byBuild = new Map(pubs.map((p) => [p.build_id, []]));
  for (const r of rows) { const bucket = byBuild.get(r.build_id);if (!bucket) pending();bucket.push(r); }
  for (const [id, rs] of byBuild) if (rs.length !== metadata.get(id)[expected]) pending();
  return byBuild;
}

async function catalogue(req, params, args, candidates) {
  const prefix = rolePrefix[args.role], bindings = [cx(candidates), "orion-"+prefix+"-v1", prefix];
  const metas = await query(catalogueMetaSql(args.role), bindings);
  if (!metas.length) pending();
  const metadata = new Map(metas.map((m) => [m.build_id, m]));
  const pubs = candidates.filter((p) => metadata.has(p.build_id));
  if (pubs.length !== metas.length || new Set(pubs.map((p) => p.season+":"+p.public_competition)).size !== pubs.length) pending();
  pubs.forEach(validatePublication);
  let matchCount = 0, eventCount = 0;
  for (const m of metas) {
    matchCount += m.match_count;eventCount += m.event_count ?? 0;
    if (m.oversize || m.document_count > maxDocuments || m.match_count > maxMatches || (m.event_count ?? 0)>maxEvents) oversized();
    if (!m.document_count || m.dataset_count !== 1 || m.match_count !== m.summary_count || m.actual_count !== m.match_count || !m.aliases_ok) pending();
    if (args.role !== "goals" && (!m.match_count || !m.results_ok || m.observed_count !== m.match_count || m.results_count !== m.match_count || m.unique_results !== m.match_count)) pending();
    if (args.role !== "results" && (!m.match_count || !m.goals_ok || m.family_count !== m.match_count || m.unique_families !== m.match_count)) pending();
  }
  if (args.action !== "index" && (matchCount > maxMatches || eventCount > maxEvents)) oversized();
  const source = allSources(metas);
  if (args.action === "index") return response(req, params, pubs, metas, () => archiveIndex(args.role, pubs, metadata, source));
  const selectedBindings = [cx(pubs), ...bindings.slice(1)];
  return response(req, params, pubs, metas, async () => {
    const results = args.role === "goals" ? null : grouped(await query(resultBodySql, selectedBindings), pubs, metadata, "match_count");
    const goals = args.role === "results" ? null : grouped(await query(goalBodySql, selectedBindings), pubs, metadata, "event_count");
    const ordered = [...pubs].sort((a, b) => a.season > b.season ? -1 : a.season < b.season ? 1 : a.public_competition < b.public_competition ? -1 : 1);
    if (args.action === "supplemental") return { meta: { source: "AWS", provenance: source, scope: "published-typed" }, competitions: ordered.map((p) => {
      const rs = results.get(p.build_id), gs = goals.get(p.build_id);
      const row = (r) => ({ id: r.public_id, date: r.date, time: r.source_time_text,
        home: r.source_home_label ?? r.home_label, away: r.source_away_label ?? r.away_label, round_name: r.source_round_label ?? r.round_label, status: r.status });
      return { folder: p.slug, name: p.name, country_code: p.country, season: p.season,
        results: rs.filter(played).map((r) => { const f = scoreObservation(r.scores, "final_without_shootout");return { ...row(r), ft_home: f.pair[0], ft_away: f.pair[1], scoreState: f.state }; }),
        fixtures: rs.filter((r) => !played(r)).map(row),
        goals: gs.map((r) => ({ date: r.date, home: r.home_label, away: r.away_label, minute: goalDto(r).minute, scorer: r.player, score_home: r.score_home, score_away: r.score_away })),
        coverage: { goals: gs.length ? "present" : "empty" } };
    }) };
    return { season: args.season, source, competitions: ordered.map((p) => ({ id: p.public_competition, name: p.name, country: p.country,
      ...(results ? { matches: results.get(p.build_id).map(resultDto) } : {
        events: goals.get(p.build_id).map(goalDto), coverageState: metadata.get(p.build_id).event_count ? "present" : "empty",
      }) })) };
  });
}

const sections = ["match", "shots", "momentum", "events", "players", "player_halves", "lineups", "h2h", "stats", "advanced_teams", "advanced_players", "pass_networks", "heatmaps"];
async function frozen(req, path, token) {
  const url = new URL(req.url);url.pathname = path;url.search = new URLSearchParams({ v: token }).toString();
  const internal = new Request(url);
  const value = await orionProRoute(internal, path, url.searchParams);
  if (!value || value.status !== 200) pending();
  const data = (await value.json()).data;
  if (!data || data.representationToken !== token) pending();
  return data;
}
async function point(req, params, args, candidates) {
  const found = await query(pointMetaSql, [cx(candidates), args.mid]);
  if (!found.length) reject(404, "Match introuvable.");
  if (found.length !== 1) reject(409, "Précisez une version publiée.");
  const m = found[0], p = candidates.find((row) => row.build_id === m.build_id);
  if (!p) pending();validatePublication(p);
  if (m.evidence?.length !== 1) pending();
  const evidence = m.evidence[0];if (evidence.oversize) oversized();
  const rows = m.coverages ?? [], coverage = new Map(rows.map((c) => [c.feature, c]));
  if (rows.length > 32 || coverage.size !== rows.length) pending();
  const shots = coverage.get("shots");
  const shotsReady = ["present", "empty"].includes(shots?.state);
  if (shotsReady && (shots.state === "present" ? !(shots.count > 0 && shots.count <= 1000) : shots.count !== 0)) pending();
  return response(req, params, [p], m, async () => {
    const [obs] = await query(pointBodySql, [evidence.record, evidence.generation]);
    if (!obs) pending();
    const { match } = await frozen(req, `/api/matches/${args.mid}/summary`, p.token);
    if (match?.id !== args.mid) pending();
    const fixture = { id: match.id, league: { id: match.leagueId, name: match.league }, season: match.season,
      date: match.date, time_utc: match.timeUtc, status: match.status, round_name: obs.source_round_label ?? match.roundName,
      home_team: { id: match.home.id, name: obs.source_home_label ?? match.home.name, image_url: match.home.imageUrl },
      away_team: { id: match.away.id, name: obs.source_away_label ?? match.away.name, image_url: match.away.imageUrl },
      score_home: match.home.score, score_away: match.away.score, score_penalty_home: match.home.scorePenalty, score_penalty_away: match.away.scorePenalty };
    const endpoints = {};
    for (const section of sections) {
      const state = coverage.get(section)?.state ?? "unknown";
      endpoints[section] = { status: 503, state: ["present", "empty"].includes(state) ? "unsupported_projection" : "not_collected", coverageState: state };
    }
    endpoints.match = { status: 200, state: "ready", data: fixture };
    if (shotsReady) endpoints.shots = { status: 200, state: "ready", data: await frozen(req, `/api/pitchapi/matches/${args.mid}/shots`, p.token) };
    return { fixture, competition_id: match.leagueId, competition_name: match.league, season: match.season,
      source: sourceInfo(evidence), observation: { sourceDate: obs.source_date_text, sourceTime: obs.source_time_text, dateNote: obs.date_note, notes: obs.notes },
      completeOriginalArchive: false, endpoints };
  });
}

export async function orionProArchiveRoute(req, path, params) {
  const args = argsFor(path, params);
  if (!args) return null;
  const pubs = await publications(args);
  return args.action === "point" ? point(req, params, args, pubs) : catalogue(req, params, args, pubs);
}
