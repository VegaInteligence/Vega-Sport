import Link from "next/link";
import Icon from "./Icon.jsx";
import { pages } from "../../../shared/pages.js";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { PlayerDialog, Comparison } from "./PlayerDetails.jsx";
import CompetitionScope from "./CompetitionScope.jsx";
import { AdvancedPanel, AdvancedToggle } from "./AdvancedFilters.jsx";
import { advancedChips, countAdvanced } from "../services/advanced-filters.js";
import SiteHeader from "./SiteHeader.jsx";
import PlayerSearchResults from "./PlayerSearchResults.jsx";
import HomePreferences from "./HomePreferences.jsx";
import SeasonFilter from "./SeasonFilter.jsx";
import CompetitionOptions from "./CompetitionOptions.jsx";
import { PLAYER_RANKINGS } from "../services/player-leaderboard.js";
import {
  competitionLabel,
  orderedCompetitions,
} from "../services/competition-selector.js";
export const navigation = pages
  .filter((page) => page.navigation !== false)
  .map((page) => [page.path, page.title]);
/**
 * The list filter keeps its own text so fast typing is never overwritten by
 * a URL update still in flight. The URL follows after a short pause; outside
 * changes (chip removal, reset, navigation) still replace the text.
 */
function QueryField({ label, placeholder }) {
  const f = useFootball(),
    external = f.filters.query;
  const [value, setValue] = useState(external),
    committed = useRef(external),
    timer = useRef(null);
  useEffect(() => {
    if (external === committed.current) return;
    committed.current = external;
    window.clearTimeout(timer.current);
    setValue(external);
  }, [external]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const commit = (text) => {
    window.clearTimeout(timer.current);
    if (text === committed.current) return;
    committed.current = text;
    f.setFilters((v) => ({ ...v, query: text }));
  };
  return (
    <div className="filter-input-wrap">
      <Icon name="search" />
      <input
        id="player-search"
        type="search"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
        value={value}
        onChange={(e) => {
          const text = e.target.value;
          setValue(text);
          window.clearTimeout(timer.current);
          // Clearing applies at once; typing waits for a short pause.
          if (!text) commit(text);
          else timer.current = window.setTimeout(() => commit(text), 180);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(value);
        }}
        onBlur={() => commit(value)}
      />
    </div>
  );
}
export function Filters({ kind = "performances" }) {
  const f = useFootball(),
    fixtures = kind === "fixtures",
    home = kind === "home",
    // Playing time and advanced filters only make sense on the players page.
    players = kind === "players",
    advancedCount = players ? countAdvanced(f.filters.advanced) : 0,
    [advancedOpen, setAdvancedOpen] = useState(advancedCount > 0),
    panelId = useId();
  const reset = () => {
    f.setFilters({ query: "", league: "all", minutes: 1, match: "all" });
    if (home) {
      f.changeFocus("all");
      f.savePreferences({ favoriteLeagueIds: [], onboardingComplete: true });
    }
  };
  const minutes = [
    [1, "Joueurs entrés en jeu"],
    [30, "Moyenne ≥ 30 min"],
    [60, "Moyenne ≥ 60 min"],
    [90, "Moyenne ≥ 90 min"],
    [0, "Inclure le banc"],
  ];
  const active =
    (!home && f.filters.query) ||
    f.filters.league !== "all" ||
    (home &&
      (f.preferences.favoriteLeagueIds.length > 0 || f.focus === "europe")) ||
    (players &&
      (f.filters.minutes !== 1 ||
        advancedCount > 0 ||
        f.filters.ranking ||
        f.filters.leagues?.length)) ||
    (!fixtures && f.filters.match !== "all");
  const competitions = useMemo(
    () => orderedCompetitions(f.competitions),
    [f.competitions],
  );
  const selected = competitions.find((c) => c.id === f.filters.league);
  return (
    <section className="filter-panel" aria-label="Filtres des données">
      <div
        className={`filter-fields${fixtures ? " fixture-filter-fields" : ""}`}
      >
        {!home && (
          <div className="filter-field filter-search">
            <label htmlFor="player-search">Recherche</label>
            <QueryField
              label={
                fixtures
                  ? "Filtrer par club ou compétition"
                  : players
                    ? "Filtrer les joueurs par nom ou club"
                    : "Filtrer par joueur ou club"
              }
              placeholder={
                fixtures
                  ? "Club, compétition…"
                  : players
                    ? "Filtrer les joueurs…"
                    : "Joueur, club…"
              }
            />
          </div>
        )}
        {home ? (
          <HomePreferences f={f} />
        ) : (
          <div className="filter-field">
            <label htmlFor="league-filter">Compétition</label>
            <div className="filter-input-wrap">
              <Icon name="trophy" />
              <select
                id="league-filter"
                value={f.filters.league}
                onChange={(e) =>
                  f.setFilters((v) => ({
                    ...v,
                    league: e.target.value,
                    leagues: [],
                    match: "all",
                  }))
                }
              >
                <option value="all">Toutes les compétitions</option>
                <CompetitionOptions competitions={competitions} />
              </select>
              <Icon name="chevron" className="select-chevron" />
            </div>
          </div>
        )}
        {!home && <SeasonFilter f={f} />}
        {players && (
          <div className="filter-field">
            <label htmlFor="minutes-filter">Temps de jeu moyen</label>
            <div className="filter-input-wrap">
              <Icon name="timer" />
              <select
                id="minutes-filter"
                value={f.filters.minutes}
                onChange={(e) =>
                  f.setFilters((v) => ({
                    ...v,
                    minutes: Number(e.target.value),
                  }))
                }
              >
                {minutes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Icon name="chevron" className="select-chevron" />
            </div>
          </div>
        )}
        {players && (
          <AdvancedToggle
            open={advancedOpen}
            controls={panelId}
            onToggle={() => setAdvancedOpen((open) => !open)}
          />
        )}
        {!home && <CompetitionScope />}
        {home && active && (
          <button className="filter-reset-button" onClick={reset}>
            <Icon name="reset" /> Réinitialiser
          </button>
        )}
      </div>
      {players && advancedOpen && <AdvancedPanel id={panelId} />}
      {active && !home && (
        <div className="filter-panel-footer">
          <div className="filter-applied">
            {players && f.filters.ranking && (
              <button
                className="filter-chip"
                aria-label={`Retirer le classement ${PLAYER_RANKINGS[f.filters.ranking].label}`}
                onClick={() => f.setFilters((v) => ({ ...v, ranking: "" }))}
              >
                {PLAYER_RANKINGS[f.filters.ranking].label}
                <Icon name="close" />
              </button>
            )}
            {players && f.filters.leagues?.length > 1 && (
              <button
                className="filter-chip"
                aria-label="Retirer les compétitions de l’accueil"
                onClick={() => f.setFilters((v) => ({ ...v, leagues: [] }))}
              >
                {f.filters.leagues.length} compétitions
                <Icon name="close" />
              </button>
            )}
            {selected && !home && (
              <button
                className="filter-chip"
                aria-label={`Retirer la compétition ${selected.name}`}
                onClick={() =>
                  f.setFilters((v) => ({ ...v, league: "all", match: "all" }))
                }
              >
                <span className="scope-dot" />
                {competitionLabel(selected)}
                <Icon name="close" />
              </button>
            )}
            {f.filters.query && (
              <button
                className="filter-chip"
                aria-label="Retirer la recherche"
                onClick={() => f.setFilters((v) => ({ ...v, query: "" }))}
              >
                {f.filters.query}
                <Icon name="close" />
              </button>
            )}
            {players && f.filters.minutes !== 1 && (
              <button
                className="filter-chip"
                aria-label="Retirer le filtre de temps de jeu"
                onClick={() => f.setFilters((v) => ({ ...v, minutes: 1 }))}
              >
                {minutes.find(([v]) => v === f.filters.minutes)?.[1]}
                <Icon name="close" />
              </button>
            )}
            {players &&
              advancedChips(f.filters.advanced).map((chip) => (
                <button
                  key={chip.key}
                  className="filter-chip"
                  aria-label={`Retirer le filtre ${chip.label}`}
                  onClick={() =>
                    f.setFilters((v) => ({
                      ...v,
                      advanced: chip.clear(v.advanced),
                    }))
                  }
                >
                  {chip.label}
                  <Icon name="close" />
                </button>
              ))}
            {!fixtures && f.filters.match !== "all" && (
              <button
                className="filter-chip"
                onClick={() => f.setFilters((v) => ({ ...v, match: "all" }))}
              >
                Retirer le filtre du match
                <Icon name="close" />
              </button>
            )}
          </div>
          <button className="filter-reset-button" onClick={reset}>
            <Icon name="reset" />
            Réinitialiser
          </button>
        </div>
      )}
    </section>
  );
}
export default function Layout({
  path,
  title,
  titleIcon,
  filters = false,
  filterKind = "performances",
  hideHeading = false,
  actions,
  className = "",
  subnav,
  performanceComparison = true,
  children,
}) {
  const f = useFootball();
  const research = useResearch();
  return (
    <>
      <Link className="skip-link" href="#main">
        Aller au contenu
      </Link>
      <div className="app-shell">
        <SiteHeader path={path} href={f.navigationHref || f.href} />
        <main id="main" className={`workspace ${className}`} tabIndex="-1">
          {!hideHeading && (
            <div className="page-heading">
              <div className="page-heading-copy">
                <h1
                  className={`page-title${titleIcon ? " page-title-with-icon" : ""}`}
                >
                  {titleIcon ? (
                    <>
                      {titleIcon}
                      <span>{title}</span>
                    </>
                  ) : (
                    title
                  )}
                </h1>
                {f.partial && (
                  <p className="page-context">
                    <span className="page-progress" role="status">
                      Top 7 + UEFA affichés, autres compétitions en cours de
                      chargement…
                    </span>
                  </p>
                )}
              </div>
              {actions && <div className="heading-actions">{actions}</div>}
            </div>
          )}
          {subnav}
          {filters && <Filters kind={filterKind} />}
          {filters && filterKind === "performances" && <PlayerSearchResults />}
          {f.notice && (
            <div role="status" className="notice">
              {f.notice}
              <button onClick={() => f.setNotice("")}>Fermer</button>
            </div>
          )}
          {children}
        </main>
      </div>
      <PlayerDialog />
      {performanceComparison &&
        (!(
          path === "/joueurs/" &&
          research?.data.comparison.length &&
          research.comparisonKind === "players"
        ) ||
          f.comparing) && <Comparison />}
    </>
  );
}
