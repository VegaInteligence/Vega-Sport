// The site's live client (doc "Live"): the full state, the broadcast revisions applied to
// it in order (a gap reloads, a correction replaces), the hand-over to core, and the
// AppSync Events WebSocket handshake.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLive,
  isLiveWindow,
  liveConfigured,
  missing,
  newer,
  readLive,
  subscribeLive,
} from "../dashboard/frontend/src/services/live-client.js";

const CONFIG = { origin: "https://api.example", http: "abc.appsync-api.us-east-2.amazonaws.com", realtime: "abc.appsync-realtime-api.us-east-2.amazonaws.com", key: "da2-public" };
const KICKOFF = Date.parse("2025-09-20T19:00:00Z");
const STATE = {
  match: "m_live01", revision: 4, status: "in_play", provisional: false, minute: 12, minuteAdded: null, period: "first_half",
  score: { home: 1, away: 0 }, families: { score: "live", events: "live", stats: "live" },
  events: [{ seq: 1, revision: 2, type: "goal", minute: 9, teamId: "t_home01", player: null, cancelled: false }], stats: [],
};
const round = (revision, body) => ({ match: "m_live01", revision, ...body });
const live = (status, minute, home, away) => ({ status, minute, minute_added: null, period: "second_half", home_score: home, away_score: away, finished_at: null });

test("live only with the three AppSync settings", () => {
  assert.equal(liveConfigured(CONFIG), true);
  assert.equal(liveConfigured({ ...CONFIG, key: "" }), false);
});

test("the live window: 30 minutes before kick-off to 3 hours after, never once over", () => {
  const match = { id: "m_live01", status: "not_started", timeUtc: "2025-09-20T19:00:00Z" };
  assert.equal(isLiveWindow(match, KICKOFF - 45 * 60000), false);
  assert.equal(isLiveWindow(match, KICKOFF - 20 * 60000), true);
  assert.equal(isLiveWindow({ ...match, status: "in_play" }, KICKOFF + 100 * 60000), true);
  assert.equal(isLiveWindow({ ...match, status: "finished" }, KICKOFF + 100 * 60000), false);
  assert.equal(isLiveWindow(match, KICKOFF + 4 * 3600000), false);
  assert.equal(isLiveWindow({ ...match, id: "bad" }, KICKOFF), false);
});

test("the full state is read once, a missing one is null", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return url.endsWith("m_live01") ? { ok: true, status: 200, json: async () => STATE } : { ok: false, status: 404 };
  };
  assert.deepEqual(await readLive("m_live01", { config: CONFIG, fetcher }), STATE);
  assert.equal(await readLive("m_none01", { config: CONFIG, fetcher }), null);
  assert.equal(await readLive("../x", { config: CONFIG, fetcher }), null);
  assert.deepEqual(calls, ["https://api.example/live/matches/m_live01", "https://api.example/live/matches/m_none01"]);
});

test("revisions in order: state, a new event, statistics, a VAR correction, then core takes the score", () => {
  let state = applyLive(STATE, round(5, { state: live("in_play", 70, 2, 0) }));
  assert.deepEqual([state.revision, state.minute, state.score], [5, 70, { home: 2, away: 0 }]);
  const goal = { seq: 2, provider_event_id: "e2", revision: 6, event_type: "goal", minute: 70, team_id: "t_home01", player_id: "p_aaaaa1", player_name: "Buteur", is_cancelled: false };
  state = applyLive(state, round(6, { state: live("in_play", 70, 3, 0), events: [goal] }));
  assert.equal(applyLive(state, round(6, { events: [goal] })), state); // already applied
  assert.deepEqual(state.events.map((e) => [e.seq, e.type, e.player]), [[1, "goal", null], [2, "goal", "p_aaaaa1"]]);
  state = applyLive(state, round(7, { stats: [{ team_id: "t_home01", possession_pct: 55, total_shots: 9, revision: 7 }] }));
  assert.deepEqual(state.stats, [{ teamId: "t_home01", revision: 7, possessionPct: 55, totalShots: 9 }]);
  // VAR: the same event, a new revision, cancelled, and the score back.
  state = applyLive(state, round(8, { state: live("in_play", 72, 2, 0), events: [{ ...goal, revision: 8, is_cancelled: true }] }));
  assert.deepEqual([state.events.length, state.events[1].cancelled, state.events[1].revision, state.score.home], [2, true, 8, 2]);
  state = applyLive(state, round(9, { state: { ...live("finished", 90, 2, 1), finished_at: "2025-09-20T20:55:00Z" } }));
  assert.deepEqual([state.provisional, state.finishedAt], [true, "2025-09-20T20:55:00Z"]); // the whistle: a provisional result
  state = applyLive(state, round(10, { families: ["score"] }));
  assert.deepEqual([state.provisional, state.families], [false, { score: "core", events: "live", stats: "live" }]);
});

test("a missing revision asks for the full state; another match or an older read changes nothing", () => {
  assert.equal(missing(STATE, round(5, {})), false);
  assert.equal(missing(STATE, round(7, {})), true);
  assert.equal(applyLive(STATE, round(7, { state: live("in_play", 80, 5, 5) })), STATE);
  assert.equal(missing(STATE, { ...round(9, {}), match: "m_other1" }), false);
  assert.equal(applyLive(STATE, { ...round(5, { state: live("in_play", 80, 5, 5) }), match: "m_other1" }), STATE);
  assert.equal(missing(null, round(9, {})), false);
  assert.equal(newer(STATE, { revision: 3 }), false);
  assert.equal(newer(STATE, { revision: 4 }), true);
  assert.equal(newer(null, { revision: 1 }), true);
});

test("AppSync Events: the key in the subprotocol, init, then the match channel", () => {
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols) {
      Object.assign(this, { url, protocols, sent: [], readyState: 1 });
      sockets.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.closed = true;
    }
  }
  const changes = [];
  const stop = subscribeLive("m_live01", (c) => changes.push(c), { config: CONFIG, WebSocketImpl: FakeSocket });
  const socket = sockets[0];
  assert.equal(socket.url, `wss://${CONFIG.realtime}/event/realtime`);
  assert.equal(socket.protocols[0], "aws-appsync-event-ws");
  const header = JSON.parse(Buffer.from(socket.protocols[1].slice("header-".length), "base64url").toString());
  assert.deepEqual(header, { host: CONFIG.http, "x-api-key": CONFIG.key });
  socket.onopen();
  socket.onmessage({ data: JSON.stringify({ type: "connection_ack" }) });
  assert.deepEqual(socket.sent.map((m) => m.type), ["connection_init", "subscribe"]);
  assert.equal(socket.sent[1].channel, "/live/match/m-live01"); // AppSync: no underscore in a segment
  socket.onmessage({ data: JSON.stringify({ type: "data", id: socket.sent[1].id, event: JSON.stringify({ match: "m_live01", revision: 1 }) }) });
  socket.onmessage({ data: JSON.stringify({ type: "data", id: "other", event: "{}" }) });
  assert.deepEqual(changes, [{ match: "m_live01", revision: 1 }]);
  stop();
  assert.equal(socket.sent.at(-1).type, "unsubscribe");
  assert.equal(socket.closed, true);
});
