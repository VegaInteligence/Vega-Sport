// The non-compact player paths count finished matches only, and both grade tooltips keep an
// unknown goal or assist unknown (VI-23 stage 7, docs/calculs/09-audit-2026-11/FAILURE_MODES.md
// §16.1 and §16.3). Written and run before the corrections; the coordinator's real-browser runs
// are the end-to-end check of the tooltips (review-evidence/browser-stage7-red/).
//
// PlayerDetails' PlayerDialog, PlayerComparison's comparisonSamples and PlayerScoutOverview run
// with their real code, compiled as club-profile-render.test.mjs does; the services they compute
// with are the real ones; every other module is a stub, recording the props it receives.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
const service = (name) => import(`../dashboard/frontend/src/services/${name}.js`);
const seasonPlayer = await service("season-player");
const shared = await import("../dashboard/shared/player-profile.js");
const real = {
  "../services/season-player.js": seasonPlayer,
  "../services/player-profile.js": await service("player-profile"),
  "../services/format.js": await service("format"),
  "../services/grades.js": await service("grades"),
  "../services/scouting.js": await service("scouting"),
  "../services/player-directory.js": await service("player-directory"),
  "../services/advanced-filters.js": await service("advanced-filters"),
  "../../../shared/competition-scope.js": await import("../dashboard/shared/competition-scope.js"),
};
const { EMPTY_ADVANCED } = real["../services/advanced-filters.js"];

/* ------------------------------------------------------------ harness */

const seen = [];
const Noop = () => null;
const record = (name, render = (props) => props.children ?? null) =>
  function Stub(props) {
    seen.push({ name, props });
    return render(props);
  };
const classes = new Proxy({}, { get: (_, key) => String(key) });
const css = { __esModule: true, default: classes };
const anyModule = () =>
  new Proxy({}, { get: (_, key) => (key === "__esModule" ? true : key === "then" || typeof key === "symbol" ? undefined : Noop) });
function load(file, stubs) {
  const filename = path.join(root, "dashboard/frontend/src", file);
  const code = babel
    .transformSync(fs.readFileSync(filename, "utf8"), {
      presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
    })
    .code.replace(/\bimport\((["'][^"']+["'])\)/g, "Promise.resolve(require($1))");
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports,process){" + code + "\n})", { filename })(
    (name) => (name in stubs ? stubs[name] : name in real ? real[name] : name.endsWith(".css") ? css : anyModule()),
    mod, mod.exports, process,
  );
  return mod.exports;
}
const last = (name) => seen.filter((call) => call.name === name).at(-1)?.props;

/* ------------------------------------------------------------ the performance card (§16.1) */

let currentFootball;
const details = load("components/PlayerDetails.jsx", {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children }) => e("a", { href }, children) },
  "../hooks/FootballContext.jsx": { useFootball: () => currentFootball },
  "./UI.jsx": { Modal: ({ title, header, footer, children }) => e("div", { "data-modal": title }, header, children, footer),
    Media: Noop, Segments: Noop, Skeleton: Noop },
  "./Hint.jsx": { Term: ({ children }) => children },
});
const season = "2026/2027";
/** A performance: an attacker's 90 minutes in `matchId`, with `shots` and a grade. */
const performance = (id, matchId, shots, extra = {}) => ({
  id, playerId: `p_${id}`, name: `Joueur ${id}`, matchId, date: "2026-10-01", season, teamId: "t_000001", team: "Club Test",
  leagueId: "l_000001", league: "Ligue Test", positionId: 91, minutes: 90, shots, touches: 40, starter: true, statsReliable: true, ...extra,
});
/** A season read: `finished` performances in finished matches, `canceled` ones in canceled matches. */
function read(finished, canceled) {
  const rows = [...finished, ...canceled];
  const status = new Map([...finished.map((r) => [r.matchId, "finished"]), ...canceled.map((r) => [r.matchId, "canceled"])]);
  return {
    appearances: rows,
    matches: [...status].map(([id, s]) => ({ id, status: s, date: "2026-10-01", leagueId: "l_000001",
      home: { id: "t_000001", name: "Club Test", score: s === "finished" ? 1 : null }, away: { id: "t_000002", name: "Rival", score: s === "finished" ? 0 : null } })),
    fixtures: [],
    competitions: [{ id: "l_000001", name: "Ligue Test" }],
  };
}
function openCard(data, id) {
  currentFootball = {
    performanceSummary: undefined, performanceData: data, compactMode: false, player: id, deferredPerformance: null,
    byAppearance: new Map(data.appearances.map((r) => [r.id, r])), comparison: [], toggle() {}, setPlayer() {},
    href: (url, params = {}) => `${url}?${new URLSearchParams(params)}`,
  };
  return renderToStaticMarkup(e(details.PlayerDialog));
}
const shotsCentile = (html) => html.match(/pc-metric-label">Tirs<\/span>.*?pc-pct[^>]*>([^<]*)<\/span>/)?.[1];
const finishedPeers = (n, matchOf = (i) => `f${i}`) => Array.from({ length: n }, (_, i) => performance(`f${i}`, matchOf(i), i));
const canceledExtremes = () => Array.from({ length: 5 }, (_, i) => performance(`c${i}`, `c${i}`, 99));

test("the performance card ranks against finished performances only (§16.1)", () => {
  // 29 finished peers (the opened one among them) and 5 canceled: below the 30-peer minimum.
  const below = read(finishedPeers(29), canceledExtremes());
  const small = openCard(below, "f28");
  assert.match(small, /Échantillon trop réduit/, "29 finished performances are too few");
  assert.equal(shotsCentile(small), "—", "no centile below the minimum");
  // 30 finished peers: centiles, which the canceled extremes cannot move.
  const full = read(finishedPeers(30), canceledExtremes());
  const html = openCard(full, "f29");
  assert.match(html, /Centile parmi 30 performances/);
  const finishedShots = Float64Array.from(full.appearances.filter((r) => r.matchId.startsWith("f")).map((r) => r.shots)).sort();
  const rawShots = Float64Array.from(full.appearances.map((r) => r.shots)).sort();
  assert.notEqual(shared.percentile(finishedShots, 29), shared.percentile(rawShots, 29), "the case discriminates");
  assert.equal(shotsCentile(html), String(shared.percentile(finishedShots, 29)), "the centile among the finished performances");
});

test("an unfinished performance opened explicitly keeps its values and its raw match rank (§16.1)", () => {
  // The opened performance is in a canceled match, with two other graded players of that match.
  const target = performance("t", "c_open", 12, { grade: 70, gradeZ: 1.0 });
  const mates = [performance("u", "c_open", 3, { grade: 80, gradeZ: 1.5 }), performance("v", "c_open", 2, { grade: 60, gradeZ: 0.5 })];
  const data = read(finishedPeers(30), [target, ...mates]);
  const html = openCard(data, "t");
  assert.match(html, /<h2>Joueur t<\/h2>/);
  assert.match(html, /<b>90 min<\/b>/, "its observed minutes");
  assert.match(html, /2e note sur 3/, "its rank among the match's grades, unfinished match included");
  assert.match(html, /Centile parmi 30 performances/, "ranked against the 30 finished performances");
});

test("the read's finished appearances are one array per read, for the cache and the warm-up (§16.1)", () => {
  const { finishedReadAppearances } = seasonPlayer;
  assert.equal(typeof finishedReadAppearances, "function", "season-player.js exports finishedReadAppearances");
  const data = read(finishedPeers(3), canceledExtremes());
  const rows = finishedReadAppearances(data);
  assert.equal(finishedReadAppearances(data), rows, "the same array for the same read");
  assert.deepEqual(rows, seasonPlayer.finishedAppearances(data));
  assert.deepEqual(finishedReadAppearances(null), []);
});

/* ------------------------------------------------------------ the comparison fallback (§16.1) */

const loads = [];
let routing;
const comparison = load("components/PlayerComparison.jsx", {
  react: React,
  "../hooks/FootballContext.jsx": { useFootball: () => currentFootball },
  "../hooks/ResearchContext.jsx": { useResearch: () => ({}) },
  "../services/research-storage.js": { comparisonKey: () => "key", DEFAULT_SAMPLE: {} },
  "../services/resources.js": { useResource: () => ({ value: undefined }) },
  "../services/compact-reads.js": { supportsCompactRead: () => false, compactQuery: (p) => JSON.stringify(p), compactScope: (ids) => ids.join(","),
    playerReadParams: () => ({}), readCompactPages: async () => assert.fail("no compact read in the fallback") },
  "../services/scouting-history.js": {
    playerRoutes: async () => routing,
    loadPlayerSeason: async (manifest, id, entrySeason) => {
      loads.push(entrySeason);
      return { season: entrySeason, data: loadedData, profile: null };
    },
  },
});
const P = "p_000001";
/** One season: m1 a finished record, m2 a finished fixture only, m3 canceled, m4 of unknown status. */
function comparedSeason(label, statuses = { m1: "finished", m3: "canceled" }, fixtures = { m2: "finished" }) {
  const row = (playerId, matchId, minutes, goals) => ({ id: `${playerId}:${matchId}`, playerId, name: playerId === P ? "Élie Durand" : "Pair",
    matchId, date: "2026-10-01", season: label, teamId: "t_000001", team: "Club Test", leagueId: "l_000001", league: "Ligue Test",
    minutes, goals, assists: 0, positionId: 91 });
  return {
    appearances: [row(P, "m1", 90, 1), row(P, "m2", 80, 1), row(P, "m3", 90, 2), row(P, "m4", 70, 3), row("p_000002", "m1", 90, 0), row("p_000002", "m3", 90, 4)],
    matches: Object.entries(statuses).map(([id, status]) => ({ id, status, date: "2026-10-01", leagueId: "l_000001",
      home: { id: "t_000001", name: "Club Test" }, away: { id: "t_000002", name: "Rival" } })),
    fixtures: Object.entries(fixtures).map(([id, status]) => ({ id, status, date: "2026-10-01", leagueId: "l_000001" })),
    competitions: [{ id: "l_000001", name: "Ligue Test" }],
    teams: [],
  };
}
let loadedData;
const entry = (entrySeason) => ({ id: P, name: "Élie Durand", season: entrySeason,
  scope: { league: "all", leagues: [], focus: "all", role: EMPTY_ADVANCED.role, venue: EMPTY_ADVANCED.venue, result: EMPTY_ADVANCED.result,
    from: EMPTY_ADVANCED.from, to: EMPTY_ADVANCED.to } });
async function compare(entrySeason, pageData) {
  currentFootball = { manifest: { storage: "legacy" }, season, compactMode: false, data: pageData, focus: "all" };
  routing = { routes: { [P]: { [entrySeason]: ["l_000001"] } } };
  const [sample] = await comparison.comparisonSamples(currentFootball, [entry(entrySeason)]);
  return sample;
}

test("the comparison fallback counts finished matches, reused or loaded alike (§16.1)", async () => {
  const page = comparedSeason(season), pageBefore = structuredClone(page);
  loadedData = comparedSeason("2025/2026");
  const loadedBefore = structuredClone(loadedData);
  loads.length = 0;
  const reused = await compare(season, page);
  assert.deepEqual(loads, [], "the page's season is reused");
  assert.deepEqual([reused.profile.matches, reused.profile.minutes, reused.profile.stats.goals.sum], [2, 170, 2],
    "m1 (record) and m2 (fixture only); the canceled m3 and the unknown m4 left out");
  assert.equal(reused.profiles.find((p) => p.id === "p_000002").matches, 1, "a peer's canceled match is left out too");
  assert.deepEqual(reused.competitionNames, ["Ligue Test"]);
  const loaded = await compare("2025/2026", page);
  assert.deepEqual(loads, ["2025/2026"], "another season is loaded");
  const figures = (s) => [s.profile.matches, s.profile.minutes, s.profile.stats.goals.sum, s.profiles.length];
  assert.deepEqual(figures(loaded), figures(reused), "the loaded and the reused season agree");
  assert.deepEqual(page, pageBefore, "the page's data unchanged");
  assert.deepEqual(loadedData, loadedBefore, "the loaded data unchanged");
});

test("with no finished match, the comparison keeps its named empty profile (§16.1)", async () => {
  const page = comparedSeason(season, { m1: "in_play", m3: "canceled" }, { m2: "postponed" });
  const sample = await compare(season, page);
  assert.equal(sample.profile.name, "Élie Durand");
  assert.deepEqual([sample.profile.matches, sample.profile.minutes], [0, 0], "no fabricated season");
  assert.deepEqual(sample.profiles, []);
});

/* ------------------------------------------------------------ both grade tooltips (§16.3) */

const overview = load("components/PlayerScoutOverview.jsx", {
  react: React,
  "./PhoneFold.jsx": { useCardFold: () => ({ section: {}, head: {}, part: "", button: null, wrap: (children) => children }) },
  "./PlayerScoutCharts.jsx": { fmt: (value, digits = 0) => Number(value).toFixed(digits), LineChart: record("LineChart", Noop),
    TipBody: record("TipBody", Noop), PercentileBadge: ({ label }) => label, PercentilePizza: Noop, ToneLegend: Noop, PercentileBar: Noop },
  "./ClubScoutUI.jsx": { clubStyles: classes },
  "./FormBars.jsx": { __esModule: true, default: record("FormBars", Noop) },
  "./Hint.jsx": { Hint: Noop, Term: ({ children }) => children },
  "./UI.jsx": { Segments: Noop, Skeleton: Noop },
});
/** Three graded matches: a goal and an unknown assist; an unknown goal and no assist; an explicit 0 / 0. */
function gradedSeason() {
  const row = (matchId, date, goals, assists, grade) => ({ id: `${P}:${matchId}`, playerId: P, name: "Élie Durand", matchId, date, season,
    teamId: "t_000001", team: "Club Test", leagueId: "l_000001", league: "Ligue Test", minutes: 90, goals, assists, grade, gradeZ: 0, positionId: 91 });
  return [row("m1", "2026-09-01", 1, undefined, 60), row("m2", "2026-09-08", undefined, 0, 55), row("m3", "2026-09-15", 0, 0, 50)];
}
const tooltip = (chart, point) => chart.tip(point).props.rows.find(([label]) => label === "Buts / PD")[1];
const byMatch = (chart) => Object.fromEntries(chart.points.map((point) => [point.row.matchId, tooltip(chart, point)]));
const EXPECTED = { m1: "1 / —", m2: "— / 0", m3: "0 / 0" };

test("the recent-form tooltip keeps an unknown goal or assist unknown, and a known zero (§16.3)", () => {
  const profile = seasonPlayer.aggregateSeason(gradedSeason(), P);
  const cohorts = real["../services/scouting.js"].buildCohorts([profile], 450);
  seen.length = 0;
  renderToStaticMarkup(e(overview.default, { profile, cohorts, ready: false, season, matches: [], onTab: () => {} }));
  const chart = last("FormBars");
  assert.equal(chart?.ariaLabel, "Note des derniers matchs");
  assert.deepEqual(Object.fromEntries(chart.items.map((item) => [item.matchId, item.goalsAssists])), EXPECTED);
});

test("the recent-form bars read each match from the player's side, oldest first", () => {
  const profile = seasonPlayer.aggregateSeason(gradedSeason(), P);
  const cohorts = real["../services/scouting.js"].buildCohorts([profile], 450);
  const side = (id, score) => ({ id, name: id === "t_000001" ? "Club Test" : "Rival", imageUrl: `${id}.png`, score });
  const matches = [
    { id: "m1", home: side("t_000002", 2), away: side("t_000001", 1) },
    { id: "m2", home: side("t_000001", 3), away: side("t_000002", 3) },
  ];
  seen.length = 0;
  renderToStaticMarkup(e(overview.default, { profile, cohorts, ready: false, season, matches, onTab: () => {} }));
  const items = last("FormBars").items;
  assert.deepEqual(items.map((item) => item.matchId), ["m1", "m2", "m3"]);
  assert.deepEqual(items[0], { ...items[0], home: false, opponent: { name: "Rival", imageUrl: "t_000002.png" },
    score: { for: 1, against: 2 }, result: "D", competition: "Ligue Test", minutes: 90, grade: 60 });
  assert.deepEqual([items[1].home, items[1].result, items[1].score], [true, "N", { for: 3, against: 3 }]);
  // m3 is not among the page's matches: no opponent, score or result is made up.
  assert.deepEqual([items[2].opponent, items[2].score, items[2].result, items[2].home], [null, null, null, null]);
});

test("the Matchs tab's grade tooltip keeps an unknown goal or assist unknown, and a known zero (§16.3)", () => {
  const rows = gradedSeason();
  const profile = seasonPlayer.aggregateSeason(rows, P);
  seen.length = 0;
  renderToStaticMarkup(e(overview.PlayerGames, { profile, matches: [], logRows: profile.rows }));
  const chart = last("LineChart");
  assert.equal(chart?.ariaLabel, "Note par match");
  assert.deepEqual(byMatch(chart), EXPECTED);
});
