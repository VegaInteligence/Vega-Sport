import test from "node:test";
import assert from "node:assert/strict";
import {
  playerHalfMinutes,
  loadPlayerHalfMinutes,
} from "../dashboard/frontend/src/services/player-half-minutes.js";

const period = (name, value) => ({
  period: name,
  stats: [{ stats: { arbitrary: { key: "minutes_played", stat: { value } } } }],
});
const payload = () => ({
  match_id: "m_123456",
  players: [
    {
      player: { id: "p_123456" },
      team_id: "t_123456",
      periods: [period("FirstHalf", 45), period("SecondHalf", 45)],
    },
  ],
});
const parse = (data) =>
  playerHalfMinutes(data, "m_123456", "p_123456", "t_123456");

test("accepts unique matching regulation periods and stable metric keys", () => {
  assert.equal(parse(payload()), 90);
  const data = payload();
  data.players[0].periods[1] = period("SecondHalf", 0);
  assert.equal(parse(data), 45);
});

test("rejects missing, duplicate, foreign and invalid observations", () => {
  for (const mutate of [
    (d) => {
      d.match_id = "m_wrong";
    },
    (d) => {
      d.players[0].player.id = "p_wrong";
    },
    (d) => {
      d.players[0].team_id = "t_wrong";
    },
    (d) => {
      d.players.push(structuredClone(d.players[0]));
    },
    (d) => {
      d.players[0].periods.pop();
    },
    (d) => {
      d.players[0].periods[1].period = "FirstHalf";
    },
    (d) => {
      d.players[0].periods.push(period("ExtraTimeFirstHalf", 15));
    },
    (d) => {
      d.players[0].periods[0] = period("FirstHalf", null);
    },
    (d) => {
      d.players[0].periods[0] = period("FirstHalf", 46);
    },
    (d) => {
      d.players[0].periods[0].stats.push(
        structuredClone(d.players[0].periods[0].stats[0]),
      );
    },
  ]) {
    const data = payload();
    mutate(data);
    assert.equal(parse(data), null);
  }
});

test("loader uses shared endpoint, skips failures and duplicate matches, and propagates cancellation", async () => {
  const calls = [];
  const client = {
    async ensureEndpoint(match, section, force, options) {
      calls.push([match.id, section, force, options.signal]);
      if (match.id === "m_badbad") throw Error("unavailable");
      return { data: payload() };
    },
  };
  const controller = new AbortController();
  const result = await loadPlayerHalfMinutes(
    client,
    [{ id: "m_123456" }, { id: "m_123456" }, { id: "m_badbad" }],
    "p_123456",
    "t_123456",
    controller.signal,
  );
  assert.deepEqual([...result], [["m_123456", 90]]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [
    "m_123456",
    "players/halves",
    false,
    controller.signal,
  ]);
  controller.abort();
  await assert.rejects(
    loadPlayerHalfMinutes(
      client,
      [{ id: "m_123456" }],
      "p_123456",
      "t_123456",
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("loader reads three matches at a time and answers in the matches' order", async () => {
  const ids = ["m_aaaaa1", "m_aaaaa2", "m_aaaaa3", "m_aaaaa4", "m_aaaaa5"];
  const waiting = new Map();
  let active = 0,
    most = 0;
  const client = {
    ensureEndpoint(match) {
      most = Math.max(most, ++active);
      return new Promise((resolve) => waiting.set(match.id, () => (active--, resolve({ data: { ...payload(), match_id: match.id } }))));
    },
  };
  const loading = loadPlayerHalfMinutes(client, ids.map((id) => ({ id })), "p_123456", "t_123456");
  await Promise.resolve();
  assert.deepEqual([...waiting.keys()], ids.slice(0, 3));
  // The reads end out of order; the next match starts as soon as one ends.
  for (const id of ["m_aaaaa3", "m_aaaaa1", "m_aaaaa2", "m_aaaaa5", "m_aaaaa4"]) {
    while (!waiting.has(id)) await new Promise((resolve) => setImmediate(resolve));
    waiting.get(id)();
  }
  assert.deepEqual([...(await loading).keys()], ids);
  assert.equal(most, 3);
});
