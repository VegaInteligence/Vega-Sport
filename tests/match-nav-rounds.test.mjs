// The round picker's 34 rounds (FAILURE_MODES § 73): the provider names the round of played matches only, so the
// season's matches to come had no round and the picker showed 11 rounds of 34. A league's rounds to come are read from
// the dates: an unfinished round takes the next match of the two clubs it lacks, then the matches left, by kick-off,
// make rounds of half the clubs, each club once. Whatever does not fit stays out, as before: never a match in a wrong
// round, never a match lost from the rounds shown.
import test from "node:test";
import assert from "node:assert/strict";
import { navMatch, navPosition, navRounds } from "../dashboard/frontend/src/services/match-nav.js";

const TEAMS = Array.from({ length: 18 }, (_, i) => ({ id: `t_${String(i + 1).padStart(6, "0")}`, name: `Club ${i + 1}` }));
const DAY = 86400000;
const START = Date.parse("2026-08-14T19:00:00Z");

/** A double round robin of the 18 clubs (circle method): 34 rounds of 9, round r one week after round r - 1. */
function season() {
  const ids = TEAMS.map((_, i) => i), rounds = [];
  let ring = ids.slice(1);
  for (let r = 0; r < 17; r++) {
    const order = [0, ...ring], pairs = [];
    for (let i = 0; i < 9; i++) pairs.push(r % 2 ? [order[17 - i], order[i]] : [order[i], order[17 - i]]);
    rounds.push(pairs);
    ring = [ring.at(-1), ...ring.slice(0, -1)];
  }
  const all = [...rounds, ...rounds.map((pairs) => pairs.map(([h, a]) => [a, h]))];
  return all.flatMap((pairs, r) => pairs.map(([h, a], i) => ({ round: r + 1, h, a, t: START + r * 7 * DAY + Math.floor(i / 3) * DAY + (i % 3) * 7200000 })));
}

/** API rows: played (and named) up to `named`, `partial` matches of the next round played too. */
function rows({ named = 11, partial = 0, edit = (x) => x } = {}) {
  let count = 0;
  return edit(season()).map((m, i) => {
    const done = m.round <= named || (m.round === named + 1 && count++ < partial);
    return {
      id: `m_${String(i).padStart(6, "0")}`, time_utc: new Date(m.t).toISOString(), status: done ? "finished" : "not_started",
      round_name: done ? String(m.round) : null, has_playoff: false, home_team: TEAMS[m.h], away_team: TEAMS[m.a],
      score_home: done ? 1 : null, score_away: done ? 0 : null, _round: m.round,
    };
  });
}
const nav = (list) => ({ matches: list.map(navMatch), rounds: Object.fromEntries(list.filter((r) => r.round_name).map((r) => [r.id, { name: r.round_name, playoff: false }])) });
const truth = (list) => Object.fromEntries(list.map((r) => [r.id, String(r._round)]));
const placed = (groups) => Object.fromEntries(groups.flatMap((g) => g.matches.map((m) => [m.id, g.name])));
const clubs = (g) => new Set(g.matches.flatMap((m) => [m.home.id, m.away.id]));

test("R46 the 34 rounds of a league whose 11 first are played: each of 9 matches, each club once, in its true round", () => {
  const list = rows();
  const groups = navRounds(nav(list));
  assert.equal(groups.length, 34);
  assert.deepEqual(groups.map((g) => g.name), Array.from({ length: 34 }, (_, i) => String(i + 1)));
  for (const g of groups) {
    assert.equal(g.matches.length, 9, g.label);
    assert.equal(clubs(g).size, 18, g.label);
  }
  assert.deepEqual(placed(groups), truth(list), "every match in its own round, none lost");
  assert.equal(groups[11].label, "12ᵉ journée");
  assert.deepEqual(groups.map((g) => Boolean(g.inferred)), Array.from({ length: 34 }, (_, i) => i >= 11));
});

test("R46 a round under way (3 of 9 played) takes its 6 matches to come, not the next round's", () => {
  const list = rows({ partial: 3 });
  const groups = navRounds(nav(list));
  assert.equal(groups.length, 34);
  assert.deepEqual(placed(groups), truth(list));
});

test("R46 a postponed match of round 5, set between rounds 12 and 13, goes back to round 5", () => {
  const list = rows({
    edit: (all) => {
      const late = all.find((m) => m.round === 5 && m.h === all.find((x) => x.round === 5).h);
      late.t = START + 11 * 7 * DAY + 4 * DAY; // the Tuesday after round 12's weekend
      return all;
    },
  }).map((r) => (r._round === 5 && r.time_utc > "2026-10-01" ? { ...r, status: "not_started", round_name: null, score_home: null, score_away: null } : r));
  const groups = navRounds(nav(list));
  assert.equal(groups.length, 34);
  assert.deepEqual(placed(groups), truth(list));
});

test("R46 matches that do not make a round stay out: no round is made up, none of the named rounds loses a match", () => {
  // Round 20's first match moved into the middle of round 19: from there on the dates no longer give rounds of each club once.
  const list = rows({ edit: (all) => { all.find((m) => m.round === 20).t = START + 18 * 7 * DAY + DAY + 3600000; return all; } });
  const groups = navRounds(nav(list));
  const where = placed(groups), real = truth(list);
  for (const [id, name] of Object.entries(where)) assert.equal(name, real[id], `${id} placed in round ${name}`);
  for (const g of groups) assert.equal(clubs(g).size, 18, g.label);
  assert.ok(groups.length >= 18 && groups.length < 34, `${groups.length} rounds`);
  for (let r = 1; r <= 11; r++) assert.equal(groups[r - 1].matches.length, 9);
});

test("R46 a cup's rounds are left as they are", () => {
  const cup = [
    { id: "c1", time_utc: "2026-02-01T20:00:00Z", status: "finished", round_name: "1/8", home_team: TEAMS[0], away_team: TEAMS[1], score_home: 1, score_away: 0 },
    { id: "c2", time_utc: "2026-02-02T20:00:00Z", status: "finished", round_name: "1/8", home_team: TEAMS[2], away_team: TEAMS[3], score_home: 1, score_away: 0 },
    { id: "c3", time_utc: "2026-03-01T20:00:00Z", status: "not_started", round_name: null, home_team: TEAMS[0], away_team: TEAMS[2] },
  ];
  const groups = navRounds(nav(cup));
  assert.deepEqual(groups.map((g) => [g.name, g.matches.map((m) => m.id)]), [["1/8", ["c1", "c2"]]]);
});

test("R46 a match to come has its place in the thread: previous and next around it", () => {
  const list = rows();
  const groups = navRounds(nav(list));
  const id = list.find((r) => r._round === 20).id;
  const at = navPosition(groups, id);
  assert.equal(at.group.name, "20");
  assert.ok(at.previous && at.next);
});

test("R48 a time not set yet (midnight UTC for a whole round) is no time; one real midnight kick-off keeps its time", () => {
  const base = rows();
  const day30 = base.find((r) => r._round === 30).time_utc.slice(0, 10);
  const list = base.map((r) => (r._round === 30 ? { ...r, time_utc: `${day30}T00:00:00Z`, date: day30 } : r));
  const real = list.find((r) => r._round === 29);
  real.time_utc = `${real.time_utc.slice(0, 10)}T00:00:00Z`;
  const groups = navRounds(nav(list));
  const r30 = groups.find((g) => g.name === "30"), r29 = groups.find((g) => g.name === "29");
  assert.equal(r30.matches.length, 9);
  assert.ok(r30.matches.every((m) => m.timeUtc === null && m.date === day30));
  assert.ok(r29.matches.some((m) => m.timeUtc === real.time_utc));
});
