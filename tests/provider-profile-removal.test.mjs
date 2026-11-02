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
const commonjs = requireLocal(
  "next/dist/compiled/babel/plugin-transform-modules-commonjs",
);
const e = React.createElement;

async function loadComponent(file, stubs) {
  const filename = path.join(root, file),
    source = await fs.readFile(filename, "utf8");
  const code = babel.transformSync(source, {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import: " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

test("lineups open the site's player profile and do not offer a provider profile", async () => {
  const UI = {
    Card: () => null,
    Empty: ({ children }) => e("p", null, children),
    AsyncState: () => null,
    StructuredData: () => null,
    Segments: () => null,
    Media: () => null,
  };
  const stubs = {
    react: React,
    "next/link": {
      __esModule: true,
      default: ({ href, children, ...props }) =>
        e("a", { href, ...props }, children),
    },
    "./UI.jsx": UI,
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({
        href: (url, params) => url + "?season=2026%2F2027&id=" + params.id,
      }),
    },
    "../services/resources.js": {
      useResource: () => null,
      download: () => {},
      json: () => {},
    },
    "./DataExplorer.jsx": { __esModule: true, default: () => null },
    "./PlayerMetrics.jsx": {
      __esModule: true,
      default: () => null,
      periodLabel: String,
    },
    "../services/format.js": {
      MATCH_SECTIONS: [],
      number: String,
      isNumber: (x) => typeof x === "number",
    },
    "./Charts.jsx": { ShotMap: () => null, XgTimeline: () => null },
    "./MatchLink.jsx": { MatchLink: () => null },
  };
  const { Lineups } = await loadComponent(
    "dashboard/frontend/src/components/MatchSections.jsx",
    stubs,
  );
  const payload = {
    home_team: { name: "Club A" },
    away_team: { name: "Club B" },
    home: {
      starters: [{ player_id: "p_123456", name: "Joueur", shirt_number: "10" }],
      subs: [],
    },
    away: { starters: [], subs: [] },
  };
  const html = renderToStaticMarkup(e(Lineups, { payload }));
  assert.match(html, /href="\/joueurs\/\?season=2026%2F2027&amp;id=p_123456"/);
  assert.match(html, /Voir le profil de Joueur/);
  assert.doesNotMatch(html, /Fiche PitchAPI|profiledialog/i);
});

test("player data retains match observations but no provider profile source", async () => {
  const requested = [];
  const stubs = {
    react: React,
    "./UI.jsx": {
      AsyncState: () => null,
      Empty: () => null,
      Segments: () => null,
    },
    "./DataExplorer.jsx": { __esModule: true, default: () => null },
    "./PlayerMetrics.jsx": {
      __esModule: true,
      default: () => null,
      periodShort: String,
    },
    "../services/resources.js": {
      useResource: (key) => {
        requested.push(key);
        return { loading: false };
      },
      json: () => {},
      download: () => {},
    },
  };
  const mod = await loadComponent(
    "dashboard/frontend/src/components/PlayerData.jsx",
    stubs,
  );
  const html = renderToStaticMarkup(
    e(mod.default, {
      row: { id: "m_1:p_1", matchId: "m_1", playerId: "p_1" },
      mode: "data",
    }),
  );
  assert.match(html, />Statistiques</);
  assert.match(html, />Composition</);
  assert.doesNotMatch(html, /Fiche du joueur|Fiche PitchAPI/);
  assert.deepEqual(requested, ["player-match-source:m_1"]);
});

test("match data keeps its analyses and omits the raw provider match profile", async () => {
  const UI = {
    Card: ({ children }) => e("section", null, children),
    Empty: ({ children }) => e("p", null, children),
    AsyncState: ({ resource, children }) => children(resource.value),
    StructuredData: () => null,
    Segments: () => null,
    Media: () => null,
  };
  const stubs = {
    react: React,
    "next/link": {
      __esModule: true,
      default: ({ children }) => e("a", null, children),
    },
    "./UI.jsx": UI,
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({
        configured: false,
        statusKnown: true,
        client: {},
        setPlayer: () => {},
      }),
    },
    "../services/resources.js": {
      useResource: () => ({
        value: { source: "snapshot", data: {} },
        loading: false,
      }),
      download: () => {},
      json: () => {},
    },
    "./DataExplorer.jsx": { __esModule: true, default: () => null },
    "./PlayerMetrics.jsx": {
      __esModule: true,
      default: () => null,
      periodLabel: String,
    },
    "../services/format.js": {
      MATCH_SECTIONS: [
        ["events", "Événements"],
        ["lineups", "Compositions"],
        ["match", "Fiche du match"],
      ],
      number: String,
      isNumber: () => false,
    },
    "./Charts.jsx": { ShotMap: () => null, XgTimeline: () => null },
    "./MatchLink.jsx": { MatchLink: () => null },
  };
  const { MatchSections } = await loadComponent(
    "dashboard/frontend/src/components/MatchSections.jsx",
    stubs,
  );
  const html = renderToStaticMarkup(
    e(MatchSections, { match: { id: "m_123456" }, initialSection: "archive" }),
  );
  assert.match(html, />Événements</);
  assert.match(html, />Compositions</);
  assert.match(html, />Archive complète</);
  assert.match(html, /2 analyses/);
  assert.doesNotMatch(html, /Fiche du match/);
});
