import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createDisciplineRoute } from "../dashboard/backend/services/relational-discipline.js";
import { summarizeDiscipline } from "../dashboard/frontend/src/services/player-discipline.js";

const mid = (n) => `m_${String(n).padStart(6, "0")}`;
const player = "p_000001";
const request = (route, params, options) => {
  const url = new URL("https://api.test/api/read/discipline");
  url.search = new URLSearchParams(params);
  return route(new Request(url, options), url.pathname, url.searchParams);
};
const base = { season: "2026/2027", player, matches: mid(1) };

test("discipline validates bounded native IDs and parameters before SQL", async () => {
  let calls = 0;
  const route = createDisciplineRoute(async () => {
    calls++;
    throw Error("must not query");
  });
  for (const params of [
    { ...base, player: "p_000001' OR TRUE" },
    { ...base, matches: "m_000001,broken" },
    { ...base, matches: "m_000001,,m_000002" },
    {
      ...base,
      matches: Array.from({ length: 201 }, (_, i) => mid(i)).join(","),
    },
    { ...base, season: "2026/27" },
    { ...base, leagues: "l_000001'" },
    { ...base, generation: "42;select 1" },
    { ...base, unused: "1" },
    { season: base.season, player },
    new URLSearchParams([...Object.entries(base), ["player", player]]),
  ])
    await assert.rejects(
      request(route, params),
      (error) => error.status === 400,
    );
  await assert.rejects(
    request(route, base, { method: "POST" }),
    (error) => error.status === 405,
  );
  assert.equal(
    await route(
      new Request("https://api.test/"),
      "/unrelated",
      new URLSearchParams(),
    ),
    null,
  );
  assert.equal(calls, 0);
});

const databaseUrl =
  process.env.VEGA_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL discipline preserves native events, coverage, scope and conditional publication in one query",
  { skip: !databaseUrl },
  async () => {
    const target = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
    assert.match(target.pathname, /^\/(?:vega_refactor_test|.*_e2e)$/);
    const require = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = require("pg"),
      db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query("BEGIN");
      assert.equal(
        (await db.query("SELECT to_regnamespace('statarena_app') name")).rows[0]
          .name,
        null,
      );
      for (const name of [
        "003_relational_core.sql",
        "004_match_details.sql",
        "020_publication_foreign_key_indexes.sql",
      ])
        await db.query(
          readFileSync(
            new URL(`../dashboard/backend/migrations/${name}`, import.meta.url),
            "utf8",
          ),
        );
      await db.query(`UPDATE statarena_app.publications SET generation=42;
        INSERT INTO statarena_app.partitions(season,league_id,source_digest,retrieved_at) VALUES
          ('2026/2027','l_000001','one','2026-11-06T12:00:00Z'),
          ('2026/2027','l_000002','two','2026-11-06T11:00:00Z');
        INSERT INTO statarena_app.players(id,player_id,name) VALUES
          ('p_000001','p_000001','Joueur'),('p_000002','p_000002','Autre joueur');`);
      for (let n = 1; n <= 20; n++) {
        const season = n === 17 ? "2025/2026" : base.season,
          league = n === 16 ? "l_000002" : "l_000001",
          actor = n === 18 ? "p_000002" : player;
        await db.query(
          "INSERT INTO statarena_app.matches(id,season,league_id) VALUES($1,$2,$3)",
          [mid(n), season, league],
        );
        await db.query(
          `INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id)
          VALUES($1,$2,$2,$3,$4,$5)`,
          [
            `appearance-${n}`,
            actor,
            mid(n),
            n === 19 ? "2025/2026" : season,
            n === 20 ? "l_000002" : league,
          ],
        );
        await db.query(
          "INSERT INTO statarena_app.match_details(match_id) VALUES($1)",
          [mid(n)],
        );
      }
      let sequence = 0;
      async function family(n, options = {}) {
        const {
          status = 200,
          hasData = true,
          error = undefined,
          missing = [],
          nullGroups = [],
          sheet = true,
          events = [],
          params = "{}",
          subject = "",
          kind = "events",
        } = options;
        const resource = (
          await db.query(
            `INSERT INTO statarena_app.match_families
          (match_id,family,subject_id,params,status,has_data,has_error,error_object,
           error_has_code,error_has_message,source_digest)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,false,$9) RETURNING resource_id`,
            [
              mid(n),
              kind,
              subject,
              params,
              status,
              hasData,
              error !== undefined,
              error !== undefined && error !== null,
              String(++sequence).padStart(64, "0"),
            ],
          )
        ).rows[0].resource_id;
        if (!sheet) return resource;
        await db.query(
          `INSERT INTO statarena_app.event_sheets(resource_id,record_no,missing,null_groups,match_id)
          VALUES($1,0,$2,$3,$4)`,
          [resource, missing, nullGroups, mid(n)],
        );
        for (const [i, event] of events.entries()) {
          await db.query(
            `INSERT INTO statarena_app.match_events
            (resource_id,record_no,parent_no,position,missing,null_groups,event_type,
             period,minute,minute_added,player_id)
            VALUES($1,$2,0,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              resource,
              i,
              event.missing || [],
              event.nullGroups || [],
              event.kind,
              event.period === undefined ? "SecondHalf" : event.period,
              event.minute ?? null,
              event.added ?? null,
              event.player || player,
            ],
          );
        }
        return resource;
      }
      const primary = await family(1, {
        events: [
          { kind: "YellowCard", minute: 10 },
          { kind: "secondyellow", minute: 60 },
          { kind: "redcard", minute: 60, added: 0 },
          { kind: "redcard", minute: 80 },
          { kind: "yellowcard", minute: 15, player: "p_000002" },
          { kind: "yellowcard", minute: 16, missing: ["player.id"] },
          { kind: "yellowcard", minute: 17, nullGroups: ["player"] },
          { kind: "yellowcard", minute: 18, missing: ["player"] },
          { kind: "yellowcard", minute: 19, missing: ["event_type"] },
          { kind: "goal", minute: 20 },
        ],
      });
      await family(2, {
        events: [
          { kind: "secondyellow", minute: 62, missing: ["period"] },
          { kind: "redcard", minute: 62, period: null },
          {
            kind: "secondyellow",
            minute: 63,
            missing: ["period", "minute_added"],
          },
          { kind: "redcard", minute: 63, missing: ["period"] },
          { kind: "secondyellow", minute: null },
          { kind: "redcard", minute: null },
        ],
      });
      await family(3);
      await family(4, { missing: ["events"] });
      await family(5, { nullGroups: ["events"] });
      await family(6, { sheet: false });
      await family(7, { status: 500 });
      await family(8, { hasData: false });
      await family(9, { error: {} });
      await family(10, { error: null });
      // 11 has no family. Neither params, subject nor another family is a fallback.
      await family(12, { params: '{"period":"FirstHalf"}' });
      await family(13, { subject: player });
      await family(14, { kind: "shots" });
      for (let n = 15; n <= 20; n++)
        await family(n, { events: [{ kind: "yellowcard", minute: 22 }] });

      const calls = [],
        route = createDisciplineRoute(async (sql, values) => {
          calls.push({ sql, values });
          return (await db.query(sql, values)).rows;
        });
      const selected = Array.from({ length: 20 }, (_, i) => mid(i + 1)).concat(
        mid(99),
      );
      const params = {
        ...base,
        leagues: "l_000001",
        generation: "42",
        matches: [...selected, mid(1)].reverse().join(","),
      };
      const response = await request(route, params),
        body = await response.json(),
        etag = response.headers.get("etag");
      assert.equal(
        calls.length,
        1,
        "one SQL round-trip for all selected matches",
      );
      assert.equal(body.meta.generation, "42");
      assert.ok(Number(response.headers.get("content-length")) < 64 * 1024);
      assert.match(response.headers.get("cache-control"), /s-maxage=30/);
      assert.ok(
        calls[0].values.some(
          (value) => Array.isArray(value) && value.length === 21,
        ),
      );
      assert.ok(!calls[0].sql.includes(player));
      assert.ok(!calls[0].sql.includes(mid(1)));
      const expected = (
        await db.query(
          `SELECT statarena_app.detail_data_events(f.resource_id) data
        FROM statarena_app.match_families f
        WHERE f.match_id=ANY($1) AND f.family='events' AND f.params='{}' AND f.subject_id=''
        ORDER BY f.match_id`,
          [[mid(1), mid(2), mid(3), mid(10), mid(15)]],
        )
      ).rows.map((row) => row.data);
      expected.push(...Array(selected.length - expected.length).fill(null));
      assert.deepEqual(body.data, summarizeDiscipline(player, expected));
      assert.deepEqual(body.data, {
        yellow: 2,
        directRed: 3,
        secondYellow: 4,
        covered: 5,
        total: 21,
      });

      calls.length = 0;
      const conditional = await request(route, params, {
        headers: { "If-None-Match": etag },
      });
      assert.equal(conditional.status, 304);
      assert.equal(await conditional.text(), "");
      assert.equal(calls.length, 1);
      const canonical = { ...params, matches: selected.join(",") };
      assert.equal(
        (await request(route, canonical, { method: "HEAD" })).headers.get(
          "etag",
        ),
        etag,
      );
      for (const options of [
        {},
        { method: "HEAD" },
        { headers: { "If-None-Match": "*" } },
      ])
        await assert.rejects(
          request(route, { ...params, generation: "41" }, options),
          (error) => error.status === 409,
        );

      // Native corrections may change events without changing the core generation.
      await db.query(
        `UPDATE statarena_app.match_families SET source_digest=$1 WHERE resource_id=$2;
        `,
        ["f".repeat(64), primary],
      );
      await db.query(
        "UPDATE statarena_app.match_events SET event_type='redcard' WHERE resource_id=$1 AND record_no=0",
        [primary],
      );
      const corrected = await request(route, params, {
        headers: { "If-None-Match": etag },
      });
      assert.equal(corrected.status, 200);
      assert.notEqual(corrected.headers.get("etag"), etag);
      assert.equal((await corrected.json()).data.yellow, 1);

      const emptyScope = await (
        await request(route, { ...params, leagues: "none" })
      ).json();
      assert.deepEqual(emptyScope.data, {
        yellow: 0,
        directRed: 0,
        secondYellow: 0,
        covered: 0,
        total: 21,
      });
      const all = await (
        await request(route, { ...base, generation: "42", matches: mid(16) })
      ).json();
      assert.equal(all.data.yellow, 1);
      const otherSeason = await (
        await request(route, { ...base, season: "2025/2026", matches: mid(17) })
      ).json();
      assert.equal(otherSeason.data.covered, 1);
      const otherPlayer = await (
        await request(route, { ...base, player: "p_000002", matches: mid(1) })
      ).json();
      assert.equal(otherPlayer.data.covered, 0);
      const empty = await (
        await request(route, { ...base, matches: "" })
      ).json();
      assert.deepEqual(empty.data, {
        yellow: 0,
        directRed: 0,
        secondYellow: 0,
        covered: 0,
        total: 0,
      });
      const bounded = await (
        await request(route, {
          ...base,
          matches: Array.from({ length: 200 }, (_, i) => mid(i + 100)).join(
            ",",
          ),
        })
      ).json();
      assert.equal(bounded.data.total, 200);
      assert.equal(bounded.data.covered, 0);
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  },
);
