import { validDay } from "./fixtures.js";

export function defaultCompetitionMatchStatus(day) {
  return day ? "all" : "finished";
}

function matchStatus(match) {
  if (match.status) return match.status;
  if (match.finished === true) return "finished";
  if (match.finished === false) return "not_started";
  return "unknown";
}

function matchDate(match) {
  const timestamp = match.time_utc || match.timeUtc;
  const day = validDay(match.date)
    ? match.date
    : typeof timestamp === "string" && validDay(timestamp.slice(0, 10))
      ? timestamp.slice(0, 10)
      : null;
  const parsed =
    typeof timestamp === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)
      ? Date.parse(timestamp)
      : NaN;
  return { day, time: Number.isFinite(parsed) ? parsed : null };
}

/** Results newest first; upcoming matches in the order they will be played. */
export function orderCompetitionMatches(
  matches,
  { status = "all", day = false } = {},
) {
  const items = (matches || [])
    .filter((match) => status === "all" || matchStatus(match) === status)
    .map((match, index) => ({
      match,
      index,
      status: matchStatus(match),
      ...matchDate(match),
    }));
  const group = (item) =>
    day || status !== "all"
      ? 0
      : item.status === "finished"
        ? 0
        : item.status === "not_started"
          ? 1
          : 2;
  items.sort((a, b) => {
    const aGroup = group(a),
      bGroup = group(b);
    if (aGroup !== bGroup) return aGroup - bGroup;
    if (!a.day || !b.day) return a.day ? -1 : b.day ? 1 : a.index - b.index;
    const direction =
      day || status === "not_started" || (status === "all" && aGroup === 1)
        ? 1
        : -1;
    const dayOrder = a.day.localeCompare(b.day);
    if (dayOrder) return direction * dayOrder;
    if (a.time === null || b.time === null)
      return a.time !== null ? -1 : b.time !== null ? 1 : a.index - b.index;
    return direction * (a.time - b.time) || a.index - b.index;
  });
  return items.map(({ match }) => match);
}
