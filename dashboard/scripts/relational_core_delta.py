"""Bounded, match-grain publication of the existing public relational schema.

The caller owns the writer lease and the partition transaction. No intermediate
commit is permitted: source digest, receipts, aggregates and generation refer to
the same committed facts. Original provider responses remain in staging/detail.
"""

import hashlib
import json
from collections import defaultdict

from psycopg import sql

from relational_core import (
    APPEARANCE_BOOL, APPEARANCE_NUMBER, APPEARANCE_TEXT,
    SHOT_BOOL, SHOT_NUMBER, SHOT_TEXT, SIDE_BOOL, SIDE_NUMBER, SIDE_TEXT,
    _finite, _identity, _many, _partition_metadata, publication_digest, row_batches, snake,
)

MAX_MATCHES = 32
MAX_MATCH_BYTES = 4 * 1024 * 1024
CHILD_TABLES = (
    "match_coverage", "match_warnings", "shots", "team_statistics",
    "appearances", "appearance_metrics", "appearance_shirt_numbers", "match_appearance_members",
)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def number(value):
    # These particular columns are float8 in the published schema. Native types
    # which have their own discriminator (shirt/position/raw statistics) are kept below.
    value = _finite(value)
    return float(value) if value is not None else None


def match_inputs(snapshot):
    appearances = defaultdict(list)
    seen = set()
    for appearance in snapshot.get("appearances") or []:
        if appearance["id"] in seen:
            raise ValueError("Duplicate appearance in a publication")
        seen.add(appearance["id"])
        appearances[appearance["matchId"]].append(appearance)
    matches = {}
    for match in snapshot.get("matches") or []:
        if match["id"] in matches:
            raise ValueError("Duplicate match in a publication")
        matches[match["id"]] = (match, appearances.pop(match["id"], []))
    if appearances:
        raise ValueError("Publication contains appearances without their match")
    return matches


def match_rows(match, people, season, league):
    """Project every persisted core value, preserving all within-match order."""
    mid = match["id"]
    rows = {table: [] for table in ("matches", "players", *CHILD_TABLES)}
    referee, referee_id, referee_object = _identity(match.get("referee"))
    stadium, stadium_id, stadium_object = _identity(match.get("stadium"))
    row = dict(id=mid, season=season, league_id=league, league=match.get("league"),
               country=match.get("country"), day=match.get("date"), date=match.get("date"),
               time_utc=match.get("timeUtc"), status=match.get("status"),
               round_name=None if match.get("roundName") is None else str(match["roundName"]),
               has_playoff=match.get("hasPlayoff"), detail_collected=match.get("detailCollected"),
               referee=referee, referee_id=referee_id, referee_object=referee_object,
               stadium=stadium, stadium_id=stadium_id, stadium_object=stadium_object)
    for side in ("home", "away"):
        team = match.get(side) or {}
        row.update({side + "_" + snake(k): team.get(k) for k in SIDE_TEXT + SIDE_BOOL})
        row.update({side + "_" + snake(k): number(team.get(k)) for k in SIDE_NUMBER})
    rows["matches"].append(row)
    for key, value in sorted((match.get("coverage") or {}).items()):
        rows["match_coverage"].append(dict(match_id=mid, coverage_key=key,
            flag=value if isinstance(value, bool) else None,
            count=value if type(value) is int else None))
    for kind, key in (("warning", "warnings"), ("code", "warningCodes")):
        rows["match_warnings"].extend(dict(match_id=mid, kind=kind, ordinal=i, value=value)
                                      for i, value in enumerate(match.get(key) or []))
    for ordinal, shot in enumerate(match.get("shots") or []):
        rows["shots"].append(dict(id=shot["id"], match_id=mid, ordinal=ordinal,
            **{snake(k): shot.get(k) for k in SHOT_TEXT + SHOT_BOOL},
            **{snake(k): number(shot.get(k)) for k in SHOT_NUMBER}))
    for ordinal, stat in enumerate(match.get("stats") or []):
        rows["team_statistics"].append(dict(match_id=mid, metric_key=stat["key"], ordinal=ordinal,
            label=stat.get("label"), home_value=number(stat.get("home")), away_value=number(stat.get("away")),
            home_raw=None if stat.get("homeRaw") is None else str(stat["homeRaw"]),
            away_raw=None if stat.get("awayRaw") is None else str(stat["awayRaw"]),
            home_raw_type=type(stat.get("homeRaw")).__name__, away_raw_type=type(stat.get("awayRaw")).__name__,
            format=stat.get("format"), reliable=stat.get("reliable")))
    reserved = {"id", "name", "imageUrl", "playerRef", *APPEARANCE_TEXT, *APPEARANCE_NUMBER, *APPEARANCE_BOOL}
    for ordinal, person in enumerate(people):
        identity = dict(playerId=person["playerId"], name=person.get("name"), imageUrl=person.get("imageUrl"))
        ref = person.get("playerRef") or person["playerId"] + ":" + hashlib.sha256(canonical(identity).encode()).hexdigest()[:16]
        rows["players"].append(dict(id=ref, player_id=person["playerId"], name=person.get("name"), image_url=person.get("imageUrl")))
        appearance = dict(id=person["id"], player_ref=ref, ordinal=ordinal,
            position_id_type=type(person.get("positionId")).__name__,
            **{snake(k): person.get(k) for k in APPEARANCE_TEXT + APPEARANCE_BOOL},
            **{snake(k): number(person.get(k)) for k in APPEARANCE_NUMBER})
        appearance.update(season=season, league_id=league)
        if appearance["position_id"] is not None:
            appearance["position_id"] = str(appearance["position_id"])
        jersey = person.get("shirtNumber")
        if jersey is not None and type(jersey) not in (str, int, float, bool):
            raise ValueError("Shirt number must be a native scalar")
        rows["appearances"].append(appearance)
        rows["appearance_shirt_numbers"].append(dict(appearance_id=person["id"],
            value_text=None if jersey is None else str(jersey), value_type=type(jersey).__name__))
        rows["appearance_metrics"].extend(dict(appearance_id=person["id"], metric_key=key, value=number(value))
            for key, value in sorted(person.items()) if key not in reserved
            and (value is None or type(value) in (int, float)))
    members = match.get("players") or [p["id"] for p in people]
    rows["match_appearance_members"] = [dict(match_id=mid, appearance_id=pid, ordinal=i)
                                        for i, pid in enumerate(members)]
    return rows


def fixtures(snapshot, season, league):
    items = snapshot.get("fixtures")
    if items is None:
        items = [dict(id=m["id"], league=dict(id=league, name=m.get("league")),
            season=m.get("season") or season, date=m.get("date"), time_utc=m.get("timeUtc"),
            status=m.get("status"), home_team=dict(id=(m.get("home") or {}).get("id"),
                name=(m.get("home") or {}).get("name"), image_url=(m.get("home") or {}).get("imageUrl")),
            away_team=dict(id=(m.get("away") or {}).get("id"), name=(m.get("away") or {}).get("name"),
                image_url=(m.get("away") or {}).get("imageUrl")),
            score_home=(m.get("home") or {}).get("score"), score_away=(m.get("away") or {}).get("score"),
            round_name=m.get("roundName"), has_playoff=m.get("hasPlayoff"))
            for m in snapshot.get("matches") or []]
    result = {}
    for fixture in items:
        f = fixture
        if f["id"] in result:
            raise ValueError("Duplicate fixture in a publication")
        competition, home, away = f.get("league") or {}, f.get("home_team") or {}, f.get("away_team") or {}
        result[f["id"]] = dict(id=f["id"], season=season, league_id=competition.get("id") or league,
            native_season=f.get("season"), day=f.get("date"), time_utc=f.get("time_utc"), status=f.get("status"),
            round_name=None if f.get("round_name") is None else str(f["round_name"]),
            home_team_id=home.get("id"), home_name=home.get("name"), home_image_url=home.get("image_url"),
            away_team_id=away.get("id"), away_name=away.get("name"), away_image_url=away.get("image_url"),
            league_name=competition.get("name"), league_image_url=competition.get("image_url"),
            score_home=number(f.get("score_home")), score_away=number(f.get("score_away")),
            score_penalty_home=number(f.get("score_penalty_home")), score_penalty_away=number(f.get("score_penalty_away")),
            has_playoff=f.get("has_playoff"))
        if result[f["id"]]["league_id"] != league:
            raise ValueError("Fixture belongs to another competition")
    return result


def snapshot_state(value, season, league, *, source_digest=None):
    """Keep only small fingerprints before the caller mutates its in-memory tables."""
    return dict(source_digest=source_digest,
        matches={mid: fingerprint(match_rows(match, people, season, league))
                 for mid, (match, people) in match_inputs(value).items()},
        fixtures={mid: fingerprint(row) for mid, row in fixtures(value, season, league).items()},
        metrics=fingerprint(value.get("metrics") or []))


def upsert(db, table, rows, keys, *, latest_season=False):
    for batch in row_batches(rows):
        columns = list(batch[0])
        changed = [k for k in columns if k not in keys]
        identifiers = sql.SQL(",").join(map(sql.Identifier, columns))
        row_sql = sql.SQL("(") + sql.SQL(",").join(sql.Placeholder() for _ in columns) + sql.SQL(")")
        assignments = sql.SQL(",").join(sql.SQL("{}=EXCLUDED.{}").format(sql.Identifier(k), sql.Identifier(k)) for k in changed)
        old = sql.SQL(",").join(sql.SQL("target.{}").format(sql.Identifier(k)) for k in changed)
        new = sql.SQL(",").join(sql.SQL("EXCLUDED.{}").format(sql.Identifier(k)) for k in changed)
        statement = sql.SQL("INSERT INTO statarena_app.{} AS target ({}) VALUES {} ON CONFLICT ({}) DO UPDATE SET {} WHERE ({}) IS DISTINCT FROM ({})").format(
            sql.Identifier(table), identifiers, sql.SQL(",").join(row_sql for _ in batch),
            sql.SQL(",").join(map(sql.Identifier, keys)), assignments, old, new)
        if latest_season:
            statement += sql.SQL(" AND EXCLUDED.latest_season>=target.latest_season")
        db.execute(statement, [row.get(k) for row in batch for k in columns])


def assert_scope(db, table, mids, season, league):
    if not mids:
        return
    for start in range(0, len(mids), MAX_MATCHES):
        rows = db.execute(sql.SQL("SELECT id,season,league_id FROM statarena_app.{} WHERE id=ANY(%s)").format(sql.Identifier(table)),
                          (mids[start:start + MAX_MATCHES],))
        if any((s, l) != (season, league) for _, s, l in rows):
            raise ValueError("Cross-partition identity move requires an explicit coordinated publication")


def delete_scoped(db, table, mids, season, league):
    for start in range(0, len(mids), MAX_MATCHES):
        db.execute(sql.SQL("DELETE FROM statarena_app.{} WHERE season=%s AND league_id=%s AND id=ANY(%s)").format(sql.Identifier(table)),
                   (season, league, mids[start:start + MAX_MATCHES]))


def write_matches(db, items):
    mids = [mid for mid, _ in items]
    # Preserve match rows and their external references; only their changed facts
    # are replaced. Appearance children cascade using the existing FK indexes.
    db.execute("DELETE FROM statarena_app.match_appearance_members WHERE match_id=ANY(%s)", (mids,))
    db.execute("DELETE FROM statarena_app.appearances WHERE match_id=ANY(%s)", (mids,))
    for table in ("match_coverage", "match_warnings", "shots", "team_statistics"):
        db.execute(sql.SQL("DELETE FROM statarena_app.{} WHERE match_id=ANY(%s)").format(sql.Identifier(table)), (mids,))
    merged = {table: [row for _, group in items for row in group[table]]
              for table in ("matches", "players", *CHILD_TABLES)}
    upsert(db, "matches", merged["matches"], ["id"])
    _many(db, "players", merged["players"])
    for table in CHILD_TABLES:
        _many(db, table, merged[table])


def update_catalog(db, value, season, league):
    competitions = {c["id"]: c for c in value.get("competitions") or []}
    teams = {t["id"]: t for t in value.get("teams") or []}
    for match in value.get("matches") or []:
        competitions.setdefault(match.get("leagueId") or league,
            dict(id=match.get("leagueId") or league, name=match.get("league"), country=match.get("country")))
        for side in ("home", "away"):
            team = match.get(side) or {}
            if team.get("id"):
                teams.setdefault(team["id"], team)
    # Retain established profile values where a sparse source omits a field, as
    # the legacy publisher did. Guarded UPDATE avoids rewriting identical rows.
    for table, items, columns in (
        ("competitions", competitions.values(), ("name", "country", "provider_country", "image_url")),
        ("teams", teams.values(), ("name", "image_url", "country")),
    ):
        for item in items:
            cells = dict(id=item["id"], name=item.get("name"), country=item.get("country"),
                         image_url=item.get("imageUrl"), latest_season=season)
            if table == "competitions":
                cells["provider_country"] = item.get("providerCountry")
            fields = list(cells)
            assignments = sql.SQL(",").join(sql.SQL("{}=coalesce(EXCLUDED.{},target.{})").format(sql.Identifier(k), sql.Identifier(k), sql.Identifier(k)) for k in columns)
            db.execute(sql.SQL("INSERT INTO statarena_app.{} AS target ({}) VALUES ({}) ON CONFLICT(id) DO UPDATE SET {},latest_season=EXCLUDED.latest_season WHERE EXCLUDED.latest_season>=target.latest_season AND ({}) IS DISTINCT FROM ({})").format(
                sql.Identifier(table), sql.SQL(",").join(map(sql.Identifier, fields)),
                sql.SQL(",").join(sql.Placeholder() for _ in fields), assignments,
                sql.SQL(",").join(sql.SQL("target.{}").format(sql.Identifier(k)) for k in (*columns, "latest_season")),
                sql.SQL(",").join([*(sql.SQL("coalesce(EXCLUDED.{},target.{})").format(sql.Identifier(k), sql.Identifier(k)) for k in columns), sql.SQL("EXCLUDED.latest_season")])),
                [cells[k] for k in fields])
    upsert(db, "competition_seasons", [dict(competition_id=c["id"], season=season, sample_matches=c.get("sampleMatches") or 0)
                                        for c in competitions.values()], ["competition_id", "season"])
    upsert(db, "team_seasons", [dict(team_id=t["id"], season=season, league_id=league,
        name=t.get("name"), image_url=t.get("imageUrl"), sample_matches=t.get("sampleMatches") or 0)
        for t in teams.values()], ["team_id", "season", "league_id"])
    _many(db, "competition_catalog_seasons", [dict(competition_id=c["id"], native_season=native, ordinal=i)
        for c in competitions.values() for i, native in enumerate(c.get("seasons") or [season])])


def publish_incremental(db, season, league, value, *, previous_state=None):
    digest = publication_digest(value)
    prior = db.execute("SELECT source_digest FROM statarena_app.partitions WHERE season=%s AND league_id=%s", (season, league)).fetchone()
    if prior and prior[0] == digest:
        return 0
    if previous_state is not None and previous_state.get("source_digest") not in (None, prior[0] if prior else None):
        raise RuntimeError("Publication changed after the partition was read")
    if previous_state is None:
        from relational_snapshot import read_partition, snapshot
        previous = read_partition(db, season, league) if prior else None
        previous_state = snapshot_state(snapshot(previous["tables"], previous["meta"], previous["metrics"]), season, league) if previous else dict(matches={}, fixtures={}, metrics=None)
    incoming = match_inputs(value)
    assert_scope(db, "matches", sorted(incoming), season, league)
    delete_scoped(db, "matches", sorted(set(previous_state["matches"]) - set(incoming)), season, league)
    pending, pending_bytes, changed_count, batch_count = [], 0, 0, 0
    for mid in sorted(incoming):
        rows = match_rows(*incoming[mid], season, league)
        encoded = canonical(rows).encode()
        if previous_state["matches"].get(mid) == hashlib.sha256(encoded).hexdigest():
            continue
        if len(encoded) > MAX_MATCH_BYTES:
            raise ValueError("One match exceeds the core publication envelope; source work retained")
        if pending and (len(pending) >= MAX_MATCHES or pending_bytes + len(encoded) > MAX_MATCH_BYTES):
            write_matches(db, pending)
            batch_count += 1
            pending, pending_bytes = [], 0
        pending.append((mid, rows))
        pending_bytes += len(encoded)
        changed_count += 1
    if pending:
        write_matches(db, pending)
        batch_count += 1
    calendar = fixtures(value, season, league)
    assert_scope(db, "fixtures", sorted(calendar), season, league)
    delete_scoped(db, "fixtures", sorted(set(previous_state["fixtures"]) - set(calendar)), season, league)
    changed_fixtures = [row for mid, row in calendar.items() if previous_state["fixtures"].get(mid) != fingerprint(row)]
    upsert(db, "fixtures", changed_fixtures, ["id"])
    update_catalog(db, value, season, league)
    if prior:
        db.execute("DELETE FROM statarena_app.partition_counts WHERE season=%s AND league_id=%s", (season, league))
        db.execute("DELETE FROM statarena_app.partition_notes WHERE season=%s AND league_id=%s", (season, league))
    _partition_metadata(db, season, league, digest, value.get("meta") or {}, update=bool(prior))
    if previous_state["metrics"] != fingerprint(value.get("metrics") or []):
        db.execute("DELETE FROM statarena_app.partition_metrics WHERE season=%s AND league_id=%s", (season, league))
        for ordinal, metric in enumerate(value.get("metrics") or []):
            upsert(db, "metric_definitions", [dict(metric_key=metric["key"], label=metric.get("label"), unit=metric.get("unit"), decimals=metric.get("decimals"))], ["metric_key"])
            _many(db, "partition_metrics", [dict(season=season, league_id=league, metric_key=metric["key"], ordinal=ordinal)])
    db.execute("UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()")
    print(canonical(dict(phase="core-delta", season=season, league=league, changed_matches=changed_count,
                         match_batches=batch_count, changed_fixtures=len(changed_fixtures))), flush=True)
    return 1
