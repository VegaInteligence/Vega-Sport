// Major tournaments (mock-up validated 18 Nov 2026): a nation's runs as tiles that open each edition's page, and a
// bracket that fits one screen, both halves towards the final in the middle.
//
// Failure modes and expected outcomes, written before the code:
//
//  1. The third-place match under each name the archives give it (« Third place match », « Third-place match »,
//     « Third place play-off », « Match for third place »): read as the third-place match. Before: only two names
//     were read, so 1934 and 1978–2010 showed no third-place match.
//  2. 1950's « Final Round » is a group, not a final: never read as the final.
//  3. A replayed tie (« Quarter-finals, Replays », 1934 and 1938): one tie, decided by the replay, in the first
//     match's team order, marked « match rejoué ». A replay without its first match stays out of the bracket.
//  4. 1934 and 1938 name their round of 16 « Preliminary round » and « First round »: a round so named, without groups
//     and with exactly twice the ties of the first named round, is the round before it. 1950's « First round » has
//     groups and the group play-offs of 1954/1958 have one tie each: both stay out.
//  5. A tie without a score (Sweden–Austria 1938, a walkover) still links to the next round when its team plays
//     exactly one match of the round before; two candidates link nothing.
//  6. The two halves: each round's first half on the left and second half on the right, in bracket order, the final
//     alone in the middle; a final with no other round (1974, 1978) is a bracket of its own; rounds whose crossings
//     are unknown, or without a final, are not split (they are listed by round). The champion is the final's winner,
//     by the shoot-out when the score is level; an unplayed or undecided final names nobody.
//  7. An edition's page: the World Cup's archive and its collected editions are one selector, each season leading to
//     the competition that holds it; any other competition offers its own seasons only.
//  8. A run's link: the World Cup by its year (archive up to 2018, collected after), the Euro and the other
//     confederations' tournaments by their edition; a year the site has no page for (Euro 2016) gives no link.
//  9. A run's depth, for its gauge: first round 1, round of 32 or 16: 2, quarter-finals 3, semi-finals and both
//     third-place outcomes 4, final 5, title 6; an unknown stage counts as the first round, never as a title.
// 10. The runs by competition, each with its own medals: a nation's titles are counted in the competition they were
//     won in, so the Euros the base does not hold (before 2020) are never implied by a World Cup's count.
// 11. A national team's name in French whatever the edition's year (the flag alone is withheld before 1994), the home
//     nations and the teams of the past included; a fixture's placeholder (« Winner Match 45 ») is left as it is.
//     The same team under two spellings (« Italy », « Italie ») is one team; two unknown names are compared as text.
// 12. The groups of an edition: one table per group the source names, in order; 1950's final round, which has no
//     group name, is the « Poule finale »; an edition without groups (1934) has no table. A win is worth three
//     points unless the edition says otherwise: two in the World Cups before 1994 (East Germany's 1974 group is won
//     with 5 points, not 7).
// 13. Flags of the old editions (the user, 18 Nov 2026: « n'hésite pas à mettre les drapeaux »; before, an edition
//     earlier than 1994 showed none). A country that exists today has its flag whatever the year. A team of the past
//     has the flag it played under: West Germany's and Czechoslovakia's are their successors', the Dutch East Indies
//     played under the Netherlands'; the Soviet Union, East Germany and Zaire have a drawing of their own; Yugoslavia
//     has the kingdom's plain tricolour in 1930, the star from 1946 to 1991, the plain tricolour again up to 2006
//     (Serbia and Montenegro too) and none after, nor without a year (which flag is not known). A placeholder or an
//     unknown name has none. Every code the archives' teams get has an image: the flag library's, or the site's own
//     style, never an empty box.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { groupTables, normalizeOpenCup } from "../dashboard/frontend/src/services/cup-matches.js";
import { bracketSides, buildKnockoutBracket, knockoutStage, mergeCupReplays } from "../dashboard/frontend/src/services/knockout-bracket.js";
import { WORLD_CUP_ARCHIVE_ID, WORLD_CUP_ID, competitionEditions, tournamentEdition } from "../dashboard/frontend/src/services/cup-catalog.js";
import { runDepth, runsByTournament } from "../dashboard/frontend/src/services/tournament-runs.js";
import { nationalFlagCode, nationalTeamLabel, nationalTeamName, sameNationalTeam } from "../dashboard/frontend/src/services/national-flags.js";

const open = (round, team1, team2, score, extra = {}) => ({ round, team1, team2, ...(score ? { score } : {}), ...extra });
const ft = (a, b) => ({ ft: [a, b] });

test("1, 2. the third-place match under every archive name; 1950's final round is no final", () => {
  for (const name of ["Third place match", "Third-place match", "Third place play-off", "Third-place play-off", "Match for third place", "Third place", "Bronze"])
    assert.equal(knockoutStage(name), "third", name);
  assert.equal(knockoutStage("Final Round"), null);
  assert.equal(knockoutStage("Final"), "final");
  assert.equal(knockoutStage("Quarter-finals, Replays"), null);
});

test("3. a replayed tie is one tie, decided by its replay", () => {
  const rows = normalizeOpenCup([
    open("Quarter-finals", "Italy", "Spain", { ft: [1, 1], et: [1, 1] }, { date: "1934-05-31" }),
    open("Quarter-finals", "Austria", "Hungary", ft(2, 1), { date: "1934-05-31" }),
    // The replay with the teams the other way round.
    open("Quarter-finals, Replays", "Spain", "Italy", ft(0, 1), { date: "1934-06-01" }),
    // A replay whose first match the source does not hold.
    open("Quarter-finals, Replays", "Sweden", "Germany", ft(1, 2), { date: "1934-06-01" }),
  ]);
  const merged = mergeCupReplays(rows);
  assert.equal(merged.length, 3);
  const tie = merged.find((m) => m.home === "Italy");
  assert.deepEqual(tie.score, [1, 0]);
  assert.equal(tie.date, "1934-06-01");
  assert.ok(tie.notes.includes("match rejoué"));
  assert.equal(merged.find((m) => m.home === "Sweden").roundName, "Quarter-finals, Replays");
  assert.equal(buildKnockoutBracket(rows).rounds[0].matches.length, 2);
});

test("4, 5. 1934's preliminary round is its round of 16; a tie without a score still links", () => {
  const first = [["Italy", "USA", 7, 1], ["Spain", "Brazil", 3, 1], ["Austria", "France", 3, 2], ["Hungary", "Egypt", 4, 2], ["Czechoslovakia", "Romania", 2, 1], ["Switzerland", "Netherlands", 3, 2], ["Germany", "Belgium", 5, 2]];
  const rows = normalizeOpenCup([
    ...first.map(([a, b, x, y]) => open("Preliminary round", a, b, ft(x, y))),
    open("Preliminary round", "Sweden", "Argentina"), // no score: the team alone links it
    open("Quarter-finals", "Italy", "Spain", ft(1, 0)),
    open("Quarter-finals", "Austria", "Hungary", ft(2, 1)),
    open("Quarter-finals", "Czechoslovakia", "Switzerland", ft(3, 2)),
    open("Quarter-finals", "Germany", "Sweden", ft(2, 1)),
    open("Semi-finals", "Italy", "Austria", ft(1, 0)),
    open("Semi-finals", "Czechoslovakia", "Germany", ft(3, 1)),
    open("Third-place match", "Germany", "Austria", ft(3, 2)),
    open("Final", "Italy", "Czechoslovakia", { ft: [1, 1], et: [2, 1] }),
  ]);
  const bracket = buildKnockoutBracket(rows);
  assert.deepEqual(bracket.rounds.map((r) => [r.key, r.matches.length]), [["round16", 8], ["quarter", 4], ["semi", 2], ["final", 1]]);
  assert.equal(bracket.connected, true);
  assert.deepEqual(bracket.rounds[0].matches.slice(0, 2).map((m) => m.home), ["Italy", "Spain"]);
  assert.equal(bracket.thirdPlace.length, 1);
  // A first round played in groups (1950) and a one-tie play-off (1954) stay out.
  const grouped = normalizeOpenCup([
    ...first.map(([a, b, x, y]) => open("First round", a, b, ft(x, y), { group: "Group 1" })),
    open("First round", "Sweden", "Argentina", ft(1, 0), { group: "Group 2" }),
    open("Group 2 Play-off", "Italy", "Spain", ft(1, 0)),
    open("Quarter-finals", "Italy", "Spain", ft(1, 0)), open("Quarter-finals", "Austria", "Hungary", ft(2, 1)),
    open("Quarter-finals", "Czechoslovakia", "Switzerland", ft(3, 2)), open("Quarter-finals", "Germany", "Sweden", ft(2, 1)),
  ]);
  assert.deepEqual(buildKnockoutBracket(grouped).rounds.map((r) => r.key), ["quarter"]);
  // Two unplayed ties with the same team name link nothing.
  const ambiguous = buildKnockoutBracket(normalizeOpenCup([
    open("Semi-finals", "A", "B"), open("Semi-finals", "A", "C"), open("Final", "A", "C"),
  ]));
  assert.equal(ambiguous.connected, false);
});

test("6. the two halves towards the final, and the champion", () => {
  const rows = normalizeOpenCup([
    open("Quarter-finals", "Spain", "Germany", ft(2, 1)), open("Quarter-finals", "Portugal", "France", { ft: [0, 0], et: [0, 0], p: [3, 5] }),
    open("Quarter-finals", "England", "Switzerland", { ft: [1, 1], et: [1, 1], p: [5, 3] }), open("Quarter-finals", "Netherlands", "Turkey", ft(2, 1)),
    open("Semi-finals", "Spain", "France", ft(2, 1)), open("Semi-finals", "Netherlands", "England", ft(1, 2)),
    open("Final", "Spain", "England", ft(2, 1)), open("Third place play-off", "France", "Netherlands", ft(1, 0)),
  ]);
  const sides = bracketSides(buildKnockoutBracket(rows));
  assert.equal(sides.half, 2);
  assert.deepEqual(sides.rounds.map((r) => [r.key, r.left.map((m) => m.home), r.right.map((m) => m.home)]), [
    ["quarter", ["Spain", "Portugal"], ["Netherlands", "England"]],
    ["semi", ["Spain"], ["Netherlands"]],
  ]);
  assert.equal(sides.final.home, "Spain");
  assert.equal(sides.champion, "Spain");
  assert.equal(sides.third.home, "France");
  // A final decided by the shoot-out; an unplayed final names nobody.
  const shootout = bracketSides(buildKnockoutBracket(normalizeOpenCup([open("Final", "Argentina", "France", { ft: [2, 2], et: [3, 3], p: [4, 2] })])));
  assert.deepEqual([shootout.half, shootout.rounds.length, shootout.champion], [1, 0, "Argentina"]);
  assert.equal(bracketSides(buildKnockoutBracket(normalizeOpenCup([open("Final", "Winner Match 49", "Winner Match 50")]))).champion, null);
  // Unknown crossings, or no final: listed by round, not split.
  assert.equal(bracketSides(buildKnockoutBracket(normalizeOpenCup([open("Semi-finals", "A", "B", ft(1, 0)), open("Semi-finals", "C", "D", ft(1, 0)), open("Final", "E", "F", ft(1, 0))]))), null);
  assert.equal(bracketSides(buildKnockoutBracket(normalizeOpenCup([open("Quarter-finals", "A", "B", ft(1, 0)), open("Quarter-finals", "C", "D", ft(1, 0)), open("Semi-finals", "A", "C", ft(1, 0))]))), null);
  assert.equal(bracketSides(buildKnockoutBracket([])), null);
});

test("7. the World Cup's editions are one selector over two competitions", () => {
  const native = { id: WORLD_CUP_ID, name: "Coupe du monde", seasons: ["2026", "2022"] };
  const archive = { id: WORLD_CUP_ARCHIVE_ID, name: "Coupe du monde — archives", seasons: ["2018", "2014", "1930"] };
  const euro = { id: "open-cup:euro", seasons: ["2028", "2024", "2020"] };
  const catalog = [native, archive, euro];
  const expected = [["2026", WORLD_CUP_ID], ["2022", WORLD_CUP_ID], ["2018", WORLD_CUP_ARCHIVE_ID], ["2014", WORLD_CUP_ARCHIVE_ID], ["1930", WORLD_CUP_ARCHIVE_ID]];
  assert.deepEqual(competitionEditions(native, catalog).map((e) => [e.season, e.id]), expected);
  assert.deepEqual(competitionEditions(archive, catalog).map((e) => [e.season, e.id]), expected);
  assert.deepEqual(competitionEditions(euro, catalog).map((e) => [e.season, e.id]), [["2028", "open-cup:euro"], ["2024", "open-cup:euro"], ["2020", "open-cup:euro"]]);
  // The archive alone (the collected World Cup not in the catalogue yet): its own seasons.
  assert.deepEqual(competitionEditions(archive, [archive]).map((e) => e.season), ["2018", "2014", "1930"]);
  assert.deepEqual(competitionEditions(null, catalog), []);
});

test("8. a run's edition page, or none", () => {
  assert.deepEqual(tournamentEdition("world-cup", 2026), { id: WORLD_CUP_ID, edition: "2026" });
  assert.deepEqual(tournamentEdition("world-cup", 2022), { id: WORLD_CUP_ID, edition: "2022" });
  assert.deepEqual(tournamentEdition("world-cup", 2018), { id: WORLD_CUP_ARCHIVE_ID, edition: "2018" });
  assert.deepEqual(tournamentEdition("world-cup", 1930), { id: WORLD_CUP_ARCHIVE_ID, edition: "1930" });
  assert.equal(tournamentEdition("world-cup", 1942), null);
  assert.deepEqual(tournamentEdition("euro", 2024), { id: "open-cup:euro", edition: "2024" });
  assert.equal(tournamentEdition("euro", 2016), null);
  assert.deepEqual(tournamentEdition("afcon", 2025), { id: "nations-results:afcon", edition: "2025" });
  assert.deepEqual(tournamentEdition("copa-america", 2024), { id: "nations-results:copa-america", edition: "2024" });
  assert.equal(tournamentEdition("olympics", 2024), null);
  assert.equal(tournamentEdition("euro", null), null);
});

test("9, 10. a run's depth, and the runs by competition with their own medals", () => {
  const depth = (stage) => runDepth({ stage });
  assert.deepEqual(["1er tour", "16es", "8es", "Quarts", "Demi", "3e", "4e", "Match 3e place", "Finale", "Finaliste", "Vainqueur"].map(depth), [1, 2, 2, 3, 4, 4, 4, 4, 5, 5, 6]);
  assert.equal(depth("Tour inconnu"), 1);
  assert.equal(depth(undefined), 1);
  const run = (tournament, label, year, stage, tone) => ({ tournament, label: `${label} ${year}`, year, stage, ...(tone ? { tone } : {}) });
  const groups = runsByTournament([
    run("world-cup", "Coupe du monde", 1998, "Vainqueur", "gold"), run("world-cup", "Coupe du monde", 2006, "Finaliste", "silver"),
    run("euro", "Euro", 2020, "8es"), run("world-cup", "Coupe du monde", 2018, "Vainqueur", "gold"),
    run("euro", "Euro", 2024, "Demi"), run("world-cup", "Coupe du monde", 1986, "3e", "bronze"), run("afcon", "CAN", 2023, "Vainqueur", "gold"),
  ]);
  assert.deepEqual(groups.map((g) => [g.tournament, g.label, g.runs.map((r) => r.year), g.medals]), [
    ["world-cup", "Coupe du monde", [1986, 1998, 2006, 2018], { gold: 2, silver: 1, bronze: 1 }],
    ["euro", "Euro", [2020, 2024], { gold: 0, silver: 0, bronze: 0 }],
    ["afcon", "CAN", [2023], { gold: 1, silver: 0, bronze: 0 }],
  ]);
  assert.deepEqual(runsByTournament([]), []);
  assert.deepEqual(runsByTournament(undefined), []);
});

test("11. a national team's French name whatever the year, and one team under two spellings", () => {
  assert.equal(nationalTeamLabel("Brazil"), "Brésil");
  assert.equal(nationalTeamLabel("Germany"), "Allemagne");
  assert.equal(nationalTeamLabel("England"), "Angleterre");
  assert.equal(nationalTeamLabel("Northern Ireland"), "Irlande du Nord");
  assert.equal(nationalTeamLabel("Italie"), "Italie");
  assert.equal(nationalTeamLabel("West Germany"), "Allemagne de l’Ouest");
  assert.equal(nationalTeamLabel("Soviet Union"), "URSS");
  assert.equal(nationalTeamLabel("Czechoslovakia"), "Tchécoslovaquie");
  assert.equal(nationalTeamLabel("Yugoslavia"), "Yougoslavie");
  assert.equal(nationalTeamLabel("DR Congo"), "RD Congo");
  assert.equal(nationalTeamLabel("Winner Match 45"), "Winner Match 45");
  assert.equal(nationalTeamLabel(""), "");
  assert.equal(sameNationalTeam("Italy", "Italie"), true);
  assert.equal(sameNationalTeam("France", "france"), true);
  assert.equal(sameNationalTeam("West Germany", "West Germany"), true);
  assert.equal(sameNationalTeam("West Germany", "Germany"), false);
  assert.equal(sameNationalTeam("France", "Spain"), false);
  assert.equal(sameNationalTeam("", "France"), false);
  assert.equal(sameNationalTeam("France", undefined), false);
});

test("12. the groups of an edition, 1950's final round included", () => {
  const rows = normalizeOpenCup([
    open("Matchday 1", "France", "Mexico", ft(4, 1), { group: "Group 1" }), open("Matchday 2", "Argentina", "France", ft(1, 0), { group: "Group 1" }),
    open("Matchday 1", "Brazil", "Bolivia", ft(4, 0), { group: "Group 2" }),
    open("Final Round", "Uruguay", "Brazil", ft(2, 1)), open("Final Round", "Sweden", "Spain", ft(3, 1)),
    open("Semi-finals", "Argentina", "USA", ft(6, 1)),
  ]);
  assert.equal(rows[0].group, "Group 1");
  const tables = groupTables(rows);
  assert.deepEqual(tables.map((t) => t.name), ["Groupe 1", "Groupe 2", "Poule finale"]);
  assert.deepEqual(tables[0].rows.map((r) => [r.name, r.points]), [["France", 3], ["Argentina", 3], ["Mexico", 0]]);
  assert.deepEqual(tables[2].rows.map((r) => r.name), ["Sweden", "Uruguay", "Brazil", "Spain"]);
  // A win was worth two points in the World Cups before 1994: the page says which rule the edition played under.
  assert.deepEqual(groupTables(rows, { win: 2 })[0].rows.map((r) => [r.name, r.points]), [["France", 2], ["Argentina", 2], ["Mexico", 0]]);
  assert.deepEqual(groupTables(normalizeOpenCup([open("Quarter-finals", "Italy", "Spain", ft(1, 0))])), []);
  assert.deepEqual(groupTables(undefined), []);
});

test("13. the flags of the old editions", () => {
  const flag = (name, year) => nationalFlagCode(name, year);
  assert.deepEqual([flag("Spain", "1950"), flag("Brazil", "1958"), flag("France", "1930"), flag("Netherlands", "1974"), flag("Germany", "1938"), flag("England", "1966")], ["es", "br", "fr", "nl", "de", "gb-eng"]);
  assert.deepEqual([flag("West Germany", "1974"), flag("Czechoslovakia", "1962"), flag("Dutch East Indies", "1938")], ["de", "cz", "nl"]);
  assert.deepEqual([flag("Soviet Union", "1966"), flag("East Germany", "1974"), flag("Zaire", "1974")], ["su", "dd", "zr"]);
  assert.deepEqual(["1930", "1950", "1990", "1998", "2018", ""].map((year) => flag("Yugoslavia", year)), ["yu-1992", "yu-1946", "yu-1946", "yu-1992", null, null]);
  assert.deepEqual([flag("Serbia and Montenegro", "2006"), flag("Serbia and Montenegro", "2010")], ["yu-1992", null]);
  assert.deepEqual([flag("Winner Match 45", "2028"), flag("Unknown", "1954"), flag("", "1954")], [null, null, null]);
  // A team of the past keeps its own name and is not its successor.
  assert.equal(nationalTeamLabel("West Germany"), "Allemagne de l’Ouest");
  assert.equal(sameNationalTeam("West Germany", "Germany"), false);
  // Its flag's code is its successor's: the name read through the flag (the match pages) must not become « Allemagne ».
  assert.equal(nationalTeamName("West Germany", "1974"), "Allemagne de l’Ouest");
  assert.equal(nationalTeamName("Czechoslovakia", "1962"), "Tchécoslovaquie");
  assert.equal(nationalTeamName("Spain", "1950"), "Espagne");
  // Every code has an image.
  const root = new URL("../dashboard/", import.meta.url);
  const css = fs.readFileSync(new URL("frontend/src/competition-selector.css", root), "utf8");
  const teams = ["Spain", "West Germany", "East Germany", "Soviet Union", "Czechoslovakia", "Yugoslavia", "Zaire", "Dutch East Indies", "Serbia and Montenegro", "Northern Ireland", "Wales", "Cuba", "Haiti", "Kuwait", "North Korea", "Israel", "El Salvador", "Bulgaria"];
  for (const name of teams) for (const year of ["1930", "1958", "1974", "1990", "2006"]) {
    const code = flag(name, year);
    if (!code) continue;
    const drawn = css.includes(`.fi.national-flag.fi-${code} {`);
    assert.ok(drawn || fs.existsSync(new URL(`node_modules/flag-icons/flags/4x3/${code}.svg`, root)), `${name} ${year}: ${code} has no image`);
  }
});
