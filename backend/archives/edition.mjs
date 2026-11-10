#!/usr/bin/env node
/**
 * One archive season edition, built by main's own shared/archive.js from a results
 * file and a goals file of main's archive builders (either may be "-": absent).
 * Prints {season, competitions, matches} as JSON; the importer (vega/archives.py)
 * reads it from stdout and never stores it.
 *
 *   node backend/archives/edition.mjs <results.json.gz|-> <goals.json.gz|->
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildArchiveSeason, teamSimilarity } from "../../dashboard/shared/archive.js";

const read = (path) => (path && path !== "-" ? JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) : null);
const [resultsPath, goalsPath] = process.argv.slice(2);
const edition = buildArchiveSeason(read(resultsPath), read(goalsPath));
// The side a goal's team designates, compared as the archive page compares it.
const side = (goal, match) => {
  const home = teamSimilarity(goal.team, match.team1),
    away = teamSimilarity(goal.team, match.team2);
  return home > away ? "home" : away > home ? "away" : null;
};
const matches = edition.matches.map(({ raw, ...match }) => ({
  ...match,
  goals: match.goals ? match.goals.map((goal) => ({ ...goal, side: side(goal, match) })) : null,
  // The typed facts of the results record that the edition's notes come from.
  source: raw
    ? {
        status: raw.status ?? null,
        ft: raw.score?.ft ?? null,
        et: raw.score?.et ?? null,
        p: raw.score?.p ?? null,
        neutral: String(raw.sourceFields?.neutral ?? "").toLowerCase() === "yes",
        nonmatch: raw.sourceFields?.nonmatch ?? null,
      }
    : null,
}));
process.stdout.write(JSON.stringify({ season: edition.season, competitions: edition.competitions, matches }));
