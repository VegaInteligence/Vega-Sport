// « Prochains matchs » (doc "Prochains matchs : comment on choisit"): the
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

// « À l'affiche » (VI-48, #69): the same block fed by the API's `billboard` (yesterday → today + 3, by the served
// importance v2 `weight`, clubs and national teams mixed). Written before chooseBillboard.
//
// Failure modes and expected outcomes:
//  A1 The big card goes to a finished match (it shows a countdown) → the card is the most important match not
//     finished yet (in play counts as not finished); the rows are the next most important, finished or not.
//  A2 A heavier finished match pushes the most important coming one out of the five → the card still takes it, the
//     lightest of the others leaves.
//  A3 The favourites lose their places → as today: up to three places, a favourite's match within 48 h takes the
//     card, a match the favourites and the billboard share counts once and keeps the served weight.
//  A4 A personal match already kicked off stays → it leaves, as today; a billboard match does not leave at kick-off
//     (yesterday's results stay, with their score).
//  A5 The API serves no `billboard` (an older publication or backend) → exactly today's choice from `highlights`.
//  A6 The API serves an empty billboard, or one with nothing left to play → today's choice too, so the block never
//     disappears while `highlights` has matches.
//  A7 The choice says where it comes from → each billboard pick carries `billboard: true` (the block's title
//     follows it); today's picks do not.
const entry = (id, iso, weight, status = "not_started", extra = {}) => ({
  fixture: { id, status }, time: at(iso), day: iso.slice(0, 10), weight, ...extra,
});

test("A1–A2 billboard: the card is the most important match not finished, the rows the next most important", () => {
  const now = at("2026-11-24T07:00:00Z");
  const billboard = [
    entry("bre-eve", "2026-11-23T20:00:00Z", 7.1, "finished"),
    entry("mon-fio", "2026-11-23T17:30:00Z", 3.4, "finished"),
    entry("ars-bvb", "2026-11-24T20:00:00Z", 6.9),
    entry("rma-psv", "2026-11-24T20:00:00Z", 5.8),
    entry("live", "2026-11-24T06:30:00Z", 2.0, "in_play"),
    entry("psg-rom", "2026-11-25T20:00:00Z", 6.4),
    entry("small", "2026-11-26T18:00:00Z", 1.0),
  ];
  const five = chooseUpcoming({ editorial: [], billboard, now });
  assert.deepEqual(ids(five), ["ars-bvb", "bre-eve", "psg-rom", "rma-psv", "mon-fio"]);
  assert.ok(five.every((m) => m.billboard === true));
  // A2: five finished matches heavier than anything coming: the coming one still leads, the lightest leaves.
  const heavy = [1, 2, 3, 4, 5].map((n) => entry("done" + n, "2026-11-23T20:00:00Z", 9 - n, "finished"));
  const pick = chooseUpcoming({ billboard: [...heavy, entry("next", "2026-11-25T20:00:00Z", 2), entry("later", "2026-11-26T20:00:00Z", 1)], now });
  assert.deepEqual(ids(pick), ["next", "done1", "done2", "done3", "done4"]);
  // In play leads when it is the heaviest not finished.
  assert.equal(chooseUpcoming({ billboard: [entry("live", "2026-11-24T06:30:00Z", 4, "in_play"), entry("ars", "2026-11-24T20:00:00Z", 3)], now })[0].fixture.id, "live");
});

test("A3–A4 billboard: the favourites keep their places and the card within 48 h", () => {
  const now = at("2026-11-24T07:00:00Z");
  const billboard = [
    entry("ars-bvb", "2026-11-24T20:00:00Z", 6.9),
    entry("psg-rom", "2026-11-25T20:00:00Z", 6.4),
    entry("rma-psv", "2026-11-24T20:00:00Z", 5.8),
    entry("bre-eve", "2026-11-23T20:00:00Z", 5.0, "finished"),
    entry("mci-nap", "2026-11-24T20:00:00Z", 4.0),
  ];
  const matches = [
    match("psg-rom", "2026-11-25T20:00:00Z", { favourites: ["t_psg"] }),
    match("fra-next", "2026-12-01T20:00:00Z", { favourites: ["t_fra"] }),
    match("real-gone", "2026-11-24T06:00:00Z", { favourites: ["t_real"] }),
  ];
  const five = chooseUpcoming({ billboard, favourites: FAVOURITES, matches, now });
  // PSG – Roma is a favourite's, within 48 h: the card; France's next match has a place; Real's started match left.
  assert.deepEqual(ids(five), ["psg-rom", "fra-next", "ars-bvb", "rma-psv", "bre-eve"]);
  assert.equal(five[0].weight, 6.4); // the served weight
  assert.equal(five[0].favourite, true);
  assert.equal(ids(five).filter((id) => id === "psg-rom").length, 1);
  // No favourite within 48 h: the heaviest not finished leads.
  const far = chooseUpcoming({ billboard, favourites: FAVOURITES, matches: [match("fra-next", "2026-12-01T20:00:00Z", { favourites: ["t_fra"] })], now });
  assert.equal(far[0].fixture.id, "ars-bvb");
});

test("A5–A7 without a usable billboard, today's choice from highlights", () => {
  const now = at("2026-11-24T07:00:00Z");
  const editorial = [match("big", "2026-11-25T20:00:00Z", { weight: 9 }), match("small", "2026-11-26T20:00:00Z", { weight: 2 })];
  const today = chooseUpcoming({ editorial, now });
  assert.deepEqual(ids(chooseUpcoming({ editorial, now, billboard: undefined })), ids(today));
  assert.deepEqual(ids(chooseUpcoming({ editorial, now, billboard: [] })), ids(today));
  assert.deepEqual(ids(chooseUpcoming({ editorial, now, billboard: [entry("done", "2026-11-23T20:00:00Z", 8, "finished")] })), ids(today));
  assert.ok(today.every((m) => !m.billboard));
});
