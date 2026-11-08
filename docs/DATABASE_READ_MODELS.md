# Source facts and computed read models

The database separates observed source data from rebuildable results used by the website. A provider's rating or official standing is an observation in this model, even if the provider computed it. Application-derived aggregates never replace those observations.

An ordinary PostgreSQL view names a query and runs its underlying work when read. A materialized view stores its result. This application also uses publisher-maintained projection tables, which allow one changed competition/season or match to be refreshed atomically instead of rebuilding a global materialized view. These tables serve the same precomputation purpose, with explicit version and coverage checks.

| Layer | Current examples | Purpose and update contract |
| --- | --- | --- |
| Source records and typed facts | `matches`, `fixtures`, `appearances`, `shots`, `team_statistics`, `match_coverage`; normalized provider record stores | Preserve original values, identities, missingness, source digests and collection clocks. Publication commits coherent source changes. |
| Ordinary compatibility views | Typed projections over consolidated catalog, support and detail records | Expose the established relational shape; their presence does not imply precomputed results. |
| Official standings | Normalized provider standings exposed by the support reader | Preserve supplied points, ranks, groups and provenance, including rules that cannot be inferred from scores. |
| Player read model | `player_season_rollups` (025/037) | Rebuild the affected season/competition in its publication transaction; source-digest and ambiguity checks select the fast path or the original facts. |
| Archive read model | `archive_read_editions`, `archive_read_matches` (032) | Serve bounded historical reads with their own source fence. |
| Home read model | `home_projection` (035) | Prepare common scopes, validate generation, watermarks and exact time boundaries, and use the ordinary query after expiry or invalidation. |

A reusable result is keyed by competition and season (plus team/player/match as needed). Ligue1 does not need a separate database object from every other league. Official standings remain distinct from the explicitly labelled standings derived from available results.

New read models require an existing consumer and evidence of repeated expensive work. Assess the current SQL plan, rows and buffers read, the cost of refreshing and storing the result, and equality with the existing output. A bounded indexed query remains appropriate when it avoids the expensive work without adding another stored copy.

The 8 November 2026 RDS investigation illustrates this rule: the club directory took about 12ms of SQL, while a club analysis read took about 2.36s. Its initial identity/count/result aggregation took about 69ms. The dominant cost was a scan of roughly 1.25 million shots across seasons for a small selection of matches. The adopted reader limits shot access by match using the existing index, and only retrieves statistic keys consumed by its calculations. No additional club aggregate table was adopted: it would have accelerated the already-cheap part of that query. The selected results, score validity, own-goal exclusion, minute bins and missing-statistic rules remain unchanged.

The refresh workflow keeps source publication and derived-cache maintenance observable separately. When publication fails, an available cache worker may still refresh the latest committed snapshot; the publication failure remains a failure. Schema-only runs do not calculate home data, a failed explicit home installation does not refresh, and cancelled or unauthenticated runs do not attempt database work. The refresh receipt records the actual generation and validity period. Scheduled execution is not a guarantee of five-minute freshness.

Readers may use a stored result only when its scope, algorithm and source revision are valid. Empty-but-complete data must remain distinguishable from an absent projection, and a valid null must remain unknown rather than becoming zero. Corrections, removals and publication races must invalidate or atomically replace affected results. The existing facts provide the correctness fallback.

References: [PostgreSQL materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html), [refresh and concurrent-read requirements](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html), and the repository's sealed migrations and relational read tests.
