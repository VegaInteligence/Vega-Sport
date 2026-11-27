import React from "react";

const line = (width, height, className = "") => (
  <span className={`skeleton-line ${className}`.trim()} aria-hidden="true" style={{ width, height }} />
);

/** The day's part of the calendar while its week is read: the day's title, then one 22 px card of rows. */
export function CalendarBodySkeleton({ label = "Chargement des matchs…" }) {
  return (
    <div className="calendar-skeleton calendar-skeleton-body" role="status" aria-busy="true" data-page-loading="">
      <span className="sr-only">{label}</span>
      <div className="calendar-skeleton-dayhead" aria-hidden="true">
        {line("min(230px, 55vw)", "1.1em")}
        {line("min(210px, 40vw)", "0.7em")}
      </div>
      <div className="calendar-skeleton-card" aria-hidden="true">
        {[0, 1].map((group) => (
          <div className="calendar-skeleton-group" key={group}>
            <div className="calendar-skeleton-grouphead">
              <span className="skeleton-line calendar-skeleton-logo" />
              {line(group ? "96px" : "140px", "0.8em")}
            </div>
            {Array.from({ length: group ? 2 : 3 }, (_, i) => (
              <div className="calendar-skeleton-row" key={i}>
                {line(`${[52, 44, 58][i % 3]}%`, "0.8em", "calendar-skeleton-home")}
                <span className="skeleton-line skeleton-pill calendar-skeleton-mid" />
                {line(`${[46, 56, 40][i % 3]}%`, "0.8em", "calendar-skeleton-away")}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The calendar before its code arrives (§ 88, LoadingPage): the title and the bar Saison · Compétition · search, the
 * strip of the week's seven days between its arrows, then the day's card.
 */
export default function CalendarSkeleton({ label = "Chargement du calendrier…" }) {
  return (
    <div className="calendar-skeleton" role="status" aria-busy="true" data-page-loading="">
      <span className="sr-only">{label}</span>
      <div className="calendar-skeleton-head" aria-hidden="true">
        {line("min(190px, 50vw)", "1.6em")}
        <span className="skeleton-line skeleton-pill calendar-skeleton-bar" />
      </div>
      <div className="calendar-skeleton-nav" aria-hidden="true">
        <div className="calendar-skeleton-strip">
          {Array.from({ length: 7 }, (_, i) => (
            <span className="calendar-skeleton-day" key={i}>
              {line("28px", "0.6em")}
              {line("18px", "1em")}
              {line("44px", "0.55em")}
            </span>
          ))}
        </div>
        <span className="skeleton-line skeleton-pill calendar-skeleton-side" />
      </div>
      <CalendarBodySkeleton label="" />
    </div>
  );
}
