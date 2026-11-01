import { useEffect, useState } from "react";
const cache = new Map();
export async function json(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Données indisponibles (HTTP ${response.status})`);
  return response.json();
}
export function useResource(key, loader, enabled = true) {
  const [result, setResult] = useState({ key: null, loading: true });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setResult({ key, loading: true });
    if (key.startsWith("season:") && key.endsWith(":full"))
      for (const old of cache.keys())
        if (old.startsWith("season:") && old.endsWith(":full") && old !== key)
          cache.delete(old);
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(loader));
    cache
      .get(key)
      .then((value) => {
        if (active) setResult({ key, value, loading: false });
      })
      .catch((error) => {
        cache.delete(key);
        if (active) setResult({ key, error: error.message, loading: false });
      });
    return () => {
      active = false;
    };
  }, [key, attempt, enabled]);
  return {
    ...(enabled && result.key === key ? result : { loading: true }),
    retry: () => {
      cache.delete(key);
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
