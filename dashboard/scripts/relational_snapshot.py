"""Reconstruct the last committed partition from typed RDS rows for incremental publication."""

from collections import defaultdict

from psycopg.rows import dict_row
from relational_core import (
    APPEARANCE_BOOL,
    APPEARANCE_NUMBER,
    APPEARANCE_TEXT,
    SHOT_BOOL,
    SHOT_NUMBER,
    SHOT_TEXT,
    SIDE_BOOL,
    SIDE_NUMBER,
    SIDE_TEXT,
    snake,
)

TABLES = (
    "players",
    "performances",
    "matches",
    "shots",
    "team_statistics",
    "teams",
    "competitions",
    "fixtures",
)


def typed_scalar(v, kind):
    if v is None:
        return None
    if kind == "bool":
        if v not in ("True", "False"):
            raise ValueError("Invalid stored boolean scalar")
        return v == "True"
    if kind in ("int", "float"):
        return float(v) if kind == "float" else int(v)
    return v


def read_partition(db, season, league):
    params = (season, league)

    def rows(statement):
        with db.cursor(row_factory=dict_row) as cur:
            return cur.execute(statement, params).fetchall()

    def fields(row, names, prefix=""):
        return {k: row[prefix + snake(k)] for k in names}

    def children(table, order):
        return rows(
            f"SELECT c.* FROM statarena_app.{table} c JOIN statarena_app.matches m ON m.id=c.match_id WHERE m.season=%s AND m.league_id=%s ORDER BY {order}"
        )

    prior = rows(
        "SELECT * FROM statarena_app.partitions WHERE season=%s AND league_id=%s"
    )
    if not prior:
        return None
    p = prior[0]
    meta = {
        k: p[snake(k)]
        for k in (
            "source",
            "retrievedAt",
            "ratingSource",
            "rankingAvailable",
            "startDate",
            "endDate",
        )
        if p[snake(k)] is not None
    }
    meta.update(
        {
            r["metric_key"]: r["value"]
            for r in rows(
                "SELECT metric_key,value FROM statarena_app.partition_counts WHERE season=%s AND league_id=%s"
            )
        }
    )
    meta["notes"] = [
        r["note"]
        for r in rows(
            "SELECT note FROM statarena_app.partition_notes WHERE season=%s AND league_id=%s ORDER BY ordinal"
        )
    ]
    metrics = [
        {
            "key": r["metric_key"],
            "label": r["label"],
            "unit": r["unit"],
            "decimals": r["decimals"],
        }
        for r in rows(
            "SELECT d.* FROM statarena_app.partition_metrics p JOIN statarena_app.metric_definitions d USING(metric_key) WHERE p.season=%s AND p.league_id=%s ORDER BY ordinal"
        )
    ]
    tables = {t: [] for t in TABLES}
    for r in rows(
        "SELECT * FROM statarena_app.fixtures WHERE season=%s AND league_id=%s ORDER BY day,id"
    ):

        def team(side, r=r):
            return {
                "id": r[side + "_team_id"],
                "name": r[side + "_name"],
                "image_url": r[side + "_image_url"],
            }

        tables["fixtures"].append(
            {
                "id": r["id"],
                "season": r["native_season"],
                "date": str(r["day"]) if r["day"] else None,
                "time_utc": r["time_utc"],
                "status": r["status"],
                "round_name": r["round_name"],
                "has_playoff": r["has_playoff"],
                "league": {
                    "id": league,
                    "name": r["league_name"],
                    "image_url": r["league_image_url"],
                },
                "home_team": team("home"),
                "away_team": team("away"),
                "score_home": r["score_home"],
                "score_away": r["score_away"],
                "score_penalty_home": r["score_penalty_home"],
                "score_penalty_away": r["score_penalty_away"],
            }
        )
    teams = rows(
        "SELECT s.*,t.country FROM statarena_app.team_seasons s JOIN statarena_app.teams t ON t.id=s.team_id WHERE s.season=%s AND s.league_id=%s ORDER BY team_id"
    )
    tables["teams"] = [
        {
            "id": r["team_id"],
            "name": r["name"],
            "imageUrl": r["image_url"],
            "country": r["country"],
            "sampleMatches": r["sample_matches"],
            "seasons": [season],
            "leagueIds": [league],
        }
        for r in teams
    ]
    comps = rows(
        "SELECT c.*,s.sample_matches,ARRAY(SELECT native_season FROM statarena_app.competition_catalog_seasons cs WHERE cs.competition_id=c.id ORDER BY ordinal,native_season) AS seasons FROM statarena_app.competition_seasons s JOIN statarena_app.competitions c ON c.id=s.competition_id WHERE s.season=%s AND c.id=%s"
    )
    tables["competitions"] = [
        {
            "id": r["id"],
            "name": r["name"],
            "country": r["country"],
            "providerCountry": r["provider_country"],
            "imageUrl": r["image_url"],
            "sampleMatches": r["sample_matches"],
            "seasons": r["seasons"],
            "sampleSeasons": [season],
        }
        for r in comps
    ]
    coverage = defaultdict(dict)
    warnings = defaultdict(list)
    members = defaultdict(list)
    for r in children("match_coverage", "c.match_id,c.coverage_key"):
        coverage[r["match_id"]][r["coverage_key"]] = (
            r["flag"] if r["flag"] is not None else r["count"]
        )
    for r in children("match_warnings", "c.match_id,c.kind,c.ordinal"):
        warnings[(r["match_id"], r["kind"])].append(r["value"])
    for r in children("match_appearance_members", "c.match_id,c.ordinal"):
        members[r["match_id"]].append(r["appearance_id"])
    for r in rows(
        "SELECT * FROM statarena_app.matches WHERE season=%s AND league_id=%s ORDER BY time_utc DESC NULLS LAST,id DESC"
    ):
        m = fields(
            r,
            [
                "id",
                "date",
                "timeUtc",
                "country",
                "league",
                "season",
                "leagueId",
                "status",
                "roundName",
                "hasPlayoff",
                "detailCollected",
            ],
        )
        for side in ("home", "away"):
            m[side] = fields(r, SIDE_TEXT + SIDE_NUMBER + SIDE_BOOL, side + "_")
        for k in ("referee", "stadium"):
            m[k] = {"id": r[k + "_id"], "name": r[k]} if r[k + "_object"] else r[k]
        m.update(
            players=members[m["id"]],
            coverage=coverage[m["id"]],
            warnings=warnings[m["id"], "warning"],
            warningCodes=warnings[m["id"], "code"],
        )
        tables["matches"].append(m)
    extras = defaultdict(dict)
    for r in rows(
        "SELECT e.* FROM statarena_app.appearance_metrics e JOIN statarena_app.appearances a ON a.id=e.appearance_id WHERE a.season=%s AND a.league_id=%s"
    ):
        extras[r["appearance_id"]][r["metric_key"]] = r["value"]
    players = {}
    for r in rows(
        "SELECT a.*,p.name,p.image_url,s.value_text AS shirt_number_raw,s.value_type AS shirt_number_type FROM statarena_app.appearances a JOIN statarena_app.players p ON p.id=a.player_ref LEFT JOIN statarena_app.appearance_shirt_numbers s ON s.appearance_id=a.id WHERE a.season=%s AND a.league_id=%s ORDER BY a.ordinal,a.id"
    ):
        cells = fields(r, APPEARANCE_TEXT + APPEARANCE_NUMBER + APPEARANCE_BOOL)
        cells["positionId"] = typed_scalar(r["position_id"], r["position_id_type"])
        if r["shirt_number_type"] is not None:
            cells["shirtNumber"] = typed_scalar(r["shirt_number_raw"], r["shirt_number_type"])
        tables["performances"].append(
            dict(cells, **extras[r["id"]], id=r["id"], playerRef=r["player_ref"])
        )
        players[r["player_ref"]] = {
            "id": r["player_ref"],
            "playerId": r["player_id"],
            "name": r["name"],
            "imageUrl": r["image_url"],
        }
    tables["players"] = list(players.values())
    for r in children("shots", "c.match_id,c.ordinal,c.id"):
        tables["shots"].append(
            dict(
                fields(r, SHOT_TEXT + SHOT_NUMBER + SHOT_BOOL),
                id=r["id"],
                matchId=r["match_id"],
            )
        )
    stats = defaultdict(list)

    for r in children("team_statistics", "c.match_id,c.ordinal"):
        stats[r["match_id"]].append(
            {
                "key": r["metric_key"],
                "label": r["label"],
                "home": r["home_value"],
                "away": r["away_value"],
                "homeRaw": typed_scalar(r["home_raw"], r["home_raw_type"]),
                "awayRaw": typed_scalar(r["away_raw"], r["away_raw_type"]),
                "format": r["format"],
                "reliable": r["reliable"],
            }
        )
    tables["team_statistics"] = [
        {"matchId": mid, "values": v} for mid, v in stats.items()
    ]
    return {"meta": meta, "metrics": metrics, "tables": tables}


def snapshot(tables, meta, metrics):
    players = {p["id"]: p for p in tables["players"]}
    shots = defaultdict(list)
    for s in tables["shots"]:
        shots[s["matchId"]].append({k: v for k, v in s.items() if k != "matchId"})
    stats = {r["matchId"]: r["values"] for r in tables["team_statistics"]}
    return {
        "meta": meta,
        "metrics": metrics,
        "teams": tables["teams"],
        "competitions": tables["competitions"],
        "fixtures": tables["fixtures"],
        "appearances": [
            dict(
                p,
                name=players[p["playerRef"]].get("name"),
                imageUrl=players[p["playerRef"]].get("imageUrl"),
            )
            for p in tables["performances"]
        ],
        "matches": [
            dict(m, shots=shots[m["id"]], stats=stats.get(m["id"], []))
            for m in tables["matches"]
        ],
    }
