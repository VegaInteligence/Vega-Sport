// Effect 5 (#69) as the home renders it (the rules: tests/preference-effects.test.mjs).
//  R5 Home season cards (scorers, finishing): a favourite player not marked → his row carries data-followed (the
//     standings' highlight of saved clubs, styles.css); nobody else's does; no favourite, no mark.
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

async function homePlayers() {
  return compile("components/HomePlayers.jsx", {
    "next/link": link,
    "./PhoneFold.jsx": { PhoneFoldToggle: () => null, usePhoneFold: () => ({}) },
    "./Icon.jsx": { __esModule: true, default: () => null },
    "./UI.jsx": { Media: () => null, Segments: () => null },
    "./HoverCard.jsx": { useHoverBubble: () => ({}) },
    "../services/resources.js": { json: async () => ({}), useResource: () => ({}) },
    "./MatchTabs.module.css": {},
    "./Hint.jsx": { Term: ({ children }) => children },
    "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (u) => u, setPlayer() {}, filters: {}, season: "2026/2027" }) },
    "../services/format.js": { number: String },
    "./HomeCommon.jsx": { Kicker: ({ children }) => h("span", null, children), lastName: String, matchHref: () => "", relativeDay: String, shortDay: String },
    "../services/player-leaderboard.js": { playerLeaderboardHref: () => "/joueurs/" },
    "../services/home-insights.js": { matchDay: () => "", weekPeriodLabel: () => "" },
  });
}
const leader = (playerId, goals) => ({ playerId, lastId: `m:${playerId}`, name: playerId, team: "Club", goals, assists: 1, xg: goals - 1, xa: 1, apps: 10 });
const followed = (html) => [...html.matchAll(/data-player-id="([^"]+)"[^>]*data-followed="true"|data-followed="true"[^>]*data-player-id="([^"]+)"/g)].map((m) => m[1] || m[2]);

test("R5 the home's season cards mark the favourite players", async () => {
  const { SeasonScorers, Finishing } = await homePlayers();
  const leaders = { goals: [leader("p_a", 9), leader("p_fav", 8)], assists: [], clinical: [leader("p_fav", 8), leader("p_b", 5)], wasteful: [] };
  const favourites = new Set(["p_fav"]);
  assert.deepEqual(followed(renderToStaticMarkup(h(SeasonScorers, { leaders, favourites }))), ["p_fav"]);
  assert.deepEqual(followed(renderToStaticMarkup(h(Finishing, { leaders, favourites }))), ["p_fav"]);
  assert.deepEqual(followed(renderToStaticMarkup(h(SeasonScorers, { leaders }))), []);
});

