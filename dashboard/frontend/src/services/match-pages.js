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

export async function readFixturePage(
  filters,
  { cursor = null, generation = null, signal, fetcher = fetch } = {},
) {
  if (!filters)
    return {
      data: { matches: [] },
      pagination: { nextCursor: null, generation: null },
    };
  const params = new URLSearchParams(filters);
  if (cursor) params.set("cursor", cursor);
  const response = await fetcher(apiUrl(`/api/fixtures?${params}`), { signal });
  // A changed publication requires an explicit reset, never appending or silently
  // retrying through multiple generations until a page happens to succeed.
  if (response.status === 409) return { publicationChanged: true };
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
  if (generation !== null && body.pagination.generation !== generation)
    return { publicationChanged: true };
  return body;
}
