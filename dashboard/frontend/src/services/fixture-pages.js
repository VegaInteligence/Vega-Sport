import { readPages } from "../season_data.js";
import { apiUrl } from "../data-url.js";
import { readFixturePage } from "./match-pages.js";
import { PUBLICATION_UNAVAILABLE, isExplicitPublication, notifyPublicationChanged } from "./publication-change.js";
import { publicApiFetch } from "./public-api-fetch.js";
import { createResourceCache } from "./resource-cache.js";
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

// One read of a competition's season, shared by every reader of the same publication, league and season (the match
// page's head, its « Classement », the competition pages): FAILURE_MODES_OPTIMISATIONS.md GH129. The last reader
// leaving cancels it.
const seasons = createResourceCache({ maxEntries: 24 });
const SEASON_UNSERVED = Symbol("season read unserved");
const otherPublication = () => Object.assign(new Error(PUBLICATION_UNAVAILABLE), { code: "PUBLICATION_CHANGED" });

// Pinned to the manifest's publication (GH129-i): the API refuses another (409), and an answer of another generation
// (an edge holding an older one) is never kept under the one asked.
async function readSeason(league, season, generation, signal) {
  const response = await publicApiFetch(
    apiUrl("/api/fixtures/season?" + new URLSearchParams({ league, season, generation })),
    { signal },
  );
  // A season longer than the read takes (413), or an API without it: the pages, never a shorter season.
  if ([404, 405, 413, 501].includes(response.status)) return SEASON_UNSERVED;
  if (response.status === 409) throw otherPublication();
  if (!response.ok)
    throw new Error("Données indisponibles (HTTP " + response.status + ").");
  const body = await response.json();
  if (!Array.isArray(body?.data?.matches) || body.meta?.generation == null)
    throw new Error("Page de rencontres invalide.");
  if (String(body.meta.generation) !== generation) throw otherPublication();
  return [body.data];
}

/** Return fixtures only once the entire scope has been read at one generation. A league's season is one read when the
 * manifest says the API serves it (capabilities.seasonFixtures), its pages otherwise.
 *
 * Given the read API's manifest N, every row returned is of N (GH129-m): the season's read and the pages alike, so that
 * no caller keeps another publication's rows under N (MatchNav's `match-nav:…:N`, the football client's fixtures). A
 * page of another publication fails the read as PUBLICATION_CHANGED; a current visitor's site is told, once, to re-read
 * its manifest, whose N+1 its next reads name. A publication the link asks for (?v=N) is shown or fails: no re-read. */
export async function completeFixtures(
  { day, league, season },
  { signal, manifest } = {},
) {
  const filters = day
    ? { from: day, to: day, status: "all" }
    : { league, season, status: "all" };
  const held =
    manifest?.storage === "aws-relational" && manifest.publicationVersion
      ? String(manifest.publicationVersion)
      : null;
  let told = false;
  const tell = () => {
    if (told || isExplicitPublication(held)) return;
    told = true;
    notifyPublicationChanged();
  };
  let pages = null;
  if (!day && league && season && held && manifest.capabilities?.seasonFixtures === true) {
    const key = `season-fixtures:${held}:${league}:${season}`;
    try {
      const read = await seasons.read(key, ({ signal: shared }) => readSeason(league, season, held, shared), { signal });
      if (read !== SEASON_UNSERVED) pages = read;
      else seasons.forget(key);
    } catch (error) {
      if (error?.code !== "PUBLICATION_CHANGED") throw error;
      // Another publication than the manifest's: nothing kept; the manifest is read again, the pages (of N) meanwhile.
      seasons.forget(key);
      tell();
    }
  }
  if (!pages) {
    try {
      pages = await readPages("/api/fixtures", filters, fetch, {
        signal,
        ...(held && { expectedGeneration: held }),
      });
    } catch (error) {
      if (!held || error?.code !== "PUBLICATION_CHANGED") throw error;
      tell();
      throw otherPublication();
    }
  }
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
