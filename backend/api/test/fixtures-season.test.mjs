// GET /api/fixtures/season: one competition's season in one read (FAILURE_MODES_OPTIMISATIONS.md GH129-a, GH129-b,
// GH129-k, GH129-l, GH129-o, each written before its code), against /api/fixtures' pages on the API seed, which gets 120 more fixtures of its Ligue 1
// 2025/2026 here (126 in all: three pages of 50), a competition season of 1 001 fixtures (more than the read takes) and
// one of 900 whose answer passes 4 MiB (two clubs' names of 2 600 characters: synthetic, local).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { context, get, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";
import { tag } from "../src/routes/matches.mjs";

before(() => {
  if (skip) return;
  const script = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import connect_local
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    for i in range(120):
        mid = 8001 + i
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date,kickoff_at)
             VALUES (%s,1,2025,'pitchapi',%s,%s,%s,%s,%s,%s,%s)""",
          (mid, 'finished' if i < 100 else 'not_started', 1 + i % 4, 1 + (i + 1) % 4, i % 3 if i < 100 else None, i % 2 if i < 100 else None,
           f"2025-10-{1 + i % 28:02d}", f"2025-10-{1 + i % 28:02d}T{10 + i % 9}:00:00Z"))
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (f"m_s{i:05d}", mid))
    x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES (9701,'Ligue XXL','FRA','league')")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi','l_xxlxxl',9701)")
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (9701,9701,2025,'2025/2026',true)")
    for i in range(1001):
        mid = 9001 + i
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at)
             VALUES (%s,9701,2025,'pitchapi','not_started',1,2,'2026-01-01','2026-01-01T12:00:00Z')""", (mid,))
    x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES (9702,'Ligue Octets','FRA','league')")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','pitchapi','l_octets',9702)")
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,is_current) VALUES (9702,9702,2025,'2025/2026',true)")
    x("INSERT INTO core.teams(id,name) VALUES (9711,%s),(9712,%s)", ("Nord " + "N" * 2595, "Sud " + "S" * 2596))
    for i in range(900):
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at)
             VALUES (%s,9702,2025,'pitchapi','not_started',9711,9712,'2026-02-01','2026-02-01T12:00:00Z')""", (12001 + i,))
    x("SELECT ops.refresh_editions()")
`;
  const done = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../..", import.meta.url)), process.env.VEGA_V2_API_NODE_TEST_DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

async function pages(query) {
  const rows = [];
  let cursor = null, generation;
  do {
    const { response, body } = await get(`/api/fixtures?${query}&limit=50${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(response.status, 200);
    rows.push(...body.data.matches);
    generation = body.pagination.generation;
    cursor = body.pagination.nextCursor;
  } while (cursor);
  return { rows, generation };
}

test("GH129-a the season in one read: the rows of the pages, in their order, and one statement", { skip }, async () => {
  const paged = await pages("league=l_3FJFUl&season=2025%2F2026&status=all");
  assert.equal(paged.rows.length, 126);
  let statements = 0;
  const handle = createHandler({ read: async (...args) => (statements++, context.reader.read(...args)) });
  const response = await handle(new Request("https://api.test/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.matches, paged.rows);
  assert.equal(body.meta.generation, paged.generation);
  assert.equal(body.meta.count, 126);
  assert.equal(statements, 1);
  assert.match(response.headers.get("cache-control"), /s-maxage=30/);
  // An unknown league: an empty season, as /api/fixtures answers it.
  const unknown = await get("/api/fixtures/season?league=l_zzzzzz&season=2025%2F2026");
  assert.equal(unknown.response.status, 200);
  assert.deepEqual(unknown.body.data.matches, []);
  // The manifest says the read exists.
  assert.equal((await get("/api/dashboard/manifest")).body.capabilities.seasonFixtures, true);
});

test("GH129-b bounds, parameters and the validator", { skip }, async () => {
  const big = await get("/api/fixtures/season?league=l_xxlxxl&season=2025%2F2026");
  assert.equal(big.response.status, 413);
  assert.equal(big.body.error.code, "SEASON_TOO_LARGE");
  for (const query of ["league=x&season=2025%2F2026", "league=l_3FJFUl&season=2025-26", "league=l_3FJFUl", "season=2025%2F2026",
    "league=l_3FJFUl&season=2025%2F2026&status=played", "league=l_3FJFUl&season=2025%2F2026&limit=50", "league=l_3FJFUl&season=2025%2F2026&cursor=abc",
    "league=l_3FJFUl,l_xxlxxl&season=2025%2F2026"]) {
    const { response } = await get(`/api/fixtures/season?${query}`);
    assert.equal(response.status, 400, query);
  }
  const first = await get("/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026");
  const etag = first.response.headers.get("etag");
  assert.ok(etag);
  const again = await get("/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026", { "If-None-Match": etag });
  assert.equal(again.response.status, 304);
});

test("GH129-k pinned to a publication: the current one answers, another is refused; the manifest names the families' routes", { skip }, async () => {
  const current = (await get("/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026")).body.meta.generation;
  assert.match(current, /^\d+$/);
  const pinned = await get(`/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026&generation=${current}`);
  assert.equal(pinned.response.status, 200);
  assert.equal(pinned.body.meta.generation, current);
  const other = await get(`/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026&generation=${Number(current) + 1}`);
  assert.equal(other.response.status, 409);
  assert.equal(other.body.error.code, "PUBLICATION_CHANGED");
  assert.match(other.response.headers.get("cache-control"), /no-store/);
  for (const bad of ["x", "1.5", "", "9".repeat(30)])
    assert.equal((await get(`/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026&generation=${bad}`)).response.status, 400, bad);
  const manifest = (await get("/api/dashboard/manifest")).body;
  assert.equal(manifest.capabilities.matchFamilyRoutes, true);
  assert.equal(manifest.publicationVersion, current, "the manifest's publication is the generation the reads carry");
});

// A HEAD and the conditional GETs answer as the GET (GH129-l, review of 26 Nov 2026 at 04:05): on the season the GET
// refuses (1 001 fixtures), the same 413 no-store, never a 200 that an edge or a browser keeps, never a 304.
test("GH129-l HEAD and conditional GETs of a season over the limit answer the GET's 413; a season within it, 200 and 304", { skip }, async () => {
  const url = (query) => `https://api.test/api/fixtures/season?${query}`;
  const ask = (query, init = {}) => context.handle(new Request(url(query), init));
  const generation = (await get("/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026")).body.meta.generation;
  for (const pin of ["", `&generation=${generation}`]) {
    const big = `league=l_xxlxxl&season=2025%2F2026${pin}`;
    // The validator the shortcut would match for that URL (the URL's and the publication's digest), a client's `*`.
    const would = tag(new Request(url(big)), generation);
    assert.equal((await ask(big)).status, 413, `GET${pin}`);
    for (const [what, init] of [
      ["HEAD", { method: "HEAD" }],
      ["If-None-Match: its URL's validator", { headers: { "If-None-Match": would } }],
      ["If-None-Match: *", { headers: { "If-None-Match": "*" } }],
      ["HEAD, If-None-Match: *", { method: "HEAD", headers: { "If-None-Match": "*" } }],
    ]) {
      const response = await ask(big, init);
      assert.equal(response.status, 413, `${what}${pin}`);
      assert.match(response.headers.get("cache-control"), /no-store/, `${what}${pin}`);
      assert.equal(response.headers.get("etag"), null, `${what}${pin}`);
      if (init.method !== "HEAD") assert.equal((await response.json()).error.code, "SEASON_TOO_LARGE", `${what}${pin}`);
    }
    const within = `league=l_3FJFUl&season=2025%2F2026${pin}`;
    const own = (await ask(within)).headers.get("etag");
    assert.ok(own);
    const head = await ask(within, { method: "HEAD" });
    assert.equal(head.status, 200, `HEAD${pin}`);
    assert.equal(head.headers.get("etag"), own, `HEAD${pin}: the GET's validator`);
    assert.match(head.headers.get("cache-control"), /s-maxage=30/);
    assert.equal((await ask(within, { headers: { "If-None-Match": own } })).status, 304, `If-None-Match${pin}`);
    assert.equal((await ask(within, { headers: { "If-None-Match": "*" } })).status, 304, `If-None-Match: *${pin}`);
  }
});

// The answer's bytes are a limit of the GET too (GH129-o, counter-review of 26 Nov 2026 at 04:25): a season within
// 1 000 fixtures whose answer passes 4 MiB is the GET's 413 for a HEAD and every conditional GET, never 200 nor 304.
test("GH129-o a season within 1 000 fixtures whose answer passes 4 MiB: HEAD and conditional GETs answer the GET's 413", { skip }, async () => {
  const url = (query) => `https://api.test/api/fixtures/season?${query}`;
  const ask = (query, init = {}) => context.handle(new Request(url(query), init));
  const generation = (await get("/api/fixtures/season?league=l_3FJFUl&season=2025%2F2026")).body.meta.generation;
  // Within the count: its pages hold the 900 fixtures.
  const first = await get("/api/fixtures?league=l_octets&season=2025%2F2026&status=all&limit=1");
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.matches[0].home_team.name.length, 2600);
  for (const pin of ["", `&generation=${generation}`]) {
    const heavy = `league=l_octets&season=2025%2F2026${pin}`;
    const got = await ask(heavy);
    assert.equal(got.status, 413, `GET${pin}`);
    assert.match(got.headers.get("cache-control"), /no-store/);
    const refusal = await got.json();
    assert.equal(refusal.error.code, "PAGE_TOO_LARGE", `GET${pin}: the bytes, not the count`);
    // The validator the answer would carry (its URL's and the publication's digest), a client's `*`.
    const would = tag(new Request(url(heavy)), generation);
    for (const [what, init] of [
      ["HEAD", { method: "HEAD" }],
      ["If-None-Match: its URL's validator", { headers: { "If-None-Match": would } }],
      ["If-None-Match: *", { headers: { "If-None-Match": "*" } }],
      ["HEAD, If-None-Match: *", { method: "HEAD", headers: { "If-None-Match": "*" } }],
      ["HEAD, If-None-Match: its URL's validator", { method: "HEAD", headers: { "If-None-Match": would } }],
    ]) {
      const response = await ask(heavy, init);
      assert.equal(response.status, 413, `${what}${pin}`);
      assert.match(response.headers.get("cache-control"), /no-store/, `${what}${pin}`);
      assert.equal(response.headers.get("etag"), null, `${what}${pin}`);
      if (init.method !== "HEAD") assert.deepEqual(await response.json(), refusal, `${what}${pin}: the GET's refusal`);
    }
  }
});
