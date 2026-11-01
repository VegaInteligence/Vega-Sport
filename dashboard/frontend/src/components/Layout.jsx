import Link from "next/link";
import Icon from "./Icon.jsx";
import { pages } from "../../../shared/pages.js";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { PlayerDialog, Comparison } from "./PlayerDetails.jsx";
import { number, date } from "../services/format.js";
import CompetitionScope from "./CompetitionScope.jsx";
export const navigation = pages.map((page) => [page.path, page.title]);
export function Filters({ fixtures = false }) {
  const f = useFootball();
  const reset = () =>
    f.setFilters({ query: "", league: "all", minutes: 1, match: "all" });
  const minutes = [
    [1, "Joueurs entrés en jeu"],
    [30, "30 minutes et plus"],
    [60, "60 minutes et plus"],
    [90, "90 minutes et plus"],
    [0, "Inclure le banc"],
  ];
  const active =
    f.filters.query ||
    f.filters.league !== "all" ||
    (!fixtures && (f.filters.minutes !== 1 || f.filters.match !== "all"));
  const selected = f.data.competitions.find((c) => c.id === f.filters.league);
  const names = new Map();
  for (const c of f.competitions)
    names.set(c.name, (names.get(c.name) || 0) + 1);
  return (
    <section className="filter-panel" aria-label="Filtres des données">
      <div
        className={`filter-fields${fixtures ? " fixture-filter-fields" : ""}`}
      >
        <div className="filter-field filter-search">
          <label htmlFor="player-search">Recherche</label>
          <div className="filter-input-wrap">
            <Icon name="search" />
            <input
              id="player-search"
              type="search"
              aria-label={
                fixtures
                  ? "Rechercher un club ou une compétition"
                  : "Rechercher un joueur ou un club"
              }
              placeholder={fixtures ? "Club, compétition…" : "Joueur, club…"}
              value={f.filters.query}
              onChange={(e) =>
                f.setFilters((v) => ({ ...v, query: e.target.value }))
              }
            />
          </div>
        </div>
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
                  match: "all",
                }))
              }
            >
              <option value="all">Toutes les compétitions</option>
              {f.competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {names.get(c.name) > 1 ? ` · ${c.country || c.id}` : ""}
                </option>
              ))}
            </select>
            <Icon name="chevron" className="select-chevron" />
          </div>
        </div>
        <div className="filter-field filter-season">
          <label htmlFor="season-filter">Saison</label>
          <div className="filter-input-wrap">
            <Icon name="calendar" />
            <select
              id="season-filter"
              value={f.season}
              onChange={(e) => f.changeSeason(e.target.value)}
            >
              {f.manifest.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
            <Icon name="chevron" className="select-chevron" />
          </div>
        </div>
        {!fixtures && (
          <div className="filter-field">
            <label htmlFor="minutes-filter">Temps de jeu</label>
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
      </div>
      <div className="filter-panel-footer">
        <CompetitionScope />
        <div className="filter-applied">
          {selected && (
            <button
              className="filter-chip"
              aria-label={`Retirer la compétition ${selected.name}`}
              onClick={() =>
                f.setFilters((v) => ({ ...v, league: "all", match: "all" }))
              }
            >
              <span className="scope-dot" />
              {selected.name}
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
          {!fixtures && f.filters.minutes !== 1 && (
            <button
              className="filter-chip"
              aria-label="Retirer le filtre de temps de jeu"
              onClick={() => f.setFilters((v) => ({ ...v, minutes: 1 }))}
            >
              {minutes.find(([v]) => v === f.filters.minutes)?.[1]}
              <Icon name="close" />
            </button>
          )}
          {!fixtures && f.filters.match !== "all" && (
            <button
              className="filter-chip"
              onClick={() => f.setFilters((v) => ({ ...v, match: "all" }))}
            >
              Retirer le filtre du match
              <Icon name="close" />
            </button>
          )}
          {!fixtures && (
            <span className="filter-result-count" aria-live="polite">
              <strong>{number(f.rows.length)}</strong> apparitions{" "}
              <span>·</span> <strong>{number(f.matches.length)}</strong> matchs
            </span>
          )}
        </div>
        {active && (
          <button className="filter-reset-button" onClick={reset}>
            <Icon name="reset" />
            Réinitialiser
          </button>
        )}
      </div>
    </section>
  );
}
export default function Layout({
  path,
  title,
  filters = false,
  filterKind = "performances",
  hideHeading = false,
  className = "",
  children,
}) {
  const f = useFootball();
  return (
    <>
      <Link className="skip-link" href="#main">
        Aller au contenu
      </Link>
      <div className="app-shell">
        <header className="topbar">
          <Link
            className="brand"
            aria-label="Orion, vue d’ensemble"
            href={f.href("/")}
          >
            <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
              <rect width="40" height="40" rx="11" fill="currentColor" />
              <path
                d="M12 25 20 11l8 14M15.5 19h9"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="20" cy="28" r="2" />
            </svg>
            <span className="brand-word">
              orion<span className="brand-period">.</span>
            </span>
          </Link>
          <nav className="main-nav" aria-label="Navigation principale">
            {navigation.map(([url, label]) => (
              <Link
                key={url}
                className="nav-button"
                aria-current={path === url ? "page" : undefined}
                href={f.href(url)}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="topbar-meta">
            <span className="status-dot" />
            {f.configured ? "PitchAPI configuré" : "Données collectées"}
          </div>
        </header>
        <main id="main" className={`workspace ${className}`} tabIndex="-1">
          {!hideHeading && (
            <div className="page-heading">
              <h1 className="page-title">{title}</h1>
              <div className="heading-actions">
                {f.data.meta.retrievedAt && (
                  <span className="snapshot-label">
                    {date(f.data.meta.retrievedAt)}
                  </span>
                )}
                {filters && filterKind !== "fixtures" && (
                  <button
                    className="button button-secondary"
                    onClick={() => f.exportRows()}
                  >
                    <Icon name="download" /> Exporter les données
                  </button>
                )}
              </div>
            </div>
          )}
          {filters && <Filters fixtures={filterKind === "fixtures"} />}
          {f.notice && (
            <div role="status" className="notice">
              {f.notice}
              <button onClick={() => f.setNotice("")}>Fermer</button>
            </div>
          )}
          {children}
          <footer className="app-footer">
            <span>orion.</span>
            <Link
              href="https://github.com/OrionQuantPlatform/Football_Ranking"
              target="_blank"
              rel="noreferrer"
            >
              Voir le projet ↗
            </Link>
          </footer>
        </main>
      </div>
      <PlayerDialog />
      <Comparison />
    </>
  );
}
