import test from "node:test";
import assert from "node:assert/strict";
import {
  europeanPlaces,
  leagueZones,
  performanceSpots,
  tableZones,
} from "../dashboard/frontend/src/services/standings-zones.js";
import { inEuropeFocus } from "../dashboard/shared/competition-scope.js";

test("European places follow the association rank of the UEFA access list", () => {
  assert.deepEqual(europeanPlaces(1), ["cl", "cl", "cl", "cl", "el", "ecl"]);
  assert.deepEqual(europeanPlaces(5), ["cl", "cl", "cl", "cl-q", "el", "ecl"]);
  assert.deepEqual(europeanPlaces(6), ["cl", "cl", "cl-q", "el-q", "ecl"]);
  assert.deepEqual(europeanPlaces(7), ["cl", "cl-q", "el-q", "ecl"]);
  assert.deepEqual(europeanPlaces(14), ["cl-q", "cl-q", "ecl", "ecl"]);
  assert.deepEqual(europeanPlaces(52), ["cl-q", "ecl"]);
  // The performance spot is one more Champions League place.
  assert.deepEqual(europeanPlaces(1, { eps: true }).slice(0, 6), [
    "cl", "cl", "cl", "cl", "cl", "el",
  ]);
});

test("performance spots go to the two best associations of the season", () => {
  const row = (countryCode, points) => ({
    countryCode,
    sourceRow: { seasonRankings: [{ seasonYear: 2027, nationalAssociationPoints: points }] },
  });
  const spots = performanceSpots({ rows: [row("ENG", 9), row("ESP", 12), row("ITA", 7)] }, 2027);
  assert.deepEqual([...spots].sort(), ["ENG", "ESP"]);
});

test("relegation and promotion come from the recorded league places", () => {
  const ligue1 = leagueZones("l_3FJFUl", 18);
  assert.deepEqual(ligue1.slice(15), ["relegation-po", "relegation", "relegation"]);
  assert.equal(ligue1[14], null);
  // Another league size means other rules: nothing is shown.
  assert.deepEqual(leagueZones("l_3FJFUl", 20), Array(20).fill(null));
  const championship = leagueZones("l_4DWyTT", 24);
  assert.deepEqual(championship.slice(0, 3), ["promotion", "promotion", "promotion-po"]);
  const zones = tableZones(18, { european: ["cl", "cl"], league: ligue1 });
  assert.equal(zones[0], "cl");
  assert.equal(zones[17], "relegation");
});

test("Top 7 Europe + UEFA covers national and super cups but not lower divisions", () => {
  assert.equal(inEuropeFocus({ id: "l_3FJFUl" }), true);
  assert.equal(inEuropeFocus({ id: "open-matchday:ENG_CUP_fa-cup" }), true);
  assert.equal(inEuropeFocus({ id: "x", name: "Supercopa de España", country: "ESP" }), true);
  assert.equal(inEuropeFocus({ id: "x", name: "Trophée des Champions", country: "FRA" }), true);
  assert.equal(inEuropeFocus({ id: "x", name: "UEFA Super Cup", country: "UEFA" }), true);
  assert.equal(inEuropeFocus({ id: "x", name: "Championship", country: "ENG" }), false);
  assert.equal(inEuropeFocus({ id: "x", name: "Coupe d’Autriche", country: "AUT" }), false);
  assert.equal(inEuropeFocus({ id: "x", name: "Euro", country: "UEFA" }), false);
});
