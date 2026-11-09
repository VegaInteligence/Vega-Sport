"""Catalogue-to-queue planning; provider responses remain in memory only."""

import re
from .jobs import DETAIL_FAMILIES, enqueue
from .normalize import normalize_family, NormalizationError
from .store import StoreError

FAMILIES = ("summary", *DETAIL_FAMILIES)


def catalogue_plan(data, *, first_year=2021):
    if (
        not isinstance(first_year, int)
        or isinstance(first_year, bool)
        or not 1900 <= first_year <= 2200
    ):
        raise ValueError("invalid first year")
    if not isinstance(data, dict) or not isinstance(data.get("leagues"), list):
        raise NormalizationError("INVALID_CATALOGUE")
    selected = []
    seen = set()
    for item in data["leagues"]:
        if not isinstance(item, dict) or not isinstance(item.get("seasons"), list):
            raise NormalizationError("INVALID_CATALOGUE")
        league = item.get("id")
        if (
            not isinstance(league, str)
            or not re.fullmatch(r"l_[A-Za-z0-9]{6}", league)
            or league in seen
        ):
            raise NormalizationError("INVALID_CATALOGUE")
        seen.add(league)
        labels = []
        for label in item["seasons"]:
            if not isinstance(label, str) or not re.fullmatch(
                r"\d{4}(?:/\d{4})?", label
            ):
                raise NormalizationError("INVALID_SEASON")
            if int(label[:4]) >= first_year and label not in labels:
                labels.append(label)
        selected.append({**item, "seasons": labels})
    return {"leagues": selected}


def enqueue_catalogue(conn):
    return enqueue(conn, "reference", "league", global_key="catalogue")


def persist_catalogue(store, data, *, first_year=2021):
    plan = catalogue_plan(data, first_year=first_year)
    batch = normalize_family("leagues", plan)
    with store.conn.transaction():
        store.save_references(batch, family="league")
        count = 0
        for row in batch.rows.get("core.competition_seasons", []):
            competition = store.resolve("competition", row["competition_id"])
            edition = store.conn.execute(
                "SELECT cs.id FROM core.competition_seasons cs JOIN core.seasons s ON s.id=cs.season_id WHERE cs.competition_id=%s AND cs.native_label=%s",
                (competition, row["native_label"]),
            ).fetchone()
            if not edition:
                raise StoreError("EDITION_NOT_FOUND")
            count += (
                enqueue(
                    store.conn,
                    "backfill",
                    "league_matches",
                    competition_season_id=edition[0],
                )
                is not None
            )
        return {
            "leagues": len(plan["leagues"]),
            "editions": sum(len(x["seasons"]) for x in plan["leagues"]),
            "queued": count,
        }


def enqueue_finished(store, batch, edition_id, *, schedule_details=True):
    with store.conn.transaction():
        ids = store.save_matches(batch, edition_id, family="league_matches")
        matches = batch.rows.get("core.matches", [])
        if len(ids) != len(matches):
            raise StoreError("CALENDAR_COUNT_MISMATCH")
        count = 0
        for row, mid in zip(matches, ids):
            if not schedule_details or row.get("status") != "finished":
                continue
            done = {
                r[0]
                for r in store.conn.execute(
                    "SELECT family::text FROM ops.family_state WHERE match_id=%s AND status IN ('ok','unavailable')",
                    (mid,),
                )
            }
            for family in FAMILIES:
                if family not in done:
                    count += (
                        enqueue(
                            store.conn,
                            "backfill",
                            family,
                            entity_type="match",
                            entity_id=mid,
                        )
                        is not None
                    )
        return {
            "matches": len(matches),
            "finished": sum(x.get("status") == "finished" for x in matches),
            "queued": count,
        }


def activate_finished(store, *, after_id=0, limit=100, edition_id=None):
    """Queue the next bounded page of observed finished matches; caller can resume by ID."""
    if (
        not isinstance(after_id, int)
        or isinstance(after_id, bool)
        or after_id < 0
        or not isinstance(limit, int)
        or isinstance(limit, bool)
        or not 1 <= limit <= 1000
    ):
        raise ValueError("invalid activation cursor")
    if edition_id is not None and (
        not isinstance(edition_id, int)
        or isinstance(edition_id, bool)
        or edition_id <= 0
    ):
        raise ValueError("invalid edition")
    with store.conn.transaction():
        rows = store.conn.execute(
            "SELECT id FROM core.matches WHERE source='pitchapi' AND status='finished' AND id>%s AND (%s::integer IS NULL OR competition_season_id=%s) ORDER BY id LIMIT %s",
            (after_id, edition_id, edition_id, limit + 1),
        ).fetchall()
        selected = rows[:limit]
        count = 0
        for (mid,) in selected:
            done = {
                r[0]
                for r in store.conn.execute(
                    "SELECT family::text FROM ops.family_state WHERE match_id=%s AND status IN ('ok','unavailable')",
                    (mid,),
                )
            }
            for family in FAMILIES:
                if family not in done:
                    count += (
                        enqueue(
                            store.conn,
                            "backfill",
                            family,
                            entity_type="match",
                            entity_id=mid,
                        )
                        is not None
                    )
        return {
            "matches": len(selected),
            "queued": count,
            "next_after_id": (
                selected[-1][0] if selected and len(rows) > limit else None
            ),
        }


def catalogue_report(conn, *, first_year=2021):
    """Counts are scoped to persisted PitchAPI editions and show incomplete calendars."""
    if (
        not isinstance(first_year, int)
        or isinstance(first_year, bool)
        or not 1900 <= first_year <= 2200
    ):
        raise ValueError("invalid first year")
    status = conn.execute(
        """SELECT count(*) FILTER(WHERE m.status='finished'),
      count(*) FILTER(WHERE m.status='not_started'),
      count(*) FILTER(WHERE m.status IS DISTINCT FROM 'finished' AND m.status IS DISTINCT FROM 'not_started')
      FROM core.matches m JOIN core.seasons s ON s.id=m.season_id
      WHERE m.source='pitchapi' AND s.start_year >= %s""",
        (first_year,),
    ).fetchone()
    coverage = conn.execute(
        """WITH latest AS (
      SELECT DISTINCT ON(competition_season_id) competition_season_id,state
      FROM ops.fetch_jobs WHERE family='league_matches' ORDER BY competition_season_id,id DESC)
      SELECT count(*),count(*) FILTER(WHERE latest.state='done'),
      count(*) FILTER(WHERE latest.state IN ('pending','leased')),
      count(*) FILTER(WHERE latest.state='failed'),count(*) FILTER(WHERE latest.state IS NULL)
      FROM core.competition_seasons cs JOIN core.seasons s ON s.id=cs.season_id
      JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=cs.competition_id
      LEFT JOIN latest ON latest.competition_season_id=cs.id WHERE s.start_year >= %s""",
        (first_year,),
    ).fetchone()
    return {
        "first_year": first_year,
        "finished": status[0],
        "upcoming": status[1],
        "other_or_unknown": status[2],
        "estimated_match_family_calls_upper_bound": status[0] * len(FAMILIES),
        "editions": {
            "total": coverage[0],
            "calendar_done": coverage[1],
            "calendar_pending_or_leased": coverage[2],
            "calendar_failed": coverage[3],
            "calendar_not_queued": coverage[4],
        },
    }
