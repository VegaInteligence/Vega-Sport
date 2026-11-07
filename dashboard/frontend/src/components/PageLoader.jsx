"use client";
import React, { useId, useState } from "react";
import styles from "./PageLoader.module.css";

// The official Vega symbol, inlined so the loading mark needs no image request.
const symbol =
  "M 559 1 C 530 57 497 115 480 184 C 471 209 487 218 560 223 L 558 232 C 500 231 463 240 446 265 C 411 309 354 406 320 457 C 351 394 380 322 392 281 C 406 239 374 245 335 243 C 230 240 115 237 1 234 C 132 231 279 225 351 220 C 415 216 433 191 456 164 C 494 108 531 45 559 1 Z";

export default function PageLoader({ overlay = false }) {
  const gradient = useId();
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
              viewBox="-20 -20 607 500"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <linearGradient id={gradient} x1="0" x2="1">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset=".24" stopColor="currentColor" />
                  <stop offset="1" stopColor="currentColor" />
                </linearGradient>
              </defs>
              <path
                d={symbol}
                fill={`url(#${gradient})`}
                className={styles.shape}
              />
              <path
                d={symbol}
                pathLength="1"
                fill="none"
                className={styles.trace}
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
