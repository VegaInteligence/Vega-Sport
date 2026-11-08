import test from "node:test";
import assert from "node:assert/strict";
import { reactFixtures } from "./react-runtime.mjs";

const { renderSeasonSearch, renderSeasonProfile, preparePlayerHonoursBootstrap } =
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

test("season overview shows the scout layout without a detailed statistics shortcut", () => {
  const html = renderSeasonProfile(rows, matches, "p_1");
  assert.match(html, /<h1 class="player-profile-name">Neymar<\/h1>/);
  assert.match(html, /<h2>Saison 2026\/2027<\/h2>/);
  assert.match(html, /<span>Passes décisives<\/span><strong>0<\/strong>/);
  assert.match(html, /<h3>Profil statistique<\/h3>/);
  assert.match(html, /<h3>Indice Vega par rôle<\/h3>/);
  assert.match(html, /<h3>Forme récente<\/h3>/);
  // 37 minutes cannot be ranked: the notice replaces percentiles.
  assert.match(html, /37 minutes jouées : les centiles demandent au moins 450/);
  assert.match(html, /aria-label="Note des derniers matchs"/);
  assert.doesNotMatch(html, /Voir les statistiques détaillées/);
  assert.doesNotMatch(html, /Statistiques à afficher|Temps de jeu et note/);
  assert.doesNotMatch(html, /Matchs joués|Dernières performances|>Norway<|>Portugal</);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("Messi keeps his portrait and published trophies when filters leave no matches", async () => {
  const id = "p_1mZO3B";
  const bootstrap = await preparePlayerHonoursBootstrap(id, "Lionel Messi", {
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
  const html = renderSeasonProfile([], [], id, bootstrap);
  assert.match(html, /Lionel Messi/);
  const portrait = html.match(
    /<span class="player-avatar season-player-portrait(?: [^"]*)?"[^>]*>([\s\S]*?<img[^>]*>)/,
  )?.[1];
  assert.ok(
    portrait,
    "the known portrait remains available without match rows",
  );
  assert.match(portrait, /<img[^>]+loading="lazy"/);
  // ApiImage starts on visible intent; SSR must not bypass the shared budget.
  assert.doesNotMatch(portrait, /\ssrc=/);
  assert.match(html, /aria-label="Palmarès de Lionel Messi"/);
  assert.match(html, /\/trophies\/world-cup\.webp/);
  assert.match(html, /\/trophies\/ballon-or\.webp/);
  assert.doesNotMatch(html, /Voir les statistiques détaillées/);
});

test("published trophies remain visible without a player name and an empty result stays empty", async () => {
  const id = "p_123456";
  const bootstrap = await preparePlayerHonoursBootstrap(id, "", {
    available: true,
    honours: [
      {
        category: "team",
        name: "FIFA World Cup",
        team: "Argentina",
        seasons: ["2022"],
      },
    ],
  });
  const html = renderSeasonProfile([], [], id, bootstrap);
  assert.equal((html.match(/class="player-trophy-shelf"/g) || []).length, 1);
  assert.match(html, /aria-label="Palmarès"/);
  assert.match(html, /Coupe du monde/);
  const emptyId = "p_654321";
  const emptyBootstrap = await preparePlayerHonoursBootstrap(emptyId, "", {
    available: false,
  });
  assert.doesNotMatch(
    renderSeasonProfile([], [], emptyId, emptyBootstrap),
    /class="player-trophy-shelf"/,
  );
});

test("unillustrated individual awards remain available without illustrated trophies", async () => {
  const id = "p_123457";
  const bootstrap = await preparePlayerHonoursBootstrap(id, "", {
    available: true,
    displayGroups: [
      {
        group: "Distinctions individuelles",
        items: [{ title: "Prix inconnu", count: 2, years: "2022, 2024" }],
      },
    ],
  });
  const html = renderSeasonProfile([], [], id, bootstrap);
  assert.match(
    html,
    /<details open=""><summary>Autres distinctions \(1\)<\/summary>/,
  );
  assert.match(html, /Prix inconnu × 2 · 2022, 2024/);
  assert.doesNotMatch(html, /class="player-trophy-grid"/);
});

test("Yamal's Liga and Euro artwork remain clickable", async () => {
  const id = "p_2e0FPo";
  const name = "Lamine Yamal";
  const bootstrap = await preparePlayerHonoursBootstrap(id, name, {
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
    bootstrap,
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

test("server profiles use only the honours supplied to their own render", async () => {
  const id = "p_123458";
  const published = await preparePlayerHonoursBootstrap(id, "", {
    available: true,
    honours: [
      {
        category: "team",
        name: "FIFA World Cup",
        team: "Argentina",
        seasons: ["2022"],
      },
    ],
  });
  const empty = await preparePlayerHonoursBootstrap(id, "", {
    available: false,
  });
  const first = renderSeasonProfile([], [], id, published);
  assert.match(first, /class="player-trophy-shelf"/);
  assert.match(first, /Coupe du monde/);
  assert.doesNotMatch(first, /Chargement du palmarès/);
  const second = renderSeasonProfile([], [], id, empty);
  assert.doesNotMatch(second, /player-trophy-shelf|Chargement du palmarès/);
  const unseeded = renderSeasonProfile([], [], id);
  assert.match(unseeded, /Chargement du palmarès/);
  assert.doesNotMatch(unseeded, /player-trophy-shelf|Coupe du monde/);
  assert.equal(renderSeasonProfile([], [], id, published), first);
});
