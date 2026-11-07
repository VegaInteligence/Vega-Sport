import { publicApiFetch } from "./public-api-fetch.js";
import { apiUrl } from "../data-url.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { createResourceCache } from "./resource-cache.js";
import { useResourceBootstrap } from "./resource-bootstrap.js";
import { acceptMediaPayload } from "./media-registry.js";
const cache = createResourceCache();
export async function json(url, options) {
  const response = await publicApiFetch(apiUrl(url), options);
  if (!response.ok)
    throw new Error(`Données indisponibles (HTTP ${response.status})`);
  const body = await response.json();
  acceptMediaPayload(url, body);
  return body;
}
/** Returns an already-resolved resource without initiating a request. */
export function cachedResource(key) {
  return cache.value(key);
}
/** Starts (or reuses) a resource outside a component, e.g. a background load. */
export function primeResource(key, loader) {
  return cache.load(key, loader, { retain: true });
}
export function useResource(key, loader, enabled = true) {
  const bootstrap = useResourceBootstrap();
  const seeded =
    bootstrap?.resources && Object.hasOwn(bootstrap.resources, key)
      ? {
          key,
          value: bootstrap.resources[key],
          loading: false,
          refreshing: false,
        }
      : null;
  const [result, setResult] = useState({ key: null, loading: true });
  const loaderRef = useRef({ key, loader });
  // Only committed renders may replace a key's loader. An old subscription or
  // callback must never store the next route's response under its previous key.
  useEffect(() => {
    loaderRef.current = { key, loader };
  }, [key, loader]);
  const revalidate = useCallback(() => {
    if (!enabled) return Promise.resolve(undefined);
    const read =
      loaderRef.current.key === key ? loaderRef.current.loader : loader;
    // Capture the function before the cache schedules its Promise microtask.
    return cache.load(key, read, { force: true });
  }, [key, enabled]);
  const retry = useCallback(() => revalidate().catch(() => {}), [revalidate]);
  useEffect(() => {
    if (!enabled) return;
    if (seeded) {
      cache.seed(key, seeded.value, { updatedAt: bootstrap.createdAt });
      acceptMediaPayload(
        key === "manifest" ? "/api/dashboard/manifest" : "",
        seeded.value,
      );
    }
    if (key.startsWith("season:") && key.endsWith(":full"))
      for (const old of cache.keys())
        if (old.startsWith("season:") && old.endsWith(":full") && old !== key)
          cache.forget(old);
    if (key.startsWith("compact-cohort:"))
      for (const old of cache.keys())
        if (old.startsWith("compact-cohort:") && old !== key) cache.forget(old);
    const unsubscribe = cache.subscribe(key, setResult);
    const refreshIfStale = () => {
      if (document.visibilityState === "hidden") return;
      const read =
        loaderRef.current.key === key ? loaderRef.current.loader : loader;
      cache.load(key, read).catch(() => {});
    };
    refreshIfStale();
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [key, enabled]);
  return {
    ...(enabled && result.key === key
      ? result
      : enabled && seeded
        ? (typeof window !== "undefined" &&
            cache.peekSince(key, bootstrap.createdAt)) ||
          seeded
        : enabled && cache.peek(key)
          ? cache.peek(key)
          : { loading: true }),
    retry,
    revalidate,
  };
}
export function download(name, body, type = "application/json") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
