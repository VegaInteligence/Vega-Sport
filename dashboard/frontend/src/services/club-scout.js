"use client";
/**
 * Club profile: real published data, read once per club and generation.
 *
 * The club is read with its shots and appearances; its domestic league's
 * matches are read once (club by club on an API without that read) so every
 * team indicator below can be ranked against the same twenty clubs. Nothing
 * here is fictitious: values
 * the API does not publish (squad value, age profile) live in the pages and
 * wear a « Données fictives » badge.
 */
import { gameStates } from "./club-game-states.js";
import { useEffect, useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  compactGeneration,
  compactScope,
  readCompact,
  readCompactPages,
  supportsCompactRead,
} from "./compact-reads.js";
import { apiUrl } from "../data-url.js";
import { EUROPE_FOCUS } from "../../../shared/competition-scope.js";
import { publicApiFetch } from "./public-api-fetch.js";
import {
  clubCompetitions,
  clubMatchIndex,
  clubSquad,
  clubSummary,
  formationRecords,
  seasonCoverage,
  upcomingClubMatches,
} from "./club-analysis.js";

const INTERNATIONAL = new Set(["INT", "INT-2", "UEFA", "FIFA", "EUR", "WORLD"]);

/* ------------------------------------------------------------------ load */

const cache = new Map();
function merge(pages) {
  const out = {};
  for (const name of [
    "matches",
    "fixtures",
    "appearances",
    "teams",
    "competitions",
  ])
    out[name] = [
      ...new Map(
        pages.flatMap((page) => page[name] || []).map((row) => [row.id, row]),
      ).values(),
    ];
  return out;
}
async function readActor(params, signal) {
  const result = await readCompactPages("club", params, {
    signal,
    parallelPages: true,
  });
  return merge(result.pages);
}
async function pool(items, size, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await task(items[index], index);
      }
    }),
  );
  return out;
}

/** Cached read shared by every mount: a remount joins it, never restarts it. */
function cachedLoad(key, loader) {
  let entry = cache.get(key);
  if (!entry) {
    entry = { listeners: new Set(), progress: null };
    entry.promise = loader((progress) => {
      entry.progress = progress;
      entry.listeners.forEach((listener) => listener(progress));
    }).then(
      (value) => {
        entry.value = value;
        return value;
      },
      (error) => {
        cache.delete(key);
        throw error;
      },
    );
    cache.set(key, entry);
  }
  return entry;
}

/**
 * One league, every club read with the same indicators: positions, centiles,
 * ranks and Vega indices are computed once per league and shared.
 *
 * `whole`: the API reads a league's matches in one read (/api/read/league). Each
 * club's rows are taken from them, where each club was read on its own: twenty
 * reads of the same matches, each match twice.
 */
export function leagueCohort(
  league,
  { season, generation, whole = false, played = false, versioned = {} },
  onProgress,
) {
  return cachedLoad(
    `${generation}|${season}|league:${league.id}`,
    async (progress) => {
      const [cohort, matches] = await Promise.all([
        // The league's clubs by name and crest: their analysis is not read here (the
        // cohort is built from the matches), and it was the slowest read of the page.
        readCompactPages(
          "clubs",
          {
            season,
            leagues: compactScope([league.id]),
            generation,
            limit: 100,
          },
          {},
        ),
        whole
          ? readCompactPages(
              "league",
              {
                season,
                league: league.id,
                detail: "summary",
                // The cohort ranks on finished matches (teamRows): they are asked alone
                // when the API can, without the matches to come.
                ...(played ? { played: 1 } : {}),
                // Named by the publication, the league's matches were read again every
                // five minutes. Where the API validates them by their own version, the
                // request names none: whoever holds them is told they are unchanged.
                ...(versioned.league ? {} : { generation }),
                limit: 100,
              },
              { parallelPages: true },
            ).then((read) => merge(read.pages))
          : null,
      ]);
      const cohortClubs = cohort.pages.flatMap((page) => page.clubs || []);
      const summaries = new Map();
      let done = 0;
      progress({
        step: "league",
        league: league.name,
        done,
        total: cohortClubs.length,
      });
      if (matches) {
        for (const club of cohortClubs) summaries.set(club.id, matches);
        progress({
          step: "league",
          league: league.name,
          done: cohortClubs.length,
          total: cohortClubs.length,
        });
        return buildCohort({ league, cohortClubs, summaries });
      }
      await pool(cohortClubs, 6, async (club) => {
        const read = await readActor({
          season,
          team: club.id,
          leagues: "all",
          detail: "summary",
          limit: 100,
          generation,
        });
        summaries.set(club.id, read);
        progress({
          step: "league",
          league: league.name,
          done: ++done,
          total: cohortClubs.length,
        });
      });
      return buildCohort({ league, cohortClubs, summaries });
    },
  );
}

/**
 * A club's competitions of the season, and the league it is ranked in: its first
 * domestic competition (the one with most matches played), else its first competition.
 * `data` holds the club's matches and their competitions.
 */
export function clubLeagues(data, id) {
  const competitionById = new Map(
    (data.competitions || []).map((c) => [c.id, c]),
  );
  const competitions = clubCompetitions(data, id).map((c) => ({
    ...c,
    country: competitionById.get(c.id)?.country,
    imageUrl: competitionById.get(c.id)?.imageUrl,
  }));
  return {
    competitions,
    league:
      competitions.find((c) => c.country && !INTERNATIONAL.has(c.country)) ||
      competitions[0],
  };
}

async function loadDossier(
  { id, season, generation, whole, played, versioned },
  onProgress,
) {
  const base = {
    season,
    team: id,
    leagues: "all",
    generation,
    // Validated by the club's own editions where the API does (readCompact).
    ...(versioned?.club ? { versioned: 1 } : {}),
  };
  onProgress({ step: "club", done: 0, total: 1 });
  const [shots, apps] = await Promise.all([
    readActor({ ...base, include: "shots" }),
    readActor({ ...base, include: "appearances" }),
  ]);
  const data = {
    matches: shots.matches,
    fixtures: [...shots.fixtures, ...apps.fixtures],
    appearances: apps.appearances,
    teams: shots.teams,
    competitions: shots.competitions,
  };
  const { competitions, league } = clubLeagues(data, id);
  let cohort = null;
  if (league) {
    const entry = leagueCohort(league, {
      season,
      generation,
      whole,
      played,
      versioned,
    });
    const relay = (progress) => onProgress(progress);
    entry.listeners.add(relay);
    if (entry.progress) onProgress(entry.progress);
    try {
      cohort = await entry.promise;
    } finally {
      entry.listeners.delete(relay);
    }
  }
  return buildDossier({ id, season, data, competitions, league, cohort });
}

// A failed read is tried once more on its own before the error shows; the error
// then offers `retry`. A failed entry has already left the cache (cachedLoad).
function useCachedState(key, start) {
  const [attempt, setAttempt] = useState({ key, count: 0 });
  const tries = attempt.key === key ? attempt.count : 0;
  const [state, setState] = useState(() =>
    key && cache.get(key)?.value
      ? { status: "ready", value: cache.get(key).value }
      : { status: key ? "loading" : "idle", progress: null },
  );
  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    const entry = start();
    if (!entry) return;
    if (entry.value) {
      setState({ status: "ready", value: entry.value });
      return;
    }
    let live = true;
    const listener = (progress) =>
      live && setState({ status: "loading", progress });
    entry.listeners.add(listener);
    setState({ status: "loading", progress: entry.progress });
    entry.promise.then(
      (value) => live && setState({ status: "ready", value }),
      (error) => {
        if (!live) return;
        if (tries === 0) setAttempt({ key, count: 1 });
        else
          setState({ status: "error", error: error?.message || String(error) });
      },
    );
    return () => {
      live = false;
      entry.listeners.delete(listener);
    };
    // `start` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tries]);
  return state.status === "error"
    ? { ...state, retry: () => setAttempt({ key, count: tries + 1 }) }
    : state;
}

/** The publication a context names (its manifest and season): what reads are keyed by. */
const publicationOf = (f) => ({
  generation: compactGeneration(f?.manifest),
  season: f?.season || f?.manifest?.defaultSeason,
  manifest: f?.manifest,
  // A league's matches in one read, when the API serves it (leagueCohort).
  whole: supportsCompactRead(f?.manifest, "league"),
  played: f?.manifest?.capabilities?.playedLeague === true,
  // The reads the API validates by their own version (no publication in their address).
  versioned: f?.manifest?.capabilities?.versionedReads || {},
});
const usePublication = () => publicationOf(useFootball());

/**
 * Whether `data` is the page's read of this club, with match statistics: every match
 * in it is the club's (a page still showing another club's read is not), and one at
 * least carries statistics (a club without any is not ranked).
 */
export function isClubRead(data, clubId) {
  if (!clubId || !data?.matches?.some((match) => match.stats?.length))
    return false;
  const index = clubMatchIndex({ matches: data.matches });
  return (
    index.matches.length > 0 &&
    index.byClub.get(clubId)?.length === index.matches.length
  );
}

const dossierKey = (clubId, { generation, season }) =>
  clubId && generation && season ? `${generation}|${season}|${clubId}` : null;
const dossierLoad = (clubId, key, publication) =>
  cachedLoad(key, (progress) =>
    loadDossier({ ...publication, id: clubId }, progress),
  );

/**
 * What the profile ranks the club against, started as soon as the page holds the club's
 * matches (its summary), which name its league: the league's cohort and the European
 * pool used to start once the club's reads had ended, one after the other. Each is kept
 * by its key: the dossier and the comparison find them started, or read. Nothing is
 * started for a club without match statistics.
 */
function useComparisonStart(clubId, key, publication) {
  const f = useFootball();
  const ready = useMemo(
    () => Boolean(key) && isClubRead(f?.data, clubId),
    [key, f?.data, clubId],
  );
  useEffect(() => {
    if (!ready) return;
    const quiet = (entry) => entry?.promise.catch(() => {});
    const { league } = clubLeagues(f.data, clubId);
    // Both together: the profile's figures wait for the league's cohort and for the European
    // pool, its default reference (ClubScoutProfile).
    if (league) quiet(leagueCohort(league, publication));
    if (europeKey(publication)) quiet(europeLoad(publication));
    // One start per club and publication, once the page's own read of the club is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
}

/**
 * What the page's read of the club (its summary, already in memory) shows before the club's
 * dossier: its name, crest, league, coach, stadium and matches. No rank, centile or index:
 * those need the league's cohort. null when `data` is not this club's read.
 */
export function clubEarly(data, clubId, season) {
  if (!isClubRead(data, clubId)) return null;
  const { league } = clubLeagues(data, clubId);
  const summary = clubSummary(data, clubId);
  const allRows = teamRows(data.matches, clubId);
  const lastRow = allRows[allRows.length - 1];
  const lastHome = [...allRows].reverse().find((row) => row.side === "home");
  return {
    id: clubId,
    season,
    name: summary.name,
    imageUrl: lastRow?.match[lastRow.side]?.imageUrl || summary.imageUrl,
    coach: lastRow?.match[lastRow.side]?.coach || null,
    stadium: lastHome?.match.stadium || null,
    league,
    allRows,
  };
}

/**
 * A club's own reads (shots, appearances), started outside its profile: the data
 * provider calls it with the page's read of the club, before the page is shown. `f`
 * holds the manifest and the season; the profile finds the dossier started.
 */
export function startClubDossier(clubId, f) {
  const publication = publicationOf(f);
  const key = dossierKey(clubId, publication);
  if (key) dossierLoad(clubId, key, publication).promise.catch(() => {});
}

/**
 * What a club is ranked against, started by its page as soon as it holds the club's
 * matches: the profile started it once it had rendered.
 */
export function useClubStart(clubId) {
  const publication = usePublication();
  useComparisonStart(clubId, dossierKey(clubId, publication), publication);
}

/** Whole dossier of one club, cached per generation and season. */
export function useClubDossier(clubId) {
  const publication = usePublication();
  const key = dossierKey(clubId, publication);
  useComparisonStart(clubId, key, publication);
  const state = useCachedState(key, () =>
    dossierLoad(clubId, key, publication),
  );
  return state.status === "ready"
    ? { status: "ready", dossier: state.value }
    : state;
}

/** The season before `season` (« 2025/2026 » before « 2026/2027 », « 2025 » before « 2026 »), or null. */
export function previousSeason(season) {
  const split = /^(\d{4})\/(\d{4})$/.exec(season || "");
  if (split) return `${+split[1] - 1}/${+split[2] - 1}`;
  return /^\d{4}$/.test(season || "") ? String(+season - 1) : null;
}

/**
 * The club's matches of the season before `season`, as rows (teamRows): what completes the rolling
 * means of its first matches. [] when the publication has no such season or it cannot be read;
 * undefined while it is read. One summary read, cached per publication, season and club.
 */
export function usePreviousSeasonRows(clubId, season) {
  const { generation, manifest, versioned } = usePublication();
  const prev = previousSeason(season);
  const key =
    clubId && generation && prev && manifest?.seasons?.some((s) => s.id === prev)
      ? `${generation}|${prev}|previous:${clubId}`
      : null;
  const [state, setState] = useState({ key: null, rows: undefined });
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    cachedLoad(key, () =>
      readActor({
        season: prev,
        team: clubId,
        leagues: "all",
        detail: "summary",
        limit: 100,
        generation,
        ...(versioned?.club ? { versioned: 1 } : {}),
      }).then((data) => teamRows(data.matches, clubId)),
    ).promise.then(
      (rows) => live && setState({ key, rows }),
      () => live && setState({ key, rows: [] }),
    );
    return () => {
      live = false;
    };
    // `prev`, `clubId`, `generation` are derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return [];
  return state.key === key ? state.rows : undefined;
}

/** Any league's cohort, for similar clubs searched in another competition. */
export function useLeagueCohort(league) {
  const publication = usePublication();
  const { generation, season } = publication;
  const key =
    league?.id && generation && season
      ? `${generation}|${season}|league:${league.id}`
      : null;
  return useCachedState(key, () => leagueCohort(league, publication));
}

/** Several leagues read one after the other, progress summed across them. */
function referentialLoad(leagues, publication) {
  const ids = leagues.map((league) => league.id).sort();
  const key = `${publication.generation}|${publication.season}|ref:${ids.join(",")}`;
  return cachedLoad(key, async (progress) => {
    const done = [];
    for (const league of leagues) {
      const entry = leagueCohort(league, publication);
      const relay = (p) =>
        progress({
          ...p,
          league:
            leagues.length > 1
              ? `${league.name} (${done.length + 1}/${leagues.length})`
              : league.name,
        });
      entry.listeners.add(relay);
      if (entry.progress && !entry.value) relay(entry.progress);
      try {
        done.push(await entry.promise);
      } finally {
        entry.listeners.delete(relay);
      }
    }
    return done;
  });
}

/** Cohorts of a user-chosen referential (null: the club's own league). */
export function useReferential(leagues) {
  const publication = usePublication();
  const { generation, season } = publication;
  const key =
    leagues?.length && generation && season
      ? `${generation}|${season}|ref:${leagues
          .map((league) => league.id)
          .sort()
          .join(",")}`
      : null;
  return useCachedState(key, () => referentialLoad(leagues, publication));
}

/* ----------------------------------------------------------- Europe */

/**
 * The European pool: every club of the Top 7 leagues, their finished league
 * and UEFA matches with the team statistics ranked here, their five-year UEFA
 * coefficient and their level.
 *
 * It is read from the base: /api/clubs/europe, then /api/clubs/europe/matches
 * for each competition. A club's level is its Elo of the power ranking, fitted
 * on every result, league and European cups alike (docs/calculs/04-clubs/03).
 */
export const LEVEL_PEERS = 30;

async function readEurope(path, params) {
  const response = await publicApiFetch(
    apiUrl(`${path}?${new URLSearchParams(params)}`),
    { headers: { Accept: "application/json" } },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data)
    throw new Error(body?.error?.message || "Pool européen indisponible.");
  return body.data;
}

/**
 * The pool of the base: its head and the matches of each competition, asked together.
 * The head names the competitions, which are the site's European scope: their matches
 * waited for it (0.3 to 0.9 s on 11 November 2026). A competition the head names and
 * the scope does not is read once the head is there.
 *
 * `versioned.europeMatches`: the API validates a competition's matches by their own
 * version, so their request names no publication and whoever holds them is told they
 * are unchanged (named by the publication, they were read again every five minutes).
 */
export async function readEuropePool(
  { season, generation, versioned = {} },
  { competitions = EUROPE_FOCUS } = {},
) {
  const scope = { season, ...(generation ? { generation } : {}) };
  const matchesOf = (id) => {
    const read = readEurope("/api/clubs/europe/matches", {
      ...(versioned.europeMatches ? { season } : scope),
      league: id,
    });
    // Awaited below when the head names the competition; never left unhandled.
    read.catch(() => {});
    return read;
  };
  const headRead = readEurope("/api/clubs/europe", scope);
  const started = new Map(competitions.map(({ id }) => [id, matchesOf(id)]));
  const head = await headRead;
  const parts = await Promise.all(
    [...head.leagues, ...head.uefa].map(
      (league) => started.get(league.id) || matchesOf(league.id),
    ),
  );
  const matches = new Map();
  for (const part of parts) for (const m of part.matches) matches.set(m.id, m);
  return { ...head, matches: [...matches.values()] };
}

function europeKey({ season, generation }) {
  return season && generation ? `${generation}|${season}|europe` : null;
}

/** Cohorts of the pool; `data` is the read of readEuropePool. */
export function buildEuropePool(data) {
  const byClub = new Map();
  for (const m of data.matches)
    for (const id of [m.home.id, m.away.id]) {
      if (!byClub.has(id)) byClub.set(id, []);
      byClub.get(id).push(m);
    }
  const summaries = new Map(
    [...byClub].map(([id, matches]) => [id, { matches }]),
  );
  const uefa = data.uefa.map((c) => c.id);
  const strength = new Map(),
    clubs = [];
  for (const league of data.leagues) {
    const members = data.clubs
      .filter((c) => c.leagueId === league.id)
      .map((c) => ({ ...c, league }));
    // League matches set the level; league + UEFA matches are ranked.
    const domestic = buildCohort({ league, cohortClubs: members, summaries });
    for (const club of domestic.clubs) {
      const member = members.find((m) => m.id === club.id);
      strength.set(club.id, {
        score: member?.level ?? null,
        coefficient: member?.uefaCoefficient ?? null,
        position: club.position,
        xptsPosition: club.xptsPosition,
        league,
      });
    }
    const european = buildCohort({
      league,
      cohortClubs: members,
      summaries,
      scope: new Set([league.id, ...uefa]),
    });
    for (const club of european.clubs) {
      club.strength = strength.get(club.id)?.score ?? null;
      club.leaguePosition = strength.get(club.id)?.position ?? null;
      club.leagueXptsPosition = strength.get(club.id)?.xptsPosition ?? null;
      club.coefficient = strength.get(club.id)?.coefficient ?? null;
    }
    clubs.push(...european.clubs);
  }
  return {
    season: data.season,
    builtAt: data.builtAt,
    clubs,
    strength,
    // Elo of every club ranked in the season, the pool's clubs and the others.
    levels: new Map(Object.entries(data.levels || {})),
  };
}

function europeLoad(publication) {
  const key = europeKey(publication);
  return cachedLoad(key, async () =>
    buildEuropePool(
      await readEuropePool(publication),
    ),
  );
}

/** European pool (Top 7 leagues, league + UEFA matches). */
export function useEuropePool(enabled = true) {
  const publication = usePublication();
  const key = europeKey(publication);
  return useCachedState(enabled ? key : null, () => europeLoad(publication));
}

/**
 * The pool's clubs and their levels, without a match: what "niveau comparable" needs on
 * a player's page (levelPeerClubs). The matches are for the club profile's European
 * ranking: ten more reads, 1.6 MB for the season 2026/2027 on 11 November 2026.
 */
export function buildEuropeLevels(head) {
  const leagues = new Map(head.leagues.map((league) => [league.id, league]));
  const strength = new Map(),
    clubs = [];
  for (const member of head.clubs) {
    const league = leagues.get(member.leagueId);
    if (!league || member.level == null) continue;
    const coefficient = member.uefaCoefficient ?? null;
    strength.set(member.id, { score: member.level, coefficient, league });
    clubs.push({ ...member, league, strength: member.level, coefficient });
  }
  return {
    season: head.season,
    builtAt: head.builtAt,
    clubs,
    strength,
    levels: new Map(Object.entries(head.levels || {})),
  };
}

/** The pool's clubs and levels alone (buildEuropeLevels): one read. */
export function useEuropeLevels(enabled = true) {
  const publication = usePublication();
  const pool = europeKey(publication);
  const key = pool ? `${pool}:levels` : null;
  return useCachedState(enabled ? key : null, () =>
    cachedLoad(key, async () => {
      const { season, generation } = publication;
      return buildEuropeLevels(
        await readEurope("/api/clubs/europe", {
          season,
          ...(generation ? { generation } : {}),
        }),
      );
    }),
  );
}

/** Level of a club of the pool, else its Elo when it is ranked outside the pool. */
function poolLevel(pool, clubId) {
  return pool?.strength.get(clubId)?.score ?? pool?.levels?.get(clubId) ?? null;
}

/** Level of any club ranked in the season, in the pool or not; null without one. */
export function clubStrength(dossier, pool) {
  return poolLevel(pool, dossier.id);
}

/** The LEVEL_PEERS clubs of the pool closest to a level, one club left out. */
function nearestClubs(pool, score, except) {
  return pool.clubs
    .filter((club) => club.id !== except && club.strength != null)
    .sort((a, b) => Math.abs(a.strength - score) - Math.abs(b.strength - score))
    .slice(0, LEVEL_PEERS);
}

/**
 * Club ids of comparable level for a player's club (the club included), or
 * null when the club has no level (outside the pool, and no Elo).
 */
export function levelPeerClubs(pool, clubId) {
  const score = poolLevel(pool, clubId);
  if (score == null) return null;
  const clubs = nearestClubs(pool, score, clubId);
  return {
    ids: new Set([clubId, ...clubs.map((club) => club.id)]),
    clubs,
    leagues: new Set(clubs.map((club) => club.league?.id)).size,
  };
}

/**
 * Dossier ranked against Europe: every club of the pool, or only the
 * LEVEL_PEERS clubs whose level is closest to this one.
 */
export function europeReferential(dossier, pool, { level = false } = {}) {
  const score = clubStrength(dossier, pool);
  const own = pool.clubs.find((club) => club.id === dossier.id);
  let clubs = pool.clubs;
  const byLevel = level && score != null;
  if (byLevel) {
    clubs = nearestClubs(pool, score, dossier.id);
    if (own) clubs = [...clubs, own];
  }
  const levels = clubs.map((club) => club.strength).filter((v) => v != null);
  const view = rebase(
    dossier,
    [{ clubs }],
    byLevel ? "Europe · niveau comparable" : "Top 7 Europe + UEFA",
    {
      perMatch: true,
      multi: true,
      meta: {
        europe: true,
        level: byLevel,
        strength: score,
        range: [Math.min(...levels), Math.max(...levels)],
        leagues: new Set(clubs.map((club) => club.league?.id)).size,
      },
    },
  );
  return view;
}

/** Every competition published for the season, international ones included. */
export function useSeasonCompetitions() {
  const { manifest, season } = usePublication();
  const ids = new Set(
    (manifest?.seasons || [])
      .find((item) => item.id === season)
      ?.chunks?.map((chunk) => chunk.leagueId) || [],
  );
  return (manifest?.competitions || [])
    .filter((c) => ids.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Domestic leagues published for the season, for the competition search. */
export function useSeasonLeagues() {
  const { manifest, season } = usePublication();
  const ids = new Set(
    (manifest?.seasons || [])
      .find((item) => item.id === season)
      ?.chunks?.map((chunk) => chunk.leagueId) || [],
  );
  return (manifest?.competitions || [])
    .filter((c) => ids.has(c.id) && !INTERNATIONAL.has(c.country))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Club search across every competition (published directory read). */
export function useClubSearch() {
  const { generation, season } = usePublication();
  return async (query, signal) => {
    const result = await readCompact(
      "clubs",
      { season, leagues: "all", q: query, page: 1, limit: 8, generation },
      { signal },
    );
    return result.data?.clubs || [];
  };
}

/* --------------------------------------------------------- match reading */

const STATS = {
  xg: "expected_goals",
  npxg: "expected_goals_non_penalty",
  xgOpen: "expected_goals_open_play",
  xgSet: "expected_goals_set_play",
  xgot: "expected_goals_on_target",
  shots: "total_shots",
  sot: "ShotsOnTarget",
  shotsIn: "shots_inside_box",
  shotsOut: "shots_outside_box",
  bigChances: "big_chance",
  bigMissed: "big_chance_missed_title",
  possession: "BallPossesion",
  passes: "passes",
  passesAccurate: "accurate_passes",
  oppHalfPasses: "opposition_half_passes",
  ownHalfPasses: "own_half_passes",
  longBalls: "long_balls_accurate",
  crosses: "accurate_crosses",
  touchesBox: "touches_opp_box",
  dribbles: "dribbles_succeeded",
  duels: "duel_won",
  groundDuels: "ground_duels_won",
  aerials: "aerials_won",
  tackles: "matchstats.headers.tackles",
  interceptions: "interceptions",
  clearances: "clearances",
  blocks: "shot_blocks",
  fouls: "fouls",
  yellow: "yellow_cards",
  red: "red_cards",
  corners: "corners",
  offsides: "Offsides",
  saves: "keeper_saves",
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One row per finished match: score, both sides' statistics, timeline. */
export function teamRows(matches, clubId, leagueId = null) {
  return matches
    .filter(
      (m) =>
        m.status === "finished" &&
        (m.home?.id === clubId || m.away?.id === clubId) &&
        (!leagueId ||
          (leagueId instanceof Set
            ? leagueId.has(m.leagueId)
            : m.leagueId === leagueId)) &&
        Number.isInteger(m.home.score) &&
        Number.isInteger(m.away.score),
    )
    .sort((a, b) =>
      String(a.timeUtc || a.date).localeCompare(String(b.timeUtc || b.date)),
    )
    .map((m) => {
      const side = m.home.id === clubId ? "home" : "away",
        other = side === "home" ? "away" : "home";
      const reliable =
        m.coverage?.teamStatsReliable !== false && m.stats?.length;
      const read = (s) =>
        Object.fromEntries(
          Object.entries(STATS).map(([name, key]) => {
            const row = reliable && m.stats.find((stat) => stat.key === key);
            return [name, row ? num(row[s]) : null];
          }),
        );
      const gf = m[side].score,
        ga = m[other].score;
      const own = reliable ? read(side) : null,
        opp = reliable ? read(other) : null;
      return {
        match: m,
        side,
        opponent: m[other],
        gf,
        ga,
        result: gf > ga ? "V" : gf === ga ? "N" : "D",
        points: gf > ga ? 3 : gf === ga ? 1 : 0,
        own,
        opp,
        xpts:
          own?.xg != null && opp?.xg != null
            ? (outcomeChances(own.xg, opp.xg)?.xpts ?? null)
            : null,
      };
    });
}

/* -------------------------------------------------------- expected points */

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Poisson probabilities of 0 to n goals at a rate, n = ⌈rate + 12√rate + 12⌉: the goals left
 * out weigh less than 1e-12 (VI-23 B6). agg.xpts_v2 (130) computes the same law in SQL.
 */
function poisson(lambda) {
  const n = Math.ceil(lambda + 12 * Math.sqrt(lambda) + 12);
  const out = new Array(n + 1);
  let p = Math.exp(-lambda);
  for (let k = 0; k <= n; k++) {
    out[k] = p;
    p = (p * lambda) / (k + 1);
  }
  return out;
}
/** Σ p[i] × P(other side scores fewer than i): the chance that the first side wins. */
function winMass(p, q) {
  let total = 0,
    below = 0;
  for (let i = 0; i < p.length; i++) {
    total += p[i] * below;
    if (i < q.length) below += q[i];
  }
  return total;
}
/** The largest xG a side may have (an engineering guard, not a sporting limit: no match nears it). */
const MAX_XG = 100;
/**
 * Win/draw/loss chances when each side scores Poisson(xG) goals; null for an xG that is not a
 * finite number in [0, MAX_XG]. xG is floored at 0.01 (documented choice); win, draw and loss
 * are each summed over the support, then normalised by their total (the dropped tail is
 * < 1e-12). agg.xpts_v2 (130) has the same domain.
 */
export function outcomeChances(xgFor, xgAgainst) {
  if (
    !finite(xgFor) ||
    !finite(xgAgainst) ||
    xgFor < 0 ||
    xgAgainst < 0 ||
    xgFor > MAX_XG ||
    xgAgainst > MAX_XG
  )
    return null;
  const a = poisson(Math.max(0.01, xgFor)),
    b = poisson(Math.max(0.01, xgAgainst));
  const win = winMass(a, b),
    loss = winMass(b, a);
  let draw = 0;
  for (let k = 0; k < Math.min(a.length, b.length); k++) draw += a[k] * b[k];
  const total = win + draw + loss;
  if (!(total > 0) || !Number.isFinite(total)) return null;
  return {
    win: win / total,
    draw: draw / total,
    loss: loss / total,
    xpts: (3 * win + draw) / total,
  };
}

/* ---------------------------------------------------------------- metrics */

/**
 * The match's two sides as its record names them: the club's id (its `side`) and the
 * opponent's, or null unless they are the match's home and away teams.
 */
function sidesOf(row) {
  const home = row.match?.home?.id,
    away = row.match?.away?.id,
    us = row.side === "home" ? home : row.side === "away" ? away : null,
    them = row.opponent?.id;
  return us &&
    them &&
    us !== them &&
    them === (row.side === "home" ? away : home)
    ? { us, them }
    : null;
}
/**
 * The match's shot list without the penalty shoot-out's attempts (`period` « penalties » in the
 * embedded records, « Penalties » in the source-shaped reads): a shoot-out goal is not in the score
 * and its attempts are in no team statistic, as the server reads them. Null without a list. The
 * reading of a match's shots for shotProfile (VI-23 stage 5, §14.4); the scoring is the server's.
 */
const SHOOTOUT_PERIODS = new Set(["penalties", "Penalties"]);
function matchShots(row) {
  const shots = row.match?.shots;
  return Array.isArray(shots)
    ? shots.filter((s) => !SHOOTOUT_PERIODS.has(s?.period))
    : null;
}
/**
 * A count the server established: a non-negative integer, else unknown.
 */
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
/**
 * The match's own goals, as every match record carries them on each side (`ownGoalsFor`, the
 * opponent's own goals in that side's score: api.match_scoring, VI-23 stage 8, FAILURE_MODES §17):
 * classified by the server from the goal events, whose team is the side credited. Null unless both
 * sides are known: the shot list never classifies a goal (production stores no FALSE on a goal
 * shot), and a « no goal, no own goal » rule would pick matches by their outcome.
 */
function scoringOf(row) {
  const ownGoalsFor = count(row.match?.[row.side]?.ownGoalsFor),
    ownGoalsAgainst = count(row.opponent?.ownGoalsFor);
  return ownGoalsFor === null || ownGoalsAgainst === null
    ? null
    : { ownGoalsFor, ownGoalsAgainst };
}
/**
 * A shot's situation, in the six display buckets of SITUATION_LABELS: the eight normalized codes
 * of the embedded match records (api.match_shots) and the provider spellings of the source-shaped
 * reads (match-families.mjs). Any other value, or none, is unclassified (null), never open play.
 * The reading of a situation for shotProfile (VI-23 stage 3, §7.5).
 */
const SITUATION_CODES = new Map([
  ["regular_play", "open"],
  ["RegularPlay", "open"],
  ["individual_play", "open"],
  ["IndividualPlay", "open"],
  ["fast_break", "fastBreak"],
  ["FastBreak", "fastBreak"],
  ["from_corner", "corner"],
  ["FromCorner", "corner"],
  ["set_piece", "setPiece"],
  ["SetPiece", "setPiece"],
  ["throw_in_set_piece", "setPiece"],
  ["ThrowInSetPiece", "setPiece"],
  ["free_kick", "freeKick"],
  ["FreeKick", "freeKick"],
  ["penalty", "penalty"],
  ["Penalty", "penalty"],
]);
const situationOf = (code) => SITUATION_CODES.get(code) ?? null;
/**
 * The club's penalty attempts, as the server counts them on the match's complete shot set
 * reconciled with its statistics, its score and its goal events (`penaltyAttempts`, stage 8,
 * §17): null when unknown — equal xG and non-penalty xG establish nothing (finding 15e).
 */
function penaltiesOf(row) {
  return count(row.match?.[row.side]?.penaltyAttempts);
}

const known = (...values) => values.every(finite);
/** A mean over the matches that know `value`; `count` says on how many it stands. */
const meanOf = (value) => ({
  get: (rows) => {
    let total = 0,
      count = 0;
    for (const row of rows) {
      const v = value(row);
      if (finite(v)) {
        total += v;
        count++;
      }
    }
    return count ? total / count : null;
  },
  count: (rows) => rows.filter((row) => finite(value(row))).length,
});
/** Σ numerator / Σ denominator over the matches that know both (one support), × scale. */
const ratioOf = (pair, scale = 100) => {
  const supported = (row) => {
    const p = pair(row);
    return p && finite(p[0]) && finite(p[1]) ? p : null;
  };
  return {
    get: (rows) => {
      let a = 0,
        b = 0;
      for (const row of rows) {
        const p = supported(row);
        if (!p) continue;
        a += p[0];
        b += p[1];
      }
      return b > 0 ? (scale * a) / b : null;
    },
    count: (rows) => rows.filter(supported).length,
  };
};
/** A total over the matches that know it; unknown when none does. */
const totalOf = (value) => ({
  get: (rows) => {
    const values = rows.map(value).filter(finite);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  },
  count: (rows) => rows.filter((row) => finite(value(row))).length,
});
const own = (key) => (row) => row.own?.[key];
const opp = (key) => (row) => row.opp?.[key];
/** Both sides' share of a statistic that is the club's (field tilt, duels…). */
const share = (key) =>
  ratioOf((x) =>
    known(x.own?.[key], x.opp?.[key])
      ? [x.own[key], x.own[key] + x.opp[key]]
      : null,
  );

/**
 * Every club indicator. `better`: 1 when higher is better, -1 when lower is better, 0 for a
 * style indicator with no good or bad side. Each reads its own inputs only and stands on the
 * matches that know all of them (`count`): a missing input is never a 0, and an xG the
 * indicator does not read gates nothing (VI-23 B6, finding 8).
 */
export const METRICS = {
  ppm: {
    label: "Points / match",
    family: "results",
    better: 1,
    digits: 2,
    ...meanOf((x) => x.points),
  },
  xpts: {
    label: "xPts / match",
    family: "results",
    better: 1,
    digits: 2,
    ...meanOf((x) => x.xpts),
    info: "Points attendus : chaque camp marque selon une loi de Poisson de moyenne égale à ses xG.",
  },
  goalsFor: {
    label: "Buts marqués / match",
    family: "attack",
    better: 1,
    digits: 2,
    ...meanOf((x) => x.gf),
  },
  goalsAgainst: {
    label: "Buts encaissés / match",
    family: "defence",
    better: -1,
    digits: 2,
    ...meanOf((x) => x.ga),
  },
  xg: {
    label: "xG / match",
    family: "attack",
    better: 1,
    digits: 2,
    ...meanOf(own("xg")),
  },
  npxg: {
    label: "xG hors penalty / match",
    family: "attack",
    better: 1,
    digits: 2,
    ...meanOf(own("npxg")),
  },
  xgOpen: {
    label: "xG en jeu ouvert / match",
    family: "attack",
    better: 1,
    digits: 2,
    ...meanOf(own("xgOpen")),
  },
  bigChances: {
    label: "Grosses occasions / match",
    family: "attack",
    better: 1,
    digits: 1,
    ...meanOf(own("bigChances")),
  },
  shots: {
    label: "Tirs / match",
    family: "attack",
    better: 1,
    digits: 1,
    ...meanOf(own("shots")),
  },
  shotsOnTarget: {
    label: "Tirs cadrés / match",
    family: "attack",
    better: 1,
    digits: 1,
    ...meanOf(own("sot")),
  },
  xgPerShot: {
    label: "xG par tir (hors penalty)",
    family: "attack",
    better: 1,
    digits: 2,
    // Penalties out of both terms, counted on the match's complete shot set.
    ...ratioOf((x) => {
      const penalties = penaltiesOf(x);
      return penalties === null || !known(x.own?.npxg, x.own?.shots)
        ? null
        : [x.own.npxg, x.own.shots - penalties];
    }, 1),
    info: "Qualité moyenne des tirs : xG hors penalty divisés par le nombre de tirs hors penalty.",
  },
  boxShots: {
    label: "Tirs dans la surface",
    family: "attack",
    better: 1,
    digits: 0,
    unit: "%",
    ...ratioOf((x) => [x.own?.shotsIn, x.own?.shots]),
  },
  touchesBox: {
    label: "Ballons dans la surface / match",
    family: "attack",
    better: 1,
    digits: 1,
    ...meanOf(own("touchesBox")),
  },
  finishing: {
    label: "Finition (buts − xG) / match",
    family: "finishing",
    better: 1,
    digits: 2,
    signed: true,
    // The club's own goals: an opponent's own goal is no finishing.
    ...meanOf((x) => {
      const scoring = scoringOf(x);
      return scoring && finite(x.own?.xg)
        ? x.gf - scoring.ownGoalsFor - x.own.xg
        : null;
    }),
    info: "Écart entre buts marqués et xG : positif, l’équipe convertit mieux que la moyenne des tirs comparables.",
  },
  keeper: {
    label: "Buts évités par le gardien / match",
    family: "finishing",
    better: 1,
    digits: 2,
    signed: true,
    // The goals the keeper let in: the club's own goals are not his.
    ...meanOf((x) => {
      const scoring = scoringOf(x);
      return scoring && finite(x.opp?.xgot)
        ? x.opp.xgot - (x.ga - scoring.ownGoalsAgainst)
        : null;
    }),
    info: "xG cadrés concédés (xGOT) moins buts encaissés : ce que les arrêts ont empêché.",
  },
  conversion: {
    label: "Conversion des tirs",
    family: "finishing",
    better: 1,
    digits: 1,
    unit: "%",
    ...ratioOf((x) => {
      const scoring = scoringOf(x);
      return scoring ? [x.gf - scoring.ownGoalsFor, x.own?.shots] : null;
    }),
  },
  xga: {
    label: "xG concédés / match",
    family: "defence",
    better: -1,
    digits: 2,
    ...meanOf(opp("xg")),
  },
  npxga: {
    label: "xG concédés hors penalty / match",
    family: "defence",
    better: -1,
    digits: 2,
    ...meanOf(opp("npxg")),
  },
  shotsAgainst: {
    label: "Tirs concédés / match",
    family: "defence",
    better: -1,
    digits: 1,
    ...meanOf(opp("shots")),
  },
  bigChancesAgainst: {
    label: "Grosses occasions concédées / match",
    family: "defence",
    better: -1,
    digits: 1,
    ...meanOf(opp("bigChances")),
  },
  touchesBoxAgainst: {
    label: "Ballons adverses dans la surface / match",
    family: "defence",
    better: -1,
    digits: 1,
    ...meanOf(opp("touchesBox")),
  },
  shotsOnTargetAgainst: {
    label: "Tirs cadrés concédés / match",
    family: "defence",
    better: -1,
    digits: 1,
    ...meanOf(opp("sot")),
  },
  xgOpenAgainst: {
    label: "xG concédés en jeu ouvert / match",
    family: "defence",
    better: -1,
    digits: 2,
    ...meanOf(opp("xgOpen")),
  },
  passesAgainst: {
    label: "Passes adverses / match",
    family: "control",
    better: 0,
    digits: 0,
    ...meanOf(opp("passes")),
  },
  xgot: {
    label: "xG cadrés (xGOT) / match",
    family: "finishing",
    better: 1,
    digits: 2,
    ...meanOf(own("xgot")),
  },
  placement: {
    label: "Qualité de frappe (xGOT − xG) / match",
    family: "finishing",
    better: 1,
    digits: 2,
    signed: true,
    ...meanOf((x) =>
      known(x.own?.xgot, x.own?.xg) ? x.own.xgot - x.own.xg : null,
    ),
    info: "Ce que la précision des frappes ajoute aux occasions : positif, les tirs sont mieux placés que la moyenne.",
  },
  cleanSheets: {
    label: "Matchs sans encaisser",
    family: "defence",
    better: 1,
    digits: 0,
    unit: "%",
    ...ratioOf((x) => (finite(x.ga) ? [x.ga === 0 ? 1 : 0, 1] : null)),
  },
  possession: {
    label: "Possession",
    family: "control",
    better: 0,
    digits: 1,
    unit: "%",
    ...meanOf(own("possession")),
  },
  passes: {
    label: "Passes / match",
    family: "control",
    better: 0,
    digits: 0,
    ...meanOf(own("passes")),
  },
  passAccuracy: {
    label: "Passes réussies",
    family: "control",
    better: 1,
    digits: 1,
    unit: "%",
    ...ratioOf((x) => [x.own?.passesAccurate, x.own?.passes]),
  },
  fieldTilt: {
    label: "Territoire (field tilt)",
    family: "control",
    better: 1,
    digits: 1,
    unit: "%",
    ...share("oppHalfPasses"),
    info: "Part des passes jouées dans le camp adverse par les deux équipes qui revient au club : qui joue chez l’autre.",
  },
  boxShare: {
    label: "Part des ballons dans les surfaces",
    family: "control",
    better: 1,
    digits: 1,
    unit: "%",
    ...share("touchesBox"),
  },
  directness: {
    label: "Jeu long (part des longs ballons)",
    family: "control",
    better: 0,
    digits: 1,
    unit: "%",
    ...ratioOf((x) => [x.own?.longBalls, x.own?.passesAccurate]),
    info: "Longs ballons réussis rapportés aux passes réussies : plus la part est haute, plus le jeu est direct.",
  },
  crosses: {
    label: "Centres réussis / match",
    family: "control",
    better: 0,
    digits: 1,
    ...meanOf(own("crosses")),
  },
  ppda: {
    label: "Passes adverses par action défensive",
    family: "pressing",
    better: -1,
    digits: 1,
    ...ratioOf(
      (x) =>
        known(
          x.opp?.ownHalfPasses,
          x.own?.tackles,
          x.own?.interceptions,
          x.own?.fouls,
        )
          ? [
              x.opp.ownHalfPasses,
              x.own.tackles + x.own.interceptions + x.own.fouls,
            ]
          : null,
      1,
    ),
    info: "Passes adverses dans leur propre moitié par action défensive (tacle, interception, faute). Bas = pressing plus agressif. Approximation : la zone des actions défensives n’est pas publiée.",
  },
  defActions: {
    label: "Tacles + interceptions (ajusté poss.)",
    family: "pressing",
    better: 0,
    digits: 1,
    ...meanOf((x) =>
      known(x.own?.tackles, x.own?.interceptions, x.own?.possession) &&
      x.own.possession < 100
        ? ((x.own.tackles + x.own.interceptions) * 50) /
          (100 - x.own.possession)
        : null,
    ),
    info: "Volume défensif ramené à une possession adverse de 50 %.",
  },
  duels: {
    label: "Duels gagnés",
    family: "pressing",
    better: 1,
    digits: 1,
    unit: "%",
    ...share("duels"),
  },
  aerials: {
    label: "Duels aériens gagnés",
    family: "pressing",
    better: 1,
    digits: 1,
    unit: "%",
    ...share("aerials"),
  },
  fouls: {
    label: "Fautes / match",
    family: "pressing",
    better: 0,
    digits: 1,
    ...meanOf(own("fouls")),
  },
  xgSet: {
    label: "xG sur coups de pied arrêtés / match",
    family: "setpieces",
    better: 1,
    digits: 2,
    ...meanOf(own("xgSet")),
  },
  xgSetAgainst: {
    label: "xG concédés sur CPA / match",
    family: "setpieces",
    better: -1,
    digits: 2,
    ...meanOf(opp("xgSet")),
  },
  setShare: {
    label: "Part des CPA dans les xG",
    family: "setpieces",
    better: 0,
    digits: 1,
    unit: "%",
    ...ratioOf((x) => [x.own?.xgSet, x.own?.xg]),
  },
  corners: {
    label: "Corners / match",
    family: "setpieces",
    better: 1,
    digits: 1,
    ...meanOf(own("corners")),
  },
  cornersAgainst: {
    label: "Corners concédés / match",
    family: "setpieces",
    better: -1,
    digits: 1,
    ...meanOf(opp("corners")),
  },
  yellow: {
    label: "Cartons jaunes / match",
    family: "discipline",
    better: -1,
    digits: 2,
    ...meanOf(own("yellow")),
  },
  red: {
    label: "Cartons rouges",
    family: "discipline",
    better: -1,
    digits: 0,
    total: true,
    ...totalOf(own("red")),
  },
};
export const FAMILIES = {
  results: "Résultats",
  attack: "Attaque",
  finishing: "Finition et gardien",
  defence: "Défense",
  control: "Contrôle et territoire",
  pressing: "Pressing et duels",
  setpieces: "Coups de pied arrêtés",
  discipline: "Discipline",
};
/** Twelve performance axes for the pizza: one good/bad reading each. */
export const PERFORMANCE_KEYS = [
  "xg",
  "bigChances",
  "xgPerShot",
  "touchesBox",
  "finishing",
  "xga",
  "bigChancesAgainst",
  "keeper",
  "fieldTilt",
  "passAccuracy",
  "duels",
  "xgSet",
];
/** Style axes: where the club sits, with no value judgement. */
export const STYLE_AXES = [
  { key: "possession", low: "Laisse le ballon", high: "Monopolise le ballon" },
  {
    key: "fieldTilt",
    low: "Joue dans son camp",
    high: "Installé chez l’adversaire",
  },
  { key: "directness", low: "Jeu court", high: "Jeu long et direct" },
  {
    key: "ppda",
    low: "Pressing haut et agressif",
    high: "Bloc qui attend",
    invert: true,
  },
  { key: "crosses", low: "Peu de centres", high: "Beaucoup de centres" },
  { key: "setShare", low: "Peu dépendant des CPA", high: "Dépendant des CPA" },
  {
    key: "defActions",
    low: "Peu d’actions défensives",
    high: "Très actif sans ballon",
  },
];
/** Vega club indices: centile means per phase of play. */
export const PHASES = [
  {
    key: "attack",
    label: "Attaque",
    keys: ["xg", "bigChances", "touchesBox", "xgPerShot"],
  },
  {
    key: "defence",
    label: "Défense",
    keys: ["xga", "bigChancesAgainst", "touchesBoxAgainst", "shotsAgainst"],
  },
  {
    key: "control",
    label: "Contrôle",
    keys: ["fieldTilt", "boxShare", "passAccuracy"],
  },
  {
    key: "pressing",
    label: "Pressing et duels",
    keys: ["ppda", "duels", "aerials"],
  },
  {
    key: "setpieces",
    label: "Coups de pied arrêtés",
    keys: ["xgSet", "xgSetAgainst", "corners"],
  },
  {
    key: "finishing",
    label: "Finition et gardien",
    keys: ["finishing", "keeper"],
  },
];

/** Share of the cohort below `value`, ties counted half, oriented by `better`. */
export function centile(values, value, better = 1) {
  if (value == null || values.length < 5) return null;
  let below = 0,
    equal = 0;
  for (const v of values)
    if (v < value) below++;
    else if (v === value) equal++;
  const raw = Math.round((100 * (below + equal / 2)) / values.length);
  return better === -1 ? 100 - raw : raw;
}
const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q,
    lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/* ----------------------------------------------------- game state, shots */

export const SITUATION_LABELS = {
  open: "Jeu placé",
  fastBreak: "Contre-attaque",
  corner: "Corner",
  setPiece: "Autre CPA",
  freeKick: "Coup franc direct",
  penalty: "Penalty",
};
const shotOutcome = (shot) =>
  shot.isGoal
    ? "goal"
    : shot.isBlocked
      ? "blocked"
      : shot.isOnTarget
        ? "saved"
        : "off";

/**
 * The club's shots for and against, by situation, and their points on the map (VI-23 stage 3,
 * §7.5). A shot is the club's or its opponent's by the match's actual sides; another team's, or
 * none's, counts on neither side, and a shoot-out attempt is none of the match's (matchShots,
 * stage 5). A bucket's xG is known only while each of its shots has one; a
 * shot without a recognized situation is counted in `unclassified` and keeps its map point,
 * labelled « — ». On the map, a known 0 stays 0 and a missing xG stays null: ShotPair draws the
 * point small, says « xG indisponible » and leaves its header total unknown (VI-22).
 */
export function shotProfile(rows, clubId) {
  const empty = () => ({ shots: 0, xg: 0, goals: 0 });
  const buckets = () =>
    Object.fromEntries(Object.keys(SITUATION_LABELS).map((k) => [k, empty()]));
  const out = {
    for: buckets(),
    against: buckets(),
    unclassified: { for: empty(), against: empty() },
    mapFor: [],
    mapAgainst: [],
    matches: 0,
  };
  for (const row of rows) {
    const shots = matchShots(row) || [];
    const sides = sidesOf(row);
    if (!shots.length || !sides || sides.us !== clubId) continue;
    out.matches++;
    for (const shot of shots) {
      if (shot.isOwnGoal) continue;
      const mine = shot.teamId === sides.us;
      if (!mine && shot.teamId !== sides.them) continue;
      const key = situationOf(shot.situation);
      const bucket = key
        ? (mine ? out.for : out.against)[key]
        : out.unclassified[mine ? "for" : "against"];
      const xg = num(shot.xg);
      bucket.shots++;
      if (bucket.xg !== null) bucket.xg = xg === null ? null : bucket.xg + xg;
      if (shot.isGoal) bucket.goals++;
      if (num(shot.x) != null && num(shot.y) != null)
        (mine ? out.mapFor : out.mapAgainst).push({
          id: shot.id,
          x: Math.round((105 - shot.x) * 10) / 10,
          y: shot.y,
          xg: xg,
          outcome: shotOutcome(shot),
          player: shot.playerName,
          minute: shot.minute,
          situation: key ? SITUATION_LABELS[key] : "—",
          opponent: row.opponent.name,
          date: row.match.date,
        });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- dossier */

function clubValues(rows) {
  return Object.fromEntries(
    Object.entries(METRICS).map(([key, metric]) => [key, metric.get(rows)]),
  );
}
/** On how many matches each indicator stands. */
function clubCoverage(rows) {
  return Object.fromEntries(
    Object.entries(METRICS).map(([key, metric]) => [key, metric.count(rows)]),
  );
}
/**
 * Actual and expected points on the same matches, those whose xPts is known; the xG for and
 * against on the matches that know both (VI-23 B6, finding 9 and N5). Unknown without such a
 * match. A consumer reads these, not record.points − xptsTotal nor values.xg − values.xga, whose
 * terms stand on different matches.
 */
function pairedFields(rows) {
  const points = rows.filter((row) => finite(row.xpts)),
    xg = rows.filter((row) => finite(row.own?.xg) && finite(row.opp?.xg));
  const actual = points.reduce((t, row) => t + row.points, 0),
    expected = points.reduce((t, row) => t + row.xpts, 0),
    xgFor = xg.reduce((t, row) => t + row.own.xg, 0),
    xgAgainst = xg.reduce((t, row) => t + row.opp.xg, 0),
    delta = xg.reduce((t, row) => t + (row.own.xg - row.opp.xg), 0);
  return {
    pairedMatches: points.length,
    pairedActualPoints: points.length ? actual : null,
    pairedExpectedPoints: points.length ? expected : null,
    pairedPointsDelta: points.length ? actual - expected : null,
    pairedXgMatches: xg.length,
    pairedXgFor: xg.length ? xgFor : null,
    pairedXgAgainst: xg.length ? xgAgainst : null,
    pairedXgDelta: xg.length ? delta : null,
    pairedXgDeltaPerMatch: xg.length ? delta / xg.length : null,
  };
}
const PAIRED_KEYS = Object.keys(pairedFields([]));
function record(rows) {
  const r = { matches: rows.length, w: 0, d: 0, l: 0, gf: 0, ga: 0, points: 0 };
  for (const row of rows) {
    r[row.result === "V" ? "w" : row.result === "N" ? "d" : "l"]++;
    r.gf += row.gf;
    r.ga += row.ga;
    r.points += row.points;
  }
  return r;
}

/**
 * The indicators that read a match's scoring (own goals, penalty attempts). Every match record of
 * the club, league and Europe reads carries it since stage 8 (§17), so a league's clubs are measured
 * from their summaries; a reference that lacks an input (the Europe pool has no xGOT nor non-penalty
 * xG) leaves its clubs unmeasured, and a rank or a reference statistic of these needs MIN_MEASURED
 * measured clubs (rankCohort). VI-23 stage 5, §14.1.
 */
const SHOT_METRICS = ["xgPerShot", "finishing", "keeper", "conversion"];
const MIN_MEASURED = 5;
/**
 * The selected club as a reference's member, with its own shot-backed values and supports read on
 * its full records (`fullRows`, the dossier's allRows) of the matches the member's rows name: a
 * summary row without a full counterpart stays unsupported, and another competition's matches are
 * never read. A copy: the member, its values and its coverage are left as they are (cached).
 * In its league the summary already measures it alike; in a pool whose reads lack an input (the
 * Europe pool's xGOT and non-penalty xG) its full records still measure it (§14.1, §17).
 */
function measuredSelf(member, fullRows) {
  const ids = new Set(
    (member.rows || []).map((row) => row.match?.id).filter((v) => v != null),
  );
  const rows = fullRows.filter((row) => ids.has(row.match?.id));
  const values = { ...member.values },
    coverage = { ...(member.coverage ?? clubCoverage(member.rows || [])) };
  for (const key of SHOT_METRICS) {
    values[key] = METRICS[key].get(rows);
    coverage[key] = METRICS[key].count(rows);
  }
  return { ...member, values, coverage };
}

function buildCohort({ league, cohortClubs, summaries, scope = null }) {
  const clubs = cohortClubs
    .map((club) => {
      const read = summaries.get(club.id);
      const rows = read
        ? teamRows(read.matches, club.id, scope || league?.id)
        : [];
      const xpts = rows
        .filter((x) => finite(x.xpts))
        .reduce((t, x) => t + x.xpts, 0);
      return {
        id: club.id,
        name: club.name,
        imageUrl: club.imageUrl,
        country: club.country,
        league: club.league || league,
        rows,
        record: record(rows),
        xptsTotal: xpts,
        ...pairedFields(rows),
        values: clubValues(rows),
        coverage: clubCoverage(rows),
      };
    })
    .filter((club) => club.rows.length);
  return { league, ...rankCohort(clubs) };
}

/**
 * Positions, centiles, ranks and Vega indices of a pool of clubs. One league
 * ranks on totals; a mixed pool (several leagues, or a club from another
 * league) ranks per match, since clubs have not played the same games.
 */
function rankCohort(clubs, { perMatch = false } = {}) {
  const per = (club, value) =>
    perMatch ? value / (club.record.matches || 1) : value;
  clubs.sort(
    (a, b) =>
      per(b, b.record.points) - per(a, a.record.points) ||
      per(b, b.record.gf - b.record.ga) - per(a, a.record.gf - a.record.ga) ||
      per(b, b.record.gf) - per(a, a.record.gf) ||
      a.name.localeCompare(b.name, "fr"),
  );
  clubs.forEach((club, i) => (club.position = i + 1));
  // xPts ranks on totals only in one league whose every club is covered on every match; else on
  // xPts per covered match (a club covered less is not ranked lower for it). Clubs without xPts
  // come last (VI-23 B6, N7).
  const covered =
    !perMatch &&
    clubs.every((club) => club.pairedMatches === club.record.matches);
  const xptsKey = (club) =>
    club.pairedMatches > 0
      ? covered
        ? club.pairedExpectedPoints
        : club.pairedExpectedPoints / club.pairedMatches
      : null;
  [...clubs]
    .sort((a, b) => {
      const x = xptsKey(a),
        y = xptsKey(b);
      return x === null || y === null ? (x === null) - (y === null) : y - x;
    })
    .forEach((club, i) => (club.xptsPosition = i + 1));
  const distributions = Object.fromEntries(
    Object.keys(METRICS).map((key) => [
      key,
      clubs.map((club) => club.values[key]).filter((v) => v != null),
    ]),
  );
  // The shot-backed indicators: below MIN_MEASURED measured clubs, no rank and no reference
  // statistic (a summary cohort measures the selected club alone: never rank 1 of 1, nor its own
  // value as the league's median). Every other indicator keeps its rule (VI-23 stage 5, §14.1).
  const scarce = (key) =>
    SHOT_METRICS.includes(key) && distributions[key].length < MIN_MEASURED;
  for (const club of clubs) {
    club.centiles = Object.fromEntries(
      Object.entries(METRICS).map(([key, metric]) => [
        key,
        centile(distributions[key], club.values[key], metric.better || 1),
      ]),
    );
    club.ranks = Object.fromEntries(
      Object.entries(METRICS).map(([key, metric]) => {
        const v = club.values[key];
        if (v == null || scarce(key)) return [key, null];
        const better = metric.better === -1 ? (x) => x < v : (x) => x > v;
        return [key, 1 + distributions[key].filter(better).length];
      }),
    );
    club.phases = Object.fromEntries(
      PHASES.map((phase) => {
        const values = phase.keys
          .map((k) => club.centiles[k])
          .filter((v) => v != null);
        return [
          phase.key,
          values.length
            ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
            : null,
        ];
      }),
    );
    const weights = {
      attack: 0.3,
      defence: 0.3,
      control: 0.15,
      pressing: 0.1,
      setpieces: 0.05,
      finishing: 0.1,
    };
    let total = 0,
      weight = 0;
    for (const [k, w] of Object.entries(weights))
      if (club.phases[k] != null) {
        total += club.phases[k] * w;
        weight += w;
      }
    club.vegaIndex = weight ? Math.round(total / weight) : null;
  }
  const stats = Object.fromEntries(
    Object.keys(METRICS).map((key) => {
      const sorted = scarce(key)
        ? []
        : [...distributions[key]].sort((a, b) => a - b);
      return [
        key,
        {
          median: median(sorted),
          dist: [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => quantile(sorted, q)),
          min: sorted[0],
          max: sorted[sorted.length - 1],
        },
      ];
    }),
  );
  [...clubs]
    .sort((a, b) => (b.vegaIndex ?? -1) - (a.vegaIndex ?? -1))
    .forEach((club, i) => (club.vegaRank = i + 1));
  return { clubs, stats };
}

/**
 * The dossier re-ranked against another referential: one or several
 * competitions. When the club plays in it (Champions League), its own
 * values there are used; otherwise its league values are placed among the
 * referential's clubs.
 */
export function rebase(dossier, cohorts, label, options = {}) {
  const pool = new Map();
  for (const cohort of cohorts)
    for (const club of cohort.clubs)
      if (!pool.has(club.id)) pool.set(club.id, club);
  const own = pool.get(dossier.id);
  const copy = (club) => {
    // The paired fields the club does not carry, from its rows: computed at most once.
    let fallback;
    const paired = (key) =>
      club[key] ?? (fallback ??= pairedFields(club.rows || []))[key];
    return {
      id: club.id,
      name: club.name,
      imageUrl: club.imageUrl,
      country: club.country,
      league: club.league,
      rows: club.rows,
      record: club.record,
      xptsTotal: club.xptsTotal,
      ...Object.fromEntries(PAIRED_KEYS.map((key) => [key, paired(key)])),
      values: club.values,
      coverage: club.coverage ?? clubCoverage(club.rows || []),
      strength: club.strength ?? null,
      leaguePosition: club.leaguePosition ?? null,
      leagueXptsPosition: club.leagueXptsPosition ?? null,
      coefficient: club.coefficient ?? null,
    };
  };
  // The club: a member of the reference keeps its member's values, its shot-backed ones read on
  // its full records of the member's matches; inserted, the base dossier's measured self (§14.1).
  const self = own
    ? Array.isArray(dossier.allRows)
      ? measuredSelf(own, dossier.allRows)
      : own
    : dossier.self;
  const clubs = [...pool.values()]
    .filter((club) => club.id !== dossier.id)
    .map(copy)
    .concat(copy(self));
  const single =
    options.perMatch == null
      ? cohorts.length === 1 && Boolean(own)
      : !options.perMatch;
  const ranked = rankCohort(clubs, { perMatch: !single });
  return {
    ...dossier,
    clubs: ranked.clubs,
    stats: ranked.stats,
    self: ranked.clubs.find((club) => club.id === dossier.id),
    league: { id: `ref:${label}`, name: label },
    referential: {
      label,
      inserted: !own,
      perMatch: !single,
      multi: options.multi ?? cohorts.length > 1,
      ...options.meta,
    },
  };
}

export function buildDossier({
  id,
  season,
  data,
  competitions,
  league,
  cohort,
}) {
  const summary = clubSummary(data, id);
  const allRows = teamRows(data.matches, id);
  const leagueRows = league ? teamRows(data.matches, id, league.id) : allRows;
  const squad = clubSquad(data, summary);
  const fallback = buildCohort({
    league,
    cohortClubs: [{ id, name: summary.name, imageUrl: summary.imageUrl }],
    summaries: new Map([[id, data]]),
  });
  const ranked = cohort?.clubs.some((club) => club.id === id)
    ? cohort
    : fallback;
  // The club's shot-backed values from its own full records, ranked on copies: the cached cohort
  // is shared by every dossier of its league and is never written (VI-23 stage 5, §14.1).
  const member = ranked.clubs.find((club) => club.id === id);
  const { clubs, stats } = member
    ? rankCohort(
        ranked.clubs.map((club) =>
          club === member ? measuredSelf(member, allRows) : { ...club },
        ),
      )
    : ranked;
  const self = clubs.find((club) => club.id === id) || {
    id,
    name: summary.name,
    imageUrl: summary.imageUrl,
    rows: leagueRows,
    record: record(leagueRows),
    ...pairedFields(leagueRows),
    values: clubValues(leagueRows),
    coverage: clubCoverage(leagueRows),
    centiles: {},
    ranks: {},
    phases: {},
  };
  const lastHome = [...allRows].reverse().find((row) => row.side === "home");
  const lastRow = allRows[allRows.length - 1];
  return {
    id,
    season,
    name: summary.name,
    imageUrl:
      lastRow?.match[lastRow.side]?.imageUrl ||
      self.imageUrl ||
      summary.imageUrl,
    coach: lastRow?.match[lastRow.side]?.coach || null,
    stadium: lastHome?.match.stadium || null,
    country: league?.country || null,
    league,
    competitions,
    summary,
    allRows,
    leagueRows,
    coverage: seasonCoverage(summary, allRows),
    allRecord: record(allRows),
    self,
    clubs,
    stats,
    squad,
    formations: formationRecords(summary),
    upcoming: upcomingClubMatches(summary, Date.now(), 6),
    shotsAll: shotProfile(allRows, id),
    shotsLeague: shotProfile(leagueRows, id),
    states: gameStates(allRows, id),
    data,
  };
}

/* -------------------------------------------------------------- helpers */

/** Rolling mean over the last `size` values of a series. */
export function rolling(values, size = 5) {
  return values.map((_, i) => {
    const window = values
      .slice(Math.max(0, i - size + 1), i + 1)
      .filter((v) => v != null);
    return window.length
      ? window.reduce((a, b) => a + b, 0) / window.length
      : null;
  });
}

/**
 * Opponent strength for the calendar: league centile of its xG difference per match, read on
 * the matches that know both xG (pairedXgDeltaPerMatch); unknown without one (VI-23 N5).
 */
export function opponentStrength(dossier, opponentId) {
  const club = dossier.clubs.find((c) => c.id === opponentId);
  if (!club || !finite(club.pairedXgDeltaPerMatch)) return null;
  const values = dossier.clubs
    .map((c) => c.pairedXgDeltaPerMatch)
    .filter(finite);
  const rank = centile(values, club.pairedXgDeltaPerMatch, 1);
  // No centile (fewer than five measured clubs), no strength: never the weakest level (VI-23 stage 7, §16.2).
  return rank == null ? null : { club, centile: rank };
}

/**
 * Strength of an opponent outside the league (a European or cup opponent): centile of its
 * club Elo among the Elo of the league's clubs, so a level 5 means as strong as the league's
 * best. `levels` is the Elo of every club ranked in the season (useEuropeLevels); unknown
 * without the opponent's Elo or five rated clubs in the league.
 */
export function opponentEloStrength(dossier, levels, opponentId) {
  const elo = levels?.get(opponentId);
  if (!finite(elo)) return null;
  const values = dossier.clubs.map((c) => levels.get(c.id)).filter(finite);
  const rank = centile(values, elo, 1);
  return rank == null ? null : { elo, centile: rank };
}

export const formatMetric = (key, value, { total = false } = {}) => {
  const metric = METRICS[key];
  if (value == null || Number.isNaN(value)) return "—";
  const text = Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: total ? 0 : metric.digits,
    maximumFractionDigits: total ? 0 : metric.digits,
  });
  return `${metric.signed && value > 0 ? "+" : ""}${text}${metric.unit === "%" ? " %" : ""}`;
};
