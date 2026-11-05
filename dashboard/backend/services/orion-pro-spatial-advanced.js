import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { send } from "./relational-core.js";
import { cacheHeaders, matchesEtag } from "./cache-policy.js";

const contract = "match-statistics-v1";
const environment =
  "093759ba0cc39f72a1182bfb1a0d2db7d94ba3d1ec96171be57778cccbb49297";
const variant = "source:match-statistics-v1";
const metricFrame = "metric_105x68_acting_ltr";
const routes =
  /^\/api\/pitchapi\/matches\/(m_[A-Za-z0-9]{6})\/(heatmaps|advanced(?:\/network|\/players(?:\/(p_[A-Za-z0-9]{6}))?)?)$/;
const proToken = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/;
const frames = new Set(["acting_ltr", "home_ltr"]);
const caps = {
  maps: 80,
  cells: 8192,
  networks: 4,
  nodes: 160,
  edges: 1600,
  players: 120,
  teams: 2,
  metrics: 3000,
  bytes: 1024 * 1024,
};
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = (a, g) =>
  `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const retained = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const selected = (a, g) => `${retained(a, g)} AND ${a}.is_canonical`;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class SpatialAdvancedError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
function error(status, code, message) {
  throw new SpatialAdvancedError(status, code, message);
}
const invalid = () =>
  error(
    400,
    "STATISTICS_VERSION_INVALID",
    "Version ou paramètres de statistiques invalides.",
  );
const unavailable = () =>
  error(
    503,
    "STATISTICS_COHORT_UNAVAILABLE",
    "Ces statistiques ne sont pas disponibles pour cette publication.",
  );
const tooLarge = () =>
  error(
    413,
    "PAGE_TOO_LARGE",
    "Ces statistiques dépassent la taille maximale de réponse.",
  );
const requireFact = (ok) => {
  if (!ok) unavailable();
};

const buildSql = `/*orion:spatial-advanced:build-meta*/
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
     AND p.representation_version=b.representation_version) LIMIT 2`;

function sourceToken(b) {
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

function argumentsFor(params, endpoint, subject) {
  const heat = endpoint === "heatmaps";
  const allowed = new Set(
    heat ? ["v", "representation", "frame"] : ["v", "representation"],
  );
  const v = params.get("v"),
    id = proToken.exec(v || "")?.[1];
  const frame = heat ? (params.get("frame") ?? "acting_ltr") : null;
  if (
    !id ||
    BigInt(id) > 9223372036854775807n ||
    params.get("representation") !== contract ||
    [...params].some(([k, value]) => !allowed.has(k) || value.length > 100) ||
    new Set(params.keys()).size !== params.size ||
    (heat && !frames.has(frame))
  )
    invalid();
  const family = heat
    ? "heatmaps"
    : endpoint === "advanced/network"
      ? "pass_networks"
      : endpoint === "advanced"
        ? "advanced_teams"
        : "advanced_players";
  return { v, id, frame, family, subject: subject ?? null };
}

async function build(args) {
  const rows = await query(buildSql, [args.id]);
  if (rows.length !== 1 || sourceToken(rows[0]) !== args.v) invalid();
  const b = rows[0];
  if (
    b.representation_version !== "summary-v1-shots-v1" ||
    b.environment_sha256 !== environment ||
    b.metrics_contract_version !== "orion_pro_native107_core_v1" ||
    b.transform_version !== "orion_pro_publish_native107_core_v1" ||
    ![b.dependencies_sha256, b.code_content_sha256].every((h) =>
      /^[a-f0-9]{64}$/.test(h || ""),
    )
  )
    error(
      503,
      "STATISTICS_PUBLICATION_UNQUALIFIED",
      "Cette publication ne qualifie pas ces statistiques.",
    );
  return b;
}

const coverageSql = `/*orion:spatial-advanced:coverage-meta*/
 SELECT s.match_id::text,c.source_id::text,c.match_revision_id::text,c.document_id::text,c.recorded_from_gen::text,
        c.feature_code,c.collection_state,c.coverage_state,c.observed_row_count,root.id::text AS root_record,
        subject.candidates,subject.physical_id
 FROM analytics.match_summary s
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id
   AND m.competition_season_id=$2::bigint AND m.publication_state='published' AND ${selected("m", "$3::bigint")}
 JOIN ingest.public_aliases a ON a.route_kind='match' AND a.match_id=s.match_id
   AND a.public_key=$5::text AND ${retained("a", "$4::bigint")}
   AND (a.match_revision_id IS NULL OR EXISTS (SELECT 1 FROM football.matches witness
     WHERE witness.revision_id=a.match_revision_id AND witness.id=a.match_id
     AND witness.competition_season_id=s.competition_season_id))
 LEFT JOIN ingest.match_coverage c ON c.match_id=s.match_id AND c.feature_code=ANY($6::text[])
   AND c.variant_key=$7::text AND c.contract_version=$9::text AND ${at("c", "$3::bigint")}
   AND (c.is_canonical OR $10::bool)
 LEFT JOIN ingest.source_records root ON root.id=c.source_record_id AND root.source_id=c.source_id
   AND root.document_id=c.document_id AND root.locator_kind='json_pointer' AND root.ordinal IS NULL
   AND root.locator=CASE c.feature_code WHEN 'heatmaps.teams' THEN '/data/teams'
      WHEN 'heatmaps.players' THEN '/data/players' ELSE '/data' END
 LEFT JOIN LATERAL (
   SELECT count(*)::int AS candidates,min(found.revision_id)::text AS physical_id FROM (
     SELECT f.revision_id FROM ingest.public_aliases a
     JOIN football.player_match_advanced f ON f.player_id=a.player_id AND f.match_id=s.match_id
       AND f.source_id=c.source_id AND f.variant_key=$7::text||':advanced_players'
       AND f.contract_version=$9::text AND f.period_code='full_match' AND ${retained("f", "$3::bigint")}
     JOIN ingest.source_records sr ON sr.id=f.source_record_id AND sr.source_id=c.source_id AND sr.document_id=c.document_id
     WHERE $8::text IS NOT NULL AND a.route_kind='player' AND a.public_key=$8::text AND ${retained("a", "$4::bigint")}
     LIMIT 2
   ) found
 ) subject ON true
 WHERE s.build_id=$1::bigint AND s.competition_season_id=$2::bigint LIMIT 3`;

async function coverage(b, match, args) {
  const heat = args.family === "heatmaps",
    features = heat ? ["heatmaps.teams", "heatmaps.players"] : [args.family];
  const v = heat ? variant + ":heatmap:" + args.frame : variant;
  const rows = await query(coverageSql, [
    b.build_id,
    b.edition_id,
    b.dg,
    b.cg,
    match,
    features,
    v,
    args.subject,
    contract,
    args.frame === "home_ltr",
  ]);
  if (!rows.length)
    error(
      404,
      "RESOURCE_NOT_FOUND",
      "Match introuvable dans cette publication.",
    );
  requireFact(
    rows.length === features.length &&
      new Set(rows.map((r) => r.feature_code)).size === features.length,
  );
  const first = rows[0];
  for (const r of rows) {
    const n = r.observed_row_count,
      state = r.collection_state;
    requireFact(
      r.source_id !== null &&
        r.document_id !== null &&
        r.root_record !== null &&
        r.match_revision_id === first.match_revision_id &&
        r.source_id === first.source_id &&
        r.document_id === first.document_id &&
        r.recorded_from_gen === first.recorded_from_gen,
    );
    const present =
      state === "present" &&
      r.coverage_state === "available" &&
      Number.isInteger(n) &&
      n > 0;
    const empty =
      state === "empty" && r.coverage_state === "empty_response" && n === 0;
    const knownShape =
      heat &&
      (state === "absent" || state === "null") &&
      r.coverage_state === "available" &&
      n === null;
    requireFact(present || empty || knownShape);
  }
  const n = rows.reduce((total, r) => total + (r.observed_row_count ?? 0), 0);
  const max = {
    heatmaps: caps.maps,
    pass_networks: caps.networks,
    advanced_teams: caps.teams,
    advanced_players: caps.players,
  }[args.family];
  if (n > max) tooLarge();
  if (args.subject !== null) {
    if (!first.candidates)
      error(
        404,
        "STATISTICS_PLAYER_NOT_FOUND",
        "Joueur introuvable dans ces statistiques.",
      );
    requireFact(first.candidates === 1 && first.physical_id !== null);
  }
  return { b, args, match, rows, n, variant: v, c: first };
}

async function payload(label, sql, params, limit) {
  const rows = await query(
    `/*orion:spatial-advanced:payload:${label}*/
 WITH projected AS MATERIALIZED (${sql}), budget AS (
   SELECT coalesce(sum(octet_length(row_to_json(r)::text)),0)>${4 * caps.bytes} AS exceeded FROM projected r
 ) SELECT p.*,budget.exceeded FROM budget LEFT JOIN projected p ON NOT budget.exceeded`,
    params,
  );
  if (rows[0]?.exceeded) tooLarge();
  const facts = rows.filter((r) => r.witness !== null);
  if (facts.length > limit) tooLarge();
  return facts;
}

const scope = (ctx, v = ctx.variant) => [
  ctx.c.match_id,
  ctx.c.source_id,
  ctx.c.document_id,
  v,
  ctx.b.dg,
  ctx.b.cg,
  contract,
];
const fact = (a, contractArg = "$7::text") =>
  `${a}.match_id=$1::bigint AND ${a}.source_id=$2::bigint AND ${a}.variant_key=$4::text AND ${a}.contract_version=${contractArg}`;
const witness = (a) =>
  `${a}.source_id=$2::bigint AND ${a}.document_id=$3::bigint AND ${a}.locator_kind='json_pointer'`;
const sideJoin = (
  id,
  actor,
  match,
) => `JOIN football.match_teams side ON side.revision_id=${id}
 AND side.match_id=${match} AND side.team_id=${actor} AND NOT side.is_deleted`;

function observedJoin(kind, alias, actor, locator, physical = null) {
  const player = kind === "player";
  return `LEFT JOIN LATERAL (
 SELECT p.id::text AS id,p.display_name,p.source_name_state,p.source_image_url,p.source_image_url_state,
        count(*) OVER()::int AS candidates${player ? ",p.shirt_number,p.shirt_number_state,p.shirt_number_source_number::text" : ""}
 FROM football.${kind}_profile_versions p JOIN ingest.source_records pr ON pr.id=p.source_record_id AND ${witness("pr")}
   AND ${locator} AND pr.ordinal IS NULL AND pr.external_key IS NOT NULL
 WHERE p.${kind}_id=${actor} AND p.source_id=$2::bigint AND p.source_external_id_state='value'
   AND p.profile_context='match_statistics_observation_v1:'||pr.id::text AND p.variant_key='source:exact'
   AND ${retained("p", "$6::bigint")} ${physical ? `AND p.id=${physical}` : ""}
 LIMIT 1) ${alias} ON true
 LEFT JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a WHERE a.route_kind='${kind}'
   AND a.${kind}_id=${actor} AND a.public_key ~ '^${player ? "p" : "t"}_[A-Za-z0-9]{6}$'
   AND ${retained("a", "$6::bigint")} ORDER BY a.public_key LIMIT 1) ${alias}_alias ON true`;
}

function profileProjection(alias, player = false) {
  return `${alias}_alias.public_key AS ${alias}_public,${alias}.candidates AS ${alias}_candidates,
 ${alias}.display_name AS ${alias}_name,${alias}.source_name_state AS ${alias}_name_state,
 ${alias}.source_image_url AS ${alias}_image,${alias}.source_image_url_state AS ${alias}_image_state${
   player
     ? `,
 ${alias}.shirt_number AS ${alias}_shirt,${alias}.shirt_number_state AS ${alias}_shirt_state,
 ${alias}.shirt_number_source_number AS ${alias}_shirt_number`
     : ""
 }`;
}

const numeric = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?$/;
function exactNumber(raw) {
  requireFact(
    typeof raw === "string" &&
      raw.length <= 150000 &&
      numeric.test(raw) &&
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
function actor(row, a, player = false) {
  requireFact(
    row[a + "_candidates"] === 1 && typeof row[a + "_public"] === "string",
  );
  const out = { id: row[a + "_public"] };
  property(out, "name", row[a + "_name_state"], row[a + "_name"]);
  property(out, "image_url", row[a + "_image_state"], row[a + "_image"]);
  if (player) {
    const state = row[a + "_shirt_state"];
    if (state === "number")
      out.shirt_number = exactNumber(row[a + "_shirt_number"]);
    else
      property(
        out,
        "shirt_number",
        state === "string" ? "value" : state,
        row[a + "_shirt"],
      );
  }
  return out;
}

function group(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}
function ordered(rows, key) {
  const sorted = [...rows].sort((a, b) => a[key] - b[key]);
  requireFact(sorted.every((r, i) => r[key] === i));
  return sorted;
}
function array(out, key, parent, rows) {
  requireFact(rows.length === (parent.observed_row_count ?? 0));
  if (
    parent.collection_state === "present" ||
    parent.collection_state === "empty"
  )
    out[key] = rows;
  else if (parent.collection_state === "null") out[key] = null;
}
const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const optionalNumber = (out, key, value, predicate = Number.isFinite) => {
  if (value !== null) {
    requireFact(predicate(value));
    out[key] = value;
  }
};

async function heatmaps(ctx) {
  const out = { match_id: ctx.match };
  const modes = new Map(ctx.rows.map((r) => [r.feature_code.split(".")[1], r]));
  if (!ctx.n) {
    for (const [key, row] of modes) array(out, key, row, []);
    return out;
  }
  const maps = await payload(
    "heatmap-maps",
    `
 SELECT h.id::text AS witness,h.player_id::text,h.coordinate_frame,h.grid_columns,h.grid_rows,
        h.cell_length_m,h.cell_width_m,h.actions,h.cells_state,r.ordinal,side.side,
        ${profileProjection("tp")},${profileProjection("pp", true)}
 FROM football.match_heatmaps h ${sideJoin("h.match_team_revision_id", "h.team_id", "h.match_id")}
 JOIN ingest.source_records r ON r.id=h.source_record_id AND ${witness("r")} AND r.ordinal>=0
  AND r.locator='/data/'||(CASE WHEN h.player_id IS NULL THEN 'teams' ELSE 'players' END)||'/'||r.ordinal::text
 ${observedJoin("team", "tp", "h.team_id", "pr.locator=r.locator||'/team'")}
 ${observedJoin("player", "pp", "h.player_id", "pr.locator=r.locator||'/player'")}
 WHERE ${fact("h")} AND ${at("h", "$5::bigint")} AND h.period_code='full_match' AND h.map_kind='source_actions'
   AND (h.player_id IS NULL OR EXISTS (SELECT 1 FROM football.match_players mp WHERE mp.match_id=h.match_id
     AND mp.player_id=h.player_id AND mp.team_id=h.team_id AND mp.source_id=h.source_id AND ${retained("mp", "$5::bigint")}))
 LIMIT ${caps.maps + 1}`,
    scope(ctx),
    caps.maps,
  );
  requireFact(maps.length === ctx.n);
  const mapIds = maps.map((r) => r.witness);
  const cells = await payload(
    "heatmap-cells",
    `
 SELECT h.heatmap_id::text AS witness,h.cell_ordinal,h.column_index,h.row_index,h.action_count
 FROM football.match_heatmap_cells h WHERE h.heatmap_id=ANY($1::bigint[]) LIMIT ${caps.cells + 1}`,
    [mapIds],
    caps.cells,
  );
  const bins = group(cells, "witness"),
    shaped = { teams: [], players: [] };
  for (const m of maps) {
    const grid = {
      length: m.grid_columns,
      width: m.grid_rows,
      cell_length_m: m.cell_length_m,
      cell_width_m: m.cell_width_m,
      frame: m.coordinate_frame,
    };
    requireFact(
      grid.frame === ctx.args.frame &&
        whole(grid.length) &&
        whole(grid.width) &&
        grid.length > 0 &&
        grid.width > 0 &&
        Number.isFinite(grid.cell_length_m) &&
        Number.isFinite(grid.cell_width_m) &&
        grid.cell_length_m > 0 &&
        grid.cell_width_m > 0 &&
        (out.grid === undefined ||
          JSON.stringify(out.grid) === JSON.stringify(grid)) &&
        ["home", "away"].includes(m.side) &&
        (m.actions === null || whole(m.actions)),
    );
    out.grid = grid;
    const player = m.player_id !== null;
    const dto = { team: actor(m, "tp"), side: m.side, actions: m.actions };
    if (player) dto.player = actor(m, "pp", true);
    const points = ordered(bins.get(m.witness) ?? [], "cell_ordinal"),
      coordinates = new Set();
    for (const c of points) {
      const k = c.column_index + ":" + c.row_index;
      requireFact(
        whole(c.column_index) &&
          whole(c.row_index) &&
          whole(c.action_count) &&
          c.column_index < grid.length &&
          c.row_index < grid.width &&
          !coordinates.has(k),
      );
      coordinates.add(k);
    }
    if (m.cells_state === "available") {
      requireFact(points.length > 0);
      dto.cells = points.map((c) => [
        c.column_index,
        c.row_index,
        c.action_count,
      ]);
    } else {
      requireFact(
        !points.length && ["absent", "null", "empty"].includes(m.cells_state),
      );
      if (m.cells_state === "null") dto.cells = null;
      if (m.cells_state === "empty") dto.cells = [];
    }
    shaped[player ? "players" : "teams"].push({ slot: m.ordinal, dto });
  }
  for (const [key, parent] of modes)
    array(
      out,
      key,
      parent,
      ordered(shaped[key], "slot").map((r) => r.dto),
    );
  return out;
}

async function networks(ctx) {
  const out = { match_id: ctx.match, networks: [] };
  if (!ctx.n) return out;
  const rows = ordered(
    await payload(
      "networks",
      `
 SELECT n.id::text AS witness,n.window_kind,n.from_seconds,n.until_seconds,n.coordinate_frame,n.centralization,r.ordinal,
        ${profileProjection("tp")}
 FROM football.pass_networks n ${sideJoin("n.match_team_revision_id", "n.team_id", "n.match_id")}
 JOIN ingest.source_records r ON r.id=n.source_record_id AND ${witness("r")} AND r.ordinal>=0
   AND r.locator='/data/networks/'||r.ordinal::text
 ${observedJoin("team", "tp", "n.team_id", "pr.locator=r.locator||'/team'")}
 WHERE ${fact("n")} AND ${at("n", "$5::bigint")} LIMIT ${caps.networks + 1}`,
      scope(ctx),
      caps.networks,
    ),
    "ordinal",
  );
  requireFact(rows.length === ctx.n);
  const ids = rows.map((r) => r.witness);
  const nodes = await payload(
    "network-nodes",
    `
 SELECT z.network_id::text AS witness,z.player_id::text,z.avg_x,z.avg_y,z.passes,z.passes_received,
        z.degree,z.strength,z.betweenness,z.clustering,${profileProjection("pp", true)}
 FROM football.pass_network_nodes z JOIN football.pass_networks n ON n.id=z.network_id
 JOIN ingest.source_records r ON r.id=n.source_record_id AND ${witness("r")}
 ${observedJoin("player", "pp", "z.player_id", "pr.locator ~ ('^'||r.locator||'/nodes/(0|[1-9][0-9]*)/player$')")}
 WHERE ${fact("n")} AND ${at("n", "$5::bigint")} AND n.id=ANY($8::bigint[])
 LIMIT ${caps.nodes + 1}`,
    [...scope(ctx), ids],
    caps.nodes,
  );
  const edges = await payload(
    "network-edges",
    `
 SELECT e.network_id::text AS witness,e.from_player_id::text,e.to_player_id::text,e.passes
 FROM football.pass_network_edges e WHERE e.network_id=ANY($1::bigint[]) LIMIT ${caps.edges + 1}`,
    [ids],
    caps.edges,
  );
  const ns = group(nodes, "witness"),
    es = group(edges, "witness");
  out.networks = rows.map((n) => {
    requireFact(
      n.coordinate_frame === metricFrame &&
        n.window_kind === "first_substitution" &&
        whole(n.until_seconds) &&
        (n.from_seconds === null ||
          (whole(n.from_seconds) && n.from_seconds <= n.until_seconds)),
    );
    const window = { kind: n.window_kind, until_seconds: n.until_seconds };
    optionalNumber(window, "from_seconds", n.from_seconds, whole);
    const dto = {
      team: actor(n, "tp"),
      coordinate_frame: n.coordinate_frame,
      window,
      nodes: [],
      edges: [],
    };
    optionalNumber(dto, "centralization", n.centralization);
    const players = new Map();
    dto.nodes = (ns.get(n.witness) ?? [])
      .map((z) => {
        const p = actor(z, "pp", true);
        requireFact(
          Number.isFinite(z.avg_x) &&
            Number.isFinite(z.avg_y) &&
            z.avg_x >= 0 &&
            z.avg_x <= 105 &&
            z.avg_y >= 0 &&
            z.avg_y <= 68 &&
            !players.has(z.player_id),
        );
        players.set(z.player_id, p);
        const node = { player: p, avg_x: z.avg_x, avg_y: z.avg_y };
        for (const f of [
          "passes",
          "passes_received",
          "degree",
          "strength",
          "betweenness",
          "clustering",
        ])
          optionalNumber(node, f, z[f]);
        return node;
      })
      .sort((a, b) => compare(a.player.id, b.player.id));
    dto.edges = (es.get(n.witness) ?? [])
      .map((e) => {
        requireFact(
          players.has(e.from_player_id) &&
            players.has(e.to_player_id) &&
            whole(e.passes) &&
            e.passes > 0,
        );
        return {
          from: players.get(e.from_player_id),
          to: players.get(e.to_player_id),
          passes: e.passes,
        };
      })
      .sort(
        (a, b) => compare(a.from.id, b.from.id) || compare(a.to.id, b.to.id),
      );
    return dto;
  });
  return out;
}

// Only the approved, directly represented columns. The generic path registry
// can carry other exact source values without changing the typed schema.
const possession =
  "xt_total vaep_total vaep_offensive vaep_defensive pv_total pv_offensive pv_defensive";
const directByFamily = {
  advanced_teams: {
    possession_value: possession,
    defending:
      "aerials aerials_won avg_defensive_action_x challenges counterpress_regains_5s defensive_actions high_turnovers opponent_passes ppda",
    territory:
      "avg_action_x box_entries field_tilt final_third_entries possession_pct",
    tempo: "buildup_attacks direct_attacks direct_speed passes_per_sequence",
  },
  advanced_players: {
    possession_value: possession,
    passing:
      "crosses key_passes passes_into_box progressive_pass_distance progressive_passes switches through_balls",
    carrying:
      "carries carries_into_box carries_into_final_third carry_distance dispossessed miscontrols progressive_carries progressive_carry_distance take_ons take_ons_won",
    creation: "gca sca second_assists xag xg_buildup xg_chain",
  },
};
function directFields(family) {
  const fields = Object.entries(directByFamily[family]).flatMap(
    ([group, keys]) => keys.split(" ").map((key) => [group + "." + key, key]),
  );
  if (family === "advanced_players")
    for (const key of [
      "pass_live",
      "pass_dead",
      "take_on",
      "shot",
      "foul_drawn",
      "defensive",
    ])
      fields.push(["creation.sca_breakdown." + key, "sca_" + key]);
  return fields;
}
const registeredGroups = {
  possession_value: possession,
  passing:
    "passes pass_accuracy progressive_passes progressive_pass_distance passes_into_box key_passes assists through_balls crosses switches",
  carrying:
    "carries carry_distance progressive_carries progressive_carry_distance carries_into_final_third carries_into_box take_ons take_ons_won miscontrols dispossessed",
  creation:
    "sca gca chances_created second_assists xag xg_chain xg_buildup sca_breakdown.pass_live sca_breakdown.pass_dead sca_breakdown.take_on sca_breakdown.shot sca_breakdown.foul_drawn sca_breakdown.defensive",
  defending:
    "tackles interceptions blocks clearances duels_won aerials aerials_won ppda opponent_passes defensive_actions challenges avg_defensive_action_x high_turnovers counterpress_regains_5s ball_recovery_time",
  territory:
    "possession_pct field_tilt final_third_entries box_entries avg_action_x",
  tempo:
    "passes_per_sequence sequence_time direct_speed buildup_attacks direct_attacks",
  goalkeeping:
    "claims claims_won claim_rate sweeper_actions distributions launches launch_pct avg_pass_length distribution_accuracy",
};
const registered = new Set([
  "actions",
  "minutes_played",
  "goalkeeping",
  ...Object.entries(registeredGroups).flatMap(([prefix, fields]) =>
    fields.split(" ").map((field) => prefix + "." + field),
  ),
]);
function canonicalDecimal(value) {
  requireFact(
    typeof value === "string" && value.length <= 150000 && numeric.test(value),
  );
  const [coefficient, power = "0"] = value.toLowerCase().split("e");
  const sign = coefficient.startsWith("-") ? "-" : "";
  const [integer, fraction = ""] = coefficient.replace(/^-/, "").split(".");
  const digits = (integer + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const scale = Number(power) - fraction.length;
  requireFact(Number.isSafeInteger(scale) && Math.abs(scale) <= 150000);
  const reduced = digits.replace(/0+$/, "");
  return sign + reduced + "e" + (scale + digits.length - reduced.length);
}
function putPath(out, path, value) {
  const segments = path.split(".");
  let node = out;
  for (const name of segments.slice(0, -1)) {
    if (!Object.hasOwn(node, name)) node[name] = Object.create(null);
    requireFact(
      node[name] !== null &&
        typeof node[name] === "object" &&
        !JSON.isRawJSON(node[name]),
    );
    node = node[name];
  }
  const leaf = segments.at(-1);
  requireFact(!Object.hasOwn(node, leaf));
  node[leaf] = value;
}
function advancedDto(row, fields, values, team) {
  const out = team
    ? { team: actor(row, "tp") }
    : { player: actor(row, "pp", true), team_id: row.team_public_id };
  if (!team) requireFact(typeof out.team_id === "string");
  const direct = new Map(
    fields
      .filter(([, column]) => row[column] !== null)
      .map(([path, column]) => [path, row[column]]),
  );
  const explicit = new Map();
  for (const cell of values) {
    const path = cell.raw_key;
    requireFact(
      registered.has(path) &&
        !explicit.has(path) &&
        cell.locator === row.locator + "/" + path.replaceAll(".", "/") &&
        cell.external_key === path &&
        cell.team_id === row.team_id &&
        (team || cell.player_id === row.player_id) &&
        cell.period_definition_version === row.period_definition_version &&
        cell.numerator === null &&
        cell.denominator === null &&
        (team
          ? path !== "minutes_played" && !path.startsWith("goalkeeping")
          : !/^(tempo|territory)\./.test(path)),
    );
    if (direct.has(path))
      requireFact(
        cell.value_kind === "number" &&
          canonicalDecimal(direct.get(path)) ===
            canonicalDecimal(cell.numeric_value),
      );
    direct.delete(path);
    explicit.set(path, cell);
  }
  for (const [path, value] of direct) putPath(out, path, exactNumber(value));
  for (const [path, value] of [...explicit].sort(([a], [b]) => compare(a, b))) {
    if (value.value_kind === "number") {
      requireFact(path !== "goalkeeping");
      putPath(out, path, exactNumber(value.numeric_value));
    } else if (value.value_kind === "null") putPath(out, path, null);
    else requireFact(value.value_kind === "absent");
  }
  return out;
}

async function advanced(ctx) {
  const family = ctx.args.family,
    team = family === "advanced_teams",
    kind = team ? "team" : "player";
  if (!ctx.n)
    return team
      ? { match_id: ctx.match, teams: [] }
      : { match_id: ctx.match, sorted_by: "player_id", players: [] };
  const fields = directFields(family);
  const actorKey = team ? "match_team_revision_id" : "match_player_revision_id";
  const maximum = team ? caps.teams : caps.players;
  const v = ctx.variant + ":" + family;
  const playerJoin = `JOIN football.match_players mp ON mp.revision_id=f.match_player_revision_id
   AND mp.match_id=f.match_id AND mp.team_id=f.team_id AND mp.player_id=f.player_id
   AND mp.source_id=f.source_id AND mp.source_record_id=f.source_record_id AND mp.variant_key=f.variant_key
   AND mp.contract_version=$7::text AND ${retained("mp", "$5::bigint")}`;
  const rows = await payload(
    "advanced-subjects",
    `
 SELECT f.revision_id::text AS witness,f.${actorKey}::text AS actor_revision,f.team_id::text,
        f.period_definition_version,r.locator,r.ordinal,
        ${fields.map(([, col]) => `f.${col}::text`).join(",")},
        ${team ? profileProjection("tp") : `f.player_id::text,ta.public_key AS team_public_id,${profileProjection("pp", true)}`}
 FROM football.${kind}_match_advanced f ${team ? "" : playerJoin}
 ${sideJoin(team ? "f.match_team_revision_id" : "mp.match_team_revision_id", "f.team_id", "f.match_id")}
 JOIN ingest.source_records r ON r.id=f.source_record_id AND ${witness("r")} AND r.ordinal>=0
   AND r.locator='/data/${team ? "teams" : "players"}/'||r.ordinal::text
 JOIN football.periods d ON d.code=f.period_code AND d.definition_version=f.period_definition_version
   AND ${at("d", "$5::bigint")}
 ${
   team
     ? observedJoin("team", "tp", "f.team_id", "pr.locator=r.locator||'/team'")
     : `
  ${observedJoin("player", "pp", "f.player_id", "pr.locator=r.locator||'/player'", "mp.profile_version_id")}
  LEFT JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a WHERE a.route_kind='team' AND a.team_id=f.team_id
   AND a.public_key ~ '^t_[A-Za-z0-9]{6}$' AND ${retained("a", "$6::bigint")} ORDER BY a.public_key LIMIT 1) ta ON true`
 }
 WHERE ${fact("f")} AND ${retained("f", "$5::bigint")} AND f.period_code='full_match'
   AND ($8::bigint IS NULL OR f.revision_id=$8::bigint)
 LIMIT ${maximum + 1}`,
    [...scope(ctx, v), ctx.c.physical_id],
    maximum,
  );
  requireFact(
    rows.length === (ctx.args.subject === null ? ctx.n : 1) &&
      new Set(rows.map((r) => (team ? r.team_id : r.player_id))).size ===
        rows.length &&
      new Set(rows.map((r) => r.actor_revision)).size === rows.length,
  );
  const actors = rows.map((r) => r.actor_revision);
  const values = await payload(
    "advanced-scalars",
    `
 SELECT f.revision_id::text AS witness,f.${actorKey}::text AS actor_revision,f.team_id::text,
        ${team ? "" : "f.player_id::text,"}f.period_definition_version,m.raw_key,r.locator,r.external_key,
        f.value_kind,f.numeric_value::text,f.numerator::text,f.denominator::text
 FROM football.${kind}_match_metric_values f
 JOIN football.metric_definitions d ON d.code=f.metric_code AND d.definition_version=f.metric_definition_version
   AND d.scope='${kind}' AND ${at("d", "$5::bigint")}
 JOIN football.source_metric_mappings m ON m.source_id=f.source_id AND m.family_code=$8::text
   AND m.metric_code=f.metric_code AND m.metric_definition_version=f.metric_definition_version
   AND m.mapping_version=$6::text AND ${at("m", "$5::bigint")}
 JOIN ingest.source_records r ON r.id=f.source_record_id AND ${witness("r")}
 WHERE ${fact("f", "$6::text")} AND ${retained("f", "$5::bigint")} AND f.family_code='advanced'
   AND f.period_code='full_match' AND f.${actorKey}=ANY($7::bigint[])
 LIMIT ${caps.metrics + 1}`,
    [
      ctx.c.match_id,
      ctx.c.source_id,
      ctx.c.document_id,
      v,
      ctx.b.dg,
      contract,
      actors,
      family,
    ],
    caps.metrics,
  );
  const cells = group(values, "actor_revision");
  const sequence = ctx.args.subject === null ? ordered(rows, "ordinal") : rows;
  const body = sequence.map((row) =>
    advancedDto(row, fields, cells.get(row.actor_revision) ?? [], team),
  );
  if (team) return { match_id: ctx.match, teams: body };
  if (ctx.args.subject !== null) return body[0];
  return {
    match_id: ctx.match,
    sorted_by: "player_id",
    players: body.sort((a, b) => compare(a.player.id, b.player.id)),
  };
}

function respond(req, v, etag, body) {
  return send(req, body, 200, {
    etag,
    maxBytes: caps.bytes,
    headers: {
      ...cacheHeaders(31536000, 0, { immutable: true }),
      "X-Orion-Representation": v,
      "X-Orion-Statistics-Representation": contract,
    },
  });
}

/** Five existing forms using the admitted spatial/advanced typed observations. */
export async function orionProSpatialAdvancedRoute(req, path, params) {
  const hit = routes.exec(path);
  if (!hit) return null;
  const [, match, endpoint, subject] = hit;
  try {
    if (req.method !== "GET" && req.method !== "HEAD")
      return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
        headers: { Allow: "GET, HEAD" },
      });
    const args = argumentsFor(params, endpoint, subject);
    const ctx = await coverage(await build(args), match, args);
    const sorted = [...params].sort(([a], [b]) => compare(a, b));
    const tag = `W/"orion-spatial-advanced1-${digest([contract, path, sorted, args.v])}"`;
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag)
    )
      return respond(req, args.v, tag, null);
    const reader =
      args.family === "heatmaps"
        ? heatmaps
        : args.family === "pass_networks"
          ? networks
          : advanced;
    return respond(req, args.v, tag, {
      data: await reader(ctx),
      representation: {
        version: contract,
        sourceToken: args.v,
        family: args.family,
        origin: "published-spatial-advanced-facts",
      },
    });
  } catch (failure) {
    if (!(failure instanceof SpatialAdvancedError)) throw failure;
    return send(
      req,
      {
        ok: false,
        available: false,
        error: { code: failure.code, message: failure.message },
      },
      failure.status,
    );
  }
}
