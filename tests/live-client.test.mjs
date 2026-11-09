// The site's live client (doc "Live"): the full state, the broadcast changes applied to
// it, the hand-over to core, and the AppSync Events WebSocket handshake.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLive,
  isLiveWindow,
  liveConfigured,
  readLive,
  subscribeLive,
} from "../dashboard/frontend/src/services/live-client.js";

const CONFIG = { origin: "https://v2.example", http: "abc.appsync-api.us-east-2.amazonaws.com", realtime: "abc.appsync-realtime-api.us-east-2.amazonaws.com", key: "da2-public" };
const KICKOFF = Date.parse("2025-09-20T19:00:00Z");
const STATE = {
  match: "m_live01", status: "in_play", provisional: false, minute: 12, minuteAdded: null, score: { home: 1, away: 0 },
  families: { score: "live", events: "live", stats: "live" }, events: [{ seq: 1, kind: "goal", minute: 9 }], stats: [],
};

test("live only with the v2 API and the three AppSync settings", () => {
  assert.equal(liveConfigured(CONFIG, true), true);
  assert.equal(liveConfigured(CONFIG, false), false);
  assert.equal(liveConfigured({ ...CONFIG, key: "" }, true), false);
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
  assert.deepEqual(calls, ["https://v2.example/live/matches/m_live01", "https://v2.example/live/matches/m_none01"]);
});

test("broadcast changes: state, a new event once, statistics, then core takes the score", () => {
  let state = applyLive(STATE, { type: "state", status: "in_play", minute: 70, score_home: 2, score_away: 0 });
  assert.deepEqual([state.minute, state.score], [70, { home: 2, away: 0 }]);
  const goal = { type: "event", seq: 3, kind: "goal", minute: 70, side: "home", player: "p_aaaaa1", score_home: 2, score_away: 0 };
  state = applyLive(applyLive(state, goal), goal);
  assert.deepEqual(state.events.map((e) => e.seq), [1, 3]);
  state = applyLive(state, { type: "stats", side: "home", period: "all", possession_pct: 55, total_shots: 9 });
  assert.deepEqual(state.stats, [{ side: "home", period: "all", possessionPct: 55, totalShots: 9 }]);
  state = applyLive(state, { type: "state", status: "finished", minute: 90, score_home: 2, score_away: 1 });
  assert.equal(state.provisional, true); // the whistle: a provisional result
  state = applyLive(state, { type: "families", families: ["score"] });
  assert.deepEqual([state.provisional, state.families], [false, { score: "core", events: "live", stats: "live" }]);
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
  assert.equal(socket.sent[1].channel, "/live/match/m_live01");
  socket.onmessage({ data: JSON.stringify({ type: "data", id: socket.sent[1].id, event: JSON.stringify({ type: "state", minute: 3 }) }) });
  socket.onmessage({ data: JSON.stringify({ type: "data", id: "other", event: "{}" }) });
  assert.deepEqual(changes, [{ type: "state", minute: 3 }]);
  stop();
  assert.equal(socket.sent.at(-1).type, "unsubscribe");
  assert.equal(socket.closed, true);
});
