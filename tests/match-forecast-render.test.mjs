// The forecast card of a match to come, in parts (FAILURE_MODES.md § 70, proposal A of the mock-up hugo chose on 25 Nov
// 2026: https://claude.ai/artifact/Prb21eKP44eDYHLC3Xo3N8).
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

let answer = null;
const real = await import(pathToFileURL(path.join(root, "dashboard/frontend/src/services/forecasts.js")).href);
const filename = path.join(root, "dashboard/frontend/src/components/MatchForecast.jsx");
const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
  presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
}).code;
const mod = { exports: {} };
const stubs = {
  react: React,
  "./UI.jsx": { Card: ({ title, children }) => h("section", { "data-card": title }, children) },
  "../services/forecasts.js": { ...real, useMatchForecast: () => answer },
};
vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })((name) => {
  if (!(name in stubs)) throw new Error("Unexpected import " + name);
  return stubs[name];
}, mod, mod.exports);
const MatchForecast = mod.exports.default;
const match = { id: "m_aaaaa1", home: { name: "Lille" }, away: { name: "Lens" } };
const forecast = { home: 0.45, draw: 0.27, away: 0.28, homeGoals: 1.4, awayGoals: 1.1, score: [1, 1] };
const read = { home: 0.52, draw: 0.25, away: 0.23, homeGoals: 1.6, awayGoals: 1.0, score: [1, 0] };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

test("R34 with the line-ups: two figures, three inputs, two elevens, the table with and without", () => {
  answer = { forecast, form: { home: 1, away: 2 }, lineups: { forecast: read, home: { deviation: 0.05 }, away: { deviation: -0.3 } } };
  const html = renderToStaticMarkup(h(MatchForecast, { match }));
  const t = text(html);
  assert.match(html, /class="match-forecast-figures"/);
  assert.match(t, /Score le plus probable 1 – 0/);
  assert.match(t, /Buts attendus 1,6 – 1,0/);
  assert.match(t, /Ce que le modèle a lu/);
  assert.equal((html.match(/class="match-forecast-chip"/g) || []).length, 3);
  assert.match(t, /Onze de Lille proche de l'habituel/);
  assert.match(t, /Onze de Lens moins fort que l'habituel/);
  assert.match(html, /data-tone="down"/);
  assert.match(t, /Avec les compositions 52 % 25 % 23 %/);
  assert.match(t, /Sans les compositions 45 % 27 % 28 %/);
  assert.doesNotMatch(t, /D’après/);
});

test("R34 without the line-ups: the inputs and the note, no table", () => {
  answer = { forecast };
  const html = renderToStaticMarkup(h(MatchForecast, { match }));
  const t = text(html);
  assert.match(t, /Score le plus probable 1 – 1/);
  assert.equal((html.match(/class="match-forecast-chip"/g) || []).length, 1);
  assert.match(t, /Le modèle ne connaît ni les compositions ni les absents\./);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(t, /Onze de/);
});
