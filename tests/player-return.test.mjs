import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

// The hook reads through the resource cache; the sentences are pure.
const source = await fs.readFile(new URL("../dashboard/frontend/src/services/player-return.js", import.meta.url), "utf8");
const { returnSummary } = await import("data:text/javascript," + encodeURIComponent(source.replace(/^import .*$/m, "const useResource = null, json = null;")));

test("a return from absence reads as three sentences", () => {
  const summary = returnSummary({
    absence: { from: "2026-09-13", returnedOn: "2026-11-06", days: 54, matchesMissed: 4 },
    matchesBack: 1, minutesBack: 20, usualMinutes: 94,
    curve: [{ match: 2, returns: 6000, share: 0.88 }, { match: 1, returns: 7000, share: 0.69 }, { match: 3, returns: 5000, share: 0.97 }, { match: 4, returns: 4000, share: 1.02 }],
  });
  assert.equal(summary.headline, "Absent 54 jours (4 matchs manqués), de retour le 06/11/2026");
  assert.equal(summary.since, "1 match depuis son retour : 20 minutes en moyenne, contre 94 avant l’absence.");
  assert.equal(summary.base, "Dans la base, après une absence de cette durée, un joueur joue 69 % au premier, 88 % au deuxième, 97 % au troisième match de retour, en part de ses minutes habituelles. Son niveau par 90 minutes, lui, ne baisse pas.");
});

test("no return, or a return without a curve", () => {
  assert.equal(returnSummary(null), null);
  assert.equal(returnSummary({ absence: null }), null);
  const bare = returnSummary({ absence: { returnedOn: "2026-10-01", days: 130, matchesMissed: 12 }, matchesBack: 3, minutesBack: 61, usualMinutes: 70, curve: [] });
  assert.deepEqual([bare.headline, bare.since, bare.base],
    ["Absent 130 jours (12 matchs manqués), de retour le 01/10/2026", "3 matchs depuis son retour : 61 minutes en moyenne, contre 70 avant l’absence.", null]);
});
