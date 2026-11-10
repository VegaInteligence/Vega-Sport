"use client";
import { useEffect, useRef, useState } from "react";
import { applyLive, liveConfigured, missing, newer, readLive, subscribeLive } from "../services/live-client.js";

// The full state is read again every 30 s: a missed broadcast never lasts.
const REFRESH_MS = 30_000;
// After a gap, the full read is retried until it reaches the revision seen (CloudFront 2 s).
const RETRY_MS = 2_000,
  RETRIES = 3;

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** The live state of a match while `enabled` (services/live-client.js), else null. It only
 * listens while the tab is on screen (doc "Onglet visible uniquement"): a hidden tab
 * unsubscribes, and coming back reads the full state and subscribes again. */
export default function useLiveMatch(id, enabled) {
  const [state, setState] = useState(null);
  const current = useRef(null);
  const active = Boolean(enabled && id && liveConfigured());
  useEffect(() => {
    current.current = null;
    if (!active) {
      setState(null);
      return undefined;
    }
    let live = true,
      timer = null,
      retry = null,
      unsubscribe = () => {};
    const controller = new AbortController();
    const set = (next) => {
      current.current = next;
      setState(next);
    };
    const load = (atLeast = 0, attempt = 1) =>
      readLive(id, { signal: controller.signal })
        .then((body) => {
          if (!live) return;
          if (newer(current.current, body)) set(body);
          if (body && (body.revision ?? 0) < atLeast && attempt < RETRIES)
            retry = setTimeout(() => load(atLeast, attempt + 1), RETRY_MS);
        })
        .catch(() => {});
    const onMessage = (message) => {
      if (!live) return;
      if (missing(current.current, message)) load(message.revision);
      else set(applyLive(current.current, message));
    };
    const start = () => {
      if (timer) return;
      load();
      timer = setInterval(load, REFRESH_MS);
      unsubscribe = subscribeLive(id, onMessage);
    };
    const stop = () => {
      clearInterval(timer);
      clearTimeout(retry);
      timer = null;
      unsubscribe();
      unsubscribe = () => {};
    };
    const onVisibility = () => (visible() ? start() : stop());
    if (visible()) start();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      controller.abort();
      stop();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, active]);
  return state;
}
