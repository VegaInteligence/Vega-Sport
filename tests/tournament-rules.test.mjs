// VI-27 B: an edition's group tables, a nation's runs and the links between them, by each edition's own rules
// (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §34, written before the code; Astra–Fable decision of 18 Nov 2026).
//
// Failure modes and expected outcomes (the numbers are §34.2's):
//
// 34a–34c 1950's final pool: Uruguay 5, Brazil 4, Sweden 2, Spain 1 (two points a win); no positions when a score is
//         missing or the scores disagree with the attested table.
// 34d     A tie no declared step separates is shared (« 2= »), never ordered by name.
// 34e–34g 1954 and 1958: the group's play-off orders the two teams level, outside the group's totals; a match after
//         extra time counts with its final score.
// 34h–34m Euro 2020/2024: head-to-head first; World Cup 1994–2022: difference, goals, head-to-head, then fair play the
//         reader does not hold; World Cup 1974–1990: difference, goals; Euro 1992: two points a win (UEFA witness).
// 34n–34p Euro 2028's groups named in the round, with codes for teams; an edition's rule unknown; a canceled match.
// 34x–34aa A run without rounds has no phase and no gauge; the gauges of the new stages; links only to editions the
//         site holds, on a view the edition has.
// 34ab    1950's page opens on its groups and has no bracket.
// 34ae–34ag « Italie » finds Italy's matches; a canceled match reads « Annulé »; a replayed tie carries its replay's id.
//
// The archive editions are read from the frozen OpenFootball files through the bridge's projection, as the API serves
// them (backend/tests/fixtures/openfootball/editions.json, sha256 52c75b78…).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as cupMatches from "../dashboard/frontend/src/services/cup-matches.js";
import * as bracket from "../dashboard/frontend/src/services/knockout-bracket.js";
import * as catalog from "../dashboard/frontend/src/services/cup-catalog.js";
import * as runs from "../dashboard/frontend/src/services/tournament-runs.js";
import * as nationalFlags from "../dashboard/frontend/src/services/national-flags.js";
import * as trophies from "../dashboard/frontend/src/services/trophy-art.js";
import { editionHeaderStub } from "./edition-stubs.mjs";

const { groupTables, normalizeOpenCup, filterCupMatches } = cupMatches;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { editions } = JSON.parse(fs.readFileSync(path.join(root, "backend/tests/fixtures/openfootball/editions.json"), "utf8"));
const { GET } = await import("../backend/sources/projections/open-cups.mjs");
// The day the tests read as today (the 1950 to 2026 editions are played, Euro 2028 is to come).
const TODAY = "2026-11-18";
const NOW = Date.parse(TODAY + "T12:00:00Z");

/** An archive edition as the API serves it (the bridge's projection of the frozen file), as the site reads it. */
async function projected(key) {
  globalThis.fetch = async () => Response.json(editions[key]);
  const [competition, season] = key.split(":");
  const response = await GET(new Request(`http://bridge/api/open-cups?competition=${competition}&season=${season}`));
  assert.equal(response.status, 200, key);
  return (await response.json()).matches;
}
const edition = async (key) => normalizeOpenCup(await projected(key));
const context = (key) => { const [competition, season] = key.split(":"); return { competition, season, today: TODAY }; };
const tables = async (key) => groupTables(await edition(key), context(key));
const table = (list, name) => list.find((t) => t.name === name) || assert.fail(`no table ${name}: ${list.map((t) => t.name)}`);
const ranked = (t) => t.rows.map((r) => [r.name, r.position, r.points, Boolean(r.tied)]);

// The cup page through its real module, its other parts stubbed as the render tests do (tests/cup-sides.test.mjs).
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const h = React.createElement;
const render = (component, props) => renderToStaticMarkup(h(component, props));

async function cupComponent(value = { matches: [] }) {
  const stubs = {
    react: React,
    "./UI.jsx": { Card: ({ children }) => h("section", null, children), Media: () => null, Pager: () => null,
      Segments: ({ label, items }) => h("div", { "aria-label": label }, items.map(([id, text]) => h("button", { key: id, "data-view": id }, text))),
      AsyncState: ({ resource, children }) => children(resource.value), Empty: ({ children }) => h("p", null, children) },
    "./KnockoutBracket.jsx": { __esModule: true, default: () => h("div", null, "Tableau éliminatoire") },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "./EditionHeader.jsx": editionHeaderStub(React),
    "../services/national-flags.js": nationalFlags,
    "../services/trophy-art.js": trophies,
    "../services/format.js": { date: String, seasonLabel: String },
    "../services/fixtures.js": { parisDay: () => TODAY },
    "../services/resources.js": { useResource: () => ({ value }) },
    "../services/competition-artwork.js": await import("../dashboard/frontend/src/services/competition-artwork.js"),
    "../services/catalog-client.js": { cupTable: async () => [], cupEditionTable: async () => null },
    "../services/competition-selector.js": { competitionCountryLabel: () => "" },
    "../services/cup-matches.js": cupMatches,
    "../services/knockout-bracket.js": bracket,
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async () => ({ matches: [] }) },
    "../services/cup-archives.js": { NATIONAL_CUP_ARCHIVES: {}, GERMAN_CUP_FOLDER: "GER_CUP_dfb-pokal", isGermanCupSeason: () => false },
    "./SeasonProjection.jsx": { __esModule: true, default: () => null },
    "../services/cup-projection.js": { useCupProjection: () => null },
    "./Hint.jsx": { Term: ({ children }) => children },
    "../services/forecasts.js": { share: String },
    "./MatchForecastBar.jsx": { __esModule: true, default: () => null },
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CupCompetition.jsx");
  const compiled = babel.transformSync(fs.readFileSync(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => {
    if (!(name in stubs)) throw Error("Unexpected import " + name);
    return stubs[name];
  }, mod, mod.exports);
  return mod.exports;
}

test("34a–34c. 1950's final pool: two points a win, ranked only on its complete and attested results", async () => {
  const groups = await tables("world-cup-history:1950");
  assert.deepEqual(groups.map((t) => t.name), ["Groupe 1", "Groupe 2", "Groupe 3", "Groupe 4", "Poule finale"]);
  assert.deepEqual(ranked(table(groups, "Poule finale")), [["Uruguay", 1, 5, false], ["Brazil", 2, 4, false], ["Sweden", 3, 2, false], ["Spain", 4, 1, false]]);
  // An older API without the last day's score: the pool is not ranked, the two teams of that match have no points.
  const matches = await projected("world-cup-history:1950");
  const unscored = matches.map((m) => (m.round === "Final Round" && m.team1 === "Uruguay" && m.team2 === "Brazil" ? { ...m, score: undefined } : m));
  const partial = table(groupTables(normalizeOpenCup(unscored), context("world-cup-history:1950")), "Poule finale");
  assert.deepEqual(partial.rows.map((r) => r.position), [null, null, null, null]);
  assert.deepEqual(partial.rows.filter((r) => r.points === null).map((r) => r.name).sort(), ["Brazil", "Uruguay"]);
  // Scores that disagree with the attested table (Brazil winning the last day): no positions either.
  const contrary = matches.map((m) => (m.round === "Final Round" && m.team1 === "Uruguay" && m.team2 === "Brazil" ? { ...m, score: { ft: [1, 2] } } : m));
  assert.deepEqual(table(groupTables(normalizeOpenCup(contrary), context("world-cup-history:1950")), "Poule finale").rows.map((r) => r.position), [null, null, null, null]);
});

test("34d. teams no declared step separates share their position", async () => {
  const group2 = table(await tables("world-cup-history:1950"), "Groupe 2");
  assert.deepEqual(ranked(group2), [["Spain", 1, 6, false], ["England", 2, 2, true], ["Chile", 2, 2, true], ["United States", 2, 2, true]]);
  assert.equal(group2.unresolved, true);
});

test("34e–34g. 1954 and 1958: the play-off orders the two teams level, outside the totals; extra time counts", async () => {
  const groups1954 = await tables("world-cup-history:1954");
  const group2 = table(groups1954, "Groupe 2");
  assert.deepEqual(ranked(group2), [["Hungary", 1, 4, false], ["West Germany", 2, 2, false], ["Turkey", 3, 2, false], ["South Korea", 4, 0, false]]);
  assert.deepEqual(group2.rows.map((r) => [r.name, r.played, r.goalsFor, r.goalsAgainst]), [["Hungary", 2, 17, 3], ["West Germany", 2, 7, 9], ["Turkey", 2, 8, 4], ["South Korea", 2, 0, 16]]);
  const group4 = table(groups1954, "Groupe 4");
  assert.deepEqual(ranked(group4), [["England", 1, 3, false], ["Switzerland", 2, 2, false], ["Italy", 3, 2, false], ["Belgium", 4, 1, false]]);
  // England–Belgium 4–4 after extra time (3–3 at 90): a draw with its final score.
  assert.deepEqual(group4.rows.map((r) => [r.name, r.goalsFor]), [["England", 6], ["Switzerland", 2], ["Italy", 5], ["Belgium", 5]]);
  const group1958 = table(await tables("world-cup-history:1958"), "Groupe 1");
  assert.deepEqual(ranked(group1958), [["West Germany", 1, 4, false], ["Northern Ireland", 2, 3, false], ["Czechoslovakia", 3, 3, false], ["Argentina", 4, 2, false]]);
  assert.deepEqual(group1958.rows.map((r) => r.played), [3, 3, 3, 3]);
});

test("34h–34l. each edition's tie-breaks: Euro head-to-head, FIFA difference and goals then head-to-head", async () => {
  assert.deepEqual(ranked(table(await tables("euro:2020"), "Groupe F")), [["France", 1, 5, false], ["Germany", 2, 4, false], ["Portugal", 3, 4, false], ["Hungary", 4, 2, false]]);
  assert.deepEqual(ranked(table(await tables("euro:2024"), "Groupe E")), [["Romania", 1, 4, false], ["Belgium", 2, 4, false], ["Slovakia", 3, 4, false], ["Ukraine", 4, 4, false]]);
  assert.deepEqual(ranked(table(await tables("world-cup-history:1994"), "Groupe E")), [["Mexico", 1, 4, false], ["Ireland", 2, 4, false], ["Italy", 3, 4, false], ["Norway", 4, 4, false]]);
  // 2018 H: Japan ahead of Senegal on fair play, which the reader does not hold: level, and said so.
  const h = table(await tables("world-cup-history:2018"), "Groupe H");
  assert.deepEqual(ranked(h), [["Colombia", 1, 6, false], ["Japan", 2, 4, true], ["Senegal", 2, 4, true], ["Poland", 4, 3, false]]);
  assert.equal(h.unresolved, true);
  assert.deepEqual(ranked(table(await tables("world-cup-history:1982"), "Groupe 1")), [["Poland", 1, 4, false], ["Italy", 2, 3, false], ["Cameroon", 3, 3, false], ["Peru", 4, 2, false]]);
});

test("34m. Euro 1992: two points a win (UEFA: Sweden, two wins and a draw, five points)", () => {
  const g = (date, team1, team2, a, b) => ({ round: "Matchday", group: "Group 1", date, team1, team2, score: { ft: [a, b] } });
  const rows = normalizeOpenCup([
    g("1992-06-10", "Sweden", "France", 1, 1), g("1992-06-11", "Denmark", "England", 0, 0), g("1992-06-14", "France", "England", 0, 0),
    g("1992-06-14", "Sweden", "Denmark", 1, 0), g("1992-06-17", "Sweden", "England", 2, 1), g("1992-06-17", "Denmark", "France", 2, 1),
  ]);
  assert.deepEqual(ranked(groupTables(rows, { competition: "euro", season: "1992", today: TODAY })[0]),
    [["Sweden", 1, 5, false], ["Denmark", 2, 3, false], ["France", 3, 2, true], ["England", 3, 2, true]]);
});

test("34n–34p. Euro 2028's groups by their round; a rule unknown; a canceled match", async () => {
  const euro2028 = await tables("euro:2028");
  assert.deepEqual(euro2028.map((t) => t.name), ["Groupe A", "Groupe B", "Groupe C", "Groupe D", "Groupe E", "Groupe F"]);
  for (const t of euro2028) {
    assert.equal(t.rows.length, 4, t.name);
    assert.deepEqual(t.rows.map((r) => [r.position, r.played]), [[null, 0], [null, 0], [null, 0], [null, 0]], t.name);
  }
  assert.deepEqual(table(euro2028, "Groupe A").rows.map((r) => r.name).sort(), ["A1", "A2", "A3", "A4"]);
  // No edition, no rule: no position and no points.
  const anyGroup = groupTables(await edition("world-cup-history:1998")).find((t) => t.name === "Groupe C");
  assert.deepEqual(anyGroup.rows.map((r) => [r.position, r.points]), [[null, null], [null, null], [null, null], [null, null]]);
  // A match the source canceled is neither played nor a missing result.
  const g = (team1, team2, score, extra = {}) => ({ round: "Matchday 1", group: "Group A", date: "1998-06-10", team1, team2, ...(score ? { score: { ft: score } } : {}), ...extra });
  const canceled = normalizeOpenCup([g("A", "B", [2, 0]), g("C", "D", null, { status: "canceled" }), g("A", "C", [1, 0]), g("B", "D", [1, 1]), g("A", "D", [3, 0]), g("B", "C", [0, 0])]);
  assert.equal(canceled[1].status, "canceled");
  assert.deepEqual(ranked(groupTables(canceled, { competition: "world-cup-history", season: "1998", today: TODAY })[0]),
    [["A", 1, 9, false], ["B", 2, 2, false], ["C", 3, 1, false], ["D", 4, 1, false]]);
});

test("34x, 34y. a run without rounds has no phase and no gauge; the gauges of the new stages", () => {
  const { runDepth, runStage, runsByTournament } = runs;
  assert.equal(typeof runStage, "function", "runStage");
  const noRound = { tournament: "copa-america", label: "Copa América 2024", year: 2024, stage: "1er tour", matches: 6, games: [{ round: null }, { round: null }] };
  assert.equal(runStage(noRound), "Phase non renseignée");
  assert.equal(runDepth(noRound), 0);
  const known = { tournament: "world-cup", label: "Coupe du monde 2010", year: 2010, stage: "1er tour", matches: 3, games: [{ round: "Matchday 2" }, { round: null }] };
  assert.equal(runStage(known), "1er tour");
  assert.equal(runDepth(known), 1);
  assert.deepEqual(["Poule finale", "2e", "Phase non renseignée", "Tour inconnu", undefined].map((stage) => runDepth({ stage })), [4, 5, 0, 0, 0]);
  // A medal from an API that claimed one for a run with no round would not be counted.
  assert.deepEqual(runsByTournament([{ ...noRound, stage: "Vainqueur", tone: "gold" }])[0].medals, { gold: 0, silver: 0, bronze: 0 });
});

test("34z, 34aa. a run links only to an edition the site holds, on a view that edition has", () => {
  const { tournamentEdition, WORLD_CUP_ID, WORLD_CUP_ARCHIVE_ID } = catalog;
  assert.equal(tournamentEdition("world-cup", 2021), null);
  assert.equal(tournamentEdition("world-cup", 2030), null);
  assert.deepEqual(tournamentEdition("world-cup", 2026), { id: WORLD_CUP_ID, edition: "2026" });
  assert.deepEqual(tournamentEdition("world-cup", 1950), { id: WORLD_CUP_ARCHIVE_ID, edition: "1950" });
  assert.equal(typeof catalog.editionView, "function", "editionView");
  const view = (tournament, year) => catalog.editionView(tournamentEdition(tournament, year));
  assert.deepEqual([view("copa-america", 2024), view("afcon", 2023), view("asian-cup", 2023), view("gold-cup", 2023)], ["matchs", "matchs", "matchs", "matchs"]);
  assert.deepEqual([view("world-cup", 1950), view("world-cup", 1998), view("world-cup", 2022), view("euro", 2024)], ["groupes", "tableau", "tableau", "tableau"]);
});

test("34ae. a national team's French name finds its matches, as its source name does", async () => {
  const rows = await edition("world-cup-history:1982");
  const finals = (query, label) => filterCupMatches(rows, "all", query, NOW, label).filter((m) => m.roundName === "Final").map((m) => m.home + "–" + m.away);
  assert.deepEqual(finals("Italie", nationalFlags.nationalTeamLabel), ["Italy–West Germany"]);
  assert.deepEqual(finals("Italy", nationalFlags.nationalTeamLabel), ["Italy–West Germany"]);
  assert.deepEqual(finals("Allemagne de l’Ouest", nationalFlags.nationalTeamLabel), ["Italy–West Germany"]);
  // Without a label (a club cup), the names as they are.
  assert.deepEqual(finals("Italy"), ["Italy–West Germany"]);
  assert.deepEqual(finals("Italie"), []);
});

test("34af. a match the source canceled reads « Annulé », never upcoming or a missing score", async () => {
  const rows = await edition("world-cup-history:1938");
  const sweden = rows.find((m) => m.home === "Sweden" && m.away === "Austria");
  assert.equal(sweden.status, "canceled");
  assert.equal(filterCupMatches(rows, "scheduled", "", NOW).some((m) => m === sweden), false);
  assert.equal(filterCupMatches(rows, "all", "", NOW).includes(sweden), true);
  const { CupMatchList } = await cupComponent();
  const html = render(CupMatchList, { matches: [sweden], status: "all", query: "", page: 1, onPage: () => {}, nationalTeams: true, season: "1938" });
  assert.match(html, /Annulé/);
  assert.doesNotMatch(html, /À venir/);
});

test("34ag. a replayed tie shows its replay and carries the replay's identity, the first match kept apart", () => {
  const merged = bracket.mergeCupReplays([
    { key: "a", id: "m_first", roundName: "Quarter-finals", date: "1934-05-31", home: "Italy", away: "Spain", score: [1, 1], status: "finished", notes: ["après prolongation"] },
    { key: "b", id: "m_replay", roundName: "Quarter-finals, Replays", date: "1934-06-01", home: "Spain", away: "Italy", score: [0, 1], status: "finished", notes: [] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].id, merged[0].date, merged[0].score, merged[0].home], ["m_replay", "1934-06-01", [1, 0], "Italy"]);
  assert.deepEqual(merged[0].replayOf, { id: "m_first", date: "1934-05-31", score: [1, 1] });
});

const ARCHIVE = { id: "open-cup:world-cup-history", name: "Coupe du monde — archives", country: "INT", source: "openfootball", sourceKey: "world-cup-history",
  seasons: ["2026", "2022", "2018", "1998", "1982", "1958", "1954", "1950", "1938"], defaultSeason: "2018" };

test("34ab. 1950's page opens on its groups, without a bracket; the shared positions are said", async () => {
  const CupCompetition = (await cupComponent({ matches: await edition("world-cup-history:1950") })).default;
  const html = render(CupCompetition, { competition: ARCHIVE, initialSeason: "1950", initialView: "bracket" });
  assert.doesNotMatch(html, /data-view="bracket"/);
  assert.doesNotMatch(html, /Tableau éliminatoire/);
  assert.match(html, /Poule finale/);
  // Group 2's three teams level on two points: « 2= », the tie-break unavailable.
  assert.equal((html.match(/>2=</g) || []).length, 3);
  assert.match(html, /title="Départage indisponible"/);
  // 1998 keeps its bracket first.
  const CupCompetition1998 = (await cupComponent({ matches: await edition("world-cup-history:1998") })).default;
  const html1998 = render(CupCompetition1998, { competition: ARCHIVE, initialSeason: "1998", initialView: "" });
  assert.match(html1998, /data-view="bracket"/);
  assert.match(html1998, /Tableau éliminatoire/);
});
