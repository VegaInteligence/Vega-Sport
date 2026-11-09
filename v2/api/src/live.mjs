/**
 * GET /live/matches/{id} — the full live state of a match (doc "Live", état complet):
 * cached 2 s by CloudFront, the changes in between arriving by AppSync Events on
 * /live/match/{id}. It reads the live tables only (DynamoDB, infra/aws-v2/live.yaml),
 * never the database, so it runs in its own function outside the private network.
 *
 * `families` says, for score, events and stats, whether the site reads it from the live
 * feed or already from core (PitchAPI has it: core wins). A finished feed is a
 * provisional result until core has the score. Expired data is never served, even
 * before DynamoDB deletes it.
 */
import { errorResponse, reject, send } from "./http.mjs";

const MATCH = /^\/live\/matches\/(m_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const FAMILIES = ["score", "events", "stats"];
const STATS = ["possession_pct", "total_shots", "shots_on_target", "corners", "fouls", "yellow_cards", "red_cards", "offsides"];
const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export function liveBody(state, events, stats) {
  const core = new Set(state.core_families || []);
  return {
    match: state.match,
    provider: state.provider,
    status: state.status,
    provisional: state.status === "finished" && !core.has("score"),
    minute: state.minute ?? null,
    minuteAdded: state.minute_added ?? null,
    period: state.period ?? null,
    score: { home: state.score_home ?? null, away: state.score_away ?? null },
    kickoffAt: state.kickoff_at,
    homeTeam: state.home_team ?? null,
    awayTeam: state.away_team ?? null,
    finishedAt: state.finished_at ?? null,
    updatedAt: state.updated_at ?? null,
    families: Object.fromEntries(FAMILIES.map((f) => [f, core.has(f) ? "core" : "live"])),
    events: events.map((e) => ({
      seq: e.seq, kind: e.kind, minute: e.minute ?? null, minuteAdded: e.minute_added ?? null, period: e.period ?? null,
      side: e.side ?? null, player: e.player ?? null, playerName: e.player_name ?? null,
      score: e.score_home == null ? null : { home: e.score_home, away: e.score_away },
    })),
    stats: stats.map((s) => ({
      side: s.side, period: s.period,
      ...Object.fromEntries(STATS.filter((k) => s[k] != null).map((k) => [camel(k), s[k]])),
    })),
    expiresAt: new Date(state.expires_at * 1000).toISOString(),
  };
}

/** read: { state(id), events(id), stats(id) } over the live tables; clock in ms. */
export function createLiveHandler(read, { clock = () => Date.now() } = {}) {
  return async (req) => {
    try {
      const url = new URL(req.url);
      const found = url.pathname.match(MATCH);
      if (!found) reject(404, "Ressource introuvable.");
      if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
      if (url.search) reject(400, "Paramètre invalide.");
      const now = clock() / 1000;
      const state = await read.state(found[1]);
      if (!state || !(state.expires_at > now)) reject(404, "Pas de direct pour ce match.");
      const [events, stats] = await Promise.all([read.events(found[1]), read.stats(found[1])]);
      const live = (item) => item.expires_at > now;
      return send(req, liveBody(state, events.filter(live).sort((a, b) => a.seq - b.seq), stats.filter(live)), 200, { ttl: 2 });
    } catch (error) {
      return errorResponse(req, error);
    }
  };
}
