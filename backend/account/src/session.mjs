/**
 * The Neon session: the person's Neon Auth token, sent by the site in `X-Vega-Session`, verified
 * offline. Neon signs it with EdDSA (Ed25519) and publishes its keys at
 * `<auth URL>/.well-known/jwks.json`; `iss` and `aud` are the origin of the auth URL. The key set
 * is kept in memory and fetched again when a token names a key not seen yet (rotation), never
 * pinned in a deployment. Failure modes: FAILURE_MODES.md, section 4.
 *
 * Times are whole seconds since the epoch; `clock` is injected.
 */
import { jwtVerify, importJWK, errors } from "jose";

/** The key set is fetched again once it is this old (a key Neon removed stops verifying). */
export const JWKS_MAX_AGE = 600;
/** At most one fetch of the key set per this many seconds for kids not seen yet. */
export const JWKS_COOLDOWN = 30;
/** When Neon cannot be reached, a known key of a set fetched less than this long ago is used. */
export const JWKS_STALE_LIMIT = 3600;
export const CLOCK_SKEW = 60;
export const MAX_TOKEN_LENGTH = 8192;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const now = () => Math.floor(Date.now() / 1000);

/** The JSON object of a base64url segment, or null. */
function decode(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The default way to fetch Neon's key set: a GET with a timeout, no redirect, a 200 JSON answer
 * of 64 KiB at most holding a `keys` list. Anything else throws.
 */
export function jwksFetcher(fetchImpl = globalThis.fetch, { timeoutMs = 3000, maxBytes = 64 * 1024 } = {}) {
  return (url) =>
    withTimeout(timeoutMs, async (signal) => {
      const response = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error", signal });
      if (response.status !== 200) throw new Error(`key set: status ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error("key set: too large");
      const doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!doc || typeof doc !== "object" || !Array.isArray(doc.keys)) throw new Error("key set: no keys list");
      return doc;
    });
}

/**
 * Runs `work(signal)`, aborting it after `ms`. The timer is an ordinary one, not
 * AbortSignal.timeout's, whose timer does not keep the process alive.
 */
export async function withTimeout(ms, work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${ms} ms`)), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** The Ed25519 signing keys of a key set, by kid; any other key is left out. */
async function usableKeys(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.keys)) throw new Error("key set: no keys list");
  const keys = new Map();
  for (const jwk of doc.keys) {
    if (!jwk || typeof jwk !== "object" || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") continue;
    if (typeof jwk.kid !== "string" || !jwk.kid || jwk.kid.length > 128) continue;
    if (jwk.use !== undefined && jwk.use !== "sig") continue;
    if (jwk.alg !== undefined && jwk.alg !== "EdDSA") continue;
    try {
      keys.set(jwk.kid, await importJWK({ kty: "OKP", crv: "Ed25519", x: jwk.x }, "EdDSA"));
    } catch {
      // A key that does not import is not a key.
    }
  }
  return keys;
}

/**
 * A verifier of Neon sessions. `authUrl`: the branch's auth URL (https, no query or fragment).
 * `fetchJwks(url)`: gives the key set's JSON (tests inject theirs; by default `jwksFetcher()`).
 * `verify(token)` gives `{ ok: true, accountId, expiresAt }` or `{ ok: false, reason }`, reason one
 * of missing, format, header, key, signature, claims, expired, not-yet, unavailable.
 */
export function createSessionVerifier({ authUrl, fetchJwks = jwksFetcher(), clock = now }) {
  let url;
  try {
    url = new URL(authUrl);
  } catch {
    throw new Error("the auth URL is not a URL");
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) throw new Error("the auth URL must be https, without query, fragment or credentials");
  const origin = url.origin;
  const jwksUrl = `${url.href.replace(/\/+$/, "")}/.well-known/jwks.json`;

  let keys = new Map(),
    fetchedAt = null,
    lastAttempt = -Infinity,
    lastOk = true,
    inflight = null;

  function refresh() {
    if (inflight) return inflight;
    lastAttempt = clock();
    inflight = (async () => {
      try {
        keys = await usableKeys(await fetchJwks(jwksUrl));
        fetchedAt = clock();
        lastOk = true;
      } catch {
        lastOk = false;
      } finally {
        inflight = null;
      }
      return lastOk;
    })();
    return inflight;
  }

  /** The key named `kid`, or the reason there is none. */
  async function keyFor(kid) {
    const at = clock();
    if (fetchedAt !== null && at - fetchedAt < JWKS_MAX_AGE && keys.has(kid)) return { key: keys.get(kid) };
    let failed;
    if (inflight || at - lastAttempt >= JWKS_COOLDOWN) {
      failed = !(await refresh());
      if (!failed) return keys.has(kid) ? { key: keys.get(kid) } : { reason: "key" };
    } else failed = !lastOk;
    // Neon is out of reach (or was, within the cooldown): a known key of a recent set still serves.
    if (keys.has(kid) && fetchedAt !== null && at - fetchedAt < JWKS_STALE_LIMIT) return { key: keys.get(kid) };
    return { reason: failed || fetchedAt === null ? "unavailable" : "key" };
  }

  async function verify(token) {
    const fail = (reason) => ({ ok: false, reason });
    if (token === undefined || token === null || token === "") return fail("missing");
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return fail("format");
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every((part) => SEGMENT.test(part))) return fail("format");
    const header = decode(parts[0]);
    if (!header || !decode(parts[1])) return fail("format");
    // The algorithm and the key are the verifier's choice, never the token's.
    if (header.alg !== "EdDSA" || typeof header.kid !== "string" || !header.kid || header.crit !== undefined) return fail("header");
    const found = await keyFor(header.kid);
    if (!found.key) return fail(found.reason);
    const at = clock();
    let payload;
    try {
      ({ payload } = await jwtVerify(token, found.key, {
        algorithms: ["EdDSA"],
        issuer: origin,
        audience: origin,
        currentDate: new Date(at * 1000),
        clockTolerance: CLOCK_SKEW,
        requiredClaims: ["sub", "exp", "iat"],
      }));
    } catch (error) {
      if (error instanceof errors.JWSSignatureVerificationFailed) return fail("signature");
      if (error instanceof errors.JWTExpired) return fail("expired");
      if (error instanceof errors.JWTClaimValidationFailed) return fail(error.claim === "nbf" && error.reason === "check_failed" ? "not-yet" : "claims");
      if (error instanceof errors.JOSEAlgNotAllowed) return fail("header");
      if (error instanceof errors.JWTInvalid) return fail("claims");
      return fail("format");
    }
    const { sub, exp, iat } = payload;
    if (typeof sub !== "string" || !ACCOUNT_ID.test(sub) || !Number.isInteger(exp) || !Number.isInteger(iat)) return fail("claims");
    if (iat > at + CLOCK_SKEW) return fail("not-yet");
    return { ok: true, accountId: sub, expiresAt: exp };
  }

  return { verify, origin, jwksUrl };
}
