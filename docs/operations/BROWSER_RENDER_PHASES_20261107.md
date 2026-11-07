# Locate remaining browser rendering time

PR41 removes repeated relational connectivity jobs and reuses visited dynamic
routes without restarting publication freshness. The production receipt still
contains genuine memory transitions above the 100ms goal (260.6ms and 356ms).
Those samples contain no API/RSC read and are not declared passing.

Opt-in receipt version3 keeps the same event timestamp, readiness conditions,
memory evidence and two-frame completion rule. It additionally records when
the new workspace is first observed, when it meets the existing ready gate,
and the time spent in the final two animation frames. These are observations
from the page's own monotone clock, not external automation durations.

Image Resource Timing entries are recorded separately with path, timing and
byte counts. They explain possible media work without reclassifying a data
cache hit as an image-cache hit. Zero transfer bytes alone do not establish a
cache hit, especially for cross-origin images. The image log is bounded to100
entries and is diagnostic, not an exhaustive image/network proof.

No timing target or page-reveal deadline changes in this diagnostic addition.
Normal visitors do not enable it; use `?acceptance=1` on a fresh document.
