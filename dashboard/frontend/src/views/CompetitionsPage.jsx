"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useEffect, useRef, useDeferredValue, useMemo } from "react";
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
import { defaultCompetitionMatchStatus, orderCompetitionMatches } from "../services/competition-matches.js";
import { normalizeText, seasonLabel } from "../services/format.js";
import { useResource, json, download } from "../services/resources.js";
import { csvString } from "../model.js";
import { dataUrl } from "../data-url.js";
import CompetitionScope from "../components/CompetitionScope.jsx";
import CompetitionHighlights from "../components/CompetitionHighlights.jsx";
import CupCompetition from "../components/CupCompetition.jsx";
import NativeKnockoutBracket from "../components/NativeKnockoutBracket.jsx";
import { EUROPE_FOCUS_IDS } from "../../../shared/competition-scope.js";
import CompetitionStandings from "../components/CompetitionStandings.jsx";
import { WORLD_CUP_ID, mergeCupCatalog, competitionSearchText, normalizeCompetitionQuery } from "../services/cup-catalog.js";
import { FEATURED_EUROPE_IDS, FEATURED_LEAGUE_IDS, countryLabel, orderedFeatured, orderedCountryCodes, competitionGroups, orderedCompetitions, competitionLabel, competitionCountry, competitionCountryLabel } from "../services/competition-selector.js";
import {
  PREFERRED_COMPETITION_KEY, localeCountry,
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
function Supplemental() {
  const [id, setId] = useState(""),
    [kind, setKind] = useState("results");
  const result = useResource("supplemental", async () => {
    const index = await json(dataUrl("raw/supplemental-index.json"));
    return {
      meta: index.meta,
      competitions: await Promise.all(
        index.competitions.map(async (c) => {
          const { tables, ...value } = c;
          for (const [name, ref] of Object.entries(tables)) {
            const r = await fetch(dataUrl(ref.path));
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            value[name] = await new Response(
              r.body.pipeThrough(new DecompressionStream("gzip")),
            ).json();
          }
          return value;
        }),
      ),
    };
  });
  return (
    <AsyncState resource={result}>
      {(value) => (
        <SupplementalPanel
          data={value}
          id={id}
          kind={kind}
          onId={setId}
          onKind={setKind}
        />
      )}
    </AsyncState>
  );
}

function Fixtures({ competition, day }) {
  const f = useFootball();
  const [season, setSeason] = useState(
    competition?.seasons?.find((s) => seasonLabel(s) === f.season) || competition?.seasons?.[0] || f.season,
  );
  const supported = !day;
  const hasKnockout = Boolean(competition && (competition.id === WORLD_CUP_ID || FEATURED_EUROPE_IDS.includes(competition.id)));
  const [view, setView] = useState(supported ? "standings" : "matches");
  const [status, setStatus] = useState(() => defaultCompetitionMatchStatus(day));
  const [page, setPage] = useState(1);
  const resource = useResource(
    "fixtures:" + f.client.id + ":" + competition?.id + ":" + season + ":" + day + ":" + f.configured,
    async () => {
      const scoped = Object.assign(Object.create(f.client), {
        browseMode: day ? "day" : "catalog", day, competitionId: competition?.id, season,
      });
      await f.client.loadFixtures.call(scoped);
      return scoped.fixtures.get(day ? "date:" + day : competition.id + ":" + season);
    },
    f.statusKnown,
  );
  const showHighlights = supported && view === "standings";
  return (
    <div className={"competition-detail-layout" + (showHighlights ? " competition-detail-layout--overview" : "")}>
    <Card title={competition ? <span className="competition-detail-title"><Media name={competition.name} url={competition.imageUrl} /><span><strong>{competition.name}</strong><small>{competitionCountryLabel(competition)}</small></span></span> : "Calendrier par date"} className="competition-detail">
      {!day && (
        <div className="competition-detail-controls">
          <label>Saison de compétition
            <select aria-label="Saison de compétition" value={season} onChange={(e) => {
              setSeason(e.target.value);
              const next = seasonLabel(e.target.value);
              if (f.manifest.seasons.some((s) => s.id === next)) f.changeSeason(next);
              setPage(1);
            }}>
              {competition.seasons?.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {supported && <Segments value={view} onChange={(next) => { if (next === "matches" && view !== "matches") { setStatus("finished"); setPage(1); } setView(next); }} label="Vue de la compétition" items={[["standings", "Classement"], ["matches", "Matchs"], ...(hasKnockout ? [["bracket", "Tableau"]] : [])]} />}
        </div>
      )}
      <AsyncState resource={resource}>
        {(value) => {
          const rows = orderCompetitionMatches(
            (value.matches || []).filter((m) => f.focus !== "europe" || EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId)),
            { status, day: Boolean(day) },
          );
          const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
          return <>
            {value.error && <p role="status">{value.error} · données collectées affichées.</p>}
            {supported && view === "bracket" && hasKnockout ? <NativeKnockoutBracket competition={competition} season={season} matches={value.matches || []} /> : supported && view === "standings" ? <CompetitionStandings competition={competition} season={season} matches={value.matches || []} source={value.source} /> : supported ? <MatchdaySchedule key={competition.id + ":" + season} competition={competition} season={season} initialStatus={status} matches={(value.matches || []).filter((m) => f.focus !== "europe" || EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId))} /> : <>
              <Segments value={status} onChange={(v) => { setStatus(v); setPage(1); }} label="Statut des rencontres" items={[["finished", "Résultats"], ["not_started", "À venir"], ["all", "Tous"]]} />
              {!day && <p className="competition-matches-order">{status === "finished" ? "Les résultats les plus récents en premier" : status === "not_started" ? "Les prochaines rencontres en premier" : "Résultats récents, puis rencontres à venir"}</p>}
              {rows.slice((current - 1) * 30, current * 30).map((m) => <MatchLink key={m.id} match={m} />)}
              {!rows.length && <Empty>{status === "finished" ? "Aucun match terminé disponible pour cette saison." : "Aucune rencontre collectée."}</Empty>}
              <Pager page={current} total={pages} onChange={setPage} />
            </>}
          </>;
        }}
      </AsyncState>
    </Card>
    {showHighlights && resource.value && (
      <CompetitionHighlights
        matches={resource.value.matches || []}
        competition={competition}
        season={season}
        onShowMatches={(next) => { setStatus(next); setPage(1); setView("matches"); }}
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
  const [supplemental, setSupplemental] = useState(false);
  const [day, setDay] = useState("");
  const [choice, setChoice] = useState({ ready: false, saved: null, country: null });
  const manualChoice = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let saved = null;
    try { saved = window.localStorage.getItem(PREFERRED_COMPETITION_KEY); } catch {}
    if (saved) {
      setChoice({ ready: true, saved, country: null });
      return () => { active = false; controller.abort(); };
    }
    const timer = setTimeout(() => controller.abort(), 2500);
    (async () => {
      let detected = null;
      try {
        const response = await fetch("/api/visitor-country", { cache: "no-store", signal: controller.signal });
        if (response.ok) detected = (await response.json()).country;
      } catch {}
      if (active && !manualChoice.current) setChoice({ ready: true, saved: null, country: detected || localeCountry(navigator.languages || [navigator.language]) });
      clearTimeout(timer);
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);
  // The archived catalogue corrects a few provider country codes even while
  // the full season is still loading (for example Turkey's 1. Lig).
  const referenceCountries = useMemo(() => {
    const countries = new Map();
    for (const season of f.manifest.seasons) {
      for (const chunk of season.chunks) {
        for (const competition of chunk.competitions || []) {
          if (competition.id && competition.country && !countries.has(competition.id))
            countries.set(competition.id, competition.country);
        }
      }
    }
    return countries;
  }, [f.manifest]);
  const cupIndex = useResource("supplemental-cup-index", () => json(dataUrl("raw/supplemental-index.json")));
  const nativeCatalog = f.catalog.map((c) => ({
    ...c,
    country: referenceCountries.get(c.id) || c.country,
    seasons: [...new Set([...(c.seasons || []), ...f.manifest.seasons.flatMap((s) =>
      s.chunks.filter((chunk) => chunk.leagueId === c.id).flatMap((chunk) =>
        chunk.competitions?.find((item) => item.id === c.id)?.seasons || chunk.meta?.catalogSeasons || chunk.meta?.seasons || [],
      ),
    )])].sort().reverse(),
  }));
  const expandedCatalog = mergeCupCatalog(nativeCatalog, cupIndex.value);
  const catalog = f.focus === "europe" ? expandedCatalog.filter((competition) => EUROPE_FOCUS_IDS.has(competition.id)) : expandedCatalog;
  const chosenId = id || (choice.ready ? preferredCompetition(catalog, choice.saved, choice.country) : null);
  const selected = (id ? expandedCatalog : catalog).find((c) => c.id === chosenId);
  const rows = orderedCompetitions(catalog).filter((c) =>
    (country === "all" || competitionCountry(c) === country) && competitionSearchText(c, competitionCountryLabel(c)).includes(normalizeCompetitionQuery(query)),
  );
  // Render the first screen immediately, then the rest of the catalogue.
  const complete = useDeferredValue(true, false);
  const groups = competitionGroups(rows, complete ? Infinity : 120);
  const internationalCups = [WORLD_CUP_ID, "open-cup:euro", "open-cup:club-world-cup"].map((key) => expandedCatalog.find((competition) => competition.id === key)).filter(Boolean);
  const nationalCups = expandedCatalog.filter((competition) =>
    competition.id === "open-cup:france-cup" || competition.source === "open-matchday",
  );
  const nationalCupGroups = competitionGroups(nationalCups);
  const selectedNationalCup = nationalCups.some((competition) => competition.id === selected?.id)
    ? selected.id
    : "";
  useEffect(() => {
    if (!id || f.focus !== "europe" || EUROPE_FOCUS_IDS.has(id)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("focus", "all");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [id, f.focus]);
  function openDirectory() {
    if (f.focus === "europe") {
      const url = new URL(window.location.href);
      url.searchParams.set("focus", "all");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    setDirectory(true);
  }
  function chooseCompetition(next) {
    manualChoice.current = true;
    try { window.localStorage.setItem(PREFERRED_COMPETITION_KEY, next); } catch {}
    setChoice({ ready: true, saved: next, country: null });
    setDirectory(false);
    window.history.pushState(null, "", f.href("/competitions/", { id: next, ...(f.focus === "europe" && !EUROPE_FOCUS_IDS.has(next) ? { focus: "all" } : {}) }));
  }
  return (
    <Layout path="/competitions/" title="Compétitions" showSeasonContext={!selected?.source} showDataContext={!selected?.source}>
      {!directory ? <>
        <section
            className="league-spotlight"
            aria-label="Choisir une compétition"
          >
            <div className="league-spotlight-heading">
              <div>
                <h2>Championnats à la une</h2>
                <p>Retrouvez les sept grandes ligues européennes.</p>
              </div>
              <div className="league-spotlight-actions">
                <Link
                  className="button button-secondary"
                  href={f.href("/archives/")}
                >
                  Archives
                </Link>
                <button
                  className="button button-secondary"
                  onClick={openDirectory}
                >
                  Toutes les compétitions <Icon name="arrow" />
                </button>
              </div>
            </div>
            <div className="league-spotlight-grid">
              {orderedCompetitions(orderedFeatured(catalog, FEATURED_LEAGUE_IDS)).map((c) => (
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
            {orderedFeatured(catalog, FEATURED_EUROPE_IDS).length > 0 && (
              <div className="league-spotlight-cups">
                <span>Coupes d’Europe</span>
                {orderedCompetitions(orderedFeatured(catalog, FEATURED_EUROPE_IDS)).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="league-cup-button"
                    aria-pressed={selected?.id === c.id}
                    onClick={() => chooseCompetition(c.id)}
                  >
                    <Media name={c.name} url={c.imageUrl} />
                    <span>{competitionLabel(c)}</span>
                  </button>
                ))}
              </div>
            )}
            {internationalCups.length > 0 && <div className="league-spotlight-cups"><span>Coupes internationales</span>{internationalCups.map((c) => <button key={c.id} type="button" className="league-cup-button" aria-pressed={selected?.id === c.id} onClick={() => chooseCompetition(c.id)}><Media name={c.name} url={c.imageUrl} /><span>{c.name}</span></button>)}</div>}
            {nationalCupGroups.length > 0 && (
              <div className="league-spotlight-cups">
                <span id="national-cups-label">Coupes nationales</span>
                <div className="national-cup-picker" data-selected={Boolean(selectedNationalCup)}>
                  <select
                    aria-labelledby="national-cups-label"
                    value={selectedNationalCup}
                    onChange={(event) => chooseCompetition(event.target.value)}
                  >
                    <option value="" disabled>Choisir une coupe</option>
                    {nationalCupGroups.map((group) => (
                      <optgroup key={group.key} label={group.label}>
                        {group.competitions.map((competition) => (
                          <option key={competition.id} value={competition.id}>
                            {competition.name}{competition.coverage ? " · " + competition.coverage : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <Icon name="chevron" />
                </div>
              </div>
            )}
            {cupIndex.error && <p className="cup-catalog-error" role="status">Les autres coupes nationales sont temporairement indisponibles. <button type="button" onClick={cupIndex.retry}>Réessayer</button></p>}
          </section>
        {selected ? (selected.source ? <CupCompetition key={selected.id} competition={selected} /> : <Fixtures key={selected.id} competition={selected} />) : (!id && !choice.ready) || (id?.startsWith("open-matchday:") && cupIndex.loading) ? <div className="loading-state" role="status">Chargement de la compétition…</div> : id?.startsWith("open-matchday:") && cupIndex.error ? <div className="notice" role="alert">Les coupes nationales sont indisponibles. <button className="button button-secondary" onClick={cupIndex.retry}>Réessayer</button></div> : <Empty>Compétition inconnue ou indisponible.</Empty>}
      </> : <>
        <button className="inline-link competition-back" onClick={() => setDirectory(false)}>← Retour à la compétition</button>
        <div className="clubs-toolbar">
          <CompetitionScope />
          <input type="search" placeholder="Rechercher une compétition…" aria-label="Rechercher une compétition" value={query} onChange={(e) => { setQuery(e.target.value); }} />
          <select aria-label="Filtrer par pays" value={country} onChange={(e) => { setCountry(e.target.value); }}>
            <option value="all">Tous les pays</option>
            {orderedCountryCodes(catalog).map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
          </select>
          <button className="button button-secondary" disabled={f.focus === "europe"} onClick={() => setSupplemental((v) => !v)}>Autres ligues et coupes</button>
          <label>Calendrier par date <input type="date" aria-label="Calendrier par date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        </div>
        {day && <Fixtures key={day} day={day} />}
        {supplemental && f.focus !== "europe" ? <Supplemental /> : <>
          <div className="competition-directory">
            {groups.map((group, index) => (
              <section key={group.key} className="directory-country" aria-labelledby={"competition-country-" + index}>
                <h2 id={"competition-country-" + index}>{group.label}</h2>
                <div className="competition-grid directory-grid">
                  {group.competitions.map((c) => <button key={c.id} type="button" className="competition-card competition-card-button" onClick={() => chooseCompetition(c.id)}>
                    <div className="competition-card-header"><Media name={c.name} url={c.imageUrl} /><div><h3>{c.name}</h3><p>{competitionCountryLabel(c)}</p></div></div>
                    <div className="directory-card-footer"><span>{c.seasons?.length || 0} saisons</span><Icon name="arrow" /></div>
                  </button>)}
                </div>
              </section>
            ))}
          </div>
          {!rows.length && (cupIndex.loading ? <div className="loading-state" role="status">Chargement des compétitions…</div> : <Empty>Aucune compétition ne correspond à la recherche.</Empty>)}
        </>}
      </>}
    </Layout>
  );
}
