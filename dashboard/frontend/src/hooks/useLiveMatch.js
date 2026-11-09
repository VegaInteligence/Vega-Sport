"use client";
import { useEffect, useState } from "react";
import { applyLive, liveConfigured, readLive, subscribeLive } from "../services/live-client.js";

// The full state is read again every 30 s: a missed broadcast never lasts.
const REFRESH_MS = 30_000;

/** The live state of a match while `enabled` (services/live-client.js), else null. */
export default function useLiveMatch(id, enabled) {
  const [state, setState] = useState(null);
  const active = Boolean(enabled && id && liveConfigured());
  useEffect(() => {
    if (!active) {
      setState(null);
      return undefined;
    }
    let live = true;
    const controller = new AbortController();
    const load = () =>
      readLive(id, { signal: controller.signal })
        .then((body) => live && setState(body))
        .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    const unsubscribe = subscribeLive(id, (change) => live && setState((previous) => applyLive(previous, change)));
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
      unsubscribe();
    };
  }, [id, active]);
  return state;
}
