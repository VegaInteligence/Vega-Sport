// The reports (/rapport): what the builders make of the API's reads, and the thread's text.
import test from "node:test";
import assert from "node:assert/strict";
import { buildClubReport, buildMatchReport, buildPlayerReport, currentSeason, gradeOf, reportKind } from "../dashboard/frontend/src/server/report-data.js";
import { reportImageUrl, reportSlug, reportThread } from "../dashboard/frontend/src/services/reports.js";

const today = new Date("2026-11-16T10:00:00Z");
const side = (id, name, score, xg) => ({ id, name, score, xg, imageUrl: null });

test("a report's kind and season come from its id and the day", () => {
  assert.deepEqual(["p_217YMB", "t_4NZcri", "m_3s9Uyk", "x", ""].map(reportKind), ["player", "club", "match", null, null]);
  assert.equal(currentSeason(today), "2026/2027");
  assert.equal(currentSeason(new Date("2026-03-01T00:00:00Z")), "2025/2026");
  assert.equal(gradeOf(0), 50);
  assert.equal(gradeOf(4), 90.9);
});

test("a player's season: totals, per 90, the season grade of 20 minutes or more, his matches", () => {
  const read = { data: {
    matches: [
      { id: "m1", date: "2026-08-20", home: side("t1", "Real Madrid", 2, 1.5), away: side("t2", "Espanyol", 1, 0.4) },
      { id: "m2", date: "2026-08-27", home: side("t3", "Sevilla", 0, 0.2), away: side("t1", "Real Madrid", 0, 1.1) },
      { id: "m3", date: "2026-09-03", home: side("t1", "Real Madrid", 1, 0.9), away: side("t4", "Getafe", 2, 1.0) },
    ],
    appearances: [
      { playerId: "p_aaaaa1", matchId: "m1", teamId: "t1", team: "Real Madrid", league: "LaLiga", minutes: 90, grade: 80, gradeZ: 2.4, goals: 2, assists: 0, xg: 1.2, shots: 4 },
      { playerId: "p_aaaaa1", matchId: "m2", teamId: "t1", team: "Real Madrid", league: "LaLiga", minutes: 90, grade: 50, gradeZ: 0, goals: 0, assists: 1, xg: 0.3, shots: 2 },
      { playerId: "p_aaaaa1", matchId: "m3", teamId: "t1", team: "Real Madrid", league: "LaLiga", minutes: 10, grade: 95, gradeZ: 5, goals: 0, assists: 0, xg: 0.1, shots: 1 },
    ] } };
  const r = buildPlayerReport({ id: "p_aaaaa1", season: "2026/2027", read, power: null, profile: { data: { name: "Kylian", birth_date: "1998-12-20" } }, values: null }, today);
  assert.deepEqual([r.seasonStats.matches, r.seasonStats.minutes, r.seasonStats.totals.goals, r.seasonStats.per90.goals], [3, 190, 2, 0.95]);
  // The 10-minute match is left out of the grade: z̄ = (90·2.4 + 90·0) / 180 = 1.2.
  assert.equal(r.seasonStats.grade, gradeOf(1.2));
  assert.equal(r.player.age, 27);
  assert.deepEqual(r.appearances.map((a) => [a.opponent, a.home, a.score, a.result]), [["Espanyol", true, "2-1", "V"], ["Sevilla", false, "0-0", "N"], ["Getafe", true, "1-2", "D"]]);
  assert.deepEqual(r.best.map((a) => a.matchId), ["m1", "m2"]);
  assert.match(reportThread(r), /^Kylian \(Real Madrid\) en six images\. 2 buts et 1 passe décisive en 3 matchs cette saison\.\nvegasport\.vercel\.app$/);
});

test("a club's season: record, top players, projection and coming matches", () => {
  const read = { data: {
    teams: [{ id: "t1", name: "Real Madrid", country: "ESP" }],
    competitions: [{ id: "l1", name: "LaLiga", country: "ESP" }, { id: "l2", name: "Champions League", country: "INT-2" }],
    matches: [
      { id: "m1", status: "finished", date: "2026-08-20", home: side("t1", "Real Madrid", 2, 1.5), away: side("t2", "Espanyol", 1, 0.4) },
      { id: "m2", status: "finished", date: "2026-08-27", home: side("t3", "Sevilla", 1, 0.2), away: side("t1", "Real Madrid", 0, 1.1) },
    ],
    fixtures: [{ id: "m9", status: "not_started", date: "2026-11-21", time_utc: "2026-11-21T20:00:00Z", home_team: { id: "t1" }, away_team: { id: "t5", name: "Celta Vigo" }, league: { name: "LaLiga" } }],
    appearances: [
      { playerId: "p1", teamId: "t1", name: "Güler", minutes: 180, gradeZ: 1, goals: 1, assists: 1 },
      { playerId: "p2", teamId: "t1", name: "Mbappé", minutes: 170, gradeZ: 2, goals: 2, assists: 0 },
      { playerId: "p3", teamId: "t1", name: "Rarely", minutes: 20, gradeZ: 5, goals: 0, assists: 0 },
    ] } };
  const projection = { competition: "l1", teams: [
    { id: "t9", name: "Barcelona", played: 12, points: 33, projectedPoints: 96, places: [0.6, 0.4, 0, 0] },
    { id: "t1", name: "Real Madrid", played: 12, points: 30, projectedPoints: 92.7, places: [0.322, 0.6, 0.074, 0.004] },
  ] };
  const r = buildClubReport({ id: "t1", season: "2026/2027", read, clubs: { rows: [{ teamId: "t1", rank: 5, score: 93.4, elo: 1961, eloChange: 50 }] }, projection,
    forecasts: { m9: { forecast: { home: 0.8495, draw: 0.1054, away: 0.0452 } } } }, today);
  assert.deepEqual([r.record.wins, r.record.losses, r.record.goalsFor, r.record.points], [1, 1, 2, 3]);
  // A regular plays 270 minutes or more: none here, so nobody is ranked; the list holds them all.
  assert.deepEqual([r.top.length, r.players.map((p) => p.name)], [0, ["Güler", "Mbappé", "Rarely"]]);
  assert.deepEqual([r.outlook.position, r.outlook.title, r.outlook.top4, r.club.league], [2, 32.2, 100, "LaLiga"]);
  assert.deepEqual(r.upcoming.map((m) => [m.opponent, m.win, m.draw, m.loss]), [["Celta Vigo", 85, 11, 5]]);
  assert.match(reportThread(r), /Score Vega 93,4\/100|Score Vega 93\/100/);
});

test("a match: its statistics read from the « All » period, the best grades and the forecast at kick-off", () => {
  const r = buildMatchReport({ id: "m_aaaaa1",
    match: { data: { date: "2026-11-07", home_team: { id: "t1", name: "Valencia" }, away_team: { id: "t2", name: "Real Madrid" }, score_home: 0, score_away: 3 } },
    stats: { data: { periods: [{ period: "FirstHalf", groups: [{ items: [{ key: "expected_goals", home: "0.06", away: "0.76" }] }] },
      { period: "All", groups: [{ items: [{ key: "expected_goals", home: "0.16", away: "2.20" }, { key: "accurate_passes", home: "223 (79%)", away: "565 (91%)" }] }] }] } },
    grades: { grades: [{ playerId: "p1", teamId: "t2", name: "Güler", grade: 74.3 }, { playerId: "p2", teamId: "t1", name: "Guerra", grade: 53 }, { playerId: "p3", teamId: "t2", name: "Mbappé", grade: 66.3 }] },
    live: { points: [{ minute: 0, home: 0.1, draw: 0.17, away: 0.73 }, { minute: 90, home: 0, draw: 0, away: 1 }], events: [{ minute: 28, kind: "goal", side: "away" }] } }, today);
  assert.deepEqual(r.stats.map((s) => [s.key, s.home, s.away]), [["expected_goals", 0.16, 2.2], ["accurate_passes", 223, 565]]);
  assert.deepEqual([r.best.away.map((p) => p.name), r.playerOfMatch.name, r.before], [["Güler", "Mbappé"], "Güler", { home: 10, draw: 17, away: 73 }]);
  assert.equal(reportThread(r), "Valencia 0–3 Real Madrid en six images. xG 0,16–2,20. Joueur du match : Güler, 74/100.\nvegasport.vercel.app");
  assert.equal(reportSlug(r), "vega-valencia-real-madrid");
  assert.equal(reportImageUrl("m_aaaaa1", 3), "/api/rapport/image?id=m_aaaaa1&n=3");
});
