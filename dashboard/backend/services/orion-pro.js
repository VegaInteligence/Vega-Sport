import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { cacheHeaders, matchesEtag } from "./cache-policy.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const mid = /^m_[A-Za-z0-9]{6}$/;
const lid = /^l_[A-Za-z0-9]{6}$/;
const year = /^\d{4}(?:\/\d{4})?$/;
const tokenPattern = /^pro1\.([1-9][0-9]{0,18})\.([a-f0-9]{64})$/;
const at = (a, g) =>
  `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) =>
  `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const capabilities = {
  frozenRepresentations: true,
  fixturesPagination: true,
  matchSummary: true,
  lazyShots: true,
};
const representationVersion = "summary-v1-shots-v1";

function tokenBuild(value) {
  if (value === null) return null;
  const match = tokenPattern.exec(value);
  if (!match || BigInt(match[1]) > 9223372036854775807n)
    reject(400, "Version invalide.");
  return match[1];
}

function token(row) {
  return `pro1.${row.build_id}.${digest(
    JSON.stringify([
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
    ]),
  )}`;
}

const metadataSql = `/*orion:meta*/
SELECT b.id::text build_id,b.competition_season_id::text edition_id,
 b.dataset_snapshot_id::text dataset_snapshot_id,d.generation::text dataset_generation,
 b.catalog_snapshot_id::text catalog_snapshot_id,c.generation::text catalog_generation,
 b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
 b.metrics_contract_version,b.transform_version,b.finished_at,
 e.season_key AS season,co.name AS league_name,aliases.keys AS league_keys,
 totals.matches_count AS match_count
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
JOIN LATERAL (SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id
 AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id
 AND p.representation_version=b.representation_version
 AND ($1::bigint IS NOT NULL OR p.published_to_gen IS NULL) LIMIT 1) published ON true
JOIN football.competition_seasons e ON e.id=b.competition_season_id AND ${selected("e", "d.generation")}
JOIN football.competitions co ON co.id=e.competition_id AND ${selected("co", "c.generation")}
LEFT JOIN LATERAL (SELECT array_agg(a.public_key ORDER BY a.public_key) keys FROM ingest.public_aliases a
 WHERE a.route_kind='competition' AND a.competition_id=e.competition_id
 AND a.public_key ~ '^l_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "c.generation")}) aliases ON true
LEFT JOIN analytics.competition_summary totals ON totals.build_id=b.id AND totals.competition_season_id=b.competition_season_id
WHERE b.status='ready' AND ($1::bigint IS NULL OR b.id=$1::bigint)
ORDER BY e.season_key DESC,b.competition_season_id,b.id LIMIT 2049`;

async function representations(v, filters) {
  const id = tokenBuild(v);
  const rows = await query(metadataSql, [id]);
  if (!rows.length || rows.length > 2048)
    reject(503, "Publication indisponible.");
  for (const row of rows) {
    if (row.representation_version !== representationVersion)
      reject(503, "Représentation indisponible.");
    if (!row.league_keys?.length) reject(503, "Catalogue public indisponible.");
    row.league_id = row.league_keys[0];
    row.token = token(row);
  }
  if (v !== null && (rows.length !== 1 || rows[0].token !== v))
    reject(400, "Version invalide.");
  const matches = filters
    ? rows.filter(
        (row) =>
          (!filters.leagues.length ||
            filters.leagues.some((id) => row.league_keys.includes(id))) &&
          (!filters.seasons.length || filters.seasons.includes(row.season)),
      )
    : rows;
  if (!matches.length) reject(503, "Publication indisponible.");
  return matches;
}

const identity = (rows) =>
  rows.length === 1
    ? rows[0].token
    : "proset." + digest(JSON.stringify(rows.map((r) => r.token).sort()));
function responseTag(req, rows) {
  const version = identity(rows);
  const url = new URL(req.url);
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return `W/"orion-pro1-${digest(JSON.stringify([url.pathname, params, version]))}"`;
}
function response(
  req,
  value,
  rows,
  { status = 200, etag = true, maxBytes = 256 * 1024 } = {},
) {
  const url = new URL(req.url);
  const frozen = url.searchParams.has("v");
  return send(req, value, status, {
    ...(etag && status === 200 ? { etag: responseTag(req, rows) } : {}),
    ttl: status === 200 ? 15 : 0,
    maxBytes,
    headers: {
      ...(status === 200 && frozen
        ? cacheHeaders(31536000, 0, { immutable: true })
        : {}),
      ...(rows.length === 1 ? { "X-Orion-Representation": rows[0].token } : {}),
    },
  });
}

function validated(req, rows) {
  return req.method === "HEAD" ||
    matchesEtag(req.headers.get("if-none-match"), responseTag(req, rows))
    ? response(req, null, rows)
    : null;
}

function dateOk(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function values(params, singular, plural, pattern, maximum) {
  if (params.has(singular) && params.has(plural))
    reject(400, "Filtres incompatibles.");
  const raw = params.get(params.has(singular) ? singular : plural) || "";
  const list = raw ? raw.split(",") : [];
  if (list.length > maximum || list.some((v) => !pattern.test(v)))
    reject(400, "Identifiants invalides.");
  return [...new Set(list)].sort();
}

function pageArguments(p) {
  const leagues = values(p, "league", "leagues", lid, 100);
  const seasons = values(p, "season", "seasons", year, 2);
  const raw = p.get("limit") ?? "50",
    limit = Number(raw);
  const status = p.get("status") || "all",
    from = p.get("from"),
    to = p.get("to"),
    q = p.get("q") || "";
  if (!/^[1-9]\d{0,2}$/.test(raw) || limit > 100)
    reject(400, "Taille de page invalide.");
  if (
    !["all", "played", "upcoming"].includes(status) ||
    (from && !dateOk(from)) ||
    (to && !dateOk(to)) ||
    (from && to && from > to) ||
    q.length > 200
  )
    reject(400, "Filtres invalides.");
  const scope = digest(
    JSON.stringify([leagues, seasons, status, from, to, q, limit, p.get("v")]),
  );
  let cursor;
  if (p.has("cursor")) {
    try {
      const encoded = p.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) throw Error();
      cursor = JSON.parse(Buffer.from(encoded, "base64url").toString());
      if (
        cursor.scope !== scope ||
        !mid.test(cursor.id) ||
        !(cursor.day === null || dateOk(cursor.day)) ||
        typeof cursor.generation !== "string" ||
        cursor.generation.length > 200
      )
        throw Error();
    } catch {
      reject(400, "Curseur invalide.");
    }
  }
  return { leagues, seasons, limit, status, from, to, q, scope, cursor };
}

const contextSql = `SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
 build_id bigint,edition_id bigint,dg bigint,cg bigint,league_id text,league_name text,season text,token text)`;
const context = (rows) =>
  JSON.stringify(
    rows.map((row) => ({
      build_id: row.build_id,
      edition_id: row.edition_id,
      dg: row.dataset_generation,
      cg: row.catalog_generation,
      league_id: row.league_id,
      league_name: row.league_name,
      season: row.season,
      token: row.token,
    })),
  );
const selectedMatch = `m.id=s.match_id AND m.revision_id=s.match_revision_id AND m.competition_season_id=x.edition_id
 AND m.publication_state='published' AND ${selected("m", "x.dg")}`;
const publicMatch = `a.route_kind='match' AND a.match_id=s.match_id AND ${aliasAt("a", "x.cg")}
 AND a.public_key ~ '^m_[A-Za-z0-9]{6}$'
 AND (a.match_revision_id IS NULL OR EXISTS(SELECT 1 FROM football.matches anchor
 WHERE anchor.id=a.match_id AND anchor.revision_id=a.match_revision_id AND anchor.competition_season_id=x.edition_id))`;

// These ranks belong to summary-v1-shots-v1. A policy change requires a new
// representation adapter; row IDs/timestamps never resolve profile precedence.
function profileSelection(table, actorColumn, actor, source, generation) {
  return `WITH candidates AS (
    SELECT p.display_name,CASE p.profile_context WHEN 'provider_global' THEN 0
      WHEN 'legacy_normalized_global' THEN 1 WHEN 'global' THEN 2 END AS priority
    FROM ${table} p WHERE p.${actorColumn}=${actor} AND ${selected("p", generation)}
    AND ((p.profile_context='provider_global' AND p.variant_key='provider:exact' AND p.source_id=${source})
      OR (p.profile_context='legacy_normalized_global' AND p.source_id=${source})
      OR (p.profile_context='global' AND p.provenance_kind='manual' AND p.source_id IS NULL)))
  SELECT count(*)::integer AS candidates,
    CASE WHEN count(*)=1 THEN min(display_name) END AS display_name
  FROM candidates WHERE priority=(SELECT min(priority) FROM candidates)`;
}

function validateProfiles(rows) {
  if (
    rows.some(
      (row) =>
        row.home_profile_candidates > 1 ||
        row.away_profile_candidates > 1 ||
        row.player_profile_candidates > 1,
    )
  )
    reject(503, "Profil canonique ambigu.");
}

async function matchMetadata(rows, publicId) {
  const found = await query(
    `/*orion:matchmeta*/ WITH x AS (${contextSql})
 SELECT x.*,s.match_id::text,s.match_revision_id::text,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('state',c.collection_state,'coverageState',c.coverage_state,
 'count',c.observed_row_count,'source',c.source_id::text,'variant',c.variant_key) ORDER BY c.source_id,c.variant_key),'[]'::jsonb)
 FROM ingest.match_coverage c WHERE c.match_id=s.match_id AND c.feature_code='shots' AND c.is_canonical
 AND ${at("c", "x.dg")}) AS coverage
 FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
 JOIN football.matches m ON ${selectedMatch}
 JOIN ingest.public_aliases a ON ${publicMatch} AND a.public_key=$2`,
    [context(rows), publicId],
  );
  if (!found.length) reject(404, "Match introuvable.");
  if (found.length !== 1) reject(409, "Précisez une version publiée.");
  const row = found[0];
  if (row.coverage.length > 1) reject(503, "Couverture ambiguë.");
  return {
    ...row,
    coverage: row.coverage[0] || { state: "unknown", count: null },
  };
}

const lightSql = `WITH x AS (${contextSql}), records AS (
 SELECT x.*,a.public_key AS public_id,s.match_id::text,s.match_date::text AS day,
 to_char(s.kickoff_at AT TIME ZONE 'UTC','HH24:MI:SS') AS time_utc,s.status,m.round_label AS round_name,
 NULL::boolean AS has_playoff,s.home_goals,s.away_goals,s.home_shootout_goals,s.away_shootout_goals,
 ht.public_key AS home_id,at.public_key AS away_id,
 hp.candidates AS home_profile_candidates,ap.candidates AS away_profile_candidates,
 CASE WHEN hp.candidates=0 THEN s.home_label ELSE hp.display_name END AS home_name,
 CASE WHEN ap.candidates=0 THEN s.away_label ELSE ap.display_name END AS away_name
 FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
 JOIN football.matches m ON ${selectedMatch}
 JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a WHERE ${publicMatch}
 AND ($2::text IS NULL OR a.public_key=$2) ORDER BY a.public_key LIMIT 1) a ON true
 LEFT JOIN LATERAL (${profileSelection("football.team_profile_versions", "team_id", "s.home_team_id", "m.source_id", "x.cg")}) hp ON true
 LEFT JOIN LATERAL (${profileSelection("football.team_profile_versions", "team_id", "s.away_team_id", "m.source_id", "x.cg")}) ap ON true
 LEFT JOIN LATERAL (SELECT t.public_key FROM ingest.public_aliases t WHERE t.route_kind='team' AND t.team_id=s.home_team_id
 AND ${aliasAt("t", "x.cg")} AND t.public_key ~ '^t_[A-Za-z0-9]{6}$' ORDER BY t.public_key LIMIT 1) ht ON true
 LEFT JOIN LATERAL (SELECT t.public_key FROM ingest.public_aliases t WHERE t.route_kind='team' AND t.team_id=s.away_team_id
 AND ${aliasAt("t", "x.cg")} AND t.public_key ~ '^t_[A-Za-z0-9]{6}$' ORDER BY t.public_key LIMIT 1) at ON true)
 SELECT * FROM records r`;

function fixtureDto(row) {
  return {
    id: row.public_id,
    season: row.season,
    date: row.day,
    time_utc: row.time_utc,
    status: row.status,
    round_name: row.round_name,
    has_playoff: row.has_playoff,
    home_team: { id: row.home_id, name: row.home_name, image_url: null },
    away_team: { id: row.away_id, name: row.away_name, image_url: null },
    league: { id: row.league_id, name: row.league_name, image_url: null },
    score_home: row.home_goals,
    score_away: row.away_goals,
    score_penalty_home: row.home_shootout_goals,
    score_penalty_away: row.away_shootout_goals,
  };
}

async function manifest(req, p) {
  const rows = await representations(p.get("v"));
  const precondition = validated(req, rows);
  if (precondition) return precondition;
  const seasons = new Map(),
    competitions = new Map();
  const editions = rows.map((r) => ({
    leagueId: r.league_id,
    season: r.season,
    representationToken: r.token,
    sourceDigest: digest(r.token),
    datasetGeneration: r.dataset_generation,
    catalogGeneration: r.catalog_generation,
  }));
  for (const row of rows) {
    const competition = competitions.get(row.league_id) || {
      id: row.league_id,
      name: row.league_name,
      seasons: [],
    };
    if (!competition.seasons.includes(row.season))
      competition.seasons.push(row.season);
    competitions.set(row.league_id, competition);
    if (!seasons.has(row.season))
      seasons.set(row.season, { id: row.season, chunks: [] });
    seasons.get(row.season).chunks.push({
      leagueId: row.league_id,
      sourceDigest: digest(row.token),
      representationToken: row.token,
      meta: { matchCount: row.match_count },
      competitions: [
        {
          ...competition,
          name: row.league_name,
          seasons: [row.season],
          sampleMatches: row.match_count,
        },
      ],
    });
  }
  return response(
    req,
    {
      schemaVersion: 4,
      storage: "aws-orion-pro",
      capabilities,
      editions,
      defaultSeason:
        rows
          .map((r) => r.season)
          .sort()
          .at(-1) || null,
      retrievedAt: rows
        .map((r) => r.finished_at)
        .sort((a, b) => new Date(a) - new Date(b))
        .at(-1),
      seasons: [...seasons.values()],
      competitions: [...competitions.values()],
      clubCountries: {},
      scouting: { version: 2, sourceDigest: digest(identity(rows)) },
    },
    rows,
    { maxBytes: 1024 * 1024 },
  );
}

async function fixtures(req, p) {
  const args = pageArguments(p),
    rows = await representations(p.get("v"), args),
    generation = identity(rows);
  if (args.cursor && args.cursor.generation !== generation)
    reject(409, "La publication a changé. Rechargez la première page.");
  const precondition = validated(req, rows);
  if (precondition) return precondition;
  const parameters = [context(rows), null],
    terms = [];
  const bind = (value) => {
    parameters.push(value);
    return "$" + parameters.length;
  };
  if (args.status !== "all")
    terms.push(
      `r.status=${bind(args.status === "played" ? "finished" : "not_started")}`,
    );
  if (args.from) terms.push(`r.day>=${bind(args.from)}`);
  if (args.to) terms.push(`r.day<=${bind(args.to)}`);
  if (args.q) {
    const value =
      "%" +
      args.q
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\\%_]/g, "\\$&") +
      "%";
    terms.push(
      `regexp_replace(normalize(lower(concat_ws(' ',r.home_name,r.away_name,r.league_name)),NFD),'[̀-ͯ]','','g') LIKE ${bind(value)}`,
    );
  }
  if (args.cursor) {
    const day = bind(args.cursor.day),
      id = bind(args.cursor.id);
    terms.push(
      `(r.day>${day}::text OR (r.day IS NULL AND ${day}::text IS NOT NULL) OR (r.day IS NOT DISTINCT FROM ${day}::text AND r.public_id>${id}))`,
    );
  }
  const data = await query(
    "/*orion:list*/ " +
      lightSql +
      (terms.length ? " WHERE " + terms.join(" AND ") : "") +
      ` ORDER BY r.day NULLS LAST,r.public_id LIMIT ${bind(args.limit + 1)}`,
    parameters,
  );
  validateProfiles(data);
  const last = data[args.limit - 1];
  const nextCursor =
    data.length > args.limit
      ? Buffer.from(
          JSON.stringify({
            scope: args.scope,
            generation,
            day: last.day,
            id: last.public_id,
          }),
        ).toString("base64url")
      : null;
  return response(
    req,
    {
      data: { matches: data.slice(0, args.limit).map(fixtureDto) },
      pagination: { limit: args.limit, nextCursor, generation },
    },
    rows,
    { maxBytes: 2 * 1024 * 1024 },
  );
}

async function summary(req, p, id) {
  const rows = await representations(p.get("v")),
    metadata = await matchMetadata(rows, id);
  const scoped = rows.filter((r) => r.build_id === String(metadata.build_id));
  const precondition = validated(req, scoped);
  if (precondition) return precondition;
  const [row] = await query("/*orion:summary*/ " + lightSql, [
    context(scoped),
    id,
  ]);
  if (!row) reject(404, "Match introuvable.");
  validateProfiles([row]);
  const f = fixtureDto(row),
    state = metadata.coverage.state;
  return response(
    req,
    {
      data: {
        version: 1,
        state: "ready",
        representationToken: scoped[0].token,
        match: {
          id: f.id,
          season: f.season,
          leagueId: f.league.id,
          league: f.league.name,
          date: f.date,
          timeUtc: f.time_utc,
          status: f.status,
          roundName: f.round_name,
          hasPlayoff: f.has_playoff,
          home: {
            id: f.home_team.id,
            name: f.home_team.name,
            imageUrl: null,
            score: f.score_home,
            scorePenalty: f.score_penalty_home,
          },
          away: {
            id: f.away_team.id,
            name: f.away_team.name,
            imageUrl: null,
            score: f.score_away,
            scorePenalty: f.score_penalty_away,
          },
          shots: [],
          stats: [],
          coverage: {
            shots: ["present", "empty"].includes(state)
              ? true
              : state === "unknown"
                ? null
                : false,
          },
          coverageStates: { shots: state },
          warnings: [],
          warningCodes: [],
          leadingPlayers: [],
          detailCollected: null,
          summaryVersion: 1,
        },
      },
    },
    scoped,
  );
}

const periodLabels = {
  full_match: "All",
  first_half: "1st",
  second_half: "2nd",
  extra_time_first_half: "ET1",
  extra_time_second_half: "ET2",
  shootout: "Penalties",
};
async function shots(req, p, id) {
  const rows = await representations(p.get("v")),
    metadata = await matchMetadata(rows, id);
  const scoped = rows.filter((r) => r.build_id === String(metadata.build_id)),
    coverage = metadata.coverage;
  if (!["present", "empty"].includes(coverage.state))
    return response(
      req,
      {
        ok: false,
        available: false,
        error: {
          code: "NOT_COLLECTED",
          message: "Donnée non collectée.",
          state: coverage.state,
        },
      },
      scoped,
      { status: 404, etag: false },
    );
  if (
    (coverage.state === "present" &&
      !(coverage.count > 0 && coverage.count <= 1000)) ||
    (coverage.state === "empty" && coverage.count !== 0)
  )
    reject(503, "Couverture invalide.");
  const precondition = validated(req, scoped);
  if (precondition) return precondition;
  let facts = [];
  if (coverage.state === "present") {
    facts = await query(
      `/*orion:shots*/ WITH x AS (${contextSql})
 SELECT s.external_shot_id,s.player_id,s.period_code,s.minute,s.minute_added,s.x_m,s.y_m,
 s.coordinate_frame,s.pitch_length_m,s.pitch_width_m,s.xg,s.xgot,s.source_event_type,s.source_shot_type,
 s.is_goal,s.is_own_goal,s.is_on_target,s.outcome,s.body_part,s.situation,
 p.sequence_no AS period_order,pa.public_key AS player_public_id,pp.display_name AS player_name,
 pp.candidates AS player_profile_candidates,
 ta.public_key AS team_public_id
 FROM x JOIN football.shots s ON s.match_id=$2::bigint AND s.source_id=$3::bigint AND s.variant_key=$4
 AND ${selected("s", "x.dg")}
 JOIN football.match_teams mt ON mt.match_id=s.match_id AND mt.team_id=s.team_id AND ${selected("mt", "x.dg")}
 JOIN football.matches m ON m.id=s.match_id AND m.competition_season_id=x.edition_id AND ${selected("m", "x.dg")}
 LEFT JOIN football.periods p ON p.code=s.period_code AND p.definition_version=s.period_definition_version AND ${at("p", "x.dg")}
 LEFT JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a WHERE a.route_kind='player' AND a.player_id=s.player_id
 AND ${aliasAt("a", "x.cg")} AND a.public_key ~ '^p_[A-Za-z0-9]{6}$' ORDER BY a.public_key LIMIT 1) pa ON true
 LEFT JOIN LATERAL (${profileSelection("football.player_profile_versions", "player_id", "s.player_id", "s.source_id", "x.cg")}) pp ON true
 LEFT JOIN LATERAL (SELECT a.public_key FROM ingest.public_aliases a WHERE a.route_kind='team' AND a.team_id=s.team_id
 AND ${aliasAt("a", "x.cg")} AND a.public_key ~ '^t_[A-Za-z0-9]{6}$' ORDER BY a.public_key LIMIT 1) ta ON true
 ORDER BY p.sequence_no NULLS LAST,s.source_ordinal NULLS LAST,s.external_shot_id,s.revision_id LIMIT 1001`,
      [context(scoped), metadata.match_id, coverage.source, coverage.variant],
    );
    if (facts.length !== coverage.count) reject(503, "Collection incomplète.");
    validateProfiles(facts);
  }
  const periods = new Map();
  for (const s of facts) {
    const period = periodLabels[s.period_code] || s.period_code || "Unknown";
    if (!periods.has(period)) periods.set(period, { period, shots: [] });
    const coordinates = s.coordinate_frame === "acting_ltr";
    periods.get(period).shots.push({
      id: s.external_shot_id,
      team_id: s.team_public_id,
      player:
        s.player_id === null
          ? null
          : { id: s.player_public_id, name: s.player_name },
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
    });
  }
  return response(
    req,
    {
      data: {
        periods: [...periods.values()],
        representationToken: scoped[0].token,
        collectionState: coverage.state,
      },
    },
    scoped,
    { maxBytes: 2 * 1024 * 1024 },
  );
}

export async function orionProRoute(req, path, params) {
  let read, allowed;
  if (path === "/api/dashboard/manifest") {
    read = () => manifest(req, params);
    allowed = ["v"];
  } else if (path === "/api/fixtures") {
    read = () => fixtures(req, params);
    allowed = [
      "league",
      "leagues",
      "season",
      "seasons",
      "status",
      "from",
      "to",
      "q",
      "limit",
      "cursor",
      "v",
    ];
  } else {
    const match = /^\/api\/matches\/(m_[A-Za-z0-9]{6})\/summary$/.exec(path);
    const detail = /^\/api\/pitchapi\/matches\/(m_[A-Za-z0-9]{6})\/shots$/.exec(
      path,
    );
    if (match) {
      read = () => summary(req, params, match[1]);
      allowed = ["v"];
    } else if (detail) {
      read = () => shots(req, params, detail[1]);
      allowed = ["v"];
    } else return null;
  }
  validateParams(params, allowed);
  tokenBuild(params.get("v"));
  return read();
}

/** Shared with the season read-model routes: the same published-build resolution and tokens. */
export { representations as proRepresentations, tokenBuild as proTokenBuild };
