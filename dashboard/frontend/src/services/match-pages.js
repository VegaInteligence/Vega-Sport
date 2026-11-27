import { publicApiFetch } from "./public-api-fetch.js";
import { notifyPublicationChanged } from "./publication-change.js";
import { apiUrl } from "../data-url.js";
import { europeFocusIds } from "../../../shared/competition-scope.js";
import { fixtureWeek, parisDay, shiftDay, validDay } from "./fixtures.js";

/** Build one server page; aggregate/season readers are deliberately not used. */
export function matchPageFilters({
  manifest,
  season,
  focus,
  league = "all",
  query = "",
  upcoming = false,
  week,
  now = Date.now(),
}) {
  const europe = europeFocusIds(manifest);
  if (focus === "europe" && league !== "all" && !europe.has(league))
    return null;
  const filters = {
    season,
    status: upcoming ? "upcoming" : "played",
    order: upcoming ? "asc" : "desc",
    limit: "30",
  };
  if (league !== "all") filters.league = league;
  else if (focus === "europe") filters.leagues = [...europe].sort().join(",");
  if (query.trim()) filters.q = query.trim();
  if (upcoming) {
    const today = parisDay(now);
    const selected = fixtureWeek(validDay(week) ? week : today);
    // Stored dates are UTC/provider dates. A Paris Monday can start on Sunday
    // UTC; the calendar applies its existing exact Paris/kickoff predicate.
    filters.from = shiftDay(
      selected.start > today ? selected.start : today,
      -1,
    );
    filters.to = selected.end;
    if (filters.from > filters.to) return null;
  }
  return filters;
}

/**
 * One page of fixtures; `page` is its place in the list (0 for the first).
 *
 * The API refuses (409) a cursor of an older publication: it keeps the list from mixing
 * the pages of two. Such a page, or a page of another publication than `generation` (the
 * one its previous pages hold), is never shown as a refusal: the site re-reads its manifest
 * (publication-change.js), and the list is read again from its first page, with the same
 * filters and order, up to the requested place, all of the publication that first page
 * gives. That page comes marked `restarted`, with `cursors` and `page`, for the list to
 * take its new cursors (PaginatedMatches). Read again once only: refused again, it comes
 * as `{ publicationUnsettled: true }`, for the list to keep its last pages.
 */
export async function readFixturePage(
  filters,
  {
    cursor = null,
    generation = null,
    page = cursor ? 1 : 0,
    signal,
    fetcher = fetch,
  } = {},
) {
  if (!filters)
    return {
      data: { matches: [] },
      pagination: { nextCursor: null, generation: null },
    };
  const body = await readFixtureBody(filters, cursor, { signal, fetcher });
  if (
    body &&
    (generation === null || body.pagination.generation === generation)
  )
    return body;
  notifyPublicationChanged();
  // A first page of a newer publication is itself the restart.
  if (body && !cursor)
    return { ...body, restarted: true, cursors: [null], page: 0 };
  let current = await readFixtureBody(filters, null, { signal, fetcher });
  if (!current) return { publicationUnsettled: true };
  const fresh = current.pagination.generation,
    cursors = [null];
  // Up to the requested place, or the last page if the list is now shorter.
  while (cursors.length <= page && current.pagination.nextCursor) {
    const next = current.pagination.nextCursor;
    current = await readFixtureBody(filters, next, { signal, fetcher });
    if (!current || current.pagination.generation !== fresh)
      return { publicationUnsettled: true };
    cursors.push(next);
  }
  return { ...current, restarted: true, cursors, page: cursors.length - 1 };
}

/** The page's body, or null when its publication was refused (409). */
export async function readFixtureBody(filters, cursor, { signal, fetcher }) {
  const params = new URLSearchParams(filters);
  if (cursor) params.set("cursor", cursor);
  const response = await publicApiFetch(
    apiUrl(`/api/fixtures?${params}`),
    { signal },
    fetcher,
  );
  if (response.status === 409) return null;
  if (!response.ok)
    throw new Error(`Rencontres indisponibles (HTTP ${response.status}).`);
  const body = await response.json();
  if (
    !Array.isArray(body.data?.matches) ||
    body.data.matches.length > Number(filters.limit) ||
    typeof body.pagination?.generation !== "string" ||
    !(
      body.pagination.nextCursor === null ||
      (typeof body.pagination.nextCursor === "string" &&
        body.pagination.nextCursor.length > 0)
    )
  )
    throw new Error("Page de rencontres invalide.");
  return body;
}
