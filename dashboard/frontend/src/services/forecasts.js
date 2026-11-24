/**
 * Match forecasts and season projections (/api/forecasts/…): what the model built on the
 * clubs' strengths gives for a match still to play, and a league replayed to its end.
 */
import { useResource, json } from "./resources.js";
import { timeline } from "../../../shared/inplay.js";

const none = (error) =>
  /\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error);

/** A league's projection, or null without one (a season over, a cup, a league too small). */
export function useSeasonProjection(competitionId, season) {
  const enabled = Boolean(competitionId && /^\d{4}\/\d{4}$/.test(season || ""));
  const resource = useResource(
    `season-projection:${competitionId || "none"}:${season || "none"}`,
    () =>
      json("/api/forecasts/season?" + new URLSearchParams({ competition: competitionId, season })).catch(none),
    enabled,
  );
  return enabled && !resource.error ? (resource.value ?? null) : null;
}

/** A match's forecast, or null without one (a match played, a team without a strength). */
export function useMatchForecast(matchId, enabled = true) {
  const on = Boolean(enabled && /^m_/.test(matchId || ""));
  const resource = useResource(
    `match-forecast:${matchId || "none"}`,
    () => json("/api/forecasts/match?" + new URLSearchParams({ match: matchId })).catch(none),
    on,
  );
  return on && !resource.error ? (resource.value ?? null) : null;
}

/** A share as the site writes it: "—" for none, "< 1 %" below one, else a whole percentage. */
export function share(value) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 0.005) return "< 1 %";
  if (value > 0.995 && value < 1) return "> 99 %";
  return `${Math.round(value * 100)} %`;
}

// A side's deviation (the sum of its outfield starters' rates less its club's usual one) below
// which its eleven reads as its usual one, and from which it reads as clearly apart.
const ELEVEN_NEAR = 0.15, ELEVEN_FAR = 0.6;

/** How a side's confirmed eleven compares with its usual one. */
export function elevenWord(deviation) {
  const size = Math.abs(deviation);
  if (!(size >= ELEVEN_NEAR)) return "proche de son onze habituel";
  return `${size >= ELEVEN_FAR ? "nettement " : ""}${deviation > 0 ? "plus fort" : "moins fort"} que son onze habituel`;
}

/**
 * What a match's card shows: the forecast that read the two confirmed line-ups when the
 * answer carries one (with what each eleven is against its club's usual one, and the
 * forecast before the line-ups), else the forecast from the two strengths alone.
 */
export function matchForecastReading(answer, home, away) {
  if (!answer?.forecast) return null;
  const read = answer.lineups?.forecast;
  // A match about to be played also reads each club's last ten matches (their chances, and what the results owe to something else).
  const recent = answer.form ? " et leurs dix derniers matchs (xG)" : "";
  if (!read || !answer.lineups.home || !answer.lineups.away)
    return { forecast: answer.forecast, lineups: false,
      basis: `D’après la force des deux équipes avant le match${recent} ; le modèle ne connaît ni les compositions ni les absents.` };
  const before = answer.forecast;
  // A share and its sign are not split between two lines of the sentence.
  const whole = (value) => share(value).replace(/ /g, "\u00a0");
  return {
    forecast: read, lineups: true,
    basis: `D’après la force des deux équipes${answer.form ? ", leurs dix derniers matchs (xG)" : ""} et leurs compositions confirmées : le onze de ${home} est ${elevenWord(answer.lineups.home.deviation)}, celui de ${away} ${elevenWord(answer.lineups.away.deviation)}.`,
    before: `Sans les compositions : ${home} ${whole(before.home)} · nul ${whole(before.draw)} · ${away} ${whole(before.away)}.`,
  };
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The table's rows, by projected points: the title, the first four places, the last three,
 * and the club's coming league matches when the answer carries them. */
export function projectionRows(projection) {
  const teams = projection?.teams || [];
  return teams.map((team) => {
    const places = team.places || [];
    return {
      id: team.id,
      name: team.name,
      imageUrl: team.imageUrl,
      played: team.played,
      points: team.points,
      projectedPoints: team.projectedPoints,
      title: places[0] ?? 0,
      topFour: sum(places.slice(0, 4)),
      bottomThree: places.length > 7 ? sum(places.slice(-3)) : null,
      next: team.next?.matches > 0 ? team.next : null,
      stages: projection.format === "league-phase" ? cupStages(team.stages) : null,
    };
  });
}

// A domestic knockout cup's rounds (124), from the round of 64 to the winner, and how the site names them.
const KNOCKOUT_ROUNDS = [["r64", "32es"], ["r32", "16es"], ["r16", "8es"], ["qf", "Quarts"], ["sf", "Demies"], ["final", "Finale"], ["win", "Vainqueur"]];

/**
 * A domestic cup's projection (format "knockout"): its rows, the likeliest winner first, each with its
 * Elo and its opponent of the round in play; `current`, that round (every club still in it reaches it);
 * `rounds`, the later ones, one column each.
 */
export function knockoutRows(projection) {
  const teams = projection?.teams || [];
  if (!teams.length) return { rows: [], current: null, rounds: [] };
  const present = KNOCKOUT_ROUNDS.filter(([key]) => teams.some((t) => Number(t.stages?.[key]) > 0));
  const [current, ...later] = present.map(([key, label]) => ({ key, label }));
  const rows = teams
    .map((t) => ({ id: t.id, name: t.name, imageUrl: t.imageUrl ?? null, elo: t.elo ?? null, opponent: t.opponent ?? null,
      stages: Object.fromEntries(KNOCKOUT_ROUNDS.map(([key]) => [key, Number(t.stages?.[key]) || 0])) }))
    .sort((a, b) => b.stages.win - a.stages.win || b.stages.final - a.stages.final || String(a.name).localeCompare(String(b.name)));
  return { rows, current: current ?? null, rounds: later };
}

// A UEFA cup's stages (122): the league phase's three outcomes, then each knockout round reached.
export const CUP_STAGES = ["top8", "playoff", "out", "r16", "qf", "sf", "final", "win"];
const cupStages = (stages) => Object.fromEntries(CUP_STAGES.map((stage) => [stage, Number(stages?.[stage]) || 0]));

// The live feed's goals (any kind: each counts for the side whose score it raises) and dismissals.
const LIVE_GOALS = new Set(["goal", "own_goal", "penalty_goal"]);
// The feed's periods after the 90 minutes: a match that has one went to extra time.
const LIVE_EXTRA = new Set(["extra_time", "penalties"]);

/**
 * The match minute by minute from the live feed, while the base has not read it yet: the
 * API's kick-off point and model (`answer.inplay`, `answer.rho`, `answer.rates`) carried on
 * with the feed's goals and red cards, by the same calculation (shared/inplay.js). The
 * answer as it is when the base already has the match's events, when the feed has not
 * started, or when its goal events do not give its score (no chart is better than a wrong
 * one). A match the feed says went to extra time (its period, or an event's) runs past the
 * 90th, to the 120th (`extraTime`); a shoot-out's kicks are not its goals: they are counted
 * apart (`penalties`: the kicks scored), the match ending level. `live`: the state of
 * /live/matches/{id} (hooks/useLiveMatch.js); `match`: the match, for its two teams' ids.
 */
export function withLive(answer, live, match) {
  if (!answer || !live || !answer.inplay || !answer.rates) return answer;
  if (live.families?.events === "core" || !["in_play", "half_time", "finished"].includes(live.status)) return answer;
  const side = (teamId) => (teamId === match?.home?.id ? "home" : teamId === match?.away?.id ? "away" : null);
  const all = live.events || [];
  const kicks = all.filter((e) => e.period === "penalties" && !e.cancelled);
  const events = all
    .filter((e) => e.period !== "penalties" && !e.cancelled && e.minute != null && (LIVE_GOALS.has(e.type) || e.type === "red_card"))
    .map((e) => ({ minute: e.minute, added: e.minuteAdded || 0, kind: e.type === "red_card" ? "red" : "goal", side: side(e.teamId) }));
  if (events.some((e) => !e.side)) return answer;
  const goals = (name) => events.filter((e) => e.kind === "goal" && e.side === name).length;
  if (goals("home") !== live.score?.home || goals("away") !== live.score?.away) return answer;
  const finished = live.status === "finished";
  const shootout = live.period === "penalties" || kicks.length > 0;
  const extra = shootout || LIVE_EXTRA.has(live.period) || all.some((e) => LIVE_EXTRA.has(e.period));
  const top = extra ? 120 : 90;
  // The break of extra time is at the 105th; a shoot-out comes after the 120th.
  const clock = shootout
    ? 120
    : live.status === "half_time"
      ? extra ? Math.max(90, Math.min(105, live.minute ?? 105)) : 45
      : Math.max(live.minute ?? 0, ...events.map((e) => e.minute));
  const last = finished ? top : Math.max(extra ? 90 : 0, Math.min(top, Math.floor(clock)));
  const points = timeline(answer.rates.home, answer.rates.away, events, answer.inplay, answer.rho ?? 0, last, extra);
  if (finished) {
    const end = points.at(-1), [h, a] = end.score;
    Object.assign(end, { home: h > a ? 1 : 0, draw: h === a ? 1 : 0, away: h < a ? 1 : 0 });
  }
  const scored = (name) => kicks.filter((e) => e.type === "penalty_goal" && side(e.teamId) === name).length;
  return {
    ...answer, status: finished ? "finished" : "in_play", points, events, live: true,
    ...(extra ? { extraTime: true, penalties: kicks.length ? [scored("home"), scored("away")] : null } : {}),
  };
}

/** A finished or running match minute by minute, or null without one (a match to play, no goal timeline). */
export function useMatchWinProbability(matchId, enabled = true) {
  const on = Boolean(enabled && /^m_/.test(matchId || ""));
  const resource = useResource(
    `match-win-probability:${matchId || "none"}`,
    () => json("/api/forecasts/live?" + new URLSearchParams({ match: matchId })).catch(none),
    on,
  );
  return on && !resource.error ? (resource.value ?? null) : null;
}

/**
 * A match's probabilities as three lines over the minutes: `lines` with each goal a jump (the
 * minute before stands until the goal), `series` the real minutes the pointer stops at, each goal
 * with the score it made and the scoring side's chances the minute before and at the goal.
 * Null without at least two points.
 */
export function probabilityLines(answer) {
  const points = answer?.points || [];
  if (points.length < 2) return null;
  const byMinute = new Map(points.map((p) => [p.minute, p]));
  const score = [0, 0];
  const goals = (answer.events || [])
    .filter((event) => event.kind === "goal")
    .map((event) => {
      score[event.side === "home" ? 0 : 1]++;
      const before = byMinute.get(event.minute - 1), after = byMinute.get(event.minute);
      return {
        minute: event.minute,
        side: event.side,
        label: `${score[0]}–${score[1]}`,
        from: before && after ? before[event.side] : null,
        to: before && after ? after[event.side] : null,
      };
    });
  const jumps = new Set(goals.filter((goal) => goal.from != null).map((goal) => goal.minute));
  const pick = (p) => ({ minute: p.minute, home: p.home, draw: p.draw, away: p.away, score: p.score ?? null });
  // A match that went to extra time (the API's answer or the live feed's): after the 90th the middle line
  // is no longer a draw but a level 120th minute, so the lines step at the 90th as they do at a goal.
  const extra = answer.extraTime === true;
  const lines = [];
  points.forEach((p, i) => {
    if (i && jumps.has(p.minute) && !(extra && p.minute === 91)) lines.push({ ...pick(points[i - 1]), minute: p.minute });
    lines.push(pick(p));
    if (extra && p.minute === 90 && points[i + 1]) lines.push({ ...pick(points[i + 1]), minute: 90 });
  });
  return {
    lines,
    series: points.map(pick),
    goals,
    reds: (answer.events || []).filter((event) => event.kind === "red").map((event) => ({ minute: event.minute, side: event.side })),
    span: extra ? 120 : Math.max(90, points.at(-1).minute),
    extra,
    // The shoot-out's score, [home, away], or null without one.
    penalties: extra ? (answer.penalties ?? null) : null,
    start: points[0],
    end: points.at(-1),
    live: answer.status === "in_play" ? points.at(-1) : null,
    // The kick-off's shares come from the forecast that read the two confirmed line-ups.
    lineups: answer.lineups === true,
  };
}

/** A coming match's bookmakers' odds and Vega's fair odds (/api/forecasts/odds), or null without any. */
export function useMatchOdds(matchId, enabled = true) {
  const on = Boolean(enabled && /^m_/.test(matchId || ""));
  const resource = useResource(
    `match-odds:${matchId || "none"}`,
    () => json("/api/forecasts/odds?" + new URLSearchParams({ match: matchId })).catch(none),
    on,
  );
  return on && !resource.error ? (resource.value ?? null) : null;
}

/** Odds as the site writes them: two decimals with a comma; "—" for none. */
export const oddsText = (value) => (Number.isFinite(value) ? value.toFixed(2).replace(".", ",") : "—");
