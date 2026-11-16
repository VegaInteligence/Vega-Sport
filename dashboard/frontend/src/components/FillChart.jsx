"use client";
/* A chart that fills the height its column leaves it, beside a taller neighbour (a league
 * table): it measures that room and draws the chart to it, instead of leaving the space
 * empty under a chart of fixed height. On a single column it keeps its own height. */
import React, { useEffect, useRef, useState } from "react";

const WIDE = "(min-width: 1101px)";

/**
 * `children(height)`: the chart for a drawing `height` tall (in the chart's own units, for a
 * drawing `drawn` units wide shown at most `cap` pixels wide), or `base` on a single column.
 */
export default function FillChart({ base, drawn = 640, cap = Infinity, legend = 30, max = 1000, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(base);
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const wide = window.matchMedia(WIDE);
    const measure = () => {
      if (!wide.matches) return setHeight(base);
      const { width, height: room } = box.getBoundingClientRect();
      const shown = Math.min(width, cap);
      if (!shown || room <= legend) return setHeight(base);
      setHeight(Math.max(base, Math.min(max, Math.round((drawn * (room - legend)) / shown))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    wide.addEventListener("change", measure);
    measure();
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, [base, drawn, cap, legend, max]);
  return (
    <div ref={ref} className="fill-chart">
      <div className="fill-chart-inner">{children(height)}</div>
    </div>
  );
}
