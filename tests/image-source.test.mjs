// FAILURE_MODES.md §21 (21l), written before the code: one image gate for the site, accepting the
// three provider shapes, Vega's reference to a reviewed packed image and the exact UEFA club logo.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptedImageSource } from "../dashboard/frontend/src/services/image-source.js";
import { safeImageUrl } from "../dashboard/frontend/src/services/format.js";

const HASH = "54bb97457ba1934e9c87d71fb5e1cf9a9068f151df4f7d671691f7097fc8a6db";
const accepted = [
  "https://cdn.pitchapi.dev/images/teams/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png",
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.png",
  "https://img.thesports.com/football/competition/6f803b0ca5b52b392cb3fb4225ad7186.png",
  `https://media.vega.invalid/sha256/${HASH}.png`,
  `https://media.vega.invalid/sha256/${HASH}.jpg`,
  `https://media.vega.invalid/sha256/${HASH}.webp`,
  "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png",
];
const refused = [
  "https://evil.example/logo.png",
  "http://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png",
  "https://user:pass@img.uefa.com/imgml/TP/teams/logos/70x70/64125.png",
  "https://img.uefa.com:8443/imgml/TP/teams/logos/70x70/64125.png",
  "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png?w=1",
  "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.png#x",
  "https://img.uefa.com/imgml/TP/teams/logos/140x140/64125.png",
  "https://img.uefa.com/imgml/TP/teams/logos/70x70/64125.svg",
  "https://img.uefa.com/imgml/TP/teams/logos/70x70/abc.png",
  `https://media.vega.invalid/sha256/${HASH}.svg`,
  `https://media.vega.invalid/sha256/${HASH.slice(1)}.png`,
  `https://media.vega.invalid/sha256/${HASH.toUpperCase()}.png`,
  `https://media.vega.invalid/sha256/${HASH}.png?x=1`,
  `https://media.vega.invalid/other/${HASH}.png`,
  `https://media.vega.invalid:444/sha256/${HASH}.png`,
  "https://cdn.pitchapi.dev:8443/images/teams/a.png",
  "not a url",
  "",
];

test("the image gate accepts the provider shapes, the packed-image reference and the UEFA club logo", () => {
  for (const url of accepted) assert.equal(acceptedImageSource(url), true, url);
  for (const url of refused) assert.equal(acceptedImageSource(url), false, url);
});

test("the site asks the API for an accepted image, and for nothing else", () => {
  for (const url of accepted) assert.equal(safeImageUrl(url).includes("/api/assets?url=" + encodeURIComponent(url)), true, url);
  for (const url of refused) assert.equal(safeImageUrl(url), "", url);
});
