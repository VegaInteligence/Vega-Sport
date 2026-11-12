/**
 * One sentence on two teams' past meetings, for a match preview: a run of wins, of draws,
 * or of meetings without a win, read from the meetings the base holds (newest first).
 * Nothing is said below MIN_RUN meetings in a row: two results are not a habit.
 */
export const MIN_RUN = 3;

const winner = (meeting) =>
  meeting.home.score === meeting.away.score
    ? null
    : meeting.home.score > meeting.away.score
      ? meeting.home.id
      : meeting.away.id;

function run(meetings, test) {
  let length = 0;
  for (const meeting of meetings) {
    if (!test(winner(meeting))) break;
    length++;
  }
  return length;
}

export function headToHeadNote(meetings, home, away) {
  const played = (meetings || []).filter(
    (m) => Number.isFinite(m?.home?.score) && Number.isFinite(m?.away?.score),
  );
  if (played.length < MIN_RUN || !home?.id || !away?.id) return null;
  const sides = [
    [home, away],
    [away, home],
  ];
  for (const [team, other] of sides) {
    const wins = run(played, (id) => id === team.id);
    if (wins >= MIN_RUN)
      return `${team.name} reste sur ${wins} victoires de suite contre ${other.name}.`;
  }
  const draws = run(played, (id) => id === null);
  if (draws >= MIN_RUN)
    return `Les ${draws} dernières confrontations se sont terminées sur un nul.`;
  // The longer run first; the home side when both are as long.
  const winless = sides
    .map(([team, other]) => [run(played, (id) => id !== team.id), team, other])
    .sort((a, b) => b[0] - a[0])[0];
  const [length, team, other] = winless;
  if (length < MIN_RUN) return null;
  return length === played.length
    ? `${team.name} n’a battu ${other.name} dans aucune des ${length} confrontations collectées.`
    : `${team.name} n’a plus battu ${other.name} depuis ${length} confrontations.`;
}
