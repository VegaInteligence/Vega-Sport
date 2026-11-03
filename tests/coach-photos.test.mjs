import test from "node:test";
import assert from "node:assert/strict";
import { refreshCoachPortraits } from "../dashboard/scripts/neon_coach_photos.mjs";

test("coach photo repair keeps identities and leaves existing portraits on failed refreshes", async () => {
  const rows = [
    {
      params: '{"uefa":"1"}',
      body: { coach: { name: "Rúben Amorim", photo: { sourceUrl: "known" } } },
    },
    {
      params: '{"uefa":"2"}',
      body: { coach: { name: "Luis Enrique", photo: null } },
    },
    {
      params: '{"uefa":"3"}',
      body: { coach: { name: "Old coach", photo: null } },
    },
    {
      params: '{"uefa":"4"}',
      body: { coach: { name: "Coach", photo: { sourceUrl: "unavailable" } } },
    },
  ];
  const saved = [];
  const result = await refreshCoachPortraits(rows, {
    loadPhoto: async (source) => (source === "known" ? { url: "thumb" } : null),
    loadClub: async (params) =>
      params.uefa === "2"
        ? { coach: { name: "Luis Enrique", photo: { url: "enrique" } } }
        : { coach: { name: "New coach", photo: { url: "wrong" } } },
    save: async (params, name, photo) => {
      saved.push({ params, name, photo });
      return true;
    },
  });
  assert.equal(result.updated, 2);
  assert.equal(result.unavailable, 2);
  assert.deepEqual(saved.map((row) => row.photo.url).sort(), [
    "enrique",
    "thumb",
  ]);
});
