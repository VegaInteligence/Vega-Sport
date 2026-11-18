import { stageKind, UNKNOWN_STAGE_LABEL } from "../../../shared/tournament-stages.js";

/**
 * A nation's runs in the major tournaments (/api/nations/{id}: `tournaments`) as the nation's page shows them: by
 * competition, each run with the depth its gauge fills and the competition's own medals. A medal is counted in the
 * competition it was won in: the editions the base does not hold (the Euros before 2020) are never implied by another
 * competition's count.
 */

/** The gauge's steps: first round, round of 32 or 16, quarter-finals, semi-finals, final, title. */
export const RUN_STEPS = 6;

// The stages the API names (backend/api/src/routes/nations.mjs: STAGES).
const DEPTH = { "1er tour": 1, "16es": 2, "8es": 2, Quarts: 3, Demi: 4, "3e": 4, "Poule finale": 4, "2e": 5, "4e": 4, "Match 3e place": 4, Finale: 5, Finaliste: 5, Vainqueur: 6 };

/** Older API responses called unclassified rounds the first round. */
export function runStage(run) {
  const games = run?.games;
  if (Array.isArray(games)) {
    const latest = games.findLast((game) => game.status !== "canceled");
    const stage = stageKind(latest?.round);
    // The API's dated history is sorted chronologically. An undated summary can only corroborate that a round exists.
    const hasRound = latest?.date ? stage !== "unknown" : games.some((game) => game.status !== "canceled" && stageKind(game.round) !== "unknown");
    if (!hasRound) return UNKNOWN_STAGE_LABEL;
    if (stage === "final-pool" && run.stage === "1er tour") return "Poule finale";
  }
  return Object.hasOwn(DEPTH, run?.stage) ? run.stage : UNKNOWN_STAGE_LABEL;
}

export const runDepth = (run) => DEPTH[runStage(run)] || 0;
export const runTone = (run) => runDepth(run) > 0 ? run.tone : undefined;

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
    const tone = runTone(run);
    if (Object.hasOwn(group.medals, tone)) group.medals[tone]++;
  }
  const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  return [...groups.values()]
    .map((group) => ({ ...group, runs: [...group.runs].sort((a, b) => a.year - b.year) }))
    .sort((a, b) => rank(a.tournament) - rank(b.tournament));
}
