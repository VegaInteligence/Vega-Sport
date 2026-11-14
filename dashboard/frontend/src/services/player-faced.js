/**
 * A goalkeeper's shots on target faced in a season (/api/players/{id}/faced): the goals
 * they were expected to give once struck (xGOT), the goals they gave, and his place among
 * the keepers who faced enough of them.
 */
import { useResource, json } from "./resources.js";

const text = (value, decimals) => value.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const signed = (value, decimals) => `${value > 0 ? "+" : ""}${text(value, decimals)}`;
const plural = (count, one, many) => `${text(count, 0)} ${count < 2 ? one : many}`;
const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);

/** The card's two sentences, or null without a reading. */
export function facedSummary(answer) {
  if (!answer || !(answer.shots > 0) || !Number.isFinite(answer.xgot) || !Number.isFinite(answer.prevented)) return null;
  const place = answer.rank >= 1 && answer.keepers >= 1
    ? ` ${ordinal(answer.rank)} des ${text(answer.keepers, 0)} gardiens à ${answer.minShots} tirs cadrés subis ou plus, par tir.`
    : answer.minShots ? ` Pas de rang sous ${answer.minShots} tirs cadrés subis.` : "";
  return {
    headline: `${plural(answer.shots, "tir cadré subi", "tirs cadrés subis")} · ${plural(answer.goals, "but encaissé", "buts encaissés")}`,
    reading: `Ces tirs valaient ${text(answer.xgot, 1)} buts une fois frappés (xGOT) : ${signed(answer.prevented, 1)} but${Math.abs(answer.prevented) < 2 ? "" : "s"} évité${Math.abs(answer.prevented) < 2 ? "" : "s"}, soit ${signed(answer.per100, 1)} pour 100 tirs cadrés.${place}`,
  };
}

/** A keeper's shots faced of a season: null without any, undefined while they load. */
export function usePlayerFaced(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `player-faced:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/players/${encodeURIComponent(id)}/faced?` + new URLSearchParams({ season }))
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
