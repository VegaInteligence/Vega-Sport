"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { Empty, Pager } from "./UI.jsx";
import { MatchLink } from "./MatchLink.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { json, useResource } from "../services/resources.js";
import {
  defaultMatchday,
  matchdayGroups,
  nearestUntried,
} from "../services/competition-matchdays.js";

async function fetchRounds(client, competition, season, candidates) {
  const found = {};
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const match = candidates[cursor++];
        try {
          const detail = (
            await client.request(`matches/${encodeURIComponent(match.id)}`)
          ).data;
          const name = detail?.round_name;
          if (
            detail?.id === match.id &&
            detail?.league?.id === competition &&
            String(detail?.season) === String(season) &&
            (typeof name === "string" || typeof name === "number") &&
            String(name).trim()
          ) {
            found[match.id] = {
              name: String(name).trim(),
              playoff: detail.has_playoff === true,
            };
          }
        } catch {
          // A missing detail leaves the match accessible in the unlabelled list.
        }
      }
    }),
  );
  return found;
}

export default function MatchdaySchedule({
  competition,
  season,
  matches,
  initialStatus = "finished",
}) {
  const f = useFootball();
  const [selection, setSelection] = useState(null);
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState({});
  const [triedExtra, setTriedExtra] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const automaticStarted = useRef(false);
  const resource = useResource(
    `matchdays:${competition.id}:${season}:${f.manifest?.publicationVersion || f.manifest?.scouting?.sourceDigest || ""}`,
    async ({ signal }) => {
      const url = `/api/matchdays?competition=${encodeURIComponent(competition.id)}&season=${encodeURIComponent(season)}`;
      const archived =
        (
          await json(url, { signal }).catch((error) => {
            if (error.name === "AbortError") throw error;
            return { matches: {} };
          })
        ).matches || {};
      return { rounds: archived };
    },
    Boolean(competition.id && season),
  );
  useEffect(() => {
    if (
      f.manifest?.storage === "aws-relational" ||
      !resource.value ||
      !f.client.configured ||
      automaticStarted.current
    )
      return;
    // Published round metadata already describes the collected fixtures.
    // Missing labels must not trigger 24 match-detail requests on each visit.
    automaticStarted.current = true;
    const archived = resource.value.rounds;
    let missing = nearestUntried(
      matches,
      new Set(Object.keys(archived)),
      Date.now(),
      Object.keys(archived).length ? 12 : 24,
    );
    if (Object.keys(archived).length) {
      missing = missing.filter((match) => {
        const time = Date.parse(match.time_utc || match.timeUtc || match.date);
        return (
          Number.isFinite(time) && Math.abs(time - Date.now()) <= 10 * 86400000
        );
      });
    }
    if (!missing.length) return;
    setLoadingMore(true);
    fetchRounds(f.client, competition.id, season, missing).then((found) => {
      setExtra((previous) => ({ ...previous, ...found }));
      setTriedExtra((previous) => [
        ...previous,
        ...missing.map((match) => match.id),
      ]);
      setLoadingMore(false);
    });
  }, [resource.value, f.client, competition.id, season, matches]);
  const rounds = useMemo(
    () => ({ ...(resource.value?.rounds || {}), ...extra }),
    [resource.value, extra],
  );
  const groups = useMemo(
    () => matchdayGroups(matches, rounds),
    [matches, rounds],
  );
  const selected =
    groups.find((group) => group.key === selection) ||
    groups.find(
      (group) => group.key === defaultMatchday(groups, initialStatus),
    );
  const position = groups.findIndex((group) => group.key === selected?.key);
  const tried = new Set([...Object.keys(rounds), ...triedExtra]);
  const remaining = nearestUntried(matches, tried);
  const pages = Math.max(1, Math.ceil((selected?.matches.length || 0) / 30));
  const current = Math.min(page, pages);

  async function loadMore() {
    if (loadingMore || !remaining.length) return;
    setLoadingMore(true);
    const found = await fetchRounds(
      f.client,
      competition.id,
      season,
      remaining,
    );
    setExtra((previous) => ({ ...previous, ...found }));
    setTriedExtra((previous) => [
      ...previous,
      ...remaining.map((match) => match.id),
    ]);
    setLoadingMore(false);
  }
  function choose(key) {
    setSelection(key);
    setPage(1);
  }

  if (!matches.length)
    return <Empty>Aucune rencontre collectée pour cette saison.</Empty>;
  if (!selected)
    return <Empty>Aucune rencontre collectée pour cette saison.</Empty>;
  const finished = selected.matches.filter(
    (match) => match.status === "finished" || match.finished === true,
  ).length;
  const upcoming = selected.matches.filter(
    (match) => match.status === "not_started" || match.finished === false,
  ).length;
  return (
    <section className="matchday-schedule" aria-label="Matchs par journée">
      {resource.loading && (
        <p role="status" className="matchday-note">
          Chargement des journées…
        </p>
      )}
      <div className="matchday-toolbar">
        <div className="matchday-heading">
          <span className="matchday-eyebrow">
            {selected.key === "unknown"
              ? "Autres rencontres"
              : "Calendrier de la compétition"}
          </span>
          <h3 aria-live="polite">{selected.label}</h3>
          <p>
            {selected.matches.length} match
            {selected.matches.length > 1 ? "s" : ""} · {finished} résultat
            {finished > 1 ? "s" : ""}
            {upcoming ? ` · ${upcoming} à venir` : ""} · Heure de Paris
          </p>
        </div>
        <nav
          className="matchday-navigation"
          aria-label="Navigation entre les journées"
        >
          <button
            type="button"
            className="button button-secondary matchday-arrow"
            aria-label="Journée précédente"
            disabled={position <= 0}
            onClick={() => choose(groups[position - 1].key)}
          >
            <Icon name="back" />
          </button>
          <label className="sr-only" htmlFor="matchday-choice">
            Choisir une journée
          </label>
          <select
            id="matchday-choice"
            value={selected.key}
            onChange={(event) => choose(event.target.value)}
          >
            {groups.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-secondary matchday-arrow"
            aria-label="Journée suivante"
            disabled={position >= groups.length - 1}
            onClick={() => choose(groups[position + 1].key)}
          >
            <Icon name="arrow" />
          </button>
        </nav>
      </div>
      {selected.matches.some((match) => match.fixtureIdentityUncertain) && (
        <p className="matchday-note">
          Certaines rencontres apparaissent plusieurs fois dans la source ; leur
          fiche et leur horaire restent à confirmer.
        </p>
      )}
      {selected.key === "unknown" && (
        <p className="matchday-note">
          {loadingMore
            ? "Recherche des journées en cours…"
            : "La journée de ces rencontres n’est pas précisée. Elles restent accessibles par date."}
        </p>
      )}
      {selected.matches.slice((current - 1) * 30, current * 30).map((match) => (
        <MatchLink key={match.id} match={match} showKickoff />
      ))}
      <Pager
        page={current}
        total={pages}
        onChange={setPage}
        label="Pagination des matchs de la journée"
      />
      {selected.key === "unknown" &&
        remaining.length > 0 &&
        f.client.configured && (
          <button
            className="button button-secondary matchday-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? "Recherche des journées…"
              : "Rechercher d’autres journées"}
          </button>
        )}
    </section>
  );
}
