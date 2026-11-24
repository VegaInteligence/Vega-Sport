import { fixtureWeek, parisDay, shiftDay, validDay } from "./fixtures.js";
import { FEATURED_CLUB_IDS } from "./home.js";
import { knockoutStage } from "./knockout-bracket.js";
import { SIMPLE_LEAGUES } from "./competition-standings.js";
import { rankSeasonPlayers } from "./player-leaderboard.js";
import { GRADE_SEASON_MINUTES, gradeOf } from "./grades.js";
import { HOME_PRIORITY, isLocal } from "./home-priority.js";
import { involvesFavourite, preferenceOrder } from "./preference-effects.js";
import { ahead } from "./home-upcoming.js";
import { LIVE_SPAN_MS } from "./live-client.js";
import { matchForecast } from "./cup-matches.js";

export const CHAMPIONS_LEAGUE_ID = "l_0bfbkO";
export const EUROPA_LEAGUE_ID = "l_38d9HA";
export const CONFERENCE_LEAGUE_ID = "l_2WZ2tt";
export const UEFA_IDS = [
  CHAMPIONS_LEAGUE_ID,
  EUROPA_LEAGUE_ID,
  CONFERENCE_LEAGUE_ID,
];
/** Premier League, LaLiga, Bundesliga, Serie A, Ligue 1. */
export const TOP_FIVE_IDS = [
  "l_4WFCIZ",
  "l_0ErfuF",
  "l_1Isor4",
  "l_0ALvwF",
  "l_3FJFUl",
];
/** The seven domestic leagues of the Top 7 Europe scope, in display order. */
export const TOP_SEVEN_IDS = [...TOP_FIVE_IDS, "l_4QexZg", "l_4H43wr"];
const PRESTIGE_IDS = new Set([...TOP_FIVE_IDS, ...UEFA_IDS]);
const SHORT_NAMES = {
  l_4WFCIZ: "PL",
  l_0ErfuF: "LIGA",
  l_1Isor4: "BUN",
  l_0ALvwF: "SA",
  l_3FJFUl: "L1",
  l_4QexZg: "POR",
  l_4H43wr: "ERE",
  l_0bfbkO: "LDC",
  l_38d9HA: "LE",
  l_2WZ2tt: "LC",
};

export const leagueOf = (record) =>
  record?.leagueId || record?.league?.id || "";
export const shortCompetition = (id, name = "") =>
  SHORT_NAMES[id] ||
  String(name)
    .replace(/[^A-Za-zÀ-ÿ0-9 ]/g, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
const hasScore = (value) => Number.isInteger(value) && value >= 0;
const explicitKickoff = (record) => {
  const value = record?.timeUtc || record?.time_utc;
  return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? Date.parse(value)
    : NaN;
};
export const matchDay = (record) => {
  const time = explicitKickoff(record);
  return Number.isFinite(time)
    ? parisDay(time)
    : typeof record?.date === "string"
      ? record.date.slice(0, 10)
      : "";
};
const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Time of a match or fixture: an explicit UTC timestamp, else noon on its date. */
export function kickoffTime(record) {
  const time = explicitKickoff(record);
  if (Number.isFinite(time)) return time;
  const day = matchDay(record);
  return validDay(day) ? Date.parse(day + "T12:00:00Z") : NaN;
}
export const finishedMatch = (match) =>
  match &&
  (match.status === "finished" ||
    (match.status == null && match.finished === true)) &&
  match.finished !== false &&
  hasScore(match.home?.score) &&
  hasScore(match.away?.score);

// Mirrors LATEST_WEEK_DAYS in backend/services/relational-home.js.
export const LATEST_WEEK_DAYS = 14;

/**
 * Live widgets follow the current Monday–Sunday in Paris. While that week has
 * no result yet (Monday morning, international breaks), they keep the latest
 * week with results, flagged `latest`, if it is under LATEST_WEEK_DAYS old;
 * otherwise the empty current week. An archive uses its last played week.
 * Calendar days, rather than 7 × 24 hours, preserve the boundaries across DST.
 */
export function matchdayWindow(matches, now, { archive = false } = {}) {
  let last = -Infinity;
  for (const match of matches || []) {
    if (!finishedMatch(match)) continue;
    const time = kickoffTime(match);
    if (Number.isFinite(time) && time <= now && time > last) last = time;
  }
  if (archive && !Number.isFinite(last)) return null;
  const today = parisDay(now),
    lastDay = Number.isFinite(last) ? parisDay(last) : "";
  const latest =
    !archive &&
    Boolean(lastDay) &&
    lastDay < fixtureWeek(today).start &&
    lastDay > shiftDay(today, -LATEST_WEEK_DAYS);
  return {
    ...fixtureWeek(archive || latest ? lastDay : today),
    current: !archive,
    latest,
    asOf: now,
    asOfDay: today,
  };
}

/** A calendar-year season may still be active beside a split-year season. */
export function archiveSeason(season, defaultSeason, now) {
  return Boolean(
    season &&
    defaultSeason &&
    season < defaultSeason &&
    season !== parisDay(now).slice(0, 4),
  );
}

const periodFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
export function weekPeriodLabel(period) {
  if (!period || !validDay(period.start) || !validDay(period.end)) return "";
  return periodFormat.formatRange(
    new Date(period.start + "T12:00:00Z"),
    new Date(period.end + "T12:00:00Z"),
  );
}

export function inWindow(record, window) {
  const day = matchDay(record),
    time = explicitKickoff(record);
  return (
    Boolean(window) &&
    validDay(day) &&
    day >= window.start &&
    day <= window.end &&
    (!Number.isFinite(window.asOf) ||
      (day <= (window.asOfDay || parisDay(window.asOf)) &&
        (!Number.isFinite(time) || time <= window.asOf)))
  );
}
export function weekResults(matches, window) {
  return (matches || [])
    .filter((m) => finishedMatch(m) && inWindow(m, window))
    .sort(
      (a, b) =>
        kickoffTime(b) - kickoffTime(a) ||
        String(a.id).localeCompare(String(b.id)),
    );
}

const featuredCount = (match) =>
  Number(FEATURED_CLUB_IDS.has(match.home?.id)) +
  Number(FEATURED_CLUB_IDS.has(match.away?.id));
/** Editorial weight of a match: big clubs, the Champions League, Top 5 leagues and the top of the tables. */
export function matchWeight(match, ranks = new Map()) {
  const league = leagueOf(match),
    home = match.home || match.home_team,
    away = match.away || match.away_team;
  const rank = (team) => ranks.get(team?.id)?.rank;
  return (
    2 *
      (Number(FEATURED_CLUB_IDS.has(home?.id)) +
        Number(FEATURED_CLUB_IDS.has(away?.id))) +
    (league === CHAMPIONS_LEAGUE_ID ? 3 : UEFA_IDS.includes(league) ? 1 : 0) +
    (TOP_FIVE_IDS.includes(league) ? 1 : 0) +
    (rank(home) <= 3 ? 1 : 0) +
    (rank(away) <= 3 ? 1 : 0)
  );
}

// The national teams' tournaments, as International Results names them, in short French (the week strip's label).
const INTERNATIONAL_LABELS = {
  Friendly: "Amical",
  "UEFA Nations League": "LN UEFA",
  "CONCACAF Nations League": "LN CONCACAF",
  "African Cup of Nations qualification": "Qualif. CAN",
  "FIFA World Cup qualification": "Qualif. CM",
  "UEFA Euro qualification": "Qualif. Euro",
  "AFC Asian Cup qualification": "Qualif. Asie",
  "CONCACAF Gold Cup qualification": "Qualif. Gold Cup",
};
/** A national result's tournament in the strip; one without a short name as the source writes it. */
export const internationalLabel = (tournament) =>
  INTERNATIONAL_LABELS[tournament] || tournament || "International";

/**
 * The week strip: each day the national teams' results first, in the API's order (their two sides' Elo; during an
 * international break they are the week's news), then the clubs' by their weight; eight a day, the four latest days
 * of both lists. The visitor's country (home-priority.js, `leagues`: its competitions, null without one): under
 * "location" its results lead the clubs of each day, before the cut; under "importance" it only breaks ties.
 */
export function weekTicker(results, internationals = [], ranks = new Map(), { leagues = null, priority = HOME_PRIORITY, favourites = null } = {}) {
  // Effect 1 (preference-effects.js): a favourite club's result leads its day, then the priority's order.
  const clubOrder = preferenceOrder({
    favourite: (m) => involvesFavourite(m, favourites),
    local: (m) => isLocal(m, leagues),
    weight: (a, b) => matchWeight(b, ranks) - matchWeight(a, ranks),
    priority,
  });
  const days = new Map();
  const day = (key) =>
    days.get(key) ||
    days.set(key, { day: key, nations: [], clubs: [] }).get(key);
  for (const m of internationals)
    day(m.date).nations.push({ ...m, national: true });
  for (const m of results) day(matchDay(m)).clubs.push(m);
  return [...days.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 4)
    .map(({ day, nations, clubs }) => ({
      day,
      matches: [
        ...nations,
        ...clubs.sort(clubOrder),
      ].slice(0, 8),
    }));
}

// Statuses after which a match is no longer under way, whatever its kick-off.
const OVER = new Set(["finished", "postponed", "canceled", "abandoned"]);
/**
 * A match of the strip that is not a result, at `now`: "upcoming" while its kick-off is ahead and the feed has not
 * started it (the « À l'affiche » rule, home-upcoming.js), then "live" when the feed says in_play or, the feed still
 * saying not started, during the live window after kick-off (live-client.js); else null (over, or stale).
 */
export function tickState(record, now) {
  if (ahead(record, now)) return "upcoming";
  const status = record?.fixture?.status;
  if (status === "in_play") return "live";
  if (OVER.has(status) || !Number.isFinite(record?.time)) return null;
  return record.time < now && now <= record.time + LIVE_SPAN_MS ? "live" : null;
}

/**
 * The home's strip (« le bandeau »), results and matches to come (doc "Accueil", « Le bandeau »). `upcoming`:
 * { billboard, matches, local, window } (the common read's billboard and billboardWindow, the favourites' matches of
 * the personal read, the country's candidates of localMatches), or null (archived season, older API).
 * - Nothing to come or in play: exactly weekTicker's days (newest first), no anchor: the strip of before.
 * - Otherwise days oldest first: weekTicker's result days, as they are; then, from today to the window's end, the
 *   matches in play and to come, one record per fixture (billboard first, then favourites', then the country's; a
 *   match among the results keeps its results record), up to 8 a day chosen by the one rule (preferenceOrder:
 *   favourite clubs, then the country under `priority`, then the served weight), shown after the day's results:
 *   in play first, then by kick-off, then weight. `anchor`: the id of the first tick that is not finished.
 */
export function scoreboardTicker(
  results,
  internationals = [],
  ranks = new Map(),
  { leagues = null, priority = HOME_PRIORITY, favourites = null, upcoming = null, now = Date.now() } = {},
) {
  const past = weekTicker(results, internationals, ranks, { leagues, priority, favourites });
  const none = { days: past, anchor: null, ahead: false };
  if (!upcoming || !Array.isArray(upcoming.billboard)) return none;
  const today = parisDay(now);
  const end =
    upcoming.window?.end ||
    upcoming.billboard.reduce((last, m) => (typeof m?.day === "string" && m.day > last ? m.day : last), today);
  const known = new Set([...(results || []), ...(internationals || [])].map((m) => m.id));
  const seen = new Set(),
    byDay = new Map();
  for (const m of [...upcoming.billboard, ...(upcoming.matches || []), ...(upcoming.local || [])]) {
    const id = m?.fixture?.id;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    if (known.has(id)) continue;
    const tick = tickState(m, now);
    if (!tick) continue;
    const day = typeof m.day === "string" ? m.day : parisDay(m.time);
    if (day > end || (tick === "upcoming" && day < today)) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ ...m, id, tick });
  }
  if (!byDay.size) return none;
  const heavier = (a, b) => (b.weight ?? 0) - (a.weight ?? 0);
  const rule = preferenceOrder({
    favourite: (m) => involvesFavourite(m, favourites),
    local: (m) => isLocal(m, leagues),
    weight: heavier,
    priority,
  });
  const choice = (a, b) => rule(a, b) || a.time - b.time || String(a.id).localeCompare(String(b.id));
  const shown = (a, b) =>
    Number(b.tick === "live") - Number(a.tick === "live") || a.time - b.time || heavier(a, b) || String(a.id).localeCompare(String(b.id));
  const days = new Map(past.map((d) => [d.day, { day: d.day, matches: [...d.matches] }]));
  for (const [day, list] of byDay) {
    const picked = list.sort(choice).slice(0, 8).sort(shown);
    if (days.has(day)) days.get(day).matches.push(...picked);
    else days.set(day, { day, matches: picked });
  }
  const ordered = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const anchor = ordered.flatMap((d) => d.matches).find((m) => m.tick)?.id ?? null;
  return { days: ordered, anchor, ahead: true };
}

/**
 * A strip tick's pre-match forecast (doc "Accueil", « Le bandeau »): the record's own `forecast` (the billboard's and
 * the country's records; it stays the pre-match one while the match is played), else its fixture's; as whole
 * percentages of home, draw, away that sum to 100 (largest remainder; a tie goes to home, then draw, then away).
 * Null without a valid forecast (matchForecast: three shares in [0, 1] summing to about 1).
 */
export function tickForecast(m) {
  const f = matchForecast(m?.forecast) || matchForecast(m?.fixture?.forecast);
  if (!f) return null;
  const sides = ["home", "draw", "away"],
    total = f.home + f.draw + f.away,
    exact = sides.map((side) => (f[side] / total) * 100),
    whole = exact.map(Math.floor);
  let left = 100 - whole.reduce((a, b) => a + b, 0);
  for (const i of [0, 1, 2].sort((a, b) => exact[b] - whole[b] - (exact[a] - whole[a]) || a - b)) if (left-- > 0) whole[i]++;
  return { home: whole[0], draw: whole[1], away: whole[2] };
}

/** The week's showcase: a meeting of big clubs, ideally near the top of the table. */
export function selectMatchOfTheWeek(results, ranks = new Map()) {
  let best = null,
    bestScore = -Infinity;
  for (const match of results || []) {
    const clubs = featuredCount(match);
    const rh = ranks.get(match.home?.id)?.rank,
      ra = ranks.get(match.away?.id)?.rank;
    const score =
      clubs * 4 +
      (rh && rh <= 4 ? 2 : 0) +
      (ra && ra <= 4 ? 2 : 0) +
      (rh && ra && Math.max(rh, ra) <= 3 ? 2 : 0) +
      (leagueOf(match) === CHAMPIONS_LEAGUE_ID ? 3 : 0) +
      (TOP_FIVE_IDS.includes(leagueOf(match)) ? 1 : 0) +
      (match.shots?.length ? 1 : 0);
    if (
      score > bestScore ||
      (score === bestScore && kickoffTime(match) > kickoffTime(best))
    ) {
      best = match;
      bestScore = score;
    }
  }
  return best;
}

const shotSide = (shot, match) =>
  shot.teamId === match.home?.id
    ? "home"
    : shot.teamId === match.away?.id
      ? "away"
      : null;
/**
 * Cumulative expected goals of both teams over the match and the goals on
 * that line. An own goal adds no xG and counts for the other side.
 */
export function xgTimeline(match) {
  const shots = [...(match?.shots || [])]
    .filter((s) => shotSide(s, match) && Number.isFinite(s.minute))
    .sort((a, b) => a.minute - b.minute);
  const lines = { home: [[0, 0]], away: [[0, 0]] },
    total = { home: 0, away: 0 },
    goals = [],
    events = [];
  for (const shot of shots) {
    const side = shotSide(shot, match),
      minute = Math.max(0, shot.minute);
    if (!shot.isOwnGoal && Number.isFinite(shot.xg)) {
      lines[side].push([minute, total[side]]);
      total[side] += shot.xg;
      lines[side].push([minute, total[side]]);
      events.push({
        id: shot.id || "",
        side,
        minute,
        xg: shot.xg,
        total: total[side],
        player: shot.playerName || "",
        playerId: shot.playerId || "",
        outcome: shotOutcome(shot),
      });
    }
    if (shot.isGoal || shot.isOwnGoal) {
      const scorer = shot.isOwnGoal
        ? side === "home"
          ? "away"
          : "home"
        : side;
      goals.push({
        side: scorer,
        minute,
        player: shot.playerName || "",
        playerId: shot.playerId || "",
        shotId: shot.id || "",
        ownGoal: Boolean(shot.isOwnGoal),
        penalty: shot.situation === "Penalty",
        xg: total[scorer],
      });
    }
  }
  const end = Math.max(90, ...shots.map((s) => s.minute));
  lines.home.push([end, total.home]);
  lines.away.push([end, total.away]);
  return { lines, total, goals, events, end };
}
const SITUATIONS = {
  RegularPlay: "Jeu placé",
  FastBreak: "Contre-attaque",
  SetPiece: "Coup de pied arrêté",
  FromCorner: "Sur corner",
  FreeKick: "Coup franc direct",
  Penalty: "Penalty",
};
const BODY_PARTS = {
  RightFoot: "pied droit",
  LeftFoot: "pied gauche",
  Header: "de la tête",
  OtherBodyParts: "autre surface",
};
export function shotOutcome(shot) {
  if (shot.isOwnGoal) return "Contre son camp";
  if (shot.isGoal) return "But";
  if (shot.type === "Post") return "Sur le poteau";
  if (shot.isBlocked) return "Contré";
  if (shot.type === "AttemptSaved" || shot.isOnTarget)
    return shot.isOnTarget === false ? "Contré" : "Arrêté";
  return "Non cadré";
}
/** Shots placed on one pitch: the home team attacks left, the visitors right. */
export function shotMapPoints(match) {
  return (match?.shots || [])
    .filter(
      (s) =>
        !s.isOwnGoal &&
        shotSide(s, match) &&
        Number.isFinite(s.x) &&
        Number.isFinite(s.y),
    )
    .map((s) => {
      const home = shotSide(s, match) === "home",
        flip = (x, y) => (home ? [105 - x, 68 - y] : [x, y]);
      // The real end of the shot: where it was blocked, else where it crossed the goal line.
      const end =
        s.isBlocked &&
        Number.isFinite(s.blockedX) &&
        Number.isFinite(s.blockedY)
          ? flip(s.blockedX, s.blockedY)
          : Number.isFinite(s.goalCrossedY)
            ? flip(105, s.goalCrossedY)
            : null;
      return {
        side: home ? "home" : "away",
        x: home ? 105 - s.x : s.x,
        y: home ? 68 - s.y : s.y,
        end,
        measured: Boolean(end),
        height:
          Number.isFinite(s.goalCrossedZ) && !s.isBlocked
            ? s.goalCrossedZ
            : null,
        xg: Number.isFinite(s.xg) ? s.xg : 0,
        goal: Boolean(s.isGoal),
        minute: s.minute,
        player: s.playerName || "",
        playerId: s.playerId || "",
        id: s.id || "",
        outcome: shotOutcome(s),
        situation: SITUATIONS[s.situation] || "",
        body: BODY_PARTS[s.shotType] || "",
      };
    });
}

/**
 * Result-derived league tables with the order of standingsFromFixtures, plus
 * each club's points after every game, recent form and current winning run.
 */
export function leagueProgress(fixtures, leagueIds) {
  const wanted = leagueIds ? new Set(leagueIds) : null,
    byLeague = new Map(),
    seen = new Map();
  for (const fixture of fixtures || []) {
    const league = leagueOf(fixture);
    if (
      !fixture?.id ||
      !SIMPLE_LEAGUES.has(league) ||
      (wanted && !wanted.has(league))
    )
      continue;
    const previous = seen.get(fixture.id);
    if (
      previous &&
      !(previous.status !== "finished" && fixture.status === "finished")
    )
      continue;
    seen.set(fixture.id, fixture);
  }
  for (const fixture of seen.values()) {
    const league = leagueOf(fixture);
    if (!byLeague.has(league)) byLeague.set(league, []);
    byLeague.get(league).push(fixture);
  }
  const result = new Map();
  for (const [league, list] of byLeague) {
    const teams = new Map();
    const row = (team) => {
      if (!teams.has(team.id))
        teams.set(team.id, {
          id: team.id,
          name: team.name,
          imageUrl: team.image_url || team.imageUrl || "",
          leagueId: league,
          played: 0,
          points: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          results: [],
          cumulative: [],
          cleanSheets: 0,
        });
      return teams.get(team.id);
    };
    const finished = [];
    for (const f of list) {
      const home = f.home_team,
        away = f.away_team;
      if (!home?.id || !away?.id || home.id === away.id) continue;
      row(home);
      row(away);
      if (
        f.status === "finished" &&
        hasScore(f.score_home) &&
        hasScore(f.score_away)
      )
        finished.push(f);
    }
    finished.sort(
      (a, b) => kickoffTime(a) - kickoffTime(b) || a.id.localeCompare(b.id),
    );
    for (const f of finished) {
      for (const [team, gf, ga] of [
        [f.home_team, f.score_home, f.score_away],
        [f.away_team, f.score_away, f.score_home],
      ]) {
        const r = teams.get(team.id),
          outcome = gf > ga ? "W" : gf === ga ? "D" : "L";
        r.played++;
        r.goalsFor += gf;
        r.goalsAgainst += ga;
        r.points += outcome === "W" ? 3 : outcome === "D" ? 1 : 0;
        r.results.push(outcome);
        r.cumulative.push(r.points);
        if (ga === 0) r.cleanSheets++;
      }
    }
    const rows = [...teams.values()].map((r) => {
      let streak = 0;
      for (let i = r.results.length - 1; i >= 0 && r.results[i] === "W"; i--)
        streak++;
      return {
        ...r,
        difference: r.goalsFor - r.goalsAgainst,
        form: r.results.slice(-5),
        streak,
      };
    });
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.difference - a.difference ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name, "fr"),
    );
    rows.forEach((r, i) => (r.rank = i + 1));
    const games = Math.max(0, (rows.length - 1) * 2);
    result.set(league, {
      leagueId: league,
      rows,
      played: Math.max(0, ...rows.map((r) => r.played)),
      games,
    });
  }
  return result;
}
export function teamRanks(progress) {
  const ranks = new Map();
  for (const table of progress.values())
    for (const row of table.rows)
      if (!ranks.has(row.id)) ranks.set(row.id, row);
  return ranks;
}
/** Share of the Top 5 league seasons already played, from 0 to 1. */
export function seasonProgress(progress) {
  const tables = TOP_FIVE_IDS.map((id) => progress.get(id)).filter(
    (t) => t?.games,
  );
  const pool = tables.length
    ? tables
    : [...progress.values()].filter((t) => t.games);
  return pool.length
    ? sum(pool.map((t) => Math.min(1, t.played / t.games))) / pool.length
    : 0;
}
export function bestWinStreak(progress) {
  let best = null;
  for (const table of progress.values())
    for (const row of table.rows)
      if (
        row.streak >= 3 &&
        (!best ||
          row.streak > best.streak ||
          (row.streak === best.streak && row.rank < best.rank))
      )
        best = row;
  return best;
}

/** The meanest defence of the followed leagues, after at least five games. */
export function bestDefence(progress) {
  return bestDefences(progress, 1)[0] || null;
}

export function bestDefences(progress, limit = 3) {
  const rows = [];
  for (const table of progress.values())
    for (const row of table.rows) {
      if (row.played < 5) continue;
      const perGame = row.goalsAgainst / row.played;
      rows.push({ ...row, perGame });
    }
  const seen = new Set();
  return rows
    .sort((a, b) => a.perGame - b.perGame || b.cleanSheets - a.cleanSheets)
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .slice(0, limit);
}

/** Best Vega grade per player in the window, 60 minutes or more (by the normal score z). */
export function weekPerformances(
  appearances,
  window,
  minMinutes = 60,
  matches = null,
) {
  const best = new Map(),
    eligibleMatches = new Map();
  for (const row of appearances || []) {
    const match = matches?.get(row.matchId);
    if (matches && !eligibleMatches.has(row.matchId))
      eligibleMatches.set(
        row.matchId,
        Boolean(finishedMatch(match) && inWindow(match, window)),
      );
    if (
      (matches && !eligibleMatches.get(row.matchId)) ||
      (!matches && row.status != null && row.status !== "finished") ||
      row.finished === false ||
      (!matches && !inWindow(row, window)) ||
      !(row.minutes >= minMinutes) ||
      !Number.isFinite(row.gradeZ)
    )
      continue;
    const previous = best.get(row.playerId);
    if (!previous || row.gradeZ > previous.gradeZ) best.set(row.playerId, row);
  }
  return [...best.values()].sort(
    (a, b) =>
      b.gradeZ - a.gradeZ ||
      (b.goals || 0) - (a.goals || 0) ||
      String(a.name).localeCompare(String(b.name), "fr"),
  );
}
/** The player of the week comes from a Top 5 league or a European cup when the selection has one. */
export function playerOfTheWeek(performances) {
  return (
    performances.find((row) => PRESTIGE_IDS.has(row.leagueId)) ||
    performances[0] ||
    null
  );
}

const INTERNATIONAL = new Set(["INT", "INT-2", "UEFA", "WORLD"]);
/**
 * A season shows its own games. Calendar-year leagues keep their year label,
 * but an international tournament of another label, such as the World Cup
 * played before a split season, belongs to the previous season.
 */
export function inSeason(row, season) {
  return (
    !season ||
    !row?.season ||
    row.season === season ||
    !INTERNATIONAL.has(row.country)
  );
}
/** Season totals per player within the selection. */
export function seasonTotals(appearances, season) {
  const players = new Map();
  for (const row of appearances || []) {
    if (!(row.minutes > 0) || !inSeason(row, season)) continue;
    let p = players.get(row.playerId);
    if (!p)
      players.set(
        row.playerId,
        (p = {
          playerId: row.playerId,
          name: row.name,
          imageUrl: row.imageUrl,
          team: row.team,
          teamId: row.teamId,
          date: "",
          lastId: row.id,
          apps: 0,
          minutes: 0,
          goals: 0,
          assists: 0,
          xg: 0,
          xa: 0,
          xgMatches: 0,
          xaMatches: 0,
          gradeZm: 0,
          gradeMinutes: 0,
          gradeCount: 0,
        }),
      );
    p.apps++;
    p.minutes += row.minutes;
    p.goals += row.goals || 0;
    p.assists += row.assists || 0;
    if (Number.isFinite(row.xg)) {
      p.xg += row.xg;
      p.xgMatches++;
    }
    if (Number.isFinite(row.xa)) {
      p.xa += row.xa;
      p.xaMatches++;
    }
    // The season grade: the minutes-weighted mean z of his matches of 20 minutes or more.
    if (Number.isFinite(row.gradeZ) && row.minutes >= GRADE_SEASON_MINUTES) {
      p.gradeZm += row.gradeZ * row.minutes;
      p.gradeMinutes += row.minutes;
      p.gradeCount++;
    }
    // The club shown is the most recent domestic one: a European game keeps the same club.
    if ((row.date || "") >= p.date) {
      p.date = row.date || "";
      p.lastId = row.id;
      if (!UEFA_IDS.includes(row.leagueId) || !p.team) {
        p.team = row.team;
        p.teamId = row.teamId;
      }
    }
  }
  return [...players.values()].map((p) => ({
    ...p,
    // A season total must cover the same matches as goals/assists. A partial
    // xG sum is not zero and must not create a false finishing outperformance.
    xg: p.xgMatches === p.apps ? p.xg : null,
    xa: p.xaMatches === p.apps ? p.xa : null,
    grade: p.gradeMinutes ? gradeOf(p.gradeZm / p.gradeMinutes) : null,
  }));
}
export function seasonLeaders(totals) {
  const top = (list, compare, n = 5) => [...list].sort(compare).slice(0, n);
  const maxMinutes = Math.max(0, ...totals.map((p) => p.minutes));
  const gradedMin = Math.max(450, Math.round(maxMinutes * 0.4));
  return {
    goals: rankSeasonPlayers(totals, "goals").slice(0, 10),
    assists: rankSeasonPlayers(totals, "assists").slice(0, 10),
    clinical: rankSeasonPlayers(totals, "clinical").slice(0, 8),
    wasteful: rankSeasonPlayers(totals, "wasteful").slice(0, 8),
    grade: top(
      totals.filter((p) => p.grade != null && p.gradeMinutes >= gradedMin),
      (a, b) => b.grade - a.grade,
      10,
    ),
    gradedMin,
  };
}
export function biggestWin(results) {
  let best = null;
  for (const m of results || []) {
    const margin = Math.abs(m.home.score - m.away.score),
      goals = m.home.score + m.away.score;
    if (
      margin >= 3 &&
      (!best ||
        margin > best.margin ||
        (margin === best.margin && goals > best.goals))
    )
      best = { match: m, margin, goals };
  }
  return best;
}
export function weekTotals(results) {
  return {
    matches: results.length,
    goals: sum(results.map((m) => m.home.score + m.away.score)),
    xg: sum(
      results.map(
        (m) =>
          (Number.isFinite(m.home.xg) ? m.home.xg : 0) +
          (Number.isFinite(m.away.xg) ? m.away.xg : 0),
      ),
    ),
  };
}

/** Saved clubs plus the latest observed club of every saved player. */
export function personalClubIds(lists, appearances, season) {
  const clubs = new Set(),
    players = new Set(),
    latest = new Map();
  for (const list of lists || [])
    for (const entry of list.entries || []) {
      if (entry.kind === "clubs") clubs.add(entry.id);
      if (entry.kind === "players") players.add(entry.id);
    }
  for (const row of appearances || []) {
    if (
      !players.has(row.playerId) ||
      !row.teamId ||
      !row.date ||
      !(row.minutes > 0) ||
      !inSeason(row, season) ||
      (INTERNATIONAL.has(row.country) && !UEFA_IDS.includes(row.leagueId))
    )
      continue;
    const previous = latest.get(row.playerId);
    if (
      !previous ||
      row.date > previous.date ||
      (row.date === previous.date && row.id > previous.id)
    )
      latest.set(row.playerId, row);
  }
  for (const row of latest.values()) clubs.add(row.teamId);
  return clubs;
}

/** Within a day, personal European games precede personal domestic games. */
export const upcomingDayOrder = (a, b) =>
  a.day.localeCompare(b.day) ||
  b.personal - a.personal ||
  b.europePriority - a.europePriority ||
  a.time - b.time ||
  a.fixture.id.localeCompare(b.fixture.id);

/** Upcoming fixtures in scope: personal clubs first, then editorial choices. */
export function upcomingHighlights(
  fixtures,
  now,
  leagueIds,
  ranks = new Map(),
  days = 7,
  clubIds = new Set(),
) {
  const limit = now + days * 864e5,
    seen = new Set(),
    list = [];
  for (const f of fixtures || []) {
    if (
      !f?.id ||
      seen.has(f.id) ||
      f.status !== "not_started" ||
      (leagueIds && !leagueIds.has(leagueOf(f)))
    )
      continue;
    const time = kickoffTime(f);
    if (
      !Number.isFinite(time) ||
      time <= now ||
      time > limit ||
      !f.home_team?.name ||
      !f.away_team?.name
    )
      continue;
    seen.add(f.id);
    const personal = Number(
      clubIds.has(f.home_team.id) || clubIds.has(f.away_team.id),
    );
    const european = UEFA_IDS.indexOf(leagueOf(f));
    list.push({
      fixture: f,
      time,
      day: parisDay(time),
      personal,
      europePriority:
        personal && european >= 0 ? UEFA_IDS.length - european : 0,
      weight: matchWeight(f, ranks),
    });
  }
  return list.sort(
    (a, b) =>
      b.personal - a.personal ||
      (a.personal ? upcomingDayOrder(a, b) : 0) ||
      b.weight - a.weight ||
      a.time - b.time ||
      a.fixture.id.localeCompare(b.fixture.id),
  );
}

/**
 * The Ballon d'Or race opens on the home once every Champions League
 * quarter-final second leg is played. Round names come from the matchday
 * archive; a played semi-final or final also proves the quarters are over.
 */
export function ballonDorRaceOpen({
  fixtures = [],
  matches = [],
  rounds = {},
} = {}) {
  const games = new Map();
  for (const f of fixtures)
    if (leagueOf(f) === CHAMPIONS_LEAGUE_ID && f.id)
      games.set(f.id, f.status === "finished");
  for (const m of matches)
    if (leagueOf(m) === CHAMPIONS_LEAGUE_ID && m.id)
      games.set(m.id, games.get(m.id) || finishedMatch(m));
  const stages = { quarter: [], later: [] };
  for (const [id, finished] of games) {
    const stage = knockoutStage(rounds[id]?.name);
    if (stage === "quarter") stages.quarter.push(finished);
    else if (stage === "semi" || stage === "final") stages.later.push(finished);
  }
  if (stages.later.some(Boolean)) return true;
  return stages.quarter.length >= 8 && stages.quarter.every(Boolean);
}

/** Vega grades of a player's last games of the season, oldest first. */
export function recentGrades(appearances, playerId, season, count = 6) {
  return (appearances || [])
    .filter(
      (row) =>
        row.playerId === playerId &&
        row.minutes > 0 &&
        Number.isFinite(row.grade) &&
        inSeason(row, season),
    )
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(-count);
}
