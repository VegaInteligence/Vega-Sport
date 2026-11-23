import React from "react";
import s from "./Nations.module.css";

const line = (width, height) => (
  <span
    className="skeleton-line"
    aria-hidden="true"
    style={{ width, height }}
  />
);

/**
 * A nation's page while it loads: its identity column (back link, flag, name, ranking and
 * record), then its three tabs, six figures, and the Elo chart beside the coming matches, in
 * grey. The site shell shows it before the page's code and data arrive, so it stays light.
 * `back`: the page's real « ← » link, once the page's code runs; a grey line before.
 */
export default function NationSkeleton({
  label = "Chargement de la sélection…",
  back = null,
}) {
  return (
    <div
      className="club-skeleton"
      role="status"
      aria-busy="true"
      data-page-loading=""
      data-nation-skeleton=""
    >
      <span className="sr-only">{label}</span>
      <div className="club-skeleton-body">
        <aside className="club-skeleton-aside" data-skeleton-part="rail">
          <div className="club-skeleton-back">{back || line("120px")}</div>
          <div
            className="club-skeleton-card club-skeleton-identity"
            aria-hidden="true"
          >
            <span className="skeleton-line club-skeleton-crest" />
            {line("52%", "1.4em")}
            {line("40%")}
          </div>
          <div
            className="club-skeleton-card club-skeleton-split"
            aria-hidden="true"
          >
            {line("44%")}
            {line("28%", "2.2em")}
            {line("70%")}
          </div>
          <div className="club-skeleton-card" aria-hidden="true">
            {line("30%")}
            {line("64%", "1.6em")}
            {line("52%")}
          </div>
        </aside>
        <div
          className="club-skeleton-main"
          aria-hidden="true"
          data-skeleton-part="main"
        >
          <div className="club-skeleton-tabs">
            {["11%", "7%", "8%"].map((w, i) => (
              <React.Fragment key={i}>{line(w)}</React.Fragment>
            ))}
          </div>
          <div className="club-skeleton-kpis">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                {line("56%")}
                {line("44%", "1.8em")}
                {line("36%")}
              </div>
            ))}
          </div>
          <div className={s.skeletonGrid}>
            <div className={s.skeletonCard}>
              {line("36%", "1.2em")}
              <span className={`skeleton-line ${s.skeletonChart}`} />
            </div>
            <div className={s.skeletonCard}>
              {line("44%", "1.2em")}
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={s.skeletonRow}>
                  {line("14%")}
                  {line(`${62 - (i % 2) * 12}%`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
