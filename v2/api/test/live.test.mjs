// GET /live/matches/{id} (src/live.mjs) over fake live tables: the full state, the
// families handed over to core, the expiry, and what it refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveHandler } from "../src/live.mjs";

const NOW = Date.parse("2025-09-20T21:00:00Z");
const later = NOW / 1000 + 3600;
const tables = {
  state: {
    m_live01: {
      match: "m_live01", provider: "replay", status: "finished", minute: 90, minute_added: 4, period: "second_half",
      score_home: 2, score_away: 1, kickoff_at: "2025-09-20T19:00:00Z", home_team: "t_lyon01", away_team: "t_psg001",
      finished_at: "2025-09-20T20:50:00Z", updated_at: "2025-09-20T20:50:00Z", core_families: ["events"], expires_at: later,
    },
    m_gone01: { match: "m_gone01", status: "in_play", kickoff_at: "2025-09-17T19:00:00Z", expires_at: NOW / 1000 - 1 },
  },
  events: {
    m_live01: [
      { match: "m_live01", seq: 3, kind: "goal", minute: 70, side: "home", player: "p_aaaaa1", player_name: "A. Striker", score_home: 2, score_away: 0, expires_at: later },
      { match: "m_live01", seq: 1, kind: "goal", minute: 9, side: "home", player: "p_aaaaa1", player_name: "A. Striker", score_home: 1, score_away: 0, expires_at: later },
      { match: "m_live01", seq: 2, kind: "yellow_card", minute: 40, side: "away", player_name: "B. Back", expires_at: NOW / 1000 - 5 },
    ],
  },
  stats: { m_live01: [{ match: "m_live01", key: "home#all", side: "home", period: "all", possession_pct: 52, total_shots: 14, expires_at: later }] },
};
const read = {
  state: async (id) => tables.state[id] ?? null,
  events: async (id) => tables.events[id] ?? [],
  stats: async (id) => tables.stats[id] ?? [],
};
const handle = createLiveHandler(read, { clock: () => NOW });
const get = async (path, method = "GET") => {
  const response = await handle(new Request("https://api.test" + path, { method }));
  return { response, body: method === "HEAD" ? null : await response.json() };
};

test("the full live state of a match, cached 2 s", async () => {
  const { response, body } = await get("/live/matches/m_live01");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=2\b/);
  assert.deepEqual(
    [body.status, body.provisional, body.minute, body.minuteAdded, body.score, body.homeTeam, body.awayTeam],
    ["finished", true, 90, 4, { home: 2, away: 1 }, "t_lyon01", "t_psg001"],
  );
  // Core already has the events: the site reads those from core, the rest from the feed.
  assert.deepEqual(body.families, { score: "live", events: "core", stats: "live" });
  // In order, without the expired item.
  assert.deepEqual(body.events.map((e) => [e.seq, e.kind, e.player, e.score]), [
    [1, "goal", "p_aaaaa1", { home: 1, away: 0 }],
    [3, "goal", "p_aaaaa1", { home: 2, away: 0 }],
  ]);
  assert.deepEqual(body.stats, [{ side: "home", period: "all", possessionPct: 52, totalShots: 14 }]);
  assert.equal(body.expiresAt, new Date(later * 1000).toISOString());
});

test("no live state: expired, unknown, or not a match", async () => {
  assert.equal((await get("/live/matches/m_gone01")).response.status, 404); // expired, not yet deleted
  assert.equal((await get("/live/matches/m_none01")).response.status, 404);
  assert.equal((await get("/live/matches/../state")).response.status, 404);
  assert.equal((await get("/live/matches/m_live01?x=1")).response.status, 400);
  assert.equal((await get("/live/matches/m_live01", "POST")).response.status, 405);
  const head = await get("/live/matches/m_live01", "HEAD");
  assert.equal(head.response.status, 200);
});

test("the score comes from core once PitchAPI has it: no longer provisional", async () => {
  tables.state.m_live01.core_families = ["score", "events", "stats"];
  const { body } = await get("/live/matches/m_live01");
  assert.deepEqual([body.provisional, body.families], [false, { score: "core", events: "core", stats: "core" }]);
});
