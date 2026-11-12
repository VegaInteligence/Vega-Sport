/**
 * Match forecasts and season projections (/api/forecasts/…): what the model built on the
 * clubs' strengths gives for a match still to play, and a league replayed to its end.
 */
import { useResource, json } from "./resources.js";

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
    };
  });
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

const CHART = { width: 720, height: 240, left: 30, right: 700, top: 24, bottom: 200 };

/**
 * The drawing of a match's probabilities: three stacked areas (home at the bottom, the
 * draw, away at the top) over the minutes, a marker at each goal with the score it made,
 * and the three shares at kick-off. Null without at least two points.
 */
export function probabilityChart(answer, frame = CHART) {
  const points = answer?.points || [];
  if (points.length < 2) return null;
  const span = Math.max(90, points.at(-1).minute);
  const x = (minute) => frame.left + (Math.min(minute, span) / span) * (frame.right - frame.left);
  const y = (share) => frame.bottom - share * (frame.bottom - frame.top);
  const fixed = (value) => Math.round(value * 10) / 10;
  const area = (low, high) => {
    const up = points.map((p) => `${fixed(x(p.minute))},${fixed(y(high(p)))}`);
    const down = [...points].reverse().map((p) => `${fixed(x(p.minute))},${fixed(y(low(p)))}`);
    return `M${up.join("L")}L${down.join("L")}Z`;
  };
  const score = [0, 0];
  const goals = (answer.events || [])
    .filter((event) => event.kind === "goal")
    .map((event) => {
      score[event.side === "home" ? 0 : 1]++;
      return { x: fixed(x(event.minute)), side: event.side, minute: event.minute, label: `${score[0]}–${score[1]}` };
    });
  // Each goal with what it did to the scoring side's chances of winning, the minute before and at the goal.
  const at = (minute) => points[Math.max(0, Math.min(points.length - 1, minute))];
  const swings = goals.map((goal) => ({
    minute: goal.minute,
    label: goal.label,
    side: goal.side,
    from: at(goal.minute - 1)[goal.side],
    to: at(goal.minute)[goal.side],
  }));
  return {
    swings,
    paths: {
      home: area(() => 0, (p) => p.home),
      draw: area((p) => p.home, (p) => p.home + p.draw),
      away: area((p) => p.home + p.draw, () => 1),
    },
    goals,
    reds: (answer.events || []).filter((event) => event.kind === "red").map((event) => ({ x: fixed(x(event.minute)), side: event.side, minute: event.minute })),
    ticks: [0, 15, 30, 45, 60, 75, 90].map((minute) => ({ minute, x: fixed(x(minute)) })),
    start: points[0],
    live: answer.status === "in_play" ? points.at(-1) : null,
    frame,
  };
}
