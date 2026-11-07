"use client";
import React, { useId } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import SeasonSelect from "./SeasonSelect.jsx";
import styles from "./PlayerProfileFilters.module.css";

export default function PlayerProfileFilters({ children }) {
  const f = useFootball();
  const fromId = useId(),
    toId = useId();
  const from = f.filters?.advanced?.from || "",
    to = f.filters?.advanced?.to || "";
  const update = (patch) =>
    f.setFilters((current) => ({
      ...current,
      advanced: { ...current.advanced, ...patch },
    }));
  return (
    <div className={styles.filters} role="group" aria-label="Filtres du joueur">
      {children ?? (
        <SeasonSelect
          value={f.season}
          seasons={(f.manifest?.seasons || []).map((season) => season.id)}
          onChange={f.changeSeason}
          className={styles.season}
        />
      )}
      <div className={styles.field}>
        <label htmlFor={fromId}>Du</label>
        <input
          id={fromId}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => update({ from: event.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={toId}>Au</label>
        <input
          id={toId}
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => update({ to: event.target.value })}
        />
      </div>
      {(from || to) && (
        <button
          className={styles.clear}
          type="button"
          onClick={() => update({ from: "", to: "" })}
        >
          Effacer période
        </button>
      )}
    </div>
  );
}
