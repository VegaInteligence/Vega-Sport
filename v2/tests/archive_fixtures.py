"""Synthetic archive sources laid out as main's data/sources (OpenFootball + scorers)."""

import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import zipfile

PREMIER_LEAGUE = {"name": "English Premier League 2015/16", "matches": [
    {"round": "Matchday 1", "date": "2015-08-08", "team1": "Arsenal FC", "team2": "West Ham United FC", "score": {"ft": [0, 2]}},
    {"round": "Matchday 1", "date": "2015-08-08", "team1": "Leicester City FC", "team2": "Sunderland AFC", "score": {"ft": [4, 2]}},
    {"round": "Matchday 2", "date": "2015-08-15", "team1": "Chelsea FC", "team2": "Leicester City FC",
     "score": {"ft": [1, 1], "et": [2, 2], "p": [4, 3]}},
]}
GOALS = [
    # season, date, game, scorer, team, minute, home, away
    ("2015-2016", "2015-08-08", "Arsenal vs. West Ham United 0:2", "Cheikhou Kouyaté", "West Ham United", "43", "0", "1"),
    ("2015-2016", "2015-08-08", "Arsenal vs. West Ham United 0:2", "Mauro Zárate", "West Ham United", "57", "0", "2"),
    ("2015-2016", "2015-08-08", "Leicester City vs. Sunderland 4:2", "Jamie Vardy", "Leicester City", "11", "1", "0"),
    ("2015-2016", "2015-08-09", "Everton vs. Watford 2:2", "Ross Barkley", "Everton", "45+2", "1", "1"),
]
# A season PitchAPI also collects: a league it has (once its edition exists) and a cup it never has.
RECENT_GOALS = {
    "eng-premier-league": [
        ("2021-2022", "2021-08-14", "Manchester United vs. Leeds United 2:0", "Bruno Fernandes", "Manchester United", "30", "1", "0"),
        ("2021-2022", "2021-08-14", "Manchester United vs. Leeds United 2:0", "Mason Greenwood", "Manchester United", "52", "2", "0"),
    ],
    "eng-fa-cup": [
        ("2021-2022", "2022-01-08", "Chelsea vs. Chesterfield 1:0", "Timo Werner", "Chelsea", "6", "1", "0"),
    ],
}


def make_sources(root, goals=None):
    """The sources folder; `goals` is {goal competition: rows} (default: the 2015/2016 league)."""
    root = Path(root)
    (root / "openfootball").mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(root / "openfootball/football-json-test.zip", "w") as z:
        z.writestr("football.json-test/2015-16/en.1.json", json.dumps(PREMIER_LEAGUE))
        z.writestr("football.json-test/2015-16/xx.1.json", json.dumps(PREMIER_LEAGUE))  # unknown country: skipped
        z.writestr("football.json-test/2025-26/en.1.json", json.dumps(PREMIER_LEAGUE))  # after the results archive's last season: skipped
    folder = root / "worldclub/goals"
    folder.mkdir(parents=True, exist_ok=True)
    files = []
    for competition, rows in sorted((goals or {"eng-premier-league": GOALS}).items()):
        text = io.StringIO()
        writer = csv.writer(text)
        writer.writerow(["season", "date", "game", "scoring_player", "scoring_team", "time", "GH", "GA"])
        writer.writerows(rows)
        raw = text.getvalue().encode("utf-8")
        (folder / f"{competition}.csv.gz").write_bytes(gzip.compress(raw, mtime=0))
        files.append({"name": f"{competition}.csv", "sha256": hashlib.sha256(raw).hexdigest()})
    (folder / "manifest.json").write_text(json.dumps({
        "repository": "https://github.com/schochastics/football-data", "revision": "test", "files": files,
    }))
    return root
