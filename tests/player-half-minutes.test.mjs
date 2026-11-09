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
