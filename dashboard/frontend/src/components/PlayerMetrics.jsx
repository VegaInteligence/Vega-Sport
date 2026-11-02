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
function display(stat) {
  if (stat?.value == null) return { text: "—" };
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

export default function PlayerMetrics({ row }) {
  if (!row?.stats?.length) return <Empty>Statistiques non renseignées.</Empty>;
  return (
    <div className="source-metric-groups">
      {row.stats.map((group, index) => {
        const entries = Object.entries(group.stats || {}).filter(
          ([label]) => !HIDDEN.has(label),
        );
        if (!entries.length) return null;
        return (
          <section key={`${group.key}:${index}`}>
            <h3>{GROUPS[group.key] || group.title || group.key}</h3>
            <dl className="performance-stat-list">
              {entries.map(([label, item]) => {
                const value = display(item.stat);
                return (
                  <div key={label} data-metric-key={item.key || label}>
                    <dt>{LABELS[label] || label}</dt>
                    <dd
                      className={
                        value.text === "—" ? "missing-value" : undefined
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
