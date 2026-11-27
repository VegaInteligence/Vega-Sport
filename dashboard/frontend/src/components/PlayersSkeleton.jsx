import React from "react";

const line = (width, height) => <span className="skeleton-line" aria-hidden="true" style={{ width, height }} />;
const NAME_WIDTHS = ["46%", "38%", "52%", "34%", "44%", "40%", "50%", "36%"];

/**
 * The players' directory (`player={false}`) or a player's page (`player`) while they load, in their shape since § 87
 * (piste B). The directory: the title and its bar at the right, the views' track with the search beside it, the table
 * on a 22 px card. A player: « ← Joueurs » and the bar on one line, the head card (portrait, name, the six facts),
 * the tabs' track, the key figures and the four tiles.
 * Light on purpose: the site shell shows it before the page's code and data arrive.
 */
export default function PlayersSkeleton({ player = false, label }) {
  return (
    <div
      className={`players-skeleton players-skeleton--${player ? "player" : "directory"}`}
      role="status"
      aria-busy="true"
      data-page-loading=""
    >
      <span className="sr-only">{label || (player ? "Chargement du joueur…" : "Chargement des joueurs…")}</span>
      {player ? (
        <>
          <div className="players-skeleton-heading" aria-hidden="true">
            <span className="skeleton-line skeleton-pill players-skeleton-back" data-skeleton-part="title" />
            <span className="skeleton-line skeleton-pill players-skeleton-bar is-wide" data-skeleton-part="bar" />
          </div>
          <div className="players-skeleton-card players-skeleton-head" data-skeleton-part="card" aria-hidden="true">
            <div className="players-skeleton-identity">
              <span className="skeleton-line players-skeleton-portrait" />
              <div className="players-skeleton-lines">
                {line("min(260px, 50vw)", "1.6em")}
                {line("min(200px, 40vw)")}
                {line("min(240px, 45vw)", "1.4em")}
              </div>
            </div>
            <div className="players-skeleton-facts">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="skeleton-line players-skeleton-fact" data-skeleton-part="tile" />
              ))}
            </div>
          </div>
          <span className="skeleton-line skeleton-pill players-skeleton-tabs" data-skeleton-part="tab" aria-hidden="true" />
          <div className="players-skeleton-tiles" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="players-skeleton-card players-skeleton-tile" data-skeleton-part="card">
                {line("48%")}
                {line("36%", "1.8em")}
                {line("70%")}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="players-skeleton-heading" aria-hidden="true">
            <div data-skeleton-part="title">{line("min(150px, 40vw)", "1.6em")}</div>
            <span className="skeleton-line skeleton-pill players-skeleton-bar" data-skeleton-part="bar" />
          </div>
          <div className="players-skeleton-tabs-row" aria-hidden="true">
            <span className="skeleton-line skeleton-pill players-skeleton-tabs" data-skeleton-part="tab" />
            <span className="skeleton-line skeleton-pill players-skeleton-search" />
          </div>
          <div className="players-skeleton-card players-skeleton-table" data-skeleton-part="card" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="players-skeleton-row" data-skeleton-part="row">
                <span className="skeleton-line players-skeleton-dot" />
                {line(NAME_WIDTHS[i % NAME_WIDTHS.length])}
                <span className="skeleton-line skeleton-pill players-skeleton-pill" />
                {line("70%")}
                {line("60%")}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
