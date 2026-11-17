// A domestic cup's bracket from its numbered rounds (VI-19, « toutes les coupes ont le même design », 17 Nov 2026):
// open-matchday numbers a cup's rounds (gw) without naming them, so the bracket stayed empty. The rounds are named by
// their ties, walking back from the last one: each round before holds twice as many (1 final, 2 semi-finals, 4
// quarter-finals, 8 round of 16…); the two legs of a tie (the same pairs in two rounds) are one round; an earlier
// irregular round (replays, a preliminary round) stays out of the bracket.
import test from "node:test";
import assert from "node:assert/strict";
import { numberedCupRounds, normalizeSupplementalCup } from "../dashboard/frontend/src/services/cup-matches.js";
import { knockoutStage } from "../dashboard/frontend/src/services/knockout-bracket.js";

const pair = (gw, home, away, score = null, date = "2026-10-01") => ({ gw, home, away, date, ft_home: score?.[0], ft_away: score?.[1] });

test("a cup's numbered rounds are named by their ties, from the last one back", () => {
  const results = [
    ...[["A", "B"], ["C", "D"], ["E", "F"]].map(([h, a]) => pair("1", h, a, [1, 0], "2026-08-01")), // a preliminary round: 3 ties
    ...[["A", "P"], ["C", "Q"], ["E", "R"], ["G", "S"], ["H", "T"], ["I", "U"], ["J", "V"], ["K", "W"]].map(([h, a]) => pair("6", h, a, [2, 1], "2026-10-28")),
  ];
  const fixtures = [["A", "C"], ["E", "G"], ["H", "I"], ["J", "K"]].map(([h, a]) => pair("7", h, a, null, "2026-12-15"));
  const named = numberedCupRounds(normalizeSupplementalCup(results, fixtures));
  const stage = (gw) => [...new Set(named.filter((m) => m.gw === gw).map((m) => knockoutStage(m.roundName)))];
  assert.deepEqual([stage("1"), stage("6"), stage("7")], [[null], ["round16"], ["quarter"]]);
  assert.equal(named.find((m) => m.gw === "7").round, "Quarts de finale");
});

test("two legs are one round; a last round that is no power of two names nothing", () => {
  const semis = [pair("8", "A", "B", [1, 0], "2027-01-10"), pair("8", "C", "D", [0, 0], "2027-01-11"), pair("9", "B", "A", [2, 2], "2027-02-03"), pair("9", "D", "C", [1, 3], "2027-02-04")];
  const named = numberedCupRounds(normalizeSupplementalCup(semis, [pair("10", "A", "C", null, "2027-03-20")]));
  assert.deepEqual(named.map((m) => knockoutStage(m.roundName)), ["semi", "semi", "semi", "semi", "final"]);
  const odd = numberedCupRounds(normalizeSupplementalCup([pair("3", "A", "B", [1, 0]), pair("3", "C", "D", [1, 0]), pair("3", "E", "F", [1, 0])], []));
  assert.deepEqual(odd.map((m) => m.roundName), ["", "", ""]);
  assert.deepEqual(numberedCupRounds([]), []);
});
