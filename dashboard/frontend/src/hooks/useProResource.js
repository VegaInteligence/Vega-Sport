"use client";
import { useEffect, useRef, useState } from "react";

// Retained values belong to ProMatchClient's bounded cache. This hook owns
// only the mounted view's result, never a second global response cache.
export function useProResource(key, loader, enabled = true) {
  const latest = useRef(loader);
  latest.current = loader;
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = latest.current;
    setResult({ key, loading: true });
    Promise.resolve()
      .then(load)
      .then(
        (value) => active && setResult({ key, value, loading: false }),
        (error) =>
          active &&
          setResult({
            key,
            error: error.message || "Données indisponibles.",
            loading: false,
          }),
      );
    return () => {
      active = false;
    };
  }, [key, enabled, attempt]);
  return {
    ...(enabled && result?.key === key ? result : { loading: true }),
    retry: () => setAttempt((value) => value + 1),
  };
}
