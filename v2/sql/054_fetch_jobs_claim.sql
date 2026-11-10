-- The claim (jobs.claim) takes the next due job of a lane: highest priority first, then
-- the oldest run_after, then the lowest id. fetch_jobs_pending (lane, run_after,
-- priority DESC) is not in that order, so each claim read every pending job of its lane
-- and sorted them. Unnoticed with a few thousand jobs; with the backfill's 949,000
-- (10 November 2026) one claim took 0.4 s, before every single request to the provider.
-- This index is in the claim's order and holds the two states a claim can take
-- (pending, and leased once the lease has run out): a claim reads its first entry.
CREATE INDEX fetch_jobs_claim ON ops.fetch_jobs(lane, priority DESC, run_after, id)
WHERE state IN ('pending', 'leased');
