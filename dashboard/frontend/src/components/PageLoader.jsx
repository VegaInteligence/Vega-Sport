"use client";
import React, { useState } from "react";
import styles from "./PageLoader.module.css";
import { MARK } from "../brand-mark.js";

// The mark « V. », inlined so the loading screen needs no image request (src/brand-mark.js).
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
              viewBox={`-20 -210 ${MARK.width + 100} ${MARK.height + 230}`}
              aria-hidden="true"
              focusable="false"
            >
              <path d={MARK.letter} className={styles.shape} />
              {/* The point waits like a ball: it bounces (PageLoader.module.css). */}
              <circle
                cx={MARK.point.cx}
                cy={MARK.point.cy}
                r={MARK.point.r}
                className={styles.point}
              />
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
