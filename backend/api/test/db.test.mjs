// The reader's connections: kept between requests, and a statement that found its
// connection closed is sent once more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { PLANNER_SETTINGS, createReader } from "../src/db.mjs";
import { gate, lose, standIn, until } from "./pg-stand-in.mjs";

/** A pool that answers each statement with the next outcome of a list. */
function fakePool(outcomes) {
  const state = { options: null, sent: [], listeners: {} };
  class Pool {
    constructor(options) {
      state.options = options;
    }
    on(event, listener) {
      state.listeners[event] = listener;
    }
    // One connection of the pool, given to the callback as pg-pool gives it (GH140: the
    // reader takes its connections itself): its statements are recorded as sent on it,
    // and how it was given back.
    connect(callback) {
      const client = Object.assign(new EventEmitter(), {
        query: (sql, values, done) => {
          state.sent.push(values === undefined ? [sql] : [sql, values]);
          const outcome = outcomes.shift();
          const answer = outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ rows: outcome });
          if (!done) return answer;
          answer.then((result) => done(null, result), done);
        },
        release: (error) => state.released.push(error ?? null),
      });
      queueMicrotask(() => callback(undefined, client, client.release));
    }
    end() {}
  }
  state.released = [];
  return { Pool, state };
}
const lost = (code, message = "read " + code) => Object.assign(new Error(message), { code });

test("connections are kept five minutes and an idle one that closes ends nothing", () => {
  const { Pool, state } = fakePool([]);
  createReader("postgresql://reader@localhost/base", { Pool, role: "vega_read" });
  assert.equal(state.options.idleTimeoutMillis, 300_000);
  assert.equal(state.options.keepAlive, true);
  assert.equal(state.options.max, 4);
  assert.match(state.options.options, /default_transaction_read_only=on .*-c role=vega_read$/);
  // pg emits "error" on the pool for an idle client that failed: it has a listener.
  assert.equal(typeof state.listeners.error, "function");
  assert.doesNotThrow(() => state.listeners.error(lost("ECONNRESET")));
});

test("a statement that found its connection closed is sent once more", async () => {
  for (const error of [lost("ECONNRESET"), lost("EPIPE"), new Error("Connection terminated unexpectedly")]) {
    const { Pool, state } = fakePool([error, [{ n: 1 }]]);
    const reader = createReader("postgresql://reader@localhost/base", { Pool });
    assert.deepEqual(await reader.read("SELECT $1::int AS n", [1]), [{ n: 1 }]);
    assert.deepEqual(state.sent, [["SELECT $1::int AS n", [1]], ["SELECT $1::int AS n", [1]]]);
  }
});

test("once only, and never a statement the base refused", async () => {
  // Closed twice: the second failure is the answer.
  let { Pool, state } = fakePool([lost("ECONNRESET"), lost("ECONNRESET", "second")]);
  await assert.rejects(createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1"), /second/);
  assert.equal(state.sent.length, 2);
  // An error of the base (it names a severity): a timeout, a bad statement.
  for (const refused of [
    Object.assign(new Error("canceling statement due to statement timeout"), { severity: "ERROR", code: "57014" }),
    Object.assign(new Error("terminating connection due to administrator command"), { severity: "FATAL", code: "57P01" }),
    new Error("something else"),
  ]) {
    ({ Pool, state } = fakePool([refused, [{ n: 1 }]]));
    await assert.rejects(createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1"), refused);
    assert.equal(state.sent.length, 1);
  }
});

test("a statement with planner settings of its own runs alone in a transaction that sets them", async () => {
  const { Pool, state } = fakePool([[], [], [{ n: 1 }], []]);
  const reader = createReader("postgresql://reader@localhost/base", { Pool });
  assert.deepEqual(await reader.read("SELECT $1::int AS n", [1], { plan: ["hashJoins"] }), [{ n: 1 }]);
  assert.deepEqual(state.sent, [["BEGIN"], ["SET LOCAL enable_nestloop = off"], ["SELECT $1::int AS n", [1]], ["COMMIT"]]);
  assert.deepEqual(state.released, [null]);
  // The settings have names: nothing else reaches the base.
  assert.deepEqual(Object.keys(PLANNER_SETTINGS), ["hashJoins"]);
  await assert.rejects(reader.read("SELECT 1", [], { plan: ["enable_seqscan = off"] }), /unknown planner setting/);
  assert.equal(state.sent.length, 4);
  // Without any, the statement is sent as before.
  const plain = fakePool([[{ n: 2 }]]);
  assert.deepEqual(await createReader("postgresql://reader@localhost/base", { Pool: plain.Pool }).read("SELECT 2 AS n", [], { plan: [] }), [{ n: 2 }]);
  assert.deepEqual(plain.state.sent, [["SELECT 2 AS n", []]]);
});

test("a refused statement ends its transaction; a lost connection is not given back and the statement is sent once more", async () => {
  const refused = Object.assign(new Error("canceling statement due to statement timeout"), { severity: "ERROR", code: "57014" });
  let { Pool, state } = fakePool([[], [], refused, []]);
  await assert.rejects(createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1", [], { plan: ["hashJoins"] }), refused);
  assert.deepEqual(state.sent.map(([sql]) => sql), ["BEGIN", "SET LOCAL enable_nestloop = off", "SELECT 1", "ROLLBACK"]);
  assert.deepEqual(state.released, [null]);
  // The connection closes under the statement: it is dropped, and all is sent again on another.
  const closed = lost("ECONNRESET");
  ({ Pool, state } = fakePool([[], [], closed, closed, [], [], [{ n: 1 }], []]));
  assert.deepEqual(await createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1 AS n", [], { plan: ["hashJoins"] }), [{ n: 1 }]);
  assert.deepEqual(state.sent.map(([sql]) => sql), ["BEGIN", "SET LOCAL enable_nestloop = off", "SELECT 1 AS n", "ROLLBACK", "BEGIN", "SET LOCAL enable_nestloop = off", "SELECT 1 AS n", "COMMIT"]);
  assert.deepEqual(state.released, [closed, null]);
});

// Incident of 20 November 2026 (VI-33): a copy of the function that sleeps keeps its
// connection (the pool's own idle limit does not run while the copy is frozen), and the
// login ran out of connections. The base is asked to close a session left idle.
test("the base closes a session left idle, when asked to; a statement that found it closed is sent once more", async () => {
  let { Pool, state } = fakePool([]);
  createReader("postgresql://reader@localhost/base", { Pool, role: "vega_read", idleSessionMs: 120_000 });
  assert.match(state.options.options, / -c idle_session_timeout=120000 /);
  // The role stays last (its test above), and nothing is asked without the option.
  assert.match(state.options.options, /-c role=vega_read$/);
  ({ Pool, state } = fakePool([]));
  createReader("postgresql://reader@localhost/base", { Pool });
  assert.doesNotMatch(state.options.options, /idle_session_timeout/);
  for (const bad of [0, -1, 1.5, "120000", Number.NaN]) assert.throws(() => createReader("postgresql://reader@localhost/base", { Pool, idleSessionMs: bad }), /invalid idle session/);
  // The base's own word for it (57P05) reaches the statement sent on the closed session:
  // it never ran, and is sent again on a new one.
  const idle = Object.assign(new Error("terminating connection due to idle-session timeout"), { severity: "FATAL", code: "57P05" });
  ({ Pool, state } = fakePool([idle, [{ n: 1 }]]));
  assert.deepEqual(await createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1 AS n"), [{ n: 1 }]);
  assert.equal(state.sent.length, 2);
  // In a transaction of its own, the closed session is not given back to the pool.
  ({ Pool, state } = fakePool([idle, [], [], [], [{ n: 1 }], []]));
  assert.deepEqual(await createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1 AS n", [], { plan: ["hashJoins"] }), [{ n: 1 }]);
  assert.deepEqual(state.released, [idle, null]);
  // A login out of connections (53300) is the base refusing: asking again at once would
  // only ask for one more.
  const full = Object.assign(new Error("too many connections for role"), { severity: "FATAL", code: "53300" });
  ({ Pool, state } = fakePool([full, [{ n: 1 }]]));
  await assert.rejects(createReader("postgresql://reader@localhost/base", { Pool }).read("SELECT 1"), full);
  assert.equal(state.sent.length, 1);
});

// GH140 (FAILURE_MODES_OPTIMISATIONS.md, written before these tests): the connections a statement's checkouts open, told
// to the statement that asked (`opened(first)`), on pg-pool's own pool over a stand-in for pg's client (pg-stand-in.mjs).
const DSN = "postgresql://reader@localhost/base";
const reset = () => Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
const refusedStatement = () => Object.assign(new Error("canceling statement due to statement timeout"), { severity: "ERROR", code: "57014" });
const PLANNED = ["BEGIN", "SET LOCAL enable_nestloop = off"];
/** One reader of the stand-in, ended after the test (pg-pool keeps an idle connection's timer until then). */
function reading(t, answer) {
  const { Pool, base } = standIn(answer);
  const reader = createReader(DSN, { Pool, max: 1 });
  t.after(() => void reader.end().catch(() => {}));
  const read = async (sql) => {
    const told = [];
    const rows = await reader.read(sql, [], { opened: (first) => told.push(first) });
    return { rows, told };
  };
  return { reader, base, read };
}

test("GH140-a, b, d, e: the pool's first connection, a kept one, one the base closed while idle, one lost under a statement", async (t) => {
  let next = null;
  const { base, read } = reading(t, () => {
    const outcome = next ?? [{ n: 1 }];
    next = null;
    return outcome;
  });
  assert.deepEqual(await read("SELECT 1"), { rows: [{ n: 1 }], told: [true] }, "a: the copy's first statement");
  assert.deepEqual(await read("SELECT 2"), { rows: [{ n: 1 }], told: [] }, "b: the connection kept");
  // d: the base ends the session left idle; its FATAL reaches the pool while the connection is idle in it.
  base.clients[0].lose(Object.assign(new Error("terminating connection due to idle-session timeout"), { severity: "FATAL", code: "57P05" }));
  assert.deepEqual(await read("SELECT 3"), { rows: [{ n: 1 }], told: [false] }, "d: a later connection");
  // e: the connection dies under the statement, which is sent once more on a new one.
  next = lose(reset());
  assert.deepEqual(await read("SELECT 4"), { rows: [{ n: 1 }], told: [false] }, "e: the retry's connection");
  assert.deepEqual(base.sent, [[1, "SELECT 1"], [1, "SELECT 2"], [2, "SELECT 3"], [2, "SELECT 4"], [3, "SELECT 4"]]);
});

test("GH140-e: the copy's first statement, lost under it or ended by the base (57P05): both connections its own", async (t) => {
  const idle = Object.assign(new Error("terminating connection due to idle-session timeout"), { severity: "FATAL", code: "57P05" });
  for (const failure of [lose(reset()), idle]) {
    let first = true;
    const { base, read } = reading(t, () => (first ? ((first = false), failure) : [{ n: 1 }]));
    assert.deepEqual(await read("SELECT 1"), { rows: [{ n: 1 }], told: [true, false] });
    assert.deepEqual(base.sent, [[1, "SELECT 1"], [2, "SELECT 1"]]);
    assert.deepEqual(base.clients.map((c) => c.ended), [1, 0], "the first connection dropped");
  }
});

test("GH140-f, g: a statement waiting behind another's is told of the connection opened for it inside the other's callback", async (t) => {
  for (const plan of [[], ["hashJoins"]]) {
    const held = gate();
    const refused = refusedStatement();
    const { Pool, base } = standIn((sql) => (sql === "SELECT 'a'" ? held.then(() => refused) : [{ n: 2 }]));
    // The async context each "connect" of the pool is emitted in: what the reader must not count by.
    const asking = new AsyncLocalStorage(), contexts = [];
    class Watched extends Pool {
      constructor(options) {
        super(options);
        this.on("connect", () => contexts.push(asking.getStore()));
      }
    }
    const reader = createReader(DSN, { Pool: Watched, max: 1 });
    t.after(() => void reader.end().catch(() => {}));
    const a = [], b = [];
    const first = asking.run("A", () => reader.read("SELECT 'a'", [], { opened: (x) => a.push(x) }));
    const second = asking.run("B", () => reader.read("SELECT 'b'", [], { plan, opened: (x) => b.push(x) }));
    // A's statement holds the one connection; B waits in the pool's queue.
    await until(() => base.sent.length === 1);
    assert.deepEqual([a, b], [[true], []]);
    held.open();
    await assert.rejects(first, refused);
    assert.deepEqual(await second, [{ n: 2 }]);
    assert.deepEqual([a, b], [[true], [false]], plan.join() || "ordinary");
    assert.deepEqual(contexts, ["A", "A"], "B's connection is opened inside A's callback, in A's async context");
    const own = plan.length ? [...PLANNED, "SELECT 'b'", "COMMIT"] : ["SELECT 'b'"];
    assert.deepEqual(base.sent, [[1, "SELECT 'a'"], ...own.map((sql) => [2, sql])]);
    assert.deepEqual(base.clients.map((c) => c.ended), [1, 0], "A's connection dropped after its failure");
  }
});

test("GH140-h, i: a connection lost under a statement while another waits: heard, dropped once, the retry's opening its own", async (t) => {
  for (const plan of [["hashJoins"], []]) {
    let lost = false;
    const { reader, base } = reading(t, (sql) => (sql === "SELECT 'a'" && !lost ? ((lost = true), lose(reset())) : [{ n: 3 }]));
    const a = [], b = [];
    const first = reader.read("SELECT 'a'", [], { plan, opened: (x) => a.push(x) });
    const second = reader.read("SELECT 'b'", [], { opened: (x) => b.push(x) });
    assert.deepEqual([await first, await second], [[{ n: 3 }], [{ n: 3 }]]);
    // pg-pool opens a connection for whoever asks while it has room: A's retry, before B, which reuses it after A.
    assert.deepEqual([a, b], [[true, false], []], plan.join() || "ordinary");
    const statements = plan.length ? [...PLANNED, "SELECT 'a'"] : ["SELECT 'a'"];
    assert.deepEqual(base.sent, [...statements.map((sql) => [1, sql]), ...(plan.length ? [...statements, "COMMIT"] : statements).map((sql) => [2, sql]), [2, "SELECT 'b'"]]);
    // The planned statement's ROLLBACK was tried on the dead connection, which refused it before the base.
    assert.deepEqual(base.unsent, plan.length ? [[1, "ROLLBACK"]] : []);
    assert.deepEqual(base.clients.map((c) => c.ended), [1, 0], "the dead connection dropped once");
  }
});

test("GH140-j: a connection the base refuses is no opening, and the statement is not sent again", async (t) => {
  const { reader, base, read } = reading(t, () => [{ n: 1 }]);
  base.refuse = Object.assign(new Error("too many connections for role"), { severity: "FATAL", code: "53300" });
  const told = [];
  await assert.rejects(reader.read("SELECT 1", [], { opened: (first) => told.push(first) }), base.refuse);
  assert.deepEqual([told, base.attempts, base.sent], [[], 1, []]);
  // The base takes it again: the pool's first connection is its first that opened.
  base.refuse = null;
  assert.deepEqual(await read("SELECT 1"), { rows: [{ n: 1 }], told: [true] });
});

test("GH140-k: a count that throws takes no statement with it", async (t) => {
  const { reader, base } = reading(t, () => [{ n: 1 }]);
  const broken = () => {
    throw new Error("count unavailable");
  };
  assert.deepEqual(await reader.read("SELECT 1", [], { plan: ["hashJoins"], opened: broken }), [{ n: 1 }]);
  assert.deepEqual(await reader.read("SELECT 2", [], { opened: broken }), [{ n: 1 }]);
  // Both on the one connection, given back after each.
  assert.deepEqual(base.sent, [...PLANNED, "SELECT 1", "COMMIT", "SELECT 2"].map((sql) => [1, sql]));
});
