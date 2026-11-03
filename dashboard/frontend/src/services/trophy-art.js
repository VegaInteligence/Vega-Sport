// Images are deliberately matched to a specific trophy, not inferred from
// a generic word such as "cup". See docs/TROPHY_IMAGE_CREDITS.md.
const ART = {
  "copa america": "copa-america.webp",
  finalissima: "finalissima.webp",
  "jeux olympiques": "olympic-2008.webp",
  "ligue des champions": "champions-league.webp",
  "uefa champions league": "champions-league.webp",
  "copa del rey": "copa-del-rey.webp",
  "coupe du roi": "copa-del-rey.webp",
  "spanish copa del rey": "copa-del-rey.webp",
  "supercoupe d espagne": "spanish-supercup.webp",
  "spanish super cup": "spanish-supercup.webp",
  "supercoupe de l uefa": "uefa-supercup.webp",
  "uefa super cup": "uefa-supercup.webp",
  "coupe intercontinentale de la fifa": "intercontinental-2024.webp",
  "fifa intercontinental cup": "intercontinental-2024.webp",
  "mls cup": "mls-cup.webp",
  "american mls cup": "mls-cup.webp",
  "supporters shield": "supporters-shield.webp",
  "american mls supporters shield": "supporters-shield.webp",
  "ballon d or": "ballon-or.webp",
  "the best fifa": "fifa-best.webp",
  "the best fifa men s player": "fifa-best.webp",
  "soulier d or europeen": "golden-shoe.webp",
  "european golden shoe": "golden-shoe.webp",
  "premier league": "premier-league.webp",
  "english premier league": "premier-league.webp",
  "ligue europa": "europa-league.webp",
  "uefa europa league": "europa-league.webp",
  "fa cup": "fa-cup.webp",
  "english fa cup": "fa-cup.webp",
  bundesliga: "bundesliga.webp",
  "german bundesliga": "bundesliga.webp",
  "serie a": "serie-a.webp",
  "italian serie a": "serie-a.webp",
  "coupe de la ligue": "coupe-ligue.webp",
  "french league cup": "coupe-ligue.webp",
  "french coupe de la ligue": "coupe-ligue.webp",
};

const normalize = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// The first year of a season identifies which trophy design was in use.
function latestStart(years) {
  const values = [
    ...String(years || "").matchAll(/(?:^|[,;]\s*)((?:19|20)\d{2})/g),
  ].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : null;
}

export function trophyArt(item) {
  const name = normalize(item?.title);
  const year = latestStart(item?.years) ?? item?.trophyYear ?? null;
  let file = ART[name];
  if (["coupe du monde", "fifa world cup"].includes(name))
    file = year !== null && year >= 1974 ? "world-cup.webp" : null;
  if (["liga", "spanish la liga", "la liga"].includes(name))
    file = year !== null && year < 2023 ? "liga.webp" : null;
  if (["ligue 1", "french ligue 1"].includes(name))
    file =
      year === null
        ? null
        : year >= 2024
          ? "ligue1-2024.webp"
          : "ligue1-classic.webp";
  if (["coupe du monde des clubs", "fifa club world cup"].includes(name))
    file =
      year === null
        ? null
        : year >= 2025
          ? "club-world-cup-2025.webp"
          : "club-world-cup.webp";
  if (["jeux olympiques"].includes(name) && year !== 2008) file = null;
  return file ? `/trophies/${file}` : null;
}
