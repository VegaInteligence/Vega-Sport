"""Complementary competitions of open-matchday (github.com/oladeeayo/open-matchday), the
European part main reads (the previous pipeline's collect_open_matchday.py): leagues and cups
PitchAPI does not cover, for the season the source publishes.

The source also publishes copies of leagues PitchAPI holds (Premier League, Ligue 1, the UEFA
cups…), under its own club names: read, they doubled PitchAPI's matches with clubs no rule
links (« Man City », « Paris »). Such a folder (COVERED, with the PitchAPI league it copies) is
not read in a season PitchAPI holds that league; in a season it does not, the folder is read.

Each competition is a cup-source edition (cup_key `open-matchday:<folder>:<season>`):
results and fixtures become matches (source open_matchday), with the half-time score, and
the team statistics the source gives (shots, shots on target, fouls, corners, per half
too, cards) become core.team_match_stats rows. The source's goal minutes name no side and
are not kept. Read every six hours; an unreadable competition is skipped, the others are
written.

A competition's files replace its edition only as the complete snapshot the summary describes
(read_files: its declared rows, no reported error) and only when they keep every result the
base holds (snapshot.py); otherwise the edition stays as it was, the competition counts as
unmatched and ops.parse_failures says why (FAILURE_MODES.md §19). A match whose values and
statistics are unchanged is not written again.
"""

import csv
from datetime import timedelta
import io
import re

from . import SourceError, failure, open_matchday_history, snapshot
from .cups import _round, _team
from ..seasons import sporting_season
from ..store import Store

SOURCE = "https://github.com/oladeeayo/open-matchday"
RAW = "https://raw.githubusercontent.com/oladeeayo/open-matchday/master/"
# collect_open_matchday.py (main): the European country codes kept; a drift test compares them.
EUROPE = set("ALB AND ARM AUT AZE BEL BIH BLR BUL CRO CYP CZE DEN ENG ESP EST FIN FRA FRO GEO GER GIB GRE HUN IRE IRL ISL ISR ITA KAZ KOS LIE "
             "LTU LUX LVA MDA MKD MLT MNE NED NIR NOR POL POR ROU RUS SCO SMR SRB SUI SVK SVN SWE TUR UEFA UKR WAL".split())
FOLDER = re.compile(r"^[A-Z0-9_]+_[a-z0-9-]+$")
# The folders that copy a league PitchAPI holds, with that league's PitchAPI key (reviewed
# 17 Nov 2026 against core: same country, same division). Cups and the leagues PitchAPI does not
# hold (English fifth division and below, Wales, Ireland's second and third, Scotland's lower
# divisions, Poland's second and third, Cyprus, Kazakhstan, Ukraine, Slovenia…) are not here.
COVERED = {
    "AUT_1_bundesliga": "l_3zsMpo", "BEL_1_pro-league": "l_2L6d1F", "CRO_1_hnl": "l_2tFk9k", "CZE_1_chance-liga": "l_0F4I4F",
    "DEN_1_superliga": "l_49Zmno", "ENG_1_premier-league": "l_4WFCIZ", "ENG_2_championship": "l_4DWyTT", "ENG_3_league-one": "l_0ahLw8",
    "ENG_4_league-two": "l_1W6idJ", "ESP_1_la-liga": "l_0ErfuF", "ESP_2_segunda-division": "l_3kyHLd", "FIN_1_veikkausliiga": "l_3Ci5Cg",
    "FRA_1_ligue-1": "l_3FJFUl", "FRA_2_ligue-2": "l_0275VP", "GER_1_bundesliga": "l_1Isor4", "GER_2_2-bundesliga": "l_3hvsne",
    "GER_3_3-liga": "l_47077Y", "GRE_1_super-league": "l_3xwVF2", "ITA_1_serie-a": "l_0ALvwF", "ITA_2_serie-b": "l_0jy5yE",
    "NED_1_eredivisie": "l_4H43wr", "NED_2_eerste-divisie": "l_49KZaB", "NOR_1_eliteserien": "l_0uqFK8", "POL_1_ekstraklasa": "l_214sqK",
    "POR_1_primeira-liga": "l_4QexZg", "ROU_1_liga-1": "l_0kSJLz", "RUS_1_premier-liga": "l_2Mh0jT", "SCO_1_premiership": "l_1LMdEO",
    "SUI_1_super-league": "l_4d6Bwl", "SVK_1_nike-liga": "l_4MU9Yh", "SWE_1_allsvenskan": "l_1XsMdH", "TUR_1_super-lig": "l_0S1uaf",
    "UEFA_1_champions-league": "l_0bfbkO", "UEFA_1_europa-league": "l_38d9HA", "UEFA_1_conference-league": "l_2WZ2tt",
}
# Clubs the source writes two ways (its results one way, its fixtures and cups another; reviewed 17 Nov 2026 over
# every Scottish folder): one club, under the full name its league tables use. Read otherwise, each spelling was a club
# of its own: phantom rows in a table, a fixture without a forecast, a cup the projection could not rate.
SPELLINGS = {
    "Airdrie Utd": "Airdrieonians", "Queen of Sth": "Queen of the South", "Queen of South": "Queen of the South",
    "Annan": "Annan Athletic", "Elgin": "Elgin City", "Forfar": "Forfar Athletic", "Ayr": "Ayr United",
    "Dunfermline": "Dunfermline Athletic", "Inverness": "Inverness Caledonian Thistle", "Morton": "Greenock Morton",
    "Raith": "Raith Rovers",
}
# CSV columns -> team_match_stats columns, per side and period.
STATS = {"shots": "total_shots", "target": "shots_on_target", "fouls": "fouls", "corners": "corners", "yellow": "yellow_cards", "red": "red_cards"}
PERIODS = (("all", ""), ("first_half", "_1h"), ("second_half", "_2h"))
# The columns each file must have for its rows to name a match (and a result its score).
HEADERS = {"results": {"date", "home", "away", "ft_home", "ft_away"}, "fixtures": {"date", "home", "away"}}
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


# The source's country codes the base writes otherwise (core.countries, PitchAPI's teams).
COUNTRY_CODES = {"IRE": "IRL"}


def country_of(folder):
    """The base's country of a folder ("IRE_2_first-division" -> "IRL"); None for a UEFA one."""
    code = folder.split("_", 1)[0]
    return COUNTRY_CODES.get(code, code) if len(code) == 3 else None


def scopes(now):
    return {"europe": timedelta(hours=6)}


def _int(value):
    return int(value) if isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip()) else None


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def season_label(code):
    """'2627' -> '2026/2027'."""
    if not re.fullmatch(r"\d{4}", str(code or "")):
        raise SourceError("INVALID_SEASON")
    return f"20{code[:2]}/20{code[2:]}"


def rows(text):
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"), newline="")))


def read_files(get, league, code, folder):
    """A competition's (results, fixtures) rows, as the summary describes them: integer counts and
    no reported error, each declared file read with its columns and exactly its declared rows.
    SourceError with a detail when they are not that complete snapshot; an unreadable file raises
    the reader's own SourceError (no detail)."""
    declared = {part: _count(league.get(part)) for part in HEADERS}
    errors = league.get("errors", [])
    if None in declared.values() or not isinstance(errors, list):
        raise SourceError("MANIFEST_INVALID", f"results={league.get('results')!r} fixtures={league.get('fixtures')!r} errors={errors!r}")
    if errors:
        raise SourceError("SOURCE_REPORTED_ERRORS", "; ".join(map(str, errors)))
    out = {}
    for part, count in declared.items():
        if not count:
            out[part] = []
            continue
        text = get(f"{RAW}data/{folder}/{part}_{code}.csv", as_text=True)
        reader = csv.DictReader(io.StringIO(text.lstrip("﻿"), newline=""))
        if not HEADERS[part] <= set(reader.fieldnames or ()):
            raise SourceError("INVALID_HEADER", f"{part}: {reader.fieldnames}")
        out[part] = list(reader)
        if len(out[part]) != count:
            raise SourceError("ROW_COUNT_MISMATCH", f"{part}: {len(out[part])} rows, {count} declared")
    return out["results"], out["fixtures"]


def candidate(folder, season, results, fixtures, label):
    """{provider key: row} of the snapshot, results first then fixtures, in source order.

    A result row names both sides, its day and its two goals (INVALID_RESULT_ROW otherwise); a
    fixture row without them names no match and is skipped. A fixture with the key of a result is
    that result. Rows of one key otherwise make one match, from the last of them (as before)."""
    out = {}
    attestations = open_matchday_history.for_edition(folder, season)
    for status, items in (("finished", results), ("not_started", fixtures)):
        for item in items:
            home, away, day = (item.get("home") or "").strip(), (item.get("away") or "").strip(), (item.get("date") or "").strip()
            home, away = SPELLINGS.get(home, home), SPELLINGS.get(away, away)
            goals = (_int(item.get("ft_home")), _int(item.get("ft_away"))) if status == "finished" else (None, None)
            if not home or not away or not DAY.fullmatch(day):
                if status == "finished":
                    raise SourceError("INVALID_RESULT_ROW", f"{label}: a result without its sides or day: {dict(item)}")
                continue
            if status == "finished" and None in goals:
                raise SourceError("INVALID_RESULT_ROW", f"{label}: {day} {home}–{away} without its goals: {item.get('ft_home')!r}–{item.get('ft_away')!r}")
            half = (_int(item.get("ht_home")), _int(item.get("ht_away")))
            row = {
                "status": status, "home": home, "away": away, "date": day, "round": (item.get("gw") or "").strip() or None,
                "home_score": goals[0], "away_score": goals[1],
                "home_score_ht": half[0] if None not in half else None, "away_score_ht": half[1] if None not in half else None,
                "stats": _row_stats(item),
            }
            key = f"{folder}:{season}:{day}|{home}|{away}"
            if status == "finished" and key in attestations:
                open_matchday_history.final_score(key, goals, attestations[key]["score"])
            if key in out and out[key]["status"] == "finished" and status != "finished":
                continue  # a fixture still listed after its result: the result is the match
            out.pop(key, None)
            out[key] = row
    return out


def _row_stats(item):
    """{(side, period): {column: value}} of the statistics a CSV row gives (corners alone per half)."""
    out = {}
    for side in ("home", "away"):
        for period, suffix in PERIODS:
            stats = {}
            for name, column in STATS.items():
                value = _int(item.get(f"{side}_{name}{suffix}")) if suffix == "" or name == "corners" else None
                if value is not None:
                    stats[column] = value
            out[(side, period)] = stats
    return out


def _write_stats(conn, season, match, row, home, away):
    """Merge the cells present in this source, including zero, at the team and period key."""
    teams = {"home": home, "away": away}
    reported = {}
    for (side, period), columns in row["stats"].items():
        if columns:
            reported.setdefault((teams[side], period), {}).update(columns)
    changed = 0
    for (team, period), columns in sorted(reported.items()):
        keys = ("season_id", "match_id", "team_id", "period")
        names = (*keys, *columns)
        values = ", ".join(["%s"] * len(names))
        assignments = ", ".join(f"{name}=EXCLUDED.{name}" for name in columns)
        differs = " OR ".join(f"stored.{name} IS DISTINCT FROM EXCLUDED.{name}" for name in columns)
        changed += conn.execute(
            f"""INSERT INTO core.team_match_stats AS stored ({', '.join(names)}) VALUES ({values})
                ON CONFLICT ({', '.join(keys)}) DO UPDATE
                SET {assignments}, updated_at=now() WHERE {differs}""",
            [season, match, team, period, *columns.values()],
        ).rowcount
    return bool(changed)


def save(conn, folder, name, season, results, fixtures, now, *, declared_results=None):
    """Write one competition's complete reported window; return the matches the edition holds.

    Refused (SourceError with a detail, nothing written): a result row without its sides, day or
    goals, and a snapshot that drops or unplays a result the base holds (snapshot.guard). Matches
    and statistics are written only where they changed."""
    label = sporting_season(season)
    if label is None:
        raise SourceError("INVALID_SEASON")
    cup_key = f"open-matchday:{folder}:{season}"
    snap = candidate(folder, season, results, fixtures, cup_key)
    stored = conn.execute("SELECT id FROM core.competition_seasons WHERE cup_key = %s", (cup_key,)).fetchone()
    before = snapshot.stored(conn, "open_matchday", stored and stored[0])
    preserved = open_matchday_history.retained(conn, stored and stored[0], before, snap,
                                                  open_matchday_history.for_edition(folder, season), declared_results)
    status = {key: row["status"] for key, row in snap.items()}
    status.update(dict.fromkeys(preserved, "finished"))
    snapshot.guard("open_matchday", before, status, cup_key)
    season_id = Store(conn).season(label)
    country = country_of(folder)
    family = f"cup:open-matchday:{folder}"
    found = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider='vega' AND provider_key=%s", (family,)).fetchone()
    if country:
        conn.execute("INSERT INTO core.countries(code) VALUES (%s) ON CONFLICT DO NOTHING", (country,))
    if found:
        comp = found[0]
        # The name, and the country of an edition written before its code was the base's (IRE).
        conn.execute(
            """UPDATE core.competitions SET name=%s, country_code=%s, updated_at=now()
               WHERE id=%s AND (name IS DISTINCT FROM %s OR country_code IS DISTINCT FROM %s)""",
            (name, country, comp, name, country),
        )
    else:
        comp = conn.execute("INSERT INTO core.competitions(name, country_code) VALUES (%s, %s) RETURNING id", (name, country)).fetchone()[0]
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','vega',%s,%s)", (family, comp))
    edition = conn.execute(
        """INSERT INTO core.competition_seasons(competition_id, season_id, native_label, cup_key, cup_name, cup_source_url, cup_checked_at, cup_updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (cup_key) DO UPDATE SET cup_name=EXCLUDED.cup_name, cup_checked_at=EXCLUDED.cup_checked_at, updated_at=now()
           RETURNING id""",
        (comp, season_id, season, cup_key, name, SOURCE, now, now),
    ).fetchone()[0]
    elsewhere = snapshot.elsewhere(conn, "open_matchday", edition, [key for key in snap if key not in before])
    snapshot.guard("open_matchday", elsewhere, status, cup_key)
    before.update(elsewhere)
    changes = 0
    reserved = {before[key]["archive_position"] for key in preserved}
    position = 0
    for key, row in snap.items():
        found = before.get(key)
        if key in preserved:
            home, away = found["home_team_id"], found["away_team_id"]
            # A previously attested result can gain optional data without moving
            # its row or replacing the facts that established its identity.
            values = {"archive_position": found["archive_position"]}
        else:
            while position in reserved:
                position += 1
            home = _team(conn, "open_matchday", f"name:{row['home']}", row["home"])
            away = _team(conn, "open_matchday", f"name:{row['away']}", row["away"])
            values = {
                "competition_season_id": edition, "season_id": season_id, "source": "open_matchday", "status": row["status"],
                "match_date": row["date"], "home_team_id": home, "away_team_id": away, "home_team_name": row["home"], "away_team_name": row["away"],
                "home_score": row["home_score"], "away_score": row["away_score"],
                "archive_position": position,
            }
            position += 1
        if row["round"]:
            values["round_id"] = _round(conn, edition, row["round"])
        elif found is not None and found["competition_season_id"] != edition:
            values["round_id"] = None  # a round belongs to its former edition
        if row["home_score_ht"] is not None and row["away_score_ht"] is not None:
            values.update(home_score_ht=row["home_score_ht"], away_score_ht=row["away_score_ht"])
        mid, outcome = snapshot.write(conn, "open_matchday", key, values, found)
        match_changed = outcome in ("inserted", "updated")
        stats_changed = _write_stats(conn, season_id, mid, row, home, away)
        if stats_changed and outcome is None:
            snapshot.write(conn, "open_matchday", key, values, found, changed=True)
        elif stats_changed and outcome == "moved":
            # snapshot.write already checked and updated the same match in this transaction.
            conn.execute("""UPDATE core.matches SET revision=revision+1, updated_at=now()
                            WHERE id=%s AND season_id=%s""", (mid, season_id))
        changes += match_changed or stats_changed
    changes += snapshot.remove(conn, "open_matchday", before, status)
    if changes:
        conn.execute("UPDATE core.competition_seasons SET cup_updated_at=%s WHERE id=%s", (now, edition))
    return len(status)


def held(conn, folder, season):
    """Whether PitchAPI holds, in `season` ("YYYY/YYYY+1"), the league `folder` copies."""
    key = COVERED.get(folder)
    return key is not None and conn.execute(
        """SELECT 1 FROM core.provider_ids p
           JOIN core.competition_seasons cs ON cs.competition_id = p.entity_id AND cs.cup_key IS NULL AND cs.archive_key IS NULL
           JOIN core.seasons s ON s.id = cs.season_id
           WHERE p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.provider_key = %s AND s.label = %s""",
        (key, sporting_season(season)),
    ).fetchone() is not None


def drop_copy(conn, folder, season):
    """Remove the edition of `folder` written for `season` before PitchAPI held its league (VI-21):
    its matches (their statistics go with them), rounds, the edition, and the competition with its
    id when it holds no other edition. Returns the matches removed."""
    edition = conn.execute("SELECT id, competition_id FROM core.competition_seasons WHERE cup_key = %s", (f"open-matchday:{folder}:{season}",)).fetchone()
    if edition is None:
        return 0
    removed = conn.execute("DELETE FROM core.matches WHERE competition_season_id = %s", (edition[0],)).rowcount
    conn.execute("DELETE FROM core.rounds WHERE competition_season_id = %s", (edition[0],))
    conn.execute("DELETE FROM core.competition_seasons WHERE id = %s", (edition[0],))
    if not conn.execute("SELECT 1 FROM core.competition_seasons WHERE competition_id = %s", (edition[1],)).fetchone():
        conn.execute("DELETE FROM core.provider_ids WHERE entity_type = 'competition' AND entity_id = %s", (edition[1],))
        conn.execute("DELETE FROM core.competitions WHERE id = %s", (edition[1],))
    conn.execute(
        "DELETE FROM core.provider_ids p WHERE p.entity_type='match' AND p.provider='open_matchday' AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id=p.entity_id)"
    )
    return removed


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
        if held(conn, folder, season):
            # PitchAPI holds this league this season: its copy would double its matches. One read
            # before (until 17 Nov 2026) is removed (the user's yes, VI-21).
            with conn.transaction():
                drop_copy(conn, folder, season)
            continue
        try:
            results, fixtures = read_files(get, league, code, folder)
            with conn.transaction():
                written += save(conn, folder, league.get("league") or folder, season, results, fixtures, now, declared_results=len(results))
        except SourceError as error:
            # This competition is not written now (its files unreadable, or not the complete snapshot that
            # keeps its results): its edition stays as it was; the others go on.
            unmatched += 1
            if error.detail is not None:
                cup_key = f"open-matchday:{folder}:{season}"
                edition = conn.execute("SELECT id FROM core.competition_seasons WHERE cup_key = %s", (cup_key,)).fetchone()
                failure(conn, error.code, f"{cup_key}: {error.detail}", edition and edition[0])
    conn.execute(
        """INSERT INTO core.source_revisions(source, name, url, license, revision, retrieved_at) VALUES ('open-matchday', 'open-matchday', %s, %s, %s, %s)
           ON CONFLICT (source) DO UPDATE SET revision=EXCLUDED.revision, retrieved_at=EXCLUDED.retrieved_at""",
        (SOURCE, "informational, non-commercial use with attribution", summary.get("generated_utc"), now),
    )
    return written, unmatched
