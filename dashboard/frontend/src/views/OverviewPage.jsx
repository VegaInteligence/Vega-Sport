"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { useResourceBootstrap } from "../services/resource-bootstrap.js";
import { mirrorHomeState } from "../services/home-bootstrap-preferences.js";
import { AsyncState, Empty } from "../components/UI.jsx";
import useCompactRead from "../hooks/useCompactRead.js";
import { compactGeneration, compactScope } from "../services/compact-reads.js";
import { fixtureWeek, parisDay } from "../services/fixtures.js";
import HomePreferences from "../components/HomePreferences.jsx";
import SeasonFilter from "../components/SeasonFilter.jsx";
import {
  HomeTicker,
  MatchOfTheWeek,
  NumberOfTheWeek,
} from "../components/HomeMatchday.jsx";
import {
  AlsoShone,
  Finishing,
  PlayerOfTheWeek,
  SeasonScorers,
} from "../components/HomePlayers.jsx";
import {
  BallonDorRace,
  BallonDorTeaser,
  BestDefence,
  NextMatches,
  TitleRace,
  WinStreak,
} from "../components/HomeSeason.jsx";
import { json, useResource } from "../services/resources.js";
import { ballonDorRanking } from "../services/ballon-dor.js";
import { competitionIndex } from "../services/competition-identity.js";
import { europeFocusIds } from "../../../shared/competition-scope.js";
import {
  CHAMPIONS_LEAGUE_ID,
  TOP_SEVEN_IDS,
  archiveSeason,
  ballonDorRaceOpen,
  bestDefences,
  bestWinStreak,
  biggestWin,
  leagueOf,
  leagueProgress,
  matchdayWindow,
  playerOfTheWeek,
  personalClubIds,
  recentRatings,
  seasonLeaders,
  seasonProgress,
  seasonTotals,
  selectMatchOfTheWeek,
  teamRanks,
  upcomingHighlights,
  weekPeriodLabel,
  weekPerformances,
  weekResults,
} from "../services/home-insights.js";

function useClock() {
  const bootstrap = useResourceBootstrap();
  const [now, setNow] = useState(() => bootstrap?.now || Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return now;
}

/**
 * The home follows the saved competitions. Without a choice it shows the
 * Top 7 Europe leagues and the European cups; "all competitions" chosen in
 * the filter opens it to every league.
 */
function homeScope(f, focusIds) {
  if (f.filters.league !== "all")
    return { ids: new Set([f.filters.league]), label: null };
  const favorites = f.preferences.favoriteLeagueIds;
  if (favorites.length)
    return {
      ids: new Set(favorites),
      label: `${favorites.length} compétition${favorites.length > 1 ? "s" : ""} suivie${favorites.length > 1 ? "s" : ""}`,
    };
  if (f.focus === "all" && f.preferences.onboardingComplete)
    return { ids: null, label: "toutes les compétitions" };
  return { ids: focusIds, label: "Top 7 Europe et coupes d’Europe" };
}

function LegacyOverview() {
  const f = useFootball(),
    research = useResearch(),
    params = useSearchParams(),
    now = useClock();
  const focusIds = useMemo(() => europeFocusIds(f.manifest), [f.manifest]);
  const scope = homeScope(f, focusIds),
    scopeKey = scope.ids ? [...scope.ids].sort().join(",") : "all",
    inScope = (record) => !scope.ids || scope.ids.has(leagueOf(record));
  const competitions = useMemo(
    () =>
      competitionIndex(
        f.competitions,
        f.data.competitions,
        f.catalog,
        f.allCompetitions,
      ),
    [f.competitions, f.data.competitions, f.catalog, f.allCompetitions],
  );
  const matches = f.matches;
  const scopedMatches = useMemo(
    () => matches.filter(inScope),
    [matches, scopeKey],
  );
  const scopedRows = useMemo(() => f.rows.filter(inScope), [f.rows, scopeKey]);
  const fixtures = f.data.fixtures;
  const archived =
    archiveSeason(f.season, f.manifest.defaultSeason, now) ||
    Boolean(params.get("v"));

  const matchWeek = useMemo(
    () => matchdayWindow(scopedMatches, now, { archive: archived }),
    [scopedMatches, now, archived],
  );
  const results = useMemo(
    () => weekResults(scopedMatches, matchWeek),
    [scopedMatches, matchWeek],
  );
  const progress = useMemo(
    () => leagueProgress(fixtures, scope.ids),
    [fixtures, scopeKey],
  );
  const ranks = useMemo(() => teamRanks(progress), [progress]);
  const featured = useMemo(
    () => selectMatchOfTheWeek(results, ranks),
    [results, ranks],
  );
  const matchIndex = useMemo(
    () => new Map(scopedMatches.map((m) => [m.id, m])),
    [scopedMatches],
  );
  const performances = useMemo(
    () => weekPerformances(scopedRows, matchWeek, 60, matchIndex),
    [scopedRows, matchWeek, matchIndex],
  );
  const potw = playerOfTheWeek(performances);
  const totals = useMemo(
    () => seasonTotals(scopedRows, f.season),
    [scopedRows, f.season],
  );
  const leaders = useMemo(() => seasonLeaders(totals), [totals]);
  const personalClubs = useMemo(
    () => personalClubIds(research?.data.lists, f.rows, f.season),
    [research?.data.lists, f.rows, f.season],
  );
  const highlights = useMemo(
    () => upcomingHighlights(fixtures, now, scope.ids, ranks, 7, personalClubs),
    [fixtures, now, scopeKey, ranks, personalClubs],
  );
  const streak = useMemo(() => bestWinStreak(progress), [progress]);
  const defences = useMemo(() => bestDefences(progress), [progress]);
  const defence = defences[0];
  const bestOfFeatured = useMemo(
    () =>
      featured
        ? scopedRows
            .filter(
              (r) => r.matchId === featured.id && Number.isFinite(r.rating),
            )
            .sort((a, b) => b.rating - a.rating)[0]
        : null,
    [featured, scopedRows],
  );
  const tables = useMemo(() => {
    const order = (id) =>
      TOP_SEVEN_IDS.includes(id) ? TOP_SEVEN_IDS.indexOf(id) : 99;
    return [...progress.values()]
      .filter((t) => t.played > 0 && t.rows.length >= 4)
      .sort(
        (a, b) =>
          order(a.leagueId) - order(b.leagueId) ||
          (competitions.get(a.leagueId)?.name || "").localeCompare(
            competitions.get(b.leagueId)?.name || "",
            "fr",
          ),
      )
      .slice(0, 8);
  }, [progress, competitions]);

  // The Ballon d'Or race takes the stage once the Champions League quarter-final second legs are played.
  const rounds = useResource(
    `home-rounds:${CHAMPIONS_LEAGUE_ID}:${f.season}`,
    () =>
      json(
        `/api/matchdays?competition=${CHAMPIONS_LEAGUE_ID}&season=${encodeURIComponent(f.season)}`,
      )
        .then((d) => d.matches || {})
        .catch(() => ({})),
  );
  const override = params.get("ballondor");
  // The Ballon d'Or blocks show only the STATARENA ranking, never a stand-in list.
  const ranking = ballonDorRanking(f.season);
  const raceOpen =
    override === "ouvert"
      ? true
      : override === "ferme"
        ? false
        : ballonDorRaceOpen({
            fixtures,
            matches: f.data.matches,
            rounds: rounds.value || {},
          });

  const win = biggestWin(results);
  const streakNext =
    streak &&
    highlights
      .filter(
        (h) =>
          h.fixture.home_team.id === streak.id ||
          h.fixture.away_team.id === streak.id,
      )
      .sort((a, b) => a.time - b.time)[0];
  const potwMatch = potw && matchIndex.get(potw.matchId);
  const potwSeason = potw && totals.find((p) => p.playerId === potw.playerId);
  const potwRecent = potw
    ? recentRatings(scopedRows, potw.playerId, f.season)
    : [];
  const others = performances
    .filter((p) => p.playerId !== potw?.playerId)
    .slice(0, 9);
  return (
    <OverviewContent
      f={f}
      scope={scope}
      scopeKey={scopeKey}
      competitions={competitions}
      archived={archived}
      now={now}
      model={{
        matchWeek,
        results,
        tables,
        highlights,
        ranks,
        featured,
        bestOfFeatured,
        potw,
        potwMatch,
        potwSeason,
        potwRecent,
        others,
        matchIndex,
        performances,
        leaders,
        streak,
        defences,
        defence,
        win,
        streakNext,
        raceOpen,
        ranking,
        progressValue: seasonProgress(progress),
        hasSeasonPlayers: totals.length > 0,
      }}
    />
  );
}

export default function OverviewPage() {
  const f = useFootball();
  return f.compactMode ? <CompactOverview /> : <LegacyOverview />;
}

function CompactOverview() {
  const f = useFootball(),
    research = useResearch(),
    params = useSearchParams(),
    now = useClock();
  const scope = homeScope(f, europeFocusIds(f.manifest)),
    scopeKey = compactScope(scope.ids ? [...scope.ids] : null),
    archived =
      archiveSeason(f.season, f.manifest.defaultSeason, now) ||
      Boolean(params.get("v")),
    entries = (research?.data.lists || []).flatMap(
      (list) => list.entries || [],
    ),
    saved = (kind) =>
      [
        ...new Set(
          entries
            .filter((entry) => entry.kind === kind)
            .map((entry) => entry.id),
        ),
      ]
        .sort()
        .slice(0, 100)
        .join(","),
    summary = useCompactRead(
      "home",
      {
        season: f.season,
        leagues: scopeKey,
        generation: compactGeneration(f.manifest),
        archive: archived ? 1 : undefined,
        personalTeams: saved("clubs"),
        personalPlayers: saved("players"),
      },
      { clock: Math.floor(now / 300_000), refreshManifest: f.refreshManifest },
    );
  useEffect(() => {
    if (!f.preferencesReady || !research?.ready) return;
    mirrorHomeState({
      preferences: f.preferences, season: f.season,
      personalTeams: saved("clubs").split(",").filter(Boolean),
      personalPlayers: saved("players").split(",").filter(Boolean),
    });
    if (summary.value && !summary.loading)
      delete document.documentElement.dataset.homeBootstrapMismatch;
  }, [f.preferencesReady, research?.ready, f.preferences, f.season, scopeKey, summary.value, summary.loading]);
  if (summary.loading || summary.error)
    return (
      <Layout
        path="/"
        title="Vue d’ensemble"
        actions={
          <>
            <SeasonFilter f={f} compact />
            <HomePreferences f={f} />
          </>
        }
      >
        <AsyncState
          resource={summary}
          loading={<p role="status">Chargement de la synthèse…</p>}
        >
          {() => null}
        </AsyncState>
      </Layout>
    );
  return (
    <AsyncState
      resource={summary}
      loading={
        <Layout path="/" title="Vue d’ensemble">
          <p role="status">Chargement de la synthèse…</p>
        </Layout>
      }
    >
      {(value) => {
        const data = value.data,
          currentWeek = fixtureWeek(parisDay(now)),
          validPeriod = archived || data.period?.start === currentWeek.start,
          results = validPeriod ? data.results || [] : [],
          ranks = new Map(data.ranks || []),
          potw = validPeriod ? data.potw : null,
          others = validPeriod ? data.others || [] : [],
          competitions = competitionIndex(
            f.allCompetitions,
            f.competitions,
            data.competitions || [],
          ),
          highlights = (data.highlights || []).filter(
            (item) => item.time >= now,
          );
        return (
          <>
            {summary.refreshing && (
              <p className="notice" role="status">
                Actualisation de la synthèse…
              </p>
            )}
            {summary.refreshError && (
              <p className="notice notice-warning" role="status">
                La dernière synthèse reste affichée. {summary.refreshError}{" "}
                <button onClick={summary.retry}>Réessayer</button>
              </p>
            )}
            <OverviewContent
              f={f}
              scope={scope}
              scopeKey={scopeKey}
              competitions={competitions}
              archived={archived}
              now={now}
              model={{
                ...data,
                matchWeek: validPeriod
                  ? data.period
                  : { ...currentWeek, current: true },
                results,
                ranks,
                featured: validPeriod ? data.featured : null,
                bestOfFeatured: validPeriod ? data.bestOfFeatured : null,
                potw,
                others,
                performances: [potw, ...others].filter(Boolean),
                matchIndex: new Map(
                  [...results, ...(data.otherMatches || [])].map((match) => [
                    match.id,
                    match,
                  ]),
                ),
                win: validPeriod ? data.win : null,
                tables: data.tables || [],
                highlights,
                streakNext:
                  data.streakNext?.time >= now ? data.streakNext : null,
                leaders: data.leaders || {
                  goals: [],
                  assists: [],
                  clinical: [],
                  wasteful: [],
                },
                defences: data.defences || [],
                defence: data.defences?.[0],
                progressValue: data.seasonProgress,
                ranking: null,
                raceOpen: Boolean(data.raceOpen),
              }}
            />
          </>
        );
      }}
    </AsyncState>
  );
}

function OverviewContent({
  f,
  scope,
  scopeKey,
  competitions,
  archived,
  now,
  model,
}) {
  const {
    matchWeek,
    results,
    tables,
    highlights,
    ranks,
    featured,
    bestOfFeatured,
    potw,
    potwMatch,
    potwSeason,
    potwRecent,
    others,
    matchIndex,
    performances,
    leaders,
    streak,
    defences,
    defence,
    win,
    streakNext,
    raceOpen,
    ranking,
    progressValue,
    hasSeasonPlayers,
  } = model;
  if (
    !results.length &&
    !tables.length &&
    !highlights.length &&
    !hasSeasonPlayers
  )
    return (
      <Layout
        path="/"
        title="Vue d’ensemble"
        actions={
          <>
            <SeasonFilter f={f} compact />
            <HomePreferences f={f} />
          </>
        }
      >
        <Empty>
          {archived
            ? "Aucun match terminé pour cette sélection."
            : "Aucun match terminé disponible cette semaine pour cette sélection."}{" "}
          {f.season !== f.manifest.defaultSeason && (
            <Link
              className="inline-link"
              href={f.href("/", {
                season: f.manifest.defaultSeason,
                league: "",
              })}
            >
              Voir la saison en cours
            </Link>
          )}
        </Empty>
      </Layout>
    );
  const initialTable = tables.some((t) => t.leagueId === "l_3FJFUl")
    ? "l_3FJFUl"
    : tables[0]?.leagueId;
  const hasWeekSummary = Boolean(potw || win);
  const hasFinishing =
    leaders.clinical.length > 0 || leaders.wasteful.length > 0;
  const hasScorers = leaders.goals.length > 0 || leaders.assists.length > 0;
  const seasonCards =
    Number(hasFinishing) +
    Number(hasScorers) +
    Number(Boolean(streak || defence));
  const seasonSpan = (usual) =>
    seasonCards === 1
      ? "home-span-12"
      : seasonCards === 2
        ? "home-span-6"
        : usual;

  return (
    <Layout path="/" title="Vue d’ensemble" hideHeading className="home-page">
      <h1 className="sr-only">Vue d’ensemble</h1>
      <div className="home-toolbar">
        <SeasonFilter f={f} compact />
        <HomePreferences f={f} />
      </div>
      {matchWeek && (
        <div className="home-section-head">
          <h2>
            {archived ? `Archives · ${f.season}` : "Semaine en cours"}
            <span>
              {weekPeriodLabel(matchWeek)}
              {!archived && " · résultats provisoires"}
            </span>
          </h2>
        </div>
      )}
      {!results.length && !archived && (
        <p className="home-meta" role="status">
          Aucun match terminé disponible pour cette semaine.
        </p>
      )}
      {results.length > 0 && !performances.length && (
        <p className="home-meta" role="status">
          Aucune note éligible disponible pour cette période (60 min minimum).
        </p>
      )}
      <HomeTicker
        results={results}
        ranks={ranks}
        competitions={competitions}
        period={matchWeek}
      />
      <div className="home-bento">
        {featured && (
          <div className={hasWeekSummary ? "home-span-8" : "home-span-12"}>
            <MatchOfTheWeek
              match={featured}
              ranks={ranks}
              competition={competitions.get(leagueOf(featured))}
              bestPlayer={bestOfFeatured}
              period={matchWeek}
            />
          </div>
        )}
        {hasWeekSummary && (
          <div
            className={`home-stack ${featured ? "home-span-4" : "home-span-12"}`}
          >
            <PlayerOfTheWeek
              performance={potw}
              match={potwMatch}
              season={potwSeason}
              recent={potwRecent}
              period={matchWeek}
            />
            <NumberOfTheWeek
              win={win}
              competition={win && competitions.get(leagueOf(win.match))}
              period={matchWeek}
            />
          </div>
        )}
        {raceOpen && ranking?.length >= 3 && (
          <div className="home-span-12">
            <BallonDorRace ranking={ranking} />
          </div>
        )}
        {tables.length > 0 && (
          <div className={highlights.length ? "home-span-7" : "home-span-12"}>
            <TitleRace
              key={`${scopeKey}:${f.season}`}
              tables={tables}
              competitions={competitions}
              initial={initialTable}
            />
          </div>
        )}
        {highlights.length > 0 && (
          <div className={tables.length ? "home-span-5" : "home-span-12"}>
            <NextMatches
              highlights={highlights}
              ranks={ranks}
              competitions={competitions}
              now={now}
            />
          </div>
        )}
        {hasFinishing && (
          <div className={seasonSpan("home-span-5")}>
            <Finishing
              leaders={leaders}
              scopeIds={scope.ids ? [...scope.ids] : null}
            />
          </div>
        )}
        {hasScorers && (
          <div className={seasonSpan("home-span-4")}>
            <SeasonScorers
              leaders={leaders}
              scopeIds={scope.ids ? [...scope.ids] : null}
            />
          </div>
        )}
        {(streak || defence) && (
          <div className={`${seasonSpan("home-span-3")} home-stack`}>
            <WinStreak
              streak={streak}
              competitions={competitions}
              next={streakNext}
              now={now}
            />
            <BestDefence
              defence={defence}
              contenders={defences.slice(1)}
              competitions={competitions}
            />
          </div>
        )}
        {!(raceOpen && ranking?.length >= 3) && (
          <div className="home-span-12">
            <BallonDorTeaser
              progress={progressValue}
              ranking={ranking}
              raceOpen={raceOpen}
            />
          </div>
        )}
      </div>
      <AlsoShone
        performances={others}
        matches={matchIndex}
        period={matchWeek}
      />
    </Layout>
  );
}
