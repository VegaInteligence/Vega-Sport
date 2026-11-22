// The Euros of 1960 to 2016, read from openfootball/euro's text files (CC0), written before the reader.
//
// Failure modes and expected outcomes:
// - Six layouts across the editions: "T1 v T2 score" (1960–1968); a date/time/venue line, then "T1 score T2"
//   (1976–1980); date, time, match and venue on one line (1984–1992); date, venue first, then the match
//   (1996–2000); a time with its local time "(19:00 EEST)" (2012); abbreviated months (2008, 2016).
//   Each gives the same row: {round, date, team1, team2, score[, group]}.
// - Scores: "2-1 a.e.t." → et only (the 90-minute score is not written); "2-2 a.e.t., 5-3 pen.",
//   "(aet, 4-2 pen)" and "4-2 pen. 0-0 a.e.t. (0-0)" → et and p, ft when written in brackets;
//   "(aet/gg)", "(aet/sg)" → et; "1-1 (9-8 pen)" → ft and p, no extra time.
// - A venue never names a team ("@ Paris (Stade de France)"); a time is never a score.
// - Skipped: comments, scorers in brackets, line-ups ("Netherlands: Schrijvers, …"), penalty sequences
//   ("2-1 Nehoda, 2-2 Flohe"), group listings ("Group A | …"), "▪ Matchday 1 | …" (the round stays).
// - A weekday of two letters ("Th Jun 19", 2008) is a date.
// - Two group matches the 2016 file dates 21 June were played on 22 June (Italy–Ireland, Sweden–Belgium):
//   corrected; every other match agrees with International Results (284 of 286, checked 22 Nov 2026).
// - "Final, Replay" is a final (the nation page's stage reads "Final").
// - A match before any date, a team that is not a name, or a count other than the edition's real number
//   of matches throws: the base reads a whole edition or nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { EURO_HISTORY_MATCHES, parseEuroText } from "../dashboard/frontend/src/services/openfootball-euro.js";

test("each edition's real number of matches is known", () => {
  assert.deepEqual(EURO_HISTORY_MATCHES, {
    1960: 4, 1964: 4, 1968: 5, 1972: 4, 1976: 4, 1980: 14, 1984: 15, 1988: 15,
    1992: 15, 1996: 31, 2000: 31, 2004: 31, 2008: 31, 2012: 31, 2016: 51,
  });
});

test("1960–1968: T1 v T2 score, with extra time and a replayed final", () => {
  const text = [
    "= Euro 1968      # Italy, June 5-10",
    "# All times are local, CET (UTC+1).",
    "▪ Semi-finals",
    "June 5 ",
    "  18:00      Italy   v Soviet Union   0-0 a.e.t.   @ Stadio San Paolo, Naples",
    "                 (Vincent 12' Heutte 43', 62' Wisniewski 53'; ",
    "  21:15     Yugoslavia   v England   1-0       @ Stadio Comunale, Florence",
    "▪ Third place play-off",
    "June 8 ",
    "  15:00   England    v Soviet Union  2-0     @ Stadio Olimpico, Rome",
    "▪ Final",
    "June 8 ",
    "  21:15    Italy   v Yugoslavia   1-1 a.e.t.   @ Stadio Olimpico, Rome",
    "▪ Final, Replay",
    "June 10 ",
    "  21:15   Italy   v Yugoslavia   2-0      @ Stadio Olimpico, Rome",
  ].join("\n");
  const rows = parseEuroText(text, 1968);
  assert.deepEqual(rows[0], { round: "Semi-finals", date: "1968-06-05", team1: "Italy", team2: "Soviet Union", score: { et: [0, 0] } });
  assert.deepEqual(rows[1], { round: "Semi-finals", date: "1968-06-05", team1: "Yugoslavia", team2: "England", score: { ft: [1, 0] } });
  assert.deepEqual(rows.slice(3).map((r) => [r.round, r.date, r.score]), [
    ["Final", "1968-06-08", { et: [1, 1] }],
    ["Final", "1968-06-10", { ft: [2, 0] }],
  ]);
});

test("1976–1980: a date line, then T1 score T2; line-ups and penalty sequences are skipped", () => {
  const text = [
    "▪ Final",
    "June 20 20:15 @ Beograd, Crvena zvezda",
    "Czechoslovakia   2-2 a.e.t., 5-3 pen.  West Germany",
    "  Penalties: 1-0 Masny,  1-1 Bonhof,",
    "             2-1 Nehoda, 2-2 Flohe,",
    "  Czechoslovakia: Viktor, Pivarník, Ondrus, Capkovic, Gögh, Dobiás (Vesely 94),",
    "▪ Group 2",
    "June 12 17:45 @ Torino, Stadio Comunale",
    "Belgium          1-1 England",
    "▪ Third place play-off",
    "June 21 20:30 @ Napoli, San Paolo",
    "Czechoslovakia   1-1 Italy    (9-8 pen)        # note - no extra time played",
  ].join("\n");
  const rows = parseEuroText(text, 1976, { 1976: 3 });
  assert.deepEqual(rows, [
    { round: "Final", date: "1976-06-20", team1: "Czechoslovakia", team2: "West Germany", score: { et: [2, 2], p: [5, 3] } },
    { round: "Group 2", group: "Group 2", date: "1976-06-12", team1: "Belgium", team2: "England", score: { ft: [1, 1] } },
    { round: "Third place play-off", date: "1976-06-21", team1: "Czechoslovakia", team2: "Italy", score: { ft: [1, 1], p: [9, 8] } },
  ]);
});

test("1984–2004: date, time, match and venue on one line, the venue first or last", () => {
  const text = [
    "Group A   | England   Netherlands     Scotland    Switzerland",
    "▪ Semi-finals",
    "June 24 20:00    Spain            1-1 a.e.t., 5-4 pen.  Denmark   @ Lyon",
    "▪ Group A",
    "June 8   @ London            England          1-1 Switzerland",
    "▪ Quarter-finals",
    "June 22 15:00 @ London           ",
    "  England          0-0 Spain           (aet, 4-2 pen)",
    "▪ Final",
    "July 2 20:00 @ Rotterdam   France             2-1 Italy                   (aet/gg)",
    "July 1 19:45   Greece             1-0 Czech Republic   (aet/sg)    @ Estádio do Dragão, Porto",
  ].join("\n");
  const rows = parseEuroText(text, 2000, { 2000: 5 });
  assert.deepEqual(rows.map((r) => [r.date, r.team1, r.team2, r.score]), [
    ["2000-06-24", "Spain", "Denmark", { et: [1, 1], p: [5, 4] }],
    ["2000-06-08", "England", "Switzerland", { ft: [1, 1] }],
    ["2000-06-22", "England", "Spain", { et: [0, 0], p: [4, 2] }],
    ["2000-07-02", "France", "Italy", { et: [2, 1] }],
    ["2000-07-01", "Greece", "Czech Republic", { et: [1, 0] }],
  ]);
  assert.equal(rows[1].group, "Group A");
});

test("2008–2016: abbreviated months, local times and a venue that names a country", () => {
  const text = [
    "▪ Matchday 1 | Jun 10 - Jun 14",
    "▪ Group A",
    "Jun 10",
    "  21:00   France            2-1  Romania           @ Paris (Stade de France)",
    "          Albania           0-1  Switzerland       @ Lens",
    "▪ Matchday 2 | Jun 15 - Jun 18",
    "▪ Quarter-finals",
    "Jun 20",
    "   20:45   Croatia     1-3 pen. 1-1 a.e.t. (0-0)   Turkey   @ Ernst-Happel-Stadion, Wien",
    "   20:45   Netherlands   1-3 a.e.t. (1-1)    Russia   @ St. Jakob-Park, Basel",
    "   20:45 (21:45 EEST)   England  2-4 pen. 0-0 a.e.t. (0-0)  Italy  @ Kyiv",
    "   21:00   Wales        1-0                  Northern Ireland  @ Paris (Parc des Princes)",
  ].join("\n");
  const rows = parseEuroText(text, 2016, { 2016: 6 });
  assert.deepEqual(rows.map((r) => [r.round, r.team1, r.team2, r.score]), [
    ["Group A", "France", "Romania", { ft: [2, 1] }],
    ["Group A", "Albania", "Switzerland", { ft: [0, 1] }],
    ["Quarter-finals", "Croatia", "Turkey", { ft: [0, 0], et: [1, 1], p: [1, 3] }],
    ["Quarter-finals", "Netherlands", "Russia", { ft: [1, 1], et: [1, 3] }],
    ["Quarter-finals", "England", "Italy", { ft: [0, 0], et: [0, 0], p: [2, 4] }],
    ["Quarter-finals", "Wales", "Northern Ireland", { ft: [1, 0] }],
  ]);
  assert.ok(rows.every((r) => r.date === "2016-06-10" || r.date === "2016-06-20"));
});

test("a two-letter weekday is a date; the 2016 file's two misdated group matches are corrected", () => {
  const weekday = "▪ Quarter-finals\nTh Jun 19\n  20:45   Portugal    2-3    Germany    @ St. Jakob-Park, Basel\n";
  assert.equal(parseEuroText(weekday, 2008, { 2008: 1 })[0].date, "2008-06-19");
  const text = "▪ Group E\nJun 21\n  21:00   Italy             0-1  Ireland           @ Lille\n          Sweden            0-1  Belgium           @ Nice\n  21:00   Iceland           2-1  Austria           @ Paris\n";
  assert.deepEqual(parseEuroText(text, 2016, { 2016: 3 }).map((r) => r.date), ["2016-06-22", "2016-06-22", "2016-06-21"]);
});

test("an edition read in part, a match before any date or a team that is no name throws", () => {
  const one = "▪ Final\nJuly 10\n  20:30    Soviet Union   v Yugoslavia  2-1 a.e.t.  @ Parc des Princes, Paris\n";
  assert.equal(parseEuroText(one, 1960, { 1960: 1 }).length, 1);
  assert.throws(() => parseEuroText(one, 1960), /Incomplete/);
  assert.throws(() => parseEuroText("▪ Final\n  Soviet Union   v Yugoslavia  2-1\n", 1960, { 1960: 1 }), /date/);
  assert.throws(() => parseEuroText("▪ Final\nJuly 10\n  Soviet 2 Union   v Yugoslavia  2-1\n", 1960, { 1960: 1 }), /team/);
  assert.throws(() => parseEuroText(one, 1961), /edition/);
});

test("the Euros before 2020 are read from openfootball/euro by the source projection", async () => {
  const text = "▪ Final\nJuly 10\n  20:30    Soviet Union   v Yugoslavia  2-1 a.e.t.  @ Parc des Princes, Paris\n";
  const { GET } = await import("../backend/sources/projections/open-cups.mjs");
  const asked = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(text); };
  try {
    const response = await GET(new Request("http://bridge/api/open-cups?competition=euro&season=1960"));
    // The file holds one of the edition's four matches: the edition is refused whole.
    assert.equal(response.status, 502);
    assert.deepEqual(asked, ["https://raw.githubusercontent.com/openfootball/euro/88d150a6c8db43925ea327b87e990f653c999b11/1960--france/euro.txt"]);
    // 2020 and after keep their JSON files.
    globalThis.fetch = async (url) => { asked.push(String(url)); return Response.json({ name: "Euro 2024", matches: [] }); };
    assert.equal((await GET(new Request("http://bridge/api/open-cups?competition=euro&season=2024"))).status, 200);
    assert.equal(asked.at(-1), "https://raw.githubusercontent.com/openfootball/euro.json/master/2024/euro.json");
    assert.equal((await GET(new Request("http://bridge/api/open-cups?competition=euro&season=2017"))).status, 400);
  } finally {
    globalThis.fetch = original;
  }
});
