import { isNumber } from "./format.js";
import {
  MIN_PEER_MINUTES,
  PROFILE_METRICS,
  RANKED,
  peerGroup,
  percentile,
  profileFromDistribution,
} from "../../../shared/player-profile.js";

export {
  MIN_PEER_MINUTES,
  PROFILE_METRICS,
  keyFigures,
  metricValue,
  percentile,
  performanceProfileFromCounts,
  positionOf,
} from "../../../shared/player-profile.js";

// Sorted peer distributions, computed once per loaded dataset and line.
// Sorted peer distributions for every line. They are built in small slices
// while the browser is idle after the data loads, so opening a card only
// binary-searches; if a card opens first, the remaining work runs at once.
const GROUPS = ["G", "D", "M", "O", "F"];
const getters = RANKED.map(
  (key) =>
    PROFILE_METRICS[key][4] ||
    ((row) => (isNumber(row[key]) ? row[key] : null)),
);
const builders = new WeakMap();
function builder(appearances) {
  let state = builders.get(appearances);
  if (state) return state;
  const lists = Object.fromEntries(
    GROUPS.map((g) => [g, { count: 0, values: RANKED.map(() => []) }]),
  );
  state = { index: 0, sorted: 0, result: null };
  const total = GROUPS.length * RANKED.length;
  // Returns true when everything is ready; `budget` bounds the work in ms.
  state.run = (budget = Infinity) => {
    if (state.result) return true;
    const stop = performance.now() + budget;
    while (state.index < appearances.length) {
      const end = Math.min(state.index + 2000, appearances.length);
      for (; state.index < end; state.index++) {
        const row = appearances[state.index];
        if (!(row.minutes >= MIN_PEER_MINUTES)) continue;
        const g = peerGroup(row).group,
          own = lists[g],
          outfield = g === "G" || g === "F" ? null : lists.F;
        own.count++;
        if (outfield) outfield.count++;
        for (let k = 0; k < getters.length; k++) {
          const v = getters[k](row);
          if (v === null) continue;
          own.values[k].push(v);
          if (outfield) outfield.values[k].push(v);
        }
      }
      if (performance.now() > stop) return false;
    }
    while (state.sorted < total) {
      const list = lists[GROUPS[Math.floor(state.sorted / RANKED.length)]],
        k = state.sorted % RANKED.length;
      list.values[k] = Float64Array.from(list.values[k]).sort();
      state.sorted++;
      if (performance.now() > stop) return false;
    }
    state.result = Object.fromEntries(
      GROUPS.map((g) => [
        g,
        {
          count: lists[g].count,
          values: Object.fromEntries(
            RANKED.map((key, k) => [key, lists[g].values[k]]),
          ),
        },
      ]),
    );
    return true;
  };
  builders.set(appearances, state);
  return state;
}
function distributions(appearances, group) {
  const state = builder(appearances);
  state.run();
  return state.result[group];
}
/** Prepares the percentile tables in idle time; returns a cancel function. */
export function warmProfiles(appearances) {
  if (typeof window === "undefined" || !appearances?.length) return () => {};
  const state = builder(appearances),
    idle =
      window.requestIdleCallback ||
      ((callback) =>
        setTimeout(() => callback({ timeRemaining: () => 8 }), 50)),
    cancelIdle = window.cancelIdleCallback || clearTimeout;
  let handle;
  const step = (deadline) => {
    if (!state.run(Math.max(4, Math.min(12, deadline.timeRemaining()))))
      handle = idle(step, { timeout: 2000 });
  };
  handle = idle(step, { timeout: 2000 });
  return () => cancelIdle(handle);
}
/** Sections of the profile for one appearance, ranked against its line. */
export function performanceProfile(row, appearances) {
  const line = peerGroup(row),
    { count, values } = distributions(appearances, line.group);
  return profileFromDistribution(row, line, count, (key, value) =>
    percentile(values[key], value),
  );
}

/** Rank of a rating among the players of the same match. */
const ratingsByMatch = new WeakMap();
export function matchRatingRank(row, appearances) {
  if (!isNumber(row.rating)) return null;
  let index = ratingsByMatch.get(appearances);
  if (!index) {
    index = new Map();
    for (const r of appearances) {
      if (!isNumber(r.rating)) continue;
      if (!index.has(r.matchId)) index.set(r.matchId, []);
      index.get(r.matchId).push(r.rating);
    }
    ratingsByMatch.set(appearances, index);
  }
  const rated = index.get(row.matchId) || [];
  return {
    rank: rated.filter((rating) => rating > row.rating).length + 1,
    total: rated.length,
  };
}
