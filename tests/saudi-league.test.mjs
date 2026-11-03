import test from "node:test";
import assert from "node:assert/strict";
import { enrichSeasonCompetitions } from "../dashboard/frontend/src/services/competition-identity.js";
import { reconcileSaudiFixtures } from "../dashboard/frontend/src/services/saudi-fixtures.js";

test("Saudi competition is enriched by provider ID without changing other competitions", () => {
  const [saudi, other] = enrichSeasonCompetitions(
    [
      { id: "l_0Lpz1f", name: "Saudi Pro League", country: "", imageUrl: null },
      { id: "other", country: "FRA", imageUrl: "old" },
    ],
    [
      { id: "l_0Lpz1f", country_code: "KSA", image_url: "saudi-logo" },
      { id: "other", country_code: "KSA", image_url: "new" },
    ],
  );
  assert.equal(saudi.country, "KSA");
  assert.equal(saudi.imageUrl, "saudi-logo");
  assert.deepEqual([other.country, other.imageUrl], ["FRA", "old"]);
});

test("duplicate upcoming fixtures do not invent a kickoff or a canonical match ID", () => {
  const base = {
    season: "2026/2027",
    date: "2026-11-05",
    home_team: { id: "h" },
    away_team: { id: "a" },
    status: "not_started",
  };
  const input = [
    { ...base, id: "m_one", time_utc: "2026-11-05T13:25:00Z" },
    { ...base, id: "m_two", time_utc: "2026-11-05T17:00:00Z" },
    {
      ...base,
      id: "m_result",
      status: "finished",
      time_utc: "2026-11-05T13:25:00Z",
    },
    {
      ...base,
      id: "m_other",
      date: "2026-11-06",
      time_utc: "2026-11-06T17:00:00Z",
    },
  ];
  const output = reconcileSaudiFixtures(input);
  assert.equal(output.length, 3);
  assert.deepEqual(output[0].fixtureAlternatives, ["m_one", "m_two"]);
  assert.equal(output[0].time_utc, null);
  assert.equal(output[0].fixtureIdentityUncertain, true);
  assert.equal(output[1].id, "m_result");
  assert.equal(output[2].id, "m_other");
  assert.equal(input[0].time_utc, "2026-11-05T13:25:00Z");
});
