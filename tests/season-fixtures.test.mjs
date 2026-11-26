// A competition's season in one read on the site (FAILURE_MODES_OPTIMISATIONS.md GH129-c, GH129-d, GH129-g, GH129-i,
// GH129-m, GH129-n, each written before its change): completeFixtures with the manifest's `seasonFixtures`, its
// fallbacks to /api/fixtures' pages, one read shared by the match page's head and its « Classement », the head without
// /api/matchdays for the native API's rows (with it for rows that do not carry their round), a family the API does not
// have without the legacy archive read only when the manifest says so, and the read and its pages pinned to the
// manifest's publication, never returning nor keeping another generation's rows under it.
import test from "node:test";
import assert from "node:assert/strict";
import { completeFixtures } from "../dashboard/frontend/src/services/fixture-pages.js";
import { loadMatchNav, navPosition, navRounds, navSearch } from "../dashboard/frontend/src/services/match-nav.js";
import { FootballDataClient } from "../dashboard/frontend/src/services/football-client.js";
import { primeResource } from "../dashboard/frontend/src/services/resources.js";
import {
  PUBLICATION_UNAVAILABLE, holdExplicitPublication, onPublicationChanged,
} from "../dashboard/frontend/src/services/publication-change.js";

// The manifest's publicationVersion is the publication's generation the API's reads carry (one value, api.publication).
const MANIFEST = { storage: "aws-relational", publicationVersion: "7", capabilities: { seasonFixtures: true, fixturePaginationOrder: true } };
const fixtureRow = (i) => ({
  id: `m_${String(i).padStart(6, "0")}`, season: "2025/2026", date: `2025-08-${String(1 + (i % 28)).padStart(2, "0")}`, time_utc: "19:00",
  status: i < 300 ? "finished" : "not_started", round_name: String(1 + Math.floor(i / 10)), has_playoff: false,
  home_team: { id: "t_000001", name: "Un" }, away_team: { id: "t_000002", name: "Deux" }, league: { id: "l_000001", name: "Ligue" },
  score_home: i < 300 ? 1 : null, score_away: i < 300 ? 0 : null,
});
const ROWS = Array.from({ length: 386 }, (_, i) => fixtureRow(i));
// A match only the newer publications have: a row of theirs kept under an older one shows by its id.
const LATE = { ...fixtureRow(386), id: "m_900000" };
// The API at publication `current` (as the real one: its season's read, its pages and their cursors are of its current
// publication alone): /api/fixtures/season answers the whole season pinned to it (409 for another; `seasonStatus`
// otherwise), /api/fixtures its pages of `limit`, each cursor naming its publication (409 once it is not the current
// one). `moveAfter`: the API moves to `next` once that many pages are served (a publication between two pages). `edge`
// answers the season with another generation's body whatever is asked (an edge holding an older answer). Publications
// above `older` have the late match. `rows`, `matchdays`: the season's rows (a function of the generation) and the
// answer of /api/matchdays.
function api({ seasonStatus = 200, delay = 0, current = "7", edge = null, moveAfter = null, next = null, older = current, rows = null, matchdays = {} } = {}) {
  const calls = [];
  let now = current, served = 0;
  const season = (generation) => (rows ? rows(generation) : Number(generation) > Number(older) ? [...ROWS, LATE] : ROWS);
  const fetcher = async (url, init = {}) => {
    const u = new URL(String(url), "https://api.test");
    calls.push(u.pathname + u.search);
    if (delay) await new Promise((done, fail) => {
      const timer = setTimeout(done, delay);
      init.signal?.addEventListener("abort", () => { clearTimeout(timer); fail(init.signal.reason); }, { once: true });
    });
    if (u.pathname === "/api/fixtures/season") {
      if (seasonStatus !== 200) return Response.json({ ok: false, error: { code: "SEASON_TOO_LARGE", retry: false } }, { status: seasonStatus });
      if (edge) return Response.json({ data: { matches: ROWS.slice(0, 3) }, meta: { generation: edge, count: 3 } });
      if (u.searchParams.get("generation") !== now)
        return Response.json({ ok: false, error: { code: "PUBLICATION_CHANGED", retry: true } }, { status: 409 });
      return Response.json({ data: { matches: season(now) }, meta: { generation: now, count: season(now).length } });
    }
    if (u.pathname === "/api/fixtures") {
      const limit = Number(u.searchParams.get("limit"));
      const cursor = u.searchParams.get("cursor");
      if (cursor && cursor.split(":")[0] !== now)
        return Response.json({ ok: false, error: { code: "PUBLICATION_CHANGED", retry: true } }, { status: 409 });
      const start = cursor ? Number(cursor.split(":")[1]) : 0;
      const all = u.searchParams.has("from") ? season(now).filter((m) => m.date === u.searchParams.get("from")) : season(now);
      const page = all.slice(start, start + limit);
      const body = { data: { matches: page }, pagination: { limit, nextCursor: start + limit < all.length ? `${now}:${start + limit}` : null, generation: now } };
      if (moveAfter !== null && ++served === moveAfter) now = next;
      return Response.json(body);
    }
    if (u.pathname === "/api/matchdays") return Response.json({ matches: matchdays });
    return Response.json({ ok: false, error: { code: "RESOURCE_NOT_FOUND" } }, { status: 404 });
  };
  return { calls, fetcher };
}

test("GH129-c the season in one read when the manifest says so; the pages otherwise and on a 413", async (t) => {
  const one = api();
  t.mock.method(globalThis, "fetch", one.fetcher);
  const matches = await completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest: MANIFEST });
  assert.deepEqual(one.calls, ["/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=7"]);
  assert.deepEqual(matches.map((m) => m.id), ROWS.map((m) => m.id));
  t.mock.restoreAll();

  const paged = api();
  t.mock.method(globalThis, "fetch", paged.fetcher);
  const old = await completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest: { ...MANIFEST, capabilities: {} } });
  assert.equal(paged.calls.filter((c) => c.startsWith("/api/fixtures?")).length, 8);
  assert.equal(paged.calls.filter((c) => c.startsWith("/api/fixtures/season")).length, 0);
  assert.deepEqual(old.map((m) => m.id), ROWS.map((m) => m.id));
  t.mock.restoreAll();

  const big = api({ seasonStatus: 413, current: "8" });
  t.mock.method(globalThis, "fetch", big.fetcher);
  const fallback = await completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest: { ...MANIFEST, publicationVersion: "8" } });
  assert.equal(big.calls[0], "/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=8");
  assert.equal(big.calls.filter((c) => c.startsWith("/api/fixtures?")).length, 8, "the pages after a 413, never a shorter season");
  assert.equal(fallback.length, 386);
  t.mock.restoreAll();

  // A day's fixtures stay paged.
  const day = api();
  t.mock.method(globalThis, "fetch", day.fetcher);
  await completeFixtures({ day: "2025-08-02" }, { manifest: MANIFEST });
  assert.ok(day.calls.every((c) => c.startsWith("/api/fixtures?")), day.calls.join(" "));
});

test("GH129-d one read shared by every reader of the same season and publication; the last one leaving cancels it", async (t) => {
  const shared = api({ delay: 30, current: "9" });
  t.mock.method(globalThis, "fetch", shared.fetcher);
  const manifest = { ...MANIFEST, publicationVersion: "9" };
  const [a, b] = await Promise.all([
    completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest }),
    completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest }),
  ]);
  assert.equal(shared.calls.length, 1);
  assert.equal(a.length, 386);
  assert.deepEqual(a, b);
  t.mock.restoreAll();

  const leaving = api({ delay: 50, current: "10" });
  t.mock.method(globalThis, "fetch", leaving.fetcher);
  const later = { ...MANIFEST, publicationVersion: "10" };
  const first = new AbortController(), second = new AbortController();
  const p1 = completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest: later, signal: first.signal });
  const p2 = completeFixtures({ league: "l_000001", season: "2025/2026" }, { manifest: later, signal: second.signal });
  first.abort();
  await assert.rejects(p1, { name: "AbortError" });
  assert.equal((await p2).length, 386, "the other reader keeps the read");
  assert.equal(leaving.calls.length, 1);
});

test("GH129-e the head reads the season once and asks no round of /api/matchdays", async (t) => {
  const head = api({ current: "11" });
  t.mock.method(globalThis, "fetch", head.fetcher);
  const f = { manifest: { ...MANIFEST, publicationVersion: "11" }, client: { fixtures: new Map() } };
  const nav = await loadMatchNav(f, { league: "l_000001", season: "2025/2026" });
  assert.deepEqual(head.calls, ["/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=11"]);
  assert.equal(nav.matches.length, 386);
  assert.equal(nav.rounds["m_000000"].name, "1");
});

test("GH129-g a family absent with the manifest's matchFamilyRoutes: no archive read; an older server keeps the archive", async (t) => {
  const data = { meta: { endDate: "2025-09-01", storage: "aws-relational", generation: "7" }, competitions: [], matches: [] };
  const match = { id: "m_aaaaa1", leagueId: "l_000001", season: "2025/2026", status: "finished" };
  async function family(capabilities, status) {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      calls.push(String(url).split("?")[0]);
      if (String(url).includes("/api/archive/")) return Response.json({ endpoints: {} });
      return Response.json({ ok: false, error: { code: "RESOURCE_NOT_FOUND", message: "Donnée indisponible." } }, { status });
    });
    const client = new FootballDataClient({ data, manifest: { storage: "aws-relational", publicationVersion: "7", capabilities } });
    client.configured = true;
    client.statusKnown = true;
    await assert.rejects(client.endpointResponse(match, "momentum"), /pas disponibles pour ce match|Donnée indisponible|indisponible/);
    t.mock.restoreAll();
    return calls;
  }
  assert.deepEqual(await family({ matchFamilyRoutes: true }, 404), ["/api/matches/m_aaaaa1/momentum"]);
  for (const status of [404, 405, 501])
    assert.deepEqual(await family({}, status), ["/api/matches/m_aaaaa1/momentum", "/api/archive/matches/m_aaaaa1"], String(status));
});

test("GH129-i the season pinned to the manifest's publication: another generation's answer is never kept under it", async (t) => {
  const changed = [];
  const stop = onPublicationChanged(() => changed.push(true));
  t.after(stop);
  const scope = { league: "l_000001", season: "2025/2026" };
  const read = async (server, version) => {
    t.mock.method(globalThis, "fetch", server.fetcher);
    const rows = await completeFixtures(scope, { manifest: { ...MANIFEST, publicationVersion: version } });
    t.mock.restoreAll();
    return rows;
  };
  // Manifest 21, the API at 21: one pinned read, kept; a second reader asks nothing.
  const at21 = api({ current: "21" });
  assert.equal((await read(at21, "21")).length, 386);
  assert.deepEqual(at21.calls, ["/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=21"]);
  await read(at21, "21");
  assert.equal(at21.calls.length, 1);
  // Manifest 22, an edge answering 21's three rows for 22's URL: nothing kept, the manifest re-read, 22's pages.
  const edge = api({ current: "22", edge: "21" });
  assert.equal((await read(edge, "22")).length, 386, "the whole season, from the pages");
  assert.ok(edge.calls.some((c) => c.startsWith("/api/fixtures?")), edge.calls.join(" "));
  assert.equal(changed.length, 1);
  const healthy = api({ current: "22" });
  assert.equal((await read(healthy, "22")).length, 386, "never the edge's three rows");
  assert.deepEqual(healthy.calls, ["/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=22"]);
  // Manifest 23 while the API is at 24 (409, its pages of 24): the manifest re-read, the read fails, nothing of 24
  // returned nor kept under 23.
  const newer = api({ current: "24", older: "23" });
  t.mock.method(globalThis, "fetch", newer.fetcher);
  await assert.rejects(completeFixtures(scope, { manifest: { ...MANIFEST, publicationVersion: "23" } }), { code: "PUBLICATION_CHANGED", message: PUBLICATION_UNAVAILABLE });
  t.mock.restoreAll();
  assert.equal(changed.length, 2);
  const again = api({ current: "24", older: "23" });
  t.mock.method(globalThis, "fetch", again.fetcher);
  await assert.rejects(completeFixtures(scope, { manifest: { ...MANIFEST, publicationVersion: "23" } }), { code: "PUBLICATION_CHANGED" });
  t.mock.restoreAll();
  assert.equal(again.calls[0], "/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=23", "asked again, nothing kept");
  // The new publication: pinned 24, kept under 24, its late match with it.
  const at24 = api({ current: "24", older: "23" });
  const rows24 = await read(at24, "24");
  assert.equal(rows24.length, 387);
  assert.ok(rows24.some((m) => m.id === LATE.id));
  assert.deepEqual(at24.calls, ["/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=24"]);
});

test("GH129-m manifest N, the API at N+1: no row of N+1 returned nor kept under N, whatever leads to the pages", async (t) => {
  const changed = [];
  const stop = onPublicationChanged(() => changed.push(true));
  t.after(stop);
  const scope = { league: "l_000001", season: "2025/2026" };
  const N = "31", N1 = "32";
  const manifestN = { ...MANIFEST, publicationVersion: N };
  const old = { ...manifestN, capabilities: {} };
  const refused = { code: "PUBLICATION_CHANGED", message: PUBLICATION_UNAVAILABLE };
  const run = async (server, fn) => {
    const s = api({ older: N, ...server });
    t.mock.method(globalThis, "fetch", s.fetcher);
    try {
      return await fn(s);
    } finally {
      t.mock.restoreAll();
    }
  };
  const cases = [
    ["the season refused (409)", { current: N1 }, manifestN, scope],
    ["the season too long (413)", { current: N1, seasonStatus: 413 }, manifestN, scope],
    ["an older API", { current: N1 }, old, scope],
    ["between two pages, an older API", { current: N, moveAfter: 2, next: N1 }, old, scope],
    ["between two pages, after a 413", { current: N, moveAfter: 3, next: N1, seasonStatus: 413 }, manifestN, scope],
    ["a day's fixtures", { current: N1 }, manifestN, { day: "2025-08-02" }],
  ];
  for (const [what, server, manifest, asked] of cases) await t.test(what, async () => {
    const before = changed.length;
    await run(server, (s) => assert.rejects(completeFixtures(asked, { manifest }), refused, `${what}: ${s.calls.join(" ")}`));
    assert.equal(changed.length, before + 1, `${what}: the site told once to re-read its manifest`);
    // Read again: asked again, nothing kept under N.
    const calls = await run(server, async (s) => {
      await assert.rejects(completeFixtures(asked, { manifest }), refused, what);
      return s.calls;
    });
    assert.ok(calls.length > 0, `${what}: asked again`);
  });
  // A link's ?v=N: shown or failed; never another publication, nor a re-read of the manifest asked.
  await t.test("a link's ?v=N", async () => {
    const release = holdExplicitPublication(N);
    try {
      for (const [what, server, manifest] of cases.slice(0, 3)) {
        const before = changed.length;
        await run(server, () => assert.rejects(completeFixtures(scope, { manifest }), refused, `?v=N, ${what}`));
        assert.equal(changed.length, before, `?v=N, ${what}: no re-read asked`);
      }
    } finally {
      release();
    }
  });

  // The real callers. The head's resource (MatchNav.jsx's key): nothing kept under N, asked again.
  await t.test("the head's resource", async () => {
    const f = { manifest: manifestN, client: { fixtures: new Map() } };
    const key = `match-nav:l_000001:2025/2026:${N}`;
    for (let i = 0; i < 2; i++) {
      const calls = await run({ current: N1 }, async (s) => {
        await assert.rejects(primeResource(key, ({ signal }) => loadMatchNav(f, scope, { signal })), refused);
        return s.calls;
      });
      assert.equal(calls[0], `/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=${N}`, `head, read ${i + 1}`);
    }
  });
  // The football client of manifest N: its fixtures hold its own snapshot, never a row of N+1.
  await t.test("the football client", async () => {
    const data = {
      meta: { endDate: "2025-09-01", storage: "aws-relational", generation: N },
      competitions: [{ id: "l_000001", name: "Ligue" }],
      matches: [{ id: "m_000000", leagueId: "l_000001", league: "Ligue", season: "2025/2026", date: "2025-08-01", status: "finished",
        home: { id: "t_000001", name: "Un", score: 1 }, away: { id: "t_000002", name: "Deux", score: 0 } }],
    };
    const client = new FootballDataClient({ data, manifest: manifestN });
    Object.assign(client, { configured: true, statusKnown: true, competitionId: "l_000001", season: "2025/2026" });
    await run({ current: N1 }, () => client.loadFixtures());
    const held = client.fixtures.get("l_000001:2025/2026");
    assert.equal(held.source, "snapshot");
    assert.deepEqual(held.matches.map((m) => m.id), ["m_000000"], "the client's own snapshot");
    assert.equal(client.fixtureIndex.has(LATE.id), false);
    await run({ current: N1 }, () => assert.rejects(client.request("leagues/l_000001/matches?season=2025/2026"), refused));
  });
  // Pages all of N (a 413 at N): returned, every row of N.
  await t.test("pages all of N; then the manifest N+1", async () => {
    const atN = await run({ current: N, seasonStatus: 413 }, (s) => completeFixtures(scope, { manifest: manifestN }).then((rows) => ({ rows, s })));
    assert.equal(atN.rows.length, 386);
    assert.equal(atN.s.calls.filter((c) => c.startsWith("/api/fixtures?")).length, 8);
    // The manifest N+1: read and kept under N+1, the late match with it.
    const manifestN1 = { ...MANIFEST, publicationVersion: N1 };
    const fresh = await run({ current: N1 }, (s) => completeFixtures(scope, { manifest: manifestN1 }).then((rows) => ({ rows, s })));
    assert.equal(fresh.rows.length, 387);
    assert.deepEqual(fresh.s.calls, [`/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=${N1}`]);
    assert.deepEqual(await run({ current: N1 }, (s) => completeFixtures(scope, { manifest: manifestN1 }).then(() => s.calls)), [], "kept under N+1");
  });
});

test("GH129-n the head takes the rounds rows do not carry from /api/matchdays; never for the native API's rows", async (t) => {
  const scope = { league: "l_000001", season: "2025/2026" };
  const two = [fixtureRow(0), { ...fixtureRow(1), date: "2025-08-09", home_team: { id: "t_000003", name: "Trois" } }];
  const bare = two.map(({ round_name, has_playoff, ...row }) => row);
  const matchdays = { [two[0].id]: { name: "1", playoff: false }, [two[1].id]: { name: "2", playoff: false } };
  const check = (nav, what) => {
    const groups = navRounds(nav);
    assert.deepEqual(groups.map((g) => g.matches.map((m) => m.id)), [[two[0].id], [two[1].id]], what);
    const at = navPosition(groups, two[0].id);
    assert.equal(at.next?.id, two[1].id, `${what}: the next match`);
    assert.equal(navPosition(groups, two[1].id).previous?.id, two[0].id, `${what}: the previous match`);
    assert.deepEqual(navSearch(groups, "trois").map((r) => r.match.id), [two[1].id], `${what}: the search`);
  };
  // An older server (no season's read): its pages carry no round.
  await t.test("an older server's pages", async () => {
    const older = api({ rows: () => bare, matchdays });
    t.mock.method(globalThis, "fetch", older.fetcher);
    check(await loadMatchNav({ manifest: { ...MANIFEST, capabilities: {} }, client: { fixtures: new Map() } }, scope), "older server");
    t.mock.restoreAll();
    assert.equal(older.calls.filter((c) => c.startsWith("/api/matchdays?")).length, 1, older.calls.join(" "));
  });
  // The football client's snapshot (localFixtures(), what it keeps when the API fails).
  await t.test("the football client's snapshot", async () => {
    const data = {
      meta: { endDate: "2025-09-01", storage: "aws-relational", generation: "7" },
      competitions: [{ id: "l_000001", name: "Ligue" }],
      matches: two.map((row) => ({ id: row.id, leagueId: "l_000001", league: "Ligue", season: "2025/2026", date: row.date, status: "finished",
        home: { ...row.home_team, score: 1 }, away: { ...row.away_team, score: 0 } })),
    };
    const client = new FootballDataClient({ data, manifest: MANIFEST });
    client.fixtures.set("l_000001:2025/2026", { matches: client.localFixtures("l_000001", "2025/2026"), source: "snapshot" });
    const snapshot = api({ matchdays });
    t.mock.method(globalThis, "fetch", snapshot.fetcher);
    check(await loadMatchNav({ manifest: MANIFEST, client }, scope), "snapshot");
    t.mock.restoreAll();
    assert.deepEqual(snapshot.calls, ["/api/matchdays?competition=l_000001&season=2025%2F2026"]);
  });
  // The native API's rows: the field present (null for one fixture): no /api/matchdays, the one season read.
  await t.test("the native API's rows", async () => {
    const native = api({ current: "12", rows: () => [{ ...two[0], round_name: null }, two[1], fixtureRow(2)], matchdays });
    t.mock.method(globalThis, "fetch", native.fetcher);
    const nav = await loadMatchNav({ manifest: { ...MANIFEST, publicationVersion: "12" }, client: { fixtures: new Map() } }, scope);
    t.mock.restoreAll();
    assert.deepEqual(native.calls, ["/api/fixtures/season?league=l_000001&season=2025%2F2026&generation=12"]);
    assert.equal(nav.rounds[two[0].id], undefined, "a fixture without a round stays out of the thread");
  });
});
