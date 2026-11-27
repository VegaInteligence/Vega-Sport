import React from "react";

const line = (width, height) => <span className="skeleton-line" aria-hidden="true" style={{ width, height }} />;
const NAME_WIDTHS = ["46%", "38%", "52%", "34%", "44%", "40%", "50%", "36%"];

/**
 * The Ballon d'Or (`kind="ballon"`) and the Power Ranking (`kind="power"`) while they load, in their shape since § 87
 * (piste B): the title at the left and its bar at the right, then « la une » (the leader's wide card, the second and
 * the third stacked) or the views' track and the first three's cards, then the ranking on a 22 px card of the veil.
 * Light on purpose: the site shell shows it before the page's code and data arrive.
 */
export default function RankingSkeleton({ kind = "ballon", label = "Chargement du classement…" }) {
  const ballon = kind === "ballon";
  return (
    <div className={`ranking-skeleton ranking-skeleton--${kind}`} role="status" aria-busy="true" data-page-loading="">
      <span className="sr-only">{label}</span>
      <div className="ranking-skeleton-heading" aria-hidden="true">
        <div className="ranking-skeleton-title" data-skeleton-part="title">
          {ballon && <span className="skeleton-line ranking-skeleton-trophy" />}
          {line(ballon ? "min(290px, 60vw)" : "min(200px, 50vw)", "1.6em")}
        </div>
        <span
          className={`skeleton-line skeleton-pill ranking-skeleton-bar${ballon ? "" : " is-wide"}`}
          data-skeleton-part="bar"
        />
      </div>
      {!ballon && <span className="skeleton-line skeleton-pill ranking-skeleton-views" data-skeleton-part="views" aria-hidden="true" />}
      <div className={ballon ? "ranking-skeleton-une" : "ranking-skeleton-top3"} aria-hidden="true">
        {[1, 2, 3].map((rank) => (
          <div key={rank} className={`ranking-skeleton-card ranking-skeleton-place-${rank}`} data-skeleton-part="card">
            <span className="skeleton-line ranking-skeleton-avatar" />
            <div className="ranking-skeleton-lines">
              {line(rank === 1 && ballon ? "34%" : "56%")}
              {line(rank === 1 && ballon ? "62%" : "40%", rank === 1 && ballon ? "2em" : undefined)}
              {rank === 1 && ballon && <span className="skeleton-line skeleton-pill ranking-skeleton-score" />}
            </div>
          </div>
        ))}
      </div>
      <div className="ranking-skeleton-board" data-skeleton-part="card" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="ranking-skeleton-row" data-skeleton-part="row">
            {line("20px")}
            <span className="skeleton-line ranking-skeleton-dot" />
            {line(NAME_WIDTHS[i % NAME_WIDTHS.length])}
            <span className="skeleton-line skeleton-pill ranking-skeleton-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}
