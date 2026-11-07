"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useState } from "react";
import Layout from "../components/Layout.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Card, Empty, Pager, AsyncState } from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import MatchDetail from "../components/MatchDetail.jsx";
import UpcomingMatches from "../components/UpcomingMatches.jsx";
import { useResource, json } from "../services/resources.js";
import { loadRemoteMatch } from "../services/remote-match.js";
import {
  matchResourceKey,
  validateMatchPublication,
} from "../services/match-resources.js";
import { ResearchLists, useHasSaved } from "../components/ResearchUI.jsx";
import ProMatchesPage from "./ProMatchesPage.jsx";
import PaginatedMatches from "../components/PaginatedMatches.jsx";
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
    <AsyncState resource={resource}>
      {(match) => <MatchDetail key={match.id} match={match} />}
    </AsyncState>
  );
}
export default function MatchesPage() {
  const f = useFootball();
  return f.pro ? <ProMatchesPage /> : <LegacyMatchesPage />;
}
function LegacyMatchesPage() {
  const f = useFootball(),
    [page, setPage] = useState(1),
    search = useSearchParams(),
    id = search.get("id"),
    hasSaved = useHasSaved("matches"),
    tab = search.get("tab"),
    saved = tab === "saved" || (!tab && hasSaved),
    upcoming = !saved && tab !== "results",
    selected = f.data.matches.find((m) => m.id === id),
    fixture = f.data.fixtures?.find((m) => m.id === id),
    pages = Math.max(1, Math.ceil(f.matches.length / 30)),
    current = Math.min(page, pages);
  return (
    <Layout
      path="/matchs/"
      title="Calendrier"
      filters={!id && !saved}
      filterKind={upcoming || f.pagedMatches ? "fixtures" : "performances"}
      hideHeading={!!id}
      className={id ? "match-workspace" : ""}
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
      {id ? (
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
      ) : f.pagedMatches ? (
        <PaginatedMatches upcoming={upcoming} />
      ) : upcoming ? (
        <UpcomingMatches />
      ) : (
        <Card title="Résultats">
          {f.matches.slice((current - 1) * 30, current * 30).map((m) => (
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
