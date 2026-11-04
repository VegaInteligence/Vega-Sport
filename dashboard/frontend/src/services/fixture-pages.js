import { readPages } from "../season_data.js";

/** Return fixtures only once the entire scope has been read at one generation. */
export async function completeFixtures({ day, league, season }) {
  const filters = day
    ? { from: day, to: day, status: "all" }
    : { league, season, status: "all" };
  const pages = await readPages("/api/fixtures", filters);
  const matches = new Map();
  for (const page of pages) {
    if (!Array.isArray(page.matches))
      throw new Error("Page de rencontres invalide.");
    for (const match of page.matches) {
      if (typeof match?.id !== "string" || !match.id)
        throw new Error("Identifiant de rencontre absent.");
      // Older league envelopes can carry the league once for the entire page.
      // Date scopes must keep each fixture's own competition identity.
      const value =
        !day && !match.league && page.league
          ? { ...match, league: page.league }
          : match;
      matches.set(match.id, value);
    }
  }
  return [...matches.values()];
}
