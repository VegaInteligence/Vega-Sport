/**
 * Live matches (doc "Live"): the full state from GET /live/matches/{id}
 * (the API's distribution, cached 2 s), then each revision as AppSync Events publishes it on
 * /live/match/{id}: one message per revision, applied in order, the full state read again
 * when one is missing. The browser never talks to the live provider: one feed per match,
 * on the server. Built with the three NEXT_PUBLIC_LIVE_EVENTS_* settings (outputs of
 * infra/aws/live.yaml); without them nothing here runs.
 */

export const LIVE = {
  origin: process.env.NEXT_PUBLIC_API_ORIGIN || "",
  http: process.env.NEXT_PUBLIC_LIVE_EVENTS_HTTP || "",
  realtime: process.env.NEXT_PUBLIC_LIVE_EVENTS_REALTIME || "",
  key: process.env.NEXT_PUBLIC_LIVE_EVENTS_KEY || "",
};
export const liveConfigured = (config = LIVE) =>
  Boolean(config.http && config.realtime && config.key);

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
const STATS = ["possession_pct", "total_shots", "shots_on_target", "corners", "fouls"];

const liveEvent = (e) => ({
  seq: e.seq, revision: e.revision, type: e.event_type, minute: e.minute ?? null, minuteAdded: e.minute_added ?? null,
  period: e.period ?? null, teamId: e.team_id ?? null, player: e.player_id ?? null, relatedPlayer: e.related_player_id ?? null,
  playerName: e.player_name ?? null, cancelled: Boolean(e.is_cancelled),
});
const liveStats = (s) => ({
  teamId: s.team_id, revision: s.revision,
  ...Object.fromEntries(STATS.filter((k) => s[k] != null).map((k) => [camel(k), s[k]])),
});

/** True when a broadcast skips a revision: the full state must be read again (doc "Écriture
 * réussie, diffusion ratée"). */
export function missing(state, message) {
  return Boolean(state && message && message.match === state.match && (message.revision ?? 0) > (state.revision ?? 0) + 1);
}

/** The next revision applied to the full state (what GET /live/matches/{id} returns). A
 * revision already applied, another match's or one after a gap leaves the state as it is.
 * A corrected event (goal cancelled by VAR) replaces the event of the same seq. */
export function applyLive(state, message) {
  if (!state || !message || message.match !== state.match) return state;
  if ((message.revision ?? 0) !== (state.revision ?? 0) + 1) return state;
  let next = { ...state, revision: message.revision };
  if (message.state) {
    const s = message.state;
    next = {
      ...next, status: s.status, minute: s.minute ?? null, minuteAdded: s.minute_added ?? null, period: s.period ?? null,
      score: { home: s.home_score ?? null, away: s.away_score ?? null }, finishedAt: s.finished_at ?? next.finishedAt ?? null,
    };
  }
  if (message.events?.length) {
    const bySeq = new Map((next.events || []).map((e) => [e.seq, e]));
    for (const e of message.events) bySeq.set(e.seq, liveEvent(e));
    next.events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  }
  if (message.stats?.length) {
    const byTeam = new Map((next.stats || []).map((s) => [s.teamId, s]));
    for (const s of message.stats) byTeam.set(s.team_id, liveStats(s));
    next.stats = [...byTeam.values()];
  }
  if (message.families) {
    const core = new Set(message.families);
    next.families = Object.fromEntries(FAMILIES.map((f) => [f, core.has(f) ? "core" : "live"]));
  }
  next.provisional = next.status === "finished" && next.families?.score !== "core";
  return next;
}

/** A full read never replaces a newer state (CloudFront may serve one up to 2 s old). */
export const newer = (current, body) => !current || !body || (body.revision ?? 0) >= (current.revision ?? 0);

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
    // AppSync channel segments take letters, digits and dashes only: m_2fkSwK -> m-2fkSwK.
    if (data.type === "connection_ack")
      socket.send(JSON.stringify({ type: "subscribe", id: subscription, channel: `/live/match/${id.replace(/_/g, "-")}`, authorization }));
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
