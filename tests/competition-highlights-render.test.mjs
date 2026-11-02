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
const elem = React.createElement;

test("competition overview renders linked fixtures, results, scores and empty states", async () => {
  const highlights = await import("../dashboard/frontend/src/services/competition-highlights.js");
  const fixtures = await import("../dashboard/frontend/src/services/fixtures.js");
  const Link = ({ href, children, prefetch, ...props }) => elem("a", { href, ...props }, children);
  const Card = ({ title, children, action }) => elem("section", null, elem("h2", null, title), action, children);
  const stubs = {
    "react": React,
    "next/link": { __esModule: true, default: Link },
    "./UI.jsx": { Card, Media: () => null },
    "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (url, params) => url + "?" + new URLSearchParams(params) }) },
    "../services/format.js": { date: (value) => value.slice(0, 10) },
    "../services/fixtures.js": fixtures,
    "../services/competition-highlights.js": highlights,
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CompetitionHighlights.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const matches = [
    { id: "m_future", status: "not_started", date: "2099-01-03", time_utc: "2099-01-03T19:00:00Z", home_team: { name: "Paris" }, away_team: { name: "Lille" } },
    { id: "m_done", status: "finished", date: "2000-01-02", home_team: { name: "Lyon" }, away_team: { name: "Nice" }, score_home: 2, score_away: 1 },
  ];
  const props = { matches, competition: { id: "l_123" }, season: "2026/2027", onShowMatches: () => {} };
  const html = renderToStaticMarkup(elem(mod.exports.default, props));
  assert.match(html, /Prochains matchs/);
  assert.match(html, /Derniers résultats/);
  assert.match(html, /Heures de Paris/);
  assert.match(html, /Paris/);
  assert.match(html, /Lyon/);
  assert.match(html, /m_future/);
  assert.match(html, /m_done/);
  assert.match(html, /sourceSeason=2026%2F2027/);
  assert.match(html, /<strong>2<\/strong>/);
  const empty = renderToStaticMarkup(elem(mod.exports.default, { ...props, matches: [] }));
  assert.match(empty, /Aucune rencontre à venir/);
  assert.match(empty, /Aucun résultat disponible/);
  const completed = Array.from({ length: 6 }, (_, i) => ({ id: "m_done_" + i, status: "finished", date: "2000-01-0" + (i + 1), home_team: { name: "Équipe A" }, away_team: { name: "Équipe B" }, score_home: i, score_away: 0 }));
  const five = renderToStaticMarkup(elem(mod.exports.default, { ...props, matches: completed }));
  assert.equal((five.match(/class="competition-highlight-match"/g) || []).length, 5);
  assert.match(five, /m_done_5/);
  assert.doesNotMatch(five, /m_done_0/);

});
