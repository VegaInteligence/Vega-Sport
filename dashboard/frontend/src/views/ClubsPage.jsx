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
import { Card, Media, Pager, Empty } from "../components/UI.jsx";
import { ProfileDialog } from "../components/PlayerDetails.jsx";
import ClubRanking from "../components/ClubRanking.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import { normalizeText, number } from "../services/format.js";
import { countryLabel } from "../services/competition-selector.js";

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

export default function ClubsPage() {
  const f = useFootball(),
    [query, setQuery] = useState(""),
    [country, setCountry] = useState("all"),
    [paging, setPaging] = useState({ key: "", page: 1 }),
    [profile, setProfile] = useState(false);
  const id = useSearchParams().get("id");
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
            country:
              f.manifest.clubCountries?.[t.id] ||
              (domestic ? leagueCountry : "unknown"),
          });
        if (domestic && map.get(t.id).country === "unknown")
          map.get(t.id).country = leagueCountry;
        map.get(t.id).count++;
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
  const search = normalizeText(useDeferredValue(query)),
    selected = clubs.find((c) => c.id === id),
    visible = useMemo(
      () =>
        clubs.filter(
          (c) =>
            c.search.includes(search) &&
            (activeCountry === "all" || c.country === activeCountry),
        ),
      [clubs, search, activeCountry],
    ),
    layout = useDirectoryCapacity(
      gridRef,
      !selected && visible.length > 0,
      [f.season, f.focus, search, activeCountry].join("|"),
    ),
    capacity = layout.capacity,
    pageKey = [f.season, f.focus, search, activeCountry, capacity].join("|"),
    pages = Math.max(1, Math.ceil(visible.length / capacity)),
    current =
      paging.key === pageKey && paging.data === f.data
        ? Math.min(paging.page, pages)
        : 1,
    shown = visible.slice((current - 1) * capacity, current * capacity);
  useEffect(() => {
    setPaging({ key: pageKey, data: f.data, page: 1 });
  }, [pageKey, f.data]);
  return (
    <Layout path="/clubs/" title={selected ? selected.name : "Clubs"}>
      {selected ? (
        <>
          <Link className="inline-link" href={f.href("/clubs/")}>
            ← Tous les clubs
          </Link>
          <Card
            title={selected.name}
            action={
              <button
                className="button button-secondary"
                onClick={() => setProfile(true)}
              >
                Fiche PitchAPI
              </button>
            }
          >
            <div className="club-identity">
              <Media
                name={selected.name}
                url={selected.imageUrl}
                className="crest club-logo"
              />
              <p>
                {selected.league} · {number(selected.count)} matchs
              </p>
            </div>
          </Card>
          <ClubRanking clubId={id} />
          <Card title="Matchs du club">
            {f.data.matches
              .filter((m) => m.home.id === id || m.away.id === id)
              .map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
          </Card>
          <Card title="Joueurs référencés">
            <div className="club-roster">
              {[
                ...new Map(
                  f.data.appearances
                    .filter((r) => r.teamId === id)
                    .map((r) => [r.playerId, r]),
                ).values(),
              ].map((r) => (
                <Link
                  className="roster-player"
                  key={r.playerId}
                  href={f.href("/joueurs/", { id: r.playerId })}
                >
                  <Media
                    name={r.name}
                    url={r.imageUrl}
                    className="player-avatar"
                  />
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.position || ""}</small>
                  </span>
                </Link>
              ))}
            </div>
          </Card>
          {profile && (
            <ProfileDialog
              id={id}
              kind="teams"
              onClose={() => setProfile(false)}
            />
          )}
        </>
      ) : (
        <>
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
                onChange={(e) => setCountry(e.target.value)}
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
              <span>Saison</span>
              <select
                aria-label="Saison"
                value={f.season}
                onChange={(e) => f.changeSeason(e.target.value)}
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
            {(query || activeCountry !== "all") && (
              <button
                className="filter-reset-button"
                onClick={() => {
                  setQuery("");
                  setCountry("all");
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
                        ? c.league
                        : countryLabel(c.country) + " · " + c.league}
                    </p>
                  </div>
                </div>
                <div className="directory-card-footer">
                  <span>{number(c.count)} matchs</span>
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
