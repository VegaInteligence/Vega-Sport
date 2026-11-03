import test from "node:test";
import assert from "node:assert/strict";
import {
  loadPlayerHonours,
  MESSI_HONOURS,
  MESSI_ID,
} from "../dashboard/frontend/src/services/player-honours.js";

test("Messi's verified honours are available independent of the selected season", async () => {
  const result = await loadPlayerHonours(
    MESSI_ID,
    "Lionel Messi",
    async () => ({ ok: false }),
  );
  assert.equal(result.groups, MESSI_HONOURS);
  const items = result.groups.flatMap((group) => group.items);
  assert.equal(
    items.find((item) => item.title === "Coupe du monde").years,
    "2022",
  );
  assert.equal(items.find((item) => item.title === "Ballon d’Or").count, 8);
  assert.equal(
    items.find((item) => item.title === "Ligue des champions").count,
    4,
  );
  assert.equal(
    items.find((item) => item.title === "Campeones Cup").years,
    "2026",
  );
});

test("other players require an exact identity and nationality before their honours are shown", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("/api/player-honours")) return { ok: false };
    const body = String(url).includes("pitchapi")
      ? { data: { name: "Kylian Mbappé", country_code: "FRA" } }
      : String(url).includes("searchplayers")
        ? {
            player: [
              {
                idPlayer: "1234",
                strPlayer: "Kylian Mbappé",
                strNationality: "France",
                strSport: "Soccer",
              },
            ],
          }
        : {
            honours: [
              {
                idPlayer: "1234",
                strSport: "Soccer",
                strTeam: "France",
                strHonour: "FIFA World Cup",
                strSeason: "2018",
              },
            ],
          };
    return { ok: true, json: async () => body };
  };
  const result = await loadPlayerHonours("p_123456", "Kylian Mbappé", fetcher);
  assert.deepEqual(result.groups, [
    {
      group: "France",
      items: [{ title: "Coupe du monde", count: 1, years: "2018" }],
    },
  ]);
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(result).includes("1234"), false);
  assert.deepEqual(
    (await loadPlayerHonours("p_123456", "Different Player", fetcher)).groups,
    [],
  );
});

test("a namesake from another country is never assigned the player's trophies", async () => {
  let calls = 0;
  const fetcher = async (url) => ({
    ok: !String(url).startsWith("/api/player-honours"),
    json: async () =>
      ++calls === 1
        ? { data: { name: "Alex Martin", country_code: "FRA" } }
        : {
            player: [
              {
                idPlayer: "44",
                strPlayer: "Alex Martin",
                strNationality: "England",
                strSport: "Soccer",
              },
            ],
          },
  });
  assert.deepEqual(
    (await loadPlayerHonours("p_123456", "Alex Martin", fetcher)).groups,
    [],
  );
  assert.equal(calls, 2);
});

test("a refreshed Messi projection adds new titles and retains the verified baseline", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      available: true,
      sourceUrl:
        "https://en.wikipedia.org/w/index.php?title=Lionel_Messi&oldid=123",
      fetchedAt: "2026-11-03T12:00:00Z",
      honours: [
        {
          name: "MLS Cup",
          team: "Inter Miami",
          category: "team",
          seasons: ["2025", "2026"],
        },
        {
          name: "Supercopa de España",
          team: "Barcelona",
          category: "team",
          seasons: ["2006"],
        },
      ],
    }),
  });
  const result = await loadPlayerHonours(MESSI_ID, "Lionel Messi", fetcher);
  assert.equal(
    result.groups
      .find((g) => g.group === "Inter Miami")
      .items.find((i) => i.title === "MLS Cup").count,
    2,
  );
  assert.equal(
    result.groups
      .find((g) => g.group === "FC Barcelone")
      .items.find((i) => i.title === "Supercoupe d’Espagne").count,
    8,
  );
  assert.match(result.sourceUrl, /^https:\/\/en\.wikipedia\.org\//);
});
