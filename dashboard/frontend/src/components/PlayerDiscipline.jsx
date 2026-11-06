import React from "react";
import { playerDiscipline } from "../services/player-bio.js";
import styles from "./PlayerBio.module.css";

const CARDS = [
  ["yellow", "Jaunes"],
  ["directRed", "Rouges directs"],
  ["secondYellow", "Deuxièmes jaunes"],
];

export default function PlayerDiscipline({ id, season }) {
  const data = playerDiscipline(id);
  if (
    !data ||
    (season && season.replace(/\/20(?=\d{2}$)/, "/") !== data.season)
  )
    return null;
  const total = (key) =>
    data.competitions.reduce((sum, item) => sum + item[key], 0);
  return (
    <section className={styles.panel} aria-label="Discipline">
      <h3>Cartons en club</h3>
      <p className={styles.source}>
        {data.competitions.map((item) => item.competition).join(" et ")} ·{" "}
        {total("matches")} matchs
      </p>
      <dl className={styles.grid}>
        {CARDS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{total(key)}</dd>
          </div>
        ))}
      </dl>
      <details className="player-profile-source">
        <summary>Détail par compétition</summary>
        <ul>
          {data.competitions.map((item) => (
            <li key={item.competition}>
              <a href={item.source} target="_blank" rel="noreferrer">
                {item.competition}
              </a>{" "}
              · {item.matches} matchs · {item.yellow} jaunes · {item.directRed}{" "}
              rouges directs · {item.secondYellow} deuxièmes jaunes
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
