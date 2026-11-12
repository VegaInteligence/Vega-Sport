import assert from "node:assert/strict";
import test from "node:test";
import { gameStates } from "../dashboard/frontend/src/services/club-game-states.js";

const CLUB = "t_club", OTHER = "t_other";
const goal = (minute, mine, extra = {}) => ({ isGoal: true, minute, teamId: mine ? CLUB : OTHER, ...extra });
const row = (gf, ga, shots) => ({ gf, ga, points: gf > ga ? 3 : gf === ga ? 1 : 0, result: gf > ga ? "V" : gf === ga ? "N" : "D", match: { shots } });

test("a club's goals by half and the points its half-time scores would give", () => {
  const states = gameStates([
    // 2-0 at the break, 2-2 at the end: a second half lost.
    row(2, 2, [goal(10, true), goal(45, true, { minuteAdded: 3 }), goal(60, false), goal(88, false)]),
    // 0-1 at the break, 2-1 at the end; the source's period wins over the minute.
    row(2, 1, [goal(44, false), goal(46, true, { period: "second_half" }), goal(90, true, { minuteAdded: 4, period: "second_half" })]),
    // An own goal by the opponent counts for the club.
    row(1, 0, [{ isOwnGoal: true, minute: 30, teamId: OTHER }]),
    // A timeline that does not give the final score is left out of every count.
    row(3, 0, [goal(5, true)]),
  ], CLUB);
  assert.equal(states.matches, 3);
  assert.deepEqual(states.halves, { first: { gf: 3, ga: 1 }, second: { gf: 2, ga: 2 }, halfTimePoints: 6, points: 7 });
});

test("a goal in extra time belongs to neither half", () => {
  const states = gameStates([row(1, 0, [goal(105, true, { period: "extra_time" })])], CLUB);
  assert.deepEqual([states.halves.first, states.halves.second, states.halves.halfTimePoints], [{ gf: 0, ga: 0 }, { gf: 0, ga: 0 }, 1]);
});
