/**
 * Live matches on the v2 API (doc "Live"): the full state from GET /live/matches/{id}
 * (the v2 distribution, cached 2 s), then each change as AppSync Events publishes it on
 * /live/match/{id}. The browser never talks to the live provider: one feed per match,
 * on the server. Built with NEXT_PUBLIC_API_SCHEMA=v2 and the three
 * NEXT_PUBLIC_LIVE_EVENTS_* settings (outputs of infra/aws-v2/live.yaml); without them
 * nothing here runs.
 */
import { API_V2 } from "./v2-routes.js";

export const LIVE = {
  origin: process.env.NEXT_PUBLIC_API_ORIGIN || "",
  http: process.env.NEXT_PUBLIC_LIVE_EVENTS_HTTP || "",
  realtime: process.env.NEXT_PUBLIC_LIVE_EVENTS_REALTIME || "",
  key: process.env.NEXT_PUBLIC_LIVE_EVENTS_KEY || "",
};
export const liveConfigured = (config = LIVE, v2 = API_V2) =>
  Boolean(v2 && config.http && config.realtime && config.key);

const MATCH = /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const AHEAD = 30 * 60 * 1000,
  SPAN = 3 * 60 * 60 * 1000;

/** A match worth a live read: not over, kick-off within 30 minutes or under way (3 h). */
export function isLiveWindow(match, now = Date.now()) {
  if (!match || !MATCH.test(match.id || "")) return false;
  if (["finished", "postponed", "canceled", "abandoned"].includes(match.status)) return false;
  const kickoff = Date.parse(match.timeUtc || "");
  return Number.isFinite(kickoff) && now >= kickoff - AHEAD && now <= kickoff + SPAN;
}

/** The full live state, or null when the match has none (404). */
export async function readLive(id, { config = LIVE, fetcher = fetch, signal } = {}) {
  if (!MATCH.test(id || "")) return null;
  const response = await fetcher(`${config.origin}/live/matches/${id}`, { signal, headers: { Accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Direct indisponible.");
  return response.json();
}

const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const FAMILIES = ["score", "events", "stats"];

/** One broadcast change applied to the full state (what GET /live/matches/{id} returns). */
export function applyLive(state, change) {
  if (!state || !change) return state;
  if (change.type === "state")
    return {
      ...state,
      status: change.status,
      minute: change.minute ?? null,
      minuteAdded: change.minute_added ?? null,
      period: change.period ?? null,
      score: { home: change.score_home ?? null, away: change.score_away ?? null },
      provisional: change.status === "finished" && state.families?.score !== "core",
    };
  if (change.type === "event") {
    if (state.events.some((e) => e.seq === change.seq)) return state;
    const event = {
      seq: change.seq, kind: change.kind, minute: change.minute ?? null, minuteAdded: change.minute_added ?? null,
      period: change.period ?? null, side: change.side ?? null, player: change.player ?? null, playerName: change.player_name ?? null,
      score: change.score_home == null ? null : { home: change.score_home, away: change.score_away },
    };
    return { ...state, events: [...state.events, event].sort((a, b) => a.seq - b.seq) };
  }
  if (change.type === "stats") {
    const { type, side, period, ...values } = change;
    const row = { side, period, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [camel(k), v])) };
    return { ...state, stats: [...state.stats.filter((s) => s.side !== side || s.period !== period), row] };
  }
  if (change.type === "families") {
    const core = new Set(change.families);
    const families = Object.fromEntries(FAMILIES.map((f) => [f, core.has(f) ? "core" : "live"]));
    return { ...state, families, provisional: state.status === "finished" && !core.has("score") };
  }
  return state;
}

const base64url = (text) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Subscribe to /live/match/{id} (AppSync Events WebSocket); returns the unsubscribe. */
export function subscribeLive(id, onChange, { config = LIVE, WebSocketImpl = globalThis.WebSocket } = {}) {
  if (!WebSocketImpl || !MATCH.test(id || "")) return () => {};
  const authorization = { host: config.http, "x-api-key": config.key };
  const socket = new WebSocketImpl(`wss://${config.realtime}/event/realtime`, [
    "aws-appsync-event-ws",
    "header-" + base64url(JSON.stringify(authorization)),
  ]);
  const subscription = `live-${id}`;
  socket.onopen = () => socket.send(JSON.stringify({ type: "connection_init" }));
  socket.onmessage = (message) => {
    let data;
    try {
      data = JSON.parse(message.data);
    } catch {
      return;
    }
    if (data.type === "connection_ack")
      socket.send(JSON.stringify({ type: "subscribe", id: subscription, channel: `/live/match/${id}`, authorization }));
    else if (data.type === "data" && data.id === subscription) {
      try {
        onChange(JSON.parse(data.event));
      } catch {
        /* a change that is not JSON is ignored; the next full read repairs the state */
      }
    }
  };
  return () => {
    try {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "unsubscribe", id: subscription }));
      socket.close();
    } catch {
      /* already closed */
    }
  };
}
