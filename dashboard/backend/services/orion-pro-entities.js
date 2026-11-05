import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";
import { cloudFrontObjectUrl, immutableFile } from "./cdn.js";

// Separate adapter: summary-v1-shots-v1 and its existing DTOs are untouched.
const contract = "entities-v1";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const patterns = {
  players: /^p_[A-Za-z0-9]{6}$/,
  teams: /^t_[A-Za-z0-9]{6}$/,
  leagues: /^l_[A-Za-z0-9]{6}$/,
};
const tokenPattern = /^pro1\.([1-9][0-9]{0,18})\.([a-f0-9]{64})$/;
const at = (a, g) =>
  `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) =>
  `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;

function buildId(v, required = false) {
  if (v === null && !required) return null;
  const m = typeof v === "string" && tokenPattern.exec(v);
  if (!m || BigInt(m[1]) > 9223372036854775807n)
    reject(400, "Précisez une version publiée valide.");
  return m[1];
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

const publicationSql = `/*orion:entitypubmeta*/
SELECT b.id::text build_id,b.competition_season_id::text edition_id,
 b.competition_season_revision_id::text edition_revision_id,
 b.dataset_snapshot_id::text dataset_snapshot_id,d.generation::text dataset_generation,
 b.catalog_snapshot_id::text catalog_snapshot_id,c.generation::text catalog_generation,
 b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
 b.metrics_contract_version,b.transform_version,e.season_key AS season,
 co.id::text competition_id,co.revision_id::text competition_revision_id,
 co.name AS league_name,aliases.keys AS league_keys
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
JOIN LATERAL (SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id
 AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id
 AND p.representation_version=b.representation_version
 AND ($1::bigint IS NOT NULL OR p.published_to_gen IS NULL) LIMIT 1) publication ON true
JOIN football.competition_seasons e ON e.id=b.competition_season_id
 AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
JOIN football.competitions co ON co.id=e.competition_id AND ${selected("co", "c.generation")}
LEFT JOIN LATERAL (SELECT array_agg(a.public_key ORDER BY a.public_key) keys
 FROM ingest.public_aliases a WHERE a.route_kind='competition' AND a.competition_id=e.competition_id
 AND a.public_key ~ '^l_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "c.generation")}) aliases ON true
WHERE b.status='ready' AND ($1::bigint IS NULL OR b.id=$1::bigint)
ORDER BY b.competition_season_id,b.id LIMIT 2049`;

async function publications(v, required = false) {
  const id = buildId(v, required),
    rows = await query(publicationSql, [id]);
  if (
    !rows.length ||
    rows.length > 2048 ||
    new Set(rows.map((r) => r.build_id)).size !== rows.length
  )
    reject(503, "Publication indisponible.");
  for (const row of rows) {
    if (
      row.representation_version !== "summary-v1-shots-v1" ||
      !row.league_keys?.length
    )
      reject(503, "Représentation indisponible.");
    row.token = token(row);
    row.league_id = row.league_keys[0];
  }
  if (v !== null && (rows.length !== 1 || rows[0].token !== v))
    reject(400, "Version invalide.");
  return rows;
}

const generation = (rows) =>
  rows.length === 1
    ? rows[0].token
    : "proset." + digest(JSON.stringify(rows.map((r) => r.token).sort()));
const context = (row) =>
  JSON.stringify([
    {
      build_id: row.build_id,
      edition_id: row.edition_id,
      edition_revision_id: row.edition_revision_id,
      dg: row.dataset_generation,
      cg: row.catalog_generation,
      competition_id: row.competition_id,
    },
  ]);
const contextSql = `SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
 build_id bigint,edition_id bigint,edition_revision_id bigint,dg bigint,cg bigint,competition_id bigint)`;
const scopeSql = `WITH x AS (${contextSql}), matches AS (
 SELECT m.*,x.dg FROM x JOIN analytics.match_summary s ON s.build_id=x.build_id AND s.competition_season_id=x.edition_id
 JOIN football.matches m ON m.id=s.match_id AND m.revision_id=s.match_revision_id
 AND m.competition_season_id=x.edition_id AND m.publication_state='published' AND ${selected("m", "x.dg")}
), team_members AS (
 SELECT mt.team_id,mt.source_id FROM matches m JOIN football.match_teams mt
 ON mt.match_id=m.id AND mt.match_revision_id=m.revision_id AND ${selected("mt", "m.dg")}
 UNION SELECT ct.team_id,ct.source_id FROM x JOIN football.competition_teams ct
 ON ct.competition_season_id=x.edition_id AND ct.competition_season_revision_id=x.edition_revision_id AND ${selected("ct", "x.dg")}
), player_members AS (
 SELECT mp.player_id,mp.source_id FROM matches m JOIN football.match_teams mt
 ON mt.match_id=m.id AND mt.match_revision_id=m.revision_id AND ${selected("mt", "m.dg")}
 JOIN football.match_players mp ON mp.match_id=m.id AND mp.team_id=mt.team_id
 AND mp.match_team_revision_id=mt.revision_id AND ${selected("mp", "m.dg")}
)`;

function tag(req, rows, metadata = null) {
  const u = new URL(req.url),
    params = [...u.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return `W/"orion-entities1-${digest(JSON.stringify([contract, u.pathname, params, generation(rows), metadata]))}"`;
}

function reply(req, value, rows, metadata = null) {
  return send(req, value, 200, {
    etag: tag(req, rows, metadata),
    ttl: 15,
    maxBytes: 2 * 1024 * 1024,
    headers: {
      "X-Orion-Entity-Contract": contract,
      ...(rows.length === 1 ? { "X-Orion-Representation": rows[0].token } : {}),
    },
  });
}

function validated(req, rows, metadata) {
  return req.method === "HEAD" ||
    matchesEtag(req.headers.get("if-none-match"), tag(req, rows, metadata))
    ? reply(req, null, rows, metadata)
    : null;
}

function ids(params, key, pattern) {
  if (!params.has(key)) return [];
  const values = params.get(key).split(",");
  if (
    values.length > 8 ||
    values.some((v) => !pattern.test(v)) ||
    new Set(values).size !== values.length
  )
    reject(400, "Identifiants invalides.");
  return values.sort();
}

// Compare decimal values, including exponent spellings, without a lossy parse.
function decimal(value) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!m) return null;
  const exponent = Number(m[4] || 0) - (m[3]?.length || 0);
  let coefficient = BigInt((m[1] || "") + m[2] + (m[3] || ""));
  let scale = exponent;
  if (coefficient === 0n) return "0";
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale++;
  }
  return `${coefficient}e${scale}`;
}

const absent = Symbol("absent");
function scalar(meta, key) {
  const state = meta[key + "_state"],
    value = meta[key];
  if (state === "absent") return absent;
  if (state === "null") return null;
  if (state === "string" && typeof value === "string") return value;
  if (state === "number") {
    const raw = meta[key + "_source_number"],
      number = Number(raw);
    if (
      raw !== null &&
      Number.isFinite(number) &&
      decimal(raw) === decimal(JSON.stringify(number))
    )
      return number;
  }
  reject(503, "Valeur de profil non représentable.");
}

async function media(assetId, mediaBase) {
  if (assetId === null) return { url: null, fingerprint: null };
  const [asset] = await query(
    `/*orion:entitymediameta*/ SELECT storage_key,content_sha256,content_type
 FROM ingest.media_assets WHERE id=$1::bigint`,
    [assetId],
  );
  const ext = asset?.storage_key?.split(".").at(-1)?.toLowerCase();
  if (
    !asset ||
    !/^[a-f0-9]{64}$/.test(asset.content_sha256 || "") ||
    !immutableFile(asset.storage_key) ||
    !asset.storage_key.endsWith(asset.content_sha256 + "." + ext) ||
    asset.content_type !==
      {
        webp: "image/webp",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
      }[ext]
  )
    reject(503, "Média de profil indisponible.");
  let url;
  try {
    url = cloudFrontObjectUrl(asset.storage_key, mediaBase);
  } catch {
    reject(503, "Média de profil indisponible.");
  }
  return {
    url,
    fingerprint: [
      asset.storage_key,
      asset.content_sha256,
      asset.content_type,
      url,
    ],
  };
}

async function entityMetadata(row, kind, publicId, options) {
  const league = kind === "leagues",
    player = kind === "players";
  const actor = league ? "competition" : player ? "player" : "team";
  const identities = await query(
    `/*orion:entitymeta*/ ${scopeSql}
 SELECT a.${actor}_id::text AS actor_id,
 ${
   league
     ? "ARRAY[]::text[]"
     : `(SELECT array_agg(DISTINCT s.source_id::text ORDER BY s.source_id::text)
 FROM ${player ? "player_members" : "team_members"} s WHERE s.${actor}_id=a.${actor}_id AND s.source_id IS NOT NULL)`
 } AS sources
 FROM x JOIN ingest.public_aliases a ON a.route_kind=$2 AND a.public_key=$3 AND ${aliasAt("a", "x.cg")}
 WHERE ${league ? "a.competition_id=x.competition_id" : `EXISTS(SELECT 1 FROM ${player ? "player_members" : "team_members"} members WHERE members.${actor}_id=a.${actor}_id)`}`,
    [context(row), actor, publicId],
  );
  if (!identities.length)
    reject(404, "Profil indisponible dans cette édition.");
  if (identities.length !== 1) reject(503, "Identité publique ambiguë.");
  const identity = identities[0];
  let winner;
  if (league) {
    const records = await query(
      `/*orion:entityprofilemeta*/ SELECT c.revision_id::text AS profile_id,c.image_asset_id::text
 FROM football.competitions c WHERE c.id=$1::bigint AND ${selected("c", "$2::bigint")}`,
      [identity.actor_id, row.catalog_generation],
    );
    if (records.length !== 1)
      reject(503, "Compétition canonique indisponible.");
    winner = records[0];
  } else {
    const table = player
      ? "football.player_profile_versions"
      : "football.team_profile_versions";
    const records = await query(
      `/*orion:entityprofilemeta*/ WITH candidates AS (
 SELECT p.id::text AS profile_id,p.image_asset_id::text,
 ${player ? "p.raw_position_code,p.raw_position_code_state,p.raw_position_code_source_number::text,p.shirt_number,p.shirt_number_state,p.shirt_number_source_number::text," : ""}
 CASE p.profile_context WHEN 'provider_global' THEN 0 WHEN 'legacy_normalized_global' THEN 1 WHEN 'global' THEN 2 END AS priority
 FROM ${table} p WHERE p.${actor}_id=$1::bigint AND ${selected("p", "$3::bigint")}
 AND ((p.profile_context='provider_global' AND p.variant_key='provider:exact' AND p.source_id=ANY($2::bigint[]))
 OR (p.profile_context='legacy_normalized_global' AND p.source_id=ANY($2::bigint[]))
 OR (p.profile_context='global' AND p.provenance_kind='manual' AND p.source_id IS NULL)))
 SELECT * FROM candidates WHERE priority=(SELECT min(priority) FROM candidates) ORDER BY profile_id LIMIT 2`,
      [identity.actor_id, identity.sources || [], row.catalog_generation],
    );
    if (!records.length) reject(404, "Profil non collecté.");
    if (records.length !== 1) reject(503, "Profil canonique ambigu.");
    winner = records[0];
  }
  const native = {};
  if (player) {
    for (const [from, to] of [
      ["raw_position_code", "position_id"],
      ["shirt_number", "shirt_number"],
    ]) {
      const value = scalar(winner, from);
      if (value !== absent) native[to] = value;
    }
  }
  const image = await media(winner.image_asset_id, options.mediaBase);
  return {
    actorId: identity.actor_id,
    profileId: winner.profile_id,
    native,
    image,
    validator: [identity.actor_id, winner.profile_id, image.fingerprint],
  };
}

async function profile(req, params, kind, publicId, archive, options) {
  const rows = await publications(params.get("v"), true),
    row = rows[0];
  const metadata = await entityMetadata(row, kind, publicId, options);
  const precondition = validated(req, rows, metadata.validator);
  if (precondition) return precondition;
  let records;
  if (kind === "leagues") {
    records = await query(
      `/*orion:entitycontent*/ SELECT c.name,co.iso2 AS country_code
 FROM football.competitions c LEFT JOIN football.countries co
 ON co.id=c.country_id AND co.revision_id=c.country_revision_id AND ${selected("co", "$2::bigint")}
 WHERE c.revision_id=$1::bigint`,
      [metadata.profileId, row.catalog_generation],
    );
  } else {
    records = await query(
      `/*orion:entitycontent*/ SELECT p.display_name AS name
 ${kind === "players" ? ",p.short_name,p.country_code_source AS country_code" : ""}
 FROM ${kind === "players" ? "football.player_profile_versions" : "football.team_profile_versions"} p
 WHERE p.id=$1::bigint`,
      [metadata.profileId],
    );
  }
  if (records.length !== 1) reject(503, "Profil indisponible.");
  const data = {
    id: publicId,
    ...records[0],
    image_url: metadata.image.url,
    ...(kind === "leagues" ? { season: row.season } : metadata.native),
  };
  return reply(
    req,
    archive ? { status: 200, data } : { data },
    rows,
    metadata.validator,
  );
}

function catalogueArguments(params) {
  const raw = params.get("limit") ?? "50",
    limit = Number(raw),
    q = params.get("q") || "";
  if (
    !/^[1-9]\d{0,2}$/.test(raw) ||
    limit > 100 ||
    q.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(q)
  )
    reject(400, "Filtres de catalogue invalides.");
  const scope = digest(JSON.stringify([limit, q, params.get("v")]));
  let cursor = null;
  if (params.has("cursor")) {
    try {
      const encoded = params.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) throw Error();
      cursor = JSON.parse(Buffer.from(encoded, "base64url").toString());
      if (
        cursor.scope !== scope ||
        !patterns.leagues.test(cursor.id) ||
        typeof cursor.generation !== "string" ||
        cursor.generation.length > 200
      )
        throw Error();
    } catch {
      reject(400, "Curseur invalide.");
    }
  }
  return { limit, q, scope, cursor };
}
const searchText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

async function catalogue(req, params, options) {
  const args = catalogueArguments(params),
    rows = await publications(params.get("v")),
    gen = generation(rows);
  if (args.cursor && args.cursor.generation !== gen)
    reject(409, "La publication a changé. Rechargez la première page.");
  const grouped = new Map();
  for (const row of rows) {
    const entry = grouped.get(row.league_id) || { row, seasons: new Set() };
    // Discovery is mutable: name/context from the greatest admitted catalogue generation.
    if (BigInt(row.catalog_generation) > BigInt(entry.row.catalog_generation))
      entry.row = row;
    entry.seasons.add(row.season);
    grouped.set(row.league_id, entry);
  }
  const page = [...grouped.values()]
    .filter(
      (entry) =>
        searchText(entry.row.league_name).includes(searchText(args.q)) &&
        (!args.cursor || entry.row.league_id > args.cursor.id),
    )
    .sort((a, b) =>
      a.row.league_id < b.row.league_id
        ? -1
        : a.row.league_id > b.row.league_id
          ? 1
          : 0,
    )
    .slice(0, args.limit + 1);
  const visible = page.slice(0, args.limit),
    metadata = [];
  for (const entry of visible) {
    const records = await query(
      `/*orion:entitycataloguemeta*/ SELECT image_asset_id::text FROM football.competitions
 WHERE revision_id=$1::bigint`,
      [entry.row.competition_revision_id],
    );
    if (records.length !== 1) reject(503, "Catalogue indisponible.");
    entry.image = await media(records[0].image_asset_id, options.mediaBase);
    metadata.push([entry.row.competition_revision_id, entry.image.fingerprint]);
  }
  const precondition = validated(req, rows, metadata);
  if (precondition) return precondition;
  let content = [];
  if (visible.length) {
    content = await query(
      `/*orion:entitylist*/ WITH x AS (
 SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(public_id text,revision_id bigint,cg bigint))
 SELECT x.public_id AS id,c.name,co.iso2 AS country_code FROM x
 JOIN football.competitions c ON c.revision_id=x.revision_id
 LEFT JOIN football.countries co ON co.id=c.country_id AND co.revision_id=c.country_revision_id AND ${selected("co", "x.cg")}
 ORDER BY x.public_id COLLATE "C"`,
      [
        JSON.stringify(
          visible.map((entry) => ({
            public_id: entry.row.league_id,
            revision_id: entry.row.competition_revision_id,
            cg: entry.row.catalog_generation,
          })),
        ),
      ],
    );
    if (content.length !== visible.length) reject(503, "Catalogue incomplet.");
  }
  const last = visible.at(-1),
    nextCursor =
      page.length > args.limit
        ? Buffer.from(
            JSON.stringify({
              scope: args.scope,
              generation: gen,
              id: last.row.league_id,
            }),
          ).toString("base64url")
        : null;
  return reply(
    req,
    {
      data: {
        leagues: content.map((record, index) => ({
          ...record,
          image_url: visible[index].image.url,
          seasons: [...visible[index].seasons].sort().reverse(),
        })),
      },
      pagination: { limit: args.limit, nextCursor, generation: gen },
    },
    rows,
    metadata,
  );
}

async function routing(req, params) {
  const players = ids(params, "player", patterns.players),
    teams = ids(params, "team", patterns.teams);
  if (!players.length && !teams.length)
    reject(400, "Précisez les identifiants.");
  const rows = await publications(params.get("v"), true),
    row = rows[0];
  const precondition = validated(req, rows, null);
  if (precondition) return precondition;
  const records = await query(
    `/*orion:entityroutes*/ ${scopeSql}
 SELECT DISTINCT a.route_kind,a.public_key FROM x JOIN ingest.public_aliases a
 ON ${aliasAt("a", "x.cg")} WHERE (a.route_kind='player' AND a.public_key=ANY($2::text[])
 AND EXISTS(SELECT 1 FROM player_members p WHERE p.player_id=a.player_id))
 OR (a.route_kind='team' AND a.public_key=ANY($3::text[])
 AND EXISTS(SELECT 1 FROM team_members t WHERE t.team_id=a.team_id)) ORDER BY a.route_kind,a.public_key`,
    [context(row), players, teams],
  );
  const routes = {},
    clubRoutes = {};
  for (const record of records) {
    const out = record.route_kind === "player" ? routes : clubRoutes;
    out[record.public_key] = { [row.season]: [row.league_id] };
  }
  return reply(req, { routes, clubRoutes }, rows, null);
}

/** Opt-in dispatch. Returns null for other capabilities; never falls back to source documents. */
export async function orionProEntityRoute(req, path, params, options = {}) {
  const match =
    /^\/api\/(pitchapi|archive\/profiles)\/(players|teams|leagues)(?:\/([^/]+))?$/.exec(
      path,
    );
  const routes = path === "/api/scouting/routes";
  const catalogueRoute =
    match?.[1] === "pitchapi" && match[2] === "leagues" && !match[3];
  if (!routes && !(match?.[3] || catalogueRoute)) return null;
  if (!["GET", "HEAD"].includes(req.method))
    return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, {
      headers: { Allow: "GET, HEAD" },
    });
  validateParams(
    params,
    routes
      ? ["v", "player", "team"]
      : catalogueRoute
        ? ["v", "limit", "cursor", "q"]
        : ["v"],
  );
  if (match?.[3] && !patterns[match[2]].test(match[3]))
    reject(400, "Identifiant invalide.");
  buildId(params.get("v"), !catalogueRoute);
  if (routes) return routing(req, params);
  if (catalogueRoute) return catalogue(req, params, options);
  return profile(
    req,
    params,
    match[2],
    match[3],
    match[1] === "archive/profiles",
    options,
  );
}
