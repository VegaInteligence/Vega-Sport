// The « Avant-match » cards: without a previous meeting, « Joueurs les plus utilisés » takes the whole row
// (FAILURE_MODES.md § 69; hugo, 25 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const h = React.createElement;

let value = null;
const club = (id, name) => ({ id, name, matches: 0, wins: 0, draws: 0, losses: 0, forms: [] });
const stubs = {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children, ...props }) => h("a", { href, ...props }, children) },
  "../hooks/FootballContext.jsx": { useFootball: () => ({ manifest: {}, href: (p) => p }) },
  "../services/resources.js": { useResource: () => ({ value }) },
  "../services/match-resources.js": { matchResourceKey: () => "k", validateMatchPublication: () => {} },
  "../season_data.js": { loadSeason: async () => null },
  "../services/scouting-history.js": { headToHeadFixtures: () => [], loadClubSeasonDetail: async () => null, mergeSeasonData: () => null, playerRoutes: async () => ({}) },
  "../services/compact-reads.js": { supportsCompactRead: () => false },
  "../services/club-analysis.js": {
    beforeMatch: () => true,
    clubMetric: () => ({ value: null }),
    clubSquad: (_data, team) => ({ profiles: [{ id: "p_" + team.id, name: "Joueur " + team.name, matches: 3, minutes: 270, role: { label: "Milieu" } }] }),
    clubSummary: (_data, id) => club(id, id === "t_home01" ? "Lille" : "Lens"),
    normalizedFixture: (m) => m,
  },
  "../services/format.js": { date: String, isNumber: (v) => Number.isFinite(v), number: String, seasonLabel: String },
  "../services/head-to-head.js": { headToHeadNote: () => null },
  "./UI.jsx": {
    AsyncState: ({ resource, children }) => children(resource.value),
    Card: ({ title, className, children }) => h("section", { "data-card": title, className: className || undefined }, children),
    Empty: ({ children }) => h("p", null, children),
    Media: () => null,
  },
  "./MatchLink.jsx": { MatchLink: ({ match }) => h("span", null, match.id) },
  "./StatRows.jsx": { StatRows: () => null },
};
const filename = path.join(root, "dashboard/frontend/src/components/MatchContext.jsx");
const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
  presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
}).code;
const mod = { exports: {} };
vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })((name) => {
  if (!(name in stubs)) throw new Error("Unexpected import " + name);
  return stubs[name];
}, mod, mod.exports);
const MatchContext = mod.exports.default;
const match = { id: "m_aaaaa1", leagueId: "l_3FJFUl", season: "2026/2027", date: "2026-11-28", home: { id: "t_home01", name: "Lille" }, away: { id: "t_away01", name: "Lens" } };
const meeting = { id: "m_old001", status: "finished", date: "2025-03-01", home: { id: "t_home01", score: 2 }, away: { id: "t_away01", score: 1 } };
const players = (html) => /<section data-card="Joueurs les plus utilisés"( class="([^"]*)")?/.exec(html);

test("R35 no previous meeting: no head-to-head card, the players' card spans the row", () => {
  value = { data: {}, fixtures: [], season: "2026/2027" };
  const html = renderToStaticMarkup(h(MatchContext, { match }));
  assert.doesNotMatch(html, /Confrontations précédentes/);
  assert.match(players(html)?.[2] || "", /\bmatch-overview-wide\b/);
  assert.match(html, /Joueur Lille/);
  assert.match(html, /Joueur Lens/);
});

test("R35 with a previous meeting: both cards, the players' card in its column", () => {
  value = { data: {}, fixtures: [meeting], season: "2026/2027" };
  const html = renderToStaticMarkup(h(MatchContext, { match }));
  assert.match(html, /Confrontations précédentes/);
  assert.doesNotMatch(players(html)?.[2] || "", /match-overview-wide/);
});

test("R35 the wide players' card keeps its two teams side by side on a computer", async () => {
  // Above 851 px the overview's cards stack their content in a column (« end together »); the wide players' card must
  // not, or its two teams fall one under the other and the row is half empty.
  const css = await fs.readFile(path.join(root, "dashboard/frontend/src/analysis.css"), "utf8");
  const rule = /\.match-overview-grid > \.match-overview-wide > \.card-body > \.context-players \{([^}]*)\}/.exec(css);
  assert.ok(rule, "a rule for the wide players' card");
  assert.match(rule[1], /display:\s*grid/);
  assert.match(rule[1], /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  const media = css.lastIndexOf("@media (min-width: 851px)", css.indexOf(rule[0]));
  assert.ok(media > 0 && css.indexOf(rule[0]) > css.indexOf(".match-overview-grid > .card > .card-body > :is(", media), "after the column rule it overrides");
});
