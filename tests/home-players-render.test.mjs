// « Vos joueurs cette semaine » and « Ils ont aussi brillé » (FAILURE_MODES § 80, piste B of
// https://claude.ai/artifact/7m8xpqAU3o9U9ndvf2xYKb, hugo 27 Nov 2026): one card per section with a ranked list, the
// grade a pill (green from GRADE_HIGH), no « 0 but » or « 0 passe », a phone fold after five.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react");
const { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core");
const preset = requireLocal("next/dist/compiled/babel/preset-react");
const commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const h = React.createElement;
const src = (file) => import(path.join(root, "dashboard/frontend/src", file));

async function load() {
  const stubs = {
    react: React,
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => h("a", { href, ...rest }, children) },
    "./PhoneFold.jsx": {
      usePhoneFold: () => ({ fold: { "data-phone-fold": "closed" }, toggle: { open: false, onToggle: () => {} } }),
      PhoneFoldToggle: ({ label }) => h("button", { className: "phone-fold-toggle" }, label),
    },
    "./Icon.jsx": { __esModule: true, default: ({ name }) => h("svg", { "data-icon": name }) },
    "./UI.jsx": { Media: ({ name }) => h("img", { alt: name }), Segments: () => null },
    "./HoverCard.jsx": { useHoverBubble: () => ({ show: () => {}, hide: () => {}, bubble: null }) },
    "../services/resources.js": { json: async () => ({}), useResource: () => ({ value: [] }) },
    "./MatchTabs.module.css": {},
    "./Hint.jsx": { Term: ({ children }) => children },
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({ href: (url, params = {}) => url + "?" + new URLSearchParams(params), setPlayer: () => {} }),
    },
    "../services/format.js": await src("services/format.js"),
    "./HomeCommon.jsx": {
      Kicker: ({ children }) => children,
      lastName: (n) => n,
      matchHref: () => "/matchs",
      relativeDay: () => "dimanche",
      shortDay: () => "mar. 24 nov.",
    },
    "../services/player-leaderboard.js": { playerLeaderboardHref: () => "/joueurs" },
    "../services/home-insights.js": await src("services/home-insights.js"),
    "../services/grades.js": await src("services/grades.js"),
  };
  const filename = path.join(root, "dashboard/frontend/src/components/HomePlayers.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const period = { start: "2026-11-23", end: "2026-11-29", current: true };
const game = { id: "m1", home: { name: "Brentford", score: 4 }, away: { name: "Everton", score: 0 } };
const shone = [
  { id: "a", name: "Mikkel Damsgaard", team: "Brentford", grade: 80, goals: 0, assists: 0, matchId: "m1" },
  { id: "b", name: "Vitaly Janelt", team: "Brentford", grade: 77, goals: 1, assists: 0, matchId: "m1" },
  { id: "c", name: "Jaidon Anthony", team: "Brentford", grade: 71, goals: 0, assists: 2, matchId: "m1" },
  { id: "d", name: "Un", team: "X", grade: 69.6, goals: 0, assists: 0, matchId: "m1" },
  { id: "d2", name: "Zéro", team: "X", grade: 69, goals: 0, assists: 0, matchId: "m1" },
  { id: "e", name: "Deux", team: "X", grade: 68, goals: 0, assists: 0, matchId: "m1" },
  { id: "f", name: "Trois", team: "X", grade: 67, goals: 0, assists: 0, matchId: "m1" },
  { id: "g", name: "Quatre", team: "X", grade: 66, goals: 0, assists: 0, matchId: "m1" },
];

test("« Ils ont aussi brillé » is one card with a ranked list, grades as pills, no zero", async () => {
  const { AlsoShone } = await load();
  const html = renderToStaticMarkup(h(AlsoShone, { performances: shone, matches: new Map([["m1", game]]), period }));
  assert.doesNotMatch(html, /home-rail/);
  assert.equal((html.match(/class="home-list-card"/g) || []).length, 1);
  assert.match(html, /<ol class="home-list is-ranked">/);
  assert.deepEqual([...html.matchAll(/home-list-rank">(\d+)</g)].map((m) => m[1]), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  // Green from 70 (the lineups' GRADE_HIGH), judged on the number shown: 69.6 reads 70 and is green; 69 is neutral.
  assert.equal((html.match(/class="home-grade" data-high=""/g) || []).length, 4);
  assert.match(html, /data-high="" aria-label="Note Vega 70">70</);
  assert.match(html, /aria-label="Note Vega 69">69</);
  // Only the goals and assists there are.
  assert.doesNotMatch(html, /0 but|0 passe/);
  assert.match(html, /1 but/);
  assert.match(html, /2 passes/);
  assert.match(html, /Brentford <b>4–0<\/b> Everton/);
  // A phone shows five: the sixth and seventh fold, with a button naming them all.
  assert.equal((html.match(/<li class="phone-fold-part">/g) || []).length, 3);
  assert.match(html, /data-phone-fold="closed"/);
  assert.match(html, /Voir les 8 joueurs/);
});

test("« Vos joueurs » lists each followed player with his week and his next match", async () => {
  const { YourPlayers } = await load();
  const now = Date.parse("2026-11-27T12:00:00Z");
  const next = (home, away) => ({ time: now + 864e5 * 2, home: { name: home }, away: { name: away } });
  const players = [
    {
      playerId: "p1", name: "Kylian Mbappé", team: "Real Madrid",
      matches: [{ matchId: "m1", date: "2026-11-24", opponent: "PSV Eindhoven", score: [5, 1], minutes: 90, grade: 87, goals: 2, assists: 1 }],
      next: next("Real Madrid", "Deportivo Alavés"),
    },
    {
      playerId: "p2", name: "Vitinha", team: "Paris Saint-Germain",
      matches: [{ matchId: "m2", date: "2026-11-25", opponent: "Roma", score: [2, 2], minutes: 90, grade: 69, goals: 0, assists: 0 }],
      next: null,
    },
    { playerId: "p3", name: "Lamine Yamal", team: "Barcelona", matches: [], next: next("Deportivo A Coruña", "Barcelona") },
  ];
  const html = renderToStaticMarkup(h(YourPlayers, { players, period, now }));
  assert.doesNotMatch(html, /home-rail/);
  assert.equal((html.match(/class="home-list-row"/g) || []).length, 3);
  // The opponent's name is the only part that may be cut on a phone: the score stays whole beside it.
  assert.match(html, /<span class="home-list-opponent">contre PSV Eindhoven<\/span><b class="home-list-score">5–1<\/b>/);
  assert.match(html, /2 buts/);
  assert.match(html, /1 passe/);
  assert.doesNotMatch(html, /0 but|0 passe/);
  assert.match(html, /Pas de match cette semaine/);
  // No match, no grade: a « – » pill.
  assert.match(html, /aria-label="Pas de note cette semaine">–</);
  assert.match(html, /data-high="" aria-label="Note Vega 87"/);
  // The next match, its day written with a capital.
  assert.match(html, /<b>Dimanche<\/b> · Deportivo A Coruña – Barcelona/);
});
