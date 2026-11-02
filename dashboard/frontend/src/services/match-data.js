import { isNumber, number } from "./format.js";
// Editorial order for team statistics. The source returns groups and items
// alphabetically; this list decides both the section and the reading order.
const definitions = [
  ["BallPossesion", "Possession", "Possession"],
  ["total_shots", "Tirs", "Tirs"],
  ["ShotsOnTarget", "Tirs cadrés", "Tirs"],
  ["ShotsOffTarget", "Tirs non cadrés", "Tirs"],
  ["blocked_shots", "Tirs contrés", "Tirs"],
  ["shots_inside_box", "Tirs dans la surface", "Tirs"],
  ["shots_outside_box", "Tirs hors surface", "Tirs"],
  ["big_chance", "Grosses occasions", "Tirs"],
  ["big_chance_missed_title", "Grosses occasions manquées", "Tirs"],
  ["shots_woodwork", "Montants touchés", "Tirs"],
  ["expected_goals", "Buts attendus · xG", "Buts attendus"],
  ["expected_goals_non_penalty", "xG hors penalty", "Buts attendus"],
  ["expected_goals_open_play", "xG dans le jeu", "Buts attendus"],
  ["expected_goals_set_play", "xG sur phase arrêtée", "Buts attendus"],
  ["expected_goals_on_target", "xG cadrés · xGOT", "Buts attendus"],
  ["passes", "Passes tentées", "Passes"],
  ["accurate_passes", "Passes réussies", "Passes"],
  ["opposition_half_passes", "Passes dans le camp adverse", "Passes"],
  ["own_half_passes", "Passes dans son camp", "Passes"],
  ["long_balls_accurate", "Passes longues réussies", "Passes"],
  ["accurate_crosses", "Centres réussis", "Passes"],
  ["touches_opp_box", "Ballons dans la surface adverse", "Passes"],
  ["corners", "Corners", "Passes"],
  ["player_throws", "Touches", "Passes"],
  ["duel_won", "Duels gagnés", "Duels"],
  ["ground_duels_won", "Duels au sol gagnés", "Duels"],
  ["aerials_won", "Duels aériens gagnés", "Duels"],
  ["dribbles_succeeded", "Dribbles réussis", "Duels"],
  ["matchstats.headers.tackles", "Tacles", "Défense"],
  ["interceptions", "Interceptions", "Défense"],
  ["clearances", "Dégagements", "Défense"],
  ["shot_blocks", "Tirs bloqués", "Défense"],
  ["keeper_saves", "Arrêts", "Défense"],
  ["fouls", "Fautes commises", "Discipline"],
  ["yellow_cards", "Cartons jaunes", "Discipline"],
  ["red_cards", "Cartons rouges", "Discipline"],
  ["Offsides", "Hors-jeu", "Discipline"],
];
// Section order also balances the two reading columns: attack and contest on
// the left, circulation, defence and discipline on the right.
export const STAT_GROUPS = [
  "Possession",
  "Tirs",
  "Buts attendus",
  "Duels",
  "Passes",
  "Défense",
  "Discipline",
];
const known = new Map(
  definitions.map(([key, label, group], order) => [
    key,
    { label, group, order },
  ]),
);
export function matchStat(match, key, field) {
  const found = match.stats?.find((s) => s.key === key);
  return found
    ? { ...found, label: known.get(key)?.label || found.label || key }
    : {
        key,
        label: known.get(key)?.label || key,
        home: match.home?.[field] ?? null,
        away: match.away?.[field] ?? null,
      };
}
export const overviewStats = (match) => [
  matchStat(match, "expected_goals", "xg"),
  matchStat(match, "total_shots", "shots"),
  matchStat(match, "ShotsOnTarget", "shotsOnTarget"),
  matchStat(match, "BallPossesion", "possession"),
  matchStat(match, "big_chance"),
  matchStat(match, "corners"),
];
export function statValue(stat, side) {
  const value = stat[side] ?? stat[side + "Value"];
  if (!isNumber(value)) return "—";
  return (
    number(
      value,
      stat.key?.startsWith("expected_goals") || stat.format === "double"
        ? 2
        : 0,
    ) + (stat.key === "BallPossesion" ? " %" : "")
  );
}
export function groupedStats(source) {
  const items = Array.isArray(source) ? source : source?.stats || [];
  const groups = new Map(STAT_GROUPS.map((k) => [k, []])),
    seen = new Set();
  for (const stat of items) {
    if (!stat?.key || seen.has(stat.key)) continue;
    seen.add(stat.key);
    const definition = known.get(stat.key),
      group = definition?.group || "Autres indicateurs";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      ...stat,
      label: definition?.label || stat.label || stat.title || stat.key,
    });
  }
  return [...groups]
    .filter(([, rows]) => rows.length)
    .map(([title, rows]) => ({
      title,
      rows: rows.sort(
        (a, b) =>
          (known.get(a.key)?.order ?? Infinity) -
          (known.get(b.key)?.order ?? Infinity),
      ),
    }));
}

/** Flattens a source period (alphabetical groups) into stat rows. */
export function periodStats(period) {
  const numeric = (value) =>
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d/.test(value)
        ? Number.parseFloat(value)
        : null;
  return (period?.groups || []).flatMap((group) =>
    (group.items || []).map((item) => ({
      ...item,
      label: item.title || item.key,
      home: numeric(item.home),
      away: numeric(item.away),
      homeRaw: item.home,
      awayRaw: item.away,
      format: item.format_type,
    })),
  );
}

export function statPercentage(stat, side) {
  const value = stat[side] ?? stat[side + "Value"];
  const raw = stat[side + "Raw"];
  const match =
    isNumber(value) && typeof raw === "string"
      ? raw.match(/\(([\d.,]+)%\)/)
      : null;
  return match ? match[1] + " %" : null;
}
