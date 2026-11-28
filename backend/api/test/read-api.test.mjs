// Contract tests of the read API against a seeded local database (test/seed.py).
// Shapes are the current API's (main); values are recomputed by hand from the seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { context, counting, get, skip } from "./context.mjs";
import { timestamp, types } from "../src/db.mjs";
import { createHandler } from "../src/handler.mjs";
import { CAPABILITIES, editionCounts, editionDigest, manifestShape } from "../src/routes/system.mjs";

const clubs = "/api/read/clubs?season=2025/2026&leagues=all";
// The keys of a club record in the previous backend's relational-clubs.js (main), plus
// the power ranking of the season.
const DIRECTORY_KEYS = ["competitionCounts", "count", "country", "id", "imageUrl", "league", "name", "power"];
const ANALYSIS_KEYS = [
  ...DIRECTORY_KEYS, "away", "cleanSheets", "draws", "excludedStats", "formations", "forms", "games",
  "goalTimes", "goalsAgainst", "goalsFor", "home", "losses", "matches", "points", "shots", "stats", "unscored", "wins",
].sort();

test("club directory: envelope, order, facets", { skip }, async () => {
  const { response, body } = await get(clubs);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"compact-v2-/);
  assert.deepEqual(Object.keys(body).sort(), ["data", "meta", "pagination"]);
  assert.deepEqual(body.data.clubs.map((c) => c.id), ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"]);
  assert.deepEqual(Object.keys(body.data.clubs[0]).sort(), DIRECTORY_KEYS);
  const { power, ...club } = body.data.clubs[0];
  assert.deepEqual(club, {
    id: "t_aaaaa1", name: "Olympique Été", imageUrl: "https://img.example/t1.png", league: "Ligue 1",
    country: "FRA", count: 3, competitionCounts: { l_3FJFUl: 3 },
  });
  // The club power ranking (Elo after its last match of the season): moved points only.
  assert.deepEqual(Object.keys(power).sort(), ["draws", "elo", "eloChange", "eloLow", "eloPeak", "eloStart", "expectedResults", "losses", "matches", "rank", "results", "score", "wins"]);
  assert.equal(power.matches, 3);
  // t_aaaaa1: won 2–0, lost 0–1, drew 0–0.
  assert.deepEqual([power.wins, power.draws, power.losses, power.results, power.eloStart], [1, 1, 1, 1.5, 1500]);
  assert.ok(power.eloPeak >= power.elo && power.elo >= power.eloLow);
  assert.equal(Math.round(body.data.clubs.reduce((sum, c) => sum + c.power.elo, 0)), 6000);
  assert.deepEqual(body.data.clubs.map((c) => c.power.rank).sort(), [1, 2, 3, 4]);
  // No team country: the domestic league's country.
  assert.equal(body.data.clubs[2].country, "FRA");
  assert.deepEqual(body.data.facets, { countries: ["FRA"], competitionIds: ["l_3FJFUl"] });
  assert.deepEqual(body.meta, {
    generation: "7", publishedAt: "2025-09-20T11:00:00.000Z", sourceRetrievedAt: "2025-09-20T10:00:00.000Z",
    latestSourceRetrievedAt: "2025-09-20T10:00:00.000Z", startDate: "2025-09-01", endDate: "2025-09-06",
    partitionCount: 1, missingWatermarks: 0,
  });
  assert.deepEqual(body.pagination, { page: 1, limit: 24, total: 4, pages: 1, generation: "7" });
});

test("club analysis: records, statistics, forms, formations, goal times", { skip }, async () => {
  const { body } = await get(clubs + "&analysis=1&sort=points&direction=desc");
  const ids = body.data.clubs.map((c) => c.id);
  assert.deepEqual(ids, ["t_aaaaa1", "t_aaaaa3", "t_aaaaa2", "t_aaaaa4"]);
  const t1 = body.data.clubs[0];
  assert.deepEqual(Object.keys(t1).sort(), ANALYSIS_KEYS);
  assert.deepEqual(
    [t1.matches, t1.wins, t1.draws, t1.losses, t1.points, t1.goalsFor, t1.goalsAgainst, t1.cleanSheets],
    [3, 1, 1, 1, 4, 2, 1, 2],
  );
  assert.deepEqual(t1.home, { matches: 2, wins: 1, draws: 0, losses: 1, points: 3, goalsFor: 2, goalsAgainst: 1, cleanSheets: 1 });
  assert.deepEqual(t1.stats.xgFor, { sum: 2.25, count: 3 });
  assert.deepEqual(t1.stats.possession, { sum: 138, count: 3 });
  assert.equal(t1.stats.corners, undefined); // never observed: omitted, as today
  assert.deepEqual(t1.formations, [["4-3-3", 2], ["4-4-2", 1]]);
  // As main, from the shot map: only match 1 has one (its two goals); the goal conceded in
  // match 3 has no shot, so it is not observed.
  assert.deepEqual(t1.goalTimes, { for: [1, 1, 0, 0, 0, 0], against: [0, 0, 0, 0, 0, 0], observed: 2 });
  assert.equal(t1.forms.length, 3);
  assert.deepEqual(t1.forms[0], {
    match: {
      id: "m_aaaaa5", season: "2025/2026", leagueId: "l_3FJFUl", league: "Ligue 1", date: "2025-09-05",
      timeUtc: "2025-09-05T19:00:00Z", status: "finished",
      home: { id: "t_aaaaa4", name: "Union Sud", score: 0, formation: "4-3-3" },
      away: { id: "t_aaaaa1", name: "Olympique Été", score: 0, formation: "4-4-2" },
    },
    result: "N", scoreFor: 0, scoreAgainst: 0, side: "away",
  });
  const t2 = body.data.clubs[2];
  assert.equal(t2.unscored, 0);
  assert.equal(t2.count, 3); // the upcoming match counts in the directory, not in the record
  assert.equal(t2.matches, 2);
});

test("accent-insensitive search, country and competition filters", { skip }, async () => {
  const { body } = await get(clubs + "&q=ete");
  assert.deepEqual(body.data.clubs.map((c) => c.id), ["t_aaaaa1"]);
  const none = await get(clubs + "&competition=l_zzzzzz");
  assert.equal(none.body.pagination.total, 0);
});

test("errors: stable codes and retry advice", { skip }, async () => {
  const bad = await get(clubs + "&unknown=1");
  assert.equal(bad.response.status, 400);
  assert.deepEqual(bad.body.error, { code: "INVALID_PARAMETER", message: "Paramètres invalides.", retry: false });
  const changed = await get(clubs + "&generation=6");
  assert.equal(changed.response.status, 409);
  assert.equal(changed.body.error.code, "PUBLICATION_CHANGED");
  assert.equal(changed.body.error.retry, true);
  const missing = await get("/api/read/nothing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "RESOURCE_NOT_FOUND");
  const season = await get("/api/read/clubs?season=bad");
  assert.equal(season.response.status, 400);
});

test("media=1 maps image URLs to their copies", { skip }, async () => {
  const { response, body } = await get(clubs + "&media=1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"media-v1-/);
  assert.deepEqual(body.media, { "https://img.example/t1.png": "https://media.test/data/sources/v2/images/" + "ab".repeat(32) + ".png" });
  const again = await get(clubs + "&media=1", { "if-none-match": response.headers.get("etag") });
  assert.equal(again.response.status, 304);
  // Not a compact read: no map, as on main.
  assert.equal((await get("/api/dashboard/manifest?media=1")).response.status, 400);
});

test("a database failure answers DATA_UNAVAILABLE, never the database's code", { skip }, async () => {
  const { createHandler } = await import("../src/handler.mjs");
  const failing = createHandler({ read: async () => { throw Object.assign(new Error("boom"), { code: "42P18" }); } });
  const response = await failing(new Request("https://api.test" + clubs));
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).error, { code: "DATA_UNAVAILABLE", message: "Données indisponibles.", retry: true });
});

test("conditional reads answer 304 without the payload query", { skip }, async () => {
  const first = await get(clubs);
  const again = await get(clubs, { "if-none-match": first.response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

test("the read role cannot reach core, agg or ops", { skip }, async () => {
  await assert.rejects(context.reader.read("SELECT 1 FROM core.matches"), /permission denied/);
  await assert.rejects(context.reader.read("SELECT 1 FROM agg.team_season_stats"), /permission denied/);
  await assert.rejects(context.reader.read("INSERT INTO api.publication VALUES (1, now())"), /read-only|permission denied|cannot insert/);
});

test("manifest, health and status", { skip }, async () => {
  const { response, body } = await get("/api/dashboard/manifest");
  assert.equal(response.status, 200);
  assert.equal(body.publicationVersion, "7");
  assert.equal(body.defaultSeason, "2025/2026");
  assert.equal(body.capabilities.compactReads.clubs, true);
  assert.equal(body.schemaVersion, 5);
  const chunk = body.seasons[0].chunks[0];
  assert.equal(chunk.leagueId, "l_3FJFUl");
  // A league's entry carries what is its own: its competition is in the catalogue, the
  // publication's date on the manifest (the site puts both back).
  assert.deepEqual(Object.keys(chunk).sort(), ["leagueId", "meta", "sourceDigest"]);
  assert.deepEqual(Object.keys(chunk.meta).sort(), ["collectedMatches", "endDate", "expectedFinishedMatches", "matchCount", "retrievedAt", "startDate", "teamCount"]);
  assert.ok(body.competitions.some((c) => c.id === chunk.leagueId) && body.publishedAt);
  // What the request spent, for whoever measures it: one statement since GH141 (four before).
  assert.match(response.headers.get("server-timing"), /^total;dur=\d+\.\d, db;dur=\d+\.\d;desc="1 query"$/);
  assert.deepEqual(
    [chunk.meta.matchCount, chunk.meta.expectedFinishedMatches, chunk.meta.collectedMatches, chunk.meta.teamCount],
    [6, 5, 5, 4],
  );
  assert.deepEqual(body.competitions, [
    { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", providerCountry: "FRA", imageUrl: "https://img.example/l1.png", seasons: ["2025/2026"] },
  ]);
  assert.deepEqual(body.clubCountries, { t_aaaaa1: "FRA", t_aaaaa2: "FRA", t_aaaaa4: "FRA" });
  const health = await get("/api/health");
  // GH202-a: the package it runs (VEGA_RELEASE), null without it (FAILURE_MODES_OPTIMISATIONS.md).
  assert.deepEqual(health.body, { source: "AWS", status: "ok", revision: "7", release: null });
  const status = await get("/api/status");
  assert.equal(status.body.schema, "v2");
  assert.match(status.response.headers.get("server-timing"), /^total;dur=\d+\.\d, db;dur=0\.0;desc="0 queries"$/);
  assert.match((await get("/api/nothing")).response.headers.get("server-timing"), /^total;dur=/);
  // A constant: the browser keeps it, where every page asked the function for it.
  assert.equal(status.response.headers.get("cache-control"), "public, max-age=3600, s-maxage=3600");
  assert.equal(health.response.headers.get("cache-control"), "no-store");
  assert.equal(body.capabilities.compactReads.league, true);
  assert.deepEqual([body.capabilities.wholeSelection, body.capabilities.playedLeague, body.capabilities.roleGroups], [true, true, true]);
});

test("the manifest's validator changes with what a deploy puts in it", { skip }, async () => {
  const { response, body } = await get("/api/dashboard/manifest");
  const etag = response.headers.get("etag");
  assert.equal((await get("/api/dashboard/manifest", { "if-none-match": etag })).response.status, 304);
  // The same publication under other capabilities is another manifest: its validator
  // must not be the one browsers and the distribution hold.
  const now = manifestShape(body.schemaVersion, CAPABILITIES);
  assert.match(now, /^[a-f0-9]{12}$/);
  assert.notEqual(manifestShape(body.schemaVersion, { ...CAPABILITIES, roleGroups: false }), now);
  assert.notEqual(manifestShape(body.schemaVersion + 1, CAPABILITIES), now);
  assert.deepEqual(body.capabilities, CAPABILITIES);
});

test("the default season is the latest one already started", async () => {
  const { defaultSeason } = await import("../src/routes/system.mjs");
  const season = (...starts) => ({ chunks: starts.map((startDate) => ({ meta: { startDate } })) });
  // A league's next calendar year is published ahead: it is not the default.
  const seasons = new Map([["2027/2028", season("2027-02-13")], ["2026/2027", season("2026-08-14", null)], ["2025/2026", season("2025-08-15")]]);
  assert.equal(defaultSeason(seasons, "2026-11-09"), "2026/2027");
  assert.equal(defaultSeason(seasons, "2027-02-13"), "2027/2028");
  assert.equal(defaultSeason(new Map([["2027/2028", season("2027-02-13")]]), "2026-11-09"), "2027/2028");
  assert.equal(defaultSeason(new Map(), "2026-11-09"), null);
});

// GH141 (FAILURE_MODES_OPTIMISATIONS.md, written before these tests): the manifest's statements, and its bytes against
// the native statements'.
const MANIFEST = "/api/dashboard/manifest";
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

test("GH141-a, b, c: the manifest in one statement; HEAD, its tag and * in the publication's one; another tag in two", { skip }, async () => {
  const ask = counting();
  const plain = await ask(MANIFEST);
  assert.deepEqual([plain.status, plain.statements.length], [200, 1]);
  assert.match(plain.timing, /desc="1 query"$/);
  for (const [headers, method, status] of [[{}, "HEAD", 200], [{ "if-none-match": plain.etag }, "GET", 304], [{ "if-none-match": "*" }, "GET", 304]]) {
    const r = await ask(MANIFEST, headers, method);
    assert.deepEqual([r.status, r.etag, r.cache, r.body, r.statements.length], [status, plain.etag, plain.cache, null, 1], `${method} ${JSON.stringify(headers)}`);
    assert.doesNotMatch(r.statements[0], /api\.editions/, "the publication alone");
  }
  const stale = await ask(MANIFEST, { "if-none-match": `W/"core-v3-${"0".repeat(64)}"` });
  assert.deepEqual([stale.status, stale.etag, stale.cache, stale.statements.length], [200, plain.etag, plain.cache, 2]);
  assert.deepEqual(stale.body, plain.body);
});

test("GH141-a, f: the manifest's lists, digests and watermarks are those of the native statements", { skip }, async () => {
  const { body } = await get(MANIFEST);
  const [[state], editions, competitions, countries] = await Promise.all([
    context.reader.read("SELECT generation::text AS version, published_at FROM api.publication"),
    context.reader.read(`SELECT season, league_id, start_date, end_date, match_count, finished_count, collected_count, team_count, retrieved_at
                         FROM api.editions ORDER BY season DESC, league_id`),
    context.reader.read("SELECT id, name, country, image_url, seasons FROM api.competitions ORDER BY name, id"),
    context.reader.read("SELECT team_id, country FROM api.team_countries"),
  ]);
  assert.ok(editions.length && editions.every((p) => p.retrieved_at === null || p.retrieved_at instanceof Date), "typed watermarks");
  assert.deepEqual([body.publicationVersion, body.publishedAt, body.retrievedAt, body.scouting.sourceDigest], [state.version, iso(state.published_at), iso(state.published_at), state.version]);
  assert.deepEqual(body.seasons.flatMap((s) => s.chunks.map((chunk) => [s.id, chunk])), editions.map((p) => [p.season, {
    leagueId: p.league_id, sourceDigest: editionDigest(p),
    meta: { ...editionCounts(p), retrievedAt: iso(p.retrieved_at), startDate: p.start_date, endDate: p.end_date },
  }]));
  assert.deepEqual(body.competitions, competitions.map((c) => ({ id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: c.image_url, seasons: c.seasons || [] })));
  assert.deepEqual(body.clubCountries, Object.fromEntries(countries.map((r) => [r.team_id, r.country])));
});

test("GH141-f: a watermark's text, parsed as the reader parses the column, is the column's Date, in any session offset", { skip }, async () => {
  const texts = ["2025-09-20 10:00:00.123456+00", "2025-09-20 10:00:00.999999+00", "2025-09-20 10:00:00.123+00", "2025-09-20 10:00:00.1+00",
    "2025-09-20 10:00:00+00", "2025-09-20 12:30:00.5005+02:30", null];
  const sql = "SELECT x AS typed, x::text AS text FROM unnest($1::timestamptz[]) WITH ORDINALITY AS u(x, n) ORDER BY n";
  const same = (rows) => {
    assert.equal(rows.length, texts.length);
    for (const r of rows) assert.deepEqual(timestamp(r.text), r.typed, r.text);
  };
  same(await context.reader.read(sql, [texts]));
  // A session in another time zone writes its offset in the text: the same instants.
  const client = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN, types });
  await client.connect();
  try {
    await client.query("SET TimeZone = 'Asia/Kolkata'");
    const { rows } = await client.query(sql, [texts]);
    assert.ok(rows.some((r) => /\+05:30$/.test(r.text ?? "")), "the session's offset in the text");
    same(rows);
  } finally {
    await client.end();
  }
});

// A stand-in read: the publication's version alone (`check`), and the manifest's statement (`snapshot`, with its lists).
function manifestBase({ check, snapshot, lists = true }) {
  const statements = [];
  const edition = { season: "2025/2026", league_id: "l_3FJFUl", start_date: "2025-09-01", end_date: null, match_count: 6, finished_count: 5,
    collected_count: 5, team_count: 4, retrieved_at: "2025-09-20 10:00:00.123456+00" };
  const competition = { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", image_url: null, seasons: null };
  const read = async (sql) => {
    statements.push(sql);
    const full = /api\.editions/.test(sql), version = full ? snapshot : check;
    if (version === null) return [];
    const state = { version, published_at: new Date("2025-09-20T11:00:00.000Z") };
    return [full ? { ...state, editions: lists ? [edition] : [], competitions: lists ? [competition] : [], countries: lists ? [["t_aaaaa1", "FRA"]] : [] } : state];
  };
  return { statements, handle: (headers = {}, method = "GET") => createHandler({ read })(new Request("https://api.test" + MANIFEST, { headers, method })) };
}

test("GH141-d, e, g: the tag names the publication the lists were read with; none, a 503; empty lists; a watermark's text", async () => {
  const tagOf = async (version) => (await manifestBase({ check: version, snapshot: version }).handle()).headers.get("etag");
  const [six, eight] = [await tagOf("6"), await tagOf("8")];
  // d: the request holds 6's tag, the publication is 7 when checked and 8 in the snapshot: its tag and body say 8.
  const moved = manifestBase({ check: "7", snapshot: "8" });
  const response = await moved.handle({ "if-none-match": six });
  const body = await response.json();
  assert.deepEqual([response.status, response.headers.get("etag"), body.publicationVersion, body.scouting.sourceDigest, moved.statements.length], [200, eight, "8", "8", 2]);
  // The watermark's text: the Date to the millisecond, its digest the typed row's (int8 counts as the reader gives them).
  const typed = { season: "2025/2026", league_id: "l_3FJFUl", match_count: "6", finished_count: "5", collected_count: "5", team_count: "4", retrieved_at: new Date("2025-09-20T10:00:00.123Z") };
  assert.deepEqual(body.seasons, [{ id: "2025/2026", chunks: [{ leagueId: "l_3FJFUl", sourceDigest: editionDigest(typed),
    meta: { matchCount: 6, expectedFinishedMatches: 5, collectedMatches: 5, teamCount: 4, retrievedAt: "2025-09-20T10:00:00.123Z", startDate: "2025-09-01", endDate: null } }] }]);
  assert.deepEqual([body.competitions, body.clubCountries], [[{ id: "l_3FJFUl", name: "Ligue 1", country: "FRA", providerCountry: "FRA", imageUrl: null, seasons: [] }], { t_aaaaa1: "FRA" }]);
  // e: no publication, whatever is asked: a 503 in one statement.
  for (const [headers, method] of [[{}, "GET"], [{}, "HEAD"], [{ "if-none-match": six }, "GET"]]) {
    const none = manifestBase({ check: null, snapshot: null });
    assert.deepEqual([(await none.handle(headers, method)).status, none.statements.length], [503, 1], `${method} ${JSON.stringify(headers)}`);
  }
  // g: no editions, competitions or clubs.
  const empty = await (await manifestBase({ check: "7", snapshot: "7", lists: false }).handle()).json();
  assert.deepEqual([empty.seasons, empty.competitions, empty.clubCountries, empty.defaultSeason], [[], [], {}, null]);
});
