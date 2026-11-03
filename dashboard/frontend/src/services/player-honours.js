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
      { title: "Liga", count: 10, trophyYear: 2018 },
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
  "La Liga": "Liga",
  "Copa del Rey": "Coupe du Roi",
  "Supercopa de España": "Supercoupe d’Espagne",
  "UEFA Super Cup": "Supercoupe de l’UEFA",
  "FIFA Club World Cup": "Coupe du monde des clubs",
  "FIFA World Youth Championship": "Coupe du monde U20",
  "Olympic Games": "Jeux olympiques",
  "Ballon d'Or": "Ballon d’Or",
  "Supporters' Shield": "Supporters’ Shield",
  "Trophée des Champions": "Trophée des champions",
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

const TEAM_LABELS = {
  barcelona: "FC Barcelone",
  "paris saint germain": "Paris Saint-Germain",
  "inter miami": "Inter Miami",
  argentina: "Argentine",
  "argentina u20": "Argentine",
  "argentina u23": "Argentine",
};

/** A projection is a dated, identity-checked source, not a complete career. */
export function projectionGroups(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    if (
      !row?.name ||
      !Array.isArray(row.seasons) ||
      !["team", "individual"].includes(row.category)
    )
      continue;
    const group =
      row.category === "individual"
        ? "Distinctions individuelles"
        : TEAM_LABELS[normalized(row.team)] || row.team || "Titres";
    const title = TITLES[row.name] || row.name;
    if (!groups.has(group)) groups.set(group, new Map());
    const titles = groups.get(group);
    if (!titles.has(title)) titles.set(title, new Set());
    for (const season of row.seasons)
      if (typeof season === "string" && season.trim())
        titles.get(title).add(season.trim());
  }
  return [...groups]
    .map(([group, titles]) => ({
      group,
      items: [...titles]
        .filter(([, years]) => years.size)
        .map(([title, years]) => ({
          title,
          count: years.size,
          years: [...years].sort().reverse().join(", "),
        })),
    }))
    .filter((group) => group.items.length);
}

function editionKey(value) {
  const match = /^(\d{4})[–—/-](\d{2}|\d{4})$/.exec(value.trim());
  if (!match) return value.trim();
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end += Math.floor(start / 100) * 100;
    if (end < start) end += 100;
  }
  return String(end);
}

/** Preserve the verified Messi baseline while admitting newly sourced editions. */
export function mergeMessiHonours(extra) {
  const groups = MESSI_HONOURS.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
  }));
  for (const incoming of extra) {
    let group = groups.find(
      (item) => normalized(item.group) === normalized(incoming.group),
    );
    if (!group) {
      group = { group: incoming.group, items: [] };
      groups.push(group);
    }
    for (const item of incoming.items) {
      const existing = group.items.find(
        (value) => normalized(value.title) === normalized(item.title),
      );
      if (!existing) group.items.push({ ...item });
      else if (existing.years && item.years) {
        const editions = new Map();
        for (const year of [
          ...existing.years.split(","),
          ...item.years.split(","),
        ]) {
          const value = year.trim();
          if (value && !editions.has(editionKey(value)))
            editions.set(editionKey(value), value);
        }
        existing.count = Math.max(existing.count, item.count, editions.size);
        existing.years = [...editions.values()].sort().reverse().join(", ");
      } else if (item.count > existing.count) Object.assign(existing, item);
      else if (!existing.years && item.count === existing.count)
        existing.years = item.years;
    }
  }
  return groups;
}

function wikipediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "en.wikipedia.org"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/** Resolve an exact footballer and nationality before showing external honours. */
export async function loadPlayerHonours(id, expectedName, fetcher = fetch) {
  if (!/^p_[A-Za-z0-9]{6}$/.test(id || ""))
    return { groups: [], partial: true };
  try {
    const response = await fetcher(
      `/api/player-honours?id=${encodeURIComponent(id)}`,
    );
    if (response.ok) {
      const projection = await response.json();
      const groups = projectionGroups(projection?.honours);
      if (projection?.available && groups.length)
        return {
          groups: id === MESSI_ID ? mergeMessiHonours(groups) : groups,
          partial: true,
          sourceUrl: wikipediaUrl(projection.sourceUrl),
          fetchedAt: projection.fetchedAt || null,
        };
    }
  } catch {
    // A missing projection still permits the existing fallbacks.
  }
  if (id === MESSI_ID) return { groups: MESSI_HONOURS, partial: true };
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
