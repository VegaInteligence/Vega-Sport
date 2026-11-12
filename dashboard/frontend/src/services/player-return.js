/**
 * The absence a player is coming back from (/api/players/{id}/return), with what the base
 * shows of such returns: playing time comes back over a few matches, the level per 90
 * minutes does not fall.
 */
import { useResource, json } from "./resources.js";

// In French, none and one take the singular.
const plural = (count, one, many) => `${count} ${count < 2 ? one : many}`;
const frenchDate = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
};
const RANKS = ["premier", "deuxième", "troisième"];

/** The card's three sentences, or null when the player is not coming back from anything. */
export function returnSummary(answer) {
  const absence = answer?.absence;
  if (!absence?.days || !answer.matchesBack) return null;
  const back = frenchDate(absence.returnedOn);
  const curve = (answer.curve || [])
    .filter((point) => point.match >= 1 && point.match <= RANKS.length && Number.isFinite(point.share))
    .sort((a, b) => a.match - b.match)
    .map((point) => `${Math.round(point.share * 100)} % au ${RANKS[point.match - 1]}`);
  return {
    headline: `Absent ${plural(absence.days, "jour", "jours")} (${plural(absence.matchesMissed, "match manqué", "matchs manqués")})${back ? `, de retour le ${back}` : ""}`,
    since: `${plural(answer.matchesBack, "match", "matchs")} depuis son retour : ${answer.minutesBack} minutes en moyenne, contre ${answer.usualMinutes} avant l’absence.`,
    base: curve.length
      ? `Dans la base, après une absence de cette durée, un joueur joue ${curve.join(", ")} match de retour, en part de ses minutes habituelles. Son niveau par 90 minutes, lui, ne baisse pas.`
      : null,
  };
}

/** A player's return in progress: null without one, undefined while it loads. */
export function usePlayerReturn(id) {
  const enabled = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || "");
  const resource = useResource(
    `player-return:${id || "none"}`,
    () =>
      json(`/api/players/${encodeURIComponent(id)}/return`)
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
