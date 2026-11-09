"""Translate PitchAPI responses into typed, source-preserving row batches."""

from dataclasses import dataclass, field
from datetime import datetime, date, timezone
from decimal import Decimal, InvalidOperation
import math
import re
from .schema_contract import (
    PLAYER_STATS_COLUMNS,
    TEAM_STATS_COLUMNS,
    TEAM_ADVANCED_COLUMNS,
    PLAYER_ADVANCED_COLUMNS,
    PITCHAPI_PLAYER_KEYS,
    PITCHAPI_TEAM_KEYS,
    PLAYER_TOTAL_KEYS,
)


class NormalizationError(ValueError):
    """Controlled errors only: never include provider values in exception text."""


@dataclass(frozen=True)
class EntityRef:
    entity_type: str
    provider_key: str | None = None
    fields: dict = field(default_factory=dict)
    natural_name: str | None = None


@dataclass
class NormalizedFamily:
    rows: dict = field(default_factory=dict)
    references: list = field(default_factory=list)
    unknown_paths: set = field(default_factory=set)
    coverage: str = "ok"

    def add(self, table, row):
        self.rows.setdefault("core." + table, []).append(row)


_ID = re.compile(r"^[ltpm]_[A-Za-z0-9]{6}$")
_PATH = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,100}$")
_PERIOD = {
    "All": "all",
    "FirstHalf": "first_half",
    "SecondHalf": "second_half",
    "ExtraTime": "extra_time",
    "Penalties": "penalties",
}


def number(value, kind):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise NormalizationError("INVALID_NUMBER")
    try:
        n = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise NormalizationError("INVALID_NUMBER") from None
    if not n.is_finite():
        raise NormalizationError("INVALID_NUMBER")
    if kind == "smallint":
        if n != n.to_integral_value() or not -32768 <= n <= 32767:
            raise NormalizationError("SMALLINT_RANGE")
        return int(n)
    if kind == "real":
        if abs(n) > Decimal("3.4028234663852886e38"):
            raise NormalizationError("REAL_RANGE")
        result = float(n)
        if not math.isfinite(result):
            raise NormalizationError("REAL_RANGE")
        return result
    raise NormalizationError("INVALID_TYPE")


def _object(value):
    if not isinstance(value, dict):
        raise NormalizationError("INVALID_OBJECT")
    return value


def _list(value):
    if not isinstance(value, list):
        raise NormalizationError("INVALID_LIST")
    return value


def _key(value, prefix):
    if (
        not isinstance(value, str)
        or not _ID.fullmatch(value)
        or not value.startswith(prefix + "_")
    ):
        raise NormalizationError("INVALID_ID")
    return value


def _ref(out, kind, value, *, required=True):
    if value is None and not required:
        return None
    if isinstance(value, str):
        key = value
        fields = {}
    else:
        value = _object(value)
        key = value.get("id") or value.get("player_id")
        fields = {
            k: value[k]
            for k in (
                "name",
                "short_name",
                "country_code",
                "image_url",
                "position_id",
                "shirt_number",
            )
            if k in value
        }
        for key_name in ("position_id", "shirt_number"):
            if key_name in fields:
                fields[key_name] = number(fields[key_name], "smallint")
        for key_name in ("name", "short_name", "country_code", "image_url"):
            if (
                key_name in fields
                and fields[key_name] is not None
                and not isinstance(fields[key_name], str)
            ):
                raise NormalizationError("INVALID_REFERENCE")
    prefix = {"player": "p", "team": "t", "competition": "l", "match": "m"}[kind]
    key = _key(key, prefix)
    out.references.append(EntityRef(kind, key, fields))
    return key


def _natural(out, kind, value):
    if not value:
        return None
    name = value.get("name") if isinstance(value, dict) else value
    if not isinstance(name, str) or not name.strip():
        raise NormalizationError("INVALID_REFERENCE")
    out.references.append(EntityRef(kind, natural_name=name))
    return name


def _unknown(out, path):
    # Paths only, no values, and no arbitrary payload text.
    if isinstance(path, str) and _PATH.fullmatch(path):
        out.unknown_paths.add(path)


def _unknown_keys(out, prefix, obj, known):
    for key in obj:
        if key not in known and isinstance(key, str):
            _unknown(out, prefix + "." + key)


def _period(value):
    if not isinstance(value, str) or value not in _PERIOD:
        raise NormalizationError("UNKNOWN_PERIOD")
    return _PERIOD[value]


def _bool(value):
    if value is not None and not isinstance(value, bool):
        raise NormalizationError("INVALID_BOOLEAN")
    return value


def _typed_fields(obj, fields, types, aliases=None):
    aliases = aliases or {}
    row = {}
    for source, target in fields.items():
        if source in obj:
            name = aliases.get(target, target)
            row[name] = (
                number(obj[source], types[name]) if name in types else obj[source]
            )
    return row


def _match(out, item):
    item = _object(item)
    _unknown_keys(
        out,
        "match",
        item,
        {
            "id",
            "home_team",
            "away_team",
            "league",
            "status",
            "score_home",
            "score_away",
            "score_penalty_home",
            "score_penalty_away",
            "round",
            "round_name",
            "date",
            "time_utc",
            "has_playoff",
            "referee",
            "stadium",
            "season",
        },
    )
    mid = _ref(out, "match", item.get("id"))
    competition = (
        _ref(out, "competition", item["league"])
        if item.get("league") is not None
        else None
    )
    row = {
        "id": mid,
        "home_team_id": _ref(out, "team", item.get("home_team"), required=False),
        "away_team_id": _ref(out, "team", item.get("away_team"), required=False),
    }
    if competition is not None:
        row["provider_competition_id"] = competition
    if item.get("season") is not None:
        if not isinstance(item["season"], str) or not re.fullmatch(
            r"\d{4}(?:/\d{4})?", item["season"]
        ):
            raise NormalizationError("INVALID_SEASON")
        row["provider_season"] = item["season"]
    status = item.get("status")
    if status is not None:
        if status not in (
            "not_started",
            "in_play",
            "finished",
            "postponed",
            "awarded",
            "canceled",
        ):
            raise NormalizationError("UNKNOWN_STATUS")
        row["status"] = status
    for src, dst in [
        ("score_home", "home_score"),
        ("score_away", "away_score"),
        ("score_penalty_home", "home_penalty_score"),
        ("score_penalty_away", "away_penalty_score"),
    ]:
        if src in item:
            row[dst] = number(item[src], "smallint")
    for src, dst in [
        ("round", "round_name"),
        ("round_name", "round_name"),
        ("date", "match_date"),
        ("time_utc", "kickoff_at"),
    ]:
        if src in item:
            value = item[src]
            if value is not None and src == "date":
                try:
                    value = date.fromisoformat(value)
                except (ValueError, TypeError):
                    raise NormalizationError("INVALID_DATE") from None
            if value is not None and src == "time_utc":
                try:
                    value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    if value.tzinfo is None:
                        raise ValueError()
                    value = value.astimezone(timezone.utc)
                except (ValueError, TypeError, AttributeError):
                    raise NormalizationError("INVALID_TIMESTAMP") from None
            row[dst] = value
    if "has_playoff" in item:
        row["has_playoff"] = _bool(item["has_playoff"])
    if item.get("referee"):
        row["referee_id"] = _natural(out, "referee", item["referee"])
    if item.get("stadium"):
        row["venue_id"] = _natural(out, "venue", item["stadium"])
    out.add("matches", row)


def _player_stats(out, row, groups, *, half=False):
    for group in _list(groups):
        group = _object(group)
        stats = _object(group.get("stats"))
        for label, val in stats.items():
            val = _object(val)
            key = val.get("key")
            stat = _object(val.get("stat"))
            if (
                key == ""
                and stat.get("type") == "boolean"
                and isinstance(label, str)
                and re.sub(r"[^a-z]", "", label.lower()) == "shotmap"
            ):
                continue
            if key in ("xg_and_xa", "shot_accuracy"):
                continue
            if not isinstance(key, str):
                raise NormalizationError("INVALID_STAT_KEY")
            column = PITCHAPI_PLAYER_KEYS.get(key)
            if not column or (half and column in ("rating", "fantasy_points")):
                if isinstance(key, str):
                    _unknown(out, "player_stats." + key)
                continue
            typ = stat.get("type")
            if typ == "boolean":
                continue
            if typ not in (
                "integer",
                "double",
                "fraction",
                "fractionWithPercentage",
                "percentage",
                "distanceWithPercentage",
                "distance",
                "speed",
                "fantasyPoints",
            ):
                raise NormalizationError("UNKNOWN_STAT_FORMAT")
            row[column] = number(stat.get("value"), PLAYER_STATS_COLUMNS[column])
            if "total" in stat:
                total = PLAYER_TOTAL_KEYS.get(key, column + "_total")
                if total in PLAYER_STATS_COLUMNS:
                    row[total] = number(stat["total"], PLAYER_STATS_COLUMNS[total])
                elif key not in ("shot_accuracy",):
                    _unknown(out, "player_stats." + str(key) + ".total")


def _display(value, fmt):
    if fmt not in (None, "", "integer", "integerWithPercentage", "double", "distance"):
        raise NormalizationError("UNKNOWN_STAT_FORMAT")
    if value is None:
        return None, None, None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise NormalizationError("INVALID_STAT_VALUE")
    text = str(value).strip()
    if text in ("", "-", "—"):
        return None, None, None
    pattern = r"^([+-]?\d+(?:\.\d+)?)\s*(?:/\s*([+-]?\d+(?:\.\d+)?))?\s*(?:\(\s*([+-]?\d+(?:\.\d+)?)\s*%\s*\)|%)?$"
    match = re.fullmatch(pattern, text)
    if not match:
        raise NormalizationError("INVALID_STAT_VALUE")
    val, total, pct = match.groups()
    if text.endswith("%") and pct is None:
        pct = val
    return val, total, pct


def _advanced(out, item, player):
    cols = PLAYER_ADVANCED_COLUMNS if player else TEAM_ADVANCED_COLUMNS
    row = {"team_id": _ref(out, "team", item.get("team_id") or item.get("team"))}
    if player:
        row["player_id"] = _ref(out, "player", item.get("player"))
        row["minutes_played"] = number(item.get("minutes_played"), "smallint")
    if "actions" in item:
        row["actions"] = number(item["actions"], cols["actions"])
    groups = (
        "possession_value",
        "passing",
        "carrying",
        "creation",
        "defending",
        "territory",
        "tempo",
        "goalkeeping",
    )
    for group in groups:
        values = item.get(group)
        if values is None:
            continue
        for key, value in _object(values).items():
            if key == "chances_created":
                continue
            if key == "sca_breakdown":
                for cat, n in _object(value).items():
                    col = "sca_" + cat
                    if col in cols:
                        row[col] = number(n, cols[col])
                    else:
                        _unknown(out, group + ".sca_breakdown." + cat)
                if player:
                    for cat in (
                        "pass_live",
                        "pass_dead",
                        "take_on",
                        "shot",
                        "defensive",
                    ):
                        col = "sca_" + cat
                        if col in cols and col not in row:
                            row[col] = 0
                continue
            if key in cols:
                row[key] = number(value, cols[key])
            else:
                _unknown(out, group + "." + str(key))
    return row


def normalize_family(family, data, *, match_id=None):
    """Consume the unwrapped data object; failures raise a value-free error."""
    out = NormalizedFamily()
    if match_id is not None:
        _key(match_id, "m")
    roots = {
        "leagues": {"leagues"},
        "league_matches": {"league", "matches", "season"},
        "date": {"date", "matches"},
        "shots": {"match_id", "periods"},
        "events": {"match_id", "events"},
        "lineups": {"match_id", "home_team", "away_team", "home", "away"},
        "momentum": {"match_id", "points"},
        "h2h": {
            "match_id",
            "home_team",
            "away_team",
            "home_wins",
            "draws",
            "away_wins",
            "total_matches",
            "recent_matches",
        },
        "stats": {"match_id", "home_team", "away_team", "periods"},
        "players_halves": {"match_id", "players"},
        "advanced": {"match_id", "teams"},
        "advanced_players": {"match_id", "sorted_by", "players"},
        "advanced_network": {"match_id", "networks"},
        "heatmaps": {"match_id", "grid", "teams", "players"},
    }
    if family in roots and isinstance(data, dict):
        _unknown_keys(out, family, data, roots[family])
    if (
        isinstance(data, dict)
        and "match_id" in data
        and match_id
        and data["match_id"] != match_id
    ):
        raise NormalizationError("MATCH_ID_MISMATCH")
    if family in ("leagues", "league"):
        entries = (
            _list(_object(data).get("leagues"))
            if family == "leagues"
            else [_object(data)]
        )
        for item in entries:
            item = _object(item)
            _unknown_keys(
                out,
                "league",
                item,
                {
                    "id",
                    "name",
                    "country_code",
                    "image_url",
                    "seasons",
                    "season",
                    "is_free",
                },
            )
            key = _ref(out, "competition", item)
            out.add(
                "competitions",
                {
                    "id": key,
                    "name": item.get("name"),
                    "country_code": item.get("country_code"),
                    "image_url": item.get("image_url"),
                },
            )
            seasons = item.get("seasons", [item["season"]] if "season" in item else [])
            for label in _list(seasons):
                if not isinstance(label, str) or not re.fullmatch(
                    r"\d{4}(?:/\d{4})?", label
                ):
                    raise NormalizationError("INVALID_SEASON")
                out.add(
                    "competition_seasons",
                    {"competition_id": key, "native_label": label},
                )
    elif family in ("league_matches", "date"):
        data = _object(data)
        if isinstance(data.get("league"), dict):
            _ref(out, "competition", data["league"])
        for item in _list(data.get("matches")):
            _match(out, item)
    elif family in ("team", "player"):
        item = _object(data)
        _unknown_keys(
            out,
            family,
            item,
            {
                "id",
                "name",
                "short_name",
                "country_code",
                "image_url",
                "shirt_number",
                "position_id",
            },
        )
        key = _ref(out, family, item)
        row = {"id": key}
        for k in ("name", "short_name", "country_code", "image_url"):
            if k in item:
                row[k] = item[k]
        if family == "player":
            for k in ("shirt_number", "position_id"):
                if k in item:
                    row[k] = number(item[k], "smallint")
        out.add(family + "s", row)
    elif family == "summary":
        if match_id and _object(data).get("id") != match_id:
            raise NormalizationError("MATCH_ID_MISMATCH")
        _match(out, _object(data))
    elif family == "momentum":
        for item in _list(_object(data).get("points")):
            item = _object(item)
            out.add(
                "match_momentum",
                {
                    "minute": number(item.get("minute"), "real"),
                    "value": number(item.get("value"), "real"),
                },
            )
    elif family == "h2h":
        item = _object(data)
        out.add(
            "match_h2h",
            {
                k: number(item.get(k), "smallint")
                for k in ("home_wins", "draws", "away_wins", "total_matches")
            },
        )
    elif family == "events":
        types = {
            "goal": "goal",
            "substitution": "substitution",
            "yellowcard": "yellow_card",
            "redcard": "red_card",
        }
        for i, item in enumerate(_list(_object(data).get("events"))):
            item = _object(item)
            kind = types.get(str(item.get("event_type", "")).replace("_", "").lower())
            if kind is None:
                raise NormalizationError("UNKNOWN_EVENT_TYPE")
            row = {
                "seq": number(i, "smallint"),
                "event_type": kind,
                "team_id": _ref(out, "team", item.get("team_id"), required=False),
                "player_id": _ref(out, "player", item.get("player"), required=False),
                "related_player_id": _ref(
                    out, "player", item.get("sub_in_player"), required=False
                ),
            }
            for k in ("minute", "minute_added", "score_home", "score_away"):
                if k in item:
                    row[k] = number(item[k], "smallint")
            if item.get("period") is not None:
                row["period"] = _period(item["period"])
            for k in ("is_own_goal", "is_penalty"):
                if k in item:
                    row[k] = _bool(item[k])
            out.add("match_events", row)
    elif family == "shots":
        obj = _object(data)
        seq = 0
        for group in _list(obj.get("periods")):
            group = _object(group)
            period = _period(group.get("period"))
            for item in _list(group.get("shots")):
                item = _object(item)
                _unknown_keys(
                    out,
                    "shots.item",
                    item,
                    {
                        "id",
                        "player",
                        "team_id",
                        "x",
                        "y",
                        "expected_goals",
                        "expected_goals_on_target",
                        "is_on_target",
                        "goal_crossed_y",
                        "goal_crossed_z",
                        "is_inside_box",
                        "shot_type",
                        "situation",
                        "minute",
                        "minute_added",
                        "event_type",
                        "is_blocked",
                        "blocked_x",
                        "blocked_y",
                        "is_own_goal",
                        "is_saved_off_line",
                        "keeper",
                    },
                )
                row = {
                    "shot_no": number(seq, "smallint"),
                    "period": period,
                    "team_id": _ref(out, "team", item.get("team_id")),
                    "player_id": _ref(
                        out, "player", item.get("player"), required=False
                    ),
                }
                seq += 1
                if item.get("id") is not None:
                    if not isinstance(item["id"], str) or not re.fullmatch(
                        r"s_[A-Za-z0-9]{6}", item["id"]
                    ):
                        raise NormalizationError("INVALID_SHOT_ID")
                    row["provider_shot_key"] = item["id"]
                if item.get("keeper") is not None:
                    row["keeper_id"] = _ref(out, "player", item["keeper"])
                for src, dst in [
                    ("x", "x"),
                    ("y", "y"),
                    ("expected_goals", "xg"),
                    ("expected_goals_on_target", "xgot"),
                    ("goal_crossed_y", "goal_crossed_y"),
                    ("goal_crossed_z", "goal_crossed_z"),
                    ("blocked_x", "blocked_x"),
                    ("blocked_y", "blocked_y"),
                ]:
                    if src in item:
                        row[dst] = number(item[src], "real")
                for k in ("minute", "minute_added"):
                    if k in item:
                        row[k] = number(item[k], "smallint")
                for k in (
                    "is_on_target",
                    "is_inside_box",
                    "is_blocked",
                    "is_own_goal",
                    "is_saved_off_line",
                ):
                    if k in item:
                        row[k] = _bool(item[k])
                for src, dst, values in [
                    (
                        "event_type",
                        "outcome",
                        {
                            "Goal": "goal",
                            "AttemptSaved": "saved",
                            "Miss": "miss",
                            "Post": "post",
                        },
                    ),
                    (
                        "shot_type",
                        "body_part",
                        {
                            "RightFoot": "right_foot",
                            "LeftFoot": "left_foot",
                            "Header": "header",
                            "OtherBodyParts": "other",
                        },
                    ),
                ]:
                    if item.get(src) is not None:
                        if not isinstance(item[src], str) or item[src] not in values:
                            raise NormalizationError("UNKNOWN_SHOT_ENUM")
                        row[dst] = values[item[src]]
                if item.get("situation") is not None:
                    situations = {
                        "RegularPlay": "regular_play",
                        "FromCorner": "from_corner",
                        "SetPiece": "set_piece",
                        "FastBreak": "fast_break",
                        "FreeKick": "free_kick",
                        "ThrowInSetPiece": "throw_in_set_piece",
                        "Penalty": "penalty",
                        "IndividualPlay": "individual_play",
                    }
                    if (
                        not isinstance(item["situation"], str)
                        or item["situation"] not in situations
                    ):
                        raise NormalizationError("UNKNOWN_SHOT_ENUM")
                    row["situation"] = situations[item["situation"]]
                out.add("shots", row)
    elif family == "lineups":
        obj = _object(data)
        for side in ("home", "away"):
            block = _object(obj.get(side))
            team = _ref(out, "team", obj.get(side + "_team"))
            out.add(
                "lineups",
                {
                    "team_id": team,
                    "side": side,
                    "formation": block.get("formation"),
                    "confirmed": _bool(block.get("confirmed")),
                    "lineup_type": block.get("lineup_type"),
                    "coach_id": _natural(out, "coach", block.get("coach")),
                },
            )
            for key, starter in [("starters", True), ("substitutes", False)]:
                players = block.get(
                    key, block.get("subs") if key == "substitutes" else None
                )
                for item in _list(players):
                    item = _object(item)
                    row = {
                        "team_id": team,
                        "player_id": _ref(out, "player", item),
                        "is_starter": starter,
                    }
                    for k in ("shirt_number", "position_id"):
                        if k in item:
                            row[k] = number(item[k], "smallint")
                    if "is_captain" in item:
                        row["is_captain"] = _bool(item["is_captain"])
                    if starter:
                        for src, dst in [
                            ("pitch_x", "pitch_x"),
                            ("pitch_y", "pitch_y"),
                        ]:
                            if src in item:
                                row[dst] = number(item[src], "real")
                    out.add("lineup_players", row)
    elif family in ("players", "players_halves"):
        entries = (
            _list(data) if family == "players" else _list(_object(data).get("players"))
        )
        for item in entries:
            item = _object(item)
            pid = _ref(out, "player", item.get("player"))
            tid = _ref(out, "team", item.get("team_id"))
            periods = (
                [{"stats": item.get("stats")}]
                if family == "players"
                else _list(item.get("periods"))
            )
            for period in periods:
                period = _object(period)
                row = {"player_id": pid, "team_id": tid}
                if family == "players_halves":
                    row["period"] = _period(period.get("period"))
                _player_stats(
                    out, row, period.get("stats"), half=family == "players_halves"
                )
                out.add(
                    (
                        "player_match_stats"
                        if family == "players"
                        else "player_match_half_stats"
                    ),
                    row,
                )
    elif family == "stats":
        obj = _object(data)
        teams = {
            side: _ref(out, "team", obj.get(side + "_team"))
            for side in ("home", "away")
        }
        for period in _list(obj.get("periods")):
            period = _object(period)
            rows = {
                side: {"team_id": teams[side], "period": _period(period.get("period"))}
                for side in teams
            }
            for group in _list(period.get("groups")):
                for item in _list(_object(group).get("items")):
                    item = _object(item)
                    key = item.get("key")
                    if not isinstance(key, str):
                        raise NormalizationError("INVALID_STAT_KEY")
                    column = PITCHAPI_TEAM_KEYS.get(key)
                    if not column:
                        if isinstance(key, str):
                            _unknown(out, "team_stats." + key)
                        continue
                    for side in teams:
                        value, total, pct = _display(
                            item.get(side), item.get("format_type")
                        )
                        rows[side][column] = number(value, TEAM_STATS_COLUMNS[column])
                        pct_column = {
                            "long_balls_accurate": "long_balls_pct",
                            "accurate_crosses": "crosses_pct",
                            "ground_duels_won": "ground_duels_pct",
                            "aerials_won": "aerials_pct",
                            "dribbles_succeeded": "dribbles_pct",
                        }.get(column, column + "_pct")
                        if pct is not None and pct_column in TEAM_STATS_COLUMNS:
                            rows[side][pct_column] = number(pct, "real")
                        if (
                            total is not None
                            and column + "_total" in TEAM_STATS_COLUMNS
                        ):
                            rows[side][column + "_total"] = number(
                                total, TEAM_STATS_COLUMNS[column + "_total"]
                            )
            for row in rows.values():
                out.add("team_match_stats", row)
    elif family in ("advanced", "advanced_players"):
        obj = _object(data)
        player = family == "advanced_players"
        entries = _list(obj.get("players" if player else "teams"))
        for item in entries:
            out.add(
                "player_match_advanced" if player else "team_match_advanced",
                _advanced(out, _object(item), player),
            )
    elif family == "advanced_network":
        for item in _list(_object(data).get("networks")):
            item = _object(item)
            team = _ref(out, "team", item.get("team"))
            window = _object(item.get("window"))
            out.add(
                "pass_network_teams",
                {
                    "team_id": team,
                    "window_kind": window.get("kind"),
                    "window_until_s": number(window.get("until_seconds"), "real"),
                    "centralization": number(item.get("centralization"), "real"),
                },
            )
            for node in _list(item.get("nodes")):
                node = _object(node)
                row = {
                    "team_id": team,
                    "player_id": _ref(out, "player", node.get("player")),
                }
                for k in ("avg_x", "avg_y", "betweenness", "clustering"):
                    row[k] = number(node.get(k), "real")
                for k in ("passes", "passes_received", "degree", "strength"):
                    row[k] = number(node.get(k), "smallint")
                out.add("pass_network_nodes", row)
            for edge in _list(item.get("edges")):
                edge = _object(edge)
                out.add(
                    "pass_network_edges",
                    {
                        "team_id": team,
                        "from_player_id": _ref(out, "player", edge.get("from")),
                        "to_player_id": _ref(out, "player", edge.get("to")),
                        "passes": number(edge.get("passes"), "smallint"),
                    },
                )
    elif family == "heatmaps":
        obj = _object(data)
        grid = _object(obj.get("grid"))
        if (grid.get("length"), grid.get("width"), grid.get("frame")) != (
            16,
            12,
            "acting_ltr",
        ):
            raise NormalizationError("INVALID_HEATMAP_GRID")
        for kind in ("teams", "players"):
            for item in _list(obj.get(kind)):
                item = _object(item)
                row = {
                    "team_id": _ref(out, "team", item.get("team")),
                    "actions": number(item.get("actions"), "smallint"),
                }
                cells = [0] * 192
                seen = set()
                if kind == "players":
                    row["player_id"] = _ref(out, "player", item.get("player"))
                for cell in _list(item.get("cells")):
                    if not isinstance(cell, list) or len(cell) != 3:
                        raise NormalizationError("INVALID_HEATMAP_CELL")
                    x, y, n = (number(v, "smallint") for v in cell)
                    if (
                        x is None
                        or y is None
                        or n is None
                        or not (0 <= x < 16 and 0 <= y < 12 and n >= 0)
                        or (x, y) in seen
                    ):
                        raise NormalizationError("INVALID_HEATMAP_CELL")
                    seen.add((x, y))
                    cells[y * 16 + x] = n
                row["cells"] = cells
                out.add("team_heatmaps" if kind == "teams" else "player_heatmaps", row)
    else:
        raise NormalizationError("UNSUPPORTED_FAMILY")
    return out
