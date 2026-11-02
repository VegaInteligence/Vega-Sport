import test from "node:test";
import assert from "node:assert/strict";
import { localeCountry, preferredCompetition, standingsFromFixtures, hasCompleteHomeAwaySchedule, COUNTRY_LEAGUES } from "../dashboard/frontend/src/services/competition-standings.js";
import { GET as visitorCountry } from "../dashboard/frontend/app/api/visitor-country/route.js";

const team = (id) => ({ id, name: id });
const game = (id, home, away, hs, as, status = "finished", date = "2026-10-01") => ({ id, home_team: team(home), away_team: team(away), score_home: hs, score_away: as, status, date });
test("country and saved preferences select a known competition in the right order", () => {
  const catalog = [{ id: COUNTRY_LEAGUES.FR }, { id: COUNTRY_LEAGUES.DE }];
  assert.equal(preferredCompetition(catalog, null, "DE"), COUNTRY_LEAGUES.DE);
  assert.equal(preferredCompetition(catalog, COUNTRY_LEAGUES.FR, "DE"), COUNTRY_LEAGUES.FR);
  assert.equal(preferredCompetition(catalog, "missing", "XX"), COUNTRY_LEAGUES.FR);
  assert.equal(preferredCompetition([{ id: "thai2", name: "Thai League 2", country: "THA" }, { id: "thai1", name: "Thai League 1", country: "THA" }], null, "TH"), "thai1");
  assert.equal(localeCountry(["fr-CA", "fr-FR"]), "CA");
  assert.equal(localeCountry(["fr", "en-GB"]), "GB");
  assert.equal(localeCountry(["fr"]), null);
});
test("country endpoint emits only a country code and disables caching", async () => {
  let response = await visitorCountry(new Request("https://example.test/api/visitor-country", { headers: { "x-vercel-ip-country": "fr" } }));
  assert.deepEqual(await response.json(), { country: "FR" });
  assert.match(response.headers.get("cache-control"), /no-store/);
  response = await visitorCountry(new Request("https://example.test/api/visitor-country", { headers: { "cf-ipcountry": "XX" } }));
  assert.deepEqual(await response.json(), { country: null });
});
test("standings count wins, draws, goals and only finished valid matches once", () => {
  const matches = [
    game("1", "A", "B", 2, 0), game("2", "A", "C", 1, 1),
    game("3", "B", "C", 3, 1), game("1", "A", "B", 2, 0),
    game("4", "A", "D", null, null, "not_started"),
    game("5", "B", "D", null, 0, "finished", "2026-10-03"),
  ];
  const value = standingsFromFixtures(matches);
  assert.equal(value.played, 3);
  assert.equal(value.excluded, 1);
  assert.equal(value.lastDate, "2026-10-01");
  assert.deepEqual(value.rows.map((r) => [r.id, r.points, r.played, r.wins, r.draws, r.losses, r.goalsFor, r.goalsAgainst, r.difference]), [
    ["A", 4, 2, 1, 1, 0, 3, 1, 2], ["B", 3, 2, 1, 0, 1, 3, 3, 0],
    ["C", 1, 2, 0, 1, 1, 2, 4, -2], ["D", 0, 0, 0, 0, 0, 0, 0, 0],
  ]);
});
test("a final result replaces a duplicate upcoming fixture", () => {
  const result = standingsFromFixtures([game("same", "A", "B", null, null, "not_started"), game("same", "A", "B", 0, 1)]);
  assert.equal(result.played, 1);
  assert.equal(result.rows[0].id, "B");
  assert.equal(result.rows[0].points, 3);
});

test("additional meetings mark a schedule as unsuitable for a simple table", () => {
  const result = standingsFromFixtures([game("1", "A", "B", 1, 0), game("2", "B", "A", 1, 1), game("3", "A", "B", 0, 0)]);
  assert.equal(result.complexSchedule, true);
});

test("a complete balanced home-and-away schedule can support a derived table", () => {
  const games = [
    game("1", "A", "B", 1, 0),
    game("2", "B", "A", null, null, "not_started"),
    game("3", "A", "C", 2, 1),
    game("4", "C", "A", null, null, "not_started"),
    game("5", "B", "C", 0, 0),
    game("6", "C", "B", null, null, "not_started"),
  ];
  assert.equal(hasCompleteHomeAwaySchedule(games), true);
  assert.equal(hasCompleteHomeAwaySchedule([...games, games[0]]), true);
  assert.equal(hasCompleteHomeAwaySchedule(games.slice(0, 5)), false);
  assert.equal(
    hasCompleteHomeAwaySchedule([...games, game("7", "A", "B", 2, 0)]),
    false,
  );
  assert.equal(
    hasCompleteHomeAwaySchedule(
      games.map((g) =>
        g.id === "2" ? { ...g, home_team: team("A"), away_team: team("B") } : g,
      ),
    ),
    false,
  );
});
