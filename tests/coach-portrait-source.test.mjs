import test from "node:test";
import assert from "node:assert/strict";
import { findCoachPortrait } from "../dashboard/scripts/coach-portrait-source.mjs";
import {
  recentLineupIds,
  lineupCoaches,
} from "../dashboard/scripts/neon_observed_coaches.mjs";

function source(candidates) {
  return async (raw) => {
    const url = new URL(raw),
      action = url.searchParams.get("action");
    if (action === "wbsearchentities")
      return Response.json({
        search: candidates.map((id) => ({
          id,
          match: { text: "Didier Digard" },
        })),
      });
    if (action === "wbgetentities")
      return Response.json({
        entities: Object.fromEntries(
          candidates.map((id) => [
            id,
            {
              claims: {
                P106: [
                  { mainsnak: { datavalue: { value: { id: "Q628099" } } } },
                ],
                P18: [{ mainsnak: { datavalue: { value: "Digard.jpg" } } }],
              },
            },
          ]),
        ),
      });
    return Response.json({
      query: {
        pages: {
          1: {
            imageinfo: [
              {
                url: "https://upload.wikimedia.org/wikipedia/commons/a/af/Digard.jpg",
                descriptionurl:
                  "https://commons.wikimedia.org/wiki/File:Digard.jpg",
                extmetadata: {
                  Artist: { value: "Photographer" },
                  LicenseShortName: { value: "CC BY-SA 3.0" },
                },
              },
            ],
          },
        },
      },
    });
  };
}

test("a portrait requires one exact football-manager identity", async () => {
  const photo = await findCoachPortrait("Didier Digard", source(["Q267128"]));
  assert.equal(photo.author, "Photographer");
  assert.match(photo.url, /Digard\.jpg$/);
  assert.equal(
    await findCoachPortrait("Didier Digard", source(["Q267128", "Q2"])),
    null,
  );
});

test("lineup discovery covers both clubs and keeps recent fixtures bounded per club", () => {
  const fixture = (id, home, away) => ({
    id,
    home_team: { id: home },
    away_team: { id: away },
  });
  assert.deepEqual(
    recentLineupIds(
      [
        fixture("one", "a", "b"),
        fixture("two", "a", "c"),
        fixture("three", "a", "b"),
      ],
      1,
    ),
    ["one", "two"],
  );
  assert.deepEqual(
    lineupCoaches({
      home: { coach: { name: "Didier Digard" } },
      away: { coach: { name: "Luis Enrique" } },
    }),
    ["Didier Digard", "Luis Enrique"],
  );
});
