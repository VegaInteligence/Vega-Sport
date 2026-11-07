import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSI_PORTRAIT,
  resolvePlayerIdentity,
  identityFromPlayerSummary,
  loadSummaryIdentity,
} from "../dashboard/frontend/src/services/player-identity.js";

test("relational summary requires both actor and appearance to match", () => {
  const data = {
    meta: { actor: { id: "p_123456" } },
    appearances: [
      { playerId: "p_123456", name: "Player", imageUrl: "portrait" },
    ],
  };
  assert.deepEqual(identityFromPlayerSummary("p_123456", data), {
    name: "Player",
    imageUrl: "portrait",
  });
  assert.equal(identityFromPlayerSummary("p_654321", data), null);
  assert.equal(
    identityFromPlayerSummary("p_123456", {
      ...data,
      appearances: [{ playerId: "p_654321", name: "Other" }],
    }),
    null,
  );
  assert.equal(
    identityFromPlayerSummary("p_123456", { ...data, appearances: [] }),
    null,
  );
});

test("the aggregate placeholder never becomes a verified name", () => {
  assert.equal(
    resolvePlayerIdentity("p_123456", { matches: 1, name: "Joueur" }, [
      { playerId: "p_123456", name: "Joueur" },
    ]).name,
    "",
  );
});

test("summary lookup uses the requested player and falls back across seasons", async () => {
  const calls = [];
  const read = async (_kind, params) => {
    calls.push(params);
    if (params.season === "new")
      return {
        data: { meta: { actor: { id: params.player } }, appearances: [] },
      };
    return {
      data: {
        meta: { actor: { id: params.player } },
        appearances: [{ playerId: params.player, name: params.player }],
      },
    };
  };
  assert.equal(
    (await loadSummaryIdentity("p_123456", ["new", "old"], "g1", read)).name,
    "p_123456",
  );
  assert.equal(
    (await loadSummaryIdentity("p_654321", ["old"], "g2", read)).name,
    "p_654321",
  );
  assert.deepEqual(
    calls.map(({ player, season, generation }) => [player, season, generation]),
    [
      ["p_123456", "new", "g1"],
      ["p_123456", "old", "g1"],
      ["p_654321", "old", "g2"],
    ],
  );
});
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
