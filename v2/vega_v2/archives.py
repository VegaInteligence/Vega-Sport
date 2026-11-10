"""Historical archives into core (doc: archives in core.matches, scorers in
core.match_events), built exactly as main builds them.

1. main's archive builders (dashboard/scripts/build_*_history.py, build_historical_goals.py)
   run unchanged on the pinned source files, into a temporary directory;
2. for each season, main's shared/archive.js builds the edition (results, the goals
   attached to their match, goal-only matches) through v2/archives/edition.mjs;
3. the edition is written as typed rows: one competition per archive family, one
   edition per season, Vega teams by name and country, matches, rounds and goals.

Seasons up to 2020/2021 are imported whole. From 2021/2022 on PitchAPI is the source,
and the archives only fill what it does not have: a competition is imported for the
seasons PitchAPI has no edition of it (the national cups it never has, a league before
its first PitchAPI season), so a match is never stored twice (PITCHAPI_COMPETITIONS).
A season is replaced as a whole (its archive matches only); ids stay stable because
every row is keyed by its archive key. Files are processed in a temporary directory
and never stored.

  python -m vega_v2.archives --sources <dir, or s3://bucket/data/sources, laid out as main's data/sources> [--seasons ...]
"""

import argparse
from collections import defaultdict
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
# goal archive's competitions (dashboard/scripts/build_historical_goals.py), the only
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
ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(os.environ.get("VEGA_ARCHIVE_SCRIPTS", ROOT / "dashboard/scripts"))
EDITION = Path(os.environ.get("VEGA_ARCHIVE_EDITION", ROOT / "v2/archives/edition.mjs"))
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


def match_row(match):
    source = match.get("source")
    score = match["score"]
    if source:
        et, p = _pair(source.get("et")), _pair(source.get("p"))
        not_played = source.get("status") == "not_played"
        row = {
            "home_score_et": et and et[0], "away_score_et": et and et[1],
            "home_penalty_score": p and p[0], "away_penalty_score": p and p[1], "decided_on_penalties": None,
            "status": "canceled" if not_played else "finished",
            "note": (source.get("nonmatch") or None) if not_played else None, "is_neutral": bool(source.get("neutral")) or None,
        }
    else:
        notes = match.get("notes") or []
        extra = "après prolongation" in notes
        row = {
            "home_score_et": score[0] if extra else None, "away_score_et": score[1] if extra else None,
            "home_penalty_score": None, "away_penalty_score": None, "decided_on_penalties": "tirs au but" in notes or None,
            "status": "finished", "note": None, "is_neutral": None,
        }
    row.update(home_score=score[0], away_score=score[1])
    if notes_of(row) != (match.get("notes") or []):
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


class Loader:
    def __init__(self, conn):
        self.conn = conn
        self.teams = {}

    def _key(self, entity, provider_key):
        row = self.conn.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider='vega' AND provider_key=%s", (entity, provider_key)
        ).fetchone()
        return row and row[0]

    def _link(self, entity, provider_key, ident):
        self.conn.execute(
            "INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES (%s,'vega',%s,%s)", (entity, provider_key, ident)
        )

    def competition(self, comp_family, name, country):
        key = "archive:" + comp_family
        ident = self._key("competition", key)
        if ident is None:
            ident = self.conn.execute("INSERT INTO core.competitions(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]
            self._link("competition", key, ident)
        return ident

    def team(self, name, country):
        key = f"archive:{normalize(country)}:{normalize(name)}"
        if key not in self.teams:
            ident = self._key("team", key)  # may be a PitchAPI club the archive team was merged into
            if ident is None:
                ident = self.conn.execute("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]
                self._link("team", key, ident)
            self.teams[key] = ident
        return self.teams[key]

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

    def season(self, label, data, provider_of):
        """Replace one season's archive matches with its edition."""
        start = int(label[:4])
        Store(self.conn).season(label)
        competitions, matches = data["competitions"], data["matches"]
        if start > LAST_ARCHIVE_SEASON:
            ours = self.uncovered(label, competitions)
            competitions = [c for c in competitions if c["id"] in ours]
            matches = [m for m in matches if m["competitionId"] in ours]
        editions = {}
        for position, comp in enumerate(competitions):
            competition = self.competition(family(comp["id"]), comp["name"], comp.get("country"))
            editions[comp["id"]] = self.conn.execute(
                """INSERT INTO core.competition_seasons(competition_id, season_id, native_label, archive_key, archive_name, archive_country, archive_position)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (season_id, archive_key) WHERE archive_key IS NOT NULL DO UPDATE SET archive_name=EXCLUDED.archive_name, archive_country=EXCLUDED.archive_country,
                     archive_position=EXCLUDED.archive_position, updated_at=now()
                   RETURNING id""",
                (competition, start, label, comp["id"], comp["name"], comp.get("country"), position),
            ).fetchone()[0]
        keep = {m["key"] for m in matches}
        changed = self.conn.execute(
            "DELETE FROM core.matches WHERE season_id=%s AND archive_key IS NOT NULL AND NOT archive_key = ANY(%s)", (start, list(keep))
        ).rowcount
        # An edition the season no longer has (PitchAPI has it now) goes with its rounds.
        gone = [
            ident
            for (ident,) in self.conn.execute(
                "SELECT id FROM core.competition_seasons WHERE season_id=%s AND archive_key IS NOT NULL AND NOT id = ANY(%s)",
                (start, list(editions.values())),
            ).fetchall()
        ]
        if gone:
            self.conn.execute("DELETE FROM core.rounds WHERE competition_season_id = ANY(%s)", (gone,))
            changed += self.conn.execute("DELETE FROM core.competition_seasons WHERE id = ANY(%s)", (gone,)).rowcount
        # What the season already holds, read once: a re-import writes only what differs (the
        # archives rarely change; rewriting them all saturated the base for hours).
        rounds = {
            (edition, name): ident
            for edition, name, ident in self.conn.execute(
                "SELECT competition_season_id, name, id FROM core.rounds WHERE competition_season_id = ANY(%s)", (list(editions.values()),)
            ).fetchall()
        }
        stored, stored_goals = {}, defaultdict(list)
        written = 0
        for position, match in enumerate(matches):
            edition_id = editions[match["competitionId"]]
            row = match_row(match)
            home = self.team(match["team1"], match.get("country")) if match.get("team1") else None
            away = self.team(match["team2"], match.get("country")) if match.get("team2") else None
            round_id = None
            if match.get("round"):
                round_id = rounds.get((edition_id, match["round"]))
                if round_id is None:
                    round_id = rounds[(edition_id, match["round"])] = self.conn.execute(
                        """INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s)
                           ON CONFLICT (competition_season_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id""",
                        (edition_id, match["round"]),
                    ).fetchone()[0]
            values = dict(row, competition_season_id=edition_id, season_id=start, round_id=round_id,
                          match_date=match.get("date") or None, date_unverified=bool(match.get("dateNote")) or None,
                          home_team_id=home, away_team_id=away, archive_key=match["key"], archive_position=position,
                          home_team_name=match.get("team1") or None, away_team_name=match.get("team2") or None,
                          source=provider_of(match))
            columns = list(values)
            if not stored and written == 0:
                stored.update(self._stored_matches(start, columns))
                # Archive matches only: after LAST_ARCHIVE_SEASON the season also holds PitchAPI's goals.
                for match_id, *goal in self.conn.execute(
                    f"SELECT e.match_id, {', '.join(f'e.{c}::text' for c in GOAL_COLUMNS)} FROM core.match_events e "
                    "JOIN core.matches m ON m.id = e.match_id AND m.season_id = e.season_id AND m.archive_key IS NOT NULL "
                    "WHERE e.season_id=%s AND e.event_type='goal' ORDER BY e.match_id, e.seq",
                    (start,),
                ).fetchall():
                    stored_goals[match_id].append(tuple(goal))
            goals = []
            for seq, goal in enumerate(match.get("goals") or []):
                minute, added = _minute(goal.get("minute"))
                score = _pair(goal.get("score")) or [None, None]
                goals.append(({"home": home, "away": away}.get(goal.get("side")), seq, minute, added, goal.get("player") or None,
                              score[0], score[1], str(goal["minute"]) if goal.get("minute") not in (None, "") else None,
                              bool(goal.get("scoreDisagreement")) or None))
            known = stored.get(match["key"])
            if known is not None and known[1] == tuple(_pg_text(values[c]) for c in columns):
                mid = known[0]
            else:
                mid = self.conn.execute(
                    f"""INSERT INTO core.matches({", ".join(columns)}) VALUES ({", ".join(["%s"] * len(columns))})
                        ON CONFLICT (season_id, archive_key) WHERE archive_key IS NOT NULL DO UPDATE SET
                        {", ".join(f"{c}=EXCLUDED.{c}" for c in columns if c not in ("season_id", "archive_key"))},
                        revision=core.matches.revision+1, updated_at=now() RETURNING id""",
                    [values[c] for c in columns],
                ).fetchone()[0]
                changed += 1
            if stored_goals.get(mid, []) != [tuple(_pg_text(v) for v in goal) for goal in goals]:
                self.conn.execute("DELETE FROM core.match_events WHERE season_id=%s AND match_id=%s", (start, mid))
                for goal in goals:
                    self.conn.execute(
                        f"""INSERT INTO core.match_events(season_id, match_id, event_type, {', '.join(GOAL_COLUMNS)})
                            VALUES (%s,%s,'goal',{', '.join(['%s'] * len(GOAL_COLUMNS))})""",
                        (start, mid, *goal),
                    )
                changed += 1
            written += 1
        if changed:
            self.conn.execute(
                """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('archive_season', %s)
                   ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
                (start,),
            )
        return written

    def _stored_matches(self, season, columns):
        """{archive key: (match id, the columns as PostgreSQL prints them)} of a season."""
        return {
            key: (ident, tuple(rest))
            for key, ident, *rest in self.conn.execute(
                f"SELECT archive_key, id, {', '.join(f'{c}::text' for c in columns)} FROM core.matches "
                "WHERE season_id=%s AND archive_key IS NOT NULL",
                (season,),
            ).fetchall()
        }


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


def record_sources(conn, results_index, goals_index):
    entries = []
    if results_index:
        src = results_index["source"]
        entries.append(("results", src))
        entries += [(f"results/{a['name']}", a) for a in src.get("additionalSources", [])]
    if goals_index:
        entries.append(("goals", goals_index["source"]))
    for position, (key, src) in enumerate(entries):
        conn.execute(
            """INSERT INTO core.source_revisions(source, name, url, license, revision, archive_sha256, coverage, position, retrieved_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,now())
               ON CONFLICT (source) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, license=EXCLUDED.license,
                 revision=EXCLUDED.revision, archive_sha256=EXCLUDED.archive_sha256, coverage=EXCLUDED.coverage,
                 position=EXCLUDED.position, retrieved_at=now()""",
            (re.sub(r"[^a-z0-9_./-]", "-", key.lower())[:80], src.get("name") or key, src.get("url"), src.get("license"),
             src.get("revision"), src.get("archiveSha256"), src.get("coverage"), position),
        )


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


def run(conn, sources, seasons=None):
    """Import every archive season (or the given labels); returns {season: matches}."""
    out = {}
    with tempfile.TemporaryDirectory(prefix="vega-archives-") as work:
        if str(sources).startswith("s3://"):
            sources = download(str(sources), Path(work) / "sources")
        results_dir, goals_dir = build_sources(sources, work)
        results_index = json.loads((results_dir / "index.json").read_text(encoding="utf-8"))
        goals_index = json.loads((goals_dir / "index.json").read_text(encoding="utf-8")) if goals_dir else None
        files = {}
        for kind, index, base in (("results", results_index, results_dir), ("goals", goals_index, goals_dir)):
            for entry in (index or {}).get("seasons", []):
                files.setdefault(entry["id"], {})[kind] = base / Path(entry["path"]).name
        with conn.transaction():
            record_sources(conn, results_index, goals_index)
        loader = Loader(conn)
        provider_of = provider_for(results_index)
        for label in sorted(files):
            if seasons and label not in seasons:
                continue
            data = edition(files[label].get("results"), files[label].get("goals"))
            with conn.transaction():
                out[label] = loader.season(label, data, provider_of)
            # One line per season as it lands: the import runs for hours.
            print(f"season={label} matches={out[label]}", flush=True)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", required=True)
    parser.add_argument("--seasons", help="comma-separated labels (default: every archive season)")
    args = parser.parse_args(argv)
    dsn = os.environ.get("V2_DATABASE_URL")
    if not dsn:
        print("V2_DATABASE_URL is required", file=sys.stderr)
        return 2
    from .worker import connect

    conn = connect(dsn)
    done = run(conn, args.sources, set(args.seasons.split(",")) if args.seasons else None)
    print(f"archives seasons={len(done)} matches={sum(done.values())}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
