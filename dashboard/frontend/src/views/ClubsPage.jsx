"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, {
  useDeferredValue,
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import Icon from "../components/Icon.jsx";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Media, Pager, Empty } from "../components/UI.jsx";
import ClubWorkspace from "../components/ClubWorkspace.jsx";
import { ResearchLists } from "../components/ResearchUI.jsx";
import { clubMatchHistory } from "../services/club-matches.js";
import { normalizeText, number } from "../services/format.js";
import {
  countryLabel,
  competitionCountry,
  competitionLabel,
  orderedCompetitions,
} from "../services/competition-selector.js";

function useDirectoryCapacity(gridRef, active, scope) {
  const [layout, setLayout] = useState({ capacity: 12, height: undefined });
  useLayoutEffect(() => {
    if (!active || !gridRef.current) return;
    const grid = gridRef.current;
    const measure = () => {
      const card = grid.firstElementChild;
      if (!card) return;
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(" ").length;
      const gap = parseFloat(style.rowGap) || 0;
      const height = card.getBoundingClientRect().height;
      const top = grid.getBoundingClientRect().top + window.scrollY;
      // Reserve the pager, its margin and a small bottom gutter.
      const available = window.innerHeight - top - 64;
      const rows = Math.max(1, Math.floor((available + gap) / (height + gap)));
      const capacity = columns * rows;
      const pageHeight = rows * height + (rows - 1) * gap;
      setLayout((previous) =>
        previous.capacity === capacity && previous.height === pageHeight
          ? previous
          : { capacity, height: pageHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [gridRef, active, scope]);
  return layout;
}

function ClubsViewSwitch({ saved = false, href }) {
  return (
    <nav className="matches-view-switch" aria-label="Vue des clubs">
      <Link
        href={href("/clubs/", { clubsView: "" })}
        aria-current={saved ? undefined : "page"}
      >
        Explorer
      </Link>
      <Link
        href={href("/clubs/", { clubsView: "saved" })}
        aria-current={saved ? "page" : undefined}
      >
        Mes clubs
      </Link>
    </nav>
  );
}

export default function ClubsPage() {
  const f = useFootball(),
    [query, setQuery] = useState(""),
    [country, setCountry] = useState("all"),
    [competitionId, setCompetitionId] = useState("all"),
    [paging, setPaging] = useState({ key: "", page: 1 });
  const params = useSearchParams(),
    id = params.get("id");
  const gridRef = useRef(null);
  const clubs = useMemo(() => {
    const map = new Map();
    const competitions = new Map(f.data.competitions.map((c) => [c.id, c]));
    for (const m of f.data.matches)
      for (const side of ["home", "away"]) {
        const t = m[side];
        const leagueCountry = competitions.get(m.leagueId)?.country;
        const domestic =
          leagueCountry &&
          !["UEFA", "INT", "INT-2", "FIFA"].includes(leagueCountry);
        if (!map.has(t.id))
          map.set(t.id, {
            ...t,
            league: m.league,
            count: 0,
            competitionCounts: {},
            country:
              f.manifest.clubCountries?.[t.id] ||
              (domestic ? leagueCountry : "unknown"),
          });
        if (domestic && map.get(t.id).country === "unknown")
          map.get(t.id).country = leagueCountry;
        map.get(t.id).count++;
        const counts = map.get(t.id).competitionCounts;
        counts[m.leagueId] = (counts[m.leagueId] || 0) + 1;
      }
    return [...map.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((club) => ({ ...club, search: normalizeText(club.name) }));
  }, [f.data, f.manifest.clubCountries]);
  const countries = useMemo(
    () =>
      [...new Set(clubs.map((c) => c.country))].sort((a, b) =>
        a === "unknown"
          ? 1
          : b === "unknown"
            ? -1
            : countryLabel(a).localeCompare(countryLabel(b), "fr"),
      ),
    [clubs],
  );
  const activeCountry = countries.includes(country) ? country : "all";
  const competitions = useMemo(() => {
    const represented = new Set(
      clubs.flatMap((club) => Object.keys(club.competitionCounts)),
    );
    return orderedCompetitions(
      f.data.competitions.filter(
        (competition) =>
          represented.has(competition.id) &&
          (activeCountry === "all" ||
            competitionCountry(competition) === activeCountry),
      ),
    );
  }, [clubs, f.data.competitions, activeCountry]);
  const activeCompetition = competitions.find((c) => c.id === competitionId);
  const activeCompetitionId = activeCompetition?.id || "all";
  const search = normalizeText(useDeferredValue(query)),
    selected = clubs.find((c) => c.id === id),
    visible = useMemo(
      () =>
        clubs.filter(
          (c) =>
            c.search.includes(search) &&
            (activeCountry === "all" || c.country === activeCountry) &&
            (activeCompetitionId === "all" ||
              c.competitionCounts[activeCompetitionId] > 0),
        ),
      [clubs, search, activeCountry, activeCompetitionId],
    ),
    layout = useDirectoryCapacity(
      gridRef,
      !selected && visible.length > 0,
      [f.season, f.focus, search, activeCountry, activeCompetitionId].join("|"),
    ),
    capacity = layout.capacity,
    pageKey = [
      f.season,
      f.focus,
      search,
      activeCountry,
      activeCompetitionId,
      capacity,
    ].join("|"),
    pages = Math.max(1, Math.ceil(visible.length / capacity)),
    current =
      paging.key === pageKey && paging.data === f.data
        ? Math.min(paging.page, pages)
        : 1,
    shown = visible.slice((current - 1) * capacity, current * capacity);
  useEffect(() => {
    setPaging({ key: pageKey, data: f.data, page: 1 });
  }, [pageKey, f.data]);
  const clubMatches = useMemo(
    () => clubMatchHistory(f.data.matches, f.data.fixtures, id),
    [f.data.matches, f.data.fixtures, id],
  );
  return (
    <Layout path="/clubs/" title="Clubs">
      {selected ? (
        <>
          <Link
            className="inline-link competition-back"
            href={f.href("/clubs/", { clubView: "", clubScope: "", vs: "" })}
          >
            ← Tous les clubs
          </Link>
          <ClubWorkspace
            key={selected.id}
            club={{
              ...selected,
              countryLabel:
                selected.country === "unknown"
                  ? ""
                  : countryLabel(selected.country),
            }}
            history={clubMatches}
          />
        </>
      ) : params.get("clubsView") === "saved" ? (
        <>
          <ClubsViewSwitch saved href={f.href} />
          <ResearchLists kind="clubs" />
        </>
      ) : (
        <>
          <ClubsViewSwitch href={f.href} />
          <div className="clubs-toolbar club-directory-toolbar">
            <div className="filter-input-wrap club-directory-search">
              <Icon name="search" />
              <input
                placeholder="Rechercher un club…"
                type="search"
                aria-label="Rechercher un club"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="club-directory-select">
              <span>Pays</span>
              <select
                aria-label="Pays des clubs"
                value={activeCountry}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setCompetitionId("all");
                }}
              >
                <option value="all">Tous les pays</option>
                {countries.map((value) => (
                  <option key={value} value={value}>
                    {value === "unknown"
                      ? "Pays non renseigné"
                      : countryLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="club-directory-select">
              <span>Compétition</span>
              <select
                aria-label="Compétition des clubs"
                value={activeCompetitionId}
                onChange={(e) => setCompetitionId(e.target.value)}
              >
                <option value="all">Toutes les compétitions</option>
                {competitions.map((competition) => (
                  <option key={competition.id} value={competition.id}>
                    {competitionLabel(competition)}
                  </option>
                ))}
              </select>
            </label>
            <label className="club-directory-select">
              <span>Saison</span>
              <select
                aria-label="Saison"
                value={f.season}
                onChange={(e) => {
                  setQuery("");
                  setCountry("all");
                  setCompetitionId("all");
                  f.changeSeason(e.target.value);
                }}
              >
                {f.manifest.seasons.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="club-directory-summary"
            role="status"
            aria-live="polite"
          >
            <span>
              {number(visible.length)} club{visible.length === 1 ? "" : "s"}
            </span>
            {(query ||
              activeCountry !== "all" ||
              activeCompetitionId !== "all") && (
              <button
                className="filter-reset-button"
                onClick={() => {
                  setQuery("");
                  setCountry("all");
                  setCompetitionId("all");
                }}
              >
                <Icon name="reset" /> Réinitialiser
              </button>
            )}
          </div>
          <div
            className="competition-grid directory-grid club-directory-grid"
            ref={gridRef}
            style={{ minHeight: pages > 1 ? layout.height : undefined }}
          >
            {shown.map((c) => (
              <Link
                className="competition-card"
                key={c.id}
                href={f.href("/clubs/", { id: c.id })}
              >
                <div className="competition-card-header">
                  <Media name={c.name} url={c.imageUrl} />
                  <div>
                    <h2>{c.name}</h2>
                    <p>
                      {c.country === "unknown"
                        ? activeCompetition?.name || c.league
                        : countryLabel(c.country) +
                          " · " +
                          (activeCompetition?.name || c.league)}
                    </p>
                  </div>
                </div>
                <div className="directory-card-footer">
                  <span>
                    {number(
                      activeCompetition
                        ? c.competitionCounts[activeCompetitionId]
                        : c.count,
                    )}{" "}
                    matchs
                  </span>
                  <Icon name="arrow" />
                </div>
              </Link>
            ))}
          </div>
          {!visible.length && <Empty>Aucun club pour ces filtres.</Empty>}
          <Pager
            page={current}
            total={pages}
            label="Pagination des clubs"
            onChange={(page) => setPaging({ key: pageKey, data: f.data, page })}
          />
        </>
      )}
    </Layout>
  );
}
