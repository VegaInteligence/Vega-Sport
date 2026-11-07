import { actorReadKey, actorReadParams } from "./actor-reads.js";
import {
  compactGeneration,
  compactScope,
  directoryScopeIds,
  mergeActorPages,
  readCompactPages,
  supportsCompactRead,
} from "./compact-reads.js";
import { playerLeagueIds } from "./player-leaderboard.js";
import { cachedResource, primeResource } from "./resources.js";

/** Build the exact actor key used by FootballProvider for a destination. */
export function actorIntent(href, currentHref, football) {
  if (
    !football?.manifest ||
    football.pro ||
    football.manifest.capabilities?.actorSummary !== true
  )
    return null;
  let url, current;
  try {
    url = new URL(href, currentHref);
    current = new URL(currentHref);
  } catch {
    return null;
  }
  if (
    url.origin !== current.origin ||
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  if (
    (url.searchParams.get("v") || "") !== (current.searchParams.get("v") || "")
  )
    return null;
  const kind = /^\/joueurs\/?$/.test(url.pathname)
    ? "player"
    : /^\/clubs\/?$/.test(url.pathname)
      ? "club"
      : null;
  const id = url.searchParams.get("id");
  if (
    !kind ||
    !new RegExp(`^${kind === "player" ? "p" : "t"}_[A-Za-z0-9]{6}$`).test(
      id || "",
    ) ||
    !supportsCompactRead(football.manifest, kind)
  )
    return null;
  const season = url.searchParams.get("season") || football.season;
  if (
    !season ||
    !football.manifest.seasons?.some((entry) => entry.id === season) ||
    !compactGeneration(football.manifest)
  )
    return null;
  const requested = url.searchParams.get("focus");
  const focus =
    requested === "all" || requested === "europe"
      ? requested
      : football.preferences?.focus;
  if (kind === "player" && focus !== "all" && focus !== "europe") return null;
  const filters = {
    league: url.searchParams.get("league") || "all",
    leagues: playerLeagueIds(url.searchParams.get("leagues") || ""),
  };
  const leagues =
    kind === "club"
      ? "all"
      : compactScope(
          directoryScopeIds(football.manifest, season, focus, filters),
        );
  const params = actorReadParams(football.manifest, kind, {
    id,
    season,
    leagues,
  });
  return {
    kind,
    params,
    key: actorReadKey(kind, params),
    manifest: football.manifest,
  };
}

export function prefetchActor(
  intent,
  {
    prime = primeResource,
    cached = cachedResource,
    read = readCompactPages,
    merge = mergeActorPages,
  } = {},
) {
  if (cached(intent.key) !== undefined) return Promise.resolve();
  return prime(intent.key, async ({ signal } = {}) => {
    const result = await read(intent.kind, intent.params, { signal });
    if (
      String(result.meta?.generation || "") !== String(intent.params.generation)
    )
      throw new Error("Publication modifiée.");
    const expected =
      intent.params[intent.kind === "player" ? "player" : "team"];
    if (
      !result.pages?.length ||
      result.pages.some(
        (page) =>
          page.meta?.actor?.kind !== intent.kind ||
          page.meta?.actor?.id !== expected,
      )
    )
      throw new Error("Identit\u00e9 incoh\u00e9rente.");
    const data = merge(result, intent.manifest, intent.params.season);
    data.meta.actorScope = intent.params.leagues;
    return data;
  });
}

/** Two retained jobs maximum; at most two unstarted intents may wait. */
export function createIntentScheduler(
  start,
  { limit = 2, maxQueued = 2 } = {},
) {
  let active = 0,
    stopped = false;
  const queued = new Map(),
    running = new Set();
  const pump = () => {
    while (!stopped && active < limit && queued.size) {
      const [key, item] = queued.entries().next().value;
      queued.delete(key);
      running.add(key);
      active++;
      Promise.resolve()
        .then(() => start(item))
        .catch(() => {})
        .finally(() => {
          active--;
          running.delete(key);
          pump();
        });
    }
  };
  return {
    add(item) {
      if (
        stopped ||
        queued.has(item.key) ||
        running.has(item.key) ||
        queued.size >= maxQueued
      )
        return;
      queued.set(item.key, item);
      pump();
    },
    cancel(key) {
      queued.delete(key);
    },
    stop() {
      stopped = true;
      queued.clear();
    },
    pending() {
      return { active, queued: queued.size };
    },
  };
}
