# Deployed navigation acceptance — 7 November 2026

## Environment and scope

The deployed frontend at `https://vegasport.vercel.app` was exercised through the browser after the backend deployment was confirmed live at 05:24:14 UTC. This was a representative interaction and rendering check before the database consolidation cutover, while the production backfill was beginning. It did not perform database writes, change configuration or run a load test.

- Frontend main revision: `4268b329`; deployment `dpl_4D41Gg4fV9P5QVxUP78wo3CkRUhV`.
- Deployed backend artifact SHA-256: `006b04ef536dd4849200334353446a5d67f782e16b1394764624b52eb30cc0a4`.
- Selected current season: `2026/2027`; Europe focus for the navigation checks.
- Browser: dedicated cloud Chrome tab 7, separate from the deployment operator's tab.
- Final inspected state: calendar results, approximately 05:36 UTC.

The browser checks reached populated results after each interaction. An initial route shell or loading indicator was not counted as success. Browser-tool call duration is not a reliable page-load measurement, so no millisecond latency claim is derived from this exercise. The separate [public HTTP deployment receipt](../verification/db-refactor-20261107/runtime-before-cutover.json) contains all 30 HTTP requests and server timing measurements, including the slower client observations.

## Observed coverage

| Route or interaction | Observed result |
| --- | --- |
| Dashboard | The weekly widget displays **2–8 November 2026**, with provisional-period wording and **Anastasios Douvikas**, rather than the previously frozen Hakimi selection. Results and upcoming fixtures are populated. |
| Player directory, initial page | **20 player rows**, **2,185 qualified players**, **110 pages**. The default rating ranking and at-least-five-rated-matches rule are visible. |
| Player directory, next page | A different set of **20 players** renders. The total and page count remain unchanged; the UI reports page 2 of 110. |
| Global search | Typing **Hakimi** returns **Achraf Hakimi — Paris Saint-Germain**. Pressing Enter opens the corresponding player profile and closes the search dropdown. |
| Player overview | Hakimi's season table renders **12 matches**, **887 minutes**, **3 goals**, **3 assists**, with the complete **4 Champions League + 8 Ligue 1** split. The profile radar and career section render. |
| Player statistics | The statistics tab renders season/career tables and match links. Opening the PSG–Slovan result from that table navigates to the corresponding match. |
| Match overview | PSG–Slovan Bratislava renders the **6–1** result, team statistics, goal timeline and player ratings. |
| Deferred match shots | Selecting **Tirs & xG** renders the shot map and collected-shot list after its own loading state. The page reports no missing xG or coordinates for the displayed shots. |
| Club overview | PSG renders its **13-match** season summary, **10–2–1** record, **41–15** goals, home/away breakdown, recent results and upcoming fixtures. |
| Club directory | **192 clubs**, **7 pages**. The first page contains 28 club links. Searching **Paris** returns exactly **Paris FC** and **Paris Saint-Germain**. |
| Competition standings | The Ligue 1 view renders all **18 club rows** in its standings table. |
| Competition matchdays | Selecting **Matchs** renders the tenth matchday with **9 fixtures**, **1 result** and **8 upcoming**. |
| Archive season | Selecting **2018/2019** renders **50 match rows** and **205 pages**. The first visible row is Rayo Majadahonda–CF Reus Deportiu, 9 June 2019. |
| Archive next page | Page 2 renders **50 different match rows**, beginning with Wolfsberger AC–Sturm Graz, 26 May 2019. The edition version is retained in the URL. |
| Archive search | Searching **Müller** resets pagination and renders **13 matching rows**, consistent with the native archive acceptance case. |
| Archive match detail | Opening Fortuna Düsseldorf–Hannover 96 renders the **2–1** result and all **three** recorded goals, including Nicolai Müller. The selected source-position key and edition version remain bound together. |
| Calendar upcoming | The current week, **2–8 November 2026**, renders **30 fixtures on the page**, with explicit further-page controls. |
| Calendar results | Switching to **Résultats** renders the recent result list, including matches on 6 and 5 November, with further-page controls. |

The season and match values above are observations of the application's published dataset. This check does not independently authenticate the upstream football results.

## Verified URLs

These are the exact settled URLs observed after navigation, with the relevant scope and publication parameters preserved.

- [Player directory](https://vegasport.vercel.app/joueurs?season=2026%2F2027&focus=europe)
- [Hakimi profile](https://vegasport.vercel.app/joueurs?season=2026%2F2027&focus=europe&id=p_4QqLFm)
- [PSG–Slovan match](https://vegasport.vercel.app/matchs?season=2026%2F2027&focus=europe&id=m_0jZMQu&competition=l_0bfbkO&sourceSeason=2026%2F2027&tab=results)
- [PSG club profile](https://vegasport.vercel.app/clubs?season=2026%2F2027&focus=europe&id=t_41iFW3)
- [Club directory](https://vegasport.vercel.app/clubs?season=2026%2F2027&focus=europe)
- [Competitions](https://vegasport.vercel.app/competitions?season=2026%2F2027&focus=europe)
- [Archive 2018/2019, first page](https://vegasport.vercel.app/archives?season=2026%2F2027&focus=europe&as=2018-2019)
- [Archive 2018/2019, second page](https://vegasport.vercel.app/archives?season=2026%2F2027&focus=europe&as=2018-2019&ap=2&av=08e5785e66973332c4bf758a068f925068b5b9cf34feb262342cc2c9c4e36e53)
- [Archive Müller search](https://vegasport.vercel.app/archives?season=2026%2F2027&focus=europe&as=2018-2019&aq=M%C3%BCller)
- [Archive selected match](https://vegasport.vercel.app/archives?season=2026%2F2027&focus=europe&as=2018-2019&aq=M%C3%BCller&m=r%3A2018-19%2Fde.1%3A304&av=08e5785e66973332c4bf758a068f925068b5b9cf34feb262342cc2c9c4e36e53)
- [Calendar results](https://vegasport.vercel.app/matchs?season=2026%2F2027&focus=europe&tab=results)

## Result and limits

No application error, failed result page, incorrect pagination transition or visibly broken layout was observed in these checks. The player overview and final calendar results were also inspected as screenshots. Sampled warning/error logs contained only the cloud browser extension's metadata-delivery errors, whose source was `chrome-extension://…/content-script.bundle.js`; these were excluded from application regressions.

This evidence establishes representative rendering and interaction coverage. It does not establish every device size, every analytical tab, every historical edition, concurrency limits, physical cold-cache latency, or behavior after the subsequent database cutover. Database parity, rollback and publication-fence checks are covered by their separate native acceptance receipts. The controlled automated navigation gates and production build are documented in [FRONTEND_PERFORMANCE_20261107.md](FRONTEND_PERFORMANCE_20261107.md).

## Direct-origin deployment acceptance

The follow-up navigation corrections from [PR #29](https://github.com/VegaInteligence/Vega-Sport/pull/29) were exercised again after production deployment `dpl_FXu91hMLMWioLCAaNLjkmZQhjFU1` became READY at **07:03:58 UTC**, on main revision `1fcb00e`. [Main CI 42349281748](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42349281748) passed all three jobs. The backend remained artifact `006b04ef536dd4849200334353446a5d67f782e16b1394764624b52eb30cc0a4`. Database reconstruction proofs were still running; this phase is also **pre-cutover**.

The same browser tab performed a full page navigation before the checks, replacing the earlier frontend bundle. The rendered document's manifest preload and asset image URLs explicitly use `https://d317dq37z1tacb.cloudfront.net/api/…`, confirming the production build's direct API origin. The following populated states were observed approximately **07:07–07:09 UTC**:

| Interaction | Observed result |
| --- | --- |
| Global search and player navigation | **Hakimi** returns **Achraf Hakimi — Paris Saint-Germain**. Enter opens `p_4QqLFm`; the overview renders **12 matches, 887 minutes, 3 goals, 3 assists**, with the complete competition split. |
| Club directory | The initial page contains exactly **24 club links**, with **192 clubs** and **8 pages**. This supersedes the earlier 28-card page observation for the new deployment. |
| Explicit archive edition | Opening `as=2018-2019` directly renders **50 rows**, page **1 of 205**, beginning with Rayo Majadahonda–CF Reus Deportiu. |
| Archive detail | The visible Tottenham–Liverpool goal link opens the **0–2** final and the **two recorded goals**, Mo Salah 2′ and Divock Origi 87′. Its source-position key remains bound to the edition version in the URL. |
| Native match shots | PSG–Slovan renders **6–1**, then selecting **Tirs & xG** renders the map and **44 collected shots**, with **0 missing xG** and **0 missing coordinates**. |

New exact settled URLs for this phase:

- [Archive final and its publication version](https://vegasport.vercel.app/archives?season=2026%2F2027&focus=europe&as=2018-2019&m=r%3A2018-19%2Fuefa.cl%3A124&av=08e5785e66973332c4bf758a068f925068b5b9cf34feb262342cc2c9c4e36e53)
- [PSG–Slovan shots](https://vegasport.vercel.app/matchs?season=2026%2F2027&focus=europe&id=m_0jZMQu&competition=l_0bfbkO&sourceSeason=2026%2F2027&tab=results&view=shots)

No visible application failure or CORS error was observed. The sampled warning/error log entries were the known cloud browser extension's metadata-delivery errors, not application errors. These checks establish successful representative interactions with the direct-origin build; they do not measure browser latency or prove every route, device or cancellation race. The existing automated contracts cover failure/cancellation behavior. A separate curl transport attempt did not reach an HTTP response, so it supplies no production response-time comparison. The following phase records the subsequent post-cutover check.

## Post-cutover capacity deployment — data passed, image gate open

[PR #30](https://github.com/VegaInteligence/Vega-Sport/pull/30) was merged as main `a34514589726d6f8770dbcb86a798bd76d6b0af7` after [CI 42353670931](https://github.com/VegaInteligence/Vega-Sport/actions/runs/42353670931) passed all three jobs. Production deployment `dpl_J7iTzpPePQkbMfFMuDdRaPYzLdo6` was confirmed READY at **08:10:40 UTC**. This browser phase ran **08:11:14–08:18:24.869 UTC**, after the database activation reported at 08:05:32 UTC, against backend artifact prefix `5f4de1`. The adapted publisher was running, so a stable generation across the entire window is not assumed.

A fresh document load preceded this bounded sequence. The data and navigation checks below reached populated content:

| Interaction | Observed result |
| --- | --- |
| Player directory and return navigation | **20 rows**, **2,185 qualified players**, page **1 of 110**. Returning from the match view renders the 20-row directory again. |
| Global search and player profile | **Hakimi** followed by Enter opens **Achraf Hakimi**. The overview shows **12 matches, 887 minutes, 3 goals and 3 assists**, split across Champions League and Ligue 1. |
| Clubs pagination | Page 1 contains **24 clubs**, beginning with 1. FC Köln; **192 clubs**, **8 pages**. Next opens page 2, beginning with Beşiktaş, with the same total. |
| Explicit archive edition and next page | `as=2018-2019` renders **50 rows**, page **1 of 205**. Next renders another **50 rows**, beginning with Wolfsberger AC–Sturm Graz, while preserving the edition token. |
| Archive goal detail | The page-2 link opens **Wolfsberger AC 2–1 Sturm Graz** and **three goals**: Michael John Lema 11′, Lukas Spendlhofer 79′ and Sékou Koïta 90′. The selected position key is `r:2018-19/at.1:189`, bound to the same edition version. |
| Native match overview and shots | PSG–Slovan renders **6–1**, **35–9 shots**, then **44 collected shots** on the shots tab, with **0 missing xG** and **0 missing coordinates**. |

**Image acceptance did not pass.** Visible player portraits and club crests showed their initials fallbacks. The settled club directory had no image elements; the final player directory had **27 fallback elements** and **13 deferred image elements**, all without a source and below the visible area. No decoded Blob image was observed (`naturalWidth` remained zero for those deferred elements). This distinguishes the expected below-fold deferral from the visible slots that had already fallen back. The screenshot retained with the private receipt shows the final populated player directory and its initials. This phase does not certify image rendering or the completed capacity fix.

The 50-entry warning/error console sample contained no application or CORS error within this window; its new entries were the known browser-extension metadata errors. That absence does not explain the image failure because image load errors are handled by the component. The browser tab was retained for review. No load test or additional HTTP probe was performed, and tool duration is not a page-latency measure. The exact window is available for independent CloudWatch correlation; **zero backend throttles is not asserted by this browser evidence**.

### Image diagnosis and prepared correction

The operator's bounded follow-up confirmed a valid **9,588-byte WebP**, HTTP 200 and `image/webp`, at the final immutable PSG asset URL. Direct final-CDN HEAD responses with both `Origin: https://vegasport.vercel.app` and `Origin: null` omitted `Access-Control-Allow-Origin`. The image-byte fetch introduced a CORS requirement that the previously native image route did not have; the CDN policy's configuration alone had not proved that response behavior.

The prepared fix restores native `<img>` source assignment after admission to the same shared scheduler. It removes Blob fetching/cache/object-URL code, retains visible intent and the four-total/two-image limits, and releases admission on native load/error or cleanup. Native image events cannot inspect HTTP retry headers, so there is no new automatic image retry; existing alternate-source and initials fallbacks remain. JSON throttle handling is unchanged. The focused scheduler/component lifecycle suite passes **21 tests**, and the complete workflow navigation command passes **126 tests**. This is local verification only: **deployment, decoded native images and a fresh bounded browser acceptance remain pending**.
