"use client";
import { useSearchParams } from "next/navigation";
import BackLink from "../components/BackLink.jsx";
import Link from "next/link";
import React, { useState, useEffect, useDeferredValue, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import CompetitionOptions from "../components/CompetitionOptions.jsx";
import CompetitionSkeleton from "../components/CompetitionSkeleton.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Media, Segments, Empty, Skeleton } from "../components/UI.jsx";
import { seasonLabel } from "../services/format.js";
import { useResource } from "../services/resources.js";
import {
  cupIndex as loadCupIndex,
  servesCupWorkerIndex,
} from "../services/catalog-client.js";
import SeasonSelect from "../components/SeasonSelect.jsx";
import CupCompetition from "../components/CupCompetition.jsx";
import NationsCompetition from "../components/NationsCompetition.jsx";
import { inEuropeFocus } from "../../../shared/competition-scope.js";
import {
  WORLD_CUP_ID,
  WORLD_CUP_ARCHIVE_ID,
  awaitsCupIndex,
  findCompetition,
  mergeCupCatalog,
  competitionEditions,
  editionView,
  competitionSearchText,
  normalizeCompetitionQuery,
} from "../services/cup-catalog.js";
import {
  FEATURED_EUROPE_IDS,
  FEATURED_LEAGUE_IDS,
  countryLabel,
  orderedFeatured,
  orderedCountryCodes,
  competitionGroups,
  orderedCompetitions,
  competitionCountry,
  competitionCountryLabel,
  mergeCompetitionSeasons,
} from "../services/competition-selector.js";
import {
  PREFERRED_COMPETITION_KEY,
  VISITOR_COUNTRY_KEY,
  localeCountry,
} from "../services/competition-standings.js";
import { writePreferredCompetition } from "../services/local-preferences.js";
import { openingCompetition } from "../services/preference-effects.js";
import useFavourites from "../hooks/useFavourites.js";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { preferencesChanged } from "../services/user-preferences.js";
import CompetitionEdition from "../components/CompetitionEdition.jsx";
export function SupplementalPanel({
  data: value,
  id = "",
  kind = "results",
  onId = () => {},
  onKind = () => {},
}) {
  const selected = value.competitions.find((c) => c.folder === id),
    rows = selected?.[kind] || [];
  return (
    <Card title="Autres ligues et coupes">
      <p>Saison 2026/2027 ou année 2026.</p>
      <label>
        Compétition
        <select value={id} onChange={(e) => onId(e.target.value)}>
          <option value="">Choisir</option>
          <CompetitionOptions
            competitions={value.competitions}
            valueKey="folder"
          />
        </select>
      </label>
      {selected && (
        <>
          <Segments
            value={kind}
            onChange={onKind}
            label="Données complémentaires"
            items={[
              ["results", "Résultats"],
              ["fixtures", "Calendrier"],
              ["goals", "Buts"],
            ]}
          />
          <div className="table-scroll">
            {rows.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    {Object.keys(rows[0]).map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {Object.keys(rows[0]).map((k) => (
                        <td key={k}>
                          {r[k] === null ||
                          r[k] === undefined ||
                          r[k] === "" ? (
                            <span className="missing-value">—</span>
                          ) : (
                            String(r[k])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>Aucune donnée.</Empty>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
// A cup edition's views in its address, in the site's words.
const VIEW_OF_PARAM = {
  tableau: "bracket",
  groupes: "groups",
  classement: "standings",
  matchs: "matches",
  joueurs: "players",
};
const PARAM_OF_VIEW = {
  bracket: "tableau",
  groups: "groupes",
  standings: "classement",
  matches: "matchs",
  players: "joueurs",
};

function availableView(id, edition, view) {
  if (!view) return "";
  const firstView = editionView({ id, edition });
  if (
    firstView === "matchs" ||
    (firstView === "groupes" && view !== "matchs" && view !== "tableau")
  )
    return firstView;
  return view;
}

export default function CompetitionsPage() {
  const f = useFootball();
  const research = useResearch(),
    favourites = useFavourites();
  const params = useSearchParams();
  const id = params.get("id");
  const requestedEdition = params.get("edition") || "";
  // A cup edition's view and the team followed through it (a nation's tile leads here) are in the address.
  const viewParam = params.get("view") || "";
  const followed = params.get("team") || "";
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("all");
  const [directory, setDirectory] = useState(false);
  // The directory filters stay on this page: they never change the scope of
  // the other pages and never reload the season.
  const [europeOnly, setEuropeOnly] = useState(false);
  const [directorySeason, setDirectorySeason] = useState("all");
  const [openSeason, setOpenSeason] = useState("");
  const [choice, setChoice] = useState({
    ready: false,
    saved: null,
    country: null,
  });
  useEffect(() => {
    let saved = null,
      kept = null;
    try {
      saved = window.localStorage.getItem(PREFERRED_COMPETITION_KEY);
      kept = window.localStorage.getItem(VISITOR_COUNTRY_KEY);
    } catch {}
    if (saved) {
      setChoice({ ready: true, saved, country: null });
      return;
    }
    // Shown at once: the country kept from an earlier visit, else the browser language's.
    setChoice({
      ready: true,
      saved: null,
      country:
        kept || localeCountry(navigator.languages || [navigator.language]),
    });
    // The hosting's country is kept for the next visit: what is shown now never changes.
    const controller = new AbortController();
    fetch("/api/visitor-country", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (/^[A-Z]{2}$/.test(body?.country || ""))
          window.localStorage.setItem(VISITOR_COUNTRY_KEY, body.country);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  // The archived catalogue corrects a few provider country codes even while
  // the full season is still loading (for example Turkey's 1. Lig).
  const referenceCountries = useMemo(() => {
    const countries = new Map();
    for (const season of f.manifest.seasons) {
      for (const chunk of season.chunks) {
        for (const competition of chunk.competitions || []) {
          if (
            competition.id &&
            competition.country &&
            !countries.has(competition.id)
          )
            countries.set(competition.id, competition.country);
        }
      }
    }
    return countries;
  }, [f.manifest]);
  const legacyCupIndex = useResource("supplemental-cup-index", () =>
    loadCupIndex("supplemental"),
  );
  const workerCupIndex = useResource(
    "cup-worker-index",
    () => loadCupIndex("worker"),
    servesCupWorkerIndex(f.manifest),
  );
  const cupIndex = workerCupIndex.value?.competitions?.length
    ? workerCupIndex
    : legacyCupIndex;
  const nativeCatalog = (f.allCatalog || f.catalog).map((c) => ({
    ...c,
    country: referenceCountries.get(c.id) || c.country,
    seasons: mergeCompetitionSeasons(
      c.seasons || [],
      f.manifest.seasons.flatMap((s) =>
        s.chunks
          .filter((chunk) => chunk.leagueId === c.id)
          .flatMap(
            (chunk) =>
              chunk.competitions?.find((item) => item.id === c.id)?.seasons ||
              chunk.meta?.catalogSeasons ||
              chunk.meta?.seasons ||
              [],
          ),
      ),
    ),
  }));
  const expandedCatalog = mergeCupCatalog(
    nativeCatalog,
    cupIndex.value,
    workerCupIndex.value?.native,
  );
  const catalog =
    f.focus === "europe"
      ? expandedCatalog.filter(inEuropeFocus)
      : expandedCatalog;
  // Effects 4 and 11: the saved competition, else the first favourite club's league, else the visitor's country's
  // (homeCountry, not « Aucun pays »), else the detected country / browser language, as before.
  const chosenId =
    id ||
    (choice.ready && f.preferencesReady !== false && research?.ready !== false
      ? openingCompetition(catalog, {
          saved: choice.saved,
          favouriteClubs: favourites.order.clubs,
          clubCountries: f.manifest?.clubCountries,
          homeCountry: f.preferences?.homeCountry,
          detected: choice.country,
        })
      : null);
  // By its own id or the canonical id it answers to (l_v…, VI-30): the URL keeps the id it was asked with.
  const selected = findCompetition(id ? expandedCatalog : catalog, chosenId);
  const directoryCatalog = europeOnly
    ? expandedCatalog.filter(inEuropeFocus)
    : expandedCatalog;
  const seasonOptions = f.manifest.seasons.map((s) => s.id);
  const inSeason = (c) =>
    directorySeason === "all" ||
    (c.seasons || []).some((s) => seasonLabel(s) === directorySeason);
  const directoryCountry =
    country === "all" || orderedCountryCodes(directoryCatalog).includes(country)
      ? country
      : "all";
  const rows = orderedCompetitions(directoryCatalog).filter(
    (c) =>
      (directoryCountry === "all" ||
        competitionCountry(c) === directoryCountry) &&
      inSeason(c) &&
      competitionSearchText(c, competitionCountryLabel(c)).includes(
        normalizeCompetitionQuery(query),
      ),
  );
  // Render the first screen immediately, then the rest of the catalogue.
  const complete = useDeferredValue(true, false);
  const groups = competitionGroups(rows, complete ? Infinity : 120);
  useEffect(() => {
    if (
      !id ||
      f.focus !== "europe" ||
      inEuropeFocus(findCompetition(expandedCatalog, id) || { id })
    )
      return;
    const url = new URL(window.location.href);
    url.searchParams.set("focus", "all");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [id, f.focus]);
  function openDirectory() {
    setEuropeOnly(f.focus === "europe");
    setDirectory("all");
  }
  function chooseCompetition(next) {
    setOpenSeason(
      directory && directorySeason !== "all" ? directorySeason : "",
    );
    writePreferredCompetition(next);
    preferencesChanged();
    setChoice({ ready: true, saved: next, country: null });
    setDirectory(false);
    window.history.pushState(
      null,
      "",
      f.href("/competitions/", {
        id: next,
        edition: "",
        ...(f.focus === "europe" &&
        !inEuropeFocus(
          expandedCatalog.find((c) => c.id === next) || { id: next },
        )
          ? { focus: "all" }
          : {}),
      }),
    );
  }
  const isCup = (competition) =>
    Boolean(
      competition &&
      (competition.source ||
        competition.id === WORLD_CUP_ID ||
        FEATURED_EUROPE_IDS.includes(competition.id) ||
        competition.cupWorker),
    );
  // A cup outside the featured row has a page of its own: no row of leagues above it, its name as the page's title.
  const standalone =
    !directory && isCup(selected) && !FEATURED_EUROPE_IDS.includes(selected.id);
  const currentView = selected
    ? availableView(selected.id, requestedEdition || openSeason, viewParam)
    : viewParam;
  useEffect(() => {
    if (currentView === viewParam) return;
    const url = new URL(window.location.href);
    if (
      url.searchParams.get("id") !== id ||
      url.searchParams.get("view") !== viewParam
    )
      return;
    url.searchParams.set("view", currentView);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [id, viewParam, currentView]);
  // The edition's address: what it holds, and what changes.
  const editionAddress = (next) => {
    const address = {
      // Preserve canonical IDs when changing the current page's controls (VI-30).
      id: id || selected.id,
      edition: requestedEdition,
      view: currentView,
      team: followed,
      ...next,
    };
    address.view = availableView(
      next.id || selected.id,
      address.edition || openSeason,
      address.view,
    );
    return f.href("/competitions/", address);
  };
  const replaceEditionAddress = (next) =>
    window.history.replaceState(null, "", editionAddress(next));
  const edition = selected && {
    initialView: VIEW_OF_PARAM[currentView] || "",
    highlight: followed,
    heading: standalone,
    editions: competitionEditions(selected, expandedCatalog),
    onEdition: (entry) =>
      window.history.pushState(
        null,
        "",
        editionAddress({ id: entry.id, edition: entry.season }),
      ),
    onSeason: (season) => replaceEditionAddress({ edition: season }),
    onView: (view) =>
      replaceEditionAddress({
        view:
          view === "standings" && selected.id === WORLD_CUP_ID
            ? "groupes"
            : PARAM_OF_VIEW[view] || "",
      }),
    onHighlight: (team) => replaceEditionAddress({ team }),
  };
  return (
    <Layout
      path="/competitions/"
      hideHeading={standalone}
      loader={<CompetitionSkeleton />}
      title={directory ? "Toutes les compétitions" : "Compétitions à la une"}
      actions={
        directory ? null : (
          <>
            <Link
              className="button button-secondary"
              href={f.href("/archives/")}
            >
              Archives
            </Link>
            <button className="button button-secondary" onClick={openDirectory}>
              Toutes les compétitions <Icon name="arrow" />
            </button>
          </>
        )
      }
    >
      {!directory ? (
        <>
          {!standalone && (
            <section
              className="league-spotlight"
              aria-label="Choisir une compétition"
            >
              <div className="league-spotlight-grid">
                {[
                  ...orderedCompetitions(
                    orderedFeatured(catalog, FEATURED_LEAGUE_IDS),
                  ),
                  // The three UEFA cups after the seven leagues, in their own order.
                  ...orderedFeatured(catalog, FEATURED_EUROPE_IDS),
                ].map((c) => (
                  <button
                    key={c.id}
                    className="league-spotlight-item"
                    type="button"
                    aria-pressed={selected?.id === c.id}
                    onClick={() => chooseCompetition(c.id)}
                  >
                    <Media
                      name={c.name}
                      url={c.imageUrl}
                      className="crest league-spotlight-logo"
                      initials={false}
                    />
                    <span>
                      <strong>{c.name}</strong>
                      <small>{competitionCountryLabel(c)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {/* Only a cup with a page of its own: a featured cup has the row above, like a league. */}
          {standalone && (
            <BackLink
              className="inline-link cup-return"
              onFallback={openDirectory}
              label="Toutes les compétitions"
            />
          )}
          {selected ? (
            selected.sourceKey === "nations-league" ? (
              <NationsCompetition key={selected.id} competition={selected} />
            ) : selected.source ? (
              <CupCompetition
                key={`${selected.id}:${requestedEdition}`}
                competition={selected}
                name={
                  selected.id === WORLD_CUP_ARCHIVE_ID
                    ? "Coupe du monde"
                    : selected.name
                }
                initialSeason={requestedEdition || openSeason}
                {...edition}
              />
            ) : (
              <CompetitionEdition
                key={`${selected.id}:${requestedEdition}`}
                competition={selected}
                initialSeason={requestedEdition || openSeason}
                {...(isCup(selected)
                  ? edition
                  : {
                      initialView: edition.initialView,
                      onView: edition.onView,
                      onSeason: edition.onSeason,
                    })}
              />
            )
          ) : (!id && !choice.ready) ||
            (awaitsCupIndex(id) && cupIndex.loading) ? (
            <CompetitionSkeleton detail />
          ) : awaitsCupIndex(id) && cupIndex.error ? (
            <div className="notice" role="alert">
              Les coupes nationales sont indisponibles.{" "}
              <button
                className="button button-secondary"
                onClick={cupIndex.retry}
              >
                Réessayer
              </button>
            </div>
          ) : (
            <Empty>Compétition inconnue ou indisponible.</Empty>
          )}
        </>
      ) : (
        <>
          <button
            className="inline-link competition-back"
            onClick={() => setDirectory(false)}
          >
            ← Retour à la compétition
          </button>
          <div className="filter-fields competition-directory-toolbar">
            <div className="filter-field filter-search competition-directory-search">
              <label htmlFor="competition-directory-search">
                Rechercher une compétition
              </label>
              <div className="filter-input-wrap">
                <Icon name="search" />
                <input
                  id="competition-directory-search"
                  type="search"
                  placeholder="Rechercher une compétition…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
              </div>
            </div>
            <div className="filter-rail">
              <button
                type="button"
                className="competition-scope-button"
                aria-pressed={europeOnly}
                onClick={() => setEuropeOnly((value) => !value)}
              >
                <Icon name="trophy" />
                Top 7 Europe + UEFA{europeOnly && <Icon name="check" />}
              </button>
              <div className="filter-field">
                <label htmlFor="competition-directory-country">
                  Filtrer par pays
                </label>
                <div className="filter-input-wrap">
                  <Icon name="globe" />
                  <select
                    id="competition-directory-country"
                    value={directoryCountry}
                    onChange={(e) => {
                      setCountry(e.target.value);
                    }}
                  >
                    <option value="all">Tous les pays</option>
                    {orderedCountryCodes(directoryCatalog).map((c) => (
                      <option key={c} value={c}>
                        {countryLabel(c)}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron" className="select-chevron" />
                </div>
              </div>
              <SeasonSelect
                label="Filtrer par saison"
                allLabel="Toutes les saisons"
                value={directorySeason}
                seasons={seasonOptions}
                onChange={setDirectorySeason}
              />
            </div>
          </div>
          <div className="competition-directory">
            {groups.map((group, index) => (
              <section
                key={group.key}
                className="directory-country"
                aria-labelledby={"competition-country-" + index}
              >
                <h2 id={"competition-country-" + index}>{group.label}</h2>
                <div className="competition-grid directory-grid">
                  {group.competitions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="competition-card competition-card-button"
                      onClick={() => chooseCompetition(c.id)}
                    >
                      <div className="competition-card-header">
                        <Media url={c.imageUrl} initials={false} />
                        <div>
                          <h3>{c.name}</h3>
                          <p>
                            {isCup(c)
                              ? "Coupe · " + competitionCountryLabel(c)
                              : competitionCountryLabel(c)}
                          </p>
                        </div>
                      </div>
                      <div className="directory-card-footer">
                        <span>
                          {c.seasons?.length || 0} saison
                          {(c.seasons?.length || 0) === 1 ? "" : "s"}
                        </span>
                        <Icon name="arrow" />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {!rows.length &&
            (cupIndex.loading ? (
              <Skeleton
                data-page-loading=""
                label="Chargement des compétitions…"
                kind="table"
                lines={8}
              />
            ) : (
              <Empty>Aucune compétition ne correspond à ces filtres.</Empty>
            ))}
        </>
      )}
    </Layout>
  );
}
