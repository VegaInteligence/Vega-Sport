// Effect 6 (#69) as the Ballon d'Or page renders it (the rules: tests/preference-effects.test.mjs).
//  R6 A favourite player's podium place and row not marked → data-followed on them only; none without favourites.
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

test("R6 the Ballon d'Or marks the favourite players' places", async () => {
  const ranking = Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, playerId: `p_${i + 1}`, teamId: "t_x", name: `P${i + 1}`, team: "Club", position: "A", score: 90 - i }));
  const render = async (players) => {
    const mod = await compile("views/PlayerRankingPage.jsx", {
      "next/link": link,
      "../components/Layout.jsx": { __esModule: true, default: ({ children }) => h("main", null, children) },
      "../components/Icon.jsx": { __esModule: true, default: () => null },
      "../components/BallonDorIcon.jsx": { __esModule: true, default: () => null },
      "../components/UI.jsx": { Media: () => null },
      "../components/Hint.jsx": { Term: ({ children }) => children },
      "../components/SeasonSelect.jsx": { __esModule: true, default: () => null },
      "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (u) => u, season: "2026/2027", manifest: { seasons: [] } }) },
      "../hooks/useFavourites.js": favouritesHook([], players),
      "../services/format.js": { number: String },
      "../services/ballon-dor.js": { useBallonDorRanking: () => ranking, useBreakouts: () => [] },
    });
    const html = renderToStaticMarkup(h(mod.default));
    return [...html.matchAll(/<li[^>]*data-followed="true"[^>]*aria-label="Rang (\d+)/g)].map((m) => Number(m[1]));
  };
  assert.deepEqual(await render(["p_2", "p_12"]), [2, 12]);
  assert.deepEqual(await render([]), []);
});
