# Home presentation payload — 7 November 2026

## Observed default and budget

The actual `prepareHomeBootstrap` function was run for a new visitor: no saved preferences, research list or URL filter. It selected season `2026/2027`, the seven European leagues and three UEFA competitions, generation 899, and `media=1`. The public response was **179,114 uncompressed bytes**, including **145,952 bytes of card data** and **32,879 bytes of resolved image mappings**. Its gzip Content-Length was 35,261 bytes. Image files themselves are separate. The manifest was another 193,904 uncompressed bytes.

This exceeded the initial plan's indicative 100,000-byte card budget even without the image mappings. A subsequent public read at generation 906 had the same representation size and supplied the comparison sample. These are specific default-scope observations, not maximum sizes across every season and personal selection.

## Representation change

`compactHomePresentation` copies only fields consumed by the overview cards, their alternate tabs, drill-down links and chart interactions. It is applied only to `/api/read/home?media=1`, before resolving image mappings. The existing SQL, stored projections, calculations, ordering and complete plain-home response remain unchanged.

The largest savings come from removing unused performance metrics from recent ratings and the other players' cards; unused match/lineup metadata from score summaries; unused fields from season leaders and table rows; and ranks for clubs absent from the ticker, featured match and upcoming games. The featured match keeps every shot and every field consumed by its xG curve, shot map, scorer links and hover details. Its four displayed additional statistics keep their values. Every displayed card and list keeps all its entries.

`null`, `false`, zero and absent properties retain their distinction. Values are not rounded, recomputed or coerced. Image URLs and the immutable mapping for every retained image remain available. The media representation uses the new `media-home-v2` ETag prefix so an old validator cannot conceal a representation change. Other resolved-media routes retain their existing contract and validator version.

## Evidence

The [sanitized comparison receipt](../verification/home-payload-20261107/comparison.json) records the captured generation, hashes, section sizes and limits without publishing the response data. Transforming the captured default response gives **97,667 uncompressed bytes**, including **64,991 bytes of card data** and **32,393 bytes of image mappings**: an **81,447-byte reduction (45.47%)**. This is an offline comparison of the exact public response; deployment acceptance must measure the public endpoint again.

`tests/home-presentation.test.mjs` renders the real HomeMatchday, HomePlayers and HomeSeason JSX before and after compaction. The populated public sample covered 20 card/competition-tab variants with byte-identical markup, including image URLs, links and SVG geometry. Synthetic CI data additionally exercises own goals, penalties, blocked shots, on/off-target outcomes, missing metrics and false/zero values. Separate assertions compare the complete xG timeline and shot-map models, ticker weights, upcoming ordering and performance-link IDs. No browser latency is inferred from these render tests.

The suite also verifies source-model immutability, retained absence/null semantics, the new ETag, conditional GET and HEAD behavior, one bounded image lookup, and unchanged representation of other API routes. It runs in the existing navigation CI job. An optional public sample can be checked locally:

```bash
VEGA_HOME_PRESENTATION_SAMPLE=/tmp/home-response.json node --test tests/home-presentation.test.mjs tests/resolved-media.test.mjs
```

## Initial-read count and limits

On the successful default server-rendered path, `home-bootstrap.js` performs **two sequential critical API reads**: manifest, then the compact home summary. It derives the compact catalogue from the manifest and embeds both resources in the page. Fresh resource seeds suppress duplicate client reads. `/api/status` is a separate, shared, non-blocking client read after hydration. Images, fonts and analytics are not part of the useful-data-read count. The ordinary client fallback has the same two critical reads plus that status read; preference mismatches, publication conflicts and later revalidation can add requests.

Thus the static default path fits the plan's 2–4 useful-data-read target and performs no full-season download. This is a code-path count, not a captured browser waterfall. The manifest still exceeds 100 KB, and the combined bootstrap data is larger than the card response alone. The 100 KB card figure remains an indicative default-scope target; larger historical or personal scopes are allowed within existing response limits. No data or UI is truncated to enforce an arbitrary byte quota.
