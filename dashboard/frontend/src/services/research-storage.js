import { SCOUT_METRICS, DEFAULT_INDEX, METRIC_PRESETS } from "./scouting.js";
export const RESEARCH_KEY = "statarena.research.v1";
const idPattern = /^(p|t|m)_[A-Za-z0-9]+$/;
const kinds = { players: "p", clubs: "t", matches: "m" };
const text = (value, length = 100) =>
  typeof value === "string" ? value.slice(0, length) : "";
export const DEFAULT_COLUMNS = [
  "matches",
  "minutes",
  "rating",
  "goals",
  "assists",
  "xg",
  "xa",
  "chancesCreated",
];
export const EMPTY_RESEARCH = {
  version: 1,
  activeList: "main",
  lists: [{ id: "main", name: "Ma sélection", entries: [] }],
  views: [],
  templates: [],
  comparison: [],
  settings: {
    columns: DEFAULT_COLUMNS,
    scatter: { x: "xg", y: "xa" },
    comparisonMetrics: METRIC_PRESETS.overview.keys,
    index: DEFAULT_INDEX,
  },
};
export const DEFAULT_SAMPLE = {
  league: "all",
  focus: "all",
  role: "all",
  venue: "all",
  result: "all",
  from: "",
  to: "",
};
export function cleanSample(value = {}) {
  return {
    league: /^l_[A-Za-z0-9]+$/.test(value.league || "") ? value.league : "all",
    focus: value.focus === "europe" ? "europe" : "all",
    role: ["starter", "sub"].includes(value.role) ? value.role : "all",
    venue: ["home", "away"].includes(value.venue) ? value.venue : "all",
    result: ["win", "draw", "loss"].includes(value.result)
      ? value.result
      : "all",
    from: /^\d{4}-\d{2}-\d{2}$/.test(value.from || "") ? value.from : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(value.to || "") ? value.to : "",
  };
}
export const comparisonKey = (entry) =>
  [entry.id, entry.season, ...Object.values(cleanSample(entry.scope))].join(
    ":",
  );
export function playerSelection(profile, f, season = f.season) {
  return {
    id: profile.id,
    kind: "players",
    name: profile.name,
    imageUrl: profile.imageUrl,
    season,
    scope:
      season === f.season
        ? cleanSample({
            ...f.filters.advanced,
            league: f.filters.league,
            focus: f.focus,
          })
        : DEFAULT_SAMPLE,
  };
}
export function cleanIndex(value) {
  const seen = new Set();
  return {
    name: text(value?.name) || DEFAULT_INDEX.name,
    groups: [
      ...new Set(
        Array.isArray(value?.groups)
          ? value.groups.filter((g) => ["G", "D", "M", "O", "F"].includes(g))
          : [],
      ),
    ],
    minMinutes: Math.max(
      0,
      Math.min(
        9000,
        Number.isFinite(value?.minMinutes) ? value.minMinutes : 450,
      ),
    ),
    weights: (Array.isArray(value?.weights)
      ? value.weights
      : DEFAULT_INDEX.weights
    )
      .flatMap((item) => {
        if (!SCOUT_METRICS[item?.key]?.rankable || seen.has(item.key))
          return [];
        seen.add(item.key);
        return [
          {
            key: item.key,
            direction: item.direction === "min" ? "min" : "max",
            weight: Number.isFinite(item.weight)
              ? Math.max(0, Math.min(100, item.weight))
              : 1,
          },
        ];
      })
      .slice(0, 32),
  };
}
export function cleanEntry(value) {
  if (
    !value ||
    !kinds[value.kind] ||
    !idPattern.test(value.id || "") ||
    !value.id.startsWith(kinds[value.kind] + "_")
  )
    return null;
  return {
    id: value.id,
    kind: value.kind,
    name: text(value.name) || value.id,
    season: /^\d{4}\/\d{4}$/.test(value.season || "") ? value.season : "",
    imageUrl: /^https:\/\//.test(value.imageUrl || "")
      ? text(value.imageUrl, 1000)
      : "",
    ...(value.kind === "players" ? { scope: cleanSample(value.scope) } : {}),
  };
}
export function cleanSettings(value = {}) {
  const keys = (items, fallback, meta = false) => {
    const valid = [...new Set(Array.isArray(items) ? items : fallback)].filter(
      (key) =>
        SCOUT_METRICS[key] ||
        (meta && ["matches", "minutes", "rating"].includes(key)),
    );
    return valid.length ? valid.slice(0, 32) : fallback;
  };
  return {
    columns: keys(value.columns, DEFAULT_COLUMNS, true),
    scatter: {
      x: SCOUT_METRICS[value.scatter?.x] ? value.scatter.x : "xg",
      y: SCOUT_METRICS[value.scatter?.y] ? value.scatter.y : "xa",
    },
    comparisonMetrics: keys(
      value.comparisonMetrics,
      METRIC_PRESETS.overview.keys,
    ),
    index: cleanIndex(value.index),
  };
}
export function cleanResearch(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.lists))
    throw new Error("Format de recherches non reconnu.");
  const listIds = new Set();
  const lists = value.lists.slice(0, 50).flatMap((list) => {
    if (
      typeof list?.id !== "string" ||
      !/^[\w-]{1,80}$/.test(list.id) ||
      listIds.has(list.id)
    )
      return [];
    listIds.add(list.id);
    const entries = [],
      seen = new Set();
    for (const raw of (Array.isArray(list.entries) ? list.entries : []).slice(
      0,
      5000,
    )) {
      const entry = cleanEntry(raw),
        key = entry && entry.kind + ":" + entry.id;
      if (entry && !seen.has(key)) {
        entries.push(entry);
        seen.add(key);
      }
    }
    return [{ id: list.id, name: text(list.name, 60) || "Sélection", entries }];
  });
  if (!lists.length)
    lists.push({ id: "main", name: "Ma sélection", entries: [] });
  const comparison = [],
    picked = new Set();
  for (const raw of Array.isArray(value.comparison) ? value.comparison : []) {
    const entry = cleanEntry({ ...raw, kind: "players" }),
      key = entry && comparisonKey(entry);
    if (entry?.season && !picked.has(key) && comparison.length < 4) {
      comparison.push(entry);
      picked.add(key);
    }
  }
  const views = (Array.isArray(value.views) ? value.views : [])
    .slice(0, 50)
    .flatMap((view) => {
      if (!view || typeof view.id !== "string") return [];
      const query = new URLSearchParams();
      const allowed = new Set([
        "q",
        "season",
        "focus",
        "league",
        "minutes",
        "basis",
        "pos",
        "role",
        "venue",
        "result",
        "rmin",
        "from",
        "to",
        "stats",
        "playersView",
      ]);
      for (const [key, raw] of new URLSearchParams(text(view.query, 4000)))
        if (allowed.has(key)) query.set(key, raw.slice(0, 400));
      return [
        {
          id: text(view.id, 80),
          name: text(view.name, 60) || "Recherche",
          query: query.toString(),
          settings: cleanSettings(view.settings),
        },
      ];
    });
  const templates = (Array.isArray(value.templates) ? value.templates : [])
    .slice(0, 50)
    .flatMap((item) =>
      typeof item?.id === "string"
        ? [{ id: text(item.id, 80), ...cleanIndex(item) }]
        : [],
    );
  return {
    version: 1,
    lists,
    activeList: lists.some((l) => l.id === value.activeList)
      ? value.activeList
      : lists[0].id,
    comparison,
    views,
    templates,
    settings: cleanSettings(value.settings),
  };
}
export function readResearch() {
  try {
    const raw = window.localStorage.getItem(RESEARCH_KEY);
    return raw ? cleanResearch(JSON.parse(raw)) : EMPTY_RESEARCH;
  } catch {
    return EMPTY_RESEARCH;
  }
}
