// VI-30 (docs/calculs/09-audit-2026-11/FAILURE_MODES_VI30.md V12–V18, written before the code): a supplemental entry
// answers to its edition's canonical competition id (the API's `competition_id`), never by a name; one entry per
// competition in the directory and the search; a lookup waits for the catalogue that can answer it.
import test from "node:test";
import assert from "node:assert/strict";
import { awaitsCupIndex, findCompetition, mergeCupCatalog, supplementalCupCatalog, supplementalLeagueCatalog } from "../dashboard/frontend/src/services/cup-catalog.js";
import { globalCompetitionCatalog } from "../dashboard/frontend/src/services/global-search.js";

const FAW = `https://media.vega.invalid/sha256/${"0b2958916b260998034409a86e6ede3879dd706020e0371df9b9e03ddb826022"}.png`;
const index = {
  meta: { source_generated_at_utc: "2026-11-17T07:19:26Z" },
  competitions: [
    { name: "Cymru North", folder: "WAL_2_cymru-north", season: "2026/2027", tables: { results: { rows: 29 }, fixtures: { rows: 0 } }, country_code: "WAL", image_url: FAW, competition_id: "l_v0000130" },
    { name: "OFB Cup", folder: "AUT_CUP_ofb-cup", season: "2026/2027", tables: { results: { rows: 7 }, fixtures: { rows: 4 } }, country_code: "AUT", competition_id: "l_v0000087" },
    // An older API (no canonical id), and a malformed one.
    { name: "Cymru South", folder: "WAL_3_cymru-south", season: "2026/2027", tables: { results: { rows: 29 } }, country_code: "WAL" },
    { name: "National League", folder: "ENG_5_national-league", season: "2026/2027", tables: { results: { rows: 36 } }, country_code: "ENG", competition_id: "open-matchday:x" },
  ],
};

test("V12/V16: an entry carries its edition's canonical id, only a well-formed one", () => {
  const leagues = supplementalLeagueCatalog(index);
  const north = leagues.find((c) => c.folder === "WAL_2_cymru-north");
  assert.deepEqual([north.id, north.canonicalId, north.imageUrl], ["open-matchday:WAL_2_cymru-north", "l_v0000130", FAW]);
  assert.equal("canonicalId" in leagues.find((c) => c.folder === "WAL_3_cymru-south"), false);
  assert.equal("canonicalId" in leagues.find((c) => c.folder === "ENG_5_national-league"), false);
  assert.equal(supplementalCupCatalog(index)[0].canonicalId, "l_v0000087");
});

test("V12/V15: a lookup by the source key or the canonical id finds the same entry; an unknown id none", () => {
  const catalog = mergeCupCatalog([{ id: "l_3FJFUl", name: "Ligue 1", country: "FRA", seasons: ["2026/2027"] }], index);
  const bySource = findCompetition(catalog, "open-matchday:WAL_2_cymru-north");
  assert.ok(bySource);
  assert.equal(findCompetition(catalog, "l_v0000130"), bySource);
  assert.equal(findCompetition(catalog, "l_v0000087").id, "open-matchday:AUT_CUP_ofb-cup");
  assert.equal(findCompetition(catalog, "l_v9999999"), undefined);
  assert.equal(findCompetition(catalog, ""), undefined);
  assert.equal(findCompetition(catalog, "l_3FJFUl").name, "Ligue 1");
  // One entry for the competition, in the directory and in the search.
  assert.equal(catalog.filter((c) => c.name === "Cymru North").length, 1);
  assert.equal(globalCompetitionCatalog([], index).filter((c) => c.name === "Cymru North").length, 1);
});

test("V18: an item whose canonical id is a native competition's is that competition, listed once", () => {
  const native = [{ id: "l_0ALvwF", name: "Serie A", country: "ITA", seasons: ["2026/2027"] }];
  const copy = { competitions: [{ name: "Italian top flight", folder: "ITA_1_serie-a", season: "2026/2027", tables: { results: { rows: 8 } }, country_code: "ITA", competition_id: "l_0ALvwF" }] };
  assert.deepEqual(supplementalLeagueCatalog(copy, native), []);
  const catalog = mergeCupCatalog(native, copy);
  assert.equal(catalog.filter((c) => c.country === "ITA").length, 1);
  // The native entry answers its own id, never the copy.
  assert.equal(findCompetition(catalog, "l_0ALvwF").name, "Serie A");
});

test("V13/V14: the ids a supplemental index can answer wait for it", () => {
  assert.equal(awaitsCupIndex("open-matchday:WAL_2_cymru-north"), true);
  assert.equal(awaitsCupIndex("l_v0000130"), true);
  for (const id of ["l_3FJFUl", "open-cup:euro", "", null, undefined]) assert.equal(awaitsCupIndex(id), false, String(id));
});
