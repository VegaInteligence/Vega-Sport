/**
 * The live view of a match (components/MatchLive.jsx): what the feed's state
 * (GET /live/matches/{id}, hooks/useLiveMatch.js) says, put in the order and the words the
 * page shows. Pure: the state in, rows out.
 */

export const LIVE_PERIODS = {
  first_half: "1re mi-temps",
  second_half: "2e mi-temps",
  extra_time: "Prolongation",
  penalties: "Tirs au but",
};
const GOALS = new Set(["goal", "own_goal", "penalty_goal"]);
const EVENT_LABELS = {
  goal: "But",
  own_goal: "But contre son camp",
  penalty_goal: "But sur penalty",
  missed_penalty: "Penalty manqué",
  yellow_card: "Carton jaune",
  red_card: "Carton rouge",
  substitution: "Remplacement",
  var: "Décision vidéo",
};

export const liveMinute = (minute, added) => (minute == null ? "—" : `${minute}${added ? `+${added}` : ""}’`);

/** The feed runs the page: it has a state, the match has started, and the base has not taken the score over. */
export const liveRunning = (live) => Boolean(live && live.status !== "scheduled" && live.families?.score !== "core");

/** The words of the state: { label, clock, tone } with tone "live" (in play), "pause" or "over". */
export function liveStatus(live) {
  if (!liveRunning(live)) return null;
  if (live.status === "finished") return { label: "Résultat provisoire", clock: "Terminé", tone: "over" };
  if (live.status === "abandoned") return { label: "Match arrêté", clock: "Arrêté", tone: "over" };
  if (live.status === "half_time") return { label: "Mi-temps", clock: "Mi-temps", tone: "pause" };
  if (live.period === "penalties") return { label: "En direct · Tirs au but", clock: "Tirs au but", tone: "live" };
  const clock = live.minute != null ? liveMinute(live.minute, live.minuteAdded) : "En direct";
  return { label: live.minute != null ? `En direct · ${clock}` : "En direct", clock, tone: "live", period: LIVE_PERIODS[live.period] || null };
}

const sideOf = (teamId, match) => (teamId === match?.home?.id ? "home" : teamId === match?.away?.id ? "away" : null);
const order = (a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.minuteAdded ?? 0) - (b.minuteAdded ?? 0) || a.seq - b.seq;
// A first-half event: the feed says so, or it gives no period and the minute is one of the first 45.
const inFirstHalf = (e) => (e.period ? e.period === "first_half" : (e.minute ?? 0) <= 45);

/**
 * The feed's events, oldest first, each with its side, its words and, for a goal that stands,
 * the score it made. `names`: Map of player id → name (the line-ups), for the players the
 * feed only names by id (the passer of a goal, the player a substitute replaces).
 * Shoot-out kicks are left to liveShootout.
 */
export function liveEvents(live, match, names = new Map()) {
  const score = { home: 0, away: 0 };
  return (live?.events || [])
    .filter((e) => EVENT_LABELS[e.type] && e.period !== "penalties")
    .sort(order)
    .map((e) => {
      const side = sideOf(e.teamId, match);
      const goal = GOALS.has(e.type);
      if (goal && !e.cancelled && side) score[side]++;
      const other = e.relatedPlayer ? names.get(e.relatedPlayer) || null : null;
      const name = e.playerName || (e.player ? names.get(e.player) : null) || null;
      return {
        seq: e.seq,
        type: e.type,
        side,
        minute: liveMinute(e.minute, e.minuteAdded),
        firstHalf: inFirstHalf(e),
        period: e.period || null,
        label: EVENT_LABELS[e.type],
        name,
        player: e.player || null,
        detail: e.cancelled
          ? "Annulé (VAR)"
          : e.type === "substitution"
            ? other && `à la place de ${other}`
            : e.type === "goal"
              ? other && `Passe de ${other}`
              : e.type === "penalty_goal"
                ? "Penalty"
                : e.type === "own_goal"
                  ? "Contre son camp"
                  : null,
        cancelled: Boolean(e.cancelled),
        goal,
        score: goal && !e.cancelled ? `${score.home}–${score.away}` : null,
      };
    });
}

/**
 * The page's feed, newest first: the events with the match's moments between them (kick-off,
 * half-time with its score, extra time, the end). A moment is a row { marker, label, score }.
 */
export function liveFeed(live, match, names) {
  if (!liveRunning(live)) return [];
  const events = liveEvents(live, match, names);
  const rows = [{ marker: "kickoff", label: "Coup d’envoi" }];
  const tally = (list) => {
    const last = list.filter((e) => e.score).at(-1);
    return last ? last.score : "0–0";
  };
  const first = events.filter((e) => e.firstHalf);
  const extra = events.filter((e) => e.period === "extra_time");
  const regular = events.filter((e) => !e.firstHalf && e.period !== "extra_time");
  const pastFirstHalf =
    live.status === "half_time" || live.status === "finished" || regular.length > 0 || extra.length > 0 ||
    ["second_half", "extra_time", "penalties"].includes(live.period) || (live.period == null && (live.minute ?? 0) > 45);
  const inExtra = extra.length > 0 || ["extra_time", "penalties"].includes(live.period);
  rows.push(...first);
  if (pastFirstHalf) rows.push({ marker: "half_time", label: "Mi-temps", score: tally(first) });
  rows.push(...regular);
  if (inExtra) rows.push({ marker: "extra_time", label: "Prolongation", score: tally([...first, ...regular]) });
  rows.push(...extra);
  if (live.period === "penalties" || (live.events || []).some((e) => e.period === "penalties"))
    rows.push({ marker: "penalties", label: "Tirs au but", score: tally(events) });
  if (live.status === "finished") rows.push({ marker: "full_time", label: "Fin du match", score: `${live.score?.home ?? 0}–${live.score?.away ?? 0}` });
  if (live.status === "abandoned") rows.push({ marker: "abandoned", label: "Match arrêté" });
  return rows.reverse();
}

/** The goals and dismissals of each side, for the scoreboard: { home: [...], away: [...] }, oldest first. */
export function liveScorers(live, match, names) {
  const out = { home: [], away: [] };
  if (!liveRunning(live)) return out;
  for (const e of liveEvents(live, match, names))
    if (e.side && !e.cancelled && (e.goal || e.type === "red_card"))
      out[e.side].push({ seq: e.seq, name: e.name || e.label, minute: e.minute, red: e.type === "red_card", note: e.type === "penalty_goal" ? "pen." : e.type === "own_goal" ? "csc" : null });
  return out;
}

/** The shoot-out, kick by kick: { home: [{seq, name, scored}], away: [...], score: "4–3" }, or null without one. */
export function liveShootout(live, match, names = new Map()) {
  const kicks = (live?.events || []).filter((e) => e.period === "penalties" && ["penalty_goal", "missed_penalty"].includes(e.type) && !e.cancelled).sort((a, b) => a.seq - b.seq);
  if (!kicks.length) return null;
  const out = { home: [], away: [] };
  for (const e of kicks) {
    const side = sideOf(e.teamId, match);
    if (side) out[side].push({ seq: e.seq, name: e.playerName || names.get(e.player) || null, scored: e.type === "penalty_goal" });
  }
  const made = (list) => list.filter((k) => k.scored).length;
  return { ...out, score: `${made(out.home)}–${made(out.away)}` };
}

const STATS = [
  ["BallPossesion", "possessionPct", "Possession"],
  ["totalShots", "totalShots", "Tirs"],
  ["shotsOnTarget", "shotsOnTarget", "Tirs cadrés"],
  ["corners", "corners", "Corners"],
  ["fouls", "fouls", "Fautes", true],
];
/** The feed's team statistics as comparison rows (components/StatRows.jsx), or null until both sides have some. */
export function liveStatRows(live, match) {
  if (!live || live.families?.stats === "core") return null;
  const home = (live.stats || []).find((s) => s.teamId === match?.home?.id);
  const away = (live.stats || []).find((s) => s.teamId === match?.away?.id);
  if (!home || !away) return null;
  const rows = STATS.filter(([, key]) => home[key] != null && away[key] != null).map(([key, field, label, lowerIsBetter]) => ({
    key, label, home: home[field], away: away[field], ...(lowerIsBetter ? { lowerIsBetter: true } : {}),
  }));
  return rows.length ? rows : null;
}
