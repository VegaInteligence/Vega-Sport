// The rendered player profile reads the finished season summary; its match log keeps every
// observation (VI-23 stage 6, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §15). Written and run
// before the correction; the coordinator's real-browser runs are the end-to-end check.
//
// PlayersPage, PlayerSeasonProfile and PlayerGames run with their real code, compiled as
// club-profile-render.test.mjs does. The services they compute with are the real ones; every other
// module they import is a stub, and the stubs of the children record the props they receive.
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
const real = {
  "../services/season-player.js": seasonPlayer,
  "../services/scouting.js": await service("scouting"),
  "../services/format.js": await service("format"),
  "../services/player-identity.js": await service("player-identity"),
  "../services/player-directory.js": await service("player-directory"),
  "../services/player-leaderboard.js": await service("player-leaderboard"),
  "../services/advanced-filters.js": await service("advanced-filters"),
  "../services/grades.js": await service("grades"),
  "../services/player-profile.js": await service("player-profile"),
};

/* ------------------------------------------------------------ harness */

const seen = [];
const Noop = () => null;
/** A stub component that records its props; `render` gives its markup (its children by default). */
const record = (name, render = (props) => props.children ?? null) =>
  function Stub(props) {
    seen.push({ name, props });
    return render(props);
  };
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
/** Any other module: a no-op component for every name (never a thenable). */
const anyModule = () =>
  new Proxy({}, { get: (_, key) => (key === "__esModule" ? true : key === "then" || typeof key === "symbol" ? undefined : Noop) });
/** The real file, compiled; `import()` becomes a resolved require so that lazy() can load a stub. */
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
const propsOf = (name) => seen.filter((call) => call.name === name).map((call) => call.props);
const last = (name) => propsOf(name).at(-1);

/* ------------------------------------------------------------ the player's season */

const P = "p_000001", TEAM = "t_000001", season = "2026/2027";
const OBSERVED = [
  // match, date, minutes, goals, assists, grade
  ["m1", "2026-09-01", 90, 1, 0, 62],
  ["m3", "2026-09-03", 90, 0, 0, 48],
  ["m2", "2026-09-08", 80, 1, 1, 71],
];
// The coordinator's browser cases: m3 canceled; or no finished match at all (m5 for m2).
const MIXED = { m1: "finished", m3: "canceled", m2: "finished" };
const ONLY_UNFINISHED = { m1: "in_play", m3: "canceled", m5: "not_started" };
function football(statuses) {
  const ids = Object.keys(statuses);
  const observed = OBSERVED.map(([, ...rest], i) => [ids[i], ...rest]);
  const appearances = observed.map(([matchId, date, minutes, goals, assists, grade]) => ({
    id: `${P}:${matchId}`, playerId: P, name: "Élie Durand", imageUrl: "https://img.test/elie.png", matchId, date, season,
    teamId: TEAM, team: "Club Test", leagueId: "l_000001", league: "Ligue Test", minutes, goals, assists, grade, gradeZ: 0,
    starter: true, positionId: 91,
  }));
  return {
    season, compactMode: false, focus: [], actorScope: "all", client: null,
    manifest: { storage: "aws-relational", seasons: [{ id: season }], capabilities: {} },
    data: {
      appearances,
      matches: observed.map(([id, date]) => ({ id, date, season, status: statuses[id], leagueId: "l_000001",
        home: { id: TEAM, name: "Club Test", score: statuses[id] === "finished" ? 1 : null },
        away: { id: "t_000002", name: "Rival", score: statuses[id] === "finished" ? 0 : null } })),
      fixtures: observed.map(([id, date]) => ({ id, date, status: statuses[id], leagueId: "l_000001" })),
      teams: [{ id: TEAM, name: "Club Test", imageUrl: "https://img.test/club.png" }],
    },
    filters: { league: "all", match: "all", minutes: 0, query: "", leagues: [], basis: "total", ranking: "all",
      advanced: { ...real["../services/advanced-filters.js"].EMPTY_ADVANCED } },
    href: (url, params = {}) => `${url}?${new URLSearchParams(params)}`,
    setFilters() {}, refreshManifest() {},
  };
}
const ids = (rows) => rows.map((row) => row.matchId);

/* ------------------------------------------------------------ PlayerSeasonProfile */

let currentFootball, currentParams;
const profileModule = load("components/PlayerSeasonProfile.jsx", {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children }) => e("a", { href }, children) },
  "next/navigation": { useSearchParams: () => currentParams },
  "../hooks/FootballContext.jsx": { useFootball: () => currentFootball },
  "../hooks/useActorRead.js": { __esModule: true, default: () => ({ value: null, error: null }) },
  "../hooks/useVisibleIntent.js": { __esModule: true, default: () => [null, false] },
  "../hooks/ResearchContext.jsx": { useResearch: () => ({}) },
  "../services/actor-reads.js": { actorReadParams: () => ({}) },
  "../services/compact-reads.js": { compactGeneration: () => "g", readCompact: async () => ({}) },
  "../services/resources.js": { cachedResource: () => undefined, primeResource: () => {}, useResource: () => ({ value: undefined }) },
  // The published record's key and loader (GH129): the profile reads it through useResource, stubbed above.
  "../services/player-prefetch.js": { playerRecordResource: (id) => [`player-record:${id}`, async () => null] },
  "../services/club-scout.js": { levelPeerClubs: () => null, useEuropeLevels: () => ({ status: "idle" }) },
  "../services/ballon-dor.js": { breakoutSignal: () => null, usePlayerPower: () => undefined, vegaParts: () => null },
  "../services/national-flags.js": { nationalFlagCode: () => null },
  "../services/player-honours.js": { MESSI_ID: "p_1mZO3B" },
  "./PlayerHonours.jsx": { usePlayerHonours: () => null },
  "./PlayerScoutCharts.jsx": { chartTokens: "chart-tokens" },
  "./RankingDialog.jsx": { RankingProvider: ({ children }) => children, RankingTrigger: ({ children }) => children },
  "./PlayerProfileFilters.jsx": { __esModule: true, default: Noop, FilterGroup: ({ children }) => children },
  "./ResearchUI.jsx": { BookmarkButton: record("BookmarkButton", Noop), ComparePlayerButton: record("ComparePlayerButton", Noop),
    MetricInfo: Noop, ResearchTabs: record("ResearchTabs", Noop) },
  "./PlayerScoutRail.jsx": { __esModule: true, default: record("PlayerScoutRail", (p) => e("div", null, p.actions)),
    PlayerScoutStrip: record("PlayerScoutStrip", (p) => e("div", null, p.actions)),
    // § 87: the head reads its facts once for the head and the tiles; the tiles go to the overview.
    usePlayerScoutData: () => ({}), PlayerScoutTiles: Noop, PlayerScoutExtrasTiles: Noop, PlayerScoutExtrasHonours: Noop,
    PlayerScoutExtras: ({ children }) => children },
  "./BackLink.jsx": { __esModule: true, default: Noop },
  "./PlayerScoutOverview.jsx": { __esModule: true, default: record("PlayerScoutOverview", Noop), PlayerGames: record("PlayerGames", Noop),
    PlayerScoutCompare: Noop, PlayerScoutStats: Noop },
  "./PlayerPresenceCard.jsx": { __esModule: true, default: record("PlayerPresenceCard", Noop) },
  "./PlayerPhysical.jsx": { __esModule: true, default: record("PlayerPhysical", Noop) },
  "./UI.jsx": { Segments: Noop, Skeleton: record("Skeleton", Noop) },
});
/** The profile as PlayersPage renders it (with `summary`, the finished subject) or as another caller does. */
function renderProfile(statuses, view, { summary = true } = {}) {
  seen.length = 0;
  currentFootball = football(statuses);
  currentParams = new URLSearchParams({ id: P, playerView: view });
  const rows = currentFootball.data.appearances.filter((row) => row.playerId === P);
  const summaryRows = seasonPlayer.finishedAppearances(currentFootball.data, rows);
  renderToStaticMarkup(e(profileModule.default, {
    id: P, rows, scopeRows: summaryRows, profiles: undefined,
    ...(summary ? { summaryProfile: seasonPlayer.aggregateSeason(summaryRows, P) } : {}),
  }));
  return { rows };
}

test("mixed season: the profile's figures are the finished summary; presence, playing time and the log stay raw (§15)", () => {
  renderProfile(MIXED, "overview");
  const overview = last("PlayerScoutOverview");
  assert.ok(overview, "the overview rendered");
  assert.deepEqual([overview.profile.matches, overview.profile.minutes], [2, 170], "the overview's season figures");
  assert.deepEqual(seasonPlayer.contributionRate(overview.profile), { minutes: 170 / 3, count: 3 }, "« 57′ »");
  assert.deepEqual([last("PlayerScoutRail").profile.matches, last("PlayerScoutStrip").profile.matches], [2, 2], "rail and strip");
  assert.deepEqual(ids(last("PlayerScoutRail").playingTime.rows).sort(), ["m1", "m2", "m3"], "the playing time reads every observation");
  assert.equal(last("ResearchTabs").items.length, 9, "the full tabs");
  assert.equal(last("BookmarkButton").name, "Élie Durand");
  renderProfile(MIXED, "games");
  const games = last("PlayerGames");
  assert.deepEqual(ids(games.profile.rows).sort(), ["m1", "m2"], "Par compétition reads the finished rows");
  assert.deepEqual(ids(games.logRows || []).sort(), ["m1", "m2", "m3"], "the period's log keeps the canceled observation");
  renderProfile(MIXED, "physical");
  assert.deepEqual(ids(last("PlayerPhysical").rows).sort(), ["m1", "m2"], "the match load reads the finished rows");
  renderProfile(MIXED, "stats");
  assert.deepEqual(ids(last("PlayerPresenceCard").rows).sort(), ["m1", "m2", "m3"], "presence reads every observation");
});

test("no finished match: the tabs, the identity, the club and the log stay; the summary is empty (§15)", () => {
  renderProfile(ONLY_UNFINISHED, "overview");
  assert.equal(last("ResearchTabs").items.length, 9, "the full tabs, not the history layout");
  const overview = last("PlayerScoutOverview");
  assert.ok(overview, "the overview rendered");
  assert.deepEqual([overview.profile.matches, overview.profile.minutes], [0, 0], "no finished match counted");
  assert.equal(seasonPlayer.contributionRate(overview.profile), null, "no rate (« — »)");
  const strip = last("PlayerScoutStrip");
  assert.equal(strip?.identity.name, "Élie Durand", "the identity, from the raw appearances");
  assert.equal(strip.identity.imageUrl, "https://img.test/elie.png");
  assert.equal(last("PlayerScoutRail").team?.name, "Club Test", "the club, from the raw rows");
  assert.deepEqual([last("BookmarkButton").name, last("BookmarkButton").imageUrl], ["Élie Durand", "https://img.test/elie.png"]);
  assert.ok(propsOf("ComparePlayerButton").every((props) => props.profile.name === "Élie Durand"), "the comparison is named");
  assert.equal(last("PlayerScoutRail").profile.matches, 0, "the rail's figures stay finished-only");
  renderProfile(ONLY_UNFINISHED, "games");
  const games = last("PlayerGames");
  assert.deepEqual([games.profile.matches, games.profile.rows.length], [0, 0], "no finished season row");
  assert.deepEqual(ids(games.logRows || []).sort(), ["m1", "m3", "m5"], "the log keeps the three observations");
});

test("without a summary, the profile reads its rows as before (other callers)", () => {
  renderProfile(MIXED, "overview", { summary: false });
  assert.equal(last("PlayerScoutOverview").profile.matches, 3);
  renderProfile(MIXED, "games", { summary: false });
  assert.equal(last("PlayerGames").profile.matches, 3);
});

/* ------------------------------------------------------------ PlayersPage */

const pageModule = load("views/PlayersPage.jsx", {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children }) => e("a", { href }, children) },
  "next/navigation": { useSearchParams: () => currentParams },
  "../hooks/FootballContext.jsx": { FootballContext: React.createContext(null), useFootball: () => currentFootball },
  "../hooks/useCompactRead.js": { __esModule: true, default: () => ({ value: null, loading: false, error: null, retry() {} }) },
  "../services/compact-reads.js": { cohortGroupParams: () => ({}), compactGeneration: () => "g", compactQuery: (p) => JSON.stringify(p),
    playerReadParams: () => ({}) },
  "../components/Layout.jsx": { __esModule: true, default: ({ children }) => e("main", null, children) },
  "../components/UI.jsx": { Skeleton: record("Skeleton", Noop) },
  "../components/PlayerSeasonProfile.jsx": { __esModule: true, default: record("PlayerSeasonProfile", Noop) },
  "./PlayerMatchesPage.jsx": { __esModule: true, default: record("PlayerMatchesPage", Noop) },
});
async function renderPage(statuses, view) {
  seen.length = 0;
  currentFootball = football(statuses);
  currentParams = new URLSearchParams({ id: P, playerView: view });
  const page = e(pageModule.default);
  renderToStaticMarkup(page); // starts the lazy profile
  await new Promise((resolve) => setImmediate(resolve));
  renderToStaticMarkup(page);
}

test("PlayersPage hands the finished subject and summary rows to the profile, the raw rows apart (§15)", async () => {
  await renderPage(MIXED, "overview");
  const props = last("PlayerSeasonProfile");
  assert.ok(props, "the profile rendered");
  assert.deepEqual(ids(props.rows).sort(), ["m1", "m2", "m3"], "rows stay the raw observations");
  assert.equal(props.summaryProfile?.matches, 2, "summaryProfile is the finished subject");
  assert.equal(props.summaryProfile.minutes, 170);
  assert.deepEqual([...new Set(ids(props.scopeRows))].sort(), ["m1", "m2"], "scopeRows are the summary rows");
  // The legacy matches view lists the raw observations, unchanged.
  await renderPage(MIXED, "matches");
  assert.deepEqual(ids(last("PlayerMatchesPage").currentRows).sort(), ["m1", "m2", "m3"]);
});

/* ------------------------------------------------------------ PlayerGames */

const overviewModule = load("components/PlayerScoutOverview.jsx", {
  react: React,
  "./PhoneFold.jsx": { useCardFold: () => ({ section: {}, head: {}, part: "", button: null, wrap: (children) => children }) },
  "./PlayerScoutCharts.jsx": { fmt: (value, digits = 0) => Number(value).toFixed(digits), LineChart: record("LineChart", Noop),
    PercentileBadge: ({ label }) => label, TipBody: Noop },
  "./Hint.jsx": { Hint: Noop, Term: ({ children }) => children },
});
const tables = (html) => html.split("<table").slice(1).map((table) => table.split("<tbody>")[1].split("</tbody>")[0]);
const bodyRows = (tbody) => tbody.split("<tr").slice(1);

test("Matchs: Par compétition sums the finished rows; the period's table and grade plot list the log (§15)", () => {
  const data = football(MIXED).data;
  const raw = data.appearances;
  const profile = seasonPlayer.aggregateSeason(seasonPlayer.finishedAppearances(data, raw), P);
  seen.length = 0;
  const html = renderToStaticMarkup(e(overviewModule.PlayerGames, { profile, matches: data.matches, logRows: seasonPlayer.aggregateSeason(raw, P).rows }));
  const [competitions, period] = tables(html);
  assert.equal(bodyRows(competitions).length, 1, "one competition");
  assert.match(competitions, />Ligue Test</);
  // MJ, Min, Buts, PD, xG, xA, Min / B+PD, Note Vega
  const cells = [...bodyRows(competitions)[0].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual([cells[0], cells[1], cells[6]], ["2", "170", "57′"], "2 finished matches, 170 minutes, « 57′ »");
  assert.equal(bodyRows(period).length, 3, "the three observations");
  assert.match(period, />03\/09</, "the canceled match is listed");
  assert.deepEqual(bodyRows(period).map((row) => row.match(/>(\d+)′<\/td>/)?.[1]), ["80", "90", "90"], "the observed minutes");
  assert.equal(last("LineChart").points.length, 3, "the grade plot reads the log");
  // Without logRows, the log is the profile's rows (other callers).
  seen.length = 0;
  const plain = renderToStaticMarkup(e(overviewModule.PlayerGames, { profile, matches: data.matches }));
  assert.equal(bodyRows(tables(plain)[1]).length, 2);
  assert.equal(last("LineChart").points.length, 2);
});
