/**
 * The route of a request as the logs name it (FAILURE_MODES_OPTIMISATIONS.md GH204, GH149): the path after /api/ (or
 * live/), each identifier (m_…, p_…, t_…, l_…, a World Cup match's key) written `id`, the segments joined by dots:
 * read.home-favourites, matches.id.summary, players.id.injuries. The handler names `other` a path no route serves; the
 * edge function of infra/aws/api.yaml (EdgeFamily) writes the same names for the access logs, and
 * test/edge-logs.test.mjs keeps the two together. Never an identifier, a query or a value: a finite set.
 */
const ID = /^[mptl]_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

export function routeFamily(path) {
  const parts = String(path || "").split("/");
  if (parts[0] !== "" || (parts[1] !== "api" && parts[1] !== "live") || parts.length > 8) return "other";
  const rest = parts[1] === "live" ? ["live", ...parts.slice(2)] : parts.slice(2);
  const named = rest.map((part, i) => (ID.test(part) || (i === 2 && rest[0] === "worldcup" && rest[1] === "matches" && KEY.test(part)) ? "id" : part));
  const name = named.join(".");
  return /^[a-z0-9.-]{1,40}$/.test(name) ? name : "other";
}
