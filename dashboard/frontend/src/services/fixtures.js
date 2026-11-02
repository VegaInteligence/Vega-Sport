import { normalizeText } from "../model.js";

export const FIXTURE_TIME_ZONE = "Europe/Paris";
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FIXTURE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const kickoffFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FIXTURE_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
export function parisDay(value) {
  const parts = Object.fromEntries(
    dayFormatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}
export function shiftDay(day, count) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
export function fixtureWeek(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const start = shiftDay(day, -((weekday + 6) % 7));
  return { start, end: shiftDay(start, 6) };
}
const dayLabelFormats = new Map();
export function dayLabel(day, options = {}) {
  const key = JSON.stringify(options);
  let format = dayLabelFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      ...options,
    });
    dayLabelFormats.set(key, format);
  }
  return format.format(new Date(`${day}T12:00:00Z`));
}
// Kickoff and Paris day depend only on the fixture: parsed once, not on every
// clock tick, week change or search.
const fixtureTimes = new WeakMap();
function fixtureTime(fixture) {
  let time = fixtureTimes.get(fixture);
  if (!time) {
    // A timestamp without an offset is ambiguous; retain only its known date.
    const parsed =
      typeof fixture.time_utc === "string" &&
      validDay(fixture.time_utc.slice(0, 10)) &&
      /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(fixture.time_utc)
        ? Date.parse(fixture.time_utc)
        : NaN;
    const kickoff = Number.isFinite(parsed) ? parsed : null;
    const day = kickoff === null ? fixture.date : parisDay(kickoff);
    time = { kickoff, day };
    fixtureTimes.set(fixture, time);
  }
  return time;
}
const fixtureTexts = new WeakMap();
function fixtureText(fixture) {
  let text = fixtureTexts.get(fixture);
  if (text === undefined) {
    text = normalizeText(
      [fixture.home_team?.name, fixture.away_team?.name, fixture.league?.name]
        .filter(Boolean)
        .join(" "),
    );
    fixtureTexts.set(fixture, text);
  }
  return text;
}
export function upcomingFixtures(fixtures, { week, now, league, query }) {
  const today = parisDay(now),
    search = normalizeText(query || ""),
    seen = new Set();
  const result = [];
  for (const fixture of fixtures) {
    if (!fixture.id || fixture.status !== "not_started" || seen.has(fixture.id))
      continue;
    if (league && league !== "all" && fixture.league?.id !== league) continue;
    if (search && !fixtureText(fixture).includes(search)) continue;
    const { kickoff, day } = fixtureTime(fixture);
    if (!validDay(day) || day < today || day < week.start || day > week.end)
      continue;
    if (kickoff !== null && kickoff <= now) continue;
    seen.add(fixture.id);
    result.push({ fixture, day, kickoff });
  }
  return result.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity) ||
      a.fixture.id.localeCompare(b.fixture.id),
  );
}
