// C6 (FAILURE_MODES.md §22), written before the code: the competition header's Media gets the verified logo the API
// gives for the edition's own competition; a cup without one keeps the existing fallback, never another's logo.
import test from "node:test";
import assert from "node:assert/strict";
import { mergeCupCatalog, supplementalCupCatalog, supplementalLeagueCatalog } from "../dashboard/frontend/src/services/cup-catalog.js";

const REFERENCE = `https://media.vega.invalid/sha256/${"0b2958916b260998034409a86e6ede3879dd706020e0371df9b9e03ddb826022"}.png`;
const index = {
  meta: { source_generated_at_utc: "2026-11-17T07:19:26Z" },
  competitions: [
    { name: "Cymru North", folder: "WAL_2_cymru-north", season: "2026/2027", tables: { results: { rows: 29 }, fixtures: { rows: 0 } }, country_code: "WAL", image_url: REFERENCE },
    { name: "OFB Cup", folder: "AUT_CUP_ofb-cup", season: "2026/2027", tables: { results: { rows: 7 }, fixtures: { rows: 4 } }, country_code: "AUT" },
  ],
};

test("a supplemental league or cup carries the logo of its own competition", () => {
  const [league] = supplementalLeagueCatalog(index);
  assert.deepEqual([league.id, league.imageUrl], ["open-matchday:WAL_2_cymru-north", REFERENCE]);
  const [cup] = supplementalCupCatalog(index);
  assert.equal(cup.id, "open-matchday:AUT_CUP_ofb-cup");
  assert.equal(cup.imageUrl, undefined);
  const merged = mergeCupCatalog([], index);
  assert.equal(merged.find((c) => c.id === "open-matchday:WAL_2_cymru-north").imageUrl, REFERENCE);
});
