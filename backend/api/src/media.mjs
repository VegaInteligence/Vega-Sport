/**
 * media=1 on the compact reads: the response gets a `media` map from each image URL it
 * contains to its copy behind CloudFront, as the previous backend's resolved-media.js
 * on main. Copies come from api.media_assets (written by the worker, vega/media.py).
 */
import { createHash } from "node:crypto";
import { matchesEtag } from "./http.mjs";

export const MEDIA_ROUTES = new Set([
  "/api/read/home", "/api/read/home-favourites", "/api/read/players", "/api/read/clubs", "/api/read/player",
  "/api/read/club", "/api/read/archive", "/api/read/performance", "/api/read/discipline",
]);
const TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

// Only content-addressed, already-public files may be delivered from CloudFront (cdn.js on main).
export function immutableFile(path) {
  return (
    !path.split("/").some((part) => part.startsWith(".")) &&
    /^(?:raw|computed|sources)\/[A-Za-z0-9_./-]+(?:-|\/)[a-f0-9]{24,64}\.(?:json(?:\.gz)?|webp|png|jpe?g)$/.test(path)
  );
}

export function cloudFrontObjectUrl(path, configuredBase) {
  if (!immutableFile(path)) throw new Error("File is not content-addressed");
  const base = new URL(configuredBase);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("Invalid CloudFront URL");
  return new URL("data/" + path, base).href;
}

// Collect only image-valued fields; never interpret arbitrary strings as assets.
export function imageSources(value, out = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) imageSources(item, out);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === "image_url" || key === "imageUrl") && typeof item === "string" && item.length <= 2048) out.add(item);
    else if (item && typeof item === "object") imageSources(item, out);
  }
  return out;
}

export async function mediaSidecar(body, read, base) {
  const sources = [...imageSources(body.data)];
  if (!sources.length || sources.length > 1000 || !base) return {};
  const rows = await read("SELECT source_url AS url,s3_key AS path,content_type FROM api.media_assets WHERE source_url = ANY($1::text[])", [sources]);
  const map = Object.create(null);
  for (const row of [...rows].sort((a, b) => String(a.url).localeCompare(String(b.url)))) {
    if (!immutableFile(row.path || "")) continue;
    const type = TYPES[row.path.split(".").at(-1).toLowerCase()];
    if (!type || type !== row.content_type) continue;
    try {
      map[row.url] = cloudFrontObjectUrl(row.path, base);
    } catch {
      /* unresolved */
    }
  }
  return map;
}

/** Wraps `invoke` (the route handler) for media=1 reads; null when the request is not one. */
export async function withResolvedMedia(req, invoke, read, base, { present = (data) => data } = {}) {
  const url = new URL(req.url);
  if (
    !["GET", "HEAD"].includes(req.method) ||
    !MEDIA_ROUTES.has(url.pathname) ||
    url.searchParams.getAll("media").length !== 1 ||
    url.searchParams.get("media") !== "1"
  )
    return null;
  url.searchParams.delete("media");
  const headers = new Headers(req.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  const original = await invoke(new Request(url, { method: "GET", headers }));
  if (!original.ok)
    return req.method === "HEAD" ? new Response(null, { status: original.status, headers: original.headers }) : original;
  const body = await original.json();
  const home = url.pathname === "/api/read/home";
  if (home) body.data = present(body.data);
  body.media = await mediaSidecar(body, read, base);
  const serialized = JSON.stringify(body);
  const originTag = original.headers.get("etag");
  const signature = originTag ? JSON.stringify([originTag, body.media]) : serialized;
  const tag = `W/"${home ? "media-home-v2" : "media-v1"}-${createHash("sha256").update(signature).digest("hex")}"`;
  const output = new Headers(original.headers);
  output.set("ETag", tag);
  output.delete("content-length");
  if (matchesEtag(req.headers.get("if-none-match"), tag)) return new Response(null, { status: 304, headers: output });
  return new Response(req.method === "HEAD" ? null : serialized, { status: 200, headers: output });
}
