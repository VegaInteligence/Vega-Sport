/**
 * GET /live/matches/{id} — the full live state of a match (doc "Live", état complet):
 * cached 2 s by CloudFront, the revisions in between arriving by AppSync Events on
 * /live/match/{id}. It reads the live tables only (DynamoDB, infra/aws-v2/live.yaml),
 * never the database, so it runs in its own function outside the private network.
 *
 * Read at one revision, never assembled from pieces of two: the ingestor writes a
 * revision's events and statistics before its state, so a snapshot is consistent when no
 * item is newer than the state; otherwise it is read again.
 *
 * `families` says, for score, events and stats, whether the site reads it from the live
 * feed or already from core (PitchAPI has it: core wins). A finished feed is a
 * provisional result until core has the score. Expired data is never served, even
 * before DynamoDB deletes it.
 */
import { errorResponse, reject, send } from "./http.mjs";

const MATCH = /^\/live\/matches\/(m_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const FAMILIES = ["score", "events", "stats"];
const STATS = ["possession_pct", "total_shots", "shots_on_target", "corners", "fouls"];
const ATTEMPTS = 3;
const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export function liveBody(state, events, stats) {
  const core = new Set(state.core_families || []);
  return {
    match: state.match,
    revision: state.revision ?? 0,
    provider: state.provider,
    status: state.status,
    provisional: state.status === "finished" && !core.has("score"),
    minute: state.minute ?? null,
    minuteAdded: state.minute_added ?? null,
    period: state.period ?? null,
    score: { home: state.home_score ?? null, away: state.away_score ?? null },
    kickoffAt: state.kickoff_at,
    homeTeam: state.home_team ?? null,
    awayTeam: state.away_team ?? null,
    finishedAt: state.finished_at ?? null,
    updatedAt: state.updated_at ?? null,
    families: Object.fromEntries(FAMILIES.map((f) => [f, core.has(f) ? "core" : "live"])),
    events: events.map((e) => ({
      seq: e.seq, revision: e.revision, type: e.event_type, minute: e.minute ?? null, minuteAdded: e.minute_added ?? null,
      period: e.period ?? null, teamId: e.team_id ?? null, player: e.player_id ?? null, relatedPlayer: e.related_player_id ?? null,
      playerName: e.player_name ?? null, cancelled: Boolean(e.is_cancelled),
    })),
    stats: stats.map((s) => ({
      teamId: s.team_id, revision: s.revision,
      ...Object.fromEntries(STATS.filter((k) => s[k] != null).map((k) => [camel(k), s[k]])),
    })),
    expiresAt: new Date(state.expires_at * 1000).toISOString(),
  };
}

/** One consistent snapshot: every event and statistic at or below the state's revision. */
export async function snapshot(read, id, now) {
  const live = (item) => item.expires_at > now;
  for (let attempt = 1; ; attempt++) {
    const state = await read.state(id);
    if (!state || !live(state)) return null;
    const revision = state.revision ?? 0;
    const [events, stats] = await Promise.all([read.events(id), read.stats(id)]);
    const newer = [...events, ...stats].some((item) => (item.revision ?? 0) > revision);
    if (!newer || attempt === ATTEMPTS) {
      // Still newer after three reads (a burst of revisions): the state's own revision wins.
      const at = (item) => live(item) && (item.revision ?? 0) <= revision;
      return { state, events: events.filter(at).sort((a, b) => a.seq - b.seq), stats: stats.filter(at) };
    }
  }
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
      const snap = await snapshot(read, found[1], clock() / 1000);
      if (!snap) reject(404, "Pas de direct pour ce match.");
      return send(req, liveBody(snap.state, snap.events, snap.stats), 200, { ttl: 2 });
    } catch (error) {
      return errorResponse(req, error);
    }
  };
}
