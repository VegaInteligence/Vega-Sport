// Vega's grade of each player in one match: read from the route's body, kept only where shown.
import test from "node:test";
import assert from "node:assert/strict";
import { gradeTitle, gradesOf, leadingPlayers, playerOf } from "../dashboard/frontend/src/services/match-grades.js";

test("a match's best players: by Vega's grade from 60 minutes, the rows' own z first, else the grades' rank", () => {
  const grades = gradesOf({
    match: "m_aaaaa1",
    grades: [
      { playerId: "p_aaaab2", teamId: "t_aaaaa1", name: "Bé", imageUrl: null, team: "Club A", minutes: 64, goals: 1, assists: null, grade: 71, rank: 1 },
      { playerId: "p_aaaab1", teamId: "t_aaaaa2", name: "Aé", imageUrl: "https://img.example/a.png", team: "Club B", minutes: 90, goals: 0, assists: 0, grade: 60, rank: 2 },
      { playerId: "p_aaaab3", teamId: "t_aaaaa1", name: "Cé", minutes: 30, grade: 85, rank: 3 },
      { playerId: "p_aaaab4", teamId: "t_aaaaa1", name: "Dé", minutes: 5, grade: null, rank: null },
    ],
  });
  // An appearance's row is found by its player, whatever its own id (« match:player »).
  assert.equal(grades.get(playerOf({ id: "m_aaaaa1:p_aaaab1", playerId: "p_aaaab1" })).grade, 60);
  assert.equal(grades.get(playerOf({ id: "p_aaaab2" })).rank, 1);
  // Rows that carry their z: the best z from 60 minutes; the 30-minute cameo is shown, not ranked.
  const rows = [
    { id: "m_aaaaa1:p_aaaab1", playerId: "p_aaaab1", minutes: 90, gradeZ: 0.7 },
    { id: "m_aaaaa1:p_aaaab2", playerId: "p_aaaab2", minutes: 64, gradeZ: 1.5 },
    { id: "m_aaaaa1:p_aaaab3", playerId: "p_aaaab3", minutes: 30, gradeZ: 3.0 },
  ];
  assert.deepEqual(leadingPlayers(rows, grades).map((r) => r.id), ["m_aaaaa1:p_aaaab2", "m_aaaaa1:p_aaaab1"]);
  // Rows without z (a match read by its summary alone): from the grades, best rank first, each
  // row built from its grade with the id of an appearance of the match.
  const leading = leadingPlayers([{ id: "m_aaaaa1:p_aaaab1", playerId: "p_aaaab1", minutes: 90 }], grades, { match: "m_aaaaa1", count: 2 });
  assert.deepEqual(leading.map((r) => [r.id, r.playerId, r.name, r.team, r.minutes, r.goals, r.grade]), [
    ["m_aaaaa1:p_aaaab2", "p_aaaab2", "Bé", "Club A", 64, 1, 71],
    ["m_aaaaa1:p_aaaab1", "p_aaaab1", "Aé", "Club B", 90, 0, 60],
  ]);
  // Neither: nothing.
  assert.deepEqual(leadingPlayers(rows.map(({ gradeZ, ...r }) => r), new Map()), []);
  assert.deepEqual(leadingPlayers(undefined, undefined), []);
});

// hugo, 25 Nov 2026, 19 h 03 (FAILURE_MODES § 63.5): « au lieu d'en choisir que 4 augmente le nombre affiché ». A pool
// that carries fewer graded rows than the grades (the summary's few leaders) gives way to the grades, every player
// graded from 60 minutes by rank, up to `count`.
test("R14 a short pool gives way to the match's grades, up to count", () => {
  const grades = gradesOf({
    match: "m_aaaaa1",
    grades: Array.from({ length: 12 }, (_, i) => ({
      playerId: "p_g" + String(i).padStart(4, "0"), name: "J" + i, team: "Club", minutes: i === 5 ? 30 : 90, grade: 90 - i, rank: i + 1,
    })),
  });
  const pool = [0, 1, 2, 3].map((i) => ({ id: "m_aaaaa1:p_g" + String(i).padStart(4, "0"), playerId: "p_g" + String(i).padStart(4, "0"), minutes: 90, gradeZ: 2 - i / 10 }));
  const leading = leadingPlayers(pool, grades, { match: "m_aaaaa1", count: 8 });
  assert.deepEqual(leading.map((r) => r.playerId), ["p_g0000", "p_g0001", "p_g0002", "p_g0003", "p_g0004", "p_g0006", "p_g0007", "p_g0008"]);
  assert.equal(new Set(leading.map((r) => r.id)).size, 8);
  // A pool as long as count keeps its own order.
  assert.equal(leadingPlayers(pool, grades, { match: "m_aaaaa1", count: 4 }).length, 4);
});

test("a match's grades by player, the ones shown only, with their rank in the match", () => {
  const grades = gradesOf({
    match: "m_aaaaa1",
    grades: [
      { playerId: "p_aaaab1", minutes: 90, grade: 80.8, rank: 1 },
      { playerId: "p_aaaab4", minutes: 90, grade: 50, rank: 2 },
      { playerId: "p_aaaab3", minutes: 10, grade: null, rank: null },
    ],
  });
  assert.deepEqual([...grades.keys()], ["p_aaaab1", "p_aaaab4"]);
  assert.equal(gradeTitle(grades.get("p_aaaab1")), "Note Vega du match sur 100 · 1er du match");
  assert.equal(gradeTitle(grades.get("p_aaaab4")), "Note Vega du match sur 100 · 2e du match");
  assert.equal(gradesOf(null).size, 0);
});
