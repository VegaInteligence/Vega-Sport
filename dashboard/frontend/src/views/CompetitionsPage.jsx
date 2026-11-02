"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from "react";
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
import { normalizeText, seasonLabel, number, date } from "../services/format.js";
import { useResource, json, download } from "../services/resources.js";
import { csvString } from "../model.js";
import { dataUrl } from "../data-url.js";
import CompetitionScope from "../components/CompetitionScope.jsx";
import { EUROPE_FOCUS_IDS } from "../../../shared/competition-scope.js";
import {
  SIMPLE_LEAGUES, PREFERRED_COMPETITION_KEY, localeCountry,
  preferredCompetition, standingsFromFixtures,
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
      <p>
        Saison2026/2027 ou année2026 · Source :{" "}
        <Link href="https://github.com/oladeeayo/open-matchday">
          open-matchday
        </Link>{" "}
        · usage non commercial avec attribution · certains matchs recoupent
        PitchAPI.
      </p>
      <label>
        Compétition
        <select value={id} onChange={(e) => onId(e.target.value)}>
          <option value="">Choisir</option>
          {value.competitions.map((c) => (
            <option key={c.folder} value={c.folder}>
              {c.name || c.folder}
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
                `open-matchday-${id}-${kind}.csv`,
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
function Standings({ matches, source }) {
  const f = useFootball();
  const table = useMemo(() => standingsFromFixtures(matches), [matches]);
  if (table.complexSchedule) return <Empty>Le format de cette saison comprend des rencontres supplémentaires : le classement ne peut pas être établi à partir des seuls scores. Retrouvez les matchs dans l’onglet Matchs.</Empty>;
  if (!table.played) return <Empty>Aucun résultat terminé disponible pour établir le classement.</Empty>;
  return (
    <div className="competition-standings">
      <div className="standings-meta">
        <span>{number(table.played)} matchs pris en compte{table.lastDate ? " · dernier match le " + date(table.lastDate) : ""}</span>
        <span>{source === "api" ? "Résultats PitchAPI" : "Archive PitchAPI"}</span>
      </div>
      <div className="table-scroll">
        <table className="data-table standings-table">
          <caption className="sr-only">Classement calculé à partir des résultats disponibles</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Équipe</th><th scope="col" title="Points">Pts</th><th scope="col" title="Matchs joués">J</th><th scope="col" title="Victoires">G</th><th scope="col" title="Matchs nuls">N</th><th scope="col" title="Défaites">D</th><th scope="col" title="Buts pour">BP</th><th scope="col" title="Buts contre">BC</th><th scope="col" title="Différence de buts">Diff.</th></tr></thead>
          <tbody>{table.rows.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <th scope="row"><Link className="standings-team" href={f.href("/clubs/", { id: row.id })}><Media name={row.name} url={row.imageUrl} /> <span>{row.name}</span></Link></th>
              <td className="standings-points">{row.points}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.difference > 0 ? "+" : ""}{row.difference}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="standings-note">Classement calculé à partir des résultats disponibles. Les sanctions et certains critères de départage ne sont pas pris en compte.{table.excluded ? " " + table.excluded + " match(s) terminé(s) sans score exploitable ont été exclus." : ""}</p>
    </div>
  );
}
function Fixtures({ competition, day }) {
  const f = useFootball();
  const [season, setSeason] = useState(
    competition?.seasons?.find((s) => seasonLabel(s) === f.season) || competition?.seasons?.[0] || f.season,
  );
  const supported = !day && SIMPLE_LEAGUES.has(competition?.id);
  const [view, setView] = useState(supported ? "standings" : "matches");
  const [status, setStatus] = useState("all");
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
  return (
    <Card title={competition?.name || "Calendrier par date"} className="competition-detail">
      {!day && (
        <div className="competition-detail-controls">
          <label>Saison de compétition
            <select aria-label="Saison de compétition" value={season} onChange={(e) => {
              setSeason(e.target.value);
              const next = seasonLabel(e.target.value);
              if (f.manifest.seasons.some((s) => s.id === next)) f.changeSeason(next);
              setPage(1);
            }}>
              {competition.seasons?.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
            </select>
          </label>
          {supported && <Segments value={view} onChange={setView} label="Vue de la compétition" items={[["standings", "Classement"], ["matches", "Matchs"]]} />}
        </div>
      )}
      {!day && !supported && <p className="standings-note">Le classement n’est pas disponible pour le format de cette compétition. Retrouvez ses matchs ci-dessous.</p>}
      <AsyncState resource={resource}>
        {(value) => {
          const rows = (value.matches || []).filter((m) =>
            (status === "all" || m.status === status) &&
            (f.focus !== "europe" || EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId)),
          );
          const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
          return <>
            {value.error && <p role="status">{value.error} · données collectées affichées.</p>}
            {supported && view === "standings" ? <Standings matches={value.matches || []} source={value.source} /> : <>
              <Segments value={status} onChange={(v) => { setStatus(v); setPage(1); }} label="Statut des rencontres" items={[["all", "Tous"], ["finished", "Terminés"], ["not_started", "À venir"]]} />
              {rows.slice((current - 1) * 30, current * 30).map((m) => <MatchLink key={m.id} match={m} />)}
              {!rows.length && <Empty>Aucune rencontre collectée.</Empty>}
              <Pager page={current} total={pages} onChange={setPage} />
            </>}
          </>;
        }}
      </AsyncState>
    </Card>
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
  const catalog = f.catalog.map((c) => ({
    ...c,
    seasons: [...new Set([...(c.seasons || []), ...f.manifest.seasons.flatMap((s) =>
      s.chunks.filter((chunk) => chunk.leagueId === c.id).flatMap((chunk) =>
        chunk.competitions?.find((item) => item.id === c.id)?.seasons || chunk.meta?.catalogSeasons || chunk.meta?.seasons || [],
      ),
    )])].sort().reverse(),
  }));
  const chosenId = id || (choice.ready ? preferredCompetition(catalog, choice.saved, choice.country) : null);
  const selected = catalog.find((c) => c.id === chosenId);
  const rows = catalog.filter((c) =>
    (country === "all" || c.country === country) && normalizeText((c.name || "") + " " + (c.country || "")).includes(normalizeText(query)),
  );
  // Render the first screen immediately, then the rest of the catalogue.
  const complete = useDeferredValue(true, false);
  function chooseCompetition(next) {
    manualChoice.current = true;
    try { window.localStorage.setItem(PREFERRED_COMPETITION_KEY, next); } catch {}
    setChoice({ ready: true, saved: next, country: null });
    setDirectory(false);
    window.history.pushState(null, "", f.href("/competitions/", { id: next }));
  }
  return (
    <Layout path="/competitions/" title="Compétitions">
      {!directory ? <>
        <div className="competition-picker">
          <label className="competition-picker-field">Compétition
            <select aria-label="Choisir une compétition" value={selected?.id || ""} onChange={(e) => chooseCompetition(e.target.value)}>
              {!selected && <option value="">Choisir une compétition</option>}
              {[...catalog].sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr")).map((c) => <option key={c.id} value={c.id}>{c.name}{c.country ? " (" + c.country + ")" : ""}</option>)}
            </select>
          </label>
          <button className="button button-secondary" onClick={() => setDirectory(true)}>Toutes les compétitions</button>
        </div>
        {selected ? <Fixtures key={selected.id} competition={selected} /> : !id && !choice.ready ? <div className="loading-state" role="status">Choix du championnat…</div> : <Empty>Compétition inconnue ou indisponible.</Empty>}
      </> : <>
        <button className="inline-link competition-back" onClick={() => setDirectory(false)}>← Retour à la compétition</button>
        <div className="clubs-toolbar">
          <CompetitionScope />
          <input type="search" placeholder="Rechercher une compétition…" aria-label="Rechercher une compétition" value={query} onChange={(e) => { setQuery(e.target.value); }} />
          <select aria-label="Filtrer par pays" value={country} onChange={(e) => { setCountry(e.target.value); }}>
            <option value="all">Tous les pays</option>
            {[...new Set(catalog.map((c) => c.country).filter(Boolean))].sort().map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="button button-secondary" disabled={f.focus === "europe"} onClick={() => setSupplemental((v) => !v)}>Autres ligues et coupes</button>
          <label>Calendrier par date <input type="date" aria-label="Calendrier par date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        </div>
        {day && <Fixtures key={day} day={day} />}
        {supplemental && f.focus !== "europe" ? <Supplemental /> : <>
          <div className="competition-grid directory-grid">
            {(complete ? rows : rows.slice(0, 120)).map((c) => <button key={c.id} className="competition-card competition-card-button" onClick={() => chooseCompetition(c.id)}>
              <div className="competition-card-header"><Media name={c.name} url={c.imageUrl} /><div><h2>{c.name}</h2><p>{c.country}</p></div></div>
              <div className="directory-card-footer"><span>{c.seasons?.length || 0} saisons</span><Icon name="arrow" /></div>
            </button>)}
          </div>
          {!rows.length && <Empty>Aucune compétition ne correspond à la recherche.</Empty>}
        </>}
      </>}
    </Layout>
  );
}
