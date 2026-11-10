import test from "node:test";
import assert from "node:assert/strict";
import { competitionGroups, orderedCountryCodes } from "../dashboard/frontend/src/services/competition-selector.js";

const catalogue = [
  { id: "championship", name: "Championship", country: "ENG" },
  { id: "fr2", name: "Ligue 2", country: "FRA" },
  { id: "australia", name: "A-League", country: "AUS" },
  { id: "europa", name: "Europa League", country: "INT-2" },
  { id: "germany2", name: "2. Bundesliga", country: "GER" },
  { id: "sweden", name: "Allsvenskan", country: "SWE" },
  { id: "champions", name: "Champions League", country: "INT" },
  { id: "england1", name: "Premier League", country: "ENG" },
  { id: "belgium", name: "First Division A", country: "BEL" },
  { id: "germany1", name: "Bundesliga", country: "GER" },
  { id: "fr1", name: "Ligue 1", country: "FRA" },
  { id: "egypt", name: "Premier League", country: "EGY" },
  { id: "unknown", name: "Other" },
];

test("groups follow the French alphabetical order of their labels, leagues their pyramid", () => {
  const groups = competitionGroups(catalogue);
  assert.deepEqual(groups.map((group) => group.label), ["Allemagne", "Angleterre", "Australie", "Autres compétitions", "Belgique", "Égypte", "Europe", "France", "International", "Suède"]);
  const named = (label) => groups.find((group) => group.label === label).competitions.map((item) => item.name);
  assert.deepEqual(named("Allemagne"), ["Bundesliga", "2. Bundesliga"]);
  assert.deepEqual(named("Angleterre"), ["Premier League", "Championship"]);
  assert.deepEqual(named("France"), ["Ligue 1", "Ligue 2"]);
  assert.deepEqual(named("Europe"), ["Europa League"]);
  assert.deepEqual(named("International"), ["Champions League"]);
  assert.equal(catalogue[0].name, "Championship");
});

test("country filter uses displayed labels and initial limiting preserves the sorted order", () => {
  assert.deepEqual(orderedCountryCodes(catalogue), ["GER", "ENG", "AUS", "BEL", "EGY", "INT-2", "FRA", "INT", "SWE"]);
  const visible = competitionGroups(catalogue, 3);
  assert.deepEqual(visible.map((group) => group.label), ["Allemagne", "Angleterre"]);
  assert.deepEqual(visible.flatMap((group) => group.competitions.map((item) => item.id)), ["germany1", "germany2", "england1"]);
});
