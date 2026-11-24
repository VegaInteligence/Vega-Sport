/**
 * The gate: the decision taken on every request at the entry of the CDN, before the
 * shared cache is consulted. A reserved read is let through only with a valid pass of a
 * sufficient level; its answer is then the cached one, shared by every allowed account.
 * Pure: the CloudFront function that runs it gives the request, the rules, the keys and
 * the time. Failure modes: FAILURE_MODES.md, section 2.
 */
import { verifyPass } from "./pass.mjs";

/** The header a pass travels in. Not Authorization: the CDN signs its requests to the
 * origin with it. In no cache key and no origin request policy. */
export const PASS_HEADER = "x-vega-pass";
const TOKEN = /^[A-Za-z0-9_.-]+$/;
const PREFIX = /^(\/[a-z0-9][a-z0-9._-]*)+$/;

// The read API's CORS headers (infra/aws/transport.mjs), with the pass among the headers a
// page may send; test/gate.test.mjs keeps the two together.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "If-None-Match, If-Modified-Since, Content-Type, X-Vega-Pass",
  "access-control-expose-headers": "ETag, Content-Length, Cache-Control, Age, X-Cache, X-Data-Source, Server-Timing, Retry-After, X-Amzn-ErrorType",
};
const respond = (status, error) => ({
  action: "respond",
  status,
  headers: { ...cors, "cache-control": "no-store", ...(error ? { "content-type": "application/json; charset=utf-8" } : { "access-control-max-age": "7200" }) },
  body: error ? JSON.stringify({ ok: false, available: false, error }) : "",
});

/**
 * The path a rule is compared with: lower case, percent-encoded letters decoded, empty
 * segments and a trailing slash dropped. Null when it cannot be read safely: a `.` or `..`
 * segment, an encoded slash, backslash or percent sign, a control character, an invalid
 * escape, a query or a fragment.
 */
export function normalisePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || /[?#\\]/.test(path) || /%(2f|5c|25)/i.test(path)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\?#]/.test(decoded)) return null;
  const segments = decoded.toLowerCase().split("/").filter(Boolean);
  // The origin refuses dot segments (infra/aws/transport.mjs); resolving them here would
  // let the gate and the origin disagree on which read is asked.
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return "/" + segments.join("/");
}

/** The rules checked and ordered, longest prefix first. Throws on a rule that could be
 * misread: an unknown level, a prefix named twice, a prefix that is not already normal. */
export function compileRules(rules) {
  if (!Array.isArray(rules)) throw new Error("rules: a list required");
  const seen = new Set();
  for (const rule of rules) {
    const { prefix, level } = rule ?? {};
    if (typeof prefix !== "string" || !PREFIX.test(prefix) || normalisePath(prefix) !== prefix) throw new Error(`invalid prefix: ${prefix}`);
    if (level !== 2 && level !== 3) throw new Error(`invalid level for ${prefix}: ${level}`);
    if (seen.has(prefix)) throw new Error(`prefix named twice: ${prefix}`);
    seen.add(prefix);
  }
  return rules.map(({ prefix, level }) => ({ prefix, level })).sort((a, b) => b.prefix.length - a.prefix.length || (a.prefix < b.prefix ? -1 : 1));
}

/** The minimum level of a normalised path: the longest rule that matches whole segments. */
export function minimumLevel(path, rules) {
  for (const { prefix, level } of rules) if (path === prefix || path.startsWith(prefix + "/")) return level;
  return 0;
}

/** The one token of the pass header, or null. */
function heldToken(headers) {
  const value = headers?.[PASS_HEADER];
  if (typeof value !== "string") return null;
  const token = value.trim();
  return TOKEN.test(token) ? token : null;
}

/**
 * `request`: { method, path, headers } with lower-case header names.
 * `{ action: "forward", level, minimum }`: let through; `level` is the verified level (0
 * without a valid pass). `{ action: "respond", status, headers, body }`: answered here, the
 * origin is not called.
 */
export function decide(request, { rules, keyring, now }) {
  const { method, path, headers } = request ?? {};
  const normal = normalisePath(path);
  if (normal === null || typeof method !== "string") return respond(400, { code: "INVALID_PATH", message: "Chemin invalide.", retry: false });
  if (method === "OPTIONS") return respond(204);
  const minimum = minimumLevel(normal, rules);
  const token = heldToken(headers);
  const pass = token ? verifyPass(token, keyring, now) : null;
  const level = pass?.ok ? pass.level : 0;
  if (level >= minimum) return { action: "forward", level, minimum };
  if (pass?.ok) return respond(403, { code: "LEVEL_REQUIRED", message: "Offre insuffisante.", retry: false, minimumLevel: minimum, level });
  const expired = pass?.reason === "expired";
  return respond(401, { code: !token ? "PASS_REQUIRED" : expired ? "PASS_EXPIRED" : "PASS_INVALID", message: "Connexion requise.", retry: expired, minimumLevel: minimum });
}
