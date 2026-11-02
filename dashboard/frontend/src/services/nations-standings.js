const compareTuple = (a, b) => {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return b[index] - a[index];
  return 0;
};
function splitBy(rows, tuple) {
  const sorted = [...rows].sort((a, b) => compareTuple(tuple(a), tuple(b)) || a.name.localeCompare(b.name, "fr"));
  const groups = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (!last || compareTuple(tuple(last[0]), tuple(row)) !== 0) groups.push([row]);
    else last.push(row);
  }
  return groups;
}
function headToHead(rows, matches) {
  if (rows.length < 2) return [rows];
  const ids = new Set(rows.map((row) => row.id));
  const mini = new Map(rows.map((row) => [row.id, { points: 0, goals: 0, against: 0 }]));
  for (const match of matches) {
    if (match.status !== "finished" || !match.score || !ids.has(match.homeId) || !ids.has(match.awayId)) continue;
    const home = mini.get(match.homeId), away = mini.get(match.awayId), [h, a] = match.score;
    home.goals += h; home.against += a; away.goals += a; away.against += h;
    home.points += h > a ? 3 : h === a ? 1 : 0; away.points += a > h ? 3 : h === a ? 1 : 0;
  }
  const split = splitBy(rows, (row) => { const m = mini.get(row.id); return [m.points, m.goals - m.against, m.goals]; });
  if (split.length > 1) return split.flatMap((part) => part.length > 1 ? headToHead(part, matches) : [part]);
  return splitBy(rows, (row) => [row.goals - row.against, row.goals, row.awayGoals, row.wins, row.awayWins]);
}

/** League A groups from completed source fixtures; unresolved final ties stay tied. */
export function nationsStandings(matches) {
  const groups = new Map();
  for (const match of matches || []) {
    if (!match.group || !match.homeId || !match.awayId) continue;
    if (!groups.has(match.group)) groups.set(match.group, { teams: new Map(), matches: [] });
    const group = groups.get(match.group);
    for (const [id, name] of [[match.homeId, match.home], [match.awayId, match.away]]) {
      if (!group.teams.has(id)) group.teams.set(id, { id, name, played: 0, wins: 0, draws: 0, losses: 0, goals: 0, against: 0, awayGoals: 0, awayWins: 0, points: 0 });
    }
    group.matches.push(match);
    if (match.status !== "finished" || !match.score) continue;
    const h = group.teams.get(match.homeId), a = group.teams.get(match.awayId), [hs, as] = match.score;
    h.played++; a.played++; h.goals += hs; h.against += as; a.goals += as; a.against += hs; a.awayGoals += as;
    if (hs > as) { h.wins++; a.losses++; h.points += 3; }
    else if (as > hs) { a.wins++; h.losses++; a.points += 3; a.awayWins++; }
    else { h.draws++; a.draws++; h.points++; a.points++; }
  }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([group, data]) => {
    const pointGroups = splitBy([...data.teams.values()], (team) => [team.points]);
    const ranks = pointGroups.flatMap((part) => headToHead(part, data.matches));
    let position = 1;
    const rows = ranks.flatMap((part) => { const start = position; position += part.length; return part.map((team) => ({ ...team, position: start, tied: part.length > 1, difference: team.goals - team.against })); });
    return { group, rows, unresolved: ranks.some((part) => part.length > 1) };
  });
}
