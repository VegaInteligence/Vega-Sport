// The club page's display of unknown values (VI-22, handoff of the VI-23 calculation audit).
// Written before the components change. Expected behaviour, on the rendered markup:
//
// - Shot maps: the header total of xG is unknown (—) once a shot of the list has no xG; a known 0
//   stays 0,0; a shot without xG is still drawn, at the smallest size, and says « xG indisponible ».
// - Game states: an unknown time in each state shows —, never 0 % or NaN; the halves line says
//   on how many matches it stands when fewer than the chronology's.
// - League tables: a club whose xPts is unknown shows — for xPts and the gap, without an up/down
//   colour; a club whose xPts stand on fewer matches than its record shows the gap of those
//   matches and says so in the cell's title.
// - Finishing: a season total is the mean times its own support (0,8 on one supported match of
//   three, not 2,4); an unknown total shows — without colour.
// - Set pieces: « Contre-attaques et CPA réunis » is unknown when one of its terms is.
// - Coming matches: an opponent of the reference without a measured centile gets no difficulty
//   (never level 1), keeps its place and reads « données insuffisantes »; an opponent outside the
//   reference reads « hors référentiel ».
// - Results and expected: points beside xPts on the same matches, goals beside xG on the matches
//   that know that side's xG, the keeper's total on its own support.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const e = React.createElement;
// A CSS module: every class name is its key (Babel's interop reads `default`, not `__esModule`).
const css = new Proxy({}, { get: (_, key) => (key === "__esModule" ? false : key === "default" ? css : String(key)) });
const supported = await import("../dashboard/frontend/src/services/club-supported.js").catch(() => ({}));

async function load(file, stubs) {
  const filename = path.join(root, "dashboard/frontend/src/components", file);
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
    (name) => {
      if (name.endsWith(".css")) return css;
      if (!(name in stubs)) throw Error(`unexpected import ${name} in ${file}`);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const SITUATIONS = { openPlay: "Jeu placé", fastBreak: "Contre-attaque", corner: "Corner", setPiece: "Touche", freeKick: "Coup franc", penalty: "Penalty" };
const common = {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children, prefetch, ...props }) => e("a", { href, ...props }, children) },
  // The server render of a « ← » button (BackLink.jsx): its fixed link and label.
  // A coming match's forecast (ClubScoutTabs' Upcoming): none here, so no chances are shown.
  "../services/forecasts.js": { share: (v) => `${Math.round(v * 100)} %`, useMatchForecast: () => null },
  "../services/cup-matches.js": { matchForecast: () => null },
  "./BackLink.jsx": { __esModule: true, default: ({ href, label, prefix = "← ", onFallback, ...props }) => e("a", { href, ...props }, prefix, label) },
  "./Icon.jsx": { __esModule: true, default: () => null },
  "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (url, params) => `${url}?${new URLSearchParams(params)}` }) },
  "./Hint.jsx": { Hint: () => null, Term: ({ children }) => children },
  "../services/club-supported.js": supported,
  // The checked image resolver (the real module): Picture goes through it (FAILURE_MODES.md §22).
  "../services/format.js": await import("../dashboard/frontend/src/services/format.js"),
};
const ui = await load("ClubScoutUI.jsx", {
  ...common,
  "./ClubSkeleton.jsx": { __esModule: true, default: () => null },
  "./UI.jsx": { Skeleton: () => null },
  "./PhoneFold.jsx": { useCardFold: () => ({ section: {}, head: {}, part: "", button: null, wrap: (children) => children }) },
  "./PlayerScoutCharts.jsx": { PercentileBar: () => null, toneVar: () => "" },
  "./RankingDialog.jsx": { RankingTrigger: ({ children }) => children },
  "../services/glossary.js": { explain: () => "" },
  "../services/club-scout.js": { METRICS: {}, SITUATION_LABELS: SITUATIONS, STYLE_AXES: [], formatMetric: () => "", rolling: () => [] },
});
const html = (element) => renderToStaticMarkup(element);
const rowOf = (markup, name) => markup.split("<tr").find((part) => part.includes(name)) || "";

// Match rows: xPts known when both xG are.
const row = (points, gf, ga, own, opp) => ({
  points, gf, ga, own, opp, result: points === 3 ? "V" : points === 1 ? "N" : "D",
  xpts: own?.xg != null && opp?.xg != null ? points * 0.6 : null,
});
const club = (id, name, rows, extra = {}) => ({
  id, name, rows,
  record: { matches: rows.length, points: rows.reduce((t, r) => t + r.points, 0), gf: rows.reduce((t, r) => t + r.gf, 0), ga: rows.reduce((t, r) => t + r.ga, 0) },
  // What the service gives today: xPts summed over the matches that know both xG.
  xptsTotal: rows.reduce((t, r) => t + (r.xpts ?? 0), 0),
  values: {},
  ...extra,
  leaguePosition: extra.position ?? null,
  leagueXptsPosition: extra.xptsPosition ?? null,
});
const A = club("t_a", "Club A", [row(3, 2, 0, { xg: 1.5 }, { xg: 0.5 }), row(1, 1, 1, { xg: 1 }, { xg: 1 })], { position: 1, xptsPosition: 1 });
// One match of two knows its xG (3 points, xPts 1,8); the other gave 3 points too.
const B = club("t_b", "Club B", [row(3, 1, 0, { xg: 2 }, { xg: 0.5 }), row(3, 1, 0, null, null)], { position: 2, xptsPosition: 2 });
const C = club("t_c", "Club C", [row(1, 1, 1, null, null)], { position: 3, xptsPosition: 3 });

test("shot maps: an unknown xG makes the total unknown, a known zero stays", () => {
  const markup = html(e(ui.ShotPair, {
    profile: {
      mapFor: [
        { id: 1, x: 10, y: 30, xg: 0.2, outcome: "off", situation: "openPlay", opponent: "X" },
        { id: 2, x: 12, y: 34, xg: null, outcome: "goal", situation: "openPlay", opponent: "X" },
      ],
      mapAgainst: [{ id: 3, x: 5, y: 30, xg: 0, outcome: "saved", situation: "openPlay", opponent: "Y" }],
    },
  }));
  // Each side's key figures: shots, xG (unknown as soon as one shot has none), goals; the
  // figures that need the xG are unknown with it.
  const figures = (side) => {
    const block = markup.slice(markup.indexOf(`data-shotmap="${side}"`));
    return Object.fromEntries([...block.matchAll(/data-figure="(\w+)"><dt>[^<]*<\/dt><dd><b>([^<]*)<\/b>/g)].slice(0, 6).map((m) => [m[1], m[2]]));
  };
  assert.deepEqual(figures("for"), { shots: "2", xg: "—", goals: "1", diff: "—", perShot: "—", distance: figures("for").distance });
  assert.deepEqual(figures("against"), { shots: "1", xg: "0,0", goals: "0", diff: "0,0", perShot: "0,00", distance: "6,4 m" });
  assert.doesNotMatch(markup, /NaN/);
  // One mark per shot; the one without xG drawn dashed.
  assert.equal((markup.match(/data-mark=/g) || []).length, 3);
  assert.equal((markup.match(/stroke-dasharray="2 2"/g) || []).length, 1);
});

test("game states: an unknown time in each state is not 0 %", () => {
  const empty = { matches: 0, halfMatches: 0, minutes: null, halves: { first: { gf: 0, ga: 0 }, second: { gf: 0, ga: 0 }, halfTimePoints: 0, points: 0 },
    scoredFirst: { matches: 0, points: 0, w: 0, d: 0, l: 0 }, concededFirst: { matches: 0, points: 0, w: 0, d: 0, l: 0 },
    pointsFromBehind: 0, pointsDropped: 0, comebacks: [], collapses: [] };
  const markup = html(e(ui.GameState, { states: empty }));
  assert.match(markup, /Mène <b>—<\/b>/);
  assert.doesNotMatch(markup, /NaN|0 %/);
  const some = { ...empty, matches: 3, halfMatches: 2, minutes: { lead: 93, level: 93, behind: 93 },
    halves: { first: { gf: 2, ga: 0 }, second: { gf: 1, ga: 1 }, halfTimePoints: 4, points: 5 } };
  const known = html(e(ui.GameState, { states: some }));
  assert.match(known, /Mène <b>33 %<\/b>/);
  assert.match(known, /2 d’entre eux/);
});

test("league table: unknown xPts stays unknown, a partial one says on how many matches", () => {
  const markup = html(e(ui.LeagueTable, { dossier: { id: "t_a", clubs: [A, B, C] } }));
  const c = rowOf(markup, "Club C"), b = rowOf(markup, "Club B");
  assert.doesNotMatch(c, /0,0|\+1,0/);
  assert.equal((c.match(/<td[^>]*>—<\/td>/g) || []).length, 3); // xPts, gap, xG difference
  assert.doesNotMatch(c, /class="(up|down)"/);
  // B: 3 points beside 1,8 xPts on its one match with xG, not 6 beside 1,8.
  assert.match(b, /\+1,2/);
  assert.doesNotMatch(b, /\+4,2/);
  assert.match(b, /title="[^"]*1 des 2 matchs/);
});

test("expected gap table: per match on the paired matches, unknown without them", () => {
  const markup = html(e(ui.ExpectedGapTable, { dossier: { id: "t_a", clubs: [A, B, C] } }));
  const c = rowOf(markup, "Club C"), b = rowOf(markup, "Club B");
  assert.match(b, /3,00/);
  assert.match(b, /1,80/);
  assert.match(b, /\+1,20/);
  assert.equal((c.match(/<td[^>]*>—<\/td>/g) || []).length, 3);
});

const advanced = await load("ClubScoutAdvanced.jsx", {
  ...common,
  "./UI.jsx": { Segments: () => null },
  "./PlayerScoutCharts.jsx": { Gauge: () => null, PercentileBar: () => null },
  "../services/club-scout.js": { METRICS: {}, PHASES: [] },
  "./ClubScoutUI.jsx": {
    ...ui,
    Card: ({ title, children }) => e("section", null, e("h3", null, title), children),
    LeaguePlot: () => null, MetricTable: () => null, MirrorBars: () => null, ShotPair: () => null,
    SituationTable: () => null, StyleSpectrum: () => null, LeagueTable: () => null, ExpectedGapTable: () => null,
  },
});

test("finishing: a season total stands on its own support", () => {
  const self = { ...club("t_a", "Club A", [row(3, 2, 0, { xg: 1.2 }, { xg: 0.5 }), row(0, 0, 1, null, null), row(1, 0, 0, null, null)]),
    values: { finishing: 0.8, keeper: 0.4, placement: null, conversion: null }, coverage: { finishing: 1, keeper: 1, placement: 0 }, ranks: { finishing: 2, keeper: 3 } };
  const markup = html(e(advanced.Finishing, { dossier: { self, clubs: [self, B, C], shotsAll: {} } }));
  assert.match(markup, /Buts − xG<\/span><strong class="up">\+0,8<\/strong>/);
  assert.match(markup, /Buts évités \(gardien\)<\/span><strong class="up">\+0,4<\/strong>/);
  assert.match(markup, /Qualité de frappe<\/span><strong>—<\/strong>/);
  assert.doesNotMatch(markup, /2,4|1,2<\/strong>/);
  // An unknown conversion is unknown, not « — % ».
  assert.match(markup, /Conversion<\/span><strong>—<\/strong>/);
});

test("set pieces: counter-attacks and set pieces together are unknown when one term is", () => {
  const bucket = (shots, xg, goals) => ({ shots, xg, goals });
  const side = (fast, corner) => ({ openPlay: bucket(10, 1, 1), fastBreak: fast, corner, setPiece: bucket(2, 0.3, 0), freeKick: bucket(1, 0.1, 0), penalty: bucket(1, 0.76, 1) });
  const markup = html(e(advanced.SetPieces, { dossier: {
    shotsAll: { for: side(bucket(3, null, 1), bucket(5, 1.2, 1)), against: side(bucket(2, 0.4, 0), bucket(4, 0.8, 1)) },
    self: { values: { setShare: 30 } }, stats: { setShare: { median: 25 } },
  } }));
  assert.match(markup, /— xG créés/);
  assert.match(markup, /1,6 concédés/);
  assert.doesNotMatch(markup, /1,6 xG créés|NaN/);
});

const tabs = await load("ClubScoutTabs.jsx", {
  ...common,
  "./UI.jsx": { Segments: () => null, Skeleton: () => null },
  "./ResearchUI.jsx": { BookmarkButton: () => null },
  "./PhoneFold.jsx": { PhoneFoldToggle: () => null, usePhoneFold: () => ({ fold: {}, part: "", button: null }) },
  "./PointsRace.jsx": { PointsRaceLines: () => null, PointsPerMatch: () => null },
  "../services/profile-blocks.js": { euros: () => "", readDay: () => "", useClubSquad: () => null, weightedAge: () => null },
  "../services/resources.js": { json: async () => ({}), useResource: () => ({}) },
  "./ClubInformation.jsx": { __esModule: true, default: () => null },
  "./PlayerScoutCharts.jsx": { PercentilePizza: () => null },
  // Today's service: an opponent of the reference without a measured centile still comes back.
  "../services/club-scout.js": { FAMILIES: {}, METRICS: {}, PERFORMANCE_KEYS: [], PHASES: [], formatMetric: () => "",
    opponentStrength: (dossier, id) => { const c = dossier.clubs.find((x) => x.id === id); return c ? { club: c, centile: c.centile ?? null } : null; },
    // Club Elo of the season: one opponent outside the league is rated, the other is not.
    useEuropeLevels: () => ({ status: "ready", value: { levels: new Map([["t_e", 1990]]) } }),
    opponentEloStrength: (dossier, levels, id) => (levels.has(id) ? { elo: levels.get(id), centile: 95 } : null) },
  "./ClubScoutUI.jsx": { ...ui, LeagueTable: () => null, FormStrip: () => null },
  "./ClubSubstitutions.jsx": { __esModule: true, default: () => null },
  "./ClubPassingTriangle.jsx": { __esModule: true, default: () => null },
});

test("coming matches: no fabricated difficulty, the reason told apart", () => {
  const member = { id: "t_m", name: "Membre", position: 6 };
  const markup = html(e(tabs.Upcoming, { dossier: {
    id: "t_a", clubs: [member],
    upcoming: [
      { id: "m_1", date: "2026-11-21", home: { id: "t_a", name: "Club A" }, away: { id: "t_m", name: "Membre" }, league: "Ligue" },
      { id: "m_2", date: "2026-11-25", home: { id: "t_o", name: "Ailleurs" }, away: { id: "t_a", name: "Club A" }, league: "Coupe" },
      { id: "m_3", date: "2026-12-08", home: { id: "t_a", name: "Club A" }, away: { id: "t_e", name: "Europe" }, league: "Ligue des champions" },
    ],
  } }));
  assert.doesNotMatch(markup, /Difficulté 1 sur 5|hors référentiel/);
  assert.match(rowOf(markup.replaceAll("<a", "<tr"), "Membre"), /6e[\s\S]*données insuffisantes/);
  // Outside the league: rated by its club Elo among the league's clubs, else « sans Elo ».
  assert.match(rowOf(markup.replaceAll("<a", "<tr"), "Ailleurs"), /sans Elo/);
  assert.match(rowOf(markup.replaceAll("<a", "<tr"), "Europe"), /Elo 1990 : centile 95[\s\S]*Difficulté 5 sur 5/);
});

test("results and expected: each pair on the same matches", () => {
  const self = { ...club("t_a", "Club A", [
    row(3, 2, 0, { xg: 1.5, xgot: 1.9 }, { xg: 0.5, xgot: 0.4 }),
    row(1, 1, 1, { xg: 0.7, xgot: null }, { xg: null, xgot: null }),
    row(0, 0, 2, null, null),
  // As the service serves it: the keeper's mean and the one match it stands on.
  ]), values: { xg: 1.1, xga: 0.5, keeper: 0.4 }, coverage: { keeper: 1 } };
  const markup = html(e(tabs.ExpectedCard, { dossier: { id: "t_a", self, clubs: [self], league: { name: "Ligue" } } }));
  // Points beside xPts: 3 · 1,8 on the one match with both xG (not 4 · 1,8).
  assert.match(markup, /3 · 1,8/);
  assert.match(markup, /sur 1 match/);
  // Goals beside xG: 3 · 2,2 on the two matches with xG for; conceded 0 · 0,5 on one.
  assert.match(markup, /3 · 2,2/);
  assert.match(markup, /0 · 0,5/);
  // The keeper: 0,4 on its one supported match, not 0,4 × 3.
  assert.match(markup, /\+0,4/);
  assert.doesNotMatch(markup, /\+1,2<\/dd>|4 · 1,8/);
});
