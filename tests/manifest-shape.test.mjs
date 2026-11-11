// The manifest lost, in each league's entry of a season, the competition its catalogue
// already gives and the publication's date. The pages still read them: the site puts
// them back, and what it computes from a manifest is the same either way.
import test from "node:test";
import assert from "node:assert/strict";
import { expandManifest } from "../dashboard/frontend/src/services/manifest-shape.js";
import { compactCatalogue, directoryScopeIds } from "../dashboard/frontend/src/services/compact-reads.js";
import { europeFocusIds } from "../dashboard/shared/competition-scope.js";

const competition = (id, name, country, seasons) => ({ id, name, country, providerCountry: country, imageUrl: `https://img.example/${id}.png`, seasons });
const CATALOGUE = [
  competition("l_3FJFUl", "Ligue 1", "FRA", ["2026/2027", "2025/2026"]),
  competition("l_2ApGa4", "J. League", "JPN", ["2027", "2026"]),
  competition("l_cupfra", "Coupe de France", "FRA", ["2026/2027"]),
];
const meta = (matchCount) => ({ matchCount, expectedFinishedMatches: 0, collectedMatches: 0, teamCount: 18, retrievedAt: null, startDate: "2026-08-14", endDate: "2027-05-22" });
const PUBLISHED = "2026-11-11T10:25:42.625Z";
/** The manifest as the API sends it since schema 5. */
const slim = () => ({
  schemaVersion: 5,
  storage: "aws-relational",
  capabilities: { compactReads: { home: true } },
  defaultSeason: "2026/2027",
  publishedAt: PUBLISHED,
  publicationVersion: "7",
  seasons: [
    { id: "2027/2028", chunks: [{ leagueId: "l_2ApGa4", sourceDigest: "a".repeat(16), meta: meta(0) }] },
    {
      id: "2026/2027",
      chunks: [
        { leagueId: "l_3FJFUl", sourceDigest: "b".repeat(16), meta: meta(306) },
        { leagueId: "l_cupfra", sourceDigest: "c".repeat(16), meta: meta(12) },
        // An edition whose competition the catalogue does not list.
        { leagueId: "l_unknwn", sourceDigest: "d".repeat(16), meta: meta(3) },
      ],
    },
  ],
  competitions: CATALOGUE,
});
/** The same manifest as the API sent it before (schema 4). */
function former() {
  const manifest = slim();
  manifest.schemaVersion = 4;
  for (const season of manifest.seasons)
    for (const chunk of season.chunks) {
      const entry = CATALOGUE.find((c) => c.id === chunk.leagueId);
      chunk.meta.publishedAt = PUBLISHED;
      chunk.competitions = entry ? [{ ...entry, sampleMatches: chunk.meta.matchCount, sampleSeasons: chunk.meta.matchCount ? [season.id] : [] }] : [];
    }
  return manifest;
}

test("a slim manifest gets back what each league's entry used to repeat", () => {
  const wire = slim();
  const before = structuredClone(wire);
  const manifest = expandManifest(wire);
  assert.deepEqual(manifest, { ...former(), schemaVersion: 5 });
  // The received document is left as it was, and one document has one expansion.
  assert.deepEqual(wire, before);
  assert.equal(expandManifest(wire), manifest);
  assert.equal(expandManifest(manifest), manifest);
});

test("a manifest that still carries them is returned as it is", () => {
  const manifest = former();
  assert.equal(expandManifest(manifest), manifest);
  for (const value of [null, undefined, "x", {}, { seasons: null }]) assert.equal(expandManifest(value), value);
  // Entries without counts (older documents, tests): their competition, no invented date.
  const bare = { seasons: [{ id: "2026/2027", chunks: [{ leagueId: "l_3FJFUl", sourceDigest: "fr1" }] }], competitions: CATALOGUE };
  assert.deepEqual(expandManifest(bare).seasons[0].chunks[0], {
    leagueId: "l_3FJFUl",
    sourceDigest: "fr1",
    competitions: [{ ...CATALOGUE[0], sampleMatches: 0, sampleSeasons: [] }],
  });
});

test("what the site computes from a manifest does not depend on its form", () => {
  const forms = [slim(), expandManifest(slim()), former()];
  for (const season of ["2026/2027", "2027/2028"]) {
    const [a, b, c] = forms.map((manifest) => compactCatalogue(manifest, season));
    assert.deepEqual(a, c, season);
    assert.deepEqual(b, c, season);
  }
  const [a, b, c] = forms.map((manifest) => [...europeFocusIds(manifest)].sort());
  assert.deepEqual(a, c);
  assert.deepEqual(b, c);
  assert.ok(c.includes("l_cupfra") && c.includes("l_3FJFUl") && !c.includes("l_2ApGa4"));
  for (const manifest of forms) assert.deepEqual(directoryScopeIds(manifest, "2026/2027", "europe"), ["l_3FJFUl", "l_cupfra"]);
});
