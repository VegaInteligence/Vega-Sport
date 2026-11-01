import { isNumber, number } from "./format.js";
const definitions = [
  ["expected_goals", "Buts attendus · xG", "Occasions & finition"],
  ["expected_goals_non_penalty", "xG hors penalty", "Occasions & finition"],
  ["expected_goals_on_target", "xG cadrés · xGOT", "Occasions & finition"],
  ["expected_goals_open_play", "xG dans le jeu", "Occasions & finition"],
  ["expected_goals_set_play", "xG sur phase arrêtée", "Occasions & finition"],
  ["total_shots", "Tirs", "Occasions & finition"],
  ["ShotsOnTarget", "Tirs cadrés", "Occasions & finition"],
  ["ShotsOffTarget", "Tirs non cadrés", "Occasions & finition"],
  ["blocked_shots", "Tirs contrés", "Occasions & finition"],
  ["shots_inside_box", "Tirs dans la surface", "Occasions & finition"],
  ["shots_outside_box", "Tirs hors surface", "Occasions & finition"],
  ["shots_woodwork", "Montants touchés", "Occasions & finition"],
  ["big_chance", "Grosses occasions", "Occasions & finition"],
  [
    "big_chance_missed_title",
    "Grosses occasions manquées",
    "Occasions & finition",
  ],
  ["dribbles_succeeded", "Dribbles réussis", "Occasions & finition"],
  ["BallPossesion", "Possession", "Construction & maîtrise"],
  ["passes", "Passes tentées", "Construction & maîtrise"],
  ["accurate_passes", "Passes réussies", "Construction & maîtrise"],
  ["long_balls_accurate", "Passes longues réussies", "Construction & maîtrise"],
  [
    "opposition_half_passes",
    "Passes dans le camp adverse",
    "Construction & maîtrise",
  ],
  ["own_half_passes", "Passes dans son camp", "Construction & maîtrise"],
  ["accurate_crosses", "Centres réussis", "Construction & maîtrise"],
  ["player_throws", "Touches", "Construction & maîtrise"],
  [
    "touches_opp_box",
    "Ballons dans la surface adverse",
    "Construction & maîtrise",
  ],
  ["corners", "Corners", "Construction & maîtrise"],
  ["duel_won", "Duels gagnés", "Duels & défense"],
  ["aerials_won", "Duels aériens gagnés", "Duels & défense"],
  ["ground_duels_won", "Duels au sol gagnés", "Duels & défense"],
  ["matchstats.headers.tackles", "Tacles", "Duels & défense"],
  ["interceptions", "Interceptions", "Duels & défense"],
  ["clearances", "Dégagements", "Duels & défense"],
  ["shot_blocks", "Tirs bloqués", "Duels & défense"],
  ["keeper_saves", "Arrêts", "Duels & défense"],
  ["fouls", "Fautes commises", "Discipline"],
  ["yellow_cards", "Cartons jaunes", "Discipline"],
  ["red_cards", "Cartons rouges", "Discipline"],
  ["Offsides", "Hors-jeu", "Discipline"],
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
export function groupedStats(match) {
  const groups = new Map(
    [
      "Occasions & finition",
      "Construction & maîtrise",
      "Duels & défense",
      "Discipline",
    ].map((k) => [k, []]),
  );
  for (const stat of match.stats || []) {
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

export function statPercentage(stat, side) {
  const value = stat[side] ?? stat[side + "Value"];
  const raw = stat[side + "Raw"];
  const match =
    isNumber(value) && typeof raw === "string"
      ? raw.match(/\(([\d.,]+)%\)/)
      : null;
  return match ? match[1] + " %" : null;
}
