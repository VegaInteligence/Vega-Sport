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
import { ResearchLists } from "../components/ResearchUI.jsx";
function RemoteDetail({ id }) {
  const f = useFootball(),
    resource = useResource(`remote-match:${id}`, () =>
      loadRemoteMatch(id, f.client, json),
    );
  return (
    <AsyncState resource={resource}>
      {(match) => <MatchDetail key={match.id} match={match} />}
    </AsyncState>
  );
}
export default function MatchesPage() {
  const f = useFootball(),
    [page, setPage] = useState(1),
    search = useSearchParams(),
    id = search.get("id"),
    saved = search.get("tab") === "saved",
    upcoming = !saved && search.get("tab") !== "results",
    selected = f.data.matches.find((m) => m.id === id),
    fixture = f.data.fixtures?.find((m) => m.id === id),
    pages = Math.max(1, Math.ceil(f.matches.length / 30)),
    current = Math.min(page, pages);
  return (
    <Layout
      path="/matchs/"
      title="Matchs"
      filters={!id && !saved}
      filterKind={upcoming ? "fixtures" : "performances"}
      hideHeading={!!id}
      className={id ? "match-workspace" : ""}
      subnav={
        !id && (
          <nav className="matches-view-switch" aria-label="Vue des matchs">
            {[
              ["upcoming", "À venir"],
              ["results", "Résultats"],
              ["saved", "Mes matchs"],
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
