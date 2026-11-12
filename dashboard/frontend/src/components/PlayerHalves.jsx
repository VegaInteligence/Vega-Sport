"use client";
import React, { useId } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { halfRows, usePlayerHalves } from "../services/player-halves.js";
import s from "./PlayerScout.module.css";

/** What the player produces per 90 minutes in first halves and in second halves. */
export default function PlayerHalves({ id }) {
  const f = useFootball();
  const heading = useId();
  const table = halfRows(usePlayerHalves(f.season, id));
  if (!table) return null;
  return (
    <section className={s.card} aria-labelledby={heading}>
      <div className={s.cardHead}>
        <div>
          <h3 id={heading}>Par mi-temps</h3>
          <p>Par 90 minutes jouées dans chaque mi-temps, toutes compétitions de la saison</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Statistique</th>
              <th scope="col">1re mi-temps</th>
              <th scope="col">2e mi-temps</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Minutes jouées</th>
              <td>{number(table.minutes[0])}</td>
              <td>{number(table.minutes[1])}</td>
            </tr>
            {table.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{number(row.first, row.decimals)}</td>
                <td>{number(row.second, row.decimals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
