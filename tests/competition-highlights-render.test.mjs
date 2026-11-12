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
  const levelService = await import("../dashboard/frontend/src/services/league-levels.js").catch(() => null) || {};
  let levels = null;
  const compile = async (file, known) => {
    const source = path.join(root, file);
    const code = babel.transformSync(await fs.readFile(source, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename: source }).code;
    const out = { exports: {} };
    vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename: source })((name) => { if (!(name in known)) throw Error("Unexpected import " + name); return known[name]; }, out, out.exports);
    return out.exports.default;
  };
  const stubs = {
    "react": React,
    "next/link": { __esModule: true, default: Link },
    "./UI.jsx": { Card, Media: () => null },
    "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (url, params) => url + "?" + new URLSearchParams(params) }) },
    "../services/format.js": { date: (value) => value.slice(0, 10) },
    "../services/fixtures.js": fixtures,
    "../services/competition-highlights.js": highlights,
    // The league's level card: the service's own reading of a fixed answer, the card's markup.
    "../services/league-levels.js": { leagueStrength: levelService.leagueStrength, useLeagueLevels: () => levels },
    "./LeagueStrengthCard.jsx": { __esModule: true, default: await compile("dashboard/frontend/src/components/LeagueStrengthCard.jsx", {
      "react": React, "./UI.jsx": { Card }, "../services/format.js": { number: (value) => String(value) },
      "../services/competition-selector.js": { COUNTRY_NAMES: { ENG: "Angleterre" } },
    }) },
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
  // No level known for the competition: no card. A league on the scale: its level, rank, seasons and neighbours.
  assert.doesNotMatch(html, /Niveau du championnat/);
  levels = { onScale: 41, leagues: [
    { id: "l_top", name: "Premier League", country: "ENG", level: 1777.2, rank: 1, onScale: true, seasons: [] },
    { id: "l_123", name: "Ligue 1", level: 1636.4, rank: 2, onScale: true, seasons: [{ season: "2025/2026", level: 1630 }, { season: "2026/2027", level: 1636.4 }] },
    { id: "l_off", name: "MLS", level: 1500, rank: null, onScale: false, seasons: [] },
  ] };
  const level = renderToStaticMarkup(elem(mod.exports.default, props));
  assert.match(level, /Niveau du championnat/);
  assert.match(level, /<strong>1636<\/strong><span>2e sur 41 championnats<\/span>/);
  assert.match(level, /2026\/2027<\/span><span>1636<small>\+6<\/small>/);
  assert.match(level, /Devant : Premier League \(Angleterre\)/);
  assert.doesNotMatch(level, /Derrière/);
  assert.match(level, /competition-highlights--level/);
  const off = renderToStaticMarkup(elem(mod.exports.default, { ...props, competition: { id: "l_off" } }));
  assert.match(off, /trop peu de matchs/);

});
