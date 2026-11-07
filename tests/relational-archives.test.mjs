import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createArchiveReadRoute,
  archiveEditionQuery,
  archiveMetadataQuery,
  archivePageQuery,
  archiveDetailQuery,
} from "../dashboard/backend/services/relational-archives.js";
import {
  archiveRows,
  buildArchiveSeason,
} from "../dashboard/shared/archive.js";

import { buildArchiveProjection } from "../dashboard/shared/archive-projection.js";
import projectionModel from "../dashboard/backend/services/archive-projection-model.json" with { type: "json" };

const season = "2018/2019";
const invoke = (route, params = {}, options) => {
  const req = new Request(
    `https://api.test/api/read/archive?${new URLSearchParams({ season, ...params })}`,
    options,
  );
  return route(req, new URL(req.url).pathname, new URL(req.url).searchParams);
};
const fixture = () => ({
  editions: [
    {
      resource_id: 2,
      scope: "goals",
      source_digest: "b".repeat(64),
      updated_at: "2026-11-01T10:00:00Z",
      response_status: 200,
    },
    {
      resource_id: 1,
      scope: "results",
      source_digest: "a".repeat(64),
      updated_at: "2026-11-01T10:00:00Z",
      response_status: 200,
    },
  ],
  result_headers: [
    {
      record_no: 1,
      position: 0,
      id: "2018-19/de.1",
      name: "Bundesliga",
      country: "Allemagne",
      missing: [],
      null_groups: [],
    },
  ],
  result_matches: [
    {
      parent_no: 1,
      position: 0,
      date: "2018-08-24",
      team1: "FC Bayern München",
      team2: "TSG 1899 Hoffenheim",
      score_ft: [3, 1],
      missing: [],
      null_groups: [],
    },
    ...Array.from({ length: 121 }, (_, index) => ({
      parent_no: 1,
      position: index + 1,
      date: "2018-08-25",
      team1: `Équipe ${index}`,
      team2: `Adversaire ${index}`,
      score_ft: index === 0 ? null : [0, 0],
      status: index === 0 ? "not_played" : "played",
      sourceFields_neutral: index === 1 ? "yes" : null,
      sourceFields_nonmatch: index === 0 ? "annulée" : null,
      missing: [],
      null_groups: [],
    })),
  ],
  goal_headers: [
    {
      record_no: 1,
      position: 0,
      id: "bundesliga",
      name: "Bundesliga",
      country: "Allemagne",
      missing: [],
      null_groups: [],
    },
    {
      record_no: 2,
      position: 1,
      id: "nor",
      name: "Eliteserien",
      country: "Norvège",
      calendarYear: 2018,
      missing: [],
      null_groups: [],
    },
  ],
  goal_events: [
    {
      parent_no: 1,
      position: 0,
      date: "2018-08-25",
      match: "Bayern München vs. 1899 Hoffenheim 3:1",
      minute: "23",
      player: "Thomas Müller",
      score: [1, 0],
      team: "Bayern München",
      missing: [],
    },
    {
      parent_no: 1,
      position: 1,
      date: "2018-08-25",
      match: "Bayern München vs. 1899 Hoffenheim 3:1",
      minute: "23",
      player: "Thomas Müller",
      score: [1, 0],
      team: "Bayern München",
      missing: [],
    },
    {
      parent_no: 1,
      position: 2,
      date: "2018-08-26",
      match: "Rapid Wien vs. Admira 3:0",
      minute: "5",
      player: "X",
      score: [1, 0],
      team: "Rapid Wien",
      missing: [],
    },
    {
      parent_no: 2,
      position: 0,
      date: "2018-09-01",
      match: "Molde vs. Rosenborg 1:0",
      minute: "12",
      player: "Ola",
      score: [1, 0],
      team: "Molde",
      missing: [],
    },
  ],
});

function projectionOf(row) {
  return buildArchiveProjection(
    {
      ...row,
      source_fence: {
        editions: row.editions,
        expected_scopes: row.expected_scopes || [],
      },
    },
    season,
  );
}

function storedRead(row, sql, values = [], projection = projectionOf(row)) {
  const source_fence = {
    editions: row.editions,
    expected_scopes: row.expected_scopes || [],
  };
  if (sql === archiveMetadataQuery)
    return {
      source_fence,
      projection: projection.ready
        ? {
            version: projection.version,
            revision: projection.revision,
            source_fence: projection.source_fence,
            competitions: projection.competitions,
            summary: projection.summary,
            match_count: projection.matches.length,
          }
        : null,
    };
  assert.notEqual(
    sql,
    archiveEditionQuery,
    "Public requests must never rebuild a full edition",
  );
  if (!projection.ready || projection.version !== values[1])
    return { ready: false };
  if (sql === archiveDetailQuery) {
    const match = projection.matches.find((m) => m.match_key === values[2]);
    return {
      ready: true,
      match: match ? { listing: match.listing, goals: match.goals } : null,
    };
  }
  assert.equal(sql, archivePageQuery);
  const [, , competition, needle, requestedPage, limit] = values;
  const matches = projection.matches.filter(
    (m) =>
      (competition === "all" || m.competition_id === competition) &&
      (!needle ||
        m.search_teams.includes(needle) ||
        m.search_players.includes(needle)),
  );
  const total = matches.length,
    pages = Math.max(1, Math.ceil(total / limit)),
    page = Math.min(requestedPage, pages);
  return {
    ready: true,
    pagination: { total, pages, page, limit, hasMore: page < pages },
    matches: matches
      .slice((page - 1) * limit, page * limit)
      .map((m) => m.listing),
  };
}

function mocked(row = fixture()) {
  const calls = [];
  const route = createArchiveReadRoute(async (sql, values) => {
    calls.push(sql);
    return [structuredClone(storedRead(row, sql, values))];
  });
  return { route, calls, row };
}

test("archive pagination keeps exact edition facets, goal-only matches and player search", async () => {
  const { route, calls } = mocked();
  const response = await invoke(route);
  const first = await response.json();
  assert.equal(first.data.matches.length, 50);
  assert.equal(first.pagination.total, 124);
  assert.equal(first.pagination.pages, 3);
  assert.deepEqual(first.data.summary, {
    matches: 124,
    results: 123,
    withGoals: 3,
    goals: 3,
    competitions: 2,
  });
  assert.equal(
    first.data.competitions.find((c) => c.id === "2018-19/de.1").matches,
    123,
  );
  assert.equal(
    first.data.competitions.find((c) => c.id === "g:nor").matches,
    1,
  );
  assert.equal(first.data.matches[0].team1, "Molde");
  for (const match of first.data.matches) {
    assert.ok(!Object.hasOwn(match, "goals"));
    assert.ok(!Object.hasOwn(match, "raw"));
  }
  assert.ok(Number(response.headers.get("content-length")) < 512 * 1024);
  const third = await (
    await invoke(route, { page: "3", version: first.meta.version })
  ).json();
  assert.equal(third.data.matches.length, 24);
  assert.deepEqual(third.data.summary, first.data.summary);
  assert.deepEqual(third.data.competitions, first.data.competitions);
  const player = await (await invoke(route, { q: "muller" })).json();
  assert.equal(player.pagination.total, 1);
  assert.equal(player.data.matches[0].key, "r:2018-19/de.1:0");
  assert.equal(
    player.data.matches[0].goalCount,
    1,
    "duplicate observations count once",
  );
  assert.deepEqual(player.data.summary, first.data.summary);
  assert.equal(
    (await (await invoke(route, { competition: "g:nor" })).json()).pagination
      .total,
    1,
  );
  const detail = await (
    await invoke(route, { match: player.data.matches[0].key })
  ).json();
  assert.equal(detail.data.match.goals[0].player, "Thomas Müller");
  assert.equal(detail.pagination, undefined);
  assert.equal(
    calls.filter((sql) => sql === archiveEditionQuery).length,
    0,
    "cold routes only read published pages; matching belongs to the publisher",
  );
});

test("independent archive publication changes invalidate cache, conditional responses and page versions", async () => {
  const { route, calls, row } = mocked();
  const first = await invoke(route),
    firstBody = await first.json();
  const etag = first.headers.get("etag");
  calls.length = 0;
  const unchanged = await invoke(
    route,
    {},
    { headers: { "if-none-match": etag } },
  );
  assert.equal(unchanged.status, 304);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("result_matches"));
  const head = await invoke(route, {}, { method: "HEAD" });
  assert.equal(head.headers.get("etag"), etag);
  assert.equal(await head.text(), "");
  row.editions[0].source_digest = "c".repeat(64);
  row.goal_events[0].player = "Joueur corrigé";
  row.goal_events[1].player = "Joueur corrigé";
  const changed = await invoke(
    route,
    {},
    { headers: { "if-none-match": etag } },
  );
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  await assert.rejects(
    invoke(route, { page: "2", version: firstBody.meta.version }),
    (e) => e.status === 409,
  );
  assert.equal(
    (await (await invoke(route, { q: "corrige" })).json()).pagination.total,
    1,
  );
  await assert.rejects(
    invoke(route, { match: "r:missing:0" }, { method: "HEAD" }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    invoke(
      route,
      { match: "r:missing:0" },
      { headers: { "if-none-match": "*" } },
    ),
    (e) => e.status === 404,
  );
});

test("invalid archive input and absent resources do not become empty successful editions", async () => {
  const { route, calls } = mocked();
  for (const params of [
    { season: "invalid" },
    { limit: "101" },
    { q: "x".repeat(101) },
    { version: "42" },
    { match: "" },
    { competition: "x\u0000" },
  ])
    await assert.rejects(invoke(route, params), (e) => e.status === 400);
  await assert.rejects(
    invoke(route, {}, { method: "POST" }),
    (e) => e.status === 405,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    await route(
      new Request("https://api.test/api/health"),
      "/api/health",
      new URLSearchParams(),
    ),
    null,
  );
  await assert.rejects(
    invoke(createArchiveReadRoute(async () => [{ editions: [] }])),
    (e) => e.status === 404,
  );
  const incomplete = fixture();
  incomplete.expected_scopes = ["results", "goals"];
  incomplete.editions = incomplete.editions.filter(
    (edition) => edition.scope === "results",
  );
  await assert.rejects(
    invoke(mocked(incomplete).route),
    (e) => e.status === 503,
  );
  const resultsOnly = fixture();
  resultsOnly.expected_scopes = ["results"];
  resultsOnly.editions = resultsOnly.editions.filter(
    (edition) => edition.scope === "results",
  );
  resultsOnly.goal_headers = [];
  resultsOnly.goal_events = [];
  assert.equal(
    (await (await invoke(mocked(resultsOnly).route)).json()).pagination.total,
    122,
  );
  const unavailable = fixture();
  unavailable.editions[0].response_status = 503;
  await assert.rejects(
    invoke(mocked(unavailable).route),
    (e) => e.status === 503,
  );
  await assert.rejects(
    invoke(
      createArchiveReadRoute(async () => {
        throw new Error("timeout");
      }),
    ),
    /timeout/,
  );
});

test("a publication race retries a coherent page and never caches a mixed response", async () => {
  const before = fixture(),
    after = fixture();
  after.editions[0].source_digest = "c".repeat(64);
  let reads = 0;
  const route = createArchiveReadRoute(async (sql, values) => {
    reads++;
    return [
      structuredClone(storedRead(reads === 1 ? before : after, sql, values)),
    ];
  });
  const body = await (await invoke(route)).json();
  assert.equal(reads, 4);
  assert.equal(body.meta.sourceDigests.goals, "c".repeat(64));
  const unstable = createArchiveReadRoute(async (sql, values) => [
    storedRead(sql === archiveMetadataQuery ? before : after, sql, values),
  ]);
  await assert.rejects(invoke(unstable), (e) => e.status === 503);
});

test("missing or stale projections fail closed without cold source reconstruction", async () => {
  const row = fixture(),
    projection = projectionOf(row);
  row.editions[0].source_digest = "d".repeat(64);
  const calls = [];
  const stale = createArchiveReadRoute(async (sql, values) => {
    calls.push(sql);
    return [storedRead(row, sql, values, projection)];
  });
  await assert.rejects(invoke(stale), (e) => e.status === 503);
  assert.deepEqual(calls, [archiveMetadataQuery]);
  await assert.rejects(
    invoke(
      createArchiveReadRoute(async () => [
        {
          source_fence: { editions: row.editions, expected_scopes: [] },
          projection: null,
        },
      ]),
      {},
      { method: "HEAD" },
    ),
    (e) => e.status === 503,
  );
});

test("expected streams and source identity fence detail keys even when digests stay equal", async () => {
  const { route, row } = mocked();
  const first = await (await invoke(route)).json();
  row.expected_scopes = ["goals", "results"];
  const changed = await (await invoke(route)).json();
  assert.notEqual(changed.meta.version, first.meta.version);
  assert.deepEqual(changed.data.summary, first.data.summary);
  await assert.rejects(
    invoke(route, { match: "r:2018-19/de.1:0", version: first.meta.version }),
    (e) => e.status === 409,
  );
  row.editions[0].resource_id = 99;
  await assert.rejects(
    invoke(route, { version: changed.meta.version }),
    (e) => e.status === 409,
  );
});

test("player search cannot match across two distinct goal scorers", async () => {
  const row = fixture();
  row.goal_events.push({
    ...row.goal_events[0],
    position: 3,
    minute: "24",
    player: "Beta",
    score: [2, 0],
  });
  const { route } = mocked(row);
  assert.equal(
    (await (await invoke(route, { q: "muller beta" })).json()).pagination.total,
    0,
  );
  assert.equal(
    (await (await invoke(route, { q: "muller" })).json()).pagination.total,
    1,
  );
  assert.equal(
    (await (await invoke(route, { q: "beta" })).json()).pagination.total,
    1,
  );
  await assert.rejects(
    invoke(route, { q: "muller\u001fbeta" }),
    (e) => e.status === 400,
  );
});

test(
  "published archive pages preserve the full catalogue's exact merge, filters, totals and detail keys",
  { skip: !process.env.VEGA_TEST_DATABASE_URL },
  async () => {
    const target = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
    const require = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = require("pg"),
      db = new Client({ connectionString: target.href });
    await db.connect();
    try {
      await db.query("BEGIN");
      assert.equal(
        (await db.query("SELECT to_regnamespace('statarena_app') AS schema"))
          .rows[0].schema,
        null,
      );
      await db.query(
        await readFile(
          new URL(
            "../dashboard/backend/migrations/006_catalog_models.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await db.query(
        await readFile(
          new URL(
            "../dashboard/backend/migrations/032_archive_read_projection.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const row = fixture();
      const insert = async (table, record) => {
        const names = Object.keys(record);
        await db.query(
          `INSERT INTO statarena_app.${table}(${names.map((key) => '"' + key + '"').join(",")}) VALUES(${names.map((_, i) => "$" + (i + 1)).join(",")})`,
          Object.values(record),
        );
      };
      for (const scope of ["results", "goals"]) {
        const meta = row.editions.find((e) => e.scope === scope);
        const resource = (
          await db.query(
            "INSERT INTO statarena_app.catalog_editions(catalog,scope,edition,model,source_digest) VALUES('archive-season',$1,$2,$3,$4) RETURNING resource_id",
            [scope, season, `archive_${scope}`, meta.source_digest],
          )
        ).rows[0].resource_id;
        await insert(`cat_archive_${scope}`, {
          resource_id: resource,
          record_no: 0,
          missing: [],
          null_groups: [],
          season,
        });
        const headers =
          scope === "results" ? row.result_headers : row.goal_headers;
        for (const header of headers)
          await insert(`cat_archive_${scope}_competitions`, {
            resource_id: resource,
            parent_no: 0,
            ...header,
          });
        const records =
          scope === "results" ? row.result_matches : row.goal_events;
        for (let i = 0; i < records.length; i++)
          await insert(
            `cat_archive_${scope}_competitions_${scope === "results" ? "matches" : "events"}`,
            {
              resource_id: resource,
              record_no: i + 1,
              null_groups: [],
              ...records[i],
            },
          );
      }
      const raw = (
        await db.query(
          "SELECT scope,statarena_app.catalog_response(c) AS body FROM statarena_app.catalog_editions c ORDER BY scope",
        )
      ).rows;
      const legacy = buildArchiveSeason(
        raw.find((r) => r.scope === "results").body,
        raw.find((r) => r.scope === "goals").body,
      );
      const source = (await db.query(archiveEditionQuery, [season])).rows[0];
      const projection = buildArchiveProjection(source, season);
      assert.equal(projection.ready, true);
      await db.query(projectionModel.insert_header, [
        season,
        projection.revision,
        JSON.stringify(projection.source_fence),
        projection.version,
        JSON.stringify(projection.competitions),
        JSON.stringify(projection.summary),
        projection.matches.length,
      ]);
      await db.query(projectionModel.insert_matches, [
        season,
        JSON.stringify(projection.matches),
      ]);
      const readCalls = [];
      const read = async (sql, values) => {
        readCalls.push(sql);
        assert.notEqual(sql, archiveEditionQuery);
        return (await db.query(sql, values)).rows;
      };
      const route = createArchiveReadRoute(read);
      const complete = [];
      for (let page = 1; page <= 3; page++) {
        const body = await (await invoke(route, { page: String(page) })).json();
        assert.equal(body.pagination.total, legacy.matches.length);
        complete.push(...body.data.matches);
      }
      assert.deepEqual(
        complete,
        legacy.matches.map(({ raw, goals, ...match }) => ({
          ...match,
          hasGoals: Boolean(goals?.length),
          goalCount: goals?.length || 0,
        })),
      );
      for (const [competition, q] of [
        ["all", "muller"],
        ["all", "equipe"],
        ["2018-19/de.1", "rapid"],
        ["g:nor", "ola"],
        ["all", "nom absent"],
      ]) {
        const actual = await (
          await invoke(route, { competition, q, limit: "100" })
        ).json();
        const expected = archiveRows(legacy, competition, q);
        assert.equal(actual.pagination.total, expected.length);
        assert.deepEqual(
          actual.data.matches.map((m) => m.key),
          expected.slice(0, 100).map((m) => m.key),
        );
      }
      for (const match of legacy.matches.filter((m) => m.goals?.length)) {
        const body = await (await invoke(route, { match: match.key })).json();
        const { raw, ...expected } = match;
        assert.deepEqual(body.data.match, expected);
      }
      const fresh = createArchiveReadRoute(read);
      const cold = await (
        await invoke(fresh, { page: "999", limit: "7" })
      ).json();
      assert.equal(cold.data.matches.length, legacy.matches.length % 7);
      assert.equal(cold.pagination.page, Math.ceil(legacy.matches.length / 7));
      assert.ok(readCalls.every((sql) => !sql.includes("result_matches")));
      await db.query(
        "UPDATE statarena_app.catalog_editions SET source_digest=repeat('f',64) WHERE catalog='archive-season' AND scope='goals'",
      );
      await assert.rejects(
        invoke(createArchiveReadRoute(read)),
        (e) => e.status === 503,
      );
      await assert.rejects(
        invoke(route, { version: projection.version }),
        (e) => e.status === 409,
      );
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);
