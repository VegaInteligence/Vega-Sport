import React, { useEffect, useMemo, useRef } from "react";
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
import { AsyncState, Card, Empty, Pager } from "./UI.jsx";
import CompetitionOptions from "./CompetitionOptions.jsx";

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
  return (
    <>
      <div className="table-scroll">
        <table className="data-table historical-results archive-results">
          <thead>
            <tr>
              <th>Date</th>
              <th>Compétition</th>
              <th>Équipe 1</th>
              <th>Score</th>
              <th>Équipe 2</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((match) => {
              const open = Boolean(
                match.hasGoals || match.goalCount > 0 || match.goals?.length,
              );
              return (
                <tr
                  key={match.key}
                  className={open ? "archive-row-open" : "archive-row-closed"}
                  data-archive-match={match.key}
                  onClick={open && onOpen ? () => onOpen(match) : undefined}
                >
                  <td>
                    {date(match.date)}
                    {match.dateNote && (
                      <small className="historical-score-note">
                        Date non vérifiée
                      </small>
                    )}
                  </td>
                  <td>{match.competition}</td>
                  <td>{match.team1 || "—"}</td>
                  <td className="archive-score">
                    {open ? (
                      <Link
                        href={matchHref(match)}
                        prefetch={false}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Buts de ${match.team1} – ${match.team2}`}
                      >
                        {scoreText(match.score)}
                      </Link>
                    ) : (
                      scoreText(match.score)
                    )}
                    {match.notes.length > 0 && (
                      <small className="historical-score-note">
                        {match.notes.join(" · ")}
                      </small>
                    )}
                  </td>
                  <td>{match.team2 || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={current} total={pages} onChange={onPage} />
    </>
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
          <Link className="inline-link" href={backHref}>
            ← Retour aux archives
          </Link>
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
  const version = bounded ? displayed.value?.meta?.version : undefined;
  const matchHref = (match) => hrefWith({ m: match.key, av: version });
  if (matchKey)
    return (
      <AsyncState resource={displayed}>
        {(value) => {
          if (bounded && value.data.publicationChanged)
            return (
              <Card title="Archives actualisées">
                <p>
                  La publication a changé. Retrouvez ce match dans la liste
                  actualisée.
                </p>
                <Link
                  className="inline-link"
                  href={hrefWith({ m: null, av: null })}
                >
                  ← Retour aux archives
                </Link>
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
    );
  const competitions = edition ? orderedCompetitions(edition.competitions) : [];
  return (
    <Card title="Archives" className="archive-card">
      <div className="historical-archive-filters">
        <label>
          Saison{" "}
          <select
            aria-label="Saison des archives"
            value={entry.id}
            onChange={(event) =>
              setParams({
                as: event.target.value.replace("/", "-"),
                ac: null,
                ap: null,
                av: null,
              })
            }
          >
            {seasons.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compétition{" "}
          <select
            aria-label="Compétition des archives"
            value={competition}
            disabled={!edition}
            onChange={(event) =>
              setParams({ ac: event.target.value, ap: null, av: null })
            }
          >
            <option value="all">Toutes les compétitions</option>
            <CompetitionOptions competitions={competitions} />
          </select>
        </label>
        <label>
          Équipe ou buteur{" "}
          <input
            type="search"
            aria-label="Rechercher une équipe ou un buteur dans les archives"
            placeholder="Nom d’équipe ou de joueur…"
            value={query}
            maxLength={100}
            onChange={(event) =>
              setParams({ aq: event.target.value, ap: null, av: null })
            }
          />
        </label>
      </div>
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
    </Card>
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
  const indexes = useResource(
    `archive:indexes:${generation}`,
    async ({ signal }) => {
      const [results, goals] = await Promise.all([
        archiveIndex("results", { signal }),
        archiveIndex("goals", { signal }),
      ]);
      return archiveSeasons(results, goals);
    },
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
  return (
    <AsyncState resource={displayedIndexes}>
      {(seasons) => {
        if (!seasons.length) return <Empty>Aucune archive disponible.</Empty>;
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
