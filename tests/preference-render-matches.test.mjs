// Effect 3 (#69) as the matches page renders it (the rules: tests/preference-effects.test.mjs).
//  R3 Within a day, a favourite club's match is listed after the others → first of its day; the day order and the
//     other days unchanged; without favourites (or a favourite absent) the order of before.
import test from "node:test";
import assert from "node:assert/strict";
import { React, compile, renderToStaticMarkup, src } from "./support/render-component.mjs";

const h = React.createElement;
const effects = await src("services/preference-effects.js");
const favouritesHook = (clubs = [], players = []) => ({
  __esModule: true,
  default: () => ({ clubs: new Set(clubs), players: new Set(players), order: { clubs, players } }),
});
const link = { __esModule: true, default: ({ href, children, ...props }) => h("a", { href, ...props }, children) };

test("R3 the matches page lists a favourite club's match first within its day", async () => {
  const fixture = (id, time, home, away) => ({
    id, status: "not_started", date: time.slice(0, 10), time_utc: time,
    league: { id: "l_4WFCIZ", name: "Premier League" }, home_team: { id: home, name: home }, away_team: { id: away, name: away },
  });
  const fixtures = [
    fixture("early", "2026-11-28T12:30:00Z", "t_a", "t_b"),
    fixture("fav", "2026-11-28T20:00:00Z", "t_c", "t_fav"),
    fixture("next-day", "2026-11-29T15:00:00Z", "t_d", "t_e"),
  ];
  const context = {
    data: { competitions: [], fixtures },
    competitions: [], catalog: [], filters: { query: "", league: "all" }, focus: "all", season: "2026/2027",
    manifest: { defaultSeason: "2026/2027" }, preferences: { favoriteLeagueIds: [] }, href: (url, q) => `${url}?id=${q?.id || ""}`,
  };
  const render = async (clubs) => {
    const mod = await compile("components/UpcomingMatches.jsx", {
      react: { ...React, useState: (v) => React.useState(typeof v === "function" ? () => Date.parse("2026-11-24T08:00:00Z") : v) },
      "next/link": link,
      "next/navigation": { useSearchParams: () => new URLSearchParams("week=2026-11-23") },
      "../hooks/FootballContext.jsx": { useFootball: () => context },
      "../hooks/useFavourites.js": favouritesHook(clubs),
      "../services/preference-effects.js": effects,
      "./UI.jsx": { Media: () => null, Pager: () => null },
      "./Icon.jsx": { __esModule: true, default: () => null },
      "../services/fixtures.js": await src("services/fixtures.js"),
      "../services/competition-identity.js": await src("services/competition-identity.js"),
    });
    const html = renderToStaticMarkup(h(mod.default, {}));
    return [...html.matchAll(/data-fixture-id="([^"]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(await render([]), ["early", "fav", "next-day"]);
  assert.deepEqual(await render(["t_fav"]), ["fav", "early", "next-day"]);
  assert.deepEqual(await render(["t_absent"]), ["early", "fav", "next-day"]);
});

