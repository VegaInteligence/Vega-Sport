"use client";
import React, { useEffect, useState } from "react";
import { MESSI_ID } from "../services/player-honours.js";

const GOATS = [4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 97];
export default function MessiGoats({ id }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (
      id !== MESSI_ID ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    )
      return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [id]);
  if (id !== MESSI_ID || !visible) return null;
  return (
    <div className="messi-goats" aria-hidden="true">
      {GOATS.map((left, i) => (
        <span
          key={left}
          style={{
            "--goat-left": `${left}%`,
            "--goat-delay": `${(i % 5) * 0.18}s`,
            "--goat-drift": `${i % 2 ? 28 : -28}px`,
          }}
        >
          🐐
        </span>
      ))}
    </div>
  );
}
