// Test double of the read API for tests/e2e/calendar.e2e.mjs (FAILURE_MODES § 86): a small HTTP server whose answers
// are all made up here, in the shapes of backend/api (no upstream, no production data). Three weeks of the 2026/2027
// season around Friday 27 Nov 2026, 20 h 40 in Paris (NOW), ten competitions of the Top 7 Europe + UEFA and Ligue 2:
//
//  - week of 16 Nov: the leagues on Saturday 21 and Sunday 22, three matches each a day (42, all over);
//  - week of 23 Nov (120 matches, three pages of 50): Monday 23 Serie A and LaLiga; Tuesday 24 and Wednesday 25 the
//    Champions League (9 a day); Thursday 26 the Europa League and the Conference League (18 each); Friday 27 eight:
//    Eredivisie 18 h 45 (over), Eredivisie 20 h 00 and Bundesliga 20 h 30 (kicked off, not over: in play by the live
//    rule), Ligue 1 20 h 45, Serie A 20 h 45, Premier League 21 h 00, LaLiga 21 h 00, Liga Portugal 21 h 15 (to come);
//    Saturday 28 and Sunday 29 the leagues, four matches each a day (a match is over 1 h 45 after its kick-off);
//  - week of 30 Nov: nothing from Monday 30 to Thursday 3, Ligue 1 and Bundesliga on Friday 4, the leagues on Saturday 5
//    and Sunday 6 (three each a day): 44.
//  Ligue 2 plays on Saturdays (two matches), outside the Top 7 Europe + UEFA scope.
//
// Routes: GET /api/status, /api/dashboard/manifest (schema 5, aws-relational: the site reads the calendar by pages),
// /api/fixtures (league|leagues, season, status all|played|upcoming, from/to on the provider's day, q, order, limit ≤ 50,
// cursor = base64url {scope, generation, offset}; a match to come carries `forecast`), /api/matches/{id}/summary
// (the match a row opens); anything else 404, logged. `state.delay` (ms) holds every fixtures answer that long.
// GET /__control?delay=… sets it by hand. Every request is logged in `log` with its path, query and status.
import http from "node:http";

export const NOW = "2026-11-27T19:40:00Z";
export const SEASON = "2026/2027";
export const COMPETITIONS = [
  { id: "l_0bfbkO", name: "Champions League", country: "UEFA", short: "LDC" },
  { id: "l_38d9HA", name: "Europa League", country: "UEFA", short: "LE" },
  { id: "l_2WZ2tt", name: "Conference League", country: "UEFA", short: "LC" },
  { id: "l_4WFCIZ", name: "Premier League", country: "ENG", short: "PL" },
  { id: "l_0ErfuF", name: "LaLiga", country: "ESP", short: "LL" },
  { id: "l_0ALvwF", name: "Serie A", country: "ITA", short: "SA" },
  { id: "l_1Isor4", name: "Bundesliga", country: "GER", short: "BL" },
  { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", short: "L1" },
  { id: "l_4QexZg", name: "Liga Portugal", country: "POR", short: "LP" },
  { id: "l_4H43wr", name: "Eredivisie", country: "NED", short: "ED" },
  { id: "l_0275VP", name: "Ligue 2", country: "FRA", short: "L2" },
];
const LEAGUES = ["l_4WFCIZ", "l_0ErfuF", "l_0ALvwF", "l_1Isor4", "l_3FJFUl", "l_4QexZg", "l_4H43wr"];
const byId = new Map(COMPETITIONS.map((c) => [c.id, c]));

// A Paris time of November or December (UTC+1) as an instant.
const at = (day, hm) => new Date(`${day}T${hm}:00+01:00`).toISOString().replace(".000", "");
// Six characters, one per decimal digit (0 written Z): two numbers never share an id.
const id6 = (prefix, n) => `${prefix}_${String(n).padStart(6, "0").replace(/0/g, "Z")}`;

function schedule() {
  const plan = [];
  const add = (day, league, times) => times.forEach((hm) => plan.push({ day, league, hm }));
  const leaguesDay = (day, count) => {
    const times = ["13:30", "16:00", "18:30", "21:00"].slice(0, count);
    LEAGUES.forEach((league) => add(day, league, times));
  };
  leaguesDay("2026-11-21", 3);
  leaguesDay("2026-11-22", 3);
  add("2026-11-23", "l_0ALvwF", ["20:45"]);
  add("2026-11-23", "l_0ErfuF", ["21:00"]);
  for (const day of ["2026-11-24", "2026-11-25"]) add(day, "l_0bfbkO", ["18:45", "18:45", ...Array(7).fill("21:00")]);
  for (const league of ["l_38d9HA", "l_2WZ2tt"]) add("2026-11-26", league, [...Array(9).fill("18:45"), ...Array(9).fill("21:00")]);
  add("2026-11-27", "l_4H43wr", ["18:45", "20:00"]);
  add("2026-11-27", "l_1Isor4", ["20:30"]);
  add("2026-11-27", "l_3FJFUl", ["20:45"]);
  add("2026-11-27", "l_0ALvwF", ["20:45"]);
  add("2026-11-27", "l_4WFCIZ", ["21:00"]);
  add("2026-11-27", "l_0ErfuF", ["21:00"]);
  add("2026-11-27", "l_4QexZg", ["21:15"]);
  leaguesDay("2026-11-28", 4);
  leaguesDay("2026-11-29", 4);
  add("2026-11-28", "l_0275VP", ["15:00", "20:00"]);
  add("2026-12-04", "l_3FJFUl", ["20:45"]);
  add("2026-12-04", "l_1Isor4", ["20:30"]);
  leaguesDay("2026-12-05", 3);
  leaguesDay("2026-12-06", 3);
  add("2026-12-05", "l_0275VP", ["15:00", "20:00"]);
  return plan;
}

// The matchday of a league's match: one per weekend, one per European week.
const ROUNDS = { "2026-11-21": 12, "2026-11-22": 12, "2026-11-23": 13, "2026-11-27": 13, "2026-11-28": 13, "2026-11-29": 13, "2026-12-04": 14, "2026-12-05": 14, "2026-12-06": 14 };
const EURO_ROUND = { "2026-11-24": 5, "2026-11-25": 5, "2026-11-26": 5 };

export function makeMatches(now = Date.parse(NOW)) {
  const counters = new Map();
  return schedule().map(({ day, league, hm }, i) => {
    const competition = byId.get(league),
      n = counters.get(league) || 0;
    counters.set(league, n + 2);
    const kickoff = at(day, hm),
      started = Date.parse(kickoff) <= now,
      over = started && Date.parse(kickoff) + 105 * 60_000 <= now;
    const team = (k) => ({ id: id6("t", 5000 + COMPETITIONS.indexOf(competition) * 40 + (k % 36)), name: `Club ${competition.short} ${(k % 36) + 1}`, image_url: null });
    const home = (i * 7) % 4,
      away = (i * 5 + 1) % 3,
      h = 0.3 + ((i * 13) % 30) / 100,
      d = 0.22 + ((i * 7) % 8) / 100;
    return {
      ...(started ? {} : { forecast: { home: h, draw: d, away: Math.round((1 - h - d) * 10000) / 10000 } }),
      id: id6("m", 70000 + i),
      season: SEASON,
      // The provider's day: the UTC date of the kick-off.
      date: kickoff.slice(0, 10),
      time_utc: kickoff,
      status: over ? "finished" : "not_started",
      round_name: String(ROUNDS[day] || EURO_ROUND[day] || 1),
      has_playoff: false,
      home_team: team(n),
      away_team: team(n + 1),
      league: { id: league, name: competition.name, image_url: null },
      score_home: over ? home : null,
      score_away: over ? away : null,
      score_penalty_home: null,
      score_penalty_away: null,
    };
  });
}

function manifest(published) {
  const at = new Date(published).toISOString();
  return {
    schemaVersion: 5,
    storage: "aws-relational",
    capabilities: {
      boundedSearch: true,
      fixturePaginationOrder: true,
      versionedPartitions: true,
      playerGradeRanking: true,
      actorSummary: true,
      wholeSelection: true,
      roleGroups: true,
      playerProfiles: true,
      marketValues: true,
      versionedReads: { league: true, club: true, player: true, europeMatches: true },
      playedLeague: true,
      resolvedMedia: false,
      boundedArchive: true,
      compactReads: { home: true, players: true, clubs: true, player: true, club: true, league: true, performance: true, discipline: true, presence: true },
    },
    defaultSeason: SEASON,
    retrievedAt: at,
    publishedAt: at,
    publicationVersion: "G1",
    seasons: [
      {
        id: SEASON,
        chunks: COMPETITIONS.map((c) => ({
          leagueId: c.id,
          sourceDigest: `digest-${c.short}`.padEnd(16, "0").slice(0, 16),
          meta: { matchCount: 306, expectedFinishedMatches: 120, collectedMatches: 120, teamCount: 18, retrievedAt: at, startDate: "2026-08-14", endDate: "2027-05-30" },
        })),
      },
      {
        id: "2025/2026",
        chunks: COMPETITIONS.map((c) => ({
          leagueId: c.id,
          sourceDigest: `old-${c.short}`.padEnd(16, "0").slice(0, 16),
          meta: { matchCount: 306, expectedFinishedMatches: 306, collectedMatches: 306, teamCount: 18, retrievedAt: at, startDate: "2025-08-15", endDate: "2026-05-24" },
        })),
      },
    ],
    competitions: COMPETITIONS.map((c) => ({ id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: null, seasons: [SEASON, "2025/2026"] })),
    clubCountries: {},
    scouting: { version: 2, sourceDigest: "G1" },
  };
}

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unb64 = (s) => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString());
  } catch {
    return null;
  }
};
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function startCalendarApi({ port = 0, now = Date.parse(NOW), matches = makeMatches(now), manifest: served = manifest(now - 60_000) } = {}) {
  const state = { delay: 0, generation: served.publicationVersion || "G1" };
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const q = url.searchParams;
    const cors = {
      "access-control-allow-origin": req.headers.origin || "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-expose-headers": "*",
      vary: "Origin",
    };
    const send = (status, body) => {
      log.push({ t: Date.now(), path: url.pathname, query: Object.fromEntries(q), status });
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    if (url.pathname === "/__control") {
      if (q.has("delay")) state.delay = Number(q.get("delay")) || 0;
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify(state));
    }
    const route = url.pathname;
    if (route === "/api/status") return send(200, { source: "AWS", configured: true, basePath: "/api/matches", schema: "v2" });
    if (route === "/api/dashboard/manifest") return send(200, served);
    if (route === "/api/fixtures") {
      if (state.delay) await new Promise((done) => setTimeout(done, state.delay));
      const g = state.generation;
      const leagues = (q.get("league") || q.get("leagues") || "").split(",").filter(Boolean),
        status = q.get("status") || "all",
        from = q.get("from"),
        to = q.get("to"),
        text = fold(q.get("q")),
        order = q.get("order") || "asc",
        limit = Math.min(50, Number(q.get("limit") || 50));
      const scope = [...q.entries()].filter(([k]) => k !== "cursor").sort().map((e) => e.join("=")).join("&");
      let offset = 0;
      if (q.has("cursor")) {
        const cursor = unb64(q.get("cursor"));
        if (!cursor || cursor.scope !== scope) return send(400, { error: { message: "Curseur invalide." } });
        if (cursor.generation !== g) return send(409, { error: { code: "PUBLICATION_CHANGED", message: "Les données ont été actualisées. Rechargez la première page.", retry: true } });
        offset = cursor.offset;
      }
      const rows = matches
        .filter((m) => (!leagues.length || leagues.includes(m.league.id)) && (!q.get("season") || m.season === q.get("season")))
        .filter((m) => status === "all" || (status === "played" ? m.status === "finished" : m.status === "not_started"))
        .filter((m) => (!from || m.date >= from) && (!to || m.date <= to))
        .filter((m) => !text || fold(`${m.home_team.name} ${m.away_team.name} ${m.league.name}`).includes(text))
        .sort((a, b) => (a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) * (order === "desc" ? -1 : 1));
      const page = rows.slice(offset, offset + limit);
      const nextCursor = offset + limit < rows.length ? b64({ scope, generation: g, offset: offset + limit }) : null;
      return send(200, { data: { matches: page }, pagination: { limit, nextCursor, generation: g }, meta: { generation: g } });
    }
    const summary = route.match(/^\/api\/matches\/([^/]+)\/summary$/);
    if (summary) {
      const m = matches.find((match) => match.id === summary[1]);
      if (!m) return send(404, { error: { message: "Match inconnu." } });
      // assembleMatch's shape (backend/api/src/routes/matches.mjs), without events, shots or players.
      const side = (team, score) => ({ id: team.id, name: team.name, score, imageUrl: null });
      return send(200, {
        data: {
          match: {
            id: m.id, date: m.date, timeUtc: m.time_utc, leagueId: m.league.id, league: m.league.name, season: m.season,
            status: m.status, finished: m.status === "finished", round: m.round_name,
            home: side(m.home_team, m.score_home), away: side(m.away_team, m.score_away),
            players: [], shots: [], stats: [], coverage: {}, ...(m.forecast ? { forecast: m.forecast } : {}),
          },
        },
        meta: { generation: state.generation },
      });
    }
    return send(404, { error: { message: "Route absente de la doublure." } });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    state,
    log,
    matches,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const api = await startCalendarApi({ port: Number(process.argv[2] || 8791) });
  console.log("calendar-api on", api.origin, api.matches.length, "matches");
}
