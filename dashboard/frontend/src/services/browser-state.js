"use client";
import { useMemo, useSyncExternalStore } from "react";

/** SSR never populates the document store; client fallbacks commit explicitly. */
export function createBrowserStateStore({
  key,
  storage,
  fallback,
  normalize,
  preserveRequestFallback = false,
}) {
  const documents = new WeakMap();
  const unread = Symbol("unread storage");
  const unavailable = { value: fallback, ready: false };
  function context() {
    if (typeof window === "undefined" || !window.document) return null;
    let state = documents.get(window.document);
    if (!state) {
      state = {
        view: window,
        raw: unread,
        rawInvalid: false,
        readUnavailable: false,
        hasValue: false,
        serialized: JSON.stringify(fallback),
        snapshot: { value: fallback, ready: true },
        failedWrite: false,
        listeners: new Set(),
        stop: null,
      };
      documents.set(window.document, state);
    }
    return state;
  }
  function read(state) {
    let raw;
    try {
      raw = state.view[storage].getItem(key);
    } catch {
      // Preserve edits made in this document when browser storage is blocked.
      state.readUnavailable = true;
      return state.snapshot;
    }
    if (state.raw === unread && state.failedWrite) {
      // No persisted baseline was readable when this edit failed to save.
      // Remember the recovered baseline without discarding the unsaved edit.
      state.raw = raw;
      state.readUnavailable = false;
      return state.snapshot;
    }
    if (raw !== state.raw) {
      let value = fallback;
      state.rawInvalid = false;
      try {
        if (raw) value = normalize(JSON.parse(raw));
      } catch {
        state.rawInvalid = true;
      }
      state.raw = raw;
      state.readUnavailable = state.rawInvalid;
      if (state.rawInvalid && preserveRequestFallback) return state.snapshot;
      const serialized = JSON.stringify(value);
      if (serialized !== state.serialized)
        state.snapshot = { value, ready: true };
      state.serialized = serialized;
      state.failedWrite = false;
      state.hasValue = true;
    } else {
      state.readUnavailable = state.rawInvalid;
    }
    return state.snapshot;
  }
  const select = (state, requestFallback) =>
    preserveRequestFallback &&
    !state.hasValue &&
    state.readUnavailable &&
    requestFallback
      ? requestFallback
      : state.snapshot;
  const notify = (state) => {
    for (const listener of [...state.listeners]) listener();
  };
  return {
    getSnapshot(requestFallback) {
      const state = context();
      // Reading storage and selecting a request fallback never writes storage
      // or notifies subscribers during render, including an abandoned render.
      if (!state) return unavailable;
      read(state);
      return select(state, requestFallback);
    },
    subscribe(listener, requestFallback) {
      const state = context();
      if (!state) return () => {};
      read(state);
      const selected = select(state, requestFallback);
      const promoted = selected !== state.snapshot;
      if (promoted) {
        // A failed first read used to retain the provider's request seed. Keep
        // it for later visits only after commit; an abandoned render cannot
        // replace another request's fallback, and this never writes storage.
        state.snapshot = selected;
        state.serialized = JSON.stringify(selected.value);
        state.hasValue = true;
      }
      state.listeners.add(listener);
      if (!state.stop) {
        const sync = (event) => {
          if (event.key !== null && event.key !== key) return;
          try {
            if (event.storageArea && event.storageArea !== state.view[storage])
              return;
          } catch {}
          const previous = state.snapshot;
          if (read(state) !== previous) notify(state);
        };
        state.view.addEventListener("storage", sync);
        state.stop = () => state.view.removeEventListener("storage", sync);
      }
      // React's snapshot comparison handles a change between render and commit.
      if (promoted) notify(state);
      else listener();
      return () => {
        state.listeners.delete(listener);
        if (!state.listeners.size) {
          state.stop?.();
          state.stop = null;
        }
      };
    },
    set(action, requestFallback) {
      const state = context();
      if (!state) return false;
      read(state);
      const previous = select(state, requestFallback);
      const value = normalize(
        typeof action === "function" ? action(previous.value) : action,
      );
      const serialized = JSON.stringify(value);
      if (serialized === state.serialized && !state.failedWrite) return true;
      let persisted = true;
      try {
        if (serialized !== state.raw)
          state.view[storage].setItem(key, serialized);
        state.raw = serialized;
        state.rawInvalid = false;
        state.readUnavailable = false;
      } catch {
        // Keep the last observed raw value: reading it again must not overwrite
        // this newer in-memory edit. A genuinely changed stored value still wins.
        persisted = false;
      }
      state.failedWrite = !persisted;
      state.hasValue = true;
      if (serialized !== state.serialized) {
        state.serialized = serialized;
        state.snapshot = { value, ready: true };
        notify(state);
      }
      return persisted;
    },
  };
}

/** Hydration sees exactly its server request; client navigation reads storage. */
export function useBrowserState(store, serverValue) {
  const serverSnapshot = useMemo(
    () => ({ value: serverValue, ready: false }),
    [serverValue],
  );
  const client = useMemo(() => {
    const requestFallback = { value: serverValue, ready: true };
    return {
      getSnapshot: () => store.getSnapshot(requestFallback),
      subscribe: (listener) => store.subscribe(listener, requestFallback),
      set: (action) => store.set(action, requestFallback),
    };
  }, [store, serverValue]);
  const snapshot = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    () => serverSnapshot,
  );
  return [snapshot.value, client.set, snapshot.ready];
}
