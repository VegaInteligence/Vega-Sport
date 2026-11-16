/**
 * The club's squad (/api/teams/{id}/squad), the player's tracked physical figures
 * (/api/players/{id}/physical) and his style (/api/players/{id}/style): the blocks of the
 * pages that showed mock-up figures until 16 Nov 2026, and the rules that turn them into
 * sentences. Nothing here invents a label: a zone or a foot is named only when the numbers
 * clearly say so (docs/calculs/08-notes-vega).
 */
import { useResource, json } from "./resources.js";
import { number } from "./format.js";

const missing = (error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error));
const read = (path, season) =>
  json(`${path}?${new URLSearchParams({ season })}`).then((body) => body?.data ?? null).catch(missing);

export function useClubSquad(id, season, enabled = true) {
  return useResource(`club-squad:${id}:${season}`, () => read(`/api/teams/${encodeURIComponent(id)}/squad`, season), Boolean(enabled && id && season));
}

export function usePlayerPhysical(id, season, enabled = true) {
  return useResource(`player-physical:${id}:${season}`, () => read(`/api/players/${encodeURIComponent(id)}/physical`, season), Boolean(enabled && id && season));
}

export function usePlayerStyle(id, season, enabled = true) {
  return useResource(`player-style:${id}:${season}`, () => read(`/api/players/${encodeURIComponent(id)}/style`, season), Boolean(enabled && id && season));
}

/** « 1,30 Md€ », « 485 M€ », « 900 k€ ». */
export function euros(value) {
  if (value == null) return "—";
  if (value >= 1e9) return `${number(value / 1e9, 2)} Md€`;
  if (value >= 1e6) return `${number(value / 1e6, value >= 1e8 ? 0 : 1)} M€`;
  return `${number(value / 1e3, 0)} k€`;
}

const DAY_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const readDay = (iso) => (iso ? DAY_MONTH.format(new Date(`${iso}T00:00:00Z`)) : null);

// The age weighted by minutes is shown when the ages known cover 90 % of the minutes played,
// over five full matches at least (11 players × 90 minutes each).
export const AGE_COVERAGE = 0.9;
export const AGE_MINUTES = 5 * 11 * 90;

/** The squad's age weighted by its minutes (an age in whole years is half a year short on average). */
export function weightedAge(minutesByAge) {
  let total = 0, known = 0, years = 0;
  for (const { age, minutes } of minutesByAge || []) {
    total += minutes;
    if (age != null && age >= 0) {
      known += minutes;
      years += (age + 0.5) * minutes;
    }
  }
  if (total < AGE_MINUTES || known < AGE_COVERAGE * total) return null;
  return { age: years / known, coverage: known / total };
}

/* --------------------------------------------------------------- style */

// A zone is named when it holds at least 45 % of the actions and 10 points more than the next.
export const ZONE_SHARE = 45;
export const ZONE_LEAD = 10;
export const ZONE_MATCHES = 5;
export const SHOTS_MIN = 10;
export const FOOT_SHARE = 70;

const THIRDS = ["son tiers défensif", "le milieu de terrain", "le dernier tiers"];
// The thirds span 5, 6 and 5 of the map's 16 cells: each share is taken per cell before the
// rule, or the middle third would lead by its size alone.
const THIRD_CELLS = [5, 6, 5];
const SIDES = ["côté droit", "dans l’axe", "côté gauche"];

const shares = (values) => {
  const total = values.reduce((t, v) => t + v, 0);
  return total ? values.map((v) => (100 * v) / total) : values.map(() => null);
};
const dominant = (values) => {
  const ranked = values.map((share, index) => ({ share, index })).sort((a, b) => b.share - a.share);
  return ranked[0].share >= ZONE_SHARE && ranked[0].share - ranked[1].share >= ZONE_LEAD ? ranked[0].index : null;
};

/** Where he acts: shares by third and side, and the zone named when one clearly leads. */
export function zoneReading(zones) {
  if (!zones?.actions || zones.matches < ZONE_MATCHES) return null;
  const thirds = shares(zones.thirds), sides = shares(zones.sides);
  const third = dominant(shares(thirds.map((share, i) => share / THIRD_CELLS[i])));
  const side = dominant(sides);
  const where = [third == null ? null : THIRDS[third], side == null ? null : SIDES[side]].filter(Boolean);
  return {
    thirds, sides,
    title: where.length ? `Surtout ${where.join(", ")}` : "Présence répartie",
    text: `${number(thirds[2], 0)} % de ses actions dans le dernier tiers, ${number(sides[0], 0)} % côté droit, ${number(sides[2], 0)} % côté gauche`,
    matches: zones.matches,
  };
}

/** The foot he shoots with, penalties left out: named at 70 % of his foot shots. */
export function footReading(shots) {
  if (!shots || shots.shots < SHOTS_MIN) return null;
  const feet = shots.rightFoot + shots.leftFoot;
  const right = feet ? (100 * shots.rightFoot) / feet : null;
  const header = (100 * shots.header) / shots.shots;
  const title = right == null ? "Frappe surtout de la tête"
    : right >= FOOT_SHARE ? "Frappe surtout du pied droit"
      : 100 - right >= FOOT_SHARE ? "Frappe surtout du pied gauche"
        : "Frappe des deux pieds";
  const feetText = right == null ? null
    : right >= 50 ? `${number(right, 0)} % du droit, ${number(100 - right, 0)} % du gauche`
      : `${number(100 - right, 0)} % du gauche, ${number(right, 0)} % du droit`;
  const parts = [feetText && `Frappes du pied : ${feetText}`, `${number(header, 0)} % de ses tirs de la tête`].filter(Boolean);
  return { title, text: `${parts.join(" · ")} (${number(shots.shots)} tirs hors penalty)` };
}

/** Where he shoots from: the share of his shots inside the box, penalties left out. */
export function boxReading(shots) {
  if (!shots || shots.shots < SHOTS_MIN) return null;
  const inside = (100 * shots.insideBox) / shots.shots;
  return {
    title: inside >= 80 ? "Tire de près" : inside <= 50 ? "Tire souvent de loin" : "Tire de près comme de loin",
    text: `${number(inside, 0)} % de ses tirs dans la surface (${number(shots.insideBox)} sur ${number(shots.shots)})`,
  };
}

/** His share of his team's passes, placed among his role when they are enough. */
export function passReading(passes) {
  if (!passes) return null;
  return {
    share: passes.share,
    text: `Reçoit ${number(passes.share, 1)} % des passes de son équipe`,
    rank: passes.percentile == null ? null
      : passes.percentile >= 50 ? `plus que ${number(passes.percentile, 0)} % des ${passes.cohort.label} de ${passes.competition}`
        : `moins que ${number(100 - passes.percentile, 0)} % des ${passes.cohort.label} de ${passes.competition}`,
    note: `${number(passes.networks)} matchs, jusqu’au premier changement de chaque équipe`,
  };
}

/* ------------------------------------------------------------- physical */

export const PHYSICAL_ROWS = {
  distance: { label: "Distance parcourue", unit: "km / 90 min", scale: 1 / 1000, digits: 1 },
  running: { label: "Distance en course", unit: "m / 90 min", scale: 1, digits: 0 },
  sprinting: { label: "Distance en sprint", unit: "m / 90 min", scale: 1, digits: 0 },
  sprints: { label: "Sprints", unit: "/ 90 min", scale: 1, digits: 1 },
  topSpeed: { label: "Vitesse de pointe", unit: "km/h, médiane des matchs", scale: 1, digits: 1 },
};

/** A tracked figure in its unit: « 10,6 », « 1 881 ». */
export function physicalValue(key, value) {
  const row = PHYSICAL_ROWS[key];
  return value == null ? "—" : number(value * row.scale, row.digits);
}

/** The distance per 90 minutes split into sprint, running and the rest, in metres. */
export function speedZones(metrics) {
  const get = (key) => metrics.find((m) => m.key === key)?.value ?? null;
  const distance = get("distance"), running = get("running"), sprinting = get("sprinting");
  if (distance == null || running == null || sprinting == null) return null;
  const rest = Math.max(0, distance - running - sprinting);
  return [
    { label: "Sprint", value: sprinting },
    { label: "Course", value: running },
    { label: "Reste de la distance", value: rest },
  ];
}

/* ---------------------------------------------------------- match load */

// A short turnaround: the next match three days or fewer after the previous one (Saturday to
// Tuesday). The recent load: the minutes of the 28 days ending on his last match.
export const SHORT_REST_DAYS = 3;
export const LOAD_WINDOW_DAYS = 28;
const DAY_MS = 86400000;

const middle = (values) => {
  const sorted = [...values].sort((a, b) => a - b), m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/**
 * His match load over the season's rows (one per match played, with its date and minutes):
 * minutes, starts, full matches, rest between matches, short turnarounds and the last four
 * weeks. Every player has it: it needs no tracking.
 */
export function matchLoad(rows) {
  const seen = new Set();
  const games = (rows || [])
    .filter((row) => row.minutes > 0 && row.date && !seen.has(row.matchId) && seen.add(row.matchId))
    .map((row) => ({ row, day: Date.parse(`${String(row.date).slice(0, 10)}T00:00:00Z`) }))
    .filter((game) => Number.isFinite(game.day))
    .sort((a, b) => a.day - b.day);
  if (!games.length) return null;
  const rests = games.slice(1).map((game, i) => Math.round((game.day - games[i].day) / DAY_MS));
  const total = (list) => list.reduce((t, game) => t + game.row.minutes, 0);
  const known = games.filter((game) => typeof game.row.starter === "boolean");
  const last = games[games.length - 1].day;
  const recent = games.filter((game) => game.day > last - LOAD_WINDOW_DAYS * DAY_MS);
  const minutes = total(games);
  return {
    matches: games.length,
    minutes,
    perMatch: minutes / games.length,
    starts: known.length === games.length ? known.filter((game) => game.row.starter).length : null,
    full: games.filter((game) => game.row.minutes >= 90).length,
    restMedian: rests.length ? middle(rests) : null,
    shortRest: rests.filter((days) => days <= SHORT_REST_DAYS).length,
    recent: { matches: recent.length, minutes: total(recent), until: games[games.length - 1].row.date },
    games: games.map((game, i) => ({
      date: String(game.row.date).slice(0, 10),
      minutes: game.row.minutes,
      starter: game.row.starter ?? null,
      league: game.row.league || null,
      rest: i ? rests[i - 1] : null,
    })),
  };
}
