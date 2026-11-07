"use client";
import React, { useDeferredValue, useMemo, useState } from "react";
import CompetitionOptions from "./CompetitionOptions.jsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FootballContext, useFootball } from "../hooks/FootballContext.jsx";
import useActorRead from "../hooks/useActorRead.js";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { actorReadParams } from "../services/actor-reads.js";
import {
  CLUB_METRICS,
  CLUB_STYLE_KEYS,
  allClubSummaries,
  clubCompetitions,
  clubMetric,
  clubSquad,
  clubStyleCohort,
  clubSummary,
  cohortMedian,
  formationRecords,
  headToHead,
  orientedCentile,
  similarClubs,
  upcomingClubMatches,
} from "../services/club-analysis.js";
import { date, isNumber, normalizeText, number } from "../services/format.js";
import { Card, Empty, Media, Segments } from "./UI.jsx";
import Icon from "./Icon.jsx";
import { MatchLink } from "./MatchLink.jsx";
import ClubForm from "./ClubForm.jsx";
import ClubRanking from "./ClubRanking.jsx";
import { ClubFacts, ClubRoster } from "./ClubProfile.jsx";
import { BookmarkButton, ResearchTabs, ReportButton } from "./ResearchUI.jsx";
import { ResearchRadar } from "./ResearchCharts.jsx";
import useCompactRead from "../hooks/useCompactRead.js";
import {
  compactGeneration,
  compactScope,
  supportsCompactRead,
} from "../services/compact-reads.js";

const TABS = [
  ["overview", "Vue d’ensemble"],
  ["squad", "Effectif"],
  ["matches", "Matchs"],
  ["style", "Profil de jeu"],
  ["compare", "Comparer"],
];
const MIN_COHORT = 10;
const OUTCOME_KEYS = new Set([
  "xgFor",
  "xgAgainst",
  "xgDifference",
  "shotsFor",
  "shotsAgainst",
  "shotsOnTarget",
]);
const decimals = (key) => (key === "possession" ? 1 : 2);
const signed = (value, digits = 0) =>
  isNumber(value) ? `${value > 0 ? "+" : ""}${number(value, digits)}` : "—";
const metricLabel = (key) =>
  CLUB_METRICS[key].label + (CLUB_METRICS[key].lowerIsBetter ? " ↓" : "");
const axisLabel = (key) =>
  metricLabel(key)
    .replace(" / match", "")
    .replace("Ballons dans la surface", "Touches surface");

function setParam(key, value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", url.pathname + url.search);
}

/** One cohort per competition scope, computed only when a tab needs it. */
function useCohort(data, competition, enabled) {
  const f = useFootball(),
    remote = f.compactMode,
    params = {
      season: f.season,
      leagues: compactScope(competition === "all" ? null : [competition]),
      analysis: 1,
      generation: compactGeneration(f.manifest),
      limit: 100,
    },
    resource = useCompactRead("clubs", params, {
      enabled: enabled && remote && supportsCompactRead(f.manifest, "clubs"),
      allPages: true,
      refreshManifest: f.refreshManifest,
    });
  const value = useMemo(() => {
    if (!enabled || (remote && !resource.value)) return null;
    const clubs = (
      remote
        ? resource.value.data.clubs
        : allClubSummaries(data, { competition })
    ).filter((club) => club.matches > 0);
    const distributions = clubStyleCohort(clubs);
    return {
      clubs,
      distributions,
      size: Math.max(0, ...Object.values(distributions).map((v) => v.length)),
    };
  }, [data, competition, enabled, remote, resource.value]);
  return remote ? { ...resource, value } : { value };
}

function RecordTable({ club }) {
  const rows = [
    ["Total", club],
    ["Domicile", club.home],
    ["Extérieur", club.away],
  ];
  return (
    <div className="table-scroll">
      <table className="data-table club-record-table">
        <caption className="sr-only">Bilan de la saison</caption>
        <thead>
          <tr>
            <th scope="col">Bilan</th>
            <th scope="col">MJ</th>
            <th scope="col">V</th>
            <th scope="col">N</th>
            <th scope="col">D</th>
            <th scope="col">BP</th>
            <th scope="col">BC</th>
            <th scope="col">Diff.</th>
            <th scope="col">Pts / match</th>
            <th scope="col">Sans encaisser</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, record]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{number(record.matches)}</td>
              <td>{number(record.wins)}</td>
              <td>{number(record.draws)}</td>
              <td>{number(record.losses)}</td>
              <td>{number(record.goalsFor)}</td>
              <td>{number(record.goalsAgainst)}</td>
              <td>{signed(record.goalsFor - record.goalsAgainst)}</td>
              <td>
                {record.matches
                  ? number(record.points / record.matches, 2)
                  : "—"}
              </td>
              <td>{number(record.cleanSheets)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormStrip({ club, limit = 5 }) {
  const f = useFootball();
  const forms = club.forms.slice(0, limit).reverse();
  if (!forms.length) return null;
  return (
    <div
      className="research-form"
      aria-label="Forme récente, du plus ancien au plus récent"
    >
      {forms.map((form) => (
        <Link
          key={form.match.id}
          data-result={form.result}
          title={`${date(form.match.date)} · ${form.match.home.name} ${form.match.home.score}–${form.match.away.score} ${form.match.away.name}`}
          href={f.href("/matchs/", {
            tab: "results",
            id: form.match.id,
            competition: form.match.leagueId,
            sourceSeason: form.match.season,
          })}
        >
          {form.result}
        </Link>
      ))}
    </div>
  );
}

function Overview({ club, summary, history, allHistory, competitionName }) {
  const f = useFootball();
  const [informationRef, informationVisible] = useVisibleIntent(
    `${club.id}:${f.season}`,
  );
  const upcoming = useMemo(
    () => upcomingClubMatches(summary, Date.now(), 3),
    [summary],
  );
  const figures = [
    ["xgFor", "xG pour / match"],
    ["xgAgainst", "xG contre / match"],
    ["shotsFor", "Tirs / match"],
    ["possession", "Possession"],
  ];
  return (
    <div className="club-overview">
      <div className="season-player-figures club-figures">
        {figures.map(([key, label]) => {
          const metric = clubMetric(summary, key);
          return (
            <div key={key}>
              <span>{label}</span>
              <strong>
                {isNumber(metric.value)
                  ? `${number(metric.value, decimals(key))}${key === "possession" ? " %" : ""}`
                  : "—"}
              </strong>
              {metric.count < summary.matches && (
                <small>
                  {metric.count}/{summary.matches} matchs renseignés
                </small>
              )}
            </div>
          );
        })}
      </div>
      <section className="club-overview-panel club-overview-record">
        <div className="season-section-heading">
          <h3>Bilan · {competitionName}</h3>
          {summary.unscored > 0 && (
            <span>{summary.unscored} matchs sans score exploitable exclus</span>
          )}
        </div>
        {summary.matches ? (
          <>
            <p className="club-overview-scroll-hint">
              Faites défiler le tableau pour voir toutes les statistiques.
            </p>
            <RecordTable club={summary} />
          </>
        ) : (
          <Empty>Aucun match terminé pour ce périmètre.</Empty>
        )}
      </section>
      <div className="club-overview-matches">
        <section className="club-overview-panel">
          <div className="season-section-heading">
            <h3>Derniers résultats</h3>
          </div>
          <ClubForm matches={history} clubId={club.id} href={f.href} />
          <div className="club-match-list">
            {summary.forms.slice(0, 4).map((form) => (
              <MatchLink key={form.match.id} match={form.match} />
            ))}
          </div>
        </section>
        <section className="club-overview-panel">
          <div className="season-section-heading">
            <h3>Prochains matchs</h3>
          </div>
          {upcoming.length ? (
            <div className="club-match-list">
              {upcoming.map((match) => (
                <MatchLink key={match.id} match={match} showKickoff />
              ))}
            </div>
          ) : (
            <Empty>Aucun match à venir collecté.</Empty>
          )}
        </section>
      </div>
      <div className="club-overview-info" ref={informationRef}>
        {informationVisible && (
          <>
            <ClubFacts club={club} matches={allHistory} />
            <ClubRanking clubId={club.id} />
          </>
        )}
      </div>
    </div>
  );
}

function Squad({ club, summary }) {
  const f = useFootball(),
    [mode, setMode] = useState("minutes");
  const squad = useMemo(() => clubSquad(f.data, summary), [f.data, summary]);
  const possible = summary.matches * 90;
  return (
    <>
      <div className="research-toolbar">
        <Segments
          label="Présentation de l’effectif"
          value={mode}
          onChange={setMode}
          items={[
            ["minutes", "Temps de jeu"],
            ["roster", "Par poste"],
          ]}
        />
      </div>
      {mode === "roster" ? (
        <ClubRoster
          clubId={club.id}
          appearances={f.data.appearances}
          href={f.href}
          season={f.season}
        />
      ) : squad.profiles.length ? (
        <>
          <div className="research-stat-strip club-rotation">
            <div>
              <span>Joueurs utilisés</span>
              <strong>{number(squad.used)}</strong>
            </div>
            <div>
              <span>Minutes des 11 plus utilisés</span>
              <strong>
                {isNumber(squad.topElevenMinuteShare)
                  ? `${number(squad.topElevenMinuteShare)} %`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Titulaires reconduits</span>
              <strong>
                {isNumber(squad.continuity)
                  ? `${number(squad.continuity, 1)} / 11`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Compositions connues</span>
              <strong>
                {number(squad.lineupMatches)}
                <small> / {number(summary.matches)}</small>
              </strong>
            </div>
          </div>
          <p className="club-note">
            Titulaires reconduits : moyenne des joueurs gardés dans le onze d’un
            match au suivant, sur les compositions complètes collectées.
          </p>
          <div className="table-scroll">
            <table className="data-table club-squad-table">
              <caption className="sr-only">Temps de jeu de l’effectif</caption>
              <thead>
                <tr>
                  <th scope="col">Joueur</th>
                  <th scope="col">MJ</th>
                  <th scope="col">Tit.</th>
                  <th scope="col">Minutes</th>
                  <th scope="col">Part du temps de jeu</th>
                  <th scope="col">Buts</th>
                  <th scope="col">PD</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {squad.profiles.map((player) => {
                  const share = possible
                    ? (player.minutes / possible) * 100
                    : null;
                  return (
                    <tr key={player.id}>
                      <th scope="row">
                        <Link
                          className="table-player"
                          href={f.href("/joueurs/", { id: player.id, q: "" })}
                        >
                          <Media
                            name={player.name}
                            url={player.imageUrl}
                            className="player-avatar"
                          />
                          <span className="player-copy">
                            <strong className="player-name">
                              {player.name}
                            </strong>
                            <span className="player-meta">
                              {player.role?.label || "Poste non renseigné"}
                            </span>
                          </span>
                        </Link>
                      </th>
                      <td>{number(player.matches)}</td>
                      <td>
                        {player.knownStarts ? number(player.starts) : "—"}
                      </td>
                      <td>{number(player.minutes)}</td>
                      <td>
                        {isNumber(share) ? (
                          <span className="club-share">
                            <span>
                              <i
                                style={{ width: `${Math.min(100, share)}%` }}
                              />
                            </span>
                            {number(share)} %
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{number(player.stats.goals?.sum ?? null)}</td>
                      <td>{number(player.stats.assists?.sum ?? null)}</td>
                      <td>{number(player.rating, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty>
          Aucune performance individuelle collectée pour ce périmètre.
        </Empty>
      )}
    </>
  );
}

function GoalTimes({ summary }) {
  const times = summary.goalTimes,
    max = Math.max(1, ...times.for, ...times.against);
  const labels = ["0–15′", "16–30′", "31–45′", "46–60′", "61–75′", "76–90′+"];
  if (!times.observed)
    return <Empty>Aucun but daté dans les tirs collectés.</Empty>;
  return (
    <div className="club-goal-times" role="table" aria-label="Buts par période">
      <div className="club-goal-legend" aria-hidden="true">
        <span>
          <i className="is-for" /> Marqués
        </span>
        <span>
          <i className="is-against" /> Encaissés
        </span>
      </div>
      {labels.map((label, i) => (
        <div className="club-goal-row" role="row" key={label}>
          <span role="rowheader">{label}</span>
          <span className="club-goal-bars" role="cell">
            <span
              className="is-for"
              style={{ width: `${(times.for[i] / max) * 100}%` }}
            />
            <span
              className="is-against"
              style={{ width: `${(times.against[i] / max) * 100}%` }}
            />
          </span>
          <span role="cell" className="club-goal-values">
            <b>{times.for[i]}</b> / {times.against[i]}
          </span>
        </div>
      ))}
      <p className="club-note">
        {times.observed} buts datés dans les tirs collectés, hors CSC.
      </p>
    </div>
  );
}

function Matches({ club, summary, details }) {
  const [venue, setVenue] = useState("all"),
    [period, setPeriod] = useState("results"),
    [expanded, setExpanded] = useState(false);
  const formations = useMemo(() => formationRecords(summary), [summary]);
  const list = useMemo(() => {
    const upcoming = period === "upcoming";
    return summary.games
      .filter(
        (m) =>
          (upcoming
            ? m.status === "not_started"
            : m.status !== "not_started") &&
          (venue === "all" ||
            (venue === "home" ? m.home.id === club.id : m.away.id === club.id)),
      )
      .sort((a, b) => {
        const order = String(a.timeUtc || a.date).localeCompare(
          String(b.timeUtc || b.date),
        );
        return upcoming ? order : -order;
      });
  }, [summary, venue, period, club.id]);
  return (
    <>
      <div className="research-two-columns club-section">
        <section>
          <div className="season-section-heading">
            <h3>Buts par période</h3>
          </div>
          {details && !details.value ? (
            <p data-page-loading={details?.loading ? "" : undefined} role="status" className="loading-state">
              {details.error || "Chargement des tirs de la saison…"}
            </p>
          ) : (
            <GoalTimes summary={summary} />
          )}
        </section>
        <section>
          <div className="season-section-heading">
            <h3>Systèmes utilisés</h3>
          </div>
          {formations.length ? (
            <div className="table-scroll">
              <table className="data-table club-metric-table">
                <caption className="sr-only">Résultats par système</caption>
                <thead>
                  <tr>
                    <th scope="col">Système</th>
                    <th scope="col">MJ</th>
                    <th scope="col">V-N-D</th>
                    <th scope="col">Buts</th>
                  </tr>
                </thead>
                <tbody>
                  {formations.map((item) => (
                    <tr key={item.formation}>
                      <th scope="row">{item.formation}</th>
                      <td>{number(item.matches)}</td>
                      <td>
                        {item.wins}-{item.draws}-{item.losses}
                      </td>
                      <td>
                        {item.goalsFor} – {item.goalsAgainst}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Système non renseigné.</Empty>
          )}
        </section>
      </div>
      <section className="club-section club-calendar">
        <div className="season-section-heading">
          <Segments
            label="Résultats ou matchs à venir"
            value={period}
            onChange={setPeriod}
            items={[
              ["results", "Résultats"],
              ["upcoming", "À venir"],
            ]}
          />
          <Segments
            label="Lieu des matchs"
            value={venue}
            onChange={setVenue}
            items={[
              ["all", "Tous"],
              ["home", "Domicile"],
              ["away", "Extérieur"],
            ]}
          />
        </div>
        {list.length ? (
          <div className="club-match-list">
            {(expanded ? list : list.slice(0, 8)).map((match) => (
              <MatchLink
                key={match.id}
                match={match}
                showKickoff={match.status === "not_started"}
              />
            ))}
            {list.length > 8 && (
              <button
                className="inline-link club-more"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Réduire" : `Voir les ${list.length} matchs`}
              </button>
            )}
          </div>
        ) : (
          <Empty>
            {period === "upcoming"
              ? "Aucun match à venir collecté pour ce périmètre."
              : "Aucun résultat pour ce périmètre."}
          </Empty>
        )}
      </section>
    </>
  );
}

function CohortNote({ cohort, competitionName }) {
  return (
    <div className="research-context">
      <span>
        Centiles parmi {number(cohort.size)} clubs · {competitionName} · 3
        matchs minimum · statistiques d’équipe fiables
      </span>
    </div>
  );
}

function StyleProfile({ summary, cohort, competitionName, onCompare }) {
  const f = useFootball();
  if (cohort.size < MIN_COHORT)
    return (
      <Empty>
        Trop peu de clubs comparables dans ce périmètre ({cohort.size}).
        Choisissez « Toutes les compétitions » pour élargir la cohorte.
      </Empty>
    );
  const values = Object.fromEntries(
    CLUB_STYLE_KEYS.map((key) => [
      key,
      orientedCentile(summary, key, cohort.distributions),
    ]),
  );
  const similar = similarClubs(summary, cohort.clubs, cohort.distributions, 6);
  return (
    <>
      <CohortNote cohort={cohort} competitionName={competitionName} />
      <div className="research-two-columns">
        <ResearchRadar
          title={`${summary.name} · profil de jeu en centiles`}
          axes={CLUB_STYLE_KEYS.map((key) => ({ key, label: axisLabel(key) }))}
          series={[
            { name: summary.name, values },
            {
              name: "Médiane de la cohorte",
              values: Object.fromEntries(
                CLUB_STYLE_KEYS.filter((key) => values[key] != null).map(
                  (key) => [key, 50],
                ),
              ),
            },
          ]}
          context={`${f.season}, ${competitionName}, ${cohort.size} clubs`}
        />
        <div className="table-scroll">
          <table className="data-table club-metric-table">
            <caption className="sr-only">Indicateurs collectifs</caption>
            <thead>
              <tr>
                <th scope="col">Indicateur</th>
                <th scope="col">Club</th>
                <th scope="col">Médiane</th>
                <th scope="col">Centile</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(CLUB_METRICS).map((key) => {
                const metric = clubMetric(summary, key),
                  centile = orientedCentile(summary, key, cohort.distributions);
                return (
                  <tr key={key}>
                    <th scope="row">{metricLabel(key)}</th>
                    <td>{number(metric.value, decimals(key))}</td>
                    <td>
                      {number(
                        cohortMedian(cohort.distributions, key),
                        decimals(key),
                      )}
                    </td>
                    <td>
                      {centile == null ? (
                        "—"
                      ) : (
                        <span className="club-share">
                          <span>
                            <i style={{ width: `${centile}%` }} />
                          </span>
                          {number(centile)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="club-note">
            ↓ : indicateur concédé, le centile est inversé (élevé = moins
            concédé).
            {summary.excludedStats > 0 &&
              ` ${summary.excludedStats} match(s) aux statistiques incohérentes exclus des moyennes.`}
          </p>
        </div>
      </div>
      <section className="club-section">
        <div className="season-section-heading">
          <h3>Clubs au profil proche</h3>
          <span>Proximité des centiles de style, pas un niveau</span>
        </div>
        {similar.length ? (
          <div className="research-similar-grid">
            {similar.map(({ club, similarity, parts }) => (
              <article className="research-similar club-similar" key={club.id}>
                <div className="research-similar-heading">
                  <Link
                    href={f.href("/clubs/", { id: club.id, clubView: "style" })}
                  >
                    <Media name={club.name} url={club.imageUrl} />
                    <span>
                      <strong>{club.name}</strong>
                      <small>
                        {club.wins}-{club.draws}-{club.losses} ·{" "}
                        {number(club.matches)} matchs
                      </small>
                    </span>
                  </Link>
                  <span className="research-index-score">
                    {number(similarity, 1)}
                    <small>proximité / 100</small>
                  </span>
                </div>
                <p className="club-note">
                  Plus proches :{" "}
                  {parts
                    .slice(0, 3)
                    .map((part) => axisLabel(part.key).replace(" ↓", ""))
                    .join(" · ")}
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => onCompare(club.id)}
                >
                  <Icon name="compare" /> Comparer
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty>
            Pas assez d’indicateurs communs pour rapprocher ce club d’autres
            clubs.
          </Empty>
        )}
      </section>
    </>
  );
}

function ClubPicker({ clubs, exclude, onPick, suggestions }) {
  const [query, setQuery] = useState(""),
    deferred = useDeferredValue(query);
  const results = useMemo(() => {
    const needle = normalizeText(deferred).trim();
    if (needle.length < 2) return [];
    return clubs
      .filter((c) => c.id !== exclude && normalizeText(c.name).includes(needle))
      .sort(
        (a, b) =>
          Number(!normalizeText(a.name).startsWith(needle)) -
            Number(!normalizeText(b.name).startsWith(needle)) ||
          b.matches - a.matches,
      )
      .slice(0, 8);
  }, [clubs, deferred, exclude]);
  const shown = query.trim().length >= 2 ? results : suggestions;
  return (
    <div className="club-picker">
      <label className="research-search">
        Club à comparer
        <input
          type="search"
          value={query}
          placeholder="Nom du club…"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {shown.length > 0 && (
        <div className="club-picker-options">
          {query.trim().length < 2 && <small>Suggestions</small>}
          {shown.map((club) => (
            <button
              type="button"
              key={club.id}
              className="filter-chip"
              onClick={() => {
                setQuery("");
                onPick(club.id);
              }}
            >
              <Media name={club.name} url={club.imageUrl} />
              {club.name}
            </button>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && !results.length && (
        <p className="club-note">Aucun club dans ce périmètre.</p>
      )}
    </div>
  );
}

function Comparison({ summary, cohort, competitionName, rivalId, onRival }) {
  const f = useFootball();
  const rival = cohort.clubs.find((c) => c.id === rivalId);
  const suggestions = useMemo(
    () =>
      cohort.size >= MIN_COHORT
        ? similarClubs(summary, cohort.clubs, cohort.distributions, 4).map(
            (s) => s.club,
          )
        : [],
    [summary, cohort],
  );
  const meetings = useMemo(
    () => (rival ? headToHead(f.data, summary.id, rival.id) : []),
    [f.data, summary.id, rival],
  );
  const sides = rival ? [summary, rival] : [];
  // Only outcome indicators get a "better" side; style volumes stay neutral.
  const resultRows = [
    ["Matchs", (c) => c.matches, 0, null],
    ["Points / match", (c) => clubMetric(c, "pointsPerMatch").value, 2, 1],
    ["Bilan V-N-D", (c) => `${c.wins}-${c.draws}-${c.losses}`, 0, null],
    ["Buts marqués / match", (c) => clubMetric(c, "goalsFor").value, 2, 1],
    [
      "Buts encaissés / match",
      (c) => clubMetric(c, "goalsAgainst").value,
      2,
      -1,
    ],
  ];
  return (
    <>
      <ClubPicker
        clubs={cohort.clubs}
        exclude={summary.id}
        onPick={onRival}
        suggestions={suggestions}
      />
      {!rival ? (
        <Empty>
          Choisissez un club du même périmètre ({competitionName}) pour comparer
          bilans, indicateurs et profils de jeu.
        </Empty>
      ) : (
        <>
          <div className="club-compare-heading">
            {sides.map((club, i) => (
              <div key={club.id} className={i ? "is-rival" : ""}>
                <Media name={club.name} url={club.imageUrl} />
                <strong>{club.name}</strong>
                <FormStrip club={club} />
              </div>
            ))}
            <button className="inline-link" onClick={() => onRival("")}>
              Retirer
            </button>
          </div>
          {cohort.size >= MIN_COHORT && (
            <CohortNote cohort={cohort} competitionName={competitionName} />
          )}
          <div className="research-two-columns">
            {cohort.size >= MIN_COHORT ? (
              <ResearchRadar
                title={`${summary.name} et ${rival.name} · centiles`}
                axes={CLUB_STYLE_KEYS.map((key) => ({
                  key,
                  label: axisLabel(key),
                }))}
                series={sides.map((club) => ({
                  name: club.name,
                  values: Object.fromEntries(
                    CLUB_STYLE_KEYS.map((key) => [
                      key,
                      orientedCentile(club, key, cohort.distributions),
                    ]),
                  ),
                }))}
                context={`${f.season}, ${competitionName}`}
              />
            ) : (
              <Empty>Cohorte trop réduite pour situer les deux clubs.</Empty>
            )}
            <div className="table-scroll">
              <table className="data-table club-compare-table">
                <caption className="sr-only">
                  Comparaison de {summary.name} et {rival.name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Indicateur</th>
                    <th scope="col">{summary.name}</th>
                    <th scope="col">{rival.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map(([label, get, digits, direction]) => {
                    const a = get(summary),
                      b = get(rival);
                    const best =
                      direction && isNumber(a) && isNumber(b) && a !== b
                        ? a > b === direction > 0
                          ? 0
                          : 1
                        : null;
                    return (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        <td className={best === 0 ? "is-best" : ""}>
                          {isNumber(a) ? number(a, digits) : a}
                        </td>
                        <td className={best === 1 ? "is-best" : ""}>
                          {isNumber(b) ? number(b, digits) : b}
                        </td>
                      </tr>
                    );
                  })}
                  {Object.keys(CLUB_METRICS)
                    .filter((key) => !CLUB_METRICS[key].result)
                    .map((key) => {
                      const a = clubMetric(summary, key).value,
                        b = clubMetric(rival, key).value;
                      const best =
                        OUTCOME_KEYS.has(key) &&
                        isNumber(a) &&
                        isNumber(b) &&
                        a !== b
                          ? a > b !== Boolean(CLUB_METRICS[key].lowerIsBetter)
                            ? 0
                            : 1
                          : null;
                      return (
                        <tr key={key}>
                          <th scope="row">{metricLabel(key)}</th>
                          <td className={best === 0 ? "is-best" : ""}>
                            {number(a, decimals(key))}
                          </td>
                          <td className={best === 1 ? "is-best" : ""}>
                            {number(b, decimals(key))}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          <section className="club-section">
            <div className="season-section-heading">
              <h3>Confrontations cette saison</h3>
            </div>
            {meetings.length ? (
              <div className="club-match-list">
                {meetings.map((match) => (
                  <MatchLink key={match.id} match={match} />
                ))}
              </div>
            ) : (
              <Empty>Aucune confrontation collectée cette saison.</Empty>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function ClubWorkspace(props) {
  const f = useFootball();
  const params = useSearchParams();
  const view = params.get("clubView") || "overview";
  const enabled =
    f.manifest?.capabilities?.actorSummary === true &&
    ["squad", "matches"].includes(view);
  const details = useActorRead(
    f.manifest,
    "club",
    actorReadParams(f.manifest, "club", {
      id: props.club.id,
      season: f.season,
      include: view === "squad" ? "appearances" : "shots",
    }),
    { enabled, refreshManifest: f.refreshManifest },
  );
  const context = useMemo(
    () =>
      enabled && details.value
        ? Object.assign(Object.create(f), { data: details.value })
        : f,
    [f, enabled, details.value],
  );
  return (
    <FootballContext.Provider value={context}>
      <ClubWorkspaceContent {...props} details={enabled ? details : null} />
    </FootballContext.Provider>
  );
}

function ClubWorkspaceContent({ club, history, details }) {
  const f = useFootball(),
    params = useSearchParams();
  const view = TABS.some(([key]) => key === params.get("clubView"))
    ? params.get("clubView")
    : "overview";
  const competitions = useMemo(
    () => clubCompetitions(f.data, club.id),
    [f.data, club.id],
  );
  const requested = params.get("clubScope") || "all";
  const competition = competitions.some((c) => c.id === requested)
    ? requested
    : "all";
  const competitionName =
    competition === "all"
      ? "toutes compétitions"
      : competitions.find((c) => c.id === competition)?.name;
  const summary = useMemo(
    () => clubSummary(f.data, club.id, { competition }),
    [f.data, club.id, competition],
  );
  const total = useMemo(
    () => (competition === "all" ? summary : clubSummary(f.data, club.id)),
    [f.data, club.id, competition, summary],
  );
  const scopedHistory = useMemo(
    () =>
      competition === "all"
        ? history
        : history.filter((m) => m.leagueId === competition),
    [history, competition],
  );
  const cohortState = useCohort(
    f.data,
    competition,
    view === "style" || view === "compare",
  );
  const cohort = cohortState.value;
  const rivalId = params.get("vs") || "";
  const change = (value) =>
    setParam("clubView", value === "overview" ? "" : value);
  const xgDiff = clubMetric(total, "xgDifference");
  return (
    <Card className="player-season-card research-player-profile club-workspace">
      <div className="season-player-heading">
        <div className="season-player-identity">
          <Media
            name={club.name}
            url={club.imageUrl}
            className="crest season-player-portrait club-portrait"
          />
          <div>
            <h2>{club.name}</h2>
            <p>
              {[club.countryLabel, competitions[0]?.name, f.season]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="research-toolbar">
          <BookmarkButton
            kind="clubs"
            id={club.id}
            name={club.name}
            imageUrl={club.imageUrl}
            season={f.season}
          />
          <ReportButton
            title={`${club.name} · ${f.season}`}
            context={`${competitionName} · ${summary.matches} matchs terminés · bilan ${summary.wins}-${summary.draws}-${summary.losses}`}
            data={{
              club: { id: club.id, name: club.name },
              season: f.season,
              scope: competitionName,
              record: {
                matches: summary.matches,
                wins: summary.wins,
                draws: summary.draws,
                losses: summary.losses,
                goalsFor: summary.goalsFor,
                goalsAgainst: summary.goalsAgainst,
                home: summary.home,
                away: summary.away,
              },
              metrics: Object.fromEntries(
                Object.keys(CLUB_METRICS).map((key) => [
                  key,
                  clubMetric(summary, key),
                ]),
              ),
              formations: summary.formations,
              goalTimes: summary.goalTimes,
            }}
          >
            <RecordTable club={summary} />
          </ReportButton>
        </div>
      </div>
      <div className="research-stat-strip">
        <div>
          <span>Matchs joués</span>
          <strong>{number(total.matches)}</strong>
        </div>
        <div>
          <span>Bilan V-N-D</span>
          <strong>
            {total.wins}-{total.draws}-{total.losses}
          </strong>
        </div>
        <div>
          <span>Buts</span>
          <strong>
            {number(total.goalsFor)} – {number(total.goalsAgainst)}
          </strong>
        </div>
        <div>
          <span>Diff. xG / match</span>
          <strong>{signed(xgDiff.value, 2)}</strong>
        </div>
      </div>
      <div className="club-tabs-row">
        <ResearchTabs
          label="Analyse du club"
          value={view}
          items={TABS}
          onChange={change}
          panelId="club-profile-panel"
        />
        {competitions.length > 1 && (
          <label className="club-scope">
            <span>Périmètre</span>
            <span className="filter-input-wrap">
              <Icon name="trophy" />
              <select
                aria-label="Compétition analysée"
                value={competition}
                onChange={(e) =>
                  setParam(
                    "clubScope",
                    e.target.value === "all" ? "" : e.target.value,
                  )
                }
              >
                <option value="all">
                  Toutes les compétitions ({total.matches})
                </option>
                <CompetitionOptions
                  competitions={competitions.map((c) => ({
                    ...f.allCatalog.find((item) => item.id === c.id),
                    ...c,
                  }))}
                  label={(c) => `${c.name} (${c.finished})`}
                />
              </select>
              <Icon name="chevron" className="select-chevron" />
            </span>
          </label>
        )}
      </div>
      <div
        id="club-profile-panel"
        role="tabpanel"
        aria-label={TABS.find(([key]) => key === view)[1]}
      >
        {details?.error && (
          <p role="alert">
            {details.error} <button onClick={details.retry}>Réessayer</button>
          </p>
        )}
        {["style", "compare"].includes(view) && cohortState.loading && (
          <p data-page-loading="" role="status" className="loading-state">
            Chargement de la cohorte des clubs…
          </p>
        )}
        {["style", "compare"].includes(view) && cohortState.error && (
          <p role="alert">
            {cohortState.error}{" "}
            <button onClick={cohortState.retry}>Réessayer</button>
          </p>
        )}
        {view === "overview" && (
          <Overview
            club={club}
            summary={summary}
            history={scopedHistory}
            allHistory={history}
            competitionName={competitionName}
          />
        )}
        {view === "squad" &&
          (details && !details.value ? (
            <p data-page-loading={details?.loading ? "" : undefined} role="status" className="loading-state">
              Chargement de l’effectif de la saison…
            </p>
          ) : (
            <Squad club={club} summary={summary} />
          ))}
        {view === "matches" && (
          <Matches club={club} summary={summary} details={details} />
        )}
        {view === "style" && cohort && (
          <StyleProfile
            summary={summary}
            cohort={cohort}
            competitionName={competitionName}
            onCompare={(id) => {
              setParam("vs", id);
              change("compare");
            }}
          />
        )}
        {view === "compare" && cohort && (
          <Comparison
            summary={summary}
            cohort={cohort}
            competitionName={competitionName}
            rivalId={rivalId}
            onRival={(id) => setParam("vs", id)}
          />
        )}
      </div>
    </Card>
  );
}
