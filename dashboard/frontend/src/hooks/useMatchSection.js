/**
 * One family of a match (/api/matches/{id}/{family}: lineups, events, players, stats,
 * momentum, heatmaps, advanced, advanced/players, advanced/network…), read through the
 * page's client and shared with the match sections that read it too: its `data`, or null.
 */
import { useFootball } from "./FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { matchReadSource, matchResourceKey } from "../services/match-resources.js";

export default function useMatchSection(match, section, enabled = true) {
  const f = useFootball();
  const resource = useResource(
    matchResourceKey(f.manifest || f.client, "section", match, section, matchReadSource(f.manifest, f.configured), 0),
    async ({ signal }) => {
      const entry = (await f.client.ensureEndpoint(match, section, false, { signal })) || f.client.payloads.get(`${match.id}:${section}`);
      if (entry?.error) throw new Error(entry.error);
      return entry;
    },
    Boolean(enabled && match?.id && f.statusKnown && f.client),
  );
  return { ...resource, data: resource.value?.data ?? null };
}
