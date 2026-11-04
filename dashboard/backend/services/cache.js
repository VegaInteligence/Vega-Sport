import { record, timeSync } from "./metrics.js";

// Byte-bounded LRU with coalescing; failed loads are never retained.
export function cache(limit, { name = "local", maxEntryBytes = limit } = {}) {
  const entries = new Map(),
    pending = new Map();
  let bytes = 0;
  async function load(key, loader, ttl = 30000) {
    const old = entries.get(key);
    if (old && old.until > Date.now()) {
      record(`cache_${name}_hit`);
      entries.delete(key);
      entries.set(key, old);
      return old.value;
    }
    if (old) {
      record(`cache_${name}_expired`);
      bytes -= old.size;
      entries.delete(key);
    }
    if (pending.has(key)) {
      record(`cache_${name}_coalesced`);
      return pending.get(key);
    }
    record(`cache_${name}_miss`);
    const promise = (async () => {
      const value = await loader();
      const size = timeSync("cache_size_ms", () =>
        Buffer.isBuffer(value)
          ? value.length
          : value?.body && Buffer.isBuffer(value.body)
            ? value.body.length + 512
            : Buffer.byteLength(JSON.stringify(value) ?? "null"),
      );
      // Inadmissible entries must not evict useful retained content.
      if (size > Math.min(limit, maxEntryBytes)) {
        record(`cache_${name}_rejected`);
        return value;
      }
      while (entries.size && bytes + size > limit) {
        const first = entries.keys().next().value;
        bytes -= entries.get(first).size;
        entries.delete(first);
        record(`cache_${name}_evicted`);
      }
      entries.set(key, { value, size, until: Date.now() + ttl });
      bytes += size;
      return value;
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }
  // In-flight loads still coalesce; completed stale metadata can be refreshed.
  load.delete = (key) => {
    const old = entries.get(key);
    if (!old) return;
    bytes -= old.size;
    entries.delete(key);
    record(`cache_${name}_invalidated`);
  };
  return load;
}
