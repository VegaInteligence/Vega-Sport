// VI-30 (docs/calculs/09-audit-2026-11/FAILURE_MODES_VI30.md, written before the code): a table row's `sides` (each
// side's own FK: the team's public id and its crest reference, or null) reach the list's two existing Media slots and
// the bracket; names never choose an image; a national-team cup keeps its flags.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { normalizeSupplementalCup, numberedCupRounds } from "../dashboard/frontend/src/services/cup-matches.js";
import { combineCupLegs } from "../dashboard/frontend/src/services/knockout-bracket.js";
import { editionHeaderStub } from "./edition-stubs.mjs";
import * as nationalFlags from "../dashboard/frontend/src/services/national-flags.js";
import * as trophies from "../dashboard/frontend/src/services/trophy-art.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const elem = React.createElement;

const ref = (byte) => `https://media.vega.invalid/sha256/${byte.repeat(32)}.png`;
const side = (id, byte) => ({ id, image_url: byte ? ref(byte) : null });
const result = (home, away, score, sides, extra = {}) => ({ gw: "1", date: "2026-08-01", home, away, ft_home: String(score[0]), ft_away: String(score[1]), ...(sides && { sides }), ...extra });

test("V1/V2/V3: a side's id and crest are copied from its own row, and only when given", () => {
  const [both, partial, none, noCrest] = normalizeSupplementalCup([
    result("Brickfield", "Llanuwchllyn", [5, 1], { home: side("t_v0003688", "16"), away: side("t_v0003689", "6b") }),
    result("Atus Velden", "A. Klagenfurt", [1, 2], { away: side("t_v0000002", "aa") }),
    result("Deutschlandsberger", "Amstetten", [1, 1], undefined),
    result("Hull", "Coventry", [2, 0], { home: side("t_v0000003", null), away: side("t_v0000004", null) }),
  ], []);
  assert.deepEqual([both.homeTeamId, both.homeImage, both.awayTeamId, both.awayImage], ["t_v0003688", ref("16"), "t_v0003689", ref("6b")]);
  assert.deepEqual([partial.home, partial.homeTeamId, partial.homeImage, partial.awayTeamId, partial.awayImage], ["Atus Velden", undefined, undefined, "t_v0000002", ref("aa")]);
  for (const key of ["homeTeamId", "awayTeamId", "homeImage", "awayImage"]) assert.equal(key in none, false, key);
  assert.deepEqual([noCrest.homeTeamId, noCrest.homeImage, noCrest.awayImage], ["t_v0000003", undefined, undefined]);
});

test("V4: two clubs spelled alike keep their own rows' images; a malformed side is ignored", () => {
  const rows = normalizeSupplementalCup(
    [result("Ipswich", "Sunderland", [2, 1], { home: side("t_v1", null), away: side("t_v0000010", null) })],
    [{ gw: "2", date: "2026-11-21", home: "Aston Villa", away: "Sunderland", sides: { home: side("t_v2", null), away: side("t_v0009402", "2b") } },
     { gw: "2", date: "2026-11-22", home: "X", away: "Y", sides: { home: { id: 7, image_url: ref("cc") }, away: { id: "t_v3", image_url: 42 } } }],
  );
  const [first, twin, odd] = rows;
  assert.equal(first.awayImage, undefined);
  assert.deepEqual([twin.awayTeamId, twin.awayImage], ["t_v0009402", ref("2b")]);
  assert.deepEqual([odd.homeTeamId, odd.homeImage, odd.awayTeamId, odd.awayImage], [undefined, undefined, "t_v3", undefined]);
  assert.equal(twin.status, "scheduled");
});

test("V11: two legs combined keep the first leg's sides, in the displayed order", () => {
  // A two-legged semi-final (the round's name as the source gives it), the second leg reversed.
  const legs = normalizeSupplementalCup([
    result("A", "B", [1, 0], { home: side("t_a", "0a"), away: side("t_b", "0b") }, { gw: "5", date: "2027-01-10", round_name: "Semi-finals" }),
    result("B", "A", [2, 2], { home: side("t_b", "0b"), away: side("t_a", "0a") }, { gw: "6", date: "2027-01-17", round_name: "Semi-finals" }),
  ], []);
  const [tie] = combineCupLegs(numberedCupRounds(legs));
  assert.deepEqual([tie.home, tie.homeImage, tie.away, tie.awayImage], ["A", ref("0a"), "B", ref("0b")]);
  assert.deepEqual(tie.legs.map((l) => l.score), [[1, 0], [2, 2]]);
});

async function cupComponent(flags) {
  const cupMatches = await import("../dashboard/frontend/src/services/cup-matches.js");
  // A Media that shows what it was given; a flag that names its team.
  const Media = ({ name, url }) => elem("i", { "data-media": name, "data-url": url ?? "" });
  const NationalFlag = ({ name }) => { flags.push(name); return elem("b", { "data-flag": name }); };
  const stubs = {
    react: React,
    "./UI.jsx": { Card: ({ children }) => elem("section", null, children), Media, Pager: () => null, Segments: () => null, AsyncState: () => null, Empty: ({ children }) => elem("p", null, children) },
    "./KnockoutBracket.jsx": { __esModule: true, default: () => null },
    "./NationalFlag.jsx": { __esModule: true, default: NationalFlag },
    "./EditionHeader.jsx": editionHeaderStub(React),
    "../services/national-flags.js": nationalFlags,
    "../services/trophy-art.js": trophies,
    "../services/format.js": { date: String, seasonLabel: String },
    "../services/fixtures.js": { parisDay: () => "2026-11-18" },
    "../services/resources.js": { useResource: () => ({}) },
    "../services/competition-artwork.js": await import("../dashboard/frontend/src/services/competition-artwork.js"),
    "../services/catalog-client.js": { cupTable: async () => [] },
    "../services/competition-selector.js": { competitionCountryLabel: () => "" },
    "../services/cup-matches.js": cupMatches,
    "../services/knockout-bracket.js": { combineCupLegs: (m) => m, knockoutStage: () => null },
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async () => ({ matches: [] }) },
    "../services/cup-archives.js": { NATIONAL_CUP_ARCHIVES: {}, GERMAN_CUP_FOLDER: "GER_CUP_dfb-pokal", isGermanCupSeason: () => false },
    "./SeasonProjection.jsx": { __esModule: true, default: () => null },
    "../services/cup-projection.js": { useCupProjection: () => null },
    "./Hint.jsx": { Term: ({ children }) => children },
    "../services/forecasts.js": { share: String },
    "./MatchForecastBar.jsx": { __esModule: true, default: () => null },
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CupCompetition.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  return mod.exports;
}

test("V1/V3: the list's two existing Media slots receive each side's own crest, in order; none without one", async () => {
  const { CupMatchList } = await cupComponent([]);
  const matches = normalizeSupplementalCup([
    result("Brickfield", "Llanuwchllyn", [5, 1], { home: side("t_v0003688", "16"), away: side("t_v0003689", "6b") }),
    result("Atus Velden", "A. Klagenfurt", [1, 2], { away: side("t_v0000002", "aa") }, { date: "2026-07-24" }),
  ], []);
  const html = renderToStaticMarkup(elem(CupMatchList, { matches, status: "finished", query: "", page: 1, onPage: () => {} }));
  const slots = [...html.matchAll(/<i data-media="([^"]*)" data-url="([^"]*)"><\/i>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(slots, [["Brickfield", ref("16")], ["Llanuwchllyn", ref("6b")], ["Atus Velden", ""], ["A. Klagenfurt", ref("aa")]]);
  // The row keeps the main lists' design: the name beside its badge, the score between.
  assert.match(html, /<span class="team-name home-team"><span>Brickfield<\/span><i data-media="Brickfield"/);
});

test("V8: a national-team cup keeps its flags and ignores any image", async () => {
  const flags = [];
  const { CupMatchList } = await cupComponent(flags);
  const matches = [{ key: "n", date: "2024-06-14", home: "Germany", away: "Scotland", score: [5, 1], status: "finished", round: "", homeImage: ref("de"), awayImage: ref("5c") }];
  const html = renderToStaticMarkup(elem(CupMatchList, { matches, status: "finished", query: "", page: 1, onPage: () => {}, nationalTeams: true, season: "2024" }));
  assert.deepEqual(flags, ["Germany", "Scotland"]);
  assert.doesNotMatch(html, /data-media=/);
});
