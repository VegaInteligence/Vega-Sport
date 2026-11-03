export const MESSI_ID = "p_1mZO3B";

// Principal honours verified against FIFA, UEFA, FC Barcelona and MLS.
// https://www.fcbarcelona.com/en/news/2208549/the-most-decorated-player-in-barca-history/featured
// https://www.fifa.com/en/the-best-fifa-football-awards/articles/the-world-cup-the-best-and-all-of-lionel-messis-trophy-wins
// https://www.mlssoccer.com/competitions/campeones-cup/news/lionel-messi-lifts-record-48th-trophy-as-inter-miami-win-campeones-cup
// https://www.uefa.com/ballondor/news/0287-195e642735da-0594342b9554-1000--history-of-the-ballon-d-or-all-the-winners/
export const MESSI_HONOURS = [
  {
    group: "Argentine",
    items: [
      { title: "Coupe du monde", count: 1, years: "2022" },
      { title: "Copa América", count: 2, years: "2021, 2024" },
      { title: "Finalissima", count: 1, years: "2022" },
      { title: "Jeux olympiques", count: 1, years: "2008" },
      { title: "Coupe du monde U20", count: 1, years: "2005" },
    ],
  },
  {
    group: "FC Barcelone",
    items: [
      {
        title: "Ligue des champions",
        count: 4,
        years: "2006, 2009, 2011, 2015",
      },
      { title: "Liga", count: 10 },
      { title: "Coupe du Roi", count: 7 },
      { title: "Supercoupe d’Espagne", count: 8 },
      {
        title: "Coupe du monde des clubs",
        count: 3,
        years: "2009, 2011, 2015",
      },
      { title: "Supercoupe de l’UEFA", count: 3, years: "2009, 2011, 2015" },
    ],
  },
  {
    group: "Paris Saint-Germain",
    items: [
      { title: "Ligue 1", count: 2, years: "2021/2022, 2022/2023" },
      { title: "Trophée des champions", count: 1, years: "2022" },
    ],
  },
  {
    group: "Inter Miami",
    items: [
      { title: "Campeones Cup", count: 1, years: "2026" },
      { title: "MLS Cup", count: 1, years: "2025" },
      { title: "Supporters’ Shield", count: 1, years: "2024" },
      { title: "Leagues Cup", count: 1, years: "2023" },
    ],
  },
  {
    group: "Distinctions individuelles",
    items: [
      {
        title: "Ballon d’Or",
        count: 8,
        years: "2009, 2010, 2011, 2012, 2015, 2019, 2021, 2023",
      },
      { title: "The Best FIFA", count: 3, years: "2019, 2022, 2023" },
      {
        title: "Soulier d’or européen",
        count: 6,
        years: "2010, 2012, 2013, 2017, 2018, 2019",
      },
    ],
  },
];

const NATIONALITIES = {
  ARG: "Argentina",
  AUS: "Australia",
  AUT: "Austria",
  BEL: "Belgium",
  BRA: "Brazil",
  CAN: "Canada",
  CHI: "Chile",
  CHN: "China",
  COL: "Colombia",
  CRO: "Croatia",
  CZE: "Czech Republic",
  DEN: "Denmark",
  EGY: "Egypt",
  ENG: "England",
  ESP: "Spain",
  FRA: "France",
  GER: "Germany",
  GHA: "Ghana",
  GRE: "Greece",
  IRL: "Ireland",
  ITA: "Italy",
  JPN: "Japan",
  KOR: "South Korea",
  MAR: "Morocco",
  MEX: "Mexico",
  NED: "Netherlands",
  NGA: "Nigeria",
  NOR: "Norway",
  PAR: "Paraguay",
  POL: "Poland",
  POR: "Portugal",
  ROU: "Romania",
  RSA: "South Africa",
  RUS: "Russia",
  SCO: "Scotland",
  SEN: "Senegal",
  SRB: "Serbia",
  SUI: "Switzerland",
  SWE: "Sweden",
  TUR: "Turkey",
  UKR: "Ukraine",
  URU: "Uruguay",
  USA: "United States",
  WAL: "Wales",
};
const TITLES = {
  "FIFA World Cup": "Coupe du monde",
  "UEFA Champions League": "Ligue des champions",
  "UEFA Europa League": "Ligue Europa",
  "French Ligue 1": "Ligue 1",
  "English Premier League": "Premier League",
  "Spanish La Liga": "Liga",
  "German Bundesliga": "Bundesliga",
  "Italian Serie A": "Serie A",
  "European Golden Shoe": "Soulier d’or européen",
  "FIFA FIFPro World XI": "Équipe mondiale FIFA FIFPRO",
};
const normalized = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
async function read(url, fetcher) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error("Palmarès momentanément indisponible.");
  return response.json();
}

/** Resolve an exact footballer and nationality before showing external honours. */
export async function loadPlayerHonours(id, expectedName, fetcher = fetch) {
  if (id === MESSI_ID) return { groups: MESSI_HONOURS, partial: true };
  if (!/^p_[A-Za-z0-9]{6}$/.test(id || ""))
    return { groups: [], partial: true };
  const identity = (await read(`/api/pitchapi/players/${id}`, fetcher)).data;
  const country = NATIONALITIES[identity?.country_code];
  if (!country || normalized(identity?.name) !== normalized(expectedName))
    return { groups: [], partial: true };
  const base = "https://www.thesportsdb.com/api/v1/json/123/";
  const search = await read(
    `${base}searchplayers.php?${new URLSearchParams({ p: identity.name })}`,
    fetcher,
  );
  const candidates = (search.player || []).filter(
    (player) =>
      player.strSport === "Soccer" &&
      normalized(player.strPlayer) === normalized(identity.name) &&
      normalized(player.strNationality) === normalized(country) &&
      /^\d+$/.test(player.idPlayer || ""),
  );
  if (candidates.length !== 1) return { groups: [], partial: true };
  const source = await read(
    `${base}lookuphonours.php?${new URLSearchParams({ id: candidates[0].idPlayer })}`,
    fetcher,
  );
  const groups = new Map();
  for (const item of source.honours || []) {
    if (
      item.idPlayer !== candidates[0].idPlayer ||
      item.strSport !== "Soccer" ||
      !item.strHonour
    )
      continue;
    const group = item.strTeam?.trim() || "Titres";
    // The provider uses its old Club World Cup label for FIFA's 2024
    // Intercontinental Cup. FIFA distinguishes the two competitions.
    const title =
      item.strHonour === "FIFA Club World Cup" && item.strSeason === "2024"
        ? "Coupe intercontinentale de la FIFA"
        : TITLES[item.strHonour] || item.strHonour.trim();
    if (!groups.has(group)) groups.set(group, new Map());
    const titles = groups.get(group);
    if (!titles.has(title)) titles.set(title, new Set());
    if (typeof item.strSeason === "string" && item.strSeason.trim())
      titles.get(title).add(item.strSeason.trim());
  }
  return {
    partial: true,
    groups: [...groups].map(([group, titles]) => ({
      group,
      items: [...titles].map(([title, years]) => ({
        title,
        count: years.size || 1,
        years: [...years].sort().reverse().join(", "),
      })),
    })),
  };
}
