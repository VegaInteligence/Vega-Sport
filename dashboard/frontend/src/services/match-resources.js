import { createResourceCache } from "./resource-cache.js";

const unknownPublications = new WeakMap();
const responseCaches = new WeakMap();
let unknownSequence = 0;

function editionsFor(manifest, entity) {
  const league = entity?.leagueId || entity?.league?.id;
  return (manifest.editions || []).filter(
    (item) =>
      (!league || item.leagueId === league) &&
      (!entity?.season || item.season === entity.season),
  );
}

function publicationIssue(manifest, entity) {
  if (!manifest || typeof manifest !== "object") return "unavailable";
  if (manifest.storage !== "aws-orion-pro") return null;
  const editions = editionsFor(manifest, entity);
  if (!editions.length) return "missing-edition";
  if (
    entity?.representationToken &&
    !editions.some(
      (item) => item.representationToken === entity.representationToken,
    )
  )
    return `stale-token:${entity.representationToken}`;
  return null;
}

export function validateMatchPublication(manifest, entity) {
  if (publicationIssue(manifest, entity))
    throw new Error(
      "La version du match est indisponible. Actualisez les données.",
    );
}

function publication(manifest, entity) {
  if (!manifest || typeof manifest !== "object") return ["unavailable"];
  const storage = manifest?.storage || "legacy";
  if (storage === "aws-orion-pro") {
    const editions = editionsFor(manifest, entity);
    // Resolve tokens from the displayed manifest, never a stale match object.
    return [
      storage,
      (editions.length ? editions : manifest.editions || [])
        .map((item) => [item.leagueId, item.season, item.representationToken])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      publicationIssue(manifest, entity),
    ];
  }
  const version =
    manifest?.publicationVersion ||
    manifest?.scouting?.sourceDigest ||
    manifest?.retrievedAt;
  if (version) return [storage, String(version)];
  // A source without a publication token cannot share responses across newly
  // fetched manifests. Keep those reads scoped to the source object itself.
  if (!unknownPublications.has(manifest))
    unknownPublications.set(manifest, ++unknownSequence);
  return [storage, "unversioned", unknownPublications.get(manifest)];
}

export const matchReadSource = (manifest, configured) =>
  configured ||
  manifest?.storage === "aws-relational" ||
  manifest?.storage === "aws-orion-pro"
    ? "native"
    : "snapshot";

/** Stable across route clients, separate for every displayed publication. */
export function matchResourceKey(manifest, kind, subject, ...parameters) {
  const entity = typeof subject === "string" ? { id: subject } : subject;
  return `match:${kind}:${JSON.stringify([
    publication(manifest, entity),
    entity?.id || "",
    ...parameters,
  ])}`;
}

/** Fetcher ownership prevents tests, transports or backends sharing responses. */
export function readMatchResource(
  fetcher,
  key,
  loader,
  { signal, force = false } = {},
) {
  if (!responseCaches.has(fetcher))
    responseCaches.set(fetcher, createResourceCache({ maxEntries: 96 }));
  return responseCaches.get(fetcher).read(key, loader, {
    signal,
    ...(force ? { age: 0 } : {}),
  });
}
