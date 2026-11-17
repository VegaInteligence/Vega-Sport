import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenCupText } from "../dashboard/frontend/src/services/openfootball-cups.js";
import { combineCupLegs, buildKnockoutBracket } from "../dashboard/frontend/src/services/knockout-bracket.js";
import { normalizeOpenCup } from "../dashboard/frontend/src/services/cup-matches.js";
import { normalizeOpenLigaMatches } from "../dashboard/frontend/src/services/openligadb.js";
import { nationsStandings } from "../dashboard/frontend/src/services/nations-standings.js";

const team = (id, name, shortName = "") => ({ teamId: id, teamName: name, shortName });
const sourceMatch = (id, group, home, away, score, type = 2) => ({ matchID: id, matchDateTime: "2026-10-01T20:45:00", group: { groupName: group, groupOrderID: 1 }, team1: home, team2: away, matchIsFinished: Boolean(score), matchResults: score ? [{ resultTypeID: type, pointsTeam1: score[0], pointsTeam2: score[1] }] : [] });

test("archive parser preserves shootouts, extra time and an unscored final", () => {
  const text = "# Matches 3\n▪ Round of 16\nFri Jan 10 2025\n  20:00  A   v B   5-4 pen. 1-1 a.e.t. (1-1, 0-0)\n▪ Semifinals\nSat Feb 1\n  20:00  A   v C   2-1 a.e.t. (1-1)\n▪ Final\nSun May 4\n  15:00  A   v D\n";
  const rows = parseOpenCupText(text, 2024);
  assert.deepEqual(rows[0].score, { ft: [1, 1], p: [5, 4], et: [1, 1] });
  // After extra time 2–1; the brackets give the 90 minutes, 1–1 (FAILURE_MODES.md §19, 19z).
  assert.deepEqual(rows[1].score, { ft: [1, 1], et: [2, 1] });
  assert.equal(rows[2].score, undefined);
  assert.throws(() => parseOpenCupText(text.replace("# Matches 3", "# Matches 4"), 2024), /Incomplete/);
});

test("cup semi-finals combine two legs and keep penalties separate", () => {
  const rows = normalizeOpenCup([
    { round: "Semifinals", date: "2025-04-01", team1: "A", team2: "B", score: { ft: [1, 0] } },
    { round: "Semifinals", date: "2025-04-08", team1: "B", team2: "A", score: { ft: [1, 0], p: [3, 4] } },
  ]);
  const [tie] = combineCupLegs(rows);
  assert.deepEqual(tie.score, [1, 1]);
  assert.deepEqual(tie.penalties, [4, 3]);
  assert.deepEqual(tie.legs.map((leg) => leg.score), [[1, 0], [0, 1]]);
  assert.equal(buildKnockoutBracket([tie]).rounds[0].matches.length, 1);
});

test("OpenLigaDB separates penalties and translates national teams", () => {
  const france = team(1, "Frankreich", "FRA"), italy = team(2, "Italien", "ITA");
  const row = sourceMatch(7, "Gruppe A", france, italy, [1, 1]);
  row.matchResults.push({ resultTypeID: 4, resultTypeKind: "AfterExtraTime", pointsTeam1: 2, pointsTeam2: 2 }, { resultTypeID: 5, resultTypeKind: "AfterPenalties", pointsTeam1: 4, pointsTeam2: 3 });
  const [result] = normalizeOpenLigaMatches([row], "nations-league");
  assert.equal(result.home, "France"); assert.equal(result.away, "Italie");
  assert.deepEqual(result.score, [2, 2]); assert.deepEqual(result.penalties, [4, 3]); assert.equal(result.group, 1);
  const future = sourceMatch(8, "Achtelfinale", france, italy, null);
  const [cup] = normalizeOpenLigaMatches([future], "germany-cup");
  assert.equal(cup.roundName, "Round of 16"); assert.equal(cup.score, null);
});

test("Nations League groups use points and head-to-head before overall goal difference", () => {
  const a = team(1, "A"), b = team(2, "B"), c = team(3, "C"), d = team(4, "D");
  const raw = [sourceMatch(1,"Gruppe A",a,b,[1,0]),sourceMatch(2,"Gruppe A",a,c,[0,4]),sourceMatch(3,"Gruppe A",b,c,[6,0]),sourceMatch(4,"Gruppe A",c,d,[1,0])];
  const rows = nationsStandings(normalizeOpenLigaMatches(raw, "nations-league"))[0].rows;
  assert.deepEqual(rows.map((row) => row.name), ["C", "A", "B", "D"]);
  assert.equal(rows[1].points, 3); assert.equal(rows[2].difference, 5);
});

test("Nations results cover other leagues without assigning teams to the wrong group", async () => {
  const { parseNationsResults } = await import("../dashboard/frontend/src/services/nations-results.js");
  const csv = "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral\n2026-09-26,Scotland,Switzerland,0,3,UEFA Nations League,\"Glasgow, Scotland\",Scotland,FALSE\n2026-09-27,Austria,Kosovo,2,1,UEFA Nations League,Vienna,Austria,FALSE\n2026-09-27,Scotland,Austria,1,0,UEFA Nations League,Glasgow,Scotland,FALSE\n";
  const rows = parseNationsResults(csv);
  assert.equal(rows.length, 2); assert.equal(rows[0].league, "B"); assert.equal(rows[0].group, 1); assert.equal(rows[0].home, "Écosse"); assert.deepEqual(rows[0].score, [0, 3]);
  assert.equal(rows[1].group, 3);
  assert.throws(() => parseNationsResults(csv + "2026-09-26,Scotland,Switzerland,0,3,UEFA Nations League,Glasgow,Scotland,FALSE\n"), /Duplicate/);
});

test("the yearly Club World Cups are read from their text files, in the season of their year", async () => {
  // openfootball/club-worldcup, 2021/clubworldcup.txt (CC0): played in February 2022.
  const text = "= Club World Cup 2021\n\n# Date       Thu Feb 3 - Sat Feb 12 2022 (9d)\n# Teams      7\n# Matches    8\n\n\n\n▪ Round 1\n  Thu Feb 3 2022\n    20:30  Al Jazira Club (UAE)    v AS Pirae (TAH)           4-1 (3-0)\n\n\n▪ Round 2\n  Sat Feb 5\n    20:30  Al Ahly SC (EGY)        v CF Monterrey (MEX)       1-0 (0-0)\n  Sun Feb 6\n    20:30  Al Hilal (KSA)          v Al Jazira Club (UAE)     6-1 (2-1)\n\n\n▪ Match 5th place\n  Wed Feb 9\n    17:30  CF Monterrey (MEX)      v Al Jazira Club (UAE)     3-1 (3-0)\n\n\n▪ Semifinals\n  Tue Feb 8\n    20:30  Palmeiras (BRA)         v Al Ahly SC (EGY)         2-0 (1-0)\n  Wed Feb 9\n    20:30  Al Hilal (KSA)          v Chelsea FC (ENG)         0-1 (0-1)\n\n\n▪ Match 3rd place\n  Sat Feb 12\n    17:00  Al Hilal (KSA)          v Al Ahly SC (EGY)         0-4 (0-3)\n\n\n▪ Final\n  Sat Feb 12\n    20:30  Chelsea FC (ENG)        v Palmeiras (BRA)          2-1 a.e.t. (1-1, 0-0)\n";
  const { GET } = await import("../backend/sources/projections/open-cups.mjs");
  const asked = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(text); };
  try {
    const read = async (season) => {
      const response = await GET(new Request("http://bridge/api/open-cups?competition=club-world-cup&season=" + season));
      return [response.status, await response.json()];
    };
    const [status, body] = await read("2021");
    assert.equal(status, 200);
    assert.deepEqual(asked, ["https://raw.githubusercontent.com/openfootball/club-worldcup/master/2021/clubworldcup.txt"]);
    assert.deepEqual([body.name, body.season, body.matches.length, body.source.url], ["Club World Cup 2021", "2021", 8, "https://github.com/openfootball/club-worldcup"]);
    assert.deepEqual(body.matches[0], { round: "Round 1", date: "2022-02-03", team1: "Al Jazira Club (UAE)", team2: "AS Pirae (TAH)", score: { ft: [4, 1] } });
    // Chelsea–Palmeiras, 1–1 after 90 minutes (FAILURE_MODES.md §19, 19z).
    assert.deepEqual(body.matches.at(-1), { round: "Final", date: "2022-02-12", team1: "Chelsea FC (ENG)", team2: "Palmeiras (BRA)", score: { ft: [1, 1], et: [2, 1] } });
    // An edition before the base's first season is not read.
    assert.equal((await read("2019"))[0], 400);
    assert.equal(asked.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("the other confederations' club competitions are read from their text files, dated in their own year", async () => {
  // openfootball/south-america, copa-libertadores/2025_copal.txt (CC0): played from February to November.
  const text = "= Copa Libertadores 2025\n\n# Date       Tue Feb 4 - Sat Nov 29 2025 (298d)\n# Teams      4\n# Matches    4\n\n▪ Qualifying, Round 1\n  Tue Feb 4 2025\n    21:30  Monagas SC (VEN)        v Defensor SC (URU)        2-0 (0-0)\n  Thu Feb 13\n    21:30  CSCyD El Nacional (ECU) v CD Blooming (BOL)        4-3 pen. (2-1, 0-1)\n\n▪ Finals, Final\n  Sat Nov 29\n    18:15  SE Palmeiras (BRA)      v CR Flamengo (BRA)        0-1 (0-0)\n  Sun Nov 30\n    18:15  N.N.                    v N.N.\n";
  // A season-long text parse would put February 2025 in 2026; the calendar mode keeps it in its year.
  assert.equal(parseOpenCupText(text, 2025, {}, { calendar: true })[1].date, "2025-02-13");
  assert.throws(() => parseOpenCupText(text.replace("Sun Nov 30", "Sun Nov 30 2026"), 2025, {}, { calendar: true }), /Unexpected/);
  const { GET } = await import("../backend/sources/projections/open-cups.mjs");
  const asked = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(text); };
  try {
    const response = await GET(new Request("http://bridge/api/open-cups?competition=copa-libertadores&season=2025"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(asked, ["https://raw.githubusercontent.com/openfootball/south-america/master/copa-libertadores/2025_copal.txt"]);
    assert.deepEqual([body.name, body.matches.length, body.source.url], ["Copa Libertadores 2025", 4, "https://github.com/openfootball/south-america"]);
    assert.deepEqual(body.matches[1], { round: "Qualifying, Round 1", date: "2025-02-13", team1: "CSCyD El Nacional (ECU)", team2: "CD Blooming (BOL)", score: { ft: [2, 1], p: [4, 3] } });
    // A team still to be decided names nobody.
    assert.deepEqual([body.matches[3].team1, body.matches[3].team2], [null, null]);
    // The African competition is read by its season, from August to May.
    const caf = await GET(new Request("http://bridge/api/open-cups?competition=caf-champions-league&season=2024%2F2025"));
    assert.equal(caf.status, 200);
    // From August to May: November is in the season's first year, February in its second.
    assert.deepEqual((await caf.json()).matches.map((m) => m.date), ["2025-02-04", "2025-02-13", "2024-11-29", "2024-11-30"]);
    assert.equal(asked.at(-1), "https://raw.githubusercontent.com/openfootball/world/master/africa/champions-league/2024-25_cafcl.txt");
    assert.equal((await GET(new Request("http://bridge/api/open-cups?competition=copa-sudamericana&season=2026"))).status, 400);
  } finally {
    globalThis.fetch = original;
  }
});

test("the other confederations' national-team tournaments are read from International Results by name and days", async () => {
  const { parseTournamentResults } = await import("../dashboard/frontend/src/services/nations-results.js");
  const head = "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral\n";
  const csv = head + [
    "2023-11-16,Ivory Coast,Seychelles,9,0,FIFA World Cup qualification,Abidjan,Ivory Coast,FALSE",
    "2024-01-13,Ivory Coast,Guinea-Bissau,2,0,African Cup of Nations,Ebimpé,Ivory Coast,FALSE",
    "2024-01-14,Nigeria,Equatorial Guinea,1,1,African Cup of Nations,Abidjan,Ivory Coast,TRUE",
    "2024-01-14,Japan,Vietnam,4,2,AFC Asian Cup,Doha,Qatar,TRUE",
    "2024-02-11,Ivory Coast,Nigeria,2,1,African Cup of Nations,Ebimpé,Ivory Coast,FALSE",
  ].join("\n") + "\n";
  const rows = parseTournamentResults(csv, "afcon", "2023");
  assert.deepEqual(rows.map((r) => [r.date, r.home, r.away, r.score, r.neutral]), [
    ["2024-01-13", "Ivory Coast", "Guinea-Bissau", [2, 0], false], ["2024-01-14", "Nigeria", "Equatorial Guinea", [1, 1], true], ["2024-02-11", "Ivory Coast", "Nigeria", [2, 1], false],
  ]);
  assert.equal(rows[0].key, "afcon:2024-01-13|Ivory Coast|Guinea-Bissau");
  assert.deepEqual(parseTournamentResults(csv, "asian-cup", "2023").map((r) => r.home), ["Japan"]);
  assert.throws(() => parseTournamentResults(csv, "afcon", "2019"), /Unknown/);
  assert.throws(() => parseTournamentResults(csv + "2024-01-13,Ivory Coast,Guinea-Bissau,2,0,African Cup of Nations,Ebimpé,Ivory Coast,FALSE\n", "afcon", "2023"), /Duplicate/);
  const { GET } = await import("../backend/sources/projections/nations-results.mjs");
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(csv);
  try {
    const body = await (await GET(new Request("http://bridge/api/nations-results?competition=afcon&season=2023"))).json();
    assert.deepEqual([body.name, body.season, body.matches.length], ["Coupe d’Afrique des nations 2023", "2023", 3]);
    assert.equal((await GET(new Request("http://bridge/api/nations-results?competition=gold-cup&season=2021"))).status, 400);
    // The Nations League keeps its own read.
    assert.equal((await GET(new Request("http://bridge/api/nations-results?season=2026%2F2027"))).status, 502);
  } finally {
    globalThis.fetch = original;
  }
});

test("the confederations' cups' rounds read in French", () => {
  const rows = normalizeOpenCup(["Finals, Final", "Finals, Semifinals", "Finals, Round of 16", "Qualifying, Round 2", "Qual. Round 1", "Preliminary round", "Group, Matchday 3", "Gruppe G", "Playoffs"]
    .map((round, i) => ({ round, date: "2025-03-0" + (i % 9 + 1), team1: "A", team2: "B", score: { ft: [1, 0] } })));
  assert.deepEqual(rows.map((r) => r.round), ["Finale", "Demi-finales", "Huitièmes de finale", "Tour préliminaire 2", "Tour préliminaire 1", "Tour préliminaire",
    "Phase de groupes · Journée 3", "Groupe G", "Barrages"]);
});

// FAILURE_MODES.md §19 (19a, 19f, 19g): openfootball/worldcup.json at 516d3825 (CC0) writes most of
// 1950–2014 and seven 2022 results as arrays, and cancels 1938 Sweden–Austria.
test("the World Cup projection writes array results as objects and keeps the source's status", async () => {
  const { GET } = await import("../backend/sources/projections/open-cups.mjs");
  const original = globalThis.fetch;
  const read = async (season, matches) => {
    globalThis.fetch = async () => Response.json({ name: "World Cup " + season, matches });
    const response = await GET(new Request("http://bridge/api/open-cups?competition=world-cup-history&season=" + season));
    return [response.status, await response.json()];
  };
  try {
    const [status, body] = await read("1938", [
      { round: "First round", date: "1938-06-05", team1: "Sweden", team2: "Austria", status: "canceled" },
      { round: "First round", date: "1938-06-05", team1: "France", team2: "Belgium", score: { ft: [3, 1], ht: [2, 1] } },
    ]);
    assert.equal(status, 200);
    assert.deepEqual(body.matches, [
      { round: "First round", date: "1938-06-05", team1: "Sweden", team2: "Austria", status: "canceled" },
      { round: "First round", date: "1938-06-05", team1: "France", team2: "Belgium", score: { ft: [3, 1], ht: [2, 1] } },
    ]);
    const [, wc1962] = await read("1962", [{ round: "Matchday 1", group: "Group 1", date: "1962-05-30", team1: "Uruguay", team2: "Colombia", score: [2, 1] }]);
    assert.deepEqual(wc1962.matches[0].score, { ft: [2, 1] });
    const [, wc2022] = await read("2022", [{ round: "Matchday 6", group: "Group B", date: "2022-11-25", team1: "England", team2: "USA", score: [0, 0] }]);
    assert.deepEqual(wc2022.matches[0].score, { ft: [0, 0] });
    // A malformed score makes the edition unreadable, with its code: the last valid one stays.
    for (const score of [[2], [2, -1], [2, 1.5], [true, 0], "2-1", { ft: [1, null] }, { ht: [1, 0] }, { p: [4, 3] }, { ft: [1, 0], x: [0, 0] }]) {
      const [code, failed] = await read("1962", [{ date: "1962-05-30", team1: "Uruguay", team2: "Colombia", score }]);
      assert.equal(code, 502, JSON.stringify(score));
      assert.equal(failed.code, "INVALID_SCORE");
    }
  } finally {
    globalThis.fetch = original;
  }
});

// FAILURE_MODES.md §19 (19z′, 19z″): a score after extra time is never the 90 minutes' too.
test("Football.TXT keeps the 90 minutes apart from extra time", () => {
  const text = "# Matches 4\n▪ Final\nSat May 3 2025\n  20:00  A   v B   2-1 a.e.t.\n  20:00  C   v D   5-4 pen. 1-1 a.e.t. (1-1, 0-0)\nSun May 4\n  20:00  E   v F   4-3 pen. (2-1, 0-1)\n  20:00  G   v H   4-1 (3-0)\n";
  assert.deepEqual(parseOpenCupText(text, 2024).map((row) => row.score), [
    { et: [2, 1] },
    { ft: [1, 1], et: [1, 1], p: [5, 4] },
    { ft: [2, 1], p: [4, 3] },
    { ft: [4, 1] },
  ]);
});
