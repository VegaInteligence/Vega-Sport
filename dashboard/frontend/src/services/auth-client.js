// Neon Auth in the browser (VI-38), through the site's own /api/auth (app/api/auth/[...path]/route.js).
// Imported lazily and only with accounts on: a site without accounts never loads it nor calls /api/auth.
import { accountsOn } from "./account-switch.js";

let client = null;

/** The Better Auth client of @neon/auth, or null with accounts off. */
export function authClient() {
  if (!accountsOn()) return Promise.resolve(null);
  client ??= import("@neon/auth/next").then(({ createAuthClient }) => createAuthClient());
  return client;
}
