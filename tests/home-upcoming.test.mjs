// « Prochains matchs » on the v2 API (doc "Prochains matchs : comment on choisit"): the
// three examples of the doc, for a visitor who follows PSG and Mbappé, and the edges.
import test from "node:test";
import assert from "node:assert/strict";
import { chooseUpcoming, favouriteOrder } from "../dashboard/frontend/src/services/home-upcoming.js";

const H = 3_600_000;
const at = (iso) => Date.parse(iso);
const match = (id, iso, { weight, europe = false, favourites } = {}) => ({
  fixture: { id }, time: at(iso), europe, ...(weight != null && { weight }), ...(favourites && { favourites }),
});
const ids = (list) => list.map((m) => m.fixture.id);
// PSG followed (strength 1); Mbappé followed: Real, his club (2), and France (3).
const FAVOURITES = [
  { teamId: "t_psg", strength: 1 },
  { teamId: "t_real", strength: 2 },
  { teamId: "t_fra", strength: 3 },
];

test("a normal week: PSG – Lens big, Barcelone – Real, PSG – Inter, then the two biggest matches", () => {
  const now = at("2026-11-13T12:00:00Z"); // Friday
  const matches = [
    match("psg-lens", "2026-11-14T20:00:00Z", { favourites: ["t_psg"] }),
    match("barca-real", "2026-11-15T20:00:00Z", { favourites: ["t_real"] }),
    match("psg-inter", "2026-11-18T20:00:00Z", { europe: true, favourites: ["t_psg"] }),
    match("real-benfica", "2026-11-18T20:00:00Z", { europe: true, favourites: ["t_real"] }),
  ];
  const editorial = [
    match("barca-real", "2026-11-15T20:00:00Z", { weight: 7 }),
    match("liverpool-city", "2026-11-15T16:30:00Z", { weight: 6 }),
    match("bayern-dortmund", "2026-11-14T17:30:00Z", { weight: 5 }),
    match("lyon-nice", "2026-11-16T19:45:00Z", { weight: 2 }),
  ];
  const five = chooseUpcoming({ editorial, favourites: FAVOURITES, matches, now });
  assert.deepEqual(ids(five), ["psg-lens", "barca-real", "psg-inter", "liverpool-city", "bayern-dortmund"]);
  assert.equal(five.find((m) => m.fixture.id === "barca-real").weight, 7); // a favourite keeps its weight
});

test("four followed clubs: one match for each of the three playing first, the two biggest matches stay", () => {
  const now = at("2026-11-13T12:00:00Z");
  const favourites = ["a", "b", "c", "d"].map((t) => ({ teamId: t, strength: 1 }));
  const matches = [
    match("a1", "2026-11-14T15:00:00Z", { favourites: ["a"] }), match("b1", "2026-11-14T18:00:00Z", { favourites: ["b"] }),
    match("c1", "2026-11-15T15:00:00Z", { favourites: ["c"] }), match("d1", "2026-11-16T15:00:00Z", { favourites: ["d"] }),
    match("a2", "2026-11-18T20:00:00Z", { favourites: ["a"] }), match("b2", "2026-11-19T20:00:00Z", { favourites: ["b"] }),
  ];
  const editorial = [match("big1", "2026-11-15T20:00:00Z", { weight: 8 }), match("big2", "2026-11-16T20:00:00Z", { weight: 6 }), match("big3", "2026-11-17T20:00:00Z", { weight: 4 })];
  assert.deepEqual(ids(chooseUpcoming({ editorial, favourites, matches, now })), ["a1", "b1", "c1", "big1", "big2"]);
});

test("an international break: France – Allemagne big, PSG at 10 days, Real at 11, then France – Espagne", () => {
  const now = at("2026-11-11T12:00:00Z"); // Wednesday
  const matches = [
    match("fra-ger", "2026-11-12T19:45:00Z", { favourites: ["t_fra"] }),
    match("fra-esp", "2026-11-15T19:45:00Z", { favourites: ["t_fra"] }),
    match("psg-next", "2026-11-21T20:00:00Z", { favourites: ["t_psg"] }),
    match("real-next", "2026-11-22T20:00:00Z", { favourites: ["t_real"] }),
  ];
  // No big match in the scope: the favourites complete.
  assert.deepEqual(ids(chooseUpcoming({ editorial: [], favourites: FAVOURITES, matches, now })), ["fra-ger", "psg-next", "real-next", "fra-esp"]);
});

test("a match between two favourites counts once; ties: the closest, then a European cup", () => {
  const favourites = [{ teamId: "x", strength: 1 }, { teamId: "y", strength: 1 }, { teamId: "z", strength: 1 }];
  const order = favouriteOrder(favourites, [
    match("x-y", "2026-11-14T20:00:00Z", { favourites: ["x", "y"] }),
    match("z-league", "2026-11-18T20:00:00Z", { favourites: ["z"] }),
    match("z-cup", "2026-11-18T20:00:00Z", { europe: true, favourites: ["z"] }),
    match("y-next", "2026-11-17T20:00:00Z", { favourites: ["y"] }),
  ]);
  assert.deepEqual(ids(order), ["x-y", "z-cup", "y-next", "z-league"]);
});

test("the big card: the heaviest match when no favourite plays within 48 h; a match leaves at kick-off", () => {
  const now = at("2026-11-13T12:00:00Z");
  const matches = [match("psg-far", "2026-11-17T20:00:00Z", { favourites: ["t_psg"] }), match("psg-gone", "2026-11-13T11:00:00Z", { favourites: ["t_psg"] })];
  const editorial = [match("small", "2026-11-14T12:00:00Z", { weight: 1 }), match("big", "2026-11-15T12:00:00Z", { weight: 9 })];
  const five = chooseUpcoming({ editorial, favourites: FAVOURITES, matches, now, rules: { places: 5, favouritePlaces: 3, bigCardHours: 48 } });
  assert.deepEqual(ids(five), ["big", "psg-far", "small"]);
  // Without favourites: the five heaviest, the heaviest first; nothing at all, nothing.
  assert.deepEqual(ids(chooseUpcoming({ editorial, now })), ["big", "small"]);
  assert.deepEqual(chooseUpcoming({ now }), []);
  // The closest favourite match within 48 h takes the card back from the heaviest.
  const soon = [...matches, match("psg-soon", "2026-11-15T11:00:00Z", { favourites: ["t_psg"] })];
  assert.equal(now + 48 * H > soon[2].time, true);
  assert.equal(chooseUpcoming({ editorial, favourites: FAVOURITES, matches: soon, now })[0].fixture.id, "psg-soon");
});
