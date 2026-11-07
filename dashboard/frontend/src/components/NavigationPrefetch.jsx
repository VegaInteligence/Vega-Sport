"use client";
import { useEffect } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  actorIntent,
  createIntentScheduler,
  prefetchActor,
} from "../services/navigation-prefetch.js";

export default function NavigationPrefetch() {
  const football = useFootball();
  useEffect(() => {
    const connection = navigator.connection;
    if (
      connection?.saveData ||
      /(^|-)2g$/.test(connection?.effectiveType || "")
    )
      return;
    const scheduler = createIntentScheduler(prefetchActor);
    const timers = new Map();
    const get = (event) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return null;
      const link = event.target?.closest?.("a[href]");
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return null;
      const intent = actorIntent(link.href, location.href, football);
      return intent && { link, intent };
    };
    const cancel = (link) => {
      const entry = timers.get(link);
      if (!entry) return;
      clearTimeout(entry.timer);
      scheduler.cancel(entry.intent.key);
      timers.delete(link);
    };
    const enter = (event) => {
      const result = get(event);
      if (!result || result.link.contains(event.relatedTarget)) return;
      cancel(result.link);
      const add = () => scheduler.add(result.intent);
      if (event.type === "focusin") {
        timers.set(result.link, { intent: result.intent });
        add();
      } else
        timers.set(result.link, {
          intent: result.intent,
          timer: setTimeout(add, 100),
        });
    };
    const leave = (event) => {
      const link = event.target?.closest?.("a[href]");
      if (link && !link.contains(event.relatedTarget)) cancel(link);
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    return () => {
      for (const item of timers.values()) clearTimeout(item.timer);
      scheduler.stop();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
    };
  }, [football]);
  return null;
}
