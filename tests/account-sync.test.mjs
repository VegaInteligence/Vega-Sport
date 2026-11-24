// The account adapter of the preferences sync (VI-38, site side) and its client of /api/account. Written before
// dashboard/frontend/src/services/account-sync.js, from docs/COMPTES_SITE.md section 5:
//  A1 first sign-in, the account empty: the browser's contract is PUT (no If-Match), returned, the marker recorded.
//  A2 first sign-in on this browser, the account holding data: merged, PUT with If-Match only when it differs,
//     returned; the marker recorded only once the account holds it.
//  A3 marker present: the account's contract as it is, nothing written; the marker is per account id.
//  A4 the stores not loaded (readLocal gives null): load rejects, nothing written.
//  A5 an other-version contract: returned unmerged and unwritten (the seam stops and reports).
//  A6 409 on save: reload, three-way merge against the base, PUT with the new revision, 3 rounds at most; the merged
//     contract returned.
//  A7 one request at a time: two saves never overlap, each uses the revision the previous one left.
//  A8 401 is a failed save; 410 is reported (sync stopped).
//  A9 5xx / network: a failed load or save, status « failed », nothing thrown into the UI.
//  A10 onStatus: syncing, synced, failed, stopped.
//  A11 a body the server refuses (413, 400, 422 CONTRACT_*): reported.
// And through the real seam (setPreferencesSync): a 409 merge re-applied to the stores.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountApiError,
  MERGED_KEY,
  createAccountAdapter,
  createAccountApi,
  forgetMerged,
  hasMerged,
} from "../dashboard/frontend/src/services/account-sync.js";
import { NOT_CHOSEN } from "../dashboard/frontend/src/services/account-merge.js";
import {
  connectPreferences,
  setPreferencesSync,
  validateContract,
} from "../dashboard/frontend/src/services/user-preferences.js";

const contract = (values = {}) => validateContract({ v: 1, ...values });
const club = (id) => ({ id, kind: "clubs", name: id, season: "", imageUrl: "" });
const withClubs = (...clubs) => contract({ lists: [{ id: "main", name: "Ma sélection", entries: clubs.map(club) }] });
const clubsOf = (c) => c.lists.flatMap((l) => l.entries.map((e) => e.id));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

/** The account API as the store answers it: one document, revisions, If-Match → 409 STALE with the current one. */
function fakeServer(initial = null) {
  const server = {
    document: initial,
    revision: initial ? 1 : null,
    calls: [],
    fail: null, // (call) => AccountApiError | null
    gate: null, // a promise every call waits for
    active: 0,
    maxActive: 0,
  };
  const run = async (call, work) => {
    server.calls.push(call);
    server.active++;
    server.maxActive = Math.max(server.maxActive, server.active);
    try {
      if (server.gate) await server.gate;
      await tick();
      const error = server.fail?.(call);
      if (error) throw error;
      return work();
    } finally {
      server.active--;
    }
  };
  server.api = {
    getPreferences: () => run({ method: "GET" }, () => ({ contract: server.document, revision: server.revision })),
    putPreferences: (body, ifMatch) =>
      run({ method: "PUT", ifMatch, body }, () => {
        if (ifMatch !== undefined && ifMatch !== null && ifMatch !== server.revision)
          throw new AccountApiError(409, { ok: false, revision: server.revision, error: { code: "STALE", message: "Les préférences ont changé depuis cette version.", retry: false } });
        server.document = JSON.parse(JSON.stringify(body));
        server.revision = (server.revision ?? 0) + 1;
        return { revision: server.revision };
      }),
  };
  return server;
}

function adapterFor(server, { local = contract(), accountId = "acc-1", storage = memoryStorage(), ...rest } = {}) {
  const statuses = [];
  const reports = [];
  let current = local;
  const adapter = createAccountAdapter({
    api: server.api,
    accountId,
    readLocal: () => current,
    storage,
    onStatus: (s) => statuses.push(s),
    ...rest,
  });
  const report = adapter.report;
  adapter.report = (error) => (reports.push(error), report(error));
  return { adapter, statuses, reports, storage, setLocal: (c) => (current = c) };
}

test("A1 first sign-in on an empty account: the browser's contract is written and returned", async () => {
  const server = fakeServer();
  const local = withClubs("t_b1");
  const { adapter, storage } = adapterFor(server, { local });
  const loaded = await adapter.load();
  assert.deepEqual(loaded, local);
  const puts = server.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].ifMatch, undefined);
  assert.deepEqual(server.document, local);
  assert.equal(hasMerged(storage, "acc-1"), true);
});

test("A2 first sign-in on an account with data: merged, written with If-Match, returned, marked", async () => {
  const server = fakeServer(withClubs("t_a1"));
  const { adapter, storage } = adapterFor(server, { local: withClubs("t_b1") });
  const loaded = await adapter.load();
  assert.deepEqual(clubsOf(loaded), ["t_a1", "t_b1"]);
  const put = server.calls.find((c) => c.method === "PUT");
  assert.equal(put.ifMatch, 1);
  assert.deepEqual(server.document, loaded);
  assert.equal(hasMerged(storage, "acc-1"), true);
});

test("A2 nothing to add: no write, still marked", async () => {
  const server = fakeServer(withClubs("t_a1"));
  const { adapter, storage } = adapterFor(server, { local: contract() });
  assert.deepEqual(await adapter.load(), withClubs("t_a1"));
  assert.equal(server.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(hasMerged(storage, "acc-1"), true);
});

test("A2 the merge's write fails: load rejects, no marker", async () => {
  const server = fakeServer(withClubs("t_a1"));
  server.fail = (call) => (call.method === "PUT" ? new AccountApiError(503, { ok: false, error: { code: "STORE_UNAVAILABLE", message: "x", retry: true } }) : null);
  const { adapter, storage } = adapterFor(server, { local: withClubs("t_b1") });
  await assert.rejects(adapter.load());
  assert.equal(hasMerged(storage, "acc-1"), false);
});

test("A2 the merge's write meets a 409: merged again on the new document", async () => {
  const server = fakeServer(withClubs("t_a1"));
  let once = true;
  const original = server.api.putPreferences;
  server.api.putPreferences = async (body, ifMatch) => {
    if (once) {
      once = false;
      server.document = withClubs("t_a1", "t_a2");
      server.revision = 2;
    }
    return original(body, ifMatch);
  };
  const { adapter } = adapterFor(server, { local: withClubs("t_b1") });
  const loaded = await adapter.load();
  assert.deepEqual(clubsOf(loaded), ["t_a1", "t_a2", "t_b1"]);
  assert.deepEqual(server.document, loaded);
});

test("A3 marker present: the account's contract as it is, nothing written; per account id", async () => {
  const storage = memoryStorage();
  const server = fakeServer(withClubs("t_a1"));
  await adapterFor(server, { local: withClubs("t_b1"), storage }).adapter.load();
  // The browser still holds t_b1 and a deleted t_x; another device removed t_b1 from the account.
  server.document = withClubs("t_a1");
  server.revision = 7;
  const before = server.calls.length;
  const again = adapterFor(server, { local: withClubs("t_b1", "t_x"), storage });
  assert.deepEqual(await again.adapter.load(), withClubs("t_a1"));
  assert.equal(server.calls.slice(before).filter((c) => c.method === "PUT").length, 0);
  // Another account on this browser merges.
  assert.equal(hasMerged(storage, "acc-2"), false);
  const other = adapterFor(fakeServer(withClubs("t_o1")), { local: withClubs("t_b1"), storage, accountId: "acc-2" });
  assert.deepEqual(clubsOf(await other.adapter.load()), ["t_o1", "t_b1"]);
  // forgetMerged removes one account's marker only.
  forgetMerged(storage, "acc-1");
  assert.equal(hasMerged(storage, "acc-1"), false);
  assert.equal(hasMerged(storage, "acc-2"), true);
  assert.ok(storage.getItem(MERGED_KEY));
});

test("A3 a damaged or missing storage never throws", async () => {
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  assert.equal(hasMerged(broken, "acc-1"), false);
  forgetMerged(broken, "acc-1");
  const garbage = memoryStorage();
  garbage.setItem(MERGED_KEY, "{not json");
  assert.equal(hasMerged(garbage, "acc-1"), false);
  const { adapter } = adapterFor(fakeServer(), { storage: broken, local: withClubs("t_1") });
  assert.deepEqual(await adapter.load(), withClubs("t_1"));
});

test("A4 the stores not loaded: load rejects and writes nothing", async () => {
  const server = fakeServer(withClubs("t_a1"));
  const { adapter, storage } = adapterFor(server, { local: null });
  await assert.rejects(adapter.load());
  assert.equal(server.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(hasMerged(storage, "acc-1"), false);
});

test("A5 an other-version contract is returned unmerged and never written", async () => {
  const future = { v: 2, lists: "whatever" };
  const server = fakeServer(future);
  const { adapter, storage } = adapterFor(server, { local: withClubs("t_b1") });
  assert.deepEqual(await adapter.load(), future);
  assert.equal(server.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(hasMerged(storage, "acc-1"), false);
});

test("A6 409 on save: three-way merge against the base, written with the new revision, returned", async () => {
  const server = fakeServer(withClubs("t_a1"));
  const { adapter } = adapterFor(server, { local: withClubs("t_a1") });
  const base = await adapter.load(); // marker recorded, base = t_a1, revision 1
  assert.deepEqual(clubsOf(base), ["t_a1"]);
  // Device B removes t_a1 and adds t_b2 (revision 2); this device adds t_l1 on top of the base.
  server.document = withClubs("t_b2");
  server.revision = 2;
  const answer = await adapter.save(withClubs("t_a1", "t_l1"));
  assert.deepEqual(clubsOf(answer), ["t_b2", "t_l1"]);
  assert.deepEqual(server.document, answer);
  assert.equal(server.revision, 3);
  const puts = server.calls.filter((c) => c.method === "PUT");
  assert.deepEqual(puts.map((c) => c.ifMatch), [1, 2]);
  // The next save starts from that base and revision: no conflict.
  assert.equal(await adapter.save(withClubs("t_b2", "t_l1", "t_l2")), undefined);
  assert.equal(server.calls.at(-1).ifMatch, 3);
});

test("A6 an ordinary save answers nothing to re-apply", async () => {
  const server = fakeServer();
  const { adapter } = adapterFor(server, { local: contract() });
  await adapter.load();
  assert.equal(await adapter.save(withClubs("t_1")), undefined);
  assert.deepEqual(server.document, withClubs("t_1"));
});

test("A6 the conflicts go on: at most 3 rounds, then a failed save", async () => {
  const server = fakeServer(withClubs("t_a1"));
  const { adapter, statuses } = adapterFor(server, { local: withClubs("t_a1") });
  await adapter.load();
  const put = server.api.putPreferences;
  server.api.putPreferences = (body, ifMatch) => {
    server.revision += 1; // another device writes every time
    return put(body, ifMatch);
  };
  await assert.rejects(adapter.save(withClubs("t_a1", "t_x")));
  assert.equal(server.calls.filter((c) => c.method === "PUT").length, 4); // the first try and 3 merges
  assert.equal(statuses.at(-1).state, "failed");
});

test("A7 one request at a time, each with the revision the previous one left", async () => {
  const server = fakeServer();
  const { adapter } = adapterFor(server, { local: contract() });
  await adapter.load(); // revision 1 (the browser's contract, written without If-Match)
  const before = server.calls.length;
  let open;
  server.gate = new Promise((resolve) => (open = resolve));
  const first = adapter.save(withClubs("t_1"));
  const second = adapter.flush(withClubs("t_1", "t_2"));
  await tick();
  open();
  await first;
  const out = await second;
  assert.equal(out.ok, true);
  assert.equal(server.maxActive, 1);
  assert.deepEqual(server.calls.slice(before).filter((c) => c.method === "PUT").map((c) => c.ifMatch), [1, 2]);
  assert.deepEqual(server.document, withClubs("t_1", "t_2"));
});

test("A8 401 is a failed save, 410 stops the sync through report", async () => {
  const server = fakeServer();
  const onExpired = [];
  const { adapter, statuses, reports } = adapterFor(server, { local: contract(), onSessionLost: () => onExpired.push(1) });
  await adapter.load();
  server.fail = () => new AccountApiError(401, { ok: false, error: { code: "SESSION_EXPIRED", message: "Session expirée.", retry: true } });
  await assert.rejects(adapter.save(withClubs("t_1")));
  assert.equal(statuses.at(-1).state, "failed");
  assert.equal(onExpired.length, 1);
  assert.equal(reports.length, 0);
  server.fail = () => new AccountApiError(410, { ok: false, error: { code: "ACCOUNT_ERASED", message: "Ce compte a été supprimé.", retry: false } });
  await assert.rejects(adapter.save(withClubs("t_1")));
  assert.equal(statuses.at(-1).state, "stopped");
  assert.match(statuses.at(-1).reason, /supprimé/);
});

test("A9 A10 a failing API: failed, then synced again; statuses in order", async () => {
  const server = fakeServer();
  const { adapter, statuses } = adapterFor(server, { local: contract() });
  server.fail = () => new TypeError("fetch failed");
  await assert.rejects(adapter.load());
  assert.deepEqual(statuses.map((s) => s.state), ["syncing", "failed"]);
  assert.ok(statuses[1].reason);
  server.fail = null;
  await adapter.load();
  assert.deepEqual(statuses.map((s) => s.state), ["syncing", "failed", "syncing", "synced"]);
  await adapter.save(withClubs("t_1"));
  assert.deepEqual(statuses.slice(-2).map((s) => s.state), ["syncing", "synced"]);
  adapter.report(new Error("Version de préférences non reconnue : 2."));
  assert.deepEqual(statuses.at(-1), { state: "stopped", reason: "Version de préférences non reconnue : 2." });
});

test("A11 a document the server refuses is reported", async () => {
  const server = fakeServer();
  const { adapter, statuses } = adapterFor(server, { local: contract() });
  await adapter.load();
  server.fail = () => new AccountApiError(413, { ok: false, error: { code: "CONTRACT_LIMIT", message: "Préférences trop volumineuses.", retry: false } });
  await assert.rejects(adapter.save(withClubs("t_1")));
  assert.equal(statuses.at(-1).state, "stopped");
  assert.equal(statuses.at(-1).reason, "Préférences trop volumineuses.");
});

test("flush reports success or the failure, never throws", async () => {
  const server = fakeServer();
  const { adapter } = adapterFor(server, { local: contract() });
  await adapter.load();
  assert.deepEqual(await adapter.flush(withClubs("t_1")), { ok: true, error: null });
  server.fail = () => new TypeError("fetch failed");
  const out = await adapter.flush(withClubs("t_2"));
  assert.equal(out.ok, false);
  assert.ok(out.error);
  // A flush before any load (sync never ready) does not write blindly over the account.
  const fresh = adapterFor(fakeServer(withClubs("t_a")), { local: contract() });
  const early = await fresh.adapter.flush(withClubs("t_z"));
  assert.equal(early.ok, false);
});

test("through the seam: a 409 merge is re-applied to the stores", async () => {
  const server = fakeServer(withClubs("t_a1"));
  let stores = withClubs("t_a1");
  const disconnect = connectPreferences({ read: () => stores, write: (c) => (stores = c) });
  const { adapter } = adapterFor(server, { local: stores });
  try {
    setPreferencesSync(adapter);
    await tick();
    await tick();
    await tick();
    // Another device adds t_b1; this browser adds t_l1.
    server.document = withClubs("t_a1", "t_b1");
    server.revision = 2;
    stores = withClubs("t_a1", "t_l1");
    // The seam debounces 1 s.
    const { preferencesChanged } = await import("../dashboard/frontend/src/services/user-preferences.js");
    preferencesChanged();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    for (let i = 0; i < 10; i++) await tick();
    assert.deepEqual(clubsOf(stores), ["t_a1", "t_b1", "t_l1"]);
    assert.deepEqual(server.document, stores);
  } finally {
    setPreferencesSync(null);
    disconnect();
  }
});

test("the client of /api/account: paths, methods, headers, errors", async () => {
  const seen = [];
  const answers = [];
  const fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body });
    const [status, body] = answers.shift();
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const api = createAccountApi({ fetch });
  answers.push([200, { accountId: "a", level: 1, pass: "x" }]);
  assert.equal((await api.session()).level, 1);
  answers.push([200, { contract: null, revision: null }]);
  assert.deepEqual(await api.getPreferences(), { contract: null, revision: null });
  answers.push([200, { revision: 4 }]);
  assert.deepEqual(await api.putPreferences(NOT_CHOSEN, 3), { revision: 4 });
  answers.push([200, { revision: 1 }]);
  await api.putPreferences(NOT_CHOSEN);
  answers.push([200, { format: "vega-account-export" }]);
  assert.equal((await api.exportData()).format, "vega-account-export");
  answers.push([503, { ok: false, error: { code: "DELETION_UNAVAILABLE", message: "La suppression du compte n'est pas encore disponible.", retry: false } }]);
  const failure = await api.erase().catch((e) => e);
  assert.ok(failure instanceof AccountApiError);
  assert.equal(failure.status, 503);
  assert.equal(failure.code, "DELETION_UNAVAILABLE");
  assert.equal(failure.message, "La suppression du compte n'est pas encore disponible.");
  answers.push([409, { ok: false, revision: 9, error: { code: "STALE", message: "x", retry: false } }]);
  const stale = await api.putPreferences(NOT_CHOSEN, 3).catch((e) => e);
  assert.equal(stale.revision, 9);
  assert.deepEqual(
    seen.map((s) => `${s.method} ${s.url}`),
    ["POST /api/account/session", "GET /api/account/preferences", "PUT /api/account/preferences", "PUT /api/account/preferences", "GET /api/account/export", "DELETE /api/account", "PUT /api/account/preferences"],
  );
  for (const s of seen.filter((s) => s.method !== "GET")) assert.equal(s.headers["content-type"], "application/json");
  assert.equal(seen[2].headers["if-match"], "3");
  assert.equal(seen[3].headers["if-match"], undefined);
  assert.deepEqual(JSON.parse(seen[2].body), NOT_CHOSEN);
  // A network failure or a non-JSON answer is an AccountApiError of status 0 / the status, never a raw throw.
  const down = createAccountApi({ fetch: async () => { throw new TypeError("fetch failed"); } });
  const offline = await down.getPreferences().catch((e) => e);
  assert.ok(offline instanceof AccountApiError);
  assert.equal(offline.status, 0);
  const html = createAccountApi({ fetch: async () => new Response("<html>", { status: 502 }) });
  const bad = await html.getPreferences().catch((e) => e);
  assert.equal(bad.status, 502);
  assert.equal(bad.code, "ACCOUNT_UNREACHABLE");
});
