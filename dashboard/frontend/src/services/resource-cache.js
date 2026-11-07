/** Shared, bounded client reads. A failed refresh never discards a valid value. */
export function createResourceCache({
  maxAge = 5 * 60_000,
  maxEntries = 96,
  now = Date.now,
} = {}) {
  const entries = new Map();
  function entry(key) {
    let item = entries.get(key);
    if (!item) {
      item = {
        snapshot: { key, loading: true, refreshing: false },
        hasValue: false,
        updatedAt: -Infinity,
        listeners: new Set(),
        pending: null,
        controller: null,
        retained: false,
      };
      entries.set(key, item);
    }
    return item;
  }
  function publish(item, snapshot) {
    item.snapshot = snapshot;
    for (const listener of item.listeners) listener(snapshot);
  }
  function trim() {
    for (const [key, item] of entries) {
      if (entries.size <= maxEntries) break;
      if (!item.pending && !item.listeners.size) entries.delete(key);
    }
  }
  function fresh(item, age) {
    return item.hasValue && now() - item.updatedAt < age;
  }
  function load(
    key,
    loader,
    { force = false, age = maxAge, retain = false } = {},
  ) {
    const item = entry(key);
    // Revalidation is also coalesced: focus, a timer and several components
    // asking for one resource share the same network request.
    if (item.pending) {
      item.retained ||= retain;
      return item.pending;
    }
    if (!force && fresh(item, age)) return Promise.resolve(item.snapshot.value);
    const controller = new AbortController();
    item.controller = controller;
    item.retained = retain;
    let pending;
    pending = Promise.resolve()
      .then(() => loader({ signal: controller.signal }))
      .then(
        (value) => {
          if (item.pending === pending && entries.get(key) === item) {
            item.pending = null;
            item.controller = null;
            item.hasValue = true;
            item.updatedAt = now();
            entries.delete(key);
            entries.set(key, item);
            publish(item, { key, value, loading: false, refreshing: false });
            trim();
          }
          return value;
        },
        (error) => {
          if (item.pending === pending && entries.get(key) === item) {
            item.pending = null;
            item.controller = null;
            publish(item, {
              key,
              ...(item.hasValue ? { value: item.snapshot.value } : {}),
              loading: false,
              refreshing: false,
              ...(error?.name === "AbortError"
                ? {}
                : {
                    [item.hasValue ? "refreshError" : "error"]:
                      error?.message || String(error),
                  }),
            });
            trim();
          }
          throw error;
        },
      );
    item.pending = pending;
    publish(item, {
      key,
      ...(item.hasValue ? { value: item.snapshot.value } : {}),
      loading: !item.hasValue,
      refreshing: item.hasValue,
    });
    return pending;
  }
  const cache = {
    load,
    peek: (key) => entries.get(key)?.snapshot,
    value: (key, { age = maxAge } = {}) => {
      const item = entries.get(key);
      return item && fresh(item, age) ? item.snapshot.value : undefined;
    },
    subscribe(key, listener) {
      const item = entry(key);
      item.listeners.add(listener);
      listener(item.snapshot);
      return () => {
        item.listeners.delete(listener);
        // Allow a React strict-mode remount to re-subscribe before cancelling.
        queueMicrotask(() => {
          if (!item.listeners.size && item.pending && !item.retained) {
            const controller = item.controller;
            item.pending = null;
            item.controller = null;
            publish(item, {
              key,
              ...(item.hasValue ? { value: item.snapshot.value } : {}),
              loading: !item.hasValue,
              refreshing: false,
            });
            controller?.abort();
            trim();
          }
        });
        trim();
      };
    },
    // Only unobserved entries may be evicted. A second component may still
    // depend on a shared request even when its first subscriber has left.
    forget(key) {
      const item = entries.get(key);
      if (!item || item.listeners.size) return false;
      entries.delete(key);
      item.controller?.abort();
      return true;
    },
    keys: () => entries.keys(),
    size: () => entries.size,
  };
  // Non-React consumers follow the same cancellation rule as mounted hooks:
  // one caller leaving must not abort a shared request another still needs.
  cache.read = (key, loader, { signal, age = maxAge } = {}) => {
    signal?.throwIfAborted();
    const unsubscribe = cache.subscribe(key, () => {});
    return new Promise((resolve, reject) => {
      let finished = false;
      const complete = (settle, value) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", abort);
        unsubscribe();
        settle(value);
      };
      const abort = () =>
        complete(
          reject,
          signal.reason || new DOMException("Aborted", "AbortError"),
        );
      signal?.addEventListener("abort", abort, { once: true });
      cache.load(key, loader, { age }).then(
        (value) => complete(resolve, value),
        (error) => complete(reject, error),
      );
    });
  };
  return cache;
}
