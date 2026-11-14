"use client";
import React, { useId } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { facedSummary, usePlayerFaced } from "../services/player-faced.js";
import s from "./PlayerScout.module.css";

/** A goalkeeper's shots on target faced in the season, and the goals he kept out of them. */
export default function PlayerFaced({ id, enabled = true }) {
  const f = useFootball();
  const heading = useId();
  const summary = facedSummary(usePlayerFaced(f.season, enabled ? id : null));
  if (!summary) return null;
  return (
    <section className={s.card} aria-labelledby={heading}>
      <div className={s.cardHead}>
        <div>
          <h3 id={heading}>Tirs cadrés subis</h3>
          <p>{summary.headline} · toutes compétitions de la saison</p>
        </div>
      </div>
      <p className={s.note}>{summary.reading}</p>
    </section>
  );
}
