import test from "node:test";
import assert from "node:assert/strict";
import {
  findCoachPortrait,
  findCoachPortraitBatch,
} from "../dashboard/scripts/coach-portrait-source.mjs";
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

test("temporary image-source failures stay eligible for a later retry", async () => {
  const fetcher = source(["Q267128"]);
  await assert.rejects(
    findCoachPortrait("Didier Digard", async (url, options) =>
      new URL(url).hostname === "commons.wikimedia.org"
        ? new Response(null, { status: 429 })
        : fetcher(url, options),
    ),
    /429/,
  );
});

test("batch lookup keeps exact unambiguous names and photo credits", async () => {
  const binding = (name, id, file) => ({
    label: { value: name },
    person: { value: `http://www.wikidata.org/entity/${id}` },
    image: {
      value: `http://commons.wikimedia.org/wiki/Special:FilePath/${file}`,
    },
  });
  const fetcher = async (url) =>
    url.includes("sparql")
      ? Response.json({
          results: {
            bindings: [
              binding("Didier Digard", "Q1", "Digard.jpg"),
              binding("Didier Digard", "Q1", "Digard.jpg"),
              binding("Alex Coach", "Q2", "One.jpg"),
              binding("Alex Coach", "Q3", "Two.jpg"),
            ],
          },
        })
      : Response.json({
          query: {
            pages: {
              1: {
                title: "File:Digard.jpg",
                imageinfo: [
                  {
                    thumburl:
                      "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Digard.jpg/320px-Digard.jpg",
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Digard.jpg",
                    extmetadata: {
                      Artist: { value: "Mirasol" },
                      LicenseShortName: { value: "CC BY-SA 3.0" },
                    },
                  },
                ],
              },
            },
          },
        });
  const photos = await findCoachPortraitBatch(
    ["Didier Digard", "Alex Coach"],
    fetcher,
  );
  assert.equal(photos.get("Didier Digard").author, "Mirasol");
  assert.match(
    photos.get("Didier Digard").url,
    /^https:\/\/upload\.wikimedia\.org\//,
  );
  assert.equal(photos.get("Alex Coach"), null);
  await assert.rejects(
    findCoachPortraitBatch(["Didier Digard"], async () => new Response(null, { status: 429 })),
    /429/,
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
