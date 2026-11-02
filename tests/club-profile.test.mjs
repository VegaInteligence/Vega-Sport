import test from "node:test";
import assert from "node:assert/strict";
import { clubRoster } from "../dashboard/frontend/src/services/club-roster.js";
import { loadClubFacts } from "../dashboard/frontend/src/services/club-facts.js";
import { resolveClubIdentity } from "../dashboard/frontend/src/services/wikidata-club-identity.js";
import { fetchWikidataClub } from "../dashboard/frontend/src/services/wikidata-club.js";

test("roster groups every player once by the latest documented match position", () => {
  const rows = [
    {
      teamId: "club",
      playerId: "g",
      name: "Gardien",
      positionId: 11,
      date: "2026-08-01",
    },
    {
      teamId: "club",
      playerId: "d",
      name: "Défenseur",
      positionId: 1,
      date: "2026-08-01",
    },
    {
      teamId: "club",
      playerId: "m",
      name: "Milieu",
      positionId: 82,
      date: "2026-09-01",
    },
    {
      teamId: "club",
      playerId: "a",
      name: "Attaquant",
      positionId: 3,
      date: "2026-09-01",
    },
    {
      teamId: "club",
      playerId: "a",
      name: "Attaquant",
      positionId: 2,
      date: "2026-08-01",
    },
    {
      teamId: "club",
      playerId: "a",
      name: "Attaquant",
      positionId: null,
      date: "2026-10-01",
    },
    {
      teamId: "club",
      playerId: "x",
      name: "Inconnu",
      positionId: null,
      date: "2026-10-01",
    },
    {
      teamId: "other",
      playerId: "z",
      name: "Autre",
      positionId: 0,
      date: "2026-10-01",
    },
  ];
  const groups = clubRoster(rows, "club");
  for (const [key, player] of [
    ["G", "g"],
    ["D", "d"],
    ["M", "m"],
    ["A", "a"],
    ["unknown", "x"],
  ])
    assert.deepEqual(
      groups[key].map((item) => item.row.playerId),
      [player],
    );
});

test("club facts use the latest completed lineup and the latest home venue", async () => {
  const matches = [
    {
      id: "m_old",
      status: "finished",
      date: "2026-09-01",
      home: { id: "club" },
      away: { id: "other" },
    },
    {
      id: "m_new",
      status: "finished",
      date: "2026-10-01",
      home: { id: "other" },
      away: { id: "club" },
    },
    {
      id: "m_future",
      status: "upcoming",
      date: "2026-12-01",
      home: { id: "club" },
      away: { id: "other" },
    },
  ];
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes("club-links"))
      return Response.json({ links: { club: { entityId: "uefa:50058" } } });
    if (url.includes("m_new/lineups"))
      return Response.json({
        data: { away_team: { id: "club" }, away: { coach: { name: "Coach" } } },
      });
    if (url.endsWith("m_old"))
      return Response.json({
        data: { home_team: { id: "club" }, stadium: "Stade" },
      });
    if (url.includes("club-wikidata?uefa=50058"))
      return Response.json({ coach: { name: "Coach" }, stadium: "Stade" });
    throw Error("Unexpected request " + url);
  };
  const result = await loadClubFacts("club", matches, fetcher);
  assert.equal(result.observedCoach.name, "Coach");
  assert.equal(result.observedCoach.date, "2026-10-01");
  assert.equal(result.observedStadium.name, "Stade");
  assert.equal(result.wiki.coach.name, "Coach");
  assert.equal(calls.length, 4);
});

test("missing identity or mismatched team does not assign another team's coach", async () => {
  const matches = [
    {
      id: "m_1",
      status: "finished",
      date: "2026-10-01",
      home: { id: "club" },
      away: { id: "other" },
    },
  ];
  const fetcher = async (url) =>
    url.includes("club-links")
      ? Response.json({ links: {} })
      : url.includes("lineups")
        ? Response.json({
            data: {
              home_team: { id: "other" },
              home: { coach: { name: "Wrong" } },
            },
          })
        : Response.json({
            data: { home_team: { id: "other" }, stadium: "Wrong" },
          });
  const result = await loadClubFacts("club", matches, fetcher);
  assert.equal(result.wiki, null);
  assert.equal(result.observedCoach, null);
  assert.equal(result.observedStadium, null);
});

test("Wikidata identity, temporal selection and Commons credits are preserved", async () => {
  let query;
  const fetcher = async (url) => {
    if (url.startsWith("https://query.wikidata.org/")) {
      query = new URL(url).searchParams.get("query");
      const value = (v) => ({ value: v });
      const row = {
        club: value("http://www.wikidata.org/entity/Q1543"),
        stadium: value("http://www.wikidata.org/entity/Q133566"),
        stadiumLabel: value("stade Giuseppe-Meazza"),
        stadiumAlias: value("San Siro"),
        coach: value("http://www.wikidata.org/entity/Q1"),
        coachLabel: value("Coach"),
        coachStart: value("2026-06-01T00:00:00Z"),
        image: value(
          "http://commons.wikimedia.org/wiki/Special:FilePath/Coach.jpg",
        ),
        founded: value("1899-01-01T00:00:00Z"),
      };
      return Response.json({ results: { bindings: [row, row] } });
    }
    return Response.json({
      query: {
        pages: {
          1: {
            imageinfo: [
              {
                url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Coach.jpg",
                descriptionurl:
                  "https://commons.wikimedia.org/wiki/File:Coach.jpg",
                extmetadata: {
                  Artist: { value: "<b>Photographer</b>" },
                  LicenseShortName: { value: "CC BY 3.0" },
                },
              },
            ],
          },
        },
      },
    });
  };
  const result = await fetchWikidataClub("50058", {
    fetcher,
    now: () => new Date("2026-11-02T00:00:00Z"),
  });
  assert.match(query, /wdt:P7361 "50058"/);
  assert.match(query, /pq:P582/);
  assert.equal(result.stadiumAlias, "San Siro");
  assert.equal(result.stadiumId, "Q133566");
  assert.equal(result.coach.name, "Coach");
  assert.equal(result.coach.photo.author, "Photographer");
  assert.equal(result.coach.photo.license, "CC BY 3.0");
  assert.equal(result.founded, "1899");
  await assert.rejects(fetchWikidataClub('1" } UNION {', { fetcher }));
});

test("ambiguous undated coaches are not presented as a current coach", async () => {
  const v = (x) => ({ value: x });
  const base = { club: v("http://www.wikidata.org/entity/Q1") };
  const fetcher = async () =>
    Response.json({
      results: {
        bindings: [
          { ...base, coach: v("c1"), coachLabel: v("One") },
          { ...base, coach: v("c2"), coachLabel: v("Two") },
        ],
      },
    });
  const result = await fetchWikidataClub("1", { fetcher });
  assert.equal(result.coach, null);
});

test("name fallback accepts only one exact football-club identity in the right country", async () => {
  const claim = (id) => ({
    rank: "normal",
    mainsnak: { datavalue: { value: { id } } },
  });
  const fetcher = async (url) =>
    new URL(url).searchParams.get("action") === "wbsearchentities"
      ? Response.json({
          search: [
            { id: "Q1", match: { text: "Fortuna Köln" } },
            { id: "Q2", match: { text: "Fortuna Köln" } },
            { id: "Q3", match: { text: "Fortuna Köln II" } },
          ],
        })
      : Response.json({
          entities: {
            Q1: { claims: { P31: [claim("Q476028")], P17: [claim("Q183")] } },
            Q2: { claims: { P31: [claim("Q15944511")], P17: [claim("Q183")] } },
            Q3: { claims: { P31: [claim("Q476028")], P17: [claim("Q183")] } },
          },
        });
  assert.equal(await resolveClubIdentity("Fortuna Köln", "GER", fetcher), "Q1");
  assert.equal(await resolveClubIdentity("Fortuna Köln", "FRA", fetcher), null);
  assert.equal(await resolveClubIdentity("Fortuna Köln", "INT", fetcher), null);
});

test("name fallback declines an ambiguous same-country club", async () => {
  const claim = (id) => ({
    rank: "normal",
    mainsnak: { datavalue: { value: { id } } },
  });
  const fetcher = async (url) =>
    new URL(url).searchParams.get("action") === "wbsearchentities"
      ? Response.json({
          search: [
            { id: "Q1", match: { text: "Club" } },
            { id: "Q2", match: { text: "Club" } },
          ],
        })
      : Response.json({
          entities: {
            Q1: { claims: { P31: [claim("Q476028")], P17: [claim("Q142")] } },
            Q2: { claims: { P31: [claim("Q476028")], P17: [claim("Q142")] } },
          },
        });
  assert.equal(await resolveClubIdentity("Club", "FRA", fetcher), null);
});
