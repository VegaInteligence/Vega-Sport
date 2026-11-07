import { readPages } from "../season_data.js";
import { readFixturePage } from "./match-pages.js";
import { parisDay, shiftDay } from "./fixtures.js";

/** Overview cards need a few results and upcoming games, not a season calendar. */
export async function competitionFixturePreview(
  { league, season, generation, now = Date.now() },
  { signal, fetcher = fetch } = {},
) {
  const common = { league, season, limit: "30" };
  const pages = await Promise.all([
    readFixturePage(
      { ...common, status: "played", order: "desc" },
      { signal, fetcher, generation: generation || null },
    ),
    readFixturePage(
      {
        ...common,
        status: "upcoming",
        order: "asc",
        from: shiftDay(parisDay(now), -1),
      },
      { signal, fetcher, generation: generation || null },
    ),
  ]);
  if (pages.some((page) => page.publicationChanged)) {
    const error = new Error(
      "La publication a changé. Actualisez les rencontres.",
    );
    error.status = 409;
    throw error;
  }
  return {
    matches: [
      ...new Map(
        pages
          .flatMap((page) => page.data.matches)
          .map((match) => [match.id, match]),
      ).values(),
    ],
    source: "api",
  };
}

/** Return fixtures only once the entire scope has been read at one generation. */
export async function completeFixtures(
  { day, league, season },
  { signal } = {},
) {
  const filters = day
    ? { from: day, to: day, status: "all" }
    : { league, season, status: "all" };
  const pages = await readPages("/api/fixtures", filters, fetch, { signal });
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
