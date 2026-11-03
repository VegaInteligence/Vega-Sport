// Images are deliberately matched to a specific trophy, not inferred from
// a generic word such as "cup". See docs/TROPHY_IMAGE_CREDITS.md.
const ART = {
  "copa america": "copa-america.jpg",
  finalissima: "finalissima.png",
  "jeux olympiques": "olympic-2008.jpg",
  "ligue des champions": "champions-league.png",
  "uefa champions league": "champions-league.png",
  "copa del rey": "copa-del-rey.jpg",
  "coupe du roi": "copa-del-rey.jpg",
  "spanish copa del rey": "copa-del-rey.jpg",
  "supercoupe d espagne": "spanish-supercup.png",
  "spanish super cup": "spanish-supercup.png",
  "supercoupe de l uefa": "uefa-supercup.jpg",
  "uefa super cup": "uefa-supercup.jpg",
  "coupe intercontinentale de la fifa": "intercontinental-2024.png",
  "fifa intercontinental cup": "intercontinental-2024.png",
  "mls cup": "mls-cup.png",
  "american mls cup": "mls-cup.png",
  "supporters shield": "supporters-shield.png",
  "american mls supporters shield": "supporters-shield.png",
  "ballon d or": "ballon-or.jpg",
  "the best fifa": "fifa-best.png",
  "the best fifa men s player": "fifa-best.png",
  "soulier d or europeen": "golden-shoe.jpg",
  "european golden shoe": "golden-shoe.jpg",
  "premier league": "premier-league.png",
  "english premier league": "premier-league.png",
  "ligue europa": "europa-league.jpg",
  "uefa europa league": "europa-league.jpg",
  "fa cup": "fa-cup.jpg",
  "english fa cup": "fa-cup.jpg",
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

export function trophyArt(item, playerId) {
  const name = normalize(item?.title);
  const year = latestStart(item?.years);
  let file = ART[name];
  if (["coupe du monde", "fifa world cup"].includes(name))
    file = year !== null && year >= 1974 ? "world-cup.jpg" : null;
  if (["liga", "spanish la liga", "la liga"].includes(name))
    file =
      (year !== null && year < 2023) ||
      (year === null && playerId === "p_1mZO3B")
        ? "liga.jpg"
        : null;
  if (["ligue 1", "french ligue 1"].includes(name))
    file =
      year === null
        ? null
        : year >= 2024
          ? "ligue1-2024.png"
          : "ligue1-classic.png";
  if (["coupe du monde des clubs", "fifa club world cup"].includes(name))
    file =
      year === null
        ? null
        : year >= 2025
          ? "club-world-cup-2025.png"
          : "club-world-cup.jpg";
  if (["jeux olympiques"].includes(name) && year !== 2008) file = null;
  return file ? `/trophies/${file}` : null;
}
