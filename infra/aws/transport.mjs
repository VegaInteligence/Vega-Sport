import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);
const limit = 6 * 1024 * 1024;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers":
    "If-None-Match, If-Modified-Since, Content-Type",
  "access-control-expose-headers":
    "ETag, Content-Length, Cache-Control, Age, X-Cache, X-Data-Source, Server-Timing, Retry-After, X-Amzn-ErrorType",
};
const fail = (statusCode, body, extra = {}) => ({
  statusCode,
  body,
  headers: {
    ...cors,
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    ...extra,
  },
});
function supportsGzip(header) {
  const weights = new Map(
    (header || "")
      .toLowerCase()
      .split(",")
      .map((s) => {
        const [coding, ...params] = s.trim().split(/\s*;\s*/);
        const q = params.find((p) => p.startsWith("q="));
        return [coding, q === undefined ? 1 : Number(q.slice(2))];
      }),
  );
  return (weights.get("gzip") ?? weights.get("*") ?? 0) > 0;
}
/**
 * What the distribution is told. A public answer may be served from the copy the
 * distribution holds for a day when the function fails or cannot be reached (a slightly
 * old answer rather than an error), unless it says how long itself. `must-revalidate`
 * would forbid it: it is the application's word to browsers, which revalidate anyway
 * (max-age=0). Until 20 November 2026 `stale-if-error=0` was added to every answer: each
 * failure of the function was shown, the home's own 24 hours included.
 * An error, a personal answer and an answer that says nothing are kept by no one.
 */
export function edgeCacheControl(value) {
  if (!value) return "no-store";
  const directives = value.split(",").map((part) => part.trim()).filter(Boolean);
  const has = (name) => directives.some((d) => d.toLowerCase().split("=")[0] === name);
  if (has("no-store") || has("private") || !has("public")) return value;
  const kept = directives.filter((d) => d.toLowerCase() !== "must-revalidate");
  if (!has("stale-if-error")) kept.push("stale-if-error=86400");
  return kept.join(", ");
}
export const adapt = (route) => async (event) => {
  const method = event?.requestContext?.http?.method,
    path = event?.rawPath;
  if (
    event?.version !== "2.0" ||
    typeof method !== "string" ||
    typeof path !== "string"
  )
    return fail(400, "Invalid request");
  if (method === "OPTIONS") return { ...fail(204, ""), body: "" };
  if (!["GET", "HEAD"].includes(method))
    return fail(405, "Method not allowed", { allow: "GET, HEAD, OPTIONS" });
  let request;
  try {
    const decoded = decodeURIComponent(path);
    if (
      !path.startsWith("/") ||
      decoded.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(decoded) ||
      /[?#]/.test(path) ||
      decoded.split("/").some((s) => s === "." || s === "..")
    )
      throw new Error();
    const headers = new Headers(event.headers);
    // OAC credentials, cookies and viewer identity must never reach application code.
    for (const h of [...headers.keys()])
      if (/^(authorization$|cookie$|x-amz-|host$|x-forwarded-)/i.test(h))
        headers.delete(h);
    request = new Request(
      "https://statarena.invalid" +
        path +
        (event.rawQueryString ? "?" + event.rawQueryString : ""),
      { method, headers },
    );
  } catch {
    return fail(400, "Invalid request");
  }
  const res = await route(request),
    headers = { ...Object.fromEntries(res.headers), ...cors };
  delete headers["set-cookie"];
  delete headers["transfer-encoding"];
  delete headers.connection;
  delete headers["vercel-cdn-cache-control"];
  delete headers["cdn-cache-control"];
  headers["cache-control"] = edgeCacheControl(headers["cache-control"]);
  const out = {
    statusCode: res.status,
    headers,
    body: "",
    isBase64Encoded: false,
  };
  if (
    method === "HEAD" ||
    res.status === 304 ||
    res.status === 204 ||
    !res.body
  )
    return out;
  const textual =
    /^(text\/|application\/(?:[\w.+-]*json|javascript|xml)\b)/i.test(
      headers["content-type"] || "",
    ) && !headers["content-encoding"];
  let bytes = Buffer.from(await res.arrayBuffer());
  if (
    textual &&
    bytes.length >= 1024 &&
    supportsGzip(request.headers.get("accept-encoding"))
  ) {
    bytes = await compress(bytes, { level: 4 });
    headers["content-encoding"] = "gzip";
    headers["content-length"] = String(bytes.length);
    headers.vary = headers.vary
      ? headers.vary + ", Accept-Encoding"
      : "Accept-Encoding";
    if (headers.etag && !headers.etag.startsWith("W/"))
      headers.etag = "W/" + headers.etag;
  }
  if (bytes.length > limit)
    return fail(502, "Response exceeds transport limit");
  out.isBase64Encoded = !textual || Boolean(headers["content-encoding"]);
  out.body = bytes.toString(out.isBase64Encoded ? "base64" : "utf8");
  if (Buffer.byteLength(JSON.stringify(out)) > limit - 1024)
    return fail(502, "Response exceeds transport limit");
  return out;
};
