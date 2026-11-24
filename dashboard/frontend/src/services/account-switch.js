/**
 * The accounts' feature switch (VI-38). Doc: docs/COMPTES_SITE.md, section 1.
 *
 * Server side, `accountFeatures(env)` reads the three settings on every call:
 *   NEON_AUTH_BASE_URL       Neon Auth's URL (https; http for a local stand-in on localhost only)
 *   NEON_AUTH_COOKIE_SECRET  32 characters or more (Neon's session cache cookie)
 *   ACCOUNT_API_ORIGIN       the account front's origin (its Function URL, no path)
 * `auth` needs the first two, `sync` all three. The browser never sees them: next.config.mjs freezes
 * `buildFlags(env)` into the bundle, read by `accountsOn()` and `accountSyncOn()`.
 */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

function url(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.protocol === "https:") return parsed;
    if (parsed.protocol === "http:" && LOCAL.has(parsed.hostname)) return parsed;
  } catch {}
  return null;
}

/** NEON_AUTH_BASE_URL as given (trimmed, no final slash), or null. */
export function neonAuthUrl(env = process.env) {
  const parsed = url(env.NEON_AUTH_BASE_URL);
  return parsed ? parsed.href.replace(/\/+$/, "") : null;
}

/** ACCOUNT_API_ORIGIN as an origin, or null (a path, a query or a public http host is not one). */
export function accountApiOrigin(env = process.env) {
  const parsed = url(env.ACCOUNT_API_ORIGIN);
  if (!parsed || (parsed.pathname !== "/" && parsed.pathname !== "")) return null;
  return parsed.origin;
}

export function accountFeatures(env = process.env) {
  const secret = typeof env.NEON_AUTH_COOKIE_SECRET === "string" ? env.NEON_AUTH_COOKIE_SECRET : "";
  const auth = Boolean(neonAuthUrl(env)) && secret.length >= 32;
  return { auth, sync: auth && Boolean(accountApiOrigin(env)) };
}

/** What next.config.mjs puts in the bundle: two flags, never a value. */
export function buildFlags(env = process.env) {
  const { auth, sync } = accountFeatures(env);
  return { NEXT_PUBLIC_VEGA_ACCOUNTS: auth ? "1" : "", NEXT_PUBLIC_VEGA_ACCOUNT_SYNC: sync ? "1" : "" };
}

// Written out in full so the bundler replaces them (next.config.mjs, `env`).
export const accountsOn = () => process.env.NEXT_PUBLIC_VEGA_ACCOUNTS === "1";
export const accountSyncOn = () => process.env.NEXT_PUBLIC_VEGA_ACCOUNT_SYNC === "1";
