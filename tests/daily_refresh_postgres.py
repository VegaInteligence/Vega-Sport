"""Exercise a daily update from queued refresh to the published player row."""
import copy
import datetime as dt
import gzip
import hashlib
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard/scripts"))
from bootstrap_neon import unpack
from neon_ingest import DAILY_MATCH_PRIORITY, claim_job, discover, seed
from neon_materialize import materialize
from neon_store import Store, canonical
from test_dashboard_data import synthetic


class MemoryStore(Store):
    def __init__(self, db, objects):
        self.db, self.objects, self.queue = db, objects, {}
        self.refresh_since = db.execute("select clock_timestamp()").fetchone()[0]

    def json(self, path):
        if path not in self.objects:
            raise FileNotFoundError(path)
        return copy.deepcopy(self.objects[path])

    def put_json(self, path, value, hot=False):
        self.objects[path] = copy.deepcopy(value)
        body = canonical(value).encode()
        if path.endswith(".gz"):
            body = gzip.compress(body, mtime=0)
        sha = hashlib.sha256(body).digest()
        self.db.execute(
            "insert into statarena.objects(path,size,sha256,etag,body,content_type) values(%s,%s,%s,%s,%s,'application/json') on conflict(path) do update set size=excluded.size,sha256=excluded.sha256,etag=excluded.etag,body=excluded.body",
            (path, len(body), sha, hashlib.md5(body).hexdigest(), body),
        )
        return {"path": path, "sha256": sha.hex()}


def main():
    db = psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True)
    db.execute((ROOT / "dashboard/backend/migrations/001_neon.sql").read_text())
    today = dt.datetime.now(dt.timezone.utc).date()
    year, label = str(today.year), f"{today.year}/{today.year + 1}"
    raw, _ = synthetic()
    sample = copy.deepcopy(raw["samples"][0])
    fixture = sample["match"]
    fixture.update(id="m_TEST01", date=str(today), season=year, league={"id": "l_0eg6C9", "name": "MLS"})
    player = sample["players"]["data"][0]
    player["player"].update(id="p_1mZO3B", name="Lionel Messi")
    player["stats"][0]["stats"]["Goals"]["stat"]["value"] = 0
    lineups = sample["lineups"]["data"]
    lineups["home"]["starters"][0]["player_id"] = "p_1mZO3B"
    objects = {
        "computed/dashboard/index.json": {"seasons": [{"id": label, "chunks": []}]},
        "raw/index.json": {"seasons": []},
        "fixture-detail": {"data": fixture},
        "players-before": {"data": [copy.deepcopy(player)]},
        "lineups": {"data": lineups},
        "shots": {"data": sample["shots"]["data"]},
        "stats": {"data": sample["team_stats"]["data"]},
    }
    store = MemoryStore(db, objects)
    db.execute(
        "insert into statarena.fixtures(id,league_id,season,day,status,body) values(%s,%s,%s,%s,'finished',%s)",
        (fixture["id"], "l_0eg6C9", year, today, Jsonb(fixture)),
    )
    for suffix, path in [("", "fixture-detail"), ("/players", "players-before"), ("/lineups", "lineups"), ("/shots", "shots"), ("/stats", "stats")]:
        db.execute(
            "insert into statarena.resources(endpoint,params,status,ref,updated_at) values(%s,'{}',200,%s,now()-interval '1 hour')",
            ("/matches/m_TEST01" + suffix, Jsonb({"path": path})),
        )
    db.execute("insert into statarena.jobs(endpoint,params,priority) values('/matches/m_OLD001','{}',-30000)")
    seed(store, "daily")
    store.flush()
    pending = db.execute("select priority from statarena.jobs where endpoint='/matches/m_TEST01/players' and params='{}'").fetchone()
    assert pending and pending[0] == DAILY_MATCH_PRIORITY
    first = claim_job(store)[0]
    assert first == "/leagues" or first.startswith("/date/")

    db.execute("insert into statarena.dirty_partitions(season,league_id) values(%s,'l_0eg6C9')", (label,))
    materialize(store, max_partitions=1, league_id="l_0eg6C9")

    def published_goal():
        manifest = store.objects["computed/dashboard/index.json"]
        chunk = manifest["seasons"][0]["chunks"][0]
        rows = unpack(store.objects[chunk["path"]]["tables"]["performances"])
        return next(row["goals"] for row in rows if row["playerId"] == "p_1mZO3B")

    assert published_goal() == 0
    player["stats"][0]["stats"]["Goals"]["stat"]["value"] = 1
    store.objects["players-after"] = {"data": [copy.deepcopy(player)]}
    db.execute("update statarena.resources set ref=%s,updated_at=clock_timestamp() where endpoint='/matches/m_TEST01/players' and params='{}'", (Jsonb({"path": "players-after"}),))
    db.execute("delete from statarena.jobs where endpoint='/matches/m_TEST01/players' and params='{}'")
    discover(store, "/matches/m_TEST01/players", [player], "daily")
    store.flush()
    store.enqueue("/matches/m_TEST01/players", force=True)
    store.flush()
    assert db.execute("select count(*) from statarena.jobs where endpoint='/matches/m_TEST01/players' and params='{}'").fetchone()[0] == 0
    materialize(store, max_partitions=1, league_id="l_0eg6C9")
    assert published_goal() == 1
    alias = db.execute("select status from statarena.resources where endpoint='/leagues/l_0eg6C9/matches' and params=%s", (canonical({"season": label, "status": "all"}),)).fetchone()
    assert alias == (200,)
    db.close()
    print(json.dumps({"daily_refresh": "passed", "goal_before": 0, "goal_after": 1, "league": "MLS"}))


if __name__ == "__main__":
    main()
