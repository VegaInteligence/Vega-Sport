/**
 * HTTP layer of the v2 read API. Same behaviour as the current API
 * (dashboard/backend/services/relational-core.js and cache-policy.js on main):
 * same envelope, same validators, same cache headers. One addition, allowed by
 * the v2 contract: every error says whether retrying can help.
 */

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function reject(status, message, code) {
  throw new ApiError(status, message, code);
}

/** Unknown, repeated or oversized parameters are refused (legacy validateParams). */
export function validateParams(params, allowed) {
  if (
    [...params].some(([k, v]) => !allowed.includes(k) || v.length > 2048) ||
    new Set(params.keys()).size !== [...params].length
  )
    reject(400, "Paramètres invalides.");
}

/** Mutable responses retain browser revalidation; CDN freshness is explicit. */
export function cacheHeaders(ttl = 60, swr = 30, { immutable = false } = {}) {
  const browser = immutable ? 31536000 : 0;
  const shared = immutable ? 31536000 : ttl;
  const stale = !immutable && swr ? `, stale-while-revalidate=${swr}` : "";
  return {
    "Cache-Control": `public, max-age=${browser}, s-maxage=${shared}${immutable ? ", immutable" : ", must-revalidate"}`,
    "CDN-Cache-Control": `public, s-maxage=${shared}${stale}`,
    "Vercel-CDN-Cache-Control": `public, s-maxage=${shared}${stale}`,
  };
}

export const noStoreHeaders = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

/** GET/HEAD If-None-Match uses weak comparison, including lists and '*'. */
export function matchesEtag(value, etag) {
  if (!value) return false;
  if (value.trim() === "*") return true;
  const tags = /(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/g;
  const candidates = value.match(tags) || [];
  if (!/^[\s,]*$/.test(value.replace(tags, ""))) return false;
  return candidates.some((tag) => tag.replace(/^W\//, "") === etag.replace(/^W\//, ""));
}

export function send(req, value, status = 200, { etag, ttl = 0, maxBytes = 0, headers = {} } = {}) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Data-Source": "AWS",
    "X-Vega-Schema": "v2",
    ...(ttl > 0 && status === 200 ? cacheHeaders(ttl, 0) : noStoreHeaders),
    ...headers,
  };
  if (etag && status === 200) {
    h.ETag = etag;
    if (matchesEtag(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: h });
  }
  if (req.method === "HEAD") return new Response(null, { status, headers: h });
  const body = JSON.stringify(value),
    bytes = Buffer.byteLength(body);
  if (maxBytes && bytes > maxBytes)
    return send(req, { error: { code: "PAGE_TOO_LARGE", message: "Réduisez la taille de page.", retry: false } }, 413);
  return new Response(body, { status, headers: { ...h, "Content-Length": String(bytes) } });
}

/** Stable machine-readable codes, and whether the same request may succeed later. */
const ERRORS = {
  400: ["INVALID_PARAMETER", false],
  404: ["RESOURCE_NOT_FOUND", false],
  405: ["METHOD_NOT_ALLOWED", false],
  409: ["PUBLICATION_CHANGED", true],
  413: ["PAGE_TOO_LARGE", false],
};

export function errorResponse(req, error) {
  const status = error.status >= 400 && error.status <= 599 ? error.status : 503;
  const [code, retry] = ERRORS[status] || ["DATA_UNAVAILABLE", true];
  return send(
    req,
    {
      ok: false,
      available: false,
      error: {
        // Only the API's own codes are public; a database error is DATA_UNAVAILABLE.
        code: (error instanceof ApiError && error.code) || code,
        message: status === 503 ? "Données indisponibles." : error.message,
        retry,
      },
    },
    status,
  );
}
