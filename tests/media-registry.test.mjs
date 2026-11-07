import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptMediaPayload,
  mediaRepresentationEnabled,
  getResolvedSnapshot,
  resolveRegisteredMedia,
  subscribe,
} from "../dashboard/frontend/src/services/media-registry.js";
const source = (n) => `https://cdn.pitchapi.dev/images/${n}.webp`;
const target = (n) =>
  `https://d2clu0phovomb8.cloudfront.net/data/raw/neon/assets/${n.toString(16).padStart(64, "0")}.webp`;
test("registry is browser-only, capability gated and accepts only valid mappings", () => {
  delete globalThis.window;
  acceptMediaPayload("/api/dashboard/manifest", {
    capabilities: { resolvedMedia: true },
    media: { [source(1)]: target(1) },
  });
  assert.equal(mediaRepresentationEnabled(), false);
  assert.equal(getResolvedSnapshot(), null);
  globalThis.window = {};
  let changes = 0;
  const off = subscribe(() => changes++);
  acceptMediaPayload("/api/dashboard/manifest", {
    capabilities: { resolvedMedia: true },
  });
  assert.equal(mediaRepresentationEnabled(), true);
  acceptMediaPayload("/api/read/home", {
    media: {
      [source(1)]: target(1),
      [source(2)]: "https://evil.example/asset",
      ["https://evil.example/foo"]: target(1),
    },
  });
  assert.equal(getResolvedSnapshot()[source(1)], target(1));
  assert.equal(Object.keys(getResolvedSnapshot()).length, 2);
  assert.equal(getResolvedSnapshot()[source(2)], null);
  assert.equal(changes, 1);
  acceptMediaPayload("/api/read/home", { media: { [source(1)]: target(1) } });
  assert.equal(changes, 1);
  acceptMediaPayload("/api/read/home", {
    data: { player: { imageUrl: source(1) } },
    media: {},
  });
  assert.equal(getResolvedSnapshot()[source(1)], null);
  assert.equal(resolveRegisteredMedia(source(1), target(1)), "");
  off();
  acceptMediaPayload("/api/dashboard/manifest", { capabilities: {} });
  assert.equal(mediaRepresentationEnabled(), false);
});
test("registry evicts oldest validated entries at the bound", () => {
  const entries = Object.fromEntries(
    Array.from({ length: 2050 }, (_, i) => [source(i + 10), target(i + 10)]),
  );
  acceptMediaPayload("/api/read/home", { media: entries });
  assert.equal(Object.keys(getResolvedSnapshot()).length, 2048);
  assert.equal(getResolvedSnapshot()[source(10)], undefined);
  assert.equal(getResolvedSnapshot()[source(2059)], target(2059));
  delete globalThis.window;
});
