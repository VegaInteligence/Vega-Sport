// Neon Auth on the server (VI-38): one instance, or null while accounts are off (account-switch.js).
// Read only by the route handlers app/api/auth and app/api/account: no layout or page reads a session.
import { createNeonAuth } from "@neon/auth/next/server";
import { accountFeatures, neonAuthUrl } from "../services/account-switch.js";

let instance = null;

export function neonAuth(env = process.env) {
  if (!accountFeatures(env).auth) return null;
  instance ??= createNeonAuth({
    baseUrl: neonAuthUrl(env),
    cookies: { secret: env.NEON_AUTH_COOKIE_SECRET },
    // Neon's logs carry hosts and paths, never an address; errors only.
    logLevel: "error",
  });
  return instance;
}

/** The session's JWT for the account API: { token } or { error: "missing" | "unavailable" }. */
export async function sessionToken(auth = neonAuth()) {
  if (!auth) return { error: "missing" };
  const { data, error } = await auth.token();
  if (typeof data?.token === "string" && data.token) return { token: data.token };
  if (error && (error.status === 401 || error.status === 403 || error.status === 404)) return { error: "missing" };
  if (!error) return { error: "missing" };
  return { error: "unavailable" };
}
