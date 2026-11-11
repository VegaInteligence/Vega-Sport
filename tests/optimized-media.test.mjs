import test from "node:test";
import assert from "node:assert/strict";
import config from "../dashboard/frontend/next.config.mjs";
import {
  directMediaCopy,
  safeResolvedMedia,
} from "../dashboard/frontend/src/services/resolved-media.js";
const hash = "a".repeat(64);
const source = `https://dngp6kh9jx2bl.cloudfront.net/data/sources/v2/images/${hash}.webp`;

test("only trusted immutable image paths can bypass the API queue", () => {
  assert.equal(safeResolvedMedia(source), source);
  for (const value of [
    source.replace("dngp6kh9jx2bl", "d111evil"),
    source.replace("https:", "http:"),
    source.replace(hash, "mutable"),
    source + "?v=1",
    "https://cdn.pitchapi.dev/logo.png",
    "/api/assets?url=x",
  ])
    assert.equal(safeResolvedMedia(value), "");
});

test("a provider image names its own copy, and nothing else does", () => {
  for (const kind of ["teams", "leagues", "players"])
    assert.equal(
      directMediaCopy(`https://cdn.pitchapi.dev/images/${kind}/${hash}.webp`),
      source,
    );
  // The copy's extension is the one its bytes gave (backend/vega/media.py: png, jpg, webp).
  assert.equal(
    directMediaCopy(`https://cdn.pitchapi.dev/images/teams/${hash}.jpeg`),
    source.replace(".webp", ".jpg"),
  );
  // What it returns is an address the site accepts as a copy.
  assert.equal(safeResolvedMedia(directMediaCopy(`https://cdn.pitchapi.dev/images/teams/${hash}.png`)), source.replace(".webp", ".png"));
  for (const value of [
    "https://cdn.pitchapi.dev/logo.png",
    `https://cdn.pitchapi.dev/images/teams/${hash.slice(1)}.webp`,
    `https://cdn.pitchapi.dev/images/teams/${hash}.webp?v=2`,
    `https://cdn.pitchapi.dev/images/teams/${hash}.svg`,
    `http://cdn.pitchapi.dev/images/teams/${hash}.webp`,
    `https://cdn.pitchapi.dev.evil.example/images/teams/${hash}.webp`,
    `https://upload.wikimedia.org/wikipedia/commons/a/ab/${hash}.png`,
    `https://img.thesports.com/football/team/${hash}.png`,
    "",
    null,
  ])
    assert.equal(directMediaCopy(value), "");
});

test("the copies are read as they are: the site has no image resizing set up", () => {
  assert.equal(config.images, undefined);
});
