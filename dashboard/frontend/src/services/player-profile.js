import { isNumber } from "./format.js";

/** Position lines from the source formation slot (positionId).
 *  Starters carry a slot (11 = keeper, 3x = back line, 6x–7x = midfield,
 *  8x = attacking midfield, 9x–11x = forwards); substitutes carry their usual
 *  line (0 keeper, 1 defender, 2 midfielder, 3 forward). */
const LINES = {
  G: { label: "Gardien", peers: "gardiens", group: "G" },
  D: { label: "Défenseur", peers: "défenseurs", group: "D" },
  M: { label: "Milieu", peers: "milieux", group: "M" },
  AM: {
    label: "Milieu offensif",
    peers: "milieux offensifs et attaquants",
    group: "O",
  },
  A: {
    label: "Attaquant",
    peers: "milieux offensifs et attaquants",
    group: "O",
  },
};
const OUTFIELD = { label: null, peers: "joueurs de champ", group: "F" };

export function positionOf(row) {
  const id = Number(row?.positionId);
  if (row?.positionId == null || !Number.isFinite(id)) return null;
  if (id === 0 || id === 11) return LINES.G;
  if (id === 1 || (id >= 30 && id < 40) || id === 51 || id === 59)
    return LINES.D;
  if (id === 2 || (id >= 50 && id < 80)) return LINES.M;
  if (id >= 80 && id < 90) return LINES.AM;
  if (id === 3 || (id >= 90 && id < 120)) return LINES.A;
  return null;
}
const peerGroup = (row) => {
  const line = positionOf(row);
  if (line) return line;
  return isNumber(row?.saves) && row.saves > 0 ? LINES.G : OUTFIELD;
};

const ratio = (num, den, minimum) => (row) =>
  isNumber(row[num]) && isNumber(row[den]) && row[den] >= minimum
    ? (row[num] / row[den]) * 100
    : null;
const duelRate = (row) => {
  const won = row.duelsWon,
    lost = row.duelsLost;
  return isNumber(won) && isNumber(lost) && won + lost >= 4
    ? (won / (won + lost)) * 100
    : null;
};

// No shot means no xG and nothing on target: the source leaves these empty
// instead of writing zero, so the zero is restored only in that case.
const withoutShots = (key) => (row) =>
  isNumber(row[key]) ? row[key] : row.shots === 0 ? 0 : null;

/** Metrics shown on the card: [key, label, decimals, unit, getter?].
 *  xA and big chances are never reported as zero by the source, so they are
 *  shown as figures but never ranked: a percentile would only compare the
 *  player with those who already recorded some. */
export const PROFILE_METRICS = {
  goals: ["goals", "Buts", 0],
  assists: ["assists", "Passes décisives", 0],
  xg: ["xg", "Buts attendus (xG)", 2, "", withoutShots("xg")],
  xa: ["xa", "Passes décisives attendues (xA)", 2],
  shots: ["shots", "Tirs", 0],
  shotsOnTarget: [
    "shotsOnTarget",
    "Tirs cadrés",
    0,
    "",
    withoutShots("shotsOnTarget"),
  ],
  touchesBox: ["touchesBox", "Ballons dans la surface", 0],
  chancesCreated: ["chancesCreated", "Occasions créées", 0],
  dribbles: ["dribbles", "Dribbles réussis", 0],
  touches: ["touches", "Ballons touchés", 0],
  passesAccurate: ["passesAccurate", "Passes réussies", 0],
  passAccuracy: [
    "passAccuracy",
    "Précision des passes",
    0,
    " %",
    ratio("passesAccurate", "passesAttempted", 10),
  ],
  passesFinalThird: ["passesFinalThird", "Passes dans le dernier tiers", 0],
  tackles: ["tackles", "Tacles", 0],
  interceptions: ["interceptions", "Interceptions", 0],
  recoveries: ["recoveries", "Récupérations", 0],
  clearances: ["clearances", "Dégagements", 0],
  blocks: ["blocks", "Tirs bloqués", 0],
  duelsWon: ["duelsWon", "Duels gagnés", 0],
  duelRate: ["duelRate", "Taux de duels gagnés", 0, " %", duelRate],
  saves: ["saves", "Arrêts", 0],
  goalsPrevented: ["goalsPrevented", "Buts évités", 2],
};
const DERIVED_INPUTS = {
  passAccuracy: ["passesAccurate", "passesAttempted"],
  duelRate: ["duelsWon", "duelsLost"],
};
const RANKED = Object.keys(PROFILE_METRICS).filter(
  (k) => !["goals", "assists", "xa"].includes(k),
);

const SECTIONS = {
  finishing: {
    title: "Finition",
    metrics: ["xg", "shots", "shotsOnTarget", "touchesBox"],
  },
  creation: {
    title: "Création",
    metrics: ["chancesCreated", "passesFinalThird", "dribbles"],
  },
  passing: {
    title: "Jeu de passes",
    metrics: ["touches", "passesAccurate", "passAccuracy"],
  },
  defence: {
    title: "Défense & duels",
    metrics: [
      "duelsWon",
      "duelRate",
      "tackles",
      "interceptions",
      "recoveries",
      "clearances",
      "blocks",
    ],
  },
  keeper: { title: "Gardien", metrics: ["saves", "goalsPrevented"] },
};
const ORDER = {
  G: ["keeper", "passing", "defence"],
  D: ["defence", "passing", "creation", "finishing"],
  M: ["passing", "creation", "defence", "finishing"],
  O: ["finishing", "creation", "passing", "defence"],
  F: ["finishing", "creation", "passing", "defence"],
};

const FIGURES = {
  G: ["saves", "goalsPrevented", "passesAccurate", "touches", "recoveries"],
  D: [
    "goals",
    "assists",
    "duelsWon",
    "recoveries",
    "interceptions",
    "clearances",
  ],
  M: ["goals", "assists", "xa", "chancesCreated", "passesAccurate"],
  O: ["goals", "assists", "xg", "xa", "shots", "chancesCreated"],
  F: ["goals", "assists", "xg", "xa", "chancesCreated", "passesAccurate"],
};
const SHORT_LABELS = { xg: "xG", xa: "xA" };
/** Four headline figures for the player's line, skipping unreported ones. */
export function keyFigures(row) {
  const keys = FIGURES[peerGroup(row).group],
    pinned = keys.filter((k) => ["goals", "assists"].includes(k)),
    available = keys.filter(
      (k) => !pinned.includes(k) && metricValue(row, k) !== null,
    );
  return [...pinned, ...available, ...keys]
    .filter((k, i, all) => all.indexOf(k) === i)
    .slice(0, 4)
    .map((key) => {
      const [, label, decimals, unit = ""] = PROFILE_METRICS[key];
      return {
        key,
        label: SHORT_LABELS[key] || label,
        decimals,
        unit,
        value: metricValue(row, key),
      };
    });
}

export const MIN_PEER_MINUTES = 30;
const MIN_PEERS = 30;
export const metricValue = (row, key) => {
  const getter = PROFILE_METRICS[key]?.[4];
  if (getter) return getter(row);
  return isNumber(row[key]) ? row[key] : null;
};

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
          outfield = g === "G" ? null : lists.F;
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
const bound = (sorted, value, strict) => {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? sorted[mid] < value : sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
/** Mid-rank percentile: share of peers below, plus half of the ties. */
export function percentile(sorted, value) {
  if (!sorted?.length || !isNumber(value)) return null;
  const below = bound(sorted, value, true),
    equal = bound(sorted, value, false) - below;
  return Math.round(((below + equal / 2) / sorted.length) * 100);
}

/** Sections of the profile for one appearance, ranked against its line. */
export function performanceProfile(row, appearances) {
  const line = peerGroup(row),
    { count, values } = distributions(appearances, line.group),
    missing = [];
  const sections = ORDER[line.group]
    .map((id) => {
      const section = SECTIONS[id];
      const metrics = section.metrics
        .map((key) => {
          const [, label, decimals, unit = ""] = PROFILE_METRICS[key],
            value = metricValue(row, key);
          if (value === null) {
            // A rate left out for a small sample is not a gap in the source.
            const inputs = DERIVED_INPUTS[key];
            if (!inputs || inputs.some((k) => !isNumber(row[k])))
              missing.push(label);
            return null;
          }
          return {
            key,
            label,
            decimals,
            unit,
            value,
            percentile:
              count >= MIN_PEERS ? percentile(values[key], value) : null,
          };
        })
        .filter(Boolean);
      return { id, title: section.title, metrics };
    })
    .filter((s) => s.metrics.length);
  return { line, peers: count, sections, missing: [...new Set(missing)] };
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
