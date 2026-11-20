// A nation's matches as one carousel (mock-up B validated 20 Nov 2026: « Ok je prends ta recommandation »): every
// played match, newest first, one group per competition edition, replacing the card of the last tournament alone.
//
// Failure modes and expected outcomes, written before the code:
//
//  1. Groups and the cards inside them run newest first; a group is a run of consecutive matches of one edition.
//  2. A match of a major tournament (a game of one of the nation's `tournaments`, same day and same two teams) takes
//     that run's label and stage: « Euro 2020 » even when the match itself says « Euro 2021 » (the 2020 Euro was
//     played in 2021), « Coupe du monde 2026 » and « Vainqueur ».
//  3. Another match takes its competition and its season: « Ligue des nations 2026/27 »; friendlies are « Matchs
//     amicaux 2025/26 »; no stage.
//  4. A match not played (no score, or not finished) is not a card.
//  5. The same two nations twice within a day are one match (an archived copy dated a day apart, Uruguay–Spain 2026):
//     the collected one, with its page, stays; never two cards, never a group counted twice.
//  6. Each group says how many matches it holds; a group key is stable (the jump row scrolls to it).
//  7. No nation, no matches: no group.
import test from "node:test";
import assert from "node:assert/strict";
import { matchCarousel } from "../dashboard/frontend/src/services/nation-carousel.js";

const ES = { id: "t_es", name: "Spain" };
const team = (name) => ({ id: `t_${name.slice(0, 3).toLowerCase()}`, name });
const game = (date, home, away, homeScore, awayScore, extra = {}) => ({
  date, status: "finished", home, away, homeScore, awayScore, homePenalties: null, awayPenalties: null, ...extra,
});

const final = game("2026-07-19", ES, team("Argentina"), 1, 0, { competition: "World Cup", round: "final", season: "2025/2026", id: "m_final" });
const uruguay = game("2026-06-27", team("Uruguay"), ES, 0, 1, { competition: "World Cup", round: "3", season: "2025/2026", id: "m_uru" });
const copy = game("2026-06-26", team("Uruguay"), ES, 0, 1, { competition: "World Cup 1930", round: "Matchday 16", season: "2025/2026" });
const capeVerde = game("2026-06-15", ES, team("Cape Verde"), 0, 0, { competition: "World Cup", round: "1", season: "2025/2026", id: "m_cv" });
const euroFinal = game("2021-07-06", team("Italie"), ES, 1, 1, { competition: "Euro 2021", round: "Semi-final", season: "2020/2021", homePenalties: 4, awayPenalties: 2 });
const nations = [
  game("2026-11-15", ES, team("England"), 2, 3, { competition: "nations-league", edition: "openligadb:nations-league:2026/2027", round: "Groupe 3", season: "2026/2027" }),
  game("2026-11-12", team("Czechia"), ES, 0, 2, { competition: "nations-league", edition: "openligadb:nations-league:2026/2027", round: "Groupe 3", season: "2026/2027" }),
];
const upcoming = { ...game("2027-03-26", ES, team("Brazil"), null, null, { competition: "Friendlies", season: "2026/2027" }), status: "not_started" };
const friendlies = [
  game("2026-06-08", ES, team("Peru"), 3, 0, { competition: "International Friendlies", season: "2025/2026" }),
  game("2026-06-04", ES, team("Iraq"), 2, 0, { competition: "International Friendlies", season: "2025/2026" }),
];

const nation = {
  id: ES.id,
  matches: [upcoming, ...nations, final, uruguay, copy, ...friendlies, capeVerde, euroFinal],
  tournaments: [
    { tournament: "euro", label: "Euro 2020", year: 2020, stage: "Demi", matches: 1, games: [euroFinal] },
    { tournament: "world-cup", label: "Coupe du monde 2026", year: 2026, stage: "Vainqueur", tone: "gold", matches: 4, games: [capeVerde, copy, uruguay, final] },
  ],
};

test("groups by edition, newest first, with the tournaments' own labels and stages", () => {
  const groups = matchCarousel(nation);
  assert.deepEqual(groups.map((g) => [g.label, g.stage, g.matches.map((m) => m.date)]), [
    ["Ligue des nations 2026/27", null, ["2026-11-15", "2026-11-12"]],
    ["Coupe du monde 2026", "Vainqueur", ["2026-07-19", "2026-06-27", "2026-06-15"]],
    ["Matchs amicaux 2025/26", null, ["2026-06-08", "2026-06-04"]],
    ["Euro 2020", "Demi", ["2021-07-06"]],
  ]);
});

test("the archived copy of a collected match is dropped; a played match only", () => {
  const all = matchCarousel(nation).flatMap((g) => g.matches);
  assert.equal(all.filter((m) => m.home.name === "Uruguay").length, 1);
  assert.equal(all.find((m) => m.home.name === "Uruguay").id, "m_uru");
  assert.equal(all.some((m) => m.status !== "finished"), false);
  assert.equal(all.length, 8);
});

test("each group has a stable key; an empty nation has no group", () => {
  const groups = matchCarousel(nation);
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
  assert.deepEqual(matchCarousel(nation).map((g) => g.key), groups.map((g) => g.key));
  assert.deepEqual(matchCarousel(null), []);
  assert.deepEqual(matchCarousel({ id: "t_x", matches: [], tournaments: [] }), []);
});
