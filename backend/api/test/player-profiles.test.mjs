// GET /api/read/players?detail=profile: a selection's profiles alone, validated by what
// they are made from (the scope's editions) and not by the publication.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { context, get, skip } from "./context.mjs";

const list = "/api/read/players?season=2025/2026&leagues=all&basis=total&sort=name&direction=asc&minutes=0";
const profiles = list + "&detail=profile";
const queries = (response) => Number(/desc="(\d+) quer/.exec(response.headers.get("server-timing"))[1]);

let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
});
after(() => owner?.end());

test("the profiles are the list's, without what a list adds to them", { skip }, async () => {
  const full = (await get(list)).body;
  const { response, body } = await get(profiles);
  assert.equal(response.status, 200);
  assert.ok(full.data.players.length > 1);
  assert.deepEqual(body.data.players, full.data.players.map((p) => ({ id: p.id, profile: p.profile })));
  assert.deepEqual(body.data.teams, full.data.teams);
  assert.deepEqual(body.pagination, full.pagination);
  // The editions, the version, the selection: no power ranking is read for it.
  assert.equal(queries(response), 3);
  assert.match(body.meta.version, /^[a-f0-9]{16}$/);
  assert.match(response.headers.get("etag"), /^W\/"players-profile-[a-f0-9]{64}"$/);
  // The same when the appearances are read (a venue is asked), and for a role group.
  for (const filter of ["&venue=home", "&group=O", "&whole=1"]) {
    const wide = (await get(list + filter)).body,
      light = (await get(profiles + filter)).body;
    assert.deepEqual(light.data.players, wide.data.players.map((p) => ({ id: p.id, profile: p.profile })), filter);
    assert.equal(light.meta.version, body.meta.version, "one version for a scope, whatever is selected in it");
  }
  assert.equal((await get("/api/dashboard/manifest")).body.capabilities.playerProfiles, true);
});

test("whoever holds the answer is told it is unchanged, without working it out", { skip }, async () => {
  const first = await get(profiles);
  const etag = first.response.headers.get("etag");
  const again = await get(profiles, { "if-none-match": etag });
  assert.equal(again.response.status, 304);
  assert.equal(again.response.headers.get("etag"), etag);
  assert.equal(queries(again.response), 2);
  assert.match(again.response.headers.get("cache-control"), /s-maxage=30/);
  // Another selection of the same scope is another answer.
  assert.equal((await get(profiles + "&group=O", { "if-none-match": etag })).response.status, 200);
});

test("it is fenced by its version, never by the publication", { skip }, async () => {
  const { body } = await get(profiles);
  assert.equal((await get(profiles + "&v=" + body.meta.version)).response.status, 200);
  const stale = await get(profiles + "&v=" + "0".repeat(16));
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "PUBLICATION_CHANGED");
  for (const bad of ["&generation=7", "&v=xyz", "&detail=full"]) assert.equal((await get(profiles + bad)).response.status, 400, bad);
  assert.equal((await get(list + "&v=" + body.meta.version)).response.status, 400);
});

test("the version changes with an edition, with its rows and with the day", { skip }, async () => {
  const read = async () => {
    const { response, body } = await get(profiles);
    return { version: body.meta.version, etag: response.headers.get("etag") };
  };
  const start = await read();
  assert.deepEqual(await read(), start);
  // A publication alone changes nothing: another resource's version.
  await owner.query("INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('home',1) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1");
  await owner.query("UPDATE ops.publication SET generation=generation+1");
  try {
    assert.deepEqual(await read(), start);
  } finally {
    await owner.query("UPDATE ops.publication SET generation=generation-1");
  }
  // An edition of the scope written again.
  const { rows: [edition] } = await owner.query("SELECT competition_season_id AS id FROM agg.player_list_editions ORDER BY 1 LIMIT 1");
  await owner.query(
    "INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('competition_season',$1) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1",
    [edition.id],
  );
  const written = await read();
  assert.notEqual(written.version, start.version);
  assert.equal((await get(profiles, { "if-none-match": start.etag })).response.status, 200);
  // Its rows recounted without a version (the daily pass).
  await owner.query("UPDATE agg.player_list_editions SET total_minutes=total_minutes+1 WHERE ctid=(SELECT ctid FROM agg.player_list_editions LIMIT 1)");
  const recounted = await read();
  assert.notEqual(recounted.version, written.version);
  // The next day: a name or an image is not in the version, and stays a day at most.
  const saved = context.now;
  try {
    context.now += 86_400_000;
    assert.notEqual((await read()).version, recounted.version);
  } finally {
    context.now = saved;
  }
});
