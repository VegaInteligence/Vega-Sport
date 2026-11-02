import test from "node:test";
import assert from "node:assert/strict";
import {
  clubMatchHistory,
  clubForm,
} from "../dashboard/frontend/src/services/club-matches.js";

function match(
  id,
  date,
  home,
  away,
  homeScore,
  awayScore,
  status = "finished",
) {
  return {
    id,
    date,
    status,
    home: { id: home, name: home, score: homeScore },
    away: { id: away, name: away, score: awayScore },
  };
}

test("the club history combines results from competitions and deduplicates fixtures", () => {
  const matches = [
    match("m2", "2026-10-02", "club", "opponent", 1, 0),
    match("other", "2026-10-03", "a", "b", 2, 0),
  ];
  const fixtures = [
    {
      id: "m2",
      date: "2026-10-02",
      status: "finished",
      home_team: { id: "club", name: "club" },
      away_team: { id: "opponent", name: "opponent" },
      score_home: 2,
      score_away: 0,
    },
    {
      id: "m3",
      date: "2026-10-04",
      status: "finished",
      home_team: { id: "opponent", name: "opponent" },
      away_team: { id: "club", name: "club" },
      score_home: 1,
      score_away: 3,
    },
    {
      id: "future",
      date: "2026-10-05",
      status: "not_started",
      home_team: { id: "club" },
      away_team: { id: "opponent" },
    },
  ];
  const history = clubMatchHistory(matches, fixtures, "club");
  assert.deepEqual(
    history.map((m) => m.id),
    ["m3", "m2"],
  );
  assert.equal(history[1].home.score, 2);
  assert.equal(history[0].away.score, 3);
});

test("form shows the five latest completed matches from the club perspective", () => {
  const history = [
    match("old", "2026-10-01", "club", "x", 1, 0),
    match("m3", "2026-10-03", "x", "club", 1, 2),
    match("m5", "2026-10-05", "club", "x", 0, 1),
    match("m2", "2026-10-02", "club", "x", null, 0),
    match("m6", "2026-10-06", "x", "club", 0, 2),
    match("m4", "2026-10-04", "club", "x", 2, 2),
    match("future", "2026-12-01", "club", "x", null, null, "not_started"),
    match("other", "2026-10-07", "a", "b", 1, 0),
  ];
  const form = clubForm(history, "club");
  assert.deepEqual(
    form.map(({ match }) => match.id),
    ["m2", "m3", "m4", "m5", "m6"],
  );
  assert.deepEqual(
    form.map(({ result }) => result),
    ["?", "V", "N", "D", "V"],
  );
  assert.deepEqual(clubForm([], "club"), []);
});
