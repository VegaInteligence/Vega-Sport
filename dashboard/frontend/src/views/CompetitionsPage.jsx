"use client";
import { useSearchParams } from "next/navigation";
import BackLink from "../components/BackLink.jsx";
import Link from "next/link";
import React, {
  useState,
  useEffect,
  useDeferredValue,
  useMemo,
  useCallback,
} from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import CompetitionOptions from "../components/CompetitionOptions.jsx";
import CompetitionSkeleton from "../components/CompetitionSkeleton.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  Card,
  Media,
  Pager,
  AsyncState,
  Segments,
  Empty,
  Skeleton,
} from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import MatchdaySchedule from "../components/MatchdaySchedule.jsx";
import { LeagueHistoryRail, LeagueHistoryView } from "../components/LeagueHistory.jsx";
import { isHistorySeason, useLeagueHistory, withHistorySeasons } from "../services/league-history.js";
import {
  defaultCompetitionMatchStatus,
  orderCompetitionMatches,
} from "../services/competition-matches.js";
import { editionArtworkUrl } from "../services/competition-artwork.js";
import { normalizeText, seasonLabel } from "../services/format.js";
import { useResource } from "../services/resources.js";
import { competitionFixturePreview } from "../services/fixture-pages.js";
import { compactGeneration } from "../services/compact-reads.js";
import { parisDay } from "../services/fixtures.js";
import {
  cupIndex as loadCupIndex,
  servesCupWorkerIndex,
} from "../services/catalog-client.js";
import CompetitionHighlights from "../components/CompetitionHighlights.jsx";
import LeagueRoundCards from "../components/LeagueRoundCards.jsx";
import LeagueRace from "../components/LeagueRace.jsx";
import { useLeagueRounds } from "../services/league-rounds.js";
import SeasonSelect from "../components/SeasonSelect.jsx";
import CupCompetition from "../components/CupCompetition.jsx";
import NationsCompetition from "../components/NationsCompetition.jsx";
import NativeKnockoutBracket from "../components/NativeKnockoutBracket.jsx";
import {
  EUROPE_FOCUS_IDS,
  inEuropeFocus,
} from "../../../shared/competition-scope.js";
import CompetitionStandings from "../components/CompetitionStandings.jsx";
import SeasonProjection from "../components/SeasonProjection.jsx";
import { useSeasonProjection } from "../services/forecasts.js";
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
import EditionHeader, { FollowedTeam } from "../components/EditionHeader.jsx";
import NationalFlag from "../components/NationalFlag.jsx";
import { nationalTeamLabel } from "../services/national-flags.js";
import { trophyArt } from "../services/trophy-art.js";
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
/**
 * A collected competition's page. A cup's (`hasKnockout`) has the edition's head: the page that holds it may offer a
 * sister competition's editions in the same selector (`editions`, `onEdition`: the World Cup's archive), open a view
 * (`initialView`), follow a team through the bracket (`highlight`, `onHighlight`) and be told of the view chosen
 * (`onView`, `onSeason`: its address follows).
 */
function Fixtures({
  competition,
  day,
  initialSeason,
  initialView,
  editions,
  onEdition,
  onView,
  onSeason,
  highlight = "",
  onHighlight,
  heading = false,
}) {
  const f = useFootball();
  // The five big leagues also offer their archived seasons, 2010/11–2020/21 (services/league-history.js).
  const seasons = withHistorySeasons(competition);
  const [season, setSeason] = useState(
    (initialSeason &&
      seasons.find(
        (s) => String(s) === initialSeason || seasonLabel(s) === initialSeason,
      )) ||
      competition?.seasons?.find((s) => seasonLabel(s) === f.season) ||
      competition?.seasons?.[0] ||
      f.season,
  );
  const supported = !day;
  const archived = !day && isHistorySeason(competition?.id, seasonLabel(season));
  const history = useLeagueHistory(archived ? competition?.id : null, seasonLabel(season));
  const hasKnockout = Boolean(
    competition &&
    (competition.id === WORLD_CUP_ID ||
      FEATURED_EUROPE_IDS.includes(competition.id) ||
      competition.cupWorker),
  );
  // The World Cup opens on its bracket (mock-up of 18 Nov 2026), any other competition on its table.
  const worldCup = competition?.id === WORLD_CUP_ID;
  const asked = initialView === "groups" ? "standings" : initialView;
  const [view, setViewState] = useState(
    !supported
      ? "matches"
      : asked === "standings" ||
          asked === "matches" ||
          (asked === "bracket" && hasKnockout) ||
          (asked === "players" && !hasKnockout)
        ? asked
        : worldCup
          ? "bracket"
          : "standings",
  );
  const setView = (next) => {
    setViewState(next);
    onView?.(next);
  };
  function pickSeason(value) {
    const other = (editions || []).find(
      (edition) =>
        edition.season === String(value) && edition.id !== competition.id,
    );
    if (other) return onEdition?.(other);
    setSeason(value);
    onSeason?.(String(value));
    const next = seasonLabel(value);
    if (f.manifest.seasons.some((s) => s.id === next)) f.changeSeason(next);
    setPage(1);
  }
  const changeView = (next) => {
    if (next === "matches" && view !== "matches") {
      setStatus("finished");
      setPage(1);
    }
    setView(next);
  };
  useEffect(() => {
    if (competition?.seasons?.includes(season)) return;
    const equivalent = competition?.seasons?.find(
      (item) => seasonLabel(item) === seasonLabel(season),
    );
    if (equivalent) setSeason(equivalent);
  }, [competition?.seasons, season]);
  const [status, setStatus] = useState(() =>
    defaultCompetitionMatchStatus(day),
  );
  const [page, setPage] = useState(1);
  // A league's table is read from the API for any season (the official one, else the one
  // the base computes from the results), so the standings view needs a preview of the
  // fixtures, not the season's whole calendar. CompetitionStandings asks for the
  // calendar when that table cannot be shown (needFixtures below).
  const previewEnabled =
    !day &&
    !archived &&
    Boolean(competition) &&
    !hasKnockout &&
    f.manifest.capabilities?.fixturePaginationOrder === true;
  const fixtureScope = `${competition?.id}:${season}`;
  const [fallbackScope, setFallbackScope] = useState(null);
  const needFixtures = useCallback(
    () => setFallbackScope(fixtureScope),
    [fixtureScope],
  );
  const needsFullCalendar =
    !previewEnabled || view !== "standings" || fallbackScope === fixtureScope;
  const preview = useResource(
    `competition-preview:${fixtureScope}:${compactGeneration(f.manifest)}:${parisDay(Date.now())}`,
    ({ signal }) =>
      competitionFixturePreview(
        {
          league: competition.id,
          season,
          generation: compactGeneration(f.manifest),
        },
        { signal },
      ).catch((error) => {
        if (error.status === 409) void f.refreshManifest().catch(() => {});
        throw error;
      }),
    previewEnabled && view === "standings",
  );
  const resource = useResource(
    "fixtures:" +
      competition?.id +
      ":" +
      season +
      ":" +
      day +
      ":" +
      f.configured +
      ":" +
      (f.manifest.publicationVersion ||
        f.manifest.scouting?.sourceDigest ||
        ""),
    async ({ signal }) => {
      const scoped = Object.assign(Object.create(f.client), {
        // The shared resource owns freshness. A client's older in-memory map
        // must not override a newly published season or a deliberate retry.
        fixtures: new Map(),
        browseMode: day ? "day" : "catalog",
        day,
        competitionId: competition?.id,
        season,
        competition,
        useCupSnapshot: hasKnockout || Boolean(competition?.cupWorker),
      });
      await f.client.loadFixtures.call(scoped, { signal });
      return scoped.fixtures.get(
        day ? "date:" + day : competition.id + ":" + season,
      );
    },
    f.statusKnown && needsFullCalendar && !archived,
  );
  const showHighlights = supported && view === "standings" && !archived;
  // The league replayed to its end, where the base projects it (a domestic league in progress).
  const projection = useSeasonProjection(
    supported && !archived ? competition?.id : null,
    seasonLabel(season),
  );
  // A league with a closed round has the whole Player of the Season race (VI-44); a cup has no rounds.
  const leagueRounds = useLeagueRounds(
    supported && !hasKnockout && !archived ? competition?.id : null,
    seasonLabel(season),
  );
  const hasRace = Boolean(leagueRounds.value?.latest);
  // Asked for by its address, the view gives way to the table where the league has no race.
  const noRace = !archived && view === "players" && !leagueRounds.loading && !hasRace;
  useEffect(() => {
    if (noRace) setViewState("standings");
  }, [noRace]);
  const views = archived
    ? [
        ["standings", "Classement"],
        ["matches", "Matchs"],
        ["players", "Joueurs"],
      ]
    : worldCup
    ? [
        ["bracket", "Tableau"],
        ["standings", "Groupes"],
        ["matches", "Matchs"],
      ]
    : [
        ["standings", "Classement"],
        ["matches", "Matchs"],
        ...(hasKnockout ? [["bracket", "Tableau"]] : []),
        ...(projection ? [["projection", "Projection"]] : []),
        ...(hasRace ? [["players", "Joueurs"]] : []),
      ];
  // Every competition, league or cup, has the edition's head on one row (#61).
  const editionHead = !day;
  const overviewFixtures = resource.value || preview.value;
  const artwork =
    resource.error || resource.refreshError
      ? null
      : overviewFixtures?.editionArtwork;
  const imageUrl = editionArtworkUrl(
    competition?.id,
    competition?.imageUrl,
    artwork,
  );
  return (
    <div
      className={
        "competition-detail-layout" +
        (showHighlights || archived ? " competition-detail-layout--overview" : "")
      }
    >
      <Card
        title={editionHead ? null : "Calendrier par date"}
        className={"competition-detail" + (editionHead ? " edition-card" : "")}
      >
        {editionHead && (
          <EditionHeader
            imageUrl={imageUrl}
            name={competition.name}
            heading={heading}
            label="Saison de compétition"
            season={String(season)}
            onSeason={pickSeason}
            editions={
              editions ||
              seasons.map((value) => ({
                season: String(value),
                id: competition.id,
              }))
            }
          >
            {highlight && worldCup && (
              <FollowedTeam
                label={nationalTeamLabel(highlight)}
                flag={<NationalFlag name={highlight} season={season} />}
                onClear={() => onHighlight?.("")}
              />
            )}
            {supported && (
              <Segments
                value={view}
                onChange={changeView}
                label="Vue de la compétition"
                items={views}
              />
            )}
          </EditionHeader>
        )}
        {archived ? (
          <LeagueHistoryView resource={history} view={view} />
        ) : supported && view === "standings" ? (
          <CompetitionStandings
            competition={competition}
            season={season}
            matches={overviewFixtures?.matches || []}
            source={resource.value?.source}
            fixturesLoading={!resource.value}
            fixturesError={resource.error}
            onRetry={resource.retry}
            onNeedFixtures={needFixtures}
            served
          />
        ) : supported && view === "players" && !hasKnockout && (hasRace || leagueRounds.loading) ? (
          <LeagueRace
            key={seasonLabel(season)}
            competition={competition?.id}
            season={seasonLabel(season)}
          />
        ) : supported && view === "projection" && projection ? (
          <SeasonProjection
            projection={projection}
            competition={competition}
            season={season}
          />
        ) : (
          <AsyncState resource={resource}>
            {(value) => {
              const rows = orderCompetitionMatches(
                (value.matches || []).filter(
                  (m) =>
                    f.focus !== "europe" ||
                    inEuropeFocus(competition) ||
                    EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId),
                ),
                { status, day: Boolean(day) },
              );
              const pages = Math.max(1, Math.ceil(rows.length / 30)),
                current = Math.min(page, pages);
              return (
                <>
                  {supported && view === "bracket" && hasKnockout ? (
                    <NativeKnockoutBracket
                      competition={competition}
                      season={season}
                      matches={value.matches || []}
                      rounds={value.rounds}
                      highlight={highlight}
                      trophy={trophyArt({
                        title: competition.name,
                        trophyYear: Number(String(season).slice(0, 4)),
                      })}
                    />
                  ) : supported ? (
                    <MatchdaySchedule
                      key={competition.id + ":" + season}
                      competition={competition}
                      season={season}
                      initialStatus={status}
                      matches={(value.matches || []).filter(
                        (m) =>
                          f.focus !== "europe" ||
                          inEuropeFocus(competition) ||
                          EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId),
                      )}
                    />
                  ) : (
                    <>
                      <Segments
                        value={status}
                        onChange={(v) => {
                          setStatus(v);
                          setPage(1);
                        }}
                        label="Statut des rencontres"
                        items={[
                          ["finished", "Résultats"],
                          ["not_started", "À venir"],
                          ["all", "Tous"],
                        ]}
                      />
                      {!day && (
                        <p className="competition-matches-order">
                          {status === "finished"
                            ? "Les résultats les plus récents en premier"
                            : status === "not_started"
                              ? "Les prochaines rencontres en premier"
                              : "Résultats récents, puis rencontres à venir"}
                        </p>
                      )}
                      {rows.slice((current - 1) * 30, current * 30).map((m) => (
                        <MatchLink key={m.id} match={m} />
                      ))}
                      {!rows.length && (
                        <Empty>
                          {status === "finished"
                            ? "Aucun match terminé disponible pour cette saison."
                            : "Aucune rencontre collectée."}
                        </Empty>
                      )}
                      <Pager page={current} total={pages} onChange={setPage} />
                    </>
                  )}
                </>
              );
            }}
          </AsyncState>
        )}
      </Card>
      {archived && history.value && <LeagueHistoryRail value={history.value} />}
      {showHighlights && overviewFixtures && (
        <CompetitionHighlights
          matches={overviewFixtures.matches || []}
          competition={competition}
          season={season}
          onShowMatches={(next) => {
            setStatus(next);
            setPage(1);
            setView("matches");
          }}
        />
      )}
      {showHighlights && !hasKnockout && (
        <LeagueRoundCards
          competition={competition?.id}
          season={seasonLabel(season)}
          onAllPlayers={() => setView("players")}
        />
      )}
    </div>
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
              <Fixtures
                key={`${selected.id}:${requestedEdition}`}
                competition={selected}
                initialSeason={requestedEdition || openSeason}
                {...(isCup(selected)
                  ? edition
                  : { initialView: edition.initialView, onView: edition.onView, onSeason: edition.onSeason })}
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
