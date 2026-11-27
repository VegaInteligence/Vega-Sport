"use client";
/* The head of a cup edition's page (mock-up validated 18 Nov 2026), on one row: the competition, its edition between
 * two arrows (the editions latest first: « ‹ » is the one before, « › » the one after), then what the page adds (the
 * team followed, the views). `imageUrl` is the page's resolved image (competition-artwork.js editionArtworkUrl: the
 * edition's attested emblem, else a logo that is no edition's); without one the slot stays empty, never initials. */
import React, { createContext, useContext } from "react";
import { Media } from "./UI.jsx";
import SeasonSelect from "./SeasonSelect.jsx";

/* The competition page (§ 82, piste B of https://claude.ai/artifact/8DpjahVVH1hHCaZ7oviEHW, hugo, 27 Nov 2026): the
 * head is the page's title, the competition's logo and name, with the home's bar on its right (Saison · Compétition ·
 * Archives) and the views under it, out of the card. The page provides what the bar adds to the season (`bar`, a
 * node); the same components elsewhere (the match page's standings) keep their head inside the card. */
const EditionPage = createContext(null);
export const EditionPageProvider = ({ bar, league, children }) => <EditionPage.Provider value={{ bar, league }}>{children}</EditionPage.Provider>;
export const useEditionPage = () => useContext(EditionPage);

function PageHead({ imageUrl, name, editions, season, onSeason, label, bar, league, children }) {
  return (
    <header className="edition-head edition-head--page">
      <div className="edition-title" data-league={league}>
        <Media url={imageUrl} className="crest edition-logo" initials={false} />
        <h1 className="edition-name">{name}</h1>
      </div>
      <div className="home-settings edition-bar">
        <SeasonSelect
          bare
          label={label}
          value={season}
          disabled={editions.length < 2}
          seasons={editions.map((edition) => ({ value: edition.season, label: edition.label || edition.season }))}
          onChange={onSeason}
        />
        {bar}
      </div>
      {React.Children.toArray(children).some(Boolean) && <div className="edition-tools">{children}</div>}
    </header>
  );
}

export default function EditionHeader({ imageUrl, name, editions, season, onSeason, label = "Édition", heading = false, children }) {
  const page = useEditionPage();
  if (page)
    return (
      <PageHead imageUrl={imageUrl} name={name} editions={editions} season={season} onSeason={onSeason} label={label} bar={page.bar} league={page.league}>
        {children}
      </PageHead>
    );
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
