/**
 * « En forme » on /joueurs (VI-39): rises, falls and playing time on the page's season and
 * competitions, read from /api/player-form (backend/api/src/routes/player-form.mjs).
 */
import { json, useResource } from "./resources.js";

export const FORM_TRENDS = [
  ["up", "En hausse"],
  ["down", "En baisse"],
  ["minutes", "Temps de jeu en hausse"],
];
/** The « Forme » filter of Performances: `forme` in the URL; the old « En forme » tab's link
 *  (playersView=form) opens it on the rises. */
export const FORM_FILTERS = [["all", "Toutes"], ...FORM_TRENDS];
export function formFilter(params) {
  const value = params.get("forme");
  if (FORM_TRENDS.some(([key]) => key === value)) return value;
  return params.get("playersView") === "form" ? "up" : "all";
}

export function formUrl(season, leagues = "all") {
  const params = new URLSearchParams({ season });
  if (leagues && leagues !== "all") params.set("leagues", leagues);
  return `/api/player-form?${params}`;
}

export function usePlayerForm(season, leagues) {
  const enabled = /^\d{4}(?:\/\d{4})?$/.test(season || "");
  const url = enabled ? formUrl(season, leagues) : "";
  return useResource(
    `player-form:${url}`,
    () => json(url).then((body) => body.data || null),
    enabled,
  );
}
