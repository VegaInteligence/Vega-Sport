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
  assert.deepEqual(rows[1].score, { ft: [2, 1], et: [2, 1] });
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
    assert.deepEqual(body.matches.at(-1), { round: "Final", date: "2022-02-12", team1: "Chelsea FC (ENG)", team2: "Palmeiras (BRA)", score: { ft: [2, 1], et: [2, 1] } });
    // An edition before the base's first season is not read.
    assert.equal((await read("2019"))[0], 400);
    assert.equal(asked.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
