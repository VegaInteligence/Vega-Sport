/**
 * The site's same-origin relay of the account API (VI-38): app/api/account/[[...path]]/route.js. The browser calls
 * /api/account/*; this reads the Neon session server-side, gets its JWT and forwards to ACCOUNT_API_ORIGIN with
 * X-Vega-Session. The JWT never reaches the browser. Doc: docs/COMPTES_SITE.md, section 2 (P1 to P10);
 * tests: tests/account-proxy.test.mjs. The error envelope is the account API's: { ok: false, error: { code,
 * message, retry } }.
 */

/** The five routes: path under /api/account → methods. "" is /api/account itself. */
export const ACCOUNT_ROUTES = Object.freeze({
  session: ["POST"],
  preferences: ["GET", "PUT"],
  export: ["GET"],
  "": ["DELETE"],
});
/** The account API's own bound on a PUT body. */
export const MAX_BODY = 4 * 1024 * 1024;
const WRITES = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;
const REVISION = /^"?[1-9][0-9]{0,15}"?$/;
const PREFIX = "/api/account";
const PASSED_HEADERS = ["content-type", "content-disposition"];

const CODES = {
  NOT_FOUND: [404, false, "Route inconnue."],
  METHOD_NOT_ALLOWED: [405, false, "Méthode non permise."],
  INVALID_REQUEST: [400, false, "Requête invalide."],
  ORIGIN_REFUSED: [403, false, "Origine non autorisée."],
  UNSUPPORTED_MEDIA_TYPE: [415, false, "Corps JSON attendu."],
  BODY_TOO_LARGE: [413, false, "Corps trop volumineux."],
  SESSION_REQUIRED: [401, false, "Session requise."],
  AUTH_UNAVAILABLE: [503, true, "Connexion momentanément indisponible."],
  SYNC_UNAVAILABLE: [503, false, "La synchronisation n'est pas encore disponible."],
  ACCOUNT_UNREACHABLE: [502, true, "Le serveur des comptes ne répond pas."],
};
const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function failure(code, headers = {}, message) {
  const [status, retry, text] = CODES[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: message ?? text, retry } }), {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  });
}

/**
 * The origin the browser addressed: Host (X-Forwarded-Host behind Vercel's proxy) and the protocol, else the URL's.
 * `next start` builds request.url on localhost whatever the Host; a browser cannot forge the Host of its requests.
 */
function ownOrigin(request, url) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  if (!host) return url.origin;
  const proto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "")).split(",")[0].trim();
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return url.origin;
  }
}

/** The route of a request, or a refusal (P1 to P4). No session read, no body read. */
export function decideAccountRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return { refuse: failure("NOT_FOUND") };
  const path = url.pathname === PREFIX ? "" : url.pathname.slice(PREFIX.length + 1);
  if (!Object.hasOwn(ACCOUNT_ROUTES, path) || (path === "" && url.pathname !== PREFIX)) return { refuse: failure("NOT_FOUND") };
  const methods = ACCOUNT_ROUTES[path];
  if (!methods.includes(request.method)) return { refuse: failure("METHOD_NOT_ALLOWED", { allow: methods.join(", ") }) };
  if (url.search) return { refuse: failure("INVALID_REQUEST") };
  const headers = request.headers;
  if (WRITES.has(request.method)) {
    const site = headers.get("sec-fetch-site");
    const origin = headers.get("origin");
    const own = ownOrigin(request, url);
    const sameOrigin = site !== null ? site === "same-origin" && (origin === null || origin === own) : origin === own;
    if (!sameOrigin) return { refuse: failure("ORIGIN_REFUSED") };
    if (!JSON_TYPE.test(headers.get("content-type") ?? "")) return { refuse: failure("UNSUPPORTED_MEDIA_TYPE") };
  }
  let ifMatch;
  if (request.method === "PUT" && headers.get("if-match") !== null) {
    ifMatch = headers.get("if-match").trim();
    if (!REVISION.test(ifMatch)) return { refuse: failure("INVALID_REQUEST", {}, "If-Match : une révision attendue.") };
  }
  return { path: path ? `/account/${path}` : "/account", method: request.method, withBody: request.method === "PUT", ifMatch };
}

async function bodyOf(request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.length > MAX_BODY ? null : new TextDecoder().decode(bytes);
}

/**
 * The whole exchange. `features`: accountFeatures(); `upstream`: the account API's origin; `getToken()`:
 * { token } | { error: "missing" | "unavailable" } (rejecting counts as unavailable); `fetch`, `timeoutMs` for
 * tests.
 */
export async function handleAccountRequest(request, { features, upstream, getToken, fetch: fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!features?.auth) return failure("NOT_FOUND");
  const decision = decideAccountRequest(request);
  if (decision.refuse) return decision.refuse;
  if (!features.sync || !upstream) return failure("SYNC_UNAVAILABLE");
  let body;
  if (decision.withBody) {
    body = await bodyOf(request);
    if (body === null) return failure("BODY_TOO_LARGE");
  }
  let found;
  try {
    found = await getToken();
  } catch {
    found = { error: "unavailable" };
  }
  if (typeof found?.token !== "string" || !found.token) return failure(found?.error === "missing" ? "SESSION_REQUIRED" : "AUTH_UNAVAILABLE");

  const headers = { accept: "application/json", "x-vega-session": found.token };
  if (decision.withBody) headers["content-type"] = "application/json";
  if (decision.ifMatch !== undefined) headers["if-match"] = decision.ifMatch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  let response, text;
  try {
    response = await fetchImpl(`${upstream}${decision.path}`, {
      method: decision.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    text = await response.text();
  } catch {
    return failure("ACCOUNT_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
  if (!/^application\/json/i.test(response.headers.get("content-type") ?? "")) return failure("ACCOUNT_UNREACHABLE");
  try {
    JSON.parse(text);
  } catch {
    return failure("ACCOUNT_UNREACHABLE");
  }
  const out = { ...BASE_HEADERS };
  for (const name of PASSED_HEADERS) {
    const value = response.headers.get(name);
    if (value) out[name] = value;
  }
  return new Response(text, { status: response.status, headers: out });
}
