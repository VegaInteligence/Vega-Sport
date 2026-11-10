"""Complementary competitions of open-matchday (github.com/oladeeayo/open-matchday), the
European part main reads (the previous pipeline's collect_open_matchday.py): leagues and cups
PitchAPI does not cover, for the season the source publishes.

Each competition is a cup-source edition (cup_key `open-matchday:<folder>:<season>`):
results and fixtures become matches (source open_matchday), with the half-time score, and
the team statistics the source gives (shots, shots on target, fouls, corners, per half
too, cards) become core.team_match_stats rows. The source's goal minutes name no side and
are not kept. Read every six hours; an unreadable competition is skipped, the others are
written.
"""

import csv
from datetime import timedelta
import io
import re

from . import SourceError
from .cups import _team
from ..seasons import sporting_season
from ..store import Store

SOURCE = "https://github.com/oladeeayo/open-matchday"
RAW = "https://raw.githubusercontent.com/oladeeayo/open-matchday/master/"
# collect_open_matchday.py (main): the European country codes kept; a drift test compares them.
EUROPE = set("ALB AND ARM AUT AZE BEL BIH BLR BUL CRO CYP CZE DEN ENG ESP EST FIN FRA FRO GEO GER GIB GRE HUN IRE IRL ISL ISR ITA KAZ KOS LIE "
             "LTU LUX LVA MDA MKD MLT MNE NED NIR NOR POL POR ROU RUS SCO SMR SRB SUI SVK SVN SWE TUR UEFA UKR WAL".split())
FOLDER = re.compile(r"^[A-Z0-9_]+_[a-z0-9-]+$")
# CSV columns -> team_match_stats columns, per side and period.
STATS = {"shots": "total_shots", "target": "shots_on_target", "fouls": "fouls", "corners": "corners", "yellow": "yellow_cards", "red": "red_cards"}


def scopes(now):
    return {"europe": timedelta(hours=6)}


def _int(value):
    return int(value) if isinstance(value, str) and value.strip().isdigit() else None


def season_label(code):
    """'2627' -> '2026/2027'."""
    if not re.fullmatch(r"\d{4}", str(code or "")):
        raise SourceError("INVALID_SEASON")
    return f"20{code[:2]}/20{code[2:]}"


def rows(text):
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"), newline="")))


def save(conn, folder, name, season, results, fixtures, now):
    """Replace one competition's edition; returns the matches written."""
    label = sporting_season(season)
    if label is None:
        raise SourceError("INVALID_SEASON")
    season_id = Store(conn).season(label)
    country = folder.split("_", 1)[0]
    family = f"cup:open-matchday:{folder}"
    found = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider='vega' AND provider_key=%s", (family,)).fetchone()
    if found:
        comp = found[0]
        conn.execute("UPDATE core.competitions SET name=%s, updated_at=now() WHERE id=%s AND name IS DISTINCT FROM %s", (name, comp, name))
    else:
        if len(country) == 3:
            conn.execute("INSERT INTO core.countries(code) VALUES (%s) ON CONFLICT DO NOTHING", (country,))
        comp = conn.execute(
            "INSERT INTO core.competitions(name, country_code) VALUES (%s, %s) RETURNING id", (name, country if len(country) == 3 else None)
        ).fetchone()[0]
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','vega',%s,%s)", (family, comp))
    edition = conn.execute(
        """INSERT INTO core.competition_seasons(competition_id, season_id, native_label, cup_key, cup_name, cup_source_url, cup_checked_at, cup_updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (cup_key) DO UPDATE SET cup_name=EXCLUDED.cup_name, cup_checked_at=EXCLUDED.cup_checked_at, updated_at=now()
           RETURNING id""",
        (comp, season_id, season, f"open-matchday:{folder}:{season}", name, SOURCE, now, now),
    ).fetchone()[0]
    keep = []
    position = 0
    for status, items in (("finished", results), ("not_started", fixtures)):
        for item in items:
            home_name, away_name, day = (item.get("home") or "").strip(), (item.get("away") or "").strip(), (item.get("date") or "").strip()
            if not home_name or not away_name or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                continue
            key = f"{folder}:{season}:{day}|{home_name}|{away_name}"
            home = _team(conn, "open_matchday", f"name:{home_name}", home_name)
            away = _team(conn, "open_matchday", f"name:{away_name}", away_name)
            round_id = None
            if (item.get("gw") or "").strip():
                round_id = conn.execute(
                    """INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s)
                       ON CONFLICT (competition_season_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id""",
                    (edition, item["gw"].strip()),
                ).fetchone()[0]
            hs, as_ = (_int(item.get("ft_home")), _int(item.get("ft_away"))) if status == "finished" else (None, None)
            values = {
                "competition_season_id": edition, "season_id": season_id, "source": "open_matchday", "status": status if hs is not None or status == "not_started" else "not_started",
                "match_date": day, "home_team_id": home, "away_team_id": away, "home_team_name": home_name, "away_team_name": away_name,
                "round_id": round_id, "home_score": hs, "away_score": as_, "home_score_ht": _int(item.get("ht_home")), "away_score_ht": _int(item.get("ht_away")),
                "archive_position": position,
            }
            position += 1
            mid = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider='open_matchday' AND provider_key=%s", (key,)).fetchone()
            columns = list(values)
            if mid:
                mid = mid[0]
                conn.execute(f"UPDATE core.matches SET {', '.join(f'{c}=%s' for c in columns)}, updated_at=now() WHERE id=%s", [values[c] for c in columns] + [mid])
            else:
                mid = conn.execute(f"INSERT INTO core.matches({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))}) RETURNING id",
                                   [values[c] for c in columns]).fetchone()[0]
                conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match','open_matchday',%s,%s)", (key, mid))
            keep.append(mid)
            conn.execute("DELETE FROM core.team_match_stats WHERE season_id=%s AND match_id=%s", (season_id, mid))
            for side, team in (("home", home), ("away", away)):
                for period, suffix in (("all", ""), ("first_half", "_1h"), ("second_half", "_2h")):
                    stats = {column: _int(item.get(f"{side}_{name}{suffix}")) for name, column in STATS.items() if suffix == "" or name == "corners"}
                    stats = {k: v for k, v in stats.items() if v is not None}
                    if stats:
                        cols = ["season_id", "match_id", "team_id", "period", *stats]
                        conn.execute(f"INSERT INTO core.team_match_stats({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
                                     [season_id, mid, team, period, *stats.values()])
    conn.execute("DELETE FROM core.matches WHERE competition_season_id=%s AND NOT id = ANY(%s)", (edition, keep))
    conn.execute(
        "DELETE FROM core.provider_ids p WHERE p.entity_type='match' AND p.provider='open_matchday' AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id=p.entity_id)"
    )
    return len(keep)


def run(conn, get, scope, now):
    if scope != "europe":
        raise ValueError(scope)
    summary = get(RAW + "build_summary.json")
    if not isinstance(summary, dict) or not isinstance(summary.get("leagues"), list):
        raise SourceError("INVALID_RESPONSE")
    season, code = season_label(summary.get("season")), summary["season"]
    written = unmatched = 0
    for league in summary["leagues"]:
        folder = str(league.get("folder") or "").split("/")[-1]
        if not FOLDER.fullmatch(folder) or folder.split("_", 1)[0] not in EUROPE:
            continue
        try:
            results = rows(get(f"{RAW}data/{folder}/results_{code}.csv", as_text=True)) if league.get("results") else []
            fixtures = rows(get(f"{RAW}data/{folder}/fixtures_{code}.csv", as_text=True)) if league.get("fixtures") else []
        except SourceError:
            unmatched += 1  # this competition's files are unreadable now; the others go on
            continue
        with conn.transaction():
            written += save(conn, folder, league.get("league") or folder, season, results, fixtures, now)
    conn.execute(
        """INSERT INTO core.source_revisions(source, name, url, license, revision, retrieved_at) VALUES ('open-matchday', 'open-matchday', %s, %s, %s, %s)
           ON CONFLICT (source) DO UPDATE SET revision=EXCLUDED.revision, retrieved_at=EXCLUDED.retrieved_at""",
        (SOURCE, "informational, non-commercial use with attribution", summary.get("generated_utc"), now),
    )
    return written, unmatched
