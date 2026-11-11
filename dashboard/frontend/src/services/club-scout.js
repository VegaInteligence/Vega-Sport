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
import { useEffect, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  compactGeneration,
  compactScope,
  readCompact,
  readCompactPages,
  supportsCompactRead,
} from "./compact-reads.js";
import { apiUrl } from "../data-url.js";
import { publicApiFetch } from "./public-api-fetch.js";
import {
  clubCompetitions,
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
export function leagueCohort(league, { season, generation, whole = false }, onProgress) {
  return cachedLoad(
    `${generation}|${season}|league:${league.id}`,
    async (progress) => {
      const [cohort, matches] = await Promise.all([
        readCompactPages(
          "clubs",
          {
            season,
            leagues: compactScope([league.id]),
            analysis: 1,
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
                generation,
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

async function loadDossier({ id, season, generation, whole }, onProgress) {
  const base = { season, team: id, leagues: "all", generation };
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
  const competitionById = new Map(data.competitions.map((c) => [c.id, c]));
  const competitions = clubCompetitions(data, id).map((c) => ({
    ...c,
    country: competitionById.get(c.id)?.country,
    imageUrl: competitionById.get(c.id)?.imageUrl,
  }));
  const league =
    competitions.find((c) => c.country && !INTERNATIONAL.has(c.country)) ||
    competitions[0];
  let cohort = null;
  if (league) {
    const entry = leagueCohort(league, { season, generation, whole });
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

function useCachedState(key, start) {
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
      (error) =>
        live &&
        setState({ status: "error", error: error?.message || String(error) }),
    );
    return () => {
      live = false;
      entry.listeners.delete(listener);
    };
    // `start` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function usePublication() {
  const f = useFootball();
  return {
    generation: compactGeneration(f?.manifest),
    season: f?.season || f?.manifest?.defaultSeason,
    manifest: f?.manifest,
    // A league's matches in one read, when the API serves it (leagueCohort).
    whole: supportsCompactRead(f?.manifest, "league"),
  };
}

/** Whole dossier of one club, cached per generation and season. */
export function useClubDossier(clubId) {
  const { generation, season, whole } = usePublication();
  const key =
    clubId && generation && season ? `${generation}|${season}|${clubId}` : null;
  const state = useCachedState(key, () =>
    cachedLoad(key, (progress) =>
      loadDossier({ id: clubId, season, generation, whole }, progress),
    ),
  );
  return state.status === "ready"
    ? { status: "ready", dossier: state.value }
    : state;
}

/** Any league's cohort, for similar clubs searched in another competition. */
export function useLeagueCohort(league) {
  const { generation, season, whole } = usePublication();
  const key =
    league?.id && generation && season
      ? `${generation}|${season}|league:${league.id}`
      : null;
  return useCachedState(key, () =>
    leagueCohort(league, { season, generation, whole }),
  );
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
  const { generation, season, whole } = usePublication();
  const key =
    leagues?.length && generation && season
      ? `${generation}|${season}|ref:${leagues
          .map((league) => league.id)
          .sort()
          .join(",")}`
      : null;
  return useCachedState(key, () =>
    referentialLoad(leagues, { season, generation, whole }),
  );
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

/** The pool of the base: its head, then the matches of each competition. */
export async function readEuropePool({ season, generation }) {
  const scope = { season, ...(generation ? { generation } : {}) };
  const head = await readEurope("/api/clubs/europe", scope);
  const parts = await Promise.all(
    [...head.leagues, ...head.uefa].map((league) =>
      readEurope("/api/clubs/europe/matches", { ...scope, league: league.id }),
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
            ? outcomeChances(own.xg, opp.xg).xpts
            : null,
      };
    });
}

/* -------------------------------------------------------- expected points */

function poisson(lambda, max = 10) {
  const out = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= max; k++) {
    out.push(p);
    p = (p * lambda) / (k + 1);
  }
  return out;
}
/** Win/draw/loss chances when each side scores Poisson(xG) goals. */
export function outcomeChances(xgFor, xgAgainst) {
  const a = poisson(Math.max(0.01, xgFor)),
    b = poisson(Math.max(0.01, xgAgainst));
  let win = 0,
    draw = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (i > j) win += a[i] * b[j];
      else if (i === j) draw += a[i] * b[j];
  return { win, draw, loss: Math.max(0, 1 - win - draw), xpts: 3 * win + draw };
}

/* ---------------------------------------------------------------- metrics */

const sum = (rows, get) => {
  let total = 0,
    count = 0;
  for (const row of rows) {
    const value = get(row);
    if (value != null && Number.isFinite(value)) {
      total += value;
      count++;
    }
  }
  return { total, count };
};
const mean = (rows, get) => {
  const s = sum(rows, get);
  return s.count ? s.total / s.count : null;
};
const ratio = (rows, top, bottom, scale = 100) => {
  let a = 0,
    b = 0;
  for (const row of rows) {
    const x = top(row),
      y = bottom(row);
    if (x == null || y == null) continue;
    a += x;
    b += y;
  }
  return b > 0 ? (scale * a) / b : null;
};
const has = (row) =>
  row.own && row.opp && row.own.xg != null && row.opp.xg != null;

/**
 * Every club indicator. `better`: 1 when higher is better, -1 when lower is
 * better, 0 for a style indicator with no good or bad side.
 */
export const METRICS = {
  ppm: {
    label: "Points / match",
    family: "results",
    better: 1,
    digits: 2,
    get: (r) => mean(r, (x) => x.points),
  },
  xpts: {
    label: "xPts / match",
    family: "results",
    better: 1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.xpts),
    info: "Points attendus : chaque camp marque selon une loi de Poisson de moyenne égale à ses xG.",
  },
  goalsFor: {
    label: "Buts marqués / match",
    family: "attack",
    better: 1,
    digits: 2,
    get: (r) => mean(r, (x) => x.gf),
  },
  goalsAgainst: {
    label: "Buts encaissés / match",
    family: "defence",
    better: -1,
    digits: 2,
    get: (r) => mean(r, (x) => x.ga),
  },
  xg: {
    label: "xG / match",
    family: "attack",
    better: 1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.own.xg),
  },
  npxg: {
    label: "xG hors penalty / match",
    family: "attack",
    better: 1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.own.npxg),
  },
  xgOpen: {
    label: "xG en jeu ouvert / match",
    family: "attack",
    better: 1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.own.xgOpen),
  },
  bigChances: {
    label: "Grosses occasions / match",
    family: "attack",
    better: 1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.bigChances),
  },
  shots: {
    label: "Tirs / match",
    family: "attack",
    better: 1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.shots),
  },
  shotsOnTarget: {
    label: "Tirs cadrés / match",
    family: "attack",
    better: 1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.sot),
  },
  xgPerShot: {
    label: "xG par tir (hors penalty)",
    family: "attack",
    better: 1,
    digits: 2,
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.npxg,
        (x) => x.own.shots,
        1,
      ),
    info: "Qualité moyenne des tirs : xG hors penalty divisés par le nombre de tirs.",
  },
  boxShots: {
    label: "Tirs dans la surface",
    family: "attack",
    better: 1,
    digits: 0,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.shotsIn,
        (x) => x.own.shots,
      ),
  },
  touchesBox: {
    label: "Ballons dans la surface / match",
    family: "attack",
    better: 1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.touchesBox),
  },
  finishing: {
    label: "Finition (buts − xG) / match",
    family: "finishing",
    better: 1,
    digits: 2,
    signed: true,
    get: (r) => mean(r.filter(has), (x) => x.gf - x.own.xg),
    info: "Écart entre buts marqués et xG : positif, l’équipe convertit mieux que la moyenne des tirs comparables.",
  },
  keeper: {
    label: "Buts évités par le gardien / match",
    family: "finishing",
    better: 1,
    digits: 2,
    signed: true,
    get: (r) => mean(r.filter(has), (x) => x.opp.xgot - x.ga),
    info: "xG cadrés concédés (xGOT) moins buts encaissés : ce que les arrêts ont empêché.",
  },
  conversion: {
    label: "Conversion des tirs",
    family: "finishing",
    better: 1,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.gf,
        (x) => x.own.shots,
      ),
  },
  xga: {
    label: "xG concédés / match",
    family: "defence",
    better: -1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.opp.xg),
  },
  npxga: {
    label: "xG concédés hors penalty / match",
    family: "defence",
    better: -1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.opp.npxg),
  },
  shotsAgainst: {
    label: "Tirs concédés / match",
    family: "defence",
    better: -1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.opp.shots),
  },
  bigChancesAgainst: {
    label: "Grosses occasions concédées / match",
    family: "defence",
    better: -1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.opp.bigChances),
  },
  touchesBoxAgainst: {
    label: "Ballons adverses dans la surface / match",
    family: "defence",
    better: -1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.opp.touchesBox),
  },
  shotsOnTargetAgainst: {
    label: "Tirs cadrés concédés / match",
    family: "defence",
    better: -1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.opp.sot),
  },
  xgOpenAgainst: {
    label: "xG concédés en jeu ouvert / match",
    family: "defence",
    better: -1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.opp.xgOpen),
  },
  passesAgainst: {
    label: "Passes adverses / match",
    family: "control",
    better: 0,
    digits: 0,
    get: (r) => mean(r.filter(has), (x) => x.opp.passes),
  },
  xgot: {
    label: "xG cadrés (xGOT) / match",
    family: "finishing",
    better: 1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.own.xgot),
  },
  placement: {
    label: "Qualité de frappe (xGOT − xG) / match",
    family: "finishing",
    better: 1,
    digits: 2,
    signed: true,
    get: (r) =>
      mean(r.filter(has), (x) =>
        x.own.xgot == null ? null : x.own.xgot - x.own.xg,
      ),
    info: "Ce que la précision des frappes ajoute aux occasions : positif, les tirs sont mieux placés que la moyenne.",
  },
  cleanSheets: {
    label: "Matchs sans encaisser",
    family: "defence",
    better: 1,
    digits: 0,
    unit: "%",
    get: (r) =>
      r.length ? (100 * r.filter((x) => x.ga === 0).length) / r.length : null,
  },
  possession: {
    label: "Possession",
    family: "control",
    better: 0,
    digits: 1,
    unit: "%",
    get: (r) => mean(r.filter(has), (x) => x.own.possession),
  },
  passes: {
    label: "Passes / match",
    family: "control",
    better: 0,
    digits: 0,
    get: (r) => mean(r.filter(has), (x) => x.own.passes),
  },
  passAccuracy: {
    label: "Passes réussies",
    family: "control",
    better: 1,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.passesAccurate,
        (x) => x.own.passes,
      ),
  },
  fieldTilt: {
    label: "Territoire (field tilt)",
    family: "control",
    better: 1,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.oppHalfPasses,
        (x) => x.own.oppHalfPasses + x.opp.oppHalfPasses,
      ),
    info: "Part des passes jouées dans le camp adverse par les deux équipes qui revient au club : qui joue chez l’autre.",
  },
  boxShare: {
    label: "Part des ballons dans les surfaces",
    family: "control",
    better: 1,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.touchesBox,
        (x) => x.own.touchesBox + x.opp.touchesBox,
      ),
  },
  directness: {
    label: "Jeu long (part des longs ballons)",
    family: "control",
    better: 0,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.longBalls,
        (x) => x.own.passesAccurate,
      ),
    info: "Longs ballons réussis rapportés aux passes réussies : plus la part est haute, plus le jeu est direct.",
  },
  crosses: {
    label: "Centres réussis / match",
    family: "control",
    better: 0,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.crosses),
  },
  ppda: {
    label: "PPDA (approx.)",
    family: "pressing",
    better: -1,
    digits: 1,
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.opp.ownHalfPasses,
        (x) => x.own.tackles + x.own.interceptions + x.own.fouls,
        1,
      ),
    info: "Passes adverses dans leur propre moitié par action défensive (tacle, interception, faute). Bas = pressing plus agressif. Approximation : la zone des actions défensives n’est pas publiée.",
  },
  defActions: {
    label: "Tacles + interceptions (ajusté poss.)",
    family: "pressing",
    better: 0,
    digits: 1,
    get: (r) =>
      mean(r.filter(has), (x) =>
        x.own.possession != null && x.own.possession < 100
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
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.duels,
        (x) => x.own.duels + x.opp.duels,
      ),
  },
  aerials: {
    label: "Duels aériens gagnés",
    family: "pressing",
    better: 1,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.aerials,
        (x) => x.own.aerials + x.opp.aerials,
      ),
  },
  fouls: {
    label: "Fautes / match",
    family: "pressing",
    better: 0,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.fouls),
  },
  xgSet: {
    label: "xG sur coups de pied arrêtés / match",
    family: "setpieces",
    better: 1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.own.xgSet),
  },
  xgSetAgainst: {
    label: "xG concédés sur CPA / match",
    family: "setpieces",
    better: -1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.opp.xgSet),
  },
  setShare: {
    label: "Part des CPA dans les xG",
    family: "setpieces",
    better: 0,
    digits: 1,
    unit: "%",
    get: (r) =>
      ratio(
        r.filter(has),
        (x) => x.own.xgSet,
        (x) => x.own.xg,
      ),
  },
  corners: {
    label: "Corners / match",
    family: "setpieces",
    better: 1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.own.corners),
  },
  cornersAgainst: {
    label: "Corners concédés / match",
    family: "setpieces",
    better: -1,
    digits: 1,
    get: (r) => mean(r.filter(has), (x) => x.opp.corners),
  },
  yellow: {
    label: "Cartons jaunes / match",
    family: "discipline",
    better: -1,
    digits: 2,
    get: (r) => mean(r.filter(has), (x) => x.own.yellow),
  },
  red: {
    label: "Cartons rouges",
    family: "discipline",
    better: -1,
    digits: 0,
    total: true,
    get: (r) => sum(r.filter(has), (x) => x.own.red).total,
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

const SITUATIONS = {
  RegularPlay: "open",
  IndividualPlay: "open",
  FastBreak: "fastBreak",
  FromCorner: "corner",
  SetPiece: "setPiece",
  FreeKick: "freeKick",
  Penalty: "penalty",
};
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

function shotProfile(rows, clubId) {
  const empty = () =>
    Object.fromEntries(
      Object.keys(SITUATION_LABELS).map((k) => [
        k,
        { shots: 0, xg: 0, goals: 0 },
      ]),
    );
  const out = {
    for: empty(),
    against: empty(),
    mapFor: [],
    mapAgainst: [],
    matches: 0,
  };
  for (const row of rows) {
    const shots = row.match.shots || [];
    if (!shots.length) continue;
    out.matches++;
    for (const shot of shots) {
      if (shot.isOwnGoal) continue;
      const mine = shot.teamId === clubId;
      const bucket = (mine ? out.for : out.against)[
        SITUATIONS[shot.situation] || "open"
      ];
      bucket.shots++;
      bucket.xg += num(shot.xg) || 0;
      if (shot.isGoal) bucket.goals++;
      if (num(shot.x) != null && num(shot.y) != null)
        (mine ? out.mapFor : out.mapAgainst).push({
          id: shot.id,
          x: Math.round((105 - shot.x) * 10) / 10,
          y: shot.y,
          xg: num(shot.xg) || 0.01,
          outcome: shotOutcome(shot),
          player: shot.playerName,
          minute: shot.minute,
          situation: SITUATION_LABELS[SITUATIONS[shot.situation] || "open"],
          opponent: row.opponent.name,
          date: row.match.date,
        });
    }
  }
  return out;
}

/** Goal timeline per match, kept only when it reproduces the final score. */
function gameStates(rows, clubId) {
  const out = {
    matches: 0,
    scoredFirst: { matches: 0, points: 0, w: 0, d: 0, l: 0 },
    concededFirst: { matches: 0, points: 0, w: 0, d: 0, l: 0 },
    goalless: 0,
    pointsFromBehind: 0,
    pointsDropped: 0,
    minutes: { lead: 0, level: 0, behind: 0 },
    comebacks: [],
    collapses: [],
  };
  for (const row of rows) {
    const goals = (row.match.shots || [])
      .filter((s) => s.isGoal || s.isOwnGoal)
      .map((s) => ({
        minute: (num(s.minute) || 0) + (num(s.minuteAdded) || 0) / 100,
        mine: s.isOwnGoal ? s.teamId !== clubId : s.teamId === clubId,
      }))
      .sort((a, b) => a.minute - b.minute);
    if (
      goals.filter((g) => g.mine).length !== row.gf ||
      goals.filter((g) => !g.mine).length !== row.ga
    )
      continue;
    out.matches++;
    let diff = 0,
      last = 0,
      led = false,
      trailed = false;
    const end = Math.max(93, ...goals.map((g) => g.minute + 1));
    for (const goal of goals) {
      const span = goal.minute - last;
      out.minutes[diff > 0 ? "lead" : diff < 0 ? "behind" : "level"] += span;
      last = goal.minute;
      diff += goal.mine ? 1 : -1;
      if (diff > 0) led = true;
      if (diff < 0) trailed = true;
    }
    out.minutes[diff > 0 ? "lead" : diff < 0 ? "behind" : "level"] +=
      end - last;
    if (!goals.length) out.goalless++;
    else {
      const bucket = goals[0].mine ? out.scoredFirst : out.concededFirst;
      bucket.matches++;
      bucket.points += row.points;
      bucket[row.result === "V" ? "w" : row.result === "N" ? "d" : "l"]++;
    }
    if (trailed && row.points) {
      out.pointsFromBehind += row.points;
      out.comebacks.push(row);
    }
    if (led && row.points < 3) {
      out.pointsDropped += 3 - row.points;
      out.collapses.push(row);
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

function buildCohort({ league, cohortClubs, summaries, scope = null }) {
  const clubs = cohortClubs
    .map((club) => {
      const read = summaries.get(club.id);
      const rows = read
        ? teamRows(read.matches, club.id, scope || league?.id)
        : [];
      const xpts = rows.filter(has).reduce((t, x) => t + x.xpts, 0);
      return {
        id: club.id,
        name: club.name,
        imageUrl: club.imageUrl,
        country: club.country,
        league: club.league || league,
        rows,
        record: record(rows),
        xptsTotal: xpts,
        values: clubValues(rows),
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
  [...clubs]
    .sort((a, b) => per(b, b.xptsTotal) - per(a, a.xptsTotal))
    .forEach((club, i) => (club.xptsPosition = i + 1));
  const distributions = Object.fromEntries(
    Object.keys(METRICS).map((key) => [
      key,
      clubs.map((club) => club.values[key]).filter((v) => v != null),
    ]),
  );
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
        if (v == null) return [key, null];
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
      const sorted = [...distributions[key]].sort((a, b) => a - b);
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
  const copy = (club) => ({
    id: club.id,
    name: club.name,
    imageUrl: club.imageUrl,
    country: club.country,
    league: club.league,
    rows: club.rows,
    record: club.record,
    xptsTotal: club.xptsTotal,
    values: club.values,
    strength: club.strength ?? null,
    leaguePosition: club.leaguePosition ?? null,
    leagueXptsPosition: club.leagueXptsPosition ?? null,
    coefficient: club.coefficient ?? null,
  });
  const clubs = [...pool.values()]
    .filter((club) => club.id !== dossier.id)
    .map(copy)
    .concat(copy(own || dossier.self));
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

function buildDossier({ id, season, data, competitions, league, cohort }) {
  const summary = clubSummary(data, id);
  const allRows = teamRows(data.matches, id);
  const leagueRows = league ? teamRows(data.matches, id, league.id) : allRows;
  const squad = clubSquad(data, summary);
  const fallback = buildCohort({
    league,
    cohortClubs: [{ id, name: summary.name, imageUrl: summary.imageUrl }],
    summaries: new Map([[id, data]]),
  });
  const { clubs, stats } = cohort?.clubs.some((club) => club.id === id)
    ? cohort
    : fallback;
  const self = clubs.find((club) => club.id === id) || {
    id,
    name: summary.name,
    imageUrl: summary.imageUrl,
    rows: leagueRows,
    record: record(leagueRows),
    values: clubValues(leagueRows),
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

/** Clubs whose style centiles sit closest, with the axes they share. */
export function similarClubs(dossier, limit = 6, pool = dossier.clubs) {
  const keys = [
    "possession",
    "fieldTilt",
    "directness",
    "ppda",
    "crosses",
    "setShare",
    "defActions",
    "xg",
    "xga",
    "passAccuracy",
  ];
  const own = dossier.self;
  return pool
    .filter((club) => club.id !== own.id)
    .map((club) => {
      const parts = keys
        .filter((k) => own.centiles[k] != null && club.centiles[k] != null)
        .map((k) => ({
          key: k,
          distance: Math.abs(own.centiles[k] - club.centiles[k]),
        }));
      const distance =
        parts.reduce((t, p) => t + p.distance, 0) / Math.max(1, parts.length);
      return {
        club,
        similarity: Math.round(100 - distance),
        parts: parts.sort((a, b) => a.distance - b.distance),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

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

/** Opponent strength for the calendar: league centile of its xG difference. */
export function opponentStrength(dossier, opponentId) {
  const club = dossier.clubs.find((c) => c.id === opponentId);
  if (!club) return null;
  const diff = (c) => (c.values.xg ?? 0) - (c.values.xga ?? 0);
  const values = dossier.clubs.map(diff);
  return { club, centile: centile(values, diff(club), 1) };
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
