/**
 * The key the site's server sends with its own reads of the API (VI-35): the
 * distribution's web ACL (infra/aws/waf.yaml) leaves the requests carrying it out of its
 * per-address limit, since the server's few shared addresses read for every visitor.
 * Server only: VEGA_API_EDGE_KEY has no NEXT_PUBLIC_ prefix and is never compiled into a
 * page. Unset or malformed, no header (the web ACL then counts these reads like any).
 * Never sent on a visitor's behalf (the /api proxy): it would lend the exemption.
 */
const KEY = /^[A-Za-z0-9_-]{32,128}$/;
export function edgeKeyHeaders(env = process.env) {
  const key = env.VEGA_API_EDGE_KEY;
  return typeof key === "string" && KEY.test(key) ? { "X-Vega-Edge-Key": key } : {};
}
