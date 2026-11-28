"""S3 (backend/panna/FAILURE_MODES.md section 10): Opta's detailed actions stored once in core.match_actions.

`python -m panna actions run --plan PLAN` reads each `events_*.parquet` object of a pinned plan outside AWS and, per
object: (A) each row's key and H1's decision of it under the pinned fixtures index, the plan's selection; (B) each
selected eligible key's set digest over its 17 source values in the object's own types (no value refused for being
inexact: exceptions keep it), and the refusal of an unstorable text before anything is written; (C) the sets not yet
stored staged by COPY and stored by `panna.put_action_sets`, which verifies its own digest of what it stored, then each
subject's membership and revision placed by `panna.place_action_sets`, one transaction per chunk; (D) the load
completed after conservation is checked in the base. H1's runs, receipts, streams, loads, chunks and scope index are
the ledger; nothing is written to panna_data.opta_events or panna.segments.
"""

from collections import defaultdict
import datetime
import hashlib
import json
from pathlib import Path
import random
import time

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import psycopg

from . import encode, load, registry, sources
from .db import AlreadyRunning, LinkLost, Session
from .load import Failure, Stop

PRODUCT = "match_actions"
TEXT = ("match_id", "player_id", "player_name", "team_id", "qualifier_json", "competition", "season")
CODES = ("event_id", "type_id", "minute", "second", "outcome", "period_id")
COORDS = ("x", "y", "end_x", "end_y")
ACCEPT = {**{n: ("string", "large_string") for n in TEXT}, **{n: ("int64", "double") for n in CODES},
          **{n: ("double",) for n in COORDS}}
# Each source column's place in core.match_actions, in the staging table's order (the set holds match_id and labels).
DEST = (("event_id", "source_event_id"), ("type_id", "type_code"), ("period_id", "period_code"), ("minute", "minute"),
        ("second", "second"), ("outcome", "outcome_code"), ("x", "x"), ("y", "y"), ("end_x", "end_x"), ("end_y", "end_y"),
        ("team_id", "source_team_key"), ("player_id", "source_player_key"), ("player_name", "source_player_name"),
        ("qualifier_json", "qualifiers"))
BITS = ("event_id", "type_id", "period_id", "minute", "second", "outcome", "x", "y", "end_x", "end_y")
STAGE = ["stage_id", "set_no", "ordinal", *(d for _, d in DEST), "competition", "season", *(f"{n}_bits" for n in BITS)]
# Bytes a stored action takes with its share of the indexes, for the database ceiling (README, S3 measured).
BYTES_PER_ACTION = 330
REUSE_BATCH = 2000
NEEDS = (
    ("backend/sql/187_match_action_sets.sql",
     "to_regclass('core.observation_sets') IS NOT NULL AND to_regclass('core.observation_set_revisions') IS NOT NULL "
     "AND to_regclass('core.match_action_sets') IS NOT NULL AND to_regclass('core.match_actions') IS NOT NULL "
     "AND to_regclass('core.current_match_action_sets') IS NOT NULL AND to_regclass('core.match_action_qualifiers') IS NOT NULL"),
    ("backend/panna/sql/006_panna_actions.sql",
     "to_regclass('panna.action_field_exceptions') IS NOT NULL AND to_regclass('panna.source_set_memberships') IS NOT NULL "
     "AND to_regprocedure('panna.put_action_sets(bigint)') IS NOT NULL "
     "AND to_regprocedure('panna.action_batch(bigint, text)') IS NOT NULL "
     "AND to_regprocedure('panna.place_action_sets(bigint, bigint, timestamptz, text[], bigint[], text[], integer[])') IS NOT NULL "
     "AND to_regprocedure('panna.action_set_digest(bigint)') IS NOT NULL"),
)
_S = pa.large_string()


def subject_of(key):
    return f"match:{len(key.encode())}:{key}"


def native_of(subject):
    _, _, key = subject.split(":", 2)
    return key


def schema_key_of(schema, name):
    """The object's schema_key and {column: Arrow type}; anything but the 17 columns in accepted types is drift."""
    names = [f.name for f in schema]
    added = sorted(set(names) - set(ACCEPT))
    removed = sorted(set(ACCEPT) - set(names))
    retyped = sorted(f.name for f in schema if f.name in ACCEPT and str(f.type) not in ACCEPT[f.name])
    if added or removed or retyped or len(names) != len(set(names)):
        raise Failure("SCHEMA_DRIFT", name, added=added, removed=removed, retyped=retyped)
    key = "arrow:" + ",".join(f"{f.name}:{f.type}" + ("" if f.nullable else "!") for f in schema)
    return key, {f.name: str(f.type) for f in schema}


# --- the canonical encoding in the source's own types (FAILURE_MODES.md 10.1, content digest) ------------------------
def exact_column(array, kind):
    if isinstance(array, pa.ChunkedArray):
        array = array.combine_chunks()
    if kind in ("string", "large_string"):
        return encode.encode_column(array, "text")
    if kind == "int64":
        return encode.encode_column(array, "bigint")
    values = np.ascontiguousarray(array.fill_null(0.0).to_numpy(zero_copy_only=False), dtype=np.float64)
    out = pc.binary_join_element_wise(pa.scalar("D", _S), pc.cast(pa.array(values.view(np.int64), pa.int64()), _S),
                                      pa.scalar("", _S))
    return pc.if_else(pc.is_null(array), pa.scalar("N", _S), out)


def exact_rows(rows, order, kinds):
    parts = [exact_column(rows.column(n), kinds[n]) for n in order]
    joined = pc.binary_join_element_wise(*parts, pa.scalar("|", _S))
    out = pc.binary_join_element_wise(joined, pa.scalar("|\n", _S), pa.scalar("", _S))
    return out.combine_chunks() if isinstance(out, pa.ChunkedArray) else out


def pieces(path, codes, wanted, order, kinds, batch_rows=load.BATCH_ROWS):
    """For each key id set in `wanted`: (key id, its rows of one batch, their encoding), in source order."""
    if not wanted.any():
        return
    position = 0
    for batch in pq.ParquetFile(path).iter_batches(batch_size=batch_rows, columns=order, use_threads=True):
        n = batch.num_rows
        c = codes[position: position + n]
        position += n
        keep = np.flatnonzero((c >= 0) & wanted[np.maximum(c, 0)])
        if not len(keep):
            continue
        sel = keep[np.argsort(c[keep], kind="stable")]
        sc = c[sel]
        rows = batch.take(pa.array(sel, pa.int64()))
        spans = encode.Spans(exact_rows(rows, order, kinds))
        cuts = np.flatnonzero(np.diff(sc)) + 1
        starts = np.concatenate(([0], cuts))
        ends = np.concatenate((cuts, [len(sc)]))
        for a, b in zip(starts.tolist(), ends.tolist()):
            yield int(sc[a]), rows.slice(a, b - a), spans.span(a, b)


def unstorable(rows):
    """The first text column of `rows` holding U+0000 (PostgreSQL's text cannot), else None."""
    for name in TEXT:
        column = rows.column(name)
        if column.null_count < len(column) and pc.any(pc.match_substring(column.cast(_S), "\x00")).as_py():
            return name
    return None


def _bits(values, rows):
    hexes = [None] * len(values)
    raw = values.view(np.uint64)
    for i in rows.tolist():
        hexes[i] = "\\x" + int(raw[i]).to_bytes(8, "big").hex()
    return pa.array(hexes, pa.string())


def stage_table(stage, set_no, table, kinds):
    """A set's staging rows: the common format, plus the 8 IEEE bytes of each cell it cannot hold exactly."""
    n = table.num_rows
    out = {"stage_id": pa.array(np.full(n, stage, np.int64)), "set_no": pa.array(np.full(n, set_no, np.int32)),
           "ordinal": pa.array(np.arange(n, dtype=np.int32))}
    bits = {}
    for src, dest in DEST:
        a = table.column(src)
        if isinstance(a, pa.ChunkedArray):
            a = a.combine_chunks()
        kind = kinds[src]
        if src in COORDS or (src in CODES and kind == "double"):
            v = np.ascontiguousarray(a.fill_null(0.0).to_numpy(zero_copy_only=False), dtype=np.float64)
            valid = ~a.is_null().to_numpy(zero_copy_only=False)
            with np.errstate(invalid="ignore"):
                if src in CODES:
                    ok = (valid & np.isfinite(v) & (np.trunc(v) == v) & ~((v == 0) & np.signbit(v))
                          & (v >= -2.0 ** 63) & (v < 2.0 ** 63))
                    out[dest] = pa.array(np.where(ok, v, 0.0).astype(np.int64), pa.int64(), mask=~ok)
                else:
                    ok = valid & ~np.isnan(v)
                    out[dest] = pa.array(np.where(ok, v, 0.0), pa.float64(), mask=~ok)
            bad = np.flatnonzero(valid & ~ok)
            if len(bad):
                bits[src] = _bits(v, bad)
        elif src in CODES:
            out[dest] = a.cast(pa.int64())
        else:
            out[dest] = a.cast(_S)
    out["competition"] = table.column("competition").cast(_S)
    out["season"] = table.column("season").cast(_S)
    for src in BITS:
        out[f"{src}_bits"] = bits.get(src, pa.nulls(n, pa.string()))
    return pa.table({name: out[name] for name in STAGE})


def runs_text(runs):
    return "{" + ",".join(f"[{start},{start + length})" for start, length in runs) + "}"


class ActionRun(load.Run):
    """A run of S3: H1's run, receipts, loads, chunks, decisions and order of generations, with the action store."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.select = self.plan.get("select") or None
        self.totals = defaultdict(int)

    def check_registry(self):
        super().check_registry()
        for needs, present in NEEDS:
            if not self.session.read(lambda c: c.execute(f"SELECT {present}").fetchone()[0]):
                raise Failure("SCHEMA_VERSION", needs=needs)

    def selected(self, key, decision):
        s = self.select
        if not s:
            return True
        if "keys" in s and key not in set(s["keys"]):
            return False
        if "key_range" in s and not (s["key_range"][0] <= key < s["key_range"][1]):
            return False
        if "vega_seasons" in s and decision.season not in set(s["vega_seasons"]):
            return False
        return True

    # --- one object -------------------------------------------------------------------------------------------------
    def load_asset(self, asset):
        if asset.dataset != "opta_events":
            raise Failure("NOT_AN_EVENTS_OBJECT", asset.name)
        path, owned = sources.fetch(asset, self.scratch, self.scratch_ceiling)
        schema = pq.ParquetFile(path).schema_arrow
        schema_key, kinds = schema_key_of(schema, asset.name)
        order = [f.name for f in schema]
        indexed = load.Indexed(path, registry.EVENTS, None, asset.name)
        self.out.emit("asset", name=asset.name, sha256=asset.sha256, bytes=asset.bytes, source_rows=indexed.source_rows,
                      schema_key=schema_key)
        self.check_order(asset)
        decisions, orphans, first_seen, scope_load = self.decide(registry.EVENTS, indexed, asset)
        outcome_of, counts = {}, defaultdict(int)
        for k, key in enumerate(indexed.keys):
            d = decisions[k]
            outcome = d.outcome(self.as_of, orphan=k in orphans, first_seen=first_seen.get(key))
            if outcome in load.ELIGIBLE and not self.selected(key, d):
                outcome = "out_of_selection"
            outcome_of[k] = outcome
            counts[outcome] += int(indexed.counts[k])
        if indexed.null_rows:
            counts["unresolved"] += indexed.null_rows
        if sum(counts.values()) != indexed.source_rows:
            raise Failure("CONSERVATION", asset.name)
        wanted = np.array([outcome_of[k] in load.ELIGIBLE for k in range(len(indexed.keys))], dtype=bool)
        # B: each wanted key's digest, and nothing stored if a text cannot be (before any write).
        hashers = defaultdict(hashlib.sha256)
        for k, rows, span in pieces(path, indexed.codes, wanted, order, kinds):
            bad = unstorable(rows)
            if bad:
                raise Failure("UNSTORABLE_TEXT", asset.name, column=bad)
            hashers[k].update(span)
        digests = {k: h.digest() for k, h in hashers.items()}

        def begin(c):
            c.execute("""INSERT INTO panna.receipts (origin, container, name, asset_id, sha256, bytes, updated_at, source_rows,
                                                     row_groups, schema, first_run_id)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (origin, container, name, sha256) DO NOTHING""",
                      (asset.origin, asset.container, asset.name, asset.asset_id, bytes.fromhex(asset.sha256), asset.bytes,
                       asset.updated_at, indexed.source_rows, indexed.row_groups,
                       json.dumps([[f.name, str(f.type)] for f in schema]), self.run_id))
            receipt = c.execute("SELECT receipt_id FROM panna.receipts WHERE origin = %s AND container = %s AND name = %s AND sha256 = %s",
                                (asset.origin, asset.container, asset.name, bytes.fromhex(asset.sha256))).fetchone()[0]
            c.execute("INSERT INTO panna.streams (dataset, origin, container, name) VALUES ('opta_events', %s, %s, %s) ON CONFLICT DO NOTHING",
                      (asset.origin, asset.container, asset.name))
            stream = c.execute("SELECT stream_id FROM panna.streams WHERE origin = %s AND container = %s AND name = %s",
                               (asset.origin, asset.container, asset.name)).fetchone()[0]
            c.execute("""INSERT INTO panna.loads (stream_id, receipt_id, run_id, as_of, scope_load_id) VALUES (%s, %s, %s, %s, %s)
                         ON CONFLICT (run_id, stream_id, receipt_id) DO NOTHING""", (stream, receipt, self.run_id, self.as_of, scope_load))
            load_id, status = c.execute("SELECT load_id, status FROM panna.loads WHERE run_id = %s AND stream_id = %s AND receipt_id = %s",
                                        (self.run_id, stream, receipt)).fetchone()
            batch, effective = c.execute("SELECT batch_id, effective_at FROM panna.action_batch(%s::bigint, %s::text)",
                                         (load_id, schema_key)).fetchone()
            return stream, load_id, status, batch, effective
        stream, load_id, status, batch, effective = self.session.unit(begin)
        line = {"name": asset.name, "status": "complete", "sets_written": 0, "sets_reused": 0, "actions_written": 0,
                "memberships_written": 0, "revisions_written": 0, "conflicts": 0, "outcomes": dict(counts)}
        if status == "complete":
            self.out.emit("load", **line, resumed=True)
            self.evict(path, owned)
            return
        ctx = {"asset": asset, "indexed": indexed, "stream": stream, "load": load_id, "batch": batch, "effective": effective,
               "schema_key": schema_key, "kinds": kinds, "order": order, "path": path, "line": line}
        self.current = asset.name
        self.write(ctx, wanted, digests)
        self.complete(ctx, wanted, digests, decisions, orphans, first_seen, outcome_of, counts)
        self.out.emit("load", **line,
                      **({"absent_from_object": ctx["absent"]} if ctx.get("absent") is not None else {}))
        self.evict(path, owned)

    # --- C: the sets not stored, and every subject placed ------------------------------------------------------------
    def write(self, ctx, wanted, digests):
        indexed = ctx["indexed"]
        keys = {k: indexed.keys[k] for k in np.flatnonzero(wanted).tolist()}
        subjects = {k: subject_of(key) for k, key in keys.items()}
        known, current, state = {}, {}, {}
        listed = list(subjects.values())
        for subject, digest, set_id, rows in self.session.read(lambda c: c.execute(
                """SELECT subject_key, content_sha256, id, row_count FROM core.observation_sets
                   WHERE origin = 'opta' AND product = %s AND schema_key = %s AND subject_key = ANY(%s)""",
                (PRODUCT, ctx["schema_key"], listed)).fetchall()):
            known[(subject, bytes(digest))] = set_id
        for subject, set_id in self.session.read(lambda c: c.execute(
                """SELECT subject_key, set_id FROM core.observation_set_revisions
                   WHERE origin = 'opta' AND product = %s AND is_current AND subject_key = ANY(%s)""", (PRODUCT, listed)).fetchall()):
            current[subject] = set_id
        for subject, set_id, runs in self.session.read(lambda c: c.execute(
                """SELECT DISTINCT ON (m.subject_key) m.subject_key, m.set_id, m.source_runs::text
                   FROM panna.source_set_memberships m JOIN panna.action_batches b ON b.id = m.batch_id
                   WHERE m.product = %s AND m.subject_key = ANY(%s) AND b.object_name = %s
                   ORDER BY m.subject_key, (m.batch_id = %s) DESC, b.issued_at DESC NULLS LAST, b.id DESC""",
                (PRODUCT, listed, ctx["asset"].name, ctx["batch"])).fetchall()):
            state[subject] = (set_id, runs)
        ctx["runs"] = {k: runs_text(indexed.runs[k]) for k in keys}
        need, place = np.zeros(len(indexed.keys), dtype=bool), []
        for k in keys:
            set_id = known.get((subjects[k], digests[k]))
            if set_id is None:
                need[k] = True
            elif current.get(subjects[k]) != set_id or state.get(subjects[k]) != (set_id, ctx["runs"][k]):
                place.append(k)
        if self.ceiling is not None:
            projected = int(indexed.counts[need].sum()) * BYTES_PER_ACTION
            size = self.session.read(lambda c: c.execute("SELECT pg_database_size(current_database())").fetchone()[0])
            if size + projected > self.ceiling:
                raise Stop("DATABASE_CEILING", projected_bytes=projected, database_bytes=size, ceiling_bytes=self.ceiling,
                           name=ctx["asset"].name)
        chunk_no = self.session.read(lambda c: c.execute(
            "SELECT coalesce(max(chunk_no) + 1, 0) FROM panna.chunks WHERE load_id = %s", (ctx["load"],)).fetchone()[0])
        for i in range(0, len(place), REUSE_BATCH):
            self.budget()
            items = [{"k": k, "subject": subjects[k], "table": None, "digest": digests[k],
                      "set_id": known[(subjects[k], digests[k])], "rows": int(indexed.counts[k])} for k in place[i: i + REUSE_BATCH]]
            self.commit_chunk(ctx, chunk_no, items)
            chunk_no += 1
        if not need.any():
            return
        pending, collected, hashers = defaultdict(list), defaultdict(int), {}
        chunk, chunk_rows = [], 0
        for k, rows, span in pieces(ctx["path"], indexed.codes, need, ctx["order"], ctx["kinds"]):
            pending[k].append(rows)
            hashers.setdefault(k, hashlib.sha256()).update(span)
            collected[k] += rows.num_rows
            if collected[k] < indexed.counts[k]:
                continue
            if hashers.pop(k).digest() != digests[k]:
                raise Failure("UNSTABLE_READ", ctx["asset"].name)
            chunk.append({"k": k, "subject": subjects[k], "table": pa.Table.from_batches(pending.pop(k)),
                          "digest": digests[k], "set_id": None, "rows": int(indexed.counts[k])})
            chunk_rows += int(indexed.counts[k])
            if chunk_rows >= self.chunk_rows:
                self.budget()
                self.commit_chunk(ctx, chunk_no, chunk)
                chunk_no += 1
                chunk, chunk_rows = [], 0
        if chunk:
            self.budget()
            self.commit_chunk(ctx, chunk_no, chunk)

    def commit_chunk(self, ctx, chunk_no, items):
        """One transaction: the chunk's ledger row first (a retried unit that finds it committed does nothing), its new
        sets staged and stored (the server's digests checked), then every subject placed."""
        started = time.monotonic()
        new = [it for it in items if it["table"] is not None]
        stage = random.getrandbits(62) + 1
        payload = load.as_csv(pa.concat_tables([stage_table(stage, no, it["table"], ctx["kinds"]) for no, it in enumerate(new)])) if new else b""
        actions = sum(it["rows"] for it in new)
        columns = ", ".join(STAGE)

        def unit(c):
            began = c.execute("""INSERT INTO panna.chunks (load_id, chunk_no, segments, rows, payload_bytes) VALUES (%s, %s, %s, %s, %s)
                                 ON CONFLICT DO NOTHING RETURNING 1""", (ctx["load"], chunk_no, len(new), actions, len(payload))).fetchone()
            if began is None:
                return None
            made = {}
            if new:
                with c.cursor().copy("COPY panna.action_stage_sets (stage_id, set_no, subject_key, schema_key, content_sha256, "
                                     "row_count) FROM STDIN") as copy:
                    for no, it in enumerate(new):
                        copy.write_row((stage, no, it["subject"], ctx["schema_key"], it["digest"], it["rows"]))
                with c.cursor().copy(f"COPY panna.action_stage ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
                    copy.write(payload)
                for no, set_id, created in c.execute("SELECT set_no, set_id, created FROM panna.put_action_sets(%s::bigint)",
                                                     (stage,)).fetchall():
                    made[no] = (set_id, created)
            by_item = {id(it): made[no] for no, it in enumerate(new)}
            set_ids = [it["set_id"] if it["table"] is None else by_item[id(it)][0] for it in items]
            placed = c.execute("SELECT subject_key, membership, revision FROM panna.place_action_sets("
                               "%s::bigint, %s::bigint, %s::timestamptz, %s::text[], %s::bigint[], %s::text[], %s::integer[])",
                               (ctx["load"], ctx["batch"], ctx["effective"], [it["subject"] for it in items], set_ids,
                                [ctx["runs"][it["k"]] for it in items], [it["rows"] for it in items])).fetchall()
            written = sum(1 for v in made.values() if v[1])
            rows = sum(it["rows"] for it in new if by_item[id(it)][1])
            counts = {"sets_written": written, "sets_reused": len(items) - written, "actions_written": rows,
                      "memberships_written": sum(1 for _, m, _ in placed if m),
                      "revisions_written": sum(1 for _, _, r in placed if r in ("first", "revised", "historical")),
                      "conflicts": sum(1 for _, _, r in placed if r == "conflict")}
            c.execute("""UPDATE panna.loads SET segments_written = segments_written + %s, segments_reused = segments_reused + %s,
                         rows_written = rows_written + %s WHERE load_id = %s""", (written, len(items) - written, rows, ctx["load"]))
            c.execute("""UPDATE panna.runs SET heartbeat_at = now(), rows_written = rows_written + %s,
                         segments_written = segments_written + %s WHERE run_id = %s""", (rows, written, self.run_id))
            return counts
        counts = self.session.unit(unit)
        if new:
            # The staged rows are gone with the unit; their space is made reusable now (FAILURE_MODES.md 10.1, Units).
            self.session.read(lambda c: c.execute("VACUUM (SKIP_LOCKED) panna.action_stage, panna.action_stage_sets"))
        if counts is None:
            return
        for name, value in counts.items():
            ctx["line"][name] += value
        self.rows_written += counts["actions_written"]
        self.segments_written += counts["sets_written"]
        self.out.emit("chunk", name=self.current, chunk=chunk_no, subjects=len(items), bytes=len(payload),
                      unit_ms=round((time.monotonic() - started) * 1000, 1), **counts)

    # --- D: the load's completion -------------------------------------------------------------------------------------
    def complete(self, ctx, wanted, digests, decisions, orphans, first_seen, outcome_of, counts):
        indexed = ctx["indexed"]
        expected = {subject_of(indexed.keys[k]): (digests[k], int(indexed.counts[k]), ctx["runs"][k])
                    for k in np.flatnonzero(wanted).tolist()}
        scope_rows = []
        if not self.select:
            stored = {r[0]: r[1:] for r in self.session.read(lambda c: c.execute(
                "SELECT key, state, outcome, reason, day, vega_season, next_eligible_on FROM panna.scope WHERE dataset = 'opta_events'"
            ).fetchall())}
            for k in orphans:
                key, d, outcome = indexed.keys[k], decisions[k], outcome_of[k]
                row = (d.state, outcome, d.reason, d.day, d.season, d.day if outcome == "deferred" else None)
                if stored.get(key) != row:
                    scope_rows.append(("opta_events", key, *row, first_seen.get(key, self.as_of), ctx["load"], self.as_of))
            here = [subject_of(key) for key in indexed.keys]
            ctx["absent"] = self.session.read(lambda c: c.execute(
                """SELECT count(DISTINCT m.subject_key) FROM panna.source_set_memberships m
                   JOIN panna.action_batches b ON b.id = m.batch_id
                   WHERE m.product = %s AND b.object_name = %s AND b.id <> %s
                     AND m.set_id IS NOT NULL AND NOT (m.subject_key = ANY(%s))""",
                (PRODUCT, ctx["asset"].name, ctx["batch"], here)).fetchone()[0])

        def unit(c):
            found = {subject: (bytes(digest) if digest is not None else None, rows, runs) for subject, digest, rows, runs in c.execute(
                """SELECT u.subject, s.content_sha256, s.row_count, st.source_runs::text
                   FROM unnest(%s::text[]) AS u (subject)
                   LEFT JOIN LATERAL (
                     SELECT m.set_id, m.source_runs FROM panna.source_set_memberships m
                     JOIN panna.action_batches b ON b.id = m.batch_id
                     WHERE m.product = %s AND m.subject_key = u.subject AND b.object_name = %s
                     ORDER BY (m.batch_id = %s) DESC, b.issued_at DESC NULLS LAST, b.id DESC LIMIT 1) st ON true
                   LEFT JOIN core.observation_sets s ON s.id = st.set_id""",
                (list(expected), PRODUCT, ctx["asset"].name, ctx["batch"])).fetchall()}
            wrong = [subject for subject, want in expected.items() if found.get(subject) != want]
            if wrong:
                raise Failure("CONSERVATION", ctx["asset"].name, subjects=len(wrong))
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
                      (json.dumps(dict(counts)), ctx["load"]))
        self.session.unit(unit)


# --- the command ------------------------------------------------------------------------------------------------------
class Refused(Exception):
    def __init__(self, code, **fields):
        super().__init__(code)
        self.code, self.fields = code, fields


def checked_plan(plan):
    """A pinned plan: its as-of, the fixtures generation it decides by, its events objects, its selection."""
    try:
        as_of = datetime.date.fromisoformat(plan["as_of"])
    except (KeyError, TypeError, ValueError):
        raise Refused("AS_OF_UNREADABLE") from None
    if as_of > load.today():
        raise Refused("AS_OF_IN_FUTURE", as_of=plan["as_of"])
    pin = plan.get("fixtures") or ""
    if not pin.startswith("sha256:") or len(pin) != 71:
        raise Refused("FIXTURES_PIN_REQUIRED")
    if not plan.get("assets"):
        raise Refused("NOTHING_NAMED")
    for entry in plan["assets"]:
        if not registry.EVENTS.matches(entry.get("container", registry.RELEASE), entry.get("name", "")) or len(entry.get("sha256", "")) != 64:
            raise Refused("NOT_AN_EVENTS_OBJECT", name=entry.get("name"))
        entry["dataset"] = "opta_events"
    select = plan.get("select")
    if select is not None:
        if not isinstance(select, dict) or not select or set(select) - {"keys", "key_range", "vega_seasons"}:
            raise Refused("SELECT_UNREADABLE")
        if "keys" in select and not (isinstance(select["keys"], list) and all(isinstance(k, str) for k in select["keys"])):
            raise Refused("SELECT_UNREADABLE")
        if "key_range" in select and not (isinstance(select["key_range"], list) and len(select["key_range"]) == 2
                                          and all(isinstance(k, str) for k in select["key_range"])):
            raise Refused("SELECT_UNREADABLE")
        if "vega_seasons" in select and not all(isinstance(s, int) for s in select["vega_seasons"]):
            raise Refused("SELECT_UNREADABLE")
    plan["product"] = PRODUCT
    return as_of


def run_plan(args, out, plan, url, runner, scratch, bounds_of, token=None):
    as_of = checked_plan(plan)
    try:
        session = Session(url, via=args.via, out=out)
    except AlreadyRunning:
        out.emit("run_end", status="already_running", reason="ALREADY_RUNNING")
        return 4
    except psycopg.OperationalError as error:
        out.emit("run_end", status="failed", reason="CONNECTION_FAILED", sqlstate=getattr(error, "sqlstate", None))
        return 1
    bounds = bounds_of(args, plan.get("bounds"))
    plan["bounds"] = bounds
    try:
        run = ActionRun(session, out, as_of, plan, runner, token=token, chunk_rows=bounds["chunk_rows"],
                        max_seconds=args.max_seconds, ceiling=bounds["database_ceiling_bytes"],
                        fixtures_pin=plan["fixtures"][7:], scratch=scratch, scratch_ceiling=args.scratch_ceiling_bytes,
                        keep_scratch=args.keep_scratch)
        try:
            return run.execute()
        except Failure as failure:
            out.emit("error", code=failure.code, name=failure.name, **failure.fields)
            out.emit("run_end", status="failed", reason=failure.code)
            return 1
        except LinkLost as lost:
            out.emit("run_end", status="partial", reason=str(lost))
            return 3
        except psycopg.Error as error:
            out.emit("run_end", status="failed", reason="DATABASE_ERROR", sqlstate=getattr(error, "sqlstate", None),
                     error=type(error).__name__, detail=str(error).splitlines()[0][:300])
            return 1
    finally:
        session.close()


def add_parser(sub, add_database, add_bounds):
    p = sub.add_parser("actions", help="S3: Opta's detailed actions stored once in core.match_actions")
    steps = p.add_subparsers(dest="step", required=True)
    run = steps.add_parser("run", help="load the events objects of a pinned plan")
    add_database(run)
    add_bounds(run)
    run.add_argument("--plan", required=True)
    run.add_argument("--scratch", required=True)
    retry = steps.add_parser("retry", help="resume the last action run that did not complete, with its plan and bounds")
    add_database(retry)
    add_bounds(retry)
    retry.add_argument("--run", type=int)
    retry.add_argument("--scratch")
    retry.add_argument("--force", action="store_true")
    status = steps.add_parser("status", help="what the action store holds")
    add_database(status)
    verify = steps.add_parser("verify", help="the server's digest of each stored set against its content digest")
    add_database(verify)
    verify.add_argument("--run", type=int)


def main(args, out, url, runner, bounds_of, default_scratch):
    try:
        if args.step == "run":
            plan = json.loads(Path(args.plan).read_text())
            return run_plan(args, out, plan, url, runner, str(Path(args.scratch).resolve()), bounds_of)
        if args.step == "retry":
            return retry(args, out, url, runner, bounds_of, default_scratch)
        if args.step == "status":
            return status(args, out, url)
        return verify(args, out, url)
    except Refused as refused:
        out.emit("run_end", status="refused", reason=refused.code, **refused.fields)
        return 2


def retry(args, out, url, runner, bounds_of, default_scratch):
    session = Session(url, via=args.via, lock=False)
    try:
        found = session.read(lambda c: c.execute(
            "SELECT run_id, token, plan FROM panna.runs WHERE status <> 'complete' AND plan->>'product' = %s"
            + (" AND run_id = %s" if args.run else "") + " ORDER BY run_id DESC LIMIT 1",
            (PRODUCT, args.run) if args.run else (PRODUCT,)).fetchone())
        later = None
        if found is not None:
            later = session.read(lambda c: c.execute(
                "SELECT max(run_id) FROM panna.runs WHERE run_id > %s AND status = 'complete' AND plan->>'product' = %s",
                (found[0], PRODUCT)).fetchone()[0])
    finally:
        session.close()
    if found is None:
        out.emit("run_end", status="complete", reason="NOTHING_TO_RETRY")
        return 0
    run_id, token, plan = found
    if later is not None and not args.force:
        raise Refused("RETRY_STALE", run_id=run_id, later_run=later)
    out.emit("retry", run_id=run_id, forced=later is not None)
    scratch = args.scratch or plan.get("scratch") or str(default_scratch)
    return run_plan(args, out, plan, url, runner, scratch, bounds_of, token=str(token))


def status(args, out, url):
    session = Session(url, via=args.via, lock=False)
    try:
        def read(c):
            subjects, resolved = c.execute("SELECT count(*), count(match_id) FROM core.current_match_action_sets").fetchone()
            sets, actions = c.execute("SELECT count(*), coalesce(sum(row_count), 0) FROM core.observation_sets WHERE product = %s",
                                      (PRODUCT,)).fetchone()
            exceptions = c.execute("SELECT count(*) FROM panna.action_field_exceptions").fetchone()[0]
            memberships = c.execute("SELECT count(*) FROM panna.source_set_memberships WHERE product = %s", (PRODUCT,)).fetchone()[0]
            loads = dict(c.execute("""SELECT l.status, count(*) FROM panna.loads l JOIN panna.runs u ON u.run_id = l.run_id
                                      WHERE u.plan->>'product' = %s GROUP BY 1""", (PRODUCT,)).fetchall())
            return {"subjects": subjects, "resolved": resolved, "pending_identity": subjects - resolved, "sets": sets,
                    "actions": int(actions), "exceptions": exceptions, "memberships": memberships, "loads": loads}
        out.emit("status", **session.read(read))
    finally:
        session.close()
    return 0


def verify(args, out, url):
    session = Session(url, via=args.via, lock=False)
    mismatches = 0
    try:
        if args.run:
            ids = [r[0] for r in session.read(lambda c: c.execute(
                """SELECT DISTINCT m.set_id FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id
                   JOIN panna.receipts r ON r.receipt_id = l.receipt_id
                   JOIN panna.action_batches b ON b.object_name = s.name AND b.content_sha256 = r.sha256
                   JOIN panna.source_set_memberships m ON m.batch_id = b.id AND m.product = %s
                   WHERE l.run_id = %s AND m.set_id IS NOT NULL ORDER BY 1""", (PRODUCT, args.run)).fetchall())]
        else:
            ids = [r[0] for r in session.read(lambda c: c.execute(
                "SELECT id FROM core.observation_sets WHERE product = %s ORDER BY id", (PRODUCT,)).fetchall())]
        for i in range(0, len(ids), 500):
            part = ids[i: i + 500]
            for set_id, subject, ok in session.read(lambda c: c.execute(
                    """SELECT o.id, o.subject_key, panna.action_set_digest(o.id) = o.content_sha256
                       FROM core.observation_sets o WHERE o.id = ANY(%s) ORDER BY o.id""", (part,)).fetchall()):
                if not ok:
                    mismatches += 1
                    out.emit("mismatch", set_id=set_id, subject_key=subject)
        out.emit("verify", sets=len(ids), mismatches=mismatches)
    finally:
        session.close()
    return 1 if mismatches else 0
