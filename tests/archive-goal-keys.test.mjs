// FAILURE_MODES.md §20 (20f, 20h, 20i and the score-conflict hold), written before the code: a goal
// label laid out on several lines is read, keys keep their legacy numbering, and label parsing never
// chooses a score nor names an invented team.
import test from "node:test";
import assert from "node:assert/strict";
import { buildArchiveSeason, parseGoalMatch } from "../dashboard/shared/archive.js";

const event = (date, match, minute, player, team, score) => ({ date, match, minute, player, team, score });
const season = (events, results = null) => buildArchiveSeason(results, {
  season: "1971/1972", competitions: [{ id: "dfb-pokal", name: "DFB-Pokal", country: "Deutschland", events }],
});
const byKey = (edition) => Object.fromEntries(edition.matches.map((m) => [m.key, m]));

test("a goal label laid out on several lines is read; the raw label is kept", () => {
  // Production labels (17 Nov 2026, worldclub DFB-Pokal 1971/72).
  assert.deepEqual(parseGoalMatch("1. FC Köln vs. Bayern München 5:1 \t\t\t\n\t\t\t\t\t\n\t\t\t(Hinspiel 0:3)"),
    { team1: "1. FC Köln", team2: "Bayern München", score: [5, 1], suffix: "(Hinspiel 0:3)" });
  assert.equal(parseGoalMatch("1. FC Kaiserslautern vs. Rot-Weiß Oberhausen 5:0 n.V.\t\t\n\t\t(Hinspiel 1:3)").suffix, "n.V. (Hinspiel 1:3)");
  assert.deepEqual(parseGoalMatch("A vs. B 2:1"), { team1: "A", team2: "B", score: [2, 1], suffix: "" });
  assert.deepEqual(parseGoalMatch("Werder Bremen vs. Hannover 96 2:1 i.E."), { team1: "Werder Bremen", team2: "Hannover 96", score: [2, 1], suffix: "i.E." });
  assert.equal(parseGoalMatch("no label here"), null);
});

test("goal-only keys keep their legacy numbering; a merge the legacy reading did not make is held (§22)", () => {
  const edition = season([
    event("1972-04-05", "Clean A vs. Clean B 1:0", "10", "P1", "Clean A", [1, 0]),
    // One match, captured once with layout whitespace (legacy: unread) and once clean (legacy: read).
    // (The unread capture holds the final goal: its legacy score is the label's, so nothing is held.)
    event("1972-04-12", "1. FC Köln vs. Bayern München 5:1 \t\t\n\t(Hinspiel 0:3)", "80", "P2", "1. FC Köln", [5, 1]),
    event("1972-04-12", "1. FC Köln vs. Bayern München 5:1 (Hinspiel 0:3)", "5", "P3", "1. FC Köln", [1, 0]),
    event("1972-04-19", "X vs. Y 2:2\n\t(Hinspiel 1:1)", "30", "P4", "X", [1, 0]),
    event("1972-04-19", "X vs. Y 2:2\n\t(Hinspiel 1:1)", "60", "P5", "Y", [2, 2]),
    event("1972-05-01", "garbage without a score", "1", "P6", "Somebody", [1, 0]),
  ]);
  const matches = byKey(edition);
  assert.deepEqual(Object.keys(matches).sort(), [
    "g:dfb-pokal:1972-04-05:0", "g:dfb-pokal:1972-04-12:1", "g:dfb-pokal:1972-04-12:2", "g:dfb-pokal:1972-04-19:3", "g:dfb-pokal:1972-05-01:4",
  ]);
  // §22: the two captures stay the two published rows, each with its own goal; nothing is absorbed.
  assert.deepEqual([1, 2].map((i) => [matches[`g:dfb-pokal:1972-04-12:${i}`].held, matches[`g:dfb-pokal:1972-04-12:${i}`].goals.length]),
    [["absorption", 1], ["absorption", 1]]);
  assert.deepEqual(edition.absorbed, []);
  assert.deepEqual(edition.held.map((h) => [h.reason, h.legacy, h.candidate]),
    [["absorption", ["g:dfb-pokal:1972-04-12:1", "g:dfb-pokal:1972-04-12:2"], ["g:dfb-pokal:1972-04-12:2"]]]);
  // Read now, same score as the legacy one: repaired in place, under its legacy key.
  const xy = matches["g:dfb-pokal:1972-04-19:3"];
  assert.deepEqual([xy.team1, xy.team2, xy.score, xy.held ?? null], ["X", "Y", [2, 2], null]);
  // Never read: no team, the raw label shown.
  const garbage = matches["g:dfb-pokal:1972-05-01:4"];
  assert.deepEqual([garbage.team1, garbage.team2, garbage.unparsedLabel], ["", "", "garbage without a score"]);
});

test("a newly read label whose score differs from the legacy one keeps its legacy values", () => {
  const edition = season([
    event("1972-04-12", "M vs. N 3:1\n\t(Hinspiel 0:0)", "5", "P1", "M", [1, 0]),
    event("1972-04-12", "M vs. N 3:1\n\t(Hinspiel 0:0)", "50", "P2", "M", [2, 1]),
  ]);
  const [match] = edition.matches;
  assert.equal(match.key, "g:dfb-pokal:1972-04-12:0");
  assert.equal(match.held, "score_change");
  assert.deepEqual([match.team1, match.team2, match.score], ["M vs. N 3:1\n\t(Hinspiel 0:0)", "", [2, 1]]);
});

test("a legacy goal-only key whose goals would now join a results match is held, both rows kept (§22)", () => {
  const results = { season: "1971/1972", competitions: [{ id: "de.cup", name: "DFB-Pokal", country: "Deutschland", matches: [
    { date: "1972-04-12", team1: "1. FC Köln", team2: "Bayern München", score: { ft: [5, 1] } },
  ] }] };
  const edition = season([
    event("1972-04-12", "1. FC Köln vs. Bayern München 5:1 \t\t\n\t(Hinspiel 0:3)", "80", "P2", "1. FC Köln", [5, 1]),
  ], results);
  assert.deepEqual(edition.matches.map((m) => [m.key, m.goals?.length ?? 0, m.held ?? m.heldGoals ?? null]).sort(),
    [["g:dfb-pokal:1972-04-12:0", 1, "absorption"], ["r:de.cup:0", 0, "absorption"]]);
  assert.deepEqual(edition.absorbed, []);
});

test("A–B and B–A the same day, and one pair in two competitions, stay distinct", () => {
  const edition = buildArchiveSeason(null, { season: "1971/1972", competitions: [
    { id: "a", name: "A", country: "X", events: [event("1972-04-12", "A vs. B 1:0", "5", "P1", "A", [1, 0]), event("1972-04-12", "B vs. A 0:2", "9", "P2", "A", [0, 1])] },
    { id: "b", name: "B", country: "X", events: [event("1972-04-12", "A vs. B 1:0", "5", "P1", "A", [1, 0])] },
  ] });
  assert.equal(edition.matches.length, 3);
  assert.deepEqual(edition.absorbed, []);
});
