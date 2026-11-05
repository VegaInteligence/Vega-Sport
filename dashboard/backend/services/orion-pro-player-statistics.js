import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { send } from "./relational-core.js";
import { cacheHeaders, matchesEtag } from "./cache-policy.js";

const contract = "shot-detail-normalized-v1";
const buildRepresentation = "summary-v1-shots-v1";
const routePattern =
  /^\/api\/pitchapi\/matches\/(m_[A-Za-z0-9]{6})\/(?:shots\/(s_[A-Za-z0-9]{6})|players\/(p_[A-Za-z0-9]{6})\/shots)$/;
const tokenPattern = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/;
const maxShots = 1000;
const maxBytes = 1024 * 1024;
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = (a, g) =>
  `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) =>
  `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;

class ShotDetailError extends Error {
  constructor(status, code, message, state) {
    super(message);
    Object.assign(this, { status, code, state });
  }
}
function error(status, code, message, state) {
  throw new ShotDetailError(status, code, message, state);
}
const invalidVersion = () =>
  error(400, "SHOT_VERSION_INVALID", "Version de tir invalide.");
const unavailable = () =>
  error(
    503,
    "SHOT_DETAIL_UNAVAILABLE",
    "Ce détail de tir n’est pas disponible.",
  );
const tooLarge = () =>
  error(
    413,
    "PAGE_TOO_LARGE",
    "Ce détail dépasse la taille maximale de réponse.",
  );

function requestArguments(params) {
  if (
    [...params].some(
      ([key, value]) =>
        !["v", "representation"].includes(key) || value.length > 100,
    ) ||
    new Set(params.keys()).size !== params.size ||
    params.get("representation") !== contract
  )
    invalidVersion();
  const v = params.get("v"),
    parsed = tokenPattern.exec(v || "");
  if (!parsed || BigInt(parsed[1]) > 9223372036854775807n) invalidVersion();
  return { v, buildId: parsed[1] };
}

const buildSql = `/*orion:shot-detail:build-meta*/
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

async function published({ v, buildId }) {
  const rows = await query(buildSql, [buildId]);
  if (rows.length !== 1 || sourceToken(rows[0]) !== v) invalidVersion();
  if (rows[0].representation_version !== buildRepresentation) unavailable();
  return rows[0];
}

// Coverage and the bounded identities/counts are enough to resolve a subject.
// Do not project source sporting values here, including for a conditional GET.
const metaSql = `/*orion:shot-detail:subject-meta*/
 SELECT s.match_id::text,c.source_id::text,c.variant_key,c.collection_state,c.coverage_state,c.observed_row_count,
        actor.player_id,actor.member_count,actor.played,counts.total_count,counts.unknown_shooter,counts.subject_count
 FROM analytics.match_summary s
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id
  AND m.competition_season_id=$2::bigint AND m.publication_state='published' AND ${selected("m", "$3::bigint")}
 JOIN ingest.public_aliases a ON a.route_kind='match' AND a.match_id=s.match_id
  AND a.public_key=$5::text AND ${aliasAt("a", "$4::bigint")}
  AND (a.match_revision_id IS NULL OR EXISTS (SELECT 1 FROM football.matches witness
    WHERE witness.revision_id=a.match_revision_id AND witness.id=a.match_id
      AND witness.competition_season_id=s.competition_season_id))
 LEFT JOIN ingest.match_coverage c ON c.match_id=s.match_id AND c.feature_code='shots'
  AND c.is_canonical AND ${at("c", "$3::bigint")}
 LEFT JOIN LATERAL (
   SELECT min(mp.player_id)::text player_id,count(*)::int member_count,bool_and(mp.played IS TRUE) played
   FROM ingest.public_aliases a
   JOIN football.match_players mp ON mp.player_id=a.player_id AND mp.match_id=s.match_id
     AND ${selected("mp", "$3::bigint")}
   WHERE $7::text='player' AND a.route_kind='player' AND a.public_key=$6::text
     AND ${aliasAt("a", "$4::bigint")}
 ) actor ON true
 LEFT JOIN LATERAL (
   SELECT count(*)::int total_count,coalesce(bool_or(r.player_id IS NULL),false) unknown_shooter,
     count(*) FILTER (WHERE ($7::text='single' AND r.external_shot_id=$6::text)
                         OR ($7::text='player' AND r.player_id=actor.player_id::bigint))::int subject_count
   FROM (SELECT x.player_id,x.external_shot_id FROM football.shots x
         WHERE x.match_id=s.match_id AND x.source_id=c.source_id AND x.variant_key=c.variant_key
           AND c.collection_state IN ('present','empty') AND c.observed_row_count<=${maxShots}
           AND ${selected("x", "$3::bigint")} LIMIT ${maxShots + 1}) r
 ) counts ON true
 WHERE s.build_id=$1::bigint AND s.competition_season_id=$2::bigint LIMIT 2`;

async function subjectMetadata(build, match, subject, mode) {
  const rows = await query(metaSql, [
    build.build_id,
    build.edition_id,
    build.dg,
    build.cg,
    match,
    subject,
    mode,
  ]);
  if (!rows.length)
    error(
      404,
      "RESOURCE_NOT_FOUND",
      "Match introuvable dans cette publication.",
    );
  if (rows.length !== 1) unavailable();
  const c = rows[0],
    state = c.collection_state ?? "unknown";
  if (state !== "present" && state !== "empty")
    error(404, "NOT_COLLECTED", "Tirs non collectés.", state);
  if (c.observed_row_count > maxShots) tooLarge();
  if (
    c.total_count !== c.observed_row_count ||
    (state === "present"
      ? c.coverage_state !== "available" || !(c.observed_row_count > 0)
      : c.coverage_state !== "empty_response" || c.observed_row_count !== 0)
  )
    unavailable();
  if (mode === "single") {
    if (c.subject_count === 0)
      error(404, "SHOT_NOT_FOUND", "Tir introuvable dans ce match.");
    if (c.subject_count !== 1) unavailable();
  } else {
    if (c.member_count === 0)
      error(404, "SHOT_PLAYER_NOT_FOUND", "Joueur introuvable dans ce match.");
    if (c.member_count !== 1 || c.played !== true) unavailable();
    if (c.unknown_shooter)
      error(
        503,
        "SHOT_ACTOR_UNRESOLVED",
        "Un tireur de ce match n’est pas identifié.",
      );
  }
  return c;
}

function playerProfileSql(actor, generation, source) {
  // Same priorities as the existing immutable normalized V1 shot projection.
  return `WITH candidates AS (
    SELECT p.display_name,CASE p.profile_context WHEN 'provider_global' THEN 0
      WHEN 'legacy_normalized_global' THEN 1 WHEN 'global' THEN 2 END AS priority
    FROM football.player_profile_versions p WHERE p.player_id=${actor} AND ${selected("p", generation)}
    AND ((p.profile_context='provider_global' AND p.variant_key='provider:exact' AND p.source_id=${source})
      OR (p.profile_context='legacy_normalized_global' AND p.source_id=${source})
      OR (p.profile_context='global' AND p.provenance_kind='manual' AND p.source_id IS NULL)))
  SELECT count(*)::int AS candidates, CASE WHEN count(*)=1 THEN min(display_name) END AS display_name
  FROM candidates WHERE priority=(SELECT min(priority) FROM candidates)`;
}

const shotSql = `/*orion:shot-detail:payload*/
 WITH target AS MATERIALIZED (
   SELECT s.revision_id,s.external_shot_id,s.player_id,s.team_id,s.minute,s.minute_added,s.x_m,s.y_m,
     s.coordinate_frame,s.pitch_length_m,s.pitch_width_m,s.xg,s.xgot,s.source_event_type,s.source_shot_type,
     s.is_goal,s.is_own_goal,s.is_on_target,s.outcome,s.body_part,s.situation,s.source_ordinal,p.sequence_no AS period_order
   FROM football.shots s
   JOIN football.match_teams mt ON mt.match_id=s.match_id AND mt.team_id=s.team_id
     AND ${selected("mt", "$4::bigint")}
   LEFT JOIN football.periods p ON p.code=s.period_code AND p.definition_version=s.period_definition_version
     AND ${at("p", "$4::bigint")}
   WHERE s.match_id=$1::bigint AND s.source_id=$2::bigint AND s.variant_key=$3::text AND ${selected("s", "$4::bigint")}
     AND (($8::text='single' AND s.external_shot_id=$7::text)
        OR ($8::text='player' AND s.player_id=$6::bigint))
   LIMIT ${maxShots + 1}
 ), subject AS (
   SELECT CASE WHEN $8::text='player' THEN $6::bigint ELSE (SELECT player_id FROM target LIMIT 1) END AS actor_id
 ), player AS MATERIALIZED (
   SELECT subject.actor_id,profile.candidates,profile.display_name,alias.public_key AS player_public_id
   FROM subject
   LEFT JOIN LATERAL (${playerProfileSql("subject.actor_id", "$5::bigint", "$2::bigint")}) profile ON true
   LEFT JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a
      WHERE a.route_kind='player' AND a.player_id=subject.actor_id AND ${aliasAt("a", "$5::bigint")}
       AND a.public_key ~ '^p_[A-Za-z0-9]{6}$' ORDER BY a.public_key LIMIT 1) alias ON true
 ), projected AS MATERIALIZED (
   SELECT t.*,player.actor_id,player.candidates,player.display_name,player.player_public_id,team.public_key AS team_public_id
   FROM player LEFT JOIN target t ON true
   LEFT JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a WHERE a.route_kind='team'
     AND a.team_id=t.team_id AND ${aliasAt("a", "$5::bigint")}
     AND a.public_key ~ '^t_[A-Za-z0-9]{6}$' ORDER BY a.public_key LIMIT 1) team ON true
 ), budget AS (
   SELECT coalesce(sum(octet_length(row_to_json(r)::text)),0)>${4 * maxBytes} AS exceeded FROM projected r
 )
 SELECT p.*,budget.exceeded FROM budget LEFT JOIN projected p ON NOT budget.exceeded
 ORDER BY p.period_order NULLS LAST,p.source_ordinal NULLS LAST,p.external_shot_id,p.revision_id`;

function actor(row) {
  return { id: row.player_public_id, name: row.display_name };
}

function shotDto(s) {
  const coordinates = s.coordinate_frame === "acting_ltr";
  return {
    id: s.external_shot_id,
    team_id: s.team_public_id,
    player: s.player_id === null ? null : actor(s),
    minute: s.minute,
    minute_added: s.minute_added,
    x: coordinates ? s.x_m : null,
    y: coordinates ? s.y_m : null,
    coordinate_frame: s.coordinate_frame,
    coordinate_state: coordinates
      ? s.x_m !== null && s.y_m !== null
        ? "available"
        : "unknown"
      : s.coordinate_frame === null
        ? "unknown"
        : "unsupported_frame",
    source_coordinates: {
      x_m: s.x_m,
      y_m: s.y_m,
      coordinate_frame: s.coordinate_frame,
      pitch_length_m: s.pitch_length_m,
      pitch_width_m: s.pitch_width_m,
    },
    expected_goals: s.xg,
    expected_goals_on_target: s.xgot,
    event_type:
      s.source_event_type ??
      (s.is_own_goal === true
        ? "OwnGoal"
        : s.is_goal === true
          ? "Goal"
          : s.outcome),
    shot_type: s.source_shot_type,
    body_part: s.body_part,
    situation: s.situation,
    is_goal: s.is_goal,
    is_own_goal: s.is_own_goal,
    is_on_target: s.is_on_target,
  };
}

async function readShots(c, b, subject, mode) {
  const rows = await query(shotSql, [
    c.match_id,
    c.source_id,
    c.variant_key,
    b.dg,
    b.cg,
    c.player_id,
    subject,
    mode,
  ]);
  if (rows[0]?.exceeded) tooLarge();
  if (!rows.length || rows[0].candidates > 1) unavailable();
  const shots = rows.filter((row) => row.revision_id !== null);
  if (shots.length !== c.subject_count || shots.length > maxShots)
    unavailable();
  if (mode === "single") return shotDto(shots[0]);
  if (rows[0].actor_id !== c.player_id || rows[0].player_public_id === null)
    unavailable();
  return { player: actor(rows[0]), shots: shots.map(shotDto) };
}

function respond(req, v, tag, data) {
  return send(req, data, 200, {
    etag: tag,
    maxBytes,
    headers: {
      ...cacheHeaders(31536000, 0, { immutable: true }),
      "X-Orion-Representation": v,
      "X-Orion-Statistics-Representation": contract,
    },
  });
}

/** Existing subject routes, on the published normalized shot collection only. */
export async function orionProPlayerStatisticsRoute(req, path, params) {
  const found = routePattern.exec(path);
  if (!found) return null;
  const [, match, shot, player] = found,
    mode = shot ? "single" : "player",
    subject = shot ?? player;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
        headers: { Allow: "GET, HEAD" },
      });
    }
    const args = requestArguments(params),
      b = await published(args);
    const c = await subjectMetadata(b, match, subject, mode);
    const orderedParams = [...params].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const tag = `W/"orion-shot-detail1-${digest([contract, path, orderedParams, args.v])}"`;
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag)
    )
      return respond(req, args.v, tag, null);
    return respond(req, args.v, tag, {
      status: 200,
      data: await readShots(c, b, subject, mode),
      representation: {
        version: contract,
        sourceToken: args.v,
        origin: "edition-shots",
      },
    });
  } catch (failure) {
    if (!(failure instanceof ShotDetailError)) throw failure;
    return send(
      req,
      {
        ok: false,
        available: false,
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.state ? { state: failure.state } : {}),
        },
      },
      failure.status,
    );
  }
}
