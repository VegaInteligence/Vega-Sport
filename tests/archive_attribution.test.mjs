import test from "node:test";
import assert from "node:assert/strict";
import { reactFixtures } from "./react-runtime.mjs";

test("archive notes keep coverage limits without naming data sources", async () => {
  const { renderArchiveAttribution } = await reactFixtures();
  const html = renderArchiveAttribution();
  assert.doesNotMatch(html, /OpenFootball|footballcsv|engsoccerdata|schochastics/);
  assert.match(html, /correspondance peut être incorrecte/);
  assert.match(html, /ne contiennent pas de xG/);
});
