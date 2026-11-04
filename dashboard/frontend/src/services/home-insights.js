import { parisDay, shiftDay, validDay } from "./fixtures.js";
import { FEATURED_CLUB_IDS } from "./home.js";
import { knockoutStage } from "./knockout-bracket.js";
import { SIMPLE_LEAGUES } from "./competition-standings.js";
import { rankSeasonPlayers } from "./player-leaderboard.js";

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
const dayOf = (record) =>
  typeof record?.date === "string" ? record.date.slice(0, 10) : "";
const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Time of a match or fixture: an explicit UTC timestamp, else noon on its date. */
export function kickoffTime(record) {
  const value = record?.timeUtc || record?.time_utc;
  const time =
    typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      ? Date.parse(value)
      : NaN;
  if (Number.isFinite(time)) return time;
  const day = dayOf(record);
  return validDay(day) ? Date.parse(day + "T12:00:00Z") : NaN;
}
export const finishedMatch = (match) =>
  match &&
  match.status !== "not_started" &&
  match.finished !== false &&
  hasScore(match.home?.score) &&
  hasScore(match.away?.score);

/**
 * The home shows the latest played week of the selection: the seven Paris days
 * ending on the last finished match. On a past or quiet season it stays on the
 * last week that has results instead of turning empty.
 */
export function matchdayWindow(matches, now, days = 7) {
  let latest = -Infinity;
  for (const match of matches || []) {
    if (!finishedMatch(match)) continue;
    const time = kickoffTime(match);
    if (Number.isFinite(time) && time <= now && time > latest) latest = time;
  }
  if (!Number.isFinite(latest)) return null;
  const end = parisDay(latest);
  return {
    start: shiftDay(end, 1 - days),
    end,
    current: end >= shiftDay(parisDay(now), -days),
  };
}
export function inWindow(record, window) {
  const day = dayOf(record);
  return (
    Boolean(window) && validDay(day) && day >= window.start && day <= window.end
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

/** Best rated performance per player in the window, 60 minutes or more. */
export function weekPerformances(appearances, window, minMinutes = 60) {
  const best = new Map();
  for (const row of appearances || []) {
    if (
      !inWindow(row, window) ||
      !(row.minutes >= minMinutes) ||
      !Number.isFinite(row.rating)
    )
      continue;
    const previous = best.get(row.playerId);
    if (!previous || row.rating > previous.rating) best.set(row.playerId, row);
  }
  return [...best.values()].sort(
    (a, b) =>
      b.rating - a.rating ||
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
          ratingSum: 0,
          ratingMinutes: 0,
        }),
      );
    p.apps++;
    p.minutes += row.minutes;
    p.goals += row.goals || 0;
    p.assists += row.assists || 0;
    p.xg += Number.isFinite(row.xg) ? row.xg : 0;
    p.xa += Number.isFinite(row.xa) ? row.xa : 0;
    if (Number.isFinite(row.rating)) {
      p.ratingSum += row.rating * row.minutes;
      p.ratingMinutes += row.minutes;
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
    rating: p.ratingMinutes ? p.ratingSum / p.ratingMinutes : null,
  }));
}
export function seasonLeaders(totals) {
  const top = (list, compare, n = 5) => [...list].sort(compare).slice(0, n);
  const maxMinutes = Math.max(0, ...totals.map((p) => p.minutes));
  const ratedMin = Math.max(450, Math.round(maxMinutes * 0.4));
  return {
    goals: rankSeasonPlayers(totals, "goals").slice(0, 10),
    assists: rankSeasonPlayers(totals, "assists").slice(0, 10),
    clinical: rankSeasonPlayers(totals, "clinical").slice(0, 8),
    wasteful: rankSeasonPlayers(totals, "wasteful").slice(0, 8),
    rating: top(
      totals.filter((p) => p.rating != null && p.minutes >= ratedMin),
      (a, b) => b.rating - a.rating,
      10,
    ),
    ratedMin,
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

/** Ratings of a player's last games of the season, oldest first. */
export function recentRatings(appearances, playerId, season, count = 6) {
  return (appearances || [])
    .filter(
      (row) =>
        row.playerId === playerId &&
        row.minutes > 0 &&
        Number.isFinite(row.rating) &&
        inSeason(row, season),
    )
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(-count);
}

const parisClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
/** Milliseconds until the next midnight in Paris. */
export function untilParisMidnight(now) {
  const [h, m, s] = parisClock.format(new Date(now)).split(":").map(Number);
  return ((24 - h) * 3600 - m * 60 - s) * 1000;
}
/** Identity of the published data: changes when any season chunk changes. */
export const manifestSignature = (manifest) =>
  JSON.stringify(
    (manifest?.seasons || []).map((season) => [
      season.id,
      (season.chunks || []).map((c) => c.sourceDigest || c.sha256 || c.path),
    ]),
  );
