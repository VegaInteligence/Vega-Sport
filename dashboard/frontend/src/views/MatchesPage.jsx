"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useState } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Empty, Pager, AsyncState } from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import MatchDetail from "../components/MatchDetail.jsx";
import MatchSkeleton from "../components/MatchSkeleton.jsx";
import UpcomingMatches from "../components/UpcomingMatches.jsx";
import { useResource, json } from "../services/resources.js";
import { loadRemoteMatch } from "../services/remote-match.js";
import {
  matchResourceKey,
  validateMatchPublication,
} from "../services/match-resources.js";
import { ResearchLists, useHasSaved } from "../components/ResearchUI.jsx";
import useFavourites from "../hooks/useFavourites.js";
import { favouritesFirstWithinDay, involvesFavourite, matchesLeague } from "../services/preference-effects.js";
import usePreselect from "../hooks/usePreselect.js";
import WorldCupArchiveMatch from "../components/WorldCupArchiveMatch.jsx";
import CalendarPage from "../components/CalendarPage.jsx";
import CalendarSkeleton from "../components/CalendarSkeleton.jsx";
function RemoteDetail({ id }) {
  const f = useFootball(),
    resource = useResource(
      matchResourceKey(f.manifest || f.client, "summary", id),
      async ({ signal }) => {
        validateMatchPublication(f.manifest || f.client, { id });
        return loadRemoteMatch(id, f.client, json, { signal });
      },
    );
  return (
    <AsyncState resource={resource} loading={<MatchSkeleton />}>
      {(match) => <MatchDetail key={match.id} match={match} />}
    </AsyncState>
  );
}
export default function MatchesPage() {
  const f = useFootball(),
    [page, setPage] = useState(1),
    search = useSearchParams(),
    // An archived World Cup match (its key in the Fjelstul World Cup Database): its own page.
    archived = search.get("cdm"),
    id = search.get("id") || archived,
    hasSaved = useHasSaved("matches"),
    tab = search.get("tab"),
    // The calendar (§ 87, the matches read by pages) opens on its day; « Mes matchs » only when asked for.
    calendar = !id && f.pagedMatches,
    saved = tab === "saved" || (!tab && hasSaved && !calendar),
    upcoming = !saved && tab !== "results",
    selected = f.data.matches.find((m) => m.id === id),
    fixture = f.data.fixtures?.find((m) => m.id === id),
    favouriteClubs = useFavourites().clubs,
    // Effect 3: within a day, a favourite club's result first.
    results = favouritesFirstWithinDay(f.matches, (m) => m.date, (m) => involvesFavourite(m, favouriteClubs)),
    pages = Math.max(1, Math.ceil(f.matches.length / 30)),
    current = Math.min(page, pages);
  // Effect 9: the league filter starts on the first followed league (not over the URL's, not after a clear).
  usePreselect("matches", {
    ready: Boolean(f.preferencesReady && !id && !saved && f.competitions?.length),
    candidate: matchesLeague(f.preferences?.favoriteLeagueIds),
    inUrl: Boolean(search.get("league") || search.get("leagues")),
    options: new Set((f.competitions || []).map((c) => c.id)),
    current: f.filters.league,
    apply: (league) => f.setFilters((v) => ({ ...v, league, leagues: [], match: "all" })),
  });
  if (calendar)
    return (
      <Layout path="/matchs/" title="Calendrier" hideHeading className="calendar-page" loader={<CalendarSkeleton />}>
        <CalendarPage saved={saved} />
      </Layout>
    );
  return (
    <Layout
      path={archived ? "/competitions/" : "/matchs/"}
      title="Calendrier"
      filters={!id && !saved}
      filterKind={upcoming ? "fixtures" : "performances"}
      hideHeading={!!id}
      className={id ? "match-workspace" : ""}
      loader={id && !archived ? <MatchSkeleton /> : undefined}
      subnav={
        !id && (
          <nav className="matches-view-switch" aria-label="Vue des matchs">
            {[
              ...(hasSaved ? [["saved", "Mes matchs"]] : []),
              ["upcoming", "À venir"],
              ["results", "Résultats"],
              ...(hasSaved ? [] : [["saved", "Mes matchs"]]),
            ].map(([tab, label]) => (
              <Link
                key={tab}
                href={f.href("/matchs/", {
                  tab,
                  ...(search.get("week") ? { week: search.get("week") } : {}),
                })}
                aria-current={
                  (saved ? "saved" : upcoming ? "upcoming" : "results") === tab
                    ? "page"
                    : undefined
                }
              >
                {label}
              </Link>
            ))}
          </nav>
        )
      }
    >
      {archived ? (
        <WorldCupArchiveMatch matchKey={archived} />
      ) : id ? (
        <>
          {selected ? (
            <MatchDetail key={selected.id} match={selected} />
          ) : fixture ? (
            <MatchDetail
              key={fixture.id}
              match={f.client.normalizedRemote(fixture)}
            />
          ) : (
            <RemoteDetail id={id} />
          )}
        </>
      ) : saved ? (
        <ResearchLists kind="matches" />
      ) : upcoming ? (
        <UpcomingMatches />
      ) : (
        <Card title="Résultats">
          {results.slice((current - 1) * 30, current * 30).map((m) => (
            <MatchLink key={m.id} match={m} week={search.get("week")} />
          ))}
          {!f.matches.length && (
            <Empty>Aucun match pour cette recherche.</Empty>
          )}
          <Pager page={current} total={pages} onChange={setPage} />
        </Card>
      )}
    </Layout>
  );
}
