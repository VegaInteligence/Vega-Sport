"""S1 (backend/panna/FAILURE_MODES.md section 8): one Opta key's half-time pair applied to one existing Vega match.

`python -m panna pilot check | apply | revert`. The scope manifest (the report of the real object: its digest, the
ordinals of the key's rows, the key, the match, the maximum row count, the digest of the rows' 13 lexical fields, the
parent the approval saw) is the only authorization: one key, one match, refused before anything is written when the
object does not fit it. `apply` loads the key's segment through the H1 loader restricted to the key, then
panna.apply_score_segment publishes from the stored segment (core.publish_score_pair). No row of another key, no
other match; nothing here selects assets by family or release."""

import datetime
import hashlib
import json
import os
import re

import psycopg
from psycopg.types.json import Jsonb
import pyarrow.compute as pc
import pyarrow.parquet as pq

from . import registry, sources
from .db import AlreadyRunning, LinkLost, Session

RULE = "opta-half-time-s1"
DATASET = "opta_fixtures"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
PUBLISHED = ("published", "unchanged")
# What the approval saw of the parent (FAILURE_MODES.md GH278.S1-c, -l): every field present, null when it had none.
APPROVAL = ("match_id", "public_id", "season_id", "competition_season_id", "home_team_id", "away_team_id", "match_date",
            "status", "parent_source")


class ScopeRefused(Exception):
    def __init__(self, code, **fields):
        super().__init__(code)
        self.code, self.fields = code, fields


def add_parser(sub, add_database):
    pilot = sub.add_parser("pilot", help="S1: one Opta key's half-time pair on one Vega match (scope manifest only)")
    steps = pilot.add_subparsers(dest="step", required=True)
    for name, text in (("check", "verify the scope manifest against the object; with a database, the decision it would get"),
                       ("apply", "load the key's segment and publish its pair (one key, one match)")):
        p = steps.add_parser(name, help=text)
        p.add_argument("--scope", required=True, help="the scope manifest (asset digest, ordinals, key, match, packet digest)")
        p.add_argument("--manifest", help="a frozen manifest naming the asset (local path or URL); else --release")
        p.add_argument("--blobs")
        p.add_argument("--release", default=registry.RELEASE)
        p.add_argument("--repo", default=registry.REPO)
        p.add_argument("--github-api", default=registry.GITHUB_API)
        p.add_argument("--as-of", help="the scope's own as-of; another day is refused")
        p.add_argument("--scratch")
        add_database(p)
        if name == "apply":
            p.add_argument("--reviewer", required=True, help="who approved the scope (recorded with the identity decision)")
    revert = steps.add_parser("revert", help="the targeted revert of one application")
    revert.add_argument("--application", type=int, required=True)
    revert.add_argument("--reviewer", required=True)
    add_database(revert)


def read_scope(path):
    try:
        body = json.loads(open(path, encoding="utf-8").read())
        scope = body["scope"]
        fields = (scope["asset"], scope["published_asset_sha256"], scope["source_ordinals_zero_based"],
                  scope["source_match_keys"], scope["match_ids"], scope["maximum_fixture_rows"], scope["packet_sha256"])
        as_of = datetime.date.fromisoformat(body["as_of_utc"])
    except (OSError, ValueError, KeyError, TypeError):
        raise ScopeRefused("SCOPE_UNREADABLE") from None
    asset, digest, ordinals, keys, matches, max_rows, packet = fields
    if not (isinstance(asset, str) and DIGEST.fullmatch(digest or "") and DIGEST.fullmatch(packet or "")
            and isinstance(ordinals, list) and all(isinstance(o, int) and o >= 0 for o in ordinals)
            and isinstance(max_rows, int) and max_rows >= 1):
        raise ScopeRefused("SCOPE_UNREADABLE")
    if not isinstance(keys, list) or len(keys) != 1 or not isinstance(keys[0], str) or not keys[0]:
        raise ScopeRefused("SCOPE_CARDINALITY", keys=len(keys) if isinstance(keys, list) else None)
    if not isinstance(matches, list) or len(matches) != 1 or not isinstance(matches[0], int):
        raise ScopeRefused("SCOPE_MATCHES", matches=len(matches) if isinstance(matches, list) else None)
    target = body.get("target")
    if not isinstance(target, dict) or any(k not in target for k in APPROVAL) or target["match_id"] != matches[0]:
        raise ScopeRefused("SCOPE_TARGET", missing=[k for k in APPROVAL if not isinstance(target, dict) or k not in target])
    return {"asset": asset, "sha256": digest[7:], "ordinals": sorted(ordinals), "key": keys[0], "match_id": matches[0],
            "max_rows": max_rows, "packet_sha256": packet[7:], "as_of": as_of, "target": target,
            "source": dict(body.get("source") or {})}


def packet_digest(rows):
    """SHA-256 of the rows' 13 lexical fields, one JSON line each in the file's column order (the scope's packet)."""
    data = b"".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode() + b"\n" for r in rows)
    return hashlib.sha256(data).hexdigest()


def locate(path, key):
    """The ordinals of the key's rows in the object, and those rows (column order kept)."""
    pf = pq.ParquetFile(path)
    ordinals, rows, offset = [], [], 0
    for group in range(pf.num_row_groups):
        column = pf.read_row_group(group, columns=["match_id"]).column("match_id")
        hits = pc.indices_nonzero(pc.equal(column, key)).to_pylist()
        if hits:
            table = pf.read_row_group(group)
            for i in hits:
                ordinals.append(offset + i)
                rows.append({name: table.column(name)[i].as_py() for name in table.schema.names})
        offset += pf.metadata.row_group(group).num_rows
    return ordinals, rows


def instant(value):
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(datetime.timezone.utc)
    except ValueError:
        return "unreadable"


def asset_of(args, scope):
    if args.manifest:
        available = sources.read_manifest(args.manifest, args.blobs)
    else:
        available = sources.list_release(args.github_api, args.repo, args.release, os.environ.get("GITHUB_TOKEN"))
    if scope["asset"] not in available:
        raise ScopeRefused("SCOPE_ASSET_ABSENT")
    (asset,) = sources.select(available, [scope["asset"]])
    if asset.dataset != DATASET:
        raise ScopeRefused("SCOPE_DATASET")
    return asset


def verify(args, scope, out, scratch):
    """The object against its scope, before anything is written: (asset, path, ordinals, rows)."""
    if args.as_of and datetime.date.fromisoformat(args.as_of) != scope["as_of"]:
        raise ScopeRefused("SCOPE_AS_OF", scope=scope["as_of"].isoformat())
    if scope["as_of"] > datetime.datetime.now(datetime.timezone.utc).date():
        raise ScopeRefused("AS_OF_IN_FUTURE")
    asset = asset_of(args, scope)
    if asset.sha256 != scope["sha256"]:
        raise ScopeRefused("SCOPE_ASSET_DIGEST")
    issued = scope["source"].get("release_asset_updated_at")
    if issued and asset.updated_at and instant(issued) != instant(asset.updated_at):
        raise ScopeRefused("SCOPE_ISSUED_AT")
    path, _ = sources.fetch(asset, scratch)
    ordinals, rows = locate(path, scope["key"])
    if not ordinals:
        raise ScopeRefused("SCOPE_KEY_ABSENT")
    if len(ordinals) > scope["max_rows"]:
        raise ScopeRefused("SCOPE_MAX_ROWS", rows=len(ordinals))
    if ordinals != scope["ordinals"]:
        raise ScopeRefused("SCOPE_ORDINALS", rows=len(ordinals))
    if packet_digest(rows) != scope["packet_sha256"]:
        raise ScopeRefused("SCOPE_PACKET_DIGEST")
    out.emit("scope", asset=asset.name, sha256=asset.sha256, key=scope["key"], match_id=scope["match_id"],
             ordinals=ordinals, rows=len(rows), packet_sha256=scope["packet_sha256"], as_of=scope["as_of"].isoformat())
    return asset, path, ordinals, rows


# The functions S1 needs, in their files' order: a base without one is refused before the loader writes anything.
NEEDS = (("core", "publish_score_pair", "backend/sql/186_match_score_observations.sql"),
         ("panna", "apply_score_segment", "backend/panna/sql/004_panna_canonical.sql"))


def missing_schema(session):
    """The first S1 migration the base lacks, or None (read in the catalog: no right on the schemas needed)."""
    for schema, name, needs in NEEDS:
        if not session.read(lambda c: c.execute(
                """SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = %s AND p.proname = %s""", (schema, name)).fetchone()):
            return needs
    return None


def refuse_schema(out, needs):
    out.emit("error", code="SCHEMA_VERSION", needs=needs)
    out.emit("pilot_end", status="failed", reason="SCHEMA_VERSION", exit=1)
    return 1


def day_of(text):
    found = re.match(r"(\d{4}-\d{2}-\d{2})", text or "")
    return datetime.date.fromisoformat(found.group(1)) if found else None


def check(args, out, url, scratch_default):
    scope = read_scope(args.scope)
    _, _, _, rows = verify(args, scope, out, args.scratch or scratch_default)
    if not url:
        out.emit("pilot_end", status="checked", exit=0)
        return 0
    first = rows[0]
    session = Session(url, via=args.via, lock=False)
    try:
        needs = missing_schema(session)
        if needs:
            return refuse_schema(out, needs)
        verdict = session.read(lambda c: c.execute(
            "SELECT core.score_pair_verdict('opta', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (scope["key"], first["home_score_ht"], first["away_score_ht"], first["home_score"], first["away_score"],
             day_of(first["match_date"]), first["home_team"], first["away_team"], scope["match_id"],
             Jsonb(scope["target"]))).fetchone()[0])
    finally:
        session.close()
    identity = verdict.get("identity") or {}
    out.emit("preview", status=verdict["status"], reason=verdict.get("reason"), half_time=verdict.get("half_time"),
             cells=verdict.get("cells"), revision=verdict.get("revision"), stale=verdict.get("stale"),
             identity={k: identity.get(k) for k in ("decision", "candidate_ids", "chosen_id", "evidence_code")})
    code = 0 if verdict["status"] in PUBLISHED else 1
    out.emit("pilot_end", status=verdict["status"], exit=code)
    return code


def apply(args, out, url, runner, scratch_default):
    from .load import Run

    scope = read_scope(args.scope)
    asset, _, ordinals, rows = verify(args, scope, out, args.scratch or scratch_default)
    plan = {"as_of": scope["as_of"].isoformat(), "release": asset.container, "assets": [asset.to_plan()], "fixtures": "current",
            "scratch": args.scratch or scratch_default,
            "scope": {"rule": RULE, "dataset": DATASET, "asset_sha256": asset.sha256, "keys": [scope["key"]],
                      "ordinals": ordinals, "max_rows": scope["max_rows"], "match_ids": [scope["match_id"]],
                      "packet_sha256": scope["packet_sha256"]}}
    try:
        session = Session(url, via=args.via, out=out)
    except AlreadyRunning:
        out.emit("pilot_end", status="already_running", exit=4)
        return 4
    try:
        needs = missing_schema(session)
        if needs:
            return refuse_schema(out, needs)
        run = Run(session, out, scope["as_of"], plan, runner, scratch=plan["scratch"])
        code = run.execute()
        if code != 0:
            out.emit("pilot_end", status="load_not_complete", exit=code)
            return code
        load = session.read(lambda c: c.execute(
            """SELECT l.load_id FROM panna.loads l JOIN panna.streams s ON s.stream_id = l.stream_id
               WHERE l.run_id = %s AND s.name = %s AND l.status = 'complete'""", (run.run_id, asset.name)).fetchone()[0])
        result = session.unit(lambda c: c.execute(
            "SELECT panna.apply_score_segment(%s, %s, %s, %s, %s, %s, %s)",
            (load, scope["key"], scope["match_id"], Jsonb(scope["target"]), RULE, args.reviewer,
             asset.url or scope["source"].get("uri"))).fetchone()[0])
    except LinkLost as lost:
        out.emit("pilot_end", status="partial", reason=str(lost), exit=3)
        return 3
    except psycopg.Error as error:
        out.emit("error", code="DATABASE_ERROR", sqlstate=getattr(error, "sqlstate", None),
                 detail=(error.diag.message_primary or "")[:200])
        out.emit("pilot_end", status="failed", exit=1)
        return 1
    finally:
        session.close()
    identity = result.get("identity") or {}
    out.emit("application", id=result["application"], status=result["status"], reason=result.get("reason"),
             changed=bool(result.get("changed")), segment_id=result.get("segment_id"), batch_id=result.get("batch_id"),
             target_match_id=result.get("target_match_id"), source_rows=result.get("source_rows"),
             target_rows=result.get("target_rows"), half_time=result.get("half_time"), lexemes=result.get("lexemes"),
             cells_before=result.get("cells_before"), cells_after=result.get("cells_after"),
             revision={"before": result.get("revision_before"), "after": result.get("revision_after")},
             observations=result.get("observations"), captured=result.get("captured"), selection=result.get("selection"),
             stale=result.get("stale"),
             identity={k: identity.get(k) for k in ("decision", "candidate_ids", "chosen_id", "evidence_code")} if identity else None)
    code = 0 if result["status"] in PUBLISHED else 1
    out.emit("pilot_end", status=result["status"], exit=code)
    return code


def revert(args, out, url):
    try:
        session = Session(url, via=args.via, out=out)
    except AlreadyRunning:
        out.emit("pilot_end", status="already_running", exit=4)
        return 4
    try:
        result = session.unit(lambda c: c.execute("SELECT panna.revert_score_application(%s, %s)",
                                                  (args.application, args.reviewer)).fetchone()[0])
    except LinkLost as lost:
        out.emit("pilot_end", status="partial", reason=str(lost), exit=3)
        return 3
    except psycopg.Error as error:
        out.emit("error", code="DATABASE_ERROR", sqlstate=getattr(error, "sqlstate", None),
                 detail=(error.diag.message_primary or "")[:200])
        out.emit("pilot_end", status="failed", exit=1)
        return 1
    finally:
        session.close()
    out.emit("revert", application=result["application"], status=result["status"], previous_status=result.get("previous_status"),
             restored=result.get("restored"), changed=bool(result.get("changed")), target_match_id=result.get("target_match_id"),
             revision={"before": result.get("revision_before"), "after": result.get("revision_after")},
             reviewer=result.get("reviewer"))
    return 0
