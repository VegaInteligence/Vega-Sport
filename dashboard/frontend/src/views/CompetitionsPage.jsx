"use client";
import { useSearchParams } from "next/navigation";
import BackLink from "../components/BackLink.jsx";
import Link from "next/link";
import React, { useState, useEffect, useMemo } from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import CompetitionOptions from "../components/CompetitionOptions.jsx";
import CompetitionSkeleton from "../components/CompetitionSkeleton.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Segments, Empty } from "../components/UI.jsx";
import { useResource } from "../services/resources.js";
import {
  cupIndex as loadCupIndex,
  servesCupWorkerIndex,
} from "../services/catalog-client.js";
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
} from "../services/cup-catalog.js";
import {
  FEATURED_EUROPE_IDS,
  FEATURED_LEAGUE_IDS,
  orderedFeatured,
  orderedCompetitions,
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
import { CompetitionSwitcher } from "../components/CompetitionPicker.jsx";
import { EditionPageProvider } from "../components/EditionHeader.jsx";
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
  // § 82: the row of ten cards and the « Toutes les compétitions » page gave way to the bar's panel of tiles.
  const openSeason = "";
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
  // § 78: the competitions chosen in the home's bar are this page's row and where it opens, as on the home (the Top 7
  // focus keeps only its own). Nothing chosen, or exactly the Top 7 Europe + UEFA, and the page is as before.
  const chosenLeagues = [];
  for (const wanted of f.preferences?.favoriteLeagueIds || []) {
    const competition = findCompetition(expandedCatalog, wanted);
    if (
      competition &&
      !chosenLeagues.includes(competition) &&
      (f.focus !== "europe" || inEuropeFocus(competition))
    )
      chosenLeagues.push(competition);
  }
  const featuredIds = [...FEATURED_LEAGUE_IDS, ...FEATURED_EUROPE_IDS];
  const followsHome =
    chosenLeagues.length > 0 &&
    !(
      chosenLeagues.length === featuredIds.length &&
      chosenLeagues.every((c) => featuredIds.includes(c.id))
    );
  const catalog = followsHome
    ? chosenLeagues
    : f.focus === "europe"
      ? expandedCatalog.filter(inEuropeFocus)
      : expandedCatalog;
  const spotlight = followsHome
    ? [
        ...orderedCompetitions(
          chosenLeagues.filter((c) => !FEATURED_EUROPE_IDS.includes(c.id)),
        ),
        ...orderedFeatured(chosenLeagues, FEATURED_EUROPE_IDS),
      ]
    : [
        ...orderedCompetitions(orderedFeatured(catalog, FEATURED_LEAGUE_IDS)),
        // The three UEFA cups after the seven leagues, in their own order.
        ...orderedFeatured(catalog, FEATURED_EUROPE_IDS),
      ];
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
  // The bar's lists (§ 82): the page's row (« À la une », or « Mes compétitions » by § 78), then every competition
  // grouped by country, as the former « Toutes les compétitions » page.
  const lists = [
    {
      key: "spotlight",
      label: followsHome ? "Mes compétitions" : "À la une",
      competitions: spotlight,
    },
    {
      key: "all",
      label: "Toutes",
      competitions: orderedCompetitions(expandedCatalog),
      grouped: true,
    },
  ];
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
  function chooseCompetition(next) {
    writePreferredCompetition(next);
    preferencesChanged();
    setChoice({ ready: true, saved: next, country: null });
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
  // A cup outside the featured row, reached from elsewhere (a nation's tile): a way back above its title.
  const standalone =
    isCup(selected) && !spotlight.some((c) => c.id === selected.id);
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
  const bar = selected && (
    <>
      <CompetitionSwitcher
        lists={lists}
        current={selected}
        onPick={chooseCompetition}
      />
      <Link
        className="home-settings-segment edition-bar-link"
        href={f.href("/archives/")}
      >
        <Icon name="archive" />
        <span>Archives</span>
      </Link>
    </>
  );
  return (
    <Layout
      path="/competitions/"
      hideHeading={Boolean(selected)}
      className="competitions-page"
      loader={<CompetitionSkeleton />}
      title={followsHome ? "Mes compétitions" : "Compétitions"}
    >
      <EditionPageProvider bar={bar} league={selected?.id}>
        {/* Only a cup with a page of its own: a featured cup is one of the bar's « À la une ». */}
        {standalone && (
          <BackLink
            className="inline-link cup-return"
            href={f.href("/competitions/")}
            label="Compétitions"
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
      </EditionPageProvider>
    </Layout>
  );
}
