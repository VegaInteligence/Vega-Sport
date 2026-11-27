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
 * The competition page while it loads, in its shape since § 82 (piste B) and § 84: the logo and the name at the left,
 * the bar Saison · Compétition · Archives at the right, the views in a pill, the table on a 22 px card of the veil and
 * the three cards beside it. `detail`: the page's own title is already shown, the skeleton starts at the views.
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
        <div className="competition-skeleton-heading" aria-hidden="true">
          <div
            className="competition-skeleton-title"
            data-skeleton-part="title"
          >
            <span
              className="skeleton-line competition-skeleton-logo"
              data-skeleton-part="logo"
            />
            {line("min(170px, 44vw)", "1.6em")}
          </div>
          <span
            className="skeleton-line skeleton-pill competition-skeleton-bar"
            data-skeleton-part="bar"
          />
        </div>
      )}
      <span
        className="skeleton-line skeleton-pill competition-skeleton-views"
        data-skeleton-part="views"
        aria-hidden="true"
      />
      <div className="competition-skeleton-body" aria-hidden="true">
        <div className="competition-skeleton-table" data-skeleton-part="table">
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              className="competition-skeleton-row"
              data-skeleton-part="row"
            >
              {line("14px")}
              <span className="skeleton-line competition-skeleton-crest" />
              {line(NAME_WIDTHS[i % NAME_WIDTHS.length])}
              {line("28px")}
            </div>
          ))}
        </div>
        <div className="competition-skeleton-side">
          {[3, 4, 6].map((rows, i) => (
            <div
              key={i}
              className="competition-skeleton-card"
              data-skeleton-part="card"
            >
              {line("44%", "1.1em")}
              {Array.from({ length: rows }, (_, j) => (
                <React.Fragment key={j}>
                  {line(`${86 - (j % 3) * 12}%`)}
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
