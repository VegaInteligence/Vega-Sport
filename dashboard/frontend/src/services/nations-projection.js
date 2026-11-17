/**
 * The Nations League's projection (125), read by edition: League A's from its own edition (groups
 * « 1 » to « 4 », then its quarter-finals and Final Four), Leagues B to D from theirs (groups « B1 »,
 * « C2 »…). One league's rows and the columns the site shows for it.
 */
import { useResource, json } from "./resources.js";
import { cupId } from "./api-routes.js";
import { useSeasonProjection } from "./forecasts.js";

// League A: the group's outcomes, then the knockout rounds. 2026–27 is transitional (three leagues of 18 from
// 2028–29): the A/B play-off is for the two worst third-placed and the two best fourth-placed, the relegation for the
// two worst fourth-placed (126).
const LEAGUE_A = [
  { key: "qf", label: "Quarts", range: "1er ou 2e", tone: "ko", title: "Part des simulations où la sélection finit dans les deux premiers de son groupe" },
  { key: "barrage", label: "Barrage", range: "A/B", tone: "po", title: "Part des simulations où la sélection joue le barrage contre un deuxième de Ligue B" },
  { key: "relegated", label: "Relégation", range: "directe", tone: "out", title: "Part des simulations où la sélection descend directement en Ligue B" },
  { key: "sf", label: "Final Four", tone: "round", title: "Part des simulations où la sélection joue le Final Four" },
  { key: "final", label: "Finale", tone: "round", title: "Part des simulations où la sélection joue la finale" },
  { key: "win", label: "Vainqueur", tone: "round", title: "Part des simulations où la sélection gagne la compétition" },
];
const PLACES = [["first", "1er"], ["second", "2e"], ["third", "3e"], ["fourth", "4e"]];
const STAGES = ["first", "second", "third", "fourth", "qf", "sf", "final", "win", "stay", "barrage", "relegated"];

const inLeague = (group, league) => (league === "A" ? /^\d+$/.test(group || "") : String(group || "").startsWith(league));
const byShares = (keys) => (a, b) => keys.reduce((d, k) => d || b.stages[k] - a.stages[k], 0) || b.points - a.points || String(a.name).localeCompare(String(b.name));

/** League `league`'s rows (League A: the likeliest winner first; B to D: group by group) and its columns. */
export function nationsProjectionRows(projection, league) {
  const rows = (projection?.format === "nations" ? projection.teams || [] : [])
    .filter((t) => inLeague(t.group, league))
    .map((t) => ({ id: t.id, name: t.name, imageUrl: t.imageUrl ?? null, group: t.group, points: t.points, played: t.played, elo: t.elo ?? null,
      stages: Object.fromEntries(STAGES.map((k) => [k, Number(t.stages?.[k]) || 0])) }));
  if (!rows.length) return { rows: [], columns: [] };
  if (league === "A") return { rows: rows.sort(byShares(["win", "final", "sf", "qf", "stay", "barrage"])), columns: LEAGUE_A };
  const counts = rows.reduce((m, r) => m.set(r.group, (m.get(r.group) || 0) + 1), new Map());
  const size = Math.max(...counts.values());
  const columns = PLACES.slice(0, Math.min(size, PLACES.length)).map(([key, label], i) => ({ key, label, tone: i === 0 ? "ko" : "po", title: `Part des simulations où la sélection finit ${label} de son groupe` }));
  const order = byShares(PLACES.map(([k]) => k));
  return { rows: rows.sort((a, b) => a.group.localeCompare(b.group) || order(a, b)), columns };
}

/** The projection of the edition that holds `league`, or null (none yet: a nation is not rated, or the groups are over). */
export function useNationsProjection(league, season) {
  const kind = league === "A" ? "openligadb" : "nations-results";
  const id = useResource(`nations-projection-id:${kind}`, () => cupId(kind, "nations-league", json).catch(() => null), true).value;
  return useSeasonProjection(id || null, season);
}
