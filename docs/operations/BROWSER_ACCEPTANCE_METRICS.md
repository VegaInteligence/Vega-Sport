# Browser acceptance receipts

Open a page with `?acceptance=1` to enable local measurements for that browser
document. The flag is opt-in and no receipt is transmitted. Next.js loads the
small instrumentation module before hydration. Normal navigation and caching
continue unchanged.

Read the JSON value of `html[data-vega-acceptance]` in browser developer tools
or a read-only DOM inspection. It includes the reference browser, viewport,
hardware hints, document identity, API resource timings and up to 40 page
transitions. API paths are recorded without query strings or response bodies.
Zero resource-transfer sizes can mean restricted cross-origin timing; they
must not be interpreted as proof of a memory or HTTP-cache hit.

A transition starts at the monotone click event timestamp (with an explicitly
labelled handler-clock fallback) and finishes only after
the target page identity has a **new**, visible `PageWorkspace` marked ready,
no visible loading marker, and two further animation frames. The measurement
does not include the latency of an external automation command. It is a
readiness-and-frame measure, not a screenshot-based proof of painted pixels.
Hidden tabs are excluded. Filters that keep the same page identity are
deliberately excluded: their existing ready marker cannot prove completion.

The shared resource cache separately counts fresh resolved hits, shared
pending requests and loaders started after the click. An opt-in fetch wrapper
records starts without changing the native promise or request, including Next
RSC reads. Resource Timing closes each body transfer. A transition is labelled
`dataInMemory` only if it has at least one fresh hit, no pending hit, no loader,
no fetch starting in the interval, no fetch still in flight at the
click, and no observed API/RSC body transfer overlapping the interval.
Unrelated background reads can conservatively exclude a sample. This label
describes data: native images may use a separate browser HTTP cache, and the
page-ready gate still includes their visible readiness. Keep the first uncached visits in the raw receipt;
report the memory cohort separately rather than discarding slow observations.

For a reproducible acceptance, warm the relevant page and its images, return
to another page, then follow the same link within the cache lifetime. Record
the number of valid memory transitions and their distribution, plus the
browser identity. A result from the shared cloud Chrome does not describe
Hugo's device or residential network.

The installed Next.js 16.4.3 guide used for this integration is
`next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`.
