// The scorers of the national matches from International Results (goalscorers.csv), FAILURE_MODES.md §57, written
// before the code.
//
// 57r: parseGoalscorers reads the file's header (date, home_team, away_team, team, scorer, minute, own_goal, penalty,
//      and the optional assist), gives each goal from the base's first held day (1 July 2021) with its match key
//      `date|home_team|away_team` as results.csv names the match, « NA » as null; a wrong header is refused.
// 57s: scorerLines: a complete list gives one line per side, in minute order (a minute unknown last), « Name 23′ »,
//      « (pen.) » for a penalty, « (csc) » for an own goal; a player who scores several times is named once with each
//      minute; the nation page's single line leaves out a side without a goal; a partial list or none gives nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { FIRST_GOAL_DAY, parseGoalscorers } from "../dashboard/frontend/src/services/nations-results.js";
import { scorerLine, scorerLines } from "../dashboard/frontend/src/services/international-scorers.js";

const HEADER = "date,home_team,away_team,team,scorer,minute,own_goal,penalty,assist";

test("57r. the goals of the file from the first held day, keyed by their match", () => {
  assert.equal(FIRST_GOAL_DAY, "2021-07-01");
  const csv = [
    HEADER,
    "2021-06-30,Turkey,Italy,Italy,Merih Demiral,53,TRUE,FALSE,NA",
    "2025-06-15,Mexico,Dominican Republic,Dominican Republic,Johan Vásquez,30,TRUE,FALSE,NA",
    '2026-07-19,Spain,Argentina,Spain,"Torres, Ferran",106,FALSE,FALSE,Nico Williams',
    "2026-07-20,Côte d'Ivoire,Mali,Mali,NA,NA,FALSE,TRUE,NA",
  ].join("\n");
  assert.deepEqual(parseGoalscorers(csv), [
    { match: "2025-06-15|Mexico|Dominican Republic", team: "Dominican Republic", scorer: "Johan Vásquez", minute: "30", ownGoal: "TRUE", penalty: "FALSE", assist: null },
    { match: "2026-07-19|Spain|Argentina", team: "Spain", scorer: "Torres, Ferran", minute: "106", ownGoal: "FALSE", penalty: "FALSE", assist: "Nico Williams" },
    { match: "2026-07-20|Côte d'Ivoire|Mali", team: "Mali", scorer: null, minute: null, ownGoal: "FALSE", penalty: "TRUE", assist: null },
  ]);
  // The file before its assist column: the same goals, no assist.
  assert.deepEqual(parseGoalscorers("date,home_team,away_team,team,scorer,minute,own_goal,penalty\n2025-06-15,A,B,A,X,1,FALSE,FALSE")[0].assist, null);
  assert.throws(() => parseGoalscorers("date,home_team,away_team,home_score\n"));
  assert.throws(() => parseGoalscorers(null));
});

test("57s. a complete list of scorers gives each side's line, a partial one nothing", () => {
  const goals = [
    { side: "away", name: "Federico Chiesa", minute: 70, penalty: false, ownGoal: false },
    { side: "home", name: "Ousmane Dembélé", minute: null, penalty: false, ownGoal: false },
    { side: "home", name: "Kylian Mbappé", minute: 12, penalty: true, ownGoal: false },
    { side: "away", name: "Theo Hernández", minute: 80, penalty: false, ownGoal: true },
  ];
  assert.deepEqual(scorerLines({ complete: true, goals }), {
    home: "Kylian Mbappé 12′ (pen.), Ousmane Dembélé",
    away: "Federico Chiesa 70′, Theo Hernández 80′ (csc)",
  });
  // One side without a goal: its line is empty.
  assert.deepEqual(scorerLines({ complete: true, goals: goals.filter((g) => g.side === "home") }), {
    home: "Kylian Mbappé 12′ (pen.), Ousmane Dembélé", away: "",
  });
  // A player who scores several times is named once with each minute; an own goal is never merged with his goals.
  const brace = [
    { side: "away", name: "César Montes", minute: 63, penalty: true, ownGoal: false },
    { side: "away", name: "César Montes", minute: 57, penalty: false, ownGoal: false },
    { side: "away", name: "César Montes", minute: 80, penalty: false, ownGoal: true },
    { side: "away", name: "Raúl Jiménez", minute: 60, penalty: false, ownGoal: false },
  ];
  assert.deepEqual(scorerLines({ complete: true, goals: brace }), {
    home: "", away: "César Montes 57′, 63′ (pen.), Raúl Jiménez 60′, César Montes 80′ (csc)",
  });
  // The nation page's single line: home first, a side without a goal left out (no dangling dash).
  assert.equal(scorerLine({ complete: true, goals }), "Kylian Mbappé 12′ (pen.), Ousmane Dembélé – Federico Chiesa 70′, Theo Hernández 80′ (csc)");
  assert.equal(scorerLine({ complete: true, goals: brace }), "César Montes 57′, 63′ (pen.), Raúl Jiménez 60′, César Montes 80′ (csc)");
  assert.equal(scorerLine({ complete: false, goals }), null);
  assert.equal(scorerLines({ complete: false, goals }), null);
  assert.equal(scorerLines(undefined), null);
  assert.equal(scorerLines({ complete: true, goals: [] }), null);
});
