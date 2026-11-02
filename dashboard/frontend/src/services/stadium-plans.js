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
      imageUrl:
        "https://sansirostadium.com/wp-content/uploads/2026/09/SETTORI-STADIO.jpg",
      format: "Plan",
    },
  ],
  Q270474: [
    {
      title: "Informations sur le stade",
      source: "Lega Serie A",
      detail: "Accès et informations sur le stade.",
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
      imageUrl:
        "https://media.asroma.com/prod/images/original/e43b6e6299dd-xbyid6e4svciedvfklxy.jpg",
      format: "Plan",
    },
  ],
  Q62149: [
    {
      title: "Plan des tribunes",
      source: "Juventus · guide visiteurs Genoa",
      detail: "Plan officiel des secteurs, page 6 du guide 2025/2026.",
      url: "https://genoacfc.it/wp-content/uploads/2026/04/JUVENTUS-vs-GENOA-Informativa-tifosi-ospiti.pdf#page=6&view=Fit&navpanes=0",
      embedded: true,
      format: "PDF",
    },
  ],
  Q55074091: [
    {
      title: "Plan interactif et vue 3D",
      source: "Tottenham Hotspur",
      detail: "Explorez les tribunes et la vue depuis une section.",
      url: "https://tottenhamhotspur.io-media.com/web/index.html",
      embedded: true,
      format: "3D",
    },
  ],
  Q163995: [
    {
      title: "Plan des tribunes",
      source: "Arsenal",
      detail: "Plan des blocs de l’Emirates Stadium.",
      url: "https://help.arsenal.com/support/solutions/articles/101000579323-at-the-stadium",
      imageUrl:
        "https://s3-eu-central-1.amazonaws.com/euc-cdn.freshdesk.com/data/helpdesk/attachments/production/101038969895/original/zGzlntzTDsPbazFTkBD0uUCvHdqR6zTdtg.png",
      format: "Plan",
    },
  ],
  Q45671: [
    {
      title: "Plan des tribunes",
      source: "Liverpool FC",
      detail: "Le plan se trouve dans la rubrique « Anfield Stadium Plan ».",
      url: "https://www.liverpoolfc.com/tickets/lfc-ticket-prices",
      imageUrl:
        "https://contentfulproxy.stadion.io/rm6ms1yxue4m/678V5gJsdOOQ5njOoQgsdY/a2f9f66210cbd0b31ff9a32f9195ac31/PL-2026-2027-Prices-MAP-72.jpg",
      format: "Plan",
    },
  ],
  Q171458: [
    {
      title: "Plan des tribunes",
      source: "Chelsea FC",
      detail: "Plan des blocs de Stamford Bridge.",
      url: "https://www.chelseafc.com/en/seating-plan",
      imageUrl:
        "https://img.chelseafc.com/image/upload/v1689333344/site-sections/tickets/ticket-information/seating-plan-jult23.png",
      format: "Plan",
    },
  ],
  Q48159: [
    {
      title: "Plan des tribunes",
      source: "Manchester City",
      detail: "Plan des blocs et des accès au format PDF.",
      url: "https://www.mancity.com/meta/media/kitn1cpz/etihad-map-new.pdf",
      embedded: true,
      format: "PDF",
    },
  ],
  Q127429: [
    {
      title: "Plans des tribunes",
      source: "Allianz Arena",
      detail: "Plans des niveaux et des blocs de l’Allianz Arena.",
      url: "https://allianz-arena.com/en/arena/site-seatmaps",
      imageUrl:
        "https://img.fcbayern.com/image/upload/f_auto/q_auto/ar_16:9,c_fill,g_custom,w_1024/v1763491993/cms/public/images/fcbayern-com/homepage/tickets/Blockplan_16_9mit_Historie.jpg",
      format: "Plans",
    },
  ],
  Q150928: [
    {
      title: "Plan des tribunes",
      source: "Borussia Dortmund",
      detail: "Blocs et tribunes du Signal Iduna Park.",
      url: "https://www.bvb.de/de/de/signal-iduna-park/stadionbesuch/stadionplan.html",
      imageUrl:
        "https://s7g10.scene7.com/is/image/BORUSSIADORTMUNDGMBHANDCOKGAA/stadionplan_2026?dpr=off&qlt=85&ts=1779781332366",
      format: "Plan",
    },
  ],
  Q207109: [
    {
      title: "Plan des tribunes",
      source: "Ajax",
      detail: "Blocs et accès de la Johan Cruijff ArenA.",
      url: "https://www.ajax.nl/fans/mindervsiueel-wedstrijdbezoek",
      imageUrl:
        "https://www.ajax.nl/media/2zvhmq2a/afbeelding.png?v=1dc99d2ac5473f0",
      format: "Plan",
    },
  ],
  Q193431: [
    {
      title: "Plan interactif des accès",
      source: "Paris Saint-Germain",
      detail: "Portes, tribunes et services du Parc des Princes.",
      url: "https://map.psg.fr/",
      embedded: true,
      allowGeolocation: true,
      format: "Plan",
    },
  ],
};

export function stadiumPlans(id) {
  return Object.hasOwn(PLANS, id || "") ? PLANS[id] : [];
}
