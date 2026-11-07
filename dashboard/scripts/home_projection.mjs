import pg from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { databaseConnectionOptions } from "../backend/services/database-connection.js";
import { competition } from "../backend/services/relational-core.js";
import {
  homeReadQuery,
  homeStamp,
} from "../backend/services/relational-home.js";
import { europeFocusIds } from "../shared/competition-scope.js";

// Publisher-only. A shared publication lock prevents source commits while the
// two exact projections are made. This routine owns its transaction.
export async function refreshHomeProjections(client, clock = Date.now) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout='45s'");
    const migration = readFileSync(
      new URL("../backend/migrations/035_home_projection.sql", import.meta.url),
    );
    const expected = createHash("sha256").update(migration).digest("hex");
    const [installed] = (
      await client.query(
        "SELECT digest FROM statarena_app.worker_schema WHERE version=$1",
        ["035_home_projection.sql"],
      )
    ).rows;
    if (installed?.digest !== expected)
      throw new Error(
        "Home projection migration is missing or differs from the sealed release",
      );
    await client.query(
      "SELECT generation FROM statarena_app.publications WHERE singleton FOR SHARE",
    );
    const seasons = (
      await client.query(
        "SELECT DISTINCT season FROM statarena_app.partitions ORDER BY season DESC LIMIT 1",
      )
    ).rows;
    if (!seasons.length) {
      await client.query("COMMIT");
      return { scopes: 0 };
    }
    const season = seasons[0].season;
    const competitions = (
      await client.query(
        "SELECT * FROM statarena_app.competitions ORDER BY name,id",
      )
    ).rows.map(competition);
    const focus = [...europeFocusIds({ competitions })].sort();
    const now = clock();
    const scopes = [null, focus],
      receipts = [];
    for (const leagueIds of scopes) {
      const filters = {
        scope: { season, leagueIds },
        archive: false,
        personalTeams: [],
        personalPlayers: [],
      };
      const params = new URLSearchParams({ season });
      if (leagueIds) params.set("leagues", leagueIds.join(","));
      const query = homeReadQuery(filters, params, now);
      const [snapshot] = (await client.query(query.sql, query.values)).rows;
      if (!snapshot?.generation)
        throw new Error("Publication unavailable during home projection");
      const until = new Date(snapshot.next_change);
      if (!(until.getTime() > now))
        throw new Error("Invalid home projection time boundary");
      receipts.push({
        scope: leagueIds ? "europe" : "all",
        generation: String(snapshot.generation),
        computedAt: new Date(now).toISOString(),
        validUntil: until.toISOString(),
      });
      await client.query(
        `INSERT INTO statarena_app.home_projection(scope_key,stamp,computed_at,valid_until,snapshot)
        VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(scope_key) DO UPDATE SET
        stamp=excluded.stamp,computed_at=excluded.computed_at,valid_until=excluded.valid_until,snapshot=excluded.snapshot`,
        [
          JSON.stringify(filters),
          homeStamp(snapshot),
          new Date(now),
          until,
          JSON.stringify(snapshot),
        ],
      );
    }
    await client.query(
      "DELETE FROM statarena_app.home_projection_queue WHERE singleton AND generation=(SELECT generation FROM statarena_app.publications WHERE singleton)",
    );
    await client.query("COMMIT");
    return { season, scopes: scopes.length, projections: receipts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const url = new URL(process.env.DATABASE_URL);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  let options;
  if (local && url.searchParams.get("sslmode") === "disable") {
    url.searchParams.delete("sslmode");
    options = { connectionString: url.href, ssl: false };
  } else {
    const ca =
      process.env.DATABASE_CA_PEM ||
      process.env.STATARENA_DATABASE_CA_PEM ||
      readFileSync(
        new URL("../backend/certs/rds-us-east-2.pem", import.meta.url),
        "utf8",
      );
    options = databaseConnectionOptions(url.href, ca);
  }
  const client = new pg.Client({
    ...options,
    application_name: "statarena-home-projector",
  });
  try {
    await client.connect();
    console.log(JSON.stringify(await refreshHomeProjections(client)));
  } finally {
    await client.end();
  }
}
