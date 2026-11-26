"use client";
/* The head of a cup edition's page (mock-up validated 18 Nov 2026), on one row: the competition, its edition between
 * two arrows (the editions latest first: « ‹ » is the one before, « › » the one after), then what the page adds (the
 * team followed, the views). `imageUrl` is the page's resolved image (competition-artwork.js editionArtworkUrl: the
 * edition's attested emblem, else a logo that is no edition's); without one the slot stays empty, never initials. */
import React from "react";
import { Media } from "./UI.jsx";
import SeasonSelect from "./SeasonSelect.jsx";

export default function EditionHeader({ imageUrl, name, editions, season, onSeason, label = "Édition", heading = false, children }) {
  const index = editions.findIndex((edition) => edition.season === season);
  const Name = heading ? "h1" : "h2";
  return (
    <header className="edition-head">
      <Media url={imageUrl} className="crest edition-logo" initials={false} />
      <Name className="edition-name">{name}</Name>
      <div className="edition-stepper">
        <button type="button" aria-label="Édition précédente" disabled={index < 0 || index >= editions.length - 1} onClick={() => onSeason(editions[index + 1].season)}>
          ‹
        </button>
        <SeasonSelect
          label={label}
          value={season}
          seasons={editions.map((edition) => ({ value: edition.season, label: edition.label || edition.season }))}
          onChange={onSeason}
        />
        <button type="button" aria-label="Édition suivante" disabled={index <= 0} onClick={() => onSeason(editions[index - 1].season)}>
          ›
        </button>
      </div>
      <div className="edition-tools">{children}</div>
    </header>
  );
}

/** The team a page follows through an edition (it came from that team's page), and the way to stop following it. */
export function FollowedTeam({ label, flag, onClear }) {
  return (
    <button type="button" className="edition-followed" onClick={onClear} aria-label={"Ne plus suivre " + label}>
      {flag}
      <span>{label}</span>
      <span aria-hidden="true">✕</span>
    </button>
  );
}
