import test from "node:test";
import assert from "node:assert/strict";
import {
  competitionIndex,
  fixtureCompetition,
} from "../dashboard/frontend/src/services/competition-identity.js";
import {
  fixtureWeek,
  upcomingFixtures,
} from "../dashboard/frontend/src/services/fixtures.js";

const russian = {
  id: "l_2Mh0jT",
  name: "Premier League",
  country: "RUS",
  imageUrl: "russian-logo",
};
const english = {
  id: "l_4WFCIZ",
  name: "Premier League",
  country: "ENG",
  imageUrl: "english-logo",
};

test("same-named competitions keep the logo and country of their own provider ID", () => {
  const index = competitionIndex([russian, english]);
  const rus = fixtureCompetition(
    { league: { id: russian.id, name: "Premier League" } },
    index,
  );
  const eng = fixtureCompetition(
    { league: { id: english.id, name: "Premier League" } },
    index,
  );
  assert.deepEqual([rus.country, rus.imageUrl], ["Russie", "russian-logo"]);
  assert.deepEqual([eng.country, eng.imageUrl], ["Angleterre", "english-logo"]);
});

test("metadata from the fixture works without a catalogue and missing countries are not invented", () => {
  const index = competitionIndex();
  const value = fixtureCompetition(
    {
      league: {
        id: "x",
        name: "Example",
        country_code: "FIN",
        image_url: "logo",
      },
    },
    index,
  );
  assert.deepEqual(
    [value.name, value.country, value.imageUrl],
    ["Example", "Finlande", "logo"],
  );
  assert.equal(
    fixtureCompetition({ league: { id: "unknown", name: "Example" } }, index)
      .country,
    "",
  );
});

test("partial catalogue updates retain known metadata without mixing distinct IDs", () => {
  const index = competitionIndex(
    [russian, english],
    [{ id: russian.id, name: "Premier League" }],
  );
  assert.equal(index.get(russian.id).country, "RUS");
  assert.equal(index.get(russian.id).imageUrl, "russian-logo");
  assert.equal(index.get(english.id).country, "ENG");
});

test("adding identities leaves chronological ordering and favorites unchanged", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const fixtures = [
    {
      id: "eng",
      status: "not_started",
      date: "2026-11-03",
      time_utc: "2026-11-03T19:00:00Z",
      league: english,
    },
    {
      id: "rus",
      status: "not_started",
      date: "2026-11-02",
      time_utc: "2026-11-02T15:00:00Z",
      league: russian,
    },
  ];
  const options = {
    week: fixtureWeek("2026-11-02"),
    now,
    league: "all",
    query: "",
  };
  const index = competitionIndex([russian, english]);
  const entries = upcomingFixtures(fixtures, options);
  assert.deepEqual(
    entries.map((entry) => entry.fixture.id),
    ["rus", "eng"],
  );
  assert.deepEqual(
    entries.map((entry) => fixtureCompetition(entry.fixture, index).country),
    ["Russie", "Angleterre"],
  );
  assert.deepEqual(
    upcomingFixtures(fixtures, {
      ...options,
      favoriteLeagueIds: [english.id],
    }).map((entry) => entry.fixture.id),
    ["eng"],
  );
});
