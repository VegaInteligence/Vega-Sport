import { filterAppearances, isNumber, normalizeText } from "../model.js";
import { percentile, positionOf } from "./player-profile.js";
import { playerSearchAliases } from "./player-aliases.js";

// A season percentile is useful only when both the player and the comparison
// group have accumulated a meaningful amount of observed playing time.
export const MIN_SEASON_MINUTES = 450;
export const MIN_SEASON_PEERS = 30;

export const SEASON_METRICS = {
  goals: { label: "Buts" },
  assists: { label: "Passes décisives" },
  xg: { label: "Buts attendus · xG", decimals: 2 },
  npxg: { label: "xG hors penalty", decimals: 2 },
  xgot: { label: "xG cadrés · xGOT", decimals: 2 },
  xa: { label: "Passes décisives attendues · xA", decimals: 2 },
  shots: { label: "Tirs" },
  shotsOnTarget: { label: "Tirs cadrés" },
  touchesBox: { label: "Ballons dans la surface" },
  chancesCreated: { label: "Occasions créées" },
  bigChancesCreated: { label: "Grosses occasions créées" },
  passesFinalThird: { label: "Passes dans le dernier tiers" },
  dribbles: { label: "Dribbles réussis" },
  touches: { label: "Ballons touchés" },
  passesAccurate: { label: "Passes réussies" },
  passesAttempted: { label: "Passes tentées" },
  passAccuracy: { label: "Précision des passes", unit: "%", ratio: true },
  duelsWon: { label: "Duels gagnés" },
  duelsLost: { label: "Duels perdus", lowerIsBetter: true },
  duelRate: { label: "Duels gagnés", unit: "%", ratio: true },
  tackles: { label: "Tacles" },
  interceptions: { label: "Interceptions" },
  recoveries: { label: "Récupérations" },
  clearances: { label: "Dégagements" },
  defensiveActions: { label: "Actions défensives" },
  blocks: { label: "Tirs bloqués" },
  saves: { label: "Arrêts" },
  goalsPrevented: { label: "Buts évités", decimals: 2 },
};

const COUNTS = Object.keys(SEASON_METRICS).filter(
  (key) => !SEASON_METRICS[key].ratio,
);
const SECTION_DEFINITIONS = {
  finishing: {
    title: "Finition",
    keys: ["xg", "shots", "shotsOnTarget", "touchesBox"],
  },
  creation: {
    title: "Création",
    keys: ["xa", "chancesCreated", "passesFinalThird", "dribbles"],
  },
  passing: {
    title: "Jeu de passes",
    keys: ["touches", "passesAccurate", "passAccuracy"],
  },
  defence: {
    title: "Défense et duels",
    keys: [
      "duelsWon",
      "duelRate",
      "tackles",
      "interceptions",
      "recoveries",
      "clearances",
      "blocks",
    ],
  },
  keeper: { title: "Gardien", keys: ["saves", "goalsPrevented"] },
};
const SECTION_ORDER = {
  G: ["keeper", "passing", "defence"],
  D: ["defence", "passing", "creation", "finishing"],
  M: ["passing", "creation", "defence", "finishing"],
  O: ["finishing", "creation", "passing", "defence"],
  F: ["finishing", "creation", "passing", "defence"],
};
// PitchAPI omits zero xA observations, so its reported values alone cannot
// form an unbiased distribution across all players.
const UNRANKED = new Set(["xa"]);

export function seasonSections(group) {
  return (SECTION_ORDER[group] || SECTION_ORDER.F).map((id) => ({
    id,
    ...SECTION_DEFINITIONS[id],
  }));
}

/** Apply the active season/competition/advanced filters without restricting the
 *  player's history to the search text or to one selected match. */
export function filterSeasonPlayerScope(rows, scope) {
  return filterAppearances(rows, { ...scope, query: "", match: "all" });
}

const names = new Map();
function normalizedName(value) {
  const name = String(value || "");
  if (!names.has(name)) {
    if (names.size > 100000) names.clear();
    names.set(name, normalizeText(name));
  }
  return names.get(name);
}

/** Search the already scoped rows by name, keeping distinct provider IDs. */
export function playerSearchResults(rows, query, limit = 6) {
  const needle = normalizeText(query).trim();
  if (needle.length < 2) return [];
  const players = new Map();
  for (const row of rows) {
    if (
      !row.playerId ||
      !row.name ||
      (!normalizedName(row.name).includes(needle) &&
        !playerSearchAliases(row.playerId).some((alias) =>
          alias.includes(needle),
        ))
    )
      continue;
    if (!players.has(row.playerId)) {
      players.set(row.playerId, {
        id: row.playerId,
        name: row.name,
        imageUrl: row.imageUrl,
        team: row.team,
      });
      if (players.size >= limit) break;
    }
  }
  return [...players.values()];
}

function accumulator(id, keepRows = false) {
  return {
    id,
    keepRows,
    rows: [],
    seen: new Set(),
    matches: 0,
    minutes: 0,
    unknownMatches: new Set(),
    stats: Object.create(null),
    ratios: Object.create(null),
    ratingSum: 0,
    ratingCount: 0,
    starts: 0,
    knownStarts: 0,
    leagueIds: new Set(),
    teamIds: new Set(),
    positions: new Map(),
    teams: new Set(),
    latest: null,
  };
}

function addRatio(acc, key, numerator, denominator, minutes) {
  if (!isNumber(numerator) || !isNumber(denominator) || denominator <= 0)
    return;
  const value = (acc.ratios[key] ||= {
    numerator: 0,
    denominator: 0,
    count: 0,
    minutes: 0,
  });
  value.numerator += numerator;
  value.denominator += denominator;
  value.count++;
  value.minutes += minutes;
}

function addAppearance(acc, row) {
  if (!row.matchId || acc.seen.has(row.matchId)) return;
  if (!isNumber(row.minutes)) {
    acc.unknownMatches.add(row.matchId);
    return;
  }
  // A named substitute who did not enter is not a played match.
  if (row.minutes <= 0) return;
  acc.unknownMatches.delete(row.matchId);
  acc.seen.add(row.matchId);
  acc.matches++;
  acc.minutes += row.minutes;
  if (typeof row.starter === "boolean") {
    acc.knownStarts++;
    if (row.starter) acc.starts++;
  }
  if (row.leagueId) acc.leagueIds.add(row.leagueId);
  if (row.teamId) acc.teamIds.add(row.teamId);
  if (acc.keepRows) acc.rows.push(row);
  if (row.team) acc.teams.add(row.team);
  if (!acc.latest || String(row.date || "") > String(acc.latest.date || ""))
    acc.latest = row;
  const line = positionOf(row);
  if (line) {
    const value = acc.positions.get(line.label) || { line, minutes: 0 };
    value.minutes += row.minutes;
    acc.positions.set(line.label, value);
  }
  if (isNumber(row.rating)) {
    acc.ratingSum += row.rating;
    acc.ratingCount++;
  }
  for (const key of COUNTS) {
    if (!isNumber(row[key])) continue;
    const value = (acc.stats[key] ||= { sum: 0, count: 0, minutes: 0 });
    value.sum += row[key];
    value.count++;
    value.minutes += row.minutes;
  }
  addRatio(
    acc,
    "passAccuracy",
    row.passesAccurate,
    row.passesAttempted,
    row.minutes,
  );
  if (isNumber(row.duelsWon) && isNumber(row.duelsLost))
    addRatio(
      acc,
      "duelRate",
      row.duelsWon,
      row.duelsWon + row.duelsLost,
      row.minutes,
    );
}

function finish(acc) {
  const groupMinutes = new Map();
  for (const value of acc.positions.values())
    groupMinutes.set(
      value.line.group,
      (groupMinutes.get(value.line.group) || 0) + value.minutes,
    );
  let group = null;
  for (const [key, minutes] of groupMinutes)
    if (!group || minutes > group.minutes) group = { key, minutes };
  let position = null;
  for (const value of acc.positions.values())
    if (
      value.line.group === group?.key &&
      (!position || value.minutes > position.minutes)
    )
      position = value;
  return {
    ...acc,
    name: acc.latest?.name || "Joueur",
    imageUrl: acc.latest?.imageUrl,
    role: position?.line || null,
    unknownMinutes: acc.unknownMatches.size,
    teams: [...acc.teams],
    leagueIds: [...acc.leagueIds],
    teamIds: [...acc.teamIds],
    rating: acc.ratingCount ? acc.ratingSum / acc.ratingCount : null,
    rows: acc.rows.sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")),
    ),
  };
}

/** Aggregate only observations with known, positive minutes, once per match. */
export function aggregateSeason(rows, playerId) {
  const acc = accumulator(playerId, true);
  for (const row of rows)
    if (row.playerId === playerId) addAppearance(acc, row);
  return finish(acc);
}

/** One accumulation pass for the directory; keep match history in the source. */
export function aggregateSeasonPlayers(rows) {
  const players = new Map();
  for (const row of rows) {
    if (!row.playerId) continue;
    let acc = players.get(row.playerId);
    if (!acc) {
      acc = accumulator(row.playerId);
      acc.identity = row;
      acc.leagues = new Set();
      players.set(row.playerId, acc);
    }
    if (String(row.date || "") > String(acc.identity.date || ""))
      acc.identity = row;
    if (row.league) acc.leagues.add(row.league);
    addAppearance(acc, row);
  }
  return [...players.values()].map((acc) => {
    const profile = finish(acc);
    return {
      ...profile,
      name: (profile.latest || acc.identity).name || "Joueur",
      imageUrl: (profile.latest || acc.identity).imageUrl,
      teams: profile.teams.length
        ? profile.teams
        : [acc.identity.team].filter(Boolean),
      role: profile.role || positionOf(acc.identity),
      leagues: [...acc.leagues],
    };
  });
}

/** Missing observations stay missing; per-90 uses only their observed minutes. */
export function seasonMetric(profile, key, mode = "total") {
  if (SEASON_METRICS[key]?.ratio) {
    const ratio = profile.ratios[key];
    return ratio?.denominator > 0
      ? {
          value: (100 * ratio.numerator) / ratio.denominator,
          count: ratio.count,
          minutes: ratio.minutes,
        }
      : { value: null, count: 0, minutes: 0 };
  }
  const stat = profile.stats[key];
  if (!stat?.count) return { value: null, count: 0, minutes: 0 };
  const value =
    mode === "perMatch"
      ? stat.sum / stat.count
      : mode === "per90"
        ? (90 * stat.sum) / stat.minutes
        : stat.sum;
  return { value, count: stat.count, minutes: stat.minutes };
}

/** Incremental so a large season never blocks the initial player card. */
export function createSeasonPeerBuilder(rows, target) {
  const keys = [
    ...new Set(
      seasonSections(target.role?.group).flatMap((section) => section.keys),
    ),
  ];
  const players = new Map();
  let index = 0;
  return {
    step(size = 1000) {
      const end = Math.min(index + size, rows.length);
      while (index < end) {
        const row = rows[index++];
        if (!row.playerId || !isNumber(row.minutes) || row.minutes <= 0)
          continue;
        let acc = players.get(row.playerId);
        if (!acc) players.set(row.playerId, (acc = accumulator(row.playerId)));
        addAppearance(acc, row);
      }
      return index >= rows.length;
    },
    result() {
      const values = Object.fromEntries(keys.map((key) => [key, []]));
      let peers = 0;
      for (const acc of players.values()) {
        const profile = finish(acc);
        if (
          profile.minutes < MIN_SEASON_MINUTES ||
          profile.role?.group !== target.role?.group
        )
          continue;
        peers++;
        for (const key of keys) {
          const metric = seasonMetric(profile, key, "per90");
          if (
            !UNRANKED.has(key) &&
            isNumber(metric.value) &&
            metric.minutes >= MIN_SEASON_MINUTES &&
            metric.minutes === profile.minutes
          )
            values[key].push(metric.value);
        }
      }
      const metrics = {};
      for (const key of keys) {
        const own = seasonMetric(target, key, "per90");
        const distribution = values[key].sort((a, b) => a - b);
        metrics[key] = {
          peers: distribution.length,
          percentile:
            !UNRANKED.has(key) &&
            own.minutes >= MIN_SEASON_MINUTES &&
            own.minutes === target.minutes &&
            distribution.length >= MIN_SEASON_PEERS
              ? percentile(distribution, own.value)
              : null,
        };
      }
      return { peers, metrics };
    },
  };
}
