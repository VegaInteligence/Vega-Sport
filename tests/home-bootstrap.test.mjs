import test from "node:test";
import assert from "node:assert/strict";
import { prepareHomeBootstrap } from "../dashboard/frontend/src/server/home-bootstrap.js";
import { compactQuery } from "../dashboard/frontend/src/services/compact-reads.js";
import { cachedResource } from "../dashboard/frontend/src/services/resources.js";
const now = Date.parse("2026-11-06T12:00:00Z");
const manifest = {
  storage: "aws-relational",
  publicationVersion: "42",
  defaultSeason: "2025/2026",
  capabilities: { compactReads: { home: true }, resolvedMedia: true },
  competitions: [
    { id: "l_4WFCIZ", name: "Premier League", country: "ENG" },
    { id: "l_999999", name: "FA Cup", country: "ENG" },
  ],
  seasons: [
    { id: "2025/2026", chunks: [] },
    { id: "2024/2025", chunks: [] },
  ],
};
const saved = {
  season: "2024/2025",
  preferences: {
    focus: "all",
    onboardingComplete: true,
    favoriteLeagueIds: ["l_999999", "l_4WFCIZ"],
  },
  personalTeams: ["t_222222", "t_111111"],
  personalPlayers: ["p_111111"],
};
function source(config = {}) {
  const paths = [];
  return {
    paths,
    fetch: async (path) => {
      paths.push(path);
      return path.includes("/manifest")
        ? config.manifest || manifest
        : {
            data: { marker: "home" },
            meta: { generation: config.generation || "42" },
            media: { asset: "direct" },
          };
    },
  };
}
test("server bootstrap uses the same canonical home key as client preferences, with media only on HTTP", async () => {
  const io = source();
  const bootstrap = await prepareHomeBootstrap(
    new URLSearchParams(),
    saved,
    io.fetch,
    now,
  );
  const expected = compactQuery({
    season: "2024/2025",
    leagues: "l_4WFCIZ,l_999999",
    generation: "42",
    archive: 1,
    personalTeams: "t_111111,t_222222",
    personalPlayers: "p_111111",
  });
  assert.equal(bootstrap.homeReady, true);
  assert.equal(bootstrap.homeKey, expected);
  assert.deepEqual(
    bootstrap.resources[`compact:home:${expected}:${Math.floor(now / 300000)}`]
      .data,
    { marker: "home" },
  );
  assert.equal(
    new URL(io.paths[1], "https://api.test").searchParams.get("media"),
    "1",
  );
  assert.equal(new URLSearchParams(bootstrap.homeKey).has("media"), false);
  assert.deepEqual(bootstrap.media, { asset: "direct" });
});
test("URL season and league take precedence and empty selection resolves to all", async () => {
  const io = source();
  const state = {
    ...saved,
    preferences: { ...saved.preferences, favoriteLeagueIds: [] },
  };
  const result = await prepareHomeBootstrap(
    new URLSearchParams("season=2025%2F2026&league=l_4WFCIZ"),
    state,
    io.fetch,
    now,
  );
  const args = new URLSearchParams(result.homeKey);
  assert.equal(args.get("season"), "2025/2026");
  assert.equal(args.get("leagues"), "l_4WFCIZ");
  assert.equal(args.has("archive"), false);
  const all = await prepareHomeBootstrap(
    new URLSearchParams(),
    state,
    source().fetch,
    now,
  );
  assert.equal(new URLSearchParams(all.homeKey).get("leagues"), "all");
});
test("invalid state, unsupported backend and generation mismatch never seed a home response", async () => {
  for (const [state, config, search] of [
    [{ clientOnly: true }, {}, ""],
    [{ preferences: { favoriteLeagueIds: ["invalid"] } }, {}, ""],
    [saved, { manifest: { ...manifest, capabilities: {} } }, ""],
    [saved, { manifest: { ...manifest, storage: "legacy" } }, ""],
    [saved, { generation: "43" }, ""],
    [saved, {}, "v=pinned"],
  ]) {
    const io = source(config);
    const result = await prepareHomeBootstrap(
      new URLSearchParams(search),
      state,
      io.fetch,
      now,
    );
    assert.equal(result.homeReady, false);
    assert.ok(
      !Object.keys(result.resources).some((key) =>
        key.startsWith("compact:home:"),
      ),
    );
  }
});
test("SSR preparation does not seed the browser resource cache", async () => {
  const io = source();
  const result = await prepareHomeBootstrap(
    new URLSearchParams(),
    saved,
    io.fetch,
    now,
  );
  const key = `compact:home:${result.homeKey}:${Math.floor(now / 300000)}`;
  assert.equal(cachedResource(key), undefined);
});

test("backend without resolved-media capability receives no media option", async () => {
  const io = source({
    manifest: { ...manifest, capabilities: { compactReads: { home: true } } },
  });
  const result = await prepareHomeBootstrap(
    new URLSearchParams(),
    saved,
    io.fetch,
    now,
  );
  assert.equal(result.homeReady, true);
  assert.equal(
    new URL(io.paths[1], "https://api.test").searchParams.has("media"),
    false,
  );
});
