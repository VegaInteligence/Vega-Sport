// The home's season scorers and assist providers: a row opens the player's page (/joueurs/?id=…), not the
// performance of his last match (hugo, 2026-11-25).
import test from "node:test";
import assert from "node:assert/strict";
import { React, compile, renderToStaticMarkup } from "./support/render-component.mjs";

const h = React.createElement;
const link = { __esModule: true, default: ({ href, children, ...props }) => h("a", { href, ...props }, children) };
const opened = [];
const football = {
  href: (page, params = {}) => `${page}?${new URLSearchParams(params)}`,
  setPlayer: (id) => opened.push(id),
  filters: {},
  season: "2026/2027",
};

const { SeasonScorers } = await compile("components/HomePlayers.jsx", {
  "next/link": link,
  "./PhoneFold.jsx": { PhoneFoldToggle: () => null, usePhoneFold: () => ({}) },
  "./Icon.jsx": { __esModule: true, default: () => null },
  "./UI.jsx": { Media: () => null, Segments: () => null },
  "./HoverCard.jsx": { useHoverBubble: () => ({}) },
  "../services/resources.js": { json: async () => ({}), useResource: () => ({}) },
  "./MatchTabs.module.css": {},
  "./Hint.jsx": { Term: ({ children }) => children },
  "../hooks/FootballContext.jsx": { useFootball: () => football },
  "../services/format.js": { number: String },
  "./HomeCommon.jsx": { Kicker: ({ children }) => h("span", null, children), lastName: String, matchHref: () => "", relativeDay: String, shortDay: String },
  "../services/player-leaderboard.js": { playerLeaderboardHref: () => "/joueurs/" },
  "../services/home-insights.js": { matchDay: () => "", weekPeriodLabel: () => "" },
});

const leader = (playerId, goals) => ({ playerId, lastId: `m_last:${playerId}`, name: playerId, team: "Club", goals, assists: 1, xg: goals - 1, xa: 1, apps: 10 });

test("each scorer row links to the player's page by player id, not to his last match", () => {
  const leaders = { goals: [leader("p_a", 9), leader("p_b", 8)], assists: [] };
  const html = renderToStaticMarkup(h(SeasonScorers, { leaders }));
  const rows = [...html.matchAll(/<li[^>]*data-player-id="([^"]+)"[^>]*><a href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(rows, [
    ["p_a", "/joueurs/?id=p_a"],
    ["p_b", "/joueurs/?id=p_b"],
  ]);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /m_last:/);
  assert.deepEqual(opened, []);
});
