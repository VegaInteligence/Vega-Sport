# Navigation and data-loading corrections — 7 November 2026

## Diagnosis and resulting behavior

The main dashboard was not the only source of perceived latency. The shared provider could block independent pages on a season load; actor profiles could wait for routing metadata, all profile extras and complete comparison cohorts; competition overviews drained fixture cursors; archives downloaded and merged two entire editions before displaying 50 rows. Navbar search had independent query and cache-identity problems. Those dependencies are now separated at the point where the user requests each view.

The frontend uses the capabilities advertised by the deployed backend. An advertised endpoint failure is an error; it does not silently start a more expensive full-season compatibility path. Older deployments without the corresponding capability retain their existing readers.

| Route or action | Initial read and rendering | Deferred work and integrity rules |
| --- | --- | --- |
| Main dashboard `/` | Existing compact dashboard path plus shared manifest/connectivity reads | Reuses the common publication cache; this change does not claim a new dashboard benchmark |
| Navbar search | Settled query after 150 ms; one bounded identity query, cached by query, edition and publication | Focusing the field does not download player partitions or cup catalogues on the bounded-search path; abandoned queries are cancelled |
| Player directory `/joueurs` | One server page with its exact global totals, filters and qualification rules | No complete cohort for ordinary table navigation; explicit export and analysis may request all aggregate pages |
| Player profile `/joueurs?id=…` | Direct actor summary, 100-match page budget; no routing-index request for a known edition | Full season totals remain complete. Shots, richer statistics and peer cohorts load on their relevant tab/section. Radar peers use the matching competition and complete position cohort; no percentile uses a partial directory page |
| Player career and match history | Selected season reads that season directly; reuses an already complete actor summary with the same edition, scope and publication | Complete multi-season career loads on visible intent. The separate `/joueurs/matchs` route does not require a provider-wide season load |
| Club directory `/clubs` | One fixed 24-row compact page with server-owned totals and facets; debounced filtering | Card measurement and browser resizing do not change the server page size or issue a second initial request. The older local reader retains adaptive layout pagination. Never derives total clubs or filter options from just the visible page |
| Club profile `/clubs?id=…` | Actor summary preserves exact team statistics and match history | Squad, shots, style/comparison cohorts and the below-fold facts/ranking panels start only when needed. A profile reached through a standings identity bypasses the season provider boot |
| Match directory `/matchs` | Existing bounded fixture/result page scoped to the selected period and publication | Further cursors require explicit pagination. Matchday metadata starts in parallel; modern relational reads do not initiate 24 match-detail probes |
| Match detail | Summary read with the route's abort signal and displayed-publication cache identity | Statistics, shots, timeline, context and standings also use publication-aware keys. Transient summary/family failures stop; 404/405/501 compatibility remains available for older native endpoints. A failed connectivity check cannot make an advertised relational backend bypass its native endpoint |
| Competitions `/competitions` | Independent catalogue/standings readers; overview requests at most 30 recent results and 30 upcoming fixtures | Full fixture drain is reserved for the explicit calendar/bracket or a genuinely missing native standings source. Result-derived fallback tables wait for the complete calendar |
| Archives `/archives` | An explicit valid edition on a bounded backend starts its 50-row page alongside the small edition indexes. Default-edition selection still waits for the indexes | Exact totals and whole-edition facets come from the server. A detail link skips unused edition indexes. Search is debounced; pagination never re-slices a server page. Only opening a goal-bearing match requests its goal array. A publication conflict replaces the requested page once; it never merges generations or downloads both full editions |
| Calendar `/calendrier` | Existing redirect to the bounded upcoming-match view | Preserves the requested edition/scope/week; no separate full-season boot |
| Player rankings `/classement-joueurs` | Independent ranking reader | Provider does not load a football season before mounting this route |
| Method `/methode` | Published manifest coverage counts | Missing counts remain unknown; no partial page is presented as a full database count |

## Shared loading and freshness

The shared resource cache coalesces reads and refreshes, reuses fresh values on navigation and bounds unobserved entries. A failed refresh retains the last valid value. Cancellation belongs to subscriptions: one component leaving cannot cancel a read another component still needs, while the last consumer leaving aborts an unretained request.

Actor keys distinguish summaries from richer `include` requests and include scope and publication. Fixture keys include publication, date window and selected scope. A stale match object in a client instance cannot replace a freshly published fixture. Routing metadata is reusable across equivalent manifest objects, and selected-season history avoids that metadata request entirely.

Archive filters use Next's supported native History API so typing does not request another server-component route for every character. Visible archive row links disable automatic detail-route prefetch. The catalogue digest token is carried between pagination/detail clicks. If a source is republished, one fresh list response replaces all rows, totals and facets together. A selected match's key contains its position within the source edition: a stale detail therefore offers a return to the updated list, and never retries the same key without its publication fence. Previously resolved data is retained during a publication refresh only for the same view and filters.

The implementation preserves the concurrent upstream UI changes at `cdc12d23ee26201049aed2a7b6bf7bfa61034f2d`, including the flattened shot map, overview radar, career sections and player-position summary. It does not redesign those components.

### Follow-up deployed after the runtime review

The match, club-directory and explicit-archive-edition corrections described above were merged through [PR #29](https://github.com/VegaInteligence/Vega-Sport/pull/29) into main revision `1fcb00e`. The production build succeeded, and [main CI 42349281748](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42349281748) passed all three jobs. Deployment `dpl_FXu91hMLMWioLCAaNLjkmZQhjFU1` was confirmed READY at **07:03:58 UTC** with the production alias `vegasport.vercel.app`.

Production now sets `NEXT_PUBLIC_API_ORIGIN` to `https://d317dq37z1tacb.cloudfront.net`. Public API reads can reach the existing AWS endpoint directly instead of traversing the same-origin Next relay and its four-request process queue. The Next-only visitor-country and image-generation helpers retain their local URLs. This removes an actual relay dependency; it does not quantify the latency saved or explain the separate slow direct-CloudFront HTTP samples.

A fresh browser load after deployment confirmed CloudFront URLs in the manifest preload and asset elements. Search and player navigation, the 24-club directory, an explicit archive edition and its version-bound goal detail, and the match shots tab all reached populated content without a visible application or CORS error. See the [direct-origin acceptance phase](FRONTEND_UI_ACCEPTANCE_20261107.md#direct-origin-deployment-acceptance) for the exact observations. This remains **before the production database cutover**; final post-cutover acceptance is separate.

The remaining match-tab failure waterfall used to request a complete match archive after a failed statistics, shots or events request. A 500/503 response, network failure, permission failure or cancellation now stops that family read. Only an explicitly unsupported legacy endpoint permits archive compatibility. An `aws-relational` manifest remains evidence of native serving even when `/api/status` fails. Pro readers retain their edition-token requirements and never enter the unversioned archive fallback.

Match-family responses are shared by actual fetcher, displayed publication, match, family and source mode. Recreating a route client can reuse the successful response while hydrating that client's own payload map. The response cache is bounded to 96 entries per fetcher with a five-minute freshness interval; the local payload map cannot bypass that lifetime. An explicit retry refreshes its response. A failed or abandoned request cannot hydrate another client, and a late response from an abandoned transport cannot replace its retry. An aborted refresh restores an existing successful value.

Cancellation is shared at both levels: multiple widgets can need one family, and different legacy families can need the same archive. Removing one subscriber leaves the others running; removing the last subscriber cancels the underlying fetch. Summary, family, context and standings callers forward their resource signal. Context reuse also requires an actual loaded season, so an empty catalogue cannot be cached as a complete pre-match analysis.

Pro resource keys use the displayed edition tokens. Stale or missing editions receive separate error identities during rendering, then fail inside the asynchronous reader before consulting successful shared data. Sources without a publication token remain isolated by their source object. This preserves controlled loading/error rendering during a publication change.

## Capacity-burst follow-up — implemented, deployment pending

The direct-origin runtime review identified a second bottleneck: simultaneous JSON and image requests could exhaust the backend's concurrency even when individual queries were fast. The browser now shares one public-read scheduler across its existing API readers. It admits **four reads at once**, with **at most two image downloads**, and chooses interactive data before queued images. Its backlog is bounded to 256 entries. The manifest's early HTML preload remains an independent browser preload; static branding, trophy art, external embeds and the Next-only country helper retain their existing delivery paths. This is protection against a burst from one document, not a global admission controller for multiple users or tabs.

Only GET/HEAD throttling is retried: HTTP 429, or HTTP 503 with a valid `Retry-After` or an explicit AWS throttling error type. There are at most two retries, at most two seconds per wait and four seconds of aggregate retry delay. A longer server-requested delay remains an error instead of being shortened. Backoff includes jitter and keeps the request's permit, preventing a rejected call from immediately unleashing the next queued request. Generic 503, 500, source errors and network exceptions acquire no new transport retry behavior. Existing page recovery cannot multiply an already handled throttle or bypass its longer backoff.

Queued requests honor their supplied abort signal before fetch starts. Active requests and backoff use the same signal. Publication-aware resource caches continue to own subscription cancellation: one subscriber leaving cannot cancel another subscriber's request, while the final subscriber can cancel the underlying work. No response generation, representation token or compatibility-fallback rules are changed.

The existing `Media` component and proxied stadium plans now start their image requests on visible intent through the same budget. Duplicate images share Blob bytes through the existing resource cache; each mounted image creates and revokes its own object URL. At most 64 blobs of up to 256 KiB each are retained between views, for at most **16 MiB** of retained image bytes, with a **60-second** freshness interval. Larger images within the publisher's existing 4 MiB bound are delivered but not retained in that cache. Native image decode errors and missing-source fallbacks remain available. An exhausted throttle shows the existing initials fallback instead of immediately requesting an alternate URL. The existing public asset route and final media CDN support anonymous CORS; no credentials or new external image hosts are introduced.

The focused regression command passed **107 tests**, including **18 new scheduler/image checks**, before deployment:

```bash
node --test tests/public-api-fetch.test.mjs tests/media-assets.test.mjs \
  tests/remote-match.test.mjs tests/aws-only-runtime.test.mjs \
  tests/bounded-reads.test.mjs tests/compact-reads.test.mjs \
  tests/resource-cache.test.mjs tests/resource-hook-identity.test.mjs \
  tests/archive-navigation.test.mjs tests/stadium-render.test.mjs
```

The two new test files are registered in the navigation CI step. They verify bounded mixed bursts, data priority, queued and active cancellation, shared subscribers, `Retry-After` seconds and dates, retry exhaustion, long-delay preservation, byte-cache eviction, object-URL cleanup, visible intent, image fallback and the absence of nested throttle retries. Post-deployment browser rendering and CloudWatch throttle measurements are still required; no zero-throttle production claim is made here.

## Verification

The initial expanded frontend regression run passed **102 tests**. Its coverage includes route policy, shared-cache cancellation and identity, bounded search, compact directory pagination, exact actor/cohort completeness, deferred radar/profile work, competition fallback correctness, archive pagination and selected-match reads, below-fold club requests, and the upstream shot-map/career/radar changes.

The subsequent match-cache/cancellation follow-up passed **64 focused client, cache, route and discipline checks**, plus **22 rendering checks**, **3 provider-profile rendering contracts** and **1 updated configured-service failure contract**. These are local results, not a claim about a later CI run. The focused command is:

```bash
node --test tests/remote-match.test.mjs tests/aws-only-runtime.test.mjs \
  tests/player-discipline.test.mjs tests/player-discipline-by-match.test.mjs \
  tests/resource-cache.test.mjs tests/navigation-performance.test.mjs \
  tests/resource-hook-identity.test.mjs
```

The added cases exercise 500/503/network failures, non-JSON 404/405/501 compatibility, a failed connectivity check on a relational source, independent cancellation across widgets and clients, cancellation while status is pending, late transport completion, explicit retry, warm client hydration, publication invalidation, fetcher isolation, cache expiry and stale Pro tokens. They extend existing CI test files.

The dedicated new archive and club loading gates are:

```bash
node --test tests/archive-navigation.test.mjs tests/club-overview-loading.test.mjs
```

They verify one bounded page, exact server page counts and all-edition facets, no second slicing, a single selected match's goals, abort propagation, bounded recovery from a source-version conflict, no full-edition fallback after an error, capability-gated compatibility, debounced query selection, client-only filter history and deferred club panels.

The Next.js 16.4.3 production build compiled successfully and generated all 14 static pages:

```bash
cd dashboard
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build frontend
```

The new gates are included in `.github/workflows/verify-ingestion.yml` alongside the existing navigation, bounded-read, compact-render, resource-cache, competition and player-render checks. `git diff --check` passed.

These are request-shape, correctness and production-build results. They do not establish a numerical production latency target. End-to-end AWS origin/CDN timings, publication rollout and full-data database acceptance must be reported from their separate deployment evidence.
