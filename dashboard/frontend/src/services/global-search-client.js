import { publicApiFetch } from "./public-api-fetch.js";
import { apiUrl } from "../data-url.js";

export const hasBoundedSearch = (manifest) =>
  manifest?.storage === "aws-relational" &&
  manifest.capabilities?.boundedSearch === true;

export async function searchIdentities(
  query,
  season,
  { signal, fetcher = fetch } = {},
) {
  const q = query.trim();
  if (q.length < 2 || !season)
    return {
      players: [],
      clubs: [],
      playersHasMore: false,
      clubsHasMore: false,
    };
  const params = new URLSearchParams({ q, season });
  const response = await publicApiFetch(
    apiUrl(`/api/search?${params}`),
    { signal },
    fetcher,
  );
  if (!response.ok)
    throw new Error("La recherche est momentanément indisponible.");
  const body = await response.json();
  if (
    !Array.isArray(body.players) ||
    !Array.isArray(body.clubs) ||
    body.players.length > 6 ||
    body.clubs.length > 4
  )
    throw new Error("Résultats de recherche invalides.");
  return body;
}
