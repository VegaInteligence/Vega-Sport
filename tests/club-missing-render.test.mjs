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
  "./CompetitionPicker.jsx": { CompetitionPicker: () => null },
  "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (url, params) => `${url}?${new URLSearchParams(params)}` }) },
  "./Hint.jsx": { Hint: () => null, Term: ({ children }) => children },
  "../services/club-supported.js": supported,
  // The checked image resolver (the real module): Picture goes through it (FAILURE_MODES.md §22).
  "../services/format.js": await import("../dashboard/frontend/src/services/format.js"),
};
const ui = await load("ClubScoutUI.jsx", {
  ...common,
  "./ClubSkeleton.jsx": { __esModule: true, default: () => null },
  "./UI.jsx": { Skeleton: () => null, Media: () => null },
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

const tabStubs = {
  ...common,
  "./UI.jsx": { Segments: () => null, Skeleton: () => null },
  "./ResearchUI.jsx": { BookmarkButton: () => null },
  "./PhoneFold.jsx": { PhoneFoldToggle: () => null, usePhoneFold: () => ({ fold: {}, part: "", button: null }) },
  "./PointsRace.jsx": { PointsRaceLines: () => null, PointsPerMatch: () => null },
  "../services/profile-blocks.js": { euros: () => "", readDay: () => "", useClubSquad: () => null, weightedAge: () => null },
  "../services/resources.js": { json: async () => ({}), useResource: () => ({}) },
  "./ClubInformation.jsx": { __esModule: true, default: () => null },
  "./TeamHero.jsx": { __esModule: true, default: () => null },
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
  // The squad tab's absents (lot 2 of « Blessés et suspendus »): not rendered by these tests.
  "./Absences.jsx": { AbsenceBoard: () => null, AbsenceCoverage: () => null, AbsenceMark: () => null },
  "../services/team-absences.js": { absenceView: () => null, useTeamAbsences: () => ({}) },
};
const tabs = await load("ClubScoutTabs.jsx", tabStubs);

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

// GH139-f/g (FAILURE_MODES_OPTIMISATIONS.md, written before the change): a coming match's chances come from its fixture
// in the club read (`forecast`, null without one); a fixture without the field (an API before GH139) asks the match's own
// read. The real share() and matchForecast(); the hook records what it is asked and answers as /api/forecasts/match.
test("GH139-f/g: the next matches' chances from the club read, a match's own read only without them", async () => {
  const { share } = await import("../dashboard/frontend/src/services/forecasts.js");
  const { matchForecast } = await import("../dashboard/frontend/src/services/cup-matches.js");
  const own = {
    m_1: { home: 0.5123, draw: 0.2501, away: 0.2376 }, m_2: { home: 0.2, draw: 0.3, away: 0.5 }, m_3: null,
    m_4: { home: 0.0452, draw: 0.1054, away: 0.8494 }, m_5: { home: 0.7, draw: 0.2, away: 0.1 }, m_6: { home: 0.34, draw: 0.33, away: 0.33 },
  };
  const ids = Object.keys(own), asked = [];
  let summary;
  const read = await load("ClubScoutTabs.jsx", {
    ...tabStubs,
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({ ...tabStubs["../hooks/FootballContext.jsx"].useFootball(), data: summary }),
    },
    "../services/forecasts.js": {
      share,
      useMatchForecast: (id, enabled = true) => {
        asked.push([id, enabled]);
        return enabled && own[id] ? { match: id, forecast: { ...own[id], homeGoals: 1.4, awayGoals: 1.1, score: [1, 1] } } : null;
      },
    },
    "../services/cup-matches.js": { matchForecast },
  });
  // Home, then away, in turn.
  const self = { id: "t_a", name: "Club A" };
  const render = (carried) => {
    asked.length = 0;
    const upcoming = ids.map((id, i) => {
      const other = { id: `t_${i}`, name: `Adversaire ${i}` };
      return { id, date: `2026-12-0${i + 1}`, home: i % 2 ? other : self, away: i % 2 ? self : other, league: "Ligue", ...(carried.includes(id) && { forecast: own[id] }) };
    });
    return [...html(e(read.Upcoming, { dossier: { id: "t_a", season: "2026/2027", clubs: [], upcoming } })).matchAll(/aria-label="(Victoire [^"]*)"/g)].map((m) => m[1]);
  };
  const fetched = () => [...new Set(asked.filter(([, enabled]) => enabled).map(([id]) => id))];
  // V the club's own share, N the draw, D the opponent's; twice a row (narrow and wide); nothing for m_3.
  const want = ids.flatMap((id, i) => {
    const f = own[id], home = i % 2 === 0;
    return f ? Array(2).fill(`Victoire ${share(home ? f.home : f.away)}, Nul ${share(f.draw)}, Défaite ${share(home ? f.away : f.home)}`) : [];
  });
  assert.deepEqual(render(ids), want);
  assert.deepEqual(fetched(), [], "no match's own read when the club read carries its forecast");
  assert.deepEqual(render([]), want);
  assert.deepEqual(fetched(), ids, "an API before GH139: each match's own read, as before");
  assert.deepEqual(render(["m_1", "m_3", "m_5"]), want);
  assert.deepEqual(fetched(), ["m_2", "m_4", "m_6"]);

  // GH139-l: the club summary revalidated while the dossier remained cached.
  summary = {
    meta: { actor: { kind: "club", id: "t_a" }, currentSeason: "2026/2027" },
    fixtures: [
      { id: "m_1", status: "not_started", forecast: { home: 0.6, draw: 0.2, away: 0.2 } },
      { id: "m_2", status: "not_started", forecast: null },
      { id: "m_4", status: "finished" },
    ],
  };
  assert.deepEqual(render(ids), [
    "Victoire 60 %, Nul 20 %, Défaite 20 %",
    "Victoire 60 %, Nul 20 %, Défaite 20 %",
    ...want.slice(6),
  ]);
  assert.deepEqual(fetched(), []);
  summary.meta.currentSeason = "2025/2026";
  assert.deepEqual(render(ids), want);
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

// The squad tab's « Absents » card when no read date is known (asOf null: no player's suspensions read yet).
// Written before the fix: in production, absenceScale(rows, null) threw RangeError and the tab fell to its error
// boundary. The reference day is then the latest read of the absences shown, else today (UTC).
const absences = await import("../dashboard/frontend/src/services/team-absences.js");
const board = await load("Absences.jsx", {
  ...common,
  "./UI.jsx": { Card: ({ children }) => children, ClubCrest: () => null, PlayerAvatar: () => null, Skeleton: () => null },
  "./PlayerScoutCharts.jsx": { chartTokens: "" },
  "../services/team-absences.js": absences,
});
const player = (id, name) => ({ id, name, imageUrl: null, role: "winger" });
const injury = (id, name, start, expectedReturn, extra = {}) => ({
  player: player(id, name), kind: "injury", label: "Cruciate ligament tear", start, expectedReturn,
  matchesMissed: 0, matchesRemaining: null, competition: null, readAt: "2026-11-23", ...extra,
});
// PSG's answer in production (2026-11-23).
const psg = {
  id: "t_41iFW3", asOf: null, squad: { players: 25, read: 0 },
  absences: [
    injury("p_4bGFWS", "Désiré Doué", "2026-11-22", null),
    injury("p_2ZwqC5", "Khvicha Kvaratskhelia", "2026-10-21", "2027-05-31", { matchesMissed: 5 }),
  ],
};
const finite = (scale) => scale.ticks.length > 0 && scale.ticks.every((t) => Number.isFinite(t.at) && t.at > 0 && t.at < 1 && t.label);

test("absents: no read date, the card holds on the latest read (PSG in production)", () => {
  const view = absences.absenceView(psg);
  assert.equal(view.asOf, "2026-11-23");
  const scale = absences.absenceScale(view.rows, view.asOf);
  assert.ok(finite(scale));
  const markup = html(e(board.AbsenceBoard, { view }));
  assert.match(markup, /Désiré Doué[\s\S]*Khvicha Kvaratskhelia|Khvicha Kvaratskhelia[\s\S]*Désiré Doué/);
  assert.match(markup, /dans 27 sem\./);
  assert.doesNotMatch(markup, /NaN|Invalid/);
});

test("absents: no read date and no dated return, the card holds", () => {
  const view = absences.absenceView({ ...psg, absences: [psg.absences[0]] });
  assert.ok(finite(absences.absenceScale(view.rows, view.asOf)));
  const markup = html(e(board.AbsenceBoard, { view }));
  assert.match(markup, /Désiré Doué[\s\S]*Inconnu/);
  assert.doesNotMatch(markup, /NaN|Invalid/);
});

test("absents: no read date and no absence, no card", () => {
  const view = absences.absenceView({ ...psg, absences: [] });
  assert.equal(html(e(board.AbsenceBoard, { view })), "");
});

test("absents: no read date nor read day, the reference is today (UTC)", () => {
  const view = absences.absenceView({ ...psg, absences: psg.absences.map((a) => ({ ...a, readAt: null })) });
  assert.equal(view.asOf, new Date().toISOString().slice(0, 10));
});

test("absents: a known read date is kept, the scale unchanged", () => {
  const view = absences.absenceView({ ...psg, asOf: "2026-11-23" });
  assert.equal(view.asOf, "2026-11-23");
  const scale = absences.absenceScale(view.rows, view.asOf);
  assert.deepEqual(scale.ticks.map((t) => t.label), ["déc.", "janv.", "févr.", "mars", "avr.", "mai"]);
  const span = Date.UTC(2027, 5, 1) - Date.UTC(2026, 10, 23);
  assert.equal(scale.ticks[0].at, (Date.UTC(2026, 11, 1) - Date.UTC(2026, 10, 23)) / span);
  assert.equal(scale.at("2027-05-31"), (Date.UTC(2027, 4, 31) - Date.UTC(2026, 10, 23)) / span);
});

test("absents: an empty or invalid day never throws nor reads NaN", () => {
  for (const asOf of [null, undefined, "", "n/a"]) {
    const scale = absences.absenceScale(psg.absences, asOf);
    assert.ok(finite(scale), String(asOf));
    assert.ok(Number.isFinite(scale.at("2027-05-31")));
    assert.equal(absences.returnDistance("2027-05-31", asOf), null, String(asOf));
    assert.doesNotMatch(absences.absenceTitle(psg.absences[1], asOf), /NaN|Invalid/);
    assert.doesNotMatch(absences.absenceDate("2026-10-21", asOf), /NaN|Invalid/);
    assert.doesNotMatch(html(e(board.AbsenceMark, { absence: psg.absences[1], asOf })), /NaN|Invalid/);
  }
  // An invalid read date in the answer: the view falls back like a missing one.
  assert.equal(absences.absenceView({ ...psg, asOf: "n/a" }).asOf, "2026-11-23");
});
