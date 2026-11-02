import { isNumber } from "./format.js";
import { percentile } from "./player-profile.js";
import { aggregateSeasonPlayers } from "./season-player.js";

export const CLUB_METRICS = {
  pointsPerMatch: { label: "Points / match", result: true },
  goalsFor: { label: "Buts marqués / match", result: true },
  goalsAgainst: {
    label: "Buts encaissés / match",
    result: true,
    lowerIsBetter: true,
  },
  xgFor: { label: "xG pour / match" },
  xgAgainst: { label: "xG contre / match", lowerIsBetter: true },
  xgDifference: { label: "Différence xG / match" },
  shotsFor: { label: "Tirs pour / match" },
  shotsAgainst: { label: "Tirs contre / match", lowerIsBetter: true },
  shotsOnTarget: { label: "Tirs cadrés / match" },
  possession: { label: "Possession", unit: "%" },
  passes: { label: "Passes tentées / match" },
  passesAccurate: { label: "Passes réussies / match" },
  touchesBox: { label: "Ballons dans la surface / match" },
  corners: { label: "Corners / match" },
  duelsWon: { label: "Duels gagnés / match" },
  aerialsWon: { label: "Duels aériens gagnés / match" },
  tackles: { label: "Tacles / match" },
  interceptions: { label: "Interceptions / match" },
  clearances: { label: "Dégagements / match" },
  saves: { label: "Arrêts / match" },
};
const STAT_KEYS = {
  xgFor: ["expected_goals", "xg"],
  shotsFor: ["total_shots", "shots"],
  shotsOnTarget: ["ShotsOnTarget", "shotsOnTarget"],
  possession: ["BallPossesion", "possession"],
  passes: ["passes"],
  passesAccurate: ["accurate_passes"],
  touchesBox: ["touches_opp_box"],
  corners: ["corners"],
  duelsWon: ["duel_won"],
  aerialsWon: ["aerials_won"],
  tackles: ["matchstats.headers.tackles"],
  interceptions: ["interceptions"],
  clearances: ["clearances"],
  saves: ["keeper_saves"],
};
export const CLUB_STYLE_KEYS = [
  "xgFor",
  "xgAgainst",
  "shotsFor",
  "shotsAgainst",
  "possession",
  "passesAccurate",
  "touchesBox",
  "duelsWon",
  "tackles",
  "interceptions",
];
const cache = new WeakMap();
const kickoff = (match) =>
  Date.parse(match.timeUtc || match.time_utc || "") || null;
export function beforeMatch(candidate, reference) {
  const a = kickoff(candidate),
    b = kickoff(reference);
  return a && b
    ? a < b
    : Boolean(
        candidate.date && reference.date && candidate.date < reference.date,
      );
}
export function normalizedFixture(match) {
  return match.home
    ? match
    : {
        ...match,
        leagueId: match.league?.id,
        league: match.league?.name,
        timeUtc: match.time_utc,
        home: {
          ...match.home_team,
          imageUrl: match.home_team?.image_url,
          score: match.score_home,
        },
        away: {
          ...match.away_team,
          imageUrl: match.away_team?.image_url,
          score: match.score_away,
        },
      };
}
export function clubMatchIndex(data) {
  if (cache.has(data)) return cache.get(data);
  const matches = new Map();
  for (const raw of [...(data.fixtures || []), ...(data.matches || [])]) {
    const match = normalizedFixture(raw);
    if (!match.id || !match.home?.id || !match.away?.id) continue;
    const previous = matches.get(match.id);
    matches.set(
      match.id,
      previous
        ? {
            ...previous,
            ...match,
            home: {
              ...previous.home,
              ...match.home,
              score: match.home.score ?? previous.home.score,
            },
            away: {
              ...previous.away,
              ...match.away,
              score: match.away.score ?? previous.away.score,
            },
          }
        : match,
    );
  }
  const byClub = new Map();
  for (const match of matches.values())
    for (const team of [match.home, match.away]) {
      if (!byClub.has(team.id)) byClub.set(team.id, []);
      byClub.get(team.id).push(match);
    }
  const value = { matches: [...matches.values()], byClub };
  cache.set(data, value);
  return value;
}
const newRecord = () => ({
  matches: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  cleanSheets: 0,
});
function addResult(record, own, against) {
  record.matches++;
  record.goalsFor += own;
  record.goalsAgainst += against;
  if (against === 0) record.cleanSheets++;
  if (own > against) {
    record.wins++;
    record.points += 3;
  } else if (own === against) {
    record.draws++;
    record.points++;
  } else record.losses++;
}
function observedStat(match, side, key, field) {
  const row = match.stats?.find((stat) => stat.key === key);
  const value = row?.[side] ?? (field ? match[side]?.[field] : null);
  return isNumber(value) ? value : null;
}
function addStat(stats, key, value) {
  if (!isNumber(value)) return;
  const stat = (stats[key] ||= { sum: 0, count: 0 });
  stat.sum += value;
  stat.count++;
}
export function clubSummary(
  data,
  clubId,
  { competition = "all", before = null } = {},
) {
  const games = (clubMatchIndex(data).byClub.get(clubId) || []).filter(
    (m) =>
      (competition === "all" || m.leagueId === competition) &&
      (!before || beforeMatch(m, before)),
  );
  const record = newRecord(),
    home = newRecord(),
    away = newRecord(),
    stats = {},
    forms = [],
    formations = new Map();
  let excludedStats = 0,
    unscored = 0;
  const identity =
    games[0] && (games[0].home.id === clubId ? games[0].home : games[0].away);
  const times = {
    for: Array(6).fill(0),
    against: Array(6).fill(0),
    observed: 0,
  };
  const shots = [];
  for (const match of games) {
    if (match.status !== "finished") continue;
    const side = match.home.id === clubId ? "home" : "away",
      opponent = side === "home" ? "away" : "home";
    const own = match[side].score,
      other = match[opponent].score;
    if (!(
      Number.isInteger(own) &&
      own >= 0 &&
      Number.isInteger(other) &&
      other >= 0
    )) {
      unscored++;
      continue;
    }
    addResult(record, own, other);
    addResult(side === "home" ? home : away, own, other);
    forms.push({
      match,
      result: own > other ? "V" : own === other ? "N" : "D",
      scoreFor: own,
      scoreAgainst: other,
      side,
    });
    const formation = match[side].formation;
    if (formation)
      formations.set(formation, (formations.get(formation) || 0) + 1);
    if (match.coverage?.teamStatsReliable === false) excludedStats++;
    else {
      for (const [name, [key, field]] of Object.entries(STAT_KEYS))
        addStat(stats, name, observedStat(match, side, key, field));
      const xgFor = observedStat(match, side, "expected_goals", "xg"),
        xgAgainst = observedStat(match, opponent, "expected_goals", "xg");
      addStat(stats, "xgAgainst", xgAgainst);
      addStat(
        stats,
        "shotsAgainst",
        observedStat(match, opponent, "total_shots", "shots"),
      );
      if (isNumber(xgFor) && isNumber(xgAgainst))
        addStat(stats, "xgDifference", xgFor - xgAgainst);
    }
    for (const shot of match.shots || []) {
      if (![clubId, match[opponent].id].includes(shot.teamId)) continue;
      shots.push({
        ...shot,
        matchId: match.id,
        date: match.date,
        season: match.season,
        leagueId: match.leagueId,
        forClub: shot.teamId === clubId,
      });
      if (shot.isGoal && !shot.isOwnGoal && isNumber(shot.minute)) {
        times[shot.teamId === clubId ? "for" : "against"][
          Math.min(5, Math.max(0, Math.floor((shot.minute - 0.01) / 15)))
        ]++;
        times.observed++;
      }
    }
  }
  forms.sort((a, b) =>
    String(b.match.timeUtc || b.match.date).localeCompare(
      String(a.match.timeUtc || a.match.date),
    ),
  );
  return {
    id: clubId,
    name:
      identity?.name ||
      data.teams?.find((t) => t.id === clubId)?.name ||
      "Club",
    imageUrl: identity?.imageUrl,
    ...record,
    home,
    away,
    stats,
    forms,
    games,
    formations: [...formations].sort((a, b) => b[1] - a[1]),
    excludedStats,
    unscored,
    shots,
    goalTimes: times,
  };
}
export function allClubSummaries(data, options) {
  return [...clubMatchIndex(data).byClub.keys()]
    .map((id) => clubSummary(data, id, options))
    .filter((c) => c.matches > 0);
}
export function clubMetric(club, key) {
  if (!club?.matches) return { value: null, count: 0 };
  if (CLUB_METRICS[key]?.result)
    return {
      value:
        key === "pointsPerMatch"
          ? club.points / club.matches
          : club[key] / club.matches,
      count: club.matches,
    };
  const stat = club.stats[key];
  return {
    value: stat?.count ? stat.sum / stat.count : null,
    count: stat?.count || 0,
  };
}
export function clubStyleCohort(clubs) {
  const distributions = {};
  for (const club of clubs)
    if (club.matches >= 3)
      for (const key of Object.keys(CLUB_METRICS)) {
        const value = clubMetric(club, key);
        if (isNumber(value.value) && value.count / club.matches >= 0.8)
          (distributions[key] ||= []).push(value.value);
      }
  for (const values of Object.values(distributions))
    values.sort((a, b) => a - b);
  return distributions;
}
export function clubCentile(club, key, cohort) {
  const stat = clubMetric(club, key),
    values = cohort[key] || [];
  return club.matches >= 3 &&
    stat.count / club.matches >= 0.8 &&
    values.length >= 10
    ? percentile(values, stat.value)
    : null;
}
export function similarClubs(target, clubs, cohort, limit = 6) {
  const required = Math.max(
    5,
    Math.ceil(
      CLUB_STYLE_KEYS.filter((key) => clubCentile(target, key, cohort) != null)
        .length * 0.75,
    ),
  );
  return clubs
    .filter((c) => c.id !== target.id)
    .flatMap((club) => {
      const parts = CLUB_STYLE_KEYS.flatMap((key) => {
        const own = clubCentile(target, key, cohort),
          other = clubCentile(club, key, cohort);
        return own == null || other == null
          ? []
          : [
              {
                key,
                target: clubMetric(target, key).value,
                other: clubMetric(club, key).value,
                distance: Math.abs(own - other),
              },
            ];
      });
      return parts.length < required
        ? []
        : [
            {
              club,
              similarity:
                100 -
                parts.reduce((sum, p) => sum + p.distance, 0) / parts.length,
              parts: parts.sort((a, b) => a.distance - b.distance),
            },
          ];
    })
    .sort(
      (a, b) =>
        b.similarity - a.similarity || a.club.id.localeCompare(b.club.id),
    )
    .slice(0, limit);
}
export function clubSquad(data, club, options = {}) {
  const valid = new Set(
    club.games.filter((m) => m.status === "finished").map((m) => m.id),
  );
  const rows = data.appearances.filter(
    (row) => row.teamId === club.id && valid.has(row.matchId),
  );
  const profiles = aggregateSeasonPlayers(rows).sort(
    (a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "fr"),
  );
  const lineups = new Map();
  for (const row of rows)
    if (row.starter === true) {
      if (!lineups.has(row.matchId)) lineups.set(row.matchId, new Set());
      lineups.get(row.matchId).add(row.playerId);
    }
  const known = club.forms
    .slice()
    .reverse()
    .flatMap((form) =>
      lineups.get(form.match.id)?.size === 11
        ? [lineups.get(form.match.id)]
        : [],
    );
  let continuity = 0;
  for (let i = 1; i < known.length; i++)
    continuity += [...known[i]].filter((id) => known[i - 1].has(id)).length;
  const totalMinutes = profiles.reduce((sum, p) => sum + p.minutes, 0);
  return {
    profiles,
    used: profiles.filter((p) => p.matches > 0).length,
    totalMinutes,
    lineupMatches: known.length,
    transitions: Math.max(0, known.length - 1),
    continuity: known.length > 1 ? continuity / (known.length - 1) : null,
    topElevenMinuteShare: totalMinutes
      ? (profiles.slice(0, 11).reduce((sum, p) => sum + p.minutes, 0) /
          totalMinutes) *
        100
      : null,
  };
}

/** Competitions the club played this season, most played first. */
export function clubCompetitions(data, clubId) {
  const counts = new Map();
  for (const match of clubMatchIndex(data).byClub.get(clubId) || []) {
    if (!match.leagueId) continue;
    const entry = counts.get(match.leagueId) || {
      id: match.leagueId,
      name: match.league || match.leagueId,
      matches: 0,
      finished: 0,
    };
    entry.matches++;
    if (match.status === "finished") entry.finished++;
    counts.set(match.leagueId, entry);
  }
  return [...counts.values()].sort(
    (a, b) => b.finished - a.finished || a.name.localeCompare(b.name, "fr"),
  );
}
export function upcomingClubMatches(club, now = Date.now(), limit = 3) {
  return club.games
    .filter((m) => m.status === "not_started")
    .filter((m) => {
      const time = Date.parse(m.timeUtc || m.date || "");
      return !Number.isFinite(time) || time >= now - 3 * 3600000;
    })
    .sort((a, b) =>
      String(a.timeUtc || a.date).localeCompare(String(b.timeUtc || b.date)),
    )
    .slice(0, limit);
}
/** Results by formation: only matches whose formation the source gives. */
export function formationRecords(club) {
  const records = new Map();
  for (const form of club.forms) {
    const formation = form.match[form.side]?.formation;
    if (!formation) continue;
    const record = records.get(formation) || {
      formation,
      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    };
    record.matches++;
    record.goalsFor += form.scoreFor;
    record.goalsAgainst += form.scoreAgainst;
    if (form.result === "V") record.wins++;
    else if (form.result === "N") record.draws++;
    else record.losses++;
    records.set(formation, record);
  }
  return [...records.values()].sort((a, b) => b.matches - a.matches);
}
/** Centile oriented so that a higher value always reads "more favourable". */
export function orientedCentile(club, key, cohort) {
  const value = clubCentile(club, key, cohort);
  return value == null
    ? null
    : CLUB_METRICS[key]?.lowerIsBetter
      ? 100 - value
      : value;
}
export function cohortMedian(cohort, key) {
  const values = cohort[key] || [];
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}
/** Season meetings between two clubs, newest first. */
export function headToHead(data, a, b) {
  return (clubMatchIndex(data).byClub.get(a) || [])
    .filter(
      (m) =>
        (m.home.id === b || m.away.id === b) &&
        m.status === "finished" &&
        isNumber(m.home.score) &&
        isNumber(m.away.score),
    )
    .sort((x, y) =>
      String(y.timeUtc || y.date).localeCompare(String(x.timeUtc || x.date)),
    );
}
