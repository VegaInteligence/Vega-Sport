const TITLES = {
  "FIFA World Cup": "Coupe du monde",
  "UEFA European Championship": "Euro",
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
export const normalized = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const TEAM_LABELS = {
  barcelona: "FC Barcelone",
  "paris saint germain": "Paris Saint-Germain",
  "inter miami": "Inter Miami",
  spain: "Espagne",
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
