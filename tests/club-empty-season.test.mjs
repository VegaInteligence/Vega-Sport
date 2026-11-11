// A club the base knows in a season by its results only (no match statistics yet): the
// profile says so instead of printing ranks and totals it does not have.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { clubSummary, seasonCoverage } from "../dashboard/frontend/src/services/club-analysis.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react");
const { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core");
const preset = requireLocal("next/dist/compiled/babel/preset-react");
const commonjs = requireLocal("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const h = React.createElement;

/** ClubScoutUI.jsx with its real code; what it imports is stubbed. */
async function loadUI() {
  const filename = path.join(root, "dashboard/frontend/src/components/ClubScoutUI.jsx");
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const stubs = {
    react: React,
    "next/link": { __esModule: true, default: ({ children, ...props }) => h("a", props, children) },
    "./Icon.jsx": { __esModule: true, default: () => null },
    // The phone fold is off in these renders: a card renders as it always did.
    "./PhoneFold.jsx": {
      useCardFold: () => ({
        section: {},
        head: {},
        part: "",
        button: null,
        wrap: (children) => children,
      }),
    },
    "../hooks/FootballContext.jsx": { useFootball: () => null },
    "./PlayerScoutCharts.jsx": { PercentileBar: () => null, toneVar: () => "" },
    "./RankingDialog.jsx": { RankingTrigger: () => null },
    "../services/club-scout.js": { METRICS: {}, SITUATION_LABELS: {}, STYLE_AXES: [], formatMetric: String, rolling: () => [] },
    // A CSS module: every class reads as its own name.
    "./ClubScout.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) },
  };
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
    (name) => {
      if (!(name in stubs)) throw new Error("Unexpected import: " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const fixture = (id, status, home, away, score) => ({
  id,
  season: "2025/2026",
  date: "2026-05-16",
  status,
  league_id: "l_league",
  league_name: "Bundesliga",
  home_team: { id: home, name: home === "t_club01" ? "1. FC Köln" : "Other" },
  away_team: { id: away, name: away === "t_club01" ? "1. FC Köln" : "Other" },
  ...(score ? { home_score: score[0], away_score: score[1] } : {}),
});

test("a season known by its results only has games played and nothing to rank", () => {
  const data = {
    matches: [],
    appearances: [],
    fixtures: [
      fixture("m_000001", "finished", "t_club01", "t_other1", [2, 1]),
      fixture("m_000002", "finished", "t_other1", "t_club01", [0, 0]),
      fixture("m_000003", "not_started", "t_club01", "t_other1"),
    ],
  };
  const coverage = seasonCoverage(clubSummary(data, "t_club01"), []);
  assert.deepEqual(coverage, { played: 2, analysed: 0, empty: true });
  assert.deepEqual(seasonCoverage({ games: [] }, []), { played: 0, analysed: 0, empty: true });
  assert.equal(seasonCoverage(clubSummary(data, "t_club01"), [{}, {}]).empty, false);
});

test("an ordinal is printed only for a rank that exists", async () => {
  const { ordinal } = await loadUI();
  assert.equal(ordinal(1), "1er");
  assert.equal(ordinal(15), "15e");
  assert.equal(ordinal(null), "—");
  assert.equal(ordinal(undefined), "—");
});

test("the empty season says what is known and prints no rank, total or 'undefined'", async () => {
  const { ClubEmptySeason } = await loadUI();
  const dossier = { id: "t_club01", name: "1. FC Köln", season: "2025/2026", league: { name: "Bundesliga" }, imageUrl: null };
  const known = renderToStaticMarkup(h(ClubEmptySeason, { dossier, played: 34 }));
  assert.match(known, /1\. FC Köln/);
  assert.match(known, /Bundesliga · 2025\/2026/);
  assert.match(known, /34 matchs joués/);
  assert.match(known, /statistiques de match ne sont pas disponibles/);
  assert.match(known, /role="status"/);
  assert.doesNotMatch(known, /undefined|null|NaN|\d+e\b|pts/);
  assert.match(renderToStaticMarkup(h(ClubEmptySeason, { dossier, played: 1 })), /\(1 match joué\)/);
  const none = renderToStaticMarkup(h(ClubEmptySeason, { dossier, played: 0 }));
  assert.match(none, /Aucun match joué cette saison\./);
  assert.doesNotMatch(none, /undefined|null|NaN|se remplira/);
});
