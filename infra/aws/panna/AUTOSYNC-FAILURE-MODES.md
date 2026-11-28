# Durable daily runner acceptance

- A missed tick cannot advance source discovery. A retry at the next opportunity reads the last successful SQL inventory. Repeated inventories are idempotent; a new digest or UTC cutoff has a different work identity. A missing or undeclared asset and an unimplemented format remain visible.
- Queue claims are single-owner, time-bounded, and fenced. An expired claim can be reclaimed; the prior writer cannot complete that claim. Reconnect after a committed product run recovers its receipt by the immutable queue job key.
- Fixtures run through the normal Panna CLI. Detailed actions remain waiting for the fixture generation and the deployment of the reviewed identity entrypoint. No guessed provider link or hidden fallback action publication.
- The runner stops on stale metrics, pressure, scratch exhaustion, or a timed-out subprocess. No permanent lock, raw file or always-on bridge is retained after cancellation.
- Process and GitHub contain counts and checksums, not payloads or credentials. The hosted runner path remains disabled until its actual scope and gates are reviewed.
