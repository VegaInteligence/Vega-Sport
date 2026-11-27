// Test double of the read API for tests/e2e/publication-changed.e2e.mjs: a small HTTP server, every answer made up
// here (no upstream). Its one rule is the API's refusal of a read pinned to a publication it no longer serves:
// backend/api/src/routes/matches.mjs nextPage() (a fixtures cursor of another generation → 409) and the compact
// reads' `generation` check (/api/read/* naming another generation → 409 PUBLICATION_CHANGED). The E2E moves the
// served publication (state.generation) between two page loads or clicks, as the worker does every few minutes.
//
//  - GET /api/status, /api/dashboard/manifest (schema 5, aws-relational, the capabilities the site reads to choose
//    its reads; publicationVersion = state.manifestGeneration ?? state.generation);
//  - GET /api/fixtures: FIXTURES matches per status, pages of `limit`, cursor = base64url {generation, offset, scope};
//    each match's teams are named after the generation that served it (« G1 Club 31 »), so a page shows which
//    publication answered it; with status=all, `from` and `to` (the calendar's week, § 86) WEEK matches spread over
//    the days after `from` up to `to`, over before `now`, to come after it;
//    `state.moveAfter` = n: after n fixtures pages answered, the served publication becomes `state.moveTo` (the worker
//    publishing between two pages of one week);
//  - GET /api/read/players: PLAYERS rows, offset pages (page, limit), each name carrying its generation;
//  - GET /api/read/home: a home of one week (Joueur de la semaine) at the served generation;
//  - GET /api/read/performance: one performance (its match, competition, profile);
//  - anything else: 404 { error }, logged, so a run shows what the pages asked for that the double does not serve.
// GET /__control?generation=…&manifest=…&refuse=… sets the state by hand. `state.refuse` (a Set of route names): refuse every read of that route with 409 whatever it names (a publication
// that does not settle). Every request is logged in `log` with its path, query, status.
import http from "node:http";

export const LEAGUE = { id: "l_3FJFUl", name: "Ligue 1", country: "FRA" };
export const SEASON = "2026/2027";
export const FIXTURES = 75;
export const PLAYERS = 60;
export const WEEK = 120;

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unb64 = (s) => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString());
  } catch {
    return null;
  }
};
const refusal = () => ({
  error: { code: "PUBLICATION_CHANGED", message: "Les données ont été actualisées. Rechargez la première page.", retry: true },
});
const id6 = (prefix, n) => `${prefix}_${String(n).padStart(6, "0").replace(/0/g, "A")}`;
const team = (n, g) => ({ id: id6("t", 100 + n), name: `Club ${n} ${g}`, image_url: null });

function manifest(state) {
  const g = state.manifestGeneration ?? state.generation;
  const published = new Date(state.publishedAt).toISOString();
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
    retrievedAt: published,
    publishedAt: published,
    publicationVersion: g,
    seasons: [
      {
        id: SEASON,
        chunks: [
          {
            leagueId: LEAGUE.id,
            sourceDigest: `digest-${g}`.padEnd(16, "0").slice(0, 16),
            meta: { matchCount: 306, expectedFinishedMatches: 120, collectedMatches: 120, teamCount: 18, retrievedAt: published, startDate: "2026-08-15", endDate: "2027-05-22" },
          },
        ],
      },
    ],
    competitions: [{ id: LEAGUE.id, name: LEAGUE.name, country: LEAGUE.country, providerCountry: LEAGUE.country, imageUrl: null, seasons: [SEASON] }],
    clubCountries: {},
    scouting: { version: 2, sourceDigest: g },
  };
}

function fixture(i, g, played, nowMs) {
  const day = 864e5;
  const time = played ? nowMs - (i + 1) * day * 0.5 : nowMs + (i + 1) * 3600_000 * 2;
  const iso = new Date(time).toISOString();
  return {
    ...(played ? {} : { forecast: { home: 0.45, draw: 0.27, away: 0.28 } }),
    id: id6("m", 1000 + i),
    season: SEASON,
    date: iso.slice(0, 10),
    time_utc: iso,
    status: played ? "finished" : "not_started",
    round_name: String(10 + Math.floor(i / 9)),
    has_playoff: false,
    home_team: team(2 * i + 1, g),
    away_team: team(2 * i + 2, g),
    league: { id: LEAGUE.id, name: LEAGUE.name, image_url: null },
    score_home: played ? i % 4 : null,
    score_away: played ? (i + 1) % 3 : null,
    score_penalty_home: null,
    score_penalty_away: null,
  };
}

// The calendar's week (status=all, from, to): WEEK matches over the days after `from` up to `to`, at noon UTC.
function weekFixture(i, g, from, to, nowMs) {
  const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5));
  const day = new Date(Date.parse(from) + (1 + Math.floor((i * span) / WEEK)) * 864e5).toISOString().slice(0, 10);
  const iso = `${day}T12:${String(i % 60).padStart(2, "0")}:00Z`;
  const played = Date.parse(iso) + 2 * 3600_000 <= nowMs;
  return { ...fixture(i, g, played, nowMs), date: day, time_utc: iso, ...(played ? {} : { forecast: { home: 0.45, draw: 0.27, away: 0.28 } }) };
}

function playerRow(i, g) {
  const id = id6("p", 2000 + i),
    name = `Joueur ${String(i + 1).padStart(2, "0")} ${g}`,
    club = `Club ${i + 1} ${g}`,
    teamId = id6("t", 100 + i + 1),
    grade = 80 - i * 0.5;
  // playerReadRecord (backend/api/src/routes/players.mjs): the list's record and its profile.
  return {
    id,
    playerId: id,
    name,
    imageUrl: null,
    team: club,
    league: LEAGUE.name,
    position: "Milieu",
    positionId: null,
    matches: 10,
    minutes: 900 - i,
    grade,
    goals: 3,
    assists: 2,
    xg: 2.5,
    finishingDelta: 0.5,
    totals: { goals: 3, assists: 2, xg: 2.5 },
    power: { score: grade },
    profile: {
      id, name, imageUrl: null, role: null, teams: [club], teamIds: [teamId], leagueIds: [LEAGUE.id], leagues: [LEAGUE.name],
      matches: 10, minutes: 900 - i, unknownMinutes: 0, starts: 10, knownStarts: 10, grade, gradeCount: 10,
      stats: {}, ratios: {}, identity: null, latest: null, rows: [],
    },
  };
}

const POTW = (g) => ({
  id: "m_AAA1A0:p_AAA2A0",
  playerId: "p_AAA2A0",
  matchId: "m_AAA1A0",
  name: "Kylian Exemple",
  team: `Club 1 ${g}`,
  teamId: "t_AAA101",
  imageUrl: null,
  grade: 88,
  minutes: 90,
  goals: 2,
  assists: 1,
  xg: 1.4,
  position: "Attaquant",
  leagueId: LEAGUE.id,
  league: LEAGUE.name,
});

function performance(g, nowMs) {
  const date = new Date(nowMs - 2 * 864e5).toISOString();
  return {
    data: {
      row: {
        ...POTW(g),
        date: date.slice(0, 10),
        starter: true,
        statsReliable: true,
        shirtNumber: 10,
        positionCode: "ST",
        season: SEASON,
      },
      match: {
        id: "m_AAA1A0",
        date: date.slice(0, 10),
        timeUtc: date,
        leagueId: LEAGUE.id,
        season: SEASON,
        status: "finished",
        home: { id: "t_AAA101", name: `Club 1 ${g}`, score: 3, imageUrl: null },
        away: { id: "t_AAA102", name: `Club 2 ${g}`, score: 1, imageUrl: null },
      },
      competition: { id: LEAGUE.id, name: LEAGUE.name, imageUrl: null },
      rank: { rank: 1, total: 22 },
      profile: { sections: [], peers: "attaquants" },
    },
    meta: { generation: g },
  };
}

export async function startPublicationApi({ port = 0, now = Date.now() } = {}) {
  const state = { generation: "G1", manifestGeneration: null, publishedAt: now - 60_000, refuse: new Set(), now, moveAfter: 0, moveTo: "G2" };
  const log = [];
  const server = http.createServer((req, res) => {
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
      log.push({ t: Date.now(), method: req.method, path: url.pathname, query: Object.fromEntries(q), status, served: state.generation });
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    // Control, for a run by hand: /__control?generation=G2&manifest=G1&refuse=fixtures,players
    if (url.pathname === "/__control") {
      if (q.has("generation")) state.generation = q.get("generation");
      if (q.has("manifest")) state.manifestGeneration = q.get("manifest") || null;
      if (q.has("refuse")) state.refuse = new Set(q.get("refuse").split(",").filter(Boolean));
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify({ ...state, refuse: [...state.refuse] }));
    }
    const g = state.generation;
    const route = url.pathname;
    const pinnedStale = q.has("generation") && q.get("generation") !== g;
    if (route === "/api/status") return send(200, { source: "AWS", configured: true, basePath: "/api/matches", schema: "v2" });
    if (route === "/api/dashboard/manifest") return send(200, manifest(state));
    if (route === "/api/fixtures") {
      if (state.refuse.has("fixtures")) return send(409, refusal());
      const played = q.get("status") !== "upcoming";
      const limit = Number(q.get("limit") || 30);
      const scope = [...q.entries()].filter(([k]) => k !== "cursor").sort().map((e) => e.join("=")).join("&");
      let offset = 0;
      if (q.has("cursor")) {
        const cursor = unb64(q.get("cursor"));
        if (!cursor || cursor.scope !== scope) return send(400, { error: { message: "Curseur invalide." } });
        if (cursor.generation !== g) return send(409, refusal());
        offset = cursor.offset;
      }
      const week = q.get("status") === "all" && q.has("from") && q.has("to"),
        total = week ? WEEK : FIXTURES;
      const matches = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, k) =>
        week ? weekFixture(offset + k, g, q.get("from"), q.get("to"), state.now) : fixture(offset + k, g, played, state.now),
      );
      const nextCursor = offset + limit < total ? b64({ scope, generation: g, offset: offset + limit }) : null;
      send(200, { data: { matches }, pagination: { limit, nextCursor, generation: g }, meta: { generation: g } });
      if (state.moveAfter > 0 && --state.moveAfter === 0) state.generation = state.moveTo;
      return;
    }
    if (route === "/api/read/players") {
      if (state.refuse.has("players") || pinnedStale) return send(409, refusal());
      const limit = Number(q.get("limit") || 20),
        page = Number(q.get("page") || 1),
        pages = Math.ceil(PLAYERS / limit);
      const players = Array.from({ length: Math.max(0, Math.min(limit, PLAYERS - (page - 1) * limit)) }, (_, k) => playerRow((page - 1) * limit + k, g));
      return send(200, {
        data: { players, teams: [] },
        meta: { generation: g },
        pagination: { page, limit, total: PLAYERS, pages, generation: g },
      });
    }
    if (route === "/api/read/home") {
      if (state.refuse.has("home") || pinnedStale) return send(409, refusal());
      return send(200, { data: homeData(g, state.now), meta: { generation: g } });
    }
    if (route === "/api/read/performance") {
      if (state.refuse.has("performance") || pinnedStale) return send(409, refusal());
      return send(200, performance(g, state.now));
    }
    return send(404, { error: { message: "Route absente de la doublure." } });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    state,
    log,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// The home's week (the period the site takes as current: backend/api/src/routes/home.mjs), its player of the week.
function homeData(g, nowMs) {
  const paris = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(nowMs));
  const d = new Date(paris + "T12:00:00Z");
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const sunday = new Date(Date.parse(monday) + 6 * 864e5).toISOString().slice(0, 10);
  const kickoff = new Date(nowMs - 2 * 864e5);
  // assembleMatch's shape (a result row carries its sides only).
  const match = {
    id: "m_AAA1A0",
    date: kickoff.toISOString().slice(0, 10),
    timeUtc: kickoff.toISOString(),
    leagueId: LEAGUE.id,
    league: LEAGUE.name,
    season: SEASON,
    status: "finished",
    finished: true,
    round: "12",
    home: { id: "t_AAA101", name: `Club 1 ${g}`, score: 3, imageUrl: null },
    away: { id: "t_AAA102", name: `Club 2 ${g}`, score: 1, imageUrl: null },
    players: [],
    shots: [],
    stats: [],
    coverage: {},
  };
  return {
    period: { start: monday, end: sunday, current: true, asOf: nowMs },
    resultCount: 1,
    results: [match],
    ranks: [],
    potw: { ...POTW(g), date: match.date },
    potwMatch: match,
    potwRecent: [],
    others: [],
    otherMatches: [],
    tables: [],
    highlights: [],
    defences: [],
    hasSeasonPlayers: true,
    seasonProgress: 0.4,
    raceOpen: false,
    competitions: [{ id: LEAGUE.id, name: LEAGUE.name, country: LEAGUE.country, providerCountry: LEAGUE.country, imageUrl: null, seasons: [] }],
    internationals: [],
    billboard: [],
    billboardWindow: { start: paris, end: paris },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const api = await startPublicationApi({ port: Number(process.argv[2] || 8790) });
  console.log("publication-api on", api.origin);
}
