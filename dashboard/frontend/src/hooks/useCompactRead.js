"use client";
import { useEffect, useRef } from "react";
import { useResource } from "../services/resources.js";
import {
  compactQuery,
  readCompact,
  readCompactPages,
} from "../services/compact-reads.js";
import { PUBLICATION_UNAVAILABLE } from "../services/publication-change.js";

/** Keep only the same scope's previous publication while its replacement loads. */
export default function useCompactRead(
  kind,
  params,
  {
    enabled = true,
    clock = "",
    refreshManifest,
    allPages = false,
    parallelPages = false,
  } = {},
) {
  const query = compactQuery(params),
    scope = `${kind}:${allPages}:${compactQuery({ ...params, generation: undefined })}`,
    // The same list whatever its page: a page refused for its publication even after
    // readCompact read it again keeps the list's last page on screen.
    list = `${kind}:${allPages}:${compactQuery({ ...params, generation: undefined, page: undefined })}`,
    resource = useResource(
      `${allPages ? "compact-cohort" : "compact"}:${kind}:${query}:${clock}`,
      ({ signal }) =>
        (allPages
          ? readCompactPages(kind, params, { signal, parallelPages }).then(
              (result) => ({
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
              }),
            )
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
      previous.current = { scope, list, value: resource.value };
  }, [enabled, resource.value, scope, list]);
  const unsettled =
    resource.error === PUBLICATION_UNAVAILABLE && previous.current?.list === list;
  if (
    enabled &&
    !resource.value &&
    (previous.current?.scope === scope || unsettled)
  ) {
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
