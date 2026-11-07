import { isNumber } from "../model.js";
import { aggregateSeason } from "./season-player.js";
import { playerDateTest } from "./player-season-history.js";

function day(value) {
  const result = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(result) &&
    !Number.isNaN(Date.parse(`${result}T12:00:00Z`))
    ? result
    : null;
}
function competition(match) {
  return match?.leagueId || match?.league?.id || match?.league_id || null;
}
function sides(match) {
  return [
    match?.home?.id,
    match?.away?.id,
    match?.home_team?.id,
    match?.away_team?.id,
    match?.homeTeamId,
    match?.awayTeamId,
  ].filter(Boolean);
}
function listed(lineup, playerId) {
  return (
    lineup?.confirmed === true &&
    (lineup.starters?.includes(playerId) || lineup.subs?.includes(playerId))
  );
}
function classify(appearance, lineup, upcoming, playerId) {
  if (isNumber(appearance?.minutes) && appearance.minutes > 0) return "played";
  if (upcoming) return "upcoming";
  if (
    lineup?.unusedSubstitute === true ||
    (appearance?.minutes === 0 &&
      (appearance?.starter === false ||
        (lineup?.confirmed === true && lineup.subs?.includes(playerId))))
  )
    return "bench";
  if (appearance?.minutes === 0) return "present_zero";
  const confirmed =
    lineup?.confirmed === true &&
    Array.isArray(lineup.starters) &&
    Array.isArray(lineup.subs);
  if (
    confirmed &&
    lineup.complete === true &&
    new Set(lineup.starters).size === 11 &&
    !lineup.starters.includes(playerId) &&
    !lineup.subs.includes(playerId)
  )
    return "absent";
  if (confirmed && lineup.subs.includes(playerId)) return "substitute_unknown";
  if (confirmed && lineup.starters.includes(playerId)) return "minutes_unknown";
  if (appearance && !isNumber(appearance.minutes)) return "minutes_unknown";
  return "participation_unknown";
}

/** Returns documented observations and admitted team fixtures for one exact competition. */
export function playerCompetitionHistory(
  history,
  playerId,
  competitionId,
  evidence = [],
  period = {},
) {
  const inPeriod = playerDateTest(period);
  const observations = [],
    sources = new Map(),
    seasons = new Set();
  for (const entry of history || []) {
    const byId = new Map((entry.data?.matches || []).map((m) => [m.id, m]));
    for (const row of entry.data?.appearances || entry.profile?.rows || []) {
      if (row.playerId !== playerId || !row.matchId || !row.teamId) continue;
      const match = byId.get(row.matchId);
      const date = day(match?.date || row.date);
      if (date) observations.push({ date, teamId: row.teamId });
      if (row.leagueId !== competitionId) continue;
      const previous = sources.get(row.matchId);
      if (
        !previous ||
        (!(
          isNumber(previous.appearance?.minutes) &&
          previous.appearance.minutes > 0
        ) &&
          isNumber(row.minutes) &&
          row.minutes > 0)
      )
        sources.set(row.matchId, {
          match: match || {
            id: row.matchId,
            date: row.date,
            leagueId: row.leagueId,
          },
          season: entry.season,
          teamId: row.teamId,
          appearance: row,
          lineup: null,
        });
    }
  }
  observations.sort(
    (a, b) => a.date.localeCompare(b.date) || a.teamId.localeCompare(b.teamId),
  );
  const spells = [];
  for (const obs of observations) {
    const last = spells.at(-1);
    if (last && last.teamId === obs.teamId) last.end = obs.date;
    else spells.push({ teamId: obs.teamId, start: obs.date, end: obs.date });
  }
  for (const candidate of evidence || []) {
    const { match, teamId, appearance, season } = candidate;
    if (
      !match?.id ||
      !teamId ||
      competition(match) !== competitionId ||
      !sides(match).includes(teamId)
    )
      continue;
    const date = day(match.date || match.time_utc || match.timeUtc);
    const explicit =
      appearance?.playerId === playerId &&
      appearance?.matchId === match.id &&
      appearance?.teamId === teamId;
    const inSpell =
      date &&
      spells.some(
        (s) => s.teamId === teamId && date >= s.start && date <= s.end,
      );
    if (
      !explicit &&
      !inSpell &&
      !listed(candidate.lineup, playerId) &&
      candidate.membershipConfirmed !== true
    )
      continue;
    const prev = sources.get(match.id);
    if (prev) {
      if (prev.teamId !== teamId) continue;
      sources.set(match.id, {
        ...candidate,
        ...prev,
        match: candidate.match,
        lineup: candidate.lineup || prev.lineup,
      });
    } else
      sources.set(match.id, {
        ...candidate,
        appearance: explicit ? appearance : null,
      });
  }
  const labels = {
    played: "A joué",
    bench: "Banc, non entré",
    absent: "Hors feuille de match",
    present_zero: "Présent, 0 min",
    substitute_unknown: "Remplaçant, temps inconnu",
    minutes_unknown: "Temps de jeu inconnu",
    participation_unknown: "Participation non renseignée",
    upcoming: "À venir",
  };
  const rows = [...sources.values()]
    .map((entry) => {
      const match = entry.match;
      const upcoming =
        ["not_started", "scheduled", "upcoming"].includes(
          String(match.status || "").toLowerCase(),
        ) || match.finished === false;
      const status = classify(
        entry.appearance,
        entry.lineup,
        upcoming,
        playerId,
      );
      return {
        ...entry,
        row: entry.appearance || null,
        status,
        statusLabel: labels[status],
      };
    })
    .filter((entry) => inPeriod(entry.appearance?.date || entry.match.date))
    .sort(
      (a, b) =>
        String(b.match?.date || b.appearance?.date || "").localeCompare(
          String(a.match?.date || a.appearance?.date || ""),
        ) || String(a.match.id).localeCompare(String(b.match.id)),
    );
  const grouped = new Map();
  for (const item of rows) {
    if (item.season) seasons.add(item.season);
    const key = JSON.stringify([item.season, item.teamId]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const sections = [...grouped].map(([key, items]) => {
    const first = items[0];
    const seasonEntry = (history || []).find(
      (entry) => entry.season === first.season,
    );
    const team = seasonEntry?.data?.teams?.find(
      (value) => value.id === first.teamId,
    ) ||
      [
        first.match.home,
        first.match.away,
        first.match.home_team,
        first.match.away_team,
      ].find((value) => value?.id === first.teamId) || {
        id: first.teamId,
        name: first.appearance?.team || "Équipe inconnue",
      };
    const comp = seasonEntry?.data?.competitions?.find(
      (value) => value.id === competitionId,
    ) || {
      id: competitionId,
      name:
        first.appearance?.league || first.match.league?.name || "Compétition",
    };
    const groupProfile = aggregateSeason(
      items.filter((item) => item.appearance).map((item) => item.appearance),
      playerId,
    );
    const entry = {
      key: competitionId,
      competition: comp,
      profile: groupProfile,
    };
    const cardMatchIds = items
      .filter((item) => item.appearance || listed(item.lineup, playerId))
      .map((item) => item.match.id);
    const group = {
      key,
      season: first.season,
      team,
      profile: groupProfile,
      competitions: [entry],
      cardMatchIds,
    };
    return { group, entry, rows: items };
  });
  return {
    competitionId,
    seasons: [...seasons].sort().reverse(),
    rows,
    sections,
    groups: sections.map((section) => section.group),
    profile: aggregateSeason(
      rows.filter((r) => r.appearance).map((r) => r.appearance),
      playerId,
    ),
    spells,
  };
}
