// Changing the season on /joueurs, /clubs or /competitions must not replace the whole site by
// the loading screen (user, 20 Nov 2026): the page and its last tables stay while the new season
// loads, and only the tables change. Written before the change to selectSeasonSnapshot.
//
// Expected outcomes:
//  1. Same page, another season, the new one not loaded yet: the previous snapshot is kept
//     (retained), whatever the read's intent or scope string (both carry the season).
//  2. Another page (or another player, club or match id): nothing is kept.
//  3. The same season with another intent (a filter): the existing rule, nothing new.
//  4. The new season loaded: it is shown, never the previous one.
//  5. Retention disabled (a match detail deferring its season): nothing is kept.
import test from "node:test";
import assert from "node:assert/strict";
import { selectSeasonSnapshot } from "../dashboard/frontend/src/services/season-version.js";

const players = (season, extra = {}) => ({
  key: `compact-catalogue:${season}:players:42`,
  intent: JSON.stringify(["/joueurs/", null, season, "europe"]),
  scope: JSON.stringify([false, season === "2026/2027", null]),
  page: JSON.stringify(["/joueurs/", null, "europe"]),
  season,
  manifest: { publicationVersion: "42" },
  ...extra,
});

test("same page, another season still loading: the page keeps its last tables", () => {
  const previous = players("2026/2027", { data: { rows: ["old"] } });
  const pending = players("2025/2026", { data: undefined });
  const shown = selectSeasonSnapshot(previous, pending);
  assert.equal(shown.retained, true);
  assert.deepEqual(shown.data, { rows: ["old"] });
});

test("another page or another id: nothing is kept", () => {
  const previous = players("2026/2027", { data: { rows: ["old"] } });
  for (const page of [["/clubs/", null, "europe"], ["/joueurs/", "p_aaaaaa", "europe"]])
    assert.equal(selectSeasonSnapshot(previous, players("2025/2026", { page: JSON.stringify(page), data: undefined })).retained, false);
});

test("the same season with another intent keeps the rule it had", () => {
  const previous = players("2026/2027", { data: { rows: ["old"] } });
  const filtered = players("2026/2027", { intent: "filter-changed", key: "other", data: undefined });
  assert.equal(selectSeasonSnapshot(previous, filtered).retained, false);
});

test("the new season once loaded is shown", () => {
  const previous = players("2026/2027", { data: { rows: ["old"] } });
  const ready = selectSeasonSnapshot(previous, players("2025/2026", { data: { rows: ["new"] } }));
  assert.equal(ready.retained, false);
  assert.deepEqual(ready.data, { rows: ["new"] });
});

test("retention disabled keeps nothing", () => {
  const previous = players("2026/2027", { data: { rows: ["old"] } });
  assert.equal(selectSeasonSnapshot(previous, players("2025/2026", { data: undefined }), false).retained, false);
});
