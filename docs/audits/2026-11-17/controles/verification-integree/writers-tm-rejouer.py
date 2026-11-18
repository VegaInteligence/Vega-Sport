"""Reproduce the observations against the frozen application and a new local database."""
from argparse import ArgumentParser
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

import psycopg
from psycopg.sql import Identifier, SQL

cli = ArgumentParser()
cli.add_argument("backend", type=Path)
cli.add_argument("revision")
cli.add_argument("dsn")
cli.add_argument("recu", type=Path)
args = cli.parse_args()
backend = args.backend.resolve()
target = urlsplit(args.dsn)
dbname = target.path.removeprefix("/")
if target.hostname != "127.0.0.1" or target.query or not re.fullmatch(r"vega_v2_tm_[0-9a-f]+", dbname):
    cli.error("dedicated loopback vega_v2_tm database required")
sys.path.insert(0, str(backend))
from vega import transfermarkt as tm
from vega.store import connect_local, migrate

script = Path(__file__).resolve().with_name("HTTP.mjs")
clock = datetime(2026, 11, 18, 13, tzinfo=timezone.utc)
player, provider_player, public = 987654, "912345", "p_v0987654"
fields = {"values": "history", "injuries": "injuries", "squad": "squad"}
units = {"values": provider_player, "injuries": provider_player, "squad": "47771:2025"}
paths = {
    "values":(f"/player/{provider_player}/market-value-history",()),
    "injuries":(f"/player/{provider_player}/injury",()),
    "squad":("/club/47771/squad",(("season","2025"),))
}
public_paths = {"values":f"/api/player-market-values?id={public}", "injuries":f"/api/players/{public}/injuries"}
full = {
    "values": [
        {"marketValue":{"determined":"2025-01-01T00:00:00Z","value":1_000_000},"clubId":"47771"},
        {"marketValue":{"determined":"2025-02-01T00:00:00Z","value":2_000_000},"clubId":"47771"}
    ],
    "injuries": [
        {"name":"Knee injury","start":"2024-08-01","end":"2024-08-11","seasonId":2024},
        {"name":"Muscle injury","start":"2025-05-01","end":"2025-05-14","seasonId":2024}
    ],
    "squad": [{"playerId":"73451","shirtNumber":8}, {"playerId":"73452","shirtNumber":19}],
}
checks = []
def expect(case, key, actual, expected):
    checks.append({"case":case,"property":key,"actual":actual,"expected":expected})
    if expected != actual:
        raise AssertionError(f"{case} {key} expected {expected!r}, observed {actual!r}")

def call_http(kind, baseline=""):
    route = public_paths.get(kind)
    if route is None:
        return None
    proc = subprocess.run(["node",str(script),str(backend),args.dsn,route,baseline],
                          check=True,capture_output=True,text=True,timeout=20)
    return json.loads(proc.stdout)

class Provider:
    def __init__(self, kind, data, raw=None):
        self.kind = kind
        self.data = data
        self.raw = raw
        self.calls = []
    def __call__(self,path,params=()):
        self.calls.append([path,[list(p) for p in params]])
        if (path,tuple(params)) != paths[self.kind]:
            raise AssertionError("unexpected provider request")
        body = self.raw if self.raw is not None else json.dumps({"success":True,"data":self.data}).encode()
        return 200, {}, body

def importer(conn, kind, data, raw=None):
    provider = Provider(kind,data,raw)
    instance = tm.Reader(conn,provider,interval=0,jitter=0,sleep=lambda _:None,clock=lambda:clock,log=lambda *a,**k:None)
    outcome = instance.read(kind,[(units[kind],1)])
    expect(kind,"provider_calls",len(provider.calls),1)
    return {"outcome":outcome,"requests":provider.calls,"http_status":200,"data":data,
            "raw_text":raw.decode() if raw else None}

def q(db, kind):
    row = db.execute("""SELECT last_http_status,error_code,rows_written,read_at IS NOT NULL,attempts
                        FROM ops.transfermarkt_reads WHERE kind=%s AND provider_key=%s""",(kind,units[kind])).fetchone()
    return dict(zip(("http","error","written","read","attempts"),row,strict=True))

def persisted(db, kind):
    if kind=="values":
        return db.execute("""SELECT valued_at::text,value_eur::integer FROM core.player_market_values
                             WHERE player_id=%s AND source='transfermarkt' ORDER BY valued_at""",(player,)).fetchall()
    if kind=="injuries":
        return db.execute("""SELECT start_date::text,label FROM core.player_injuries
                             WHERE player_id=%s AND source='transfermarkt' ORDER BY start_date""",(player,)).fetchall()
    return db.execute("""SELECT player_key,shirt_number FROM core.provider_squads
                         WHERE provider='transfermarkt' AND club_key='47771' AND season_year=2025
                         ORDER BY player_key""").fetchall()

def foreign_data(db,kind):
    if kind=="values":
        return db.execute("SELECT count(*) FROM core.player_market_values WHERE player_id=%s AND source='pitchapi'",(player,)).fetchone()[0]
    if kind=="injuries":
        return db.execute("SELECT count(*) FROM core.player_injuries WHERE player_id=%s AND source='pitchapi'",(player,)).fetchone()[0]
    return db.execute("SELECT count(*) FROM core.provider_squads WHERE provider='transfermarkt' AND club_key='47771' AND season_year=2024").fetchone()[0]

def shortlist(db):
    return [k for (k,) in db.execute("""SELECT provider_key FROM ops.transfermarkt_reads
            WHERE kind='profile' AND provider_key IN ('73451','73452','73453') ORDER BY provider_key""")]

def seed(db):
    db.execute("INSERT INTO core.players(id,name) VALUES (%s,'Joueur synthétique')",(player,))
    db.execute("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('player','transfermarkt',%s,%s)",(provider_player,player))
    db.execute("INSERT INTO core.teams(id,name) VALUES (71,'Club synthétique un'),(72,'Club synthétique deux')")
    db.execute("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','transfermarkt','47771',71)")
    db.execute("INSERT INTO core.seasons(id,label) VALUES (2025,'2025/2026')")
    db.execute("INSERT INTO core.competitions(id,name) VALUES (71,'Compétition synthétique')")
    db.execute("INSERT INTO core.competition_seasons(id,competition_id,season_id) VALUES (71,71,2025)")
    db.execute("""INSERT INTO core.matches(id,competition_season_id,season_id,match_date,status,home_team_id,away_team_id,home_score,away_score,source)
                  VALUES (71,71,2025,'2025-08-01','finished',71,72,1,0,'pitchapi')""")
    db.execute("""INSERT INTO core.player_market_values(player_id,valued_at,value_eur,source,as_of)
                  VALUES (%s,'2023-01-01',100000,'pitchapi','2023-01-01')""",(player,))
    db.execute("""INSERT INTO core.player_injuries(player_id,label,start_date,source,as_of)
                  VALUES (%s,'Indépendante','2023-01-01','pitchapi','2023-01-01')""",(player,))
    db.execute("""INSERT INTO core.provider_squads(provider,club_key,season_year,player_key,shirt_number,read_on)
                  VALUES ('transfermarkt','47771',2024,'73453',17,'2025-01-01')""")
    for kind,key in units.items():
        db.execute("INSERT INTO ops.transfermarkt_reads(kind,provider_key,priority,next_due_at) VALUES (%s,%s,1,now())",(kind,key))

def observe(db,kind,baseline=""):
    return {"stored":persisted(db,kind),"queue":q(db,kind),"sentinel_untouched":foreign_data(db,kind),
            "http":call_http(kind,baseline)}

def test(db,writer,kind,mode,data,raw):
    case = f"{kind}_{mode}"
    baseline_import = importer(writer,kind,{fields[kind]:full[kind]})
    expect(case,"baseline_outcome",baseline_import["outcome"],"ok")
    before = observe(db,kind)
    expect(case,"initial_rows",len(before["stored"]),2)
    tag = before["http"]["get"]["etag"] if before["http"] else None
    if tag is not None:
        initial_conditional = call_http(kind,tag)["conditional"]
        expect(case,"baseline_revalidation",initial_conditional["status"],304)

    if kind=="squad":
        db.execute("DELETE FROM ops.transfermarkt_reads WHERE kind='profile' AND provider_key IN ('73451','73452','73453')")
        if mode=="truncated":
            enqueue = tm.Reader(writer,Provider(kind,None),log=lambda *a,**k:None)
            enqueue.enqueue(clock)
            expect(case,"prior_queue_candidates",shortlist(db),["73451","73452","73453"])
            db.execute("DELETE FROM ops.transfermarkt_reads WHERE kind='profile' AND provider_key IN ('73451','73453')")

    received = importer(writer,kind,data,raw)
    after = observe(db,kind,tag or "")
    invalid = mode in {"wrong_type","broken_json"}
    partial = mode in {"truncated","invalid_member"}
    last_rows = 2 if invalid else 1 if partial else 2 if kind=="values" else 0
    written = 2 if invalid else 1 if partial else 0
    expect(case,"outcome",received["outcome"],"schema" if invalid else "ok")
    expect(case,"remaining_rows",len(after["stored"]),last_rows)
    expect(case,"reported_writes",after["queue"]["written"],written)
    expect(case,"reported_error",after["queue"]["error"],"SCHEMA_CHANGED" if invalid else None)
    expect(case,"sentinel_untouched",after["sentinel_untouched"],1)
    if after["http"]:
        current,conditional = (after["http"][key] for key in ("get","conditional"))
        expected_status = 404 if invalid and kind=="injuries" else 304 if kind=="values" and not partial else 200
        expect(case,"response_after_prior_etag",conditional["status"],expected_status)
        if current["status"]==200:
            api_count=len(current["body"]["data"]["history" if kind=="values" else "injuries"])
            expect(case,"public_rows",api_count,last_rows)
            expect(case,"etag_rotated",current["etag"]!=tag,expected_status==200)
    if kind=="squad":
        enqueue = tm.Reader(writer,Provider(kind,None),log=lambda *a,**k:None)
        enqueue.enqueue(clock)
        if mode=="truncated":
            expect(case,"preexisting_removed_member_queue",shortlist(db),["73451","73452","73453"])
            db.execute("DELETE FROM ops.transfermarkt_reads WHERE kind='profile' AND provider_key='73452'")
            enqueue.enqueue(clock)
        expect(case,"fresh_profile_candidates",shortlist(db),
               (["73451","73452"] if invalid else ["73451"] if partial else [])+["73453"])
        after["fresh_profile_candidates"] = shortlist(db)
    return {"scenario":case,"initial":baseline_import,"before":before,"response":received,"after":after}

admin_dsn = target._replace(path="/postgres").geturl()
with psycopg.connect(admin_dsn,autocommit=True) as admin:
    admin.execute(SQL("CREATE DATABASE {}").format(Identifier(dbname)))
with connect_local(args.dsn) as database, connect_local(args.dsn) as writer:
    migrate(database)
    seed(database)
    writer.execute("SET ROLE vega_collect")
    expect("setup","collector_role",writer.execute("SELECT current_user").fetchone()[0],"vega_collect")
    postgres = database.execute("SHOW server_version").fetchone()[0]
    migrations = database.execute("SELECT count(*) FROM ops.schema_migrations").fetchone()[0]
    cold = call_http("injuries")
    expect("cold_injuries","status",cold["get"]["status"],404)
    observations=[]
    for kind,field in fields.items():
        first = full[kind][0]
        for mode,data,raw in (
            ("empty",{field:[]},None),
            ("missing_key",{},None),
            ("truncated",{field:[first]},None),
            ("invalid_member",{field:[first,{"unexpected":True}]},None),
            ("wrong_type",{field:{"unexpected":True}},None),
            ("broken_json",None,b'{"success":true,"data":{'),
        ):
            observations.append(test(database,writer,kind,mode,data,raw))

fingerprints = ("vega/transfermarkt.py","api/src/routes/profiles.mjs","api/src/http.mjs",
                "sql/135_player_transfers.sql","sql/116_player_fouls_and_injuries.sql")
receipt = {"revision":args.revision,"synthetic":True,"database":f"PostgreSQL {postgres}",
           "migrations":migrations,"clock":clock.isoformat(),
           "hashes":{path:hashlib.sha256((backend/path).read_bytes()).hexdigest() for path in fingerprints},
           "observations":observations,"assertions":checks}
args.recu.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"revision":args.revision,"postgres":postgres,"migrations":migrations,
                  "scenarios":len(observations),"assertions":len(checks)}))
