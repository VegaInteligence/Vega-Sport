import { nationalFlagCode } from "../services/national-flags.js";
import BackLink from "./BackLink.jsx";
import MatchNav from "./MatchNav.jsx";
import { editionArtworkUrl } from "../services/competition-artwork.js";
import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import useLiveMatch from "../hooks/useLiveMatch.js";
import { isLiveWindow } from "../services/live-client.js";
import {
  Card,
  Media,
  Grade,
  Segments,
  Empty,
  AsyncState,
  Skeleton,
} from "./UI.jsx";
import Icon from "./Icon.jsx";
import { normalizeShots } from "./MatchSections.jsx";
import MatchTable from "./MatchTable.jsx";
import MatchShotMap from "./MatchShotMap.jsx";
import { StatRow } from "./StatRows.jsx";
const MatchContext = lazy(() => import("./MatchContext.jsx"));
// Before the kick-off (FAILURE_MODES § 81): the scoreboard's strip and the « Avant-match » tab.
const MatchPreview = lazy(() => import("./MatchPreview.jsx"));
const PreviewStrip = lazy(() => import("./MatchPreview.jsx").then((m) => ({ default: m.PreviewStrip })));
import MatchFlow from "./MatchFlow.jsx";
import { MatchAbsences } from "./Absences.jsx";
import { useMatchWinProbability } from "../services/forecasts.js";
import { countdown, place, tableRow, useCompetitionTable } from "../services/match-preview.js";
import MatchKpis from "./MatchKpis.jsx";
import MatchLineups from "./MatchLineups.jsx";
import MatchPlayersBoard, { MatchLeaders } from "./MatchPlayersBoard.jsx";
import MatchAnalyses from "./MatchAnalyses.jsx";
import MatchLive from "./MatchLive.jsx";
import { liveRunning, liveShootout, liveStatus } from "../services/match-live.js";
import { LINEUPS_WATCH, lineupsBeforeKickoff, teamStatsFlagged } from "../services/match-tabs.js";
import { periodShort } from "./PlayerMetrics.jsx";
import { number, date, isNumber } from "../services/format.js";
import {
  groupedStats,
  periodStats,
} from "../services/match-data.js";
import { useResource } from "../services/resources.js";
import {
  gradeTitle,
  leadingPlayers,
  playerOf,
  useMatchGrades,
} from "../services/match-grades.js";
import {
  matchReadSource,
  matchResourceKey,
} from "../services/match-resources.js";
import { seasonLabel } from "../model.js";
import { parisDay, validDay } from "../services/fixtures.js";
import { pagedMatchList } from "../services/season-version.js";
import { BookmarkButton } from "./ResearchUI.jsx";
import useCrestColours from "../hooks/useCrestColours.js";
// The match in five tabs (issue #221, FAILURE_MODES § 62): « Vue d’ensemble », « Tirs & xG » and
// the momentum of « Analyses » make the Résumé, « Joueurs » joins « Compositions », « Classement »
// joins « Avant-match ».
const views = [
  ["overview", "Résumé", "activity"],
  ["lineups", "Compositions", "pitch"],
  ["stats", "Statistiques", "filters"],
  ["analyses", "Analyses", "target"],
  // The competition's table and its projection, a tab of their own again (FAILURE_MODES § 63).
  ["standings", "Classement", "trophy"],
  ["context", "Avant-match", "calendar"],
];
/** The former tabs' addresses open the tab that holds them now. */
const FORMER_VIEWS = { shots: "overview", players: "lineups" };
function MatchStatistics({ match }) {
  const f = useFootball(),
    [period, setPeriod] = useState("All"),
    resource = useResource(
      matchResourceKey(
        f.manifest || f.client,
        "statistics",
        match,
        matchReadSource(f.manifest, f.configured),
      ),
      async ({ signal }) => {
        const entry =
          (await f.client.ensureEndpoint(
            match,
            "stats",
            Boolean(f.client.payloads.get(`${match.id}:stats`)?.error),
            { signal },
          )) || f.client.payloads.get(`${match.id}:stats`);
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
// While the feed runs the match, its view comes first and opens the page.
const liveView = ["live", "Direct", "activity"];
// Before kick-off, only what exists before a match: its context first, then the (probable) line-ups and the table.
const upcomingViews = ["context", "lineups", "standings"].map((key) => views.find(([k]) => k === key));
// While it runs, the Direct view comes first; the Résumé keeps its charts, its shots and its grades.
const runningViews = [liveView, ...views];
function MatchViewTabs({ view, onChange, panelId, views }) {
  const refs = useRef([]);
  useEffect(() => {
    const active = refs.current[views.findIndex(([key]) => key === view)];
    const strip = active?.parentElement;
    if (!strip) return;
    const reveal = () => {
      const bounds = strip.getBoundingClientRect();
      const button = active.getBoundingClientRect();
      const left = bounds.left + strip.clientLeft;
      const right = left + strip.clientWidth;
      if (button.left < left) strip.scrollLeft -= left - button.left + 8;
      else if (button.right > right)
        strip.scrollLeft += button.right - right + 8;
    };
    reveal();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    observer?.observe(strip);
    window.addEventListener("resize", reveal);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reveal);
    };
  }, [view, views]);
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
function MatchPlayer({ row, rank, grade }) {
  const f = useFootball();
  // A best grade opens his performance of the match; its dialog leads to his page.
  const props = {
    type: "button",
    onClick: () => f.setPlayer(row.id),
    "aria-busy":
      (f.player === row.id && f.deferredPerformance?.loading) || undefined,
  };
  return (
    <button className="match-player-row" {...props}>
      {rank && (
        <span className="leader-rank">{String(rank).padStart(2, "0")}</span>
      )}
      <Media name={row.name} url={row.imageUrl} className="player-avatar" />
      <span className="player-copy">
        <strong className="player-name">{row.name}</strong>
        <span className="player-meta">
          {f.player === row.id && f.deferredPerformance?.loading ? (
            <Skeleton kind="inline" label="Chargement de la performance…" />
          ) : (
            row.team
          )}
          {isNumber(row.goals) && row.goals > 0
            ? ` · ${number(row.goals)} but${row.goals > 1 ? "s" : ""}`
            : ""}
          {isNumber(row.assists) && row.assists > 0
            ? ` · ${number(row.assists)} PD`
            : ""}
        </span>
      </span>
      <span className="match-player-minutes">{number(row.minutes)}′</span>
      {(grade?.grade ?? row.grade) != null && (
        <Grade
          value={grade?.grade ?? row.grade}
          title={grade ? gradeTitle(grade) : undefined}
        />
      )}
    </button>
  );
}
/** A summary's match reads its shots, with their coordinates, from the shots family. */
function SummaryShots({ match }) {
  const f = useFootball();
  const resource = useResource(
    matchResourceKey(
      f.manifest || f.client,
      "shots-view",
      match,
      matchReadSource(f.manifest, f.configured),
    ),
    async ({ signal }) => {
      const value =
        (await f.client.ensureEndpoint(
          match,
          "shots",
          Boolean(f.client.payloads.get(`${match.id}:shots`)?.error),
          { signal },
        )) || f.client.payloads.get(`${match.id}:shots`);
      if (value?.error) throw new Error(value.error);
      return { ...match, shots: normalizeShots(value.data) };
    },
    f.statusKnown,
  );
  return (
    <AsyncState resource={resource}>
      {(value) => <MatchShotMap match={value} />}
    </AsyncState>
  );
}
// Live: the feed's goals and cards and its team statistics, while PitchAPI has not
// sent them yet (doc "Fin de match": the timeline moves to core once its events are in).
const LIVE_EVENTS = {
  goal: "But",
  own_goal: "But contre son camp",
  penalty_goal: "But sur penalty",
  missed_penalty: "Penalty manqué",
  yellow_card: "Carton jaune",
  red_card: "Carton rouge",
};
const LIVE_STATS = [
  ["possessionPct", "Possession", (v) => `${number(v)} %`],
  ["totalShots", "Tirs", number],
  ["shotsOnTarget", "Tirs cadrés", number],
  ["corners", "Corners", number],
];
export function liveTimeline(live) {
  if (!live || live.families?.events === "core") return [];
  return (live.events || []).filter((e) => LIVE_EVENTS[e.type]);
}
export function liveTeamStats(live, match) {
  if (!live || live.families?.stats === "core") return null;
  const home = (live.stats || []).find((s) => s.teamId === match.home.id);
  const away = (live.stats || []).find((s) => s.teamId === match.away.id);
  if (!home || !away) return null;
  const rows = LIVE_STATS.filter(
    ([key]) => home[key] != null && away[key] != null,
  );
  return rows.length
    ? rows.map(([key, label, format]) => ({
        key,
        label,
        home: format(home[key]),
        away: format(away[key]),
      }))
    : null;
}
function LiveTimeline({ events, match }) {
  // The scoreboard keeps the goals that stand and the dismissals; the Direct view has the rest.
  const shown = events.filter((e) => !e.cancelled && e.type !== "yellow_card" && e.period !== "penalties");
  if (!shown.length) return null;
  return (
    <ol className="scoreboard-live-events" aria-label="Buts et expulsions">
      {shown.map((e) => (
        <li
          key={e.seq}
          className={e.teamId === match.away.id ? "is-away" : "is-home"}
        >
          {e.type === "red_card" ? <i className="live-red" aria-hidden="true" /> : null}
          <strong>{e.playerName || LIVE_EVENTS[e.type]}</strong>
          <span>
            {e.minute != null
              ? `${e.minute}${e.minuteAdded ? `+${e.minuteAdded}` : ""}’`
              : ""}
            {e.type === "penalty_goal" ? " (pen.)" : e.type === "own_goal" ? " (csc)" : e.type === "missed_penalty" ? " (pen. manqué)" : ""}
          </span>
          {e.type === "red_card" && <span className="sr-only">Carton rouge</span>}
        </li>
      ))}
    </ol>
  );
}

/** A team's page: its nation's for a national team (named like a country), else its club's. */
const teamHref = (f, match, team) =>
  nationalFlagCode(team.name, match.season)
    ? f.href("/nations/", { id: team.id })
    : f.href("/clubs/", { id: team.id });

export default function MatchDetail({ match }) {
  const f = useFootball(),
    search = useSearchParams(),
    panelId = useId();
  const askedView = search.get("view");
  const requestedView = FORMER_VIEWS[askedView] || askedView;
  const [now, setNow] = useState(() => Date.now());
  const beforeKickoff = lineupsBeforeKickoff(match, now);
  const liveWindow = isLiveWindow(match, now);
  const watchClock = beforeKickoff || liveWindow || requestedView === "lineups";
  useEffect(() => {
    if (!watchClock) return;
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, LINEUPS_WATCH.every);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [watchClock]);
  // Live: the feed's minute and score until PitchAPI has the score, then core's.
  const live = useLiveMatch(match.id, liveWindow);
  const running = liveRunning(live);
  const liveStarted = live?.status && live.status !== "scheduled";
  const upcoming = beforeKickoff && !liveStarted;
  const tabs = running ? runningViews : upcoming ? upcomingViews : views;
  const defaultView = running ? "live" : upcoming ? "context" : "overview";
  const view = tabs.some(([key]) => key === requestedView) ? requestedView : defaultView;
  const selectView = (value) => {
    const url = new URL(window.location.href);
    if (value === defaultView) url.searchParams.delete("view");
    else url.searchParams.set("view", value);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const grades = useMatchGrades(match.id, view === "overview");
  const players = useMemo(
    () =>
      f.data.appearances
        .filter((r) => r.matchId === match.id)
        .sort((a, b) => (b.gradeZ ?? -99) - (a.gradeZ ?? -99)),
    [f.data, match.id],
  );
  const leading = leadingPlayers(
    players.length ? players : match.leadingPlayers,
    grades,
    // Eight rows reach the foot of the shot map beside them (hugo, 25 Nov).
    { match: match.id, count: 8 },
  );
  const competition = f.allCompetitions.find((c) => c.id === match.leagueId);
  const homeName = match.home.name ?? "Équipe non renseignée";
  const awayName = match.away.name ?? "Équipe non renseignée";
  const liveScore = running ? live.score : null;
  const liveEvents = liveScore ? liveTimeline(live) : [];
  const liveStats =
    live && live.status !== "scheduled" ? liveTeamStats(live, match) : null;
  const liveState = liveStatus(live);
  const shootout = running ? liveShootout(live, match) : null;
  // How a finished match went past the 90th, from the read the chart shares (/api/forecasts/live):
  // the summary does not say it.
  const past = useMatchWinProbability(match.id, match.status === "finished" && !running);
  const afterNote = shootout
    ? `Tirs au but ${shootout.score}`
    : past?.penalties
      ? `Tirs au but ${past.penalties[0]}–${past.penalties[1]}`
      : past?.extraTime
        ? "Après prolongation"
        : null;
  const status = liveState
    ? liveState.label
    : match.status === "finished"
      ? "Terminé"
      : upcoming
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
    ["upcoming", "calendar"].includes(search.get("from")) || upcoming;
  // The calendar (§ 86, the matches read by pages): the way back opens the day the match was chosen on, else its own.
  const calendarDay = validDay(search.get("day"))
    ? search.get("day")
    : match.timeUtc && Number.isFinite(Date.parse(match.timeUtc))
      ? parisDay(match.timeUtc)
      : validDay(match.date)
        ? match.date
        : "";
  const calendarBack = pagedMatchList(f.manifest, "/matchs/", null)
    ? f.href("/matchs/", calendarDay ? { day: calendarDay } : {})
    : null;
  // Each team in its crest's colour, blue and violet without one (hugo, 25 Nov; § 64).
  const teamColours = useCrestColours(match.home, match.away);
  // Before the kick-off, each side's place in the competition and the time left (§ 81.2).
  const table = useCompetitionTable(match, upcoming);
  const standing = (team) => {
    const row = upcoming ? tableRow(table, team.id) : null;
    return row ? ` · ${place(row.position)} · ${number(row.points)} pts` : "";
  };
  const left = upcoming ? countdown(match.timeUtc, now) : null;
  return (
    <div className="match-detail" style={teamColours}>
      <MatchNav
        match={match}
        competition={competition}
        back={
          calendarBack ? (
            <BackLink href={calendarBack} className="match-head-back" prefix={<Icon name="back" />} label="Calendrier" />
          ) : (
            <BackLink
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
              className="match-head-back"
              prefix={<Icon name="back" />}
              label={fromUpcoming ? "Matchs à venir" : "Résultats"}
            />
          )
        }
        logo={
          (competition || match.editionArtwork) && (
            <Media
              url={editionArtworkUrl(
                match.leagueId,
                competition?.imageUrl,
                match.editionArtwork,
              )}
              initials={false}
            />
          )
        }
        actions={
          <>
            <Link
              className="button button-secondary match-report-link"
              href={f.href("/rapport/", { id: match.id })}
            >
              Rapport du match
            </Link>
            <BookmarkButton
              kind="matches"
              id={match.id}
              name={`${homeName} – ${awayName}`}
              season={seasonLabel(match.season || f.season)}
            />
          </>
        }
      />
      <section className="match-scoreboard" aria-label="Résumé du match">
        <h1 className="sr-only">
          {homeName} — {awayName}
        </h1>
        <div className="scoreboard-main">
          <Link
            className="scoreboard-team"
            href={teamHref(f, match, match.home)}
          >
            <Media name={homeName} url={match.home.imageUrl} />
            <div>
              <strong>{homeName}</strong>
              <span>
                Domicile
                {match.home.formation ? ` · ${match.home.formation}` : ""}
                {standing(match.home)}
              </span>
            </div>
          </Link>
          <div className="scoreboard-center">
            <span
              className={`match-status${match.status === "finished" ? " is-finished" : ""}${liveState?.tone === "live" ? " is-live" : ""}`}
            >
              <span />
              {status}
              {/* The date in the status line (§ 63.6): the scoreboard has no line above the teams. */}
              {(match.timeUtc || match.date) && <> · {date(match.timeUtc || match.date)}</>}
              {time && !upcoming && <> · {time}</>}
            </span>
            <div
              className="scoreboard-score"
              data-live={liveScore ? "" : undefined}
            >
              {liveScore ? (
                <>
                  <strong>{number(liveScore.home)}</strong>
                  <span>–</span>
                  <strong>{number(liveScore.away)}</strong>
                </>
              ) : upcoming ? (
                <span className="scoreboard-upcoming">{time || "—"}</span>
              ) : (
                <>
                  <strong>{number(match.home.score)}</strong>
                  <span>–</span>
                  <strong>{number(match.away.score)}</strong>
                </>
              )}
            </div>
            {left && (
              <span className="scoreboard-countdown" data-countdown="">
                {left}
              </span>
            )}
            {afterNote && (
              <span className="scoreboard-shootout">{afterNote}</span>
            )}
          </div>
          <Link
            className="scoreboard-team scoreboard-away"
            href={teamHref(f, match, match.away)}
          >
            <Media name={awayName} url={match.away.imageUrl} />
            <div>
              <strong>{awayName}</strong>
              <span>
                Extérieur
                {match.away.formation ? ` · ${match.away.formation}` : ""}
                {standing(match.away)}
              </span>
            </div>
          </Link>
        </div>
        <LiveTimeline events={liveEvents} match={match} />
        {view === "live" ? null : liveStats ? (
          <div className="match-kpis" data-live="">
            {liveStats.map((s) => (
              <div key={s.key}>
                <span>{s.label}</span>
                <strong>
                  <b className="home-number">{s.home}</b>
                  <i>–</i>
                  <b className="away-number">{s.away}</b>
                </strong>
              </div>
            ))}
          </div>
        ) : (
          upcoming ? (
            <Suspense fallback={null}>
              <PreviewStrip match={match} />
            </Suspense>
          ) : (
            <MatchKpis match={match} />
          )
        )}
      </section>
      {teamStatsFlagged(match) && (
        <p role="status" className="notice notice-warning">
          Statistiques d’équipe signalées comme incohérentes.
        </p>
      )}
      <MatchViewTabs
        view={view}
        onChange={selectView}
        panelId={panelId}
        views={tabs}
      />
      <div
        id={panelId}
        className="match-view-panel"
        tabIndex={0}
        role="tabpanel"
        aria-labelledby={`${panelId}-${view}`}
      >
        {view === "live" && <MatchLive match={match} live={live} />}
        {view === "overview" && (
          <div className="match-overview-grid">
            {/* The finished match's best grade and three leaders open its Résumé (FAILURE_MODES § 63). */}
            {match.status === "finished" && !running && <MatchLeaders match={match} />}
            <MatchFlow
              match={match}
              live={liveScore ? live : null}
              extraTime={past?.extraTime === true}
            />
            {match.summaryVersion ? (
              <SummaryShots match={match} />
            ) : (
              <MatchShotMap match={match} />
            )}
            <Card
              title="Meilleures notes"
              className="match-leaders-card"
              footer={
                <button
                  className="inline-link"
                  onClick={() => selectView("lineups")}
                >
                  Tous les joueurs
                  <Icon name="arrow" />
                </button>
              }
            >
              <div className="match-leaders-list">
                {leading.map((r, i) => (
                  <MatchPlayer
                    key={r.id}
                    row={r}
                    rank={i + 1}
                    grade={grades.get(playerOf(r))}
                  />
                ))}
              </div>
              {!leading.length && <Empty>Aucune note collectée.</Empty>}
            </Card>
          </div>
        )}
        {view === "context" && (
          <Suspense
            fallback={
              <Skeleton data-page-loading="" label="Chargement du contexte…" />
            }
          >
            {/* Before the kick-off the preview (§ 81); from it, the absents are in « Compositions » (§ 79.7). */}
            {upcoming ? <MatchPreview match={match} /> : <MatchContext match={match} />}
          </Suspense>
        )}
        {view === "standings" && <MatchTable match={match} />}
        {view === "stats" && <MatchStatistics match={match} />}
        {view === "lineups" && (
          <div className="match-lineups-view">
            <MatchLineups
              key={`${match.id}:lineups`}
              match={match}
              before={upcoming}
              now={now}
            />
            {!upcoming && <MatchAbsences match={match} started />}
            {!upcoming && (
              <MatchPlayersBoard key={`${match.id}:players`} match={match} />
            )}
          </div>
        )}
        {view === "analyses" && (
          <MatchAnalyses key={`${match.id}:analyses`} match={match} />
        )}
      </div>
    </div>
  );
}
