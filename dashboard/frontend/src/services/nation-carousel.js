/**
 * A nation's matches as one carousel (mock-up B validated 20 Nov 2026): every played match, newest first, one group per
 * competition edition. A game of a major tournament takes that run's label and stage (/api/nations/{id}:
 * `tournaments`), so the 2020 Euro played in 2021 is « Euro 2020 »; another match takes its competition and season.
 */
import { competitionLabel } from "./nations.js";
import { runStage } from "./tournament-runs.js";

const DAY = 86_400_000;
const time = (date) => Date.parse(`${date}T12:00:00Z`);
const pair = (match) => [match.home?.id || match.home?.name, match.away?.id || match.away?.name].sort().join("|");
const shortSeason = (season) => String(season || "").replace(/^(\d{4})\/\d{2}(\d{2})$/, "$1/$2");

/** The played matches, the same two nations twice within a day kept once: the collected match (with its page). */
function played(matches) {
  const kept = [];
  for (const match of matches || []) {
    if (match.status !== "finished" || match.homeScore == null || match.awayScore == null || !match.date) continue;
    const twin = kept.findIndex((other) => pair(other) === pair(match) && Math.abs(time(other.date) - time(match.date)) <= DAY);
    if (twin < 0) kept.push(match);
    else if (!kept[twin].id && match.id) kept[twin] = match;
  }
  return kept.sort((a, b) => time(b.date) - time(a.date));
}

/** [{ key, label, stage, matches (newest first) }], groups newest first. */
export function matchCarousel(nation) {
  if (!nation) return [];
  const runs = new Map();
  for (const run of nation.tournaments || [])
    for (const game of run.games || []) if (game.date) runs.set(`${game.date}|${pair(game)}`, run);
  const groups = [];
  for (const match of played(nation.matches)) {
    // A tournament game: by its day, or the day before or after (an archived copy dated apart).
    const run = [0, -DAY, DAY].map((shift) => runs.get(`${new Date(time(match.date) + shift).toISOString().slice(0, 10)}|${pair(match)}`)).find(Boolean);
    const competition = competitionLabel(match);
    const label = run ? run.label : `${competition === "Match amical" ? "Matchs amicaux" : competition} ${shortSeason(match.season)}`.trim();
    const last = groups.at(-1);
    if (last && last.label === label) last.matches.push(match);
    else groups.push({ key: `${label}|${match.date}`, label, stage: run ? runStage(run) : null, matches: [match] });
  }
  return groups;
}
