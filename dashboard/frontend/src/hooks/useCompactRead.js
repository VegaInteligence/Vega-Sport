"use client";
import { useEffect, useRef } from "react";
import { useResource } from "../services/resources.js";
import {
  compactQuery,
  readCompact,
  readCompactPages,
} from "../services/compact-reads.js";

/** Keep only the same scope's previous publication while its replacement loads. */
export default function useCompactRead(
  kind,
  params,
  { enabled = true, clock = "", refreshManifest, allPages = false } = {},
) {
  const query = compactQuery(params),
    scope = `${kind}:${allPages}:${compactQuery({ ...params, generation: undefined })}`,
    resource = useResource(
      `${allPages ? "compact-cohort" : "compact"}:${kind}:${query}:${clock}`,
      ({ signal }) =>
        (allPages
          ? readCompactPages(kind, params, { signal }).then((result) => ({
              data: {
                [kind]: result.pages.flatMap((page) => page[kind]),
                teams: [
                  ...new Map(
                    result.pages
                      .flatMap((page) => page.teams || [])
                      .map((team) => [team.id, team]),
                  ).values(),
                ],
              },
              meta: result.meta,
              pagination: result.pagination,
            }))
          : readCompact(kind, params, { signal })
        ).catch((error) => {
          if (error.status === 409)
            void Promise.resolve()
              .then(() => refreshManifest?.())
              .catch(() => {});
          throw error;
        }),
      enabled,
    ),
    previous = useRef(null);
  useEffect(() => {
    if (enabled && resource.value)
      previous.current = { scope, value: resource.value };
  }, [enabled, resource.value, scope]);
  if (enabled && !resource.value && previous.current?.scope === scope) {
    return {
      ...resource,
      value: previous.current.value,
      loading: false,
      refreshing: resource.loading,
      refreshError: resource.error,
      error: undefined,
    };
  }
  return resource;
}
