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
records starts without changing the native promise or request. Next RSC reads
are identified by either the `_rsc` parameter or the `RSC` request header.
Resource Timing closes each body transfer. Version 2 retains every fetch in its
counts and records blocking and telemetry counts separately. Only same-origin
POST requests to exact `view` or `vitals` destinations advertised by the
installed Vercel SDK scripts are classified as non-blocking telemetry for the
memory label. Merely having an unknown path, ending in `/view`, or being a
background request is not enough for that exclusion.

A transition is labelled `dataInMemory` only if it has at least one fresh hit,
no pending hit, no loader, no non-telemetry fetch overlapping the interval, no
blocking fetch still in flight at the click, and no observed API/RSC body
transfer overlapping the interval. The interval includes requests that start
before the click and end after it, or complete while the click handler is
queued. Unknown or unclassifiable requests remain blocking. If bounded trace
retention discards relevant network evidence, `networkEvidenceComplete` is
false and the memory label is refused. Other background reads can therefore
conservatively exclude a sample. This label describes data: native images may
use a separate browser HTTP cache, and the page-ready gate still includes their
visible readiness. Keep all initial visits and slow transitions in the raw
receipt, recording whether the existing HTTP/image cache was controlled;
report the memory cohort separately without relabelling a new document as a
fully cold visit.

Version 3 preserves that same interval and classification. It additionally records
the first observation of the new workspace, the existing ready gate and the final
two-frame interval. Native image resource timings are bounded separately and do
not redefine the data-memory cohort. See [phase definitions](BROWSER_RENDER_PHASES_20261107.md).

Version 4 also retains the page preparation controller's last 20 checks. Each
check separates time waiting for its scheduled frame from time spent inspecting
the current layout and images. The trace reports whether data or images were
still pending, its total check count and whether readiness or a deadline ended
the preparation. It is written once on the page at completion; ordinary visits
do not collect this trace. It does not change image admission, deadlines or the
navigation completion criterion.

For a reproducible acceptance, warm the relevant page and its images, return
to another page, then follow the same link within the cache lifetime. Record
the number of valid memory transitions and their distribution, plus the
browser identity. A result from the shared cloud Chrome does not describe
Hugo's device or residential network.

The installed Next.js 16.4.3 guide used for this integration is
`next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`.
