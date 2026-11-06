// Verified individual facts, with their own attributed source; no inference from team selection.
const BIO = {
  p_2e0FPo: {
    fullName: "Lamine Yamal Nasraoui Ebana",
    height: "178 cm",
    nationality: "Espagne",
    foot: "Gauche",
    position: "Ailier droit",
    heightSource: "https://www.laliga.com/en-GB/player/lamine-yamal",
    identitySource:
      "https://www.uefa.com/uefaeuro/history/news/028d-1ae6f609153f-c6fd5979b4b8-1000--spain-at-euro-2024-fixtures-stats-coach-tickets/",
    nationalitySource:
      "https://ar.uefa.com/european-qualifiers/teams/122--spain/squad/",
    positionSource:
      "https://www.transfermarkt.com/lamine-yamal/profil/spieler/937958/from/",
    observedAt: "6 novembre 2026",
  },
};
// Competition snapshots; not a career or all-competitions total.
const DISCIPLINE = {
  p_2e0FPo: {
    season: "2026/27",
    competitions: [
      {
        competition: "Liga",
        matches: 11,
        yellow: 2,
        directRed: 0,
        secondYellow: 0,
        source: "https://www.laliga.com/en-GB/player/lamine-yamal",
        sourceLabel: "LaLiga",
      },
      {
        competition: "Ligue des champions",
        matches: 4,
        yellow: 0,
        directRed: 0,
        secondYellow: 0,
        source:
          "https://www.uefa.com/uefachampionsleague/clubs/players/250176450/",
        sourceLabel: "UEFA",
      },
    ],
    observedAt: "6 novembre 2026",
  },
};
export const playerBio = (id) => BIO[id] || null;
export const playerDiscipline = (id) => DISCIPLINE[id] || null;
