import test from "node:test";
import assert from "node:assert/strict";
import {
  filterAppearances,
  filterMatches,
} from "../dashboard/frontend/src/model.js";
import {
  buildSearchIndex,
  searchIndex,
} from "../dashboard/frontend/src/services/global-search.js";
import { searchPlayerAverages } from "../dashboard/frontend/src/services/player-directory.js";
import { playerSearchResults } from "../dashboard/frontend/src/services/season-player.js";

test("CR7 finds the same Cristiano Ronaldo in the global and player searches", () => {
  const rows = [
    {
      playerId: "p_3yEwhj",
      name: "Cristiano Ronaldo",
      team: "Al Nassr",
      league: "Saudi Pro League",
      leagueId: "l_0Lpz1f",
      matchId: "m_A",
      season: "2026/2027",
      minutes: 90,
    },
    {
      playerId: "p_other1",
      name: "Cristiano Ronaldo",
      team: "Other",
      league: "Other league",
      leagueId: "l_other",
      matchId: "m_B",
      season: "2026/2027",
      minutes: 90,
    },
  ];
  const filters = {
    query: "CR7",
    league: "all",
    season: "2026/2027",
    minutes: 0,
    match: "all",
  };
  assert.deepEqual(
    filterAppearances(rows, filters).map((row) => row.playerId),
    ["p_3yEwhj"],
  );
  assert.deepEqual(
    playerSearchResults(rows, "CR7").map((row) => row.id),
    ["p_3yEwhj"],
  );
  assert.deepEqual(
    searchPlayerAverages(rows, "cr7").map((row) => row.playerId),
    ["p_3yEwhj"],
  );
  const index = buildSearchIndex({ appearances: rows, matches: [] }, []);
  searchIndex(index, "cr");
  assert.deepEqual(
    searchIndex(index, "CR7").players.map((row) => row.id),
    ["p_3yEwhj"],
  );
  const matches = [
    {
      id: "m_A",
      leagueId: "l_0Lpz1f",
      season: "2026/2027",
      home: { name: "Al Nassr" },
      away: { name: "Club A" },
    },
    {
      id: "m_B",
      leagueId: "l_other",
      season: "2026/2027",
      home: { name: "Other" },
      away: { name: "Club B" },
    },
  ];
  assert.deepEqual(
    filterMatches(matches, rows, filters).map((match) => match.id),
    ["m_A"],
  );
});
