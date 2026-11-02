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

test("international comes first and countries follow French alphabetical order", () => {
  const groups = competitionGroups(catalogue);
  assert.deepEqual(groups.map((group) => group.label), ["International", "Allemagne", "Angleterre", "Australie", "Belgique", "Égypte", "France", "Suède", "Autres compétitions"]);
  assert.deepEqual(groups[0].competitions.map((item) => item.name), ["Champions League", "Europa League"]);
  assert.deepEqual(groups[1].competitions.map((item) => item.name), ["Bundesliga", "2. Bundesliga"]);
  assert.deepEqual(groups[2].competitions.map((item) => item.name), ["Premier League", "Championship"]);
  assert.deepEqual(groups[6].competitions.map((item) => item.name), ["Ligue 1", "Ligue 2"]);
  assert.equal(catalogue[0].name, "Championship");
});

test("country filter uses displayed labels and initial limiting preserves the sorted order", () => {
  assert.deepEqual(orderedCountryCodes(catalogue), ["INT-2", "INT", "GER", "ENG", "AUS", "BEL", "EGY", "FRA", "SWE"]);
  const visible = competitionGroups(catalogue, 3);
  assert.deepEqual(visible.map((group) => group.label), ["International", "Allemagne"]);
  assert.deepEqual(visible.flatMap((group) => group.competitions.map((item) => item.id)), ["champions", "europa", "germany1"]);
});
