// « Composition probable » (FAILURE_MODES.md §61, 61p–61q): which line-up each side of the « Compositions » tab shows,
// when our probable eleven is read, and when the line-ups are read again before kick-off. The answers are in the
// shapes of GET /api/matches/{id}/lineups and GET /api/matches/{id}/lineups/probable (backend/api/test/probable-lineups.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import {
  lineupSides, lineupView, lineupsBeforeKickoff, lineupsWatched, probableImages, probableView, probableWanted,
} from "../dashboard/frontend/src/services/match-tabs.js";

const starter = (id, name, extra = {}) => ({ player_id: id, name, shirt_number: "9", position_id: 34, pitch_x: 0.36, pitch_y: 0.63, ...extra });
const provider = (home, away) => ({
  match_id: "m_x", home_team: { id: "t_h" }, away_team: { id: "t_a" },
  ...(home && { home: { starters: [starter("p_h1", "Home One")], subs: [], formation: "4-3-3", ...home } }),
  ...(away && { away: { starters: [starter("p_a1", "Away One")], subs: [], formation: "3-5-2", ...away } }),
});
const ours = {
  match_id: "m_x", method: "probable-v1", computedAt: "2026-11-28T17:45:00Z",
  home: {
    formation: "4-3-3", basis: { lineups: 10, from: "2026-09-27", to: "2026-11-22" },
    starters: [
      starter("p_2", "Marquinhos", { share: 0.4, image_url: "https://img/m.webp", replaces: { player_id: "p_9", name: "Willian Pacho" } }),
      starter("p_3", "Achraf Hakimi", { share: 0.8, image_url: null, replaces: null }),
    ],
    absent: [{ player_id: "p_9", name: "Willian Pacho", image_url: "https://img/p.webp", kind: "suspension", label: "Yellow card suspension",
      expectedReturn: null, matchesRemaining: 1 }],
  },
  away: {
    formation: "3-4-2-1", basis: { lineups: 8, from: "2026-10-01", to: "2026-11-22" },
    starters: [starter("p_20", "Arthur Avom", { share: 1, replaces: null })], absent: [],
  },
};
const states = (sides) => ({ home: sides.home?.state ?? null, away: sides.away?.state ?? null });

test("61p: per side, the provider's eleven first (official, then « prévisionnelle »), else ours, else none", () => {
  const probable = probableView(ours);
  const view = (payload) => lineupView(payload, [], [], new Map());
  assert.deepEqual(states(lineupSides(view(provider({ confirmed: true }, { confirmed: true })), probable)), { home: "official", away: "official" });
  assert.deepEqual(states(lineupSides(view(provider({ confirmed: false }, null)), probable)), { home: "forecast", away: "probable" });
  assert.deepEqual(states(lineupSides(view(provider(null, { confirmed: true })), probable)), { home: "probable", away: "official" });
  assert.deepEqual(states(lineupSides(view(null), probable)), { home: "probable", away: "probable" });
  // A provider's eleven whose confirmation is unknown is not called official.
  assert.deepEqual(states(lineupSides(view(provider({}, { confirmed: null })), probable)), { home: "forecast", away: "forecast" });
  // Ours for one side only (the other under 5 elevens): that side has none.
  assert.deepEqual(states(lineupSides(view(null), probableView({ ...ours, away: null }))), { home: "probable", away: null });
  // Nothing anywhere: no side, the tab's empty state.
  assert.deepEqual(states(lineupSides(view(null), probableView(null))), { home: null, away: null });
  // The provider's side wins even when ours exists for it.
  const both = lineupSides(view(provider({ confirmed: true }, null)), probable);
  assert.equal(both.home.starters[0].name, "Home One");
  assert.equal(both.away.starters[0].name, "Arthur Avom");
});

test("61p: our eleven drawn as probable markers, with its share, whom each replaces, and its absent", () => {
  const { home, away } = probableView(ours);
  assert.equal(home.state, "probable");
  assert.equal(home.formation, "4-3-3");
  assert.deepEqual(home.basis, { lineups: 10, from: "2026-09-27", to: "2026-11-22" });
  const [m, h] = home.starters;
  assert.deepEqual({ id: m.id, probable: m.probable, share: m.share, x: m.x, y: m.y, imageUrl: m.imageUrl, grade: m.grade, goals: m.goals },
    { id: "p_2", probable: true, share: 0.4, x: 0.36, y: 0.63, imageUrl: "https://img/m.webp", grade: null, goals: [] });
  // Whom he replaces, with the absence's kind (the bubble's mark).
  assert.deepEqual(m.replaces, { id: "p_9", name: "Willian Pacho", kind: "suspension" });
  assert.equal(h.replaces, null);
  assert.equal(h.imageUrl, null);
  assert.deepEqual(home.absent.map((a) => [a.player.id, a.player.name, a.player.imageUrl, a.kind, a.matchesRemaining]),
    [["p_9", "Willian Pacho", "https://img/p.webp", "suspension", 1]]);
  assert.deepEqual(away.absent, []);
  // A side without starters is none; a missing share stays unknown.
  assert.equal(probableView({ ...ours, away: { ...ours.away, starters: [] } }).away, null);
  assert.equal(probableView({ ...ours, home: { ...ours.home, starters: [starter("p_5", "X")] } }).home.starters[0].share, null);
  // The portraits it carries, by player.
  assert.deepEqual([...probableImages(ours)].sort(), [["p_2", "https://img/m.webp"], ["p_9", "https://img/p.webp"]]);
});

test("61ac: probable-v2's and probable-v3's share is a score, not a count of starts: no « Titulaire N fois sur M » is drawn from it", () => {
  // probable-v1: share = starts / the basis's elevens (the bubble's « Titulaire 4 fois sur 10 »).
  assert.deepEqual(probableView(ours).home.starters.map((p) => p.share), [0.4, 0.8]);
  // probable-v2 (FAILURE_MODES §61.3): share is the player's score, so the markers carry no share to count from.
  const v2 = probableView({ ...ours, method: "probable-v2" });
  assert.deepEqual(v2.home.starters.map((p) => p.share), [null, null]);
  assert.deepEqual(v2.away.starters.map((p) => p.share), [null]);
  // The rest of the eleven is drawn the same.
  assert.deepEqual(v2.home.starters.map((p) => [p.id, p.x, p.y, p.replaces?.id ?? null]), [["p_2", 0.36, 0.63, "p_9"], ["p_3", 0.36, 0.63, null]]);
  assert.equal(probableView({ ...ours, method: undefined }).home.starters[0].share, null);
  // probable-v3 (FAILURE_MODES §61.4): the same score, drawn as v2's.
  const v3 = probableView({ ...ours, method: "probable-v3" });
  assert.deepEqual(v3, v2);
});

test("61q: ours is read only before kick-off and only while a side lacks the provider's eleven", () => {
  const kickoff = Date.parse("2026-11-28T19:45:00Z");
  const match = (status, extra = {}) => ({ status, timeUtc: "2026-11-28T19:45:00Z", home: { score: null }, away: { score: null }, ...extra });
  assert.equal(lineupsBeforeKickoff(match("not_started"), kickoff + 60_000), true); // the status first
  assert.equal(lineupsBeforeKickoff(match("finished"), kickoff - 60_000), false);
  assert.equal(lineupsBeforeKickoff(match("live"), kickoff - 60_000), false);
  assert.equal(lineupsBeforeKickoff(match(undefined), kickoff - 60_000), true);
  assert.equal(lineupsBeforeKickoff(match(undefined), kickoff + 60_000), false);
  assert.equal(lineupsBeforeKickoff(match(undefined, { home: { score: 1 } }), kickoff - 60_000), false);
  assert.equal(probableWanted(true, null), true);
  assert.equal(probableWanted(true, provider({ confirmed: false }, null)), true);
  assert.equal(probableWanted(true, provider({ confirmed: false }, { confirmed: false })), false);
  assert.equal(probableWanted(false, null), false);
});

test("61r: the line-ups are read again from 90 min before to 30 min after kick-off until both are official", () => {
  const match = { status: "not_started", timeUtc: "2026-11-28T19:45:00Z" };
  const kickoff = Date.parse(match.timeUtc), min = 60_000;
  assert.equal(lineupsWatched(match, null, kickoff - 91 * min), false);
  assert.equal(lineupsWatched(match, null, kickoff - 90 * min), true);
  assert.equal(lineupsWatched(match, null, kickoff - 40 * min), true);
  assert.equal(lineupsWatched(match, null, kickoff + 30 * min), true);
  assert.equal(lineupsWatched(match, null, kickoff + 31 * min), false);
  assert.equal(lineupsWatched(match, provider({ confirmed: true }, { confirmed: false }), kickoff - 10 * min), true);
  assert.equal(lineupsWatched(match, provider({ confirmed: true }, null), kickoff - 10 * min), true);
  assert.equal(lineupsWatched(match, provider({ confirmed: true }, { confirmed: true }), kickoff - 10 * min), false);
  assert.equal(lineupsWatched({ status: "not_started", timeUtc: null }, null, kickoff), false);
});

// § 66 (PSG – Roma in play, 25 Nov 2026): the line-up's own photos, and « incohérentes » only on statistics that exist.
test("R29: each official player takes the line-up's own photo when no statistics row, grade or probable eleven has one", async () => {
  const payload = provider(
    { confirmed: true, starters: [starter("p_h1", "Home One", { image_url: "https://img/h1.webp" }), starter("p_h2", "Home Two", { image_url: null })],
      subs: [starter("p_h3", "Home Three", { image_url: "https://img/h3.webp" })] },
    { confirmed: true, starters: [starter("p_a1", "Away One", { image_url: "https://img/a1.webp" })] },
  );
  const bare = lineupView(payload, [], [], new Map(), new Map());
  assert.deepEqual(bare.home.starters.map((p) => p.imageUrl), ["https://img/h1.webp", null]);
  assert.deepEqual(bare.home.bench.map((p) => p.imageUrl), ["https://img/h3.webp"]);
  assert.deepEqual(bare.away.starters.map((p) => p.imageUrl), ["https://img/a1.webp"]);
  // A statistics row's photo still comes first, then the grade's; our probable eleven's fills a player the line-up has none of.
  const rows = [{ id: "p_h1", imageUrl: "https://img/row.webp" }];
  const grades = new Map([["p_a1", { imageUrl: "https://img/grade.webp", grade: 70 }]]);
  const view = lineupView(payload, [], rows, grades, new Map([["p_h2", "https://img/probable.webp"], ["p_h1", "https://img/old.webp"]]));
  assert.deepEqual(view.home.starters.map((p) => p.imageUrl), ["https://img/row.webp", "https://img/probable.webp"]);
  assert.deepEqual(view.away.starters.map((p) => p.imageUrl), ["https://img/grade.webp"]);
});

test("R30: « incohérentes » only when the flag is false and the match has team statistics", async () => {
  const { teamStatsFlagged } = await import("../dashboard/frontend/src/services/match-tabs.js");
  const psgRoma = { id: "m_36394c", status: "in_play", coverage: { teamStatsReliable: false, shots: false }, stats: [] };
  assert.equal(teamStatsFlagged(psgRoma), false);
  assert.equal(teamStatsFlagged({ ...psgRoma, stats: undefined }), false);
  assert.equal(teamStatsFlagged({ ...psgRoma, coverage: undefined }), false);
  assert.equal(teamStatsFlagged(null), false);
  const row = { key: "total_shots", home: 0, away: 0 };
  assert.equal(teamStatsFlagged({ ...psgRoma, coverage: { teamStatsReliable: true }, stats: [row] }), false);
  assert.equal(teamStatsFlagged({ ...psgRoma, coverage: {}, stats: [row] }), false);
  assert.equal(teamStatsFlagged({ ...psgRoma, stats: [row] }), true);
});

test("R31: the match page's « incohérent » warnings read teamStatsFlagged, never the flag itself", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["MatchDetail.jsx", "MatchSections.jsx"]) {
    const source = await readFile(new URL(`../dashboard/frontend/src/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /teamStatsReliable\s*===\s*false/, file);
    assert.match(source, /teamStatsFlagged\(match\)/, file);
  }
});
