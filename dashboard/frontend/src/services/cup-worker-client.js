import { apiUrl } from "../data-url.js";

/** Read the published edition and merge newer native fixtures from the same backend. */
export async function cupWorkerSnapshot(
  kind,
  competition,
  season,
  fallbackUrl = null,
) {
  const path = apiUrl(
    "/api/cup-snapshot?" + new URLSearchParams({ kind, competition, season }),
  );
  const api =
    fallbackUrl ||
    (kind === "native"
      ? `/api/pitchapi/leagues/${encodeURIComponent(competition)}/matches?season=${encodeURIComponent(season)}&status=all`
      : null);
  if (api && !api.startsWith("/api/"))
    throw new Error("Route de données invalide.");
  const requests = await Promise.allSettled([
    fetch(path),
    api ? fetch(apiUrl(api)) : Promise.resolve(null),
  ]);
  let saved = null,
    fresh = null,
    status = 404;
  if (requests[0].status === "fulfilled") {
    const response = requests[0].value;
    status = response.status;
    if (response.ok) saved = await response.json();
  }
  if (requests[1].status === "fulfilled" && requests[1].value?.ok)
    fresh = await requests[1].value.json();
  if (kind === "native" && Array.isArray(fresh?.data?.matches)) {
    const matches = [
      ...new Map(
        [...(saved?.matches || []), ...fresh.data.matches].map((row) => [
          row.id,
          row,
        ]),
      ).values(),
    ];
    const rounds = { ...(saved?.rounds || {}) };
    for (const match of matches)
      if (match.round_name != null)
        rounds[match.id] = {
          name: String(match.round_name),
          playoff: match.has_playoff === true,
        };
    return { ...saved, matches, rounds };
  }
  const value = fresh || saved;
  if (
    value &&
    Array.isArray(kind === "standings" ? value.tables : value.matches)
  )
    return value;
  const error = new Error(`Données de coupe indisponibles (HTTP ${status}).`);
  error.status = status;
  throw error;
}
