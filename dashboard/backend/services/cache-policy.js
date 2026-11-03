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
  return candidates.some(
    (tag) => tag.replace(/^W\//, "") === etag.replace(/^W\//, ""),
  );
}
