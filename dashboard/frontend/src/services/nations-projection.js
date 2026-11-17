/**
 * The Nations League's projection (125), read by edition: League A's from its own edition (groups
 * « 1 » to « 4 », then its quarter-finals and Final Four), Leagues B to D from theirs (groups « B1 »,
 * « C2 »…). One league's rows and the columns the site shows for it.
 */
import { useResource, json } from "./resources.js";
import { cupId } from "./api-routes.js";
import { useSeasonProjection } from "./forecasts.js";

// The 2026–27 season is transitional (three leagues of 18 from 2028–29; 126, mockup validated 17 Nov 2026). League A:
// the quarter-finals, who stays, plays the A/B play-off or goes down, its league in 2028–29, then the Final Four.
const share = (what) => `Part des simulations où la sélection ${what}`;
const LEAGUE_A = [
  { key: "qf", label: "Quarts", range: "1er ou 2e", tone: "ko", start: true, title: share("finit dans les deux premiers de son groupe") },
  { key: "stay", label: "Maintien", range: "3e", tone: "po", title: share("reste en Ligue A comme l’un des deux meilleurs troisièmes") },
  { key: "barrage", label: "Barrage", range: "A/B", tone: "barrage", title: share("joue le barrage contre un deuxième de Ligue B") },
  { key: "relegated", label: "Relégation", range: "directe", tone: "out", title: share("descend directement en Ligue B") },
  { key: "next_a", label: "En A", range: "2028–29", tone: "ko", start: true, title: share("joue en Ligue A en 2028–29") },
  { key: "sf", label: "Final Four", tone: "round", start: true, title: share("joue le Final Four") },
  { key: "final", label: "Finale", tone: "round", title: share("joue la finale") },
  { key: "win", label: "Vainqueur", tone: "round", title: share("gagne la compétition") },
];
// League A replayed alone (Leagues B and C not rated): its places, no play-off.
const LEAGUE_A_ALONE = [
  LEAGUE_A[0],
  { key: "third", label: "3e", tone: "po", title: share("finit troisième de son groupe") },
  { key: "fourth", label: "4e", tone: "out", title: share("finit dernière de son groupe") },
  ...LEAGUE_A.slice(5),
];
// Leagues B to D: what each place leads to, then the league in 2028–29.
const PLACES = ["first", "second", "third", "fourth"], NAMES = ["1er", "2e", "3e", "4e"];
const OUTCOMES = {
  B: [["monte", "ko"], ["barrage A/B", "barrage"], ["reste", "po"], ["barrage B/C", "barrage"]],
  C: [["monte", "ko"], ["barrage B/C", "barrage"], ["reste", "po"], ["reste", "po"]],
  D: [["monte", "ko"], ["monte", "ko"], ["monte", "ko"], ["monte", "ko"]],
};
const NEXT = { B: ["next_a", "next_b", "next_c"], C: ["next_b", "next_c"], D: ["next_c"] };
const NEXT_TONES = { 3: ["ko", "po", "out"], 2: ["ko", "po"], 1: ["ko"] };
const STAGES = ["first", "second", "third", "fourth", "qf", "sf", "final", "win", "stay", "barrage", "relegated", "promoted", "next_a", "next_b", "next_c"];

const inLeague = (group, league) => (league === "A" ? /^\d+$/.test(group || "") : String(group || "").startsWith(league));
const byShares = (keys) => (a, b) => keys.reduce((d, k) => d || b.stages[k] - a.stages[k], 0) || b.points - a.points || String(a.name).localeCompare(String(b.name));
const any = (rows, keys) => rows.some((r) => keys.some((k) => r.stages[k] > 0));

/** League `league`'s rows (League A: the likeliest winner first; B to D: group by group) and its columns. */
export function nationsProjectionRows(projection, league) {
  const rows = (projection?.format === "nations" ? projection.teams || [] : [])
    .filter((t) => inLeague(t.group, league))
    .map((t) => ({ id: t.id, name: t.name, imageUrl: t.imageUrl ?? null, group: t.group, points: t.points, played: t.played, elo: t.elo ?? null,
      stages: Object.fromEntries(STAGES.map((k) => [k, Number(t.stages?.[k]) || 0])) }));
  if (!rows.length) return { rows: [], columns: [] };
  const season = any(rows, ["next_a", "next_b", "next_c"]);
  if (league === "A") return { rows: rows.sort(byShares(["win", "final", "sf", "qf", "stay", "barrage"])), columns: season ? LEAGUE_A : LEAGUE_A_ALONE };
  const counts = rows.reduce((m, r) => m.set(r.group, (m.get(r.group) || 0) + 1), new Map());
  const size = Math.min(Math.max(...counts.values()), PLACES.length);
  const outcomes = OUTCOMES[league] || [];
  const places = PLACES.slice(0, size).map((key, i) => ({ key, label: NAMES[i], ...(outcomes[i] && { range: outcomes[i][0] }), tone: outcomes[i]?.[1] ?? (i ? "po" : "ko"),
    ...(i === 0 && { start: true }), title: share(`finit ${NAMES[i]} de son groupe`) }));
  const nextKeys = season ? NEXT[league] || [] : [];
  const next = nextKeys.map((key, i) => ({ key, label: `En ${key.slice(-1).toUpperCase()}`, ...(i === 0 && { range: "2028–29", start: true }),
    tone: NEXT_TONES[nextKeys.length][i], title: share(`joue en Ligue ${key.slice(-1).toUpperCase()} en 2028–29`) }));
  const order = byShares(PLACES);
  return { rows: rows.sort((a, b) => a.group.localeCompare(b.group) || order(a, b)), columns: [...places, ...next] };
}

/** The projection of the edition that holds `league`, or null (none yet: a nation is not rated, or the groups are over). */
export function useNationsProjection(league, season) {
  const kind = league === "A" ? "openligadb" : "nations-results";
  const id = useResource(`nations-projection-id:${kind}`, () => cupId(kind, "nations-league", json).catch(() => null), true).value;
  return useSeasonProjection(id || null, season);
}
