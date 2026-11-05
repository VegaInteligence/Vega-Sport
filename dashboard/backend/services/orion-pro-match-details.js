import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { send } from "./relational-core.js";
import { cacheHeaders, matchesEtag } from "./cache-policy.js";

const representation = "match-native-v1";
const legacyRepresentation = "summary-v1-shots-v1";
const modelBindings = new Map([
  [
    "orion_pro_publish_native107_v1/orion_pro_native107_v1",
    {
      model: "f516804f6e2381b5e55763860b6470127b88a567006973afa79c0a9f5f0d9ae3",
      core: false,
    },
  ],
  [
    "orion_pro_publish_native107_core_v1/orion_pro_native107_core_v1",
    {
      model: "e06ba703bdebc3f8e7653521837f9e413b7147f4cb810fe1dc40f4668ea5f0e3",
      core: true,
    },
  ],
]);
const pathPattern =
  /^\/api\/pitchapi\/matches\/(m_[A-Za-z0-9]{6})(?:\/(momentum|events|lineups|h2h|stats))?$/;
const sourcePattern = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/;
const nativePattern = /^native1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/;
const hex = /^[a-f0-9]{64}$/;
const numeric = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?$/;
const maxBody = 1024 * 1024;
const maxTransferPerProjection = 4 * maxBody;
const limits = {
  match: 1,
  momentum: 2000,
  events: 1000,
  h2h: 500,
  lineups: 2,
  stats: 16,
};
const membersLimit = 80;
const groupLimit = 128;
const itemLimit = 1000;
const unrecordedCore = ["referee", "has_playoff", "league.image_url"];
const knownStates = new Set(["absent", "null", "value"]);
const objectStates = new Set(["absent", "null", "object"]);
const digest = (data) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const at = (a, g) =>
  `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) =>
  `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;

class NativeMatchError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}

function badVersion() {
  throw new NativeMatchError(
    400,
    "NATIVE_MATCH_VERSION_INVALID",
    "Version native du match invalide.",
  );
}

function unavailable() {
  throw new NativeMatchError(
    503,
    "NATIVE_MATCH_UNAVAILABLE",
    "Ce détail natif n’est pas disponible pour cette publication.",
  );
}

function missingCore(fields = unrecordedCore) {
  throw new NativeMatchError(
    503,
    "NATIVE_CORE_FIELDS_UNRECORDED",
    "Des champs natifs du match ne sont pas enregistrés.",
    fields,
  );
}

function tooLarge() {
  throw new NativeMatchError(
    413,
    "PAGE_TOO_LARGE",
    "Ce détail dépasse la taille maximale de réponse.",
  );
}

function requireFact(condition) {
  if (!condition) unavailable();
}

function one(rows) {
  requireFact(rows.length === 1);
  return rows[0];
}

function tokenId(token, pattern) {
  const match = pattern.exec(token || "");
  return match && BigInt(match[1]) <= 9223372036854775807n ? match[1] : null;
}

function argumentsFor(params) {
  const allowed = new Set(["representation", "v", "nv"]);
  if (
    [...params].some(
      ([name, value]) => !allowed.has(name) || value.length > 100,
    ) ||
    new Set(params.keys()).size !== params.size
  )
    badVersion();
  const v = params.get("v"),
    nv = params.get("nv");
  const buildId = tokenId(v, sourcePattern);
  if (
    params.get("representation") !== representation ||
    !buildId ||
    (nv !== null && tokenId(nv, nativePattern) !== buildId)
  )
    badVersion();
  return { v, nv, buildId };
}

const buildSql = `/*orion:native-match:build-meta*/
 SELECT b.id::text build_id,b.competition_season_id::text edition_id,
        b.dataset_snapshot_id::text dataset_snapshot_id,d.generation::text dataset_generation,
        b.catalog_snapshot_id::text catalog_snapshot_id,c.generation::text catalog_generation,
        b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
        b.metrics_contract_version,b.transform_version
 FROM analytics.aggregation_builds b
 JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
 JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
 JOIN football.competition_seasons e ON e.id=b.competition_season_id
   AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
 WHERE b.id=$1::bigint AND b.status='ready'
   AND EXISTS (SELECT 1 FROM analytics.publication_versions p
     WHERE p.build_id=b.id AND p.competition_season_id=b.competition_season_id
       AND p.catalog_snapshot_id=b.catalog_snapshot_id AND p.representation_version=b.representation_version)
 LIMIT 2`;

function sourceToken(row) {
  return `pro1.${row.build_id}.${digest([
    row.build_id,
    row.edition_id,
    row.dataset_snapshot_id,
    row.dataset_generation,
    row.catalog_snapshot_id,
    row.catalog_generation,
    row.representation_version,
    row.code_content_sha256,
    row.dependencies_sha256,
    row.environment_sha256,
    row.metrics_contract_version,
    row.transform_version,
  ])}`;
}

async function publication({ buildId, v, nv }) {
  const rows = await query(buildSql, [buildId]);
  if (rows.length !== 1 || sourceToken(rows[0]) !== v) badVersion();
  const b = rows[0];
  const binding = modelBindings.get(
    `${b.transform_version}/${b.metrics_contract_version}`,
  );
  if (
    !binding ||
    b.representation_version !== legacyRepresentation ||
    ![b.dependencies_sha256, b.environment_sha256, b.code_content_sha256].every(
      (value) => hex.test(value || ""),
    )
  ) {
    if (nv !== null) badVersion();
    unavailable();
  }
  const native = `native1.${buildId}.${digest([
    "orion-match-native-token-v1",
    representation,
    binding.model,
    v,
    b.build_id,
    b.dataset_generation,
    b.catalog_generation,
    b.dependencies_sha256,
    b.transform_version,
    b.metrics_contract_version,
    b.environment_sha256,
    b.code_content_sha256,
  ])}`;
  if (nv !== null && nv !== native) badVersion();
  return { ...b, binding, v, native };
}

const parentFields = [
  "match_id",
  "source_id",
  "feature_code",
  "variant_key",
  "recorded_from_gen",
];
const parent = (a) =>
  `(${parentFields.map((key) => `${a}.${key}`).join(",")})=($1::bigint,$2::bigint,$3::text,$4::text,$5::bigint)`;
const lineage = (a, source, document, locator, ordinal = "NULL::int") =>
  `${a}.source_id=${source} AND ${a}.document_id=${document}
    AND ${a}.locator_kind='json_pointer' AND ${a}.locator=${locator}
    AND ${a}.ordinal IS NOT DISTINCT FROM ${ordinal}`;

async function matchMetadata(b, id, feature) {
  const core = feature === "match" && b.binding.core;
  const rows = await query(
    `/*orion:native-match:match-meta*/
 SELECT s.match_id::text,s.home_team_id::text,s.away_team_id::text,
        c.source_id::text,c.feature_code,c.variant_key,c.recorded_from_gen::text,
        c.match_revision_id::text,c.document_id::text,c.source_record_id::text,
        c.contract_version,c.coverage_state,c.collection_state,c.observed_row_count,
        c.source_match_id_state,c.source_home_team_state,c.source_away_team_state,
        c.source_home_team_profile_version_id::text,c.source_away_team_profile_version_id::text
        ${core ? ",o.source_referee_state,o.source_has_playoff_state,o.source_league_image_url_state" : ""}
 FROM analytics.match_summary s
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id
   AND m.competition_season_id=$2::bigint AND m.publication_state='published'
   AND ${selected("m", "$3::bigint")}
 JOIN ingest.public_aliases a ON a.route_kind='match' AND a.match_id=s.match_id
   AND a.public_key=$5::text AND ${at("a", "$4::bigint")} AND NOT a.is_deleted
   AND (a.match_revision_id IS NULL OR EXISTS (
     SELECT 1 FROM football.matches anchor WHERE anchor.revision_id=a.match_revision_id
       AND anchor.id=a.match_id AND anchor.competition_season_id=s.competition_season_id))
 LEFT JOIN ingest.match_coverage c ON c.match_id=s.match_id AND c.feature_code=$6::text
   AND c.is_canonical AND ${at("c", "$3::bigint")}
 ${
   core
     ? `LEFT JOIN football.match_observation_details o ON o.source_record_id=c.source_record_id
   AND o.match_id=s.match_id AND o.match_revision_id=c.match_revision_id
   AND o.recorded_from_gen=c.recorded_from_gen`
     : ""
 }
 WHERE s.build_id=$1::bigint AND s.competition_season_id=$2::bigint LIMIT 2`,
    [
      b.build_id,
      b.edition_id,
      b.dataset_generation,
      b.catalog_generation,
      id,
      feature,
    ],
  );
  if (!rows.length)
    throw new NativeMatchError(
      404,
      "NATIVE_MATCH_NOT_FOUND",
      "Match introuvable dans cette publication.",
    );
  const c = one(rows);
  if (feature === "match" && !b.binding.core) missingCore();
  requireFact(
    c.contract_version === representation &&
      c.variant_key === "source:exact" &&
      c.document_id !== null &&
      c.source_record_id !== null &&
      c.match_revision_id !== null &&
      knownStates.has(c.source_match_id_state) &&
      objectStates.has(c.source_home_team_state) &&
      objectStates.has(c.source_away_team_state),
  );
  if (core) {
    const states = [
      c.source_referee_state,
      c.source_has_playoff_state,
      c.source_league_image_url_state,
    ];
    const unknownFields = unrecordedCore.filter(
      (_, index) => !knownStates.has(states[index]),
    );
    if (unknownFields.length) missingCore(unknownFields);
  }
  const count = c.observed_row_count,
    state = c.collection_state;
  const goodCount =
    (state === "present" && Number.isInteger(count) && count > 0) ||
    (state === "empty" && count === 0) ||
    ((state === "null" || state === "absent") && count === null);
  requireFact(
    goodCount &&
      c.coverage_state === (state === "empty" ? "empty_response" : "available"),
  );
  if (count > limits[feature]) tooLarge();
  if (feature === "lineups" || feature === "match")
    requireFact(state === "present" && count === limits[feature]);
  return { ...c, b, key: parentFields.map((key) => c[key]) };
}

function exactNumber(value) {
  requireFact(
    typeof value === "string" && value.length <= 150000 && numeric.test(value),
  );
  return JSON.rawJSON(value);
}

function scalar(out, key, state, value, type) {
  if (state === "absent" || state === "null") {
    requireFact(value === null);
    if (state === "null") out[key] = null;
  } else {
    requireFact(
      state === "value" &&
        typeof value === type &&
        (type !== "number" || Number.isSafeInteger(value)),
    );
    out[key] = value;
  }
}

function numberField(out, key, state, value) {
  if (state === "value") out[key] = exactNumber(value);
  else scalar(out, key, state, value, "string");
}

function field(out, row, key, column, stateColumn, type = "string") {
  scalar(out, key, row[stateColumn], row[column], type);
}

function fields(out, row, definitions) {
  for (const [key, column, state, type] of definitions)
    field(out, row, key, column, state, type);
  return out;
}

function observedObject(out, key, state, build) {
  requireFact(objectStates.has(state));
  if (state === "null") out[key] = null;
  if (state === "object") out[key] = build();
}

function declaredArray(out, key, state, count, rows, convert) {
  requireFact(rows.length === (count ?? 0));
  if (state === "present" || state === "empty") {
    requireFact(state === "present" ? count > 0 : count === 0);
    out[key] = rows.map(convert);
  } else {
    requireFact((state === "absent" || state === "null") && count === null);
    if (state === "null") out[key] = null;
  }
}

function ordered(rows, slot, convert) {
  return [...rows]
    .sort((a, b) => a[slot] - b[slot])
    .map((row, index) => {
      requireFact(row[slot] === index);
      return convert(row, index);
    });
}

function collection(data, key, c, rows, slot, convert) {
  const items = ordered(rows, slot, convert);
  declaredArray(
    data,
    key,
    c.collection_state,
    c.observed_row_count,
    items,
    (value) => value,
  );
}

function bucket(rows, key) {
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row[key])) result.set(row[key], []);
    result.get(row[key]).push(row);
  }
  return result;
}

// Limit the wire volume of a typed projection before shipping it to the API.
// The SELECTs project approved columns only; no source body or JSON column is
// read. The budget aggregate measures the ephemeral SQL row representation.
async function payload(label, sql, values) {
  const rows = await query(
    `/*orion:native-match:payload:${label}*/
 WITH projected AS MATERIALIZED (${sql}), budget AS (
   SELECT coalesce(sum(octet_length(row_to_json(p)::text)),0)>${maxTransferPerProjection} AS exceeded FROM projected p
 ) SELECT p.*,budget.exceeded FROM budget LEFT JOIN projected p ON NOT budget.exceeded`,
    values,
  );
  if (rows[0]?.exceeded) tooLarge();
  return rows.filter((row) => row.witness !== null);
}

function bounded(rows, limit) {
  if (rows.length > limit) tooLarge();
  return rows;
}

const profileColumns = (a, prefix, player = false) => `
 ${a}.id::text AS ${prefix}_profile,${a}.external_key AS ${prefix}_external_key,
 ${a}.source_external_id_state AS ${prefix}_id_state,${a}.display_name AS ${prefix}_name,
 ${a}.source_name_state AS ${prefix}_name_state,${a}.source_image_url AS ${prefix}_image,
 ${a}.source_image_url_state AS ${prefix}_image_state${
   player
     ? `,
 ${a}.raw_position_code AS ${prefix}_position,${a}.raw_position_code_state AS ${prefix}_position_state,
 ${a}.raw_position_code_source_number::text AS ${prefix}_position_number`
     : ""
 }`;

const profileJoin = ({
  alias,
  player,
  physical,
  actor,
  source,
  document,
  locator,
  ordinal,
  cg,
}) => `
 LEFT JOIN LATERAL (
   SELECT pf.id,pf.display_name,pf.source_external_id_state,pf.source_name_state,
          pf.source_image_url,pf.source_image_url_state,sr.external_key${player ? ",pf.raw_position_code,pf.raw_position_code_state,pf.raw_position_code_source_number" : ""}
   FROM football.${player ? "player" : "team"}_profile_versions pf
   JOIN ingest.source_records sr ON sr.id=pf.source_record_id AND ${lineage("sr", source, document, locator, ordinal)}
   WHERE pf.id=${physical} AND pf.${player ? "player" : "team"}_id=${actor} AND pf.source_id=${source}
     AND pf.profile_context='native_match_observation_v1:'||sr.id::text AND pf.variant_key='source:exact'
     AND ${at("pf", cg)} AND NOT pf.is_deleted
 ) ${alias} ON true`;

function codeField(out, key, state, text, number) {
  if (state === "number") {
    requireFact(typeof text === "string");
    numberField(out, key, "value", number);
  } else {
    requireFact(number === null);
    scalar(out, key, state === "string" ? "value" : state, text, "string");
  }
}

function profile(row, prefix, withPosition = false) {
  requireFact(row[`${prefix}_profile`] !== null);
  const out = fields({}, row, [
    ["id", `${prefix}_external_key`, `${prefix}_id_state`],
    ["name", `${prefix}_name`, `${prefix}_name_state`],
    ["image_url", `${prefix}_image`, `${prefix}_image_state`],
  ]);
  if (withPosition)
    codeField(
      out,
      "position_id",
      row[`${prefix}_position_state`],
      row[`${prefix}_position`],
      row[`${prefix}_position_number`],
    );
  return out;
}

async function rootData(c) {
  const [h, a] = ["home", "away"].map((side) =>
    profileJoin({
      alias: side,
      physical: side === "home" ? "$5::bigint" : "$6::bigint",
      actor: side === "home" ? "$7::bigint" : "$8::bigint",
      source: "$2::bigint",
      document: "$3::bigint",
      locator: `'/data/${side}_team'`,
      cg: "$4::bigint",
    }),
  );
  const row = one(
    await payload(
      "root",
      `
 SELECT r.id witness,r.external_key,${profileColumns("home", "home")},${profileColumns("away", "away")}
 FROM ingest.source_records r ${h} ${a}
 WHERE r.id=$1::bigint AND ${lineage("r", "$2::bigint", "$3::bigint", "'/data'")}`,
      [
        c.source_record_id,
        c.source_id,
        c.document_id,
        c.b.catalog_generation,
        c.source_home_team_profile_version_id,
        c.source_away_team_profile_version_id,
        c.home_team_id,
        c.away_team_id,
      ],
    ),
  );
  const data = {};
  scalar(
    data,
    c.feature_code === "match" ? "id" : "match_id",
    c.source_match_id_state,
    row.external_key,
    "string",
  );
  for (const side of ["home", "away"]) {
    observedObject(data, side + "_team", c[`source_${side}_team_state`], () =>
      profile(row, side),
    );
  }
  return data;
}

const eventFields = [
  ["id", "source_event_id", "source_event_id_state"],
  ["event_type", "event_type", "source_event_type_state"],
  ["period", "source_period_label", "source_period_label_state"],
  ["minute", "minute", "source_minute_state", "number"],
  ["minute_added", "minute_added", "source_minute_added_state", "number"],
  ["second", "second", "source_second_state", "number"],
  ["is_penalty", "is_penalty", "source_is_penalty_state", "boolean"],
  ["is_own_goal", "is_own_goal", "source_is_own_goal_state", "boolean"],
  ["score_home", "score_home", "source_score_home_state", "number"],
  ["score_away", "score_away", "source_score_away_state", "number"],
  ["team_id", "team_external_key", "source_team_id_state"],
];

function projection(alias, columns) {
  return [...new Set(columns)].map((column) => `${alias}.${column}`).join(",");
}

const mappedColumns = (alias, definitions, excluded = []) =>
  projection(
    alias,
    definitions
      .flatMap(([, value, state]) => [value, state])
      .filter((name) => !excluded.includes(name)),
  );

async function events(c, data) {
  const joins = ["player", "sub_in_player"]
    .map((actor) =>
      profileJoin({
        alias: actor,
        player: true,
        physical: `e.${actor}_profile_version_id`,
        actor: `e.${actor}_id`,
        source: "$2::bigint",
        document: "$6::bigint",
        locator: `r.locator||'/${actor}'`,
        cg: "$7::bigint",
      }),
    )
    .join(" ");
  const rows = bounded(
    await payload(
      "events",
      `
 SELECT r.id witness,r.external_key,e.source_ordinal,e.source_player_state,e.source_sub_in_player_state,
        ${mappedColumns("e", eventFields, ["team_external_key"])},team.external_key AS team_external_key,
        ${profileColumns("player", "player", true)},${profileColumns("sub_in_player", "sub_in_player", true)}
 FROM football.match_events e
 JOIN ingest.source_records r ON r.id=e.source_record_id
   AND ${lineage("r", "$2::bigint", "$6::bigint", "'/data/events/'||e.source_ordinal::text", "e.source_ordinal")}
 LEFT JOIN ingest.source_records team ON ${lineage("team", "$2::bigint", "$6::bigint", "r.locator||'/team_id'")}
 ${joins}
 WHERE ${parent("e")} AND e.match_revision_id=$8::bigint LIMIT ${limits.events + 1}`,
      [...c.key, c.document_id, c.b.catalog_generation, c.match_revision_id],
    ),
    limits.events,
  );
  collection(data, "events", c, rows, "source_ordinal", (row) => {
    requireFact(row.external_key === row.source_event_id);
    const item = fields({}, row, eventFields);
    for (const actor of ["player", "sub_in_player"]) {
      observedObject(item, actor, row[`source_${actor}_state`], () =>
        profile(row, actor, true),
      );
    }
    return item;
  });
}

const lineupFields = [
  ["formation", "formation", "source_formation_state"],
  ["confirmed", "confirmed", "source_confirmed_state", "boolean"],
  ["lineup_type", "source_lineup_type", "source_lineup_type_state"],
];
const lineupParent = `l.match_id=$1::bigint AND l.source_id=$2::bigint AND l.source_feature_code=$3::text
 AND l.variant_key=$4::text AND l.source_collection_from_gen=$5::bigint AND l.recorded_from_gen=$5::bigint
 AND ${at("l", "$7::bigint")} AND NOT l.is_deleted`;

async function lineups(c, data) {
  const common = [...c.key, c.document_id, c.b.dataset_generation];
  const headers = bounded(
    await payload(
      "lineup-headers",
      `
 SELECT r.id witness,l.revision_id::text AS header_id,t.side,l.team_id::text,
        ${mappedColumns("l", lineupFields)},l.source_object_state,
        l.source_coach_state,l.source_coach_name,l.source_coach_name_state,
        l.source_starters_state,l.source_starters_count,l.source_subs_state,l.source_subs_count
 FROM football.match_lineups l
 JOIN football.match_teams t ON t.revision_id=l.match_team_revision_id AND t.team_id=l.team_id AND t.match_id=l.match_id
 JOIN ingest.source_records r ON r.id=l.source_record_id
   AND ${lineage("r", "$2::bigint", "$6::bigint", "'/data/'||t.side")}
 WHERE ${lineupParent} LIMIT 3`,
      common,
    ),
    limits.lineups,
  );
  requireFact(
    headers.length === limits.lineups &&
      new Set(headers.map((row) => row.side)).size === limits.lineups,
  );
  if (
    headers.reduce(
      (sum, row) =>
        sum + (row.source_starters_count ?? 0) + (row.source_subs_count ?? 0),
      0,
    ) > membersLimit
  )
    tooLarge();

  const memberLocator = `hr.locator||CASE p.squad_status WHEN 'starter' THEN '/starters/' ELSE '/subs/' END||r.ordinal::text`;
  const playerJoin = profileJoin({
    alias: "actor",
    player: true,
    physical: "p.profile_version_id",
    actor: "p.player_id",
    source: "$2::bigint",
    document: "$6::bigint",
    locator: memberLocator,
    ordinal: "r.ordinal",
    cg: "$8::bigint",
  });
  const members = bounded(
    await payload(
      "lineup-members",
      `
 SELECT r.id witness,r.ordinal,p.lineup_revision_id::text AS header_id,p.squad_status,
        p.raw_position_code,p.raw_position_code_state,p.raw_position_code_source_number::text,
        p.shirt_number,p.shirt_number_state,p.shirt_number_source_number::text,
        p.is_captain,p.source_is_captain_state,p.raw_pitch_x::text,p.raw_pitch_y::text,
        p.source_raw_pitch_x_state,p.source_raw_pitch_y_state,${profileColumns("actor", "actor")}
 FROM football.match_lineups l
 JOIN ingest.source_records hr ON hr.id=l.source_record_id
 JOIN football.match_players p ON p.lineup_revision_id=l.revision_id AND p.match_id=l.match_id AND p.team_id=l.team_id
   AND p.source_id=l.source_id AND p.match_team_revision_id=l.match_team_revision_id
   AND p.recorded_from_gen=l.recorded_from_gen AND ${at("p", "$7::bigint")} AND NOT p.is_deleted
 JOIN ingest.source_records r ON r.id=p.source_record_id
   AND ${lineage("r", "$2::bigint", "$6::bigint", memberLocator, "r.ordinal")}
 ${playerJoin}
 WHERE ${lineupParent} LIMIT ${membersLimit + 1}`,
      [...common, c.b.catalog_generation],
    ),
    membersLimit,
  );
  const byHeader = bucket(members, "header_id");
  requireFact(
    [...byHeader.keys()].every((id) =>
      headers.some((row) => row.header_id === id),
    ),
  );
  for (const row of headers) {
    requireFact(
      (row.side === "home" || row.side === "away") &&
        c[`${row.side}_team_id`] === row.team_id,
    );
    const lineup = fields({}, row, lineupFields);
    observedObject(lineup, "coach", row.source_coach_state, () =>
      fields({}, row, [
        ["name", "source_coach_name", "source_coach_name_state"],
      ]),
    );
    const slots = bucket(byHeader.get(row.header_id) ?? [], "squad_status");
    requireFact(
      [...slots.keys()].every(
        (slot) => slot === "starter" || slot === "substitute",
      ),
    );
    for (const [key, squad] of [
      ["starters", "starter"],
      ["subs", "substitute"],
    ]) {
      const orderedMembers = ordered(
        slots.get(squad) ?? [],
        "ordinal",
        (member) => {
          requireFact(member.actor_profile !== null);
          const item = fields({}, member, [
            ["player_id", "actor_external_key", "actor_id_state"],
            ["name", "actor_name", "actor_name_state"],
            ["is_captain", "is_captain", "source_is_captain_state", "boolean"],
          ]);
          codeField(
            item,
            "position_id",
            member.raw_position_code_state,
            member.raw_position_code,
            member.raw_position_code_source_number,
          );
          codeField(
            item,
            "shirt_number",
            member.shirt_number_state,
            member.shirt_number,
            member.shirt_number_source_number,
          );
          numberField(
            item,
            "pitch_x",
            member.source_raw_pitch_x_state,
            member.raw_pitch_x,
          );
          numberField(
            item,
            "pitch_y",
            member.source_raw_pitch_y_state,
            member.raw_pitch_y,
          );
          return item;
        },
      );
      declaredArray(
        lineup,
        key,
        row[`source_${key}_state`],
        row[`source_${key}_count`],
        orderedMembers,
        (item) => item,
      );
    }
    if (row.source_object_state !== "object")
      requireFact(Object.keys(lineup).length === 0);
    observedObject(data, row.side, row.source_object_state, () => lineup);
  }
}

const recordProjection = (a) =>
  `${a}.id::text AS witness,${a}.ordinal,${a}.locator`;
const nativeRecord = (a) =>
  `${a}.source_id=$2::bigint AND ${a}.document_id=$6::bigint AND ${a}.locator_kind='json_pointer'`;

function metricJoin(side, short) {
  return `JOIN football.team_match_metric_values ${short}
    ON ${short}.revision_id=i.${side}_metric_revision_id AND ${short}.match_id=$1::bigint
     AND ${short}.source_id=$2::bigint AND ${short}.team_id=$${side === "home" ? 8 : 9}::bigint
     AND ${at(short, "$7::bigint")} AND NOT ${short}.is_deleted
    JOIN ingest.source_records ${short}_source ON ${short}_source.id=${short}.source_record_id
      AND ${short}_source.source_id=${short}.source_id`;
}
function metricProjection(short) {
  return `${short}.value_kind AS ${short}_kind,${short}.numeric_value::text AS ${short}_number,
     ${short}.text_value AS ${short}_text,${short}.boolean_value AS ${short}_boolean`;
}

function metric(item, row, side, short) {
  switch (row[short + "_kind"]) {
    case "absent":
      break;
    case "null":
      item[side] = null;
      break;
    case "number":
      item[side] = exactNumber(row[short + "_number"]);
      break;
    case "string":
      scalar(item, side, "value", row[short + "_text"], "string");
      break;
    case "boolean":
      scalar(item, side, "value", row[short + "_boolean"], "boolean");
      break;
    default:
      unavailable();
  }
}

async function stats(c, data) {
  const common = [...c.key, c.document_id];
  const periods = bounded(
    await payload(
      "stats-periods",
      `
 SELECT ${recordProjection("r")},p.source_period_label,p.source_period_label_state,p.groups_state,p.groups_count
 FROM football.match_team_stat_periods p JOIN ingest.source_records r ON r.id=p.source_record_id
  AND ${nativeRecord("r")} WHERE ${parent("p")} LIMIT ${limits.stats + 1}`,
      common,
    ),
    limits.stats,
  );
  const groups = bounded(
    await payload(
      "stats-groups",
      `
 SELECT ${recordProjection("r")},g.period_source_record_id::text AS period_id,g.group_name,g.group_name_state,
        g.items_state,g.items_count
 FROM football.match_team_stat_groups g JOIN ingest.source_records r ON r.id=g.source_record_id
  AND ${nativeRecord("r")} WHERE ${parent("g")} LIMIT ${groupLimit + 1}`,
      common,
    ),
    groupLimit,
  );
  const items = bounded(
    await payload(
      "stats-items",
      `
 SELECT ${recordProjection("r")},i.group_source_record_id::text AS group_id,i.raw_key,i.raw_key_state,
        i.title,i.title_state,i.format_type,i.format_type_state,${metricProjection("h")},${metricProjection("a")}
 FROM football.match_team_stat_items i JOIN ingest.source_records r ON r.id=i.source_record_id AND ${nativeRecord("r")}
 ${metricJoin("home", "h")} ${metricJoin("away", "a")}
 WHERE ${parent("i")} LIMIT ${itemLimit + 1}`,
      [...common, c.b.dataset_generation, c.home_team_id, c.away_team_id],
    ),
    itemLimit,
  );
  const byPeriod = bucket(groups, "period_id"),
    byGroup = bucket(items, "group_id");
  const periodIds = new Set(periods.map((row) => row.witness)),
    groupIds = new Set(groups.map((row) => row.witness));
  requireFact(
    [...byPeriod.keys()].every((id) => periodIds.has(id)) &&
      [...byGroup.keys()].every((id) => groupIds.has(id)),
  );
  collection(data, "periods", c, periods, "ordinal", (period, pi) => {
    requireFact(period.locator === `/data/periods/${pi}`);
    const out = fields({}, period, [
      ["period", "source_period_label", "source_period_label_state"],
    ]);
    const groupRows = ordered(
      byPeriod.get(period.witness) ?? [],
      "ordinal",
      (group, gi) => {
        requireFact(group.locator === `${period.locator}/groups/${gi}`);
        const part = fields({}, group, [
          ["group_name", "group_name", "group_name_state"],
        ]);
        const itemRows = ordered(
          byGroup.get(group.witness) ?? [],
          "ordinal",
          (row, ii) => {
            requireFact(
              row.locator === `${group.locator}/items/${ii}` &&
                row.raw_key_state === "value",
            );
            const item = fields({}, row, [
              ["key", "raw_key", "raw_key_state"],
              ["title", "title", "title_state"],
              ["format_type", "format_type", "format_type_state"],
            ]);
            metric(item, row, "home", "h");
            metric(item, row, "away", "a");
            return item;
          },
        );
        declaredArray(
          part,
          "items",
          group.items_state,
          group.items_count,
          itemRows,
          (item) => item,
        );
        return part;
      },
    );
    declaredArray(
      out,
      "groups",
      period.groups_state,
      period.groups_count,
      groupRows,
      (group) => group,
    );
    return out;
  });
}

const h2hTotals = ["home_wins", "draws", "away_wins", "total_matches"];
const h2hFields = [
  ["id", "external_match_id", "source_external_match_id_state"],
  ["time_utc", "time_utc_source", "source_time_utc_source_state"],
  ["status", "status_source", "source_status_source_state"],
  ["finished", "source_finished", "source_finished_state", "boolean"],
  ["score_home", "home_score", "source_home_score_state", "number"],
  ["score_away", "away_score", "source_away_score_state", "number"],
];

async function h2h(c, data) {
  const totals = one(
    await payload(
      "h2h-totals",
      `
 SELECT t.match_id AS witness,${h2hTotals.map((key) => `t.${key}::text,t.${key}_state`).join(",")}
 FROM football.match_h2h_summaries t WHERE ${parent("t")} LIMIT 2`,
      c.key,
    ),
  );
  for (const key of h2hTotals)
    numberField(data, key, totals[key + "_state"], totals[key]);
  const sides = ["home", "away"];
  const sideCols = sides
    .map(
      (side) => `
   e.source_${side}_state,e.source_${side}_id_state,${side}.external_key AS ${side}_external_key,
   e.${side}_label,e.source_${side}_label_state,e.source_${side}_image_url,e.source_${side}_image_url_state`,
    )
    .join(",");
  const sideJoins = sides
    .map(
      (side) => `
   LEFT JOIN ingest.source_records ${side}
     ON ${lineage(side, "$2::bigint", "$6::bigint", `r.locator||'/${side}/id'`)}`,
    )
    .join(" ");
  const rows = bounded(
    await payload(
      "h2h-recent",
      `
 SELECT r.id witness,r.external_key,e.entry_ordinal,${mappedColumns("e", h2hFields)},${sideCols}
 FROM football.match_h2h_entries e
 JOIN ingest.source_records r ON r.id=e.source_record_id AND
   ${lineage("r", "$2::bigint", "$6::bigint", "'/data/recent_matches/'||e.entry_ordinal::text", "e.entry_ordinal")}
 ${sideJoins}
 WHERE ${parent("e")} AND e.match_revision_id=$7::bigint LIMIT ${limits.h2h + 1}`,
      [...c.key, c.document_id, c.match_revision_id],
    ),
    limits.h2h,
  );
  collection(data, "recent_matches", c, rows, "entry_ordinal", (row) => {
    requireFact(row.external_key === row.external_match_id);
    const item = fields({}, row, h2hFields);
    for (const side of sides) {
      observedObject(item, side, row[`source_${side}_state`], () =>
        fields({}, row, [
          ["id", `${side}_external_key`, `source_${side}_id_state`],
          ["name", `${side}_label`, `source_${side}_label_state`],
          [
            "image_url",
            `source_${side}_image_url`,
            `source_${side}_image_url_state`,
          ],
        ]),
      );
    }
    return item;
  });
}

async function momentum(c, data) {
  const rows = bounded(
    await payload(
      "momentum",
      `
 SELECT p.source_record_id witness,r.id AS point_record,p.series_code,p.sample_index,p.minute::text,p.value::text
 FROM football.match_momentum p
 LEFT JOIN ingest.source_records r ON r.id=p.source_record_id AND
   ${lineage("r", "$2::bigint", "$6::bigint", "'/data/points/'||p.sample_index::text", "p.sample_index")}
 WHERE ${parent("p")} AND p.match_revision_id=$7::bigint LIMIT ${limits.momentum + 1}`,
      [...c.key, c.document_id, c.match_revision_id],
    ),
    limits.momentum,
  );
  collection(data, "points", c, rows, "sample_index", (row) => {
    // Exact short decimals are representable by the existing float columns.
    // The publisher must certify the original source shape before READY.
    requireFact(
      row.point_record !== null &&
        row.series_code === "provider_native" &&
        typeof row.minute === "string" &&
        /^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,2})?$/.test(row.minute) &&
        typeof row.value === "string" &&
        /^-?(?:0|[1-9][0-9]{0,2})$/.test(row.value),
    );
    return { minute: exactNumber(row.minute), value: exactNumber(row.value) };
  });
}

async function match(c, data) {
  const row = one(
    await payload(
      "core",
      `
 SELECT o.source_record_id witness,m.status,o.source_match_key,o.source_date_text,o.source_time_text,
        o.source_round_label,o.source_season_label,o.source_venue_label,o.source_competition_label,
        o.source_referee_label,o.source_referee_state,o.source_has_playoff,o.source_has_playoff_state,
        o.source_league_image_url,o.source_league_image_url_state,league.external_key AS league_id,
        h.goals AS score_home,a.goals AS score_away
 FROM football.match_observation_details o
 JOIN football.matches m ON m.revision_id=o.match_revision_id AND m.id=o.match_id
   AND m.competition_season_id=$8::bigint AND m.source_id=$2::bigint AND m.source_record_id=o.source_record_id
   AND ${at("m", "$7::bigint")} AND NOT m.is_deleted
 JOIN ingest.source_records league ON ${lineage("league", "$2::bigint", "$6::bigint", "'/data/league/id'")}
 JOIN football.match_scores h ON h.match_id=m.id AND h.source_id=m.source_id AND h.source_record_id=o.source_record_id
   AND h.variant_key=m.variant_key AND h.side='home' AND h.score_scope='final_without_shootout'
   AND h.score_basis='played' AND ${at("h", "$7::bigint")} AND NOT h.is_deleted
 JOIN football.match_scores a ON a.match_id=m.id AND a.source_id=m.source_id AND a.source_record_id=o.source_record_id
   AND a.variant_key=m.variant_key AND a.side='away' AND a.score_scope='final_without_shootout'
   AND a.score_basis='played' AND ${at("a", "$7::bigint")} AND NOT a.is_deleted
 WHERE o.match_id=$1::bigint AND o.source_record_id=$3::bigint
   AND o.match_revision_id=$4::bigint AND o.recorded_from_gen=$5::bigint AND o.resolution_state='resolved'
 LIMIT 2`,
      [
        c.match_id,
        c.source_id,
        c.source_record_id,
        c.match_revision_id,
        c.recorded_from_gen,
        c.document_id,
        c.b.dataset_generation,
        c.b.edition_id,
      ],
    ),
  );
  requireFact(
    typeof data.id === "string" &&
      data.id === row.source_match_key &&
      typeof data.home_team === "object" &&
      data.home_team !== null &&
      typeof data.away_team === "object" &&
      data.away_team !== null,
  );
  for (const [key, column] of [
    ["date", "source_date_text"],
    ["time_utc", "source_time_text"],
    ["status", "status"],
    ["round_name", "source_round_label"],
    ["season", "source_season_label"],
    ["stadium", "source_venue_label"],
  ])
    scalar(data, key, "value", row[column], "string");
  for (const side of ["home", "away"])
    scalar(data, "score_" + side, "value", row["score_" + side], "number");
  const league = {};
  scalar(league, "id", "value", row.league_id, "string");
  scalar(league, "name", "value", row.source_competition_label, "string");
  field(
    league,
    row,
    "image_url",
    "source_league_image_url",
    "source_league_image_url_state",
  );
  data.league = league;
  field(data, row, "referee", "source_referee_label", "source_referee_state");
  field(
    data,
    row,
    "has_playoff",
    "source_has_playoff",
    "source_has_playoff_state",
    "boolean",
  );
}

const readFamily = { match, momentum, events, lineups, h2h, stats };

function nativeResponse(req, context, etag, body) {
  return send(req, body, 200, {
    etag,
    maxBytes: maxBody,
    headers: {
      ...cacheHeaders(31536000, 0, { immutable: true }),
      "X-Orion-Representation": context.b.v,
      "X-Orion-Native-Representation": context.b.native,
      "X-Orion-Native-Version": representation,
    },
  });
}

/** Exactly six existing match paths. This dispatch belongs inside Pro mode. */
export async function orionProMatchDetailRoute(req, path, params) {
  const hit = pathPattern.exec(path);
  if (!hit) return null;
  const [, id, feature = "match"] = hit;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
        headers: { Allow: "GET, HEAD" },
      });
    }
    const args = argumentsFor(params);
    const b = await publication(args);
    const c = await matchMetadata(b, id, feature);
    const queryKey = [...params].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const tag = `W/"orion-native1-${digest([path, queryKey, b.v, b.native])}"`;
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag)
    ) {
      return nativeResponse(req, c, tag, null);
    }
    const data = await rootData(c);
    await readFamily[feature](c, data);
    return nativeResponse(req, c, tag, {
      data,
      representation: {
        version: representation,
        sourceToken: b.v,
        nativeToken: b.native,
        family: feature,
        collectionState: c.collection_state,
      },
    });
  } catch (error) {
    if (!(error instanceof NativeMatchError)) throw error;
    return send(
      req,
      {
        ok: false,
        available: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      error.status,
      { headers: { "X-Orion-Native-Error": error.code } },
    );
  }
}
