"use client";
import React, { useEffect, useState } from "react";
import { MESSI_ID } from "../services/player-honours.js";

const GOATS = [4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 97];
const RONALDO_POSITIONS = [1, 15, 29, 43, 57, 71, 85];
const MBAPPE_ID = "p_217YMB";
const RONALDO_ID = "p_3yEwhj";
const CELEBRATION_IDS = new Set([MESSI_ID, MBAPPE_ID, RONALDO_ID]);
export default function MessiGoats({ id }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (
      !CELEBRATION_IDS.has(id) ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    )
      return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [id]);
  if (!CELEBRATION_IDS.has(id) || !visible) return null;
  return (
    <div
      key={id}
      className="messi-goats"
      data-celebration={
        id === MESSI_ID ? "messi" : id === MBAPPE_ID ? "mbappe" : "ronaldo"
      }
      aria-hidden="true"
    >
      {(id === RONALDO_ID ? RONALDO_POSITIONS : GOATS).map((left, i) => (
        <span
          key={left}
          style={{
            "--goat-left": `${left}%`,
            "--goat-delay": `${(i % 5) * 0.18}s`,
            "--goat-drift": `${i % 2 ? 28 : -28}px`,
          }}
        >
          {id === MESSI_ID ? (
            "🐐"
          ) : id === RONALDO_ID ? (
            "SUUUU"
          ) : (
            <img src="/celebrations/mao-zedong.webp" alt="" />
          )}
        </span>
      ))}
    </div>
  );
}
