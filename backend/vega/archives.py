"""Historical archives into core (doc: archives in core.matches, scorers in
core.match_events), built exactly as main builds them.

1. the archive builders (backend/archives/builders/build_*_history.py, build_historical_goals.py)
   run unchanged on the pinned source files, into a temporary directory;
2. for each season, main's shared/archive.js builds the edition (results, the goals
   attached to their match, goal-only matches) through backend/archives/edition.mjs;
3. the edition is written as typed rows: one competition per archive family, one
   edition per season, Vega teams by name and country, matches, rounds and goals.

Seasons up to 2020/2021 are imported whole. From 2021/2022 on PitchAPI is the source,
and the archives only fill what it does not have: a competition is imported for the
seasons PitchAPI has no edition of it (the national cups it never has, a league before
its first PitchAPI season), so a match is never stored twice (PITCHAPI_COMPETITIONS).
A season is replaced as a whole (its archive matches only); ids stay stable because
every row is keyed by its archive key. Files are processed in a temporary directory
and never stored.

Repairs go through a reviewed plan (FAILURE_MODES.md §20, §22); a run without a mode does nothing:

  python -m vega.archives --sources S --plan plan.json | --plan-store       read only: the plan, its SHA-256
  python -m vega.archives --show-plan SHA                                    a stored plan
  python -m vega.archives --sources S --apply plan.json --plan-sha256 SHA | --apply-stored SHA
  python -m vega.archives --sources S --fresh                                seasons holding no archive match only

S: a directory, or s3://bucket/data/sources, laid out as main's data/sources; --seasons a,b limits the seasons.
"""

import argparse
from collections import defaultdict
import contextlib
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unicodedata

from .store import Store

LAST_ARCHIVE_SEASON = 2020
# After LAST_ARCHIVE_SEASON, each archive competition names the PitchAPI competition that
# is the same one (None: PitchAPI never has it). A season of it is imported only when
# PitchAPI has no edition of that competition then; a competition missing from this table
# stops the import, so that nothing PitchAPI also has gets in unnoticed. The keys are the
# goal archive's competitions (backend/archives/builders/build_historical_goals.py), the only
# archive that goes past 2020/2021.
PITCHAPI_COMPETITIONS = {
    "g:aut-bundesliga": "l_3zsMpo",
    "g:bel-pro-league": "l_2L6d1F",
    "g:bundesliga": "l_1Isor4",
    "g:champions-league": "l_0bfbkO",
    "g:cze-1-fotbalova-liga": "l_0F4I4F",
    "g:dfb-pokal": None,
    "g:eng-fa-cup": None,
    "g:eng-league-cup": None,
    "g:eng-premier-league": "l_4WFCIZ",
    "g:esp-copa-del-rey": None,
    "g:esp-primera-division": "l_0ErfuF",
    "g:europa-league": "l_38d9HA",
    "g:fra-coupe-de-france": None,
    "g:fra-ligue-1": "l_3FJFUl",
    "g:gre-super-league": "l_3xwVF2",
    "g:ita-serie-a": "l_0ALvwF",
    "g:ned-eredivisie": "l_4H43wr",
    "g:nor-eliteserien": "l_0uqFK8",
    "g:pol-ekstraklasa": "l_214sqK",
    "g:por-primeira-liga": "l_4QexZg",
    "g:sco-premiership": "l_1LMdEO",
    "g:sui-super-league": "l_4d6Bwl",
    "g:tur-sueperlig": "l_0S1uaf",
}
# The checkout's root: only the defaults below use it (in the image, /app/vega/archives.py gives "/", and the
# Dockerfile sets both variables).
ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SCRIPTS = Path(os.environ.get("VEGA_ARCHIVE_SCRIPTS", ROOT / "backend/archives/builders"))
EDITION = Path(os.environ.get("VEGA_ARCHIVE_EDITION", ROOT / "backend/archives/edition.mjs"))
# The shared files edition.mjs imports, beside it as in the checkout and the image (../../dashboard/shared).
SHARED_FILES = ("archive.js", "archive-text.js", "openfootball-history.js",
                "legacy-8018e08/archive.js", "legacy-8018e08/archive-text.js", "legacy-8018e08/openfootball-history.js")


def code_manifest():
    """{logical name: SHA-256} of every file the plan depends on, wherever it runs; ArchiveError if one is missing."""
    shared = EDITION.resolve().parents[2] / "dashboard/shared"
    files = {"vega/archives.py": HERE / "archives.py", "vega/store.py": HERE / "store.py", "archives/edition.mjs": EDITION}
    files.update({f"shared/{name}": shared / name for name in SHARED_FILES})
    builders = sorted(SCRIPTS.glob("*.py"))
    files.update({f"archives/builders/{path.name}": path for path in builders})
    missing = sorted(name for name, path in files.items() if not path.is_file())
    if missing or not builders:
        raise ArchiveError(f"parser files missing: {', '.join(missing) or 'archives/builders/*.py'}")
    return {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sorted(files.items())}


# Reviewed holds (FAILURE_MODES.md §22): kept as stored, never written fresh, until a separately reviewed action.
# The file and its SHA-256 are the pinned goals manifest's (the CSV the rows come from).
_CONCACAF = (
    ("g:champions-league:2008-09-17:1783", 633102), ("g:champions-league:2008-09-17:1784", 633103), ("g:champions-league:2008-09-18:1785", 633101),
    ("g:champions-league:2008-09-24:1786", 632862), ("g:champions-league:2008-09-25:1787", 632852), ("g:champions-league:2008-09-25:1788", 632853),
    ("g:champions-league:2008-10-01:1789", 632628), ("g:champions-league:2008-10-01:1790", 632629), ("g:champions-league:2008-10-02:1791", 632626),
    ("g:champions-league:2008-10-02:1792", 632627), ("g:champions-league:2008-10-08:1793", 632433), ("g:champions-league:2008-10-08:1794", 632434),
    ("g:champions-league:2008-10-10:1795", 632428), ("g:champions-league:2008-10-10:1796", 632429), ("g:champions-league:2008-10-22:1797", 632176),
    ("g:champions-league:2008-10-23:1798", 632175), ("g:champions-league:2008-10-30:1799", 631884), ("g:champions-league:2008-10-30:1800", 631885),
    ("g:champions-league:2008-10-30:1801", 631886), ("g:champions-league:2008-11-06:1802", 631673), ("g:champions-league:2009-02-25:1803", 628942),
    ("g:champions-league:2009-02-26:1804", 628939), ("g:champions-league:2009-02-26:1805", 628940), ("g:champions-league:2009-02-27:1806", 628927),
    ("g:champions-league:2009-03-04:1807", 628688), ("g:champions-league:2009-03-05:1808", 628685), ("g:champions-league:2009-03-05:1809", 628686),
    ("g:champions-league:2009-03-06:1810", 628674), ("g:champions-league:2009-03-18:1811", 628245), ("g:champions-league:2009-03-19:1812", 628243),
    ("g:champions-league:2009-04-08:1813", 627810), ("g:champions-league:2009-04-09:1814", 627800), ("g:champions-league:2009-04-23:1815", 627374),
)
QUARANTINE = {
    # 2008/09 CONCACAF Champions League matches filed under the UEFA competition's worldclub slug (edition 3333):
    # a slug is not a competition identity. No guessed CONCACAF edition, no merge with the UEFA one.
    **{key: {"reason": "wrong_competition_edition", "file": "worldclub/goals/champions-league.csv",
             "sha256": "944c94abe4e230dc20943d1e286163530260096332cea151939b03e1a11cc6b3",
             "evidence_sha256": "af15101ee66706c2d39a70c7216f606d4e996a6fce3006809808b2a1744ada49",
             "production_id": ident, "evidence": "full-archive-verification/concacaf-2008-09-evidence.json"} for key, ident in _CONCACAF},
    # Paris FC–Lyon, 17 Dec 2021: abandoned, both teams declared beaten by the FFF; no stored status says so.
    "g:fra-coupe-de-france:2021-12-17:2247": {
        "reason": "abandoned_status_unrepresented", "file": "worldclub/goals/fra-coupe-de-france.csv",
        "sha256": "e15412f36f77bd5a4ba86eebd20471d5cac67c864accdb94a3cd3f8dcc67a97b", "production_id": 732633,
        "evidence": "full-archive-verification/forty-seven-plus-abandoned-candidate-v1.json"},
    # Bradford–Luton, 10 Oct 1990, stored 0–2: its candidate target r:engsoccerdata/leaguecup/all/1990:92 is 1–1.
    "g:eng-league-cup:1990-10-10:389": {
        "reason": "absorption_score_conflict", "file": "worldclub/goals/eng-league-cup.csv",
        "sha256": "4a180166b5e2f861950a5d13b4fa123e8b3d4a81785670e565edde4280b8f73d", "production_id": 516140,
        "evidence": "full-archive-verification/census-candidate-v1.json"},
}
PROVIDERS = {"openfootball": "openfootball", "footballcsv": "footballcsv", "engsoccerdata": "engsoccerdata", "worldclub": "worldclub"}


class ArchiveError(RuntimeError):
    pass


def _run(args):
    done = subprocess.run(args, capture_output=True, text=True, timeout=3600)
    if done.returncode != 0:
        raise ArchiveError(f"{Path(args[1]).name} failed: {done.stderr.strip()[-500:]}")
    return done.stdout


def build_sources(sources, work):
    """Run main's builders on a data/sources-like directory; returns (results dir, goals dir)."""
    sources, work = Path(sources), Path(work)
    results, goals = work / "results", work / "goals"
    py = sys.executable
    football = sorted((sources / "openfootball").glob("football-json-*.zip"))
    if not football:
        raise ArchiveError("openfootball/football-json-*.zip is required")
    _run([py, str(SCRIPTS / "build_openfootball_history.py"), "--archive", str(football[-1]), "--output", str(results)])
    csv = {repo: sorted((sources / "openfootball").glob(f"footballcsv-{repo}-*.zip")) for repo in ("england", "deutschland", "europe", "soccerdata")}
    if all(csv.values()):
        _run([py, str(SCRIPTS / "build_footballcsv_history.py"), "--output", str(results),
              *[arg for repo, files in csv.items() for arg in (f"--{repo}", str(files[-1]))]])
    if (sources / "engsoccerdata/manifest.json").is_file():
        _run([py, str(SCRIPTS / "build_engsoccerdata_history.py"), "--source-dir", str(sources / "engsoccerdata"), "--output", str(results)])
    if (sources / "worldclub/scotland-manifest.json").is_file():
        _run([py, str(SCRIPTS / "build_scottish_history.py"), "--source", str(sources / "worldclub"), "--output", str(results)])
    if (sources / "worldclub/goals/manifest.json").is_file():
        _run([py, str(SCRIPTS / "build_historical_goals.py"), "--source", str(sources / "worldclub/goals"), "--output", str(goals)])
    return results, goals if (goals / "index.json").is_file() else None


def edition(results_file, goals_file):
    return json.loads(_run(["node", str(EDITION), str(results_file or "-"), str(goals_file or "-")]))


def normalize(value):
    folded = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", folded).strip()


def family(competition_id):
    """The competition an archive edition belongs to: its id without the season part."""
    if competition_id.startswith("g:"):
        return competition_id
    return re.sub(r"(^|/)\d{4}(-\d{2})?(?=/|$)", "", competition_id).strip("/")


def _pair(value):
    return value if isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value) else None


def notes_of(row):
    """The notes the read API shows, from the typed columns (shared/openfootball-history.js
    historicalScoreNotes for results, groupNotes for goal-only matches)."""
    notes = []
    if row["home_score_et"] is not None and row["away_score_et"] is not None:
        notes.append("après prolongation")
    if row["home_penalty_score"] is not None and row["away_penalty_score"] is not None:
        notes.append(f"tirs au but {row['home_penalty_score']} – {row['away_penalty_score']}")
    elif row["decided_on_penalties"]:
        notes.append("tirs au but")
    if row["status"] == "canceled":
        notes.append("Rencontre non disputée" + (f" : {row['note']}" if row["note"] else ""))
    if row["is_neutral"]:
        notes.append("terrain neutre")
    return notes


# A match the source says was never played (football.json: "cancelled"; the builders: "not_played").
CANCELED = ("not_played", "cancelled", "canceled")


def _status(match, source, score):
    """The stored status of a results record (FAILURE_MODES.md §20.2); ArchiveError when the source contradicts itself."""
    status, scored = source.get("status"), score[0] is not None and score[1] is not None
    if status in CANCELED and not scored:
        return "canceled"
    if status == "awarded" and scored:
        return "awarded"
    if status is None:
        return "finished"
    raise ArchiveError(f"{match['key']}: status {status!r} {'with' if scored else 'without'} a score cannot be stored")


# Shoot-outs a reviewed official document numbers, home/away as the goal-only key's label names its sides
# (full-archive-verification/verified-seven-shootouts-repair-2251-v2.json: UEFA's « UEL facts » handbook, its page line,
# the raw worldclub records). Typed only when the key, date, both sides and the sporting tally all match (§23).
UEFA_HANDBOOK = "b8af4423a998ac041f90c09a8b5e6f0aaa23c65f53571b45afbfcca22f7c94a2"
VERIFIED_SHOOTOUTS = {
    key: {"date": date, "team1": home, "team2": away, "score": score, "kicks": kicks, "production_id": ident, "document_sha256": UEFA_HANDBOOK,
          "document": "https://editorial.uefa.com/resources/0282-18289b11a060-72b9e0a04e06-1000/uel_202223_facts_md15.pdf",
          "file": "worldclub/goals/europa-league.csv", "rows": rows}
    for key, date, home, away, score, kicks, ident, rows in (
        ("g:europa-league:2013-04-11:1920", "2013-04-11", "FC Basel 1893", "Tottenham Hotspur", [2, 2], [4, 1], 659061, [2197, 2198, 2199, 2200]),
        ("g:europa-league:2013-02-21:1889", "2013-02-21", "FC Steaua Bucureşti", "AFC Ajax", [2, 0], [4, 2], 660501, [2136, 2137]),
        ("g:europa-league:2014-03-20:1955", "2014-03-20", "Real Betis", "Sevilla FC", [0, 2], [3, 4], 668262, [2660, 2661]),
        ("g:europa-league:2015-02-26:1909", "2015-02-26", "Beşiktaş", "Liverpool FC", [1, 0], [5, 4], 678350, [3138]),
        ("g:europa-league:2016-04-14:1961", "2016-04-14", "Sevilla FC", "Athletic Bilbao", [1, 2], [5, 4], 686386, [3753, 3754, 3755]),
        ("g:europa-league:2017-04-20:1619", "2017-04-20", "Beşiktaş", "Olympique Lyonnais", [2, 1], [6, 7], 695997, [4327, 4328, 4329]),
        ("g:europa-league:2019-05-09:1999", "2019-05-09", "Chelsea FC", "Eintracht Frankfurt", [1, 1], [4, 3], 711760, [5458, 5459]),
    )
}


def verified_kicks(match):
    """The reviewed shoot-out (home, away kicks) of a goal-only match, or None: every bound fact must match."""
    known = VERIFIED_SHOOTOUTS.get(match.get("key"))
    if known and (match.get("date"), match.get("team1"), match.get("team2"), list(match.get("score") or [])) == (
            known["date"], known["team1"], known["team2"], known["score"]):
        return known["kicks"]
    return None


def match_row(match):
    source = match.get("source")
    score = match["score"]
    expected = list(match.get("notes") or [])
    if source:
        et, p = _pair(source.get("et")), _pair(source.get("p"))
        status = _status(match, source, score)
        row = {
            "home_score_et": et and et[0], "away_score_et": et and et[1],
            "home_penalty_score": p and p[0], "away_penalty_score": p and p[1], "decided_on_penalties": None,
            "status": status,
            "note": (source.get("nonmatch") or None) if status == "canceled" else None, "is_neutral": bool(source.get("neutral")) or None,
        }
    else:
        notes = match.get("notes") or []
        extra = "après prolongation" in notes
        kicks = verified_kicks(match)
        row = {
            "home_score_et": score[0] if extra else None, "away_score_et": score[1] if extra else None,
            "home_penalty_score": kicks and kicks[0], "away_penalty_score": kicks and kicks[1],
            "decided_on_penalties": None if kicks else ("tirs au but" in notes or None),
            "status": "finished", "note": None, "is_neutral": None,
        }
        if kicks:
            # The reviewed document numbers the shoot-out the label only names (or omits).
            expected = (["après prolongation"] if extra else []) + [f"tirs au but {kicks[0]} – {kicks[1]}"]
    row.update(home_score=score[0], away_score=score[1])
    if notes_of(row) != expected:
        raise ArchiveError(f"notes of {match['key']} cannot be typed: {match.get('notes')}")
    return row


# A stored goal, in the order of a goal tuple built by Loader.season.
GOAL_COLUMNS = ("team_id", "seq", "minute", "minute_added", "player_name", "score_home", "score_away", "source_minute", "score_disagreement")


def _pg_text(value):
    """A value as PostgreSQL's ::text prints it (to compare a row with what is stored)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _minute(value):
    found = re.fullmatch(r"\s*(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*'?\s*", str(value or ""))
    return (int(found.group(1)), int(found.group(2)) if found.group(2) else None) if found else (None, None)


def candidate_values(match, row, edition_id, start, round_id, home, away, position, provider_of):
    """The stored columns of one edition match (the loader and the plan build them alike)."""
    return dict(row, competition_season_id=edition_id, season_id=start, round_id=round_id,
                match_date=match.get("date") or None, date_unverified=bool(match.get("dateNote")) or None,
                home_team_id=home, away_team_id=away, archive_key=match["key"], archive_position=position,
                # A goal label no reading understands names no team: its raw text is the home name.
                home_team_name=match.get("team1") or match.get("unparsedLabel") or None, away_team_name=match.get("team2") or None,
                source=provider_of(match))


def goal_rows(match, home, away):
    goals = []
    for seq, goal in enumerate(match.get("goals") or []):
        minute, added = _minute(goal.get("minute"))
        score = _pair(goal.get("score")) or [None, None]
        goals.append(({"home": home, "away": away}.get(goal.get("side")), seq, minute, added, goal.get("player") or None,
                      score[0], score[1], str(goal["minute"]) if goal.get("minute") not in (None, "") else None,
                      bool(goal.get("scoreDisagreement")) or None))
    return goals


def compare(known, values, columns):
    """"new", "unchanged", "position" (archive_position alone differs) or "changed"."""
    if known is None:
        return "new"
    now = tuple(_pg_text(values[c]) for c in columns)
    if known[1] == now:
        return "unchanged"
    at = columns.index("archive_position")
    return "position" if known[1][:at] + known[1][at + 1:] == now[:at] + now[at + 1:] else "changed"


# Every column of a stored event, in a plan's order: a plan binds the facts it would leave beside the goals it writes.
EVENT_COLUMNS = ("event_type", "seq", "team_id", "minute", "minute_added", "period", "player_id", "related_player_id", "score_home",
                 "score_away", "is_own_goal", "is_penalty", "player_name", "source_minute", "score_disagreement")
# Goal facts the archive never writes: a stored goal with one of them is not the archive's alone.
NOT_OWNED = tuple(EVENT_COLUMNS.index(c) for c in ("period", "player_id", "related_player_id", "is_own_goal", "is_penalty"))


def _field(before, values, column):
    return before[column], _pg_text(values[column])


def _published_change(before, values):
    """The published observation the candidate would change without a review (FAILURE_MODES.md §23), or None: the score
    pair; the status, but a source cancellation (no score) or award (same score) of a finished match; a stored
    extra-time, penalty or shoot-out value (one may be added where none was stored)."""
    if any(a != b for a, b in (_field(before, values, "home_score"), _field(before, values, "away_score"))):
        return "score_change"
    status, now = _field(before, values, "status")
    if status != now and not (status == "finished" and (
            (now == "canceled" and values["home_score"] is None and values["away_score"] is None) or now == "awarded")):
        return "status_change"
    for pair in (("home_score_et", "away_score_et"), ("home_penalty_score", "away_penalty_score")):
        old = tuple(before[c] for c in pair)
        if old != (None, None) and old != tuple(_pg_text(values[c]) for c in pair):
            return "phase_change"
    if before["decided_on_penalties"] == "true" and _pg_text(values["decided_on_penalties"]) != "true" and values["home_penalty_score"] is None:
        return "phase_change"
    return None


def _hold(before, values, stored_goals, goals, events, goals_changed):
    """Why a stored match must stay as stored (FAILURE_MODES.md §22, §23), or None."""
    if len(goals) < len(stored_goals):
        return "goals_lost"
    for column in ("home_team_id", "away_team_id"):
        if before[column] is not None and values[column] is None:
            return "team_cleared"
    if any(old[0] is not None and new[0] is None for old, new in zip(stored_goals, goals)):
        return "team_cleared"
    changed = _published_change(before, values)
    if changed:
        return changed
    if goals_changed:
        seqs = {str(n) for n in range(len(goals))}
        for event in events:
            if event[0] == "goal" and any(event[i] is not None for i in NOT_OWNED):
                return "events_not_owned"
            if event[0] != "goal" and event[1] in seqs:
                return "events_not_owned"
    return None


class Loader:
    """One season's identities: bindings read, and in write mode created. `created` ({(entity, key): id}) holds what
    this apply created, so that a later season's plan names those exactly as its reviewed plan did."""

    def __init__(self, conn, created=None):
        self.conn = conn
        self.created = created if created is not None else {}
        self.teams = {}
        self.new_teams, self.new_competitions = set(), set()

    def _key(self, entity, provider_key):
        row = self.conn.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider='vega' AND provider_key=%s", (entity, provider_key)
        ).fetchone()
        return row and row[0]

    def _link(self, entity, provider_key, ident):
        self.conn.execute(
            "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES (%s,'vega',%s,%s)", (entity, provider_key, ident)
        )

    def _resolve(self, entity, key, write, insert):
        """The id bound to `key`; in a plan, `new:key` when it is to be created (or was, by this apply)."""
        ident = self._key(entity, key)
        new = self.new_teams if entity == "team" else self.new_competitions
        if ident is not None:
            if not write and self.created.get((entity, key)) == ident:
                new.add(key)
                return f"new:{key}"
            return ident
        if not write:
            new.add(key)
            return f"new:{key}"
        ident = insert()
        self._link(entity, key, ident)
        self.created[(entity, key)] = ident
        return ident

    def competition(self, comp_family, name, write=True):
        return self._resolve("competition", "archive:" + comp_family, write,
                             lambda: self.conn.execute("INSERT INTO core.competitions(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0])

    def team(self, name, country, write=True):
        key = f"archive:{normalize(country)}:{normalize(name)}"
        if key not in self.teams:
            # (may be a PitchAPI club the archive team was merged into)
            self.teams[key] = self._resolve("team", key, write,
                                            lambda: self.conn.execute("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0])
        return self.teams[key]

    def side(self, match, field, bindings, stored_team, write):
        """A match side's team. A side of the appearance-ordinal feed, or of a held row, is never created: its exact
        label's binding, else the stored team, else none (FAILURE_MODES.md §22)."""
        name = match.get(field)
        if not name:
            return None
        key = f"archive:{normalize(match.get('country'))}:{normalize(name)}"
        if match.get("sides") or match.get("held"):
            ident = self._key("team", key)
            bindings[key] = ident
            return ident if ident is not None else stored_team
        bindings[key] = self.team(name, match.get("country"), write)
        return bindings[key]

    def uncovered(self, label, competitions):
        """The archive competitions of a season after LAST_ARCHIVE_SEASON that PitchAPI has
        no edition of that season (the others are PitchAPI's: not imported)."""
        unknown = sorted(c["id"] for c in competitions if c["id"] not in PITCHAPI_COMPETITIONS)
        if unknown:
            raise ArchiveError(f"{label}: no PitchAPI competition is declared for {', '.join(unknown)}")
        covered = {
            key
            for (key,) in self.conn.execute(
                """SELECT p.provider_key FROM core.provider_ids p
                   JOIN core.competition_seasons cs ON cs.competition_id = p.entity_id AND cs.season_id = %s
                     AND cs.archive_key IS NULL AND cs.cup_key IS NULL
                   WHERE p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.provider_key = ANY(%s)""",
                (int(label[:4]), [key for key in PITCHAPI_COMPETITIONS.values() if key]),
            ).fetchall()
        }
        return {c["id"] for c in competitions if PITCHAPI_COMPETITIONS[c["id"]] not in covered}

    def selection(self, label, data):
        """(competitions, matches, overlap) of a season. After LAST_ARCHIVE_SEASON a competition PitchAPI holds that
        season is not imported when the base has no archive edition of it (the existing route); a stored archive
        edition of it is kept, every match of it held (`overlap`): a primary edition is routing, not proof that it
        holds these matches or their goals (FAILURE_MODES.md §23)."""
        competitions, matches = data["competitions"], data["matches"]
        if int(label[:4]) <= LAST_ARCHIVE_SEASON:
            return competitions, matches, set()
        ours = self.uncovered(label, competitions)
        stored = {key for (key,) in self.conn.execute(
            "SELECT archive_key FROM core.competition_seasons WHERE season_id = %s AND archive_key IS NOT NULL", (int(label[:4]),)).fetchall()}
        overlap = {c["id"] for c in competitions if c["id"] not in ours and c["id"] in stored}
        return ([c for c in competitions if c["id"] in ours or c["id"] in overlap], [m for m in matches if m["competitionId"] in ours], overlap)

    def dependents(self, match_ids):
        """{match id: [where]} of what else holds these matches, through ops.archive_match_dependents (migration 134):
        every table of core, agg and ops naming a match, and the events the archive does not write. The collect
        role runs it without reading agg."""
        out = defaultdict(list)
        ids = sorted(set(match_ids))
        for at in range(0, len(ids), 5000):
            for mid, where in self.conn.execute(
                "SELECT match_id, dependency FROM ops.archive_match_dependents(%s::integer[]) ORDER BY 1, 2", (ids[at:at + 5000],)
            ).fetchall():
                out[mid].append(where)
        return dict(out)

    def bind(self, season, ids):
        """{match id: {row, events, dependents}}: everything a removal or a hold is decided on. The whole stored row,
        every event (goals included) and every reference (FAILURE_MODES.md §23)."""
        ids = sorted(set(ids))
        if not ids:
            return {}
        rows = dict(self.conn.execute("SELECT id, to_jsonb(m) FROM core.matches m WHERE season_id = %s AND id = ANY(%s)", (season, ids)).fetchall())
        events = defaultdict(list)
        for mid, event in self.conn.execute(
                "SELECT match_id, to_jsonb(e) FROM core.match_events e WHERE season_id = %s AND match_id = ANY(%s) ORDER BY match_id, seq",
                (season, ids)).fetchall():
            events[mid].append(event)
        found = self.dependents(ids)
        return {mid: {"row": rows.get(mid), "events": events.get(mid, []), "dependents": found.get(mid, [])} for mid in ids}

    def removals(self, label, competitions, matches, excluded, overlap):
        """(removed, held, edition ids) of a season (FAILURE_MODES.md §20, §22, §23); ArchiveError, before any write, for a
        stored row going without a reviewed reason. `excluded`: {reviewed copy: the competition it copies}. A copy is
        removed only with no event and no reference, and its twin (same index in the copied competition) the same
        fixture; otherwise it is held. A quarantined key is never removed; an edition goes only with all its matches."""
        start = int(label[:4])
        keep, kept = {m["key"] for m in matches} | set(QUARANTINE), {c["id"] for c in competitions}
        candidates, held, refused = [], [], []
        for key, mid, edition in self.conn.execute(
            """SELECT m.archive_key, m.id, cs.archive_key FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
               WHERE m.season_id = %s AND m.archive_key IS NOT NULL ORDER BY 1""",
            (start,),
        ).fetchall():
            if key in keep:
                continue
            if edition in overlap:
                held.append((key, mid, "primary_overlap"))
            elif edition in excluded:
                candidates.append((key, mid, edition))
            else:
                refused.append(key)
        editions_out, editions_kept = [], []
        self.editions_kept = editions_kept
        stored_editions = self.conn.execute(
            "SELECT id, archive_key FROM core.competition_seasons WHERE season_id = %s AND archive_key IS NOT NULL ORDER BY 2", (start,)).fetchall()
        for ident, edition in stored_editions:
            if edition not in kept and edition not in excluded:
                refused.append(f"edition {edition}")
        if refused:
            shown = ", ".join(refused[:10]) + (f" and {len(refused) - 10} more" if len(refused) > 10 else "")
            raise ArchiveError(f"{label}: the edition would remove {len(refused)} stored archive row(s) without a reviewed reason: {shown}")
        bound = self.bind(start, [mid for _, mid, _ in candidates])
        # The twin is the stored match of the copied competition at the same index: its real state and identity, bound
        # in full (FAILURE_MODES.md §24), never the compiler's candidate.
        twin_keys = {key: f"r:{excluded[edition]}:{key.rsplit(':', 1)[1]}" for key, _, edition in candidates if excluded.get(edition)}
        twins = {key: row for key, row in self.conn.execute(
            "SELECT archive_key, to_jsonb(m) FROM core.matches m WHERE season_id = %s AND archive_key = ANY(%s)",
            (start, sorted(set(twin_keys.values())))).fetchall()}
        same = ("match_date", "home_team_id", "away_team_id", "home_team_name", "away_team_name", "home_score", "away_score", "status")
        removed = []
        for key, mid, edition in candidates:
            facts, row = bound[mid], bound[mid]["row"]
            twin = twins.get(twin_keys.get(key))
            if facts["events"] or facts["dependents"]:
                held.append((key, mid, "removal_has_dependents"))
            elif twin is None:
                held.append((key, mid, "twin_missing"))
            elif any(row[c] != twin[c] for c in same):
                held.append((key, mid, "twin_mismatch"))
            else:
                removed.append({"key": key, "id": mid, "edition": edition, "revision": row["revision"], "row": row, "events": [], "dependents": [],
                                "twin": {"key": twin_keys[key], "id": twin["id"], "row": twin}})
        removed_ids = {r["id"] for r in removed}
        for ident, edition in stored_editions:
            if edition in kept or edition not in excluded:
                continue
            others = [mid for (mid,) in self.conn.execute(
                "SELECT id FROM core.matches WHERE competition_season_id = %s ORDER BY id", (ident,)).fetchall() if mid not in removed_ids]
            rounds = [r for (r,) in self.conn.execute("SELECT id FROM core.rounds WHERE competition_season_id = %s ORDER BY id", (ident,)).fetchall()]
            found = sorted({where for _, _, where in self.conn.execute(
                "SELECT kind, id, dependency FROM ops.archive_edition_dependents(%s::integer[], %s::integer[]) ORDER BY 1, 2, 3",
                ([ident], rounds)).fetchall()})
            if others or found:
                editions_kept.append({"key": edition, "class": "held", "id": ident,
                                      "held": "edition_holds_matches" if others else "edition_has_dependents",
                                      "dependents": found, "matches": len(others)})
                continue
            editions_out.append((edition, ident))
        return sorted(removed, key=lambda r: r["key"]), sorted(held), sorted(editions_out)

    def season(self, label, data, provider_of, excluded=()):
        """Write one season's archive matches from its edition (the plan's decisions, applied at once)."""
        done = _season(self.conn, label, data, provider_of, _copies(excluded), self.created, write=True)
        if done["refused"]:
            raise ArchiveError(done["refused"])
        return done["selected"]


def _season(conn, label, data, provider_of, excluded, created, write, digest=None):
    """One season's plan (FAILURE_MODES.md §20, §22): with `write`, also its writes, the same decisions taken by the same
    code. Teams, editions and rounds still to create are named `new:<key>` in a plan; no id is taken. Every entry binds
    the stored row, goals and events it was decided on."""
    start = int(label[:4])
    excluded = _copies(excluded)
    loader = Loader(conn, created)
    competitions, matches, overlap = loader.selection(label, data)
    selected = {m["key"] for m in matches}
    out = {"refused": None, "matches": [], "removed": [], "editions": [], "editions_removed": [], "teams_to_create": [],
           "competitions_to_create": [],
           "held_units": [u for u in data.get("held") or [] if selected & set(u["legacy"])]}
    try:
        removed, held_rows, editions_out = loader.removals(label, competitions, matches, excluded, overlap)
        rows = [match_row(m) for m in matches]
    except ArchiveError as error:
        out["refused"] = str(error)
        return out
    wrote = False
    if write:
        Store(conn).season(label)
    out["removed"] = removed
    out["editions_removed"] = [edition for edition, _ in editions_out]
    # What an edition's removal or keeping is decided on: its row and its rounds, or why it stays (FAILURE_MODES.md §24).
    for edition, ident in editions_out:
        out["editions"].append({"key": edition, "class": "removed", "id": ident,
                                "row": conn.execute("SELECT to_jsonb(cs) FROM core.competition_seasons cs WHERE id = %s", (ident,)).fetchone()[0],
                                "rounds": [r for (r,) in conn.execute(
                                    "SELECT to_jsonb(r) FROM core.rounds r WHERE competition_season_id = %s ORDER BY id", (ident,)).fetchall()]})
    out["editions"] += loader.editions_kept
    # Verify the surviving twin's exact pre-image before this transaction changes any of its
    # fields (such as archive_position). Tombstones and locks remain in place until commit.
    if write and (removed or editions_out):
        wrote = _delete(conn, loader, start, removed, [e for e in out["editions"] if e["class"] == "removed"], digest) or wrote
    # A stored match kept by a reason of its edition (a primary overlap, a copy that cannot go), with all it holds.
    facts = loader.bind(start, [mid for _, mid, _ in held_rows])
    out["matches"] += [{"key": key, "class": "held", "held": reason, "id": mid, "revision": facts[mid]["row"]["revision"], "before": facts[mid]}
                       for key, mid, reason in held_rows]
    stored_editions = {key: (ident, name, country, position) for ident, key, name, country, position in conn.execute(
        """SELECT id, archive_key, archive_name, archive_country, archive_position FROM core.competition_seasons
           WHERE season_id=%s AND archive_key IS NOT NULL""", (start,)).fetchall()}
    editions = {}
    for position, comp in enumerate(competitions):
        now = [comp["name"], comp.get("country"), position]
        known = stored_editions.get(comp["id"])
        if known is not None:
            editions[comp["id"]] = known[0]
            if list(known[1:]) != now:
                out["editions"].append({"key": comp["id"], "class": "changed", "before": list(known[1:]), "after": now})
                if write:
                    conn.execute("UPDATE core.competition_seasons SET archive_name=%s, archive_country=%s, archive_position=%s, updated_at=now() WHERE id=%s",
                                 (*now, known[0]))
                    wrote = True  # its name, country or order is published (FAILURE_MODES.md §24)
            continue
        competition = loader.competition(family(comp["id"]), comp["name"], write)
        out["editions"].append({"key": comp["id"], "class": "new", "competition": competition if not write else None, "after": now})
        if write:
            editions[comp["id"]] = conn.execute(
                """INSERT INTO core.competition_seasons(competition_id, season_id, native_label, archive_key, archive_name, archive_country, archive_position)
                   VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (competition, start, label, comp["id"], comp["name"], comp.get("country"), position),
            ).fetchone()[0]
            wrote = True
        else:
            editions[comp["id"]] = f"new:{comp['id']}"
    known_ids = [v for v in editions.values() if isinstance(v, int)]
    rounds = {(e, n): i for e, n, i in conn.execute(
        "SELECT competition_season_id, name, id FROM core.rounds WHERE competition_season_id = ANY(%s)", (known_ids,)).fetchall()}
    stored = goals_stored = events_stored = columns = None
    for position, (match, row) in enumerate(zip(matches, rows)):
        key, edition_id = match["key"], editions[match["competitionId"]]
        round_id = None
        if match.get("round"):
            round_id = rounds.get((edition_id, match["round"]))
            if round_id is None:
                if write:
                    round_id = rounds[(edition_id, match["round"])] = conn.execute(
                        """INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s)
                           ON CONFLICT (competition_season_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id""",
                        (edition_id, match["round"]),
                    ).fetchone()[0]
                else:
                    round_id = f"new:{edition_id}|{match['round']}"
        if stored is None:
            probe = candidate_values(match, row, edition_id, start, round_id, None, None, position, provider_of)
            columns = list(probe)
            stored = {k: (ident, tuple(rest[:-3]), rest[-3], rest[-2], rest[-1]) for k, ident, *rest in conn.execute(
                f"SELECT archive_key, id, {', '.join(f'{c}::text' for c in columns)}, revision, home_team_id, away_team_id FROM core.matches "
                "WHERE season_id=%s AND archive_key IS NOT NULL", (start,)).fetchall()}
            goals_stored, events_stored = defaultdict(list), defaultdict(list)
            for match_id, *event in conn.execute(
                f"SELECT e.match_id, {', '.join(f'e.{c}::text' for c in EVENT_COLUMNS)} FROM core.match_events e "
                "JOIN core.matches m ON m.id = e.match_id AND m.season_id = e.season_id AND m.archive_key IS NOT NULL "
                "WHERE e.season_id=%s ORDER BY e.match_id, e.seq", (start,)).fetchall():
                events_stored[match_id].append(list(event))
                if event[0] == "goal":
                    goals_stored[match_id].append(tuple(event[EVENT_COLUMNS.index(c)] for c in GOAL_COLUMNS))
        known = stored.get(key)
        before = None if known is None else {"row": dict(zip(columns, known[1])), "goals": [list(g) for g in goals_stored.get(known[0], [])],
                                              "events": events_stored.get(known[0], [])}
        reason = (QUARANTINE.get(key) or {}).get("reason") or (match.get("held") if known is not None else None)
        if reason:
            entry = {"key": key, "class": "held", "held": reason}
            if known is not None:
                entry.update(id=known[0], revision=known[2], before=before)
            if match.get("candidate"):
                entry["candidate"] = match["candidate"]
            out["matches"].append(entry)
            continue
        bindings = {}
        home = loader.side(match, "team1", bindings, known and known[3], write)
        away = loader.side(match, "team2", bindings, known and known[4], write)
        values = candidate_values(match, row, edition_id, start, round_id, home, away, position, provider_of)
        goals = goal_rows(match, home, away)
        goals_text = [tuple(_pg_text(v) for v in g) for g in goals]
        kind = compare(known and (known[0], known[1]), values, columns)
        goals_changed = known is None or goals_stored.get(known[0], []) != goals_text
        if known is not None:
            problem = _hold(before["row"], values, goals_stored.get(known[0], []), goals_text, before["events"], goals_changed)
            if problem:
                out["matches"].append({"key": key, "class": "held", "held": problem, "id": known[0], "revision": known[2], "before": before,
                                       "after": {"row": {c: _pg_text(values[c]) for c in columns}, "goals": [list(g) for g in goals_text]}})
                continue
        if kind == "unchanged" and not goals_changed:
            continue
        entry = {"key": key, "class": kind if kind != "unchanged" else "goals", "bindings": bindings,
                 "after": {"row": {c: _pg_text(values[c]) for c in columns}, "goals": [list(g) for g in goals_text] if goals_changed else None}}
        if known is not None:
            entry.update(id=known[0], revision=known[2], before=before)
        for flag in ("held", "heldGoals", "unparsedLabel"):
            if match.get(flag):
                entry[flag] = match[flag]
        out["matches"].append(entry)
        if not write:
            continue
        wrote = True
        if kind == "position":
            mid = known[0]
            conn.execute("UPDATE core.matches SET archive_position=%s WHERE id=%s AND revision=%s", (position, mid, known[2]))
        elif kind in ("new", "changed"):
            mid = conn.execute(
                f"""INSERT INTO core.matches({", ".join(columns)}) VALUES ({", ".join(["%s"] * len(columns))})
                    ON CONFLICT (season_id, archive_key) WHERE archive_key IS NOT NULL DO UPDATE SET
                    {", ".join(f"{c}=EXCLUDED.{c}" for c in columns if c not in ("season_id", "archive_key"))},
                    revision=core.matches.revision+1, updated_at=now() RETURNING id""",
                [values[c] for c in columns],
            ).fetchone()[0]
        else:
            mid = known[0]
        if goals_changed:
            # The archive's own rows only: cards and every other event stay (FAILURE_MODES.md §22).
            conn.execute("DELETE FROM core.match_events WHERE season_id=%s AND match_id=%s AND event_type='goal'", (start, mid))
            for goal in goals:
                conn.execute(
                    f"""INSERT INTO core.match_events(season_id, match_id, event_type, {', '.join(GOAL_COLUMNS)})
                        VALUES (%s,%s,'goal',{', '.join(['%s'] * len(GOAL_COLUMNS))})""",
                    (start, mid, *goal),
                )
    out["matches"].sort(key=lambda m: m["key"])
    out["teams_to_create"] = sorted(loader.new_teams)
    out["competitions_to_create"] = sorted(loader.new_competitions)
    out["counts"] = {kind: sum(1 for m in out["matches"] if m["class"] == kind) for kind in ("new", "changed", "position", "goals", "held")}
    if write:
        if wrote:
            conn.execute(
                """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('archive_season', %s)
                   ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
                (start,),
            )
        out["wrote"], out["selected"] = wrote, len(matches)
    return out


class ArchiveDrift(ArchiveError):
    """What an approved plan was decided on changed: its season is refused before anything is written."""


def _copies(excluded):
    """{reviewed copy competition: the competition it copies (or None)} from a dict, or the ids alone."""
    return dict(excluded) if isinstance(excluded, dict) else {e: None for e in excluded or ()}


def _before_delete():
    """A seam for the race tests: called in an apply's transaction, its locks held, before the deletion's final check."""


def _after_locks():
    """A seam for the race tests: called once the deletion holds its SHARE and row locks, before its final check."""


def _after_season(label):
    """A seam for the restart tests: called after a season's transaction committed."""


def _delete(conn, loader, start, removed, editions, digest=None):
    """The season's reviewed deletions, before any surviving row changes (FAILURE_MODES.md §23, §24, §27).
    - The removed matches are locked (FOR UPDATE, with their events) since the start of the apply; the editions and
      rounds going are locked here. A writer with a foreign key waits, then fails on the deleted row.
    - Every relation naming a match or an edition without a foreign key is SHARE-locked until the commit
      (ops.archive_lock_references).
    - The facts each removal was decided on are read again under those locks; any difference refuses the season
      (ArchiveDrift).
    - Each deleted row gets its tombstone (ops.archive_removals) in this transaction. A writer that resumes after the
      commit, or starts later, naming it is refused by the archive_removed_* triggers (foreign_key_violation)."""
    _before_delete()
    locked = conn.execute("SELECT ops.archive_lock_references()").fetchone()[0]
    edition_ids = [e["id"] for e in editions]
    round_ids = [r["id"] for e in editions for r in e["rounds"]]
    if edition_ids:
        conn.execute("SELECT id FROM core.competition_seasons WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (edition_ids,))
    if round_ids:
        conn.execute("SELECT id FROM core.rounds WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (round_ids,))
    _after_locks()
    ids = [r["id"] for r in removed]
    now = loader.bind(start, ids)
    for r in removed:
        if now[r["id"]]["row"] != r["row"] or now[r["id"]]["events"] or now[r["id"]]["dependents"]:
            raise ArchiveDrift(f"{r['key']} changed before its deletion")
    twins = {r["twin"]["id"]: r for r in removed}
    for ident, row in (conn.execute("SELECT id, to_jsonb(m) FROM core.matches m WHERE season_id = %s AND id = ANY(%s)",
                                    (start, sorted(twins))).fetchall() if twins else []):
        if row != twins[ident]["twin"]["row"]:
            raise ArchiveDrift(f"the twin of {twins[ident]['key']} changed before its deletion")
    if edition_ids:
        if conn.execute("SELECT 1 FROM core.matches WHERE competition_season_id = ANY(%s) AND id <> ALL(%s) LIMIT 1", (edition_ids, ids)).fetchone():
            raise ArchiveDrift("a removed edition holds another match")
        if conn.execute("SELECT 1 FROM ops.archive_edition_dependents(%s::integer[], %s::integer[]) LIMIT 1", (edition_ids, round_ids)).fetchone():
            raise ArchiveDrift("a removed edition or round gained a dependency")
        for e in editions:
            if conn.execute("SELECT to_jsonb(cs) FROM core.competition_seasons cs WHERE id = %s", (e["id"],)).fetchone()[0] != e["row"]:
                raise ArchiveDrift(f"edition {e['key']} changed before its deletion")
    tombstones = [("match", r["id"], start, r["key"]) for r in removed]
    tombstones += [("round", r["id"], start, None) for e in editions for r in e["rounds"]]
    tombstones += [("edition", e["id"], start, e["key"]) for e in editions]
    for kind, ident, season, key in tombstones:
        conn.execute("INSERT INTO ops.archive_removals(kind, id, season_id, archive_key, plan_sha256) VALUES (%s, %s, %s, %s, %s)",
                     (kind, ident, season, key, digest))
    if ids and conn.execute("DELETE FROM core.matches WHERE season_id = %s AND id = ANY(%s)", (start, ids)).rowcount != len(ids):
        raise ArchiveDrift("a removed match was already gone")
    if round_ids:
        conn.execute("DELETE FROM core.rounds WHERE id = ANY(%s)", (round_ids,))
    if edition_ids:
        conn.execute("DELETE FROM core.competition_seasons WHERE id = ANY(%s)", (edition_ids,))
    loader.locked = locked
    return bool(ids or edition_ids)


def provider_for(index_sources):
    def provider_of(match):
        cid = match["competitionId"]
        if cid.startswith("g:"):
            return "worldclub"
        if cid.startswith("engsoccerdata/"):
            return "engsoccerdata"
        if cid.split("/", 1)[0] in ("england", "deutschland", "europe", "soccerdata"):
            return "footballcsv"
        if cid.startswith("worldclub/") or cid.startswith("scotland/"):
            return "worldclub"
        return "openfootball"
    return provider_of


def _source_key(key):
    return re.sub(r"[^a-z0-9_./-]", "-", key.lower())[:80]


def _source_entries(results_index, goals_index):
    entries = []
    if results_index:
        src = results_index["source"]
        entries.append(("results", src))
        entries += [(f"results/{a['name']}", a) for a in src.get("additionalSources", [])]
    if goals_index:
        entries.append(("goals", goals_index["source"]))
    return entries


def record_sources(conn, results_index, goals_index):
    """The source revisions the read API shows. A row changes, and its retrieved_at with it, only when its values
    do: a run that publishes nothing new leaves them (and the archive API's ETag) as they were (§22)."""
    changed = 0
    for position, (key, src) in enumerate(_source_entries(results_index, goals_index)):
        changed += conn.execute(
            """INSERT INTO core.source_revisions(source, name, url, license, revision, archive_sha256, coverage, position, retrieved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now())
               ON CONFLICT (source) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, license=EXCLUDED.license,
                 revision=EXCLUDED.revision, archive_sha256=EXCLUDED.archive_sha256, coverage=EXCLUDED.coverage,
                 position=EXCLUDED.position, retrieved_at=now()
               WHERE (core.source_revisions.name, core.source_revisions.url, core.source_revisions.license, core.source_revisions.revision,
                      core.source_revisions.archive_sha256, core.source_revisions.coverage, core.source_revisions.position)
                 IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.url, EXCLUDED.license, EXCLUDED.revision, EXCLUDED.archive_sha256,
                                   EXCLUDED.coverage, EXCLUDED.position)""",
            (_source_key(key), src.get("name") or key, src.get("url"), src.get("license"),
             src.get("revision"), src.get("archiveSha256"), src.get("coverage"), position),
        ).rowcount
    return changed


def check_families(conn, results_index, goals_index):
    """ArchiveError when a source family the base records (results, goals, each additional results source) is not in
    the inputs: an absent family is never an instruction to clear what it gave (§22)."""
    present = {_source_key(key) for key, _ in _source_entries(results_index, goals_index)}
    recorded = {source for (source,) in conn.execute(
        "SELECT source FROM core.source_revisions WHERE source IN ('results', 'goals') OR source LIKE 'results/%'").fetchall()}
    missing = sorted(recorded - present)
    if missing:
        raise ArchiveError(f"source families recorded in the base are missing from the inputs: {', '.join(missing)}")


SOURCE_FOLDERS = ("openfootball/", "engsoccerdata/", "worldclub/")


def download(url, target, client=None):
    """Copy the archive source folders of s3://bucket/prefix into target (read only)."""
    import boto3

    bucket, _, prefix = url[len("s3://"):].partition("/")
    prefix = prefix.rstrip("/") + "/"
    s3 = client or boto3.client("s3")
    for folder in SOURCE_FOLDERS:
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix + folder):
            for item in page.get("Contents", []):
                relative = item["Key"][len(prefix):]
                if ".." in Path(relative).parts:
                    raise ArchiveError("unexpected source key")
                path = Path(target) / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                s3.download_file(bucket, item["Key"], str(path))
    return Path(target)


@contextlib.contextmanager
def editions(sources, seasons=None):
    """(inputs, results index, goals index, labels, [(label, edition data, provider_of, excluded competition ids)])."""
    with tempfile.TemporaryDirectory(prefix="vega-archives-") as work:
        if str(sources).startswith("s3://"):
            sources = download(str(sources), Path(work) / "sources")
        sources = Path(sources)
        code = code_manifest()
        results_dir, goals_dir = build_sources(sources, work)
        results_index = json.loads((results_dir / "index.json").read_text(encoding="utf-8"))
        goals_index = json.loads((goals_dir / "index.json").read_text(encoding="utf-8")) if goals_dir else None
        files = {}
        for kind, index, base in (("results", results_index, results_dir), ("goals", goals_index, goals_dir)):
            for entry in (index or {}).get("seasons", []):
                path = base / Path(entry["path"]).name
                if not path.is_file():
                    raise ArchiveError(f"the {kind} index lists {entry['id']} without its file")
                files.setdefault(entry["id"], {})[kind] = path
        # {reviewed copy: the competition it copies}: a copy's rows go only beside their twins (§23).
        excluded = {e["file"][: -len(".json")]: (e.get("copy_of") or "")[: -len(".json")] or None for e in results_index.get("excluded", [])}
        inputs = {
            "sources": {str(path.relative_to(sources)): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in sorted(sources.rglob("*")) if path.is_file()},
            "code": code,
            "excluded": sorted(results_index.get("excluded", []), key=lambda e: e["file"]),
        }
        provider_of = provider_for(results_index)
        listed = [label for label in sorted(files) if not seasons or label in seasons]
        yield inputs, results_index, goals_index, listed, (
            (label, edition(files[label].get("results"), files[label].get("goals")), provider_of, excluded) for label in listed)


def run(conn, sources, seasons=None):
    """Import the archive seasons (or the given labels) as their plans say, each in one transaction; returns
    {season: matches}. The library path of a fresh import and of the tests: the CLI only reaches it through
    --fresh, on seasons holding no archive match (§22)."""
    out = {}
    with editions(sources, seasons) as (_, results_index, goals_index, _labels, seasons_data):
        check_families(conn, results_index, goals_index)
        for label, data, provider_of, excluded in seasons_data:
            with conn.transaction():
                done = _season(conn, label, data, provider_of, excluded, {}, write=True)
                if done["refused"]:
                    raise ArchiveError(done["refused"])
                if done["wrote"]:
                    record_sources(conn, results_index, goals_index)
            out[label] = done["selected"]
            # One line per season as it lands: the import runs for hours.
            print(f"season={label} matches={out[label]} held={done['counts']['held']}", flush=True)
    return out


def fresh(conn, sources, seasons=None):
    """run(), only when no target season holds an archive match yet; ArchiveError otherwise, before any write."""
    with editions(sources, seasons) as (_, _results, _goals, labels, _data):
        busy = [label for label in labels if conn.execute(
            "SELECT 1 FROM core.matches WHERE season_id = %s AND archive_key IS NOT NULL LIMIT 1", (int(label[:4]),)).fetchone()]
    if busy:
        raise ArchiveError(f"--fresh: {len(busy)} season(s) already hold archive matches ({', '.join(busy[:5])}); repairs need a reviewed plan")
    return run(conn, sources, seasons)


def plan(conn, sources, seasons=None):
    """The read-only plan of an import (FAILURE_MODES.md §20, §22): sorted, without time, ids or sequences taken."""
    with editions(sources, seasons) as (inputs, results_index, goals_index, _labels, seasons_data):
        check_families(conn, results_index, goals_index)
        result = {"inputs": inputs, "seasons": {}}
        for label, data, provider_of, excluded in seasons_data:
            with conn.transaction():
                conn.execute("SET TRANSACTION READ ONLY")
                result["seasons"][label] = _season(conn, label, data, provider_of, excluded, {}, write=False)
    return result


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _overall(outcomes):
    values = list(outcomes.values())
    if values and all(v == "applied" for v in values):
        return "complete"
    if any(v in ("applied", "partial") for v in values):
        return "partial"
    return "refused"


def season_plan(conn, label, data, provider_of, excluded, created=None):
    """One season's read-only plan (the decisions apply_season compares and executes)."""
    return _season(conn, label, data, provider_of, excluded, created or {}, write=False)


def _decision(conn, digest, label, outcome, receipt):
    conn.execute("INSERT INTO ops.archive_plan_seasons(sha256, label, outcome, receipt) VALUES (%s, %s, %s, %s::jsonb)",
                 (digest, label, outcome, canonical(receipt)))


def apply_season(conn, label, data, provider_of, excluded, expected, created, *, digest=None, publish=None):
    """Apply one approved season plan; returns applied | partial | drift | refused | lock_timeout. The season's archive
    matches and the events of every bound match are locked, the season is planned again and written only if that
    plan is the approved one, all in one transaction with its durable decision (ops.archive_plan_seasons, when a
    stored plan's `digest` is given). `created` gains the identities a written season created."""
    if expected["refused"]:
        outcome = "refused"
        if digest:
            with conn.transaction():
                _decision(conn, digest, label, outcome, {"refused": expected["refused"]})
        return outcome
    start, mine = int(label[:4]), dict(created)
    try:
        with conn.transaction():
            conn.execute("SET LOCAL lock_timeout = '30s'")
            conn.execute("SELECT pg_advisory_xact_lock(hashtext('vega.archives.apply'))")
            conn.execute("SELECT id FROM core.matches WHERE season_id=%s AND archive_key IS NOT NULL ORDER BY id FOR UPDATE", (start,))
            bound = sorted({m["id"] for m in expected["matches"] if m.get("id")} | {r["id"] for r in expected["removed"]})
            if bound:
                conn.execute("SELECT 1 FROM core.match_events WHERE season_id=%s AND match_id = ANY(%s) ORDER BY match_id, seq FOR UPDATE",
                             (start, bound))
            if canonical(_season(conn, label, data, provider_of, excluded, mine, write=False)) != canonical(expected):
                raise ArchiveDrift(f"{label}: the stored rows differ from the reviewed plan's")
            done = _season(conn, label, data, provider_of, excluded, mine, write=True, digest=digest)
            if done["wrote"] and publish:
                publish()
            outcome = "partial" if done["counts"]["held"] else "applied"
            if digest:
                _decision(conn, digest, label, outcome, {
                    "counts": done["counts"], "removed": [r["id"] for r in done["removed"]], "wrote": done["wrote"],
                    "created": sorted([entity, key, ident] for (entity, key), ident in mine.items() if (entity, key) not in created)})
    except ArchiveDrift as error:
        outcome = "drift"
        if digest:
            with conn.transaction():
                _decision(conn, digest, label, outcome, {"reason": str(error)})
    except (psycopg_errors().LockNotAvailable, psycopg_errors().QueryCanceled, psycopg_errors().DeadlockDetected,
            psycopg_errors().SerializationFailure):
        return "lock_timeout"  # a conflict is never an application: nothing decided, a later run tries again (§24)
    if outcome in ("applied", "partial"):
        created.update(mine)
    return outcome


def apply(conn, sources, approved, seasons=None, *, digest=None):
    """Write the seasons of a reviewed plan whose inputs, code and stored rows are still the ones it was made on (each
    through apply_season). With a stored plan's `digest`, a season already decided is not attempted again and the
    identities it created are restored (a run resumes after a crash). Returns {"status": complete | partial | refused,
    "seasons": {label: outcome}, "resumed": [labels decided by an earlier run]}."""
    wanted = set(seasons or approved["seasons"])
    decided, created = {}, {}
    if digest:
        for label, outcome, receipt in conn.execute(
                "SELECT label, outcome, receipt FROM ops.archive_plan_seasons WHERE sha256 = %s ORDER BY label", (digest,)).fetchall():
            decided[label] = outcome
            created.update({(entity, key): ident for entity, key, ident in (receipt or {}).get("created", [])})
    outcomes = {label: decided[label] for label in sorted(wanted & set(decided))}
    todo = wanted - set(decided)
    if todo:
        with editions(sources, todo) as (inputs, results_index, goals_index, _labels, seasons_data):
            if canonical(inputs) != canonical(approved["inputs"]):
                raise ArchiveError("the sources or the parser differ from the reviewed plan's")
            check_families(conn, results_index, goals_index)
            for label, data, provider_of, excluded in seasons_data:
                expected = approved["seasons"].get(label)
                if expected is None:
                    outcomes[label] = "not_planned"
                    continue
                outcomes[label] = apply_season(conn, label, data, provider_of, excluded, expected, created, digest=digest,
                                               publish=lambda: record_sources(conn, results_index, goals_index))
                print(f"season={label} outcome={outcomes[label]}", flush=True)
                _after_season(label)
    return {"status": _overall(outcomes), "seasons": dict(sorted(outcomes.items())), "resumed": sorted(wanted & set(decided))}


def plan_lock_key(digest):
    """The session advisory lock a stored plan's applier holds: one session at a time per plan."""
    return int(digest[:15], 16)


def psycopg_errors():
    import psycopg

    return psycopg.errors


def store_plan(conn, approved):
    """Keep a plan's exact canonical bytes in ops.archive_plans under their SHA-256 (migration 134); returns it."""
    body = canonical(approved) + "\n"
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    with conn.transaction():
        conn.execute("INSERT INTO ops.archive_plans(sha256, plan) VALUES (%s, %s) ON CONFLICT (sha256) DO NOTHING", (digest, body))
    return digest


def _stored(conn, digest):
    row = conn.execute("SELECT plan, applied_at FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()
    if row is None or hashlib.sha256(row[0].encode("utf-8")).hexdigest() != digest:
        raise ArchiveError(f"no stored plan {digest}")
    return json.loads(row[0]), row[1]


def stored_plan(conn, digest):
    return _stored(conn, digest)[0]


def apply_stored(conn, sources, digest, seasons=None):
    """Apply a stored plan by its digest (all its seasons, or the given subset), owned by this session alone. Each
    season's decision is durable as it commits; the plan is stamped applied, with its receipt, only once every planned
    season has a decision. Returns apply()'s report with the seasons still `pending`."""
    approved, _ = _stored(conn, digest)
    key = plan_lock_key(digest)
    if not conn.execute("SELECT pg_try_advisory_lock(%s)", (key,)).fetchone()[0]:
        raise ArchiveError(f"plan {digest} is being applied by another session")
    try:
        # Its state is read once the plan is this session's (another applier may have just finished): §24.
        applied_at = conn.execute("SELECT applied_at FROM ops.archive_plans WHERE sha256 = %s", (digest,)).fetchone()[0]
        if applied_at is not None:
            raise ArchiveError(f"plan {digest} was applied at {applied_at.isoformat()}")
        report = apply(conn, sources, approved, seasons, digest=digest)
        decided = dict(conn.execute("SELECT label, outcome FROM ops.archive_plan_seasons WHERE sha256 = %s", (digest,)).fetchall())
        report["pending"] = sorted(set(approved["seasons"]) - set(decided))
        if not report["pending"]:
            with conn.transaction():
                conn.execute("UPDATE ops.archive_plans SET applied_at = now(), receipt = %s::jsonb WHERE sha256 = %s AND applied_at IS NULL",
                             (canonical({"status": _overall(decided), "seasons": dict(sorted(decided.items()))}), digest))
    finally:
        conn.execute("SELECT pg_advisory_unlock(%s)", (key,))
    return report


EXIT = {"complete": 0, "partial": 3, "refused": 1}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sources")
    parser.add_argument("--seasons", help="comma-separated labels (default: every archive season)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan", type=Path, help="write the read-only plan to this file; nothing is changed")
    mode.add_argument("--plan-store", action="store_true", help="keep the read-only plan in ops.archive_plans; prints its SHA-256")
    mode.add_argument("--show-plan", metavar="SHA256", help="print a stored plan")
    mode.add_argument("--apply", type=Path, help="write the seasons of this reviewed plan file (with --plan-sha256)")
    mode.add_argument("--apply-stored", metavar="SHA256", help="write the seasons of this stored plan, once")
    mode.add_argument("--fresh", action="store_true", help="import seasons that hold no archive match yet")
    parser.add_argument("--plan-sha256", help="the reviewed plan file's SHA-256")
    parser.add_argument("--receipt", type=Path, help="also write the apply's report to this file")
    args = parser.parse_args(argv)
    if not (args.plan or args.plan_store or args.show_plan or args.apply or args.apply_stored or args.fresh):
        print("a mode is required: --plan, --plan-store, --show-plan, --apply, --apply-stored or --fresh (FAILURE_MODES.md §22)", file=sys.stderr)
        return 2
    if not args.show_plan and not args.sources:
        print("--sources is required", file=sys.stderr)
        return 2
    dsn = os.environ.get("V2_DATABASE_URL")
    if not dsn:
        print("V2_DATABASE_URL is required", file=sys.stderr)
        return 2
    from .worker import connect

    conn = connect(dsn)
    seasons = set(args.seasons.split(",")) if args.seasons else None
    try:
        if args.show_plan:
            # The stored bytes themselves: their SHA-256 is the digest (an exported plan is the reviewed one).
            body = conn.execute("SELECT plan FROM ops.archive_plans WHERE sha256 = %s", (args.show_plan,)).fetchone()
            if body is None or hashlib.sha256(body[0].encode("utf-8")).hexdigest() != args.show_plan:
                raise ArchiveError(f"no stored plan {args.show_plan}")
            sys.stdout.buffer.write(body[0].encode("utf-8"))
            sys.stdout.flush()
            return 0
        if args.plan or args.plan_store:
            result = plan(conn, args.sources, seasons)
            if args.plan:
                args.plan.write_text(canonical(result) + "\n", encoding="utf-8")
                print(f"plan={args.plan} sha256={hashlib.sha256(args.plan.read_bytes()).hexdigest()}", flush=True)
            else:
                print(f"plan stored sha256={store_plan(conn, result)}", flush=True)
            return 0
        if args.fresh:
            done = fresh(conn, args.sources, seasons)
            print(f"archives seasons={len(done)} matches={sum(done.values())}", flush=True)
            return 0
        if args.apply:
            raw = args.apply.read_bytes()
            if hashlib.sha256(raw).hexdigest() != (args.plan_sha256 or ""):
                print("--plan-sha256 must be the reviewed plan's digest", file=sys.stderr)
                return 2
            report = apply(conn, args.sources, json.loads(raw), seasons)
        else:
            report = apply_stored(conn, args.sources, args.apply_stored, seasons)
    except ArchiveError as error:
        print(f"refused: {error}", file=sys.stderr)
        return 1
    if args.receipt:
        args.receipt.write_text(canonical(report) + "\n", encoding="utf-8")
    print(canonical(report), flush=True)
    return EXIT[report["status"]]


if __name__ == "__main__":
    sys.exit(main())
