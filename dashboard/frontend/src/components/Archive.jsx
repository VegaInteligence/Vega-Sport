import React, { useEffect, useMemo, useRef } from "react";
import BackLink from "./BackLink.jsx";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  archiveIndex,
  archivePage,
  archiveQuery,
  archiveSeason,
  supportsBoundedArchive,
} from "../services/catalog-client.js";
import { useFootball } from "../hooks/FootballContext.jsx";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import {
  archiveRows,
  archiveSeasons,
  buildArchiveSeason,
  teamSimilarity,
} from "../services/archive.js";
import { date } from "../services/format.js";
import { useResource } from "../services/resources.js";
import { orderedCompetitions } from "../services/competition-selector.js";
import { AsyncState, Card, Empty, Pager, Skeleton } from "./UI.jsx";
import { CompetitionPicker } from "./CompetitionPicker.jsx";
import SeasonSelect from "./SeasonSelect.jsx";
import Icon from "./Icon.jsx";

const PAGE_SIZE = 50;

function scoreText([home, away]) {
  return home === null || away === null || home === undefined
    ? "—"
    : `${home} – ${away}`;
}

/** Match list: only matches with goal events link to their sub-page. */
export function ArchiveResults({
  rows,
  page,
  pagination,
  onPage,
  matchHref,
  onOpen,
}) {
  const pages =
      pagination?.pages ?? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    current = pagination?.page ?? Math.min(page, pages),
    visible = pagination
      ? rows
      : rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  if (!rows.length) return <Empty>Aucun match pour cette sélection.</Empty>;
  // § 81: one block a day, one line a match, the score in a pill; no table sliding sideways on a phone.
  const days = [];
  for (const match of visible) {
    const last = days[days.length - 1];
    if (last && last.date === match.date) last.matches.push(match);
    else days.push({ date: match.date, matches: [match] });
  }
  return (
    <>
      <div className="archive-days archive-results">
        {days.map((day, index) => (
          <section key={`${day.date}:${index}`} className="archive-day">
            <h2 className="archive-day-date">{date(day.date)}</h2>
            <div className="archive-day-rows">
              {day.matches.map((match) => {
                const open = Boolean(
                  match.hasGoals || match.goalCount > 0 || match.goals?.length,
                );
                const score = (
                  <b className="archive-line-score-pill">
                    {scoreText(match.score)}
                  </b>
                );
                return (
                  <div
                    key={match.key}
                    className={
                      "archive-line " +
                      (open ? "archive-row-open" : "archive-row-closed")
                    }
                    data-archive-match={match.key}
                    onClick={open && onOpen ? () => onOpen(match) : undefined}
                  >
                    <span className="archive-line-competition">
                      {match.competition}
                      {match.dateNote && (
                        <small className="historical-score-note">
                          Date non vérifiée
                        </small>
                      )}
                    </span>
                    <span className="archive-line-team archive-line-home">
                      {match.team1 || "—"}
                    </span>
                    <span className="archive-line-score archive-score">
                      {open ? (
                        <Link
                          href={matchHref(match)}
                          prefetch={false}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Buts de ${match.team1} – ${match.team2}`}
                        >
                          {score}
                        </Link>
                      ) : (
                        score
                      )}
                      {match.notes.length > 0 && (
                        <small className="historical-score-note">
                          {match.notes.join(" · ")}
                        </small>
                      )}
                    </span>
                    <span className="archive-line-team archive-line-away">
                      {match.team2 || "—"}
                    </span>
                    <span className="archive-line-go" aria-hidden="true">
                      {open ? "›" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <Pager page={current} total={pages} onChange={onPage} />
    </>
  );
}

/** The page's title, with the archives' bar on its right (§ 81, piste B). */
export function ArchiveHeading({ children }) {
  return (
    <div className="page-heading archive-heading">
      <div className="page-heading-copy">
        <h1 className="page-title">Archives</h1>
      </div>
      {children}
    </div>
  );
}

function goalSide(match, goal) {
  const home = teamSimilarity(goal.team, match.team1),
    away = teamSimilarity(goal.team, match.team2);
  if (home > away) return "home";
  if (away > home) return "away";
  return "unknown";
}

/** Sub-page: the goals of one archived match. */
export function ArchiveMatchDetail({ match, backHref }) {
  return (
    <Card
      className="archive-match"
      title={
        <span className="archive-match-title">
          <span>{match.competition}</span>
          <small>
            {date(match.date)}
            {match.round ? ` · ${match.round}` : ""}
          </small>
        </span>
      }
      action={
        backHref && (
          <BackLink
            className="inline-link"
            href={backHref}
            label="Retour aux archives"
          />
        )
      }
    >
      <div className="archive-scoreboard">
        <strong className="archive-team archive-team-home">
          {match.team1}
        </strong>
        <span className="archive-scoreboard-score">
          {scoreText(match.score)}
        </span>
        <strong className="archive-team archive-team-away">
          {match.team2}
        </strong>
      </div>
      {match.notes.length > 0 && (
        <p className="archive-match-notes">{match.notes.join(" · ")}</p>
      )}
      <ol className="archive-goals">
        {match.goals.map((goal, index) => {
          const side = goalSide(match, goal);
          return (
            <li key={index} className={`archive-goal archive-goal-${side}`}>
              <span className="archive-goal-minute">
                {goal.minute ? `${goal.minute}′` : "—"}
              </span>
              <span className="archive-goal-copy">
                <strong>{goal.player || "Buteur inconnu"}</strong>
                <small>{goal.team || "—"}</small>
              </span>
              <span className="archive-goal-score">
                {goal.score?.join(" – ") || "—"}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function SeasonArchive({
  seasons,
  entry,
  params,
  setParams,
  hrefWith,
  bounded,
  generation,
  indexState,
}) {
  const competition = params.get("ac") || "all";
  const query = params.get("aq") || "";
  const settledQuery = useDebouncedValue(query.trim());
  const searchPending = query.trim() !== settledQuery;
  const page = Math.max(1, Number(params.get("ap")) || 1);
  const matchKey = params.get("m");
  const router = useRouter();
  const readParams = {
    season: entry.id,
    ...(matchKey
      ? { match: matchKey }
      : { competition, q: settledQuery, page, limit: PAGE_SIZE }),
    version: params.get("av") || undefined,
  };
  const scope = bounded ? archiveQuery(readParams) : entry.id;
  const resource = useResource(
    `archive:${bounded ? "read" : "season"}:${generation}:${scope}`,
    async ({ signal }) => {
      if (bounded) {
        try {
          return await archivePage(readParams, { signal });
        } catch (error) {
          if (matchKey && error.status === 409)
            return { data: { publicationChanged: true } };
          if (matchKey && error.status === 404)
            return { data: { match: null } };
          throw error;
        }
      }
      const [results, goals] = await Promise.all([
        entry.results ? archiveSeason("results", entry.id, { signal }) : null,
        entry.goals ? archiveSeason("goals", entry.id, { signal }) : null,
      ]);
      return buildArchiveSeason(results, goals);
    },
    !bounded || Boolean(matchKey) || !searchPending,
  );
  // A new publication can refresh the same page without erasing its last
  // complete result. Different filters/pages never inherit each other's rows.
  const previous = useRef(null);
  useEffect(() => {
    if (resource.value) previous.current = { scope, value: resource.value };
  }, [resource.value, scope]);
  const displayed =
    !resource.value && previous.current?.scope === scope
      ? {
          ...resource,
          value: previous.current.value,
          loading: false,
          refreshing: resource.loading,
          refreshError: resource.error,
          error: undefined,
        }
      : resource;
  const edition = bounded ? displayed.value?.data : displayed.value;
  // These facets describe the whole edition, independently of search and pagination.
  const facetVersion = readParams.version || generation;
  const lastFacets = useRef(null);
  useEffect(() => {
    if (edition?.competitions)
      lastFacets.current = {
        version: facetVersion,
        competitions: edition.competitions,
      };
  }, [edition?.competitions, facetVersion]);
  const facets =
    edition?.competitions ||
    (lastFacets.current?.version === facetVersion
      ? lastFacets.current?.competitions
      : undefined);
  const version = bounded ? displayed.value?.meta?.version : undefined;
  const matchHref = (match) => hrefWith({ m: match.key, av: version });
  if (matchKey)
    return (
      <>
        <ArchiveHeading />
        <AsyncState resource={displayed}>
          {(value) => {
            if (bounded && value.data.publicationChanged)
              return (
                <Card title="Archives actualisées">
                  <p>Retrouvez ce match dans la liste des archives.</p>
                  <BackLink
                    className="inline-link"
                    href={hrefWith({ m: null, av: null })}
                    label="Retour aux archives"
                  />
                </Card>
              );
            const match = bounded
              ? value.data.match
              : value.matches.find((item) => item.key === matchKey);
            return match?.goals?.length ? (
              <ArchiveMatchDetail
                match={match}
                backHref={hrefWith({ m: null })}
              />
            ) : (
              <Card title="Match introuvable">
                <Empty>Aucun but archivé pour ce match.</Empty>
                <Link className="inline-link" href={hrefWith({ m: null })}>
                  ← Retour aux archives
                </Link>
              </Card>
            );
          }}
        </AsyncState>
      </>
    );
  const competitions = facets ? orderedCompetitions(facets) : [];
  return (
    <>
      <ArchiveHeading>
        <div className="archive-tools">
          <div className="home-settings archive-bar">
            <SeasonSelect
              bare
              label="Saison des archives"
              value={entry.id}
              seasons={seasons.map(({ id }) => id)}
              disabled={Boolean(indexState && !indexState.value)}
              onChange={(season) =>
                setParams({
                  as: season.replace("/", "-"),
                  ac: null,
                  ap: null,
                  av: null,
                })
              }
            />
            <CompetitionPicker
              bare
              label="Compétition des archives"
              value={competition}
              competitions={competitions}
              disabled={!facets}
              onChange={(id) => setParams({ ac: id, ap: null, av: null })}
            />
          </div>
          <label className="home-settings-search archive-search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Rechercher une équipe ou un buteur dans les archives"
              placeholder="Équipe ou buteur…"
              value={query}
              maxLength={100}
              onChange={(event) =>
                setParams({ aq: event.target.value, ap: null, av: null })
              }
            />
          </label>
        </div>
      </ArchiveHeading>
      <div className="archive-card">
        {indexState?.error && (
          <p role="status" className="notice notice-warning">
            La liste des saisons est indisponible.{" "}
            <button onClick={indexState.retry}>Réessayer</button>
          </p>
        )}
        <div
          aria-busy={searchPending || displayed.refreshing || displayed.loading}
        >
          <AsyncState resource={displayed}>
            {(value) =>
              bounded ? (
                <ArchiveResults
                  rows={value.data.matches}
                  pagination={value.pagination}
                  page={page}
                  onPage={(next) =>
                    setParams({
                      ap: next > 1 ? String(next) : null,
                      av: value.meta.version,
                    })
                  }
                  matchHref={matchHref}
                  onOpen={(match) =>
                    router.push(matchHref(match), { scroll: true })
                  }
                />
              ) : (
                <SeasonList
                  season={value}
                  competition={competition}
                  query={settledQuery}
                  page={page}
                  setParams={setParams}
                  matchHref={matchHref}
                  onOpen={(match) =>
                    router.push(matchHref(match), { scroll: true })
                  }
                />
              )
            }
          </AsyncState>
        </div>
      </div>
    </>
  );
}

function SeasonList({
  season,
  competition,
  query,
  page,
  setParams,
  matchHref,
  onOpen,
}) {
  const rows = useMemo(
    () => archiveRows(season, competition, query),
    [season, competition, query],
  );
  return (
    <ArchiveResults
      rows={rows}
      page={page}
      onPage={(next) => setParams({ ap: next > 1 ? String(next) : null })}
      matchHref={matchHref}
      onOpen={onOpen}
    />
  );
}

export default function Archive() {
  const f = useFootball();
  const pathname = usePathname();
  const params = useSearchParams();
  const generation =
    f?.manifest?.publicationVersion ||
    f?.manifest?.scouting?.sourceDigest ||
    "";
  const bounded = supportsBoundedArchive(f?.manifest);
  const requestedEdition = (params.get("as") || "").replace("-", "/");
  const directEdition = bounded && /^\d{4}(?:\/\d{4})?$/.test(requestedEdition);
  const indexes = useResource(
    `archive:indexes:${generation}`,
    async ({ signal }) => {
      const [results, goals] = await Promise.all([
        archiveIndex("results", { signal }),
        archiveIndex("goals", { signal }),
      ]);
      return archiveSeasons(results, goals);
    },
    // An explicit match detail has no season selector. Its publication-pinned
    // detail read already identifies the edition and needs no catalogue boot.
    !(directEdition && params.get("m")),
  );
  const previousIndexes = useRef(null);
  useEffect(() => {
    if (indexes.value) previousIndexes.current = indexes.value;
  }, [indexes.value]);
  const displayedIndexes =
    !indexes.value && previousIndexes.current
      ? {
          ...indexes,
          value: previousIndexes.current,
          loading: false,
          error: undefined,
        }
      : indexes;
  const hrefWith = (changes) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes))
      if (value === null || value === undefined || value === "")
        next.delete(key);
      else next.set(key, value);
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  };
  // These filters are entirely client-owned. The supported History API keeps
  // useSearchParams in sync without fetching an RSC route on every keystroke.
  const setParams = (changes) =>
    window.history.replaceState(null, "", hrefWith(changes));
  if (directEdition) {
    const available = displayedIndexes.value || [];
    const known = available.find((item) => item.id === requestedEdition);
    const entry = known || { id: requestedEdition };
    // The bounded reader resolves existence and freshness itself. Start it in
    // parallel with selector metadata; a slow/failed index must not block a
    // directly linked edition or silently redirect it to another season.
    return (
      <SeasonArchive
        key={entry.id}
        seasons={known ? available : [entry, ...available]}
        entry={entry}
        params={params}
        setParams={setParams}
        hrefWith={hrefWith}
        bounded={bounded}
        generation={generation}
        indexState={displayedIndexes}
      />
    );
  }
  return (
    <AsyncState
      resource={displayedIndexes}
      loading={
        <>
          <ArchiveHeading />
          <Skeleton />
        </>
      }
    >
      {(seasons) => {
        if (!seasons.length)
          return (
            <>
              <ArchiveHeading />
              <Empty>Aucune archive disponible.</Empty>
            </>
          );
        const id = (params.get("as") || "").replace("-", "/");
        const entry = seasons.find((item) => item.id === id) || seasons[0];
        return (
          <SeasonArchive
            key={entry.id}
            seasons={seasons}
            entry={entry}
            params={params}
            setParams={setParams}
            hrefWith={hrefWith}
            bounded={bounded}
            generation={generation}
          />
        );
      }}
    </AsyncState>
  );
}
