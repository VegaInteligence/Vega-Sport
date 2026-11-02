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
import { SPORTSCORE_LEAGUES } from "../services/sportscore-standings.js";
import { FEATURED_EUROPE_IDS, FEATURED_LEAGUE_IDS, countryLabel, orderedFeatured } from "../services/competition-selector.js";
import {
  SIMPLE_LEAGUES, PREFERRED_COMPETITION_KEY, localeCountry,
  preferredCompetition, standingsFromFixtures, hasCompleteHomeAwaySchedule,
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
function ResultStandings({ matches, source }) {
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
function SportscoreTable({ table, index, multiple, matches }) {
  const f = useFootball();
  const teams = useMemo(() => {
    const result = new Map();
    for (const match of matches) {
      for (const team of [match.home_team, match.away_team]) {
        if (!team?.id || !team.name) continue;
        const key = normalizeText(team.name).replace(/[^a-z0-9]/g, "");
        if (!key) continue;
        if (result.has(key) && result.get(key)?.id !== team.id)
          result.set(key, null);
        else if (!result.has(key)) result.set(key, team);
      }
    }
    return result;
  }, [matches]);
  const display = (value) => (value == null ? "—" : number(value));
  return (
    <section className="standings-group">
      {(table.name || multiple) && (
        <h3>{table.name || "Tableau " + (index + 1)}</h3>
      )}
      <div className="table-scroll">
        <table className="data-table standings-table">
          <caption className="sr-only">
            Classement SportScore{table.name ? " : " + table.name : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Équipe</th>
              <th scope="col" title="Points">
                Pts
              </th>
              <th scope="col" title="Matchs joués">
                J
              </th>
              <th scope="col" title="Victoires">
                G
              </th>
              <th scope="col" title="Matchs nuls">
                N
              </th>
              <th scope="col" title="Défaites">
                D
              </th>
              <th scope="col" title="Buts pour">
                BP
              </th>
              <th scope="col" title="Buts contre">
                BC
              </th>
              <th scope="col" title="Différence de buts">
                Diff.
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => {
              const key = normalizeText(row.name).replace(/[^a-z0-9]/g, "");
              const club = teams.get(key);
              const identity = (
                <>
                  <Media name={row.name} url={row.imageUrl} />
                  <span>{row.name}</span>
                </>
              );
              return (
                <tr key={key + ":" + i}>
                  <td>{display(row.position)}</td>
                  <th scope="row">
                    {club ? (
                      <Link
                        className="standings-team"
                        href={f.href("/clubs/", { id: club.id })}
                      >
                        {identity}
                      </Link>
                    ) : (
                      <span className="standings-team">{identity}</span>
                    )}
                  </th>
                  <td className="standings-points">{display(row.points)}</td>
                  <td>{display(row.played)}</td>
                  <td>{display(row.wins)}</td>
                  <td>{display(row.draws)}</td>
                  <td>{display(row.losses)}</td>
                  <td>{display(row.goalsFor)}</td>
                  <td>{display(row.goalsAgainst)}</td>
                  <td>
                    {row.difference == null
                      ? "—"
                      : (row.difference > 0 ? "+" : "") +
                        number(row.difference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Standings({ competition, season, matches, source }) {
  const latest = competition?.seasons?.[0];
  const current = Boolean(latest) && String(latest) === String(season);
  const enabled = current && Boolean(SPORTSCORE_LEAGUES[competition.id]);
  const external = useResource(
    "sportscore-standings:" + competition.id + ":" + season,
    () =>
      json("/api/standings?competition=" + encodeURIComponent(competition.id)),
    enabled,
  );
  if (enabled && external.loading)
    return (
      <div className="loading-state" role="status">
        Chargement du classement…
      </div>
    );
  if (enabled && external.value?.tables?.length) {
    const tables = external.value.tables;
    return (
      <div className="competition-standings">
        <div className="standings-meta">
          <span>
            Dernier tableau disponible · saison non précisée par la source
          </span>
          <a
            href="https://sportscore.com/"
            rel="dofollow"
            title="Sports data by SportScore"
          >
            SportScore
          </a>
        </div>
        {tables.map((table, index) => (
          <SportscoreTable
            key={index}
            table={table}
            index={index}
            multiple={tables.length > 1}
            matches={matches}
          />
        ))}
        <p className="standings-note">Les classements SportScore et les matchs PitchAPI peuvent être actualisés à des moments différents.</p>
      {tables.length > 1 && tables.some((table) => !table.name) && (
          <p className="standings-note">
            La source ne précise pas le nom de toutes les phases.
          </p>
        )}
      </div>
    );
  }
  if (
    SIMPLE_LEAGUES.has(competition.id) ||
    hasCompleteHomeAwaySchedule(matches)
  )
    return <ResultStandings matches={matches} source={source} />;
  if (enabled && external.error)
    return (
      <div className="standings-unavailable">
        <p role="status">Le classement est temporairement indisponible.</p>
        <button className="button button-secondary" onClick={external.retry}>
          Réessayer
        </button>
      </div>
    );
  return (
    <Empty>
      {!current
        ? "Aucun classement de cette saison n’est disponible. Les matchs restent consultables dans l’onglet Matchs."
        : "Classement indisponible pour cette compétition pour le moment. Retrouvez ses matchs dans l’onglet Matchs."}
    </Empty>
  );
}

function Fixtures({ competition, day }) {
  const f = useFootball();
  const [season, setSeason] = useState(
    competition?.seasons?.find((s) => seasonLabel(s) === f.season) || competition?.seasons?.[0] || f.season,
  );
  const supported = !day;
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
    <Card title={competition ? <span className="competition-detail-title"><Media name={competition.name} url={competition.imageUrl} /><span><strong>{competition.name}</strong><small>{countryLabel(competition.country)}</small></span></span> : "Calendrier par date"} className="competition-detail">
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
          {supported && <Segments value={view} onChange={setView} label="Vue de la compétition" items={[["standings", "Classement"], ["matches", "Matchs"]]} />}
        </div>
      )}
      <AsyncState resource={resource}>
        {(value) => {
          const rows = (value.matches || []).filter((m) =>
            (status === "all" || m.status === status) &&
            (f.focus !== "europe" || EUROPE_FOCUS_IDS.has(m.league?.id || m.leagueId)),
          );
          const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
          return <>
            {value.error && <p role="status">{value.error} · données collectées affichées.</p>}
            {supported && view === "standings" ? <Standings competition={competition} season={season} matches={value.matches || []} source={value.source} /> : <>
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
    (country === "all" || c.country === country) && normalizeText((c.name || "") + " " + (c.country || "") + " " + countryLabel(c.country)).includes(normalizeText(query)),
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
        <section
            className="league-spotlight"
            aria-label="Choisir une compétition"
          >
            <div className="league-spotlight-heading">
              <div>
                <h2>Championnats à la une</h2>
                <p>Retrouvez les sept grandes ligues européennes.</p>
              </div>
              <button
                className="button button-secondary"
                onClick={() => setDirectory(true)}
              >
                Toutes les compétitions <Icon name="arrow" />
              </button>
            </div>
            <div className="league-spotlight-grid">
              {orderedFeatured(catalog, FEATURED_LEAGUE_IDS).map((c) => (
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
                    <small>{countryLabel(c.country)}</small>
                  </span>
                </button>
              ))}
            </div>
            {orderedFeatured(catalog, FEATURED_EUROPE_IDS).length > 0 && (
              <div className="league-spotlight-cups">
                <span>Coupes d’Europe</span>
                {orderedFeatured(catalog, FEATURED_EUROPE_IDS).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="league-cup-button"
                    aria-pressed={selected?.id === c.id}
                    onClick={() => chooseCompetition(c.id)}
                  >
                    <Media name={c.name} url={c.imageUrl} />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        {selected ? <Fixtures key={selected.id} competition={selected} /> : !id && !choice.ready ? <div className="loading-state" role="status">Choix du championnat…</div> : <Empty>Compétition inconnue ou indisponible.</Empty>}
      </> : <>
        <button className="inline-link competition-back" onClick={() => setDirectory(false)}>← Retour à la compétition</button>
        <div className="clubs-toolbar">
          <CompetitionScope />
          <input type="search" placeholder="Rechercher une compétition…" aria-label="Rechercher une compétition" value={query} onChange={(e) => { setQuery(e.target.value); }} />
          <select aria-label="Filtrer par pays" value={country} onChange={(e) => { setCountry(e.target.value); }}>
            <option value="all">Tous les pays</option>
            {[...new Set(catalog.map((c) => c.country).filter(Boolean))].sort().map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
          </select>
          <button className="button button-secondary" disabled={f.focus === "europe"} onClick={() => setSupplemental((v) => !v)}>Autres ligues et coupes</button>
          <label>Calendrier par date <input type="date" aria-label="Calendrier par date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        </div>
        {day && <Fixtures key={day} day={day} />}
        {supplemental && f.focus !== "europe" ? <Supplemental /> : <>
          <div className="competition-grid directory-grid">
            {(complete ? rows : rows.slice(0, 120)).map((c) => <button key={c.id} className="competition-card competition-card-button" onClick={() => chooseCompetition(c.id)}>
              <div className="competition-card-header"><Media name={c.name} url={c.imageUrl} /><div><h2>{c.name}</h2><p>{countryLabel(c.country)}</p></div></div>
              <div className="directory-card-footer"><span>{c.seasons?.length || 0} saisons</span><Icon name="arrow" /></div>
            </button>)}
          </div>
          {!rows.length && <Empty>Aucune compétition ne correspond à la recherche.</Empty>}
        </>}
      </>}
    </Layout>
  );
}
