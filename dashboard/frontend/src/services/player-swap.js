/**
 * "What if he played in his place": what a club's league results would become if a
 * compared player played in the place of the page's player (/api/forecasts/swap). An
 * estimate from how starting line-ups relate to results; it knows nothing of how a player
 * adapts to another club, league or system.
 */
import { useResource, json } from "./resources.js";

const text = (value, decimals) => value.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const signed = (value, decimals) => `${value > 0 ? "+" : ""}${text(value, decimals)}`;
// In French, a quantity under two takes the singular.
const points = (value, decimals) => `${signed(value, decimals)} ${Math.abs(value) < 2 ? "point" : "points"}`;
const lower = (label) => (label || "").toLowerCase();

/**
 * One line of the block for an answer of the API: a title, the estimate in a sentence and
 * what it comes from; or, without an estimate, why there is none. Null without an answer.
 */
export function swapLine(answer) {
  if (!answer?.out?.name || !answer.in?.name) return null;
  const line = { key: answer.in.id, title: `${answer.in.name} à la place de ${answer.out.name}`, club: answer.club?.name || null };
  if (answer.reason === "goalkeeper")
    return { ...line, text: "Pas d’estimation pour un gardien : l’effet d’un changement de gardien sur les résultats n’a pas pu être mesuré." };
  if (answer.reason === "role")
    return { ...line, text: `Pas d’estimation : au classement, ${answer.in.name} est ${lower(answer.inPosition)} et ${answer.out.name} ${lower(answer.position)}.` };
  if (answer.reason === "minutes") return { ...line, text: "Pas d’estimation : l’un des deux a trop peu joué sur deux saisons pour que son rendement soit lu." };
  const estimate = answer.estimate, league = answer.club?.league;
  if (!estimate || !league || !Number.isFinite(estimate.pointsPerMatch)) return null;
  const season = league.matches >= 2 && Number.isFinite(estimate.pointsPerSeason) ? `, soit ${points(estimate.pointsPerSeason, 1)} sur ses ${league.matches} matchs` : "";
  return {
    ...line,
    estimate: true,
    text: `${points(estimate.pointsPerMatch, 2)} par match de ${league.name}${season}.`,
    detail: `Rendement propre par 90 min : ${signed(answer.in.rate, 2)} contre ${signed(answer.out.rate, 2)}, un écart qui vaut ${signed(estimate.elo, 0)} Elo pour ${answer.club.name}.`,
  };
}

/** The lines to show, with the club they are about: null when no compared player gives one. */
export function swapBlock(answers) {
  const lines = (answers || []).map(swapLine).filter(Boolean);
  return lines.length ? { club: lines.find((line) => line.club)?.club || null, estimated: lines.some((line) => line.estimate), lines } : null;
}

/** The API's answers for the page's player and each compared one: undefined while they load. */
export function usePlayerSwaps(season, out, others) {
  const player = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/;
  const ids = (others || []).filter((id) => player.test(id || "") && id !== out);
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && player.test(out || "") && ids.length);
  const resource = useResource(
    `player-swaps:${season || "none"}:${out || "none"}:${ids.join(",")}`,
    () =>
      Promise.all(
        ids.map((id) =>
          json("/api/forecasts/swap?" + new URLSearchParams({ season, out, in: id })).catch((error) =>
            /\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error),
          ),
        ),
      ),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
