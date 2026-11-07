import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { refreshHomeProjections } from "../dashboard/scripts/home_projection.mjs";

test("publisher writes both default scopes from one fenced snapshot and rolls back on failure", async () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const metadata = {
    generation: "3",
    published_at: "2026-11-01",
    partition_count: 1,
  };
  let fail = false;
  const statements = [],
    inserts = [];
  const client = {
    async query(sql, values) {
      statements.push(sql);
      if (sql.includes("SELECT digest FROM statarena_app.worker_schema"))
        return {
          rows: [
            {
              digest: createHash("sha256")
                .update(
                  readFileSync(
                    new URL(
                      "../dashboard/backend/migrations/035_home_projection.sql",
                      import.meta.url,
                    ),
                  ),
                )
                .digest("hex"),
            },
          ],
        };
      if (sql.includes("SELECT DISTINCT season"))
        return { rows: [{ season: "2025/2026" }] };
      if (sql.includes("SELECT * FROM statarena_app.competitions"))
        return { rows: [{ id: "l_999999", name: "FA Cup", country: "ENG" }] };
      if (sql.includes("/*vega:compact:home*/")) {
        if (fail) throw Error("projection failed");
        return {
          rows: [
            {
              ...metadata,
              next_change: new Date(now + 10000),
              result_count: 4,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO statarena_app.home_projection"))
        inserts.push(values);
      return { rows: [] };
    },
  };
  const receipt = await refreshHomeProjections(client, () => now);
  assert.equal(receipt.season, "2025/2026");
  assert.equal(receipt.scopes, 2);
  assert.deepEqual(
    receipt.projections.map((x) => x.scope),
    ["all", "europe"],
  );
  assert.ok(
    receipt.projections.every(
      (x) => x.generation === "3" && Date.parse(x.validUntil) === now + 10000,
    ),
  );
  assert.equal(inserts.length, 2);
  assert.equal(JSON.parse(inserts[0][0]).scope.leagueIds, null);
  assert.ok(JSON.parse(inserts[1][0]).scope.leagueIds.includes("l_999999"));
  assert.ok(statements.some((s) => s.includes("FOR SHARE")));
  assert.equal(statements.at(-1), "COMMIT");
  fail = true;
  await assert.rejects(
    refreshHomeProjections(client, () => now),
    /projection failed/,
  );
  assert.equal(statements.at(-1), "ROLLBACK");
});

test("publisher rejects missing or changed 035 journal before doing any projection", async () => {
  for (const rows of [[], [{ digest: "0".repeat(64) }]]) {
    const statements = [];
    const client = {
      async query(sql) {
        statements.push(sql);
        return { rows: sql.includes("SELECT digest") ? rows : [] };
      },
    };
    await assert.rejects(
      refreshHomeProjections(client),
      /migration is missing or differs/,
    );
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.ok(!statements.some((sql) => sql.includes("/*vega:compact:home*/")));
  }
});
