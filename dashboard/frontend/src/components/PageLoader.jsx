"use client";
import React, { useState } from "react";
import styles from "./PageLoader.module.css";
import { MARK } from "../brand-mark.js";

// The mark « V* », inlined so the loading screen needs no image request (src/brand-mark.js).
export default function PageLoader({ overlay = false }) {
  const [spark, setSpark] = useState(0);
  const follow = (event) => {
    if (event.pointerType !== "mouse") return;
    const node = event.currentTarget;
    const box = node.getBoundingClientRect();
    node.style.setProperty(
      "--logo-x",
      `${((event.clientX - box.left) / box.width - 0.5) * 10}px`,
    );
    node.style.setProperty(
      "--logo-y",
      `${((event.clientY - box.top) / box.height - 0.5) * 10}px`,
    );
  };
  const reset = (event) => {
    event.currentTarget.style.removeProperty("--logo-x");
    event.currentTarget.style.removeProperty("--logo-y");
  };
  return (
    <div
      className={`${styles.loader}${overlay ? ` ${styles.overlay}` : ""}`}
      data-page-loader=""
    >
      <div className={styles.content}>
        <button
          type="button"
          className={styles.control}
          aria-label="Faire scintiller le logo Vega"
          onPointerMove={follow}
          onPointerLeave={reset}
          onPointerCancel={reset}
          onClick={() => setSpark((value) => value + 1)}
        >
          <span className={styles.follow}>
            <svg
              key={spark}
              className={`${styles.symbol}${spark ? ` ${styles.spark}` : ""}`}
              viewBox={`-30 -40 ${MARK.width + 60} ${MARK.height + 80}`}
              aria-hidden="true"
              focusable="false"
            >
              <path d={MARK.letter} className={styles.shape} />
              {/* The asterisk turns while the page waits (PageLoader.module.css). */}
              <path d={MARK.sign} className={styles.sign} />
            </svg>
          </span>
        </button>
        <span role="status" className={styles.status}>
          Chargement…
        </span>
      </div>
    </div>
  );
}
