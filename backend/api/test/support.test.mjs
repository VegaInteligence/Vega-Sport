// Contract tests of the support reads (relational-support.js on main), under neutral routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const PHOTO = {
  url: "https://upload.wikimedia.org/wikipedia/commons/c/c1/Coach.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:Coach.jpg",
  author: "Someone", license: "CC BY-SA 4.0",
};

test("club facts by the club's Vega id", { skip }, async () => {
  const { response, body } = await get("/api/club-facts?club=t_aaaaa1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"support-v1-/);
  assert.deepEqual(body, {
    sourceUrl: "https://www.wikidata.org/entity/Q704", fetchedAt: "2025-09-20T09:00:00.000Z", stadium: "Stade Été",
    stadiumId: "Q1150", stadiumAlias: null, coach: { name: "Coach Un", photo: PHOTO }, founded: "1950",
  });
  assert.equal((await get("/api/club-facts?club=t_aaaaa2")).response.status, 404); // not linked
  assert.equal((await get("/api/club-facts?uefa=52747")).response.status, 400);
  assert.equal((await get("/api/club-facts")).response.status, 400);
  assert.equal((await get("/api/club-wikidata?uefa=52747")).response.status, 404); // no source in a route
});

test("coach portrait and stadium", { skip }, async () => {
  assert.deepEqual((await get("/api/coach-portrait?name=coach%20un")).body, { name: "Coach Un", lookupVersion: 3, photo: PHOTO });
  assert.equal((await get("/api/coach-portrait?name=Nobody")).response.status, 404);
  const { body } = await get("/api/stadium?club=t_aaaaa1");
  assert.deepEqual(body, {
    id: "Q1150", sourceUrl: "https://www.wikidata.org/wiki/Q1150", fetchedAt: "2025-09-20T09:00:00.000Z", capacity: 41000,
    capacityAsOf: "2019", opened: "2016-01-09", created: null, coordinates: { lat: 45.76, lon: 4.98 },
    plans: [{ title: "Plan interactif", source: "Club", detail: "Accès et tribunes.", url: "https://club.example/plan", embedded: true, allowGeolocation: true, format: "Plan" }],
  });
  assert.equal((await get("/api/stadium?club=t_aaaaa2")).response.status, 404);
  assert.equal((await get("/api/stadium?id=Q1150")).response.status, 400);
});

test("player honours and image redirects", { skip }, async () => {
  const { response, body } = await get("/api/player-honours?id=p_aaaab1");
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    available: true, source: "Wikipédia", identitySourceUrl: "https://www.wikidata.org/wiki/Q100",
    sourceUrl: "https://en.wikipedia.org/w/index.php?title=E&oldid=7#Honours", revision: 7, fetchedAt: "2025-09-20T09:00:00.000Z",
    honours: [
      { name: "French Ligue 1", team: "Olympique Été", category: "team", seasons: ["2023–24", "2024–25"] },
      { name: "Ligue 1 Player of the Year", team: null, category: "individual", seasons: ["2025"] },
    ],
  });
  assert.equal(body.displayGroups, undefined); // only Messi's page carries main's curated list
  assert.equal((await get("/api/player-honours?id=p_aaaab2")).response.status, 404);
  assert.equal((await get("/api/player-honours?id=bad")).response.status, 400);
  const asset = await get("/api/assets?url=" + encodeURIComponent("https://img.example/t1.png"));
  assert.equal(asset.response.status, 307);
  assert.equal(asset.response.headers.get("location"), "https://media.test/data/sources/v2/images/" + "ab".repeat(32) + ".png");
  // A source has one copy for good: the browser keeps where it is for a day.
  assert.equal(asset.response.headers.get("cache-control"), "public, max-age=86400, s-maxage=86400");
  assert.equal((await get("/api/assets?url=" + encodeURIComponent("https://img.example/none.png"))).response.status, 404);
});
