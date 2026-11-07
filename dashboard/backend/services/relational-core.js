import { packPartition } from "./partition-wire.js";
import { createHash } from "node:crypto";
import { query, cache } from "./postgres.js";
import { cacheHeaders, matchesEtag, noStoreHeaders } from "./cache-policy.js";
import { serializeJson, responseBytes } from "./metrics.js";
const id = /^m_[A-Za-z0-9]{6}$/,
  league = /^l_[A-Za-z0-9]{6}$/,
  season = /^\d{4}(?:\/\d{4})?$/;
const globalState =
  "SELECT generation::text AS version, published_at FROM statarena_app.publications WHERE singleton";
// The writer commits each partition's rows, digest and publication generation
// in one transaction. Pending jobs prepare later commits; they do not invalidate
// the last committed read. Every paged read includes its version in the same SQL
// snapshot and rejects a cursor from another generation before returning rows.
const PAGE_TTL = 30;
const digest = (s) => createHash("sha256").update(s).digest("hex");
const camel = (k) => k.replace(/_([a-z])/g, (_, v) => v.toUpperCase());
// Column names come from the backend's typed SQL projections.
const fieldNames = new Map();
export function camelRow(row) {
  const out = Object.create(null);
  for (const field of Object.keys(row)) {
    let key = fieldNames.get(field);
    if (key === undefined) {
      key = camel(field);
      fieldNames.set(field, key);
    }
    out[key] = row[field];
  }
  return out;
}
const tag = (req, version) =>
  'W/"core-v3-' +
  digest(new URL(req.url).pathname + new URL(req.url).search + "|" + version) +
  '"';
// Capability changes must invalidate the manifest even without a publication.
// Keep this representation revision separate from other endpoint validators.
const manifestTag = (req, version) => tag(req, `manifest-v4|${version}`);
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function reject(status, message) {
  throw new ApiError(status, message);
}
export function validateParams(params, allowed) {
  if (
    [...params].some(([k, v]) => !allowed.includes(k) || v.length > 2048) ||
    new Set(params.keys()).size !== params.size
  )
    reject(400, "Paramètres invalides.");
}
export function send(
  req,
  value,
  status = 200,
  { etag, ttl = 0, maxBytes = 0, headers = {} } = {},
) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Data-Source": "AWS",
    ...(ttl > 0 && status === 200 ? cacheHeaders(ttl, 0) : noStoreHeaders),
    ...headers,
  };
  if (etag && status === 200) {
    h.ETag = etag;
    if (matchesEtag(req.headers.get("if-none-match"), etag))
      return new Response(null, { status: 304, headers: h });
  }
  if (req.method === "HEAD") return new Response(null, { status, headers: h });
  const body = serializeJson(value),
    bytes = Buffer.byteLength(body);
  if (maxBytes && bytes > maxBytes)
    return send(
      req,
      {
        error: {
          code: "PAGE_TOO_LARGE",
          message: "Réduisez la taille de page.",
        },
      },
      413,
    );
  responseBytes(body);
  return new Response(body, {
    status,
    headers: { ...h, "Content-Length": String(bytes) },
  });
}
const dateOk = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
function pageArgs(p, defaultLimit, scope) {
  const raw = p.get("limit") ?? String(defaultLimit),
    limit = Number(raw);
  if (!/^[1-9]\d{0,2}$/.test(raw) || limit > 100)
    reject(400, "Taille de page invalide.");
  const fingerprint = digest(JSON.stringify([scope, limit]));
  let cursor = null;
  if (p.has("cursor")) {
    try {
      const str = p.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(str)) throw Error();
      cursor = JSON.parse(Buffer.from(str, "base64url").toString());
      if (
        cursor.scope !== fingerprint ||
        !id.test(cursor.id) ||
        !(cursor.day === null || dateOk(cursor.day)) ||
        typeof cursor.generation !== "string" ||
        cursor.generation.length > 80
      )
        throw Error();
    } catch {
      reject(400, "Curseur invalide.");
    }
  }
  return { limit, cursor, fingerprint };
}
function nextPage(rows, state, args) {
  if (args.cursor && args.cursor.generation !== state.version)
    reject(409, "La publication a changé. Rechargez la première page.");
  const last = rows[args.limit - 1];
  const nextCursor =
    rows.length > args.limit
      ? Buffer.from(
          JSON.stringify({
            scope: args.fingerprint,
            generation: state.version,
            day: last.day,
            id: last.id,
          }),
        ).toString("base64url")
      : null;
  return { limit: args.limit, nextCursor, generation: state.version };
}
function keyset(alias, dayParam, idParam, order = "asc") {
  const comparison = order === "desc" ? "<" : ">";
  return `(${alias}.day ${comparison} ${dayParam}::date OR (${alias}.day IS NULL AND ${dayParam}::date IS NOT NULL)
 OR (${alias}.day IS NOT DISTINCT FROM ${dayParam}::date AND ${alias}.id ${comparison} ${idParam}))`;
}
const jsonRows = (sql, projection = "r") =>
  `(SELECT coalesce(json_agg(${projection}),'[]'::json) FROM (${sql}) r)`;
// Keep each child read tied to one indexed match key. The ordered lateral
// subquery bounds work to the page even as historical seasons accumulate.
const byPage = (table, order, fields = "r.*") =>
  jsonRows(`SELECT ${fields} FROM page p CROSS JOIN LATERAL (
    SELECT * FROM statarena_app.${table} WHERE match_id=p.id ORDER BY ${order}
  ) r ORDER BY r.match_id,${order
    .split(",")
    .map((key) => "r." + key.trim())
    .join(",")}`);
// Migration 003's appearance columns, in their published order. A newer table
// layout travels as named records until its positional representation is reviewed.
// The reviewed, generated performance cohort key is internal to SQL and does
// not change this public wire layout. All other added columns keep the fallback.
const appearanceColumns =
  `id player_ref ordinal position_id_type player_id team_id team match_id league_id
league country season date role position_id raw_pitch_x raw_pitch_y shirt_number
minutes rating goals assists xg npxg xa xgot shots shots_on_target chances_created
big_chances_created passes_accurate defensive_actions interceptions tackles
recoveries duels_won duels_lost touches touches_box passes_final_third clearances
blocks dribbles saves goals_prevented shots_off_target blocked_shots shots_woodwork
shot_accuracy big_chances_missed xg_plus_xa long_balls_accurate line_breaking_passes
accurate_crosses corners throws offsides dispossessed dribbled_past headed_clearances
aerials_won ground_duels_won fouls was_fouled errors_led_to_goal goals_conceded
saves_inside_box dive_saves sweeper_actions high_claims punches xgot_faced
distance_covered top_speed sprints running_distance sprinting_distance fantasy_points
passes_attempted long_balls_attempted crosses_attempted ground_duels aerial_duels
dribbles_attempted starter stats_reliable is_captain`.split(/\s+/);
const appearanceFields = [
  ...appearanceColumns,
  "name",
  "image_url",
  "extras",
  "shirt_number_raw",
  "shirt_number_type",
];
const appearanceProjection = `CASE WHEN (
  SELECT array_agg(attname ORDER BY attnum) = ARRAY[${appearanceColumns.map((key) => `'${key}'`).join(",")}]::name[]
  FROM pg_catalog.pg_attribute
  WHERE attrelid='statarena_app.appearances'::regclass AND attnum>0 AND NOT attisdropped
    AND NOT (attname='performance_group' AND attgenerated='s')
) THEN json_build_array(${appearanceFields.map((key) => "r." + key).join(",")})
  ELSE row_to_json(r) END`;
const appearanceOutput = appearanceFields
  .map((field, index) => ({ field, index, key: camel(field) }))
  .filter(
    ({ field }) =>
      ![
        "extras",
        "ordinal",
        "player_ref",
        "position_id",
        "position_id_type",
        "shirt_number_raw",
        "shirt_number_type",
      ].includes(field),
  );
const extrasIndex = appearanceFields.indexOf("extras");
const positionIndex = appearanceFields.indexOf("position_id");
const positionTypeIndex = appearanceFields.indexOf("position_id_type");
const shirtIndex = appearanceFields.indexOf("shirt_number");
const shirtRawIndex = appearanceFields.indexOf("shirt_number_raw");
const shirtTypeIndex = appearanceFields.indexOf("shirt_number_type");
export function appearanceRecord(row) {
  if (!Array.isArray(row)) {
    const {
      extras,
      ordinal,
      player_ref,
      position_id,
      position_id_type,
      performance_group,
      shirt_number_raw,
      shirt_number_type,
      ...values
    } = row;
    return {
      ...camelRow(values),
      ...extras,
      positionId: nativeScalar(position_id, position_id_type),
      shirtNumber:
        shirt_number_type == null
          ? row.shirt_number
          : nativeScalar(shirt_number_raw, shirt_number_type),
    };
  }
  if (row.length !== appearanceFields.length)
    throw Error("Unexpected appearance projection");
  const record = Object.create(null);
  for (const { key, index } of appearanceOutput) record[key] = row[index];
  Object.assign(record, row[extrasIndex]);
  record.positionId = nativeScalar(row[positionIndex], row[positionTypeIndex]);
  record.shirtNumber =
    row[shirtTypeIndex] == null
      ? row[shirtIndex]
      : nativeScalar(row[shirtRawIndex], row[shirtTypeIndex]);
  return record;
}
function nativeScalar(value, kind) {
  if (value == null || kind === "NoneType") return null;
  if (kind === "int" || kind === "float") return Number(value);
  if (kind === "bool") return value === "True";
  return value;
}
export function fixture(row) {
  const team = (side) => ({
    id: row[side + "_team_id"],
    name: row[side + "_name"],
    image_url: row[side + "_image_url"],
  });
  return {
    id: row.id,
    season: row.native_season ?? row.season,
    date: row.day,
    time_utc: row.time_utc,
    status: row.status,
    round_name: row.round_name,
    has_playoff: row.has_playoff,
    home_team: team("home"),
    away_team: team("away"),
    league: {
      id: row.league_id,
      name: row.league_name,
      image_url: row.league_image_url,
    },
    score_home: row.score_home,
    score_away: row.score_away,
    score_penalty_home: row.score_penalty_home,
    score_penalty_away: row.score_penalty_away,
  };
}
export function competition(row) {
  const {
    latest_season,
    competition_id,
    season: year,
    sample_matches,
    catalog_seasons,
    ...c
  } = row;
  return {
    ...camelRow(c),
    seasons: catalog_seasons ?? (year ? [year] : []),
    ...(year && {
      sampleSeasons: sample_matches ? [year] : [],
      sampleMatches: sample_matches,
    }),
  };
}
export function assembleMatches(data) {
  const grouped = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return m;
  };
  const shots = grouped(data.shots, "match_id"),
    stats = grouped(data.stats, "match_id"),
    cover = grouped(data.cover, "match_id"),
    warnings = grouped(data.warnings, "match_id"),
    members = grouped(data.players, "match_id");
  return data.matches.map((r) => {
    const match = {
      id: r.id,
      season: r.season,
      leagueId: r.league_id,
      league: r.league,
      country: r.country,
      date: r.date,
      timeUtc: r.time_utc,
      status: r.status,
      roundName: r.round_name,
      hasPlayoff: r.has_playoff,
    };
    for (const k of ["referee", "stadium"])
      match[k] = r[k + "_object"] ? { id: r[k + "_id"], name: r[k] } : r[k];
    for (const side of ["home", "away"])
      match[side] = Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => k.startsWith(side + "_"))
          .map(([k, v]) => [camel(k.slice(side.length + 1)), v]),
      );
    match.shots = (shots.get(r.id) || []).map(({ match_id, ordinal, ...s }) =>
      camelRow(s),
    );
    const raw = (v, t) =>
      v == null
        ? v
        : t === "int" || t === "float"
          ? Number(v)
          : t === "bool"
            ? v === "True"
            : v;
    match.stats = (stats.get(r.id) || []).map((s) => ({
      key: s.metric_key,
      label: s.label,
      home: s.home_value,
      away: s.away_value,
      homeRaw: raw(s.home_raw, s.home_raw_type),
      awayRaw: raw(s.away_raw, s.away_raw_type),
      format: s.format,
      reliable: s.reliable,
    }));
    match.coverage = Object.fromEntries(
      (cover.get(r.id) || []).map((c) => [c.coverage_key, c.flag ?? c.count]),
    );
    for (const [key, kind] of [
      ["warnings", "warning"],
      ["warningCodes", "code"],
    ])
      match[key] = (warnings.get(r.id) || [])
        .filter((w) => w.kind === kind)
        .map((w) => w.value);
    match.detailCollected = r.detail_collected;
    match.players = (members.get(r.id) || []).map((p) => p.appearance_id);
    return match;
  });
}
async function globalValidator(req, ttl, etagFor = tag) {
  if (req.method !== "HEAD" && !req.headers.has("if-none-match")) return null;
  const [m] = await query(globalState);
  if (!m) reject(503, "Publication indisponible.");
  const etag = etagFor(req, m.version);
  return req.method === "HEAD" ||
    matchesEtag(req.headers.get("if-none-match"), etag)
    ? send(req, null, 200, { etag, ttl })
    : null;
}
export async function manifest(req) {
  const validated = await globalValidator(req, 15, manifestTag);
  if (validated) return validated;
  const [r] =
    await query(`SELECT g.*, ${jsonRows("SELECT p.season,p.league_id,p.source_digest,p.retrieved_at,p.start_date,p.end_date,p.published_at,(SELECT json_object_agg(metric_key,value) FROM statarena_app.partition_counts c WHERE c.season=p.season AND c.league_id=p.league_id) AS counts FROM statarena_app.partitions p ORDER BY p.season DESC,p.league_id")} partitions,
 ${jsonRows("SELECT c.*,(SELECT json_agg(native_season ORDER BY ordinal) FROM statarena_app.competition_catalog_seasons k WHERE k.competition_id=c.id) catalog_seasons FROM statarena_app.competitions c ORDER BY name,id")} competitions,
 (SELECT json_object_agg(id,country) FROM statarena_app.teams WHERE country IS NOT NULL) countries FROM (${globalState}) g`);
  if (!r) reject(503, "Publication indisponible.");
  const catalog = r.competitions.map(competition),
    byId = new Map(catalog.map((c) => [c.id, c])),
    seasons = new Map();
  for (const p of r.partitions) {
    if (!seasons.has(p.season))
      seasons.set(p.season, { id: p.season, chunks: [] });
    const c = byId.get(p.league_id);
    seasons.get(p.season).chunks.push({
      leagueId: p.league_id,
      sourceDigest: p.source_digest,
      meta: {
        ...(p.counts || {}),
        retrievedAt: p.retrieved_at,
        startDate: p.start_date,
        endDate: p.end_date,
        publishedAt: p.published_at,
      },
      competitions: c
        ? [
            {
              ...c,
              sampleMatches: p.counts?.matchCount ?? 0,
              sampleSeasons: p.counts?.matchCount ? [p.season] : [],
            },
          ]
        : [],
    });
  }
  return send(
    req,
    {
      schemaVersion: 4,
      storage: "aws-relational",
      capabilities: {
        boundedSearch: true,
        fixturePaginationOrder: true,
        versionedPartitions: true,
        playerRatingRanking: true,
        actorSummary: true,
        resolvedMedia: true,
        boundedArchive: true,
        compactReads: {
          home: true,
          players: true,
          clubs: true,
          player: true,
          club: true,
          performance: true,
          discipline: true,
        },
      },
      defaultSeason: [...seasons.keys()][0] || null,
      retrievedAt: r.published_at,
      publishedAt: r.published_at,
      publicationVersion: r.version,
      seasons: [...seasons.values()],
      competitions: catalog,
      clubCountries: r.countries || {},
      scouting: { version: 2, sourceDigest: r.version },
    },
    200,
    { etag: manifestTag(req, r.version), ttl: 15 },
  );
}
export async function partitionPage(req, p) {
  validateParams(p, ["season", "league", "limit", "cursor", "format", "v"]);
  const columns = p.get("format") === "columns";
  if (p.has("format") && !columns) reject(400, "Format invalide.");
  const y = p.get("season"),
    l = p.get("league"),
    expectedVersion = p.get("v");
  if (!season.test(y) || !league.test(l))
    reject(400, "Saison ou compétition invalide.");
  if (p.has("v") && !/^[a-f0-9]{64}$/.test(expectedVersion))
    reject(400, "Version de partition invalide.");
  const checkVersion = (state) => {
    if (expectedVersion && state.version !== expectedVersion)
      reject(409, "La publication a changé. Rechargez le catalogue.");
  };
  const args = pageArgs(
      p,
      25,
      columns ? ["partition", y, l, "columns"] : ["partition", y, l],
    ),
    c = args.cursor;
  const metaSql = `SELECT p.*,source_digest AS version FROM statarena_app.partitions p WHERE season=$1 AND league_id=$2`;
  if (req.method === "HEAD" || req.headers.has("if-none-match")) {
    const [m] = await query(metaSql, [y, l]);
    if (!m) reject(404, "Partition introuvable.");
    checkVersion(m);
    nextPage([], m, args);
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag(req, m.version))
    )
      return send(req, null, 200, { etag: tag(req, m.version), ttl: PAGE_TTL });
  }
  const binds = [y, l, args.limit];
  if (c) binds.push(c.day, c.id);
  const pred = (a) => (c ? " AND " + keyset(a, "$4", "$5") : "");
  const [r] = await query(
    `WITH candidates AS (
 (SELECT f.id,f.day FROM statarena_app.fixtures f WHERE f.season=$1 AND f.league_id=$2 ${pred("f")} ORDER BY f.day NULLS LAST,f.id LIMIT ($3::int+1))
 UNION ALL (SELECT m.id,m.day FROM statarena_app.matches m WHERE m.season=$1 AND m.league_id=$2 ${pred("m")}
 AND NOT EXISTS(SELECT 1 FROM statarena_app.fixtures f WHERE f.id=m.id AND f.season=m.season AND f.league_id=m.league_id)
 ORDER BY m.day NULLS LAST,m.id LIMIT ($3::int+1))),
 keys AS (SELECT * FROM candidates ORDER BY day NULLS LAST,id LIMIT ($3::int+1)), page AS (SELECT id FROM keys ORDER BY day NULLS LAST,id LIMIT $3),
 page_appearances AS MATERIALIZED (
 SELECT a.*,p.name,p.image_url,s.value_text AS shirt_number_raw,s.value_type AS shirt_number_type
 FROM page k CROSS JOIN LATERAL (
   SELECT * FROM statarena_app.appearances
   WHERE match_id=k.id AND season=$1 AND league_id=$2 ORDER BY ordinal,id
 ) a JOIN statarena_app.players p ON p.id=a.player_ref
 LEFT JOIN statarena_app.appearance_shirt_numbers s ON s.appearance_id=a.id
 ),
 appearance_extras AS (
 SELECT e.appearance_id,json_object_agg(e.metric_key,e.value ORDER BY e.metric_key) extras
 FROM statarena_app.appearance_metrics e JOIN page_appearances a ON a.id=e.appearance_id GROUP BY e.appearance_id)
 SELECT s.*, ${jsonRows("SELECT id,day::text FROM keys ORDER BY day NULLS LAST,id")} keys,
 ${jsonRows("SELECT m.* FROM statarena_app.matches m JOIN page USING(id) ORDER BY m.day NULLS LAST,m.id")} matches,
 ${jsonRows("SELECT f.* FROM statarena_app.fixtures f JOIN page USING(id) ORDER BY f.day NULLS LAST,f.id")} fixtures,
 ${jsonRows("SELECT a.*,e.extras FROM page_appearances a LEFT JOIN appearance_extras e ON e.appearance_id=a.id ORDER BY a.match_id,a.ordinal,a.id", appearanceProjection)} appearances,
 ${byPage("shots", "ordinal,id")} shots,
 ${byPage("team_statistics", "ordinal")} stats,
 ${byPage("match_coverage", "coverage_key")} cover,
 ${byPage("match_appearance_members", "ordinal", "r.match_id,r.appearance_id")} players,
 ${byPage("match_warnings", "ordinal")} warnings,
 ${jsonRows("SELECT m.metric_key AS key,m.label,m.unit,m.decimals FROM statarena_app.partition_metrics pm JOIN statarena_app.metric_definitions m USING(metric_key) WHERE pm.season=$1 AND pm.league_id=$2 ORDER BY pm.ordinal")} metrics,
 ${jsonRows("SELECT c.*,s.season,s.sample_matches,(SELECT json_agg(native_season ORDER BY ordinal) FROM statarena_app.competition_catalog_seasons k WHERE k.competition_id=c.id) catalog_seasons FROM statarena_app.competitions c JOIN statarena_app.competition_seasons s ON s.competition_id=c.id WHERE c.id=$2 AND s.season=$1")} competitions,
 ${jsonRows("SELECT s.team_id AS id,s.name,s.image_url,s.sample_matches,t.country FROM statarena_app.team_seasons s JOIN statarena_app.teams t ON s.team_id=t.id WHERE season=$1 AND league_id=$2 ORDER BY s.team_id")} teams,
 (SELECT json_object_agg(metric_key,value) FROM statarena_app.partition_counts WHERE season=$1 AND league_id=$2) counts,
 (SELECT json_agg(note ORDER BY ordinal) FROM statarena_app.partition_notes WHERE season=$1 AND league_id=$2) notes FROM (${metaSql}) s`,
    binds,
  );
  if (!r) reject(404, "Partition introuvable.");
  checkVersion(r);
  const pagination = nextPage(r.keys, r, args);
  const data = {
    meta: {
      ...r.counts,
      source: r.source,
      retrievedAt: r.retrieved_at,
      currentSeason: y,
      ratingSource: r.rating_source,
      rankingAvailable: r.ranking_available,
      startDate: r.start_date,
      endDate: r.end_date,
      notes: r.notes || [],
    },
    metrics: r.metrics,
    competitions: r.competitions.map(competition),
    teams: r.teams.map((t) => ({
      ...camelRow(t),
      seasons: [y],
      leagueIds: [l],
    })),
    fixtures: r.fixtures.map(fixture),
    matches: assembleMatches(r),
    appearances: r.appearances.map(appearanceRecord),
  };
  return send(
    req,
    { data: columns ? packPartition(data) : data, pagination },
    200,
    {
      etag: tag(req, r.version),
      ttl: PAGE_TTL,
      maxBytes: 2 * 1024 * 1024,
    },
  );
}

function list(p, key, pattern, max) {
  const raw = p.get(key) || "",
    values = raw ? raw.split(",") : [];
  if (values.length > max || values.some((v) => !pattern.test(v)))
    reject(400, "Identifiants invalides.");
  return [...new Set(values)].sort();
}
export async function fixturePage(req, p, { legacy = false } = {}) {
  validateParams(p, [
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
    "order",
  ]);
  if (
    (p.has("league") && p.has("leagues")) ||
    (p.has("season") && p.has("seasons"))
  )
    reject(400, "Filtres incompatibles.");
  const leagues = list(p, p.has("league") ? "league" : "leagues", league, 100),
    seasons = list(p, p.has("season") ? "season" : "seasons", season, 2);
  const status = p.get("status") || "all",
    order = p.get("order") || "asc",
    from = p.get("from"),
    to = p.get("to"),
    q = p.get("q") || "";
  if (
    !["all", "played", "upcoming"].includes(status) ||
    !["asc", "desc"].includes(order) ||
    (from && !dateOk(from)) ||
    (to && !dateOk(to)) ||
    (from && to && from > to) ||
    q.length > 200
  )
    reject(400, "Filtres invalides.");
  const args = pageArgs(p, 50, [
      "fixtures",
      leagues,
      seasons,
      status,
      from,
      to,
      q,
      ...(order === "desc" ? [order] : []),
    ]),
    binds = [],
    terms = [];
  const bind = (v) => {
    binds.push(v);
    return "$" + binds.length;
  };
  if (leagues.length)
    terms.push("league_id=ANY(" + bind(leagues) + "::text[])");
  if (seasons.length) {
    const k = bind(seasons);
    terms.push(
      "(season=ANY(" + k + "::text[]) OR native_season=ANY(" + k + "::text[]))",
    );
  }
  if (status !== "all")
    terms.push(
      status === "played" ? "status='finished'" : "status='not_started'",
    );
  if (from) terms.push("day>=" + bind(from) + "::date");
  if (to) terms.push("day<=" + bind(to) + "::date");
  if (q) {
    const like =
      "%" +
      q
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\\%_]/g, "\\$&") +
      "%";
    terms.push(
      "regexp_replace(normalize(lower(concat_ws(' ',home_name,away_name,league_name)),NFD),'[̀-ͯ]','','g') LIKE " +
        bind(like),
    );
  }
  if (args.cursor)
    terms.push(keyset("f", bind(args.cursor.day), bind(args.cursor.id), order));
  const isMeta = req.method === "HEAD" || req.headers.has("if-none-match");
  if (isMeta) {
    const [g] = await query(globalState);
    if (!g) reject(503, "Publication indisponible.");
    nextPage([], g, args);
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag(req, g.version))
    )
      return send(req, null, 200, { etag: tag(req, g.version), ttl: PAGE_TTL });
  }
  const sql =
    "SELECT * FROM statarena_app.fixtures f " +
    (terms.length ? "WHERE " + terms.join(" AND ") : "") +
    ` ORDER BY day ${order.toUpperCase()} NULLS LAST,id ${order.toUpperCase()}` +
    (legacy ? "" : " LIMIT " + bind(args.limit + 1));
  const [r] = await query(
    `SELECT g.*,${jsonRows(sql)} AS rows FROM (${globalState}) g`,
    binds,
  );
  if (!r) reject(503, "Publication indisponible.");
  const pagination = nextPage(r.rows, r, args),
    matches = (legacy ? r.rows : r.rows.slice(0, args.limit)).map(fixture);
  return send(
    req,
    legacy ? { data: { matches } } : { data: { matches }, pagination },
    200,
    { etag: tag(req, r.version), ttl: PAGE_TTL, maxBytes: 2 * 1024 * 1024 },
  );
}
export async function scouting(req, p) {
  validateParams(p, ["player", "team"]);
  const players = list(p, "player", /^p_[A-Za-z0-9]{6}$/, 8),
    teams = list(p, "team", /^t_[A-Za-z0-9]{6}$/, 8);
  if (!players.length && !teams.length)
    reject(400, "Précisez les identifiants.");
  const validated = await globalValidator(req, 30);
  if (validated) return validated;
  const [r] = await query(
    `SELECT g.*,${jsonRows("SELECT DISTINCT player_id AS id,season,league_id FROM statarena_app.appearances WHERE player_id=ANY($1::text[]) ORDER BY 1,2,3")} players,
 ${jsonRows("SELECT team_id AS id,season,league_id FROM statarena_app.team_seasons WHERE team_id=ANY($2::text[]) UNION SELECT home_team_id,season,league_id FROM statarena_app.fixtures WHERE home_team_id=ANY($2::text[]) UNION SELECT away_team_id,season,league_id FROM statarena_app.fixtures WHERE away_team_id=ANY($2::text[]) ORDER BY 1,2,3")} teams FROM (${globalState}) g`,
    [players, teams],
  );
  if (!r) reject(503, "Publication indisponible.");
  const group = (rows) => {
    const out = {};
    for (const row of rows) {
      if (row.league_id)
        ((out[row.id] ??= {})[row.season] ??= []).push(row.league_id);
    }
    return out;
  };
  return send(
    req,
    { routes: group(r.players), clubRoutes: group(r.teams) },
    200,
    { etag: tag(req, r.version), ttl: 30 },
  );
}
const summaries = cache(8 * 1024 * 1024, {
  name: "summary",
  maxEntryBytes: 256 * 1024,
});
export async function summary(req, mid) {
  const base = `SELECT p.source_digest AS version, EXISTS(SELECT 1 FROM statarena_app.matches WHERE id=$1) AS has_match, EXISTS(SELECT 1 FROM statarena_app.publication_jobs j WHERE j.season=p.season AND j.league_id=p.league_id) dirty FROM
 (SELECT season,league_id FROM statarena_app.matches WHERE id=$1 UNION SELECT season,league_id FROM statarena_app.fixtures WHERE id=$1) t
 JOIN statarena_app.partitions p USING(season,league_id) ORDER BY p.published_at DESC LIMIT 1`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [m] = await query(base, [mid]);
    if (!m) reject(404, "Match introuvable.");
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag(req, m.version))
    )
      return send(req, null, 200, {
        etag: tag(req, m.version),
        ttl: m.dirty || !m.has_match ? 0 : 15,
      });
    const load = async () => {
      const [r] = await query(
        `SELECT s.*,
 ${jsonRows("SELECT * FROM statarena_app.matches WHERE id=$1")} matches,
 ${jsonRows("SELECT * FROM statarena_app.fixtures WHERE id=$1")} fixtures,
 ${jsonRows("SELECT match_id,id,team_id,player_id,player_name,minute,minute_added,period,xg,is_goal,is_own_goal FROM statarena_app.shots WHERE match_id=$1 ORDER BY ordinal,id")} shots,
 ${jsonRows("SELECT * FROM statarena_app.team_statistics WHERE match_id=$1 AND metric_key IN ('expected_goals','total_shots','ShotsOnTarget','BallPossesion','big_chance','corners') ORDER BY ordinal")} stats,
 ${jsonRows("SELECT * FROM statarena_app.match_coverage WHERE match_id=$1")} cover,
 ${jsonRows("SELECT * FROM statarena_app.match_warnings WHERE match_id=$1 ORDER BY ordinal")} warnings,
 ${jsonRows("SELECT a.id,a.player_id,a.match_id,a.team_id,a.team,p.name,p.image_url,a.minutes,a.rating,a.goals,a.assists FROM statarena_app.appearances a JOIN statarena_app.players p ON a.player_ref=p.id WHERE match_id=$1 AND minutes>0 AND rating IS NOT NULL ORDER BY rating DESC,a.id LIMIT 5")} leaders
 FROM (${base}) s WHERE s.version=$2`,
        [mid, m.version],
      );
      if (!r) {
        const error = new Error("Publication changée.");
        error.code = "ESTALE";
        throw error;
      }
      let match = assembleMatches(r)[0],
        state = "ready";
      if (!match) {
        const f = fixture(r.fixtures[0]);
        match = {
          id: f.id,
          leagueId: f.league.id,
          league: f.league.name,
          season: f.season,
          date: f.date,
          timeUtc: f.time_utc,
          status: f.status,
          home: {
            ...f.home_team,
            imageUrl: f.home_team.image_url,
            score: f.score_home,
          },
          away: {
            ...f.away_team,
            imageUrl: f.away_team.image_url,
            score: f.score_away,
          },
          shots: [],
          stats: [],
          coverage: {},
          warnings: [],
        };
        state = "pending";
      }
      delete match.players;
      match.summaryVersion = 1;
      match.leadingPlayers = r.leaders.map(camelRow);
      return { data: { version: 1, state, match } };
    };
    try {
      const value = m.dirty
        ? await load()
        : await summaries(mid + ":" + m.version, load, 15 * 60 * 1000);
      return send(req, value, 200, {
        etag: tag(req, m.version),
        maxBytes: 256 * 1024,
        ttl: m.dirty || value.data.state !== "ready" ? 0 : 15,
      });
    } catch (error) {
      if (error.code !== "ESTALE" || attempt) throw error;
    }
  }
}
