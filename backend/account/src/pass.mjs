/**
 * The pass: what a signed-in visitor shows to read what its level opens. A compact JWS
 * (header.payload.signature, base64url, HMAC-SHA256) carrying the account id and the
 * level, nothing else about the person. The account API signs it; the gate before the
 * cache verifies it (gate.mjs). Failure modes: FAILURE_MODES.md, section 1.
 *
 * Times are whole seconds since the epoch.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Levels a pass may carry: 1 free account, 2 Plus, 3 Pro. A visitor (0) holds none. */
export const PASS_LEVELS = [1, 2, 3];
/** The longest a pass may live. A change of plan takes effect at the next renewal. */
export const MAX_LIFETIME = 900;
export const DEFAULT_LIFETIME = 600;
/** How far ahead of the verifier's clock an issuer's clock may be. */
export const CLOCK_SKEW = 60;
const MAX_LENGTH = 1024;
const MIN_KEY_BYTES = 32;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;

const seconds = (value, name) => {
  // Below 1e11: a clock given in milliseconds is a mistake, not a far future.
  if (!Number.isInteger(value) || value < 0 || value >= 1e11) throw new Error(`${name}: whole seconds since the epoch required`);
  return value;
};
const validLevel = (level) => Number.isInteger(level) && PASS_LEVELS.includes(level);
const validAccount = (id) => typeof id === "string" && ACCOUNT_ID.test(id);
const sign = (key, body) => createHmac("sha256", key).update(body).digest();
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** The JSON object of a segment, or null. */
function decode(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The keys a signer or a verifier holds. `keys`: name -> key (a Buffer, or its base64url
 * text as a parameter store keeps it), 32 bytes at least. `current`: the name of the key
 * that signs. A rotation adds the new key everywhere, makes it current, then drops the old
 * one once the passes it signed have expired.
 */
export function createKeyring({ current, keys }) {
  const held = new Map();
  for (const [name, value] of Object.entries(keys ?? {})) {
    if (!KEY_ID.test(name)) throw new Error("invalid key name");
    const key = Buffer.isBuffer(value) ? value : typeof value === "string" && SEGMENT.test(value) ? Buffer.from(value, "base64url") : null;
    if (!key || key.length < MIN_KEY_BYTES) throw new Error(`key ${name}: ${MIN_KEY_BYTES} bytes at least`);
    held.set(name, key);
  }
  if (!held.has(current)) throw new Error("the current key is not held");
  return { current, keys: held };
}

/** A pass for `accountId` at `level`, issued at `now`, valid `lifetime` seconds. */
export function signPass({ accountId, level, now, lifetime = DEFAULT_LIFETIME }, keyring) {
  if (!validAccount(accountId)) throw new Error("invalid account id");
  if (!validLevel(level)) throw new Error("invalid level");
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > MAX_LIFETIME) throw new Error("invalid lifetime");
  const iat = seconds(now, "now");
  const body = `${encode({ alg: "HS256", typ: "JWT", kid: keyring.current })}.${encode({ sub: accountId, lvl: level, iat, exp: iat + lifetime })}`;
  return `${body}.${sign(keyring.keys.get(keyring.current), body).toString("base64url")}`;
}

/**
 * `{ ok: true, accountId, level, expiresAt }`, or `{ ok: false, reason }` with reason one of
 * format, header, key, signature, claims, lifetime, not-yet, expired. The reason is for the
 * verifier's own decisions and logs: only `expired` is told to a client (gate.mjs).
 */
export function verifyPass(token, keyring, now) {
  const at = seconds(now, "now");
  const fail = (reason) => ({ ok: false, reason });
  if (typeof token !== "string" || token.length > MAX_LENGTH) return fail("format");
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => SEGMENT.test(part))) return fail("format");
  const header = decode(parts[0]),
    claims = decode(parts[1]);
  if (!header || !claims) return fail("format");
  // The algorithm is the verifier's: a token that announces another is not looked at further.
  if (header.alg !== "HS256" || typeof header.kid !== "string") return fail("header");
  const key = keyring.keys.get(header.kid);
  if (!key) return fail("key");
  const expected = sign(key, `${parts[0]}.${parts[1]}`),
    given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return fail("signature");
  const { sub, lvl, iat, exp } = claims;
  if (!validAccount(sub) || !validLevel(lvl) || !Number.isInteger(iat) || !Number.isInteger(exp)) return fail("claims");
  if (exp <= iat || exp - iat > MAX_LIFETIME) return fail("lifetime");
  if (iat > at + CLOCK_SKEW) return fail("not-yet");
  if (exp <= at) return fail("expired");
  return { ok: true, accountId: sub, level: lvl, expiresAt: exp };
}
