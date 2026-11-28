// The reads validated by the version of what they are made from when they name no
// publication: a league's season (/api/read/league) and a competition's pool matches
// (/api/clubs/europe/matches).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { context, get, skip } from "./context.mjs";

const league = "/api/read/league?season=2025/2026&league=l_3FJFUl&detail=summary&limit=100";
const pool = "/api/clubs/europe/matches?season=2025/2026&league=l_3FJFUl";
const cup = "/api/clubs/europe/matches?season=2025/2026&league=l_0bfbkO";
const queries = (response) => Number(/desc="(\d+) quer/.exec(response.headers.get("server-timing"))[1]);

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
});
after(() => owner?.end());

test("the same answer as the publication's, with its version and its own validator", { skip }, async () => {
  for (const [path, ttl] of [[league, 30], [pool, 300]]) {
    const pinned = await get(path + "&generation=7");
    const { response, body } = await get(path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(body.data, pinned.body.data, path);
    assert.match(body.meta.version, /^[a-f0-9]{16}$/);
    assert.equal(pinned.body.meta.version, undefined);
    assert.match(response.headers.get("etag"), /^W\/"versioned-[a-f0-9]{64}"$/);
    assert.match(pinned.response.headers.get("etag"), /^W\/"compact-v2-/);
    // Asked again after 30 s; the publication's answer keeps its own time.
    assert.match(response.headers.get("cache-control"), /s-maxage=30\b/);
    assert.match(pinned.response.headers.get("cache-control"), new RegExp(`s-maxage=${ttl}\\b`));
  }
  assert.deepEqual((await get("/api/dashboard/manifest")).body.capabilities.versionedReads, { league: true, club: true, player: true, europeMatches: true });
});

test("whoever holds the answer is told it is unchanged in one statement", { skip }, async () => {
  for (const path of [league, pool]) {
    const etag = (await get(path)).response.headers.get("etag");
    const again = await get(path, { "if-none-match": etag });
    assert.equal(again.response.status, 304, path);
    assert.equal(queries(again.response), 1);
    assert.equal(again.response.headers.get("etag"), etag);
  }
  // Another page or another filter of the same league is another answer.
  const etag = (await get(league)).response.headers.get("etag");
  assert.equal((await get(league + "&played=1", { "if-none-match": etag })).response.status, 200);
});

test("the pages after the first are fenced by the version", { skip }, async () => {
  const paged = "/api/read/league?season=2025/2026&league=l_3FJFUl&detail=summary&limit=2";
  const first = (await get(paged)).body;
  assert.ok(first.pagination.pages > 1);
  const second = await get(paged + "&page=2&v=" + first.meta.version);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.meta.version, first.meta.version);
  for (const path of [paged + "&page=2", pool]) {
    const stale = await get(path + "&v=" + "0".repeat(16));
    assert.equal(stale.response.status, 409, path);
    assert.equal(stale.body.error.code, "PUBLICATION_CHANGED");
    assert.equal((await get(path + "&v=xyz")).response.status, 400);
    assert.equal((await get(path + "&generation=7&v=" + first.meta.version)).response.status, 400);
  }
  // The pool's head carries the power ranking: it has no version to name.
  assert.equal((await get("/api/clubs/europe?season=2025/2026&v=" + first.meta.version)).response.status, 400);
});

test("the version changes with the scope's editions and with the day, not with a publication", { skip }, async () => {
  const versions = async () => Promise.all([league, pool, cup].map(async (path) => (await get(path)).body.meta.version));
  const start = await versions();
  // A version names a form and its editions: the league's is not its pool matches'.
  assert.notEqual(start[0], start[1]);
  // A publication that touches nothing of the scope.
  await owner.query("INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('home',1) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1");
  await owner.query("UPDATE ops.publication SET generation=generation+1");
  try {
    assert.deepEqual(await versions(), start);
    // The publication's own answer changed its validator; this one did not.
    assert.equal((await get(league + "&generation=7")).response.status, 409);
  } finally {
    await owner.query("UPDATE ops.publication SET generation=generation-1");
  }
  // A match of the league written: the league, its pool matches, and a cup's (the pool's clubs are the leagues').
  const { rows: [edition] } = await owner.query("SELECT competition_season_id AS id FROM api.edition_keys WHERE season='2025/2026' AND league_id='l_3FJFUl'");
  await owner.query(
    "INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('competition_season',$1) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1",
    [edition.id],
  );
  const written = await versions();
  for (let i = 0; i < 3; i++) assert.notEqual(written[i], start[i]);
  // The edition's published counts (a collection the version missed).
  await owner.query("UPDATE agg.editions SET collected_count=collected_count+1 WHERE competition_season_id=$1", [edition.id]);
  const counted = await versions();
  for (let i = 0; i < 3; i++) assert.notEqual(counted[i], written[i]);
  await owner.query("UPDATE agg.editions SET collected_count=collected_count-1 WHERE competition_season_id=$1", [edition.id]);
  // The next day.
  const saved = context.now;
  try {
    context.now += 86_400_000;
    const next = await versions();
    for (let i = 0; i < 3; i++) assert.notEqual(next[i], written[i]);
  } finally {
    context.now = saved;
  }
});


const club = "/api/read/club?season=2025/2026&leagues=all&team=t_aaaaa1";
const player = "/api/read/player?season=2025/2026&leagues=all&player=p_aaaab1";
const OWN = [club + "&detail=summary&limit=100", club + "&include=shots", club + "&include=appearances", player + "&detail=summary&limit=100", player];

test("a club's and a player's own reads: the publication's answer, validated by their own editions", { skip }, async () => {
  for (const path of OWN) {
    const pinned = await get(path + "&generation=7");
    const { response, body } = await get(path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(body.data, pinned.body.data, path);
    assert.deepEqual(body.pagination, pinned.body.pagination, path);
    assert.match(body.meta.version, /^[a-f0-9]{16}$/);
    assert.match(response.headers.get("etag"), /^W\/"versioned-[a-f0-9]{64}"$/);
    // Unchanged for whoever holds it: the actor's ids, then the version.
    const again = await get(path, { "if-none-match": response.headers.get("etag") });
    assert.equal(again.response.status, 304, path);
    assert.equal(queries(again.response), 2);
  }
  // The pages after the first name the version the first gave.
  const first = (await get(club + "&include=appearances&limit=2")).body;
  assert.ok(first.pagination.pages > 1);
  assert.equal((await get(club + "&include=appearances&limit=2&page=2&v=" + first.meta.version)).response.status, 200);
  assert.equal((await get(club + "&include=appearances&limit=2&page=2&v=" + "0".repeat(16))).response.status, 409);
  assert.equal((await get(club + "&generation=7&v=" + first.meta.version)).response.status, 400);
  // An actor the base does not know: an empty answer, and a version all the same.
  const nobody = await get("/api/read/club?season=2025/2026&leagues=all&team=t_zzzzzz");
  assert.equal(nobody.response.status, 200);
  assert.match(nobody.body.meta.version, /^[a-f0-9]{16}$/);
});

test("an actor's version follows the editions of his own matches, no other", { skip }, async () => {
  const versions = async () => Promise.all(OWN.map(async (path) => (await get(path)).body.meta.version));
  const bump = (id) =>
    owner.query(
      "INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('competition_season',$1) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1",
      [id],
    );
  const start = await versions();
  // A club's and a player's reads are two forms.
  assert.notEqual(start[0], start[3]);
  // An edition none of his matches is in, and the actor's own version (it advances with every season's match).
  const { rows: [edition] } = await owner.query("SELECT competition_season_id AS id FROM api.edition_keys WHERE season='2025/2026' AND league_id='l_3FJFUl'");
  const { rows: [other] } = await owner.query("SELECT max(id)+1000 AS id FROM core.competition_seasons");
  await bump(other.id);
  for (const [kind, id] of [["team", "t_aaaaa1"], ["player", "p_aaaab1"]])
    await owner.query(
      `INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('${kind}',api.internal_id('${kind}',$1)) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1`,
      [id],
    );
  assert.deepEqual(await versions(), start);
  // A match of his league written.
  await bump(edition.id);
  const written = await versions();
  for (let i = 0; i < OWN.length; i++) assert.notEqual(written[i], start[i], OWN[i]);
  await owner.query("DELETE FROM ops.resource_versions WHERE resource_kind='competition_season' AND resource_id=$1", [other.id]);
});

// GH139 (FAILURE_MODES_OPTIMISATIONS.md, written before the change): forecast.refresh rewrites agg.match_forecasts without
// an edition's version or a publication. m_aaaaa6, t_aaaaa2 at home to t_aaaaa3, is the seed's match to come.
test("GH139-b–e: a club's validators follow its matches to come's forecasts, no other", { skip }, async () => {
  const M6 = "match_id=api.internal_id('match','m_aaaaa6')";
  const sides = ["t_aaaaa2", "t_aaaaa3"].map((team) => `/api/read/club?season=2025/2026&leagues=all&team=${team}`);
  const paths = [...sides, sides[0] + "&generation=7"];
  const read = async (path, headers) => {
    const { response, body } = await get(path, headers);
    return { status: response.status, etag: response.headers.get("etag"), version: body?.meta.version,
      forecast: body?.data.fixtures.find((f) => f.id === "m_aaaaa6")?.forecast };
  };
  const others = async () => Promise.all([club, league, player].map(async (path) => (await get(path)).body.meta.version));
  const start = await Promise.all(paths.map((path) => read(path))), kept = await others();
  assert.deepEqual(start.map((r) => r.forecast), Array(3).fill({ home: 0.5123, draw: 0.2501, away: 0.2376 }));
  // GH139-d: nothing changed: a 304, in two statements for the versioned reads.
  for (const [i, path] of paths.entries()) {
    const again = await get(path, { "if-none-match": start[i].etag });
    assert.equal(again.response.status, 304, path);
    if (i < 2) assert.equal(queries(again.response), 2, path);
  }
  await owner.query(`CREATE TEMP TABLE gh139 AS SELECT * FROM agg.match_forecasts WHERE ${M6}`);
  try {
    let held = start;
    // GH139-c and e: only the forecast changed, then (GH139-b) deleted: null, never left out.
    for (const [change, want] of [
      [`UPDATE agg.match_forecasts SET home_win=0.6,draw=0.25,away_win=0.15 WHERE ${M6}`, { home: 0.6, draw: 0.25, away: 0.15 }],
      [`DELETE FROM agg.match_forecasts WHERE ${M6}`, null],
    ]) {
      await owner.query(change);
      const now = await Promise.all(paths.map((path, i) => read(path, { "if-none-match": held[i].etag })));
      for (const [i, path] of paths.entries()) {
        assert.equal(now[i].status, 200, `${path}: the tag held before ${change}`);
        assert.deepEqual(now[i].forecast, want, path);
        if (i === 2) continue;
        assert.notEqual(now[i].version, held[i].version, path);
        assert.equal((await get(`${path}&limit=1&page=2&v=${held[i].version}`)).response.status, 409, path);
      }
      assert.deepEqual(await others(), kept, "t_aaaaa1, the league and the player");
      held = now;
    }
    assert.equal((await get(sides[0] + "&generation=6")).response.status, 409);
  } finally {
    await owner.query(`DELETE FROM agg.match_forecasts WHERE ${M6}`);
    await owner.query("INSERT INTO agg.match_forecasts SELECT * FROM gh139");
    await owner.query("DROP TABLE gh139");
  }
  // The same forecast again: the same versions.
  assert.deepEqual((await Promise.all(sides.map((path) => read(path)))).map((r) => r.version), start.slice(0, 2).map((r) => r.version));
});
