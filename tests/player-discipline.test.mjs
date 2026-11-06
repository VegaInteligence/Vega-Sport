import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeDiscipline,
  loadDiscipline,
} from "../dashboard/frontend/src/services/player-discipline.js";
test("paired dismissal is not counted as direct red; unknown matches remain uncovered", () => {
  const event = (kind, minute) => ({
    event_type: kind,
    minute,
    period: "SecondHalf",
    player: { id: "p" },
  });
  const d = summarizeDiscipline("p", [
    {
      events: [
        event("yellowcard", 10),
        event("secondyellow", 60),
        event("redcard", 60),
        event("redcard", 80),
      ],
    },
    null,
  ]);
  assert.deepEqual(d, {
    yellow: 1,
    secondYellow: 1,
    directRed: 1,
    covered: 1,
    total: 2,
  });
});
test("fetch failures remain uncovered and workers respect concurrency", async () => {
  let active = 0,
    peak = 0;
  const client = {
    payloads: new Map(),
    async ensureEndpoint(m) {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (m.id === "b") throw Error();
      this.payloads.set(`${m.id}:events`, { data: { events: [] } });
    },
  };
  const d = await loadDiscipline(
    client,
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    "p",
    2,
  );
  assert.equal(peak, 2);
  assert.equal(d.covered, 2);
  assert.equal(d.total, 3);
});

test("an in-flight match endpoint does not become a missing result", async () => {
  const client = {
    payloads: new Map([["a:events", { loading: true }]]),
    async ensureEndpoint() {},
    async request(path) {
      assert.equal(path, "matches/a/events");
      return {
        data: { events: [{ event_type: "yellowcard", player: { id: "p" } }] },
      };
    },
  };
  const totals = await loadDiscipline(client, [{ id: "a" }], "p");
  assert.equal(totals.covered, 1);
  assert.equal(totals.yellow, 1);
});
