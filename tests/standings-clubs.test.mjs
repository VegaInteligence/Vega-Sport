import test from "node:test";
import assert from "node:assert/strict";
import { matchStandingsClubs } from "../dashboard/frontend/src/services/standings-clubs.js";
import { fixtureClub } from "../dashboard/frontend/src/services/club-fixtures.js";
import { mergeCompetitionSeasons } from "../dashboard/frontend/src/services/competition-selector.js";

test("matches the reported French and German clubs to fixture IDs", () => {
  const pairs = [
    ["Havre Athletic Club", "Le Havre"],
    ["AS Monaco", "Monaco"],
    ["OGC Nice", "Nice"],
    ["RC Lens", "Lens"],
    ["Stade Brestois 29", "Brest"],
    ["Toulouse FC", "Toulouse"],
    ["RC Strasbourg Alsace", "Strasbourg"],
    ["AJ Auxerre", "Auxerre"],
    ["Stade Rennais FC", "Rennes"],
    ["FC Bayern Munich", "Bayern München"],
    ["1. FSV Mainz 05", "Mainz 05"],
    ["SC Freiburg", "Freiburg"],
    ["Bournemouth AFC", "AFC Bournemouth"],
    ["RCD Espanyol de Barcelona", "Espanyol"],
    ["RC Deportivo", "Deportivo A Coruña"],
    ["New York Red Bulls", "Red Bull New York"],
  ];
  const rows = pairs.map(([name]) => ({ name }));
  const matches = pairs.map(([, name], i) => ({
    home_team: { id: `club-${i}`, name },
  }));
  assert.deepEqual(
    matchStandingsClubs(rows, matches).map((team) => team?.id),
    pairs.map((_, i) => `club-${i}`),
  );
});

test("does not confuse teams with similar names, reserve sides or missing fixtures", () => {
  const matches = [
    {
      home_team: { id: "paris", name: "Paris FC" },
      away_team: { id: "psg", name: "Paris Saint-Germain" },
    },
    {
      home_team: { id: "city", name: "Manchester City" },
      away_team: { id: "united", name: "Manchester United" },
    },
    {
      home_team: { id: "ajax", name: "Ajax" },
      away_team: { id: "ajax-ii", name: "Ajax II" },
    },
  ];
  const rows = [
    "Paris FC",
    "Paris Saint Germain",
    "Manchester United",
    "Manchester City",
    "Jong Ajax",
    "Ajax",
    "Paris",
    "Chelsea",
  ].map((name) => ({ name }));
  assert.deepEqual(
    matchStandingsClubs(rows, matches).map((team) => team?.id || null),
    ["paris", "psg", "united", "city", "ajax-ii", "ajax", null, null],
  );
  assert.equal(
    matchStandingsClubs(
      [{ name: "Ajax B" }],
      [{ home_team: { id: "ajax", name: "Ajax" } }],
    )[0],
    null,
  );
  assert.equal(
    matchStandingsClubs(
      [{ name: "Sheffield United" }],
      [{ home_team: { id: "wrong", name: "Sheffield Wednesday" } }],
    )[0],
    null,
  );
});

test("two distinct rows cannot claim the same fixture club", () => {
  const rows = [{ name: "AS Monaco" }, { name: "Monaco FC" }];
  const matches = [{ home_team: { id: "monaco", name: "Monaco" } }];
  assert.deepEqual(matchStandingsClubs(rows, matches), [null, null]);
});

test("a fixture-only club can open a profile even without detailed match files", () => {
  const fixtures = [
    {
      league: { id: "league", name: "MLS" },
      home_team: { id: "club", name: "Nashville", image_url: "crest" },
      away_team: { id: "other", name: "Miami" },
    },
  ];
  assert.deepEqual(fixtureClub(fixtures, "club", { club: "USA" }), {
    id: "club",
    name: "Nashville",
    image_url: "crest",
    imageUrl: "crest",
    country: "USA",
    league: "MLS",
  });
  assert.equal(fixtureClub(fixtures, "missing"), null);
});

test("calendar-year competitions use the provider season rather than the archive bucket", () => {
  assert.deepEqual(
    mergeCompetitionSeasons(["2026", "2025"], ["2026/2027", "2024/2025"]),
    ["2026", "2025", "2024/2025"],
  );
  assert.deepEqual(
    mergeCompetitionSeasons(["2026/2027"], ["2025/2026", "2026/2027"]),
    ["2026/2027", "2025/2026"],
  );
});
