import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenCup } from "../dashboard/frontend/src/services/cup-matches.js";
import { attachNativeMatches, bracketWinner, buildKnockoutBracket, knockoutStage, nativeKnockoutMatches } from "../dashboard/frontend/src/services/knockout-bracket.js";

const match = (key, roundName, home, away, score, extra = {}) => ({ key, roundName, home, away, score, status: score ? "finished" : "scheduled", ...extra });

test("completed rounds are ordered by their actual qualifiers and penalties", () => {
  const rows = [
    match("q1", "Quarter-finals", "Spain", "Germany", [2, 1]),
    match("q2", "Quarter-finals", "Portugal", "France", [0, 0], { penalties: [3, 5] }),
    match("q3", "Quarter-finals", "England", "Switzerland", [1, 1], { penalties: [5, 3] }),
    match("q4", "Quarter-finals", "Netherlands", "Turkey", [2, 1]),
    match("s1", "Semi-finals", "Spain", "France", [2, 1]),
    match("s2", "Semi-finals", "Netherlands", "England", [1, 2]),
    match("f", "Final", "Spain", "England", [2, 1]),
    match("third", "Match for third place", "France", "Netherlands", [1, 0]),
  ];
  const result = buildKnockoutBracket(rows);
  assert.equal(result.connected, true);
  assert.deepEqual(result.rounds[0].matches.map((row) => row.key), ["q1", "q2", "q4", "q3"]);
  assert.equal(bracketWinner(rows[1]), "france");
  assert.equal(result.thirdPlace[0].key, "third");
});

test("future match-number references link the published slots", () => {
  const rows = [
    match("a", "Round of 16", "A", "B", null, { number: 37 }),
    match("b", "Round of 16", "C", "D", null, { number: 38 }),
    match("c", "Round of 16", "E", "F", null, { number: 39 }),
    match("d", "Round of 16", "G", "H", null, { number: 40 }),
    match("q1", "Quarter-finals", "Winner Match 39", "Winner Match 37", null, { number: 45 }),
    match("q2", "Quarter-finals", "Winner Match 40", "Winner Match 38", null, { number: 46 }),
    match("s", "Semi-finals", "Winner Match 45", "Winner Match 46", null),
  ];
  const result = buildKnockoutBracket(rows);
  assert.equal(result.connected, true);
  assert.deepEqual(result.rounds[0].matches.map((row) => row.key), ["c", "a", "d", "b"]);
});

test("ambiguous or incomplete source data never invent crossing lines", () => {
  const result = buildKnockoutBracket([
    match("a", "1/4", "A", "B", [1, 1]),
    match("b", "1/4", "C", "D", [1, 0]),
    match("s", "1/2", "Unknown", "C", [0, 1]),
  ]);
  assert.equal(result.connected, false);
  assert.equal(bracketWinner(result.rounds[0].matches[0]), null);
  assert.equal(knockoutStage("Matchday 3"), null);
  assert.equal(knockoutStage("Quarterfinals"), "quarter");
});

test("two-legged European ties aggregate in the same team order and retain links", () => {
  const matches = [
    { id: "m1", date: "2026-04-01", status: "finished", home_team: { id: "a", name: "A" }, away_team: { id: "b", name: "B" }, score_home: 1, score_away: 0 },
    { id: "m2", date: "2026-04-08", status: "finished", home_team: { id: "b", name: "B" }, away_team: { id: "a", name: "A" }, score_home: 2, score_away: 3 },
  ];
  const rows = nativeKnockoutMatches(matches, { m1: { name: "1/4" }, m2: { name: "1/4" } });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].score, [4, 2]);
  assert.deepEqual(rows[0].legs.map((leg) => leg.score), [[1, 0], [3, 2]]);
  assert.deepEqual(rows[0].legs.map((leg) => leg.id), ["m1", "m2"]);
  assert.equal(nativeKnockoutMatches(matches.slice(0, 1), { m1: { name: "1/4" } })[0].score, null);
  const future = { ...matches[1], status: "not_started", score_home: 0, score_away: 0 };
  assert.equal(nativeKnockoutMatches([future], { m2: { name: "1/4" } })[0].legs[0].score, null);
});

test("native match links require a unique exact date and team pairing", () => {
  const open = normalizeOpenCup([{ round: "Final", num: 104, date: "2026-07-19", team1: "Spain", team2: "Argentina", score: { ft: [0, 0], et: [1, 0] } }]);
  assert.equal(open[0].number, 104);
  assert.deepEqual(open[0].score, [1, 0]);
  const native = { id: "m1", date: "2026-07-19", home_team: { name: "Spain", image_url: "https://example.com/a.png" }, away_team: { name: "Argentina" } };
  assert.equal(attachNativeMatches(open, [native])[0].id, "m1");
  assert.equal(attachNativeMatches(open, [native, native])[0].id, undefined);
});
