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
| Club directory `/clubs` | One compact page with server-owned totals and facets; debounced filtering | Never derives total clubs or filter options from just the visible page |
| Club profile `/clubs?id=…` | Actor summary preserves exact team statistics and match history | Squad, shots, style/comparison cohorts and the below-fold facts/ranking panels start only when needed. A profile reached through a standings identity bypasses the season provider boot |
| Match directory `/matchs` | Existing bounded fixture/result page scoped to the selected period and publication | Further cursors require explicit pagination. Matchday metadata starts in parallel; modern relational reads do not initiate 24 match-detail probes |
| Match detail | Summary read with the route's abort signal | Transient failures stop. Full archive/native compatibility fallbacks are limited to missing or unsupported older summary routes; individual heavy detail sections retain separate readers |
| Competitions `/competitions` | Independent catalogue/standings readers; overview requests at most 30 recent results and 30 upcoming fixtures | Full fixture drain is reserved for the explicit calendar/bracket or a genuinely missing native standings source. Result-derived fallback tables wait for the complete calendar |
| Archives `/archives` | Two small edition indexes, then one merged 50-row server page with exact totals and whole-edition facets | Search is debounced. Pagination never re-slices a server page. Only opening a goal-bearing match requests its goal array. A publication conflict replaces the complete requested page once; it never merges generations or downloads both full editions |
| Calendar `/calendrier` | Existing redirect to the bounded upcoming-match view | Preserves the requested edition/scope/week; no separate full-season boot |
| Player rankings `/classement-joueurs` | Independent ranking reader | Provider does not load a football season before mounting this route |
| Method `/methode` | Published manifest coverage counts | Missing counts remain unknown; no partial page is presented as a full database count |

## Shared loading and freshness

The shared resource cache coalesces reads and refreshes, reuses fresh values on navigation and bounds unobserved entries. A failed refresh retains the last valid value. Cancellation belongs to subscriptions: one component leaving cannot cancel a read another component still needs, while the last consumer leaving aborts an unretained request.

Actor keys distinguish summaries from richer `include` requests and include scope and publication. Fixture keys include publication, date window and selected scope. A stale match object in a client instance cannot replace a freshly published fixture. Routing metadata is reusable across equivalent manifest objects, and selected-season history avoids that metadata request entirely.

Archive filters use Next's supported native History API so typing does not request another server-component route for every character. Visible archive row links disable automatic detail-route prefetch. The catalogue digest token is carried between pagination/detail clicks. If a source is republished, one fresh list response replaces all rows, totals and facets together. A selected match's key contains its position within the source edition: a stale detail therefore offers a return to the updated list, and never retries the same key without its publication fence. Previously resolved data is retained during a publication refresh only for the same view and filters.

The implementation preserves the concurrent upstream UI changes at `cdc12d23ee26201049aed2a7b6bf7bfa61034f2d`, including the flattened shot map, overview radar, career sections and player-position summary. It does not redesign those components.

## Verification

The expanded frontend regression run passed **102 tests**. Its coverage includes route policy, shared-cache cancellation and identity, bounded search, compact directory pagination, exact actor/cohort completeness, deferred radar/profile work, competition fallback correctness, archive pagination and selected-match reads, below-fold club requests, and the upstream shot-map/career/radar changes.

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
