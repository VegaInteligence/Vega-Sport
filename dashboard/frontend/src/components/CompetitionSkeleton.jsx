import React from "react";

const line = (width, height, className = "") => (
  <span
    className={`skeleton-line ${className}`.trim()}
    aria-hidden="true"
    style={{ width, height }}
  />
);
const NAME_WIDTHS = ["46%", "38%", "52%", "34%", "44%", "40%", "50%", "36%"];

/**
 * The competitions page while it loads, in grey: its title and row of competitions (`detail`
 * false), then the edition's header, a table of 20 rows and the three cards beside it.
 * Light on purpose: the site shell shows it before the page's code and data arrive.
 */
export default function CompetitionSkeleton({
  label = "Chargement de la compétition…",
  detail = false,
}) {
  return (
    <div
      className="competition-skeleton"
      role="status"
      aria-busy="true"
      data-page-loading=""
    >
      <span className="sr-only">{label}</span>
      {!detail && (
        <>
          <div className="competition-skeleton-heading" aria-hidden="true">
            {line("min(340px, 70%)", "1.9em")}
            <div className="competition-skeleton-actions">
              {line("84px", "2.4em")}
              {line("190px", "2.4em")}
            </div>
          </div>
          <div className="competition-skeleton-spotlight" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="competition-skeleton-tile">
                <span className="skeleton-line competition-skeleton-logo" />
                <span>
                  {line("80%")}
                  {line("56%", "0.6em")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="competition-skeleton-body" aria-hidden="true">
        <div className="competition-skeleton-main">
          <div className="competition-skeleton-head">
            <span className="skeleton-line competition-skeleton-logo" />
            {line("120px", "1.2em")}
            {line("140px", "2em")}
            <span className="competition-skeleton-views">
              {line("min(300px, 100%)", "2em")}
            </span>
          </div>
          <div className="competition-skeleton-table">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="competition-skeleton-row">
                {line("14px")}
                <span className="skeleton-line competition-skeleton-crest" />
                {line(NAME_WIDTHS[i % NAME_WIDTHS.length])}
                {line("28px")}
              </div>
            ))}
          </div>
        </div>
        <div className="competition-skeleton-side">
          {[3, 4, 6].map((rows, i) => (
            <div key={i} className="competition-skeleton-card">
              {line("44%", "1.1em")}
              {Array.from({ length: rows }, (_, j) => (
                <React.Fragment key={j}>{line(`${86 - (j % 3) * 12}%`)}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
