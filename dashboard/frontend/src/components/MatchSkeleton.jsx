import React from "react";

const line = (width, height, className = "") => (
  <span
    className={`skeleton-line ${className}`.trim()}
    aria-hidden="true"
    style={{ width, height }}
  />
);
const pill = (width, part = "top-pill") => (
  <span
    className="skeleton-line skeleton-pill match-skeleton-pill"
    data-skeleton-part={part}
    style={{ width }}
  />
);

function Team({ away = false }) {
  return (
    <div className={`match-skeleton-team${away ? " is-away" : ""}`}>
      <span
        className="skeleton-line match-skeleton-crest"
        data-skeleton-part="crest"
      />
      <span className="match-skeleton-team-text">
        {line("min(170px, 30vw)", "1.35em")}
        {line("min(110px, 22vw)", "0.75em")}
      </span>
    </div>
  );
}

/**
 * A match page while it loads, in its shape since § 81 and the pills (§ 84): the way back and the competition, the
 * matchday's strip between two round buttons, the score's head, the five figures on their 22 px card, the tabs and
 * the first cards. Finished or to come, the page keeps that frame; only the cards' words change.
 */
export default function MatchSkeleton({ label = "Chargement du match…" }) {
  return (
    <div
      className="match-skeleton"
      role="status"
      aria-busy="true"
      data-page-loading=""
    >
      <span className="sr-only">{label}</span>
      <div className="match-skeleton-top" aria-hidden="true">
        <span className="match-skeleton-group">
          {pill("94px")}
          {pill("min(291px, 52vw)")}
        </span>
        <span className="match-skeleton-group match-skeleton-actions">
          {pill("138px")}
          {pill("119px")}
        </span>
      </div>
      <div className="match-skeleton-thread" aria-hidden="true">
        <span
          className="skeleton-line match-skeleton-step"
          data-skeleton-part="step"
        />
        <div className="match-skeleton-strip">
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              className="match-skeleton-tick"
              data-skeleton-part="tick"
            >
              {line("58%", "0.6em")}
              {[0, 1].map((j) => (
                <span key={j} className="match-skeleton-tick-team">
                  <span className="skeleton-line match-skeleton-dot" />
                  {line(`${64 - ((i + j) % 3) * 10}%`, "0.7em")}
                </span>
              ))}
            </div>
          ))}
        </div>
        <span
          className="skeleton-line match-skeleton-step"
          data-skeleton-part="step"
        />
      </div>
      <div className="match-skeleton-score" aria-hidden="true">
        <Team />
        <div className="match-skeleton-center">
          {line("110px", "0.7em")}
          <span
            className="skeleton-line match-skeleton-result"
            data-skeleton-part="score"
          />
        </div>
        <Team away />
      </div>
      <div
        className="match-skeleton-kpis"
        data-skeleton-part="kpis"
        aria-hidden="true"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="match-skeleton-kpi" data-skeleton-part="kpi">
            {line("56%", "0.65em")}
            {line("42%", "1.4em")}
          </div>
        ))}
      </div>
      <div className="match-skeleton-tabs" aria-hidden="true">
        {[62, 92, 80, 64, 82].map((width, i) => (
          <span key={i} className="match-skeleton-tab" data-skeleton-part="tab">
            <span className="skeleton-line match-skeleton-icon" />
            {line(`${width}px`, "0.8em")}
          </span>
        ))}
      </div>
      <div className="match-skeleton-cards" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="match-skeleton-card"
            data-skeleton-part="panel"
          >
            {line("48%", "0.6em")}
            <span className="match-skeleton-card-body">
              {i === 0 && (
                <span className="skeleton-line match-skeleton-face" />
              )}
              <span>
                {line("72%", "1.1em")}
                {line("52%", "0.7em")}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div
        className="match-skeleton-card match-skeleton-wide"
        data-skeleton-part="panel"
        aria-hidden="true"
      >
        <span className="match-skeleton-wide-head">
          {line("180px", "1em")}
          <span
            className="skeleton-line skeleton-pill match-skeleton-pill"
            style={{ width: "min(300px, 40%)" }}
          />
        </span>
        <span className="skeleton-line match-skeleton-chart" />
      </div>
    </div>
  );
}
