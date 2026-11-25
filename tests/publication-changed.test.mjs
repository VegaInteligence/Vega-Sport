/**
 * A read pinned to a publication the API no longer serves (409 PUBLICATION_CHANGED).
 *
 * The site holds one publication (manifest.publicationVersion) and names it on its reads
 * (`generation`). The worker publishes every few minutes; the site re-reads its manifest
 * every four. In between, every pinned read was refused with « Les données ont été
 * actualisées. Rechargez la première page. », shown as it was in the player's
 * « Performance du joueur » window, the lists and the cards, with a « Réessayer » that
 * sent the same stale pin again.
 *
 * Failure modes and expected outcomes:
 * F1  One read pinned to a stale publication: read again once without the pin, answered by
 *     the current publication, labelled with the publication the site holds (its callers'
 *     invariant); the site is told to re-read its manifest. Two requests, no error.
 * F2  The read without the pin fails too: an error, with a neutral message (never
 *     « Rechargez la première page » nor « actualisées »), status kept. Two requests, no loop.
 * F3  A read that names no publication is never read again on a 409 (one request).
 * F4  A paged read whose next page is refused (stale publication): read again once from
 *     its first page without the stale pin, the next pages on the publication the first one
 *     gave; never pages of two publications.
 * F5  A paged read whose first page is refused: same, from the first page, unpinned.
 * F6  A paged read refused again after its restart: neutral error, no loop.
 * F7  The fixtures' page N>1 refused (stale cursor): page 1 read again with the same
 *     filters, then the cursors up to page N, all at the new publication; that page comes
 *     marked `restarted` with its new cursors. A shorter list gives its last page.
 * F8  A fixture page of another publication than the held one: same, never mixed rows. A
 *     second refusal during that recovery: `publicationUnsettled` (the list keeps its last
 *     pages and offers « Actualiser »), no error, no loop.
 * F9  The competition preview, both pages of a newer publication: shown; pages of two
 *     publications: read again once, then a neutral error.
 * F10 No site source carries « Rechargez la première page » nor « La publication a changé ».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  readCompact,
  readCompactPages,
} from "../dashboard/frontend/src/services/compact-reads.js";
import { readFixturePage } from "../dashboard/frontend/src/services/match-pages.js";
import { competitionFixturePreview } from "../dashboard/frontend/src/services/fixture-pages.js";
import { onPublicationChanged } from "../dashboard/frontend/src/services/publication-change.js";

const STALE = /Rechargez|actualisées|actualisez/i;
const changed = () =>
  Response.json(
    {
      error: {
        code: "PUBLICATION_CHANGED",
        message: "Les données ont été actualisées. Rechargez la première page.",
        retry: true,
      },
    },
    { status: 409 },
  );
const performance = (generation) =>
  Response.json({
    data: { row: { id: "m_aaaaaa:p_bbbbbb", name: "Joueur" }, profile: { sections: [] } },
    meta: { generation },
  });
const params = (url) => new URL(url, "https://site.test").searchParams;
function listen() {
  const events = [];
  const stop = onPublicationChanged(() => events.push(Date.now()));
  return { events, stop };
}

test("F1 a single read pinned to a stale publication is read again once, unpinned, without an error", async () => {
  const calls = [],
    seen = listen();
  try {
    const body = await readCompact(
      "performance",
      { season: "2026/2027", appearance: "m_aaaaaa:p_bbbbbb", leagues: "all", generation: "41" },
      {
        fetcher: async (url) => {
          calls.push(params(url).get("generation"));
          return params(url).get("generation") === "41" ? changed() : performance("42");
        },
      },
    );
    assert.deepEqual(calls, ["41", null]);
    assert.equal(body.data.row.name, "Joueur");
    // Labelled with the publication the site holds; the served one is kept beside it.
    assert.equal(body.meta.generation, "41");
    assert.equal(body.meta.servedGeneration, "42");
    assert.ok(seen.events.length >= 1);
  } finally {
    seen.stop();
  }
});

test("F2 a read still refused without its pin fails once, with a neutral message", async () => {
  for (const second of [changed, () => new Response("{}", { status: 503 })]) {
    let calls = 0;
    await assert.rejects(
      readCompact(
        "performance",
        { season: "2026/2027", appearance: "m_aaaaaa:p_bbbbbb", generation: "41" },
        {
          fetcher: async () => (++calls === 1 ? changed() : second()),
        },
      ),
      (error) => {
        assert.doesNotMatch(error.message, STALE);
        assert.ok([409, 503].includes(error.status));
        return true;
      },
    );
    assert.equal(calls, 2);
  }
});

test("F3 a read that names no publication is not read again on a 409, and says nothing stale", async () => {
  let calls = 0;
  await assert.rejects(
    readCompact(
      "performance",
      { season: "2026/2027", appearance: "m_aaaaaa:p_bbbbbb" },
      { fetcher: async () => (calls++, changed()) },
    ),
    (error) => error.status === 409 && !STALE.test(error.message),
  );
  assert.equal(calls, 1);
});

const playersPage = (page, generation, total = 3) =>
  Response.json({
    data: { players: [{ playerId: `p_${page}${generation}` }], teams: [] },
    meta: { generation },
    pagination: { page, limit: 1, total, pages: total, generation },
  });

test("F4 a paged read refused on a next page restarts once from its first page, never mixing publications", async () => {
  const calls = [],
    seen = listen();
  try {
    let current = "41";
    const result = await readCompactPages(
      "players",
      { season: "2026/2027", limit: 1, generation: "41" },
      {
        fetcher: async (url) => {
          const q = params(url);
          calls.push([q.get("page"), q.get("generation")]);
          if (calls.length === 1) {
            const first = playersPage(1, current);
            current = "42";
            return first;
          }
          return q.get("generation") && q.get("generation") !== current
            ? changed()
            : playersPage(Number(q.get("page")), current);
        },
      },
    );
    assert.deepEqual(calls, [
      ["1", "41"],
      ["2", "41"],
      ["1", null],
      ["2", "42"],
      ["3", "42"],
    ]);
    assert.deepEqual(
      result.pages.map((page) => page.players[0].playerId),
      ["p_142", "p_242", "p_342"],
    );
    assert.equal(result.meta.generation, "41");
    assert.equal(result.meta.servedGeneration, "42");
    assert.ok(seen.events.length >= 1);
  } finally {
    seen.stop();
  }
});

test("F5 a paged read refused on its first page restarts from it, unpinned", async () => {
  const calls = [];
  const result = await readCompactPages(
    "players",
    { season: "2026/2027", limit: 1, generation: "41" },
    {
      fetcher: async (url) => {
        const q = params(url);
        calls.push([q.get("page"), q.get("generation")]);
        return q.get("generation") === "41"
          ? changed()
          : playersPage(Number(q.get("page")), "42", 2);
      },
    },
  );
  assert.deepEqual(calls, [
    ["1", "41"],
    ["1", null],
    ["2", "42"],
  ]);
  assert.equal(result.pages.length, 2);
});

test("F6 a paged read refused again after its restart fails with a neutral message, without a loop", async () => {
  const calls = [];
  await assert.rejects(
    readCompactPages(
      "players",
      { season: "2026/2027", limit: 1, generation: "41" },
      {
        fetcher: async (url) => {
          const q = params(url);
          calls.push(q.get("page"));
          return q.get("page") === "1" ? playersPage(1, String(40 + calls.length)) : changed();
        },
      },
    ),
    (error) => error.status === 409 && !STALE.test(error.message),
  );
  assert.deepEqual(calls, ["1", "2", "1", "2"]);
});

const fixtureFilters = { season: "2026/2027", limit: "30", status: "played", order: "desc" };
// A list of fixtures of one publication: page n's cursor is `<generation>-<n>`.
const fixtures = (generation, index = 0, last = 9) =>
  Response.json({
    data: { matches: [{ id: `m_${generation}_${index}` }] },
    pagination: {
      generation,
      nextCursor: index < last ? `${generation}-${index + 1}` : null,
    },
  });
const fixtureList = (generation, { refuse = () => false, last } = {}) => {
  const calls = [];
  const fetcher = async (url) => {
    const cursor = params(url).get("cursor");
    calls.push(cursor);
    if (refuse(cursor, calls.length)) return new Response(null, { status: 409 });
    if (cursor && !cursor.startsWith(`${generation}-`)) return new Response(null, { status: 409 });
    return fixtures(generation, cursor ? Number(cursor.split("-")[1]) : 0, last);
  };
  return { calls, fetcher };
};

test("F7 page 2 refused (stale publication): page 1 is read again, then page 2 at the new version", async () => {
  const seen = listen();
  try {
    const list = fixtureList("42");
    const value = await readFixturePage(fixtureFilters, {
      cursor: "41-1",
      generation: "41",
      page: 1,
      fetcher: list.fetcher,
    });
    assert.deepEqual(list.calls, ["41-1", null, "42-1"]);
    assert.equal(value.restarted, true);
    assert.equal(value.page, 1);
    assert.deepEqual(value.cursors, [null, "42-1"]);
    assert.equal(value.pagination.generation, "42");
    assert.deepEqual(value.data.matches, [{ id: "m_42_1" }]);
    assert.equal(value.publicationUnsettled, undefined);
    assert.ok(seen.events.length >= 1);
  } finally {
    seen.stop();
  }
  // Page 4: the new cursors up to it, all of the new publication.
  const deep = fixtureList("42");
  const fourth = await readFixturePage(fixtureFilters, {
    cursor: "41-3",
    generation: "41",
    page: 3,
    fetcher: deep.fetcher,
  });
  assert.deepEqual(deep.calls, ["41-3", null, "42-1", "42-2", "42-3"]);
  assert.equal(fourth.page, 3);
  assert.deepEqual(fourth.data.matches, [{ id: "m_42_3" }]);
  // The list got shorter: its last page.
  const short = fixtureList("42", { last: 1 });
  const last = await readFixturePage(fixtureFilters, {
    cursor: "41-3",
    generation: "41",
    page: 3,
    fetcher: short.fetcher,
  });
  assert.equal(last.page, 1);
  assert.deepEqual(last.cursors, [null, "42-1"]);
});

test("F8 a page of another publication never mixes rows; a second refusal keeps the list (publicationUnsettled)", async () => {
  // The cursor's page answered, but under a newer publication than the previous pages'.
  const calls = [];
  const value = await readFixturePage(fixtureFilters, {
    cursor: "41-1",
    generation: "41",
    page: 1,
    fetcher: async (url) => {
      const cursor = params(url).get("cursor");
      calls.push(cursor);
      return fixtures("42", cursor ? Number(cursor.split("-")[1]) : 0);
    },
  });
  assert.deepEqual(calls, ["41-1", null, "42-1"]);
  assert.equal(value.restarted, true);
  assert.deepEqual(value.data.matches, [{ id: "m_42_1" }]);
  // A first page of a newer publication is itself the restart: no second request.
  let first = 0;
  const fresh = await readFixturePage(fixtureFilters, {
    generation: "41",
    fetcher: async () => (first++, fixtures("42")),
  });
  assert.equal(first, 1);
  assert.equal(fresh.restarted, true);
  assert.equal(fresh.page, 0);
  // Refused again during the recovery (page 2 at the new version, then the first page):
  // no error, no loop, never the « Rechargez » notice.
  for (const refuse of [(cursor) => cursor === "42-1", () => true]) {
    const list = fixtureList("42", { refuse });
    const unsettled = await readFixturePage(fixtureFilters, {
      cursor: "41-1",
      generation: "41",
      page: 1,
      fetcher: list.fetcher,
    });
    assert.deepEqual(unsettled, { publicationUnsettled: true });
    assert.ok(list.calls.length <= 3);
  }
});

test("F9 the competition preview accepts a newer publication, and reads mixed pages again once", async () => {
  const season = "2026/2027";
  const newer = await competitionFixturePreview(
    { league: "l_000001", season, generation: "41" },
    {
      fetcher: async (url) =>
        Response.json({
          data: { matches: [{ id: params(url).get("status") }] },
          pagination: { generation: "42", nextCursor: null },
        }),
    },
  );
  assert.deepEqual(newer.matches.map(({ id }) => id), ["played", "upcoming"]);
  let calls = 0;
  const mixedOnce = await competitionFixturePreview(
    { league: "l_000001", season, generation: "41" },
    {
      fetcher: async (url) => {
        calls++;
        const generation = calls === 1 ? "41" : "42";
        return Response.json({
          data: { matches: [{ id: params(url).get("status") }] },
          pagination: { generation, nextCursor: null },
        });
      },
    },
  );
  assert.equal(calls, 4);
  assert.equal(mixedOnce.matches.length, 2);
  let always = 0;
  await assert.rejects(
    competitionFixturePreview(
      { league: "l_000001", season, generation: "41" },
      {
        fetcher: async () =>
          Response.json({
            data: { matches: [] },
            pagination: { generation: String(++always), nextCursor: null },
          }),
      },
    ),
    (error) => error.status === 409 && !STALE.test(error.message),
  );
  assert.equal(always, 4);
});

test("F10 no site source shows « Rechargez la première page » nor « La publication a changé »", () => {
  const root = new URL("../dashboard/frontend/src/", import.meta.url).pathname,
    found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(jsx?|mjs)$/.test(name) && /Rechargez la première page|La publication a changé/.test(readFileSync(path, "utf8")))
        found.push(path);
    }
  };
  walk(root);
  assert.deepEqual(found, []);
});
