"""A run (backend/panna/FAILURE_MODES.md, sections 3 and 4): each asset of the plan read and decided, then its eligible
segments not yet stored written in verified chunks, then its load completed with its manifest, tombstones and scope.

Per object: (A) the key of every row and each key's outcome at the run's as-of; (B) when segments of these keys are
already stored or the stream has a previous generation, each eligible key's digest, which says what is new, and the
churn guard; the projection against the ceiling; (C) the new segments' rows, chunk by chunk, each chunk's ledger rows,
data rows and manifest entries in one transaction after the server's digests equal the loader's; (D) the tombstones,
the scope index and the load's completion, last. Every unit can run again after a lost link and finds what committed.
"""

from collections import defaultdict
import datetime
import hashlib
import io
import json
import time
import uuid

import numpy as np
import pyarrow as pa
import pyarrow.csv as pcsv
import pyarrow.parquet as pq

from . import encode, registry, scope, sources
from .db import LinkLost

BATCH_ROWS = 65_536
CHUNK_ROWS = 50_000
CHUNK_BYTES = 64 << 20
ELIGIBLE = ("eligible", "eligible_orphan")
# The fixtures index an events load decides by: the latest complete fixtures load of a run whose plan is not scoped.
# A scoped load (S1's pilot: one key) is no index of the other fixtures (FAILURE_MODES.md section 8, review m3).
INDEX_LOAD = """SELECT l.load_id, r.sha256 FROM panna.loads l JOIN panna.streams s USING (stream_id) JOIN panna.receipts r USING (receipt_id)
                JOIN panna.runs u ON u.run_id = l.run_id
                WHERE s.dataset = 'opta_fixtures' AND l.status = 'complete' AND coalesce(jsonb_typeof(u.plan->'scope'), 'null') = 'null'
                ORDER BY l.load_id DESC LIMIT 1"""


class Failure(Exception):
    """An object that cannot be loaded as it is: named, nothing of it written, the run goes on and ends failed."""

    def __init__(self, code, name=None, **fields):
        super().__init__(code)
        self.code, self.name, self.fields = code, name, fields


class Stop(Exception):
    """A bound reached: the run stops PARTIAL; `retry` resumes it."""

    def __init__(self, reason, **fields):
        super().__init__(reason)
        self.reason, self.fields = reason, fields


class Output:
    def __init__(self, stream):
        self.stream = stream

    def emit(self, event, **fields):
        self.stream.write(json.dumps({"event": event, **fields}, default=str) + "\n")
        self.stream.flush()


def drift(dataset, schema):
    """The differences between a file's schema and the dataset's columns: added, removed, retyped, the columns read
    through a declared exact conversion ({name: {from, to, rule}}, registry.CONVERTIBLE), and whether the file holds
    the dataset's extension: all of its columns, since any of them without the others is drift (FAILURE_MODES.md
    section 9)."""
    source = {f.name: str(f.type) for f in schema}
    columns = list(dataset.columns)
    extended = dataset.extension is not None and any(c.name in source for c in dataset.extension.columns)
    if extended:
        columns += dataset.extension.columns
    expected = {c.name: c.pg_type for c in columns}
    added = sorted(set(source) - set(expected))
    removed = sorted(set(expected) - set(source))
    retyped, conversions = [], {}
    for name in sorted(set(source) & set(expected)):
        if source[name] in registry.ACCEPTED[expected[name]]:
            continue
        rule = registry.CONVERTIBLE.get(expected[name], {}).get(source[name])
        if rule:
            conversions[name] = {"from": source[name], "to": expected[name], "rule": rule}
        else:
            retyped.append(name)
    return added, removed, retyped, conversions, extended


def checked(dataset, path, name):
    """The file's drift refused (SCHEMA_DRIFT) or its conversions, then its index (LOSSY_CONVERSION refused there)."""
    schema = pq.ParquetFile(path).schema_arrow
    added, removed, retyped, conversions, extended = drift(dataset, schema)
    if added or removed or retyped:
        raise Failure("SCHEMA_DRIFT", name, added=added, removed=removed, retyped=retyped)
    return Indexed(path, dataset, conversions, name, extended)


# A key's extension segment that is not stored yet (write's targets).
NEW = "new"


def key_digests(indexed, wanted):
    """{key id: digest of its rows}, and for an extended object {key id: digest of their added columns, or None when
    every added value of the key is NULL (no extension segment)}."""
    base, ext, valued = {}, {}, defaultdict(int)
    for k, _, span, ext_span, n in indexed.pieces(wanted):
        base.setdefault(k, hashlib.sha256()).update(span)
        if ext_span is not None:
            ext.setdefault(k, hashlib.sha256()).update(ext_span)
            valued[k] += n
    return {k: h.digest() for k, h in base.items()}, {k: h.digest() if valued[k] else None for k, h in ext.items()}


class Indexed:
    """What pass A learnt of one file: each row's key id, the keys, their counts, runs and editions; and that every
    value of a converted column is an exact integer, else the whole object is refused before anything is written."""

    def __init__(self, path, dataset, conversions=None, name=None, extended=False):
        self.path, self.dataset, self.conversions = path, dataset, dict(conversions or {})
        # The dataset of the object's added columns when it holds them (FAILURE_MODES.md section 9), else None.
        self.extension = dataset.extension if extended else None
        pf = pq.ParquetFile(path)
        self.source_rows = pf.metadata.num_rows
        self.row_groups = pf.metadata.num_row_groups
        self.schema = pf.schema_arrow
        self.keys, ids = [], {}
        self.codes = np.full(self.source_rows, -1, dtype=np.int32)
        self.editions = defaultdict(set)
        extra = ["competition", "season"]
        self.fixture_rows = [] if dataset is registry.FIXTURES else None
        position = 0
        inexact = defaultdict(int)
        columns = [dataset.key] + extra + (["match_date"] if self.fixture_rows is not None else [])
        columns += [c for c in self.conversions if c not in columns]
        for batch in pf.iter_batches(batch_size=1 << 20, columns=columns, use_threads=True):
            for column in self.conversions:
                inexact[column] += encode.inexact(batch.column(column))
            n = batch.num_rows
            encoded = batch.column(dataset.key).dictionary_encode()
            local_ids = []
            for key in encoded.dictionary.to_pylist():
                i = ids.get(key)
                if i is None:
                    i = ids[key] = len(self.keys)
                    self.keys.append(key)
                local_ids.append(i)
            mapping = np.array(local_ids or [0], dtype=np.int32)
            mask = encoded.indices.is_null().to_numpy(zero_copy_only=False)
            local = encoded.indices.fill_null(0).to_numpy(zero_copy_only=False).astype(np.int64)
            codes = np.where(mask, -1, mapping[local]).astype(np.int32)
            self.codes[position: position + n] = codes
            grouped = pa.table({"k": pa.array(codes, pa.int32()), "c": batch.column("competition").cast(pa.string()),
                                "s": batch.column("season").cast(pa.string())}).group_by(["k", "c", "s"]).aggregate([])
            for k, c, s in zip(*(grouped.column(col).to_pylist() for col in ("k", "c", "s"))):
                if k >= 0:
                    self.editions[k].add((c, s))
            if self.fixture_rows is not None:
                for key, day, c, s in zip(*(batch.column(col).to_pylist() for col in (dataset.key, "match_date", "competition", "season"))):
                    self.fixture_rows.append({"match_id": key, "match_date": day, "competition": c, "season": s})
            position += n
        refused = {c: n for c, n in sorted(inexact.items()) if n}
        if refused:
            raise Failure("LOSSY_CONVERSION", name, columns=refused)
        valid = self.codes >= 0
        self.counts = np.bincount(self.codes[valid], minlength=len(self.keys)).astype(np.int64)
        self.null_rows = int((~valid).sum())
        # Each key's runs in the file: (start, length) pairs, in order.
        self.runs = defaultdict(list)
        if self.source_rows:
            starts = np.concatenate(([0], np.flatnonzero(self.codes[1:] != self.codes[:-1]) + 1))
            lengths = np.diff(np.concatenate((starts, [self.source_rows])))
            for start, length, code in zip(starts.tolist(), lengths.tolist(), self.codes[starts].tolist()):
                if code >= 0:
                    self.runs[code].append((start, length))

    def pieces(self, wanted, batch_rows=BATCH_ROWS):
        """For the keys whose id is set in `wanted` (a bool array): (key id, rows as a RecordBatch, their canonical
        encoding as bytes, the encoding of their added columns or None, how many of them hold an added value), in
        source order for each key, one piece per batch the key has rows in."""
        pf = pq.ParquetFile(self.path)
        position = 0
        added = list(self.extension.columns) if self.extension else []
        names = [c.name for c in self.dataset.columns] + [c.name for c in added]
        for batch in pf.iter_batches(batch_size=batch_rows, columns=names, use_threads=True):
            batch = encode.convert(batch, self.conversions)
            n = batch.num_rows
            codes = self.codes[position: position + n]
            position += n
            keep = np.flatnonzero((codes >= 0) & wanted[np.maximum(codes, 0)])
            if not len(keep):
                continue
            order = keep[np.argsort(codes[keep], kind="stable")]
            sorted_codes = codes[order]
            rows = batch.take(pa.array(order, pa.int64()))
            spans = encode.Spans(encode.encode_rows(rows, self.dataset.columns))
            ext_spans, valued = None, np.zeros(len(order) + 1, dtype=np.int64)
            if added:
                ext_spans = encode.Spans(encode.encode_rows(rows, added))
                holds = np.zeros(len(order), dtype=bool)
                for c in added:
                    holds |= ~rows.column(c.name).is_null().to_numpy(zero_copy_only=False)
                valued[1:] = np.cumsum(holds)
            cuts = np.flatnonzero(np.diff(sorted_codes)) + 1
            starts = np.concatenate(([0], cuts))
            ends = np.concatenate((cuts, [len(sorted_codes)]))
            for a, b in zip(starts.tolist(), ends.tolist()):
                yield (int(sorted_codes[a]), rows.slice(a, b - a), spans.span(a, b),
                       ext_spans.span(a, b) if ext_spans is not None else None, int(valued[b] - valued[a]))


def as_csv(table):
    sink = io.BytesIO()
    pcsv.write_csv(table, sink, pcsv.WriteOptions(include_header=False))
    return sink.getvalue()


class Run:
    def __init__(self, session, out, as_of, plan, runner, token=None, chunk_rows=CHUNK_ROWS, max_seconds=None,
                 ceiling=None, churn_limit=0.5, churn_min=100, allow_churn=False, fixtures_pin=None, scratch=None,
                 scratch_ceiling=None, keep_scratch=False):
        self.session, self.out, self.as_of, self.plan = session, out, as_of, plan
        self.runner, self.token = runner, token or str(uuid.uuid4())
        self.chunk_rows, self.max_seconds, self.ceiling = chunk_rows, max_seconds, ceiling
        self.churn_limit, self.churn_min, self.allow_churn = churn_limit, churn_min, allow_churn
        self.fixtures_pin, self.scratch, self.scratch_ceiling = fixtures_pin, scratch, scratch_ceiling
        self.keep_scratch = keep_scratch
        self.started = time.monotonic()
        self.rows_written = self.segments_written = 0
        self.index = None  # the fixtures index this run decided: {key: Decision}, and its load
        self.index_load = None
        self.index_sha = None
        self.fixtures_failed = False
        self.current = None  # the asset being written, named by each chunk's line
        # S1 (FAILURE_MODES.md section 8): a run restricted to the keys its plan names, in one dataset. Every other row
        # of the object is out of scope: counted, never written, no scope row, no tombstone.
        self.scope = plan.get("scope")

    def scoped_keys(self, dataset):
        if not self.scope or self.scope.get("dataset") != dataset.name:
            return None
        return set(self.scope["keys"])

    def check_scope(self, indexed, asset, outcome_of):
        """The scoped keys as the plan names them: each present, at the plan's ordinals, eligible, within its rows."""
        scope = self.scope
        ordinals = []
        for k, key in enumerate(indexed.keys):
            if key in scope["keys"]:
                if outcome_of[k] != "eligible":
                    raise Failure("SCOPE_KEY_NOT_ELIGIBLE", asset.name, outcome=outcome_of[k])
                ordinals += [start + i for start, length in indexed.runs[k] for i in range(length)]
        if not ordinals:
            raise Failure("SCOPE_KEY_ABSENT", asset.name)
        if sorted(ordinals) != sorted(scope["ordinals"]):
            raise Failure("SCOPE_ORDINALS", asset.name, found=len(ordinals))
        if len(ordinals) > scope["max_rows"]:
            raise Failure("SCOPE_MAX_ROWS", asset.name, found=len(ordinals))

    # --- the run --------------------------------------------------------------------------------------------------
    def check_registry(self):
        for needs, present in (
                ("002_panna_variants.sql", "to_regclass('panna.current_generations') IS NOT NULL"),
                ("003_panna_segment_index.sql", "to_regclass('panna_data.opta_events_segment_id') IS NOT NULL "
                                                "AND to_regclass('panna_data.opta_fixtures_segment_id') IS NOT NULL"),
                ("005_panna_fixture_extension.sql", "to_regclass('panna_data.opta_fixtures_ext') IS NOT NULL AND EXISTS ("
                 "SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = to_regclass('panna.manifest') "
                 "AND attname = 'extension_segment_id' AND NOT attisdropped)")):
            if not self.session.read(lambda c: c.execute(f"SELECT {present}").fetchone()[0]):
                raise Failure("SCHEMA_VERSION", needs=f"backend/panna/sql/{needs}")
        rows = self.session.read(lambda c: c.execute(
            "SELECT dataset, source_ordinal, name, pg_type, physical_ordinal FROM panna.columns ORDER BY 1, 2").fetchall())
        stored = defaultdict(list)
        for dataset, ordinal, name, pg_type, physical in rows:
            stored[dataset].append((ordinal, name, pg_type, physical))
        for d in registry.TABLES.values():
            mine = [(i, c.name, c.pg_type, c.physical) for i, c in enumerate(d.columns)]
            if stored.get(d.name) != mine:
                raise Failure("REGISTRY_MISMATCH", d.name)

    def start(self):
        def unit(c):
            c.execute("INSERT INTO panna.runs (token, as_of, plan, runner) VALUES (%s, %s, %s, %s) ON CONFLICT (token) DO NOTHING",
                      (self.token, self.as_of, json.dumps(self.plan), self.runner))
            run_id, status = c.execute("SELECT run_id, status FROM panna.runs WHERE token = %s", (self.token,)).fetchone()
            # A retry keeps the run's row and writes back its plan, whose bounds the retry may have replaced.
            c.execute("UPDATE panna.runs SET status = 'running', reason = NULL, heartbeat_at = now(), finished_at = NULL, plan = %s "
                      "WHERE run_id = %s", (json.dumps(self.plan), run_id))
            return run_id
        self.run_id = self.session.unit(unit)
        self.out.emit("run_start", run_id=self.run_id, as_of=self.as_of.isoformat(), assets=len(self.plan["assets"]),
                      synchronous_commit=self.session.setting("synchronous_commit"))

    def finish(self, status, reason=None, **fields):
        def unit(c):
            c.execute("UPDATE panna.runs SET status = %s, reason = %s, finished_at = now(), heartbeat_at = now() WHERE run_id = %s",
                      (status, reason, self.run_id))
        try:
            self.session.unit(unit)
        except LinkLost:
            pass
        self.out.emit("run_end", status=status, reason=reason, run_id=self.run_id, rows_written=self.rows_written,
                      segments_written=self.segments_written, **fields)

    def execute(self):
        self.check_registry()
        self.start()
        failures, refused = [], []
        for entry in self.plan["assets"]:
            asset = sources.Asset(**entry)
            try:
                self.load_asset(asset)
            except Failure as failure:
                failures.append(failure.code)
                if asset.dataset == "opta_fixtures":
                    self.fixtures_failed = True
                self.out.emit("error", code=failure.code, name=failure.name or asset.name, **failure.fields)
            except sources.SourceError as error:
                failures.append(error.code)
                if asset.dataset == "opta_fixtures":
                    self.fixtures_failed = True
                self.out.emit("error", code=error.code, name=error.name or asset.name, detail=error.detail)
            except Stop as stop:
                if stop.reason == "CHURN_GUARD":
                    refused.append(stop.reason)
                    self.out.emit("refused", name=asset.name, reason=stop.reason, **stop.fields)
                    continue
                self.finish("partial", stop.reason, **stop.fields)
                return 3
            except LinkLost as lost:
                self.out.emit("run_end", status="partial", reason=str(lost), run_id=self.run_id,
                              rows_written=self.rows_written, segments_written=self.segments_written)
                return 3
        if failures:
            self.finish("failed", failures[0])
            return 1
        if refused:
            self.finish("partial", refused[0])
            return 3
        self.finish("complete")
        return 0

    def budget(self):
        if self.max_seconds is not None and time.monotonic() - self.started >= self.max_seconds:
            raise Stop("MAX_SECONDS")

    # --- one asset ------------------------------------------------------------------------------------------------
    def load_asset(self, asset):
        dataset = registry.DATASETS[asset.dataset]
        if dataset.depends and self.fixtures_failed:
            raise Failure("DEPENDENCY_MISSING", asset.name, needs=dataset.depends)
        path, owned = sources.fetch(asset, self.scratch, self.scratch_ceiling)
        indexed = checked(dataset, path, asset.name)
        schema = [[f.name, str(f.type)] for f in indexed.schema]
        conversions = indexed.conversions or None
        extension = indexed.extension.name if indexed.extension else None
        self.out.emit("asset", name=asset.name, sha256=asset.sha256, bytes=asset.bytes, source_rows=indexed.source_rows,
                      **({"conversions": {c: v["from"] for c, v in indexed.conversions.items()}} if conversions else {}),
                      **({"extension": extension} if extension else {}))
        decisions, orphans, first_seen, scope_load = self.decide(dataset, indexed, asset)
        # Each row's outcome, and a scoped run's checks, before anything of the object is written.
        outcome_of = {}
        counts = defaultdict(int)
        scoped = self.scoped_keys(dataset)
        for k, key in enumerate(indexed.keys):
            d = decisions[k]
            outcome = d.outcome(self.as_of, orphan=k in orphans, first_seen=first_seen.get(key))
            if scoped is not None and key not in scoped:
                outcome = "out_of_scope"
            outcome_of[k] = outcome
            counts[outcome] += int(indexed.counts[k])
        if indexed.null_rows:
            counts["unresolved" if scoped is None else "out_of_scope"] += indexed.null_rows
        if sum(counts.values()) != indexed.source_rows:
            raise Failure("CONSERVATION", asset.name)
        if scoped is not None:
            self.check_scope(indexed, asset, outcome_of)

        def begin(c):
            c.execute("""INSERT INTO panna.receipts (origin, container, name, asset_id, sha256, bytes, updated_at, source_rows,
                                                     row_groups, schema, first_run_id)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (origin, container, name, sha256) DO NOTHING""",
                      (asset.origin, asset.container, asset.name, asset.asset_id, bytes.fromhex(asset.sha256), asset.bytes,
                       asset.updated_at, indexed.source_rows, indexed.row_groups, json.dumps(schema), self.run_id))
            receipt = c.execute("SELECT receipt_id FROM panna.receipts WHERE origin = %s AND container = %s AND name = %s AND sha256 = %s",
                                (asset.origin, asset.container, asset.name, bytes.fromhex(asset.sha256))).fetchone()[0]
            c.execute("INSERT INTO panna.streams (dataset, origin, container, name) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                      (dataset.name, asset.origin, asset.container, asset.name))
            stream = c.execute("SELECT stream_id FROM panna.streams WHERE origin = %s AND container = %s AND name = %s",
                               (asset.origin, asset.container, asset.name)).fetchone()[0]
            c.execute("""INSERT INTO panna.loads (stream_id, receipt_id, run_id, as_of, scope_load_id, conversions, extension)
                         VALUES (%s, %s, %s, %s, %s, %s, %s)
                         ON CONFLICT (run_id, stream_id, receipt_id) DO NOTHING""",
                      (stream, receipt, self.run_id, self.as_of, scope_load, json.dumps(conversions) if conversions else None,
                       extension))
            load, status = c.execute("SELECT load_id, status FROM panna.loads WHERE run_id = %s AND stream_id = %s AND receipt_id = %s",
                                     (self.run_id, stream, receipt)).fetchone()
            return stream, load, status
        stream, load, status = self.session.unit(begin)
        if status == "complete":
            self.out.emit("load", name=asset.name, status="complete", segments_written=0, rows_written=0, segments_reused=0,
                          outcomes=dict(counts), resumed=True)
            self.remember(dataset, asset, indexed, decisions, load)
            self.evict(path, owned)
            return
        eligible = np.array([outcome_of[k] in ELIGIBLE for k in range(len(indexed.keys))], dtype=bool)
        self.current = asset.name
        written, reused, rows, digests, ext_digests = self.write(dataset, asset, indexed, eligible, outcome_of, decisions,
                                                                 stream, load)
        self.complete(dataset, asset, indexed, eligible, outcome_of, decisions, orphans, first_seen, stream, load, counts,
                      digests, ext_digests)
        self.out.emit("load", name=asset.name, status="complete", segments_written=written, rows_written=rows,
                      segments_reused=reused, outcomes=dict(counts),
                      **({"conversions": sorted(indexed.conversions)} if indexed.conversions else {}),
                      **({"extension": extension, "extended_keys": sum(1 for d in ext_digests.values() if d)}
                         if extension else {}))
        self.remember(dataset, asset, indexed, decisions, load)
        self.evict(path, owned)

    def evict(self, path, owned):
        if owned and not self.keep_scratch:
            path.unlink(missing_ok=True)

    def remember(self, dataset, asset, indexed, decisions, load):
        if dataset is registry.FIXTURES:
            self.index = {indexed.keys[k]: d for k, d in decisions.items()}
            self.index_load = load
            self.index_sha = asset.sha256

    # --- A: decisions -----------------------------------------------------------------------------------------------
    def decide(self, dataset, indexed, asset):
        """{key id: Decision}, the key ids decided as orphans, the first sight of pending keys, the fixtures load."""
        stored_first = dict(self.session.read(lambda c: c.execute(
            "SELECT key, first_seen_on FROM panna.scope WHERE dataset = %s AND state = 'pending'", (dataset.name,)).fetchall()))
        if dataset is registry.FIXTURES:
            by_key = scope.decide_fixtures(indexed.fixture_rows)
            return {k: by_key[key] for k, key in enumerate(indexed.keys)}, set(), stored_first, None
        index, index_load, index_sha = self.fixture_index()
        if self.fixtures_pin and self.fixtures_pin != index_sha:
            raise Failure("FIXTURES_VERSION_MISMATCH", asset.name, current=index_sha, asked=self.fixtures_pin)
        decisions, orphans = {}, set()
        for k, key in enumerate(indexed.keys):
            if key in index:
                decisions[k] = index[key]
            else:
                decisions[k] = scope.decide_orphan(indexed.editions[k])
                orphans.add(k)
        first_seen = {indexed.keys[k]: stored_first.get(indexed.keys[k], self.as_of) for k in orphans
                      if decisions[k].state == "pending"}
        return decisions, orphans, first_seen, index_load

    def fixture_index(self):
        if self.index is not None:
            return self.index, self.index_load, self.index_sha
        found = self.session.read(lambda c: c.execute(INDEX_LOAD).fetchone())
        if found is None:
            raise Failure("DEPENDENCY_MISSING", needs="opta_fixtures")
        rows = self.session.read(lambda c: c.execute(
            "SELECT key, state, reason, day, vega_season FROM panna.scope WHERE dataset = 'opta_fixtures'").fetchall())
        self.index = {key: scope.Decision(state, reason, day, season) for key, state, reason, day, season in rows}
        self.index_load, self.index_sha = found[0], bytes(found[1]).hex()
        return self.index, self.index_load, self.index_sha

    # --- B and C: what is new, and its rows ------------------------------------------------------------------------
    def write(self, dataset, asset, indexed, eligible, outcome_of, decisions, stream, load):
        """Each eligible key's pair of segments: its rows, and for an extended object their added columns (none when
        all are NULL). Each segment is stored once; the manifest names the pair of every key whose pair changed."""
        ext = indexed.extension
        keys = [indexed.keys[k] for k in np.flatnonzero(eligible).tolist()]
        names = [dataset.name] + ([dataset.extension.name] if dataset.extension else [])
        stored, stored_ext = defaultdict(dict), defaultdict(dict)
        for name, key, digest, segment in self.session.read(lambda c: c.execute(
                "SELECT dataset, key, digest, segment_id FROM panna.segments WHERE dataset = ANY(%s) AND key = ANY(%s)",
                (names, keys)).fetchall()):
            (stored if name == dataset.name else stored_ext)[key][bytes(digest)] = segment
        state_rows = self.session.read(lambda c: c.execute(
            """SELECT DISTINCT ON (m.key) m.key, m.segment_id, m.extension_segment_id, m.load_id = %s
               FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
               WHERE m.stream_id = %s AND (l.status = 'complete' OR m.load_id = %s) ORDER BY m.key, m.load_id DESC""",
            (load, stream, load)).fetchall())
        state = {key: (segment, extension) for key, segment, extension, _ in state_rows}
        mine = {key for key, _, _, own in state_rows if own}
        previous = {key: (segment, extension) for key, segment, extension in self.session.read(lambda c: c.execute(
            """SELECT DISTINCT ON (m.key) m.key, m.segment_id, m.extension_segment_id FROM panna.manifest m
               JOIN panna.loads l ON l.load_id = m.load_id
               WHERE m.stream_id = %s AND l.status = 'complete' ORDER BY m.key, m.load_id DESC""", (stream,)).fetchall())
            if segment is not None}
        digests, ext_digests = {}, {}
        if stored or previous or ext is not None:
            digests, ext_digests = key_digests(indexed, eligible)
        target = {}  # key id -> (its segment id, or None: new; its extension segment: an id, None (none) or NEW)
        for k in np.flatnonzero(eligible).tolist():
            key = indexed.keys[k]
            segment = stored.get(key, {}).get(digests[k]) if k in digests else None
            extension = stored_ext.get(key, {}).get(ext_digests[k], NEW) if ext_digests.get(k) is not None else None
            target[k] = (segment, extension)
        # A scoped run writes its plan's keys only (at most max_rows rows): no share of the stream to guard.
        if previous and self.scoped_keys(dataset) is None:
            here = set(indexed.keys)
            changed = sum(1 for k, key in enumerate(indexed.keys) if key in previous and
                          (not eligible[k] or target.get(k) != previous[key])) + sum(1 for key in previous if key not in here)
            share = changed / len(previous)
            if len(previous) >= self.churn_min and share > self.churn_limit and not self.allow_churn:
                self.session.unit(lambda c: c.execute("UPDATE panna.loads SET status = 'refused', reason = 'CHURN_GUARD' WHERE load_id = %s", (load,)))
                raise Stop("CHURN_GUARD", changed=changed, previous=len(previous))
        # What needs an entry in this load's manifest: a key whose current pair is not its target.
        need = np.zeros(len(indexed.keys), dtype=bool)
        reuse = []
        projected = 0
        for k, (segment, extension) in target.items():
            key = indexed.keys[k]
            if key in mine:
                continue
            if segment is None or extension is NEW:
                need[k] = True
                projected += int(indexed.counts[k]) * ((segment is None) * dataset.bytes_per_row
                                                       + (extension is NEW) * (ext.bytes_per_row if ext else 0))
            elif state.get(key) != (segment, extension):
                reuse.append(k)
        if self.ceiling is not None:
            size = self.session.read(lambda c: c.execute("SELECT pg_database_size(current_database())").fetchone()[0])
            if size + projected > self.ceiling:
                raise Stop("DATABASE_CEILING", projected_bytes=projected, database_bytes=size, ceiling_bytes=self.ceiling, name=asset.name)
        written = rows = 0
        chunk_no = self.session.read(lambda c: c.execute(
            "SELECT coalesce(max(chunk_no) + 1, 0) FROM panna.chunks WHERE load_id = %s", (load,)).fetchone()[0])
        # Reused segments: manifest entries only, in batches.
        for i in range(0, len(reuse), 5000):
            self.budget()
            items = [{"k": k, "table": None, "segment": target[k][0], "extension": target[k][1]} for k in reuse[i: i + 5000]]
            self.commit_chunk(dataset, indexed, stream, load, chunk_no, items, decisions, outcome_of)
            chunk_no += 1
        # Existing segments the new entries name: reused alone, or beside a new extension (loads.segments_reused).
        reused = len(reuse) + sum(1 for k in np.flatnonzero(need).tolist() if target[k][0] is not None)
        if not need.any():
            return 0, reused, 0, *self.all_digests(indexed, eligible, digests, ext_digests)
        pending, hashers, ext_hashers = defaultdict(list), defaultdict(hashlib.sha256), defaultdict(hashlib.sha256)
        valued, collected = defaultdict(int), defaultdict(int)
        chunk, chunk_rows, chunk_bytes = [], 0, 0
        for k, piece, span, ext_span, n in indexed.pieces(need):
            pending[k].append(piece)
            hashers[k].update(span)
            chunk_bytes += len(span)
            if ext_span is not None:
                ext_hashers[k].update(ext_span)
                valued[k] += n
                chunk_bytes += len(ext_span)
            collected[k] += piece.num_rows
            if collected[k] < indexed.counts[k]:
                continue
            digest = hashers.pop(k).digest()
            ext_digest = None
            if ext is not None:
                hashed = ext_hashers.pop(k).digest()
                ext_digest = hashed if valued.pop(k, 0) else None
            if (k in digests and digests[k] != digest) or (k in ext_digests and ext_digests[k] != ext_digest):
                raise Failure("UNSTABLE_READ", asset.name)
            digests[k] = digest
            if ext is not None:
                ext_digests[k] = ext_digest
            chunk.append({"k": k, "table": pa.Table.from_batches(pending.pop(k)), "digest": digest, "segment": target[k][0],
                          "ext_digest": ext_digest, "extension": target[k][1]})
            chunk_rows += int(indexed.counts[k])
            if chunk_rows >= self.chunk_rows or chunk_bytes >= CHUNK_BYTES:
                self.budget()
                w, r = self.commit_chunk(dataset, indexed, stream, load, chunk_no, chunk, decisions, outcome_of)
                written, rows = written + w, rows + r
                chunk_no += 1
                chunk, chunk_rows, chunk_bytes = [], 0, 0
        if chunk:
            self.budget()
            w, r = self.commit_chunk(dataset, indexed, stream, load, chunk_no, chunk, decisions, outcome_of)
            written, rows = written + w, rows + r
        return written, reused, rows, *self.all_digests(indexed, eligible, digests, ext_digests)

    def all_digests(self, indexed, eligible, digests, ext_digests):
        """The digests of every eligible key, for the completion's check: those of passes B and C, the others hashed."""
        missing = np.zeros(len(indexed.keys), dtype=bool)
        for k in np.flatnonzero(eligible).tolist():
            if k not in digests:
                missing[k] = True
        if missing.any():
            more, more_ext = key_digests(indexed, missing)
            digests.update(more)
            ext_digests.update(more_ext)
        return digests, ext_digests

    def commit_chunk(self, dataset, indexed, stream, load, chunk_no, items, decisions, outcome_of):
        """One transaction: the chunk's new segments of both datasets (ledger, rows, server digests checked) and the
        manifest entry of each of its keys, naming the key's pair. Returns the segments and rows the chunk holds."""
        started = time.monotonic()
        timing = {}
        ext = indexed.extension
        new = [(it, dataset, it["digest"]) for it in items if it["table"] is not None and it["segment"] is None]
        new += [(it, ext, it["ext_digest"]) for it in items if it["table"] is not None and it["extension"] is NEW]
        ids = []
        if new:
            ids = [r[0] for r in self.session.read(lambda c: c.execute(
                "SELECT nextval('panna.segments_segment_id_seq') FROM generate_series(1, %s)", (len(new),)).fetchall())]
        assigned, tables = {}, defaultdict(list)
        for (it, d, _), segment in zip(new, ids):
            assigned[(it["k"], d.name)] = segment
            table = it["table"].select([c.name for c in d.columns])
            n = table.num_rows
            table = table.add_column(0, "segment_id", pa.array(np.full(n, segment, dtype=np.int32)))
            table = table.add_column(1, "ordinal", pa.array(np.arange(n, dtype=np.int32)))
            tables[d.name].append(table)
        payloads = {name: as_csv(pa.concat_tables(t)) for name, t in tables.items()}
        datasets = [d for d in (dataset, ext) if d is not None and d.name in payloads]
        keys = [indexed.keys[it["k"]] for it in items]
        rows = sum(t.num_rows for ts in tables.values() for t in ts)
        payload_bytes = sum(len(b) for b in payloads.values())
        timing["encode_ms"] = round((time.monotonic() - started) * 1000, 1)

        def pair(it):
            segment = it["segment"] if it["segment"] is not None else assigned[(it["k"], dataset.name)]
            extension = assigned[(it["k"], ext.name)] if it["extension"] is NEW else it["extension"]
            return segment, extension

        def manifest_row(it):
            k = it["k"]
            runs = indexed.runs[k]
            flat = [v for run in runs for v in run] if len(runs) > 1 else None
            segment, extension = pair(it)
            return (stream, indexed.keys[k], load, segment, runs[0][0], int(indexed.counts[k]), flat, extension)

        def unit(c):
            began = time.monotonic()
            present = c.execute("SELECT count(*) FROM panna.manifest WHERE load_id = %s AND key = ANY(%s)", (load, keys)).fetchone()[0]
            if present == len(keys):
                return False
            if present:
                raise Failure("PARTIAL_CHUNK", load=load, chunk=chunk_no)
            if new:
                with c.cursor().copy("COPY panna.segments (segment_id, dataset, key, digest, rows, flag, day, first_load_id, first_as_of) FROM STDIN") as copy:
                    for (it, d, digest), segment in zip(new, ids):
                        k = it["k"]
                        copy.write_row((segment, d.name, indexed.keys[k], digest, int(indexed.counts[k]), outcome_of[k],
                                        decisions[k].day, load, self.as_of))
                for d in datasets:
                    columns = ", ".join(["segment_id", "ordinal"] + [f'"{col.name}"' for col in d.columns])
                    with c.cursor().copy(f"COPY panna_data.{d.name} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
                        copy.write(payloads[d.name])
                copied = time.monotonic()
                timing["copy_ms"] = round((copied - began) * 1000, 1)
                for d in datasets:
                    mine = [(it, digest, segment) for (it, dd, digest), segment in zip(new, ids) if dd is d]
                    server = dict(c.execute(encode.sql_digests(d.name, d.columns), ([s for _, _, s in mine],)).fetchall())
                    for it, digest, segment in mine:
                        if bytes(server.get(segment, b"")) != digest:
                            raise Failure("VERIFY_MISMATCH", key=indexed.keys[it["k"]], segment_id=segment, dataset=d.name)
                timing["verify_ms"] = round((time.monotonic() - copied) * 1000, 1)
            with c.cursor().copy("COPY panna.manifest (stream_id, key, load_id, segment_id, first_row, row_count, runs, "
                                 "extension_segment_id) FROM STDIN") as copy:
                for it in items:
                    copy.write_row(manifest_row(it))
            reused = sum(1 for it in items if it["segment"] is not None)
            c.execute("INSERT INTO panna.chunks (load_id, chunk_no, segments, rows, payload_bytes) VALUES (%s, %s, %s, %s, %s)",
                      (load, chunk_no, len(keys), rows, payload_bytes))
            c.execute("""UPDATE panna.loads SET segments_written = segments_written + %s, segments_reused = segments_reused + %s,
                         rows_written = rows_written + %s WHERE load_id = %s""", (len(new), reused, rows, load))
            c.execute("""UPDATE panna.runs SET heartbeat_at = now(), rows_written = rows_written + %s,
                         segments_written = segments_written + %s WHERE run_id = %s""", (rows, len(new), self.run_id))
            return True
        if self.session.unit(unit):
            self.rows_written += rows
            self.segments_written += len(new)
            self.out.emit("chunk", name=self.current, chunk=chunk_no, segments=len(new),
                          reused=sum(1 for it in items if it["segment"] is not None), rows=rows, bytes=payload_bytes,
                          unit_ms=round((time.monotonic() - started) * 1000, 1), **timing)
        return len(new), rows

    # --- D: the load's completion -----------------------------------------------------------------------------------
    def complete(self, dataset, asset, indexed, eligible, outcome_of, decisions, orphans, first_seen, stream, load, counts,
                 digests, ext_digests):
        present = set(indexed.keys[k] for k in np.flatnonzero(eligible).tolist())
        expected = {indexed.keys[k]: (digests[k], ext_digests.get(k)) for k in np.flatnonzero(eligible).tolist()}
        expected_rows = counts.get("eligible", 0) + counts.get("eligible_orphan", 0)
        scope_rows = []
        stored = {r[0]: r[1:] for r in self.session.read(lambda c: c.execute(
            "SELECT key, state, outcome, reason, day, vega_season, next_eligible_on FROM panna.scope WHERE dataset = %s",
            (dataset.name,)).fetchall())}
        keys = range(len(indexed.keys)) if dataset is registry.FIXTURES else orphans
        scoped = self.scoped_keys(dataset)
        if scoped is not None:
            keys = [k for k in keys if indexed.keys[k] in scoped]
        for k in keys:
            key, d, outcome = indexed.keys[k], decisions[k], outcome_of[k]
            following = d.day if outcome == "deferred" else None
            row = (d.state, outcome, d.reason, d.day, d.season, following)
            if stored.get(key) != row:
                scope_rows.append((dataset.name, key, *row, first_seen.get(key, self.as_of), load, self.as_of))

        def unit(c):
            # Conservation: what the base holds now, not what the loader remembers having written. A chunk acknowledged
            # then lost (a crash-restart), or any key whose current segment is not this generation's, stops here.
            # Both segments of the pair: an extension whose digest or row count is not the generation's is stale too.
            found = {key: (bytes(digest) if digest is not None else None, rows or 0,
                           bytes(ext_digest) if ext_digest is not None else None, ext_rows or 0)
                     for key, digest, rows, ext_digest, ext_rows in c.execute(
                """SELECT DISTINCT ON (m.key) m.key, s.digest, s.rows, x.digest, x.rows
                   FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
                   LEFT JOIN panna.segments s ON s.segment_id = m.segment_id
                   LEFT JOIN panna.segments x ON x.segment_id = m.extension_segment_id
                   WHERE m.stream_id = %s AND (l.status = 'complete' OR m.load_id = %s) AND m.key = ANY(%s)
                   ORDER BY m.key, m.load_id DESC""", (stream, load, list(expected))).fetchall()}
            none = (None, 0, None, 0)
            missing = sum(1 for key in expected if found.get(key, none)[0] is None)
            stale = sum(1 for key, (digest, ext_digest) in expected.items()
                        if found.get(key, none)[0] is not None
                        and (found[key][0] != digest or found[key][2] != ext_digest
                             or (ext_digest is not None and found[key][3] != found[key][1])))
            rows_found = sum(f[1] for f in found.values() if f[0] is not None)
            if missing or stale or rows_found != expected_rows:
                raise Failure("CONSERVATION", asset.name, missing=missing, stale=stale, rows=rows_found, expected_rows=expected_rows)
            c.execute("""INSERT INTO panna.manifest (stream_id, key, load_id, segment_id)
                         SELECT %s, m.key, %s, NULL FROM (
                           SELECT DISTINCT ON (m.key) m.key, m.segment_id FROM panna.manifest m JOIN panna.loads l ON l.load_id = m.load_id
                           WHERE m.stream_id = %s AND (l.status = 'complete' OR m.load_id = %s) ORDER BY m.key, m.load_id DESC) m
                         WHERE m.segment_id IS NOT NULL AND NOT (m.key = ANY(%s))
                           AND (%s::text[] IS NULL OR m.key = ANY(%s::text[]))
                         ON CONFLICT DO NOTHING""",
                      (stream, load, stream, load, list(present), sorted(scoped) if scoped is not None else None,
                       sorted(scoped) if scoped is not None else None))
            if scope_rows:
                c.execute("CREATE TEMPORARY TABLE panna_scope_in (LIKE panna.scope) ON COMMIT DROP")
                with c.cursor().copy("""COPY panna_scope_in (dataset, key, state, outcome, reason, day, vega_season, next_eligible_on,
                                        first_seen_on, decided_load_id, decided_as_of) FROM STDIN""") as copy:
                    for row in scope_rows:
                        copy.write_row(row)
                c.execute("""INSERT INTO panna.scope SELECT * FROM panna_scope_in
                             ON CONFLICT (dataset, key) DO UPDATE SET state = excluded.state, outcome = excluded.outcome,
                               reason = excluded.reason, day = excluded.day, vega_season = excluded.vega_season,
                               next_eligible_on = excluded.next_eligible_on, decided_load_id = excluded.decided_load_id,
                               decided_as_of = excluded.decided_as_of""")
            c.execute("UPDATE panna.loads SET status = 'complete', outcomes = %s, completed_at = now() WHERE load_id = %s",
                      (json.dumps(dict(counts)), load))
        self.session.unit(unit)


def today():
    return datetime.datetime.now(datetime.timezone.utc).date()
