import React from "react";
import { TeamHeroSkeleton, TeamSkeletonTabs } from "./ClubSkeleton.jsx";
import s from "./Nations.module.css";

const line = (width, height) => (
  <span
    className="skeleton-line"
    aria-hidden="true"
    style={{ width, height }}
  />
);

/**
 * A nation's page while it loads, in the page's shape (FAILURE_MODES § 86): the head with its six figures, the three
 * tabs' track, then the Elo chart beside the coming matches, in grey. The site shell shows it before the page's code
 * and data arrive, so it stays light.
 */
export default function NationSkeleton({ label = "Chargement de la sélection…" }) {
  return (
    <div
      className="club-skeleton team-skeleton"
      role="status"
      aria-busy="true"
      data-page-loading=""
      data-nation-skeleton=""
    >
      <span className="sr-only">{label}</span>
      <div data-skeleton-part="head">
        <TeamHeroSkeleton />
      </div>
      <TeamSkeletonTabs widths={[128, 84, 92]} />
      <div className="team-skeleton-cards" aria-hidden="true" data-skeleton-part="main">
        <div className={s.skeletonGrid}>
          <div className={`team-skeleton-card ${s.skeletonCard}`}>
            {line("36%", "1.2em")}
            <span className={`skeleton-line ${s.skeletonChart}`} />
          </div>
          <div className={`team-skeleton-card ${s.skeletonCard}`}>
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
  );
}
