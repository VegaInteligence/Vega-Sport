import assert from "node:assert/strict";
import test from "node:test";

// ballon-dor.js reads its data through the resource hooks; the sentence itself is pure.
const source = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../dashboard/frontend/src/services/ballon-dor.js", import.meta.url), "utf8"));
const body = source.slice(source.indexOf("const points ="));
const { vegaParts } = await import("data:text/javascript," + encodeURIComponent(body));

test("the two parts of a player's Vega score read as one sentence", () => {
  assert.equal(vegaParts({ ownContribution: 12.44, clubLevel: 3.1 }), "Ce qu’il produit : 12,4 · niveau de son club : 3,1 (points du classement de la saison).");
  assert.equal(vegaParts({ ownContribution: -0.26, clubLevel: 0 }), "Ce qu’il produit : -0,3 · niveau de son club : 0,0 (points du classement de la saison).");
});

test("a player without a ranking total has no sentence", () => {
  for (const power of [null, undefined, {}, { ownContribution: 3 }, { ownContribution: null, clubLevel: 2 }]) assert.equal(vegaParts(power), null);
});
