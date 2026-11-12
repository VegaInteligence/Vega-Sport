/**
 * A club's most used passing triangle and its most linked pair
 * (/api/teams/{id}/passing), from the season's pass networks. The source's network covers
 * a match up to its first substitution.
 */
import { useResource, json } from "./resources.js";

const names = (group) => (group?.players || []).map((player) => player.name).filter(Boolean);

/** The card's two figures, or null without a pair. */
export function passingFacts(answer) {
  const facts = [
    answer?.triangle && names(answer.triangle).length === 3 && { label: "Triangle le plus utilisé", passes: answer.triangle.passes, players: names(answer.triangle).join(" · ") },
    answer?.pair && names(answer.pair).length === 2 && { label: "Duo le plus lié", passes: answer.pair.passes, players: names(answer.pair).join(" · ") },
  ].filter(Boolean);
  return facts.length ? facts : null;
}

/** A club's passing circuits of a season: null without any, undefined while they load. */
export function useClubPassing(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `club-passing:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/teams/${encodeURIComponent(id)}/passing?` + new URLSearchParams({ season }))
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
