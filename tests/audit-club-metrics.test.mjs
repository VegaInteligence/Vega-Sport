// A club's descriptive indicators keep an unknown unknown, read each ratio on one support,
// and use one expected-points law (calculation audit of 16 Nov 2026, VI-23 B6). Written before
// the corrections: docs/calculs/09-audit-2026-11/FAILURE_MODES.md §7.
//
// club-scout.js runs with its real code; React, the football context and the reads are stubbed
// as in club-league-cohort.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");

/** club-scout.js; `league` answers the league reads: {league id: {clubs, matches}}. */
function loadClubScout(league = {}) {
  const stubs = {
    react: React,
    "../hooks/FootballContext.jsx": { useFootball: () => null },
    "../data-url.js": { apiUrl: (p) => p },
    "./public-api-fetch.js": { publicApiFetch: async () => assert.fail("no other read") },
    "./compact-reads.js": {
      compactGeneration: (manifest) => manifest?.publicationVersion || "",
      compactScope: (ids) => ids.join(","),
      supportsCompactRead: () => true,
      readCompact: async () => assert.fail("no single read"),
      readCompactPages: async (kind, params) => {
        const id = params.league || params.leagues;
        if (kind === "clubs") return { pages: [{ clubs: league[id].clubs }] };
        if (kind === "league") return { pages: [{ matches: league[id].matches, fixtures: [], appearances: [], teams: [], competitions: [] }] };
        return assert.fail("unexpected read " + kind);
      },
    },
  };
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = babel.transformSync(fs.readFileSync(file, "utf8"), {
      presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename: file,
    }).code;
    vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename: file })(
      (name) => {
        if (name in stubs && (file.endsWith("club-scout.js") || name === "react")) return stubs[name];
        if (!name.startsWith(".")) return requireLocal(name);
        return load(path.resolve(path.dirname(file), name));
      },
      mod, mod.exports, process,
    );
    return mod.exports;
  };
  return load(path.join(root, "dashboard/frontend/src/services/club-scout.js"));
}

const scout = loadClubScout();
const { METRICS, outcomeChances, teamRows, opponentStrength } = scout;

/* Independent reference of the expected-points law: log-space Poisson, 200 goals a side. */
function law(a, b) {
  const pmf = (l) => Array.from({ length: 200 }, (_, k) => {
    let lg = 0;
    for (let i = 2; i <= k; i++) lg += Math.log(i);
    return Math.exp(-l + k * Math.log(l) - lg);
  });
  const pa = pmf(Math.max(0.01, a)), pb = pmf(Math.max(0.01, b));
  let win = 0, draw = 0, loss = 0;
  for (let i = 0; i < 200; i++)
    for (let j = 0; j < 200; j++) {
      const p = pa[i] * pb[j];
      if (i > j) win += p;
      else if (i === j) draw += p;
      else loss += p;
    }
  return { win, draw, loss, xpts: 3 * win + draw };
}
const close = (actual, expected, tolerance, label) =>
  assert.ok(actual != null && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);

/* ------------------------------------------------------------- rows */

const CLUB = "t_club", OPP = "t_opp";
const NAMES = ["xg", "npxg", "xgOpen", "xgSet", "xgot", "shots", "sot", "shotsIn", "shotsOut", "bigChances", "bigMissed", "possession",
  "passes", "passesAccurate", "oppHalfPasses", "ownHalfPasses", "longBalls", "crosses", "touchesBox", "dribbles", "duels", "groundDuels",
  "aerials", "tackles", "interceptions", "clearances", "blocks", "fouls", "yellow", "red", "corners", "offsides", "saves"];
const side = (values) => Object.fromEntries(NAMES.map((name) => [name, values[name] ?? null]));
/**
 * A row as teamRows gives it, the match carrying its real sides (the club at home, or away with
 * `away`); `shots` the match's shot list (own goals: the scorer's own team). `scoring`, the match's
 * scoring as every match record carries it since stage 8 (api.match_scoring, FAILURE_MODES §17):
 * { ownFor, ownAgainst, penalties, oppPenalties } on the club's and the opponent's sides (`ownGoalsFor`,
 * `penaltyAttempts`); a missing value is unknown, as the API's null. No `scoring`: neither field.
 */
function row({ gf = 2, ga = 1, own = {}, opp = {}, shots = [], away = false, scoring = undefined } = {}) {
  const o = side(own), p = side(opp);
  const fields = (ownGoalsFor, penaltyAttempts) => (scoring ? { ownGoalsFor: ownGoalsFor ?? null, penaltyAttempts: penaltyAttempts ?? null } : {});
  const us = { id: CLUB, name: "Club", ...fields(scoring?.ownFor, scoring?.penalties) },
    them = { id: OPP, name: "Opp", ...fields(scoring?.ownAgainst, scoring?.oppPenalties) };
  return {
    match: { id: "m", home: away ? them : us, away: away ? us : them, shots }, side: away ? "away" : "home", opponent: them, gf, ga,
    result: gf > ga ? "V" : gf === ga ? "N" : "D", points: gf > ga ? 3 : gf === ga ? 1 : 0, own: o, opp: p,
    xpts: o.xg != null && p.xg != null ? law(o.xg, p.xg).xpts : null,
  };
}
// Shots as the embedded club records give them (api.match_shots through match-record.mjs): the
// normalized situation codes, a goal's explicit own-goal flag; a non-goal attempt may have none.
// A missing situation is an unknown classification (FAILURE_MODES §7.2).
const goal = (teamId, extra = {}) => ({ teamId, isGoal: true, isOwnGoal: false, situation: "regular_play", ...extra });
const ownGoal = (teamId) => ({ teamId, isGoal: true, isOwnGoal: true });
const miss = (teamId, extra = {}) => ({ teamId, isGoal: false, situation: "regular_play", ...extra });
const unclassified = (teamId) => ({ teamId, isGoal: false });

// Every primitive known; the shot list reproduces the 2–1 (two club goals, one against).
const OWN = { xg: 1.4, npxg: 1.4, xgOpen: 1.0, xgSet: 0.4, xgot: 1.6, shots: 12, sot: 5, shotsIn: 8, bigChances: 2, possession: 55, passes: 500,
  passesAccurate: 430, oppHalfPasses: 250, ownHalfPasses: 180, longBalls: 40, crosses: 6, touchesBox: 25, duels: 50, aerials: 12, tackles: 15,
  interceptions: 9, fouls: 11, yellow: 2, red: 0, corners: 6 };
const OPP_SIDE = { xg: 0.9, npxg: 0.9, xgOpen: 0.7, xgSet: 0.2, xgot: 1.2, shots: 9, sot: 3, bigChances: 1, possession: 45, passes: 400,
  passesAccurate: 320, oppHalfPasses: 150, ownHalfPasses: 200, touchesBox: 15, duels: 45, aerials: 10, corners: 4 };
// The complete, reconciled shot set: all 12 of the club's shots (its 2 goals) and all 9 of the
// opponent's (its goal); none is a penalty.
const SHOTS = [goal(CLUB), goal(CLUB), ...Array.from({ length: 10 }, () => miss(CLUB)), goal(OPP), ...Array.from({ length: 8 }, () => miss(OPP))];
// The match's scoring as the server establishes it: no own goal either way, no penalty attempt.
const SCORED = { ownFor: 0, ownAgainst: 0, penalties: 0, oppPenalties: 0 };
const complete = (change = {}) => row({ own: { ...OWN, ...change.own }, opp: { ...OPP_SIDE, ...change.opp }, shots: change.shots ?? SHOTS,
  scoring: "scoring" in change ? change.scoring : SCORED });

// metric: [value on the complete row, inputs ("own.x", "opp.x", "scoring": the match's own goals,
// "penalties": the club's penalty attempts)]
const MATRIX = {
  keeper: [1.2 - 1, ["opp.xgot", "scoring"]],
  fieldTilt: [(100 * 250) / 400, ["own.oppHalfPasses", "opp.oppHalfPasses"]],
  boxShare: [(100 * 25) / 40, ["own.touchesBox", "opp.touchesBox"]],
  duels: [(100 * 50) / 95, ["own.duels", "opp.duels"]],
  aerials: [(100 * 12) / 22, ["own.aerials", "opp.aerials"]],
  ppda: [200 / 35, ["opp.ownHalfPasses", "own.tackles", "own.interceptions", "own.fouls"]],
  defActions: [(24 * 50) / 45, ["own.tackles", "own.interceptions", "own.possession"]],
  passAccuracy: [(100 * 430) / 500, ["own.passesAccurate", "own.passes"]],
  directness: [(100 * 40) / 430, ["own.longBalls", "own.passesAccurate"]],
  boxShots: [(100 * 8) / 12, ["own.shotsIn", "own.shots"]],
  setShare: [(100 * 0.4) / 1.4, ["own.xgSet", "own.xg"]],
  placement: [1.6 - 1.4, ["own.xgot", "own.xg"]],
  // Penalty attempts as the server counts them on the complete shot set (no xG = npxG shortcut).
  xgPerShot: [1.4 / 12, ["own.npxg", "own.shots", "penalties"]],
  finishing: [2 - 1.4, ["own.xg", "scoring"]],
  conversion: [(100 * 2) / 12, ["own.shots", "scoring"]],
  red: [0, ["own.red"]],
};

test("every derived indicator on a complete row (BC)", () => {
  for (const [key, [value]] of Object.entries(MATRIX)) close(METRICS[key].get([complete()]), value, 1e-9, key);
});

test("each input removed alone makes its indicator unknown (failure matrix)", () => {
  const wrong = [];
  for (const [key, [, inputs]] of Object.entries(MATRIX))
    for (const input of inputs) {
      const [where, name] = input.split(".");
      const change = input === "scoring" ? { scoring: { ...SCORED, ownFor: null } }
        : input === "penalties" ? { scoring: { ...SCORED, penalties: null } } : { [where]: { [name]: null } };
      const value = METRICS[key].get([complete(change)]);
      if (value !== null) wrong.push(`${key} without ${input}: ${value}`);
    }
  assert.deepEqual(wrong, []);
});

test("the audit's row: the opponent's figures unknown", () => {
  const r = row({ gf: 1, ga: 2,
    own: { xg: 1, xgot: 1, oppHalfPasses: 100, touchesBox: 10, tackles: 10, possession: 50, duels: 20, aerials: 8 },
    opp: { xg: 1, ownHalfPasses: 200 } });
  const got = Object.fromEntries(["keeper", "fieldTilt", "boxShare", "ppda", "defActions", "duels", "aerials"].map((k) => [k, METRICS[k].get([r])]));
  assert.deepEqual(got, { keeper: null, fieldTilt: null, boxShare: null, ppda: null, defActions: null, duels: null, aerials: null });
});

test("a missing xG does not hide an indicator that does not read it", () => {
  const rows = [complete(), complete({ own: { xg: null, npxg: null, possession: 45, duels: 30 }, opp: { xg: null, npxg: null, duels: 30 } })];
  close(METRICS.possession.get(rows), 50, 1e-9, "possession");
  close(METRICS.duels.get(rows), (100 * 80) / 155, 1e-9, "duels"); // (50 + 30) / ((50 + 45) + (30 + 30))
  close(METRICS.xg.get(rows), 1.4, 1e-9, "xg"); // the xG itself: the covered match only
});

test("known zeros stay values; an empty denominator is unknown", () => {
  assert.equal(METRICS.duels.get([complete({ own: { duels: 0 }, opp: { duels: 0 } })]), null);
  close(METRICS.duels.get([complete({ own: { duels: 5 }, opp: { duels: 0 } })]), 100, 1e-9, "duels 5–0");
  assert.equal(METRICS.ppda.get([complete({ own: { tackles: 0, interceptions: 0, fouls: 0 } })]), null);
  assert.equal(METRICS.defActions.get([complete({ own: { possession: 100 } })]), null);
  // Red cards: never observed is unknown; observed zero is zero.
  assert.equal(METRICS.red.get([complete({ own: { red: null } }), complete({ own: { red: null } })]), null);
  assert.equal(METRICS.red.get([complete(), complete({ own: { red: null } })]), 0);
  assert.equal(METRICS.red.get([complete({ own: { red: 1 } }), complete({ own: { red: null } })]), 1);
});

test("a penalty changes neither side of the shot quality (15e)", () => {
  // The club's penalty attempts as the server counts them on the match's complete, reconciled shot
  // set (agg.match_scoring, FAILURE_MODES §17): left out of both terms.
  const match = (own, penalties, extra = {}) => row({ gf: 1, ga: 0, own, opp: { xg: 0.5, shots: 3 }, scoring: { ...SCORED, penalties }, ...extra });
  const xgPerShot = (r) => METRICS.xgPerShot.get([r]);
  close(xgPerShot(match({ xg: 1, npxg: 1, shots: 10 }, 0)), 0.1, 1e-12, "no penalty");
  close(xgPerShot(match({ xg: 1.78, npxg: 1, shots: 11 }, 1)), 0.1, 1e-12, "one penalty more");
  // Attempts unknown (the API's null, or a record read without the field): equal xG and non-penalty
  // xG establish nothing (FAILURE_MODES §7.2).
  assert.equal(xgPerShot(match({ xg: 1.78, npxg: 1, shots: 11 }, null)), null, "attempts unknown");
  assert.equal(xgPerShot(match({ xg: 1, npxg: 1, shots: 10 }, null)), null, "equal totals, attempts unknown");
  assert.equal(xgPerShot(row({ gf: 1, ga: 0, own: { xg: 1, npxg: 1, shots: 10 }, opp: { xg: 0.5, shots: 3 } })), null, "a record without the field");
  // The shot list is not read: its penalty is not the match's count.
  close(xgPerShot(match({ xg: 1, npxg: 1, shots: 10 }, 0, { shots: [miss(CLUB, { situation: "penalty" })] })), 0.1, 1e-12, "a listed penalty");
  // Nothing but penalties: no non-penalty attempt to divide by.
  assert.equal(xgPerShot(match({ xg: 0.76, npxg: 0, shots: 1 }, 1)), null, "a non-penalty denominator of 0");
});

test("the four read the match's scoring, never its shot list (§17, stage 8)", () => {
  // Written before the correction. The shot set's spellings, teams and flags are the server's
  // (agg.match_scoring, MatchScoringTest a–n); the client reads each side's two fields.
  const keys = ["finishing", "conversion", "keeper", "xgPerShot"];
  const want = Object.fromEntries(keys.map((key) => [key, MATRIX[key][0]]));
  // Production's goal shots: an ordinary goal's flag is null, never false (§17.1). The match's
  // scoring still measures it — before stage 8, every match with a goal was left out.
  const unflagged = SHOTS.map((s) => (s.isGoal ? { teamId: s.teamId, isGoal: true, situation: "regular_play" } : s));
  for (const key of keys) close(METRICS[key].get([complete({ shots: unflagged })]), want[key], 1e-12, `${key}: unflagged goals`);
  // No shot list (the league's summary read), another team's goal or an unknown situation in it: the same values.
  const alien = SHOTS.map((s, i) => (i === 0 ? goal("t_alien") : i === 3 ? unclassified(CLUB) : s));
  for (const shots of [[], alien])
    for (const key of keys) close(METRICS[key].get([complete({ shots })]), want[key], 1e-12, `${key}: ${shots.length} shots`);
  // The scoring unknown: the API's nulls, or a record read without the fields.
  for (const key of keys) {
    assert.equal(METRICS[key].get([complete({ scoring: { ownFor: null, ownAgainst: null, penalties: null, oppPenalties: null } })]), null, `${key}: null scoring`);
    assert.equal(METRICS[key].get([complete({ scoring: undefined })]), null, `${key}: no scoring fields`);
  }
  // The opponent's side unknown: the own-goal-adjusted three are; the shot quality reads the attempts alone.
  const half = complete({ scoring: { ...SCORED, ownAgainst: null } });
  for (const key of ["finishing", "conversion", "keeper"]) assert.equal(METRICS[key].get([half]), null, `${key}: one side unknown`);
  close(METRICS.xgPerShot.get([half]), want.xgPerShot, 1e-12, "xgPerShot on its attempts");
  // A value that is no count is unknown.
  for (const bad of [-1, 0.5, "1", Number.NaN]) {
    assert.equal(METRICS.finishing.get([complete({ scoring: { ...SCORED, ownFor: bad } })]), null, `ownGoalsFor ${String(bad)}`);
    assert.equal(METRICS.xgPerShot.get([complete({ scoring: { ...SCORED, penalties: bad } })]), null, `penaltyAttempts ${String(bad)}`);
  }
});

test("an own goal is neither the scorer's finishing nor the keeper's fault (15f)", () => {
  // Two goals for, one of them the opponent's own goal: finishing 1 − 1.0, conversion 1 in 10.
  const forUs = (away) => row({ gf: 2, ga: 0, own: { xg: 1.0, shots: 10 }, opp: { xg: 0.4, xgot: 0.5 }, scoring: { ...SCORED, ownFor: 1 }, away });
  // Two goals against, one of them the club's own goal: the keeper let in one, for 1.5 xGOT.
  const againstUs = (away) => row({ gf: 0, ga: 2, own: { xg: 0.3, shots: 4 }, opp: { xg: 1.1, xgot: 1.5 }, scoring: { ...SCORED, ownAgainst: 1 }, away });
  for (const away of [false, true]) {
    const where = away ? ", away" : "";
    close(METRICS.finishing.get([forUs(away)]), 0, 1e-12, "finishing" + where);
    close(METRICS.conversion.get([forUs(away)]), 10, 1e-12, "conversion" + where);
    close(METRICS.keeper.get([againstUs(away)]), 0.5, 1e-12, "keeper" + where);
  }
});

/* -------------------------------------------------------------- xPts law */

test("the expected-points law: symmetric, monotonic, complete, with its floor", () => {
  const six = outcomeChances(6, 6);
  close(six.win, six.loss, 1e-12, "6 v 6 win = loss");
  close(six.xpts, 1.441786889393, 1e-9, "6 v 6");
  close(outcomeChances(0, 0).xpts, 1.009851652188, 1e-9, "0 v 0 floored");
  for (const [a, b, value] of [[1, 1, 1.345745838723], [6, 1, 2.9204797647], [8, 1, 2.980046839625], [1.8, 0.9, 1.987180740701], [2.2, 1.0, 2.132300503421]])
    close(outcomeChances(a, b).xpts, value, 1e-9, `${a} v ${b}`);
  for (const [a, b] of [[1.8, 0.9], [0.3, 2.6], [12, 3], [30, 0.2]]) {
    const ab = outcomeChances(a, b), ba = outcomeChances(b, a);
    close(ab.win, ba.loss, 1e-12, `swap ${a} ${b}`);
    close(ab.win + ab.draw + ab.loss, 1, 1e-12, `sum ${a} ${b}`);
    close(ab.xpts, law(a, b).xpts, 1e-9, `reference ${a} ${b}`);
  }
  for (const b of [0.5, 1, 2, 6]) {
    let previous = -Infinity;
    for (let a = 0; a <= 20; a += 0.25) {
      const value = outcomeChances(a, b).xpts;
      assert.ok(value >= previous - 1e-12, `xPts fall from ${previous} to ${value} at ${a} v ${b}`);
      previous = value;
    }
  }
});

test("an impossible expected-goals input has no law", () => {
  for (const [a, b] of [[-0.5, 1], [1, -1], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1]]) assert.equal(outcomeChances(a, b), null, `${a} v ${b}`);
  // The supported domain ends at 100 xG a side (interim review, P2): 100 is computed, beyond it
  // there is no law, without an error or a silent clamp.
  const edge = outcomeChances(100, 1), reference = law(100, 1);
  for (const key of ["win", "draw", "loss", "xpts"]) close(edge?.[key], reference[key], 1e-9, `100 v 1 ${key}`);
  for (const [a, b] of [[100.5, 1], [750, 1], [1, 750], [1e300, 1], [1, Number.MAX_VALUE]]) {
    let got;
    assert.doesNotThrow(() => (got = outcomeChances(a, b)), `${a} v ${b} throws`);
    assert.equal(got, null, `${a} v ${b}`);
  }
  const [r] = teamRows([{ id: "m1", status: "finished", date: "2026-01-01", leagueId: "l_x", coverage: { teamStatsReliable: true },
    home: { id: CLUB, score: 1 }, away: { id: OPP, score: 0 }, stats: [{ key: "expected_goals", home: -0.4, away: 1.1 }] }], CLUB);
  assert.equal(r.xpts, null);
});

/* ------------------------------------------------------- cohort fields */

const fixture = (id, leagueId, home, away, hs, as, xg) => ({
  id, leagueId, date: `2026-01-${String(10 + Number(id.slice(-1))).padStart(2, "0")}`, timeUtc: "19:00", status: "finished",
  home: { id: home, name: home, imageUrl: null, score: hs }, away: { id: away, name: away, imageUrl: null, score: as },
  coverage: { teamStatsReliable: true },
  stats: [{ key: "total_shots", home: 10, away: 8 }, ...(xg ? [{ key: "expected_goals", home: xg[0], away: xg[1] }] : [])],
});
const club = (id) => ({ id, name: id, imageUrl: null, country: "FRA" });
const LEAGUES = {
  l_one: {
    clubs: ["t_a", "t_b", "t_c"].map(club),
    matches: [
      fixture("a1", "l_one", "t_a", "t_x", 1, 0, [1.0, 1.0]), fixture("a2", "l_one", "t_a", "t_x", 2, 0, [2.0, 0.5]), fixture("a3", "l_one", "t_a", "t_x", 0, 0, [0.5, 0.5]),
      fixture("b1", "l_one", "t_b", "t_y", 1, 0, [3.0, 0.2]), fixture("b2", "l_one", "t_b", "t_y", 4, 0, null), fixture("b3", "l_one", "t_b", "t_y", 3, 0, null),
      fixture("c1", "l_one", "t_c", "t_z", 0, 1, null), fixture("c2", "l_one", "t_c", "t_z", 0, 0, null), fixture("c3", "l_one", "t_c", "t_z", 1, 0, null),
    ],
  },
  // The audit's club: two wins, one with xG (1 v 1).
  l_two: { clubs: [club("t_d")], matches: [fixture("d1", "l_two", "t_d", "t_w", 1, 0, [1, 1]), fixture("d2", "l_two", "t_d", "t_w", 4, 0, null)] },
  // E: one match with both xG, one with its own only, one with the opponent's only.
  // F: never both in the same match.
  l_three: {
    clubs: [club("t_e"), club("t_f")],
    matches: [
      fixture("e1", "l_three", "t_e", "t_v", 2, 1, [1.5, 0.5]), fixture("e2", "l_three", "t_e", "t_v", 1, 1, [2.5, null]),
      fixture("e3", "l_three", "t_e", "t_v", 0, 1, [null, 0.1]),
      fixture("f1", "l_three", "t_f", "t_u", 1, 0, [1.0, null]), fixture("f2", "l_three", "t_f", "t_u", 0, 0, [null, 0.8]),
    ],
  },
};
const cohortOf = async (id) => {
  const s = loadClubScout(LEAGUES);
  const cohort = await s.leagueCohort({ id, name: id, country: "FRA" }, { season: "2025/2026", generation: "1", whole: true }).promise;
  return { s, cohort, by: Object.fromEntries(cohort.clubs.map((c) => [c.id, c])) };
};

test("the audit's club: season points apart, actual and expected points on the same matches", async () => {
  const { by } = await cohortOf("l_two");
  const d = by.t_d;
  // Unchanged meanings: every match's points, the covered matches' xPts. Subtracting them
  // (ClubScoutTabs.jsx:86, 291-298, owned by VI-22) still gives the audit's +4.65: the
  // consumer's handoff (FAILURE_MODES §11), not a value of this service.
  assert.equal(d.record.points, 6);
  close(d.xptsTotal, 1.345745838723, 1e-6, "xptsTotal");
  close(d.record.points - d.xptsTotal, 4.654254161277, 1e-6, "unpaired consumer gap");
  assert.equal(d.pairedMatches, 1);
  assert.equal(d.pairedActualPoints, 3);
  close(d.pairedExpectedPoints, 1.345745838723, 1e-9, "paired xPts");
  close(d.pairedPointsDelta, 1.654254161277, 1e-9, "paired delta");
});

test("clubs are placed on xPts per covered match unless every club is covered", async () => {
  const { s, cohort, by } = await cohortOf("l_one");
  const a = law(1, 1).xpts + law(2, 0.5).xpts + law(0.5, 0.5).xpts, b = law(3, 0.2).xpts;
  // B's one covered match is worth more than A's average; C, never covered, comes last.
  assert.ok(b > a / 3);
  assert.deepEqual([by.t_b.xptsPosition, by.t_a.xptsPosition, by.t_c.xptsPosition], [1, 2, 3]);
  assert.deepEqual([by.t_a.pairedMatches, by.t_b.pairedMatches, by.t_c.pairedMatches], [3, 1, 0]);
  close(by.t_a.pairedExpectedPoints, a, 1e-9, "A paired xPts");
  close(by.t_a.pairedPointsDelta, 7 - a, 1e-9, "A delta");
  close(by.t_b.pairedPointsDelta, 3 - b, 1e-9, "B delta");
  assert.deepEqual([by.t_c.pairedActualPoints, by.t_c.pairedExpectedPoints, by.t_c.pairedPointsDelta], [null, null, null]);
  // Each indicator says on how many matches it stands.
  assert.deepEqual([by.t_a.coverage.xg, by.t_b.coverage.xg, by.t_c.coverage.xg, by.t_b.coverage.ppm], [3, 1, 0, 3]);
  // A league read carries no shot list: own goals are not classified, so the residuals are unknown.
  assert.deepEqual([by.t_a.values.finishing, by.t_a.values.keeper, by.t_a.values.conversion], [null, null, null]);
  // Rebased on another referential, the paired fields travel with the club.
  const rebased = s.rebase({ id: "t_b", self: by.t_b }, [cohort], "Référentiel");
  close(rebased.self.pairedPointsDelta, 3 - b, 1e-9, "rebased delta");
});

test("the xG difference is read on the matches that know both xG", async () => {
  const { by } = await cohortOf("l_three");
  const e = by.t_e, f = by.t_f;
  // The ordinary means keep their marginal meaning: each on the matches that know it.
  close(e.values.xg, 2.0, 1e-12, "E xG per match");
  close(e.values.xga, 0.3, 1e-12, "E xGA per match");
  // The difference: on the one match that knows both (not 2.0 − 0.3).
  assert.equal(e.pairedXgMatches, 1);
  close(e.pairedXgFor, 1.5, 1e-12, "E paired xG");
  close(e.pairedXgAgainst, 0.5, 1e-12, "E paired xGA");
  close(e.pairedXgDelta, 1.0, 1e-12, "E paired delta");
  close(e.pairedXgDeltaPerMatch, 1.0, 1e-12, "E paired delta per match");
  assert.deepEqual([f.pairedXgMatches, f.pairedXgFor, f.pairedXgAgainst, f.pairedXgDelta, f.pairedXgDeltaPerMatch], [0, null, null, null, null]);
});

test("an opponent's strength is its paired xG difference, unknown without one", () => {
  // Marginal means apart from the paired differences, so that the two readings disagree.
  const clubs = [["x1", 1.2, 1.0, null], ["x2", 0.8, 1.3, 0.5], ["x3", 1.2, 1.0, 0.2], ["x4", 0.9, 1.0, -0.1], ["x5", 0.8, 1.1, -0.3], ["x6", 1.8, 1.0, 0.8]]
    .map(([id, xg, xga, delta]) => ({ id, values: { xg, xga }, pairedXgMatches: delta === null ? 0 : 4, pairedXgDeltaPerMatch: delta }));
  assert.equal(opponentStrength({ clubs }, "x1"), null);
  // x2 (+0.5 per match) among the five clubs with a paired difference: three below, itself equal.
  assert.equal(opponentStrength({ clubs }, "x2").centile, 70);
});

/* ---------------------------------------------------- the shot profile (§7.5, stage 3) */

// Written before the correction. shotProfile feeds the owned SituationTable, ShotPair and
// TeamShotMap (ClubScoutUI.jsx, VI-22); it is exported as a pure function for these tests.
const NORMALIZED = ["regular_play", "individual_play", "fast_break", "from_corner", "set_piece", "throw_in_set_piece", "free_kick", "penalty"];
const PROVIDER = ["RegularPlay", "IndividualPlay", "FastBreak", "FromCorner", "SetPiece", "ThrowInSetPiece", "FreeKick", "Penalty"];
let shotNo = 0;
const attempt = (teamId, situation, xg, extra = {}) => ({ id: `s${++shotNo}`, teamId, situation, xg, x: 95, y: 34, isGoal: false,
  isOwnGoal: false, isOnTarget: true, isBlocked: false, playerName: "Tireur", minute: 10, ...extra });
/** One match where the club and the opponent each take one attempt of every code; the club scores its penalty. */
function everyCode(spelling) {
  shotNo = 0;
  return spelling.flatMap((code, i) => [
    attempt(CLUB, code, (i + 1) / 10, i === 7 ? { isGoal: true } : {}),
    attempt(OPP, code, (i + 1) / 20),
  ]);
}
const profileOf = (shots, away = false) => scout.shotProfile([row({ shots, away })], CLUB);
const shotsBy = (side) => Object.fromEntries(Object.entries(side).map(([key, bucket]) => [key, bucket.shots]));
const BUCKETS = { open: 2, fastBreak: 1, corner: 1, setPiece: 2, freeKick: 1, penalty: 1 };

test("the shot profile reads both spellings of every situation alike (FM-S1)", () => {
  const normalized = profileOf(everyCode(NORMALIZED)), provider = profileOf(everyCode(PROVIDER));
  assert.deepEqual(normalized, provider);
  assert.deepEqual([shotsBy(normalized.for), shotsBy(normalized.against)], [BUCKETS, BUCKETS]);
  close(normalized.for.penalty.xg, 0.8, 1e-12, "the penalty's xG");
  assert.deepEqual([normalized.for.penalty.goals, normalized.for.open.goals], [1, 0]);
  close(normalized.for.setPiece.xg, 0.5 + 0.6, 1e-12, "set piece and throw-in");
  close(normalized.against.open.xg, 0.05 + 0.1, 1e-12, "the opponent's open play");
  const penalty = normalized.mapFor.find((point) => point.id === "s15");
  assert.deepEqual([penalty.situation, penalty.outcome], ["Penalty", "goal"]);
  assert.deepEqual(normalized.unclassified, { for: { shots: 0, xg: 0, goals: 0 }, against: { shots: 0, xg: 0, goals: 0 } });
});

test("an unknown or missing situation is unclassified, never open play (FM-S2)", () => {
  shotNo = 0;
  const noKey = attempt(CLUB, "regular_play", 0.3);
  delete noKey.situation;
  const p = profileOf([attempt(CLUB, "regular_play", 0.1), attempt(CLUB, "banana", 0.2), noKey, attempt(OPP, null, 0.4, { isGoal: true })]);
  assert.deepEqual([p.for.open.shots, p.against.open.shots], [1, 0]);
  assert.equal(p.unclassified.for.shots, 2);
  close(p.unclassified.for.xg, 0.5, 1e-12, "the unclassified xG");
  assert.deepEqual([p.unclassified.against.shots, p.unclassified.against.goals], [1, 1]);
  // Their points stay on the map, labelled unavailable.
  assert.deepEqual(p.mapFor.map((point) => point.situation), ["Jeu placé", "—", "—"]);
  assert.deepEqual(p.mapAgainst.map((point) => point.situation), ["—"]);
});

test("a shot of another team, or of none, is on neither side; away reads as home (FM-S3)", () => {
  shotNo = 0;
  const p = profileOf([attempt(CLUB, "regular_play", 0.1), attempt("t_alien", "regular_play", 0.2), attempt(undefined, "regular_play", 0.3),
    attempt(OPP, "regular_play", 0.4)]);
  assert.deepEqual([p.for.open.shots, p.against.open.shots], [1, 1]);
  assert.deepEqual([p.mapFor.length, p.mapAgainst.length], [1, 1]);
  const shots = everyCode(NORMALIZED);
  assert.deepEqual(profileOf(shots, true), profileOf(shots));
});

test("a missing xG leaves its bucket's xG unknown; a known zero stays zero (FM-S4, FM-S5)", () => {
  shotNo = 0;
  const p = profileOf([attempt(CLUB, "regular_play", 0.3), attempt(CLUB, "regular_play", undefined), attempt(CLUB, "regular_play", 0.2),
    attempt(CLUB, "from_corner", 0), attempt(CLUB, "from_corner", 0), attempt(OPP, "regular_play", Number.NaN)]);
  assert.deepEqual([p.for.open.shots, p.for.open.xg], [3, null], "missing, then known: still unknown");
  assert.equal(p.for.corner.xg, 0, "known zeros");
  assert.equal(p.against.open.xg, null, "not a finite number");
  // A known 0 keeps its point at 0; a missing xG stays null on the map: ShotPair draws the point
  // small, says « xG indisponible » and leaves its header total unknown (VI-22, 17 Nov 2026).
  assert.deepEqual(p.mapFor.map((point) => point.xg), [0.3, null, 0.2, 0, 0]);
  // All known: the sums as before.
  shotNo = 0;
  const known = profileOf([attempt(CLUB, "regular_play", 0.3), attempt(CLUB, "regular_play", 0.2, { isGoal: true })]);
  close(known.for.open.xg, 0.5, 1e-12, "all known");
  assert.deepEqual([known.for.open.shots, known.for.open.goals], [2, 1]);
});

/* ------------------------------------ shoot-out shots (§14.4, stage 5; before the correction) */

test("shoot-out shots stay out of the classified metrics, the buckets and the maps (§14.4)", () => {
  // An ordinary complete 1–1: one goal and one miss a side, every goal's own-goal flag explicit.
  shotNo = 0;
  const ordinary = [attempt(CLUB, "regular_play", 0.3, { isGoal: true }), attempt(CLUB, "regular_play", 0.1),
    attempt(OPP, "regular_play", 0.3, { isGoal: true }), attempt(OPP, "regular_play", 0.1)];
  const shootout = [attempt(CLUB, "penalty", 0.78, { isGoal: true, period: "penalties" }), attempt(CLUB, "penalty", 0.78, { period: "penalties" }),
    attempt(OPP, "Penalty", 0.78, { isGoal: true, period: "Penalties" }), attempt(OPP, "Penalty", 0.78, { period: "Penalties" })];
  // The match's scoring as the server gives it (it leaves the shoot-out out: MatchScoringTest h).
  const match = (shots, penalties = 0) => row({ gf: 1, ga: 1, own: { xg: 0.4, npxg: 0.4, xgot: 0.5, shots: 2 }, opp: { xg: 0.4, npxg: 0.4, xgot: 0.8, shots: 2 }, shots,
    scoring: { ...SCORED, penalties } });
  for (const key of ["finishing", "keeper", "conversion", "xgPerShot"]) {
    const plain = METRICS[key].get([match(ordinary)]), with_ = METRICS[key].get([match([...ordinary, ...shootout])]);
    assert.notEqual(plain, null, `${key} on the ordinary match`);
    assert.equal(with_, plain, `${key} with a shoot-out`);
    assert.equal(METRICS[key].count([match([...ordinary, ...shootout])]), 1, `${key}'s support`);
  }
  assert.deepEqual(scout.shotProfile([match([...ordinary, ...shootout])], CLUB), scout.shotProfile([match(ordinary)], CLUB));
  // A genuine in-match penalty stays a penalty: the non-penalty denominator removes it alone.
  shotNo = 0;
  const inMatch = [attempt(CLUB, "regular_play", 0.3, { isGoal: true }), attempt(CLUB, "penalty", 0.76, { period: "second_half" }),
    attempt(OPP, "regular_play", 0.3, { isGoal: true }), attempt(OPP, "regular_play", 0.1)];
  close(METRICS.xgPerShot.get([match([...inMatch, ...shootout], 1)]), 0.4 / 1, 1e-12, "npxG over the one non-penalty attempt");
  const profile = scout.shotProfile([match([...inMatch, ...shootout])], CLUB);
  assert.deepEqual([profile.for.penalty.shots, profile.against.penalty.shots], [1, 0]);
});

/* ------------------------- the selected club's own shot-backed measures (§14.1, stage 5, P1) */

const SEL = "t_sel", SEASON5 = "2025/2026";
const SEL_LEAGUE = { id: "l_sel", name: "Ligue Sel", country: "FRA" };
const CUP5 = { id: "l_cup", name: "Coupe", country: "FRA" };
let recordNo = 0;
/** A match record as the API embeds it (match-record.mjs): the club's full read carries its shot
 * list; the league's summary read carries `shots: []`; both carry each side's scoring (stage 8,
 * §17) when `scoring` is given: { home: [ownGoalsFor, penaltyAttempts], away: [...] }.
 * `side`: {statistic key: [home, away]}. */
function record5(leagueId, home, away, hs, as, side, shots = [], scoring = null) {
  const n = ++recordNo;
  const fields = (name) => (scoring ? { ownGoalsFor: scoring[name][0], penaltyAttempts: scoring[name][1] } : {});
  return { id: `m${n}`, leagueId, date: `2026-0${1 + (n % 8)}-${String(10 + (n % 18)).padStart(2, "0")}`, timeUtc: "19:00", status: "finished",
    home: { id: home, name: home, imageUrl: null, score: hs, ...fields("home") }, away: { id: away, name: away, imageUrl: null, score: as, ...fields("away") },
    coverage: { teamStatsReliable: true }, stats: Object.entries(side).map(([key, [h, a]]) => ({ key, home: h, away: a })), shots };
}
const STATS5 = (shots, xg, npxg, xgot) => ({ total_shots: shots, expected_goals: xg, expected_goals_non_penalty: npxg, expected_goals_on_target: xgot });
const flagged = (teamId, isGoal, extra = {}) => ({ teamId, isGoal, isOwnGoal: false, situation: "regular_play", period: "first_half", ...extra });
/**
 * The selected club's season: s1, its one match whose scoring the server established (2 goals from
 * 2 shots, 1.2 xG; the opponent's one shot, 0.4 xGOT): finishing 0.8, keeper 0.4, conversion 100 %,
 * xG/shot 0.6 — the coordinator's browser fixture; s2 and s3 with their scoring unknown. c1: a cup
 * match, its scoring established. The peers' own matches carry theirs (stage 8: a summary read
 * measures every club). `variant`: "penaltiesUnknown" (s1's attempts of the club unknown),
 * "unscored" (s1's scoring unknown).
 */
function selectedSeason({ variant = "complete" } = {}) {
  recordNo = 0;
  const none = { home: [0, 0], away: [0, 0] };
  const s1scoring = variant === "unscored" ? { home: [null, null], away: [null, null] }
    : variant === "penaltiesUnknown" ? { home: [0, null], away: [0, 0] } : none;
  const s1shots = [flagged(SEL, true), flagged(SEL, true), flagged("t_p1", false)];
  const s1 = record5(SEL_LEAGUE.id, SEL, "t_p1", 2, 0, STATS5([2, 1], [1.2, 0.2], [1.2, 0.2], [1.3, 0.4]), s1shots, s1scoring);
  const s2 = record5(SEL_LEAGUE.id, "t_p2", SEL, 1, 1, STATS5([4, 3], [1.1, 0.7], [1.1, 0.7], [0.9, 0.6]));
  const s3 = record5(SEL_LEAGUE.id, SEL, "t_p3", 0, 1, STATS5([5, 2], [0.6, 0.9], [0.6, 0.9], [0.5, 0.7]));
  const c1 = record5(CUP5.id, SEL, "t_c1", 1, 0, STATS5([3, 1], [0.9, 0.3], [0.9, 0.3], [1.0, 0.2]),
    [flagged(SEL, true), flagged(SEL, false), flagged(SEL, false), flagged("t_c1", false)], none);
  const peers = [record5(SEL_LEAGUE.id, "t_p1", "t_p2", 2, 2, STATS5([6, 6], [1.5, 1.4], [1.5, 1.4], [1.1, 1.0]), [], none),
    record5(SEL_LEAGUE.id, "t_p3", "t_p1", 0, 0, STATS5([7, 4], [0.8, 0.5], [0.8, 0.5], [0.6, 0.3]), [], none)];
  const summary = (m) => ({ ...m, shots: [] });
  return {
    full: { matches: [s1, s2, s3, c1], fixtures: [], appearances: [], teams: [], competitions: [SEL_LEAGUE, CUP5] },
    leagues: {
      [SEL_LEAGUE.id]: { clubs: [SEL, "t_p1", "t_p2", "t_p3"].map(club), matches: [s1, s2, s3, ...peers].map(summary) },
      [CUP5.id]: { clubs: [SEL, "t_c1"].map(club), matches: [c1].map(summary) },
      l_other: { clubs: ["t_o1", "t_o2"].map(club), matches: [record5("l_other", "t_o1", "t_o2", 1, 0, STATS5([5, 5], [1.0, 0.8], [1.0, 0.8], [0.7, 0.6]))].map(summary) },
    },
  };
}
const FOUR = ["finishing", "keeper", "conversion", "xgPerShot"];
const measures = (club) => Object.fromEntries(FOUR.map((key) => [key, [club.values[key], club.coverage[key]]]));
async function selectedDossier(options) {
  const fixture = selectedSeason(options);
  const s = loadClubScout(fixture.leagues);
  const cohortOf5 = async (league) => s.leagueCohort(league, { season: SEASON5, generation: "g5", whole: true }).promise;
  const cohort = await cohortOf5(SEL_LEAGUE);
  const dossier = () => s.buildDossier({ id: SEL, season: SEASON5, data: fixture.full, competitions: [SEL_LEAGUE, CUP5], league: SEL_LEAGUE, cohort });
  return { s, fixture, cohort, dossier, cohortOf5 };
}
const assertMeasured = (club, want, label) => {
  for (const key of FOUR) {
    const [value, covered] = [club.values[key], club.coverage[key]];
    assert.ok(value != null && Math.abs(value - want[key]) < 1e-9, `${label} ${key}: ${value} != ${want[key]}`);
    assert.equal(covered, 1, `${label} ${key}'s support`);
  }
};
const DOMESTIC = { finishing: 0.8, keeper: 0.4, conversion: 100, xgPerShot: 0.6 };

test("every club of the league is measured from its summary, the selected club alike (§14.1, §17)", async () => {
  const { cohort, dossier } = await selectedDossier();
  const before = structuredClone(cohort);
  const d = dossier();
  assertMeasured(d.self, DOMESTIC, "self");
  // The summary measures the club as its full read does (the same scoring fields).
  assertMeasured(cohort.clubs.find((c) => c.id === SEL), DOMESTIC, "the cohort's member");
  assert.equal(d.clubs.find((c) => c.id === SEL), d.self, "the dossier's clubs carry the same measured self");
  // The peers, on their matches whose scoring is established: t_p1 three (both peer matches and s1),
  // t_p2 and t_p3 one each (s2 and s3 unknown). Before stage 8, a peer stayed unmeasured.
  const support = { t_p1: 3, t_p2: 1, t_p3: 1 };
  for (const peer of d.clubs.filter((c) => c.id !== SEL))
    for (const [key, [value, covered]] of Object.entries(measures(peer))) {
      assert.ok(value != null, `${peer.id} ${key}: measured`);
      assert.equal(covered, support[peer.id], `${peer.id} ${key}'s support`);
    }
  // t_p1's finishing on its three: (2 − 1.5) + (0 − 0.5) + (0 − 0.2), its conversion 2 goals in 11 shots.
  const p1 = d.clubs.find((c) => c.id === "t_p1");
  close(p1.values.finishing, (0.5 - 0.5 - 0.2) / 3, 1e-9, "t_p1 finishing");
  close(p1.values.conversion, (100 * 2) / 11, 1e-9, "t_p1 conversion");
  const member = cohort.clubs.find((c) => c.id === SEL);
  assert.deepEqual(d.self.record, member.record);
  assert.equal(d.self.values.xg, member.values.xg);
  assert.equal(d.self.pairedXgDelta, member.pairedXgDelta);
  for (const key of FOUR) {
    assert.deepEqual([d.self.ranks[key], d.self.centiles[key]], [null, null], `${key}: no rank with four measured clubs`);
    assert.equal(d.stats[key].median, null, `${key}: no league median of the club's own value`);
  }
  assert.deepEqual(d.stats.xg, cohort.stats.xg, "another metric's statistics are the cohort's");
  assert.deepEqual(d.clubs.map((c) => [c.id, c.position, c.ranks.ppm, c.centiles.xg]), cohort.clubs.map((c) => [c.id, c.position, c.ranks.ppm, c.centiles.xg]));
  assert.deepEqual(cohort, before, "the cached cohort was mutated");
  const again = dossier();
  assertMeasured(again.self, DOMESTIC, "second dossier");
  assert.deepEqual(cohort, before, "the cached cohort was mutated by a second dossier");
});

test("every reference keeps a measured self and leaves its inputs unchanged (§14.1)", async () => {
  const { s, fixture, cohort, dossier, cohortOf5 } = await selectedDossier();
  const d = dossier();
  const cup = await cohortOf5(CUP5), other = await cohortOf5({ id: "l_other", name: "Autre", country: "ESP" });
  // The Europe pool as buildEuropePool makes it from /api/clubs/europe(/matches): records without a shot list.
  const pool = s.buildEuropePool({ season: SEASON5, builtAt: null, leagues: [SEL_LEAGUE], uefa: [], levels: {},
    clubs: [SEL, "t_p1", "t_p2", "t_p3"].map((id, i) => ({ ...club(id), leagueId: SEL_LEAGUE.id, level: 1500 + i, uefaCoefficient: null })),
    matches: fixture.leagues[SEL_LEAGUE.id].matches.map(({ shots, ...m }) => m) });
  assert.ok(pool.clubs.some((c) => c.id === SEL));
  const inputs = () => structuredClone({ cohort, cup, other, pool, self: d.self, clubs: d.clubs });
  const before = inputs();
  for (let pass = 0; pass < 2; pass++) {
    // Europe, the club present in the pool: its league matches, read on its full records.
    assertMeasured(s.europeReferential(d, pool).self, DOMESTIC, `Europe (pass ${pass})`);
    assertMeasured(s.europeReferential(d, pool, { level: true }).self, DOMESTIC, `Europe by level (pass ${pass})`);
    // Another league, the club inserted: its documented domestic values.
    const foreign = s.rebase(d, [other], "Autre");
    assert.equal(foreign.referential.inserted, true);
    assertMeasured(foreign.self, DOMESTIC, `inserted (pass ${pass})`);
    // A cup, the club present: its cup match alone (1 goal from 3 shots, 0.9 xG), never the league's.
    const inCup = s.rebase(d, [cup], "Coupe");
    assert.equal(inCup.referential.inserted, false);
    assertMeasured(inCup.self, { finishing: 1 - 0.9, keeper: 0.2, conversion: 100 / 3, xgPerShot: 0.3 }, `cup (pass ${pass})`);
  }
  assert.deepEqual(inputs(), before, "a rebase mutated the cohort, a pool or the dossier");
});

test("a rank of the four needs five measured clubs (§14.1)", async () => {
  const { s, dossier } = await selectedDossier();
  const d = dossier();
  // Peers measured on their records' scoring (any read since stage 8).
  const peers = (count) => {
    recordNo = 100;
    const ids = Array.from({ length: count }, (_, i) => `t_m${i}`);
    return { clubs: ids.map((id, i) => ({ id, name: id, imageUrl: null, country: "FRA", league: { id: "l_meas", name: "Mesurés" },
      ...(() => {
        const m = record5("l_meas", id, "t_x", 1 + i, 0, STATS5([2 + i, 1], [0.5 + i / 10, 0.2], [0.5 + i / 10, 0.2], [0.6, 0.3 + i / 10]),
          [], { home: [0, 0], away: [0, 0] });
        const rows = s.teamRows([m], id);
        return { rows, record: { matches: 1, points: 3, gf: 1 + i, ga: 0 }, values: Object.fromEntries(Object.keys(s.METRICS).map((k) => [k, s.METRICS[k].get(rows)])),
          coverage: Object.fromEntries(Object.keys(s.METRICS).map((k) => [k, s.METRICS[k].count(rows)])) };
      })() })) };
  };
  const four = s.rebase(d, [peers(3)], "Quatre mesurés"), five = s.rebase(d, [peers(4)], "Cinq mesurés");
  for (const key of FOUR) {
    assert.equal(four.clubs.filter((c) => c.values[key] != null).length, 4, `${key}: four measured`);
    assert.deepEqual(four.clubs.map((c) => c.ranks[key]), four.clubs.map(() => null), `${key}: no rank among four`);
    assert.equal(four.stats[key].median, null, `${key}: no median among four`);
    assert.notEqual(five.stats[key].median, null, `${key}: a median among five`);
    assert.equal(five.clubs.filter((c) => c.values[key] != null).length, 5, `${key}: five measured`);
    assert.ok(five.clubs.every((c) => Number.isInteger(c.ranks[key]) && c.centiles[key] != null), `${key}: ranks among five`);
  }
  // Another metric keeps its existing rule: a rank whatever the number of clubs.
  assert.ok(four.clubs.every((c) => Number.isInteger(c.ranks.ppm)));
});

test("the selected club's controls: its attempts or its scoring unknown (§14.1, §17)", async () => {
  // The server could not count the club's penalty attempts in s1 (a shot set that does not match,
  // an unclassified attempt: MatchScoringTest i, j): the shot quality alone is unknown.
  const attempts = (await selectedDossier({ variant: "penaltiesUnknown" })).dossier().self;
  assert.equal(attempts.values.xgPerShot, null, "no penalty count");
  close(attempts.values.finishing, 0.8, 1e-9, "finishing still reads the established own goals");
  close(attempts.values.keeper, 0.4, 1e-9, "the keeper too");
  close(attempts.values.conversion, 100, 1e-9, "two goals from two shots");
  // Its scoring unknown (events not matching the score): the four unknown, the shot list unread.
  const unscored = (await selectedDossier({ variant: "unscored" })).dossier().self;
  for (const key of FOUR) assert.equal(unscored.values[key], null, `${key}: unknown`);
});

/* ------------------------------- an opponent's strength without a centile (§16.2, stage 7) */

test("an opponent's strength needs a centile: below five measured clubs there is none (§16.2)", () => {
  // Written before the correction: { club, centile: null } read as the weakest level (ClubScoutTabs Upcoming).
  const measured = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, pairedXgMatches: 3, pairedXgDeltaPerMatch: i / 10 - 0.2 }));
  assert.equal(opponentStrength({ clubs: measured(4) }, "m2"), null, "four measured clubs: no centile, no strength");
  assert.equal(opponentStrength({ clubs: [{ id: OPP, pairedXgDeltaPerMatch: 0.2 }] }, OPP), null, "root's probe: one measured club");
  const five = opponentStrength({ clubs: measured(5) }, "m2");
  assert.equal(five?.club.id, "m2", "five measured clubs: a strength");
  assert.equal(five.centile, scout.centile(measured(5).map((c) => c.pairedXgDeltaPerMatch), 0, 1), "the existing centile");
  // An absent or unmeasured opponent: none, as before.
  assert.equal(opponentStrength({ clubs: measured(5) }, "absent"), null);
  assert.equal(opponentStrength({ clubs: [...measured(5), { id: "u", pairedXgMatches: 0, pairedXgDeltaPerMatch: null }] }, "u"), null);
  // A legitimate centile is unchanged among unmeasured clubs (the existing test's x2: 70).
  const clubs = [["x1", null], ["x2", 0.5], ["x3", 0.2], ["x4", -0.1], ["x5", -0.3], ["x6", 0.8]]
    .map(([id, delta]) => ({ id, pairedXgMatches: delta === null ? 0 : 4, pairedXgDeltaPerMatch: delta }));
  assert.equal(opponentStrength({ clubs }, "x2").centile, 70);
});
