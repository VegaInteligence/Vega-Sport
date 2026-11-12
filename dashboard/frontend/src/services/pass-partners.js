/**
 * A player's passing partners of a season (/api/players/{id}/partners): the team-mates he
 * exchanged the most passes with in the pass networks. The source's network covers each
 * match up to its first substitution.
 */
import { useResource, json } from "./resources.js";

export const PARTNERS_SHOWN = 3;

/** The partners to show: the most exchanged first, with the total of passes exchanged. */
export function partnerRows(partners, count = PARTNERS_SHOWN) {
  return (partners || [])
    .filter((partner) => partner?.id && partner.given + partner.received > 0)
    .map((partner) => ({ ...partner, passes: partner.given + partner.received }))
    .sort((a, b) => b.passes - a.passes || String(a.name).localeCompare(String(b.name)))
    .slice(0, count);
}

/** The partners of a player's season: [] without a network, undefined while it loads. */
export function usePassPartners(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `pass-partners:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/players/${encodeURIComponent(id)}/partners?` + new URLSearchParams({ season }))
        .then((body) => body.data?.partners || [])
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? [] : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return [];
  return resource.value;
}
