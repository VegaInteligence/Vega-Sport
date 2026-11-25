import { API_ORIGIN } from "../../../../src/api-origin.js";
import { safeResolvedMedia } from "../../../../src/services/resolved-media.js";

/* An image copy served from the site's own origin, so the match page can read a crest's pixels
 * for the team's colour (FAILURE_MODES § 64): the API's image host sends no CORS header. Only the
 * address of a copy (data/sources/…/<hash>.<ext>, as `safeResolvedMedia` accepts it) is read,
 * and the answer is kept a year: the file name is its content's hash. */
const TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export async function GET(request, { params }) {
  const { path } = await params;
  const address = safeResolvedMedia(`${API_ORIGIN}/${(path || []).join("/")}`);
  if (!address) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const upstream = await fetch(address, { signal: request.signal }).catch(() => null);
  if (!upstream?.ok)
    return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": TYPES[address.split(".").pop()],
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
