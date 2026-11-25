"use client";
import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FootballContext, useFootball } from "../hooks/FootballContext.jsx";
import { primeResource, useResource } from "../services/resources.js";
import { PUBLICATION_UNAVAILABLE } from "../services/publication-change.js";
import { matchPageFilters, readFixturePage } from "../services/match-pages.js";
import { AsyncState, Card, Empty } from "./UI.jsx";
import { MatchLink } from "./MatchLink.jsx";
import UpcomingMatches from "./UpcomingMatches.jsx";
import useFavourites from "../hooks/useFavourites.js";
import {
  favouritesFirstWithinDay,
  involvesFavourite,
} from "../services/preference-effects.js";

function Pages({ filters, upcoming, scopeKey }) {
  const f = useFootball(),
    favouriteClubs = useFavourites().clubs;
  const [paging, setPaging] = useState({
    page: 0,
    cursors: [null],
    generation: null,
    attempt: 0,
  });
  const cursor = paging.cursors[paging.page];
  const pageKey = (cursorKey, attempt) =>
    `match-page:${scopeKey}:${cursorKey || "first"}:${attempt}`;
  const resource = useResource(
    pageKey(cursor, paging.attempt),
    ({ signal } = {}) =>
      readFixturePage(filters, {
        cursor,
        generation: paging.page ? paging.generation : null,
        page: paging.page,
        signal,
      }),
  );
  const body = resource.value;
  // The last page shown, kept on screen while a refused publication settles.
  const shown = useRef(null);
  useEffect(() => {
    if (body?.pagination) shown.current = { value: body, page: paging.page };
  }, [body, paging.page]);
  // A page refused for an older publication comes read again at the new one, with that
  // publication's cursors up to it (readFixturePage, `restarted`): the list takes them
  // without a word, and shows that page without reading it a third time.
  useEffect(() => {
    if (!body?.pagination) return;
    if (body.restarted && paging.page !== 0) {
      const attempt = paging.attempt + 1,
        { restarted, cursors, page, ...value } = body;
      primeResource(pageKey(cursors[page], attempt), () =>
        Promise.resolve(value),
      ).catch(() => {});
      setPaging({
        page,
        cursors,
        generation: value.pagination.generation,
        attempt,
      });
      return;
    }
    if (paging.page !== 0 || body.pagination.generation === paging.generation)
      return;
    setPaging((previous) => ({
      ...previous,
      cursors: [null],
      generation: body.pagination.generation,
    }));
  }, [body, paging.page, paging.generation, paging.attempt]);
  // Refused again: the last list stays, with one more try for the reader to ask.
  const again = () => {
    setPaging((previous) => ({ ...previous, attempt: previous.attempt + 1 }));
    void Promise.resolve(f.refreshManifest?.()).catch(() => {});
  };
  const list = (value, page) => (
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
          {favouritesFirstWithinDay(
            value.data.matches,
            (match) => match.date,
            (match) => involvesFavourite(match, favouriteClubs),
          ).map((match) => (
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
          disabled={page === 0}
          onClick={() =>
            setPaging((previous) => ({ ...previous, page: page - 1 }))
          }
        >
          Précédents
        </button>
        <span aria-live="polite">Page {page + 1}</span>
        <button
          className="button button-secondary"
          disabled={!value.pagination.nextCursor}
          onClick={() =>
            setPaging((previous) => ({
              ...previous,
              page: page + 1,
              cursors: [
                ...previous.cursors.slice(0, page + 1),
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
  );
  return (
    <AsyncState resource={resource}>
      {(value) =>
        value.publicationUnsettled ? (
          <>
            <p role="status" className="notice">
              {!shown.current && PUBLICATION_UNAVAILABLE}{" "}
              <button className="button button-secondary" onClick={again}>
                Actualiser
              </button>
            </p>
            {shown.current && list(shown.current.value, shown.current.page)}
          </>
        ) : (
          list(value, value.restarted ? value.page : paging.page)
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
