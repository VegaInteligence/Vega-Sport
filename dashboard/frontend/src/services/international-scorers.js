// A national match's scorers as the site shows them under its row (International Results, FAILURE_MODES.md §57):
// one line per side, in minute order (a minute unknown last), « Name 23′ (pen.) », « (csc) » for an own goal (the
// side it counts for). A player who scores several times is named once, with each of his minutes: « Name 57′, 63′ ».
// Only a complete list is shown: a partial one, or none, keeps the row as it was.

const minuteLabel = (g) => `${g.minute}′${g.ownGoal ? " (csc)" : g.penalty ? " (pen.)" : ""}`;

function sideLine(goals) {
  // One entry per scorer, at the place of his first goal; a goal without a minute or a name stays on its own.
  const entries = [];
  const byScorer = new Map();
  for (const g of goals) {
    const key = g.name && g.minute != null ? `${g.ownGoal ? "csc" : "but"}:${g.name}` : null;
    if (key && byScorer.has(key)) {
      byScorer.get(key).minutes.push(minuteLabel(g));
      continue;
    }
    const entry = { name: g.name || "?", minutes: g.minute != null ? [minuteLabel(g)] : [], suffix: g.minute != null ? "" : g.ownGoal ? " (csc)" : g.penalty ? " (pen.)" : "" };
    entries.push(entry);
    if (key) byScorer.set(key, entry);
  }
  return entries.map((e) => `${e.name}${e.minutes.length ? ` ${e.minutes.join(", ")}` : ""}${e.suffix}`).join(", ");
}

/** {home, away} lines of a match's `scorers` ({complete, goals}), or null when there is nothing complete to show. */
export function scorerLines(scorers) {
  if (!scorers?.complete || !Array.isArray(scorers.goals) || !scorers.goals.length) return null;
  const ordered = scorers.goals
    .map((g, i) => [g, i])
    .sort(([a, i], [b, j]) => (a.minute ?? Infinity) - (b.minute ?? Infinity) || i - j)
    .map(([g]) => g);
  const line = (side) => sideLine(ordered.filter((g) => g.side === side));
  return { home: line("home"), away: line("away") };
}

/** Both sides on one line, home first: « A 12′ – B 70′ ». A side without a goal is left out (the score says whose). */
export function scorerLine(scorers) {
  const lines = scorerLines(scorers);
  return lines ? [lines.home, lines.away].filter(Boolean).join(" – ") : null;
}
