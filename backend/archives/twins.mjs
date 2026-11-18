#!/usr/bin/env node
/**
 * The goal-only archive matches that are a stored result (shared/archive.js's goalTwins),
 * for vega/archives.py's merge_twins: reads {matches: [{key, competitionId, date, team1,
 * team2, score, goals}]} on stdin, prints [{goal, result, date}].
 *
 *   node backend/archives/twins.mjs < season.json
 */
import { readFileSync } from "node:fs";
import { goalTwins } from "../../dashboard/shared/archive.js";

const { matches } = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(goalTwins(matches)));
