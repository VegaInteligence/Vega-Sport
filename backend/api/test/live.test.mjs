// GET /live/matches/{id} (src/live.mjs) over fake live tables: the full state at one
// revision, the families handed over to core, the expiry, and what it refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveHandler, snapshot } from "../src/live.mjs";

const NOW = Date.parse("2025-09-20T21:00:00Z");
const later = NOW / 1000 + 3600;
const tables = {
  state: {
    m_live01: {
      match: "m_live01", revision: 6, provider: "replay", status: "finished", minute: 90, minute_added: 4, period: "second_half",
      home_score: 2, away_score: 1, kickoff_at: "2025-09-20T19:00:00Z", home_team: "t_lyon01", away_team: "t_psg001",
      finished_at: "2025-09-20T20:50:00Z", updated_at: "2025-09-20T20:50:00Z", core_families: ["events"], expires_at: later,
    },
    m_gone01: { match: "m_gone01", revision: 1, status: "in_play", kickoff_at: "2025-09-17T19:00:00Z", expires_at: NOW / 1000 - 1 },
  },
  events: {
    m_live01: [
      { match: "m_live01", seq: 3, provider_event_id: "e3", revision: 5, event_type: "goal", minute: 70, period: "second_half", team_id: "t_lyon01", player_id: "p_aaaaa1", player_name: "A. Striker", is_cancelled: false, expires_at: later },
      { match: "m_live01", seq: 1, provider_event_id: "e1", revision: 2, event_type: "goal", minute: 9, period: "first_half", team_id: "t_lyon01", player_id: "p_aaaaa1", player_name: "A. Striker", is_cancelled: false, expires_at: later },
      { match: "m_live01", seq: 2, provider_event_id: "e2", revision: 3, event_type: "yellow_card", minute: 40, team_id: "t_psg001", player_name: "B. Back", is_cancelled: false, expires_at: NOW / 1000 - 5 },
      { match: "m_live01", seq: 4, provider_event_id: "e4", revision: 6, event_type: "goal", minute: 80, team_id: "t_psg001", player_name: "C. Late", is_cancelled: true, expires_at: later },
    ],
  },
  stats: { m_live01: [{ match: "m_live01", team_id: "t_lyon01", revision: 4, possession_pct: 52, total_shots: 14, expires_at: later }] },
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

test("the full live state of a match, cached 2 s, with its revision", async () => {
  const { response, body } = await get("/live/matches/m_live01");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=2\b/);
  assert.deepEqual(
    [body.revision, body.status, body.provisional, body.minute, body.minuteAdded, body.period, body.score, body.homeTeam, body.awayTeam],
    [6, "finished", true, 90, 4, "second_half", { home: 2, away: 1 }, "t_lyon01", "t_psg001"],
  );
  // Core already has the events: the site reads those from core, the rest from the feed.
  assert.deepEqual(body.families, { score: "live", events: "core", stats: "live" });
  // In order, without the expired item; a goal cancelled by VAR stays, marked.
  assert.deepEqual(body.events.map((e) => [e.seq, e.type, e.teamId, e.player, e.cancelled]), [
    [1, "goal", "t_lyon01", "p_aaaaa1", false],
    [3, "goal", "t_lyon01", "p_aaaaa1", false],
    [4, "goal", "t_psg001", null, true],
  ]);
  assert.deepEqual(body.stats, [{ teamId: "t_lyon01", revision: 4, possessionPct: 52, totalShots: 14 }]);
  assert.equal(body.expiresAt, new Date(later * 1000).toISOString());
});

test("one revision only: items newer than the state are read again, then left out", async () => {
  let reads = 0;
  const racing = {
    state: async () => ({ ...tables.state.m_live01, revision: reads++ === 0 ? 5 : 6 }),
    events: async () => tables.events.m_live01,
    stats: async () => tables.stats.m_live01,
  };
  // First read: the state is at 5 but event 4 is already at 6, so it reads again and gets 6.
  const caught = await snapshot(racing, "m_live01", NOW / 1000);
  assert.deepEqual([reads, caught.state.revision, caught.events.map((e) => e.seq)], [2, 6, [1, 3, 4]]);
  // A state that stays behind (a burst of revisions): after three reads, nothing newer than it.
  const behind = { ...racing, state: async () => { reads++; return { ...tables.state.m_live01, revision: 4 }; } };
  reads = 0;
  const held = await snapshot(behind, "m_live01", NOW / 1000);
  assert.deepEqual([reads, held.events.map((e) => e.seq), held.stats.length], [3, [1], 1]);
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
