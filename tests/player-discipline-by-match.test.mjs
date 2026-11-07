import test from "node:test";
import assert from "node:assert/strict";
import { loadDisciplineByMatch } from "../dashboard/frontend/src/services/player-discipline.js";

test("per-match discipline distinguishes missing sheets and paired second yellows", async () => {
  const payloads = new Map();
  const calls = [];
  const client = {
    payloads,
    async ensureEndpoint(match) {
      calls.push(match.id);
      if (match.id === "m_000002") throw new Error("unavailable");
      payloads.set(`${match.id}:events`, {
        data: {
          events: [
            { id: "one", player: { id: "p_000001" }, event_type: "yellowcard" },
            {
              id: "two",
              player: { id: "p_000001" },
              event_type: "secondyellow",
              minute: 75,
              period: 2,
            },
            {
              id: "three",
              player: { id: "p_000001" },
              event_type: "redcard",
              minute: 75,
              period: 2,
            },
          ],
        },
      });
    },
  };
  const result = await loadDisciplineByMatch(
    client,
    [{ id: "m_000001" }, { id: "m_000002" }, { id: "uefa:2048018" }],
    "p_000001",
  );
  assert.deepEqual(result.get("m_000001"), {
    yellow: 1,
    secondYellow: 1,
    directRed: 0,
  });
  assert.equal(result.has("m_000002"), false);
  assert.deepEqual(calls.sort(), ["m_000001", "m_000002"]);
});
test("abort propagates", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadDisciplineByMatch({}, [{ id: "m_000001" }], "p_000001", {
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});
