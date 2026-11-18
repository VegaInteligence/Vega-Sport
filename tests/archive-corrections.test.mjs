// FAILURE_MODES.md §22 (22d, 22e, 22f, legacy pin), written before the code: the published rows are rebuilt by
// the baseline code itself, a unit whose keys or scores the corrected reading would change keeps its legacy rows,
// and a goal's side is first the side named exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildArchiveSeason, goalSide } from "../dashboard/shared/archive.js";

const event = (date, match, minute, player, team, score) => ({ date, match, minute, player, team, score });
const goals = (id, events) => ({ season: "2000/2001", competitions: [{ id, name: id, country: "Österreich", events }] });
const byKey = (edition) => Object.fromEntries(edition.matches.map((m) => [m.key, m]));

test("the legacy reading is the baseline's own files, byte for byte", () => {
  // git show 8018e0836c:dashboard/shared/<file> | shasum -a 256
  const pinned = {
    "archive.js": "296e7abe672b5617e49eb05c5fb9253ea713a924237a8db8697b064f2db4df44",
    "openfootball-history.js": "a03306601834994bc081ee6e94e46a60f6e8aca9f86797679dc1b1fcb9973e31",
    "archive-text.js": "9fd698d0a2a8b401ec97b6c63d1cc5e8d773c75e04d6cb11206bd8e3970cec22",
  };
  for (const [name, digest] of Object.entries(pinned)) {
    const body = readFileSync(new URL(`../dashboard/shared/legacy-8018e08/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(body).digest("hex"), digest, name);
  }
});

test("22d: a legacy-readable label whose corrected score differs keeps its legacy row, held", () => {
  // Astra's literal: one observed goal at 50' ending 2–1 under « M vs. N 3:1 (Hinspiel 0:0) ».
  const edition = buildArchiveSeason(null, goals("x", [event("2000-09-01", "M vs. N 3:1 (Hinspiel 0:0)", "50", "P", "M", [2, 1])]));
  const [row] = edition.matches;
  assert.equal(row.key, "g:x:2000-09-01:0");
  assert.deepEqual(row.score, [2, 1]); // the published (legacy) score
  assert.deepEqual(row.notes, ["tirs au but"]); // the published notes
  assert.equal(row.held, "score_change");
  assert.deepEqual(row.candidate?.score, [3, 1]); // the corrected reading, reported only
});

test("22e: an absorption the legacy reading did not make keeps both legacy keys, the result without these goals", () => {
  const results = {
    season: "2000/2001",
    competitions: [{ id: "at.1", name: "Bundesliga", country: "Österreich", matches: [
      { date: "2000-09-02", team1: "Wiener", team2: "Rapid", score: { ft: [3, 1] } },
    ] }],
  };
  const edition = buildArchiveSeason(results, goals("aut", [event("2000-09-02", "Wien vs. Rapid 3:1 (Hinspiel 0:0)", "50", "P", "Wien", [2, 1])]));
  const rows = byKey(edition);
  assert.deepEqual(Object.keys(rows).sort(), ["g:aut:2000-09-02:0", "r:at.1:0"]);
  assert.equal(rows["r:at.1:0"].goals, null);
  assert.equal(rows["g:aut:2000-09-02:0"].held, "absorption");
  assert.deepEqual(rows["g:aut:2000-09-02:0"].score, [2, 1]);
  assert.deepEqual(edition.absorbed, []); // nothing is absorbed
  assert.deepEqual(edition.held.map((h) => [h.reason, h.legacy, h.candidate]), [
    ["absorption", ["g:aut:2000-09-02:0", "r:at.1:0"], ["r:at.1:0"]],
  ]);
});

test("22f: a goal's side is first the side named exactly", () => {
  assert.equal(goalSide({ team: "Manchester United" }, { team1: "Manchester United", team2: "Manchester City" }), "home");
  assert.equal(goalSide({ team: "Manchester City" }, { team1: "Manchester United", team2: "Manchester City" }), "away");
  assert.equal(goalSide({ team: "Real Madrid" }, { team1: "Atlético Madrid", team2: "Real Madrid" }), "away");
  assert.equal(goalSide({ team: "real  madrid." }, { team1: "Atlético Madrid", team2: "Real Madrid" }), "away"); // case, spaces, dots
  assert.equal(goalSide({ team: "West Ham United" }, { team1: "Arsenal FC", team2: "West Ham United FC" }), "away"); // similarity
  assert.equal(goalSide({ team: "Manchester" }, { team1: "Manchester United", team2: "Manchester City" }), null); // still a tie
});

test("22g (edition): a legacy side the corrected reading would lose holds the unit", () => {
  // A parsed legacy label: the legacy side of each goal is established; the corrected rows must keep it.
  const edition = buildArchiveSeason(null, goals("eng", [
    event("2000-09-03", "Manchester United vs. Manchester City 1:0", "10", "P", "Manchester United", [1, 0]),
  ]));
  const [row] = edition.matches;
  assert.equal(row.held, undefined);
  assert.equal(row.goals[0].side, "home");
});

test("an unchanged unit is the corrected row; a malformed legacy label is repaired in place with its key", () => {
  const edition = buildArchiveSeason(null, goals("dfb", [
    event("1972-04-12", "1. FC Köln vs. Bayern München 5:1 \t\t\n\t(Hinspiel 0:3)", "80", "P2", "Bayern München", [5, 1]),
  ]));
  const [row] = edition.matches;
  assert.equal(row.key, "g:dfb:1972-04-12:0");
  assert.deepEqual([row.team1, row.team2, row.score, row.held], ["1. FC Köln", "Bayern München", [5, 1], undefined]);
  assert.equal(row.goals[0].side, "away");
});
