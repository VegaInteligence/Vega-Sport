import test from "node:test";
import assert from "node:assert/strict";
import { reactFixtures } from "./react-runtime.mjs";

const { renderSeasonSearch, renderSeasonProfile, seedPlayerHonours } =
  await reactFixtures();
const rows = [
  {
    id: "m_1:p_1",
    playerId: "p_1",
    matchId: "m_1",
    name: "Neymar",
    teamId: "brazil",
    team: "Brazil",
    league: "World Cup",
    date: "2026-07-05",
    positionId: 3,
    minutes: 23,
    goals: 1,
    assists: 0,
    xg: 0.81,
    xa: 0.01,
    rating: 7.19,
  },
  {
    id: "m_2:p_1",
    playerId: "p_1",
    matchId: "m_2",
    name: "Neymar",
    teamId: "brazil",
    team: "Brazil",
    league: "World Cup",
    date: "2026-06-29",
    positionId: 3,
    minutes: 14,
    goals: 0,
    assists: 0,
    xg: 0.01,
    xa: 0.07,
    rating: 6.17,
  },
];
const matches = [
  {
    id: "m_1",
    home: { id: "brazil", name: "Brazil", score: 1 },
    away: { id: "norway", name: "Norway", score: 2 },
  },
  {
    id: "m_2",
    home: { id: "portugal", name: "Portugal", score: 1 },
    away: { id: "brazil", name: "Brazil", score: 2 },
  },
];

test("search presents one navigable player for multiple match performances", () => {
  const html = renderSeasonSearch(rows, "neymar");
  assert.match(html, /Joueurs trouvés/);
  assert.equal((html.match(/>Neymar<\/strong>/g) || []).length, 1);
  assert.match(html, /\/joueurs\/?\?id=p_1/);
});

test("season overview offers a radar and a shortcut to the detailed statistics", () => {
  const html = renderSeasonProfile(rows, matches, "p_1");
  assert.match(html, /Neymar/);
  assert.match(html, /Profil statistique/);
  assert.match(html, /<svg[^>]+aria-label="Radar des rangs du joueur/);
  assert.match(html, /<text[^>]*>Passes décisives<tspan[^>]*>—<\/tspan>/);
  assert.match(html, /Voir les statistiques détaillées/);
  assert.doesNotMatch(html, /Statistiques à afficher|Temps de jeu et note/);
  assert.doesNotMatch(html, /centiles au poste|Modèle du radar/);
  assert.doesNotMatch(
    html,
    /Matchs joués|Dernières performances|>Norway<|>Portugal</,
  );
  assert.doesNotMatch(html, />Brazil<|>World Cup<| · Brazil<| · World Cup</);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("Messi keeps his portrait and published trophies when filters leave no matches", async () => {
  const id = "p_1mZO3B";
  await seedPlayerHonours(id, "Lionel Messi", {
    available: true,
    honours: [
      {
        category: "team",
        name: "FIFA World Cup",
        team: "Argentina",
        seasons: ["2022"],
      },
      { category: "individual", name: "Ballon d'Or", seasons: ["2023"] },
    ],
  });
  const html = renderSeasonProfile([], [], id);
  assert.match(html, /Lionel Messi/);
  assert.match(html, /<img[^>]+api\/assets\?url=/);
  assert.match(html, /aria-label="Palmarès de Lionel Messi"/);
  assert.match(html, /\/trophies\/world-cup\.webp/);
  assert.match(html, /\/trophies\/ballon-or\.webp/);
  assert.match(html, /Voir les statistiques détaillées/);
});

test("Yamal's Liga and Euro artwork remain clickable", async () => {
  const id = "p_2e0FPo";
  const name = "Lamine Yamal";
  await seedPlayerHonours(id, name, {
    available: true,
    sourceUrl: "https://en.wikipedia.org/wiki/Lamine_Yamal#Honours",
    honours: [
      {
        category: "team",
        name: "La Liga",
        team: "Barcelona",
        seasons: ["2022–23", "2024–25", "2025–26"],
      },
      {
        category: "team",
        name: "UEFA European Championship",
        team: "Spain",
        seasons: ["2024"],
      },
    ],
  });
  const html = renderSeasonProfile(
    [{ ...rows[0], playerId: id, name }],
    matches,
    id,
  );
  assert.match(html, /<button[^>]+aria-label="Liga, 3 titres, FC Barcelone"/);
  assert.match(html, /src="\/trophies\/liga-current\.webp"/);
  assert.match(html, /<button[^>]+aria-label="Euro, Espagne"/);
  assert.match(html, /src="\/trophies\/euro-modern\.webp"/);
  assert.match(html, /FC Barcelone · 2025–26, 2024–25, 2022–23/);
  assert.doesNotMatch(html, /Faire défiler les trophées|Trophées suivants/);
  assert.doesNotMatch(
    html,
    /Source du palmarès|Palmarès sur Wikipédia|wikipedia\.org/,
  );
});
