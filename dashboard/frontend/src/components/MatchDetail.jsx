import React, { lazy, Suspense, useMemo, useRef, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Media, Rating, Segments, Empty, AsyncState } from "./UI.jsx";
import Icon from "./Icon.jsx";
import { XgTimeline, ShotMap } from "./Charts.jsx";
import { MatchSections } from "./MatchSections.jsx";
import MatchStandings from "./MatchStandings.jsx";
import MatchEventHighlights from "./MatchEventHighlights.jsx";
import { StatRow, StatRows } from "./StatRows.jsx";
const MatchContext = lazy(() => import("./MatchContext.jsx"));
import { periodShort } from "./PlayerMetrics.jsx";
import { number, date, isNumber } from "../services/format.js";
import {
  groupedStats,
  periodStats,
  overviewStats,
  statValue,
} from "../services/match-data.js";
import { download, useResource } from "../services/resources.js";
import { csvString, seasonLabel } from "../model.js";
import { BookmarkButton } from "./ResearchUI.jsx";
const views = [
  ["overview", "Vue d’ensemble", "activity"],
  ["context", "Avant-match", "calendar"],
  ["standings", "Classement", "trophy"],
  ["stats", "Statistiques", "filters"],
  ["shots", "Tirs & xG", "target"],
  ["lineups", "Compositions", "pitch"],
  ["players", "Joueurs", "players"],
  ["data", "Données complètes", "json"],
];
function MatchStatistics({ match }) {
  const f = useFootball(),
    [period, setPeriod] = useState("All"),
    resource = useResource(
      `team-periods:${match.id}:${f.client.id}`,
      async () => {
        await f.client.ensureEndpoint(
          match,
          "stats",
          Boolean(f.client.payloads.get(`${match.id}:stats`)?.error),
        );
        const entry = f.client.payloads.get(`${match.id}:stats`);
        if (entry.error) throw new Error(entry.error);
        return entry.data;
      },
      f.statusKnown,
    );
  const display = (payload) => {
    const periods = (payload?.periods || []).filter((p) => p.groups?.length),
      selected = periods.find((p) => p.period === period) || periods[0],
      groups = groupedStats(selected ? periodStats(selected) : match),
      possession = groups.find((g) => g.title === "Possession")?.rows[0],
      sections = groups.filter((g) => g.title !== "Possession");
    if (!sections.length && !possession)
      return (
        <Card title="Statistiques équipes">
          <Empty>Statistiques d’équipe indisponibles.</Empty>
        </Card>
      );
    return (
      <section className="stats-board" aria-label="Statistiques des équipes">
        <header className="stats-board-head">
          {[match.home, match.away].map((team, i) => (
            <span key={team.id} className={`stats-team ${i ? "away" : "home"}`}>
              <Media name={team.name} url={team.imageUrl} />
              <strong>{team.name}</strong>
            </span>
          ))}
          {periods.length > 1 && (
            <Segments
              label="Période des statistiques"
              value={selected.period}
              onChange={setPeriod}
              items={periods.map((p) => [p.period, periodShort(p.period)])}
            />
          )}
        </header>
        {possession && (
          <dl className="stat-rows stats-possession">
            <StatRow match={match} stat={possession} />
          </dl>
        )}
        <div className="stats-sections">
          {sections.map((group) => (
            <section className="stats-section" key={group.title}>
              <h3>{group.title}</h3>
              <dl className="stat-rows">
                {group.rows.map((s, i) => (
                  <StatRow key={`${s.key}:${i}`} match={match} stat={s} />
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    );
  };
  if (resource.error && match.stats?.length)
    return (
      <>
        <p className="notice" role="status">
          Périodes détaillées indisponibles.{" "}
          <button className="inline-link" onClick={resource.retry}>
            Réessayer
          </button>
        </p>
        {display(null)}
      </>
    );
  return <AsyncState resource={resource}>{display}</AsyncState>;
}
function MatchViewTabs({ view, onChange, panelId }) {
  const refs = useRef([]);
  return (
    <div
      className="match-view-tabs"
      role="tablist"
      aria-label="Analyse du match"
    >
      {views.map(([key, label, icon], i) => (
        <button
          role="tab"
          id={`${panelId}-${key}`}
          aria-controls={panelId}
          aria-selected={view === key}
          tabIndex={view === key ? 0 : -1}
          ref={(node) => {
            refs.current[i] = node;
          }}
          key={key}
          onClick={() => onChange(key)}
          onKeyDown={(e) => {
            let next;
            if (e.key === "ArrowRight") next = (i + 1) % views.length;
            if (e.key === "ArrowLeft")
              next = (i + views.length - 1) % views.length;
            if (e.key === "Home") next = 0;
            if (e.key === "End") next = views.length - 1;
            if (next !== undefined) {
              e.preventDefault();
              onChange(views[next][0]);
              refs.current[next]?.focus();
            }
          }}
        >
          <Icon name={icon} />
          {label}
        </button>
      ))}
    </div>
  );
}
function MatchPlayer({ row, rank }) {
  const f = useFootball();
  return (
    <button className="match-player-row" onClick={() => f.setPlayer(row.id)}>
      {rank && (
        <span className="leader-rank">{String(rank).padStart(2, "0")}</span>
      )}
      <Media name={row.name} url={row.imageUrl} className="player-avatar" />
      <span className="player-copy">
        <strong className="player-name">{row.name}</strong>
        <span className="player-meta">
          {row.team}
          {isNumber(row.goals) && row.goals > 0
            ? ` · ${number(row.goals)} but${row.goals > 1 ? "s" : ""}`
            : ""}
          {isNumber(row.assists) && row.assists > 0
            ? ` · ${number(row.assists)} PD`
            : ""}
        </span>
      </span>
      <span className="match-player-minutes">{number(row.minutes)}′</span>
      <Rating value={row.rating} />
    </button>
  );
}
function MatchPlayers({ match, players }) {
  const [scope, setScope] = useState("played");
  const rows = players.filter((r) => scope === "all" || r.minutes > 0);
  const exportCsv = () => {
    const fields = [
      "name",
      "team",
      "minutes",
      "rating",
      "goals",
      "assists",
      "xg",
      "xa",
    ];
    download(
      `statarena-${match.id}-joueurs.csv`,
      csvString(
        fields,
        rows.map((r) => fields.map((k) => r[k])),
      ),
      "text/csv;charset=utf-8",
    );
  };
  return (
    <>
      <div className="match-section-toolbar">
        <Segments
          label="Participation des joueurs"
          value={scope}
          onChange={setScope}
          items={[
            ["played", "Entrés en jeu"],
            ["all", "Tous les joueurs"],
          ]}
        />
        <button className="button button-secondary" onClick={exportCsv}>
          <Icon name="download" />
          Exporter CSV
        </button>
      </div>
      <div className="match-team-players">
        {[match.home, match.away].map((team) => (
          <Card
            key={team.id}
            title={team.name}
            action={<Media name={team.name} url={team.imageUrl} />}
          >
            {rows
              .filter((r) => r.teamId === team.id)
              .map((r) => (
                <MatchPlayer row={r} key={r.id} />
              ))}
            {!rows.some((r) => r.teamId === team.id) && (
              <Empty>Aucune performance collectée.</Empty>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
function MatchShots({ match }) {
  const f = useFootball(),
    [chart, setChart] = useState("map"),
    [team, setTeam] = useState("all");
  const shots = (match.shots || [])
    .filter((s) => team === "all" || s.teamId === team)
    .sort((a, b) => (a.minute ?? Infinity) - (b.minute ?? Infinity));
  return (
    <div className="match-shot-analysis">
      <Card
        title="Analyse des tirs"
        action={
          <Segments
            label="Graphique du match"
            value={chart}
            onChange={setChart}
            items={[
              ["map", "Carte des tirs"],
              ["timeline", "xG cumulés"],
            ]}
          />
        }
      >
        <div className="shot-team-selector">
          <Segments
            label="Équipe des tirs"
            value={team}
            onChange={setTeam}
            items={[
              ["all", "Les deux équipes"],
              [match.home.id, match.home.name],
              [match.away.id, match.away.name],
            ]}
          />
        </div>
        {chart === "map" ? (
          <ShotMap match={match} teamId={team} onPlayer={f.setPlayer} />
        ) : (
          <XgTimeline match={match} teamId={team} onPlayer={f.setPlayer} />
        )}
      </Card>
      <Card
        title="Tirs collectés"
        action={<span className="data-source-tag">{number(shots.length)}</span>}
      >
        {shots.length ? (
          <ol className="match-shot-list">
            {shots.map((s, i) => (
              <li key={s.id || i}>
                <span className="shot-minute">{number(s.minute)}′</span>
                <button
                  onClick={() =>
                    s.playerId && f.setPlayer(`${match.id}:${s.playerId}`)
                  }
                  disabled={!s.playerId}
                >
                  <strong>{s.playerName || "Joueur non renseigné"}</strong>
                  <span>
                    {s.isOwnGoal
                      ? "CSC"
                      : s.isGoal
                        ? "But"
                        : s.isOnTarget === true
                          ? "Tir cadré"
                          : "Tir"}
                  </span>
                </button>
                <span className="shot-xg">
                  {number(s.xg, 2)}
                  <small>xG</small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Aucun tir collecté.</Empty>
        )}
      </Card>
    </div>
  );
}
export default function MatchDetail({ match }) {
  const f = useFootball(),
    search = useSearchParams(),
    panelId = useId();
  // Before kick-off there is nothing to analyse yet: open on the context.
  const defaultView = match.status === "not_started" ? "context" : "overview";
  const view = views.some(([key]) => key === search.get("view"))
    ? search.get("view")
    : defaultView;
  const selectView = (value) => {
    const url = new URL(window.location.href);
    if (value === defaultView) url.searchParams.delete("view");
    else url.searchParams.set("view", value);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const players = useMemo(
    () =>
      f.data.appearances
        .filter((r) => r.matchId === match.id)
        .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1)),
    [f.data, match.id],
  );
  const leading = players
    .filter((r) => r.minutes > 0 && isNumber(r.rating))
    .slice(0, 5);
  const competition = f.data.competitions.find((c) => c.id === match.leagueId);
  const status =
    match.status === "finished"
      ? "Terminé"
      : match.status === "not_started"
        ? "À venir"
        : "Score collecté";
  const time =
    match.timeUtc && !Number.isNaN(Date.parse(match.timeUtc))
      ? new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        }).format(new Date(match.timeUtc))
      : null;
  const fromUpcoming =
    ["upcoming", "calendar"].includes(search.get("from")) ||
    match.status === "not_started";
  return (
    <div className="match-detail">
      <div className="match-breadcrumb-row">
        <nav className="match-breadcrumb" aria-label="Fil d’Ariane du match">
          <Link
            href={
              fromUpcoming
                ? f.href("/matchs/", {
                    tab: "upcoming",
                    ...(search.get("week") ? { week: search.get("week") } : {}),
                  })
                : f.href("/matchs/", {
                    tab: "results",
                    ...(search.get("week") ? { week: search.get("week") } : {}),
                  })
            }
          >
            <Icon name="back" />
            {fromUpcoming ? "Matchs à venir" : "Résultats"}
          </Link>
          <Icon name="right" />
          <span>{match.league || competition?.name || "Compétition"}</span>
          <Icon name="right" />
          <span>{match.season || f.season}</span>
        </nav>
        <div className="match-breadcrumb-actions">
          <BookmarkButton
            kind="matches"
            id={match.id}
            name={`${match.home.name} – ${match.away.name}`}
            season={seasonLabel(match.season || f.season)}
          />
          <button
            className="button button-secondary"
            onClick={() =>
              download(
                `statarena-${match.id}.json`,
                JSON.stringify(match, null, 2),
              )
            }
          >
            <Icon name="download" />
            Exporter le match
          </button>
        </div>
      </div>
      <section className="match-scoreboard" aria-label="Résumé du match">
        <div className="scoreboard-meta">
          <div>
            {competition && (
              <Media name={competition.name} url={competition.imageUrl} />
            )}
            <span>{match.league || competition?.name}</span>
          </div>
          <span>
            {date(match.timeUtc || match.date)}
            {time && <> · {time}</>}
          </span>
        </div>
        <h1 className="sr-only">
          {match.home.name} — {match.away.name}
        </h1>
        <div className="scoreboard-main">
          <Link
            className="scoreboard-team"
            href={f.href("/clubs/", { id: match.home.id })}
          >
            <Media name={match.home.name} url={match.home.imageUrl} />
            <div>
              <strong>{match.home.name}</strong>
              <span>
                Domicile
                {match.home.formation ? ` · ${match.home.formation}` : ""}
              </span>
            </div>
          </Link>
          <div className="scoreboard-center">
            <span
              className={`match-status${match.status === "finished" ? " is-finished" : ""}`}
            >
              <span />
              {status}
            </span>
            <div className="scoreboard-score">
              {match.status === "not_started" ? (
                <span className="scoreboard-upcoming">{time || "—"}</span>
              ) : (
                <>
                  <strong>{number(match.home.score)}</strong>
                  <span>–</span>
                  <strong>{number(match.away.score)}</strong>
                </>
              )}
            </div>
          </div>
          <Link
            className="scoreboard-team scoreboard-away"
            href={f.href("/clubs/", { id: match.away.id })}
          >
            <Media name={match.away.name} url={match.away.imageUrl} />
            <div>
              <strong>{match.away.name}</strong>
              <span>
                Extérieur
                {match.away.formation ? ` · ${match.away.formation}` : ""}
              </span>
            </div>
          </Link>
        </div>
        <div className="match-kpis">
          {overviewStats(match)
            .slice(0, 4)
            .map((s) => (
              <div key={s.key}>
                <span>{s.label}</span>
                <strong>
                  <b className="home-number">{statValue(s, "home")}</b>
                  <i>–</i>
                  <b className="away-number">{statValue(s, "away")}</b>
                </strong>
              </div>
            ))}
        </div>
      </section>
      {match.coverage?.teamStatsReliable === false && (
        <p role="status" className="notice notice-warning">
          Statistiques d’équipe signalées comme incohérentes.
        </p>
      )}
      <MatchViewTabs view={view} onChange={selectView} panelId={panelId} />
      <div
        id={panelId}
        className="match-view-panel"
        tabIndex={0}
        role="tabpanel"
        aria-labelledby={`${panelId}-${view}`}
      >
        {view === "overview" && (
          <div className="match-overview-grid">
            <Card
              title="Occasions au fil du match"
              className="match-overview-chart"
              action={
                <button
                  className="inline-link"
                  onClick={() => selectView("shots")}
                >
                  Analyse des tirs
                  <Icon name="arrow" />
                </button>
              }
            >
              <XgTimeline match={match} onPlayer={f.setPlayer} />
            </Card>
            <Card title="Les chiffres du match">
              <StatRows match={match} stats={overviewStats(match)} />
            </Card>
            <MatchEventHighlights match={match} />
            <Card
              title="Meilleures notes"
              className="match-leaders-card"
              footer={
                <button
                  className="inline-link"
                  onClick={() => selectView("players")}
                >
                  Tous les joueurs
                  <Icon name="arrow" />
                </button>
              }
            >
              {leading.map((r, i) => (
                <MatchPlayer key={r.id} row={r} rank={i + 1} />
              ))}
              {!leading.length && <Empty>Aucune note collectée.</Empty>}
            </Card>
          </div>
        )}
        {view === "context" && (
          <Suspense
            fallback={
              <div className="loading-state" role="status">
                Chargement du contexte…
              </div>
            }
          >
            <MatchContext match={match} />
          </Suspense>
        )}
        {view === "stats" && <MatchStatistics match={match} />}
        {view === "standings" && <MatchStandings match={match} />}
        {view === "shots" && <MatchShots match={match} />}
        {view === "lineups" && (
          <MatchSections
            key={`${match.id}:lineups`}
            match={match}
            showNavigation={false}
            initialSection="lineups"
          />
        )}
        {view === "players" && <MatchPlayers match={match} players={players} />}
        {view === "data" && (
          <MatchSections
            key={`${match.id}:data`}
            match={match}
            initialSection="events"
          />
        )}
      </div>
    </div>
  );
}
