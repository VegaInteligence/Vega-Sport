/**
 * What a report says of a player, a club or a match (the /rapport page, its six images and
 * its technical version): read from the API, built here once. The builders are pure; the
 * loader reads the API on the server (the proxy's origin).
 */
import { API_ORIGIN } from "../api-origin.js";

const ID = { player: /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/, club: /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/, match: /^m_(?:[A-Za-z0-9]{6}|v\d{7})$/ };
const SEASON = /^\d{4}\/\d{4}$/;
// A season grade as the site gives it: matches of 20 minutes or more (docs/calculs 08 § 5.7).
const GRADE_MINUTES = 20;
const BLOCKS = {
  finishing: "Finition", creation: "Création", progression: "Progression", defence: "Défense", retention: "Conservation",
  shot_stopping: "Arrêts", aerial: "Jeu aérien", depth: "Appels en profondeur", distribution: "Relance",
};

export function reportKind(id) {
  return Object.keys(ID).find((kind) => ID[kind].test(id || "")) || null;
}

/** The season in progress: from July, the one that starts that year. */
export function currentSeason(today = new Date()) {
  const year = today.getUTCFullYear();
  return today.getUTCMonth() >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const sum = (rows, key) => rows.reduce((total, row) => total + (num(row[key]) ?? 0), 0);
const round = (value, digits = 1) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const per90 = (value, minutes) => (minutes > 0 ? round((value * 90) / minutes, 2) : null);
/** A grade out of 100 from a standardised score (the Elo's form, four sd for ten to one). */
export const gradeOf = (z) => (z == null ? null : round(100 / (1 + 10 ** (-z / 4)), 1));

function seasonGrade(appearances) {
  const graded = appearances.filter((a) => num(a.gradeZ) != null && (a.minutes ?? 0) >= GRADE_MINUTES);
  const minutes = sum(graded, "minutes");
  if (!minutes) return { grade: null, graded: 0 };
  return { grade: gradeOf(graded.reduce((total, a) => total + a.minutes * a.gradeZ, 0) / minutes), graded: graded.length };
}

function sideOf(match, teamId) {
  if (!match) return null;
  const home = match.home?.id === teamId;
  const own = home ? match.home : match.away, other = home ? match.away : match.home;
  const scored = num(own?.score), conceded = num(other?.score);
  const result = scored == null || conceded == null ? null : scored > conceded ? "V" : scored < conceded ? "D" : "N";
  return { home, opponent: { id: other?.id, name: other?.name, imageUrl: other?.imageUrl || null }, scored, conceded, result,
    xgFor: num(own?.xg), xgAgainst: num(other?.xg) };
}

function age(birth, today) {
  if (!birth) return null;
  const b = new Date(`${birth}T00:00:00Z`);
  let years = today.getUTCFullYear() - b.getUTCFullYear();
  if (today.getUTCMonth() < b.getUTCMonth() || (today.getUTCMonth() === b.getUTCMonth() && today.getUTCDate() < b.getUTCDate())) years -= 1;
  return years;
}

// Player ---------------------------------------------------------------------

export function buildPlayerReport({ id, season, read, power, profile, values }, today = new Date()) {
  const data = read?.data || {};
  const matches = new Map((data.matches || []).map((m) => [m.id, m]));
  const apps = (data.appearances || []).filter((a) => a.playerId === id && (a.minutes ?? 0) > 0)
    .map((a) => ({ ...a, side: sideOf(matches.get(a.matchId), a.teamId), match: matches.get(a.matchId) || null }))
    .sort((a, b) => String(a.match?.date || "").localeCompare(String(b.match?.date || "")));
  const minutes = sum(apps, "minutes");
  const totals = Object.fromEntries(["goals", "assists", "xg", "xa", "shots", "shotsOnTarget", "chancesCreated", "bigChancesCreated", "passesAccurate",
    "duelsWon", "duelsLost", "tackles", "interceptions", "recoveries", "touchesBox", "passesFinalThird", "dribbles"].map((key) => [key, round(sum(apps, key), 2)]));
  const last = apps.at(-1);
  const p = power?.player || null;
  const person = profile?.data || {};
  const history = (values?.data?.history || []).filter((v) => num(v.valueEur) != null && v.date);
  const appearance = (a) => ({
    matchId: a.matchId, date: a.match?.date || null, league: a.league || a.match?.league || null, team: a.team,
    opponent: a.side?.opponent?.name || null, home: a.side?.home ?? null, result: a.side?.result || null,
    score: a.side && a.side.scored != null ? `${a.side.scored}-${a.side.conceded}` : null,
    minutes: a.minutes, grade: num(a.grade) == null ? null : round(a.grade, 1), goals: a.goals ?? 0, assists: a.assists ?? 0,
    xg: num(a.xg), xa: num(a.xa), shots: a.shots ?? 0, shotsOnTarget: a.shotsOnTarget ?? 0, chancesCreated: a.chancesCreated ?? 0,
    passesAccurate: a.passesAccurate ?? null, duelsWon: a.duelsWon ?? null, touches: a.touches ?? null,
  });
  const graded = apps.filter((a) => num(a.grade) != null && a.minutes >= GRADE_MINUTES);
  return {
    kind: "player", id, season, generatedAt: today.toISOString(),
    title: person.name || last?.name || "Joueur",
    player: {
      name: person.name || null, imageUrl: person.image_url || null, country: person.country_code || null,
      age: age(person.birth_date, today), birthDate: person.birth_date || null, heightCm: person.height_cm ?? null,
      foot: person.preferred_foot || null, contractUntil: person.observed_contract_until || null,
      team: last ? { id: last.teamId, name: last.team, league: last.league } : null,
      position: p?.position || null,
    },
    power: p ? { score: num(p.score), rank: p.rank ?? null, roleRank: p.roleRank ?? null, roleCount: p.roleCount ?? null, provisional: Boolean(p.provisional),
      blocks: Object.entries(p.blocks || {}).filter(([key]) => BLOCKS[key]).map(([key, b]) => ({ key, label: BLOCKS[key], percentile: num(b.percentile), contribution: num(b.contribution) })) } : null,
    seasonStats: { matches: apps.length, minutes, starts: apps.filter((a) => a.minutes >= 60).length, ...seasonGrade(apps), totals,
      per90: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, per90(value, minutes)])) },
    appearances: apps.map(appearance),
    last: apps.slice(-10).map(appearance),
    best: [...graded].sort((a, b) => b.grade - a.grade).slice(0, 3).map(appearance),
    values: { current: history.at(-1) || null, history: history.map((v) => ({ date: v.date, valueEur: v.valueEur })), source: values?.data?.source || null },
  };
}

// Club -----------------------------------------------------------------------

export function buildClubReport({ id, season, read, clubs, projection, forecasts = {} }, today = new Date()) {
  const data = read?.data || {};
  const team = (data.teams || []).find((t) => t.id === id) || null;
  const played = (data.matches || []).filter((m) => m.status === "finished" && (m.home?.id === id || m.away?.id === id))
    .map((m) => ({ ...sideOf(m, id), id: m.id, date: m.date, league: m.league, leagueId: m.leagueId }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const record = { matches: played.length, wins: played.filter((m) => m.result === "V").length, draws: played.filter((m) => m.result === "N").length,
    losses: played.filter((m) => m.result === "D").length, goalsFor: sum(played, "scored"), goalsAgainst: sum(played, "conceded"),
    xgFor: round(sum(played, "xgFor"), 1), xgAgainst: round(sum(played, "xgAgainst"), 1) };
  record.points = record.wins * 3 + record.draws;
  // The club's players: their season with it (grades of 20 minutes or more, as the site).
  const byPlayer = new Map();
  for (const a of data.appearances || []) {
    if (a.teamId !== id || !(a.minutes > 0)) continue;
    if (!byPlayer.has(a.playerId)) byPlayer.set(a.playerId, []);
    byPlayer.get(a.playerId).push(a);
  }
  const players = [...byPlayer.entries()].map(([playerId, apps]) => ({
    id: playerId, name: apps[0].name || apps[0].playerName || null, imageUrl: apps.find((a) => a.imageUrl)?.imageUrl || null,
    matches: apps.length, minutes: sum(apps, "minutes"), goals: sum(apps, "goals"), assists: sum(apps, "assists"),
    xg: round(sum(apps, "xg"), 2), xa: round(sum(apps, "xa"), 2), ...seasonGrade(apps),
  })).sort((a, b) => b.minutes - a.minutes);
  const regular = Math.max(270, 0.3 * Math.max(0, ...players.map((p) => p.minutes)));
  const top = players.filter((p) => p.grade != null && p.minutes >= regular).sort((a, b) => b.grade - a.grade).slice(0, 5);
  const ranked = (clubs?.rows || []).find((r) => r.teamId === id) || null;
  // The league projection: its row of the club, and where the table stands.
  const rows = projection?.teams || [];
  const own = rows.find((r) => r.id === id) || null;
  let outlook = null;
  if (own && Array.isArray(own.places) && own.places.length) {
    const n = own.places.length;
    const table = [...rows].sort((a, b) => b.points - a.points || b.projectedPoints - a.projectedPoints);
    const share = (from, to) => round(own.places.slice(from, to).reduce((t, x) => t + (x || 0), 0) * 100, 1);
    outlook = { league: projection.competition, played: own.played, points: own.points, projectedPoints: round(own.projectedPoints, 1),
      position: table.findIndex((r) => r.id === id) + 1, teams: n, title: share(0, 1), top4: share(0, 4), relegation: share(n - 3, n),
      places: own.places.map((x) => round((x || 0) * 100, 1)),
      table: table.map((r) => ({ id: r.id, name: r.name, played: r.played, points: r.points, projectedPoints: round(r.projectedPoints, 1) })) };
  }
  const upcoming = (data.fixtures || []).filter((f) => f.status === "not_started" && (f.home_team?.id === id || f.away_team?.id === id))
    .sort((a, b) => String(a.time_utc || a.date).localeCompare(String(b.time_utc || b.date))).slice(0, 3)
    .map((f) => {
      const home = f.home_team?.id === id, forecast = forecasts[f.id]?.forecast || null;
      const p = (side) => num(forecast?.[side]) == null ? null : round(forecast[side] * 100, 0);
      return { id: f.id, date: f.date, league: f.league?.name || null, home, opponent: home ? f.away_team?.name : f.home_team?.name,
        opponentImageUrl: (home ? f.away_team?.image_url : f.home_team?.image_url) || null,
        win: p(home ? "home" : "away"), draw: p("draw"), loss: p(home ? "away" : "home") };
    });
  const league = (data.competitions || []).find((c) => !String(c.country || "").startsWith("INT")) || null;
  return {
    kind: "club", id, season, generatedAt: today.toISOString(), title: team?.name || "Club",
    club: { name: team?.name || null, imageUrl: team?.imageUrl || null, country: team?.country || null, league: league?.name || null },
    power: ranked ? { score: num(ranked.score), rank: ranked.rank, elo: round(ranked.elo, 0), eloChange: round(ranked.eloChange, 0), of: clubs.rows.length } : null,
    record, form: played.slice(-10), matches: played, players, top, outlook, upcoming,
  };
}

// Match ----------------------------------------------------------------------

const STAT_KEYS = [
  ["expected_goals", "xG", "decimal"], ["total_shots", "Tirs", "integer"], ["ShotsOnTarget", "Tirs cadrés", "integer"],
  ["big_chance", "Grosses occasions", "integer"], ["BallPossesion", "Possession", "percent"], ["accurate_passes", "Passes réussies", "integer"],
  ["touches_opp_box", "Touches dans la surface", "integer"], ["corners", "Corners", "integer"], ["keeper_saves", "Arrêts", "integer"],
  ["fouls", "Fautes", "integer"], ["yellow_cards", "Cartons jaunes", "integer"], ["red_cards", "Cartons rouges", "integer"],
];

function statValue(text) {
  const match = String(text ?? "").match(/^-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function buildMatchReport({ id, match, stats, grades, live, forecast }, today = new Date()) {
  const m = match?.data || {};
  const all = (stats?.data?.periods || []).find((p) => p.period === "All");
  const items = new Map();
  for (const group of all?.groups || []) for (const item of group.items || []) if (!items.has(item.key)) items.set(item.key, item);
  const table = STAT_KEYS.filter(([key]) => items.has(key)).map(([key, label, format]) => {
    const item = items.get(key);
    return { key, label, format, home: statValue(item.home), away: statValue(item.away), homeText: item.home, awayText: item.away };
  });
  const rows = (grades?.grades || []).map((g) => ({ id: g.playerId, teamId: g.teamId, name: g.name, imageUrl: g.imageUrl || null, team: g.team,
    position: g.position, minutes: g.minutes, goals: g.goals ?? 0, assists: g.assists ?? 0, grade: num(g.grade), rank: g.rank }));
  const best = (teamId) => rows.filter((r) => r.teamId === teamId && r.grade != null).sort((a, b) => b.grade - a.grade).slice(0, 3);
  const points = (live?.points || []).map((p) => ({ minute: p.minute, home: num(p.home), draw: num(p.draw), away: num(p.away) }));
  const before = points[0] || (forecast?.forecast ? { minute: 0, ...forecast.forecast } : null);
  const pct = (x) => (x == null ? null : round(x * 100, 0));
  const homeId = m.home_team?.id, awayId = m.away_team?.id;
  const xg = table.find((s) => s.key === "expected_goals");
  return {
    kind: "match", id, generatedAt: today.toISOString(),
    title: `${m.home_team?.name || "?"} – ${m.away_team?.name || "?"}`,
    match: { date: m.date || null, time: m.time_utc || null, status: m.status || null, league: m.league?.name || null, round: m.round_name || null,
      stadium: m.stadium || null, referee: m.referee || null,
      home: { id: homeId, name: m.home_team?.name || null, imageUrl: m.home_team?.image_url || null, score: num(m.score_home) },
      away: { id: awayId, name: m.away_team?.name || null, imageUrl: m.away_team?.image_url || null, score: num(m.score_away) } },
    stats: table, xg: xg ? { home: xg.home, away: xg.away } : null,
    grades: rows, best: { home: best(homeId), away: best(awayId) }, playerOfMatch: [...rows].filter((r) => r.grade != null).sort((a, b) => b.grade - a.grade)[0] || null,
    before: before ? { home: pct(before.home), draw: pct(before.draw), away: pct(before.away) } : null,
    timeline: points, events: (live?.events || []).map((e) => ({ minute: e.minute, added: e.added || 0, kind: e.kind, side: e.side })),
  };
}

// Loading ----------------------------------------------------------------------

function apiOrigin() {
  return process.env.ORION_API_ORIGIN || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8765" : API_ORIGIN);
}

/** A read of the API: its JSON, or null when it has nothing (404); anything else throws. */
export async function apiGet(path, params = {}, { fetchImpl = fetch, timeout = 15000 } = {}) {
  const url = new URL(path, apiOrigin());
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`API ${response.status} ${path}`);
  return response.json();
}

const quiet = (promise) => promise.catch(() => null);

export async function loadReport(id, { season, get = apiGet, today = new Date() } = {}) {
  const kind = reportKind(id);
  if (!kind) return null;
  const s = SEASON.test(season || "") ? season : currentSeason(today);
  if (kind === "player") {
    const [read, power, profile, values] = await Promise.all([
      get("/api/read/player", { season: s, player: id, leagues: "all", detail: "summary", limit: "100" }),
      quiet(get("/api/rankings/power/player", { season: s, player: id })),
      quiet(get(`/api/players/${id}`)),
      quiet(get("/api/player-market-values", { id })),
    ]);
    if (!read) return null;
    return buildPlayerReport({ id, season: s, read, power, profile, values }, today);
  }
  if (kind === "club") {
    const [read, clubs] = await Promise.all([
      get("/api/read/club", { season: s, team: id, leagues: "all", include: "appearances", limit: "100" }),
      quiet(get("/api/rankings/power", { kind: "clubs", season: s, limit: "200" })),
    ]);
    if (!read) return null;
    const league = (read.data?.competitions || []).find((c) => !String(c.country || "").startsWith("INT"));
    const coming = (read.data?.fixtures || []).filter((f) => f.status === "not_started" && (f.home_team?.id === id || f.away_team?.id === id))
      .sort((a, b) => String(a.time_utc || a.date).localeCompare(String(b.time_utc || b.date))).slice(0, 3);
    const [projection, ...forecasts] = await Promise.all([
      league ? quiet(get("/api/forecasts/season", { competition: league.id, season: s })) : null,
      ...coming.map((f) => quiet(get("/api/forecasts/match", { match: f.id }))),
    ]);
    return buildClubReport({ id, season: s, read, clubs, projection,
      forecasts: Object.fromEntries(coming.map((f, i) => [f.id, forecasts[i]]).filter(([, f]) => f)) }, today);
  }
  const [match, stats, grades, live] = await Promise.all([
    get(`/api/matches/${id}`),
    quiet(get(`/api/matches/${id}/stats`)),
    quiet(get("/api/rankings/match", { match: id })),
    quiet(get("/api/forecasts/live", { match: id })),
  ]);
  if (!match) return null;
  const forecast = live?.points?.length ? null : await quiet(get("/api/forecasts/match", { match: id }));
  return buildMatchReport({ id, match, stats, grades, live, forecast }, today);
}
