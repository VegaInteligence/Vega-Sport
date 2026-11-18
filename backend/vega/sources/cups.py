"""Cup editions of OpenFootball, OpenLigaDB and International Results, read by main's own
source projections (scripts/source-projections, through backend/sources/bridge.mjs) for the
editions main refreshes (scripts/aws_refresh_sources.mjs), written as typed matches.

A source answer that is not 200 keeps the last edition written (main: "une source
temporairement indisponible ne remplace pas son dernier instantané valide"), and so does a 200
that would drop or unplay a result already held, or whose scores cannot be read (snapshot.py,
FAILURE_MODES.md §19).
"""

from datetime import timedelta
import hashlib
import json
import re
from urllib.parse import urlencode

from . import SourceError, cup_periods, snapshot
from ..seasons import sporting_season
from ..store import Store

WORLD_CUP_YEARS = ("1930", "1934", "1938", "1950", "1954", "1958", "1962", "1966", "1970", "1974", "1978", "1982",
                   "1986", "1990", "1994", "1998", "2002", "2006", "2010", "2014", "2018", "2022", "2026")
# frontend/src/services/cup-archives.js (NATIONAL_CUP_ARCHIVES keys and seasons).
NATIONAL_CUP_ARCHIVES = ("austria-cup-archive", "germany-cup-archive", "fa-cup-archive", "efl-cup-archive", "copa-del-rey-archive",
                         "coppa-italia-archive", "knvb-beker-archive", "portugal-cup-archive", "swiss-cup-archive")
# The editions main refreshes (aws_refresh_sources.mjs); drift-tested.
EDITIONS = (
    *[("open-cups", "euro", s) for s in ("2020", "2024", "2028")],
    *[("open-cups", "world-cup-history", s) for s in WORLD_CUP_YEARS],
    # The yearly Club World Cups played since the base's first season (2021/2022).
    *[("open-cups", "club-world-cup", s) for s in ("2021", "2022", "2023", "2025")],
    ("open-cups", "france-cup", "2024/2025"),
    ("nations-results", "nations-league", "2026/2027"),
    *[("open-cups", key, "2024/2025") for key in NATIONAL_CUP_ARCHIVES],
    ("openligadb", "nations-league", "2026/2027"),
    ("openligadb", "germany-cup", "2025/2026"),
    ("openligadb", "germany-cup", "2026/2027"),
    # The other confederations' club competitions (OpenFootball), since the base's first season.
    *[("open-cups", "copa-libertadores", s) for s in ("2021", "2022", "2023", "2024", "2025", "2026")],
    *[("open-cups", "copa-sudamericana", s) for s in ("2021", "2022", "2023", "2024", "2025")],
    *[("open-cups", "concacaf-champions", s) for s in ("2021", "2022", "2023", "2024", "2025")],
    *[("open-cups", "caf-champions-league", s) for s in ("2023/2024", "2024/2025")],
    # The other confederations' national-team tournaments (International Results).
    *[("nations-results", "afcon", s) for s in ("2021", "2023", "2025")],
    ("nations-results", "copa-america", "2024"),
    ("nations-results", "asian-cup", "2023"),
    *[("nations-results", "gold-cup", s) for s in ("2023", "2025")],
)
PROVIDER = {"open-cups": "openfootball", "openligadb": "openligadb", "nations-results": "international_results"}
# The tournament each summer cup is, for its Vega season (seasons.py: played in June/July,
# it belongs to the season that ends then).
TOURNAMENTS = {"euro": "Euro", "world-cup-history": "World Cup", "club-world-cup": "Club World Cup",
               "afcon": "Africa Cup of Nations", "copa-america": "Copa America", "asian-cup": "Asian Cup", "gold-cup": "Gold Cup"}


def scopes(now):
    """Running editions every two hours, finished ones weekly."""
    out = {}
    for kind, competition, season in EDITIONS:
        recent = int(season[:4]) >= now.year - 1
        out[f"{kind}:{competition}:{season}"] = timedelta(hours=2) if recent else timedelta(days=7)
    return out


def bridge(command, *args):
    from . import wikidata

    return wikidata.bridge(command, *args)


def _pair(value):
    return value if isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value) else None


# The version of what match_rows stores: an edition's digest is that of its rows under this version,
# so a reader that stores something else writes every edition again, once (FAILURE_MODES.md §19).
CUP_ROWS_VERSION = "cup-rows-v2"
SCORE_PARTS = ("ft", "ht", "et", "p")
CANCELED = ("canceled", "cancelled")
TOURS_AWARD = "france-cup:2024/2025:2024-12-21|Tours FC|FC Lorient|"
CUP_PUBLICATION = {"club-world-cup", "world-cup-history", "france-cup"}


def score_parts(score):
    """An OpenFootball score as {part: [home, away]} ({} without a result).

    worldcup.json writes a full-time result as {"ft": [2, 1], "ht": […]} or, in most editions
    from 1950 to 2014 and seven matches of 2022, as [2, 1]: the same full-time result.
    shared/openfootball-history.js openFootballScore reads it alike. Anything else is
    INVALID_SCORE: the edition is not written."""
    if score is None:
        return {}
    parts = {"ft": score} if isinstance(score, list) else score
    if not isinstance(parts, dict) or any(k not in SCORE_PARTS or _pair(v) is None for k, v in parts.items()):
        raise SourceError("INVALID_SCORE")
    if parts and "ft" not in parts and "et" not in parts:
        raise SourceError("INVALID_SCORE")  # a half time or a shoot-out without the match's score
    return {k: list(v) for k, v in parts.items()}


def _open_cup_status(m, parts, key):
    status = m.get("status")
    if status is None:
        return "finished" if parts else "not_started"
    if status == "awarded" and key == TOURS_AWARD and parts == {"ft": [0, 3]}:
        return "awarded"
    if status in CANCELED and not parts:
        return "canceled"
    raise SourceError("INVALID_STATUS")


def _number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def match_rows(kind, competition, season, body):
    """(provider key, row) per source match, in source order."""
    out = []
    typed_dfb = cup_periods.applies(kind, competition, season)
    for position, m in enumerate(body.get("matches") or []):
        if kind == "open-cups":
            parts = score_parts(m.get("score"))
            ft, ht, et, p = (parts.get(k) for k in SCORE_PARTS)
            final = et or ft
            key = f"{competition}:{season}:{m.get('date') or ''}|{m.get('team1') or ''}|{m.get('team2') or ''}|{m.get('num') or ''}"
            status = _open_cup_status(m, parts, key)
            if status == "awarded" and m.get("sourceStatus") != "[awarded]":
                raise SourceError("INVALID_STATUS")
            if status == "awarded":
                ft = ht = et = p = None  # the administrative tally is not a phase played on the field
            row = {
                "home": m.get("team1"), "away": m.get("team2"), "home_key": f"name:{m.get('team1')}", "away_key": f"name:{m.get('team2')}",
                "date": m.get("date") or None, "round": m.get("round") or None, "group": m.get("group"), "number": _number(m.get("num")),
                "status": status,
                "home_score": final and final[0], "away_score": final and final[1],
                "home_score_90": ft[0] if ft and et else None, "away_score_90": ft[1] if ft and et else None,
                "home_score_ht": ht and ht[0], "away_score_ht": ht and ht[1],
                "home_score_et": et and et[0], "away_score_et": et and et[1],
                "home_penalty_score": p and p[0], "away_penalty_score": p and p[1], "is_neutral": None,
            }
        else:
            score, penalties = _pair(m.get("score")), _pair(m.get("penalties"))
            if not typed_dfb and (m.get("status") == "finished" and score is None or m.get("penalties") is not None and penalties is None):
                raise SourceError("INVALID_SCORE")  # a finished match without its score, or unreadable penalties
            extra = "après prolongation" in (m.get("notes") or [])
            row = {
                "home": m.get("home"), "away": m.get("away"), "home_key": str(m.get("homeId")), "away_key": str(m.get("awayId")),
                "date": m.get("date") or None, "round": m.get("round") or None,
                "group": (f"{m['league']}{m['group']}" if kind == "nations-results" else str(m["group"])) if m.get("group") is not None else None,
                "number": None, "status": "finished" if m.get("status") == "finished" else "not_started",
                "home_score": score and score[0], "away_score": score and score[1], "home_score_90": None, "away_score_90": None,
                "home_score_ht": None, "away_score_ht": None,
                "home_score_et": score[0] if score and extra else None, "away_score_et": score[1] if score and extra else None,
                "home_penalty_score": penalties and penalties[0], "away_penalty_score": penalties and penalties[1],
                # A tournament's dataset says whether the ground was neutral (the Nations League's rows do not).
                "is_neutral": m["neutral"] if isinstance(m.get("neutral"), bool) else None,
            }
            key = str(m["key"]).split(":", 1)[1]
            if typed_dfb:
                row.update(cup_periods.score_columns(cup_periods.read(season, key, m)))
        out.append((key, dict(row, position=position)))
    return out


def _team(conn, provider, key, name):
    row = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider=%s AND provider_key=%s", (provider, key)).fetchone()
    if row:
        if name:
            # A team another source also holds (PitchAPI's, or a nation two cup sources share) keeps
            # its name; the source's spelling is a name of that source (identity.py).
            if conn.execute("SELECT 1 FROM core.provider_ids WHERE entity_type='team' AND entity_id=%s AND provider<>%s", (row[0], provider)).fetchone():
                from .identity import spelling_row

                spelling_row(conn, row[0], provider, name)  # a name of that source (search)
            else:
                conn.execute("UPDATE core.teams SET name=%s WHERE id=%s AND name<>%s", (name, row[0], name))
        return row[0]
    team = conn.execute("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (name or key,)).fetchone()[0]
    conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team',%s,%s,%s)", (provider, key, team))
    # A team the base did not know: the identity pass (identity.py), due once a day, looks
    # at it at its next turn (an hour after its last one at the earliest) rather than the next day.
    conn.execute("UPDATE ops.source_runs SET last_success_at = NULL WHERE source = 'vega' AND scope = 'team_identity'")
    return team


def unique_rows(rows):
    """One row per provider key, in source order. Rows sharing a key (two « N.N. » fixtures of a day)
    are one match, written from the last of them, as the baseline writer did."""
    last = {key: row for key, row in rows}
    return [(key, row) for key, row in rows if last[key] is row]


def rows_digest(name, rows):
    """The digest of what an edition stores (CUP_ROWS_VERSION, its name, its rows in source order)."""
    return hashlib.sha256(json.dumps({"version": CUP_ROWS_VERSION, "name": name, "rows": rows}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _round(conn, edition, name):
    found = conn.execute("SELECT id FROM core.rounds WHERE competition_season_id=%s AND name=%s", (edition, name)).fetchone()
    return found[0] if found else conn.execute("INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s) RETURNING id", (edition, name)).fetchone()[0]


def _guard_open_cup(before, rows, cup_key, reviewed_halves):
    """Keep the already published phase/award when a later source body sheds a fact."""
    statuses = {key: ("finished" if key == TOURS_AWARD and m["status"] == "awarded"
                     and before.get(key, {}).get("home_score") == 0 and before[key].get("away_score") == 3
                     else m["status"]) for key, m in rows}
    snapshot.guard("openfootball", before, statuses, cup_key)
    after = dict(rows)
    for key, old in before.items():
        new = after.get(key)
        if old["status"] == "awarded" and (new is None or new["status"] != "awarded"):
            raise SourceError("PERIODS_CONFLICT", f"{key}: the accepted award would be removed")
        if not new or new["status"] == "awarded":
            continue
        for part in ("score_ht", "score_et", "score_90", "penalty_score"):
            prior = [old[f"{side}_{part}"] for side in ("home", "away")]
            next_pair = [new[f"{side}_{part}"] for side in ("home", "away")]
            if prior == [None, None] or prior == next_pair:
                continue
            if part == "score_ht" and reviewed_halves.get(key) == prior:
                continue
            raise SourceError("PERIODS_CONFLICT", f"{key}: the known {part} would change")



def save(conn, kind, competition, season, body, now):
    """Write one edition from its source body; returns the matches added, changed or removed.

    Refused (SourceError, nothing written): unreadable scores or statuses, and a body that would
    drop or unplay a result the base holds (snapshot.guard)."""
    provider = PROVIDER[kind]
    name = body.get("name") or competition
    cup_key = f"{kind}:{competition}:{season}"
    label = sporting_season(season, league_name=TOURNAMENTS.get(competition))
    if label is None:
        raise SourceError("INVALID_SEASON")
    typed_dfb = cup_periods.applies(kind, competition, season)
    if typed_dfb:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (cup_key,))
    source_rows = match_rows(kind, competition, season, body)
    rows = unique_rows(source_rows)
    if typed_dfb and len(source_rows) != len(rows):
        raise SourceError("INVALID_PERIODS", f"{cup_key}: duplicate match keys")
    digest = rows_digest(body.get("name"), rows)
    stored = conn.execute("SELECT id, cup_digest, cup_name FROM core.competition_seasons WHERE cup_key=%s", (cup_key,)).fetchone()
    before = {}
    if stored is None or stored[1] != digest:
        before = snapshot.stored(conn, provider, stored and stored[0])
        if kind == "open-cups" and competition in CUP_PUBLICATION:
            reviewed_halves = {
                f"{competition}:{season}:{m.get('date') or ''}|{m.get('team1') or ''}|{m.get('team2') or ''}|{m.get('num') or ''}":
                m["attestedHalf"]["before"] for m in body["matches"] if m.get("attestedHalf")
            } if competition == "world-cup-history" else {}
            _guard_open_cup(before, rows, cup_key, reviewed_halves)
        else:
            snapshot.guard(provider, before, {key: m["status"] for key, m in rows}, cup_key)
        if typed_dfb:
            cup_periods.guard(conn, provider, before, rows)
    season_id = Store(conn).season(label)
    family = f"cup:{kind}:{competition}"
    row = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider='vega' AND provider_key=%s", (family,)).fetchone()
    comp = row[0] if row else conn.execute("INSERT INTO core.competitions(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]
    if not row:
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','vega',%s,%s)", (family, comp))
    source = body.get("source") or {}
    # The read is accepted: its time, the edition's name and links (cup_checked_at: the last accepted read).
    edition = conn.execute(
        """INSERT INTO core.competition_seasons(competition_id, season_id, native_label, cup_key, cup_name, cup_source_url, cup_data_url,
             cup_checked_at, cup_updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (cup_key) DO UPDATE SET cup_name=EXCLUDED.cup_name, cup_source_url=EXCLUDED.cup_source_url,
             cup_data_url=EXCLUDED.cup_data_url, cup_checked_at=EXCLUDED.cup_checked_at, updated_at=now()
           RETURNING id""",
        (comp, season_id, season, cup_key, body.get("name"), source.get("url"), source.get("dataUrl"), now, now),
    ).fetchone()[0]
    if stored is not None and stored[1] == digest:
        return 0  # the same rows: nothing written again
    elsewhere = snapshot.elsewhere(conn, provider, edition, [key for key, _ in rows if key not in before])
    if typed_dfb and elsewhere:
        raise SourceError("PERIODS_CONFLICT", f"match keys already bound to another edition: {', '.join(sorted(elsewhere))}")
    snapshot.guard(provider, elsewhere, {key: m["status"] for key, m in rows}, cup_key)
    before.update(elsewhere)
    changes, keep = 0, set()
    for key, m in rows:
        home = m.get("home_existing_id") or (_team(conn, provider, m["home_key"], m["home"]) if m["home"] else None)
        away = m.get("away_existing_id") or (_team(conn, provider, m["away_key"], m["away"]) if m["away"] else None)
        values = {k: m[k] for k in ("status", "home_score", "away_score", "home_score_90", "away_score_90", "home_score_ht",
                                     "away_score_ht", "home_score_et", "away_score_et", "home_penalty_score", "away_penalty_score", "is_neutral")}
        values.update(competition_season_id=edition, season_id=season_id, match_date=m["date"], home_team_id=home, away_team_id=away,
                      home_team_name=m["home"] or None, away_team_name=m["away"] or None,
                      round_id=_round(conn, edition, m["round"]) if m["round"] else None, group_name=m["group"],
                      match_number=m["number"], archive_position=m["position"], source=provider)
        _, outcome = snapshot.write(conn, provider, key, values, before.get(key))
        changes += outcome in ("inserted", "updated")
        keep.add(key)
    changes += snapshot.remove(conn, provider, before, keep)
    renamed = stored is not None and stored[2] != body.get("name")
    conn.execute(
        "UPDATE core.competition_seasons SET cup_digest=%s, cup_updated_at=CASE WHEN %s THEN %s ELSE cup_updated_at END WHERE id=%s",
        (digest, bool(changes) or renamed, now, edition),
    )
    if (changes or renamed) and (typed_dfb or kind == "open-cups" and competition in CUP_PUBLICATION):
        conn.execute(
            """INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES ('competition_season',%s)
               ON CONFLICT (resource_kind,resource_id) DO UPDATE
                 SET version=ops.resource_versions.version+1, updated_at=now()""", (edition,),
        )
    return changes


def run(conn, get, scope, now):
    kind, competition, season = scope.split(":", 2)
    if (kind, competition, season) not in EDITIONS:
        raise ValueError(scope)
    query = {"competition": competition, "season": season}
    answer = bridge("projection", kind, urlencode(query)) or {}
    body = answer.get("body")
    observation = body.get("phaseObservation") if isinstance(body, dict) and cup_periods.applies(kind, competition, season) else None
    try:
        if answer.get("status") != 200 or not isinstance(body, dict):
            # The projection names an unreadable body, else its HTTP status.
            code = body.get("code") if isinstance(body, dict) else None
            detail = body.get("detail") if observation else None
            raise SourceError(code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code)
                              else f"HTTP_{answer.get('status') or 'ERROR'}", detail)
        written = save(conn, kind, competition, season, body, now)
    except SourceError as error:
        if observation:
            raise cup_periods.Refusal(error, scope, now, observation) from error
        raise
    if observation:
        cup_periods.record(conn, scope, now, observation, "accepted")
    return written, 0


class For:
    """The adapter of one cup source (ops.source_runs keys runs by provider)."""

    def __init__(self, kind):
        self.kind = kind

    def scopes(self, now):
        return {scope: period for scope, period in scopes(now).items() if scope.startswith(self.kind + ":")}

    def run(self, conn, get, scope, now):
        return run(conn, get, scope, now)
