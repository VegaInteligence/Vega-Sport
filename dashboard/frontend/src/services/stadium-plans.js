/**
 * Links to maps or seat views published by clubs, leagues or stadium operators.
 * Keys identify the physical venue, so shared stadiums keep the same plan.
 * URLs are curated; no provider image or seat geometry is copied into StatArena.
 */
const PLANS = {
  Q133566: [
    {
      title: "Plan des tribunes",
      source: "San Siro Stadium",
      detail: "Secteurs et anneaux du stade.",
      url: "https://sansirostadium.com/info/?lang=en",
      format: "Plan",
    },
  ],
  Q270474: [
    {
      title: "Plan des tribunes",
      source: "Lega Serie A",
      detail: "Le plan se trouve dans la rubrique « Mappa ».",
      url: "https://www.legaseriea.it/team/fiorentina/stadium",
      format: "Plan",
    },
  ],
  Q159884: [
    {
      title: "Plan des tribunes",
      source: "AS Roma",
      detail: "Plan des secteurs du stade olympique de Rome.",
      url: "https://www.asroma.com/en/stadium/seating-plan",
      format: "Plan",
    },
  ],
  Q62149: [
    {
      title: "Vue 3D depuis les places",
      source: "Juventus",
      detail:
        "Disponible via la billetterie selon les matchs ; un compte peut être nécessaire.",
      url: "https://www.juventus.com/en/tickets/standard/first-team-men/",
      format: "3D",
    },
  ],
  Q55074091: [
    {
      title: "Plan interactif et vue 3D",
      source: "Tottenham Hotspur",
      detail: "Explorez les tribunes et la vue depuis une section.",
      url: "https://tottenhamhotspur.io-media.com/web/index.html",
      format: "3D",
    },
  ],
  Q163995: [
    {
      title: "Plan des tribunes",
      source: "Arsenal",
      detail: "Plan des blocs de l’Emirates Stadium.",
      url: "https://help.arsenal.com/support/solutions/articles/101000579598-home-tickets",
      format: "Plan",
    },
  ],
  Q45671: [
    {
      title: "Plan des tribunes",
      source: "Liverpool FC",
      detail: "Le plan se trouve dans la rubrique « Anfield Stadium Plan ».",
      url: "https://www.liverpoolfc.com/tickets/lfc-ticket-prices",
      format: "Plan",
    },
  ],
  Q171458: [
    {
      title: "Plan des tribunes",
      source: "Chelsea FC",
      detail: "Plan des blocs de Stamford Bridge.",
      url: "https://www.chelseafc.com/en/seating-plan",
      format: "Plan",
    },
  ],
  Q48159: [
    {
      title: "Plan des tribunes",
      source: "Manchester City",
      detail: "Plan des blocs et des accès au format PDF.",
      url: "https://www.mancity.com/meta/media/kitn1cpz/etihad-map-new.pdf",
      format: "PDF",
    },
  ],
  Q127429: [
    {
      title: "Plans des tribunes",
      source: "Allianz Arena",
      detail: "Plans des niveaux et des blocs de l’Allianz Arena.",
      url: "https://allianz-arena.com/en/arena/site-seatmaps",
      format: "Plans",
    },
  ],
  Q193431: [
    {
      title: "Plan interactif des accès",
      source: "Paris Saint-Germain",
      detail: "Portes, tribunes et services du Parc des Princes.",
      url: "https://map.psg.fr/",
      format: "Plan",
    },
  ],
};

export function stadiumPlans(id) {
  return Object.hasOwn(PLANS, id || "") ? PLANS[id] : [];
}
