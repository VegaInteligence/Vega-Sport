"""Seed a disposable v2 database with one real match (v2/tests/fixtures/match_m_08LEIz,
the provider's own responses of every family), written through the collector's path:
normalize_family, then Store, as the worker does. The match-family reads must give the
same bodies back (test/match-families.test.mjs)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from vega_v2.normalize import normalize_family
from vega_v2.pilot import DETAILS
from vega_v2.store import Store, connect_local, migrate

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "match_m_08LEIz"
KEY = "m_08LEIz"
FILES = {"": "match", "/lineups": "lineups", "/events": "events", "/shots": "shots", "/stats": "stats", "/players": "players",
         "/players/halves": "players_halves", "/momentum": "momentum", "/advanced": "advanced", "/advanced/players": "advanced_players",
         "/advanced/network": "advanced_network", "/heatmaps": "heatmaps", "/h2h": "h2h"}


def load(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def main(dsn):
    db = connect_local(dsn)
    db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
    migrate(db)
    store = Store(db)
    calendar = load("date")
    match = calendar["matches"][0]
    with db.transaction():
        store.season("2026/2027")
        league = dict(match["league"], country_code="RUS", seasons=[match["season"]], season=match["season"])
        store.save_references(normalize_family("league", league), family="league")
        edition, _ = store.edition(store.resolve("competition", match["league"]["id"]), match["season"])
        store.save_matches(normalize_family("summary", load("match")["data"], match_id=KEY), edition, family="summary")
    mid = store.resolve("match", KEY)
    for family, suffix, parser in DETAILS:
        if family == "summary":
            continue
        store.save_family(mid, family, normalize_family(parser, load(FILES[suffix])["data"], match_id=KEY))
    db.close()


if __name__ == "__main__":
    main(sys.argv[1])
