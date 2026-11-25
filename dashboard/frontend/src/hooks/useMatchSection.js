/**
 * One family of a match (/api/matches/{id}/{family}: lineups, lineups/probable, events, players,
 * stats, momentum, heatmaps, advanced, advanced/players, advanced/network…), read through the
 * page's client and shared with the match sections that read it too: its `data`, or null.
 * `every` (ms): while set, the family is read again at that pace (the page hidden, it waits).
 */
import { useEffect, useRef } from "react";
import { useFootball } from "./FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { matchReadSource, matchResourceKey } from "../services/match-resources.js";

export default function useMatchSection(match, section, enabled = true, { every = 0 } = {}) {
  const f = useFootball();
  // A timed read goes past the client's kept answer (and its kept error, a 404 before the line-ups exist).
  const forced = useRef(false);
  const active = Boolean(enabled && match?.id && f.statusKnown && f.client);
  const resource = useResource(
    matchResourceKey(f.manifest || f.client, "section", match, section, matchReadSource(f.manifest, f.configured), 0),
    async ({ signal }) => {
      const force = forced.current;
      forced.current = false;
      const entry = (await f.client.ensureEndpoint(match, section, force, { signal })) || f.client.payloads.get(`${match.id}:${section}`);
      if (entry?.error) throw new Error(entry.error);
      return entry;
    },
    active,
  );
  const { revalidate } = resource;
  useEffect(() => {
    if (!every || !active) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      forced.current = true;
      revalidate().catch(() => {});
    }, every);
    return () => clearInterval(timer);
  }, [every, active, revalidate]);
  return { ...resource, data: resource.value?.data ?? null };
}
