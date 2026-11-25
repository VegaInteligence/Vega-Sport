import React from "react";
import { Empty } from "./UI.jsx";
import { number, isNumber } from "../services/format.js";

export const periodLabel = (period) =>
  ({
    All: "Match entier",
    FirstHalf: "Première mi-temps",
    SecondHalf: "Seconde mi-temps",
    ExtraFirstHalf: "Prolongation · première période",
    ExtraSecondHalf: "Prolongation · seconde période",
  })[period] || period;
export const periodShort = (period) =>
  ({
    All: "Match",
    FirstHalf: "1re mi-temps",
    SecondHalf: "2e mi-temps",
    ExtraFirstHalf: "Prol. 1",
    ExtraSecondHalf: "Prol. 2",
  })[period] || periodLabel(period);

const GROUPS = {
  top_stats: "Chiffres clés",
  attack: "Attaque",
  defense: "Défense",
  duels: "Duels",
  goalkeeping: "Gardien",
  passes: "Passes",
};
// Source labels are English; unknown ones are shown as provided.
const LABELS = {
  "Accurate crosses": "Centres réussis",
  "Accurate long balls": "Passes longues réussies",
  "Accurate passes": "Passes réussies",
  "Acted as sweeper": "Sorties hors de la surface",
  "Aerial duels won": "Duels aériens gagnés",
  Assists: "Passes décisives",
  "Big chances created": "Grosses occasions créées",
  "Big chances missed": "Grosses occasions manquées",
  Blocks: "Tirs bloqués",
  "Blocked shots": "Tirs contrés",
  "Chances created": "Occasions créées",
  "Clearance off the line": "Sauvetages sur la ligne",
  Clearances: "Dégagements",
  "Conceded penalty": "Penaltys concédés",
  Corners: "Corners",
  "Defensive actions": "Actions défensives",
  Dispossessed: "Ballons perdus",
  "Diving save": "Arrêts plongés",
  "Dribbled past": "Dribblé par l’adversaire",
  "Duels lost": "Duels perdus",
  "Duels won": "Duels gagnés",
  "Error led to goal": "Erreurs menant à un but",
  "Expected assists (xA)": "Passes décisives attendues (xA)",
  "Expected goals (xG)": "Buts attendus (xG)",
  "Expected goals on target (xGOT)": "xG cadrés (xGOT)",
  "Fouls committed": "Fautes commises",
  Goals: "Buts",
  "Goals conceded": "Buts encaissés",
  "Goals prevented": "Buts évités",
  "Ground duels won": "Duels au sol gagnés",
  "Headed clearance": "Dégagements de la tête",
  "High claim": "Sorties aériennes",
  "Hit woodwork": "Montants touchés",
  Interceptions: "Interceptions",
  "Last man tackle": "Tacles du dernier défenseur",
  "Line breaking passes": "Passes qui cassent une ligne",
  "Minutes played": "Minutes jouées",
  Offsides: "Hors-jeu",
  "Own goal": "Buts contre son camp",
  "Passes into final third": "Passes dans le dernier tiers",
  "Penalties won": "Penaltys obtenus",
  Punches: "Dégagements du poing",
  Rating: "Note",
  "Vega grade": "Note Vega",
  Recoveries: "Récupérations",
  Saves: "Arrêts",
  "Saves inside box": "Arrêts dans la surface",
  "Shot accuracy": "Précision des tirs",
  "Shots off target": "Tirs non cadrés",
  "Shots on target": "Tirs cadrés",
  "Successful dribbles": "Dribbles réussis",
  Tackles: "Tacles",
  Throws: "Relances à la main",
  "Total shots": "Tirs",
  Touches: "Ballons touchés",
  "Touches in opposition box": "Ballons dans la surface adverse",
  "Was fouled": "Fautes subies",
  "xG + xA": "xG + xA",
  "xG Non-penalty": "xG hors penalty",
  "xGOT faced": "xGOT subis",
};
const HIDDEN = new Set(["Shotmap"]);
const decimalsOf = (stat) =>
  stat.type === "double" ||
  (isNumber(stat.value) && !Number.isInteger(stat.value))
    ? 2
    : 0;
function display(stat, showMissing) {
  if (stat?.value == null) return { text: showMissing ? "Non renseigné" : "—", missing: true };
  if (stat.total != null && isNumber(stat.value) && isNumber(stat.total))
    return {
      text: `${number(stat.value, decimalsOf(stat))}/${number(stat.total, decimalsOf({ value: stat.total }))}`,
      detail:
        stat.total > 0
          ? `${number((stat.value / stat.total) * 100)} %`
          : undefined,
    };
  if (isNumber(stat.value))
    return { text: number(stat.value, decimalsOf(stat)) };
  return { text: String(stat.value) };
}

const DETAIL_ROWS = [
  ["top_stats", "Total shots", "total_shots"],
  ["top_stats", "Expected goals (xG)", "expected_goals"],
  ["attack", "Successful dribbles", "dribbles_succeeded"],
  ["duels", "Was fouled", "was_fouled"],
];

function withMissingRows(groups) {
  const stats = groups.flatMap((group) => Object.values(group.stats || {}));
  // The keeper layout has different shot and duel measures.
  if (stats.some(({ key }) => key === "saves" || key === "goals_conceded")) return groups;
  const byGroup = new Map(groups.map((group) => [group.key, { ...group, stats: { ...group.stats } }]));
  const keys = new Set(stats.map(({ key }) => key));
  for (const [groupKey, label, key] of DETAIL_ROWS) {
    if (keys.has(key)) continue;
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, { key: groupKey, stats: {} });
    byGroup.get(groupKey).stats[label] = { key, stat: { value: null } };
  }
  return [...byGroup.values()];
}

export default function PlayerMetrics({ row, showMissing = false }) {
  if (!row?.stats?.length) return <Empty>Statistiques non renseignées.</Empty>;
  const groups = showMissing ? withMissingRows(row.stats) : row.stats;
  return (
    <div className="source-metric-groups">
      {groups.map((group, index) => {
        const entries = Object.entries(group.stats || {}).filter(
          ([label]) => !HIDDEN.has(label),
        );
        if (!entries.length) return null;
        return (
          <section key={`${group.key}:${index}`}>
            <h3>{GROUPS[group.key] || group.title || group.key}</h3>
            <dl className="performance-stat-list">
              {entries.map(([label, item]) => {
                const value = display(item.stat, showMissing);
                return (
                  <div key={label} data-metric-key={item.key || label}>
                    <dt>{LABELS[label] || label}</dt>
                    <dd
                      className={
                        value.missing ? "missing-value" : undefined
                      }
                    >
                      {value.text}
                      {value.detail && <small>{value.detail}</small>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
