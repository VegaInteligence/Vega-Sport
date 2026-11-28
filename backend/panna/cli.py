"""python -m panna probe | prep | run | retry | status | verify | explain (backend/panna/README.md).

Every command prints JSON lines (counts, digests, names, reason codes; never a row value, a password or a URL) and
exits 0 complete, 1 failed, 2 refused input, 3 partial (resume with `retry`), 4 another runner holds the lock."""

import argparse
from collections import Counter, defaultdict
import datetime
import hashlib
import json
import os
from pathlib import Path
import socket
import sys

import numpy as np
import psycopg

from . import registry, scope, sources
from .db import AlreadyRunning, LinkLost, Session
from .load import ELIGIBLE, INDEX_LOAD, Failure, Output, Run, checked, today

DEFAULT_SCRATCH = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "vega-panna"


def add_selection(p):
    p.add_argument("--release", default=registry.RELEASE, help="the release tag (opta-latest)")
    p.add_argument("--repo", default=registry.REPO)
    p.add_argument("--github-api", default=registry.GITHUB_API)
    p.add_argument("--asset", action="append", default=[], help="an asset of the release, by its exact name")
    p.add_argument("--family", action="append", default=[], choices=sorted(registry.FAMILIES),
                   help="every asset of a family, sorted by name")
    p.add_argument("--manifest", help="a frozen manifest: {assets: [{name, sha256, bytes, path | url}]}; no listing")
    p.add_argument("--blobs", help="with --manifest: the directory holding <sha256> files")


# A run's bounds, kept in its plan so that `retry` keeps them (GH278-aw); a bound given to `retry` replaces the stored
# one. --max-seconds is a budget of one process, never stored.
BOUNDS = {"chunk_rows": 50_000, "database_ceiling_bytes": None, "churn_limit": 0.5, "churn_min_segments": 100,
          "allow_churn": False}


def add_bounds(p):
    p.add_argument("--chunk-rows", type=int)
    p.add_argument("--max-seconds", type=float)
    p.add_argument("--database-ceiling-bytes", type=int)
    p.add_argument("--churn-limit", type=float)
    p.add_argument("--churn-min-segments", type=int)
    p.add_argument("--allow-churn", action="store_const", const=True)
    p.add_argument("--scratch-ceiling-bytes", type=int)
    p.add_argument("--keep-scratch", action="store_true")


def bounds_of(args, stored=None):
    """The bounds a run applies: given on its command line, else stored in its plan, else the defaults."""
    stored = stored or {}
    return {name: getattr(args, name) if getattr(args, name, None) is not None else stored.get(name, default)
            for name, default in BOUNDS.items()}


def add_database(p):
    p.add_argument("--database-url", help="else V2_PANNA_DATABASE_URL")
    p.add_argument("--via", help="HOST:PORT of a local port forward to the database (TLS still verifies its name)")


def parser():
    top = argparse.ArgumentParser(prog="python -m panna")
    sub = top.add_subparsers(dest="command", required=True)
    probe = sub.add_parser("probe", help="each asset's outcomes at an as-of, no database")
    add_selection(probe)
    probe.add_argument("--as-of")
    probe.add_argument("--scratch", default=str(DEFAULT_SCRATCH))
    probe.add_argument("--keys", action="store_true", help="also each key's outcome")
    prep = sub.add_parser("prep", help="fetch and check the assets, write the plan a run follows")
    add_selection(prep)
    add_database(prep)
    prep.add_argument("--as-of")
    prep.add_argument("--scratch", default=str(DEFAULT_SCRATCH))
    prep.add_argument("--plan-out", required=True)
    prep.add_argument("--fixtures", default="current")
    run = sub.add_parser("run", help="load the assets named, or a plan")
    add_selection(run)
    add_database(run)
    add_bounds(run)
    run.add_argument("--as-of")
    run.add_argument("--plan")
    run.add_argument("--scratch", default=str(DEFAULT_SCRATCH))
    run.add_argument("--fixtures", default="current", help="current, or sha256:<hex> of the fixtures the events need")
    retry = sub.add_parser("retry", help="resume the last run that did not complete, with its plan and its bounds")
    add_database(retry)
    add_bounds(retry)
    retry.add_argument("--run", type=int)
    retry.add_argument("--scratch")
    retry.add_argument("--force", action="store_true", help="resume it even though a later run completed")
    explain = sub.add_parser("explain", help="the plan of the server's verification of the latest segments")
    add_database(explain)
    explain.add_argument("--dataset", required=True, choices=sorted(registry.TABLES))
    explain.add_argument("--last-segments", type=int, default=20)
    status = sub.add_parser("status", help="what the base holds")
    add_database(status)
    verify = sub.add_parser("verify", help="the server's digest of each segment against the ledger")
    add_database(verify)
    verify.add_argument("--run", type=int)
    from . import actions, pilot
    pilot.add_parser(sub, add_database)
    actions.add_parser(sub, add_database, add_bounds)
    return top


def runner():
    if os.environ.get("GITHUB_RUN_ID"):
        return f"gh-{os.environ['GITHUB_RUN_ID']}-{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"
    return f"host:{socket.gethostname()}"[:200]


class Refused(Exception):
    def __init__(self, code, **fields):
        super().__init__(code)
        self.code, self.fields = code, fields


def as_of_of(text):
    day = today()
    if text is None:
        return day
    try:
        value = datetime.date.fromisoformat(text)
    except ValueError:
        raise Refused("AS_OF_UNREADABLE") from None
    if value > day:
        raise Refused("AS_OF_IN_FUTURE", as_of=text, today=day.isoformat())
    return value


def fixtures_pin(text):
    if not text or text == "current":
        return None
    if not text.startswith("sha256:") or len(text) != 71:
        raise Refused("FIXTURES_PIN_UNREADABLE")
    return text[7:]


def plan_of(args, as_of):
    if args.manifest:
        available = sources.read_manifest(args.manifest, args.blobs)
        families = args.family or ([] if args.asset else list(registry.FAMILIES))
    else:
        if not args.asset and not args.family:
            raise Refused("NOTHING_NAMED", hint="--asset, --family or --manifest")
        available = sources.list_release(args.github_api, args.repo, args.release, os.environ.get("GITHUB_TOKEN"))
        families = args.family
    chosen = sources.select(available, args.asset, families)
    return {"as_of": as_of.isoformat(), "release": args.release, "assets": [a.to_plan() for a in chosen],
            "fixtures": getattr(args, "fixtures", "current"), "scratch": str(Path(args.scratch).resolve())}


def database_url(args):
    url = args.database_url or os.environ.get("V2_PANNA_DATABASE_URL")
    if not url:
        raise Refused("NO_DATABASE_URL", hint="--database-url or V2_PANNA_DATABASE_URL")
    return url


def classify(plan, scratch, as_of, out, keys=False, session=None, digests=False):
    """probe and prep: each asset fetched, checked and decided; (summaries, {refused name: code}). An asset refused is
    named and the others still read. With a session, the fixtures index of the base serves events whose fixtures are
    not in the plan."""
    index = {"decided": None}
    summaries, refused = [], {}
    for entry in plan["assets"]:
        try:
            summaries.append(classify_one(entry, scratch, as_of, out, keys, session, digests, index))
        except Failure as failure:
            refused[entry["name"]] = failure.code
            out.emit("error", code=failure.code, name=failure.name or entry["name"], **failure.fields)
        except sources.SourceError as error:
            refused[entry["name"]] = error.code
            out.emit("error", code=error.code, name=error.name or entry["name"], detail=error.detail)
    return summaries, refused


def classify_one(entry, scratch, as_of, out, keys, session, digests, index):
    """One asset fetched, its schema and conversions checked, each row decided; its summary (emitted)."""
    asset = sources.Asset(**entry)
    dataset = registry.DATASETS[asset.dataset]
    if dataset.depends and index.get("failed"):
        raise Failure("DEPENDENCY_MISSING", asset.name, needs=dataset.depends)
    try:
        path, _ = sources.fetch(asset, scratch)
        entry["path"] = str(path)
        entry["sha256"] = asset.sha256
        indexed = checked(dataset, path, asset.name)
    except (Failure, sources.SourceError):
        if dataset is registry.FIXTURES:
            index["failed"] = True
        raise
    orphans = set()
    if dataset is registry.FIXTURES:
        by_key = scope.decide_fixtures(indexed.fixture_rows)
        decisions = {k: by_key[key] for k, key in enumerate(indexed.keys)}
        index["decided"] = by_key
        out.emit("audit", name=asset.name, labelled_out_played_from_2021=scope.audit(indexed.fixture_rows))
    else:
        if index["decided"] is None and session is not None and session.read(lambda c: c.execute(INDEX_LOAD).fetchone()):
            rows = session.read(lambda c: c.execute(
                "SELECT key, state, reason, day, vega_season FROM panna.scope WHERE dataset = 'opta_fixtures'").fetchall())
            index["decided"] = {k: scope.Decision(s, r, d, v) for k, s, r, d, v in rows} or None
        if index["decided"] is None:
            raise Failure("DEPENDENCY_MISSING", asset.name, needs="opta_fixtures")
        decided = index["decided"]
        decisions = {}
        for k, key in enumerate(indexed.keys):
            if key in decided:
                decisions[k] = decided[key]
            else:
                decisions[k] = scope.decide_orphan(indexed.editions[k])
                orphans.add(k)
    outcomes = Counter()
    outcome_of = {}
    for k, key in enumerate(indexed.keys):
        o = decisions[k].outcome(as_of, orphan=k in orphans, first_seen=as_of)
        outcome_of[k] = o
        outcomes[o] += int(indexed.counts[k])
        if keys:
            out.emit("key", dataset=dataset.name, key=key, outcome=o, reason=decisions[k].reason)
    if indexed.null_rows:
        outcomes["unresolved"] += indexed.null_rows
    summary = {"name": asset.name, "dataset": dataset.name, "sha256": asset.sha256, "source_rows": indexed.source_rows,
               "outcomes": dict(outcomes)}
    if indexed.conversions:
        summary["conversions"] = {c: v["from"] for c, v in indexed.conversions.items()}
    if indexed.extension:
        summary["extension"] = indexed.extension.name
    if digests:
        summary["rows_to_write"] = rows_to_write(dataset, indexed, outcome_of, session)
        summary["projected_bytes"] = summary["rows_to_write"] * dataset.bytes_per_row
    out.emit("object", **summary)
    return summary


def rows_to_write(dataset, indexed, outcome_of, session):
    eligible = np.array([outcome_of[k] in ELIGIBLE for k in range(len(indexed.keys))], dtype=bool)
    if session is None:
        return int(indexed.counts[eligible].sum())
    keys = [indexed.keys[k] for k in np.flatnonzero(eligible).tolist()]
    stored = defaultdict(set)
    for key, digest in session.read(lambda c: c.execute(
            "SELECT key, digest FROM panna.segments WHERE dataset = %s AND key = ANY(%s)", (dataset.name, keys)).fetchall()):
        stored[key].add(bytes(digest))
    if not stored:
        return int(indexed.counts[eligible].sum())
    hashers = {}
    for k, _, span, _, _ in indexed.pieces(eligible):
        hashers.setdefault(k, hashlib.sha256()).update(span)
    return sum(int(indexed.counts[k]) for k, h in hashers.items() if h.digest() not in stored.get(indexed.keys[k], ()))


def cmd_probe(args, out):
    as_of = as_of_of(args.as_of)
    plan = plan_of(args, as_of)
    summaries, refused = classify(plan, args.scratch, as_of, out, keys=args.keys)
    totals = defaultdict(Counter)
    for s in summaries:
        totals[s["dataset"]].update(s["outcomes"])
    out.emit("probe_end", as_of=as_of.isoformat(), objects=len(summaries), totals={k: dict(v) for k, v in totals.items()},
             refused=refused)
    return 1 if refused else 0


def cmd_prep(args, out):
    as_of = as_of_of(args.as_of)
    plan = plan_of(args, as_of)
    url = args.database_url or os.environ.get("V2_PANNA_DATABASE_URL")
    session = Session(url, via=args.via, lock=False) if url else None
    try:
        summaries, refused = classify(plan, args.scratch, as_of, out, session=session, digests=True)
    finally:
        if session:
            session.close()
    if refused:
        out.emit("prep_end", status="refused", refused=refused, plan=None)
        return 1
    plan["projected_bytes"] = sum(s["projected_bytes"] for s in summaries)
    plan["objects"] = summaries
    Path(args.plan_out).write_text(json.dumps(plan, indent=2))
    out.emit("prep_end", assets=len(plan["assets"]), projected_bytes=plan["projected_bytes"], plan=str(args.plan_out))
    return 0


def run_with(args, out, plan, token=None):
    url = database_url(args)
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
        run = Run(session, out, datetime.date.fromisoformat(plan["as_of"]), plan, runner(), token=token,
                  chunk_rows=bounds["chunk_rows"], max_seconds=args.max_seconds, ceiling=bounds["database_ceiling_bytes"],
                  churn_limit=bounds["churn_limit"], churn_min=bounds["churn_min_segments"], allow_churn=bounds["allow_churn"],
                  fixtures_pin=fixtures_pin(plan.get("fixtures")), scratch=args.scratch or plan.get("scratch") or str(DEFAULT_SCRATCH),
                  scratch_ceiling=args.scratch_ceiling_bytes, keep_scratch=args.keep_scratch)
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
                     error=type(error).__name__)
            return 1
    finally:
        session.close()


def cmd_run(args, out):
    if args.plan:
        plan = json.loads(Path(args.plan).read_text())
        if args.as_of and args.as_of != plan["as_of"]:
            raise Refused("AS_OF_DIFFERS_FROM_PLAN")
        as_of_of(plan["as_of"])
        plan["scratch"] = str(Path(args.scratch).resolve())
    else:
        as_of = as_of_of(args.as_of)
        fixtures_pin(args.fixtures)
        try:
            plan = plan_of(args, as_of)
        except sources.SourceError as error:
            out.emit("error", code=error.code, name=error.name, detail=error.detail)
            out.emit("run_end", status="failed", reason=error.code)
            return 1
    return run_with(args, out, plan)


def cmd_retry(args, out):
    """Resume a run that did not complete, with its plan and bounds; never one a later run has overtaken (GH278-av):
    its remaining assets would become current over newer generations, with an older as-of."""
    url = database_url(args)
    session = Session(url, via=args.via, lock=False)
    try:
        # S3's action runs resume by `actions retry` (FAILURE_MODES.md section 10), never here.
        query = "SELECT run_id, token, plan FROM panna.runs WHERE status <> 'complete' AND coalesce(plan->>'product', '') <> 'match_actions'"
        found = session.read(lambda c: c.execute(
            query + (" AND run_id = %s" if args.run else "") + " ORDER BY run_id DESC LIMIT 1",
            (args.run,) if args.run else ()).fetchone())
        if found is not None:
            run_id, token, plan = found
            streams = [(a["origin"], a["container"], a["name"]) for a in plan["assets"]]
            later = session.read(lambda c: c.execute(
                """SELECT max(run_id) FROM (
                     SELECT run_id FROM panna.runs WHERE run_id > %s AND status = 'complete'
                     UNION ALL
                     SELECT l.run_id FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id
                     WHERE l.run_id > %s AND l.status = 'complete'
                       AND (s.origin, s.container, s.name) IN (SELECT * FROM unnest(%s::text[], %s::text[], %s::text[]))) later""",
                (run_id, run_id, [o for o, _, _ in streams], [c for _, c, _ in streams], [n for _, _, n in streams])).fetchone()[0])
    finally:
        session.close()
    if found is None:
        out.emit("run_end", status="complete", reason="NOTHING_TO_RETRY")
        return 0
    if later is not None and not args.force:
        raise Refused("RETRY_STALE", run_id=run_id, later_run=later)
    out.emit("retry", run_id=run_id, forced=bool(later is not None))
    return run_with(args, out, plan, token=str(token))


def cmd_explain(args, out):
    """EXPLAIN (ANALYZE, BUFFERS) of the server's verification of the dataset's latest segments: the statement each chunk
    runs, on the base as it is (GH278-at). The plan names indexes, ids and counts, never a row's value."""
    from . import encode
    dataset = registry.TABLES[args.dataset]
    session = Session(database_url(args), via=args.via, lock=False)
    try:
        c = session.conn
        latest = c.execute("SELECT segment_id, rows FROM panna.segments WHERE dataset = %s ORDER BY segment_id DESC LIMIT %s",
                           (dataset.name, args.last_segments)).fetchall()
        ids = [segment for segment, _ in latest]
        plan = [line for (line,) in c.execute("EXPLAIN (ANALYZE, BUFFERS) " + encode.sql_digests(dataset.name, dataset.columns),
                                              (ids,)).fetchall()]
        table_rows = c.execute("SELECT coalesce(sum(rows), 0) FROM panna.segments WHERE dataset = %s", (dataset.name,)).fetchone()[0]
        out.emit("explain", dataset=dataset.name, segments=len(ids), rows=int(sum(r for _, r in latest)),
                 table_rows=int(table_rows), statement=encode.sql_digests(dataset.name, dataset.columns), plan=plan)
    finally:
        session.close()
    return 0


def cmd_status(args, out):
    session = Session(database_url(args), via=args.via, lock=False)
    try:
        c = session.conn
        datasets = {d: {"segments": s, "rows": int(r)} for d, s, r in c.execute(
            "SELECT d.dataset, count(s.segment_id), coalesce(sum(s.rows), 0) FROM panna.datasets d "
            "LEFT JOIN panna.segments s USING (dataset) GROUP BY 1 ORDER BY 1").fetchall()}
        scope_counts = defaultdict(dict)
        for d, o, n in c.execute("SELECT dataset, outcome, count(*) FROM panna.scope GROUP BY 1, 2 ORDER BY 1, 2").fetchall():
            scope_counts[d][o] = n
        due = c.execute("SELECT min(next_eligible_on) FROM panna.scope WHERE outcome = 'deferred'").fetchone()[0]
        runs = [{"run_id": r, "as_of": a.isoformat(), "status": s, "reason": why, "rows_written": w}
                for r, a, s, why, w in c.execute(
                    "SELECT run_id, as_of, status, reason, rows_written FROM panna.runs ORDER BY run_id DESC LIMIT 5").fetchall()]
        loads = dict(c.execute("SELECT status, count(*) FROM panna.loads GROUP BY 1").fetchall())
        generations = {d: {"streams": n, "empty": e} for d, n, e in c.execute(
            "SELECT dataset, count(*), count(*) FILTER (WHERE segments = 0) FROM panna.current_generations GROUP BY 1 ORDER BY 1").fetchall()}
        receipts = c.execute("SELECT count(*) FROM panna.receipts").fetchone()[0]
        size = c.execute("SELECT pg_database_size(current_database())").fetchone()[0]
        out.emit("status", datasets=datasets, scope=scope_counts, next_due=due.isoformat() if due else None, runs=runs,
                 loads=loads, generations=generations, receipts=receipts, database_bytes=size)
    finally:
        session.close()
    return 0


def cmd_verify(args, out):
    from . import encode
    session = Session(database_url(args), via=args.via, lock=False)
    try:
        c = session.conn
        where, params = "", ()
        if args.run:
            where, params = " WHERE s.first_load_id IN (SELECT load_id FROM panna.loads WHERE run_id = %s)", (args.run,)
        ledger = c.execute(f"SELECT s.segment_id, s.dataset, s.key, s.digest FROM panna.segments s{where} ORDER BY s.segment_id",
                           params).fetchall()
        by_dataset = defaultdict(list)
        for segment, dataset, key, digest in ledger:
            by_dataset[dataset].append((segment, key, bytes(digest)))
        mismatched = 0
        for name, rows in by_dataset.items():
            dataset = registry.TABLES[name]
            for i in range(0, len(rows), 1000):
                part = rows[i: i + 1000]
                server = dict(c.execute(encode.sql_digests(dataset.name, dataset.columns), ([r[0] for r in part],)).fetchall())
                for segment, key, digest in part:
                    if bytes(server.get(segment, b"")) != digest:
                        mismatched += 1
                        out.emit("mismatch", dataset=name, key=key, segment_id=segment)
        out.emit("verify", segments=len(ledger), mismatched=mismatched)
    finally:
        session.close()
    return 1 if mismatched else 0


def cmd_pilot(args, out):
    """S1 (FAILURE_MODES.md section 8): one Opta key, one Vega match, under its scope manifest (backend/panna/pilot.py)."""
    from . import pilot
    try:
        if args.step == "revert":
            return pilot.revert(args, out, database_url(args))
        if args.step == "check":
            return pilot.check(args, out, args.database_url or os.environ.get("V2_PANNA_DATABASE_URL"), str(DEFAULT_SCRATCH))
        return pilot.apply(args, out, database_url(args), runner(), str(DEFAULT_SCRATCH))
    except pilot.ScopeRefused as refused:
        out.emit("pilot_end", status="refused", reason=refused.code, exit=2, **refused.fields)
        print(f"panna: {refused.code}", file=sys.stderr)
        return 2


def cmd_actions(args, out):
    """S3 (FAILURE_MODES.md section 10): Opta's detailed actions stored once (backend/panna/actions.py)."""
    from . import actions
    return actions.main(args, out, database_url(args), runner(), bounds_of, DEFAULT_SCRATCH)


COMMANDS = {"probe": cmd_probe, "prep": cmd_prep, "run": cmd_run, "retry": cmd_retry, "status": cmd_status, "verify": cmd_verify,
            "explain": cmd_explain, "pilot": cmd_pilot, "actions": cmd_actions}


def main(argv=None):
    args = parser().parse_args(argv)
    out = Output(sys.stdout)
    try:
        return COMMANDS[args.command](args, out)
    except Refused as refused:
        out.emit("run_end", status="refused", reason=refused.code, **refused.fields)
        print(f"panna: {refused.code}", file=sys.stderr)
        return 2
    except sources.SourceError as error:
        out.emit("error", code=error.code, name=error.name, detail=error.detail)
        out.emit("run_end", status="failed", reason=error.code)
        return 1
    except Failure as failure:
        out.emit("error", code=failure.code, name=failure.name, **failure.fields)
        out.emit("run_end", status="failed", reason=failure.code)
        return 1
    except psycopg.OperationalError as error:
        out.emit("run_end", status="failed", reason="CONNECTION_FAILED", sqlstate=getattr(error, "sqlstate", None))
        return 1
