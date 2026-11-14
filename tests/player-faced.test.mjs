import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the sentences are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/player-faced.js", import.meta.url), "utf8");
const { facedSummary } = await import("data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;")));

test("a keeper's shots faced read as two sentences, with his place when he faced enough", () => {
  const summary = facedSummary({ id: "p_aaaab3", season: "2026/2027", shots: 157, goals: 44, xgot: 53.53, prevented: 9.53, per100: 6.1, rank: 12, keepers: 978, minShots: 30 });
  assert.equal(summary.headline, "157 tirs cadrés subis · 44 buts encaissés");
  assert.equal(summary.reading, "Ces tirs valaient 53,5 buts une fois frappés (xGOT) : +9,5 buts évités, soit +6,1 pour 100 tirs cadrés. 12e des 978 gardiens à 30 tirs cadrés subis ou plus, par tir.");
  // Fewer goals kept out than conceded reads with its sign; under the threshold there is no rank.
  const few = facedSummary({ shots: 12, goals: 5, xgot: 3.5, prevented: -1.5, per100: -12.5, minShots: 30 });
  assert.equal(few.headline, "12 tirs cadrés subis · 5 buts encaissés");
  assert.equal(few.reading, "Ces tirs valaient 3,5 buts une fois frappés (xGOT) : -1,5 but évité, soit -12,5 pour 100 tirs cadrés. Pas de rang sous 30 tirs cadrés subis.");
  assert.equal(facedSummary({ shots: 1, goals: 1, xgot: 0.4, prevented: -0.6, per100: -60, rank: 1, keepers: 1, minShots: 30 }).headline, "1 tir cadré subi · 1 but encaissé");
});

test("no shot faced, no reading", () => {
  assert.equal(facedSummary(null), null);
  assert.equal(facedSummary({ shots: 0, goals: 0, xgot: 0, prevented: 0 }), null);
});
