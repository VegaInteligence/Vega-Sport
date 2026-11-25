// A player's last five matches in the bubble of « Compositions » before the kick-off (FAILURE_MODES.md § 71; hugo,
// 25 Nov 2026). The fixture is the season read of four PSG starters on the evening of PSG – Roma (m_36394c), trimmed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { positionLine, readRecent, recentForm, recentParams, RECENT_MATCHES, RECENT_PAGES } = await import(
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

test("R37 a figure made of two parts is « – » when one part is unknown, never a zero (Codex on #239)", () => {
  const row = (extra) => ({ playerId: "p_x", matchId: "m_c", date: "2026-11-03", leagueId: "l_3FJFUl", minutes: 90, ...extra });
  const forward = recentForm({ appearances: [row({ goals: 1, assists: null, shots: 3, shotsOnTarget: null, xg: 0.4 })] }, { playerId: "p_x", positionId: 105 });
  assert.equal(tiles(forward)["Tirs cadrés"], "–");
  const defender = recentForm({ appearances: [row({ duelsWon: 4, duelsLost: null, passesAccurate: 30, passesAttempted: null })] }, { playerId: "p_x", positionId: 34 });
  assert.equal(tiles(defender)["Duels gagnés"], "–");
  assert.equal(tiles(defender)["Passes réussies"], "–");
  const midfielder = recentForm({ appearances: [row({ goals: 1, assists: null })] }, { playerId: "p_x", positionId: 66 });
  assert.equal(tiles(midfielder)["Buts · passes d."], "–");
});

test("R37 the read goes on to the next pages until five matches played, and stops there (Codex on #239)", async () => {
  // A reserve goalkeeper: his twelve newest entries are the match itself and eleven benches without minutes.
  const entry = (n, minutes) => ({ playerId: "p_x", matchId: `m_${String(n).padStart(3, "0")}`, date: `2026-${String(11 - Math.floor(n / 28)).padStart(2, "0")}-${String(28 - (n % 28)).padStart(2, "0")}`, leagueId: "l_3FJFUl", minutes, positionId: 0 });
  const all = [entry(0, null), ...Array.from({ length: 11 }, (_, i) => entry(i + 1, null)), ...Array.from({ length: 30 }, (_, i) => entry(i + 12, i % 2 ? 90 : null))];
  const asked = [];
  const read = async (params) => {
    asked.push(params.page || 1);
    const page = params.page || 1, rows = all.slice((page - 1) * params.limit, page * params.limit);
    return { data: { appearances: rows, competitions: [{ id: "l_3FJFUl", name: "Premier League" }] }, pagination: { page, limit: params.limit, total: all.length, pages: Math.ceil(all.length / params.limit) } };
  };
  const params = recentParams({ generation: "g1" }, "p_x", "2026/2027");
  const body = await readRecent(read, params, { matchId: "m_000" });
  const form = recentForm(body.data, { playerId: "p_x", matchId: "m_000", positionId: 0 });
  assert.equal(form.matches.length, RECENT_MATCHES);
  assert.deepEqual(form.matches.map((m) => m.matchId), ["m_013", "m_015", "m_017", "m_019", "m_021"]);
  // Page 2 holds his five newest matches played: page 3 is not read.
  assert.deepEqual(asked, [1, 2]);
  assert.deepEqual(body.data.competitions.map((c) => c.id), ["l_3FJFUl"]);
  // No more pages than the season has, and never more than RECENT_PAGES.
  asked.length = 0;
  const benches = all.map((a) => ({ ...a, minutes: null }));
  const none = await readRecent(async (p) => { asked.push(p.page || 1); const page = p.page || 1; return { data: { appearances: benches.slice((page - 1) * p.limit, page * p.limit), competitions: [] }, pagination: { page, limit: p.limit, total: benches.length, pages: Math.ceil(benches.length / p.limit) } }; }, params, { matchId: "m_000" });
  assert.deepEqual(asked, [1, 2, 3, 4].slice(0, Math.min(RECENT_PAGES, 4)));
  assert.equal(recentForm(none.data, { playerId: "p_x", matchId: "m_000", positionId: 0 }).matches.length, 0);
});

test("R37 the pages after the first are never recovered one by one: a publication change restarts the whole read (Codex on #239)", async () => {
  const entry = (n, minutes) => ({ id: `a_${n}`, playerId: "p_x", matchId: `m_${String(n).padStart(3, "0")}`, date: `2026-11-${String(28 - n).padStart(2, "0")}`, leagueId: "l_3FJFUl", minutes, positionId: 0 });
  // In publication g2 a newer bench was added: every page boundary moved by one.
  const g1 = [entry(0, null), ...Array.from({ length: 20 }, (_, i) => entry(i + 1, i < 11 ? null : 90))];
  const g2 = [{ ...entry(0, null), id: "a_new", matchId: "m_new", date: "2026-11-29" }, ...g1];
  let current = "g1";
  const calls = [];
  const read = async (p, { recover = true } = {}) => {
    const page = p.page || 1;
    calls.push({ page, generation: p.generation, recover });
    if (p.generation && p.generation !== current) {
      if (!recover) throw Object.assign(new Error("409"), { status: 409 });
      p = { ...p, generation: undefined };
    }
    const rows = (current === "g1" ? g1 : g2);
    const body = { data: { appearances: rows.slice((page - 1) * p.limit, page * p.limit), competitions: [] }, meta: { generation: current }, pagination: { page, limit: p.limit, total: rows.length, pages: Math.ceil(rows.length / p.limit), generation: current } };
    if (page === 1) current = "g2"; // the worker publishes while page 1 travels
    return body;
  };
  const body = await readRecent(read, { ...recentParams({}, "p_x", "2026/2027"), generation: "g1" }, { matchId: "m_000" });
  // Page 2 is fenced to page 1's publication and not recovered; its refusal restarts from page 1.
  assert.deepEqual(calls.slice(0, 3).map((c) => [c.page, c.generation, c.recover]), [[1, "g1", true], [2, "g1", false], [1, "g1", true]]);
  const ids = body.data.appearances.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, g2.map((a) => a.id).slice(0, ids.length));
  const form = recentForm(body.data, { playerId: "p_x", matchId: "m_000", positionId: 0 });
  assert.deepEqual(form.matches.map((m) => m.matchId), ["m_012", "m_013", "m_014", "m_015", "m_016"]);
});
