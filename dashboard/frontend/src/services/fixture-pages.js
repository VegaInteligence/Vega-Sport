import { readPages } from "../season_data.js";
import { readFixturePage } from "./match-pages.js";
import { PUBLICATION_UNAVAILABLE } from "./publication-change.js";
import { parisDay, shiftDay } from "./fixtures.js";

/** Overview cards need a few results and upcoming games, not a season calendar. */
export async function competitionFixturePreview(
  { league, season, generation, now = Date.now() },
  { signal, fetcher = fetch } = {},
) {
  const common = { league, season, limit: "30" };
  const read = (held) =>
    Promise.all([
      readFixturePage(
        { ...common, status: "played", order: "desc" },
        { signal, fetcher, generation: held },
      ),
      readFixturePage(
        {
          ...common,
          status: "upcoming",
          order: "asc",
          from: shiftDay(parisDay(now), -1),
        },
        { signal, fetcher, generation: held },
      ),
    ]);
  // Both first pages of one publication, the site's or a newer one (its manifest is then
  // re-read: readFixturePage). Pages of two publications are read again once.
  const same = (pages) =>
    pages.every((page) => page.pagination) &&
    pages[0].pagination.generation === pages[1].pagination.generation;
  let pages = await read(generation || null);
  if (!same(pages)) pages = await read(null);
  if (!same(pages)) {
    const error = new Error(PUBLICATION_UNAVAILABLE);
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
