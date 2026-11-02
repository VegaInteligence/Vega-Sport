import { isNumber } from "./format.js";
import { percentile } from "./player-profile.js";
import {
  MIN_SEASON_MINUTES,
  MIN_SEASON_PEERS,
  SEASON_METRICS,
  seasonMetric,
} from "./season-player.js";

export const SCOUTING_VERSION = "statarena-descriptive-v1";
const definitions = {
  goals: "Buts inscrits dans les performances renseignées.",
  assists: "Passes décisives attribuées.",
  xg: "Somme des probabilités de but des tirs renseignés.",
  npxg: "Buts attendus en excluant les penalties, lorsqu’ils sont renseignés.",
  xgot: "Buts attendus après placement du tir cadré.",
  xa: "Passes décisives attendues renseignées. Certaines observations nulles sont absentes : pas de centile ou de score sur cette mesure.",
  shots: "Tirs tentés renseignés, indépendamment de leur résultat.",
  shotsOnTarget: "Tirs cadrés renseignés.",
  touchesBox: "Ballons touchés dans la surface adverse.",
  chancesCreated: "Occasions créées.",
  bigChancesCreated: "Grosses occasions créées.",
  passesFinalThird:
    "Passes dans le dernier tiers. Ce n’est pas une mesure complète des directions de passe.",
  dribbles: "Dribbles réussis. Les observations absentes restent inconnues.",
  touches: "Ballons touchés dans les performances renseignées.",
  passesAccurate: "Passes réussies, hors observations non renseignées.",
  passesAttempted: "Passes tentées, hors observations non renseignées.",
  passAccuracy:
    "100 × somme des passes réussies / somme des passes tentées sur les mêmes observations.",
  duelsWon: "Duels gagnés.",
  duelsLost:
    "Duels perdus. Le volume dépend aussi du nombre de duels disputés.",
  duelRate:
    "100 × duels gagnés / (duels gagnés + perdus), sur les mêmes observations.",
  tackles: "Tacles.",
  interceptions: "Interceptions.",
  recoveries: "Récupérations de balle.",
  clearances: "Dégagements.",
  defensiveActions:
    "Agrégat d’actions défensives fourni dans les observations.",
  blocks: "Tirs bloqués par le joueur.",
  saves: "Arrêts du gardien.",
  goalsPrevented:
    "Buts évités, disponible sur une partie des gardiens.",
};
export const SCOUT_METRICS = Object.fromEntries(
  Object.entries(SEASON_METRICS).map(([key, value]) => [
    key,
    {
      ...value,
      description: definitions[key] || value.label,
      rankable: key !== "xa",
      source: "PitchAPI",
    },
  ]),
);
export const METRIC_PRESETS = {
  overview: {
    label: "Vue d’ensemble",
    keys: [
      "xg",
      "chancesCreated",
      "passesAccurate",
      "recoveries",
      "duelsWon",
      "touchesBox",
    ],
  },
  attack: {
    label: "Attaque",
    keys: ["goals", "xg", "npxg", "shots", "shotsOnTarget", "touchesBox"],
  },
  creation: {
    label: "Création",
    keys: [
      "assists",
      "xa",
      "chancesCreated",
      "passesFinalThird",
      "dribbles",
      "passAccuracy",
    ],
  },
  defence: {
    label: "Défense",
    keys: [
      "tackles",
      "interceptions",
      "recoveries",
      "duelsWon",
      "duelRate",
      "clearances",
    ],
  },
  keeper: {
    label: "Gardien",
    keys: [
      "saves",
      "goalsPrevented",
      "passesAccurate",
      "passAccuracy",
      "touches",
      "recoveries",
    ],
  },
};
export const ROLE_PROFILES = [
  {
    id: "recovery",
    label: "Récupération",
    groups: ["D", "M", "O"],
    keys: ["recoveries", "interceptions", "tackles"],
  },
  {
    id: "defending",
    label: "Défense de surface",
    groups: ["D"],
    keys: ["clearances", "blocks", "duelsWon"],
  },
  {
    id: "build",
    label: "Construction",
    groups: ["D", "M", "G"],
    keys: ["passesAccurate", "passAccuracy", "touches"],
  },
  {
    id: "creation",
    label: "Création",
    groups: ["M", "O", "F"],
    keys: ["chancesCreated", "passesFinalThird", "passesAccurate"],
  },
  {
    id: "dribbling",
    label: "Percussion",
    groups: ["M", "O", "F"],
    keys: ["dribbles", "touchesBox", "chancesCreated"],
  },
  {
    id: "finishing",
    label: "Présence offensive",
    groups: ["O", "F"],
    keys: ["xg", "shots", "touchesBox"],
  },
  {
    id: "shotstopper",
    label: "Arrêts",
    groups: ["G"],
    keys: ["saves", "goalsPrevented"],
  },
];
export const DEFAULT_INDEX = {
  name: "Mon indice",
  minMinutes: MIN_SEASON_MINUTES,
  weights: [
    { key: "passesAccurate", weight: 1, direction: "max" },
    { key: "chancesCreated", weight: 1, direction: "max" },
    { key: "recoveries", weight: 1, direction: "max" },
  ],
};

export function profileValue(profile, key, basis = "per90") {
  if (!profile) return null;
  if (key === "minutes") return profile.minutes;
  if (key === "matches") return profile.matches;
  if (key === "rating") return profile.rating;
  return seasonMetric(profile, key, basis).value;
}

export function median(values) {
  const ordered = values.filter(isNumber).sort((a, b) => a - b);
  const i = Math.floor(ordered.length / 2);
  return ordered.length
    ? ordered.length % 2
      ? ordered[i]
      : (ordered[i - 1] + ordered[i]) / 2
    : null;
}

/** One shared, unfiltered-by-statistical-threshold cohort for all research views. */
export function buildCohorts(profiles, minMinutes = MIN_SEASON_MINUTES) {
  const groups = new Map();
  for (const profile of profiles) {
    const group = profile.role?.group;
    if (!group || !profile.matches || profile.minutes < minMinutes) continue;
    if (!groups.has(group))
      groups.set(group, { profiles: [], distributions: {} });
    const cohort = groups.get(group);
    cohort.profiles.push(profile);
    for (const [key, definition] of Object.entries(SCOUT_METRICS)) {
      const metric = seasonMetric(profile, key, "per90");
      if (
        definition.rankable &&
        isNumber(metric.value) &&
        metric.count === profile.matches &&
        metric.minutes === profile.minutes
      )
        (cohort.distributions[key] ||= []).push(metric.value);
    }
  }
  for (const cohort of groups.values())
    for (const values of Object.values(cohort.distributions))
      values.sort((a, b) => a - b);
  return {
    groups,
    minMinutes,
    minPeers: MIN_SEASON_PEERS,
    version: SCOUTING_VERSION,
  };
}

export function rankMetric(profile, key, cohorts) {
  const value = seasonMetric(profile, key, "per90");
  const cohort = cohorts.groups.get(profile.role?.group);
  const values = cohort?.distributions[key] || [];
  const available =
    SCOUT_METRICS[key]?.rankable &&
    profile.minutes >= cohorts.minMinutes &&
    value.count === profile.matches &&
    value.minutes === profile.minutes &&
    values.length >= cohorts.minPeers;
  const middle = Math.floor(values.length / 2);
  const midpoint = values.length
    ? values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2
    : null;
  return {
    ...value,
    peers: values.length,
    percentile: available ? percentile(values, value.value) : null,
    median: midpoint,
  };
}

export function customIndex(profile, cohorts, config = DEFAULT_INDEX) {
  if (
    config.weights.some((w) => w.weight > 0 && !SCOUT_METRICS[w.key]?.rankable)
  )
    return {
      value: null,
      parts: [],
      reason: "Un indicateur choisi ne permet pas un classement fiable.",
    };
  const weights = config.weights.filter(
    (w) => SCOUT_METRICS[w.key]?.rankable && isNumber(w.weight) && w.weight > 0,
  );
  if (!weights.length)
    return {
      value: null,
      parts: [],
      reason: "Choisir au moins un indicateur pondéré.",
    };
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  const parts = weights.map((item) => {
    const ranked = rankMetric(profile, item.key, cohorts);
    const score =
      ranked.percentile == null
        ? null
        : item.direction === "min"
          ? 100 - ranked.percentile
          : ranked.percentile;
    return {
      ...item,
      ...ranked,
      score,
      share: item.weight / total,
      contribution: score == null ? null : (score * item.weight) / total,
    };
  });
  return {
    value: parts.every((p) => isNumber(p.contribution))
      ? parts.reduce((sum, p) => sum + p.contribution, 0)
      : null,
    parts,
    reason:
      "Les indicateurs doivent couvrir tous les matchs joués ; 30 joueurs comparables et le minimum de minutes sont requis.",
    version: SCOUTING_VERSION,
  };
}

export function roleAssessments(profile, cohorts) {
  return ROLE_PROFILES.filter((role) =>
    role.groups.includes(profile.role?.group),
  )
    .map((role) => ({
      ...role,
      ...customIndex(profile, cohorts, {
        weights: role.keys.map((key) => ({ key, weight: 1, direction: "max" })),
      }),
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

const STYLE_KEYS = [
  "shots",
  "touchesBox",
  "chancesCreated",
  "passesFinalThird",
  "dribbles",
  "touches",
  "passesAccurate",
  "passAccuracy",
  "duelsWon",
  "duelRate",
  "tackles",
  "interceptions",
  "recoveries",
  "clearances",
  "saves",
];
export function similarPlayers(target, cohorts, limit = 8) {
  const peers = cohorts.groups.get(target.role?.group)?.profiles || [];
  const own = Object.fromEntries(
    STYLE_KEYS.map((key) => [key, rankMetric(target, key, cohorts)]),
  );
  const candidates = [];
  for (const profile of peers) {
    if (profile.id === target.id) continue;
    const parts = STYLE_KEYS.flatMap((key) => {
      if (own[key].percentile == null) return [];
      const other = rankMetric(profile, key, cohorts);
      return other.percentile == null
        ? []
        : [
            {
              key,
              target: own[key].value,
              other: other.value,
              difference: Math.abs(own[key].percentile - other.percentile),
            },
          ];
    });
    // A handful of shared indicators must not masquerade as a full profile.
    const required = Math.max(
      5,
      Math.ceil(
        Object.values(own).filter((value) => value.percentile != null).length *
          0.75,
      ),
    );
    if (parts.length < required) continue;
    const distance =
      parts.reduce((sum, part) => sum + part.difference, 0) / parts.length;
    candidates.push({
      profile,
      similarity: 100 - distance,
      parts: parts.sort((a, b) => a.difference - b.difference),
    });
  }
  return candidates
    .sort(
      (a, b) =>
        b.similarity - a.similarity || a.profile.id.localeCompare(b.profile.id),
    )
    .slice(0, limit);
}

export function cohortTraits(profile, cohorts) {
  const values = STYLE_KEYS.map((key) => ({
    key,
    ...rankMetric(profile, key, cohorts),
  })).filter((x) => x.percentile != null);
  return {
    high: [...values].sort((a, b) => b.percentile - a.percentile).slice(0, 3),
    low: [...values].sort((a, b) => a.percentile - b.percentile).slice(0, 3),
  };
}

const SHORT = {
  xg: "xG",
  npxg: "xG hors pen.",
  xa: "xA",
  xgot: "xGOT",
  chancesCreated: "Occasions",
  passesAccurate: "Passes",
  recoveries: "Récupérations",
  duelsWon: "Duels",
  touchesBox: "Surface",
  passesFinalThird: "Dernier tiers",
  passAccuracy: "Passes %",
  defensiveActions: "Défense",
};
export const metricAxes = (keys) =>
  keys
    .slice(0, 8)
    .map((key) => ({
      key,
      label: SHORT[key] || SCOUT_METRICS[key]?.label || key,
    }));


export function playerSnapshot(profile, season) {
  return {
    id: profile.id,
    name: profile.name,
    season,
    position: profile.role?.label,
    teams: profile.teams,
    matches: profile.matches,
    minutes: profile.minutes,
    starts: profile.starts,
    knownStarts: profile.knownStarts,
    rating: profile.rating,
    ratingCount: profile.ratingCount,
    metrics: Object.fromEntries(
      Object.keys(SCOUT_METRICS).map((key) => [
        key,
        {
          ...seasonMetric(profile, key, "total"),
          per90: seasonMetric(profile, key, "per90").value,
          perMatch: seasonMetric(profile, key, "perMatch").value,
        },
      ]),
    ),
  };
}
