// An archived World Cup match's page (mock-up validated 18 Nov 2026), from GET /api/worldcup/matches… (138).
//
// Failure modes and expected outcomes, written before the code:
//  1. A tie of an archived edition opens its page: the index's match of the same day and teams (as the archive names
//     them, in either order) gives it its key; a tie the index does not hold keeps no link.
//  2. The match's thread: a team's substitution of one minute (one off, one on) reads as one line « on ↓ off »; two
//     changes of one minute stay as they are, never paired by guess. The half-time line comes before the first event
//     after the 45th minute (stoppage time of the first half stays before it).
//  3. A player's marks in the line-up: his goals (an own goal marked as such), his card, his minute off or on.
//  4. The stage in French: « Finale », « Match pour la 3e place », « Quart de finale », « Phase de groupes · Groupe 1 »,
//     « Second tour · Groupe A », « Poule finale »; a stage the page does not know is shown as it is.
//  5. A minute: « 27’ », « 45+1’ ».
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenCup } from "../dashboard/frontend/src/services/cup-matches.js";
import { matchThread, minuteLabel, playerMarks, stageLabel, withWorldCupKeys } from "../dashboard/frontend/src/services/worldcup-matches.js";

test("1. a tie of an archived edition gets its page's key", () => {
  const ties = normalizeOpenCup([
    { round: "Final", date: "1998-07-12", team1: "Brazil", team2: "France", score: [0, 3] },
    { round: "Semi-finals", date: "1998-07-08", team1: "France", team2: "Croatia", score: [2, 1] },
    { round: "Quarter-finals", date: "1998-07-03", team1: "Italie", team2: "France", score: { ft: [0, 0], p: [3, 4] } },
  ]);
  const index = [
    { key: "M-1998-64", date: "1998-07-12", home: "Brazil", away: "France" },
    { key: "M-1998-57", date: "1998-07-03", home: "Italy", away: "France" }, // another spelling of the same team
  ];
  assert.deepEqual(withWorldCupKeys(ties, index).map((m) => m.id), ["M-1998-64", undefined, "M-1998-57"]);
  assert.deepEqual(withWorldCupKeys(ties, null).map((m) => m.id), [undefined, undefined, undefined]);
});

const ev = (minute, side, kind, name, stoppage = 0) => ({ minute, stoppage, side, kind, person: name, name });

test("2. the thread: one change of a minute is one line, the half-time line in its place", () => {
  const lines = matchThread([
    ev(27, "away", "goal", "Zidane"), ev(45, "away", "goal", "Zidane", 1), ev(46, "home", "off", "Leonardo"), ev(46, "home", "on", "Denilson"),
    ev(68, "away", "off", "Djorkaeff"), ev(68, "away", "off", "Karembeu"), ev(68, "away", "on", "Vieira"), ev(68, "away", "on", "Boghossian"),
  ]);
  assert.deepEqual(lines.map((l) => [l.half ? "MT" : l.minute, l.side ?? null, l.kind ?? null, l.name ?? null, l.off ?? null]), [
    ["27’", "away", "goal", "Zidane", null],
    ["45+1’", "away", "goal", "Zidane", null],
    ["MT", null, null, null, null],
    ["46’", "home", "change", "Denilson", "Leonardo"],
    ["68’", "away", "off", "Djorkaeff", null], ["68’", "away", "off", "Karembeu", null],
    ["68’", "away", "on", "Vieira", null], ["68’", "away", "on", "Boghossian", null],
  ]);
  assert.deepEqual(matchThread([]), []);
  assert.deepEqual(matchThread([ev(10, "home", "goal", "A")]).map((l) => l.half ?? false), [false]);
});

test("3, 5. a player's marks and the minutes", () => {
  const events = [ev(27, "away", "goal", "Zidane"), ev(60, "home", "own_goal", "Zidane"), ev(80, "away", "yellow", "Zidane"), ev(86, "away", "off", "Zidane", 0), ev(90, "away", "penalty", "Petit", 3)];
  assert.deepEqual(playerMarks(events, "Zidane").map((m) => [m.kind, m.minute]), [["goal", "27’"], ["own_goal", "60’"], ["yellow", "80’"], ["off", "86’"]]);
  assert.deepEqual(playerMarks(events, "Petit").map((m) => [m.kind, m.minute]), [["penalty", "90+3’"]]);
  assert.deepEqual(playerMarks(events, "Nobody"), []);
  assert.equal(minuteLabel({ minute: 45, stoppage: 1 }), "45+1’");
  assert.equal(minuteLabel({ minute: 120, stoppage: 0 }), "120’");
});

test("4. the stage in French", () => {
  assert.deepEqual([
    stageLabel("final"), stageLabel("third-place match"), stageLabel("quarter-finals"), stageLabel("quarter-final"), stageLabel("semi-finals"),
    stageLabel("round of 16"), stageLabel("group stage", "Group 1"), stageLabel("second group stage", "Group A"), stageLabel("final round"), stageLabel("replay"),
  ], ["Finale", "Match pour la 3e place", "Quart de finale", "Quart de finale", "Demi-finale", "Huitième de finale", "Phase de groupes · Groupe 1",
      "Second tour · Groupe A", "Poule finale", "replay"]);
});
