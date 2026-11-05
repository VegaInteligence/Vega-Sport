import { createHash } from "node:crypto";
import { query, configured } from "./postgres.js";
import { send, reject, validateParams } from "./relational-core.js";
import { cacheHeaders } from "./cache-policy.js";
import { immutableFile, cloudFrontObjectUrl } from "./cdn.js";

const healthSql = `/*orion:healthmeta*/
SELECT (SELECT max(generation)::text FROM ingest.dataset_snapshots WHERE status='sealed') AS revision,
 EXISTS(SELECT 1 FROM analytics.publication_versions p
 JOIN analytics.aggregation_builds b ON b.id=p.build_id AND b.status='ready'
  AND b.competition_season_id=p.competition_season_id AND b.catalog_snapshot_id=p.catalog_snapshot_id
  AND b.representation_version=p.representation_version
 JOIN ingest.dataset_snapshots d ON d.id=b.dataset_snapshot_id AND d.status='sealed'
 JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id AND c.status='sealed'
 WHERE p.published_to_gen IS NULL LIMIT 1) AS ready`;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const crons = [
  "35 22 * * *",
  "10 6 * * *",
  "15 0,12 * * *",
  "50 6 * * *",
  "15 18 * * *",
];
const workflowUrl =
  "https://github.com/OrionQuantPlatform/STATARENA/actions/workflows/collect-football.yml";

async function health(req, params) {
  validateParams(params, []);
  if (!configured())
    return send(req, { source: "AWS", status: "pending", revision: null }, 503);
  const [row] = await query(healthSql);
  const body = {
    source: "AWS",
    status: row?.ready ? "ok" : "pending",
    revision: row?.revision ?? null,
  };
  return send(
    req,
    body,
    row?.ready ? 200 : 503,
    row?.ready
      ? {
          etag: `W/"orion-health1-${digest(JSON.stringify(body))}"`,
          ttl: 5,
        }
      : {},
  );
}

async function settings(req, params) {
  validateParams(params, ["limit", "cursor"]);
  const raw = params.get("limit") ?? "20",
    cursor = params.get("cursor");
  if (
    !/^[1-9][0-9]?$/.test(raw) ||
    Number(raw) > 50 ||
    (cursor !== null &&
      (!/^[1-9][0-9]{0,18}$/.test(cursor) ||
        BigInt(cursor) > 9223372036854775807n))
  )
    reject(400, "Pagination invalide.");
  if (req.method === "HEAD") return send(req, null);
  const limit = Number(raw);
  const rows = await query(
    `/*orion:operationsruns*/
SELECT id::text,mode,status,transform_version,code_commit,started_at,finished_at
FROM ingest.import_runs r WHERE ($1::bigint IS NULL OR r.id<$1::bigint)
ORDER BY r.id DESC LIMIT $2`,
    [cursor, limit + 1],
  );
  const page = rows.slice(0, limit);
  return send(req, {
    provider: "AWS",
    configured: configured(),
    // Repository declarations; activation is external state and is not inferred.
    schedule: {
      cron: crons[0],
      crons,
      timezone: "UTC",
      runner: "GitHub Actions",
      activation: "unknown",
    },
    sync: page.map((value) => ({
      name: value.mode,
      value,
      updated_at: value.finished_at ?? value.started_at,
    })),
    workflowUrl,
    page: { limit, nextCursor: rows.length > limit ? page.at(-1).id : null },
  });
}

async function asset(req, params, mediaBase) {
  validateParams(params, ["url"]);
  const input = params.get("url");
  try {
    const u = new URL(input);
    if (
      !input ||
      input.length > 2048 ||
      u.protocol !== "https:" ||
      u.username ||
      u.password
    )
      throw Error();
  } catch {
    reject(400, "URL de média invalide.");
  }
  const rows = await query(
    `/*orion:assetmeta*/
SELECT storage_key,content_sha256,content_type FROM ingest.media_assets
WHERE legacy_asset_url=$1 ORDER BY id LIMIT 2`,
    [input],
  );
  if (!rows.length) reject(404, "Média indisponible.");
  if (rows.length !== 1) reject(503, "Correspondance de média ambiguë.");
  const row = rows[0],
    extension = row.storage_key.split(".").at(-1);
  const mime = {
    png: "image/png",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  }[extension];
  if (
    !/^[a-f0-9]{64}$/.test(row.content_sha256 ?? "") ||
    !immutableFile(row.storage_key) ||
    !mime ||
    row.content_type !== mime ||
    !new RegExp(`(?:-|/)${row.content_sha256}\\.${extension}$`).test(
      row.storage_key,
    )
  )
    reject(503, "Métadonnées du média invalides.");
  let location;
  try {
    location = cloudFrontObjectUrl(row.storage_key, mediaBase);
  } catch {
    reject(503, "Origine du média indisponible.");
  }
  return new Response(null, {
    status: 307,
    headers: {
      Location: location,
      ...cacheHeaders(15, 0),
      "X-Data-Source": "AWS",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function orionProOperationalRoute(
  req,
  path,
  params,
  { mediaBase } = {},
) {
  if (path === "/api/health") return health(req, params);
  if (path === "/api/settings") return settings(req, params);
  if (path === "/api/assets") return asset(req, params, mediaBase);
  if (path === "/api/status") {
    validateParams(params, []);
    return send(req, {
      source: "AWS",
      configured: configured(),
      basePath: "/api/pitchapi",
    });
  }
  return null;
}
