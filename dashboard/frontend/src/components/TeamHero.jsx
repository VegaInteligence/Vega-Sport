"use client";
/* The head of a club's or a nation's page (FAILURE_MODES § 86, piste B of https://claude.ai/artifact/FV91Edw3nwSudoP9sTx5yS,
 * hugo, 27 Nov 2026, 20 h 50): what the identity column said first, across the page. The crest and the name, a line
 * under them, the home's bar at the right (the page gives its segments, then its actions), six figures under them.
 * The veil is shaded from its top left with the team's colour, read from its crest (the match page's reading). */
import React from "react";
import useCrestColours from "../hooks/useCrestColours.js";

/** `figures`: [{ key, label, value, note, tone, lead }]; `value` may be a node (the form's marks). */
export default function TeamHero({ mark, name, sub = [], segments, actions, figures = [], tintOf, label }) {
  const colours = useCrestColours(tintOf || null, null, { charts: false });
  const style = colours["--home"] ? { "--team-tint": colours["--home"] } : undefined;
  return (
    <header className="team-hero" style={style} aria-label={label}>
      <div className="team-hero-top">
        <div className="team-hero-who">
          <div className="team-hero-mark">{mark}</div>
          <div className="team-hero-words">
            <h1 className="team-hero-name">{name}</h1>
            {sub.filter(Boolean).length > 0 && (
              <p className="team-hero-sub">
                {sub.filter(Boolean).map((part, i) => (
                  <span key={i}>{part}</span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="team-hero-bar">
          {segments && <div className="home-settings team-hero-track">{segments}</div>}
          {actions}
        </div>
      </div>
      {figures.length > 0 && (
        <dl className="team-hero-figs">
          {figures.map((fig) => (
            <div key={fig.key || fig.label} className={`team-fig${fig.lead ? " team-fig-lead" : ""}${fig.form ? " team-fig-form" : ""}`}>
              <dt>{fig.label}</dt>
              <dd>{fig.value}</dd>
              {fig.note && <small className={fig.tone ? `team-fig-${fig.tone}` : undefined}>{fig.note}</small>}
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
