"""First-seen and monthly profile scheduling, transactional and provider-scoped."""

from datetime import datetime, timedelta, timezone
import re
from .jobs import enqueue, ack, fail
from .store import StoreError, digest

KINDS = ("team", "player")


def _valid(kind, entity_id):
    if (
        kind not in KINDS
        or not isinstance(entity_id, int)
        or isinstance(entity_id, bool)
        or entity_id <= 0
    ):
        raise StoreError("INVALID_PROFILE_TARGET")


def _at(value):
    value = value or datetime.now(timezone.utc)
    if (
        not isinstance(value, datetime)
        or value.tzinfo is None
        or value.utcoffset() is None
    ):
        raise StoreError("INVALID_PROFILE_TIME")
    return value.astimezone(timezone.utc)


def queue_first_seen(conn, kind, entity_id):
    _valid(kind, entity_id)
    table = "teams" if kind == "team" else "players"
    if not conn.execute(
        "SELECT 1 FROM core." + table + " WHERE id=%s", (entity_id,)
    ).fetchone():
        raise StoreError("UNRESOLVED_REFERENCE")
    row = conn.execute(
        "INSERT INTO ops.reference_state(provider,entity_type,entity_id) VALUES('pitchapi',%s,%s) ON CONFLICT DO NOTHING RETURNING entity_id",
        (kind, entity_id),
    ).fetchone()
    return (
        enqueue(conn, "reference", kind, entity_type=kind, entity_id=entity_id)
        if row
        else None
    )


def _lock_lease(conn, kind, entity_id, lease):
    if not lease:
        return
    job_id, token = lease
    if not conn.execute(
        "SELECT id FROM ops.fetch_jobs WHERE id=%s AND lease_token=%s AND state='leased' AND lease_until>clock_timestamp() AND family=%s AND entity_type=%s AND entity_id=%s FOR UPDATE",
        (job_id, token, kind, kind, entity_id),
    ).fetchone():
        raise StoreError("LEASE_LOST")


def save_profile(store, kind, provider_key, batch, lease=None, *, now=None):
    if (
        kind not in KINDS
        or not isinstance(provider_key, str)
        or not re.fullmatch(
            ("t" if kind == "team" else "p") + r"_[A-Za-z0-9]{6}", provider_key
        )
    ):
        raise StoreError("INVALID_PROFILE_TARGET")
    table = "core." + kind + "s"
    if (
        batch.coverage != "ok"
        or set(batch.rows) != {table}
        or len(batch.rows[table]) != 1
        or batch.rows[table][0].get("id") != provider_key
    ):
        raise StoreError("PROFILE_ID_MISMATCH")
    if any(
        ref.entity_type != kind
        or ref.provider_key != provider_key
        or ref.natural_name is not None
        for ref in batch.references
    ):
        raise StoreError("PROFILE_ID_MISMATCH")
    instant = _at(now)
    with store.conn.transaction():
        # A leased write must own the exact existing target before any mutation.
        if lease:
            entity_id = store.resolve(kind, provider_key)
            _lock_lease(store.conn, kind, entity_id, lease)
        store.save_references(batch, family=kind)
        entity_id = store.resolve(kind, provider_key)
        store.conn.execute(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id) VALUES('pitchapi',%s,%s) ON CONFLICT DO NOTHING",
            (kind, entity_id),
        )
        store.conn.execute(
            "UPDATE ops.reference_state SET fingerprint=%s,status='ok',last_success_at=%s,last_attempt_at=%s,next_due=%s,updated_at=%s WHERE provider='pitchapi' AND entity_type=%s AND entity_id=%s",
            (
                digest(batch),
                instant,
                instant,
                instant + timedelta(days=30),
                instant,
                kind,
                entity_id,
            ),
        )
        if lease:
            ack(store.conn, *lease)
        else:
            # Direct hydration has already completed this pending first-seen job.
            # A leased job belongs to another worker and must remain untouched.
            store.conn.execute(
                "UPDATE ops.fetch_jobs SET state='done',updated_at=%s WHERE lane='reference' AND family=%s AND entity_type=%s AND entity_id=%s AND state='pending'",
                (instant, kind, kind, entity_id),
            )
    return entity_id


def record_failure(store, kind, provider_key, code, lease=None, *, now=None, retry=True):
    if (
        kind not in KINDS
        or not isinstance(code, str)
        or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code)
    ):
        raise StoreError("INVALID_PROFILE_FAILURE")
    explicit_time = now is not None
    instant = _at(now)
    with store.conn.transaction():
        entity_id = store.resolve(kind, provider_key)
        _lock_lease(store.conn, kind, entity_id, lease)
        store.conn.execute(
            "INSERT INTO ops.reference_state(provider,entity_type,entity_id,status,last_attempt_at,next_due) VALUES('pitchapi',%s,%s,'error',%s,%s) ON CONFLICT(provider,entity_type,entity_id) DO UPDATE SET status='error',last_attempt_at=EXCLUDED.last_attempt_at,next_due=EXCLUDED.next_due,updated_at=EXCLUDED.last_attempt_at",
            (kind, entity_id, instant, instant + timedelta(hours=1 if retry else 24 * 30)),
        )
        store.conn.execute(
            "INSERT INTO ops.parse_failures(family,entity_type,entity_id,error_code,message) VALUES(%s,%s,%s,%s,%s)",
            (kind, kind, entity_id, code, code),
        )
        if lease:
            fail(
                store.conn,
                *lease,
                code,
                now=instant if explicit_time else None,
                retry=retry,
            )
    return entity_id


def enqueue_due(conn, *, now=None, limit=100):
    instant = _at(now)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1000:
        raise StoreError("INVALID_PROFILE_LIMIT")
    rows = conn.execute(
        "SELECT entity_type::text,entity_id FROM ops.reference_state WHERE provider='pitchapi' AND next_due IS NOT NULL AND next_due<=%s ORDER BY next_due,entity_type,entity_id FOR UPDATE SKIP LOCKED LIMIT %s",
        (instant, limit),
    ).fetchall()
    jobs = []
    for kind, entity_id in rows:
        job = enqueue(
            conn,
            "reference",
            kind,
            entity_type=kind,
            entity_id=entity_id,
            run_after=instant,
        )
        if job is not None:
            jobs.append(job)
    return jobs
