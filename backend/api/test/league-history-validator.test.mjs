// GET /api/league-history's validator (GH #137 for this route, with GH #145; docs/calculs/09-audit-2026-11/
// FAILURE_MODES_OPTIMISATIONS.md, GH137), on the API seed and the archived seasons of league-history-fixture.mjs. Written
// before the change: GH137-a, b and f fail on the base commit (a revalidation ran its four reads and built the answer),
// g and i on the tag's form; the corrections pass on both: they pin that no tag survives a change of what the answer is
// made of. Revised after the review of 25 Nov 2026, before the route changed again: a stale tag must cost one statement,
// not the four reads twice (GH137-f), a HEAD returns no row (GH137-b), and the tag carries its digest (GH137-a, g).
//
// Failure modes and expected outcomes (GH137.2):
//  GH137-a nothing changed, If-None-Match of the answer: 304, one statement, no row returned by it.
//  GH137-b HEAD: 200 with the tag, no body, one statement, no row; HEAD with the tag: 304.
//  GH137-c a correction that changes the answer: another tag, the old tag answered 200 with the corrected answer (never a
//          304 for it); one that leaves the answer as it was: 304, or 200 with the same answer.
//  GH137-d writes that do not touch the season: the same tag, 304.
//  GH137-e a correction rolled back: the same tag; a correction then its reversal: the original tag again (200 for
//          whoever holds the corrected answer); two corrections in either order: one tag.
//  GH137-f a plain GET: one statement; a GET whose tag is stale: 200 with the corrected answer and its tag, one statement.
//  GH137-g the base commit's tag, another season's, this form with another digest, a malformed one: 200; the tag without
//          W/, a list holding it, *: 304.
//  GH137-h * or a tag with an unknown or repeated parameter: 400; with a season not held, out of range, an unknown
//          league: 404.
//  GH137-i another release of the read API (VEGA_RELEASE): another tag for the same rows; the same release: the same tag.
//  GH137-j the last archived season (2020/21, its next season PitchAPI's 2021/22) and the edition holding the most matches.
//  GH137-m 400 and 404: no-store.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { context, get, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";
import { seedLeagueHistory } from "./league-history-fixture.mjs";

let owner;
before(async () => {
  if (skip) return;
  seedLeagueHistory();
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
});
after(() => owner?.end());

const path = (league, season) => `/api/league-history?competition=${league}&season=${encodeURIComponent(season)}`;
const bl2015 = path("l_1Isor4", "2015/2016"), bl2011 = path("l_1Isor4", "2011/2012"), bl2020 = path("l_1Isor4", "2020/2021");
const fr2016 = path("l_3FJFUl", "2016/2017");
const queries = (response) => Number(/desc="(\d+) quer/.exec(response.headers.get("server-timing"))[1]);
const tagOf = async (p) => (await get(p)).response.headers.get("etag");
const sql = (text, values) => owner.query(text, values);
const TAG = /^W\/"league-history-v2-[a-f0-9]{16}-[a-f0-9]{64}"$/;
// A handler whose reads are counted, with the size of what each statement gave back.
function counted() {
  const statements = [];
  const handle = createHandler({
    read: async (...args) => {
      const rows = await context.reader.read(...args);
      statements.push(JSON.stringify(rows).length);
      return rows;
    },
    clock: () => context.now,
  });
  return { statements, call: (p, init) => handle(new Request("https://api.test" + p, init)) };
}

test("GH137-a GH137-f unchanged: a 304 in one statement that returns no row of the answer; a plain GET in one statement", { skip }, async () => {
  const first = await get(bl2015);
  assert.equal(first.response.status, 200);
  assert.equal(queries(first.response), 1);
  const tag = first.response.headers.get("etag");
  assert.match(tag, TAG);
  // What the statement of the revalidation gave back, read at the reader.
  const { statements, call } = counted();
  const again = await call(bl2015, { headers: { "if-none-match": tag } });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get("etag"), tag);
  assert.equal(statements.length, 1);
  assert.ok(statements[0] < 400, `the revalidation's statement returned ${statements[0]} bytes`);
  assert.match(again.headers.get("cache-control"), /^public, max-age=0, s-maxage=3600/);
});

test("GH137-f a stale tag: the corrected answer and its tag from one statement", { skip }, async () => {
  const original = await get(bl2015);
  const tag = original.response.headers.get("etag");
  await sql("UPDATE core.matches SET home_score=4 WHERE archive_key='t:9720:0'");
  try {
    const { statements, call } = counted();
    const stale = await call(bl2015, { headers: { "if-none-match": tag } });
    assert.equal(stale.status, 200);
    assert.equal(statements.length, 1, `a stale tag ran ${statements.length} statements`);
    assert.notEqual(stale.headers.get("etag"), tag);
    assert.match(stale.headers.get("etag"), TAG);
    assert.deepEqual((await stale.json()).data.matchdays[0].matches[0].score, [4, 1]);
    // The corrected answer's tag is the one a plain GET gives.
    assert.equal((await get(bl2015)).response.headers.get("etag"), stale.headers.get("etag"));
  } finally {
    await sql("UPDATE core.matches SET home_score=5 WHERE archive_key='t:9720:0'");
  }
});

test("GH137-b HEAD: the tag without the answer, in one statement that returns no row", { skip }, async () => {
  const tag = await tagOf(bl2015);
  const { statements, call } = counted();
  const head = await call(bl2015, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("etag"), tag);
  assert.equal(await head.text(), "");
  assert.equal(statements.length, 1);
  assert.ok(statements[0] < 400, `HEAD's statement returned ${statements[0]} bytes`);
  const held = await context.handle(new Request("https://api.test" + bl2015, { method: "HEAD", headers: { "if-none-match": tag } }));
  assert.equal(held.status, 304);
});

// Each correction: what it does and undoes, and what the corrected answer shows.
const CORRECTIONS = [
  ["a score", "UPDATE core.matches SET home_score=4 WHERE archive_key='t:9720:0'", "UPDATE core.matches SET home_score=5 WHERE archive_key='t:9720:0'",
    (d) => assert.deepEqual(d.matchdays[0].matches[0].score, [4, 1])],
  ["a round's name", "UPDATE core.rounds SET name='Matchday 33' WHERE competition_season_id=9720 AND name='Matchday 34'",
    "UPDATE core.rounds SET name='Matchday 34' WHERE competition_season_id=9720 AND name='Matchday 33'", (d) => assert.equal(d.matchdays[2].number, 33)],
  ["the next season's archived spelling of a club", "UPDATE core.teams SET name='FC Bayern München (GER)' WHERE id=9712",
    "UPDATE core.teams SET name='FC Bayern Munich (GER)' WHERE id=9712", (d) => assert.equal(d.standings[0].zone, null)],
  ["the name of the club merged into", "UPDATE core.teams SET name='Borussia Dortmund 09' WHERE id=9702",
    "UPDATE core.teams SET name='Borussia Dortmund' WHERE id=9702", (d) => assert.ok(d.standings.some((r) => r.team.name === "Borussia Dortmund 09"))],
  ["a crest", "UPDATE core.assets SET source_url='https://cdn.test/bayern-2.png' WHERE id=9799",
    "UPDATE core.assets SET source_url='https://cdn.test/bayern.png' WHERE id=9799", (d) => assert.equal(d.standings[0].team.imageUrl, "https://cdn.test/bayern-2.png")],
  ["a merge removed", "UPDATE core.teams SET merged_into=NULL WHERE id=9711", "UPDATE core.teams SET merged_into=9702 WHERE id=9711",
    (d) => assert.ok(d.standings.some((r) => r.team.name === "Borussia Dortmund (archive)" && r.team.id === null))],
  ["a club's PitchAPI id", "DELETE FROM core.provider_ids WHERE entity_type='team' AND provider='pitchapi' AND entity_id=9702",
    "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_bvb0001',9702)",
    (d) => assert.ok(d.standings.some((r) => r.team.name === "Borussia Dortmund" && r.team.id === null))],
  ["a player linked to the base, with his photo", "UPDATE core.league_player_seasons SET player_id=101 WHERE player_key='38253' AND season_id=2015",
    "UPDATE core.league_player_seasons SET player_id=NULL WHERE player_key='38253' AND season_id=2015",
    (d) => assert.deepEqual([d.players.rows[0].id, d.players.rows[0].imageUrl], ["p_aaaab1", "https://img.example/p1.png"])],
  ["a player season's goals", "UPDATE core.league_player_seasons SET goals=31 WHERE player_key='38253' AND season_id=2015",
    "UPDATE core.league_player_seasons SET goals=30 WHERE player_key='38253' AND season_id=2015", (d) => assert.equal(d.summary.topScorer.goals, 31)],
  ["a player season deleted", "DELETE FROM core.league_player_seasons WHERE player_key='1' AND season_id=2015",
    "INSERT INTO core.league_player_seasons(competition_id, season_id, player_key, player_name, club_key, club_name, matches, minutes, goals, assists, yellow_cards, red_cards) SELECT entity_id, 2015, '1', 'Sandro Wagner', '105', 'SV Darmstadt 98', 32, 2700, 14, 2, 4, 0 FROM core.provider_ids WHERE entity_type='competition' AND provider='pitchapi' AND provider_key='l_1Isor4'",
    (d) => assert.equal(d.players.rows.length, 1)],
  ["a match taken out of the season", "UPDATE core.matches SET competition_season_id=9721, season_id=2016 WHERE archive_key='t:9720:4'",
    "UPDATE core.matches SET competition_season_id=9720, season_id=2015 WHERE archive_key='t:9720:4'", (d) => assert.equal(d.matchdays.length, 2)],
  ["the next season's Champions League", "INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score, source, archive_key, archive_position) VALUES (9722, 2016, '2016-09-14', 'finished', 9703, 9704, 1, 0, 'openfootball', 't:9722:9', 9)",
    "DELETE FROM core.matches WHERE archive_key='t:9722:9'", (d) => assert.equal(d.standings.find((r) => r.team.name === "SV Darmstadt 98").zone, "cl")],
  ["the next season's league", "INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score, source, archive_key, archive_position) VALUES (9721, 2016, '2016-09-10', 'finished', 9702, 9704, 0, 0, 'openfootball', 't:9721:9', 9)",
    "DELETE FROM core.matches WHERE archive_key='t:9721:9'", null],
];

test("GH137-c no tag survives a correction of what the answer is made of", { skip }, async () => {
  const original = await get(bl2015);
  const tag = original.response.headers.get("etag");
  for (const [what, apply, undo, check] of CORRECTIONS) {
    await sql(apply);
    try {
      const now = (await get(bl2015)).body;
      const held = await get(bl2015, { "if-none-match": tag });
      if (check) {
        // The answer changed: never a 304 for it, and the corrected answer under another tag.
        check(now.data);
        assert.equal(held.response.status, 200, what);
        assert.notEqual(held.response.headers.get("etag"), tag, what);
        assert.deepEqual(held.body, now, what);
      } else {
        // What the answer reads changed, the answer did not (the relegation rule falls back to the last two):
        // a 304 is right, so is a 200 with the same answer.
        assert.deepEqual(now, original.body, what);
        if (held.response.status === 200) assert.deepEqual(held.body, original.body, what);
        else assert.equal(held.response.status, 304, what);
      }
    } finally {
      await sql(undo);
    }
    assert.equal((await get(bl2015, { "if-none-match": tag })).response.status, 304, `${what}: undone`);
  }
  assert.deepEqual((await get(bl2015)).body, original.body);
});

test("GH137-c before 2012/13: an archived goal, an own goal's flag", { skip }, async () => {
  const tag = await tagOf(bl2011);
  const match = (await sql("SELECT id FROM core.matches WHERE competition_season_id=9723")).rows[0].id;
  await sql("INSERT INTO core.match_events(season_id, match_id, team_id, seq, event_type, player_name, is_own_goal) VALUES (2011, $1, 9702, 5, 'goal', 'Marco Reus', false)", [match]);
  try {
    const d = await get(bl2011, { "if-none-match": tag });
    assert.equal(d.response.status, 200);
    assert.ok(d.body.data.players.rows.some((p) => p.name === "Marco Reus"));
  } finally {
    await sql("DELETE FROM core.match_events WHERE season_id=2011 AND match_id=$1 AND seq=5", [match]);
  }
  await sql("UPDATE core.match_events SET is_own_goal=false WHERE player_name='Jérôme Boateng'");
  try {
    const d = await get(bl2011, { "if-none-match": tag });
    assert.equal(d.response.status, 200);
    assert.ok(d.body.data.players.rows.some((p) => p.name === "Jérôme Boateng"));
  } finally {
    await sql("UPDATE core.match_events SET is_own_goal=true WHERE player_name='Jérôme Boateng'");
  }
  assert.equal((await get(bl2011, { "if-none-match": tag })).response.status, 304);
});

test("GH137-c GH137-j the last archived season: its next season is PitchAPI's 2021/22", { skip }, async () => {
  const first = await get(bl2020);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.edition, "2020-21/de.1");
  const relegated = (d) => d.summary.relegated.map((t) => t.name);
  assert.deepEqual(relegated(first.body.data), ["Hannover 96", "SV Darmstadt 98"]);
  const tag = first.response.headers.get("etag");
  // PitchAPI's 2021/22 holds Darmstadt instead of Bremen: Bremen and Hannover went down.
  await sql("UPDATE core.matches SET away_team_id=9703 WHERE competition_season_id=9727 AND away_team_id=9706");
  try {
    const d = await get(bl2020, { "if-none-match": tag });
    assert.equal(d.response.status, 200);
    assert.notEqual(d.response.headers.get("etag"), tag);
    assert.deepEqual(relegated(d.body.data), ["Werder Bremen", "Hannover 96"]);
  } finally {
    await sql("UPDATE core.matches SET away_team_id=9706 WHERE competition_season_id=9727 AND away_team_id=9703");
  }
  assert.equal((await get(bl2020, { "if-none-match": tag })).response.status, 304);
});

test("GH137-c GH137-j the archive key holding the most matches is the edition read", { skip }, async () => {
  const first = await get(fr2016);
  assert.equal(first.body.data.edition, "2016-17/fr.1");
  const tag = first.response.headers.get("etag");
  await sql(`INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score, source, archive_key, archive_position)
             VALUES (9726, 2016, '2016-08-13', 'finished', 9723, 9721, 2, 2, 'other', 't:9726:1', 1), (9726, 2016, '2016-08-20', 'finished', 9722, 9723, 0, 3, 'other', 't:9726:2', 2)`);
  try {
    const d = await get(fr2016, { "if-none-match": tag });
    assert.equal(d.response.status, 200);
    assert.equal(d.body.data.edition, "engsoccerdata/france/all/2016");
  } finally {
    await sql("DELETE FROM core.matches WHERE archive_key IN ('t:9726:1', 't:9726:2')");
  }
  assert.equal((await get(fr2016, { "if-none-match": tag })).response.status, 304);
});

test("GH137-d writes that do not touch the season keep the tag", { skip }, async () => {
  const tag = await tagOf(bl2015);
  await sql("UPDATE core.matches SET home_score=home_score WHERE season_id=2025");
  await sql("UPDATE core.matches SET away_score=7 WHERE archive_key='t:9723:0'");
  await sql("INSERT INTO core.teams(id, name) VALUES (9799, 'Never Met')");
  await sql("INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('home',1) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1");
  await sql("UPDATE ops.publication SET generation=generation+1");
  try {
    const again = await get(bl2015, { "if-none-match": tag });
    assert.equal(again.response.status, 304);
    assert.equal(queries(again.response), 1);
  } finally {
    await sql("UPDATE core.matches SET away_score=1 WHERE archive_key='t:9723:0'");
    await sql("DELETE FROM core.teams WHERE id=9799");
    await sql("UPDATE ops.publication SET generation=generation-1");
  }
});

test("GH137-e a rollback, a reversal, two corrections in either order", { skip }, async () => {
  const original = await get(bl2015);
  const tag = original.response.headers.get("etag");
  await sql("BEGIN");
  await sql("UPDATE core.matches SET home_score=9 WHERE archive_key='t:9720:0'");
  try {
    assert.equal((await get(bl2015, { "if-none-match": tag })).response.status, 304, "uncommitted");
  } finally {
    await sql("ROLLBACK");
  }
  assert.equal((await get(bl2015, { "if-none-match": tag })).response.status, 304, "rolled back");
  // Reversal: whoever holds the corrected answer gets the original back, with the original tag.
  await sql("UPDATE core.matches SET home_score=4 WHERE archive_key='t:9720:0'");
  const corrected = (await get(bl2015)).response.headers.get("etag");
  await sql("UPDATE core.matches SET home_score=5 WHERE archive_key='t:9720:0'");
  const back = await get(bl2015, { "if-none-match": corrected });
  assert.equal(back.response.status, 200);
  assert.equal(back.response.headers.get("etag"), tag);
  assert.deepEqual(back.body, original.body);
  // Two corrections, in either order: the same state, the same tag.
  const crest = ["UPDATE core.assets SET source_url='https://cdn.test/bayern-3.png' WHERE id=9799", "UPDATE core.assets SET source_url='https://cdn.test/bayern.png' WHERE id=9799"];
  const score = ["UPDATE core.matches SET away_score=2 WHERE archive_key='t:9720:1'", "UPDATE core.matches SET away_score=1 WHERE archive_key='t:9720:1'"];
  await sql(crest[0]); await sql(score[0]);
  const one = await tagOf(bl2015);
  await sql(crest[1]); await sql(score[1]);
  await sql(score[0]); await sql(crest[0]);
  const other = await tagOf(bl2015);
  await sql(crest[1]); await sql(score[1]);
  assert.equal(one, other);
  assert.notEqual(one, tag);
  assert.equal(await tagOf(bl2015), tag);
});

test("GH137-g tags that are not this answer's", { skip }, async () => {
  const { response, body } = await get(bl2015);
  const tag = response.headers.get("etag");
  const v1 = `W/"league-history-v1-${createHash("sha256").update(JSON.stringify(body.data)).digest("hex")}"`;
  const otherDigest = tag.replace(/-[a-f0-9]{64}"$/, `-${"0".repeat(64)}"`);
  assert.notEqual(otherDigest, tag);
  for (const held of [v1, await tagOf(bl2011), otherDigest, 'W/"league-history-v2-0"', "nonsense", `${tag}, junk`])
    assert.equal((await get(bl2015, { "if-none-match": held })).response.status, 200, held);
  for (const held of [tag.slice(2), `W/"x", ${tag}`, "*"]) assert.equal((await get(bl2015, { "if-none-match": held })).response.status, 304, held);
});

test("GH137-h GH137-m refused before any 304, and never kept by the edge", { skip }, async () => {
  const tag = await tagOf(bl2015);
  for (const held of ["*", tag]) {
    for (const [p, status] of [[bl2015 + "&x=1", 400], [bl2015 + "&season=2015%2F2016", 400], [path("l_1Isor4", "2014/2015"), 404],
      [path("l_1Isor4", "2009/2010"), 404], [path("l_1Isor4", "2021/2022"), 404], [path("l_9xxxxx", "2015/2016"), 404]]) {
      const { response } = await get(p, { "if-none-match": held });
      assert.equal(response.status, status, `${p} ${held}`);
      assert.equal(response.headers.get("cache-control"), "no-store", p);
    }
    const head = await context.handle(new Request("https://api.test" + path("l_1Isor4", "2014/2015"), { method: "HEAD", headers: { "if-none-match": held } }));
    assert.equal(head.status, 404);
  }
});

test("GH137-i the representation's version: another release, another tag; the same release, the same tag", { skip }, async () => {
  const handler = fileURLToPath(new URL("../src/handler.mjs", import.meta.url));
  const db = fileURLToPath(new URL("../src/db.mjs", import.meta.url));
  const probe = `import { createReader } from ${JSON.stringify(db)}; import { createHandler } from ${JSON.stringify(handler)};
    const reader = createReader(process.env.VEGA_V2_API_NODE_TEST_DSN, { role: "vega_read" });
    const r = await createHandler({ read: reader.read })(new Request("https://api.test${bl2015}", { method: "HEAD" }));
    console.log(r.headers.get("etag")); await reader.end();`;
  const tag = (release) => {
    const done = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", env: { ...process.env, VEGA_RELEASE: release } });
    assert.equal(done.status, 0, done.stderr);
    return done.stdout.trim();
  };
  const a = tag("releases/v2-api/" + "a".repeat(64) + ".zip"), b = tag("releases/v2-api/" + "b".repeat(64) + ".zip");
  assert.match(a, /^W\/"league-history-v2-/);
  assert.notEqual(a, b);
  assert.equal(tag("releases/v2-api/" + "a".repeat(64) + ".zip"), a);
});
