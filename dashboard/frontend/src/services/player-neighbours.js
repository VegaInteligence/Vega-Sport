/**
 * The players whose whole statistical profile of a season is the closest to a player's
 * (/api/players/{id}/similar): neighbours on the axes learnt from every statistic of the
 * season's players, not on a chosen list of them.
 */
import { useResource, json } from "./resources.js";

/** What the card shows of each neighbour: who, where, and how close. */
export function neighbourRows(answer) {
  return (answer?.similar || [])
    .filter((player) => player?.id && player.name)
    .map((player) => ({
      id: player.id,
      name: player.name,
      imageUrl: player.image_url || null,
      similarity: Number.isFinite(player.similarity) ? player.similarity : null,
      // His Vega score beside the club: the neighbours are close in style, not in level.
      context: [player.team?.name, player.position, Number.isFinite(player.score) ? `Indice ${Math.round(player.score)}` : null]
        .filter(Boolean)
        .join(" · "),
    }));
}

/** A player's neighbours of a season: null without any, undefined while they load. */
export function usePlayerNeighbours(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `player-neighbours:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/players/${encodeURIComponent(id)}/similar?` + new URLSearchParams({ season }))
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
