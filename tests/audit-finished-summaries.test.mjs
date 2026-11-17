// A player's season summaries count finished matches only; the match logs keep every observation
// (VI-23 stage 5, docs/calculs/09-audit-2026-11/FAILURE_MODES.md §14.2). Written before the
// correction. The new helpers are read from the module namespace so that each test fails on its own.
import test from "node:test";
import assert from "node:assert/strict";
import * as seasonPlayer from "../dashboard/frontend/src/services/season-player.js";
import * as seasonHistory from "../dashboard/frontend/src/services/player-season-history.js";
import { aggregateSeason, aggregateSeasonPlayers, contributionRate } from "../dashboard/frontend/src/services/season-player.js";
import { currentPlayerSeason } from "../dashboard/frontend/src/services/actor-reads.js";
import { loadPlayerHistory, loadPlayerSeason } from "../dashboard/frontend/src/services/scouting-history.js";
import { playerCareerGroups } from "../dashboard/frontend/src/services/player-career.js";
import { addUefaNationsSnapshot } from "../dashboard/frontend/src/services/uefa-nations-snapshot.js";

const P = "p_000001", Q = "p_000002", TEAM = "t_000001", season = "2026/2027";
const LEAGUE = "l_000001", CUP = "l_000002";
const manifest = {
  storage: "aws-relational",
  publicationVersion: "42",
  capabilities: { compactReads: { player: true, club: true }, actorSummary: true },
  seasons: [{ id: season, chunks: [{ leagueId: LEAGUE }, { leagueId: CUP }] }],
};
/**
 * One season of the API's actor read. Statuses: m1 a finished match record (and its fixture), m2 a
 * finished fixture without a record, m3 in play, m4 canceled, m5 postponed, m6 not started, m7 a live
 * alias, m8 finished with unknown minutes, m9 no record and no fixture (unknown), m10 a finished cup
 * match. The finished league summary: m1 + m2 = 2 matches, 170 minutes, 2 goals, 1 assist (« 57′ »).
 */
const RECORDS = { m1: "finished", m3: "in_play", m4: "canceled", m7: "half_time", m8: "finished", m10: "finished" };
const FIXTURES = { m1: "finished", m2: "finished", m5: "postponed", m6: "not_started", m10: "finished" };
const PLAYED = [
  ["m1", 90, 1, 0, "2026-09-01"], ["m2", 80, 1, 1, "2026-09-08"], ["m3", 30, 1, 0, "2026-09-15"], ["m4", 60, 0, 1, "2026-09-22"],
  ["m5", 45, 0, 0, "2026-09-29"], ["m6", 10, 0, 0, "2026-10-06"], ["m7", 45, 1, 0, "2026-10-13"], ["m8", null, null, null, "2026-10-20"],
  ["m9", 90, 2, 0, "2026-10-27"],
];
function read() {
  const appearance = (playerId, [matchId, minutes, goals, assists, date], leagueId = LEAGUE) => ({
    id: `${playerId}:${matchId}`, playerId, name: playerId, matchId, date, teamId: TEAM, team: "Club", leagueId, league: leagueId,
    season, minutes, goals, assists, positionId: 91,
  });
  const dates = Object.fromEntries([...PLAYED, ["m10", 0, 0, 0, "2026-11-03"]].map(([m, , , , date]) => [m, date]));
  const leagueOf = (m) => (m === "m10" ? CUP : LEAGUE);
  return {
    meta: { actor: { kind: "player", id: P }, detail: "summary" },
    matches: Object.entries(RECORDS).map(([id, status]) => ({ id, status, date: dates[id], leagueId: leagueOf(id),
      home: { id: TEAM, score: status === "finished" ? 1 : null }, away: { id: "t_000002", score: status === "finished" ? 0 : null } })),
    fixtures: Object.entries(FIXTURES).map(([id, status]) => ({ id, status, date: dates[id], leagueId: leagueOf(id) })),
    appearances: [
      ...PLAYED.map((row) => appearance(P, row)),
      appearance(P, ["m10", 70, 0, 1, dates.m10], CUP),
      // A peer: one finished match, one canceled.
      appearance(Q, ["m1", 90, 0, 0, dates.m1]), appearance(Q, ["m4", 90, 3, 0, dates.m4]),
    ],
    teams: [{ id: TEAM, name: "Club" }],
    competitions: [{ id: LEAGUE, name: "Ligue", country: "FRA" }, { id: CUP, name: "Coupe", country: "FRA" }],
    metrics: [],
  };
}
const ids = (rows) => rows.map((row) => row.matchId);
const byCompetition = (group) => Object.fromEntries(group.competitions.map((c) => [c.key, c.profile.matches]));
const RAW_PLAYED = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m9", "m10"];
function assertFinished(profile, label, { matches = 3, minutes = 240, goals = 2, assists = 2 } = {}) {
  assert.deepEqual([profile.matches, profile.minutes, profile.unknownMinutes], [matches, minutes, 1], `${label}: matches, minutes, unknown`);
  assert.deepEqual([profile.stats.goals.sum, profile.stats.assists.sum], [goals, assists], `${label}: goals, assists`);
  assert.ok(ids(profile.rows).every((m) => ["m1", "m2", "m10"].includes(m)), `${label}: ${ids(profile.rows)}`);
}
/** A fake API: the read above as one compact page (navigation-performance.test.mjs's shape). */
function api(calls = []) {
  return async (path) => {
    const url = new URL(path, "https://site.test");
    calls.push(url);
    assert.equal(url.pathname, "/api/read/player");
    // The page's total counts its distinct matches and fixtures (compact-reads.js).
    const data = read(), total = new Set([...data.matches, ...data.fixtures].map((row) => row.id)).size;
    return Response.json({ data, meta: { generation: "42" }, pagination: { generation: "42", page: 1, limit: 100, total, pages: 1 } });
  };
}
const contextOf = (data) => ({ manifest, season, data: { ...data, meta: { ...data.meta, actorScope: "all", complete: true, generation: "42" } } });

test("finishedAppearances keeps the appearances of finished matches, by record or fixture (§14.2)", () => {
  const { finishedAppearances } = seasonPlayer;
  assert.equal(typeof finishedAppearances, "function", "season-player.js exports finishedAppearances");
  const data = read(), before = structuredClone(data);
  const rows = finishedAppearances(data);
  assert.deepEqual(ids(rows.filter((row) => row.playerId === P)), ["m1", "m2", "m8", "m10"]);
  const profile = aggregateSeason(rows, P);
  assertFinished(profile, "the season");
  // The page's narrowed rows: the league only.
  const league = aggregateSeason(finishedAppearances(data, data.appearances.filter((row) => row.leagueId === LEAGUE)), P);
  assertFinished(league, "the league", { matches: 2, minutes: 170, goals: 2, assists: 1 });
  assert.deepEqual(contributionRate(league), { minutes: 170 / 3, count: 3 }, "« 57′ » over three contributions");
  // The local cohort: the peer's canceled match is out too.
  const peer = aggregateSeasonPlayers(rows).find((p) => p.id === Q);
  assert.deepEqual([peer.matches, peer.minutes, peer.stats.goals.sum], [1, 90, 0]);
  // Nothing known, nothing kept; the inputs and the generic aggregator unchanged.
  assert.deepEqual(finishedAppearances(null, data.appearances), []);
  assert.deepEqual(finishedAppearances({ appearances: data.appearances }), []);
  assert.deepEqual(data, before, "the read was mutated");
  const raw = aggregateSeason(data.appearances, P);
  assert.deepEqual([raw.matches, raw.minutes], [9, 520], "aggregateSeason still counts what it is given");
});

test("the current season's summary is finished-only; the read stays raw (§14.2)", () => {
  const f = contextOf(read());
  const before = structuredClone(f.data);
  const current = currentPlayerSeason(f, P, season);
  assertFinished(current.profile, "currentPlayerSeason");
  assert.equal(current.data, f.data, "the same read, not a filtered copy");
  assert.deepEqual(f.data, before);
});

test("a fresh season and its history count finished matches only (§14.2)", async () => {
  const calls = [];
  const loaded = await loadPlayerSeason(manifest, P, season, "all", null, { fetcher: api(calls) });
  assertFinished(loaded.profile, "loadPlayerSeason");
  assert.equal(loaded.data.appearances.length, 12, "the raw read keeps every appearance");
  const [fresh] = await loadPlayerHistory(manifest, P, { season, fetcher: api(calls) });
  assertFinished(fresh.profile, "loadPlayerHistory");
  assert.equal(fresh.data.appearances.length, 12);
  const [league] = await loadPlayerHistory(manifest, P, { season, competition: LEAGUE, fetcher: api(calls) });
  assertFinished(league.profile, "a competition", { matches: 2, minutes: 170, goals: 2, assists: 1 });
});

test("a cached season, narrowed by competition or dates, never brings an unfinished match back (§14.2)", async () => {
  const f = contextOf(read());
  const cachedSeason = (value) => currentPlayerSeason(f, P, value);
  const fetcher = () => assert.fail("the cached complete season is used");
  const [all] = await loadPlayerHistory(manifest, P, { season, cachedSeason, fetcher });
  assertFinished(all.profile, "cached");
  const [cup] = await loadPlayerHistory(manifest, P, { season, competition: CUP, cachedSeason, fetcher });
  assert.deepEqual([cup.profile.matches, cup.profile.minutes, cup.profile.unknownMinutes], [1, 70, 0]);
  const [league] = await loadPlayerHistory(manifest, P, { season, competition: LEAGUE, cachedSeason, fetcher });
  assertFinished(league.profile, "cached league", { matches: 2, minutes: 170, goals: 2, assists: 1 });
  // Dates: September only (m1–m5): m1 and m2 are finished.
  const [september] = seasonHistory.playerHistoryInPeriod([all], P, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual([september.profile.matches, september.profile.minutes, september.profile.unknownMinutes], [2, 170, 0]);
  assert.deepEqual(ids(september.data.appearances.filter((row) => row.playerId === P)), ["m1", "m2", "m3", "m4", "m5"], "the narrowed read stays raw");
  // The summary groups read the summary profile.
  const [group] = seasonHistory.playerSeasonGroups([all], P);
  assertFinished(group.profile, "season group");
  assert.deepEqual(byCompetition(group), { [LEAGUE]: 2, [CUP]: 1 });
  const career = playerCareerGroups([all], P);
  assertFinished(career.clubs[0].profile, "career club");
});

test("compatibility: the match logs' groups keep every played observation (PlayerMatchesPage)", async () => {
  // A characterization of the current logs, written before the history change: it must stay green.
  const entries = await loadPlayerHistory(manifest, P, { season, fetcher: api() });
  const [group] = seasonHistory.playerSeasonGroups(entries, P, { log: true });
  assert.deepEqual(ids(group.profile.rows).sort(), [...RAW_PLAYED].sort());
  assert.equal(group.profile.unknownMinutes, 1);
  assert.deepEqual(byCompetition(group), { [LEAGUE]: 8, [CUP]: 1 });
  const [narrowed] = seasonHistory.playerSeasonGroups(seasonHistory.playerHistoryInPeriod(entries, P, { from: "2026-09-01", to: "2026-09-30" }), P, { log: true });
  assert.deepEqual(ids(narrowed.profile.rows).sort(), ["m1", "m2", "m3", "m4", "m5"]);
  const career = playerCareerGroups(entries, P, { log: true });
  assert.deepEqual(ids(career.clubs[0].profile.rows).sort(), [...RAW_PLAYED].sort());
  assert.deepEqual(ids(career.competitions.find((c) => c.key === LEAGUE).profile.rows).sort(), RAW_PLAYED.filter((m) => m !== "m10").sort());
});

test("the season's whole log, no group selected, keeps every played observation (§14.2)", async () => {
  const { playerSeasonLog } = seasonHistory;
  assert.equal(typeof playerSeasonLog, "function", "player-season-history.js exports playerSeasonLog");
  const [entry] = await loadPlayerHistory(manifest, P, { season, fetcher: api() });
  assert.deepEqual(ids(playerSeasonLog(entry, P).rows).sort(), [...RAW_PLAYED].sort());
  const [september] = seasonHistory.playerHistoryInPeriod([entry], P, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(ids(playerSeasonLog(september, P).rows).sort(), ["m1", "m2", "m3", "m4", "m5"]);
  // No read (an empty season): its profile's rows.
  assert.deepEqual(playerSeasonLog({ season, data: null, profile: aggregateSeason([], P) }, P).rows, []);
});

test("the UEFA snapshot's matches say they were played (§14.2)", async () => {
  const data = addUefaNationsSnapshot(null, "p_2e0FPo", "2026/2027");
  assert.ok(data.matches.length > 0 && data.matches.every((m) => m.status === "finished"), "every snapshot match is finished");
  assert.equal(aggregateSeason(seasonPlayer.finishedAppearances?.(data) ?? [], "p_2e0FPo").matches, 4);
});
