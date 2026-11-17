// The match page's shooters, players board and leaders keep an unknown unknown (calculation
// audit of 16 Nov 2026, VI-23 B5). Written before the correction:
// docs/calculs/09-audit-2026-11/FAILURE_MODES.md §6.2.
//
// The API's players family leaves out what the source did not publish (no zero is restored,
// api.match_player_stat_rows and match-families.mjs): the browser does not invent one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boardRows, leaders, playerRows, shootersOf, sortRows } from "../dashboard/frontend/src/services/match-tabs.js";

const stat = (key, value) => ({ key, stat: { type: "integer", value } });
const player = (id, team, stats) => ({ player: { id, name: id.toUpperCase() }, team_id: team,
  stats: [{ key: "top_stats", stats: Object.fromEntries(stats.map((s, i) => [`k${i}`, s])) }] });

test("a shooter whose shot has no xG has no xG, and comes after the known ones", () => {
  const shots = [
    { teamId: "t_h", playerId: "p_a", playerName: "A", xg: 0.4, isGoal: true },
    { teamId: "t_h", playerId: "p_a", playerName: "A", xg: null },
    { teamId: "t_h", playerId: "p_b", playerName: "B", xg: 0.1 },
    { teamId: "t_h", playerId: "p_c", playerName: "C", xg: 0.05 },
  ];
  const rows = shootersOf(shots, "t_h");
  assert.deepEqual(rows.map((r) => [r.name, r.shots, r.xg, r.goals]), [["B", 1, 0.1, 0], ["C", 1, 0.05, 0], ["A", 2, null, 1]]);
});

test("threat needs both xG and xA, tackles plus interceptions both terms", () => {
  const rows = boardRows([
    player("p_full", "t_h", [stat("minutes_played", 90), stat("expected_goals", 0.4), stat("expected_assists", 0.2), stat("matchstats.headers.tackles", 2), stat("interceptions", 1)]),
    player("p_noxg", "t_h", [stat("minutes_played", 80), stat("expected_assists", 0.9), stat("matchstats.headers.tackles", 4)]),
    player("p_noxa", "t_a", [stat("minutes_played", 70), stat("expected_goals", 0.8), stat("interceptions", 3)]),
  ], [], new Map());
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(Math.abs(by.p_full.threat - 0.6) < 1e-12, String(by.p_full.threat));
  assert.equal(by.p_full.recovered, 3);
  assert.deepEqual([by.p_noxg.threat, by.p_noxg.recovered], [null, null]);
  assert.deepEqual([by.p_noxa.threat, by.p_noxa.recovered], [null, null]);
  // An unknown can neither lead nor sort as a known value (the unknowns last, by name).
  assert.equal(leaders(rows).threat.id, "p_full");
  assert.deepEqual(sortRows(rows, { key: "recovered", direction: "desc" }).map((r) => r.id), ["p_full", "p_noxa", "p_noxg"]);
});

test("the real players family: a player without xG published leads nothing", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("../backend/tests/fixtures/match_m_08LEIz/players.json", import.meta.url), "utf8")).data;
  const raw = playerRows(payload).filter((r) => r.minutes > 0);
  const rows = boardRows(payload, [], new Map());
  assert.equal(rows.length, 29);
  // The source publishes neither shots nor xG for 13 of them: their threat is unknown.
  const unknownXg = raw.filter((r) => r.xg == null).map((r) => r.id);
  assert.equal(unknownXg.length, 13);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(unknownXg.every((id) => by[id].threat === null), "unknown xG gives an unknown threat");
  assert.ok(rows.filter((r) => r.xa == null).every((r) => r.threat === null), "unknown xA gives an unknown threat");
  const leader = leaders(rows).threat;
  assert.ok(leader && leader.xg != null && leader.xa != null, "the threat leader knows both");
  assert.equal(leader.threat, Math.max(...rows.filter((r) => r.threat != null).map((r) => r.threat)));
});

/* ------------------------------------- shoot-out kicks among the shooters (§16.4, stage 7) */

// Written before the correction. The same period predicate as the club service (§14.4).
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REGULAR = [
  { teamId: "t_h", playerId: "p_a", playerName: "A", xg: 0.4, isGoal: true, period: "first_half" },
  { teamId: "t_h", playerId: "p_a", playerName: "A", xg: 0.76, period: "second_half", situation: "penalty" }, // an in-match penalty
  { teamId: "t_h", playerId: "p_b", playerName: "B", xg: 0.3, period: "extra_time" }, // an extra-time shot
  { teamId: "t_h", playerId: "p_c", playerName: "C", xg: null, period: "second_half" }, // a missing xG: sticky
  { teamId: "t_h", playerId: "p_c", playerName: "C", xg: 0.2, period: "second_half" },
  { teamId: "t_a", playerId: "p_z", playerName: "Z", xg: 0.5, period: "first_half" },
];
const SHOOTOUT = [
  // A shoot-out-only player whose kick would outrank B's regular 0.3 xG.
  { teamId: "t_h", playerId: "p_d", playerName: "D", xg: 0.78, isGoal: true, period: "Penalties" },
  { teamId: "t_h", playerId: "p_c", playerName: "C", xg: null, period: "penalties" }, // a shoot-out kick without xG
  { teamId: "t_h", playerId: "p_e", playerName: "E", xg: 0.78, period: "Penalties" }, // shoot-out only, missed
  { teamId: "t_a", playerId: "p_z", playerName: "Z", xg: 0.78, isGoal: true, period: "Penalties" },
];
const figures = (rows) => rows.map((r) => [r.name, r.shots, r.xg === null ? null : Math.round(r.xg * 100) / 100, r.goals]);

test("shoot-out kicks are no shots of the match's shooters; in-match penalties and extra time stay (§16.4)", () => {
  const shots = [...REGULAR, ...SHOOTOUT], before = structuredClone(shots);
  const regular = shootersOf(REGULAR, "t_h", 5);
  assert.deepEqual(figures(regular), [["A", 2, 1.16, 1], ["B", 1, 0.3, 0], ["C", 2, null, 0]], "the regular shooters");
  assert.deepEqual(figures(shootersOf(shots, "t_h", 5)), figures(regular), "the shoot-out changes no value and no order");
  assert.deepEqual(figures(shootersOf(shots, "t_a", 5)), [["Z", 1, 0.5, 0]], "both spellings, both sides");
  assert.deepEqual(shots, before, "the input is not mutated");
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");

test("MatchKpis lists the same shooters, without the shoot-out (§16.4)", async () => {
  // The real MatchKpis, its services real; the hover card shows its detail, the sections are empty.
  const real = {
    "../services/match-tabs.js": await import("../dashboard/frontend/src/services/match-tabs.js"),
    "../services/match-data.js": await import("../dashboard/frontend/src/services/match-data.js"),
    "../services/format.js": await import("../dashboard/frontend/src/services/format.js"),
  };
  const stubs = {
    react: React,
    "./HoverCard.jsx": { __esModule: true, default: ({ children, content }) => React.createElement("div", null, children, content) },
    "../hooks/useMatchSection.js": { __esModule: true, default: () => ({ data: null }) },
    "../services/glossary.js": { explain: () => null },
    "./MatchTabs.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const filename = path.join(root, "dashboard/frontend/src/components/MatchKpis.jsx");
  const code = babel.transformSync(fs.readFileSync(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename })(
    (name) => stubs[name] ?? real[name] ?? assert.fail(`unexpected import ${name}`), mod, mod.exports, process,
  );
  const match = {
    id: "m_000001", home: { id: "t_h", name: "Home" }, away: { id: "t_a", name: "Away" },
    stats: [{ key: "expected_goals", home: 1.66, away: 0.5 }, { key: "total_shots", home: 5, away: 1 }], shots: [...REGULAR, ...SHOOTOUT],
  };
  const html = renderToStaticMarkup(React.createElement(mod.exports.default, { match }));
  const lines = [...html.matchAll(/<div class="bubbleLine"><span>([^<]+)<\/span><b class="[^"]*">([^<]+)<\/b>/g)].map((m) => [m[1], m[2]]);
  assert.ok(lines.length > 0, "the shooters are listed");
  assert.deepEqual([...new Set(lines.map(([name]) => name))].sort(), ["A", "B", "Z"], "the two best of each side, no shoot-out-only player");
  assert.ok(lines.some(([name, text]) => name === "B" && text === "1 tir"), "B's one regular shot");
  assert.ok(lines.some(([name, text]) => name === "Z" && text === "1 tir"), "Z's one regular shot");
});
