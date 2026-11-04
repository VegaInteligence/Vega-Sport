"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, Empty, AsyncState } from "../components/UI.jsx";
import { MatchLink } from "../components/MatchLink.jsx";
import MatchDetail from "../components/MatchDetail.jsx";
import { ResearchLists, useHasSaved } from "../components/ResearchUI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useProResource } from "../hooks/useProResource.js";

function Summary({ client, id }) {
  const resource = useProResource(client.resourceKey("summary", id), () =>
    client.summary(id),
  );
  return (
    <AsyncState resource={resource}>
      {(match) => (
        <MatchDetail key={client.resourceKey("match", id)} match={match} />
      )}
    </AsyncState>
  );
}

function MatchPages({ client, status, query, week }) {
  const [cursors, setCursors] = useState([null]);
  const [page, setPage] = useState(0);
  const filters = {
    limit: 30,
    status,
    ...(query ? { q: query } : {}),
    ...(cursors[page] ? { cursor: cursors[page] } : {}),
  };
  const key = client.resourceKey("page", JSON.stringify(filters));
  const resource = useProResource(key, () => client.page(filters));
  return (
    <AsyncState resource={resource}>
      {(body) => (
        <>
          {body.data.matches.map((match) => (
            <MatchLink
              key={match.id}
              match={match}
              week={week}
              showKickoff={status === "upcoming"}
            />
          ))}
          {!body.data.matches.length && (
            <Empty>Aucun match pour cette recherche.</Empty>
          )}
          <nav className="pagination" aria-label="Pagination des matchs">
            <button
              className="button button-secondary"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Précédents
            </button>
            <span aria-live="polite">Page {page + 1}</span>
            <button
              className="button button-secondary"
              disabled={!body.pagination.nextCursor}
              onClick={() => {
                setCursors((previous) => [
                  ...previous.slice(0, page + 1),
                  body.pagination.nextCursor,
                ]);
                setPage((value) => value + 1);
              }}
            >
              Suivants
            </button>
          </nav>
        </>
      )}
    </AsyncState>
  );
}

export default function ProMatchesPage() {
  const f = useFootball(),
    search = useSearchParams();
  const id = search.get("id"),
    tab = search.get("tab");
  const hasSaved = useHasSaved("matches");
  const saved = tab === "saved" || (!tab && hasSaved);
  const upcoming = !saved && tab !== "results";
  let client, error;
  try {
    client = f.client.edition(
      search.get("competition") || f.filters.league,
      search.get("sourceSeason") || f.season,
    );
  } catch (failure) {
    error = failure.message;
  }
  const scope =
    client &&
    client.resourceKey("list", JSON.stringify([upcoming, f.filters.query]));
  return (
    <Layout
      path="/matchs/"
      title="Calendrier"
      filters={!id && !saved}
      filterKind="fixtures"
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
            ].map(([value, label]) => (
              <Link
                key={value}
                href={f.href("/matchs/", { tab: value })}
                aria-current={
                  (saved ? "saved" : upcoming ? "upcoming" : "results") ===
                  value
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
      {saved ? (
        <ResearchLists kind="matches" />
      ) : error ? (
        <div role="alert" className="notice notice-warning">
          {error}
        </div>
      ) : id ? (
        <Summary
          key={client.resourceKey("detail", id)}
          client={client}
          id={id}
        />
      ) : (
        <Card
          title={upcoming ? "À venir" : "Résultats"}
          action={
            <button
              className="button button-secondary"
              onClick={f.refreshManifest}
            >
              Actualiser
            </button>
          }
        >
          <MatchPages
            key={scope}
            client={client}
            status={upcoming ? "upcoming" : "played"}
            query={f.filters.query}
            week={search.get("week")}
          />
        </Card>
      )}
    </Layout>
  );
}
