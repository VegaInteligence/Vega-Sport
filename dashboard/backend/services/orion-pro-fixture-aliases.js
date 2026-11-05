import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { orionProRoute } from "./orion-pro.js";
import { reject, send, validateParams } from "./relational-core.js";
import { matchesEtag } from "./cache-policy.js";

const contract = "fixtures-alias-v1";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const at = (a, g) => `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const selected = (a, g) => `${at(a, g)} AND ${a}.is_canonical AND NOT ${a}.is_deleted`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;

// Admission is separate from the frozen fixture reader. Its source token and
// alias membership are the established summary-v1-shots-v1 publication contract.
const editionSql = `/*orion:fixturealias:editionmeta*/
SELECT b.id::text build_id,b.competition_season_id::text edition_id,
 b.dataset_snapshot_id::text dataset_snapshot_id,d.generation::text dataset_generation,
 b.catalog_snapshot_id::text catalog_snapshot_id,c.generation::text catalog_generation,
 b.representation_version,b.code_content_sha256,b.dependencies_sha256,b.environment_sha256,
 b.metrics_contract_version,b.transform_version,e.season_key AS season,aliases.keys AS league_keys
FROM analytics.aggregation_builds b
JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
JOIN LATERAL (SELECT 1 FROM analytics.publication_versions p WHERE p.build_id=b.id
 AND p.competition_season_id=b.competition_season_id AND p.catalog_snapshot_id=b.catalog_snapshot_id
 AND p.representation_version=b.representation_version LIMIT 1) publication ON true
JOIN football.competition_seasons e ON e.id=b.competition_season_id
 AND e.revision_id=b.competition_season_revision_id AND ${selected("e", "d.generation")}
JOIN football.competitions co ON co.id=e.competition_id AND ${selected("co", "c.generation")}
LEFT JOIN LATERAL (SELECT array_agg(a.public_key ORDER BY a.public_key COLLATE "C") keys
 FROM ingest.public_aliases a WHERE a.route_kind='competition' AND a.competition_id=co.id
 AND a.public_key ~ '^l_[A-Za-z0-9]{6}$' AND ${aliasAt("a", "c.generation")}) aliases ON true
WHERE b.id=$1::bigint AND b.status='ready' LIMIT 2`;

function token(row) {
  return `pro1.${row.build_id}.${digest(JSON.stringify([
    row.build_id, row.edition_id, row.dataset_snapshot_id, row.dataset_generation,
    row.catalog_snapshot_id, row.catalog_generation, row.representation_version,
    row.code_content_sha256, row.dependencies_sha256, row.environment_sha256,
    row.metrics_contract_version, row.transform_version,
  ]))}`;
}
function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function argumentsFor(path, params, day, league) {
  validateParams(params, day ? ["v", "status", "limit", "cursor"] : ["v", "season", "status", "limit", "cursor"]);
  const version = params.get("v"), match = /^pro1\.([1-9][0-9]{0,18})\.[a-f0-9]{64}$/.exec(version || ""),
    raw = params.get("limit") ?? "50", limit = Number(raw), status = params.get("status") ?? "all", season = params.get("season");
  if (!match || BigInt(match[1]) > 9223372036854775807n || (day && !validDay(day))
    || !/^[1-9][0-9]{0,2}$/.test(raw) || limit > 100 || !["all", "played", "upcoming"].includes(status)
    || (season !== null && !/^\d{4}(?:\/\d{4})?$/.test(season))) reject(400, "Version, édition ou filtres invalides.");
  const scope = digest(JSON.stringify([contract, path, version, season, status, limit]));
  let cursor = null;
  if (params.has("cursor")) {
    try {
      const encoded = params.get("cursor");
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(encoded)) throw Error();
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (value.scope !== scope || typeof value.inner !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(value.inner)
        || Object.keys(value).length !== 2) throw Error();
      cursor = value.inner;
    } catch { reject(400, "Curseur invalide."); }
  }
  return { version, buildId: match[1], limit, status, season, day, league, scope, cursor };
}
function tag(req, sourceTag) {
  if (!sourceTag) reject(503, "Validateur de rencontres indisponible.");
  const url = new URL(req.url), params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return `W/"orion-fixturealias1-${digest(JSON.stringify([contract, url.pathname, params, sourceTag]))}"`;
}
function reply(req, value, args, etag) {
  return send(req, value, 200, { etag, ttl: 15, maxBytes: 2 * 1024 * 1024,
    headers: { "X-Orion-Fixture-Alias-Contract": contract, "X-Orion-Representation": args.version } });
}
async function readCore(req, args, edition, method) {
  const url = new URL(req.url);
  url.pathname = "/api/fixtures";
  url.search = "";
  url.searchParams.set("v", args.version);
  url.searchParams.set("limit", String(args.limit));
  url.searchParams.set("status", args.status);
  if (args.day) {
    url.searchParams.set("from", args.day);
    url.searchParams.set("to", args.day);
  } else {
    url.searchParams.set("league", args.league);
    url.searchParams.set("season", edition.season);
  }
  if (args.cursor) url.searchParams.set("cursor", args.cursor);
  const headers = new Headers(req.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  const internal = new Request(url, { method, headers });
  const response = await orionProRoute(internal, url.pathname, url.searchParams);
  if (!response) reject(503, "Lecteur de rencontres indisponible.");
  return response;
}
async function fixtures(req, path, params, day, league) {
  const args = argumentsFor(path, params, day, league), rows = await query(editionSql, [args.buildId]);
  if (rows.length !== 1 || token(rows[0]) !== args.version) reject(400, "Version publiée invalide.");
  const edition = rows[0];
  if (edition.representation_version !== "summary-v1-shots-v1" || !edition.league_keys?.length)
    reject(503, "Représentation de rencontres indisponible.");
  if ((league && !edition.league_keys.includes(league)) || (args.season !== null && args.season !== edition.season))
    reject(400, "Version hors de cette édition.");
  const conditional = req.method === "HEAD" || req.headers.has("if-none-match");
  let upstream = await readCore(req, args, edition, conditional ? "HEAD" : "GET");
  if (upstream.status !== 200) return upstream;
  let etag = tag(req, upstream.headers.get("etag"));
  if (conditional) {
    if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return reply(req, null, args, etag);
    upstream = await readCore(req, args, edition, "GET");
    if (upstream.status !== 200) return upstream;
    const actualTag = tag(req, upstream.headers.get("etag"));
    if (actualTag !== etag) reject(409, "La publication a changé. Rechargez la page.");
    etag = actualTag;
  }
  const body = await upstream.json(), matches = body?.data?.matches, page = body?.pagination;
  if (!Array.isArray(matches) || matches.length > args.limit || page?.generation !== args.version || page.limit !== args.limit
    || !(page.nextCursor === null || (typeof page.nextCursor === "string" && /^[A-Za-z0-9_-]{1,1024}$/.test(page.nextCursor))))
    reject(503, "Page de rencontres invalide.");
  // Fixture DTOs come directly from the frozen reader. Only cursor transport is
  // wrapped, preventing a core/date/league cursor from silently changing scope.
  return reply(req, { data: { matches }, pagination: { limit: args.limit, generation: args.version,
    nextCursor: page.nextCursor === null ? null : Buffer.from(JSON.stringify({ scope: args.scope, inner: page.nextCursor })).toString("base64url") } }, args, etag);
}

/** The two existing fixture aliases, explicitly scoped to one published edition. */
export async function orionProFixtureAliasRoute(req, path, params) {
  const date = /^\/api\/pitchapi\/date\/(\d{4}-\d{2}-\d{2})$/.exec(path),
    league = /^\/api\/pitchapi\/leagues\/(l_[A-Za-z0-9]{6})\/matches$/.exec(path);
  if (!date && !league) return null;
  if (!["GET", "HEAD"].includes(req.method)) return send(req, { error: { code: "METHOD_NOT_ALLOWED" } }, 405, { headers: { Allow: "GET, HEAD" } });
  return fixtures(req, path, params, date?.[1] ?? null, league?.[1] ?? null);
}
