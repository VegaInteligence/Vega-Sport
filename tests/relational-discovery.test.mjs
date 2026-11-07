import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createDiscoveryRoute } from "../dashboard/backend/services/relational-discovery.js";

const player = (n) => ({
  id: `p_test0${n}`,
  name: `Joueur ${n}`,
  image_url: null,
  team: "Paris",
  league_id: "l_3FJFUl",
  league: "Ligue 1",
  rank: 1,
});
const club = (n) => ({
  id: `t_test0${n}`,
  name: `Club ${n}`,
  image_url: null,
  league_id: "l_other1",
  league: "Autre championnat",
  league_country: "BRA",
  rank: 2,
});
const snapshot = (version = "42") => ({
  version,
  players: Array.from({ length: 7 }, (_, n) => player(n)),
  clubs: Array.from({ length: 5 }, (_, n) => club(n)),
});
const invoke = (route, search, options) => {
  const request = new Request(`https://api.test/api/search?${search}`, options);
  return route(
    request,
    new URL(request.url).pathname,
    new URL(request.url).searchParams,
  );
};

test("search returns bounded identities from one publication snapshot", async () => {
  const calls = [];
  const route = createDiscoveryRoute(async (sql, values) => {
    calls.push({ sql, values });
    return [snapshot()];
  });
  const response = await invoke(route, "q=Hakimi&season=2026/2027");
  const body = await response.json();
  assert.equal(calls.length, 1);
  assert.equal(body.players.length, 6);
  assert.equal(body.clubs.length, 4);
  assert.equal(body.playersHasMore, true);
  assert.equal(body.clubsHasMore, true);
  assert.equal(body.generation, "42");
  assert.equal(body.players[0].outside, false);
  assert.equal(body.clubs[0].outside, true);
  assert.equal(body.playersCount, undefined);
  assert.match(response.headers.get("cache-control"), /s-maxage=30/);
  assert.ok(Number(response.headers.get("content-length")) <= 32 * 1024);
  assert.match(calls[0].sql, /LIMIT 7/);
  assert.match(calls[0].sql, /LIMIT 5/);
  assert.doesNotMatch(
    calls[0].sql,
    /match_shots|team_match_stats|file_documents/,
  );
});

test("short input and unrelated routes do not query the database", async () => {
  let calls = 0;
  const route = createDiscoveryRoute(async () => {
    calls++;
    return [snapshot()];
  });
  for (const q of ["", "a", " a "]) {
    const response = await invoke(
      route,
      new URLSearchParams({ q, season: "2026/2027" }),
    );
    assert.deepEqual((await response.json()).players, []);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal(
    await route(
      new Request("https://api.test/api/status"),
      "/api/status",
      new URLSearchParams(),
    ),
    null,
  );
  assert.equal(calls, 0);
});

test("invalid requests fail before SQL and search terms remain bound parameters", async () => {
  const calls = [];
  const route = createDiscoveryRoute(async (sql, values) => {
    calls.push({ sql, values });
    return [snapshot()];
  });
  for (const search of [
    "q=aa&season=bad",
    "q=aa&q=bb&season=2026",
    "q=aa&season=2026&limit=999",
    new URLSearchParams({ q: "a".repeat(101), season: "2026" }),
    new URLSearchParams({ q: "aa\u0000", season: "2026" }),
  ]) {
    await assert.rejects(
      invoke(route, search),
      (error) => error.status === 400,
    );
  }
  await assert.rejects(
    invoke(route, "q=aa&season=2026", { method: "POST" }),
    (error) => error.status === 405,
  );
  assert.equal(calls.length, 0);
  await invoke(
    route,
    new URLSearchParams({ q: " ÉmBAPPÉ_%\\' ", season: "2026" }),
  );
  assert.equal(calls[0].values[0], "embappe_%\\'");
  assert.equal(calls[0].values[2], "%embappe\\_\\%\\\\'%");
  assert.equal(calls[0].values[4], "embappe\\_\\%\\\\'%");
  assert.ok(!calls[0].sql.includes("ÉmBAPPÉ"));
  await invoke(route, "q=CR7&season=2026/2027");
  assert.deepEqual(calls[1].values[3], ["p_3yEwhj"]);
});

test("ETags vary with generation/query and HEAD retains the same cache contract", async () => {
  let version = "42";
  const route = createDiscoveryRoute(async () => [snapshot(version)]);
  const first = await invoke(route, "q=hakimi&season=2026/2027");
  const etag = first.headers.get("etag");
  const conditional = await invoke(route, "q=hakimi&season=2026/2027", {
    headers: { "if-none-match": etag },
  });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  assert.equal(
    conditional.headers.get("cache-control"),
    first.headers.get("cache-control"),
  );
  const head = await invoke(route, "q=hakimi&season=2026/2027", {
    method: "HEAD",
  });
  assert.equal(head.headers.get("etag"), etag);
  assert.equal(await head.text(), "");
  version = "43";
  const changed = await invoke(route, "q=hakimi&season=2026/2027", {
    headers: { "if-none-match": etag },
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  const query = await invoke(route, "q=mbappe&season=2026/2027");
  assert.notEqual(query.headers.get("etag"), changed.headers.get("etag"));
});

test("search revalidation and retained queries avoid rescanning identities", async () => {
  let version = "42";
  const calls = [];
  const route = createDiscoveryRoute(async (sql) => {
    calls.push(sql);
    return [snapshot(version)];
  });
  const first = await invoke(route, "q=hakimi&season=2026/2027");
  const etag = first.headers.get("etag");
  assert.match(calls.pop(), /player_candidates/);
  const repeated = await invoke(route, "q=HAKIMI&season=2026/2027");
  assert.equal((await repeated.json()).generation, "42");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls.pop(), /players|appearances|team_seasons/);
  const conditional = await invoke(route, "q=hakimi&season=2026/2027", {
    headers: { "if-none-match": etag },
  });
  assert.equal(conditional.status, 304);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls.pop(), /player_candidates/);
  await invoke(route, "q=hakimi&season=2026/2027", { method: "HEAD" });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls.pop(), /player_candidates/);
  version = "43";
  const changed = await invoke(route, "q=hakimi&season=2026/2027");
  assert.equal((await changed.json()).generation, "43");
  assert.equal(calls.length, 2);
  assert.match(calls.at(-1), /player_candidates/);
});

test("mixed name/club/league terms and aliases remain bounded SQL parameters", async () => {
  const calls = [];
  const route = createDiscoveryRoute(async (sql, values) => {
    calls.push({ sql, values });
    return [snapshot()];
  });
  await invoke(
    route,
    new URLSearchParams({ q: "Mbappé Real", season: "2026/2027" }),
  );
  assert.deepEqual(calls[0].values[5], ["%mbappe%", "%real%"]);
  assert.match(calls[0].sql, /concat_ws\(' ',p\.name,a\.team,a\.league\)/);
  assert.match(calls[0].sql, /a\.season=\$2/);
  assert.doesNotMatch(calls[0].sql, /mbappe|Real/);
  await invoke(
    route,
    new URLSearchParams({ q: "CR7 Al Nassr", season: "2026/2027" }),
  );
  assert.deepEqual(calls[1].values[3], ["p_3yEwhj"]);
  assert.deepEqual(JSON.parse(calls[1].values[6]), [
    { player_id: "p_3yEwhj", pattern: "%cr7%" },
  ]);
  assert.deepEqual(calls[1].values[5], ["%cr7%", "%al%", "%nassr%"]);
  await assert.rejects(
    invoke(
      route,
      new URLSearchParams({
        q: "one two three four five six seven eight nine",
        season: "2026/2027",
      }),
    ),
    (error) => error.status === 400,
  );
  assert.equal(calls.length, 2);
});

test("database failures never become successful empty search results", async () => {
  const unavailable = createDiscoveryRoute(async () => []);
  await assert.rejects(
    invoke(unavailable, "q=hakimi&season=2026/2027"),
    (error) => error.status === 503,
  );
  const failed = createDiscoveryRoute(async () => {
    throw new Error("database timeout");
  });
  await assert.rejects(
    invoke(failed, "q=hakimi&season=2026/2027"),
    /database timeout/,
  );
});

// Optional local PostgreSQL check. All fixtures and schema creation are rolled
// back, and a pre-existing schema causes failure rather than being overwritten.
test(
  "discovery SQL resolves names, accents, aliases, seasons and club initials on PostgreSQL",
  {
    skip: !process.env.VEGA_TEST_DATABASE_URL,
  },
  async () => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Only a local test database is allowed",
    );
    const requireLocal = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = requireLocal("pg");
    const client = new Client({ connectionString: url.href });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
      CREATE SCHEMA statarena_app;
      CREATE TABLE statarena_app.publications(singleton boolean PRIMARY KEY,generation bigint,published_at timestamptz);
      CREATE TABLE statarena_app.players(id text PRIMARY KEY,player_id text,name text,image_url text);
      CREATE TABLE statarena_app.appearances(id text PRIMARY KEY,player_ref text,player_id text,season text,date text,team text,league_id text,league text);
      CREATE TABLE statarena_app.teams(id text PRIMARY KEY,name text,image_url text,country text);
      CREATE TABLE statarena_app.team_seasons(team_id text,season text,league_id text,sample_matches integer);
      CREATE TABLE statarena_app.competitions(id text PRIMARY KEY,name text,country text);
      CREATE INDEX app_appearances_player ON statarena_app.appearances(player_id,season,league_id);
      INSERT INTO statarena_app.publications VALUES(true,42,now());
      INSERT INTO statarena_app.competitions VALUES('l_3FJFUl','Ligue 1','FRA');
      INSERT INTO statarena_app.players VALUES
        ('ref_1','p_mbappe','Kylian Mbappé',null),
        ('ref_2','p_3yEwhj','Cristiano Ronaldo',null),
        ('ref_3','p_oldone','Ancien joueur',null);
      INSERT INTO statarena_app.appearances VALUES
        ('a_1','ref_1','p_mbappe','2026/2027','2026-10-01','Paris','l_3FJFUl','Ligue 1'),
        ('a_2','ref_1','p_mbappe','2026/2027','2026-11-01','Real Madrid','l_3FJFUl','Ligue 1'),
        ('a_3','ref_2','p_3yEwhj','2026/2027','2026-11-01','Al-Nassr','l_saudi1','Pro League'),
        ('a_4','ref_3','p_oldone','2025/2026','2026-05-01','Paris','l_3FJFUl','Ligue 1');
      INSERT INTO statarena_app.teams VALUES('t_paris1','Paris Saint-Germain',null,'FRA');
      INSERT INTO statarena_app.team_seasons VALUES('t_paris1','2026/2027','l_3FJFUl',12);
    `);
      const route = createDiscoveryRoute(
        async (sql, values) => (await client.query(sql, values)).rows,
      );
      const search = async (q, season = "2026/2027") =>
        (await invoke(route, new URLSearchParams({ q, season }))).json();
      assert.equal((await search("mbappe")).players[0].name, "Kylian Mbappé");
      assert.equal((await search("MBAPPÉ")).players[0].meta, "Real Madrid");
      assert.equal((await search("mbappe real")).players[0].id, "p_mbappe");
      assert.equal(
        (await search("real mbappé ligue")).players[0].id,
        "p_mbappe",
      );
      assert.deepEqual((await search("mbappe barcelona")).players, []);
      assert.equal((await search("cr7")).players[0].id, "p_3yEwhj");
      assert.equal((await search("cr7")).players[0].outside, true);
      assert.equal((await search("cr7 al nassr")).players[0].id, "p_3yEwhj");
      assert.deepEqual((await search("cr7 real")).players, []);
      assert.deepEqual((await search("Ancien")).players, []);
      assert.equal((await search("Ancien", "2025/2026")).players.length, 1);
      assert.equal((await search("psg")).clubs[0].id, "t_paris1");
      assert.equal((await search("ps")).clubs[0].id, "t_paris1");
      assert.deepEqual((await search("_%")).players, []);
      assert.equal((await search("Paris")).generation, "42");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);

test(
  "prefix search preserves the original ranking and bounds membership work on a realistic PostgreSQL fixture",
  { skip: !process.env.VEGA_TEST_DATABASE_URL },
  async (t) => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    const requireLocal = createRequire(
        new URL("../dashboard/package.json", import.meta.url),
      ),
      { Client } = requireLocal("pg"),
      client = new Client({ connectionString: url.href }),
      baseline = JSON.parse(
        await readFile(
          new URL("./fixtures/discovery-before-prefix.json", import.meta.url),
          "utf8",
        ),
      );
    await client.connect();
    try {
      await client.query("BEGIN");
      assert.equal(
        (
          await client.query(
            "SELECT to_regnamespace('statarena_app') AS schema",
          )
        ).rows[0].schema,
        null,
      );
      for (const filename of ["003_relational_core.sql"])
        await client.query(
          await readFile(
            new URL(
              `../dashboard/backend/migrations/${filename}`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
      await client.query(`
        INSERT INTO statarena_app.competitions(id,name,country,latest_season)
          VALUES('l_3FJFUl','Ligue 1','FRA','2026/2027');
        INSERT INTO statarena_app.players(id,player_id,name)
        SELECT 'ref_scale_'||i,'p_scale_'||i,
          CASE WHEN i%125=0 THEN 'Pa '||lpad(i::text,6,'0')
            WHEN i%32=0 THEN 'Other pa '||lpad(i::text,6,'0')
            ELSE 'Person '||lpad(i::text,6,'0') END
        FROM generate_series(1,26000) i;
        INSERT INTO statarena_app.players(id,player_id,name) VALUES
          ('ref_exact','p_exact','pa'),
          ('ref_exact_variant','p_exact','0 pa'),
          ('ref_prefix','p_prefix','Pablo Z'),
          ('ref_prefix_variant','p_prefix','Abapa A'),
          ('ref_prefix_fill','p_prefix_fill','Legacy Pablo'),
          ('ref_ronaldo','p_3yEwhj','Cristiano Ronaldo'),
          ('ref_muller','p_muller','Thomas Müller'),
          ('ref_context','p_context','Pa Context Z'),
          ('ref_context_variant','p_context','Otherpa Context A'),
          ('ref_literal','p_literal','Player _% Literal'),
          ('ref_old','p_old','Pa Old Season');
        INSERT INTO statarena_app.players(id,player_id,name)
        SELECT 'ref_zebra_'||i,'p_zebra_'||i,
          CASE WHEN i<=6 THEN 'Zebra Prefix ' ELSE 'Legacy Zebra ' END||i
        FROM generate_series(1,8) i;
        INSERT INTO statarena_app.appearances(id,player_ref,player_id,season,date,team,league_id,league,minutes)
        SELECT 'scale_a_'||i||'_'||g,'ref_scale_'||i,'p_scale_'||i,
          CASE WHEN i%11=0 THEN '2025/2026' ELSE '2026/2027' END,
          '2026-10-'||lpad(g::text,2,'0'),
          CASE WHEN g<7 THEN 'Paris' ELSE 'Real Madrid' END,'l_3FJFUl','Ligue 1',90
        FROM generate_series(1,26000) i CROSS JOIN generate_series(1,13) g;
        INSERT INTO statarena_app.appearances(id,player_ref,player_id,season,date,team,league_id,league,minutes)
        SELECT 'special_'||id,id,player_id,
          CASE WHEN id='ref_old' THEN '2025/2026' ELSE '2026/2027' END,
          '2026-10-31','Paris','l_3FJFUl','Ligue 1',90
        FROM statarena_app.players WHERE id NOT LIKE 'ref_scale_%' AND id NOT LIKE '%variant';
        INSERT INTO statarena_app.appearances(id,player_ref,player_id,season,date,team,league_id,league,minutes)
        VALUES('special_context_latest','ref_context','p_context','2026/2027','2026-11-01','Real Madrid','l_3FJFUl','Ligue 1',90);
        INSERT INTO statarena_app.teams(id,name,country,latest_season)
        SELECT 't_scale_'||i,
          CASE WHEN i%25=0 THEN 'Pa Club '||lpad(i::text,4,'0')
            WHEN i%41=0 THEN 'Club pa '||lpad(i::text,4,'0')
            ELSE 'Club '||lpad(i::text,4,'0') END,'FRA','2026/2027'
        FROM generate_series(1,1000) i;
        INSERT INTO statarena_app.teams(id,name,country,latest_season) VALUES
          ('t_paris','Paris Saint-Germain','FRA','2026/2027'),
          ('t_initials','Paris Athletic','FRA','2026/2027'),
          ('t_exact','pa','FRA','2026/2027');
        INSERT INTO statarena_app.team_seasons(team_id,season,league_id,sample_matches)
        SELECT id,CASE WHEN id LIKE 't_scale_%' AND substring(id FROM 9)::int%13=0 THEN '2025/2026' ELSE '2026/2027' END,
          'l_3FJFUl',12 FROM statarena_app.teams;
        ANALYZE statarena_app.players;
        ANALYZE statarena_app.appearances;
        ANALYZE statarena_app.teams;
        ANALYZE statarena_app.team_seasons;
      `);
      // The rollout builds024 over the populated model. Build in the same
      // order, so a synthetic bulk-insert GIN pending list does not stand in
      // for the native migration's compact index.
      await client.query(
        await readFile(
          new URL(
            "../dashboard/backend/migrations/024_navigation_indexes.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await client.query(
        "ANALYZE statarena_app.players; ANALYZE statarena_app.teams",
      );
      const reads = [],
        referenceSnapshots = new Map(),
        route = createDiscoveryRoute(async (sql, values) => {
          reads.push({ sql, values });
          const rows = (await client.query(sql, values)).rows;
          if (values.length) {
            const reference = referenceSnapshots.get(JSON.stringify(values));
            assert.deepEqual(
              rows[0].players,
              reference.players,
              "all seven candidate players retain their exact order and context",
            );
            assert.deepEqual(
              rows[0].clubs,
              reference.clubs,
              "all five candidate clubs retain their exact order and context",
            );
          }
          return rows;
        }),
        original = createDiscoveryRoute(async (sql, values) => {
          const rows = (
            await client.query(
              values.length
                ? values.length === 6
                  ? baseline.single
                  : baseline.multiple
                : sql,
              values,
            )
          ).rows;
          if (values.length)
            referenceSnapshots.set(JSON.stringify(values), rows[0]);
          return rows;
        });
      for (const season of ["2026/2027", "2025/2026", "2024/2025"])
        for (const q of [
          "pa",
          "Pa",
          "pa 000",
          "pablo",
          "zebra",
          "muller",
          "cr7",
          "cr7 paris",
          "pa paris ligue",
          "pa real",
          "psg",
          "ps",
          "_%",
          "notfound",
        ]) {
          const params = new URLSearchParams({ q, season }),
            expected = await (await invoke(original, params)).json(),
            actual = await (await invoke(route, params)).json();
          assert.deepEqual(actual, expected, `${q} in ${season}`);
        }
      const broad = reads.find(
          ({ values }) => values[0] === "pa" && values[1] === "2026/2027",
        ),
        explain = async (sql) =>
          (
            await client.query(
              "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql,
              broad.values,
            )
          ).rows[0]["QUERY PLAN"][0],
        before = await explain(baseline.single),
        after = await explain(broad.sql),
        nodes = (plan) => [plan, ...(plan.Plans || []).flatMap(nodes)],
        probes = (plan, relation) =>
          nodes(plan.Plan)
            .filter((node) => node["Relation Name"] === relation)
            .reduce((sum, node) => sum + node["Actual Loops"], 0);
      if (process.env.VEGA_SEARCH_PLAN_RECEIPT)
        await writeFile(
          process.env.VEGA_SEARCH_PLAN_RECEIPT,
          JSON.stringify({ status: "measured", before, after }, null, 2) + "\n",
        );
      assert.ok(
        probes(before, "appearances") > 900,
        "the former plan checks all broad matches before its limit",
      );
      assert.ok(
        probes(after, "appearances") <= 25,
        "only top eligible identities and their final contexts read appearances",
      );
      assert.ok(
        nodes(after.Plan).some(
          (node) =>
            node["Index Name"] === "app_players_search_name" &&
            node["Actual Loops"] > 0,
        ),
        "the preferred name branch uses migration024's existing index",
      );
      for (const name of ["other_players", "other_clubs"]) {
        const branch = nodes(after.Plan).find(
          (node) => node["Subplan Name"] === "CTE " + name,
        );
        assert.equal(
          branch["Actual Rows"],
          0,
          `${name} is unnecessary when preferred results fill the response`,
        );
        assert.ok(
          nodes(branch)
            .filter((node) => node["Relation Name"])
            .every((node) => node["Actual Loops"] === 0),
          `${name} must not scan its fallback inputs`,
        );
      }
      const report = {
        engine: (await client.query("SELECT version() AS version")).rows[0]
          .version,
        fixtures: (
          await client.query(
            "SELECT (SELECT count(*)::int FROM statarena_app.players) AS players,(SELECT count(*)::int FROM statarena_app.appearances) AS appearances,(SELECT count(*)::int FROM statarena_app.teams) AS clubs",
          )
        ).rows[0],
        parityQueries: 42,
        before: {
          planningMs: before["Planning Time"],
          executionMs: before["Execution Time"],
          appearanceProbes: probes(before, "appearances"),
          plan: before,
        },
        after: {
          planningMs: after["Planning Time"],
          executionMs: after["Execution Time"],
          appearanceProbes: probes(after, "appearances"),
          plan: after,
        },
      };
      t.diagnostic(
        JSON.stringify({
          beforeMs: report.before.executionMs,
          afterMs: report.after.executionMs,
          beforeProbes: report.before.appearanceProbes,
          afterProbes: report.after.appearanceProbes,
        }),
      );
      if (process.env.VEGA_SEARCH_PLAN_RECEIPT)
        await writeFile(
          process.env.VEGA_SEARCH_PLAN_RECEIPT,
          JSON.stringify(report, null, 2) + "\n",
        );
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
