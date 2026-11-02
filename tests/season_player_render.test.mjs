import test from "node:test";
import assert from "node:assert/strict";
import { reactFixtures } from "./react-runtime.mjs";

const { renderSeasonSearch, renderSeasonProfile } = await reactFixtures();
const rows = [
  {
    id: "m_1:p_1",
    playerId: "p_1",
    matchId: "m_1",
    name: "Neymar",
    team: "Brazil",
    league: "World Cup",
    date: "2026-07-05",
    positionId: 3,
    minutes: 23,
    goals: 1,
    assists: 0,
    xg: 0.81,
    xa: 0.01,
    rating: 7.19,
  },
  {
    id: "m_2:p_1",
    playerId: "p_1",
    matchId: "m_2",
    name: "Neymar",
    team: "Brazil",
    league: "World Cup",
    date: "2026-06-29",
    positionId: 3,
    minutes: 14,
    goals: 0,
    assists: 0,
    xg: 0.01,
    xa: 0.07,
    rating: 6.17,
  },
];
const matches = [
  {
    id: "m_1",
    home: { name: "Brazil", score: 1 },
    away: { name: "Norway", score: 2 },
  },
  {
    id: "m_2",
    home: { name: "Brazil", score: 2 },
    away: { name: "Portugal", score: 1 },
  },
];

test("search presents one navigable player for multiple match performances", () => {
  const html = renderSeasonSearch(rows, "neymar");
  assert.match(html, /Joueurs trouvés/);
  assert.equal((html.match(/>Neymar<\/strong>/g) || []).length, 1);
  assert.match(html, /\/joueurs\/?\?id=p_1/);
});

test("season card renders observed totals, average controls, sample warning and matches", () => {
  const html = renderSeasonProfile(rows, matches, "p_1");
  assert.match(html, /Neymar/);
  assert.match(html, /37/);
  assert.match(html, /6,68/);
  assert.match(html, /0,82/);
  assert.match(html, /Par match/);
  assert.match(html, /Échantillon insuffisant/);
  assert.match(html, /5 juil\. 2026/);
  assert.match(html, /29 juin 2026/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
