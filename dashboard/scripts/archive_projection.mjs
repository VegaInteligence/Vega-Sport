import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import model from "../backend/services/archive-projection-model.json" with { type: "json" };
import {
  ARCHIVE_PROJECTION_REVISION,
  archivePublication,
  buildArchiveProjection,
} from "../shared/archive-projection.js";

const validSeason = (season) => /^\d{4}(?:\/\d{4})?$/.test(season || "");

/** Fixed maintenance operation on a dedicated PostgreSQL client.
 * Owns its transaction; callers must not pass a pooled query function or an
 * already active transaction. No arbitrary SQL, paths or source bodies accepted.
 */
export async function refreshArchiveProjection(
  client,
  season,
  { maintenance = false, force = false } = {},
) {
  if (!validSeason(season)) throw new Error("Invalid archive season");
  let control;
  const workDeadline = performance.now() + 44000;
  const remaining = () => {
    const budget = Math.floor(workDeadline - performance.now());
    if (budget < 1) throw new Error("Archive refresh deadline exhausted");
    return budget;
  };
  const query = async (text, values) => {
    const budget = remaining();
    await client.query({
      text: "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
      values: [`${budget}ms`, `${Math.min(budget, 5000)}ms`],
      query_timeout: budget,
    });
    return client.query({ text, values, query_timeout: remaining() });
  };
  try {
    await client.query({ text: "BEGIN", query_timeout: remaining() });
    await query(model.lease);
    const hasControl = (
      await query(
        "SELECT to_regclass('statarena_app.consolidation_state') AS table_name",
      )
    ).rows[0].table_name;
    if (hasControl) {
      control = (
        await query(
          "SELECT value FROM statarena_app.consolidation_state WHERE key='control' FOR SHARE",
        )
      ).rows[0]?.value;
      if (
        !control ||
        !(
          maintenance ? ["legacy", "backfill", "active"] : ["legacy", "active"]
        ).includes(control.mode)
      )
        throw new Error(
          "Archive refresh is paused during this storage operation",
        );
    }
    await query(model.catalog_lock);
    const header = (await query(model.metadata, [season])).rows[0];
    const publication = archivePublication(header.source_fence);
    let receipt = {
      season,
      ready: publication.ready,
      changed: false,
      version: publication.version,
    };
    if (!publication.ready) receipt.reason = publication.reason;
    else if (
      !force &&
      header.projection?.version === publication.version &&
      header.projection.revision === ARCHIVE_PROJECTION_REVISION &&
      archivePublication(header.projection.source_fence).version ===
        publication.version
    )
      Object.assign(receipt, {
        matches: header.projection.match_count,
        goals: header.projection.summary.goals,
      });
    else {
      const row = (await query(model.source, [season])).rows[0];
      const projection = buildArchiveProjection(row, season);
      if (!projection.ready || projection.version !== publication.version)
        throw new Error(
          "Archive sources changed while preparing the projection",
        );
      await query(model.delete, [season]);
      await query(model.insert_header, [
        season,
        projection.revision,
        JSON.stringify(projection.source_fence),
        projection.version,
        JSON.stringify(projection.competitions),
        JSON.stringify(projection.summary),
        projection.matches.length,
      ]);
      for (let index = 0; index < projection.matches.length; index += 250)
        await query(model.insert_matches, [
          season,
          JSON.stringify(projection.matches.slice(index, index + 250)),
        ]);
      const count = (await query(model.count, [season])).rows[0].matches;
      if (count !== projection.matches.length)
        throw new Error(
          "Archive projection count differs from the exact merger",
        );
      const current = (await query(model.metadata, [season])).rows[0];
      if (
        archivePublication(current.source_fence).version !== projection.version
      )
        throw new Error("Archive sources changed before publication");
      Object.assign(receipt, {
        changed: true,
        matches: count,
        goals: projection.summary.goals,
        sourceBytes: Buffer.byteLength(JSON.stringify(row)),
      });
    }
    if (hasControl) {
      const after = (
        await query(
          "SELECT value FROM statarena_app.consolidation_state WHERE key='control' FOR SHARE",
        )
      ).rows[0]?.value;
      if (JSON.stringify(control) !== JSON.stringify(after))
        throw new Error("Archive refresh changed consolidation control");
      receipt.controlRevision = after.revision ?? null;
      receipt.controlUnchanged = true;
    }
    await query("COMMIT");
    return receipt;
  } catch (error) {
    try {
      // The final second is reserved for rollback. A connection that cannot
      // confirm rollback must be closed, never returned with an open writer.
      await client.query({ text: "ROLLBACK", query_timeout: 1000 });
    } catch {
      await client.end();
    }
    throw error;
  }
}

// The Python publisher passes already locked canonical records over stdin.
// This command only transforms JSON; it never opens a database connection.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!validSeason(input.season)) throw new Error("Invalid archive season");
  process.stdout.write(
    JSON.stringify(buildArchiveProjection(input.row, input.season)),
  );
}
