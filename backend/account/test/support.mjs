// Shared by the account suites (not a suite itself: the glob is test/*.test.mjs).
//
// Tokens are signed here with node:crypto, not with the library the code under test uses, so a
// fault of that library's use cannot hide in both sides of a test. No network: the key set is
// served by an injected fetcher.
import { generateKeyPairSync, sign } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

export const AUTH_URL = "https://ep-test-1234.neonauth.us-east-2.aws.neon.tech/neondb/auth";
export const AUTH_ORIGIN = new URL(AUTH_URL).origin;
export const JWKS_URL = `${AUTH_URL}/.well-known/jwks.json`;
export const SITE = "https://vegasport.vercel.app";
export const NOW = 1_795_000_000; // 2026-11-17, whole seconds

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

/** An Ed25519 key as Neon would hold one: its private half signs, its JWK is published. */
export function makeKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "EdDSA", use: "sig" } };
}

/** A compact JWS. `header` and `claims` override the defaults (null removes a field). */
export function token(key, claims = {}, header = {}) {
  const h = clean({ alg: "EdDSA", typ: "JWT", kid: key.kid, ...header });
  const c = clean({ sub: "acc-1", iss: AUTH_ORIGIN, aud: AUTH_ORIGIN, iat: NOW - 10, exp: NOW + 890, email: "person@example.com", name: "A Person", ...claims });
  const body = `${b64(h)}.${b64(c)}`;
  return `${body}.${sign(null, Buffer.from(body), key.privateKey).toString("base64url")}`;
}
function clean(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null));
}

/** A fetcher of the key set that counts its calls; `keys()` gives the set served now. */
export function jwksServer(keys) {
  const server = {
    calls: 0,
    fail: false,
    keys,
    async fetch(url) {
      server.calls += 1;
      if (url !== JWKS_URL) throw new Error(`unexpected key set url ${url}`);
      if (server.fail) throw new Error("network down");
      return { keys: server.keys().map((k) => k.jwk ?? k) };
    },
  };
  return server;
}

/** A Function URL event (payload 2.0), as Lambda gives it to the front. */
export function event(method, path, { headers = {}, body, base64 = false, query = "" } = {}) {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: query,
    headers: Object.fromEntries(Object.entries({ host: "abc.lambda-url.us-east-2.on.aws", ...headers }).map(([k, v]) => [k.toLowerCase(), v])),
    requestContext: { http: { method, path, protocol: "HTTP/1.1", sourceIp: "203.0.113.9", userAgent: "test" }, timeEpoch: NOW * 1000 },
    ...(body !== undefined && { body: base64 ? Buffer.from(body).toString("base64") : body, isBase64Encoded: base64 }),
  };
}

export const DSN = process.env.VEGA_V2_ACCOUNT_TEST_DSN;
export const skipDb = !DSN && "requires VEGA_V2_ACCOUNT_TEST_DSN (local vega_v2_account_test)";

/** Every file of sql/, in the order of their names: what a deployment applies. */
export function migrations() {
  const dir = new URL("../sql/", import.meta.url);
  return readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort().map((f) => ({ name: f, sql: readFileSync(new URL(f, dir), "utf8") }));
}

/** A connection as the owner, on the dedicated local base only, with the schema rebuilt. */
export async function freshBase() {
  const target = new URL(DSN);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/vega_v2_account_test")
    throw new Error("dedicated local account test DB required");
  const db = new pg.Client({ connectionString: DSN });
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS account CASCADE");
  await db.query("BEGIN");
  for (const file of migrations()) await db.query(file.sql);
  await db.query("COMMIT");
  return db;
}

/** Rows held for an account id in every account table (the erasure check). */
export async function rowsOf(db, id) {
  const out = {};
  for (const table of ["accounts", "preferences", "stripe_customers", "subscriptions", "erasures"])
    out[table] = (await db.query(`SELECT count(*)::int AS n FROM account.${table} WHERE account_id = $1`, [id])).rows[0].n;
  return out;
}

/**
 * The site's contract: the complete example of the header of user-preferences.js (branch
 * claude/accueil-importance-pays, ac08d79), its elisions filled with values of the same shape:
 * nested settings and index, a nations entry, unicode names, empty strings, nulls, decimals.
 */
export function contract(overrides = {}) {
  const scope = { league: "all", focus: "all", role: "all", venue: "all", result: "all", from: "", to: "" };
  return {
    v: 1,
    focus: "all",
    theme: "light",
    leagues: ["l_3FJFUl"],
    country: "FRA",
    homePriority: "importance",
    defaultSeason: "2026/2027",
    onboarded: true,
    competition: "l_3FJFUl",
    lists: [
      {
        id: "main",
        name: "Ma sélection",
        entries: [
          { id: "t_aaaaa1", kind: "clubs", name: "Club", season: "", imageUrl: "" },
          { id: "p_aaaab1", kind: "players", name: "Joueur", season: "2026/2027", imageUrl: "https://dngp6kh9jx2bl.cloudfront.net/data/p.webp", scope, replaces: true },
          { id: "t_FRA", kind: "nations", name: "France 🇫🇷", season: "", imageUrl: "" },
          { id: "m_x1", kind: "matches", name: "Argentine – France « finale »", season: "2022", imageUrl: "" },
        ],
      },
      { id: "list-1700000000000", name: "日本の選手 — à suivre", entries: [] },
    ],
    activeList: "main",
    views: [{ id: "v1", name: "Ailiers", query: "pos=F&minutes=900", settings: { columns: ["matches", "xg"], filters: { league: "all", leagues: ["l_A", "l_B"], minutes: 900, from: "" }, sort: { key: "xg", direction: "desc" }, basis: null } }],
    templates: [{ id: "t1", name: "Mon indice", groups: ["F"], minMinutes: 600, weights: [{ key: "xg", direction: "max", weight: 2 }, { key: "fouls", direction: "min", weight: 0.5 }] }],
    comparison: [{ id: "p_aaaab1", kind: "players", name: "Joueur", season: "2026/2027", imageUrl: "", scope: { ...scope, leagues: ["l_3FJFUl"] } }],
    researchSettings: {
      columns: ["matches", "minutes", "grade", "goals", "assists", "xg", "xa", "chancesCreated"],
      scatter: { x: "xg", y: "xa" },
      comparisonMetrics: ["xg", "xa", "chancesCreated"],
      index: { name: "Mon indice", minMinutes: 450, weights: [{ key: "passesAccurate", weight: 1, direction: "max" }, { key: "chancesCreated", weight: 1.25, direction: "max" }, { key: "recoveries", weight: -0.75, direction: "min" }] },
    },
    ...overrides,
  };
}
