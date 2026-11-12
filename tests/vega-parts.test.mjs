import assert from "node:assert/strict";
import test from "node:test";

// ballon-dor.js reads its data through the resource hooks; the sentence itself is pure.
const source = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../dashboard/frontend/src/services/ballon-dor.js", import.meta.url), "utf8"));
const body = source.slice(source.indexOf("const points =")).replace(/export function useBreakouts[\s\S]*?\n}\n/, "");
const { vegaParts, breakoutEntries, breakoutSignal } = await import("data:text/javascript," + encodeURIComponent(body));

test("the two parts of a player's Vega score read as one sentence", () => {
  assert.equal(vegaParts({ ownContribution: 12.44, clubLevel: 3.1 }), "Ce qu’il produit : 12,4 · niveau de son club : 3,1 (points du classement de la saison).");
  assert.equal(vegaParts({ ownContribution: -0.26, clubLevel: 0 }), "Ce qu’il produit : -0,3 · niveau de son club : 0,0 (points du classement de la saison).");
});

test("a player without a ranking total has no sentence", () => {
  for (const power of [null, undefined, {}, { ownContribution: 3 }, { ownContribution: null, clubLevel: 2 }]) assert.equal(vegaParts(power), null);
});

test("a flagged player's page says so in one sentence", () => {
  assert.equal(breakoutSignal({ percentile: 91.3, minutes: 1180, rank: 4 }), "Révélation : en 1\u202f180 minutes, son rendement par 90 minutes le place devant 91 % des titulaires à son poste.");
  assert.equal(breakoutSignal({ percentile: 99.8, minutes: 420 }), "Révélation : en 420 minutes, son rendement par 90 minutes le place devant 99 % des titulaires à son poste.");
  for (const none of [null, undefined, {}, { percentile: 90 }]) assert.equal(breakoutSignal(none), null);
});

test("the breakouts take the ranking's rows, their score the share of regulars they are ahead of", () => {
  const entries = breakoutEntries({ rows: [{ rank: 1, playerId: "p_a", name: "A", team: "Club", teamId: "t_a", position: "Ailier", percentile: 96.4, minutes: 610 }] });
  assert.deepEqual(entries, [{ rank: 1, playerId: "p_a", name: "A", team: "Club", teamId: "t_a", position: "Ailier", percentile: 96.4, minutes: 610, score: 96.4 }]);
  assert.deepEqual(breakoutEntries(null), []);
});
