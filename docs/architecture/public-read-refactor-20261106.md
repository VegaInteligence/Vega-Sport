# Public reads and freshness — first implementation stage

The November 6 audit found exhaustive season reads on list/search paths, `no-store` responses on the active relational API, stale weekly periods, and source dates inherited from old partition metadata. Production serves `statarena_app` with the Pro reader disabled. This change improves that active path without changing the database schema or enabling Pro.

## Behavior

- `/api/search` reads identities and limited season context, returning at most six players and four clubs. The browser waits for two characters and a short debounce, then cancels superseded requests. Competition suggestions use the small existing catalogue.
- The match directory requests one page of 30 fixtures. Results sort newest first; upcoming matches sort oldest first. Cursors retain their publication fence; a changed generation requires a reset.
- The manifest advertises capabilities. A frontend deployed ahead of the backend continues using the compatible paths. Legacy search starts only after typed intent, never on an empty hover or focus.
- Mutable public responses use short shared freshness: 15 seconds for the manifest, 30 seconds for partitions, fixtures, scouting and search. Browser revalidation, ETags, error `no-store` and generation checks remain. There is no long-lived `immutable` promise for these routes.
- Partition requests can carry `v=<sourceDigest>`. The server refuses a different committed digest, including for the first page and conditional requests. The client also checks the expected digest before populating a cache entry.
- Pending publication jobs do not disable caching of committed rows. The partition writer commits facts, digest and generation together. Existing empty-alias retirement now advances generation within the same transaction when it actually changes the manifest; its retention criteria are unchanged.
- The client cache has a lifetime, bounded retained entries, shared in-flight requests, cancellation where the loader supports it, and refresh errors that preserve valid values. A loader remains associated with the key under which it was requested.
- One provider subscription checks publication freshness while visible and when the user returns. Weekly widgets use the civil Monday–Sunday week in Europe/Paris. They expire even if no new match arrives. Archives show an explicit historical period. Matches still in progress cannot supply weekly winners.
- Missing or partially covered expected goals remain unknown. They cannot become artificial zeroes in finishing rankings.
- Partition coverage and match date bounds are recomputed from merged facts. Source observation dates remain separate from publication time. Reused archives and failed requests cannot be represented as a newly observed successful source.
- A source timestamp change alone uses a metadata update when all facts, identities, metric definitions and list orders are proven unchanged. A receipt in the existing `worker_inputs` table binds that proof to the committed full digest. Public digests keep their historical SHA256 format. Missing or inconsistent proof takes the conservative full publication path.

## Rollout and verification

Deploy the backend before the frontend to activate the new capabilities. This branch does not deploy either component, dispatch ingestion, change AWS quotas, or modify production data. Production rollout must check response cache headers, publication fences, search results, first-page request counts and real navigation latency.

The `Verify ingestion` workflow includes `tests/run_public_read_contracts.py`. It creates a disposable loopback PostgreSQL instance, runs rollback-only publication checks and the actual search/pagination SQL, then stops it. Unit and rendering tests cover week rollover, Paris daylight-saving transitions, archive labels, missing metrics, request cancellation, cache races and version changes. Production credentials are not used.

The native PostgreSQL tests cannot run in the managed root-only local container: the image maps only UID 0, and PostgreSQL correctly refuses to run as root. The hosted CI runner executes this gate as its ordinary non-root user. A skipped local integration test is not a successful SQL test.

## Remaining work

The home, player rankings, club comparisons and several analytical views still consume complete statistical cohorts. Do not truncate those reads and compute season rankings on one page. Add compact server summaries and exact aggregates, then move their filters, sorting and pagination into SQL. The large season loader still needs cancellation propagation through its whole request chain.

The publication failures observed on November 6 include a statement timeout while rebuilding appearances and a later closed connection during source preparation. This change prevents a cleanup error from hiding the original failure; it does not establish that scheduled collection or publication is operational. Verify the scheduled workflow and a complete scheduled collection-to-publication cycle. Reducing the number of partitions per batch alone does not bound work inside a full-season partition rebuild.

The schema audit identifies 295 tables and 52 views, with a conditional target of roughly 40 application tables plus authentication. Consolidation must proceed by family, with field/state/provenance mapping, parity checks, reversible reader changes and explicit approval before destructive retirement. No `DROP`, database migration or schema consolidation is included here.
