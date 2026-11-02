import { useEffect, useState } from "react";
const cache = new Map();
// Values of promises that already resolved: a component asking again for a
// loaded resource gets it in the same render, without a loading frame.
const settled = new Map();
export async function json(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Données indisponibles (HTTP ${response.status})`);
  return response.json();
}
function forget(key) {
  cache.delete(key);
  settled.delete(key);
}
function start(key, loader) {
  if (!cache.has(key)) {
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (cache.get(key) === promise) settled.set(key, value);
        return value;
      });
    cache.set(key, promise);
  }
  return cache.get(key);
}
/** Starts (or reuses) a resource outside a component, e.g. a background load. */
export function primeResource(key, loader) {
  return start(key, loader).catch((error) => {
    forget(key);
    throw error;
  });
}
export function useResource(key, loader, enabled = true) {
  const [result, setResult] = useState({ key: null, loading: true });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    if (key.startsWith("season:") && key.endsWith(":full"))
      for (const old of cache.keys())
        if (old.startsWith("season:") && old.endsWith(":full") && old !== key)
          forget(old);
    if (settled.has(key)) {
      setResult({ key, value: settled.get(key), loading: false });
      return;
    }
    setResult({ key, loading: true });
    start(key, loader)
      .then((value) => {
        if (active) setResult({ key, value, loading: false });
      })
      .catch((error) => {
        forget(key);
        if (active) setResult({ key, error: error.message, loading: false });
      });
    return () => {
      active = false;
    };
  }, [key, attempt, enabled]);
  return {
    ...(enabled && result.key === key
      ? result
      : enabled && settled.has(key)
        ? { key, value: settled.get(key), loading: false }
        : { loading: true }),
    retry: () => {
      forget(key);
      retry((n) => n + 1);
    },
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
