import { objectMeta, objectBody } from "./neon.js";
export const response = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
export async function publicFile(relative, request) {
  if (!/\.(?:json(?:\.gz)?|webp|png|jpe?g)$/.test(relative))
    return response("Not found", 404);
  if (
    !/^(raw|computed|sources)\/[A-Za-z0-9_./-]+$/.test(relative) ||
    relative.split("/").some((x) => x.startsWith("."))
  )
    return response("Forbidden", 403);
  try {
    const meta = await objectMeta(relative, request.method !== "HEAD");
    if (!meta) return response("Not found", 404);
    const etag = '"' + meta.sha256 + '"';
    const headers = {
      ETag: etag,
      "X-Data-Source": "Neon",
      "Content-Type": relative.endsWith(".gz")
        ? "application/gzip"
        : meta.content_type,
      "Cache-Control":
        /(?:-|\/)[a-f0-9]{24,64}\.(?:json\.gz|webp|png|jpg)$/.test(relative)
          ? "public, max-age=31536000, s-maxage=31536000, immutable"
          : "public, max-age=0, s-maxage=60, stale-while-revalidate=30",
    };
    if (
      (request.headers.get("if-none-match") || "")
        .split(",")
        .map((s) => s.trim())
        .includes(etag)
    )
      return response(null, 304, headers);
    headers["Content-Length"] = String(meta.size);
    return response(
      request.method === "HEAD" ? null : await objectBody(meta),
      200,
      headers,
    );
  } catch (e) {
    console.error("Neon object unavailable", e.name);
    return response("Neon data unavailable", 503);
  }
}
