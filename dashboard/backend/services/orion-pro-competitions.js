import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";
import { cloudFrontObjectUrl, immutableFile } from "./cdn.js";

const contract = "competitions-v1";
const representation = "summary-v1-shots-v1";
const maxBytes = 2 * 1024 * 1024;
const maxMatches = 10000;
const maxTables = 1000;
const maxRows = 10000;
const maxEditions = 2048;
const maxLabelBytes = 4096;
const maxAliases = 128;
const year = /^\d{4}(?:\/\d{4})?$/;
const league = /^l_[A-Za-z0-9]{6}$/;
const key = /^[\w:-]{1,100}$/;
const tokenPattern = /^pro1\.([1-9][0-9]{0,18})\.([a-f0-9]{64})$/;
const cupTypes = new Set(["cup", "tournament", "supercup"]);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = (a, g) => `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) => `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const unavailable = () => reject(503, "Cohorte de compétition indisponible.");
const tooLarge = () => reject(413, "Édition trop volumineuse.");

const routes = {
  "/api/standings": { action: "standings", fields: { competition: league, season: year }, required: ["competition"] },
  "/api/open-cups": { action: "open-cups", fields: { competition: key, season: year }, required: ["competition", "season"] },
  "/api/openligadb": { action: "openligadb", fields: { competition: key, season: year }, required: ["competition", "season"] },
  "/api/nations-results": { action: "nations-results", fields: { season: year }, required: [] },
  "/api/cup-index": { action: "index", fields: { kind: /^(worker|supplemental)$/ }, required: ["kind"] },
  "/api/cup-table": { action: "table", fields: { competition: key, season: year, kind: /^(results|fixtures)$/ }, required: ["competition", "season", "kind"] },
  "/api/cup-snapshot": { action: "snapshot", fields: { competition: key, season: year, kind: /^(native|standings|open-cups|openligadb|nations-results)$/ }, required: ["competition", "season", "kind"] },
  "/api/matchdays": { action: "matchdays", fields: { competition: league, season: year }, required: ["competition", "season"] },
};

function argumentsFor(params, spec) {
  validateParams(params, [...Object.keys(spec.fields), "v"]);
  for (const [name, value] of params)
    if (name !== "v" && !spec.fields[name].test(value)) reject(400, "Paramètre invalide.");
  if (spec.required.some((name) => !params.has(name))) reject(400, "Paramètre manquant.");
  const version = params.get("v");
  const parsed = version !== null && tokenPattern.exec(version);
  if (version !== null && (!parsed || BigInt(parsed[1]) > 9223372036854775807n)) reject(400, "Version invalide.");
  return { ...Object.fromEntries(params), version, buildId: parsed ? parsed[1] : null };
}

function proToken(row) {
  return `pro1.${row.build_id}.${digest([
    row.build_id, row.edition_id, row.dataset_snapshot_id, row.dg,
    row.catalog_snapshot_id, row.cg, row.representation_version, row.code_content_sha256,
    row.dependencies_sha256, row.environment_sha256, row.metrics_contract_version, row.transform_version,
  ])}`;
}

const publicationsSql = `/*orion:competition-publication-meta*/
SELECT b.id::text build_id,b.competition_season_id::text edition_id,
 b.competition_season_revision_id::text edition_revision_id,b.dataset_snapshot_id::text,
 d.generation::text dg,b.catalog_snapshot_id::text,c.generation::text cg,b.representation_version,
 b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,b.metrics_contract_version,b.transform_version,
 e.season_key season,co.id::text competition_id,co.slug,co.competition_type,
 CASE WHEN octet_length(co.name)<=${maxLabelBytes} THEN co.name END name,
 coalesce(octet_length(co.name)>${maxLabelBytes},false) oversize,country.iso3 country,
 coalesce(aliases.keys,ARRAY[]::text[]) keys
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
JOIN football.competition_seasons e ON e.id=b.competition_season_id AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
JOIN football.competitions co ON co.id=e.competition_id AND ${selected("co", "c.generation")}
LEFT JOIN football.countries country ON country.id=co.country_id AND ${selected("country", "c.generation")}
LEFT JOIN LATERAL (SELECT array_agg(a.public_key ORDER BY a.public_key) keys FROM (
 SELECT p.public_key FROM ingest.public_aliases p WHERE p.route_kind='competition' AND p.competition_id=co.id
 AND ${aliasAt("p", "c.generation")} ORDER BY p.public_key LIMIT ${maxAliases + 1}) a) aliases ON true
WHERE b.status='ready' AND ($1::bigint IS NULL OR b.id=$1::bigint) AND EXISTS (
 SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id AND p.competition_season_id=b.competition_season_id
 AND p.catalog_snapshot_id=b.catalog_snapshot_id AND p.representation_version=b.representation_version
 AND ($1::bigint IS NOT NULL OR p.published_to_gen IS NULL))
ORDER BY b.competition_season_id,b.id LIMIT ${maxEditions + 1}`;

async function publications(args, action) {
  const rows = await query(publicationsSql, [args.buildId]);
  if (!rows.length) {
    if (args.version !== null) reject(400, "Version invalide.");
    unavailable();
  }
  if (rows.length > maxEditions || new Set(rows.map((r) => r.edition_id)).size !== rows.length) unavailable();
  if (args.version !== null && (rows.length !== 1 || proToken(rows[0]) !== args.version)) reject(400, "Version invalide.");
  const requested = action === "nations-results" ? args.competition || "nations-league" : args.competition;
  let chosen;
  if (action === "index") {
    chosen = rows.filter((r) => cupTypes.has(r.competition_type));
  } else {
    const matching = rows.filter((r) => (r.keys.includes(requested) || r.slug === requested) && (!args.season || r.season === args.season));
    if (!matching.length) reject(404, "Édition indisponible.");
    if (new Set(matching.map((r) => r.competition_id)).size !== 1) unavailable();
    matching.sort((a, b) => a.season < b.season ? 1 : a.season > b.season ? -1 : 0);
    if (matching.length > 1 && matching[0].season === matching[1].season) unavailable();
    chosen = matching.slice(0, 1);
  }
  return chosen.map((r) => {
    if (r.oversize || r.keys.length > maxAliases) tooLarge();
    if (r.representation_version !== representation || !year.test(r.season)) unavailable();
    return { ...r, league_id: r.keys.find((k) => league.test(k)) ?? null, token: proToken(r) };
  });
}

const context = (rows) => JSON.stringify(rows.map(({ build_id, edition_id, edition_revision_id, dg, cg }) => ({ build_id, edition_id, edition_revision_id, dg, cg })));
const contextSql = `x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS a(
 build_id bigint,edition_id bigint,edition_revision_id bigint,dg bigint,cg bigint))`;
const profileJoin = (actor, source, gen) => `LEFT JOIN LATERAL (
 SELECT p.id,p.display_name,p.image_asset_id FROM football.team_profile_versions p WHERE p.team_id=${actor} AND ${selected("p", gen)} AND (
  (p.source_id=${source} AND p.profile_context='provider_global' AND p.variant_key='provider:exact') OR
  (p.source_id=${source} AND p.profile_context='legacy_normalized_global') OR
  (p.source_id IS NULL AND p.profile_context='global' AND p.variant_key='manual:curated'))
 ORDER BY CASE p.profile_context WHEN 'provider_global' THEN 1 WHEN 'legacy_normalized_global' THEN 2 ELSE 3 END LIMIT 1) profile ON true`;
const publicAlias = (kind, column, actor, gen, pattern) => `(SELECT min(a.public_key) FROM ingest.public_aliases a
 WHERE a.route_kind='${kind}' AND a.${column}=${actor} AND a.public_key ~ '${pattern}' AND ${aliasAt("a", gen)})`;

const matchScope = `${contextSql}, matches AS (
 SELECT x.build_id,x.edition_id,x.dg,x.cg,m.id,m.revision_id,m.source_id,m.source_record_id,
  m.match_date,m.kickoff_at,m.status,m.round_label,m.round_number,m.leg_number,m.tie_key,
  st.stage_key,st.stage_type,st.sequence_no,grp.group_key,grp.name group_name,
  (m.stage_id IS NULL OR st.id IS NOT NULL) AND (m.group_id IS NULL OR grp.id IS NOT NULL) AS valid_context,
  ${publicAlias("match", "match_id", "m.id", "x.cg", "^m_[A-Za-z0-9]{6}$")} AS public_key
 FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id AND m.competition_season_id=x.edition_id
  AND m.publication_state='published' AND ${selected("m", "x.dg")}
 LEFT JOIN football.competition_stages st ON st.id=m.stage_id AND st.competition_season_id=x.edition_id AND ${selected("st", "x.dg")}
 LEFT JOIN football.competition_groups grp ON grp.id=m.group_id AND grp.stage_id=st.id AND grp.competition_season_id=x.edition_id AND ${selected("grp", "x.dg")}
), visible AS (
 SELECT * FROM matches WHERE CASE $2::text WHEN 'nations-a' THEN stage_key='A' WHEN 'nations-other' THEN stage_key IN ('B','C','D') ELSE true END
), sides AS (
 SELECT m.build_id,m.id match_id,mt.side,mt.team_id,mt.revision_id,
  coalesce(mt.participant_label,profile.display_name) label,
  profile.id profile_id,profile.image_asset_id asset_id,
  ${publicAlias("team", "team_id", "mt.team_id", "m.cg", "^t_[A-Za-z0-9]{6}$")} public_key
 FROM visible m JOIN football.match_teams mt ON mt.match_id=m.id AND mt.match_revision_id=m.revision_id AND ${selected("mt", "m.dg")}
 ${profileJoin("mt.team_id", "mt.source_id", "m.cg")}
)`;
const matchMetaSql = `/*orion:competition-match-meta*/ WITH ${matchScope}, sources AS (
 SELECT DISTINCT m.build_id,s.id::text source_id,s.name,ds.id::text dataset_id,ds.source_url url,ds.license_code license
 FROM visible m JOIN ingest.sources s ON s.id=m.source_id
 JOIN ingest.source_records r ON r.id=m.source_record_id AND r.source_id=s.id
 JOIN ingest.source_documents d ON d.id=r.document_id AND d.source_id=s.id
 JOIN ingest.source_datasets ds ON ds.id=d.dataset_id AND ds.source_id=s.id
), media AS (
 SELECT DISTINCT side.build_id,side.asset_id::text id,a.storage_key,a.content_sha256,a.content_type
 FROM sides side LEFT JOIN ingest.media_assets a ON a.id=side.asset_id WHERE side.asset_id IS NOT NULL
)
SELECT x.build_id::text,
 (SELECT count(*)::int FROM football.matches m WHERE m.competition_season_id=x.edition_id AND m.publication_state='published' AND ${selected("m", "x.dg")}) actual_count,
 (SELECT count(*)::int FROM analytics.match_summary s WHERE s.build_id=x.build_id) summary_count,
 (SELECT count(*)::int FROM matches m WHERE m.build_id=x.build_id) matched_count,
 (SELECT count(*)::int FROM visible m WHERE m.build_id=x.build_id) row_count,
 (SELECT count(*)::int FROM visible m WHERE m.build_id=x.build_id AND m.status IN ('finished','awarded')) result_count,
 (SELECT count(*)::int FROM visible m WHERE m.build_id=x.build_id AND nullif(btrim(m.round_label),'') IS NULL) unknown_rounds,
 NOT EXISTS(SELECT 1 FROM matches m WHERE m.build_id=x.build_id AND (NOT m.valid_context OR m.public_key IS NULL
  OR ($2::text IN ('nations-a','nations-other') AND (m.stage_key IS NULL OR m.stage_key NOT IN ('A','B','C','D') OR m.group_key IS NULL OR m.group_key !~ '^[1-4]$')))) valid_matches,
 (SELECT count(*)::int FROM sides s WHERE s.build_id=x.build_id) side_count,
 NOT EXISTS(SELECT 1 FROM sides s WHERE s.build_id=x.build_id AND (nullif(btrim(s.label),'') IS NULL
  OR ($2::text IN ('nations-a','nations-other') AND s.public_key IS NULL))) valid_sides,
 (SELECT jsonb_agg(to_jsonb(s) - 'build_id' ORDER BY s.source_id,s.dataset_id) FROM sources s WHERE s.build_id=x.build_id) sources,
 (SELECT jsonb_agg(to_jsonb(a) - 'build_id' ORDER BY a.id) FROM media a WHERE a.build_id=x.build_id) media
FROM x ORDER BY x.build_id`;

const matchBodySql = `/*orion:competition-match-body*/ WITH ${matchScope}
SELECT m.id::text match_id,m.public_key,to_char(m.match_date,'YYYY-MM-DD') date,
 to_char(m.kickoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') kickoff_at,m.status,
 m.round_label,m.round_number,m.leg_number,m.tie_key,m.stage_key,m.stage_type,m.group_key,m.group_name,
 h.label home_name,h.public_key home_id,h.asset_id::text home_asset,
 a.label away_name,a.public_key away_id,a.asset_id::text away_asset,
 (SELECT jsonb_object_agg(s.score_scope||':'||s.side,s.goals) FROM football.match_scores s
  WHERE s.match_id=m.id AND ((s.side='home' AND s.match_team_revision_id=h.revision_id) OR (s.side='away' AND s.match_team_revision_id=a.revision_id))
  AND ${selected("s", "m.dg")}) scores
FROM visible m JOIN sides h ON h.build_id=m.build_id AND h.match_id=m.id AND h.side='home'
JOIN sides a ON a.build_id=m.build_id AND a.match_id=m.id AND a.side='away'
ORDER BY m.sequence_no NULLS LAST,m.round_number NULLS LAST,m.match_date NULLS LAST,m.kickoff_at NULLS LAST,m.id
LIMIT ${maxMatches + 1}`;
const matchdaysBodySql = `/*orion:competition-days-body*/ WITH ${matchScope}
SELECT m.public_key,m.round_label,m.stage_type FROM visible m
ORDER BY m.sequence_no NULLS LAST,m.round_number NULLS LAST,m.match_date NULLS LAST,m.kickoff_at NULLS LAST,m.id
LIMIT ${maxMatches + 1}`;

const standingsScope = `${contextSql}, revisions AS (
 SELECT x.build_id,x.dg,x.cg,s.*,
 row_number() OVER(PARTITION BY x.build_id,s.source_record_id,s.competition_season_id,s.stage_id,s.group_id,s.group_label,s.scope
 ORDER BY s.data_revision DESC,s.recorded_from_gen DESC) AS rev
 FROM x JOIN football.standing_snapshots s ON s.competition_season_id=x.edition_id AND s.recorded_from_gen<=x.dg AND s.scope='overall'
), recent AS (
 SELECT r.*,dense_rank() OVER(PARTITION BY r.build_id,r.source_id,r.stage_id,r.group_id,
   CASE WHEN r.group_id IS NULL THEN r.group_label END,r.scope ORDER BY r.observed_at DESC,r.recorded_from_gen DESC) AS recency
 FROM revisions r WHERE r.rev=1
), tables AS (
 SELECT r.*,rec.ordinal,st.sequence_no,grp.group_key,
  coalesce(r.group_label,grp.name,st.name,'') table_name,src.name source_name,
  ds.source_url,ds.license_code,
  (r.stage_id IS NULL OR st.id IS NOT NULL) AND (r.group_id IS NULL OR grp.id IS NOT NULL) AND ds.id IS NOT NULL AS valid_context,
  count(*) OVER(PARTITION BY r.build_id,r.stage_id,r.group_id,CASE WHEN r.group_id IS NULL THEN r.group_label END) AS peers
 FROM recent r JOIN ingest.sources src ON src.id=r.source_id
 JOIN ingest.source_records rec ON rec.id=r.source_record_id AND rec.source_id=r.source_id
 LEFT JOIN ingest.source_documents doc ON doc.id=rec.document_id AND doc.source_id=r.source_id
 LEFT JOIN ingest.source_datasets ds ON ds.id=doc.dataset_id AND ds.source_id=r.source_id
 LEFT JOIN football.competition_stages st ON st.id=r.stage_id AND st.competition_season_id=r.competition_season_id AND ${selected("st", "r.dg")}
 LEFT JOIN football.competition_groups grp ON grp.id=r.group_id AND grp.stage_id=st.id AND grp.competition_season_id=r.competition_season_id AND ${selected("grp", "r.dg")}
 WHERE r.recency=1
), standing_values AS (
 SELECT t.id snapshot_id,r.team_id,r.rank,r.played,r.wins,r.draws,r.losses,r.goals_for,r.goals_against,r.points,r.points_adjustment,
  coalesce(r.source_label,profile.display_name) label,profile.image_asset_id asset_id,
  ${publicAlias("team", "team_id", "r.team_id", "t.cg", "^t_[A-Za-z0-9]{6}$")} public_key
 FROM tables t JOIN football.standing_rows r ON r.snapshot_id=t.id
 ${profileJoin("r.team_id", "t.source_id", "t.cg")}
)`;
const standingsMetaSql = `/*orion:competition-standing-meta*/ WITH ${standingsScope}, media AS (
 SELECT DISTINCT r.snapshot_id,r.asset_id::text id,a.storage_key,a.content_sha256,a.content_type
 FROM standing_values r LEFT JOIN ingest.media_assets a ON a.id=r.asset_id WHERE r.asset_id IS NOT NULL
)
SELECT t.id::text,t.table_name,t.source_id::text,t.source_name,t.source_url,t.license_code,t.valid_context,t.peers::text,
 (SELECT count(*)::int FROM standing_values r WHERE r.snapshot_id=t.id) row_count,
 NOT EXISTS(SELECT 1 FROM standing_values r WHERE r.snapshot_id=t.id AND (nullif(btrim(r.label),'') IS NULL OR
  r.points::text IN ('NaN','Infinity','-Infinity') OR r.points_adjustment::text IN ('NaN','Infinity','-Infinity'))) valid_rows,
 (SELECT jsonb_agg(to_jsonb(a)-'snapshot_id' ORDER BY a.id) FROM media a WHERE a.snapshot_id=t.id) media
FROM tables t ORDER BY t.ordinal NULLS LAST,t.sequence_no NULLS LAST,t.group_key,t.group_label,t.id LIMIT ${maxTables + 1}`;
const standingsBodySql = `/*orion:competition-standing-body*/ WITH ${standingsScope}
SELECT snapshot_id::text,public_key,label,asset_id::text,rank,played,wins,draws,losses,goals_for,goals_against,points::text,points_adjustment::text
FROM standing_values ORDER BY snapshot_id,rank NULLS LAST,team_id LIMIT ${maxRows + 1}`;

function publicUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? value : null;
  } catch { return null; }
}

function mediaMap(rows, origin) {
  const images = new Map();
  for (const row of rows ?? []) {
    const ext = row.storage_key?.split(".").at(-1), mime = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" }[ext];
    if (!mime || row.content_type !== mime || !/^[a-f0-9]{64}$/.test(row.content_sha256 ?? "") ||
      !immutableFile(row.storage_key) || !row.storage_key.endsWith(row.content_sha256 + "." + ext)) unavailable();
    try { images.set(row.id, cloudFrontObjectUrl(row.storage_key, origin)); }
    catch { unavailable(); }
  }
  return images;
}

function response(req, params, rows, witness, value) {
  const path = new URL(req.url).pathname;
  const orderedParams = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const version = rows.length === 1 ? rows[0].token : "proset." + digest(rows.map((r) => r.token).sort());
  const etag = `W/"orion-competitions1-${digest([contract, path, orderedParams, version, witness])}"`;
  const options = { etag, ttl: 15, maxBytes, headers: {
    "X-Orion-Competition-Contract": contract,
    ...(rows.length === 1 ? { "X-Orion-Representation": version } : {}),
  } };
  return req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)
    ? send(req, null, 200, options)
    : Promise.resolve().then(value).then((body) => send(req, body, 200, options));
}

function decimal(raw) {
  if (raw === null) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw) || typeof JSON.rawJSON !== "function") unavailable();
  return JSON.rawJSON(raw);
}

async function standings(req, params, publication, origin) {
  if (typeof JSON.rawJSON !== "function") unavailable();
  const cx = context([publication]);
  const tables = await query(standingsMetaSql, [cx]);
  const count = tables.reduce((n, t) => n + t.row_count, 0);
  if (!tables.length || tables.some((t) => !t.valid_context || !t.valid_rows || t.peers !== "1") ||
    new Set(tables.map((t) => t.source_id)).size !== 1) unavailable();
  if (tables.length > maxTables || count > maxRows) tooLarge();
  const images = mediaMap(tables.flatMap((t) => t.media ?? []), origin);
  const witness = [tables.map((t) => [t.id, t.row_count, t.source_id, t.source_name, publicUrl(t.source_url), t.license_code, t.media]), [...images]];
  return response(req, params, [publication], witness, async () => {
    const rows = await query(standingsBodySql, [cx]);
    if (rows.length !== count || rows.length > maxRows) unavailable();
    const byTable = new Map(tables.map((t) => [t.id, []]));
    for (const r of rows) {
      const target = byTable.get(r.snapshot_id);
      if (!target) unavailable();
      target.push({ name: r.label, teamId: r.public_key, imageUrl: images.get(r.asset_id) ?? null,
        position: r.rank, played: r.played, wins: r.wins, draws: r.draws, losses: r.losses,
        goalsFor: r.goals_for, goalsAgainst: r.goals_against,
        difference: r.goals_for === null || r.goals_against === null ? null : r.goals_for - r.goals_against,
        points: decimal(r.points), pointsAdjustment: decimal(r.points_adjustment) });
    }
    return { competition: publication.name, source: tables[0].source_name, tables: tables.map((t) => {
      const rows = byTable.get(t.id);
      if (rows.length !== t.row_count) unavailable();
      return { name: t.table_name, rows };
    }) };
  });
}

function scorePair(row, scope) {
  const scores = row.scores ?? {};
  const h = scope + ":home", a = scope + ":away";
  const home = scores[h] ?? null, away = scores[a] ?? null;
  if (!Object.hasOwn(scores, h) && !Object.hasOwn(scores, a)) return { state: "absent", pair: null, home, away };
  if (!Object.hasOwn(scores, h) || !Object.hasOwn(scores, a)) return { state: "partial", pair: null, home, away };
  if (home === null || away === null) return { state: "null", pair: null, home, away };
  return { state: "value", pair: [home, away], home, away };
}
function finalScore(row) {
  for (const scope of ["final_without_shootout", "after_extra_time", "regulation"]) {
    const observed = scorePair(row, scope);
    if (observed.state !== "absent") return observed;
  }
  return { state: "absent", pair: null, home: null, away: null };
}
const played = (row) => ["finished", "awarded"].includes(row.status);
const playoff = (type) => ["knockout", "playoff", "final"].includes(type) ? true : ["league", "group"].includes(type) ? false : null;
function rounds(rows) {
  return Object.fromEntries(rows.filter((r) => r.round_label?.trim()).map((r) => {
    const flag = playoff(r.stage_type);
    return [r.public_key, { name: r.round_label, ...(flag === null ? {} : { playoff: flag }) }];
  }));
}

function sourcesFor(meta) {
  const sources = (meta.sources ?? []).map((s) => ({ name: s.name, url: publicUrl(s.url), license: s.license }));
  if (sources.length === 1) return sources[0];
  return { name: null, url: null, license: null, ...(sources.length ? { contributors: sources } : {}) };
}

function matchEnvelope(action, args, edition, meta, images, rows) {
  const source = sourcesFor(meta);
  if (action === "matchdays") return { matches: rounds(rows), unknownMatches: meta.unknown_rounds };
  if (action === "native") {
    if (!edition.league_id) unavailable();
    return { matches: rows.map((r) => {
      const f = finalScore(r), flag = playoff(r.stage_type);
      return { id: r.public_key, season: edition.season, date: r.date, time_utc: r.kickoff_at, status: r.status,
        league: { id: edition.league_id, name: edition.name, season: edition.season },
        home_team: { id: r.home_id, name: r.home_name, image_url: images.get(r.home_asset) ?? null },
        away_team: { id: r.away_id, name: r.away_name, image_url: images.get(r.away_asset) ?? null },
        score_home: f.home, score_away: f.away, scoreState: f.state,
        round_name: r.round_label, ...(flag === null ? {} : { has_playoff: flag }), leg: r.leg_number, tieKey: r.tie_key };
    }), rounds: rounds(rows), source };
  }
  if (action === "open-cups") return { name: edition.name, season: edition.season, source, matches: rows.map((r) => {
    const scores = {};
    for (const [k, scope] of [["ht", "half_time"], ["ft", "regulation"], ["et", "after_extra_time"], ["p", "shootout"]]) {
      let observed = scorePair(r, scope);
      if (k === "ft" && observed.state === "absent") observed = scorePair(r, "final_without_shootout");
      if (observed.state !== "absent") scores[k] = observed.pair ?? (observed.home !== null || observed.away !== null ? [observed.home, observed.away] : null);
    }
    return { id: r.public_key, date: r.date, team1: r.home_name, team2: r.away_name, round: r.round_label, group: r.group_name,
      ...(Object.keys(scores).length ? { score: scores } : {}), status: r.status, scoreState: finalScore(r).state,
      leg: r.leg_number, tieKey: r.tie_key };
  }) };
  if (action === "table") return rows.filter((r) => played(r) === (args.kind === "results")).map((r) => {
    const observed = finalScore(r);
    return { id: r.public_key, home: r.home_name, away: r.away_name, date: r.date, round_name: r.round_label,
      status: r.status, ...(played(r) ? { ft_home: observed.home, ft_away: observed.away, scoreState: observed.state } : {}) };
  });
  return { competition: edition.slug, season: edition.season, source, matches: rows.map((r) => {
    const f = finalScore(r), extra = scorePair(r, "after_extra_time"), penalties = scorePair(r, "shootout").pair;
    const notes = [];
    if (extra.pair) notes.push("après prolongation");
    if (penalties) notes.push(`tirs au but ${penalties[0]} – ${penalties[1]}`);
    const nations = edition.slug === "nations-league";
    return { key: r.public_key, date: r.date, home: r.home_name, away: r.away_name, homeId: r.home_id, awayId: r.away_id,
      score: played(r) ? f.pair : null, scoreState: f.state, penalties: played(r) ? penalties : null, notes,
      status: played(r) ? "finished" : "scheduled", matchStatus: r.status,
      roundName: r.round_label, round: r.round_label, leg: r.leg_number, tieKey: r.tie_key,
      group: nations ? Number(r.group_key) : null, ...(nations ? { league: r.stage_key } : {}) };
  }) };
}

function indexEnvelope(rows, metadata) {
  const byCompetition = new Map();
  for (const r of rows) {
    const m = metadata.get(r.build_id);
    const entry = byCompetition.get(r.competition_id) ?? { name: r.name, folder: r.slug, country_code: r.country, native_id: r.league_id, editions: {} };
    if (entry.folder !== r.slug || entry.native_id !== r.league_id || Object.hasOwn(entry.editions, r.season)) unavailable();
    entry.editions[r.season] = { results: { rows: m.result_count }, fixtures: { rows: m.row_count - m.result_count } };
    byCompetition.set(r.competition_id, entry);
  }
  const entries = [...byCompetition.values()].sort((a, b) => a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0);
  return { schemaVersion: 1, meta: { source: "AWS" }, competitions: entries.map(({ native_id, ...r }) => {
    const season = Object.keys(r.editions).sort().at(-1);
    return { ...r, season, tables: r.editions[season] };
  }), native: entries.filter((r) => r.native_id !== null).map((r) => ({ id: r.native_id, name: r.name, country: r.country_code, seasons: Object.keys(r.editions).sort().reverse(), cupWorker: true })) };
}

export async function orionProCompetitionRoute(req, path, params, { mediaBase } = {}) {
  const spec = Object.hasOwn(routes, path) ? routes[path] : null;
  if (!spec) return null;
  const args = argumentsFor(params, spec);
  const action = spec.action === "snapshot" ? args.kind : spec.action;
  const pubs = await publications(args, action);
  if (action === "standings") return standings(req, params, pubs[0], mediaBase);
  if (action === "nations-results" && pubs[0]?.slug !== "nations-league") unavailable();
  const mode = action === "nations-results" ? "nations-other" : action === "openligadb" && pubs[0]?.slug === "nations-league" ? "nations-a" : "all";
  if (action === "native" && !pubs[0].league_id) unavailable();
  const cx = context(pubs);
  const metas = pubs.length ? await query(matchMetaSql, [cx, mode]) : [];
  const metadata = new Map(metas.map((m) => [m.build_id, m]));
  if (metadata.size !== pubs.length) unavailable();
  for (const m of metas) {
    if (m.actual_count > maxMatches || m.row_count > maxMatches) tooLarge();
    if (m.actual_count !== m.summary_count || m.summary_count !== m.matched_count ||
      m.side_count !== m.row_count * 2 || !m.valid_matches || !m.valid_sides || (mode !== "all" && !m.row_count)) unavailable();
  }
  const images = mediaMap(metas.flatMap((m) => m.media ?? []), mediaBase);
  const witness = [metas, [...images]];
  if (action === "index") {
    const value = indexEnvelope(pubs, metadata);
    return response(req, params, pubs, witness, () => value);
  }
  return response(req, params, pubs, witness, async () => {
    const rows = await query(action === "matchdays" ? matchdaysBodySql : matchBodySql, [cx, mode]);
    const meta = metas[0];
    if (rows.length > maxMatches || rows.length !== meta.row_count || new Set(rows.map((r) => r.public_key)).size !== rows.length) unavailable();
    return matchEnvelope(action, args, pubs[0], meta, images, rows);
  });
}
