import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { send } from "./relational-core.js";
import { cacheHeaders, matchesEtag } from "./cache-policy.js";

const representation = "match-statistics-v1";
const variant = "source:match-statistics-v1";
const releaseEnvironments = new Set([
  // STATISTICS_PUBLICATION.json hashes the exact composite release descriptor.
  "e5a436a88eb5f6aaa7338c91dcae57135fd3c47d16c6da2816a88436d9c3358a",
  // FULL_STATISTICS_PUBLICATION.json retains the same player-period component.
  "093759ba0cc39f72a1182bfb1a0d2db7d94ba3d1ec96171be57778cccbb49297",
]);
const route =
  /^\/api\/pitchapi\/matches\/(m_[A-Za-z0-9]{6})\/players(?:\/(p_[A-Za-z0-9]{6}))?(\/halves)?$/;
const token = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/;
const numberToken = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?$/;
const limits = { members: 120, periods: 8, metrics: 3000, bytes: 1024 * 1024 };
const periodLabels = new Map([
  ["full_match", "All"],
  ["first_half", "FirstHalf"],
  ["second_half", "SecondHalf"],
  ["extra_time_first_half", "ExtraFirstHalf"],
  ["extra_time_second_half", "ExtraSecondHalf"],
]);
const digest = (data) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const at = (a, g) =>
  `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) =>
  `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const retained = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const orderText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class StatisticsError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
const fail = (status, code, message) => {
  throw new StatisticsError(status, code, message);
};
const invalid = () =>
  fail(400, "STATISTICS_VERSION_INVALID", "Version de statistiques invalide.");
const unavailable = () =>
  fail(
    503,
    "STATISTICS_COHORT_UNAVAILABLE",
    "Ces statistiques ne sont pas disponibles pour cette publication.",
  );
const tooLarge = () =>
  fail(
    413,
    "PAGE_TOO_LARGE",
    "Ces statistiques dépassent la taille maximale de réponse.",
  );
const requireFact = (condition) => {
  if (!condition) unavailable();
};

function argumentsFor(params) {
  if (
    [...params].some(
      ([k, v]) => !["representation", "v"].includes(k) || v.length > 100,
    ) ||
    new Set(params.keys()).size !== params.size ||
    params.get("representation") !== representation
  )
    invalid();
  const v = params.get("v");
  const id = token.exec(v || "")?.[1];
  if (!id || BigInt(id) > 9223372036854775807n) invalid();
  return { v, id };
}

const publicationSql = `/*orion:match-statistics:publication-meta*/
 SELECT b.id::text build_id,b.competition_season_id::text edition_id,
        b.dataset_snapshot_id::text dataset_snapshot_id,d.generation::text dg,
        b.catalog_snapshot_id::text catalog_snapshot_id,c.generation::text cg,
        b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
        b.metrics_contract_version,b.transform_version
 FROM analytics.aggregation_builds b
 JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
 JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
 JOIN football.competition_seasons e ON e.id=b.competition_season_id
   AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
 WHERE b.id=$1::bigint AND b.status='ready'
   AND EXISTS (SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id
     AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id
     AND p.representation_version=b.representation_version)
 LIMIT 2`;

function publicToken(b) {
  return `pro1.${b.build_id}.${digest([
    b.build_id,
    b.edition_id,
    b.dataset_snapshot_id,
    b.dg,
    b.catalog_snapshot_id,
    b.cg,
    b.representation_version,
    b.code_content_sha256,
    b.dependencies_sha256,
    b.environment_sha256,
    b.metrics_contract_version,
    b.transform_version,
  ])}`;
}

async function published({ id, v }) {
  const rows = await query(publicationSql, [id]);
  if (rows.length !== 1 || publicToken(rows[0]) !== v) invalid();
  const b = rows[0];
  if (
    b.representation_version !== "summary-v1-shots-v1" ||
    b.transform_version !== "orion_pro_publish_native107_core_v1" ||
    b.metrics_contract_version !== "orion_pro_native107_core_v1" ||
    !releaseEnvironments.has(b.environment_sha256) ||
    ![b.dependencies_sha256, b.code_content_sha256].every((d) =>
      /^[a-f0-9]{64}$/.test(d || ""),
    )
  )
    fail(
      503,
      "STATISTICS_PUBLICATION_UNQUALIFIED",
      "Cette publication ne qualifie pas ces statistiques.",
    );
  return b;
}

const coverageSql = `/*orion:match-statistics:coverage-meta*/
 SELECT s.match_id::text,c.source_id::text,c.document_id::text,c.variant_key,c.contract_version,
        c.collection_state,c.coverage_state,c.observed_row_count,root.id::text AS root_record,
        member.player_revision,member.candidates
 FROM analytics.match_summary s
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id
   AND m.competition_season_id=$2::bigint AND m.publication_state='published'
   AND ${selected("m", "$3::bigint")}
 JOIN ingest.public_aliases a ON a.route_kind='match' AND a.match_id=s.match_id
   AND a.public_key=$5::text AND ${retained("a", "$4::bigint")}
   AND (a.match_revision_id IS NULL OR EXISTS (SELECT 1 FROM football.matches w WHERE
     w.revision_id=a.match_revision_id AND w.id=a.match_id AND w.competition_season_id=s.competition_season_id))
 LEFT JOIN ingest.match_coverage c ON c.match_id=s.match_id AND c.feature_code=$6::text
   AND c.is_canonical AND ${at("c", "$3::bigint")}
 LEFT JOIN ingest.source_records root ON root.id=c.source_record_id
   AND root.source_id=c.source_id AND root.document_id=c.document_id
   AND root.locator_kind='json_pointer' AND root.locator='/data' AND root.ordinal IS NULL
 LEFT JOIN LATERAL (
   SELECT min(target.revision_id)::text AS player_revision,count(*)::int AS candidates
   FROM (
     SELECT mp.revision_id FROM ingest.public_aliases a
     JOIN football.match_players mp ON mp.player_id=a.player_id AND mp.match_id=s.match_id
       AND mp.source_id=c.source_id AND mp.variant_key=c.variant_key||':'||c.feature_code
       AND mp.contract_version=$8::text AND ${retained("mp", "$3::bigint")}
     JOIN ingest.source_records sr ON sr.id=mp.source_record_id
       AND sr.source_id=c.source_id AND sr.document_id=c.document_id
     WHERE $7::text IS NOT NULL AND a.route_kind='player' AND a.public_key=$7::text
       AND ${retained("a", "$4::bigint")}
     LIMIT 2
   ) target
 ) member ON true
 WHERE s.build_id=$1::bigint AND s.competition_season_id=$2::bigint LIMIT 2`;

async function coverage(b, matchId, family, player) {
  const rows = await query(coverageSql, [
    b.build_id,
    b.edition_id,
    b.dg,
    b.cg,
    matchId,
    family,
    player,
    representation,
  ]);
  if (!rows.length)
    fail(
      404,
      "RESOURCE_NOT_FOUND",
      "Match introuvable dans cette publication.",
    );
  requireFact(rows.length === 1);
  const c = rows[0],
    n = c.observed_row_count;
  requireFact(
    c.contract_version === representation &&
      c.variant_key === variant &&
      c.root_record !== null &&
      c.source_id !== null &&
      c.document_id !== null,
  );
  const empty =
    c.collection_state === "empty" &&
    c.coverage_state === "empty_response" &&
    n === 0;
  const present =
    c.collection_state === "present" &&
    c.coverage_state === "available" &&
    Number.isInteger(n) &&
    n > 0;
  requireFact(empty || present);
  if (n > limits.members) tooLarge();
  if (player !== null) {
    if (c.candidates === 0)
      fail(
        404,
        "STATISTICS_PLAYER_NOT_FOUND",
        "Joueur introuvable dans ces statistiques.",
      );
    requireFact(present && c.candidates === 1 && c.player_revision !== null);
  }
  return { ...c, b, family, matchId, individual: player !== null, empty };
}

// All source columns are projected explicitly. The temporary JSON row text
// only bounds transfer size and is never used as the business representation.
async function payload(label, sql, values) {
  const rows = await query(
    `/*orion:match-statistics:payload:${label}*/
 WITH projected AS MATERIALIZED (${sql}), budget AS (
   SELECT coalesce(sum(octet_length(row_to_json(r)::text)),0)>${4 * limits.bytes} AS exceeded FROM projected r
 ) SELECT p.*,budget.exceeded FROM budget LEFT JOIN projected p ON NOT budget.exceeded`,
    values,
  );
  if (rows[0]?.exceeded) tooLarge();
  return rows.filter((r) => r.witness !== null);
}

const common = (c) => [
  c.match_id,
  c.source_id,
  c.document_id,
  c.variant_key + ":" + c.family,
  c.b.dg,
  representation,
];
const factScope = (
  a,
) => `${a}.match_id=$1::bigint AND ${a}.source_id=$2::bigint AND ${a}.variant_key=$4::text
 AND ${a}.contract_version=$6::text AND ${retained(a, "$5::bigint")}`;
const documentScope = (a) =>
  `${a}.source_id=$2::bigint AND ${a}.document_id=$3::bigint AND ${a}.locator_kind='json_pointer'`;
const alias = (kind, id, pattern, result) => `LEFT JOIN LATERAL (
 SELECT a.public_key FROM ingest.public_aliases a WHERE a.route_kind='${kind}'
  AND a.${kind}_id=${id} AND ${retained("a", "$8::bigint")} AND a.public_key ~ '^${pattern}_[A-Za-z0-9]{6}$'
 ORDER BY a.public_key LIMIT 1
 ) ${result} ON true`;

async function participants(c) {
  const rows = await payload(
    "members",
    `
 SELECT mp.revision_id::text AS witness,mp.player_id::text AS actor_id,mp.team_id::text AS team_id,
        r.locator,r.ordinal,r.external_key AS native_actor_key,pa.public_key AS player_public_id,ta.public_key AS team_public_id,
        pf.id::text AS profile_id,pf.display_name,pf.source_name_state,pf.source_image_url,pf.source_image_url_state,
        pf.raw_position_code,pf.raw_position_code_state,pf.raw_position_code_source_number::text
 FROM football.match_players mp
 JOIN football.match_teams t ON t.revision_id=mp.match_team_revision_id AND t.match_id=mp.match_id
   AND t.team_id=mp.team_id AND NOT t.is_deleted
 JOIN ingest.source_records r ON r.id=mp.source_record_id AND ${documentScope("r")} AND r.ordinal>=0
   AND r.locator=(CASE WHEN $9::text='players' THEN '/data/' ELSE '/data/players/' END)||r.ordinal::text
 LEFT JOIN LATERAL (
   SELECT p.id,p.display_name,p.source_name_state,p.source_image_url,p.source_image_url_state,
          p.raw_position_code,p.raw_position_code_state,p.raw_position_code_source_number
   FROM football.player_profile_versions p
   JOIN ingest.source_records pr ON pr.id=p.source_record_id AND ${documentScope("pr")}
     AND pr.locator=r.locator||'/player' AND pr.ordinal IS NULL AND pr.external_key=r.external_key
   WHERE p.id=mp.profile_version_id AND p.player_id=mp.player_id AND p.source_id=mp.source_id
     AND p.profile_context='match_statistics_observation_v1:'||pr.id::text
     AND p.variant_key='source:exact' AND p.source_external_id_state='value' AND ${retained("p", "$8::bigint")}
 ) pf ON true
 ${alias("player", "mp.player_id", "p", "pa")} ${alias("team", "mp.team_id", "t", "ta")}
 WHERE ${factScope("mp")} AND ($7::bigint IS NULL OR mp.revision_id=$7::bigint)
 LIMIT ${limits.members + 1}`,
    [...common(c), c.player_revision, c.b.cg, c.family],
  );
  if (rows.length > limits.members) tooLarge();
  requireFact(
    rows.length === (c.individual ? 1 : c.observed_row_count) &&
      new Set(rows.map((r) => r.actor_id)).size === rows.length,
  );
  rows.sort((a, b) => a.ordinal - b.ordinal);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    requireFact(
      (c.individual || r.ordinal === i) &&
        r.profile_id !== null &&
        r.player_public_id !== null &&
        r.team_public_id !== null &&
        r.native_actor_key !== null,
    );
  }
  return rows;
}

async function periods(c, ids) {
  const cap = ids.length * limits.periods;
  const rows = await payload(
    "periods",
    `
 SELECT f.revision_id::text AS witness,f.match_player_revision_id::text AS member,
        f.player_id::text AS actor_id,f.team_id::text AS team_id,f.period_code,f.period_definition_version,
        d.sequence_no,r.locator,r.ordinal,r.external_key
 FROM football.player_match_stats f
 JOIN football.periods d ON d.code=f.period_code AND d.definition_version=f.period_definition_version
   AND ${at("d", "$5::bigint")}
 JOIN ingest.source_records r ON r.id=f.source_record_id AND ${documentScope("r")}
 WHERE ${factScope("f")} AND f.match_player_revision_id=ANY($7::bigint[])
 LIMIT ${cap + 1}`,
    [...common(c), ids],
  );
  if (rows.length > cap) tooLarge();
  return rows;
}

async function metrics(c, ids) {
  const rows = await payload(
    "metrics",
    `
 SELECT f.revision_id::text AS witness,f.match_player_revision_id::text AS member,
        f.player_id::text AS actor_id,f.team_id::text AS team_id,f.period_code,f.period_definition_version,
        d.label,m.raw_key,r.locator,r.ordinal,r.external_key,
        f.value_kind,f.numeric_value::text,f.text_value,f.boolean_value,
        f.numerator::text,f.denominator::text,(f.numerator IS NOT DISTINCT FROM f.numeric_value) AS numerator_matches
 FROM football.player_match_metric_values f
 JOIN football.metric_definitions d ON d.code=f.metric_code AND d.definition_version=f.metric_definition_version
   AND d.scope='player' AND ${at("d", "$5::bigint")}
 JOIN football.source_metric_mappings m ON m.source_id=f.source_id AND m.family_code=$8::text
   AND m.metric_code=f.metric_code AND m.metric_definition_version=f.metric_definition_version
   AND m.mapping_version=$6::text AND ${at("m", "$5::bigint")}
 JOIN ingest.source_records r ON r.id=f.source_record_id AND ${documentScope("r")}
 WHERE ${factScope("f")} AND f.family_code='standard' AND f.match_player_revision_id=ANY($7::bigint[])
 LIMIT ${limits.metrics + 1}`,
    [...common(c), ids, c.family],
  );
  if (rows.length > limits.metrics) tooLarge();
  return rows;
}

function number(raw) {
  requireFact(
    typeof raw === "string" &&
      raw.length <= 150000 &&
      numberToken.test(raw) &&
      typeof JSON.rawJSON === "function",
  );
  return JSON.rawJSON(raw);
}

function property(out, key, state, value) {
  if (state === "value") {
    requireFact(typeof value === "string");
    out[key] = value;
  } else {
    requireFact(value === null && (state === "absent" || state === "null"));
    if (state === "null") out[key] = null;
  }
}

function player(row) {
  const out = { id: row.player_public_id };
  property(out, "name", row.source_name_state, row.display_name);
  property(out, "image_url", row.source_image_url_state, row.source_image_url);
  const state = row.raw_position_code_state;
  if (state === "number") {
    requireFact(typeof row.raw_position_code === "string");
    out.position_id = number(row.raw_position_code_source_number);
  } else {
    requireFact(row.raw_position_code_source_number === null);
    property(
      out,
      "position_id",
      state === "string" ? "value" : state,
      row.raw_position_code,
    );
  }
  return out;
}

function stat(row) {
  const out = {};
  switch (row.value_kind) {
    case "number":
      out.value = number(row.numeric_value);
      break;
    case "string":
      requireFact(typeof row.text_value === "string");
      out.value = row.text_value;
      break;
    case "boolean":
      requireFact(typeof row.boolean_value === "boolean");
      out.value = row.boolean_value;
      break;
    case "null":
      out.value = null;
      break;
    case "absent":
      break;
    default:
      unavailable();
  }
  if (row.numerator !== null || row.denominator !== null) {
    requireFact(row.value_kind === "number" && row.numerator_matches);
    out.total = number(row.denominator);
  }
  return { key: row.raw_key, stat: out };
}

function by(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const slot = key(row);
    if (!result.has(slot)) result.set(slot, []);
    result.get(slot).push(row);
  }
  return result;
}

const periodKey = (r) =>
  JSON.stringify([r.member, r.period_code, r.period_definition_version]);

function statGroups(rows, period, member) {
  if (!rows.length) return [];
  const stats = Object.create(null),
    keys = new Set();
  const ordinals = new Set();
  for (const row of [...rows].sort((a, b) => orderText(a.raw_key, b.raw_key))) {
    requireFact(
      row.actor_id === member.actor_id &&
        row.team_id === member.team_id &&
        Number.isInteger(row.ordinal) &&
        row.ordinal >= 0 &&
        row.ordinal < rows.length &&
        row.locator === `${period.locator}/metrics/${row.ordinal}` &&
        row.raw_key === row.external_key &&
        typeof row.label === "string" &&
        row.label.length > 0 &&
        !ordinals.has(row.ordinal) &&
        !keys.has(row.raw_key) &&
        !Object.hasOwn(stats, row.label),
    );
    ordinals.add(row.ordinal);
    keys.add(row.raw_key);
    stats[row.label] = stat(row);
  }
  return [{ key: "top_stats", stats }];
}

function periodRows(c, rows, member, metricGroups) {
  requireFact(rows.length > 0);
  if (rows.length > limits.periods) tooLarge();
  const full = c.family === "players";
  requireFact(
    !full || (rows.length === 1 && rows[0].period_code === "full_match"),
  );
  const slots = new Set(),
    codes = new Set(),
    order = new Set();
  const exact = [];
  for (const r of rows) {
    requireFact(
      r.actor_id === member.actor_id &&
        r.team_id === member.team_id &&
        periodLabels.has(r.period_code) &&
        Number.isInteger(r.sequence_no) &&
        !codes.has(r.period_code) &&
        !order.has(r.sequence_no),
    );
    if (full)
      requireFact(r.locator === member.locator && r.ordinal === member.ordinal);
    else {
      requireFact(
        Number.isInteger(r.ordinal) &&
          r.ordinal >= 0 &&
          r.ordinal < rows.length &&
          !slots.has(r.ordinal) &&
          r.locator === `${member.locator}/periods/${r.ordinal}` &&
          r.external_key === r.period_code,
      );
      slots.add(r.ordinal);
    }
    codes.add(r.period_code);
    order.add(r.sequence_no);
    exact.push({
      order: r.sequence_no,
      period: periodLabels.get(r.period_code),
      stats: statGroups(metricGroups.get(periodKey(r)) ?? [], r, member),
    });
  }
  return exact
    .sort((a, b) => a.order - b.order)
    .map(({ period, stats }) => ({ period, stats }));
}

async function read(c) {
  if (c.empty)
    return c.family === "players" ? [] : { match_id: c.matchId, players: [] };
  const members = await participants(c),
    ids = members.map((r) => r.witness);
  const periodFacts = await periods(c, ids);
  const metricFacts = await metrics(c, ids);
  const memberSet = new Set(ids),
    periodSet = new Set(periodFacts.map(periodKey));
  requireFact(
    periodFacts.every((r) => memberSet.has(r.member)) &&
      metricFacts.every((r) => periodSet.has(periodKey(r))),
  );
  const p = by(periodFacts, (r) => r.member),
    m = by(metricFacts, periodKey);
  const rows = members.map((row) => {
    const observed = periodRows(c, p.get(row.witness) ?? [], row, m);
    const core = { player: player(row), team_id: row.team_public_id };
    return c.family === "players"
      ? { ...core, stats: observed[0].stats }
      : { ...core, periods: observed };
  });
  if (c.family === "players") return c.individual ? rows[0] : rows;
  return c.individual
    ? { match_id: c.matchId, ...rows[0] }
    : { match_id: c.matchId, players: rows };
}

function respond(req, v, etag, data) {
  return send(req, data, 200, {
    etag,
    maxBytes: limits.bytes,
    headers: {
      ...cacheHeaders(31536000, 0, { immutable: true }),
      "X-Orion-Representation": v,
      "X-Orion-Statistics-Representation": representation,
    },
  });
}

/** Four existing player/period forms with the separately certified typed cohort. */
export async function orionProMatchStatisticsRoute(req, path, params) {
  const hit = route.exec(path);
  if (!hit) return null;
  const [, matchId, alias, halves] = hit,
    family = halves ? "player_halves" : "players";
  try {
    if (req.method !== "GET" && req.method !== "HEAD")
      return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
        headers: { Allow: "GET, HEAD" },
      });
    const args = argumentsFor(params);
    const b = await published(args);
    const c = await coverage(b, matchId, family, alias ?? null);
    const sorted = [...params].sort(([a], [b]) => orderText(a, b));
    const etag = `W/"orion-statistics1-${digest([representation, path, sorted, args.v])}"`;
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), etag)
    )
      return respond(req, args.v, etag, null);
    return respond(req, args.v, etag, {
      data: await read(c),
      representation: {
        version: representation,
        sourceToken: args.v,
        family,
        origin: "published-player-period-metrics",
      },
    });
  } catch (error) {
    if (!(error instanceof StatisticsError)) throw error;
    return send(
      req,
      {
        ok: false,
        available: false,
        error: { code: error.code, message: error.message },
      },
      error.status,
    );
  }
}
