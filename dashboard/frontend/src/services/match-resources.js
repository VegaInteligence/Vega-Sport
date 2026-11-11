import { createResourceCache } from "./resource-cache.js";

const unknownPublications = new WeakMap();
const responseCaches = new WeakMap();
let unknownSequence = 0;

export function validateMatchPublication(manifest) {
  if (!manifest || typeof manifest !== "object")
    throw new Error(
      "La version du match est indisponible. Actualisez les données.",
    );
}

function publication(manifest) {
  if (!manifest || typeof manifest !== "object") return ["unavailable"];
  const storage = manifest?.storage || "legacy";
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
  configured || manifest?.storage === "aws-relational" ? "native" : "snapshot";

/** Stable across route clients, separate for every displayed publication. */
export function matchResourceKey(manifest, kind, subject, ...parameters) {
  const entity = typeof subject === "string" ? { id: subject } : subject;
  return `match:${kind}:${JSON.stringify([
    publication(manifest),
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
