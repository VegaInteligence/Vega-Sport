// The match's « Qui a dominé, minute par minute » (approved mock-up B, 20 Nov 2026), its data side:
// dashboard/frontend/src/services/match-momentum.js. Written before the code.
//
// Failure modes and expected outcomes:
//  M1 stoppage points (45.5, 90.5, 90.75) drawn over the next minute
//       -> each half is its own panel; 45.5 is the last slot of the first half, 90.5/90.75 of the second
//  M2 extra time (91–120.75) squeezed after 90 -> a third panel « Prolongation », only when it was played
//  M3 a point without a number, unsorted or repeated -> ignored, sorted, one slot per minute
//  M4 the half's share invented when nobody pressed -> null; otherwise rounded shares summing to 100
//  M5 the 5-minute average reaching across the break -> centred mean of up to 5 points of its own panel
//  M6 a goal in stoppage time put at the wrong minute or half -> its period's panel, the stoppage slot
//  M7 the score beside a goal read as the score before it -> the score after, counted goal by goal;
//       an own goal counts for the other side, which is the side drawn
//  M8 a stoppage slot labelled « 45.5′ » -> « 45+ »
import test from "node:test";
import assert from "node:assert/strict";
import { momentumPanels } from "../dashboard/frontend/src/services/match-momentum.js";

const HOME = "t_home", AWAY = "t_away";
const pts = (pairs) => pairs.map(([minute, value]) => ({ minute, value }));
const goal = (minute, period, team, extra = {}) => ({
  event_type: "goal", minute, period, team_id: team, is_own_goal: false, minute_added: null,
  player: { name: `P${minute}` }, ...extra,
});
const range = (a, b, value = 10) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, value]);

test("M1: stoppage points stay in their half, one panel per half", () => {
  const out = momentumPanels(pts([...range(0, 45), [45.5, 5], ...range(46, 90), [90.5, 7], [90.75, 0]]), [], { homeId: HOME });
  assert.deepEqual(out.panels.map((p) => p.key), ["first", "second"]);
  assert.equal(out.panels[0].points.at(-1).minute, 45.5);
  assert.equal(out.panels[1].points[0].minute, 46);
  assert.deepEqual(out.panels[1].points.slice(-2).map((p) => p.minute), [90.5, 90.75]);
  assert.deepEqual(out.panels.map((p) => p.label), ["1re mi-temps", "2e mi-temps"]);
});

test("M2: extra time is a third panel, and only when played", () => {
  const out = momentumPanels(pts([...range(0, 45), ...range(46, 90), [90.5, 1], ...range(91, 105), [105.5, 1], ...range(106, 120), [120.5, 0], [120.75, 0]]), [], { homeId: HOME });
  assert.deepEqual(out.panels.map((p) => p.key), ["first", "second", "extra"]);
  assert.equal(out.panels[2].label, "Prolongation");
  assert.equal(out.panels[2].points[0].minute, 91);
  assert.equal(out.panels[2].points.at(-1).minute, 120.75);
  assert.deepEqual(out.panels[2].ticks, [105, 120]);
  assert.deepEqual(out.panels[0].ticks, [0, 15, 30, 45]);
  assert.deepEqual(out.panels[1].ticks, [60, 75, 90]);
});

test("M3: points without a number are ignored; sorted; one slot per minute", () => {
  const out = momentumPanels([{ minute: 2, value: 5 }, { minute: 1, value: null }, { minute: "x", value: 3 }, { minute: 0, value: 4 }, { minute: 2, value: 9 }], [], { homeId: HOME });
  assert.deepEqual(out.panels[0].points.map((p) => [p.minute, p.value]), [[0, 4], [2, 9]]);
});

test("M3: nothing to draw is null", () => {
  assert.equal(momentumPanels([], [], { homeId: HOME }), null);
  assert.equal(momentumPanels(null, [], { homeId: HOME }), null);
  assert.equal(momentumPanels([{ minute: 3, value: null }], [], { homeId: HOME }), null);
});

test("M4: each half's share of the pressure, null when nobody pressed", () => {
  const out = momentumPanels(pts([[1, 30], [2, -10], [3, -50], [4, 0], [46, 0], [47, 0]]), [], { homeId: HOME });
  // 30 for the home side, 60 for the away side: 33 / 67.
  assert.deepEqual(out.panels[0].share, { home: 33, away: 67 });
  assert.equal(out.panels[1].share, null);
  const even = momentumPanels(pts([[1, 1], [2, -2]]), [], { homeId: HOME });
  assert.equal(even.panels[0].share.home + even.panels[0].share.away, 100);
});

test("M5: the 5-minute average is centred and stays in its panel", () => {
  const out = momentumPanels(pts([[41, 10], [42, 20], [43, 30], [44, 40], [45, 50], [46, -100], [47, -100]]), [], { homeId: HOME });
  const first = out.panels[0].points;
  assert.equal(first.find((p) => p.minute === 43).avg, 30); // (10+20+30+40+50)/5
  assert.equal(first.find((p) => p.minute === 45).avg, 40); // (30+40+50)/3, not reaching 46
  assert.equal(first.find((p) => p.minute === 41).avg, 20); // (10+20+30)/3
  assert.equal(out.panels[1].points[0].avg, -100);
});

test("M6: a goal goes to its period's panel; stoppage time to the stoppage slot", () => {
  const out = momentumPanels(
    pts([...range(0, 45), [45.5, 0], ...range(46, 90), [90.5, 0], ...range(91, 120)]),
    [goal(22, "FirstHalf", AWAY), goal(45, "FirstHalf", HOME, { minute_added: 2 }), goal(90, "SecondHalf", HOME, { minute_added: 3 }), goal(93, "ExtraTime", AWAY), { event_type: "card", minute: 10, period: "FirstHalf", team_id: HOME }],
    { homeId: HOME },
  );
  assert.deepEqual(out.goals.map((g) => [g.panel, g.slot, g.label]), [[0, 22, "22′"], [0, 45.5, "45+2′"], [1, 90.5, "90+3′"], [2, 93, "93′"]]);
  assert.deepEqual(out.goals.map((g) => g.side), ["away", "home", "home", "away"]);
  assert.equal(out.goals[0].player, "P22");
});

test("M6: a goal whose minute has no point goes to the nearest slot of its panel", () => {
  const out = momentumPanels(pts([[20, 1], [24, 1], [50, 1]]), [goal(23, "FirstHalf", HOME)], { homeId: HOME });
  assert.deepEqual([out.goals[0].panel, out.goals[0].slot], [0, 24]);
});

test("M7: the score after each goal; an own goal counts for the other side", () => {
  const out = momentumPanels(pts(range(0, 90)),
    [goal(58, "SecondHalf", AWAY), goal(22, "FirstHalf", AWAY), goal(70, "SecondHalf", AWAY, { is_own_goal: true })],
    { homeId: HOME });
  assert.deepEqual(out.goals.map((g) => [g.slot, g.score, g.side, g.ownGoal]), [[22, [0, 1], "away", false], [58, [0, 2], "away", false], [70, [1, 2], "home", true]]);
});

test("M8: a stoppage slot reads « 45+ », a minute « 38′ »", () => {
  const out = momentumPanels(pts([[38, 1], [45.5, 2]]), [], { homeId: HOME });
  assert.deepEqual(out.panels[0].points.map((p) => p.label), ["38′", "45+"]);
});
