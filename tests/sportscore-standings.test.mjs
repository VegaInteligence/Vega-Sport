import test from "node:test";
import assert from "node:assert/strict";
import {
  SPORTSCORE_LEAGUES,
  normalizeSportscore,
} from "../dashboard/frontend/src/services/sportscore-standings.js";
import {
  FEATURED_LEAGUE_IDS,
  countryLabel,
  orderedFeatured,
} from "../dashboard/frontend/src/services/competition-selector.js";
import { safeImageUrl } from "../dashboard/frontend/src/services/format.js";
import { GET } from "../dashboard/frontend/app/api/standings/route.js";

const payload = {
  sport: "football",
  competition: "United States Major League Soccer",
  competition_slug: "united-states-major-league-soccer",
  tables: [
    {
      group: "East",
      rows: [
        {
          pos: 1,
          team: "Club A",
          team_logo: "https://img.thesports.com/football/team/abc123.png",
          p: 8,
          w: 5,
          d: 2,
          l: 1,
          gf: 11,
          ga: 4,
          gd: 7,
          pts: 17,
        },
      ],
    },
    {
      group: "West",
      rows: [
        {
          pos: 1,
          team: "Club B",
          p: 8,
          w: 4,
          d: 3,
          l: 1,
          gf: 9,
          ga: 4,
          gd: 5,
          pts: 15,
        },
      ],
    },
  ],
};

test("the seven featured leagues use stable identifiers and keep their provider logos", () => {
  const england = {
    id: "l_4WFCIZ",
    name: "Premier League",
    country: "ENG",
    imageUrl: "english-logo",
  };
  const egypt = {
    id: "l_46aZMC",
    name: "Premier League",
    country: "EGY",
    imageUrl: "egyptian-logo",
  };
  const france = {
    id: "l_3FJFUl",
    name: "Ligue 1",
    country: "FRA",
    imageUrl: "french-logo",
  };
  assert.equal(FEATURED_LEAGUE_IDS.length, 7);
  assert.deepEqual(
    orderedFeatured([egypt, france, england]).map((x) => x.imageUrl),
    ["english-logo", "french-logo"],
  );
  assert.equal(countryLabel("ENG"), "Angleterre");
  assert.equal(countryLabel("EGY"), "Égypte");
});

test("standings keep source groups, ranks, numeric zero and missing values distinct", () => {
  const result = normalizeSportscore(
    payload,
    "united-states-major-league-soccer",
  );
  assert.deepEqual(
    result.tables.map((t) => t.name),
    ["East", "West"],
  );
  assert.equal(result.tables[0].rows[0].points, 17);
  assert.equal(result.tables[1].rows[0].position, 1);
  assert.equal(result.tables[1].rows[0].imageUrl, "");
  assert.equal(normalizeSportscore(payload, "another-league"), null);
  assert.equal(
    normalizeSportscore({ ...payload, tables: [] }, payload.competition_slug),
    null,
  );
  assert.equal(
    normalizeSportscore(
      { ...payload, sport: "basketball" },
      payload.competition_slug,
    ),
    null,
  );
});

test("only trusted team images are displayed", () => {
  assert.ok(safeImageUrl("https://img.thesports.com/football/team/abc123.png"));
  assert.equal(safeImageUrl("https://img.thesports.com/other/abc123.png"), "");
  assert.equal(
    safeImageUrl(
      "https://img.thesports.com.evil.test/football/team/abc123.png",
    ),
    "",
  );
});

test("standings route maps only known league IDs and normalizes the response", async () => {
  assert.equal(SPORTSCORE_LEAGUES.l_4V6jPs, "brazilian-campeonato-paulista-a1");
  const original = globalThis.fetch;
  let called = "";
  globalThis.fetch = async (url) => {
    called = String(url);
    return Response.json(payload);
  };
  try {
    const result = await GET(
      new Request("https://example.test/api/standings?competition=l_0eg6C9"),
    );
    assert.equal(result.status, 200);
    assert.equal(
      new URL(called).searchParams.get("slug"),
      payload.competition_slug,
    );
    assert.equal((await result.json()).tables.length, 2);
    const unknown = await GET(
      new Request("https://example.test/api/standings?competition=unknown"),
    );
    assert.equal(unknown.status, 404);
  } finally {
    globalThis.fetch = original;
  }
});
