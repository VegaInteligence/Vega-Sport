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
import { buildArchiveSeason } from "../../dashboard/shared/archive.js";

const read = (path) => (path && path !== "-" ? JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) : null);
const [resultsPath, goalsPath] = process.argv.slice(2);
const edition = buildArchiveSeason(read(resultsPath), read(goalsPath));
// Each goal carries the side shared/archive.js gave it (goalSide: the side named exactly first; a held row's
// published side), FAILURE_MODES.md §22.
const matches = edition.matches.map(({ raw, ...match }) => ({
  ...match,
  goals: match.goals ? match.goals.map((goal) => ({ ...goal, side: goal.side ?? null })) : null,
  // A side of the appearance-ordinal feed (build_footballcsv_history.py): never a team of its own.
  ...(raw?.sides && { sides: raw.sides }),
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
process.stdout.write(JSON.stringify({ season: edition.season, competitions: edition.competitions, matches, absorbed: edition.absorbed, held: edition.held }));
