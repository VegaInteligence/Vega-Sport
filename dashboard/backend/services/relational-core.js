import { packPartition } from "./partition-wire.js";
import { createHash } from "node:crypto";
import { query, cache } from "./postgres.js";
import { cacheHeaders, matchesEtag, noStoreHeaders } from "./cache-policy.js";
import { serializeJson, responseBytes } from "./metrics.js";
const id = /^m_[A-Za-z0-9]{6}$/,
  league = /^l_[A-Za-z0-9]{6}$/,
  season = /^\d{4}(?:\/\d{4})?$/;
const globalState =
  "SELECT generation::text AS version, published_at, EXISTS(SELECT 1 FROM statarena_app.publication_jobs) AS dirty FROM statarena_app.publications WHERE singleton";
const digest = (s) => createHash("sha256").update(s).digest("hex");
const camel = (k) => k.replace(/_([a-z])/g, (_, v) => v.toUpperCase());
const camelRow = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
const tag = (req, version) =>
  'W/"core-v1-' +
  digest(new URL(req.url).pathname + new URL(req.url).search + "|" + version) +
  '"';
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
function keyset(alias, dayParam, idParam) {
  return `(${alias}.day > ${dayParam}::date OR (${alias}.day IS NULL AND ${dayParam}::date IS NOT NULL)
 OR (${alias}.day IS NOT DISTINCT FROM ${dayParam}::date AND ${alias}.id > ${idParam}))`;
}
const jsonRows = (sql) =>
  `(SELECT coalesce(json_agg(r),'[]'::json) FROM (${sql}) r)`;
const byPage = (sql) =>
  jsonRows(sql + " WHERE match_id IN (SELECT id FROM page)");
function nativePositionId(value, kind) {
  if (value == null || kind === "NoneType") return null;
  if (kind === "int" || kind === "float") return Number(value);
  if (kind === "bool") return value === "True";
  return value;
}
function fixture(row) {
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
function competition(row) {
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
function assembleMatches(data) {
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
async function globalValidator(req, ttl) {
  if (req.method !== "HEAD" && !req.headers.has("if-none-match")) return null;
  const [m] = await query(globalState);
  if (!m) reject(503, "Publication indisponible.");
  const etag = tag(req, m.version);
  return req.method === "HEAD" ||
    matchesEtag(req.headers.get("if-none-match"), etag)
    ? send(req, null, 200, { etag, ttl: m.dirty ? 0 : ttl })
    : null;
}
export async function manifest(req) {
  const validated = await globalValidator(req, 15);
  if (validated) return validated;
  const [r] =
    await query(`SELECT g.*, ${jsonRows("SELECT p.season,p.league_id,p.source_digest,p.retrieved_at,(SELECT json_object_agg(metric_key,value) FROM statarena_app.partition_counts c WHERE c.season=p.season AND c.league_id=p.league_id) AS counts FROM statarena_app.partitions p ORDER BY p.season DESC,p.league_id")} partitions,
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
      meta: p.counts || {},
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
      defaultSeason: [...seasons.keys()][0] || null,
      retrievedAt: r.published_at,
      seasons: [...seasons.values()],
      competitions: catalog,
      clubCountries: r.countries || {},
      scouting: { version: 2, sourceDigest: r.version },
    },
    200,
    { etag: tag(req, r.version), ttl: r.dirty ? 0 : 15 },
  );
}
export async function partitionPage(req, p) {
  validateParams(p, ["season", "league", "limit", "cursor", "format"]);
  const columns = p.get("format") === "columns";
  if (p.has("format") && !columns) reject(400, "Format invalide.");
  const y = p.get("season"),
    l = p.get("league");
  if (!season.test(y) || !league.test(l))
    reject(400, "Saison ou compétition invalide.");
  const args = pageArgs(
      p,
      25,
      columns ? ["partition", y, l, "columns"] : ["partition", y, l],
    ),
    c = args.cursor;
  const metaSql = `SELECT p.*,source_digest AS version, EXISTS(SELECT 1 FROM statarena_app.publication_jobs j WHERE j.season=p.season AND j.league_id=p.league_id) dirty FROM statarena_app.partitions p WHERE season=$1 AND league_id=$2`;
  if (req.method === "HEAD" || req.headers.has("if-none-match")) {
    const [m] = await query(metaSql, [y, l]);
    if (!m) reject(404, "Partition introuvable.");
    nextPage([], m, args);
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag(req, m.version))
    )
      return send(req, null, 200, { etag: tag(req, m.version) });
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
 keys AS (SELECT * FROM candidates ORDER BY day NULLS LAST,id LIMIT ($3::int+1)), page AS (SELECT id FROM keys ORDER BY day NULLS LAST,id LIMIT $3)
 SELECT s.*, ${jsonRows("SELECT id,day::text FROM keys ORDER BY day NULLS LAST,id")} keys,
 ${jsonRows("SELECT m.* FROM statarena_app.matches m JOIN page USING(id) ORDER BY m.day NULLS LAST,m.id")} matches,
 ${jsonRows("SELECT f.* FROM statarena_app.fixtures f JOIN page USING(id) ORDER BY f.day NULLS LAST,f.id")} fixtures,
 ${jsonRows("SELECT a.*,p.name,p.image_url,(SELECT json_object_agg(metric_key,value) FROM statarena_app.appearance_metrics e WHERE e.appearance_id=a.id) extras FROM statarena_app.appearances a JOIN statarena_app.players p ON p.id=a.player_ref WHERE a.match_id IN(SELECT id FROM page) ORDER BY a.match_id,a.ordinal,a.id")} appearances,
 ${jsonRows("SELECT * FROM statarena_app.shots WHERE match_id IN(SELECT id FROM page) ORDER BY match_id,ordinal,id")} shots,
 ${jsonRows("SELECT * FROM statarena_app.team_statistics WHERE match_id IN(SELECT id FROM page) ORDER BY match_id,ordinal")} stats,
 ${byPage("SELECT * FROM statarena_app.match_coverage")} cover,
 ${jsonRows("SELECT match_id,appearance_id FROM statarena_app.match_appearance_members WHERE match_id IN(SELECT id FROM page) ORDER BY match_id,ordinal")} players,
 ${jsonRows("SELECT * FROM statarena_app.match_warnings WHERE match_id IN(SELECT id FROM page) ORDER BY ordinal")} warnings,
 ${jsonRows("SELECT m.metric_key AS key,m.label,m.unit,m.decimals FROM statarena_app.partition_metrics pm JOIN statarena_app.metric_definitions m USING(metric_key) WHERE pm.season=$1 AND pm.league_id=$2 ORDER BY pm.ordinal")} metrics,
 ${jsonRows("SELECT c.*,s.season,s.sample_matches,(SELECT json_agg(native_season ORDER BY ordinal) FROM statarena_app.competition_catalog_seasons k WHERE k.competition_id=c.id) catalog_seasons FROM statarena_app.competitions c JOIN statarena_app.competition_seasons s ON s.competition_id=c.id WHERE c.id=$2 AND s.season=$1")} competitions,
 ${jsonRows("SELECT s.team_id AS id,s.name,s.image_url,s.sample_matches,t.country FROM statarena_app.team_seasons s JOIN statarena_app.teams t ON s.team_id=t.id WHERE season=$1 AND league_id=$2 ORDER BY s.team_id")} teams,
 (SELECT json_object_agg(metric_key,value) FROM statarena_app.partition_counts WHERE season=$1 AND league_id=$2) counts,
 (SELECT json_agg(note ORDER BY ordinal) FROM statarena_app.partition_notes WHERE season=$1 AND league_id=$2) notes FROM (${metaSql}) s`,
    binds,
  );
  if (!r) reject(404, "Partition introuvable.");
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
    appearances: r.appearances.map(
      ({
        extras,
        ordinal,
        player_ref,
        position_id,
        position_id_type,
        ...a
      }) => ({
        ...camelRow(a),
        ...extras,
        positionId: nativePositionId(position_id, position_id_type),
      }),
    ),
  };
  return send(
    req,
    { data: columns ? packPartition(data) : data, pagination },
    200,
    {
      etag: tag(req, r.version),
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
  ]);
  if (
    (p.has("league") && p.has("leagues")) ||
    (p.has("season") && p.has("seasons"))
  )
    reject(400, "Filtres incompatibles.");
  const leagues = list(p, p.has("league") ? "league" : "leagues", league, 100),
    seasons = list(p, p.has("season") ? "season" : "seasons", season, 2);
  const status = p.get("status") || "all",
    from = p.get("from"),
    to = p.get("to"),
    q = p.get("q") || "";
  if (
    !["all", "played", "upcoming"].includes(status) ||
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
    terms.push(keyset("f", bind(args.cursor.day), bind(args.cursor.id)));
  const isMeta = req.method === "HEAD" || req.headers.has("if-none-match");
  if (isMeta) {
    const [g] = await query(globalState);
    if (!g) reject(503, "Publication indisponible.");
    nextPage([], g, args);
    if (
      req.method === "HEAD" ||
      matchesEtag(req.headers.get("if-none-match"), tag(req, g.version))
    )
      return send(req, null, 200, { etag: tag(req, g.version) });
  }
  const sql =
    "SELECT * FROM statarena_app.fixtures f " +
    (terms.length ? "WHERE " + terms.join(" AND ") : "") +
    " ORDER BY day NULLS LAST,id" +
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
    { etag: tag(req, r.version), maxBytes: 2 * 1024 * 1024 },
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
    { etag: tag(req, r.version), ttl: r.dirty ? 0 : 30 },
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
