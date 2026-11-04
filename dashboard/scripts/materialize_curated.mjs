import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { normalized, projectionGroups } from "../shared/honour-display.js";
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

export function curatedProjections(source) {
  const body = source ?? { honours: [] };
  // Capture the previous verified display order/counts alongside the original
  // projection. The reader serves both from the same committed SQL generation.
  const extra = body.available ? projectionGroups(body.honours) : [];
  return [
    {
      name: "player-honours",
      params: { id: MESSI_ID },
      body: { ...body, displayGroups: mergeMessiHonours(extra) },
    },
  ];
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const source = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(JSON.stringify(curatedProjections(source)) + "\n");
}
