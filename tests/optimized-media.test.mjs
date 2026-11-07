import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import config from "../dashboard/frontend/next.config.mjs";
import { safeResolvedMedia } from "../dashboard/frontend/src/services/resolved-media.js";
process.env.NODE_ENV = "production";
const require = createRequire(import.meta.url);
const { getImageProps } = require("../dashboard/node_modules/next/image");
const source = `https://d2clu0phovomb8.cloudfront.net/data/raw/neon/assets/${"a".repeat(64)}.webp`;
test("optimized media yields native src and bounded high-density variants", () => {
  for (const width of [64, 96, 192]) {
    const { props } = getImageProps({
      src: source,
      alt: "",
      width,
      height: width,
      quality: 75,
    });
    assert.match(props.src, /^\/_next\/image\?/);
    const widths = [...props.srcSet.matchAll(/&w=(\d+)&q=75/g)].map((match) =>
      Number(match[1]),
    );
    assert.ok(widths[0] >= width);
    assert.ok(widths.at(-1) >= width * 2);
  }
});
test("optimizer is restricted to asset origin and does not follow redirects", () => {
  assert.equal(config.images.maximumRedirects, 0);
  assert.equal(config.images.minimumCacheTTL, 31536000);
  for (const rule of config.images.remotePatterns) {
    assert.equal(rule.protocol, "https");
    assert.equal(rule.hostname, "d2clu0phovomb8.cloudfront.net");
    assert.equal(rule.search, "");
  }
});

test("only trusted immutable image paths can bypass the API queue", () => {
  assert.equal(safeResolvedMedia(source), source);
  for (const value of [
    source.replace("d2clu0phovomb8", "d111evil"),
    source.replace("https:", "http:"),
    source.replace("a".repeat(64), "mutable"),
    source + "?v=1",
    "https://cdn.pitchapi.dev/logo.png",
    "/api/assets?url=x",
  ])
    assert.equal(safeResolvedMedia(value), "");
});
