// The reader's connections: kept between requests, and a statement that found its
// connection closed is sent once more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANNER_SETTINGS, createReader } from "../src/db.mjs";

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
    async query(sql, values) {
      state.sent.push([sql, values]);
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return { rows: outcome };
    }
    // One connection of the pool: its statements are recorded as sent on it, and how it
    // was given back.
    async connect() {
      const client = {
        query: async (sql, values) => {
          state.sent.push(values === undefined ? [sql] : [sql, values]);
          const outcome = outcomes.shift();
          if (outcome instanceof Error) throw outcome;
          return { rows: outcome };
        },
        release: (error) => state.released.push(error ?? null),
      };
      return client;
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
