import { createHash } from "node:crypto";
import { cloudFrontObjectUrl, immutableFile } from "./cdn.js";
import { matchesEtag } from "./cache-policy.js";

// Collect only image-valued fields; never interpret arbitrary strings as assets.
export function imageSources(value, out = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) imageSources(item, out);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      (key === "image_url" || key === "imageUrl") &&
      typeof item === "string" &&
      item.length <= 2048
    )
      out.add(item);
    else if (item && typeof item === "object") imageSources(item, out);
  }
  return out;
}

export async function mediaSidecar(body, read, base) {
  const sources = [...imageSources(body.data)];
  // Bound both SQL input and the representation; omitted mappings use the existing alias.
  if (sources.length > 1000) return {};
  if (!sources.length) return {};
  const rows = await read(
    "SELECT url,path,content_type FROM statarena_app.assets WHERE url = ANY($1::text[])",
    [sources],
  );
  const allowed = new Set(sources),
    map = Object.create(null);
  for (const row of [...rows].sort((a, b) =>
    String(a.url).localeCompare(String(b.url)),
  )) {
    if (!allowed.has(row.url) || !immutableFile(row.path || "")) continue;
    const ext = row.path.split(".").at(-1).toLowerCase();
    if (
      !{
        webp: "image/webp",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
      }[ext] ||
      {
        webp: "image/webp",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
      }[ext] !== row.content_type
    )
      continue;
    try {
      map[row.url] = cloudFrontObjectUrl(row.path, base);
    } catch {
      /* unresolved */
    }
  }
  return map;
}

// Full representation validator includes the independently changing asset mapping.
export async function withResolvedMedia(req, invoke, read, base) {
  const url = new URL(req.url);
  if (
    !["GET", "HEAD"].includes(req.method) ||
    !new Set([
      "/api/read/home",
      "/api/read/players",
      "/api/read/clubs",
      "/api/read/player",
      "/api/read/club",
      "/api/read/archive",
      "/api/read/performance",
      "/api/read/discipline",
    ]).has(url.pathname) ||
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
    return req.method === "HEAD"
      ? new Response(null, {
          status: original.status,
          headers: original.headers,
        })
      : original;
  const body = await original.json();
  body.media = await mediaSidecar(body, read, base);
  const serialized = JSON.stringify(body);
  const originTag = original.headers.get("etag");
  const signature = originTag
    ? JSON.stringify([originTag, body.media])
    : serialized;
  const tag = `W/"media-v1-${createHash("sha256").update(signature).digest("hex")}"`;
  const output = new Headers(original.headers);
  output.set("ETag", tag);
  output.delete("content-length");
  if (matchesEtag(req.headers.get("if-none-match"), tag))
    return new Response(null, { status: 304, headers: output });
  return new Response(req.method === "HEAD" ? null : serialized, {
    status: 200,
    headers: output,
  });
}
