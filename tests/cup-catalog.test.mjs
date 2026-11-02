import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_CUP_ID, mergeCupCatalog, supplementalCupCatalog, competitionSearchText, normalizeCompetitionQuery } from "../dashboard/frontend/src/services/cup-catalog.js";
import { normalizeOpenCup, normalizeSupplementalCup, filterCupMatches } from "../dashboard/frontend/src/services/cup-matches.js";
import { parseFranceCup } from "../dashboard/frontend/src/services/openfootball-france-cup.js";

const index = { meta: { source_generated_at_utc: "2026-11-01T00:00:00Z" }, competitions: [
  { folder: "ESP_CUP_copa-del-rey", name: "Copa del Rey", country_code: "ESP", tables: { results: { path: "raw/seasons/2026-2027/supplemental_results/cup.json.gz", rows: 2 }, fixtures: { path: "raw/seasons/2026-2027/supplemental_fixtures/cup.json.gz", rows: 1 } } },
  { folder: "ENG_1_premier-league", name: "Premier League", country_code: "ENG", tables: { results: { path: "raw/seasons/2026-2027/x.gz", rows: 1 } } },
  { folder: "FRA_CUP_empty", name: "Empty cup", country_code: "FRA", tables: { results: { path: "raw/seasons/2026-2027/x.gz", rows: 0 } } },
] };

test("cup catalogue exposes actual cup data, Euro, France archive and World Cup once", () => {
  const national = supplementalCupCatalog(index);
  assert.equal(national.length, 1);
  assert.equal(national[0].name, "Coupe du Roi");
  assert.deepEqual(national[0].seasons, ["2026/2027", "2024/2025"]);
  assert.match(competitionSearchText(national[0], "Espagne"), /copa del rey/);
  assert.ok(competitionSearchText({ name: "FA Cup", aliases: ["Coupe d’Angleterre"] }).includes(normalizeCompetitionQuery("coupe d'angleterre")));
  const merged = mergeCupCatalog([{ id: WORLD_CUP_ID, name: "World Cup", country: "INT", seasons: ["2026", "2022"] }], index);
  assert.equal(merged.filter((item) => item.id === WORLD_CUP_ID).length, 1);
  const sparse = mergeCupCatalog([{ id: WORLD_CUP_ID, name: "World Cup", seasons: ["2026"] }], index);
  assert.deepEqual(sparse.find((item) => item.id === WORLD_CUP_ID).seasons, ["2026", "2022"]);
  assert.ok(merged.some((item) => item.id === "open-cup:euro" && item.seasons.includes("2024")));
  assert.ok(merged.some((item) => item.id === "openligadb:nations-league" && item.coverage.includes("A à D")));
  assert.ok(merged.some((item) => item.id === "open-cup:france-cup" && item.defaultSeason === "2024/2025"));
  assert.ok(merged.some((item) => item.id === "open-cup:world-cup-history" && item.seasons.includes("1930")));
  assert.ok(merged.some((item) => item.id === "open-cup:club-world-cup"));
  assert.match(competitionSearchText(merged.find((item) => item.id === WORLD_CUP_ID)), /coupe du monde/);
});

test("cup matches preserve extra time and penalties without treating shootouts as goals", () => {
  const rows = normalizeOpenCup([{ date: "2024-07-01", team1: "Portugal", team2: "Slovenia", round: "Round of 16", score: { ft: [0, 0], et: [0, 0], p: [3, 0] } }]);
  assert.deepEqual(rows[0].score, [0, 0]);
  assert.match(rows[0].notes.join(" "), /tirs au but 3 – 0/);
  assert.equal(rows[0].round, "Huitièmes de finale");
});

test("supplemental results and fixtures are validated, deduplicated and dated", () => {
  const rows = normalizeSupplementalCup([{ date: "2026-10-30", home: "A", away: "B", ft_home: " 2 ", ft_away: "0" }, { date: "2026-10-31", home: "C", away: "D", ft_home: "", ft_away: "" }], [{ date: "2026-10-30", home: "A", away: "B" }, { date: "2026-11-03", home: "E", away: "F" }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].score, [2, 0]);
  assert.deepEqual(filterCupMatches(rows, "scheduled", "", Date.parse("2026-11-02T12:00:00Z")).map((row) => row.home), ["E"]);
});

test("French Cup archive separates match and penalty scores", () => {
  const source = "= French Coupe de France 2024/25\n# Matches 2\n▪ Round 7\nFri Nov 15 2024\n 20:00  Paris FC   v US Quevilly-Rouen   2-4 pen. (1-1, 1-1)\n▪ Final\nSat May 24 2025\n 21:00  Paris Saint-Germain   v Stade de Reims   3-0 (3-0)\n";
  const matches = parseFranceCup(source);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0].score, { ft: [1, 1], p: [2, 4] });
  assert.equal(matches[1].date, "2025-05-24");
  assert.throws(() => parseFranceCup(source.replace("# Matches 2", "# Matches 3")), /Incomplete/);
});
