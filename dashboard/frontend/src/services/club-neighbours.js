/**
 * The clubs whose style of play is the closest to a club's (/api/teams/{id}/similar): the
 * centiles of ten style axes, each club placed in its own league, across every league of a
 * comparable level, or within one league the visitor picks.
 */
import { useResource, json } from "./resources.js";

/** A club's neighbours of a season; `league` narrows them to one league (its id). */
export function useClubNeighbours(season, id, league = null) {
  const enabled = Boolean(
    /^\d{4}\/\d{4}$/.test(season || "") &&
    /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""),
  );
  const query = new URLSearchParams({ season: season || "" });
  if (league) query.set("league", league);
  return useResource(
    `club-neighbours:${season || "none"}:${id || "none"}:${league || "all"}`,
    () =>
      json(`/api/teams/${encodeURIComponent(id)}/similar?${query}`)
        .then((body) => neighbourRows(body.data))
        // No style centiles for the club this season: nobody to compare it with.
        .catch((error) =>
          /\bHTTP 404\b/.test(error?.message || "")
            ? []
            : Promise.reject(error),
        ),
    enabled,
  );
}

/** A neighbour as a club menu item: its country and league beside its name. */
export function neighbourBrief(club, countryLabel) {
  return {
    id: club.id,
    name: club.name,
    imageUrl: club.imageUrl ?? null,
    meta: [
      club.league?.country && countryLabel(club.league.country),
      club.league?.name,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** What a card shows of each neighbour, in the site's club shape. */
export function neighbourRows(answer) {
  return (answer?.similar || [])
    .filter((club) => club?.id && club.name)
    .map((club) => ({
      id: club.id,
      name: club.name,
      imageUrl: club.image_url || null,
      similarity: club.similarity,
      closest: club.closest || [],
      league: club.league || null,
      position: club.position ?? null,
      record: club.record || null,
    }));
}
