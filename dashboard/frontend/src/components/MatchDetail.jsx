import React, { useMemo, useRef, useId, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Media, Rating, Segments, Empty } from "./UI.jsx";
import Icon from "./Icon.jsx";
import { XgTimeline, ShotMap } from "./Charts.jsx";
import { MatchSections } from "./MatchSections.jsx";
import { number, date, isNumber } from "../services/format.js";
import {
  groupedStats,
  overviewStats,
  statValue,
  statPercentage,
} from "../services/match-data.js";
import { download } from "../services/resources.js";
import { csvString } from "../model.js";
const views = [
  ["overview", "Vue d’ensemble", "activity"],
  ["stats", "Statistiques", "filters"],
  ["shots", "Tirs & xG", "target"],
  ["lineups", "Compositions", "pitch"],
  ["players", "Joueurs", "players"],
  ["data", "Données complètes", "json"],
];
function StatRows({ match, stats }) {
  return (
    <div className="comparison-stats">
      <div className="comparison-teams">
        <span>
          <i className="team-dot home" />
          {match.home.name}
        </span>
        <span>
          <i className="team-dot away" />
          {match.away.name}
        </span>
      </div>
      <dl>
        {stats.map((s, i) => {
          const home = s.home ?? s.homeValue,
            away = s.away ?? s.awayValue;
          const valid =
            s.reliable !== false &&
            isNumber(home) &&
            isNumber(away) &&
            home >= 0 &&
            away >= 0 &&
            home + away > 0;
          return (
            <div className="comparison-stat" key={`${s.key}:${i}`}>
              <dt>
                {s.label}
                {s.reliable === false && (
                  <span title="Valeur signalée comme non fiable par la source">
                    <Icon name="info" />
                  </span>
                )}
              </dt>
              <dd
                className="home-stat"
                aria-label={`${match.home.name} : ${statValue(s, "home")}${statPercentage(s, "home") ? ` (${statPercentage(s, "home")})` : ""}`}
              >
                {statValue(s, "home")}
                {statPercentage(s, "home") && (
                  <small>{statPercentage(s, "home")}</small>
                )}
              </dd>
              <dd
                className="away-stat"
                aria-label={`${match.away.name} : ${statValue(s, "away")}${statPercentage(s, "away") ? ` (${statPercentage(s, "away")})` : ""}`}
              >
                {statValue(s, "away")}
                {statPercentage(s, "away") && (
                  <small>{statPercentage(s, "away")}</small>
                )}
              </dd>
              <dd
                className={`comparison-track${valid ? "" : " comparison-unavailable"}`}
                aria-hidden="true"
              >
                <span
                  style={{
                    width: valid ? `${(home / (home + away)) * 100}%` : "0%",
                  }}
                />
                <span
                  style={{
                    width: valid ? `${(away / (home + away)) * 100}%` : "0%",
                  }}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
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
function MatchGoals({ match }) {
  const f = useFootball();
  const goals = (match.shots || [])
    .filter((s) => s.isGoal || s.isOwnGoal)
    .sort((a, b) => (a.minute ?? Infinity) - (b.minute ?? Infinity));
  return (
    <Card
      title="Buts"
      className="match-goals-card"
      action={<span className="data-source-tag">Tirs collectés</span>}
    >
      {goals.length ? (
        <ol className="match-goals">
          {goals.map((s, i) => (
            <li key={s.id || i}>
              <span className="goal-minute">{number(s.minute)}′</span>
              <span className="goal-ball">
                <Icon name="ball" />
              </span>
              <button
                onClick={() =>
                  s.playerId && f.setPlayer(`${match.id}:${s.playerId}`)
                }
                disabled={!s.playerId}
              >
                <strong>
                  {s.playerName || "Joueur non renseigné"}
                  {s.isOwnGoal ? " · CSC" : ""}
                </strong>
                <span>
                  {[match.home, match.away].find((t) => t.id === s.teamId)
                    ?.name || "Équipe non renseignée"}
                </span>
              </button>
              <Icon name="goal" />
            </li>
          ))}
        </ol>
      ) : (
        <Empty>Aucun but renseigné dans les tirs collectés.</Empty>
      )}
    </Card>
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
      `orion-${match.id}-joueurs.csv`,
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
  const view = views.some(([key]) => key === search.get("view"))
    ? search.get("view")
    : "overview";
  const selectView = (value) => {
    const url = new URL(window.location.href);
    if (value === "overview") url.searchParams.delete("view");
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
  return (
    <div className="match-detail">
      <div className="match-breadcrumb-row">
        <nav className="match-breadcrumb" aria-label="Fil d’Ariane du match">
          <Link
            href={
              search.get("from") === "calendar"
                ? f.href("/calendrier/", { week: search.get("week") || "" })
                : f.href("/matchs/")
            }
          >
            <Icon name="back" />
            {search.get("from") === "calendar" ? "Calendrier" : "Matchs"}
          </Link>
          <Icon name="right" />
          <span>{match.league || competition?.name || "Compétition"}</span>
          <Icon name="right" />
          <span>{f.season}</span>
        </nav>
        <button
          className="button button-secondary"
          onClick={() =>
            download(`orion-${match.id}.json`, JSON.stringify(match, null, 2))
          }
        >
          <Icon name="download" />
          Exporter le match
        </button>
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
          Statistiques d’équipe signalées comme incohérentes dans la source.
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
            <MatchGoals match={match} />
            <Card
              title="Meilleures notes"
              className="match-leaders-card"
              action={<span className="data-source-tag">PitchAPI</span>}
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
        {view === "stats" &&
          (match.stats?.length ? (
            <div className="match-stat-groups">
              {groupedStats(match).map((group) => (
                <Card
                  key={group.title}
                  title={group.title}
                  action={
                    <span className="data-source-tag">{group.rows.length}</span>
                  }
                >
                  <StatRows match={match} stats={group.rows} />
                </Card>
              ))}
            </div>
          ) : (
            <Card title="Statistiques équipes">
              <Empty>Statistiques d’équipe indisponibles.</Empty>
            </Card>
          ))}
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
