"use client";
import { useResource } from "../services/resources.js";
import { actorReadKey } from "../services/actor-reads.js";
import {
  mergeActorPages,
  readCompactPages,
} from "../services/compact-reads.js";

/** Heavy actor details have their own resource; they never replace route boot. */
export default function useActorRead(
  manifest,
  kind,
  params,
  { enabled = true, refreshManifest } = {},
) {
  return useResource(
    actorReadKey(kind, params),
    ({ signal }) =>
      readCompactPages(kind, params, { signal })
        .then((result) => {
          const data = mergeActorPages(result, manifest, params.season);
          data.meta.actorScope = params.leagues;
          return data;
        })
        .catch((error) => {
          if (error.status === 409)
            void Promise.resolve(refreshManifest?.()).catch(() => {});
          throw error;
        }),
    enabled,
  );
}
