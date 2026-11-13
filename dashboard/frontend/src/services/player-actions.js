/**
 * A player's action values of his league season (/api/players/{id}/actions): three sums
 * of the source that value his actions rather than count them, per 90 minutes of his
 * league, and his place among the players of his role in that league.
 */
import { useResource, json } from "./resources.js";

// The source's names are kept: they are the measures' usual ones.
export const ACTION_LABELS = {
  vaep: ["VAEP", "Ce que ses actions changent aux chances de marquer et d’encaisser"],
  pv: ["Valeur de possession (PV)", "Ce que ses actions ajoutent aux chances que la possession finisse en but"],
  xt: ["Menace attendue (xT)", "Le danger des zones où il amène le ballon"],
};
// The minutes of a league below which the API gives no reading (vega/actions.py).
export const ACTION_MIN_MINUTES = 450;

/**
 * The card's rows, or null without a reading: each value per 90 minutes, its rank and
 * percentile when the role has enough players in the league, and its two parts when the
 * source gives them.
 */
export function actionRows(answer) {
  const values = (answer?.values || []).filter((entry) => ACTION_LABELS[entry.key] && Number.isFinite(entry.value));
  if (!values.length) return null;
  return {
    competition: answer.competition?.name || null,
    position: answer.position || null,
    peers: answer.peers ?? null,
    minutes: answer.minutes ?? null,
    placed: values.some((entry) => Number.isFinite(entry.percentile)),
    rows: values.map((entry) => ({
      key: entry.key,
      label: ACTION_LABELS[entry.key][0],
      hint: ACTION_LABELS[entry.key][1],
      value: entry.value,
      rank: Number.isFinite(entry.percentile) && entry.rank >= 1 ? entry.rank : null,
      percentile: Number.isFinite(entry.percentile) ? Math.round(entry.percentile) : null,
      parts: Number.isFinite(entry.offensive) && Number.isFinite(entry.defensive) ? { offensive: entry.offensive, defensive: entry.defensive } : null,
    })),
  };
}

/** A player's action values of a season: null without any, undefined while they load. */
export function usePlayerActions(season, id) {
  const enabled = Boolean(/^\d{4}\/\d{4}$/.test(season || "") && /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/.test(id || ""));
  const resource = useResource(
    `player-actions:${season || "none"}:${id || "none"}`,
    () =>
      json(`/api/players/${encodeURIComponent(id)}/actions?` + new URLSearchParams({ season }))
        .then((body) => body.data || null)
        .catch((error) => (/\bHTTP 404\b/.test(error?.message || "") ? null : Promise.reject(error))),
    enabled,
  );
  if (!enabled || resource.error) return null;
  return resource.value;
}
