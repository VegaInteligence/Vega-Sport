// The club's game states need each goal's minute (VI-22, handoff of the VI-23 calculation audit).
// Written before the change to services/club-game-states.js. Expected behaviour:
//
// - A goal without a minute does not count as minute 0: its match has no known chronology, so it
//   is left out of every count (time leading, first goal, comebacks, halves), like a timeline that
//   does not give the final score.
// - Without any match of known chronology, the time spent leading, level or behind is unknown
//   (null), not 0 % each.
// - A goal after the 90th minute without the source's period may be stoppage time or extra time:
//   its match keeps its chronology but leaves the halves (halfMatches counts those kept).
// - Matches whose every goal has its half keep the halves exactly as before.
import assert from "node:assert/strict";
import test from "node:test";
import { gameStates } from "../dashboard/frontend/src/services/club-game-states.js";

const CLUB = "t_club", OTHER = "t_other";
const goal = (minute, mine, extra = {}) => ({ isGoal: true, minute, teamId: mine ? CLUB : OTHER, ...extra });
const row = (gf, ga, shots) => ({ gf, ga, points: gf > ga ? 3 : gf === ga ? 1 : 0, result: gf > ga ? "V" : gf === ga ? "N" : "D", match: { shots } });

test("a goal without a minute leaves its match out of every count", () => {
  const states = gameStates([
    // 1-0 at minute 20: known.
    row(1, 0, [goal(20, true)]),
    // 1-1, the club's goal has no minute: who scored first is unknown.
    row(1, 1, [goal(null, true), goal(70, false)]),
  ], CLUB);
  assert.equal(states.matches, 1);
  assert.equal(states.halfMatches, 1);
  assert.deepEqual([states.scoredFirst.matches, states.concededFirst.matches], [1, 0]);
  assert.equal(states.pointsFromBehind, 0);
  // 20 minutes level, then 73 leading (to minute 93).
  assert.deepEqual(states.minutes, { lead: 73, level: 20, behind: 0 });
  assert.deepEqual(states.halves, { first: { gf: 1, ga: 0 }, second: { gf: 0, ga: 0 }, halfTimePoints: 3, points: 3 });
});

test("no match of known chronology: the time in each state is unknown", () => {
  const states = gameStates([row(1, 0, [goal(undefined, true)])], CLUB);
  assert.equal(states.matches, 0);
  assert.equal(states.minutes, null);
  assert.equal(states.halfMatches, 0);
});

test("a goal after the 90th minute without its period leaves the halves only", () => {
  const states = gameStates([
    row(1, 0, [goal(30, true)]),
    // 0-0 at the break, 1-0 at minute 95: stoppage time or extra time, the source does not say.
    row(1, 0, [goal(95, true)]),
  ], CLUB);
  assert.equal(states.matches, 2);
  assert.equal(states.scoredFirst.matches, 2);
  assert.equal(states.halfMatches, 1);
  assert.deepEqual(states.halves, { first: { gf: 1, ga: 0 }, second: { gf: 0, ga: 0 }, halfTimePoints: 3, points: 3 });
  assert.notEqual(states.minutes, null);
});
