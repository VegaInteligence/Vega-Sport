// A national match's scorers as the site shows them under its row (International Results, FAILURE_MODES.md §57):
// one line per side, in minute order (a minute unknown last), « Name 23′ (pen.) », « (csc) » for an own goal (the
// side it counts for). Only a complete list is shown: a partial one, or none, keeps the row as it was.

const label = (g) =>
  `${g.name || "?"}${g.minute != null ? ` ${g.minute}′` : ""}${g.ownGoal ? " (csc)" : g.penalty ? " (pen.)" : ""}`;

/** {home, away} lines of a match's `scorers` ({complete, goals}), or null when there is nothing complete to show. */
export function scorerLines(scorers) {
  if (!scorers?.complete || !Array.isArray(scorers.goals) || !scorers.goals.length) return null;
  const ordered = scorers.goals
    .map((g, i) => [g, i])
    .sort(([a, i], [b, j]) => (a.minute ?? Infinity) - (b.minute ?? Infinity) || i - j)
    .map(([g]) => g);
  const line = (side) => ordered.filter((g) => g.side === side).map(label).join(", ");
  return { home: line("home"), away: line("away") };
}
