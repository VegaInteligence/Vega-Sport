import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createPlayerReadRoute,
  PLAYER_COUNT_METRICS,
  parsePlayerRead,
} from "../dashboard/backend/services/relational-players.js";
import { readPlayerRollup } from "../dashboard/backend/services/relational-player-rollups.js";

test("rollup readiness cannot hide a publication race or unsupported row filters", async () => {
  const params = new URLSearchParams({ season: "2026/2027", generation: "42" });
  let calls = 0;
  await assert.rejects(
    readPlayerRollup(
      async () => {
        calls++;
        return calls === 1
          ? [{ generation: "42", ready: true }]
          : [{ generation: "43", rollup_ready: true }];
      },
      parsePlayerRead(params),
      params,
      PLAYER_COUNT_METRICS,
    ),
    (error) => error.status === 409,
  );
  assert.equal(calls, 2);
  calls = 0;
  assert.equal(
    await readPlayerRollup(
      async () => {
        calls++;
        return [{ generation: "42", ready: false }];
      },
      parsePlayerRead(params),
      params,
      PLAYER_COUNT_METRICS,
    ),
    null,
  );
  assert.equal(calls, 1);
  params.set("venue", "away");
  calls = 0;
  assert.equal(
    await readPlayerRollup(
      async () => {
        calls++;
      },
      parsePlayerRead(params),
      params,
      PLAYER_COUNT_METRICS,
    ),
    null,
  );
  assert.equal(calls, 0);
});

const databaseUrl = process.env.VEGA_TEST_DATABASE_URL;
test(
  "published player rollups match exact facts across scopes, transfers, aliases, filters and duplicate guards",
  { skip: !databaseUrl },
  async () => {
    const target = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
    const require = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = require("pg"),
      db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query("BEGIN");
      for (const file of [
        "003_relational_core.sql",
        "025_player_season_rollups.sql",
      ])
        await db.query(
          await readFile(
            new URL(`../dashboard/backend/migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      await db.query(`UPDATE statarena_app.publications SET generation=42;
      INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at) VALUES
       ('2026/2027','l_000001','one','2026-11-06T08:00:00Z'),('2026/2027','l_000002','two','2026-11-06T09:00:00Z');
      INSERT INTO statarena_app.competitions(id,name,latest_season) VALUES ('l_000001','Ligue 1','2026/2027'),('l_000002','Coupe','2026/2027');
      INSERT INTO statarena_app.teams(id,name,latest_season) VALUES ('t_000001','Paris','2026/2027'),('t_000002','Madrid','2026/2027');
      INSERT INTO statarena_app.players(id,player_id,name,image_url) VALUES
       ('ref_old','p_000001','Ancien nom','old.jpg'),('ref_new','p_000001','Étoile','new.jpg'),
       ('ref_cr7','p_3yEwhj','Cristiano Ronaldo',null),('ref_bench','p_000003','Remplaçant',null),('ref_unknown','p_000004','Inconnu',null);
      INSERT INTO statarena_app.matches(id,season,league_id,day,date,status,home_id,away_id,home_score,away_score)
       SELECT 'm_'||lpad(n::text,6,'0'),'2026/2027',CASE WHEN n<=3 THEN 'l_000001' ELSE 'l_000002' END,
       date '2026-11-01'+n-1,to_char(date '2026-11-01'+n-1,'YYYY-MM-DD'),'finished','t_000001','t_000002',2,1 FROM generate_series(1,8) n`);
      const metricColumns = PLAYER_COUNT_METRICS.map((key) =>
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      );
      for (let n = 1; n <= 6; n++) {
        for (const [actor, ref, team, position] of [
          [
            "p_000001",
            n <= 3 ? "ref_old" : "ref_new",
            n <= 3 ? "Paris" : "Madrid",
            n <= 3 ? "31" : "91",
          ],
          ["p_3yEwhj", "ref_cr7", "Madrid", "91"],
        ]) {
          const values = [
            `a_${actor}_${n}`,
            ref,
            actor,
            `m_${String(n).padStart(6, "0")}`,
            "2026/2027",
            n <= 3 ? "l_000001" : "l_000002",
            n <= 3 ? "Ligue 1" : "Coupe",
            `2026-11-0${n}`,
            0,
            team === "Paris" ? "t_000001" : "t_000002",
            team,
            90,
            7 + (n % 3),
            n % 2 === 0,
            position,
            "int",
            ...metricColumns.map((key, index) =>
              key === "passes_attempted"
                ? 50
                : key === "passes_accurate"
                  ? 40
                  : (n + index) % 4 === 0
                    ? null
                    : (n + index) % 5,
            ),
          ];
          await db.query(
            `INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,league,date,ordinal,team_id,team,minutes,rating,starter,position_id,position_id_type,${metricColumns.join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")})`,
            values,
          );
        }
      }
      await db.query(`INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,league,date,ordinal,team_id,team,minutes,rating,goals,position_id,position_id_type) VALUES
      ('duplicate-late','ref_new','p_000001','m_000001','2026/2027','l_000001','Ligue 1','2026-11-01',99,'t_000001','Paris',90,1,999,'91','int'),
      ('unknown-duplicate','ref_old','p_000001','m_000001','2026/2027','l_000001','Ligue 1','2026-11-01',-1,'t_000001','Paris',null,null,null,'31','int'),
      ('unused','ref_bench','p_000003','m_000008','2026/2027','l_000002','Coupe','2026-11-08',0,'t_000002','Madrid',0,8,2,'91','int'),
      ('unknown','ref_unknown','p_000004','m_000007','2026/2027','l_000002','Coupe','2026-11-07',0,'t_000002','Madrid','NaN',null,null,null,'NoneType');
      UPDATE statarena_app.appearances SET xg='NaN',xa='Infinity',passes_attempted=0 WHERE id='a_p_000001_2'`);
      for (const league of ["l_000001", "l_000002"]) {
        const first = await db.query(
          "SELECT statarena_app.refresh_player_season_rollups($1,$2) amount",
          ["2026/2027", league],
        );
        assert.ok(first.rows[0].amount > 0);
        assert.equal(
          (
            await db.query(
              "SELECT statarena_app.refresh_player_season_rollups($1,$2) amount",
              ["2026/2027", league],
            )
          ).rows[0].amount,
          0,
        );
      }
      const originalColumns = (
        await db.query(
          "SELECT quote_ident(attname) AS name FROM pg_attribute WHERE attrelid='statarena_app.player_season_rollups'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum",
        )
      ).rows
        .map((row) => row.name)
        .join(",");
      const originalRows = async () =>
        (
          await db.query(
            `SELECT ${originalColumns} FROM statarena_app.player_season_rollups ORDER BY season,league_id,player_id`,
          )
        ).rows;
      const beforeIndex = await originalRows();
      const metricBytes = async () =>
        (
          await db.query(
            "SELECT season,league_id,player_id,encode(jsonb_send(metrics),'hex') bytes FROM statarena_app.player_season_rollups ORDER BY season,league_id,player_id",
          )
        ).rows;
      const beforeMetricBytes = await metricBytes();
      const refreshDefinition = (
        await db.query(
          "SELECT pg_get_functiondef('statarena_app.refresh_player_season_rollups(text,text,boolean)'::regprocedure) AS definition",
        )
      ).rows[0].definition;
      const directoryMigration = await readFile(
        new URL(
          "../dashboard/backend/migrations/030_player_directory_index.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await db.query(directoryMigration);
      await db.query(directoryMigration);
      assert.deepEqual(
        await originalRows(),
        beforeIndex,
        "adding the directory index preserves every existing rollup value",
      );
      assert.deepEqual(
        await metricBytes(),
        beforeMetricBytes,
        "retargeting JSON storage preserves binary values",
      );
      assert.equal(
        (
          await db.query(
            "SELECT pg_get_functiondef('statarena_app.refresh_player_season_rollups(text,text,boolean)'::regprocedure) AS definition",
          )
        ).rows[0].definition,
        refreshDefinition,
      );
      for (const league of ["l_000001", "l_000002"])
        await db.query(
          "SELECT statarena_app.refresh_player_season_rollups($1,$2,true)",
          ["2026/2027", league],
        );
      assert.deepEqual(
        await originalRows(),
        beforeIndex,
        "the original025 INSERT refreshes appended generated columns without a writer change or VACUUM",
      );
      let generation = "42";
      const calls = [];
      const facts = createPlayerReadRoute(
        async (sql, values) => (await db.query(sql, values)).rows,
        { rollups: false },
      );
      const rollups = createPlayerReadRoute(
        async (sql, values) => {
          calls.push(sql);
          return (await db.query(sql, values)).rows;
        },
        { rollups: true },
      );
      const request = async (route, extra) => {
        const params = new URLSearchParams({
          season: "2026/2027",
          generation,
          limit: "2",
          ...extra,
        });
        return (
          await route(
            new Request(`https://api.test/api/read/players?${params}`),
            "/api/read/players",
            params,
          )
        ).json();
      };
      const compare = async (extra = {}) => {
        const expected = await request(facts, extra),
          actual = await request(rollups, extra);
        assert.deepEqual(actual, expected, JSON.stringify(extra));
        return actual;
      };
      for (const extra of [
        {},
        { minutes: "0", limit: "10" },
        { basis: "total" },
        { basis: "per90" },
        { ranking: "rating" },
        { ranking: "goals", basis: "total" },
        { ranking: "assists", basis: "per90" },
        { ranking: "clinical", basis: "total" },
        { ranking: "wasteful", basis: "total" },
        { sort: "name", direction: "asc" },
        { sort: "minutes", minutes: "0", direction: "asc", limit: "10" },
        { sort: "passAccuracy", direction: "asc" },
        { sort: "duelRate" },
        { sort: "finishingDelta" },
        { q: "CR7" },
        { q: "Madrid", minutes: "0", limit: "10" },
        { q: "Paris" },
        { q: "Coupe" },
        { pos: "D" },
        { pos: "A" },
        { rmin: "7", stats: "goals:1,shots:1" },
        { leagues: "l_000001", minutes: "0" },
        { leagues: "l_000002", minutes: "0" },
        { leagues: "none" },
        { page: "2", minutes: "0", sort: "name" },
        { role: "sub" },
        { venue: "home" },
        { result: "win" },
        { from: "2026-11-02" },
        { match: "m_000001" },
      ])
        await compare(extra);
      assert.ok(
        calls.some((sql) => sql.includes("/*vega:compact:players:rollup*/")),
      );
      assert.ok(
        calls.some((sql) => sql.includes("/*vega:compact:players*/")),
        "advanced row filters use exact facts",
      );

      // Imported observations spanning two partitions must use global fact dedup.
      await db.query(`INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,league,date,ordinal,team_id,team,minutes,rating,goals)
      VALUES('cross-league','ref_new','p_000001','m_000001','2026/2027','l_000002','Coupe','2026-11-01',0,'t_000002','Madrid',90,10,1000);
      SELECT statarena_app.refresh_player_season_rollups('2026/2027','l_000002',true);
      UPDATE statarena_app.publications SET generation=43`);
      generation = "43";
      calls.length = 0;
      await compare({ minutes: "0" });
      assert.ok(calls.some((sql) => sql.includes("/*vega:compact:players*/")));
      assert.ok(
        !calls.some((sql) => sql.includes("/*vega:compact:players:rollup*/")),
      );

      // A failed/interrupted refresh is visible as stale, never a valid empty page.
      await db.query(`DELETE FROM statarena_app.appearances WHERE id='cross-league';
      UPDATE statarena_app.partitions SET source_digest='updated',player_rollup_ambiguous=false WHERE league_id='l_000002';
      UPDATE statarena_app.publications SET generation=44`);
      generation = "44";
      calls.length = 0;
      await compare({ minutes: "0", limit: "3" });
      assert.ok(calls.some((sql) => sql.includes("/*vega:compact:players*/")));
      await db.query(
        "SELECT statarena_app.refresh_player_season_rollups('2026/2027','l_000002')",
      );
      calls.length = 0;
      await compare({ minutes: "0", limit: "4" });
      assert.ok(
        calls.some((sql) => sql.includes("/*vega:compact:players:rollup*/")),
      );
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);

// Exact counts, qualification and ordering are discrete contracts. Derived
// measurements may differ by summation-order noise, but are never rounded in
// the payload merely to make fact and rollup representations byte-identical.
function equivalentMeasurements(actual, expected, path = "$", key = "") {
  if (typeof actual === "number" && typeof expected === "number") {
    if (
      /^(matches|count|ratingCount|unknownMinutes|starts|knownStarts|total|pages|page|limit|partitionCount|missingWatermarks)$/.test(
        key,
      )
    ) {
      assert.equal(actual, expected, path);
    } else {
      const tolerance =
        64 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected));
      assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${path}: ${actual} != ${expected}`,
      );
    }
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path);
    actual.forEach((value, index) =>
      equivalentMeasurements(value, expected[index], `${path}[${index}]`, key),
    );
    return;
  }
  if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object"
  ) {
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      path,
    );
    for (const name of Object.keys(actual))
      equivalentMeasurements(
        actual[name],
        expected[name],
        `${path}.${name}`,
        name,
      );
    return;
  }
  assert.equal(actual, expected, path);
}

test(
  "numeric comparison keys preserve mathematical ties and both sides of qualification boundaries",
  { skip: !databaseUrl },
  async () => {
    const target = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
    const require = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = require("pg"),
      db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query("BEGIN");
      assert.equal(
        (await db.query("SELECT to_regnamespace('statarena_app') AS schema"))
          .rows[0].schema,
        null,
      );
      for (const file of [
        "003_relational_core.sql",
        "025_player_season_rollups.sql",
        "030_player_directory_index.sql",
      ])
        await db.query(
          await readFile(
            new URL(`../dashboard/backend/migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      await db.query(`UPDATE statarena_app.publications SET generation=42;
      INSERT INTO statarena_app.partitions(season,league_id,source_digest) VALUES
      ('2026/2027','l_000001','one'),('2026/2027','l_000002','two')`);
      const ratings = [6.4, 5.2, 5.3, 9.7, 7.6, 8.7, 9.6];
      const actors = [
        {
          id: "p_000001",
          name: "Aaron",
          ratings,
          xg: 0.10000000000001,
          split: true,
        },
        { id: "p_000002", name: "Bastien", ratings, xg: 0.09999999999999 },
        {
          id: "p_000003",
          name: "Zoé",
          ratings: Array(7).fill(7.50000000001),
          xg: 0.10000000001,
        },
        {
          id: "p_000004",
          name: "Céline",
          ratings: Array(7).fill(7.49999999999),
          xg: 0.09999999999,
        },
        {
          id: "p_000005",
          name: "Ada",
          ratings: Array(7).fill(7.50000000000001),
          xg: 0.1,
        },
      ];
      for (const [actorIndex, actor] of actors.entries()) {
        await db.query(
          "INSERT INTO statarena_app.players(id,player_id,name) VALUES($1,$1,$2)",
          [actor.id, actor.name],
        );
        for (let index = 0; index < actor.ratings.length; index++) {
          const match = `m_${String(actorIndex + 1).padStart(2, "0")}${String(index + 1).padStart(4, "0")}`;
          const league = actor.split && index >= 3 ? "l_000002" : "l_000001";
          await db.query(
            "INSERT INTO statarena_app.matches(id,season,league_id,day,date,status) VALUES($1,'2026/2027',$2,$3::date,$3::text,'finished')",
            [match, league, `2026-11-${String(index + 1).padStart(2, "0")}`],
          );
          await db.query(
            `INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,league,date,ordinal,minutes,rating,goals,xg)
          VALUES($1,$2,$2,$3,'2026/2027',$4,'Ligue',$5,0,90,$6,1,$7)`,
            [
              `a_${actor.id}_${index}`,
              actor.id,
              match,
              league,
              `2026-11-${String(index + 1).padStart(2, "0")}`,
              actor.ratings[index],
              actor.xg,
            ],
          );
        }
      }
      for (const league of ["l_000001", "l_000002"])
        await db.query(
          "SELECT statarena_app.refresh_player_season_rollups('2026/2027',$1)",
          [league],
        );
      const read = async (sql, values) => (await db.query(sql, values)).rows;
      const facts = createPlayerReadRoute(read, { rollups: false });
      const rollups = createPlayerReadRoute(read, { rollups: true });
      const request = async (route, extra) => {
        const params = new URLSearchParams({
          season: "2026/2027",
          generation: "42",
          limit: "10",
          ...extra,
        });
        return (
          await route(
            new Request(`https://api.test/api/read/players?${params}`),
            "/api/read/players",
            params,
          )
        ).json();
      };
      const compare = async (extra, names) => {
        const expected = await request(facts, extra),
          actual = await request(rollups, extra);
        equivalentMeasurements(actual, expected);
        assert.deepEqual(
          actual.data.players.map((player) => player.name),
          names,
        );
        assert.equal(actual.pagination.total, names.length);
        return actual;
      };
      const tiedOrder = ["Zoé", "Aaron", "Ada", "Bastien", "Céline"];
      const all = await compare({ ranking: "rating" }, tiedOrder);
      assert.notEqual(
        all.data.players.find((player) => player.name === "Ada").rating,
        7.5,
        "comparison precision must not round the public profile",
      );
      await compare({ rmin: "7.5" }, tiedOrder.slice(0, 4));
      await compare({ rmin: "7.500000000001" }, ["Zoé"]);
      await compare({ rmin: "7.499999999999" }, tiedOrder.slice(0, 4));
      await compare({ rmin: "7.49999999998" }, tiedOrder);
      await compare({ sort: "rating", direction: "asc" }, [
        "Céline",
        "Aaron",
        "Ada",
        "Bastien",
        "Zoé",
      ]);
      await compare({ sort: "xg", stats: "xg:0.1" }, tiedOrder.slice(0, 4));
      await compare({ sort: "xg", stats: "xg:0.100000000001" }, ["Zoé"]);
      await compare(
        { sort: "xg", stats: "xg:0.099999999999" },
        tiedOrder.slice(0, 4),
      );
      await compare({ ranking: "goals" }, tiedOrder);
      await compare({ ranking: "clinical" }, [
        "Céline",
        "Aaron",
        "Ada",
        "Bastien",
        "Zoé",
      ]);
      await compare({ sort: "matches" }, [
        "Aaron",
        "Ada",
        "Bastien",
        "Céline",
        "Zoé",
      ]);
      const page = await request(rollups, {
        ranking: "rating",
        limit: "2",
        page: "2",
      });
      assert.deepEqual(
        page.data.players.map((player) => player.name),
        ["Ada", "Bastien"],
      );
      assert.equal(
        page.pagination.total,
        5,
        "qualification precedes pagination",
      );
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);
