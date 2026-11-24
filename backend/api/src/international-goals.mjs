/**
 * The scorers of International Results' national matches (sql/172, FAILURE_MODES.md §57), as the nation page and the
 * cup editions serve them: `scorers: {complete, goals}` on a match with goals, the goals in minute order (a minute
 * unknown last, then the file's order). `complete`: each side's goals equal its score; the site shows only a complete
 * list. A linked scorer carries his player's public id.
 */
const goalOf = (r) => {
  const goal = { side: r.side, name: r.scorer, minute: r.minute, penalty: r.penalty, ownGoal: r.own_goal };
  if (r.assist) goal.assist = r.assist;
  if (r.player_id) goal.player = r.player_id;
  return goal;
};

/** Map(key → {complete, goals}) of the rows of api.international_goals, keyed by `keyOf(row)`. */
export function scorersBy(rows, keyOf) {
  const out = new Map();
  const sorted = [...rows].sort((a, b) => (a.minute ?? Infinity) - (b.minute ?? Infinity) || a.position - b.position);
  for (const r of sorted) {
    const key = keyOf(r);
    if (!out.has(key)) out.set(key, { complete: r.complete === true, goals: [] });
    out.get(key).goals.push(goalOf(r));
  }
  return out;
}

export const withScorers = (match, scorers) => (scorers ? { ...match, scorers } : match);
