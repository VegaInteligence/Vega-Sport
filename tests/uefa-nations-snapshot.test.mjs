import test from "node:test";
import assert from "node:assert/strict";
import { addUefaNationsSnapshot } from "../dashboard/frontend/src/services/uefa-nations-snapshot.js";
import { aggregateSeason } from "../dashboard/frontend/src/services/season-player.js";
import { playerSeasonGroups } from "../dashboard/frontend/src/services/player-season-history.js";

const id = "p_2e0FPo",
  season = "2026/2027";
const empty = () => ({
  appearances: [],
  teams: [],
  competitions: [],
  matches: [],
  fixtures: [],
});
test("official UEFA supplement produces a sourced Spain competition with observed totals", () => {
  const data = addUefaNationsSnapshot(empty(), id, season);
  const profile = aggregateSeason(data.appearances, id);
  const [group] = playerSeasonGroups([{ season, data, profile }], id);
  assert.equal(group.team.id, "t_486gYN");
  assert.equal(group.competitions[0].competition.sourceLabel, "UEFA");
  assert.match(
    group.competitions[0].competition.sourceUrl,
    /^https:\/\/www\.uefa\.com\//,
  );
  assert.equal(profile.matches, 4);
  assert.equal(profile.minutes, 281);
  assert.equal(profile.stats.goals.sum, 4);
  assert.equal(profile.stats.assists.sum, 1);
  assert.equal(profile.rating, null);
  assert.equal(profile.stats.xg, undefined);
});
test("matching provider observations replace the corresponding UEFA date", () => {
  const data = empty();
  data.competitions.push({ id: "l_provider", name: "UEFA Nations League" });
  data.appearances.push({
    playerId: id,
    teamId: "t_486gYN",
    leagueId: "l_provider",
    date: "2026-09-29",
    matchId: "m_native",
    minutes: 68,
    goals: 2,
    assists: 1,
  });
  const merged = addUefaNationsSnapshot(data, id, season);
  assert.equal(merged.appearances.length, 4);
  assert.equal(aggregateSeason(merged.appearances, id).minutes, 281);
  assert.equal(addUefaNationsSnapshot(data, "p_other1", season), data);
});

test("2024/25 retains the seven official UEFA observations", () => {
  const data = addUefaNationsSnapshot(null, id, "2024/2025");
  const profile = aggregateSeason(data.appearances, id);
  assert.equal(profile.matches, 7);
  assert.equal(profile.minutes, 605);
  assert.equal(profile.stats.goals.sum, 3);
  assert.equal(profile.stats.assists.sum, 1);
});
test("partial provider coverage shares one competition and ignores missing minutes", () => {
  const data = empty();
  data.competitions.push({ id: "l_provider", name: "UEFA Nations League" });
  data.appearances.push({
    playerId: id,
    teamId: "t_486gYN",
    leagueId: "l_provider",
    date: "2026-09-29",
    matchId: "m_native",
    minutes: 68,
    goals: 2,
    assists: 1,
  });
  data.appearances.push({
    playerId: id,
    teamId: "t_486gYN",
    leagueId: "l_provider",
    date: "2026-10-03",
    matchId: "m_unknown",
    minutes: null,
  });
  const merged = addUefaNationsSnapshot(data, id, season);
  assert.equal(merged.competitions.length, 1);
  assert.equal(merged.competitions[0].id, "l_provider");
  assert.equal(merged.competitions[0].sourceLabel, "UEFA");
  assert.equal(merged.appearances.length, 4);
  assert.equal(aggregateSeason(merged.appearances, id).unknownMinutes, 0);
  assert.equal(new Set(merged.appearances.map((row) => row.leagueId)).size, 1);
});

test("UEFA matches include official identity, scores, and links only for added rows", () => {
  const data = empty();
  data.competitions.push({ id: "l_provider", name: "UEFA Nations League" });
  data.appearances.push({
    playerId: id,
    teamId: "t_486gYN",
    leagueId: "l_provider",
    date: "2026-09-29",
    matchId: "m_native",
    minutes: 68,
  });
  const merged = addUefaNationsSnapshot(data, id, season);
  assert.equal(merged.matches.length, 3);
  assert.equal(
    merged.matches.some((match) => match.id === "uefa:2047999"),
    false,
  );
  const match = merged.matches.find((match) => match.id === "uefa:2048018");
  assert.deepEqual(match.home, { id: "uefa:39", name: "Angleterre", score: 2 });
  assert.deepEqual(match.away, { id: "t_486gYN", name: "Espagne", score: 3 });
  assert.equal(
    match.sourceUrl,
    "https://www.uefa.com/uefanationsleague/match/2048018/",
  );
  assert.equal(match.leagueId, "l_provider");
  assert.equal(addUefaNationsSnapshot(null, id, "2024/2025").matches.length, 7);
});
