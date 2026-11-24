import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  DEFAULT_HOME_STATE,
  normalizeHomeState,
  encodeHomeState,
  decodeHomeState,
  homeBootstrapGuardScript,
  readBrowserHomeState,
  browserHomeBootstrapMatches,
} from "../dashboard/frontend/src/services/home-bootstrap-preferences.js";
const id = (prefix, n) => `${prefix}_${String(n).padStart(6, "0")}`;
function guard({
  cookie = "",
  preferences = null,
  research = null,
  pages = null,
  search = "",
} = {}) {
  const dataset = {};
  const values = {
    "orion.preferences.v1": preferences,
    "statarena.research.v1": research,
  };
  vm.runInNewContext(homeBootstrapGuardScript, {
    document: { cookie, documentElement: { dataset } },
    localStorage: { getItem: (k) => values[k] },
    sessionStorage: { getItem: () => pages },
    location: { search },
    URLSearchParams,
  });
  return dataset.homeBootstrapMismatch;
}
test("normalizes canonical state, bounds personal ids and preserves explicit overflow signal", () => {
  const teams = Array.from({ length: 102 }, (_, i) => id("t", 101 - i));
  const state = normalizeHomeState({
    preferences: {
      focus: "all",
      favoriteLeagueIds: [id("l", 2), id("l", 1), id("l", 2)],
    },
    season: "2026/2027",
    personalTeams: teams,
  });
  assert.deepEqual(state.preferences.favoriteLeagueIds, [
    id("l", 1),
    id("l", 2),
  ]);
  assert.equal(state.personalTeams.length, 100);
  assert.equal(state.personalTeams[0], id("t", 0));
  assert.deepEqual(
    normalizeHomeState({
      preferences: {
        favoriteLeagueIds: Array.from({ length: 201 }, (_, i) => id("l", i)),
      },
    }),
    { clientOnly: true },
  );
  assert.deepEqual(decodeHomeState(encodeHomeState(state)), state);
  assert.deepEqual(
    decodeHomeState(
      encodeHomeState({
        preferences: {
          favoriteLeagueIds: Array.from({ length: 201 }, (_, i) => id("l", i)),
        },
      }),
    ),
    { clientOnly: true },
  );
  assert.equal(decodeHomeState("%broken"), null);
});
test("guard matches actual local preference and research selections, with URL season override", () => {
  assert.equal(guard(), undefined);
  const research = {
    version: 1,
    lists: [
      {
        id: "main",
        entries: [
          { kind: "clubs", id: id("t", 1) },
          { kind: "players", id: id("p", 2) },
        ],
      },
    ],
  };
  const preferences = { focus: "all", onboardingComplete: true };
  const state = {
    preferences,
    season: "2026/2027",
    personalTeams: [id("t", 1)],
    personalPlayers: [id("p", 2)],
  };
  const cookie = `vega.home.v1=${encodeHomeState(state)}`;
  assert.equal(
    guard({
      cookie,
      preferences: JSON.stringify(preferences),
      research: JSON.stringify(research),
      pages: JSON.stringify({ "/": "2026/2027" }),
    }),
    undefined,
  );
  assert.equal(
    guard({
      cookie,
      preferences: JSON.stringify(preferences),
      research: JSON.stringify(research),
      pages: JSON.stringify({ "/": "2025/2026" }),
    }),
    "true",
  );
  assert.equal(
    guard({
      cookie,
      preferences: JSON.stringify(preferences),
      research: JSON.stringify(research),
      pages: JSON.stringify({ "/": "2025/2026" }),
      search: "?season=2026%2F2027",
    }),
    undefined,
  );
  assert.equal(guard({ preferences: JSON.stringify(preferences) }), "true");
  assert.equal(guard({ preferences: "{" }), "true");
});

test("annual seasons survive cookie and browser bootstrap comparison", () => {
  const state = normalizeHomeState({ season: "2026" });
  assert.equal(decodeHomeState(encodeHomeState(state)).season, "2026");
  globalThis.window = { location: { search: "?season=2026" } };
  globalThis.localStorage = { getItem: () => null };
  globalThis.sessionStorage = {
    getItem: () => JSON.stringify({ "/": "2025" }),
  };
  assert.equal(readBrowserHomeState().season, "2025");
  assert.equal(
    browserHomeBootstrapMatches(state, { defaultSeason: "2024" }),
    true,
  );
  assert.equal(
    browserHomeBootstrapMatches(
      { ...state, season: "2025" },
      { defaultSeason: "2024" },
    ),
    false,
  );
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

// The visitor's country (VI-48): their choice is one more preference (orion.preferences.v1 homeCountry),
// mirrored in the home cookie so that the server picks the same matches. Failure modes and expected outcomes:
//  H1 The choice is lost between the browser and the cookie → normalized, encoded and decoded unchanged ("BRA",
//     "none"); absent → "" (no choice), so every cookie written before VI-48 still matches its browser.
//  H2 A malformed choice ("bra", "BR", 12, an object) poisons the whole state (clientOnly) → it is dropped to "",
//     the rest of the state kept.
//  H3 The guard script misses a changed choice → a browser whose saved choice differs from the cookie's is a
//     mismatch (the server's cards would follow another country); the same choice matches.
test("H1–H3 the home country choice: normalized, kept by the cookie, compared by the guard", () => {
  assert.equal(normalizeHomeState({}).preferences.homeCountry, "");
  assert.equal(normalizeHomeState({ preferences: { homeCountry: "BRA" } }).preferences.homeCountry, "BRA");
  assert.equal(normalizeHomeState({ preferences: { homeCountry: "none" } }).preferences.homeCountry, "none");
  for (const bad of ["bra", "BR", 12, { code: "BRA" }, "INT-2"]) {
    const state = normalizeHomeState({ preferences: { homeCountry: bad, focus: "all" } });
    assert.equal(state.clientOnly, undefined, JSON.stringify(bad));
    assert.equal(state.preferences.homeCountry, "");
    assert.equal(state.preferences.focus, "all");
  }
  const state = normalizeHomeState({ preferences: { homeCountry: "BRA" }, season: "2026/2027" });
  assert.deepEqual(decodeHomeState(encodeHomeState(state)), state);
  const cookie = `vega.home.v1=${encodeHomeState(state)}`;
  assert.equal(guard({ cookie, preferences: JSON.stringify({ homeCountry: "BRA" }), pages: JSON.stringify({ "/": "2026/2027" }) }), undefined);
  assert.equal(guard({ cookie, preferences: JSON.stringify({ homeCountry: "FRA" }), pages: JSON.stringify({ "/": "2026/2027" }) }), "true");
  // A cookie written before VI-48 (no homeCountry) and a browser without a choice still match.
  const before = `vega.home.v1=${encodeURIComponent(JSON.stringify({ v: 1, state: { preferences: { focus: "europe", defaultSeason: "", favoriteLeagueIds: [], onboardingComplete: false }, season: "", personalTeams: [], personalPlayers: [] } }))}`;
  assert.equal(guard({ cookie: before, preferences: JSON.stringify({ focus: "europe" }) }), undefined);
});
