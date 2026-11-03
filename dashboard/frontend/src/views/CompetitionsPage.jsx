"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, {
  useState,
  useEffect,
  useRef,
  useDeferredValue,
  useMemo,
} from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  Card,
  Media,
  Pager,
  AsyncState,
  Segments,
  Empty,
} from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import MatchdaySchedule from "../components/MatchdaySchedule.jsx";
import {
  defaultCompetitionMatchStatus,
  orderCompetitionMatches,
} from "../services/competition-matches.js";
import { normalizeText, seasonLabel } from "../services/format.js";
import { useResource, json, download } from "../services/resources.js";
import { csvString } from "../model.js";
import { dataUrl } from "../data-url.js";
import CompetitionHighlights from "../components/CompetitionHighlights.jsx";
import SeasonSelect from "../components/SeasonSelect.jsx";
import CupCompetition from "../components/CupCompetition.jsx";
import NationsCompetition from "../components/NationsCompetition.jsx";
import NativeKnockoutBracket from "../components/NativeKnockoutBracket.jsx";
import {
  EUROPE_FOCUS_IDS,
  inEuropeFocus,
} from "../../../shared/competition-scope.js";
import CompetitionStandings from "../components/CompetitionStandings.jsx";
import {
  WORLD_CUP_ID,
  mergeCupCatalog,
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
  competitionLabel,
  competitionCountry,
  competitionCountryLabel,
  mergeCompetitionSeasons,
} from "../services/competition-selector.js";
import {
  PREFERRED_COMPETITION_KEY,
  localeCountry,
  preferredCompetition,
} from "../services/competition-standings.js";
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
          {orderedCompetitions(value.competitions).map((c) => (
            <option key={c.folder} value={c.folder}>
              {competitionLabel({ ...c, name: c.name || c.folder })}
            </option>
          ))}
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
          <button
            className="button button-secondary"
            onClick={() => {
              const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
              download(
                `autres-competitions-${id}-${kind}.csv`,
                csvString(
                  keys,
                  rows.map((r) => keys.map((k) => r[k])),
                ),
                "text/csv;charset=utf-8",
              );
            }}
          >
            Exporter CSV
          </button>
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
function Fixtures({ competition, day, initialSeason }) {
  const f = useFootball();
  const [season, setSeason] = useState(
    (initialSeason &&
      competition?.seasons?.find((s) => seasonLabel(s) === initialSeason)) ||
      competition?.seasons?.find((s) => seasonLabel(s) === f.season) ||
      competition?.seasons?.[0] ||
      f.season,
  );
  const supported = !day;
  const hasKnockout = Boolean(
    competition &&
    (competition.id === WORLD_CUP_ID ||
      FEATURED_EUROPE_IDS.includes(competition.id) ||
      competition.cupWorker),
  );
  const [view, setView] = useState(supported ? "standings" : "matches");
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
  const resource = useResource(
    "fixtures:" +
      f.client.id +
      ":" +
      competition?.id +
      ":" +
      season +
      ":" +
      day +
      ":" +
      f.configured,
    async () => {
      const scoped = Object.assign(Object.create(f.client), {
        browseMode: day ? "day" : "catalog",
        day,
        competitionId: competition?.id,
        season,
        competition,
        useCupSnapshot: hasKnockout || Boolean(competition?.cupWorker),
      });
      await f.client.loadFixtures.call(scoped);
      return scoped.fixtures.get(
        day ? "date:" + day : competition.id + ":" + season,
      );
    },
    f.statusKnown,
  );
  const showHighlights = supported && view === "standings";
  return (
    <div
      className={
        "competition-detail-layout" +
        (showHighlights ? " competition-detail-layout--overview" : "")
      }
    >
      <Card
        title={
          competition ? (
            <span className="competition-detail-title">
              <Media name={competition.name} url={competition.imageUrl} />
              <span>
                <strong>{competition.name}</strong>
                <small>{competitionCountryLabel(competition)}</small>
              </span>
            </span>
          ) : (
            "Calendrier par date"
          )
        }
        className="competition-detail"
      >
        {!day && (
          <div className="competition-detail-controls">
            <label>
              Saison de compétition
              <select
                aria-label="Saison de compétition"
                value={season}
                onChange={(e) => {
                  setSeason(e.target.value);
                  const next = seasonLabel(e.target.value);
                  if (f.manifest.seasons.some((s) => s.id === next))
                    f.changeSeason(next);
                  setPage(1);
                }}
              >
                {competition.seasons?.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {supported && (
              <Segments
                value={view}
                onChange={(next) => {
                  if (next === "matches" && view !== "matches") {
                    setStatus("finished");
                    setPage(1);
                  }
                  setView(next);
                }}
                label="Vue de la compétition"
                items={[
                  ["standings", "Classement"],
                  ["matches", "Matchs"],
                  ...(hasKnockout ? [["bracket", "Tableau"]] : []),
                ]}
              />
            )}
          </div>
        )}
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
                  />
                ) : supported && view === "standings" ? (
                  <CompetitionStandings
                    competition={competition}
                    season={season}
                    matches={value.matches || []}
                    source={value.source}
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
      </Card>
      {showHighlights && resource.value && (
        <CompetitionHighlights
          matches={resource.value.matches || []}
          competition={competition}
          season={season}
          onShowMatches={(next) => {
            setStatus(next);
            setPage(1);
            setView("matches");
          }}
        />
      )}
    </div>
  );
}
export default function CompetitionsPage() {
  const f = useFootball();
  const params = useSearchParams();
  const id = params.get("id");
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
  const manualChoice = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let saved = null;
    try {
      saved = window.localStorage.getItem(PREFERRED_COMPETITION_KEY);
    } catch {}
    if (saved) {
      setChoice({ ready: true, saved, country: null });
      return () => {
        active = false;
        controller.abort();
      };
    }
    const timer = setTimeout(() => controller.abort(), 2500);
    (async () => {
      let detected = null;
      try {
        const response = await fetch("/api/visitor-country", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) detected = (await response.json()).country;
      } catch {}
      if (active && !manualChoice.current)
        setChoice({
          ready: true,
          saved: null,
          country:
            detected ||
            localeCountry(navigator.languages || [navigator.language]),
        });
      clearTimeout(timer);
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
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
    json(dataUrl("raw/supplemental-index.json")),
  );
  const workerCupIndex = useResource("cup-worker-index", () =>
    json(dataUrl("raw/cup-worker/index.json")),
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
  const chosenId =
    id ||
    (choice.ready
      ? preferredCompetition(catalog, choice.saved, choice.country)
      : null);
  const selected = (id ? expandedCatalog : catalog).find(
    (c) => c.id === chosenId,
  );
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
      inEuropeFocus(expandedCatalog.find((c) => c.id === id) || { id })
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
    manualChoice.current = true;
    setOpenSeason(
      directory && directorySeason !== "all" ? directorySeason : "",
    );
    try {
      window.localStorage.setItem(PREFERRED_COMPETITION_KEY, next);
    } catch {}
    setChoice({ ready: true, saved: next, country: null });
    setDirectory(false);
    window.history.pushState(
      null,
      "",
      f.href("/competitions/", {
        id: next,
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
  return (
    <Layout
      path="/competitions/"
      title={directory ? "Toutes les compétitions" : "Championnats à la une"}
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
          <section
            className="league-spotlight"
            aria-label="Choisir une compétition"
          >
            <div className="league-spotlight-grid">
              {orderedCompetitions(
                orderedFeatured(catalog, FEATURED_LEAGUE_IDS),
              ).map((c) => (
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
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <small>{competitionCountryLabel(c)}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          {isCup(selected) && (
            <button
              type="button"
              className="inline-link cup-return"
              onClick={openDirectory}
            >
              ← Toutes les compétitions
            </button>
          )}
          {selected ? (
            selected.sourceKey === "nations-league" ? (
              <NationsCompetition key={selected.id} competition={selected} />
            ) : selected.source ? (
              <CupCompetition
                key={selected.id}
                competition={selected}
                initialSeason={openSeason}
              />
            ) : (
              <Fixtures
                key={selected.id}
                competition={selected}
                initialSeason={openSeason}
              />
            )
          ) : (!id && !choice.ready) ||
            (id?.startsWith("open-matchday:") && cupIndex.loading) ? (
            <div className="loading-state" role="status">
              Chargement de la compétition…
            </div>
          ) : id?.startsWith("open-matchday:") && cupIndex.error ? (
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
            <button
              type="button"
              className="competition-scope-button"
              aria-pressed={europeOnly}
              onClick={() => setEuropeOnly((value) => !value)}
            >
              <Icon name="trophy" />
              Top 7 Europe + UEFA{europeOnly && <Icon name="check" />}
            </button>
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
                        {c.imageUrl ? (
                          <Media name={c.name} url={c.imageUrl} />
                        ) : (
                          <span
                            className="crest competition-card-fallback"
                            aria-hidden="true"
                          >
                            <Icon name="trophy" />
                          </span>
                        )}
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
              <div className="loading-state" role="status">
                Chargement des compétitions…
              </div>
            ) : (
              <Empty>Aucune compétition ne correspond à ces filtres.</Empty>
            ))}
        </>
      )}
    </Layout>
  );
}
