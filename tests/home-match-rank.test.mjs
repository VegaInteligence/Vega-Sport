// The rank under each team on the home's « Le choc de la semaine » is its place in the match's competition
// (FAILURE_MODES.md § 68; hugo, 25 Nov 2026: « je veux le rang de la compétition où a lieu le match »).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const h = React.createElement;
const src = (file) => import(pathToFileURL(path.join(root, "dashboard/frontend/src", file)).href);

async function compile(file, stubs) {
  const filename = path.join(root, "dashboard/frontend/src", file);
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
    (name) => {
      if (name === "react") return React;
      if (!(name in stubs)) throw new Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const reads = [];
let answer = () => ({ loading: true });
const fixtures = await src("services/fixtures.js");
const homeCommon = await compile("components/HomeCommon.jsx", { "../services/fixtures.js": fixtures });
const { MatchOfTheWeek } = await compile("components/HomeMatchday.jsx", {
  "next/link": { __esModule: true, default: ({ href, children, prefetch, ...props }) => h("a", { href, ...props }, children) },
  "./Icon.jsx": { __esModule: true, default: () => null },
  "./PhoneFold.jsx": { PhoneFoldToggle: () => null, usePhoneFold: () => ({}) },
  "./UI.jsx": { Media: ({ name }) => h("span", { className: "crest", "data-media": name }) },
  "./NationalFlag.jsx": { __esModule: true, default: () => null },
  "../services/national-flags.js": { nationalTeamLabel: (name) => name },
  "./Hint.jsx": { Term: ({ children }) => children },
  "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (p, q = {}) => p + "?" + new URLSearchParams(q) }) },
  "../hooks/useCrestColours.js": { __esModule: true, default: () => ({}) },
  "../services/resources.js": {
    json: (url) => url,
    useResource: (key, loader, enabled = true) => {
      if (!enabled) return {};
      reads.push(loader());
      return answer();
    },
  },
  "../services/format.js": await src("services/format.js"),
  "../services/fixtures.js": fixtures,
  "../services/home-insights.js": await src("services/home-insights.js"),
  "./HomeCommon.jsx": homeCommon,
});

const team = (id, name) => ({ id, name, imageUrl: null, score: 1, xg: 1.2, shots: 10, shotsOnTarget: 4, possession: 50 });
const match = (leagueId, league) => ({
  id: "m_000001", season: "2026/2027", leagueId, league, date: "2026-11-24", timeUtc: "2026-11-24T20:00:00Z",
  status: "finished", home: team("t_arsenl", "Arsenal"), away: team("t_dortmd", "Borussia Dortmund"), shots: [], events: [],
});
const LEAGUE_RANKS = new Map([
  ["t_arsenl", { id: "t_arsenl", rank: 1, leagueId: "l_4WFCIZ", form: ["W", "W", "D"] }],
  ["t_dortmd", { id: "t_dortmd", rank: 1, leagueId: "l_1Isor4", form: ["W", "L"] }],
]);
const PHASE = { source: "Vega", tables: [{ name: "Champions League", rows: [
  { id: "t_realmd", name: "Real Madrid", position: 1 }, { id: "t_arsenl", name: "Arsenal", position: 6 },
  { id: "t_dortmd", name: "Borussia Dortmund", position: 8 },
] }] };
const ranksIn = (html) => [...html.matchAll(/<small>(.*?)<\/small>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
const card = (props) => renderToStaticMarkup(h(MatchOfTheWeek, { ranks: LEAGUE_RANKS, competition: null, period: { current: true }, ...props }));

test("R28 a European match shows each team's place in the competition, not in its league", () => {
  reads.length = 0;
  answer = () => ({ value: PHASE });
  const html = card({ match: match("l_0bfbkO", "Champions League") });
  assert.deepEqual(reads, ["/api/standings?competition=l_0bfbkO&season=2026%2F2027"]);
  assert.deepEqual(ranksIn(html), ["6e", "8e"]);
  assert.doesNotMatch(html, /home-form/, "the league's form is not the competition's");
});

test("R28 while the competition's table loads, or when it fails, no other competition's rank", () => {
  for (const state of [{ loading: true }, { error: new Error("HTTP 503") }, { value: { tables: [] } }]) {
    answer = () => state;
    const html = card({ match: match("l_0bfbkO", "Champions League") });
    assert.deepEqual(ranksIn(html), [], JSON.stringify(state));
    assert.doesNotMatch(html, /1er/);
  }
});

test("R28 a league match keeps the served rank and form, without any read", () => {
  reads.length = 0;
  const ranks = new Map([
    ["t_arsenl", { id: "t_arsenl", rank: 3, leagueId: "l_4WFCIZ", form: ["W", "W"] }],
    ["t_dortmd", { id: "t_dortmd", rank: 5, leagueId: "l_4WFCIZ", form: ["L"] }],
  ]);
  const html = card({ match: match("l_4WFCIZ", "Premier League"), ranks });
  assert.deepEqual(reads, []);
  assert.deepEqual(ranksIn(html), ["3e ·", "5e ·"]);
  assert.match(html, /home-form/);
});
