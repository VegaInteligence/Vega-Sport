const isNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

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
export const peerGroup = (row) => {
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
export const RANKED = Object.keys(PROFILE_METRICS).filter(
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

/** The API returns exact lower/tied/known counts, never a sampled peer array. */
export function performanceProfileFromCounts(row, counts) {
  return profileFromDistribution(
    row,
    peerGroup(row),
    Number(counts?.peers || 0),
    (key, value) => {
      const metric = counts?.metrics?.[key];
      if (!metric || !isNumber(value) || !(Number(metric.known) > 0))
        return null;
      return Math.round(
        ((Number(metric.below) + Number(metric.equal) / 2) /
          Number(metric.known)) *
          100,
      );
    },
  );
}

export function profileFromDistribution(row, line, count, rank) {
  const missing = [];
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
            percentile: count >= MIN_PEERS ? rank(key, value) : null,
          };
        })
        .filter(Boolean);
      return { id, title: section.title, metrics };
    })
    .filter((s) => s.metrics.length);
  return { line, peers: count, sections, missing: [...new Set(missing)] };
}
