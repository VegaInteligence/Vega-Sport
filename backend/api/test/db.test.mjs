// The reader's connections: kept between requests, and a statement that found its
// connection closed is sent once more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReader } from "../src/db.mjs";

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
    end() {}
  }
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
