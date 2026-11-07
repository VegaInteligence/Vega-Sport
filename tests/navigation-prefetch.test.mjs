import test from "node:test";
import assert from "node:assert/strict";
import {
  actorIntent,
  createIntentScheduler,
  prefetchActor,
} from "../dashboard/frontend/src/services/navigation-prefetch.js";
import { actorReadKey } from "../dashboard/frontend/src/services/actor-reads.js";
const origin = "https://vega.example/joueurs?season=2026%2F2027&v=123";
const football = {
  season: "2026/2027",
  preferences: { focus: "all" },
  manifest: {
    storage: "aws-relational",
    publicationVersion: "7",
    capabilities: {
      actorSummary: true,
      compactReads: { player: true, club: true },
    },
    seasons: [{ id: "2026/2027", chunks: [{ leagueId: "l_3FJFUl" }] }],
  },
};
const path = "/joueurs?season=2026%2F2027&v=123&id=p_Ab12Cd&league=l_3FJFUl";
test("actor intent uses canonical scope and rejects external, unknown, unsupported and pinned changes", () => {
  const value = actorIntent(path, origin, football);
  assert.equal(value.kind, "player");
  assert.equal(value.params.player, "p_Ab12Cd");
  assert.equal(value.params.leagues, "l_3FJFUl");
  assert.equal(value.params.detail, "summary");
  assert.equal(value.key, actorReadKey("player", value.params));
  for (const bad of [
    "https://evil.example" + path,
    "/joueurs?id=p_wrong&v=123",
    "/joueurs?id=p_Ab12Cd&v=other",
    "/matchs?id=m_Ab12Cd&v=123",
  ])
    assert.equal(actorIntent(bad, origin, football), null);
  assert.equal(
    actorIntent(path, origin, {
      ...football,
      manifest: { ...football.manifest, capabilities: { actorSummary: false } },
    }),
    null,
  );
  const club = actorIntent(
    "/clubs?season=2026%2F2027&v=123&id=t_Ab12Cd&league=l_3FJFUl",
    origin,
    football,
  );
  assert.equal(club.params.leagues, "all");
});
test("prefetch populates canonical cache with matching generation and actor scope", async () => {
  const intent = actorIntent(path, origin, football);
  let key, saved;
  await prefetchActor(intent, {
    cached: () => undefined,
    prime: async (k, load) => {
      key = k;
      saved = await load({});
    },
    read: async () => ({
      meta: { generation: "7" },
      pages: [
        { meta: { actor: { kind: "player", id: "p_Ab12Cd" } }, matches: [] },
      ],
    }),
    merge: () => ({ meta: {} }),
  });
  assert.equal(key, intent.key);
  assert.equal(saved.meta.actorScope, intent.params.leagues);
  await assert.rejects(
    prefetchActor(intent, {
      cached: () => undefined,
      prime: async (k, load) => load({}),
      read: async () => ({ meta: { generation: "8" } }),
    }),
    /Publication/,
  );
  await assert.rejects(
    prefetchActor(intent, {
      cached: () => undefined,
      prime: async (k, load) => load({}),
      read: async () => ({
        meta: { generation: "7" },
        pages: [{ meta: { actor: { kind: "player", id: "p_000000" } } }],
      }),
    }),
    /Identit/,
  );
  let called = false;
  await prefetchActor(intent, {
    cached: () => ({}),
    prime: () => {
      called = true;
    },
  });
  assert.equal(called, false);
});
test("scheduler bounds active and waiting jobs, coalesces duplicates and cancels unstarted work", async () => {
  const releases = [],
    started = [];
  const scheduler = createIntentScheduler(
    (item) =>
      new Promise((resolve) => {
        started.push(item.key);
        releases.push(resolve);
      }),
  );
  for (const key of ["a", "b", "c", "d", "e", "a"]) scheduler.add({ key });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduler.pending(), { active: 2, queued: 2 });
  assert.deepEqual(started, ["a", "b"]);
  scheduler.cancel("c");
  releases[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b", "d"]);
  scheduler.stop();
  releases.slice(1).forEach((resolve) => resolve());
});
