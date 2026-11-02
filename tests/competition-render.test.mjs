import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const localRequire = createRequire(path.join(root, "dashboard/package.json"));
const React = localRequire("react");
const { renderToStaticMarkup } = localRequire("react-dom/server");
const babel = localRequire("next/dist/compiled/babel/core");
const preset = localRequire("next/dist/compiled/babel/preset-react");
const commonjs = localRequire("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const elem = React.createElement;

test("competition page renders a result-derived league table and its limits", async () => {
  const standings = await import("../dashboard/frontend/src/services/competition-standings.js");
  const league = { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", seasons: ["2026/2027"] };
  const matches = [{ id: "m_1", status: "finished", date: "2026-11-01", home_team: { id: "a", name: "Paris" }, away_team: { id: "b", name: "Lille" }, score_home: 2, score_away: 0 }];
  const context = { catalog: [league], manifest: { seasons: [{ id: "2026/2027", chunks: [] }] }, season: "2026/2027", focus: "all", client: { id: 1 }, statusKnown: true, configured: false, href: (url) => url };
  const Link = ({ href, children, ...props }) => elem("a", { href, ...props }, children);
  const Card = ({ title, children }) => elem("section", null, elem("h2", null, title), children);
  const UI = { Card, Media: () => null, Pager: () => null, Segments: ({ items }) => elem("div", null, items.map(([id, text]) => elem("button", { key: id }, text))), Empty: ({ children }) => elem("div", null, children), AsyncState: ({ resource, children }) => children(resource.value) };
  const stubs = {
    "react": React, "next/navigation": { useSearchParams: () => new URLSearchParams("id=l_3FJFUl") },
    "next/link": { __esModule: true, default: Link },
    "../components/Icon.jsx": { __esModule: true, default: () => null },
    "../components/Layout.jsx": { __esModule: true, default: ({ children }) => elem("main", null, children) },
    "../hooks/FootballContext.jsx": { useFootball: () => context }, "../components/UI.jsx": UI,
    "../components/MatchLink.jsx": { MatchLink: () => null },
    "../services/format.js": { normalizeText: String, seasonLabel: String, number: String, date: String },
    "../services/resources.js": { useResource: () => ({ value: { matches, source: "snapshot" } }), json: () => {}, download: () => {} },
    "../model.js": { csvString: () => "" }, "../data-url.js": { dataUrl: (x) => x },
    "../components/CompetitionScope.jsx": { __esModule: true, default: () => null },
    "../../../shared/competition-scope.js": { EUROPE_FOCUS_IDS: new Set() },
    "../services/competition-standings.js": standings,
  };
  const filename = path.join(root, "dashboard/frontend/src/views/CompetitionsPage.jsx");
  const source = await fs.readFile(filename, "utf8");
  const compiled = babel.transformSync(source, { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  const run = vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename });
  run((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const html = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(html, /Classement calculé à partir des résultats disponibles/);
  assert.match(html, /Paris/);
  assert.match(html, /Lille/);
  assert.match(html, /sanctions/);
  assert.match(html, /<table/);
});
