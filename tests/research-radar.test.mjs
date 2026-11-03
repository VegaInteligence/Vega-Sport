import test from "node:test";
import assert from "node:assert/strict";
import { reactFixtures } from "./react-runtime.mjs";
import { cohortMedianPercentiles } from "../dashboard/frontend/src/services/scouting.js";

const { renderResearchRadar } = await reactFixtures();
const axes = ["xg", "chances", "passes", "recoveries", "duels", "surface"].map(
  (key) => ({ key, label: key }),
);
const plot = (values) =>
  renderResearchRadar(axes, [{ name: "Cristiano Ronaldo", values }]);

test("a complete radar renders its filled polygon", () => {
  const html = plot({
    xg: 90,
    chances: 20,
    passes: 30,
    recoveries: 0,
    duels: 40,
    surface: 60,
  });
  assert.match(html, /<polygon[^>]*stroke="#3b8eff"/);
  assert.equal((html.match(/<line[^>]*stroke="#3b8eff"/g) || []).length, 0);
  assert.equal((html.match(/<circle /g) || []).length, 6);
});

test("a radar with missing data joins adjacent known points without inventing the gap", () => {
  const html = plot({
    xg: 90,
    chances: 20,
    passes: 30,
    recoveries: 0,
    duels: null,
    surface: 60,
  });
  assert.doesNotMatch(html, /<polygon[^>]*stroke="#3b8eff"/);
  assert.equal((html.match(/<line[^>]*stroke="#3b8eff"/g) || []).length, 4);
  assert.equal((html.match(/<circle /g) || []).length, 5);
  assert.match(html, /<circle[^>]*cx="200"[^>]*cy="170"/);
  assert.match(html, /Le tracé s’interrompt si une donnée manque/);
});

test("the peer median remains available when the player's own value is missing", () => {
  const profile = { role: { group: "F" } };
  const cohorts = {
    minPeers: 30,
    groups: new Map([
      [
        "F",
        {
          distributions: {
            duelsWon: Array(30).fill(1),
            xg: Array(29).fill(1),
            xa: Array(30).fill(1),
          },
        },
      ],
    ]),
  };
  assert.deepEqual(
    cohortMedianPercentiles(["duelsWon", "xg", "xa"], profile, cohorts),
    { duelsWon: 50 },
  );
});
