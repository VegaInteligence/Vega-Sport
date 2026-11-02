import test from "node:test";
import assert from "node:assert/strict";
import { reactFixtures } from "./react-runtime.mjs";

test("archive attribution names sources, usage limits and approximate matches", async () => {
  const { renderArchiveAttribution } = await reactFixtures();
  const html = renderArchiveAttribution();
  assert.match(html, /OpenFootball/);
  assert.match(html, /footballcsv/);
  assert.match(html, /engsoccerdata/);
  assert.match(html, /usage gratuit non commercial/);
  assert.match(html, /World Club Ratings/);
  assert.match(html, /ODC-BY 1\.0/);
  assert.match(html, /correspondance peut être incorrecte/);
  assert.match(html, /ne contiennent pas de xG/);
});
