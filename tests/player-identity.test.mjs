import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSI_PORTRAIT,
  resolvePlayerIdentity,
} from "../dashboard/frontend/src/services/player-identity.js";
import { mediaImageSource } from "../dashboard/frontend/src/services/format.js";

test("Messi keeps the verified portrait when the selected filters have no matches", () => {
  const identity = resolvePlayerIdentity("p_1mZO3B", { matches: 0 }, []);
  assert.equal(identity.name, "Lionel Messi");
  assert.equal(identity.imageUrl, MESSI_PORTRAIT);
  const refreshed = resolvePlayerIdentity("p_1mZO3B", { matches: 0 }, [], {
    name: "Lionel Messi",
    image_url: "new-provider-photo",
  });
  assert.equal(refreshed.imageUrl, "new-provider-photo");
});

test("a missing latest image falls back to the same player's observed portrait", () => {
  const profile = { matches: 1, name: "Player", imageUrl: null };
  const rows = [
    { playerId: "other", imageUrl: "wrong" },
    { playerId: "p_123456", name: "Player", imageUrl: "right" },
  ];
  assert.equal(
    resolvePlayerIdentity("p_123456", profile, rows).imageUrl,
    "right",
  );
});

test("a failed current portrait falls back to the verified archived image", () => {
  const current = "https://cdn.pitchapi.dev/images/players/new-photo.webp";
  const primary = mediaImageSource(current, MESSI_PORTRAIT);
  const fallback = mediaImageSource(current, MESSI_PORTRAIT, true);
  assert.notEqual(primary, fallback);
  assert.match(fallback, /4d33a107ca0c78c/);
  assert.equal(mediaImageSource(current, MESSI_PORTRAIT, true, true), "");
});
