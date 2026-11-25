/* The shot map's periods (FAILURE_MODES § 63, § 63.4). The shots family spells them FirstHalf, SecondHalf, ExtraTime,
 * Penalties; the season's record of a match (backend/api/src/match-record.mjs) carries the base's first_half,
 * second_half, extra_time, penalties. Both read the same here. */

/** The periods a shot can belong to, in the order of the match, and how the choice names them. */
export const SHOT_PERIODS = [
  ["FirstHalf", "1re mi-temps"],
  ["SecondHalf", "2e mi-temps"],
  ["ExtraTime", "Prolongation"],
  ["ExtraFirstHalf", "Prol. 1re mi-temps"],
  ["ExtraSecondHalf", "Prol. 2e mi-temps"],
  ["Penalties", "Tirs au but"],
];
export const SHOOTOUT = "Penalties";

const BASE = {
  first_half: "FirstHalf",
  second_half: "SecondHalf",
  extra_time: "ExtraTime",
  extra_first_half: "ExtraFirstHalf",
  extra_second_half: "ExtraSecondHalf",
  penalties: "Penalties",
};

/** A shot's period in the family's spelling, whichever it came in; null without one. */
export const shotPeriod = (shot) => (shot?.period ? BASE[shot.period] || shot.period : null);

/** The choice of periods: « Match » (every period but the shoot-out), then each period with a shot; none without periods. */
export function shotPeriods(shots) {
  const present = new Set((shots || []).map(shotPeriod).filter(Boolean));
  const periods = SHOT_PERIODS.filter(([key]) => present.has(key));
  return periods.length ? [["all", "Match"], ...periods] : [];
}

/** The shots of a period: « all » leaves the shoot-out out. */
export function shotsOf(shots, period) {
  return (shots || []).filter((s) => (period === "all" ? shotPeriod(s) !== SHOOTOUT : shotPeriod(s) === period));
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Where a shot crossed the goal line, { y, z } in metres: the family's goalY / goalZ or the record's
 * goalCrossedY / goalCrossedZ (§ 63.7); null without both. */
export function shotGoal(shot) {
  const y = finite(shot?.goalY) ? shot.goalY : shot?.goalCrossedY;
  const z = finite(shot?.goalZ) ? shot.goalZ : shot?.goalCrossedZ;
  return finite(y) && finite(z) ? { y, z } : null;
}
