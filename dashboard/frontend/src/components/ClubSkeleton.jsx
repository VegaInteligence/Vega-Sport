import React from "react";

const line = (width, height) => (
  <span
    className="skeleton-line"
    aria-hidden="true"
    style={{ width, height }}
  />
);

/**
 * A club page while it loads: the shape of its identity column, toolbar, tabs,
 * headline figures and first chart, in grey. Light on purpose: the site shell
 * shows it before the page's code and data arrive.
 */
export default function ClubSkeleton({ label = "Chargement du club…" }) {
  return (
    <div className="club-skeleton" role="status" aria-busy="true" data-page-loading="">
      <span className="sr-only">{label}</span>
      <div className="club-skeleton-body">
        <aside className="club-skeleton-aside" aria-hidden="true">
          <div className="club-skeleton-back">{line("96px")}</div>
          <div className="club-skeleton-card club-skeleton-identity">
            <span className="skeleton-line club-skeleton-crest" />
            {line("62%", "1.4em")}
            {line("48%")}
            {line("56%", "1.6em")}
          </div>
          <div className="club-skeleton-card club-skeleton-split">
            {line("40%")}
            {line("30%", "2.2em")}
            {line("88%")}
            {line("72%")}
          </div>
          <div className="club-skeleton-card">
            {line("44%")}
            {line("82%")}
            {line("76%")}
            {line("68%")}
          </div>
        </aside>
        <div className="club-skeleton-main" aria-hidden="true">
          <div className="club-skeleton-toolbar">
            {line("38%", "2.4em")}
            {line("20%", "2.4em")}
          </div>
          <div className="club-skeleton-tabs">
            {["9%", "8%", "10%", "8%", "12%", "6%", "10%"].map((w, i) => (
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
          {line("22%", "1.2em")}
          <div className="club-skeleton-chart">
            <span className="skeleton-line club-skeleton-disc" />
            <div>
              {Array.from({ length: 6 }, (_, i) => (
                <React.Fragment key={i}>{line(`${88 - (i % 3) * 9}%`)}</React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
