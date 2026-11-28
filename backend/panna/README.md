# PannaData loader (`backend/panna`), pass H1

Reads PannaData's Opta fixtures and events outside AWS and writes every eligible record, every column, into RDS. No
Parquet file is ever downloaded into, stored in or fetched by AWS: the files are read on the Mac (or a runner) and only
typed rows travel, by `COPY`, to the base. GitHub #278, Linear VI-177. Rules and the failure modes each test pins:
[FAILURE_MODES.md](FAILURE_MODES.md).

## What H1 loads

| Dataset (`panna_data`) | Source (release `opta-latest` of `peteowen1/pannadata`) | Segment | Rows stored |
|---|---|---|---|
| `opta_fixtures` | `opta_fixtures.parquet`, 13 columns | one fixture (`match_id`) | the fixtures of the window whose day has come |
| `opta_events` | the 116 `events_<competition>.parquet`, 17 columns | the events of one fixture | the events of those fixtures, and of unknown fixtures whose own season is in the window |

- **Window:** Vega season 2021/22 onwards (split labels from `2021-2022`, calendar leagues from `2021`, named
  tournaments through `vega.seasons.sporting_season`, qualifiers and friendlies by their day from 2021-01-01), up to
  the run's as-of. Fixtures after the as-of are deferred and written by the first run whose as-of reaches them.
- **Types:** as in the source. `events_EPL.parquet` and `events_Scottish_Premiership.parquet` store six integer
  columns as `double`: they are read into the `bigint` columns only when every value is an exact integer; the receipt
  keeps the file's types, `panna.loads.conversions` the conversion (`column::double precision` gives the source back).
- **Each row** carries `segment_id` and `ordinal` (its place in its segment); a segment is stored once
  (`panna.segments`, its SHA-256 recomputed by the server before each chunk commits, its rows found by a B-tree on
  `segment_id`). `panna.manifest` says what each generation of each source changed; `panna_data.<dataset>_current`,
  `panna.current_segments` and `panna.current_generations` give the current state, `panna.segments_as_of(load_id)` a
  past one.
- **Durability:** each commit waits for its WAL flush (`synchronous_commit` on, printed in `run_start`); a load is
  marked complete only when every eligible key's current segment in the base is this generation's (`CONSERVATION`
  otherwise, exit 1: `retry` writes what is missing).
- **The scope index** `panna.scope` holds every fixture key's decision and day, never a deferred fixture's data.

## Setup

Python 3.14, from the repository root:

```sh
pip install -r backend/requirements.txt -r backend/panna/requirements.txt
export PYTHONPATH=backend
```

The base: SSM `/vega/v2/panna-deploy` set to `on`, then a Deploy. It creates `/vega/v2/password-panna` and
`/vega/v2/panna-database-url` (`postgresql://vega_v2_panna:…@<endpoint>:5432/vega_v2?sslmode=verify-full`), applies
`backend/panna/sql` (`001_panna.sql`, `002_panna_variants.sql`, `003_panna_segment_index.sql`) with the migrate task and
sets the login `vega_v2_panna` (4 connections, insert and read only). The loader refuses a base without all three
(`SCHEMA_VERSION`, naming the file).
The loader reads the URL from `V2_PANNA_DATABASE_URL` (or `--database-url`) and verifies TLS with the bundled RDS CA.
Through a local port forward to the private base: `--via 127.0.0.1:<port>` (TLS still checks the endpoint's name).

## Commands

Every command prints JSON lines (counts, digests, names, reason codes; never a row value or a credential). Exit 0
complete, 1 failed (an object refused, named), 2 refused input, 3 partial (`retry` resumes), 4 another runner.

```sh
M=/path/to/h1-frozen-manifest.json   # {"assets": [{name, sha256, bytes, path | url, ...}]}: no listing, no download
# The scope of every asset, no database (the full catalog: about 20 s on the Mac):
python3 -m panna probe --manifest "$M" --asset opta_fixtures.parquet --family opta_events --as-of 2026-11-28
# The plan a run follows, every file checked, with the exact projection when V2_PANNA_DATABASE_URL is set:
python3 -m panna prep --manifest "$M" --asset opta_fixtures.parquet --family opta_events --as-of 2026-11-28 --plan-out plan.json
python3 -m panna run --plan plan.json --via 127.0.0.1:15432 --database-ceiling-bytes <bytes>
# A bounded pilot, then the whole window:
python3 -m panna run --manifest "$M" --asset opta_fixtures.parquet --asset events_World_Cup.parquet --as-of 2026-11-28
python3 -m panna run --manifest "$M" --asset opta_fixtures.parquet --family opta_events --as-of 2026-11-28
# From the release itself (GitHub's listing; GITHUB_TOKEN optional), exactly the names given:
python3 -m panna run --release opta-latest --asset opta_fixtures.parquet --family opta_events
python3 -m panna retry            # the last run that did not complete, with its plan, as-of and bounds
python3 -m panna status           # rows, segments, scope, generations, runs, base size
python3 -m panna verify --run <id>  # the server's digest of each segment that run wrote (no --run: every segment)
python3 -m panna explain --dataset opta_events --last-segments 20   # the plan of the latest segments' verification
```

- `--as-of` defaults to the run's UTC date and refuses a later one. Fixtures load first; events need a complete
  fixtures load (the run's, or the latest in the base); `--fixtures sha256:<hex>` makes the run refuse any other.
- Bounds: `--database-ceiling-bytes` (refuses, before writing, an object whose projection would pass it),
  `--max-seconds`, `--chunk-rows` (50 000), `--churn-limit` (0.5 of a stream's segments changed refuses that
  object; `--allow-churn` once reviewed), `--scratch` and `--scratch-ceiling-bytes` (files read from a URL; a
  manifest's local paths are read in place and never removed). The run's ceiling, churn limits and chunk size are kept
  in its plan: `retry` applies them unless given again; `--max-seconds` is a budget of one process.
- `retry` refuses (`RETRY_STALE`, exit 2) a run older than a later complete run, or than a later complete load of
  one of its sources: its remaining assets would otherwise become current with an older as-of. `--force` overrides.
- Each chunk prints a line: `{"event": "chunk", "name", "chunk", "segments", "rows", "bytes", "encode_ms",
  "copy_ms", "verify_ms", "unit_ms"}`. A dropped link is reopened with a backoff of about 90 s, waiting for the old
  session's lock (`reconnect`, `waited_for_lock`); TCP keepalives run on both ends.

## Measured (local PostgreSQL 18.3, 28 Nov 2026, release of 27 Nov)

- `probe` of the frozen catalog (117 files) at as-of 2026-11-28: fixtures 111 584 eligible, 152 507 historical,
  6 104 deferred; events 120 871 458 eligible, 114 254 779 historical; each file equal to the independent control.
- Load of fixtures and `events_Scottish_Premiership.parquet` (converted): 2 205 342 rows in 34 s; `verify` 112 796
  segments, 0 mismatched; a replay wrote 0 rows; an independent read-back found every row equal to the source.
- Sizes: 309 bytes a stored event, 209 a fixture, before the B-tree of `003` (2.3 % of the table, 2.4 % measured
  once built on 5.6 M rows). 16-byte provenance would add 2.8 %, the source's column order 3.1 %.
- The verification of the latest 20 segments (34 721 rows of a 5.6 M-row table), before and after `003`: a lossy
  bitmap heap scan through the block range index, 2 444 buffers, 396 ms; an index scan on the B-tree, 1 350 buffers,
  104 ms (`explain`).
- Growth to 30.8 M events with `003` (five more files in one run on top of the 5.6 M rows: 25 225 264 rows in 268 s,
  each file's load equal to its `probe`): the median verification of a 50 000-row chunk stayed 128 to 136 ms in each
  fifth of the run (slope −0.49 ms per million rows added); `verify --run` 14 672 segments, 0 mismatched; `explain`
  on 30 823 131 rows: index scan, 1 350 buffers, 99.8 ms.
- Sizes at 30.8 M events: heap 299 bytes a row, the B-tree 282 MB (3.1 % of the heap when it grows chunk by chunk),
  308 bytes a row in all, under the projection's 330; fixtures 232 with their B-tree, over the projection's 220 by
  1.3 MB for the whole file. The window as of 2026-11-28 projects to about 35 GiB of events at 308 bytes a row (37 GiB
  at 330) and 0.2 GiB of control tables.

## Benchmark at scale (the verification's cost as the table grows)

On a disposable base migrated with `001`–`003`, the fixtures loaded first, then events in one run, here the seven
files that reach 30 M eligible rows at as-of 2026-11-28 (32 605 894):

```sh
# 001-003, recorded in panna_admin.applied (prints "panna applied=<pending> total=3"); it also applies the core's
# migrations the base lacks, and sets the password of vega_v2_panna, a login of the whole server.
V2_MIGRATION_DATABASE_URL=<owner URL> V2_PANNA_PASSWORD=<password> python3 -m vega.migrate
python3 -m panna run --manifest "$M" --asset opta_fixtures.parquet --as-of 2026-11-28
python3 -m panna run --manifest "$M" --as-of 2026-11-28 --asset events_Argentine_Liga_Profesional.parquet \
  --asset events_MLS.parquet --asset events_Championship.parquet --asset events_League_Two.parquet \
  --asset events_League_One.parquet --asset events_Brazilian_Serie_A.parquet --asset events_La_Liga.parquet > run.jsonl
# Per chunk: rows written so far against the server's verification time.
python3 -c 'import json, sys; t = 0
for l in open(sys.argv[1]):
    e = json.loads(l)
    if e.get("event") == "chunk" and e["rows"]:
        t += e["rows"]; print(t, e["verify_ms"], e["unit_ms"])' run.jsonl
python3 -m panna explain --dataset opta_events --last-segments 20   # Index Scan using opta_events_segment_id
```

The statement each chunk runs is `explain`'s `statement`: `SELECT d.segment_id, sha256(convert_to(string_agg(<the
row's canonical encoding>, '' ORDER BY d.ordinal), 'UTF8')) FROM panna_data.opta_events d WHERE d.segment_id =
ANY(%s) GROUP BY d.segment_id`, with the chunk's new segment ids. Expected: each load's `rows_written` equal to the
file's `probe` count, flat `verify_ms` (about 130 ms per 50 000-row chunk on the Mac), and an index scan using
`opta_events_segment_id`; a base without `003` stops before writing (`SCHEMA_VERSION`).

## Rollback

Stop the loader, set `/vega/v2/panna-deploy` to `off` (not deleted) and run a Deploy: it passes `Panna=false`, so the
migrate task no longer gets the login's password. Then, as the owner, run `backend/panna/ROLLBACK.sql`: it drops
`panna`, `panna_data`, `panna_admin` and, unless another database of the server still uses them, the two roles. The
next Deploys leave them dropped while the switch stays `off`. Nothing of the football schemas references them. A bad
load alone: its segments are content-addressed, so a corrected generation of the source adds its new segments and the
manifest makes it current; nothing is deleted.

## Not in H1 (pass H2)

The other PannaData families and formats of the window (other Parquet families, R caches and models, CSV, JSON, tar
members, player bios, credits, headshots), the dedicated tunnel task and role, the daily workflow and its alarm, the
second-day churn measurement, and the retirement of collectors PannaData replaces.
