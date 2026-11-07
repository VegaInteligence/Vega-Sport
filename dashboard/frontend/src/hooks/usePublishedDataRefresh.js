"use client";
import { useEffect, useRef } from "react";
import { parisDay } from "../services/fixtures.js";

/** One subscription in FootballProvider refreshes published data for every page. */
export default function usePublishedDataRefresh(
  refreshManifest,
  enabled = true,
) {
  const refresh = useRef(refreshManifest),
    state = useRef({
      lastCheck: Date.now(),
      day: parisDay(Date.now()),
      pending: false,
    });
  useEffect(() => {
    refresh.current = refreshManifest;
  }, [refreshManifest]);
  useEffect(() => {
    if (!enabled) return;
    const maxAge = 5 * 60_000,
      clockStep = 60_000;
    let stopped = false,
      timer;
    const arm = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      const remaining = maxAge - (Date.now() - state.current.lastCheck);
      // Hidden/pending requests may outlive the deadline. Check once a minute
      // in that case; never create an immediate timeout loop after a failure.
      const delay = remaining > 0 ? Math.min(clockStep, remaining) : clockStep;
      timer = window.setTimeout(check, delay);
    };
    const check = async () => {
      if (stopped) return;
      window.clearTimeout(timer);
      if (
        document.visibilityState !== "visible" ||
        state.current.pending ||
        typeof refresh.current !== "function"
      ) {
        arm();
        return;
      }
      const now = Date.now(),
        day = parisDay(now);
      if (state.current.day === day && now - state.current.lastCheck < maxAge) {
        arm();
        return;
      }
      state.current.pending = true;
      state.current.lastCheck = now;
      state.current.day = day;
      try {
        await refresh.current();
      } catch {
        // Keep the last valid publication. The resource owns the refresh error;
        // retry at the next freshness deadline without reloading the page.
      } finally {
        state.current.pending = false;
        arm();
      }
    };
    // One clock notices Paris midnight within a minute, shortening its last
    // tick to the freshness deadline even after a focus between two ticks.
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [enabled]);
}
