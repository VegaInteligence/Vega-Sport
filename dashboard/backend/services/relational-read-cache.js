import { cache } from "./cache.js";
import {
  checkReadGeneration,
  publicationSql,
} from "./relational-read-utils.js";

const publicationStamp = (snapshot) =>
  JSON.stringify([
    String(snapshot.generation),
    snapshot.published_at,
    snapshot.source_retrieved_at,
    snapshot.latest_source_retrieved_at,
    snapshot.start_date,
    snapshot.end_date,
    snapshot.partition_count,
    snapshot.missing_watermarks,
  ]);

/**
 * Retain expensive read snapshots, not an independently stale publication ID.
 * A first load still obtains its data and metadata in one SQL statement. A
 * retained hit is admitted only after checking the current DB publication.
 * Scope, filters, pagination and time-dependent periods are part of the key.
 */
export function createReadCache(
  read,
  { name, maxBytes = 4 * 1024 * 1024, maxEntryBytes = 1024 * 1024 } = {},
) {
  const snapshots = cache(maxBytes, { name, maxEntryBytes });
  return async function readSnapshot(
    req,
    params,
    scope,
    loader,
    { periodKey = null } = {},
  ) {
    const load = async () => {
      const snapshot = await loader();
      checkReadGeneration(params, snapshot?.generation);
      return snapshot;
    };
    // Conditional misses already checked a validator. Their payload must own
    // its fresh SQL snapshot; a hit/HEAD returned before reaching this helper.
    if (req.method === "HEAD" || req.headers.get("if-none-match"))
      return load();
    const key = JSON.stringify([
      new URL(req.url).pathname,
      [...params].sort(([a], [b]) => a.localeCompare(b)),
      periodKey,
    ]);
    const retained = snapshots.peek(key);
    let currentGeneration;
    if (retained) {
      const values = [];
      const [current] = await read(publicationSql(scope, values), values);
      checkReadGeneration(params, current?.generation);
      currentGeneration = String(current.generation);
      if (publicationStamp(retained) !== publicationStamp(current))
        snapshots.delete(key);
    }
    const snapshot = await snapshots(key, load, 5 * 60_000);
    // A publication may complete while an earlier load is still resolving.
    // Never let that in-flight result override the version we just verified.
    if (
      currentGeneration !== undefined &&
      String(snapshot.generation) !== currentGeneration
    ) {
      snapshots.delete(key);
      return load();
    }
    checkReadGeneration(params, snapshot.generation);
    return snapshot;
  };
}
