"use client";
import React, { useId } from "react";
import { returnSummary, usePlayerReturn } from "../services/player-return.js";
import s from "./PlayerScout.module.css";

/** Shown while a player is coming back from an absence: how long, and his playing time since. */
export default function PlayerReturn({ id }) {
  const heading = useId();
  const summary = returnSummary(usePlayerReturn(id));
  if (!summary) return null;
  return (
    <section className={s.card} aria-labelledby={heading}>
      <div className={s.cardHead}>
        <div>
          <h3 id={heading}>Retour d’absence</h3>
          <p>{summary.headline}</p>
        </div>
      </div>
      <p className={s.note}>
        {summary.since}
        {summary.base && ` ${summary.base}`}
      </p>
    </section>
  );
}
