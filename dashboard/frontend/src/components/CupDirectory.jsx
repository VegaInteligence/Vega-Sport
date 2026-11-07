"use client";
import React, { useState } from "react";
import Icon from "./Icon.jsx";
import { Empty, Media } from "./UI.jsx";
import { WORLD_CUP_ID, competitionSearchText, normalizeCompetitionQuery } from "../services/cup-catalog.js";
import { FEATURED_EUROPE_IDS, competitionCountryLabel, competitionGroups, orderedFeatured } from "../services/competition-selector.js";

const NATIONAL_TEAMS = [WORLD_CUP_ID, "open-cup:euro", "openligadb:nations-league", "open-cup:world-cup-history"];
const CLUB_CUPS = [...FEATURED_EUROPE_IDS, "open-cup:club-world-cup"];
function CupCard({ competition, selected, onSelect }) {
  return <button type="button" className="cup-directory-card" aria-pressed={selected} onClick={() => onSelect(competition.id)}>
    {competition.imageUrl ? <Media name={competition.name} url={competition.imageUrl} className="crest cup-directory-crest" /> : <span className="cup-directory-crest cup-directory-fallback" aria-hidden="true"><Icon name="trophy" /></span>}
    <span className="cup-directory-card-copy"><strong>{competition.name}</strong><small>{competition.coverage || (competition.source === "open-matchday" ? competition.defaultSeason : competitionCountryLabel(competition))}</small></span>
    <Icon name="right" />
  </button>;
}
export default function CupDirectory({ catalog, selectedId, onSelect, onBack, error, onRetry, loading }) {
  const [query, setQuery] = useState("");
  const needle = normalizeCompetitionQuery(query).trim();
  const matches = (competition) => competitionSearchText(competition, competitionCountryLabel(competition)).includes(needle);
  const fixed = new Set([...NATIONAL_TEAMS, ...CLUB_CUPS]);
  const discovered = catalog.filter((competition) => competition.cupWorker && !fixed.has(competition.id) && !/nations league/i.test(competition.name || ""));
  const international = (competition) => ["INT", "INT-2", "UEFA"].includes(competition.country || competition.country_code);
  const selections = orderedFeatured(catalog, NATIONAL_TEAMS).filter(matches);
  const clubs = orderedFeatured(catalog, CLUB_CUPS).filter(matches);
  const otherInternational = discovered.filter((competition) => international(competition) && matches(competition));
  const national = competitionGroups(catalog.filter((competition) => (competition.id === "open-cup:france-cup" || competition.source === "open-matchday" || (competition.cupWorker && !fixed.has(competition.id) && !international(competition))) && matches(competition)));
  const cards = (items) => <div className="cup-directory-grid">{items.map((competition) => <CupCard key={competition.id} competition={competition} selected={competition.id === selectedId} onSelect={onSelect} />)}</div>;
  return <div className="cup-directory">
    <button type="button" className="inline-link competition-back" onClick={onBack}>← Retour à la compétition</button>
    <div className="cup-directory-heading"><div><h2>Coupes</h2><p>Retrouvez les compétitions par catégorie et par pays.</p></div><input type="search" aria-label="Rechercher une coupe" placeholder="Rechercher une coupe ou un pays…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {selections.length > 0 && <section className="cup-directory-section"><h3>Sélections nationales</h3>{cards(selections)}</section>}
    {clubs.length > 0 && <section className="cup-directory-section"><h3>Coupes de clubs</h3>{cards(clubs)}</section>}
    {otherInternational.length > 0 && <section className="cup-directory-section"><h3>Autres coupes internationales</h3>{cards(otherInternational)}</section>}
    {national.length > 0 && <section className="cup-directory-section"><h3>Coupes nationales</h3><div className="cup-country-list">{national.map((group) => <section className="cup-country" key={group.key}><h4>{group.label}</h4>{cards(group.competitions)}</section>)}</div></section>}
    {error && <p className="cup-catalog-error" role="status">Certaines coupes nationales sont temporairement indisponibles. <button type="button" onClick={onRetry}>Réessayer</button></p>}
    {!selections.length && !clubs.length && !otherInternational.length && !national.length && (loading ? <div data-page-loading="" className="loading-state" role="status">Chargement des coupes…</div> : <Empty>Aucune coupe ne correspond à la recherche.</Empty>)}
  </div>;
}
