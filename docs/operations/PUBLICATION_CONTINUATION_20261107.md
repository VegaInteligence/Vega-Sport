# Automatic serving publication and queue fairness

The serving publisher now has its own hourly continuation in the existing **Build serving tables (AWS)** workflow. Collection still controls when new provider observations arrive; continuation publishes observations already staged in AWS. It does not make an old provider observation newer.

## Scheduled and manual runs

| Setting | Hourly schedule | Manual dispatch |
| --- | --- | --- |
| Trigger | Minute 17 of every hour, UTC | Existing workflow inputs |
| Publication admission budget | 30 minutes | 1–100 minutes; default 100 |
| Partition queue fetch size | 10 | 1–100; default 10 |
| Requeue all scopes | False | Existing `queue_all` choice |
| Install schema only | False | Existing `schema_only` choice |
| Lineup reader switch | Unchanged | Existing unchanged/verify/unified/legacy choice |
| Job timeout | 50 minutes | 120 minutes |

Scheduled values are selected explicitly before credentials or publication. They do not depend on absent dispatch inputs and cannot inherit a manual requeue or reader switch. The workflow keeps the `statarena-aws-ingestion` concurrency group, queued runs and `cancel-in-progress: false`. The publisher also retains its shared PostgreSQL advisory lease. GitHub may delay scheduled runs, and a queued collector or publisher may delay their start; the cron is not a strict freshness deadline.

No self-dispatch chain or additional infrastructure is introduced. The currently running workflow keeps the source version it checked out. The next run uses the merged implementation.

## Both queues receive service

Previously, global/support publication and one catalogue batch followed up to ten partition transactions. Expiry during that partition batch could leave both untouched for the entire run.

The publisher now processes globals once before the backlog. Before each partition, it admits catalogue transactions for at most a **30-second slice**, up to **40 inputs**, in atomic batches of at most **4 inputs**. It checks the earlier of the slice deadline and the overall run deadline before starting each batch. An empty partition queue lets catalogue slices continue; an empty catalogue queue lets partitions continue without waiting. Existing newest-season ordering, the placement of `@details` work last and the successful-partition `max_partitions` cap are preserved.

These are **admission limits**. An admitted catalogue batch or partition completes or rolls back atomically and may finish after its admission deadline. The change does not interrupt a source iterator or acknowledge a partially processed catalogue input. Existing per-SQL statement limits and archive transformation subprocess limits remain in force; they are not a total transaction deadline. The workflow timeout reserves 20 minutes beyond the normal admission budget for setup, final transaction work and cleanup. A pathological transaction can still reach the workflow timeout; earlier committed checkpoints survive and unfinished work is retried later.

## Durable progress and freshness

Partitions remain in `publication_jobs` until their facts, read models, receipt and generation commit together. Failures keep the existing five-minute exponential backoff, capped at six hours. An unchanged source does not reset that backoff; a newer source watermark can. Failed partitions are not retried repeatedly within the same run.

Catalogue discovery recreates a temporary work queue, using durable `worker_inputs` kind/key/digest receipts to exclude completed inputs. Every admitted batch writes its source records, archive projections, receipts and generation in the same transaction. A failure rolls back that batch, preserving its unpublished inputs. Smaller batches change commit frequency, not the source contract.

A failed global or catalogue transaction is not attempted again during the same run. Its work stays pending while healthy queues continue, and any earlier committed catalogue batches remain counted. The final workflow status is `failed` and the command exits nonzero. Failure logs contain an exception class or SQLSTATE, not the source payload or raw exception text. A broken database connection aborts immediately because it cannot safely continue publication. These guards prevent a malformed catalogue or global input from blocking every partition after being moved earlier in the run.

The existing `source-discovery`, `catalog-published`, partition timing and `partition-deferred` log records expose each queue's progress. A run that exhausts its admission budget with work remaining records `pending`; it is not evidence that the backlog is empty. Monitor the final remaining count, deferred count, committed publications and source observation dates together. Queue counts alone do not provide a reliable completion estimate because input costs differ.

The historical UEFA standings workflow remains unchanged. Its collector excludes the current season; current standings are already part of the daily football source refresh. Enabling that separate historical collector is unnecessary for serving-publication continuation.

## Verification and rollback

The public-contract CI gate executes the actual scheduled/manual shell planner, admission-boundary tests and PostgreSQL queue/receipt fixtures. The fixtures cover a long first partition, catalogue slices yielding to partitions, empty queues, a zero/successful partition cap, global deadline overrun, failed global/catalogue rollback, earlier committed batch statistics, safe failure reporting and existing retry/backoff behavior. Source freshness and atomic publication fixtures remain in the same gate.

This change adds no schema migration or data rewrite. Reverting the workflow and orchestration code preserves all committed data and durable receipts. Do not clear queues or use `queue_all` merely to continue an incomplete run; an ordinary bounded run resumes unfinished work automatically.
