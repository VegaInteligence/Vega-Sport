import { isNumber, date } from "./format.js";
import { metricValue, positionOf } from "./player-profile.js";

/** Advanced filters of the players page. They live in the URL so a filtered
 *  view can be shared, and apply to the table and to the CSV export. */
export const POSITIONS = [
  ["G", "Gardien"],
  ["D", "Défenseur"],
  ["M", "Milieu"],
  ["A", "Attaquant"],
];
export const ROLES = [
  ["all", "Tous"],
  ["starter", "Titulaire"],
  ["sub", "Remplaçant"],
];
export const VENUES = [
  ["all", "Tous"],
  ["home", "Domicile"],
  ["away", "Extérieur"],
];
export const RESULTS = [
  ["all", "Tous"],
  ["win", "Victoire"],
  ["draw", "Nul"],
  ["loss", "Défaite"],
];
/** Match statistics a condition can test: [key, label, decimals]. */
export const CONDITION_METRICS = [
  ["goals", "Buts", 0],
  ["assists", "Passes décisives", 0],
  ["xg", "xG", 2],
  ["xa", "xA", 2],
  ["shots", "Tirs", 0],
  ["shotsOnTarget", "Tirs cadrés", 0],
  ["chancesCreated", "Occasions créées", 0],
  ["touchesBox", "Ballons dans la surface", 0],
  ["dribbles", "Dribbles réussis", 0],
  ["passesAccurate", "Passes réussies", 0],
  ["passAccuracy", "Précision des passes (%)", 0],
  ["passesFinalThird", "Passes dans le dernier tiers", 0],
  ["touches", "Ballons touchés", 0],
  ["duelsWon", "Duels gagnés", 0],
  ["tackles", "Tacles", 0],
  ["interceptions", "Interceptions", 0],
  ["recoveries", "Récupérations", 0],
  ["clearances", "Dégagements", 0],
  ["saves", "Arrêts", 0],
];
export const MAX_CONDITIONS = 3;
const metricKeys = new Set(CONDITION_METRICS.map(([key]) => key));
const day = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "");
const option = (value, list) =>
  list.some(([key]) => key === value) ? value : "all";

export const EMPTY_ADVANCED = Object.freeze({
  positions: [],
  role: "all",
  venue: "all",
  result: "all",
  rating: null,
  from: "",
  to: "",
  conditions: [],
});

export function parseAdvanced(params) {
  const rating = Number.parseFloat(params.get("rmin") ?? "");
  return {
    positions: (params.get("pos") || "")
      .split(",")
      .filter((p) => POSITIONS.some(([key]) => key === p)),
    role: option(params.get("role"), ROLES),
    venue: option(params.get("venue"), VENUES),
    result: option(params.get("result"), RESULTS),
    rating: Number.isFinite(rating) ? rating : null,
    from: day(params.get("from")),
    to: day(params.get("to")),
    conditions: (params.get("stats") || "")
      .split(",")
      .map((part) => {
        const [key, min] = part.split(":");
        const value = Number.parseFloat(min);
        return metricKeys.has(key) && Number.isFinite(value)
          ? { key, min: value }
          : null;
      })
      .filter(Boolean)
      .slice(0, MAX_CONDITIONS),
  };
}
/** URL parameters for `advanced`; empty strings remove a parameter. */
export function advancedQuery(advanced = EMPTY_ADVANCED) {
  return {
    pos: advanced.positions.join(","),
    role: advanced.role === "all" ? "" : advanced.role,
    venue: advanced.venue === "all" ? "" : advanced.venue,
    result: advanced.result === "all" ? "" : advanced.result,
    rmin: isNumber(advanced.rating) ? String(advanced.rating) : "",
    from: advanced.from,
    to: advanced.to,
    stats: advanced.conditions
      .filter((c) => metricKeys.has(c.key) && isNumber(c.min))
      .map((c) => `${c.key}:${c.min}`)
      .join(","),
  };
}
/** Stable text form, used to cache filtered lists. */
export const advancedKey = (advanced) =>
  Object.values(advancedQuery(advanced)).join("|");

/** Number of active filters, as shown by the chips under the filter row. */
export function countAdvanced(advanced = EMPTY_ADVANCED) {
  return advancedChips(advanced).length;
}

const lineOf = (row) => {
  const line = positionOf(row)?.label;
  return line === "Gardien"
    ? "G"
    : line === "Défenseur"
      ? "D"
      : line === "Milieu" || line === "Milieu offensif"
        ? "M"
        : line === "Attaquant"
          ? "A"
          : null;
};
/** Row predicate for the active filters, or null when none is active.
 *  `matches` maps a match id to the match (sides and score). */
export function advancedTest(advanced, matches) {
  if (!countAdvanced(advanced)) return null;
  const positions = new Set(advanced.positions);
  return (row) => {
    if (positions.size && !positions.has(lineOf(row))) return false;
    if (advanced.role === "starter" && row.starter !== true) return false;
    if (advanced.role === "sub" && row.starter !== false) return false;
    if (
      isNumber(advanced.rating) &&
      !(isNumber(row.rating) && row.rating >= advanced.rating)
    )
      return false;
    if (advanced.from && !(row.date >= advanced.from)) return false;
    if (advanced.to && !(row.date <= advanced.to)) return false;
    for (const { key, min } of advanced.conditions) {
      const value = metricValue(row, key);
      if (!(isNumber(value) && value >= min)) return false;
    }
    if (advanced.venue !== "all" || advanced.result !== "all") {
      const match = matches.get(row.matchId),
        home = match?.home?.id === row.teamId,
        away = match?.away?.id === row.teamId;
      if (!home && !away) return false;
      if (advanced.venue === "home" && !home) return false;
      if (advanced.venue === "away" && !away) return false;
      if (advanced.result !== "all") {
        const own = home ? match.home.score : match.away.score,
          other = home ? match.away.score : match.home.score;
        if (!isNumber(own) || !isNumber(other)) return false;
        const result = own > other ? "win" : own < other ? "loss" : "draw";
        if (result !== advanced.result) return false;
      }
    }
    return true;
  };
}

const labelOf = (list, key) => list.find(([value]) => value === key)?.[1];
/** Removable chips for the active filters: { key, label, clear(advanced) }. */
export function advancedChips(advanced) {
  const chips = [];
  if (advanced.positions.length)
    chips.push({
      key: "pos",
      label: advanced.positions.map((p) => labelOf(POSITIONS, p)).join(", "),
      clear: (a) => ({ ...a, positions: [] }),
    });
  if (advanced.role !== "all")
    chips.push({
      key: "role",
      label: labelOf(ROLES, advanced.role),
      clear: (a) => ({ ...a, role: "all" }),
    });
  if (advanced.venue !== "all")
    chips.push({
      key: "venue",
      label: labelOf(VENUES, advanced.venue),
      clear: (a) => ({ ...a, venue: "all" }),
    });
  if (advanced.result !== "all")
    chips.push({
      key: "result",
      label: labelOf(RESULTS, advanced.result),
      clear: (a) => ({ ...a, result: "all" }),
    });
  if (isNumber(advanced.rating))
    chips.push({
      key: "rmin",
      label: `Note ≥ ${String(advanced.rating).replace(".", ",")}`,
      clear: (a) => ({ ...a, rating: null }),
    });
  if (advanced.from || advanced.to)
    chips.push({
      key: "dates",
      label:
        advanced.from && advanced.to
          ? `Du ${date(advanced.from)} au ${date(advanced.to)}`
          : advanced.from
            ? `Depuis le ${date(advanced.from)}`
            : `Jusqu’au ${date(advanced.to)}`,
      clear: (a) => ({ ...a, from: "", to: "" }),
    });
  advanced.conditions.forEach((condition, index) =>
    chips.push({
      key: `stat-${index}`,
      label: `${labelOf(CONDITION_METRICS, condition.key)} ≥ ${String(condition.min).replace(".", ",")}`,
      clear: (a) => ({
        ...a,
        conditions: a.conditions.filter((_, i) => i !== index),
      }),
    }),
  );
  return chips;
}
