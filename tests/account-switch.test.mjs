// The accounts' feature switch and the safe ?next= of /connexion (VI-38, site side). Written before
// dashboard/frontend/src/services/account-switch.js and account-links.js, from docs/COMPTES_SITE.md sections 1 and 6:
//  W1 no (or an invalid) Neon setting: auth off; the pages are not routes; the bundle's flags are off.
//  W2 Neon set, no account API: auth on, sync off.
//  W3 ACCOUNT_API_ORIGIN with a path, query, credentials, http on a public host, garbage: sync off; a trailing slash
//     is fine.
//  W5 the home page and the layout read no session (no import of the Neon server, no cookie read added).
//  O4 ?next= keeps a same-origin path only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountFeatures,
  accountsOn,
  accountSyncOn,
  buildFlags,
} from "../dashboard/frontend/src/services/account-switch.js";
import { safeNext, signInHref } from "../dashboard/frontend/src/services/account-links.js";
import { routeExists, routeNeedsSeason } from "../dashboard/frontend/src/services/route-data.js";

const NEON = "https://ep-steep-boat-bekuqo4w.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth";
const SECRET = "s".repeat(32);
const FRONT = "https://abcdefgh.lambda-url.us-east-2.on.aws";
const env = (values) => ({ NODE_ENV: "production", ...values });

test("W1 without valid Neon settings, accounts are off", () => {
  const off = { auth: false, sync: false };
  assert.deepEqual(accountFeatures(env({})), off);
  assert.deepEqual(accountFeatures(env({ NEON_AUTH_BASE_URL: NEON })), off);
  assert.deepEqual(accountFeatures(env({ NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: FRONT })), off);
  for (const bad of ["", "  ", "not a url", "http://ep.neon.tech/neondb/auth", `${NEON}?x=1`, `${NEON}#a`, "https://user:pw@ep.neon.tech/auth", "ftp://ep.neon.tech"])
    assert.deepEqual(accountFeatures(env({ NEON_AUTH_BASE_URL: bad, NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: FRONT })), off, bad);
  assert.deepEqual(accountFeatures(env({ NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: "s".repeat(31), ACCOUNT_API_ORIGIN: FRONT })), off);
  // A local stand-in on http is accepted on localhost only.
  assert.equal(accountFeatures(env({ NEON_AUTH_BASE_URL: "http://127.0.0.1:4100/neondb/auth", NEON_AUTH_COOKIE_SECRET: SECRET })).auth, true);
  assert.equal(accountFeatures(env({ NEON_AUTH_BASE_URL: "http://localhost:4100/neondb/auth", NEON_AUTH_COOKIE_SECRET: SECRET })).auth, true);
});

test("W2 Neon set, no account API: sign-in on, sync off", () => {
  assert.deepEqual(accountFeatures(env({ NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: SECRET })), { auth: true, sync: false });
  assert.deepEqual(accountFeatures(env({ NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: FRONT })), { auth: true, sync: true });
  assert.deepEqual(accountFeatures(env({ NEON_AUTH_BASE_URL: ` ${NEON} `, NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: `${FRONT}/` })), { auth: true, sync: true });
});

test("W3 an account origin that is not an origin turns sync off", () => {
  for (const bad of [`${FRONT}/account`, `${FRONT}?a=1`, "https://u:p@abc.lambda-url.us-east-2.on.aws", "http://abc.lambda-url.us-east-2.on.aws", "garbage", "", `${FRONT}#x`])
    assert.equal(accountFeatures(env({ NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: bad })).sync, false, bad);
  assert.equal(accountFeatures(env({ NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: "http://127.0.0.1:4200" })).sync, true);
});

test("W1 W2 the build flags and the routes follow the switch", () => {
  const saved = { a: process.env.NEXT_PUBLIC_VEGA_ACCOUNTS, s: process.env.NEXT_PUBLIC_VEGA_ACCOUNT_SYNC };
  try {
    assert.deepEqual(buildFlags(env({})), { NEXT_PUBLIC_VEGA_ACCOUNTS: "", NEXT_PUBLIC_VEGA_ACCOUNT_SYNC: "" });
    assert.deepEqual(buildFlags(env({ NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: SECRET })), { NEXT_PUBLIC_VEGA_ACCOUNTS: "1", NEXT_PUBLIC_VEGA_ACCOUNT_SYNC: "" });
    delete process.env.NEXT_PUBLIC_VEGA_ACCOUNTS;
    delete process.env.NEXT_PUBLIC_VEGA_ACCOUNT_SYNC;
    assert.equal(accountsOn(), false);
    assert.equal(accountSyncOn(), false);
    for (const path of ["/connexion", "/connexion/", "/compte", "/compte/"]) assert.equal(routeExists(path), false, path);
    process.env.NEXT_PUBLIC_VEGA_ACCOUNTS = "1";
    assert.equal(accountsOn(), true);
    assert.equal(accountSyncOn(), false);
    for (const path of ["/connexion", "/connexion/", "/compte", "/compte/"]) assert.equal(routeExists(path), true, path);
    process.env.NEXT_PUBLIC_VEGA_ACCOUNT_SYNC = "1";
    assert.equal(accountSyncOn(), true);
    // The account pages read no season.
    assert.equal(routeNeedsSeason("/connexion", new URLSearchParams()), false);
    assert.equal(routeNeedsSeason("/compte/", new URLSearchParams()), false);
  } finally {
    for (const [key, value] of [["NEXT_PUBLIC_VEGA_ACCOUNTS", saved.a], ["NEXT_PUBLIC_VEGA_ACCOUNT_SYNC", saved.s]])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("W1 next.config freezes the flags, never a secret", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { NEON_AUTH_BASE_URL: NEON, NEON_AUTH_COOKIE_SECRET: SECRET, ACCOUNT_API_ORIGIN: FRONT });
    const config = (await import(`../dashboard/frontend/next.config.mjs?flags=${Date.now()}`)).default;
    assert.deepEqual(config.env, { NEXT_PUBLIC_VEGA_ACCOUNTS: "1", NEXT_PUBLIC_VEGA_ACCOUNT_SYNC: "1" });
    assert.ok(!JSON.stringify(config.env).includes(SECRET));
    assert.ok(!JSON.stringify(config.env).includes("neonauth"));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("W5 the home page, the layout and the providers read no session", () => {
  const read = (file) => readFileSync(new URL(`../dashboard/frontend/${file}`, import.meta.url), "utf8");
  for (const file of ["app/page.jsx", "app/layout.jsx", "app/providers.jsx", "src/components/Layout.jsx", "src/components/SiteHeader.jsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /neon-auth|@neon\/auth|getSession/, file);
  }
  // The Neon client is imported lazily, behind the build-time flag, so a site without accounts never loads it.
  const client = read("src/services/auth-client.js");
  assert.match(client, /import\(\s*["']@neon\/auth\/next["']\s*\)/);
  assert.doesNotMatch(client, /^import .*@neon\/auth/m);
  // The pages behind the switch are static: they call notFound() when it is off and read no cookie.
  for (const file of ["app/connexion/page.jsx", "app/compte/page.jsx"]) {
    const source = read(file);
    assert.match(source, /notFound\(\)/, file);
    assert.doesNotMatch(source, /cookies\(|headers\(|getSession/, file);
  }
});

test("O4 ?next= keeps a same-origin path only", () => {
  assert.equal(safeNext("/clubs/?id=t_1"), "/clubs/?id=t_1");
  assert.equal(safeNext("/compte"), "/compte");
  assert.equal(safeNext("/joueurs/#x"), "/joueurs/#x");
  for (const bad of [
    null,
    undefined,
    "",
    "clubs",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/%2F%2Fevil.example",
    "/\nx",
    "/\tx",
    " /clubs",
    "/connexion",
    "/connexion/?next=/x",
    "/" + "a".repeat(600),
    ["/clubs"],
    42,
  ])
    assert.equal(safeNext(bad), "/", JSON.stringify(bad));
  assert.equal(signInHref("/clubs/?id=t_1"), "/connexion?next=%2Fclubs%2F%3Fid%3Dt_1");
  assert.equal(signInHref("/"), "/connexion");
  assert.equal(signInHref("/connexion"), "/connexion");
  assert.equal(signInHref("//evil.example"), "/connexion");
});
