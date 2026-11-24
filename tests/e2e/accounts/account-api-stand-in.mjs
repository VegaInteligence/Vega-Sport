// The account API on a local port (VI-38 E2E only; never shipped): the real front (backend/account/src/front.mjs)
// and the real store (src/store.mjs, as the group role vega_account) on a local PostgreSQL rebuilt from
// backend/account/sql, as backend/account/test/account-api.e2e.test.mjs builds them. HTTP requests become Function
// URL events (payload 2.0). The session verifier is the real one, its key set fetched from the auth stand-in.
// Neon's deletion is the stand-in's (it deletes the Better Auth user) while `deletion` is on, else absent: the
// front then answers 503 DELETION_UNAVAILABLE, as in production until a Neon API key exists.
//
//   ACCOUNT_DSN=postgresql://vega_test:local-only@127.0.0.1:5432/vega_site_account_e2e
import http from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url);
const account = new URL("../../../backend/account/", here);
const requireAccount = createRequire(new URL("package.json", account));
const { createFront } = await import(new URL("src/front.mjs", account).href);
const { createSessionVerifier } = await import(new URL("src/session.mjs", account).href);
const { createKeyring } = await import(new URL("src/pass.mjs", account).href);
const { createStore, createPool } = await import(new URL("src/store.mjs", account).href);
const { createStoreClient, localInvoker } = await import(new URL("src/store-client.mjs", account).href);
const { default: pg } = await import(pathToFileURL(requireAccount.resolve("pg")).href);

async function freshBase(dsn) {
  const name = new URL(dsn).pathname.slice(1);
  if (name !== "vega_site_account_e2e") throw new Error("dedicated local base vega_site_account_e2e required");
  const admin = new pg.Client({ connectionString: dsn.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  const dir = new URL("sql/", account);
  const files = readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  await db.query("BEGIN");
  for (const file of files) await db.query(readFileSync(new URL(file, dir), "utf8"));
  await db.query("COMMIT");
  return { db, files };
}

export async function startAccountApiStandIn({
  port = Number(process.env.ACCOUNT_PORT || 4200),
  dsn = process.env.ACCOUNT_DSN || "postgresql://vega_test:local-only@127.0.0.1:5432/vega_site_account_e2e",
  authUrl,
  jwksUrl,
  deleteUser,
} = {}) {
  const { db, files } = await freshBase(dsn);
  const pool = createPool(dsn, { role: "vega_account", max: 4 });
  const store = createStore({ pool });
  const log = [];
  // deletion: Neon's deletion configured; down: every route answers 503; delay: ms before each answer.
  const control = { deletion: false, down: false, delay: 0 };
  const make = (neon) =>
    createFront({
      verifier: createSessionVerifier({
        authUrl,
        fetchJwks: async () => {
          const response = await fetch(jwksUrl);
          if (!response.ok) throw new Error(`key set ${response.status}`);
          return response.json();
        },
      }),
      origins: ["http://127.0.0.1:3100"],
      keyring: createKeyring({ current: "p1", keys: { p1: Buffer.alloc(32, 7) } }),
      store: createStoreClient(localInvoker(store.handle)),
      neon,
      log: (line) => log.push(line),
    });
  const withDeletion = make({ deleteUser });
  const without = make(null);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__control") {
      Object.assign(control, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(control));
    }
    if (control.delay) await new Promise((resolve) => setTimeout(resolve, control.delay));
    if (control.down) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: { code: "STORE_UNAVAILABLE", message: "Comptes momentanément indisponibles.", retry: true } }));
    }
    const body = Buffer.concat(chunks);
    const event = {
      version: "2.0",
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])),
      requestContext: { http: { method: req.method, path: url.pathname, sourceIp: "127.0.0.1" } },
      ...(body.length && { body: body.toString("base64"), isBase64Encoded: true }),
    };
    const out = await (control.deletion ? withDeletion : without)(event);
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    files,
    log,
    control,
    db,
    async rows() {
      const out = {};
      for (const table of ["accounts", "preferences", "erasures"]) out[table] = (await db.query(`SELECT count(*)::int AS n FROM account.${table}`)).rows[0].n;
      return out;
    },
    async document(id) {
      const { rows } = await db.query("SELECT document, revision FROM account.preferences WHERE account_id = $1", [id]);
      return rows[0] ?? null;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
      await db.end();
    },
  };
}
