"use client";
import React, {
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Icon from "./Icon.jsx";
import { Media } from "./UI.jsx";
import { FootballContext } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import {
  buildSearchIndex,
  searchIndex,
  globalCompetitionCatalog,
  searchedEdition,
  SEARCH_LABELS,
} from "../services/global-search.js";
import { json, useResource } from "../services/resources.js";
import { dataUrl } from "../data-url.js";

const PAGES = {
  players: "/joueurs/",
  clubs: "/clubs/",
  competitions: "/competitions/",
};
const EMPTY_DATA = { appearances: [], matches: [] };
const EMPTY_COMPETITIONS = [];

/**
 * Navbar search. The typed text lives only in this component: no URL write
 * and no app-wide render per keystroke. Results follow in a deferred render
 * from an index built once per season over every competition, independent of
 * the competitions the pages are filtered on.
 */
export default function GlobalSearch() {
  const f = useContext(FootballContext),
    id = useId(),
    inputRef = useRef(null),
    rootRef = useRef(null),
    panelRef = useRef(null);
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [armed, setArmed] = useState(false),
    [active, setActive] = useState(0),
    [source, setSource] = useState(null);
  const deferred = useDeferredValue(query);
  const season = f?.season;
  const legacyCups = useResource(
    "supplemental-cup-index",
    () => json(dataUrl("raw/supplemental-index.json")),
    armed,
  );
  const workerCups = useResource(
    "cup-worker-index",
    () => json(dataUrl("raw/cup-worker/index.json")),
    armed,
  );
  // The whole season is loaded on first use (shared with the pages when they
  // already show every competition).
  useEffect(() => {
    if (!armed || !f?.searchData || (source && source.season === season))
      return;
    let active = true;
    f.searchData()
      .then((value) => active && setSource({ season, data: value }))
      .catch(() => active && setSource({ season, data: f.data }));
    return () => {
      active = false;
    };
  }, [armed, season, source?.season]);
  const data = source && source.season === season ? source.data : null;
  const baseCompetitions = f?.allCatalog?.length
    ? f.allCatalog
    : f?.allCompetitions?.length
      ? f.allCompetitions
      : f?.competitions || EMPTY_COMPETITIONS;
  const supplemental = workerCups.value?.competitions?.length
    ? workerCups.value
    : legacyCups.value;
  const competitions = useMemo(
    () =>
      globalCompetitionCatalog(
        baseCompetitions,
        supplemental,
        workerCups.value?.native,
      ),
    [baseCompetitions, supplemental, workerCups.value?.native],
  );
  const index = useMemo(
    () => (armed ? buildSearchIndex(data || EMPTY_DATA, competitions) : null),
    [armed, data, competitions],
  );
  const results = useMemo(
    () => searchIndex(index, deferred),
    [index, deferred],
  );
  const options = useMemo(
    () => results.order.flatMap((kind) => results[kind] || []),
    [results],
  );
  const stale = deferred !== query;
  const href = (item) =>
    f?.href
      ? f.href(PAGES[item.kind], {
          id: item.id,
          q: "",
          league: "",
          ...(item.kind === "players" ? { playerView: "" } : {}),
          ...(item.kind === "competitions"
            ? { edition: searchedEdition(item, query) }
            : {}),
          // A result outside the Top 7 + UEFA scope opens with every competition.
          ...(f.focus === "europe" && item.outside ? { focus: "all" } : {}),
        })
      : `${PAGES[item.kind]}?id=${encodeURIComponent(item.id)}`;
  const allPlayers = () =>
    f?.href
      ? f.href("/joueurs/", {
          id: "",
          q: query.trim(),
          playersView: "table",
          league: "",
          focus: "all",
        })
      : `/joueurs/?q=${encodeURIComponent(query.trim())}`;

  useEffect(() => setActive(0), [results]);
  // "/" or Ctrl/⌘+K focuses the search from anywhere outside a field.
  useEffect(() => {
    const onKey = (event) => {
      const target = event.target,
        typing =
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (
        (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // Results are real links: Enter follows the highlighted one.
  function close() {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }
  const follow = (selector) =>
    panelRef.current?.querySelector(selector)?.click();
  function onKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((value) =>
        event.key === "ArrowDown"
          ? (value + 1) % options.length
          : (value - 1 + options.length) % options.length,
      );
    } else if (event.key === "Enter") {
      // Enter acts on the results shown for the text actually typed.
      if (stale) return;
      event.preventDefault();
      if (options[active]) follow(`#${CSS.escape(`${id}-option-${active}`)}`);
      else follow(".global-search-all");
    } else if (event.key === "Escape") {
      if (open && query) setOpen(false);
      else {
        setQuery("");
        inputRef.current?.blur();
      }
    }
  }

  const show = open && query.trim().length >= 2;
  const listId = `${id}-results`;
  let position = -1;
  return (
    <div
      className={`global-search${show ? " is-open" : ""}`}
      ref={rootRef}
      onPointerEnter={() => setArmed(true)}
    >
      <div className="global-search-field">
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Rechercher un joueur, un club ou une compétition"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            show && options[active] ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          spellCheck="false"
          placeholder="Rechercher un joueur, un club…"
          value={query}
          onFocus={() => {
            setArmed(true);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="global-search-clear"
            aria-label="Effacer la recherche"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        ) : (
          <kbd className="global-search-hint" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      {show && (
        <div
          ref={panelRef}
          className={`global-search-panel${stale ? " is-stale" : ""}`}
          id={listId}
          role="listbox"
          aria-label="Résultats de recherche"
        >
          {!data && !results.total ? (
            <p className="global-search-note" role="status">
              Chargement des données…
            </p>
          ) : (
            <>
              {results.order.map((kind) =>
                results[kind]?.length ? (
                  <div
                    className="global-search-group"
                    role="group"
                    aria-label={SEARCH_LABELS[kind]}
                    key={kind}
                  >
                    <p className="global-search-heading" aria-hidden="true">
                      {SEARCH_LABELS[kind]}
                      {results[`${kind}Count`] > results[kind].length && (
                        <span>{number(results[`${kind}Count`])}</span>
                      )}
                    </p>
                    {results[kind].map((item) => {
                      position++;
                      const index = position;
                      return (
                        <Link
                          key={item.id}
                          id={`${id}-option-${index}`}
                          role="option"
                          aria-selected={index === active}
                          className="global-search-option"
                          href={href(item)}
                          prefetch={false}
                          onPointerDown={(event) => event.preventDefault()}
                          onPointerMove={() => setActive(index)}
                          onClick={close}
                        >
                          <Media
                            name={item.name}
                            url={item.imageUrl}
                            className={
                              kind === "players" ? "player-avatar" : "crest"
                            }
                          />
                          <span className="global-search-copy">
                            <strong>{item.name}</strong>
                            {item.meta && <span>{item.meta}</span>}
                          </span>
                          <Icon name="arrow" />
                        </Link>
                      );
                    })}
                  </div>
                ) : null,
              )}
              {!data && results.total > 0 && (
                <p className="global-search-note" role="status">
                  Recherche des joueurs et clubs…
                </p>
              )}
              {!results.total && (
                <p className="global-search-note" role="status">
                  {stale || !index
                    ? "Recherche…"
                    : `Aucun joueur, club ou compétition pour « ${query.trim()} ».`}
                </p>
              )}
              {results.playersCount > results.players?.length && (
                <Link
                  className="global-search-all"
                  href={allPlayers()}
                  prefetch={false}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={close}
                >
                  Voir les {number(results.playersCount)} joueurs
                  <Icon name="arrow" />
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
