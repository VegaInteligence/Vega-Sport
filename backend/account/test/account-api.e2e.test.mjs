// End to end: the account API as the site will drive it. Function URL events go through the
// real front (src/front.mjs), the real seam (src/store-client.mjs, in-process transport), the
// real store (src/store.mjs) as the group role vega_account, on a local PostgreSQL rebuilt from
// sql/. Tokens are signed by an Ed25519 key made here, its key set served by an injected
// fetcher; Neon's deletion is a recorder. Failure modes: FAILURE_MODES.md, section 9 (X1 to X10).
//
//   VEGA_V2_ACCOUNT_TEST_DSN=postgresql://<owner>@127.0.0.1:5432/vega_v2_account_test \
//     node --test test/account-api.e2e.test.mjs
//
// Evidence: evidence.json in VEGA_ACCOUNT_E2E_EVIDENCE, or <tmp>/vega-account-e2e/<run>/ by
// default (setup, inputs, rerun command, expected and actual results, front log, row counts).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFront } from "../src/front.mjs";
import { createSessionVerifier } from "../src/session.mjs";
import { createKeyring, verifyPass } from "../src/pass.mjs";
import { createStore, createPool } from "../src/store.mjs";
import { createStoreClient, localInvoker } from "../src/store-client.mjs";
import { AUTH_URL, SITE, NOW, DSN, skipDb as skip, makeKey, token, jwksServer, event, freshBase, rowsOf, contract, migrations } from "./support.mjs";

const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = process.env.VEGA_ACCOUNT_E2E_EVIDENCE || path.join(os.tmpdir(), "vega-account-e2e", RUN);
const ACCOUNT = "0b9e7a52-5c1e-4c8e-9a52-2f7f0c8f5d11";
const PASS_KEY = Buffer.alloc(32, 9);
const steps = [],
  logs = [],
  neonCalls = [];
let db, pool, front, frontWithoutNeon, key, keyring, failure;

before(async () => {
  if (skip) return;
  db = await freshBase();
  pool = createPool(DSN, { role: "vega_account" });
  const store = createStore({ pool });
  key = makeKey("neon-key-1");
  const jwks = jwksServer(() => [key]);
  keyring = createKeyring({ current: "p1", keys: { p1: PASS_KEY } });
  const common = {
    verifier: createSessionVerifier({ authUrl: AUTH_URL, fetchJwks: jwks.fetch, clock: () => NOW }),
    origins: [SITE],
    keyring,
    store: createStoreClient(localInvoker(store.handle)),
    clock: () => NOW,
    log: (line) => logs.push(line),
  };
  front = createFront({ ...common, neon: { deleteUser: async (id) => (neonCalls.push(id), { ok: true, status: 200 }) } });
  frontWithoutNeon = createFront({ ...common, neon: null });
});

after(async () => {
  if (!skip) {
    mkdirSync(OUT, { recursive: true });
    const failed = steps.filter((s) => !s.ok);
    writeFileSync(
      path.join(OUT, "evidence.json"),
      JSON.stringify(
        {
          subject: "Account API (VI-38, stage 2a): sign in, read null, write the site's complete contract, read it back deep-equal, a second device's stale write refused then accepted, export, delete, everything gone",
          observed: new Date().toISOString(),
          rerun: "VEGA_V2_ACCOUNT_TEST_DSN=postgresql://vega_test:local-only@127.0.0.1:5432/vega_v2_account_test VEGA_ACCOUNT_E2E_EVIDENCE=<dir> node --test backend/account/test/account-api.e2e.test.mjs",
          setup: {
            database: `${(await db.query("SELECT version()")).rows[0].version} (production runs 18)`,
            schema: migrations().map((m) => m.name),
            storeRole: "vega_account (SET ROLE through the pool's options, as the login vega_v2_account would hold it)",
            transport: "in-process localInvoker: the command and the answer cross the seam as JSON text, like a Lambda Invoke payload",
            session: "EdDSA token signed by a key generated in the test; key set served by an injected fetcher; clock pinned",
            neon: "deletion recorded, not called",
            origins: [SITE],
          },
          inputs: { accountId: ACCOUNT, now: NOW, deviceA: contract(), deviceB: DEVICE_B, contractSource: "header of dashboard/frontend/src/services/user-preferences.js, claude/accueil-importance-pays ac08d79, elisions filled" },
          steps,
          neonCalls,
          frontLog: logs,
          result: failure ? `failed: ${failure}` : failed.length ? `${failed.length} step(s) failed` : `${steps.length}/${steps.length} steps as expected`,
        },
        null,
        2,
      ),
    );
    console.log(`# evidence: ${path.join(OUT, "evidence.json")}`);
  }
  await pool?.end();
  await db?.end();
});

/** One request through the front, recorded with its expectation; tokens are not written out. */
async function step(name, expected, method, route, { body, origin = SITE, sub = ACCOUNT, handler = front, ifMatch } = {}) {
  const headers = { Origin: origin, "X-Vega-Session": token(key, { sub }), ...(ifMatch !== undefined && { "If-Match": ifMatch }) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const out = await handler(event(method, route, { headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const parsed = out.body ? JSON.parse(out.body) : null;
  // A pass is written out as its claims only (signed with the test's key, but a pass all the same).
  const answer = parsed?.pass ? { ...parsed, pass: `<pass: ${JSON.stringify(verifyPass(parsed.pass, keyring, NOW))}>` } : parsed;
  const record = { name, request: { method, route, origin, ...(ifMatch !== undefined && { ifMatch }), body: body ?? null, session: `<EdDSA token, sub ${sub}>` }, expected, status: out.statusCode, headers: out.headers, answer, rows: await rowsOf(db, sub) };
  steps.push(record);
  record.ok = out.statusCode === expected.status;
  assert.equal(out.statusCode, expected.status, `${name}: ${out.body}`);
  assert.equal(out.headers["cache-control"], "no-store", name);
  assert.equal(out.headers["access-control-allow-origin"], SITE, name);
  return { out, body: parsed, record };
}

// What a second device holds: the same site, other choices (a null theme, no country, no list entry).
const DEVICE_B = { ...contract(), theme: null, country: null, homePriority: "location", lists: [{ id: "main", name: "Sélection du téléphone", entries: [] }], activeList: "main", views: [], comparison: [] };
const GONE = { accounts: 0, preferences: 0, stripe_customers: 0, subscriptions: 0, grants: 0, erasures: 1 };

test("X10: the whole path, from the first sign-in to nothing left", { skip }, async () => {
  try {
    // 1. First sign-in: the account is created at level 1 and gets a pass.
    const signIn = await step("sign in", { status: 200, created: true, level: 1 }, "POST", "/account/session");
    assert.equal(signIn.body.created, true);
    assert.equal(signIn.body.level, 1);
    assert.deepEqual(verifyPass(signIn.body.pass, keyring, NOW), { ok: true, accountId: ACCOUNT, level: 1, expiresAt: NOW + 600 });

    // 2. Never saved: null, without revision.
    const empty = await step("read before any save", { status: 200, answer: { contract: null, revision: null } }, "GET", "/account/preferences");
    assert.deepEqual(empty.body, { contract: null, revision: null });

    // 3. Device A writes the site's complete contract.
    const written = await step("device A writes the complete contract", { status: 200, answer: { revision: 1 } }, "PUT", "/account/preferences", { body: contract() });
    assert.deepEqual(written.body, { revision: 1 });

    // 4. Read back: deep-equal (C6); the keys come back in jsonb's order, which does not matter.
    const back = await step("read back", { status: 200, answer: "deep-equal to what was written, revision 1" }, "GET", "/account/preferences");
    assert.deepEqual(back.body, { contract: contract(), revision: 1 });
    back.record.keyOrderKept = JSON.stringify(back.body.contract) === JSON.stringify(contract());

    // 5. Device A saves again; device B, which read revision 1, is refused, then reads and writes.
    await step("device A saves again", { status: 200, answer: { revision: 2 } }, "PUT", "/account/preferences", { body: contract({ focus: "europe" }) });
    await step("device B signs in", { status: 200, created: false }, "POST", "/account/session");
    const stale = await step("device B writes over revision 1", { status: 409, code: "STALE", revision: 2 }, "PUT", "/account/preferences", { body: DEVICE_B, ifMatch: "1" });
    assert.equal(stale.body.error.code, "STALE");
    assert.equal(stale.body.revision, 2);
    const current = await step("device B reads", { status: 200, answer: "revision 2" }, "GET", "/account/preferences");
    assert.deepEqual(current.body, { contract: contract({ focus: "europe" }), revision: 2 });
    const accepted = await step("device B writes over revision 2", { status: 200, answer: { revision: 3 } }, "PUT", "/account/preferences", { body: DEVICE_B, ifMatch: '"2"' });
    assert.deepEqual(accepted.body, { revision: 3 });
    const third = await step("device A reads device B's document", { status: 200, answer: "device B's document, revision 3" }, "GET", "/account/preferences");
    assert.deepEqual(third.body, { contract: DEVICE_B, revision: 3 });

    // 6. Export: everything the base holds for this id, compared with the rows themselves.
    const exported = await step("export", { status: 200, answer: "every row of the account" }, "GET", "/account/export");
    assert.match(exported.out.headers["content-disposition"], /^attachment; filename="vega-account-export\.json"$/);
    const x = exported.body;
    assert.equal(x.format, "vega-account-export");
    assert.equal(x.v, 1);
    assert.equal(x.account.accountId, ACCOUNT);
    assert.equal(x.account.level, 1);
    assert.equal(x.account.grant, null);
    assert.match(x.identity, /Neon/);
    assert.deepEqual(x.preferences.contract, DEVICE_B);
    assert.equal(x.preferences.revision, 3);
    const row = (await db.query("SELECT document, revision, updated_at FROM account.preferences WHERE account_id = $1", [ACCOUNT])).rows[0];
    assert.deepEqual(x.preferences.contract, row.document);
    assert.equal(x.preferences.revision, Number(row.revision));
    assert.equal(x.preferences.updatedAt, row.updated_at.toISOString());
    assert.deepEqual(x.stripe, { customer: null, subscriptions: [] });

    // 7. Deletion without a Neon key: refused, nothing erased (X3).
    const before = await rowsOf(db, ACCOUNT);
    const closed = await step("delete without a Neon key", { status: 503, code: "DELETION_UNAVAILABLE", rows: "unchanged" }, "DELETE", "/account", { handler: frontWithoutNeon });
    assert.equal(closed.body.error.code, "DELETION_UNAVAILABLE");
    assert.deepEqual(await rowsOf(db, ACCOUNT), before);
    assert.equal(neonCalls.length, 0);

    // 8. Deletion: AWS rows first, then Neon.
    const gone = await step("delete", { status: 200, answer: { erased: true, identityDeleted: true } }, "DELETE", "/account");
    assert.deepEqual(gone.body, { erased: true, identityDeleted: true });
    assert.deepEqual(neonCalls, [ACCOUNT]);
    assert.deepEqual(await rowsOf(db, ACCOUNT), GONE);

    // 9. Device B still holds a valid token: its next save is refused, nothing comes back (X9).
    const late = await step("device B saves after the deletion", { status: 410, code: "ACCOUNT_ERASED" }, "PUT", "/account/preferences", { body: DEVICE_B });
    assert.equal(late.body.error.code, "ACCOUNT_ERASED");
    await step("device B signs in after the deletion", { status: 410, code: "ACCOUNT_ERASED" }, "POST", "/account/session");
    await step("export after the deletion", { status: 410, code: "ACCOUNT_ERASED" }, "GET", "/account/export");
    assert.deepEqual(await rowsOf(db, ACCOUNT), GONE);

    // 10. The deletion repeated (a retry after a lost answer) succeeds.
    await step("delete again", { status: 200 }, "DELETE", "/account");
    assert.deepEqual(await rowsOf(db, ACCOUNT), GONE);
  } catch (error) {
    failure = error.message.split("\n")[0];
    throw error;
  }
});

test("X2: an account the base does not hold exports as empty", { skip }, async () => {
  const out = await step("export of an unknown account", { status: 200, answer: "account null" }, "GET", "/account/export", { sub: "never-signed-in" });
  assert.equal(out.body.account, null);
  assert.equal(out.body.preferences, null);
  assert.deepEqual(out.body.stripe, { customer: null, subscriptions: [] });
  assert.deepEqual(await rowsOf(db, "never-signed-in"), { accounts: 0, preferences: 0, stripe_customers: 0, subscriptions: 0, grants: 0, erasures: 0 });
});
