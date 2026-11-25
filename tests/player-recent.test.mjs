// A player's last five matches in the bubble of « Compositions » before the kick-off (FAILURE_MODES.md § 70; hugo,
// 25 Nov 2026). The fixture is the season read of four PSG starters on the evening of PSG – Roma (m_36394c), trimmed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { positionLine, recentForm, recentParams, RECENT_MATCHES } = await import(
  pathToFileURL(path.join(root, "dashboard/frontend/src/services/player-recent.js")).href
);
const reads = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/player-recent-psg-roma.json"), "utf8"));
// The API lists appearances by match id, not by date.
const body = (id) => ({ ...reads[id], appearances: [...reads[id].appearances].sort((a, b) => a.matchId.localeCompare(b.matchId)) });
const MATCH = "m_36394c";
const tiles = (form) => Object.fromEntries(form.tiles.map((t) => [t.label, t.value]));

test("R37 positionLine: the line of a position id", () => {
  for (const id of [0, 11]) assert.equal(positionLine(id), "G");
  for (const id of [1, 30, 34, 39, 51, 59]) assert.equal(positionLine(id), "D");
  for (const id of [2, 50, 66, 75, 79]) assert.equal(positionLine(id), "M");
  for (const id of [3, 81, 89, 91, 105, 106, 119]) assert.equal(positionLine(id), "A");
  for (const id of [null, undefined, 12, 120, 999]) assert.equal(positionLine(id), null);
});

test("R37 the read: the match's season, every competition, twelve matches", () => {
  const p = recentParams({ generation: "g1" }, "p_2Hn7OB", "2026/2027");
  assert.equal(p.season, "2026/2027");
  assert.equal(p.player, "p_2Hn7OB");
  assert.equal(p.leagues, "all");
  assert.equal(p.limit, 12);
  assert.equal(RECENT_MATCHES, 5);
});

test("R37 goalkeeper (Safonov): five matches, the match itself left out, his four figures", () => {
  const form = recentForm(body("p_2Hn7OB"), { playerId: "p_2Hn7OB", matchId: MATCH, positionId: 11 });
  assert.equal(form.line, "G");
  assert.equal(form.matches.length, 5);
  assert.ok(form.matches.every((m) => m.matchId !== MATCH));
  assert.deepEqual(form.matches.map((m) => m.date), ["2026-11-21", "2026-11-07", "2026-11-03", "2026-10-30", "2026-10-26"]);
  assert.deepEqual(form.matches.map((m) => m.competition), ["L1", "L1", "LDC", "L1", "L1"]);
  assert.equal(form.minutes, 450);
  assert.equal(Math.round(form.grade), 56);
  assert.deepEqual(tiles(form), { "Arrêts": "15", "Buts encaissés": "3", "Buts évités": "+1,1", "Sans encaisser": "3 / 5" });
});

test("R37 defender (Zabarnyi): duels, tackles and interceptions, clearances, passes", () => {
  const form = recentForm(body("p_3jDkWb"), { playerId: "p_3jDkWb", matchId: MATCH, positionId: 34 });
  assert.equal(form.line, "D");
  assert.deepEqual(tiles(form), { "Duels gagnés": "62 %", "Tacles + interc.": "9", "Dégagements": "16", "Passes réussies": "94 %" });
});

test("R37 midfielder (Vítinha): the bench without minutes is not a match played", () => {
  const form = recentForm(body("p_0QyXN7"), { playerId: "p_0QyXN7", matchId: MATCH, positionId: 75 });
  assert.equal(form.line, "M");
  assert.deepEqual(form.matches.map((m) => m.matchId), ["m_264TKg", "m_0k4IES", "m_3DY8iO", "m_14BqaI"]);
  assert.equal(form.minutes, 344);
  assert.deepEqual(tiles(form), { "Passes réussies": "93 %", "Occasions créées": "5", "Récupérations": "19", "Buts · passes d.": "1 · 1" });
});

test("R37 forward (Torres): goals, assists, xG, shots on target; the line from his matches when the line-up names none", () => {
  const form = recentForm(body("p_01Prno"), { playerId: "p_01Prno", matchId: MATCH, positionId: 105 });
  assert.equal(form.line, "A");
  assert.deepEqual(tiles(form), { "Buts": "1", "Passes d.": "0", "xG": "1,5", "Tirs cadrés": "10 / 13" });
  const unknown = recentForm(body("p_01Prno"), { playerId: "p_01Prno", matchId: MATCH, positionId: null });
  assert.equal(unknown.line, "A");
});

test("R37 a grade under 20 minutes is not shown; a figure no match carries is « – »; no match played: none", () => {
  const short = { appearances: [{ playerId: "p_x", matchId: "m_a", date: "2026-11-01", leagueId: "l_3FJFUl", minutes: 14, grade: 71, saves: null, goalsConceded: null, goalsPrevented: null }], competitions: [] };
  const form = recentForm(short, { playerId: "p_x", matchId: MATCH, positionId: 11 });
  assert.equal(form.matches[0].grade, null);
  assert.equal(form.grade, null);
  assert.equal(tiles(form)["Arrêts"], "–");
  const none = recentForm({ appearances: [{ playerId: "p_x", matchId: "m_b", date: "2026-11-02", minutes: null }] }, { playerId: "p_x", matchId: MATCH, positionId: 11 });
  assert.equal(none.matches.length, 0);
  assert.deepEqual(none.tiles, []);
  assert.equal(recentForm(null, { playerId: "p_x", matchId: MATCH }).matches.length, 0);
});
