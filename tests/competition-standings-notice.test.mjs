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

test("SportScore standings render without the update-timing message", async () => {
  const standings = await import("../dashboard/frontend/src/services/competition-standings.js");
  const sportscore = await import("../dashboard/frontend/src/services/sportscore-standings.js");
  const Link = ({ href, children, ...props }) => elem("a", { href, ...props }, children);
  const stubs = {
    "react": React,
    "next/link": { __esModule: true, default: Link },
    "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (url) => url }) },
    "./UI.jsx": { Empty: ({ children }) => elem("div", null, children), Media: () => null },
    "../services/format.js": { normalizeText: (value) => String(value).toLowerCase(), number: String, date: String },
    "../services/resources.js": { useResource: () => ({ value: { tables: [{ name: "Général", rows: [{ name: "Paris", position: 1, points: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, difference: 2 }] }] } }), json: () => {} },
    "../services/sportscore-standings.js": sportscore,
    "../services/competition-standings.js": standings,
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CompetitionStandings.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const html = renderToStaticMarkup(elem(mod.exports.default, { competition: { id: "l_3FJFUl", seasons: ["2026/2027"] }, season: "2026/2027", matches: [] }));
  assert.match(html, /Classement/);
  assert.doesNotMatch(html, /SportScore|PitchAPI/);
  assert.match(html, /Paris/);
  assert.doesNotMatch(html, /Les classements SportScore et les matchs PitchAPI/);
  assert.doesNotMatch(html, /actualisés à des moments différents/);
});
