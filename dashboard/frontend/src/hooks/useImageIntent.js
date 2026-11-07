"use client";
import { useCallback, useEffect, useState } from "react";

/** Prepare images one viewport ahead without starting optional data reads. */
export default function useImageIntent(key, enabled = true) {
  const [node, setNode] = useState(null);
  const [seen, setSeen] = useState(null);
  const ref = useCallback((element) => setNode(element), []);
  useEffect(() => {
    if (!enabled || !node || seen === key) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(key);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(key);
          observer.disconnect();
        }
      },
      { rootMargin: `${window.innerHeight}px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, key, enabled, seen]);
  return [ref, enabled && seen === key];
}
