"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { Empty } from "../components/UI.jsx";
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
import { dataUrl } from "../data-url.js";
import { competitionIndex } from "../services/competition-identity.js";
import { europeFocusIds } from "../../../shared/competition-scope.js";
import {
  CHAMPIONS_LEAGUE_ID,
  TOP_SEVEN_IDS,
  ballonDorRaceOpen,
  bestDefences,
  bestWinStreak,
  biggestWin,
  leagueOf,
  leagueProgress,
  manifestSignature,
  matchdayWindow,
  playerOfTheWeek,
  personalClubIds,
  recentRatings,
  seasonLeaders,
  seasonProgress,
  seasonTotals,
  selectMatchOfTheWeek,
  teamRanks,
  untilParisMidnight,
  upcomingHighlights,
  weekPerformances,
  weekResults,
} from "../services/home-insights.js";

/**
 * The data is refreshed every night. From midnight (Paris), the home checks
 * every 30 minutes for a newly published season and reloads itself once it
 * is there, so a page left open shows the new day without any action.
 */
function useNightlyRefresh(manifest) {
  useEffect(() => {
    if (!manifest) return;
    const current = manifestSignature(manifest);
    let timer,
      pending = false,
      stopped = false;
    const reload = () => window.location.reload();
    const check = async () => {
      try {
        const response = await fetch(dataUrl("dashboard-manifest.json"), {
          cache: "no-store",
        });
        if (
          response.ok &&
          manifestSignature(await response.json()) !== current
        ) {
          if (document.visibilityState === "visible") return reload();
          pending = true;
          return;
        }
      } catch {
        // A failed check is retried at the next interval.
      }
      if (!stopped) timer = window.setTimeout(check, 30 * 60_000);
    };
    timer = window.setTimeout(check, untilParisMidnight(Date.now()) + 60_000);
    const visible = () => {
      if (pending && document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [manifest]);
}

function useClock() {
  const [now, setNow] = useState(() => Date.now());
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

export default function OverviewPage() {
  const f = useFootball(),
    research = useResearch(),
    params = useSearchParams(),
    now = useClock();
  useNightlyRefresh(f.manifest);
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

  const matchWeek = useMemo(
    () => matchdayWindow(scopedMatches, now),
    [scopedMatches, now],
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
  const performances = useMemo(
    () => weekPerformances(scopedRows, matchWeek),
    [scopedRows, matchWeek],
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
  const matchIndex = useMemo(
    () => new Map(scopedMatches.map((m) => [m.id, m])),
    [scopedMatches],
  );
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

  if (!matchWeek && !tables.length && !highlights.length && !totals.length)
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
          Aucun match terminé pour cette sélection.{" "}
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
      <HomeTicker results={results} ranks={ranks} competitions={competitions} />
      <div className="home-bento">
        {featured && (
          <div className={hasWeekSummary ? "home-span-8" : "home-span-12"}>
            <MatchOfTheWeek
              match={featured}
              ranks={ranks}
              competition={competitions.get(leagueOf(featured))}
              bestPlayer={bestOfFeatured}
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
            />
            <NumberOfTheWeek
              win={win}
              competition={win && competitions.get(leagueOf(win.match))}
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
              progress={seasonProgress(progress)}
              ranking={ranking}
              raceOpen={raceOpen}
            />
          </div>
        )}
      </div>
      <AlsoShone performances={others} matches={matchIndex} />
    </Layout>
  );
}
