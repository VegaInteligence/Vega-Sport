import React from "react";

const line = (width, height, className = "") => (
  <span
    className={`skeleton-line ${className}`.trim()}
    aria-hidden="true"
    style={{ width, height }}
  />
);

function Card({ className = "", title = "34%", children }) {
  return (
    <div
      className={`home-skeleton-card ${className}`.trim()}
      data-skeleton-part="home-card"
    >
      {line(title, "0.7em")}
      {children}
    </div>
  );
}
const lines = (count, widths = [88, 74, 81, 66]) =>
  Array.from({ length: count }, (_, i) => (
    <React.Fragment key={i}>
      {line(`${widths[i % widths.length]}%`)}
    </React.Fragment>
  ));

/**
 * The home (« Vue d'ensemble ») while its week is read, in its shape since § 77 and the pills (§ 84): the week's
 * title with the bar Saison · Compétitions, the results strip on 22 px cards, then the bento — the week's big match
 * and the player of the week, the title race and what comes next. `toolbar` false: the page shows its own toolbar
 * (still usable to change the season or the competitions while the week loads) and the skeleton starts at the strip.
 */
export default function HomeSkeleton({
  label = "Chargement de la synthèse…",
  toolbar = true,
}) {
  return (
    <div
      className="home-skeleton"
      role="status"
      aria-busy="true"
      data-page-loading=""
    >
      <span className="sr-only">{label}</span>
      {toolbar && (
        <div className="home-skeleton-toolbar" aria-hidden="true">
          {line("min(250px, 60vw)", "1.2em")}
          <span
            className="skeleton-line skeleton-pill home-skeleton-settings"
            data-skeleton-part="settings"
          />
        </div>
      )}
      <div className="home-skeleton-ticker" aria-hidden="true">
        <span className="skeleton-line skeleton-pill home-skeleton-day" />
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="home-skeleton-tick"
            data-skeleton-part="home-tick"
          >
            {line("100%", "0.6em")}
            {[0, 1].map((j) => (
              <span key={j} className="home-skeleton-tick-team">
                <span className="skeleton-line home-skeleton-dot" />
                {line(`${68 - ((i + j) % 3) * 10}%`, "0.75em")}
              </span>
            ))}
            {line("100%", "0.25em")}
          </div>
        ))}
      </div>
      <div className="home-skeleton-bento" aria-hidden="true">
        <Card className="home-skeleton-motw" title="26%">
          <span className="home-skeleton-duel">
            <span className="skeleton-line home-skeleton-crest" />
            <span className="skeleton-line home-skeleton-score" />
            <span className="skeleton-line home-skeleton-crest" />
          </span>
          {line("100%", "2.2em")}
          <span className="skeleton-line home-skeleton-chart" />
        </Card>
        <div className="home-skeleton-stack">
          <Card className="home-skeleton-potw" title="40%">
            <span className="home-skeleton-player">
              <span className="skeleton-line home-skeleton-face" />
              <span>
                {line("70%", "1.3em")}
                {line("44%", "0.7em")}
              </span>
            </span>
            {lines(6)}
          </Card>
          <Card className="home-skeleton-number" title="38%">
            {lines(2)}
          </Card>
        </div>
        <Card className="home-skeleton-race" title="22%">
          {lines(8, [92, 86, 90, 84])}
        </Card>
        <Card className="home-skeleton-next" title="24%">
          {lines(8, [80, 72, 84, 70])}
        </Card>
      </div>
    </div>
  );
}
