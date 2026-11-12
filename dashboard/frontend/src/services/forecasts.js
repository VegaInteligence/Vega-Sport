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

/** The table's rows, by projected points: the title, the first four places, the last three. */
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
    };
  });
}
