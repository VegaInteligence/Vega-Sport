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

// The visitor's country (VI-48): the server resolves it as the browser will, and reads its home-local with the home so
// that the first paint picks the same matches for the cards (home-priority.js). Failure modes and expected outcomes:
//  S1 The detected country is lost on the server → the hosting's ISO-2 code (x-vercel-ip-country) comes back as
//     `visitorCountry`, and the cards' country (`homeCountry`) is its base code (FR → FRA).
//  S2 The cookie's manual choice is ignored → it beats the detected country; "none" gives no country and no read.
//  S3 home-local is read under another key than the browser's → the resource key is the browser's useCompactRead key
//     (season, country, generation; no media), seeded only when the API announces compactReads["home-local"].
//  S4 A failed home-local read breaks the home's bootstrap → the home stays ready, home-local is simply not seeded.
//  S5 No country, or an archived season (the window is today's) → no read at all.
function localSource(config = {}) {
  const paths = [];
  const m = { ...manifest, capabilities: { ...manifest.capabilities, compactReads: { home: true, "home-local": config.announce !== false } } };
  return {
    paths,
    fetch: async (path) => {
      paths.push(path);
      if (path.includes("/manifest")) return m;
      if (path.includes("/api/read/home-local")) {
        if (config.localFails) throw new Error("Initial data unavailable (500)");
        return { data: { country: new URL(path, "https://api.test").searchParams.get("country"), matches: [] }, meta: { generation: "42" }, media: { local: "direct" } };
      }
      return { data: { marker: "home" }, meta: { generation: "42" }, media: { asset: "direct" } };
    },
  };
}
test("S1–S5 the strip's country on the server, and its read under the browser's key", async () => {
  const clock = Math.floor(now / 300000);
  const current = { ...saved, season: "2025/2026" };
  let io = localSource();
  let result = await prepareHomeBootstrap(new URLSearchParams(), current, io.fetch, now, { country: "FR" });
  assert.equal(result.visitorCountry, "FR");
  assert.equal(result.homeCountry, "FRA");
  const key = compactQuery({ season: "2025/2026", country: "FRA", generation: "42" });
  assert.deepEqual(result.resources[`compact:home-local:${key}:${clock}`].data, { country: "FRA", matches: [] });
  assert.ok(io.paths.some((p) => p.startsWith("/api/read/home-local?") && new URL(p, "https://api.test").searchParams.get("media") === "1"));
  assert.deepEqual(result.media, { asset: "direct", local: "direct" });
  // S2: the cookie's choice beats the hosting; "none" reads nothing.
  io = localSource();
  result = await prepareHomeBootstrap(new URLSearchParams(), { ...current, preferences: { ...current.preferences, homeCountry: "BRA" } }, io.fetch, now, { country: "FR" });
  assert.equal(result.homeCountry, "BRA");
  io = localSource();
  result = await prepareHomeBootstrap(new URLSearchParams(), { ...current, preferences: { ...current.preferences, homeCountry: "none" } }, io.fetch, now, { country: "FR" });
  assert.equal(result.homeCountry, null);
  assert.ok(!io.paths.some((p) => p.includes("home-local")));
  // S3: not announced, not read.
  io = localSource({ announce: false });
  result = await prepareHomeBootstrap(new URLSearchParams(), current, io.fetch, now, { country: "FR" });
  assert.equal(result.homeCountry, "FRA");
  assert.ok(!io.paths.some((p) => p.includes("home-local")));
  // S4: a failed strip read leaves the home ready.
  io = localSource({ localFails: true });
  result = await prepareHomeBootstrap(new URLSearchParams(), current, io.fetch, now, { country: "FR" });
  assert.equal(result.homeReady, true);
  assert.ok(!Object.keys(result.resources).some((k) => k.startsWith("compact:home-local:")));
  // S5: nothing detected, no choice: no country, no read.
  io = localSource();
  result = await prepareHomeBootstrap(new URLSearchParams(), current, io.fetch, now);
  assert.equal(result.visitorCountry, null);
  assert.equal(result.homeCountry, null);
  assert.ok(!io.paths.some((p) => p.includes("home-local")));
  io = localSource();
  result = await prepareHomeBootstrap(new URLSearchParams(), saved, io.fetch, now, { country: "FR" }); // 2024/2025: archived
  assert.equal(result.homeCountry, "FRA");
  assert.ok(!io.paths.some((p) => p.includes("home-local")));
});
