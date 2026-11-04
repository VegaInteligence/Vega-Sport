import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { archiveIndex, archiveSeason } from "../services/catalog-client.js";
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
export function ArchiveResults({ rows, page, onPage, matchHref, onOpen }) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    current = Math.min(page, pages);
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
            {rows
              .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
              .map((match) => {
                const open = Boolean(match.goals?.length);
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

function SeasonArchive({ seasons, entry, params, setParams, hrefWith }) {
  const competition = params.get("ac") || "all";
  const query = params.get("aq") || "";
  const page = Math.max(1, Number(params.get("ap")) || 1);
  const matchKey = params.get("m");
  const router = useRouter();
  const resource = useResource(`archive:season:${entry.id}`, async () => {
    const [results, goals] = await Promise.all([
      entry.results ? archiveSeason("results",entry.id) : null,
      entry.goals ? archiveSeason("goals",entry.id) : null,
    ]);
    return buildArchiveSeason(results, goals);
  });
  const matchHref = (match) => hrefWith({ m: match.key });
  if (matchKey)
    return (
      <AsyncState resource={resource}>
        {(season) => {
          const match = season.matches.find((item) => item.key === matchKey);
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
  const competitions = resource.value
    ? orderedCompetitions(resource.value.competitions)
    : [];
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
            disabled={!resource.value}
            onChange={(event) =>
              setParams({ ac: event.target.value, ap: null })
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
            defaultValue={query}
            onChange={(event) =>
              setParams({ aq: event.target.value, ap: null })
            }
          />
        </label>
      </div>
      <AsyncState resource={resource}>
        {(season) => (
          <SeasonList
            season={season}
            competition={competition}
            query={query}
            page={page}
            setParams={setParams}
            matchHref={matchHref}
            onOpen={(match) => router.push(matchHref(match), { scroll: true })}
          />
        )}
      </AsyncState>
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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const indexes = useResource("archive:indexes", async () => {
    const [results, goals] = await Promise.all([
      archiveIndex("results"),
      archiveIndex("goals"),
    ]);
    return archiveSeasons(results, goals);
  });
  const hrefWith = (changes) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes))
      if (value === null || value === undefined || value === "")
        next.delete(key);
      else next.set(key, value);
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  };
  const setParams = (changes) =>
    router.replace(hrefWith(changes), { scroll: false });
  return (
    <AsyncState resource={indexes}>
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
          />
        );
      }}
    </AsyncState>
  );
}
