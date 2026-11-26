// GET /api/matchdays read from the editions asked (FAILURE_MODES_OPTIMISATIONS.md GH137M-a to GH137M-f, written before
// the change): for every selection, the base commit's status, body and ETag, its oracle being the base commit's own
// statement over api.match_rounds (kept) and its own answer building; the validator's revalidations; corrections
// inside and writes outside the selection; and what one request reads of core.matches. The API seed gets, here: 120
// more Ligue 1 2025/2026 matches (a play-off round, matches without a round, a match with a former key, matches without
// a key, `has_playoff`), a league without a PitchAPI key, a calendar-year league (native 2026), a tournament (native
// 2026, season 2025/2026), a league by a former and a current key, a cup's and an archive's editions, a league without
// rounds, and 20 other leagues of 1 000 matches each.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { context, get, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";

const DSN = process.env.VEGA_V2_API_NODE_TEST_DSN;
const LEGACY = "SELECT id,name,playoff FROM api.match_rounds WHERE league_id=$1 AND (season=$2 OR native_season=$2) ORDER BY id";

before(() => {
  if (skip) return;
  const script = `
import sys
sys.path[:0] = [sys.argv[1]]
from vega.store import Store, connect_local
db = connect_local(sys.argv[2])
x = db.execute
with db.transaction():
    store = Store(db)
    for label in ("2026/2027", "2015/2016"):
        store.season(label)
    def league(cid, name, keys, editions):
        x("INSERT INTO core.competitions(id,name,kind) VALUES (%s,%s,'league')", (cid, name))
        for key, current in keys:
            x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id,is_current) VALUES ('competition','pitchapi',%s,%s,%s)", (key, cid, current))
        for eid, season, native, extra in editions:
            x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,archive_key,cup_key) VALUES (%s,%s,%s,%s,%s,%s)",
              (eid, cid, season, native, extra.get("archive"), extra.get("cup")))
    def rounds(edition, names, stage="regular"):
        return [x("INSERT INTO core.rounds(competition_season_id,name,seq,stage) VALUES (%s,%s,%s,%s) RETURNING id", (edition, n, i, stage)).fetchone()[0] for i, n in enumerate(names)]
    def matches(first, edition, season, round_ids, count, key, no_round=lambda i: False):
        for i in range(count):
            mid = first + i
            x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at,round_id)
                 VALUES (%s,%s,%s,'pitchapi','finished',1,2,'2025-10-01','2025-10-01T18:00:00Z',%s)""",
              (mid, edition, season, None if no_round(i) else round_ids[i % len(round_ids)]))
            k = key(i)
            if k:
                x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (k, mid))
    # Ligue 1 2025/2026 (the seed's edition 1): rounds 2 to 12, a play-off round, 120 matches.
    regular = rounds(1, [str(n) for n in range(2, 13)])
    playoff = rounds(1, ["Barrages"], "playoff")
    for i in range(120):
        mid = 8001 + i
        rid = None if i % 10 == 9 else (playoff[0] if i >= 110 else regular[i % len(regular)])
        x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at,round_id,has_playoff)
             VALUES (%s,1,2025,'pitchapi','finished',1,2,'2025-10-01','2025-10-01T18:00:00Z',%s,%s)""", (mid, rid, i == 5))
        if i % 17 == 3:
            continue  # no PitchAPI key: m_v…
        if i % 23 == 4:
            x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id,is_current) VALUES ('match','pitchapi',%s,%s,false)", (f"m_o{i:05d}", mid))
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','pitchapi',%s,%s)", (f"m_k{i:05d}", mid))
    # Ligue 1 2015/2016: an archive's edition (never served by this route).
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label,archive_key) VALUES (9811,1,2015,'2015/2016','fr.1/2015-16-test')")
    matches(8201, 9811, 2015, rounds(9811, ["1", "2"]), 4, key=lambda i: None)
    # A league without a PitchAPI key (l_v0009801); a calendar-year league (native 2026: season 2026/2027); a tournament
    # (native 2026: season 2025/2026); a league known by a former and a current key; a cup's edition; no rounds.
    league(9801, "Sans clé", [], [(9801, 2025, "2025/2026", {})])
    matches(8301, 9801, 2025, rounds(9801, ["1", "2", "3"]), 10, key=lambda i: f"m_n{i:05d}")
    league(9802, "Année civile", [("l_calyr1", True)], [(9802, 2026, "2026", {})])
    matches(8401, 9802, 2026, rounds(9802, ["1", "2", "3", "Play-offs"]), 12, key=lambda i: f"m_c{i:05d}")
    x("UPDATE core.rounds SET stage='playoff' WHERE competition_season_id=9802 AND name='Play-offs'")
    league(9803, "Tournoi", [("l_wcup26", True)], [(9803, 2025, "2026", {})])
    matches(8501, 9803, 2025, rounds(9803, ["Group Stage - 1", "Round of 16", "Final"]), 9, key=lambda i: f"m_w{i:05d}")
    league(9804, "Deux clés", [("l_old001", False), ("l_new001", True)], [(9804, 2025, "2025/2026", {})])
    matches(8601, 9804, 2025, rounds(9804, ["1"]), 6, key=lambda i: f"m_d{i:05d}")
    league(9805, "Coupe", [("l_cup001", True)], [(9805, 2025, "2025/2026", {"cup": "openligadb:test-cup:2025/2026"})])
    matches(8701, 9805, 2025, rounds(9805, ["Final"]), 3, key=lambda i: f"m_u{i:05d}")
    league(9806, "Sans journées", [("l_norou1", True)], [(9806, 2025, "2025/2026", {})])
    matches(8801, 9806, 2025, [None], 5, key=lambda i: f"m_r{i:05d}", no_round=lambda i: True)
    # 20 other leagues of 1 000 matches each (2025/2026), every match with a round and a key.
    x("INSERT INTO core.competitions(id,name,kind) SELECT 9900+c,'Ligue '||c,'league' FROM generate_series(1,20) c")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) SELECT 'competition','pitchapi','l_bulk'||lpad(c::text,2,'0'),9900+c FROM generate_series(1,20) c")
    x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) SELECT 9900+c,9900+c,2025,'2025/2026' FROM generate_series(1,20) c")
    x("INSERT INTO core.rounds(competition_season_id,name,seq) SELECT 9900+c,r::text,r FROM generate_series(1,20) c, generate_series(1,38) r")
    x("""INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,match_date,kickoff_at,round_id)
         SELECT 100000+c*1000+i,9900+c,2025,'pitchapi','finished',1,2,'2025-10-01','2025-10-01T18:00:00Z',r.id
         FROM generate_series(1,20) c CROSS JOIN generate_series(0,999) i
         JOIN core.rounds r ON r.competition_season_id=9900+c AND r.name=((i%38)+1)::text""")
    x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) SELECT 'match','pitchapi','m_b'||lpad((c*1000+i)::text,5,'0'),100000+c*1000+i FROM generate_series(1,20) c, generate_series(0,999) i")
x("ANALYZE core.matches")
x("ANALYZE core.provider_ids")
x("ANALYZE core.rounds")
x("ANALYZE core.competition_seasons")
`;
  const done = spawnSync("python3", ["-c", script, fileURLToPath(new URL("../..", import.meta.url)), DSN], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
});

// The base commit's answer for a selection: its statement, its body, its validator (routes/reference.mjs at e4014803).
async function legacy(competition, season) {
  const rows = await context.reader.read(LEGACY, [competition, season]);
  if (!rows.length) return { status: 404 };
  const body = { matches: Object.fromEntries(rows.map((r) => [r.id, { name: r.name, playoff: r.playoff }])) };
  return { status: 200, body, etag: `W/"catalog-v1-${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"` };
}
const path = (competition, season) => `/api/matchdays?${new URLSearchParams({ competition, season })}`;
async function served(competition, season, headers = {}, method = "GET") {
  const response = await context.handle(new Request("https://api.test" + path(competition, season), { method, headers }));
  const text = await response.text();
  return { status: response.status, etag: response.headers.get("etag"), body: text ? JSON.parse(text) : null, cache: response.headers.get("cache-control") };
}
async function same(competition, season, why) {
  const [want, got] = [await legacy(competition, season), await served(competition, season)];
  assert.equal(got.status, want.status, `${why}: status`);
  if (want.status === 200) {
    assert.deepEqual(got.body, want.body, `${why}: body`);
    assert.equal(got.etag, want.etag, `${why}: etag`);
  }
  return want;
}
async function write(sql) {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const SELECTIONS = [
  ["l_3FJFUl", "2025/2026", 200, "the seed's league, 126 matches, a play-off round, matches without round or key, a former key"],
  ["l_3FJFUl", "2024/2025", 404, "a season not held"],
  ["l_3FJFUl", "2015/2016", 404, "an archive's edition only"],
  ["l_v0009801", "2025/2026", 200, "a league without a PitchAPI key"],
  ["l_v0009801", "2025", 404, "neither its label nor its native label"],
  ["l_v0000001", "2025/2026", 404, "l_v of a league that has a key"],
  ["l_calyr1", "2026", 200, "a calendar-year league by its native label"],
  ["l_calyr1", "2026/2027", 200, "the same by its season's label"],
  ["l_calyr1", "2025/2026", 404, "the season before"],
  ["l_wcup26", "2026", 200, "a tournament by its native label"],
  ["l_wcup26", "2025/2026", 200, "the same by its season's label"],
  ["l_old001", "2025/2026", 404, "a league's former key"],
  ["l_new001", "2025/2026", 200, "its current key"],
  ["l_cup001", "2025/2026", 404, "a cup's edition only"],
  ["l_norou1", "2025/2026", 404, "no match with a round"],
  ["l_zzzzzz", "2025/2026", 404, "an unknown league"],
  ["l_bulk07", "2025/2026", 200, "a league of 1 000 matches"],
];

test("GH137M-a every selection: the base commit's status, body and ETag", { skip }, async () => {
  for (const [competition, season, status, why] of SELECTIONS) {
    const want = await same(competition, season, why);
    assert.equal(want.status, status, `${why}: the oracle`);
  }
  const ligue1 = (await legacy("l_3FJFUl", "2025/2026")).body.matches;
  assert.equal(Object.keys(ligue1).length, 1 + 108, "the seed's round 1 and 108 of the 120 (12 without a round)");
  assert.ok(Object.keys(ligue1).some((id) => id.startsWith("m_v")), "a match without a key");
  assert.ok(!Object.keys(ligue1).some((id) => id.startsWith("m_o")), "never a former key");
  assert.equal(ligue1.m_k00005.playoff, true, "has_playoff");
  assert.equal(ligue1.m_k00110.name, "Barrages");
  assert.equal(ligue1.m_k00110.playoff, true, "a round of stage playoff");
  assert.equal(Object.keys((await legacy("l_bulk07", "2025/2026")).body.matches).length, 1000);
  assert.deepEqual((await legacy("l_calyr1", "2026")).body, (await legacy("l_calyr1", "2026/2027")).body);
});

test("GH137M-b HEAD and the validator", { skip }, async () => {
  const want = await legacy("l_3FJFUl", "2025/2026");
  const head = await served("l_3FJFUl", "2025/2026", {}, "HEAD");
  assert.deepEqual([head.status, head.etag, head.body], [200, want.etag, null]);
  assert.match(head.cache, /^public, max-age=0, s-maxage=60/);
  assert.equal((await served("l_3FJFUl", "2025/2026", { "if-none-match": want.etag })).status, 304);
  assert.equal((await served("l_3FJFUl", "2025/2026", { "if-none-match": "*" })).status, 304);
  assert.equal((await served("l_3FJFUl", "2025/2026", { "if-none-match": want.etag }, "HEAD")).status, 304);
  const stale = await served("l_3FJFUl", "2025/2026", { "if-none-match": 'W/"catalog-v1-' + "0".repeat(64) + '"' });
  assert.deepEqual([stale.status, stale.etag, stale.body], [200, want.etag, want.body]);
});

test("GH137M-c corrections inside the selection: another answer and tag each, the base commit's; never 304 for the old", { skip }, async () => {
  const corrections = [
    ["a round renamed", "UPDATE core.rounds SET name='2bis' WHERE competition_season_id=1 AND name='2'"],
    ["a match moved to another round", "UPDATE core.matches SET round_id=(SELECT id FROM core.rounds WHERE competition_season_id=1 AND name='12') WHERE id=8002"],
    ["has_playoff set", "UPDATE core.matches SET has_playoff=true WHERE id=8003"],
    ["a round's stage set to playoff", "UPDATE core.rounds SET stage='playoff' WHERE competition_season_id=1 AND name='4'"],
    ["a match's PitchAPI key changed", "UPDATE core.provider_ids SET provider_key='m_k99999' WHERE entity_type='match' AND provider='pitchapi' AND provider_key='m_k00006'"],
    ["a match added", "INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,round_id) SELECT 8999,1,2025,'pitchapi','not_started',3,4,id FROM core.rounds WHERE competition_season_id=1 AND name='5'"],
    ["a match taken out of the edition", "UPDATE core.matches SET round_id=NULL WHERE id=8007"],
  ];
  for (const [why, sql] of corrections) {
    const before = await legacy("l_3FJFUl", "2025/2026");
    await write(sql);
    const after = await same("l_3FJFUl", "2025/2026", why);
    assert.notEqual(after.etag, before.etag, `${why}: another tag`);
    assert.equal((await served("l_3FJFUl", "2025/2026", { "if-none-match": before.etag })).status, 200, `${why}: never 304 for the old tag`);
  }
});

test("GH137M-d writes outside the selection: the same tag, 304", { skip }, async () => {
  const before = await legacy("l_3FJFUl", "2025/2026");
  for (const sql of [
    "UPDATE core.rounds SET name='Journée 1' WHERE competition_season_id=9907 AND name='1'",
    "UPDATE core.matches SET has_playoff=true WHERE id=8301",
    "UPDATE core.rounds SET name='Une' WHERE competition_season_id=9811 AND name='1'",
  ]) {
    await write(sql);
    const now = await same("l_3FJFUl", "2025/2026", sql);
    assert.equal(now.etag, before.etag, sql);
    assert.equal((await served("l_3FJFUl", "2025/2026", { "if-none-match": before.etag })).status, 304, sql);
  }
});

test("GH137M-e parameters", { skip }, async () => {
  for (const query of ["competition=l_3FJFUl", "season=2025%2F2026", "competition=bad&season=2025%2F2026", "competition=l_3FJFUl&season=2025-26",
    "competition=l_3FJFUl&season=2025%2F2026&season=2025%2F2026", "competition=l_3FJFUl&season=2025%2F2026&page=2"]) {
    assert.equal((await get(`/api/matchdays?${query}`)).response.status, 400, query);
  }
});

test("GH137M-f one request reads the selection's matches by index, never the table", { skip }, async () => {
  const statements = [];
  const handle = createHandler({ read: async (sql, params) => (statements.push([sql, params]), context.reader.read(sql, params)) });
  const response = await handle(new Request("https://api.test" + path("l_3FJFUl", "2025/2026")));
  assert.equal(response.status, 200);
  assert.equal(statements.length, 1, "one statement");
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE vega_read");
    await client.query(...statements[0]);
    await client.query("RESET ROLE");
    const { rows } = await client.query(`SELECT relname, seq_scan, seq_tup_read, idx_tup_fetch FROM pg_stat_xact_user_tables
      WHERE relid IN ('core.matches'::regclass, 'core.rounds'::regclass, 'core.provider_ids'::regclass)`);
    await client.query("ROLLBACK");
    const held = Number((await client.query("SELECT count(*) FROM core.matches")).rows[0].count);
    assert.ok(held > 20_000, `the base holds ${held} matches`);
    // The selection: 127 matches (126, and GH137M-c's addition), 109 with a round; the league's key among a few.
    for (const table of ["matches", "rounds", "provider_ids"]) {
      const read = rows.find((r) => r.relname === table) ?? { seq_scan: 0, seq_tup_read: 0, idx_tup_fetch: 0 };
      assert.equal(Number(read.seq_scan), 0, `a sequential scan of core.${table} (${read.seq_tup_read} rows read)`);
      assert.ok(Number(read.idx_tup_fetch) <= 2 * 127, `${read.idx_tup_fetch} rows of core.${table} fetched for a selection of 127`);
    }
  } finally {
    await client.end();
  }
});
