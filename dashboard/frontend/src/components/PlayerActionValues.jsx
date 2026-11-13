"use client";
import React, { useId } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { ACTION_MIN_MINUTES, actionRows, usePlayerActions } from "../services/player-actions.js";
import { fmt, ordinal, PercentileBadge, PercentileBar } from "./PlayerScoutCharts.jsx";
import s from "./PlayerScout.module.css";

/** The source's action values of the player's league season, among the players of his role there. */
export default function PlayerActionValues({ id }) {
  const f = useFootball();
  const heading = useId();
  const table = actionRows(usePlayerActions(f.season, id));
  if (!table) return null;
  const cohort = `${number(table.peers)} ${table.peers < 2 ? "joueur" : "joueurs"} au même poste${table.position ? ` (${table.position.toLowerCase()})` : ""}`;
  return (
    <section className={s.panel} aria-labelledby={heading}>
      <div className={s.panelTitle}>
        <h3 id={heading}>Valeur des actions</h3>
        <p>
          Par 90 min{table.competition ? ` en ${table.competition}` : ""} · {cohort}, {ACTION_MIN_MINUTES} min ou plus
        </p>
      </div>
      <div className={s.distRows}>
        {table.rows.map((row) => (
          <div className={s.distRow} key={row.key}>
            <div className={s.distLabel}>
              <strong title={row.hint}>{row.label}</strong>
              <small>
                {row.rank ? `${ordinal(row.rank)} sur ${table.peers}` : row.hint}
                {row.parts ? ` · offensif ${fmt(row.parts.offensive, 2, { signed: true })} · défensif ${fmt(row.parts.defensive, 2, { signed: true })}` : ""}
              </small>
            </div>
            <div>{row.percentile != null && <PercentileBar value={row.percentile} />}</div>
            <span className={s.distValue}>{fmt(row.value, 2)}</span>
            {row.percentile != null ? <PercentileBadge value={row.percentile} /> : <span />}
          </div>
        ))}
      </div>
      <div className={s.panelBody}>
        <p className={s.note}>
          Valeurs calculées par le fournisseur des données, action par action, et lues ici telles quelles. Elles ne sont pas corrigées
          du niveau du championnat : le joueur est situé parmi les joueurs de sa propre compétition
          {table.placed ? "" : ", trop peu nombreux à son poste pour lui donner un rang"}. Le score Vega ne les utilise pas.
        </p>
      </div>
    </section>
  );
}
