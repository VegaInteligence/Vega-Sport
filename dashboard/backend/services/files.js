import {
  objectMeta,
  objectBody,
  externalStorage,
  dataProvider,
} from "./neon.js";
import { immutableFile, cloudFrontObjectUrl } from "./cdn.js";
import { cacheHeaders, matchesEtag, noStoreHeaders } from "./cache-policy.js";
import { responseBytes } from "./metrics.js";
export const response = (body, status = 200, headers = {}) => {
  responseBytes(body);
  return new Response(body, {
    status,
    headers: {
      "X-Content-Type-Options": "nosniff",
      ...noStoreHeaders,
      ...headers,
    },
  });
};
export async function publicFile(
  relative,
  request,
  { mutableAlias = false } = {},
) {
  if (!/\.(?:json(?:\.gz)?|webp|png|jpe?g)$/.test(relative))
    return response("Not found", 404);
  if (
    !/^(raw|computed|sources)\/[A-Za-z0-9_./-]+$/.test(relative) ||
    relative.split("/").some((x) => x.startsWith("."))
  )
    return response("Forbidden", 403);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const meta = await objectMeta(relative, { fresh: attempt > 0 });
      if (!meta) return response("Not found", 404);
      const etag = '"' + meta.sha256 + '"';
      const headers = {
        ETag: etag,
        "X-Data-Source": dataProvider(),
        "Content-Type": relative.endsWith(".gz")
          ? "application/gzip"
          : meta.content_type,
        ...cacheHeaders(60, 30, {
          immutable: !mutableAlias && immutableFile(relative),
        }),
      };
      if (matchesEtag(request.headers.get("if-none-match"), etag))
        return response(null, 304, headers);
      if (
        request.method === "GET" &&
        externalStorage() &&
        process.env.STATARENA_CLOUDFRONT_URL &&
        immutableFile(relative)
      )
        return response(null, 307, {
          Location: cloudFrontObjectUrl(
            relative,
            process.env.STATARENA_CLOUDFRONT_URL,
          ),
          "Cache-Control": "private, no-store",
        });
      headers["Content-Length"] = String(meta.size);
      if (request.method === "HEAD") return response(null, 200, headers);
      try {
        return response(await objectBody(meta), 200, headers);
      } catch (error) {
        if (error.code !== "ESTALE" || attempt === 1) throw error;
        // Restart validators and headers too: newer bytes need their newer ETag.
      }
    }
  } catch (e) {
    console.error("Neon object unavailable", e.name);
    return response(dataProvider() + " data unavailable", 503);
  }
}
