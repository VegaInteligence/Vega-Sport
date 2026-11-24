/**
 * The account API's front: a Lambda Function URL handler (payload 2.0), outside the VPC. It
 * verifies the Neon session, routes the request, asks the store through the seam
 * (store-client.mjs) and signs the Vega pass. Never cached, never behind the read API's gate.
 * Failure modes: FAILURE_MODES.md, sections 8 (H1 to H16) and 9.
 *
 * Routes, all requiring a valid Neon session in X-Vega-Session but the preflight:
 *   POST   /account/session            the account ensured, its level and a fresh pass
 *   GET    /account/preferences        { contract, revision }: the document as sent, or nulls
 *   PUT    /account/preferences        stores the body's document; { revision }; If-Match optional
 *   GET    /account/export             everything the AWS side holds about the account
 *   DELETE /account                    AWS rows, then the Neon user
 */
import { createKeyring, signPass, DEFAULT_LIFETIME } from "./pass.mjs";
import { checkContract, ContractError } from "./contract.mjs";
import { createSessionVerifier } from "./session.mjs";
import { createStoreClient, lambdaInvoker, StoreRefusal, StoreUnavailable } from "./store-client.mjs";
import { neonFromEnv } from "./neon.mjs";

/** The largest body of a PUT, decoded. A Function URL takes 6 MB; 4 MiB in base64 is 5.6 MB. */
export const MAX_BODY = 4 * 1024 * 1024;
const ROUTES = {
  "/account/session": { POST: "session" },
  "/account/preferences": { GET: "getPreferences", PUT: "putPreferences" },
  "/account/export": { GET: "export" },
  "/account": { DELETE: "erase" },
};
const WITH_BODY = new Set(["putPreferences"]);
// A revision as If-Match gives it: digits, or an entity tag's quotes around them.
const REVISION = /^"?([1-9][0-9]{0,15})"?$/;
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;
/** status, retry, message, by code. */
const CODES = {
  INVALID_REQUEST: [400, false, "Requête invalide."],
  NOT_FOUND: [404, false, "Route inconnue."],
  METHOD_NOT_ALLOWED: [405, false, "Méthode non permise."],
  ORIGIN_REFUSED: [403, false, "Origine non autorisée."],
  SESSION_REQUIRED: [401, false, "Session requise."],
  SESSION_EXPIRED: [401, true, "Session expirée."],
  SESSION_INVALID: [401, false, "Session invalide."],
  AUTH_UNAVAILABLE: [503, true, "Connexion momentanément indisponible."],
  UNSUPPORTED_MEDIA_TYPE: [415, false, "Corps JSON attendu."],
  BODY_TOO_LARGE: [413, false, "Corps trop volumineux."],
  INVALID_JSON: [400, false, "JSON invalide."],
  CONTRACT_INVALID: [400, false, "Préférences invalides."],
  CONTRACT_VERSION: [422, false, "Version des préférences inconnue."],
  CONTRACT_LIMIT: [413, false, "Préférences trop volumineuses."],
  STALE: [409, false, "Les préférences ont changé depuis cette version."],
  ACCOUNT_ERASED: [410, false, "Ce compte a été supprimé."],
  SUBSCRIPTION_ACTIVE: [409, false, "Un abonnement est en cours : résiliez-le avant de supprimer le compte."],
  DELETION_UNAVAILABLE: [503, false, "La suppression du compte n'est pas encore disponible."],
  IDENTITY_DELETE_FAILED: [502, true, "Vos données Vega sont effacées ; la suppression de l'identifiant de connexion a échoué. Réessayez."],
  STORE_UNAVAILABLE: [503, true, "Comptes momentanément indisponibles."],
  NOT_CONFIGURED: [503, false, "Comptes non configurés."],
  INTERNAL: [500, false, "Erreur interne."],
};
const SESSION_CODES = { missing: "SESSION_REQUIRED", expired: "SESSION_EXPIRED", unavailable: "AUTH_UNAVAILABLE" };
const RETRY_AFTER = new Set(["AUTH_UNAVAILABLE", "STORE_UNAVAILABLE"]);
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

function reply(status, body, headers = {}) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", vary: "Origin", ...headers },
    body: body === undefined ? "" : JSON.stringify(body),
    isBase64Encoded: false,
  };
}
function failure(code, headers = {}, { message, path, retry, extra } = {}) {
  const [status, retryDefault, text] = CODES[code];
  const error = { code, message: message ?? text, retry: retry ?? retryDefault, ...(path !== undefined && { path }) };
  return reply(status, { ok: false, ...extra, error }, { ...(RETRY_AFTER.has(code) && { "retry-after": "5" }), ...headers });
}

/**
 * `verifier`: createSessionVerifier; `origins`: the site origins allowed by CORS; `keyring`: the
 * pass keys (pass.mjs); `store`: createStoreClient; `neon`: { deleteUser } or null (deletion
 * then fails closed); `clock`: whole seconds; `log`: one line per request.
 */
export function createFront({ verifier, origins, keyring, store, neon = null, clock = () => Math.floor(Date.now() / 1000), log = () => {} }) {
  const allowed = new Set(origins);

  /** The work of one route for a verified account: a reply. */
  const work = {
    async session(accountId) {
      const { created, level } = await store.call("session", { accountId });
      const now = clock();
      return reply(200, { accountId, level, created, pass: signPass({ accountId, level, now }, keyring), passExpiresAt: now + DEFAULT_LIFETIME });
    },
    getPreferences: async (accountId) => reply(200, await store.call("getPreferences", { accountId })),
    putPreferences: async (accountId, { preferences, ifMatch }) => reply(200, await store.call("putPreferences", { accountId, preferences, ...(ifMatch !== undefined && { ifMatch }) })),
    async export(accountId) {
      const held = await store.call("export", { accountId });
      const body = {
        format: "vega-account-export",
        v: 1,
        exportedAt: new Date(clock() * 1000).toISOString(),
        identity: "Your e-mail address, name and sign-in methods are held by Neon Auth, not by Vega's servers; this export holds everything Vega's servers keep about your account.",
        ...held,
      };
      return reply(200, body, { "content-disposition": 'attachment; filename="vega-account-export.json"' });
    },
    // AWS first (one transaction), Neon second: the other order would leave rows no one can erase
    // once the person can no longer sign in (X4).
    async erase(accountId) {
      if (!neon) return failure("DELETION_UNAVAILABLE");
      await store.call("erase", { accountId });
      let outcome;
      try {
        outcome = await neon.deleteUser(accountId);
      } catch {
        outcome = { ok: false, status: 0, retry: true };
      }
      if (outcome?.ok) return reply(200, { erased: true, identityDeleted: true });
      return failure("IDENTITY_DELETE_FAILED", {}, { retry: outcome?.retry === true, extra: { erased: true } });
    },
  };

  async function serve(event, note) {
    const method = event?.requestContext?.http?.method,
      path = event?.rawPath;
    if (event?.version !== "2.0" || typeof method !== "string" || typeof path !== "string") return failure("INVALID_REQUEST");
    const headers = {};
    for (const [name, value] of Object.entries(event.headers ?? {})) if (typeof value === "string") headers[name.toLowerCase()] = value;
    if (!Object.hasOwn(ROUTES, path)) return failure("NOT_FOUND");
    note.route = path;
    const origin = headers.origin;
    if (origin !== undefined && !allowed.has(origin)) return failure("ORIGIN_REFUSED");
    const cors = origin ? { "access-control-allow-origin": origin } : {};
    const methods = ROUTES[path];
    if (method === "OPTIONS") {
      if (!origin) return failure("ORIGIN_REFUSED");
      return reply(204, undefined, {
        ...cors,
        "access-control-allow-methods": "GET, PUT, POST, DELETE",
        "access-control-allow-headers": "X-Vega-Session, Content-Type",
        "access-control-max-age": "600",
      });
    }
    const command = Object.hasOwn(methods, method) ? methods[method] : null;
    if (!command) return failure("METHOD_NOT_ALLOWED", { ...cors, allow: [...Object.keys(methods), "OPTIONS"].join(", ") });
    if (event.rawQueryString) return failure("INVALID_REQUEST", cors);
    note.command = command;

    const session = await verifier.verify(headers["x-vega-session"]);
    if (!session.ok) {
      note.reason = session.reason;
      return failure(SESSION_CODES[session.reason] ?? "SESSION_INVALID", cors);
    }

    let input;
    if (WITH_BODY.has(command)) {
      let ifMatch;
      if (headers["if-match"] !== undefined) {
        const found = REVISION.exec(headers["if-match"].trim());
        if (!found || !Number.isSafeInteger(Number(found[1]))) return failure("INVALID_REQUEST", cors, { message: "If-Match : une révision attendue." });
        ifMatch = Number(found[1]);
      }
      if (!JSON_TYPE.test(headers["content-type"] ?? "")) return failure("UNSUPPORTED_MEDIA_TYPE", cors);
      const raw = typeof event.body === "string" ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8") : Buffer.alloc(0);
      if (raw.length > MAX_BODY) return failure("BODY_TOO_LARGE", cors);
      let value;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      } catch {
        return failure("INVALID_JSON", cors);
      }
      try {
        checkContract(value);
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
        note.reason = error.code;
        return failure(error.code, cors, { message: error.message });
      }
      input = { preferences: value, ifMatch };
    }

    try {
      const out = await work[command](session.accountId, input);
      out.headers = { ...out.headers, ...cors };
      return out;
    } catch (error) {
      if (error instanceof StoreUnavailable) return failure("STORE_UNAVAILABLE", cors);
      if (error instanceof StoreRefusal) {
        note.reason = error.code;
        if (["ACCOUNT_ERASED", "SUBSCRIPTION_ACTIVE"].includes(error.code)) return failure(error.code, cors);
        if (error.code === "STALE") return failure("STALE", cors, { extra: { revision: error.details.revision ?? null } });
        if (error.code.startsWith("CONTRACT_") && CODES[error.code]) return failure(error.code, cors, { message: error.message });
        return failure("INTERNAL", cors);
      }
      note.reason = "exception";
      return failure("INTERNAL", cors);
    }
  }

  return async function handler(event) {
    const started = Date.now();
    const note = { route: "unmatched" };
    const out = await serve(event, note);
    // Never the token, the account id, an address or a body (H14).
    log(JSON.stringify({ method: typeof event?.requestContext?.http?.method === "string" ? event.requestContext.http.method.slice(0, 10) : "?", route: note.route, ...(note.command && { command: note.command }), status: out.statusCode, ms: Date.now() - started, ...(note.reason && { reason: note.reason }) }));
    return out;
  };
}

/** The allowed site origins of VEGA_SITE_ORIGINS: exact origins, https (http for a local site only), never `*`. */
function originsOf(text) {
  const list = (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error("no origin");
  for (const origin of list) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`not an origin: ${origin}`);
    }
    if (url.origin !== origin || !(url.protocol === "https:" || (url.protocol === "http:" && LOCAL.has(url.hostname)))) throw new Error(`not an exact https origin: ${origin}`);
  }
  return list;
}

/** VEGA_PASS_KEYS: `name:base64url,name:base64url`; VEGA_PASS_KEY_CURRENT: the name that signs. */
function keyringOf(env) {
  const keys = {};
  for (const pair of (env.VEGA_PASS_KEYS ?? "").split(",").filter(Boolean)) {
    const [name, value, ...rest] = pair.trim().split(":");
    if (!name || !value || rest.length) throw new Error("expected name:base64url pairs");
    keys[name] = value;
  }
  return createKeyring({ current: env.VEGA_PASS_KEY_CURRENT, keys });
}

/**
 * The front from its environment (the Lambda entry). A missing or invalid setting makes every
 * request answer 503 NOT_CONFIGURED, and the cold start logs the names of the faulty settings
 * (never their values). `deps`: { invoke, fetchJwks, neon, neonFetch, clock, log } for tests.
 */
export function createFrontFromEnv(env, deps = {}) {
  const log = deps.log ?? (() => {});
  const problems = [];
  const attempt = (name, make) => {
    try {
      return make();
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      return null;
    }
  };
  const verifier = attempt("VEGA_NEON_AUTH_URL", () => createSessionVerifier({ authUrl: env.VEGA_NEON_AUTH_URL, ...(deps.fetchJwks && { fetchJwks: deps.fetchJwks }), ...(deps.clock && { clock: deps.clock }) }));
  const origins = attempt("VEGA_SITE_ORIGINS", () => originsOf(env.VEGA_SITE_ORIGINS));
  const keyring = attempt("VEGA_PASS_KEYS", () => keyringOf(env));
  const invoke = attempt("VEGA_ACCOUNT_STORE_FUNCTION", () => {
    const invoker = lambdaInvoker({ functionName: env.VEGA_ACCOUNT_STORE_FUNCTION });
    return deps.invoke ?? invoker;
  });
  const neon = attempt("VEGA_NEON_API_KEY", () => (deps.neon !== undefined ? deps.neon : neonFromEnv(env, { fetch: deps.neonFetch })));
  if (problems.length) {
    log(JSON.stringify({ configuration: "incomplete", problems }));
    return async () => failure("NOT_CONFIGURED");
  }
  if (!neon) log(JSON.stringify({ configuration: "no Neon API key: DELETE /account answers 503 DELETION_UNAVAILABLE" }));
  return createFront({ verifier, origins, keyring, store: createStoreClient(invoke), neon, ...(deps.clock && { clock: deps.clock }), log });
}
