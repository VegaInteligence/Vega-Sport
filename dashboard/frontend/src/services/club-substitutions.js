/**
 * What follows a club's changes (/api/teams/{id}/substitutions): the points the score at
 * its first substitution of each match would have given, the points it took, and its most
 * decisive substitutes.
 */
import { useResource, json } from "./resources.js";

// In French, none and one take the singular.
const plural = (count, one, many) => `${count} ${count < 2 ? one : many}`;

/** One substitute as a phrase: "Nom (2 buts, 1 passe décisive en 8 entrées)". */
export function substituteLine(player) {
  const parts = [
    player.goals > 0 && plural(player.goals, "but", "buts"),
    player.assists > 0 && plural(player.assists, "passe décisive", "passes décisives"),
  ].filter(Boolean);
  return `${player.name} (${parts.join(", ")} en ${plural(player.entries, "entrée", "entrées")})`;
}

/** The card's four figures, or null without a match to read. */
export function changeFacts(impact) {
  if (!impact?.matches) return null;
  const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
  return [
    {
      label: "Points au premier changement",
      value: impact.pointsThen,
      note: `si chaque score en était resté là · ${plural(impact.matches, "match", "matchs")}`,
    },
    { label: "Points à la fin", value: impact.points, note: `${signed(impact.gained)} après les changements` },
    {
      label: "Mené au premier changement",
      value: impact.behind.matches,
      unit: impact.behind.matches < 2 ? "match" : "matchs",
      note: `${plural(impact.behind.points, "point pris", "points pris")}`,
    },
    {
      label: "Menait au premier changement",
      value: impact.leading.matches,
      unit: impact.leading.matches < 2 ? "match" : "matchs",
      note: `${plural(impact.leading.pointsThen - impact.leading.points, "point perdu", "points perdus")}`,
    },
  ];
}

/** A club's changes of a season: null without any, undefined while they load. */
export function useClubSubstitutions(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `club-substitutions:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/teams/${encodeURIComponent(id)}/substitutions?` + new URLSearchParams({ season }))
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
