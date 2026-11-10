import { publicApiFetch } from "./public-api-fetch.js";
import { completeFixtures } from "./fixture-pages.js";
import { apiUrl } from "../data-url.js";
import { API_V2, cupId, cupPaths } from "./v2-routes.js";

/** Read the published edition and merge newer native fixtures from the same backend. */
export async function cupWorkerSnapshot(
  kind,
  competition,
  season,
  fallbackUrl = null,
  { signal } = {},
) {
  if (fallbackUrl && !fallbackUrl.startsWith("/api/"))
    throw new Error("Route de données invalide.");
  // On v2, a cup of the complementary sources is read by its Vega id (v2-routes.js).
  const v2Cup = API_V2
    ? await cupId(kind, competition, async (url) => {
        const response = await publicApiFetch(apiUrl(url), { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
    : null;
  const paths = v2Cup ? cupPaths(v2Cup, season) : null;
  if (paths) fallbackUrl = paths.edition;
  const path = apiUrl(
    paths?.snapshot ?? "/api/cup-snapshot?" + new URLSearchParams({ kind, competition, season }),
  );
  async function read(url) {
    const response = await publicApiFetch(url, { signal });
    return {
      status: response.status,
      body: response.ok ? await response.json() : null,
    };
  }
  const [savedRequest, freshRequest] = await Promise.allSettled([
    read(path),
    kind === "native"
      ? completeFixtures({ league: competition, season }, { signal }).then(
          (matches) => ({
            status: 200,
            body: { data: { matches } },
          }),
        )
      : fallbackUrl
        ? read(apiUrl(fallbackUrl))
        : null,
  ]);
  signal?.throwIfAborted();
  const saved =
    savedRequest.status === "fulfilled" ? savedRequest.value.body : null;
  const fresh =
    freshRequest.status === "fulfilled" ? freshRequest.value?.body : null;
  const status =
    (freshRequest.status === "fulfilled" && freshRequest.value?.status) ||
    (savedRequest.status === "fulfilled" && savedRequest.value.status) ||
    503;
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
  if (kind === "native" && freshRequest.status === "rejected")
    throw freshRequest.reason;
  const error = new Error(`Données de coupe indisponibles (HTTP ${status}).`);
  error.status = status;
  throw error;
}
