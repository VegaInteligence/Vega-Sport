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

test("cup view identifies the edition and preserves penalty shootouts", async () => {
  const cupMatches = await import("../dashboard/frontend/src/services/cup-matches.js");
  const bracket = await import("../dashboard/frontend/src/services/knockout-bracket.js");
  const archives = await import("../dashboard/frontend/src/services/cup-archives.js");
  const rows = cupMatches.normalizeOpenCup([{ date: "2024-11-15", team1: "Paris FC", team2: "Quevilly", round: "Round 7", score: { ft: [1, 1], p: [2, 4] } }]);
  const Card = ({ title, children }) => elem("section", null, elem("h2", null, title), children);
  const stubs = {
    "react": React,
    "./UI.jsx": { Card, Media: () => null, Pager: () => null, Segments: ({ items }) => elem("div", null, items.map(([id, text]) => elem("button", { key: id }, text))), AsyncState: ({ resource, children }) => children(resource.value), Empty: ({ children }) => elem("p", null, children) },
    "./KnockoutBracket.jsx": { __esModule: true, default: () => elem("div", null, "Tableau éliminatoire") },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "../services/format.js": { date: String, seasonLabel: (value) => /^\d{4}$/.test(value) ? `${value}/${Number(value) + 1}` : value },
    "../services/fixtures.js": { parisDay: () => "2026-11-02" },
    "../services/resources.js": { useResource: () => ({ value: { matches: rows } }), json: () => {} },
    "../services/catalog-client.js": { cupTable: async () => ({ matches: [] }) },
    "../data-url.js": { dataUrl: (path) => path },
    "../services/competition-selector.js": { competitionCountryLabel: () => "France" },
    "../services/cup-matches.js": cupMatches,
    "../services/knockout-bracket.js": bracket,
    "../services/cup-archives.js": archives,
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async () => ({ matches: [] }) },
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CupCompetition.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const html = renderToStaticMarkup(elem(mod.exports.default, { competition: { id: "open-cup:france-cup", name: "Coupe de France", country: "FRA", source: "openfootball", sourceKey: "france-cup", seasons: ["2024/2025"], defaultSeason: "2024/2025", coverage: "Archive 2024/2025" } }));
  assert.match(html, /Coupe de France/);
  assert.match(html, /Tableau/);
  assert.match(html, /Archive 2024\/2025/);
  assert.match(html, /Paris FC/);
  assert.match(html, /1 – 1/);
  assert.match(html, /tirs au but 2 – 4/);
  assert.match(html, /Tour 7/);
  const euro = renderToStaticMarkup(elem(mod.exports.default, { competition: { id: "open-cup:euro", name: "Euro", country: "UEFA", source: "openfootball", sourceKey: "euro", seasons: ["2028", "2024", "2020"], defaultSeason: "2024" }, initialSeason: "2020" }));
  assert.match(euro, /<option value="2020" selected="">/);
});
