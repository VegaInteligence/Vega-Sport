import React from "react";

const line = (width, height) => (
  <span
    className="skeleton-line"
    aria-hidden="true"
    style={{ width, height }}
  />
);

/** The head's shape while the page is read: the crest, two lines, the bar and six figures in grey. */
export function TeamHeroSkeleton({ live = false, head = null }) {
  return (
    <div className="team-hero team-hero-skeleton" aria-hidden={live ? undefined : "true"}>
      <div className="team-hero-top">
        {head || (
          <div className="team-hero-who">
            <span className="skeleton-line team-hero-mark-skeleton" />
            <div className="team-hero-words">
              <span className="skeleton-line" style={{ width: 280, height: 30 }} />
              <span className="skeleton-line" style={{ width: 220, marginTop: 10 }} />
            </div>
          </div>
        )}
        <div className="team-hero-bar">
          <span className="skeleton-line skeleton-pill" style={{ width: 300, height: 40 }} />
          <span className="skeleton-line skeleton-pill" style={{ width: 84, height: 32 }} />
        </div>
      </div>
      <div className="team-hero-figs">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="team-fig">
            <span className="skeleton-line" style={{ width: 70 }} />
            <span className="skeleton-line" style={{ width: i < 2 ? 64 : 52, height: i < 2 ? 30 : 22, marginTop: 6 }} />
            <span className="skeleton-line" style={{ width: 90, marginTop: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The tabs' track, centred, in grey: `count` pills. */
export const TeamSkeletonTabs = ({ widths }) => (
  <div className="team-skeleton-tabs" aria-hidden="true">
    <div className="team-skeleton-track">
      {widths.map((w, i) => (
        <span key={i} className="skeleton-line skeleton-pill" style={{ width: w, height: 34 }} />
      ))}
    </div>
  </div>
);

/**
 * A club page while it loads, in the page's shape (FAILURE_MODES § 86, piste B): the head across the page with its
 * bar and six figures, the tabs' track, the key figures' card and the profile's card, in grey. Light on purpose: the
 * site shell shows it before the page's code and data arrive.
 *
 * Once the club's own read is in memory the page shows what it knows: `head` takes the head's crest and name, and
 * `after` follows the grey cards (the last matches). The page is then revealed (`live`: no data-page-loading), the
 * rest still grey.
 */
export default function ClubSkeleton({
  label = "Chargement du club…",
  head,
  after,
  live = false,
}) {
  return (
    <div
      className="club-skeleton team-skeleton"
      role={live ? undefined : "status"}
      aria-busy={live ? undefined : "true"}
      data-page-loading={live ? undefined : ""}
    >
      <span className="sr-only" role={live ? "status" : undefined}>
        {label}
      </span>
      <TeamHeroSkeleton live={live} head={head} />
      <TeamSkeletonTabs widths={[128, 104, 118, 104, 156, 78, 112, 128]} />
      <div className="club-skeleton-shapes team-skeleton-cards" aria-hidden="true">
        <div className="team-skeleton-card team-skeleton-kpis">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              {line("56%")}
              {line("44%", "1.8em")}
              {line("36%")}
            </div>
          ))}
        </div>
        <div className="team-skeleton-card team-skeleton-chart">
          {line("22%", "1.2em")}
          <div>
            <span className="skeleton-line club-skeleton-disc" />
            <div>
              {Array.from({ length: 6 }, (_, i) => (
                <React.Fragment key={i}>
                  {line(`${88 - (i % 3) * 9}%`)}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
      {after}
    </div>
  );
}
