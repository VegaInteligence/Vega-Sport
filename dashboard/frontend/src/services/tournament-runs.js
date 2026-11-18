/**
 * A nation's runs in the major tournaments (/api/nations/{id}: `tournaments`) as the nation's page shows them: by
 * competition, each run with the depth its gauge fills and the competition's own medals. A medal is counted in the
 * competition it was won in: the editions the base does not hold (the Euros before 2020) are never implied by another
 * competition's count.
 */

/** The gauge's steps: first round, round of 32 or 16, quarter-finals, semi-finals, final, title. */
export const RUN_STEPS = 6;

// The stages the API names (backend/api/src/routes/nations.mjs: STAGES).
const DEPTH = { "1er tour": 1, "16es": 2, "8es": 2, Quarts: 3, Demi: 4, "3e": 4, "4e": 4, "Match 3e place": 4, Finale: 5, Finaliste: 5, Vainqueur: 6 };

/** How far a run went, 1 to RUN_STEPS; a stage the page does not know counts as the first round, never as a title. */
export const runDepth = (run) => DEPTH[run?.stage] || 1;

// The World Cup first, the Euro second, the other tournaments in the order they come.
const ORDER = ["world-cup", "euro"];

/** The runs by competition: [{ tournament, label, runs (oldest first), medals: { gold, silver, bronze } }]. */
export function runsByTournament(runs) {
  const groups = new Map();
  for (const run of runs || []) {
    if (!groups.has(run.tournament))
      groups.set(run.tournament, { tournament: run.tournament, label: String(run.label || "").replace(/\s+\d{4}$/, ""), runs: [], medals: { gold: 0, silver: 0, bronze: 0 } });
    const group = groups.get(run.tournament);
    group.runs.push(run);
    if (run.tone in group.medals) group.medals[run.tone]++;
  }
  const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  return [...groups.values()]
    .map((group) => ({ ...group, runs: [...group.runs].sort((a, b) => a.year - b.year) }))
    .sort((a, b) => rank(a.tournament) - rank(b.tournament));
}
