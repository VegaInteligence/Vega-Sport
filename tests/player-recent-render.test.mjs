// The bubble of a player in « Compositions » before the kick-off (FAILURE_MODES.md § 70): loading, failure, none, the
// four figures of each line, and the link to his page in every state.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
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

const recent = await import(pathToFileURL(path.join(root, "dashboard/frontend/src/services/player-recent.js")).href);
const reads = JSON.parse(readFileSync(path.join(root, "tests/fixtures/player-recent-psg-roma.json"), "utf8"));
let state = { loading: true }, asked = null;
const stubs = {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children, ...props }) => h("a", { href, ...props }, children) },
  "../hooks/FootballContext.jsx": {
    useFootball: () => ({ manifest: { publicationVersion: "g1" }, href: (page, q) => `${page}?${new URLSearchParams(q)}` }),
  },
  "../services/resources.js": { useResource: (key, loader, enabled) => ((asked = { key, enabled }), state) },
  "../services/compact-reads.js": { readCompact: async () => null },
  "../services/player-recent.js": recent,
  "../services/grades.js": { GRADE_HIGH: 70 },
  "./MatchTabs.module.css": new Proxy({}, { get: (_, key) => String(key) }),
};
const filename = path.join(root, "dashboard/frontend/src/components/PlayerRecent.jsx");
const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
  presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename,
}).code;
const mod = { exports: {} };
vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })((name) => {
  if (!(name in stubs)) throw new Error("Unexpected import " + name);
  return stubs[name];
}, mod, mod.exports);
const PlayerRecent = mod.exports.default;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const render = (props) => renderToStaticMarkup(h(PlayerRecent, { matchId: "m_36394c", season: "2026/2027", ...props }));
const link = /<a href="\/joueurs\/\?id=p_[A-Za-z0-9]+[^"]*"[^>]*>Voir la fiche du joueur<\/a>/;

test("R38 loading: the name, « Lecture des derniers matchs… » and the link; the read is of his season", () => {
  state = { loading: true };
  const html = render({ playerId: "p_2Hn7OB", name: "Matvey Safonov", positionId: 11 });
  assert.match(text(html), /Matvey Safonov/);
  assert.match(text(html), /Lecture des derniers matchs…/);
  assert.match(html, link);
  assert.match(asked.key, /^player-recent:p_2Hn7OB:2026\/2027:/);
  assert.equal(asked.enabled, true);
});

test("R38 failure: « Derniers matchs indisponibles. » and the link", () => {
  state = { loading: false, error: new Error("HTTP 500") };
  const html = render({ playerId: "p_2Hn7OB", name: "Matvey Safonov", positionId: 11 });
  assert.match(text(html), /Derniers matchs indisponibles\./);
  assert.match(html, link);
});

test("R38 no match played: « aucun match joué cette saison » and the link", () => {
  state = { loading: false, value: { appearances: [] } };
  const html = render({ playerId: "p_x00001", name: "Jeune gardien", positionId: 11 });
  assert.match(text(html), /Gardien · aucun match joué cette saison/);
  assert.match(html, link);
});

const cases = [
  ["p_2Hn7OB", 11, /Gardien · 5 derniers matchs joués · 450 min/, ["Arrêts 15", "Buts encaissés 3", "Buts évités \\+1,1", "Sans encaisser 3 / 5"]],
  ["p_3jDkWb", 34, /Défenseur · 5 derniers matchs joués/, ["Duels gagnés 62 %", "Tacles \\+ interc\\. 9", "Dégagements 16", "Passes réussies 94 %"]],
  ["p_0QyXN7", 75, /Milieu · 4 derniers matchs joués · 344 min/, ["Passes réussies 93 %", "Occasions créées 5", "Récupérations 19", "Buts · passes d\\. 1 · 1"]],
  ["p_01Prno", 105, /Attaquant · 5 derniers matchs joués/, ["Buts 1", "Passes d\\. 0", "xG 1,5", "Tirs cadrés 10 / 13"]],
];
for (const [id, positionId, head, figures] of cases)
  test(`R38 ${reads[id].name}: his line, his matches and his four figures`, () => {
    state = { loading: false, value: reads[id] };
    const html = render({ playerId: id, name: reads[id].name, positionId });
    const t = text(html);
    assert.match(t, head);
    for (const figure of figures) assert.match(t, new RegExp(figure));
    assert.equal((html.match(/data-recent-match=/g) || []).length, id === "p_0QyXN7" ? 4 : 5);
    assert.match(html, link);
  });

test("R38 a probable starter keeps « Remplace … » above his matches", () => {
  state = { loading: false, value: reads.p_3jDkWb };
  const html = render({ playerId: "p_3jDkWb", name: "Ilya Zabarnyi", positionId: 34, replaces: h("p", { "data-replaces": "" }, "Remplace X") });
  assert.ok(html.indexOf("data-replaces") > 0 && html.indexOf("data-replaces") < html.indexOf("data-recent-match="));
});
