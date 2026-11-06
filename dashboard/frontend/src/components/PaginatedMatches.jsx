"use client";
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FootballContext, useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { matchPageFilters, readFixturePage } from "../services/match-pages.js";
import { AsyncState, Card, Empty } from "./UI.jsx";
import { MatchLink } from "./MatchLink.jsx";
import UpcomingMatches from "./UpcomingMatches.jsx";

function Pages({ filters, upcoming, scopeKey }) {
  const f = useFootball();
  const [paging, setPaging] = useState({
    page: 0,
    cursors: [null],
    generation: null,
    attempt: 0,
  });
  const cursor = paging.cursors[paging.page];
  const resource = useResource(
    `match-page:${scopeKey}:${cursor || "first"}:${paging.attempt}`,
    ({ signal } = {}) =>
      readFixturePage(filters, {
        cursor,
        generation: paging.page ? paging.generation : null,
        signal,
      }),
  );
  const body = resource.value;
  useEffect(() => {
    if (
      paging.page !== 0 ||
      !body?.pagination ||
      body.pagination.generation === paging.generation
    )
      return;
    setPaging((previous) => ({
      ...previous,
      cursors: [null],
      generation: body.pagination.generation,
    }));
  }, [body, paging.page, paging.generation]);
  const restart = () => {
    setPaging((previous) => ({
      page: 0,
      cursors: [null],
      generation: null,
      attempt: previous.attempt + 1,
    }));
    f.refreshManifest().catch(() => {});
  };
  return (
    <AsyncState resource={resource}>
      {(value) =>
        value.publicationChanged ? (
          <div role="status" className="notice notice-warning">
            <p>
              Les rencontres ont été actualisées. Rechargez la première page.
            </p>
            <button className="button button-primary" onClick={restart}>
              Actualiser les rencontres
            </button>
          </div>
        ) : (
          <>
            {upcoming ? (
              <FootballContext.Provider
                value={{
                  ...f,
                  data: { ...f.data, fixtures: value.data.matches },
                }}
              >
                <UpcomingMatches
                  paginated
                  nextPageAvailable={Boolean(value.pagination.nextCursor)}
                />
              </FootballContext.Provider>
            ) : (
              <Card title="Résultats">
                {value.data.matches.map((match) => (
                  <MatchLink key={match.id} match={match} />
                ))}
                {!value.data.matches.length && (
                  <Empty>Aucun match pour cette recherche.</Empty>
                )}
              </Card>
            )}
            <nav className="pagination" aria-label="Pagination des rencontres">
              <button
                className="button button-secondary"
                disabled={paging.page === 0}
                onClick={() =>
                  setPaging((previous) => ({
                    ...previous,
                    page: previous.page - 1,
                  }))
                }
              >
                Précédents
              </button>
              <span aria-live="polite">Page {paging.page + 1}</span>
              <button
                className="button button-secondary"
                disabled={!value.pagination.nextCursor}
                onClick={() =>
                  setPaging((previous) => ({
                    ...previous,
                    page: previous.page + 1,
                    cursors: [
                      ...previous.cursors.slice(0, previous.page + 1),
                      value.pagination.nextCursor,
                    ],
                    generation: value.pagination.generation,
                  }))
                }
              >
                Suivants
              </button>
            </nav>
          </>
        )
      }
    </AsyncState>
  );
}

export default function PaginatedMatches({ upcoming = false }) {
  const f = useFootball(),
    search = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const filters = matchPageFilters({
    manifest: f.manifest,
    season: f.season,
    focus: f.focus,
    league: f.filters.league,
    query: f.filters.query,
    upcoming,
    week: search.get("week"),
    now,
  });
  const scopeKey = JSON.stringify([
    f.manifest.publicationVersion || f.manifest.scouting?.sourceDigest,
    filters,
  ]);
  return (
    <Pages
      key={scopeKey}
      scopeKey={scopeKey}
      filters={filters}
      upcoming={upcoming}
    />
  );
}
