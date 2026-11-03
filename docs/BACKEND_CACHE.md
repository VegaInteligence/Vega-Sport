# Backend/cache P0

Implemented from the 3 November 2026 StatArena audit, on the existing Neon + Vercel runtime. Verification and rerun instructions: [RESULTS.md](verification/backend-cache-20261103/RESULTS.md). No schema migration, production deployment, data rewrite or ingestion change belongs to this delivery.

## Read contract

`objectMeta()` reads only path, encoded size, SHA-256, type, and an inline-presence flag. `dataJson()` checks its SHA-keyed parsed cache; `objectBody()` checks its SHA-keyed byte cache. A miss reads SQL bytes with both path and SHA pinned, or uses S3 directly when metadata says the body is external. Size and SHA checks remain mandatory.

The entirely cold inline path now takes two SQL queries instead of one. An entirely cold S3 path still takes one SQL metadata query and one object request. A metadata refresh for a retained content version transfers no body. These are measured read-path properties, not claims about production latency or billed wire egress.

If inline publication changes the version between metadata and body, the caller retries once with fresh metadata. File responses restart conditionals and ETag selection; JSON loads restart their parsed-cache lookup. A second race fails closed with 503/no-store. Generic storage, authentication and integrity errors are not automatically retried by this loop. Mutable S3 keys still have the publication race identified in A08; the hash check deliberately rejects incoherent bytes until immutable publication is implemented.

File GET validators support strong/weak lists and standalone `*`. Missing files stay 404. Matching validators and HEAD use metadata without body retrieval. Projection HEAD reads existence without its JSON body. Referenced archive/profile/compatibility HEAD still performs the resolution needed to preserve GET status and fallback semantics, but skips final representation serialization. Full metadata-only dynamic HEAD requires future trustworthy response projections; no dynamic ETag or size is invented.

The common handler strips payloads from every HEAD result, including errors. Resource-error envelopes and absent statistics retain their existing values/statuses; `null`, absent data and zero remain distinct.

## HTTP and application-cache policy

Mutable responses use browser `max-age=0, must-revalidate`. CDN TTL is explicit in `s-maxage`; SWR is confined to `CDN-Cache-Control` and `Vercel-CDN-Cache-Control`. The local Next proxy forwards these headers. Production Next remains dynamic; this change does not turn every API route into an ISR page.

| Response family | CDN fresh / SWR | Maximum additional HTTP/application-cache lag after a completed publication |
| --- | --- | --- |
| Exposed content-versioned files | 1 year / none; browser immutable | Same public path must never change bytes |
| Manifest aliases / ordinary mutable files | 60 s / 30 s | 120 s including 30 s metadata |
| Mutable `/api/assets?url=…` alias | 60 s / 30 s | Up to 180 s including 60 s lookup and 30 s metadata |
| League identities / catalog | 900 s / 30 s | Up to 990 s including resource and metadata caches |
| Team / player identity | 3,600 s / 30 s | Up to 3,690 s (61 min 30 s), including resource and metadata caches |
| League/date fixture lists | 180 s or 120 s / 30 s | Conservatively up to 270 s or 210 s with saved-resource fallback |
| Match summary / detailed families / lineups | Existing declarations: 120 s / 300 s / 60 s; SWR 30 s | TTL + up to 90 s across resource/metadata/SWR |
| Archive routes | 60 s / 30 s | Conservatively 150 s; no blanket one-hour historical assumption |
| SQL projections | 300 s / 60 s | 360 s; no application projection-body cache |
| Health, settings, status, validation, non-success and transient errors | no-store at all HTTP cache layers | No public negative-cache guarantee |

These conservative bounds describe a new HTTP retrieval under normal operation, not end-to-end user-data freshness. Add provider collection delay, publication delay, any already loaded client state and caches outside this app. Staleness beyond SWR on dependency failure is not promised. The identity TTL increase is deliberate and bounded; it does delay correction visibility compared with the former accidental 60 s TTL. There is no immediate CDN purge/invalidation mechanism in P0, and no live-data freshness promise.

The alias URL determines policy: an internal hashed image path does not make `/api/assets?url=…` immutable. Hashed gzip filenames may describe canonical uncompressed content, whereas the HTTP ETag describes the stored encoded bytes.

Local cache TTLs remain 30 s for metadata/resources and 60 s for asset lookups; byte/parsed content is retained for 15 minutes by SHA. A too-large value is returned to the caller without evicting retained small entries or retaining itself. Pending requests still coalesce and failures are not cached. The logical byte budget is not a heap or peak-allocation guarantee.

## Observability

`STATARENA_METRICS_SAMPLE_RATE` defaults to `0.01`; `0` disables sampled request instrumentation and `1` samples all requests. `STATARENA_SERVER_TIMING=1` adds origin/SQL/pool timings only to sampled responses. Public CDN responses can replay origin timing headers; they never establish current HIT/MISS or visitor latency.

Each sampled `statarena.request` JSON log includes normalized route, method, status, deployment, region, process age, total origin duration and numeric stage counters. Up to four SHA object versions are included when object metadata is consulted; resource-cache hits can have no observed object version. No extra revision query is made solely for instrumentation. Process age is not evidence that the database is warm.

Metrics distinguish SQL count/rows/execution, pool acquisition (including connection setup), exact returned bytea length, estimated metadata size, rows containing JSON bodies, S3 bytes/time/errors, gzip/parse/serialization/cache-sizing duration, payload bytes, and named cache hit/miss/expiry/coalescing/eviction/rejection/invalidation. SQL JSON bodies are not reserialized merely to estimate their size. Payload bytes precede HTTP transport compression; a `.gz` file is already an encoded payload. Partial failed S3 streams can transfer bytes that are not included in the successfully consumed-body counter. Neither counter is a replacement for Neon/Vercel billed-transfer measurements.

No raw query text/parameters, asset URLs, entity IDs, database URLs, credentials or response bodies enter these structured logs. There is no public metrics endpoint. Inspect/export `statarena.request` logs over a representative traffic window after deployment, preserving raw logs and separating health probes/tests from human navigation. Match normalized route, data versions, deployment and traffic mix when comparing source bytes and invocations; this delivery does not claim production p95/p99 or cache HIT rates.

## Remaining audit deliveries

- A04/A09: batch resource references and materialize small match/player/season projections; preserve archived/newer-response precedence and missing-data semantics. This lot deliberately retains the current 13-resource match assembly.
- A05: add a paginated interactive contract (50 default / 100 ceiling to validate), deterministic cursor ordering/null dates, response budgets and lazy heavy tabs; migrate consumers before retiring full-season responses. The existing 20,000-row limit and unused 2 MiB declaration are not fixed by P0.
- A07/A11: use measured document/CPU sizes to reduce granularity and bound concurrent heavy loads. Synchronous parse/gzip and in-flight allocation limits remain to address. Keep the pool limit at three until measurements justify a change.
- A08: publish immutable object versions, then pointers/revision, then targeted authenticated/retryable invalidation with retained old versions. No global purge or deletion of data is introduced here.
- A10/P2: assess query plans on the actual paginated workload before adding indexes, and evaluate shared cache only for small reusable summaries after measurements. No provider migration or compute upgrade is required by these P0 corrections.

Suggested commit: `fix: avoid redundant Neon reads and apply backend cache policy`.
