"""Exercise the production daily path across the earliest partially observed award year on private PG18."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
from psycopg import sql

here = Path(__file__).resolve().parent
repo = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(repo / 'backend'))
from vega import models, power, store, worker

sha = '8018e0836ca0f32e8b2eb51fc2847154abff7f13'
hashes = {}
for name in ('models', 'power', 'worker', 'store'):
    path = f'backend/vega/{name}.py'
    content = subprocess.check_output(['git', '-C', str(repo), 'show', f'{sha}:{path}'])
    assert (repo/path).read_bytes() == content
    hashes[path] = hashlib.sha256(content).hexdigest()
port = subprocess.check_output(['docker', '--context', 'colima', 'port', 'vega-vi27-audit-ci-pg18', '5432/tcp'], text=True).strip()
assert port == '127.0.0.1:55439'
base = 'postgresql://postgres@127.0.0.1:55439/'
dbname = 'vega_v2_audit_first_award_' + uuid.uuid4().hex
admin = psycopg.connect(base+'postgres', autocommit=True)
admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(dbname)))
db = store.connect_local(base+dbname)
try:
    store.migrate(db)
    book = store.Store(db)
    with db.transaction():
        for year in (2020, 2021):
            book.season(f'{year}/{year+1}')
        db.execute("INSERT INTO core.competitions(id,name) VALUES(1,'Audit first season')")
        db.execute("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2021,'2021/22')")
        db.execute("INSERT INTO core.teams(id,name) VALUES(1,'Home'),(2,'Away')")
        db.execute("INSERT INTO core.players(id,name) VALUES(1,'Forward')")
    power.refresh_players(db, 2020)
    def count_by_year(q):
        return {int(y):int(n) for y,n in db.execute(q).fetchall()}
    def snapshot():
        return dict(grades=count_by_year("SELECT award_season,count(*) FROM agg.player_match_grades GROUP BY 1"),
                    reference_rows=count_by_year("SELECT ref_season,sum(matches) FROM agg.match_grade_roles GROUP BY 1"),
                    by_run=db.execute("SELECT id,season_id,method_version,matches,players FROM agg.power_runs WHERE kind='players' AND status='published' ORDER BY season_id").fetchall(),
                    previous_year_changed=power.previous_year_changed(db,2021),
                    stale=power.stale_rankings(db))
    before = snapshot()
    with db.transaction():
        db.execute("""INSERT INTO core.matches(id,competition_season_id,season_id,match_date,kickoff_at,status,source,home_team_id,away_team_id,home_score,away_score)
            SELECT i,1,2021,d,d::timestamp AT TIME ZONE 'UTC','finished','pitchapi',1,2,2,0
            FROM generate_series(1,100) AS i CROSS JOIN LATERAL (SELECT date '2021-06-11'+i AS d) t""")
        db.execute("""INSERT INTO core.match_coverage(match_id,season_id,player_stats)
            SELECT id,season_id,'ok' FROM core.matches""")
        db.execute("""INSERT INTO core.player_match_stats(match_id,season_id,team_id,player_id,position_id,minutes_played,shots_on_target,touches)
            SELECT id,season_id,1,1,105,90,id%5,30+id%6 FROM core.matches""")
    due_before=worker.due_seasons(db,datetime.now(timezone.utc)+timedelta(hours=9))
    models.refresh_daily(db,2021)
    daily=snapshot()
    assert before['by_run'][0][3:]==(0,0)
    assert due_before==[2021] and daily['grades']=={2021:50} and not daily['previous_year_changed'] and 2020 not in daily['stale']
    with db.transaction():
        db.execute("UPDATE agg.power_runs SET method_version='historical-audit-fixture' WHERE kind='players' AND season_id=2020 AND status='published'")
    stale=power.stale_rankings(db)
    assert stale==[2020]
    for year in stale:
        power.refresh_players(db,year)
    updated=snapshot()
    assert updated['grades']=={2020:50,2021:50} and updated['reference_rows'][2020]==50
    doc=dict(code=sha,source_sha256=hashes,pg=db.execute("SHOW server_version").fetchone()[0],initial=before,due_before_daily=due_before,after_normal_daily=daily,method_change_due=stale,after_method_recompute=updated)
    (here/'result.json').write_text(json.dumps(doc,indent=2,default=str)+'\n')
    print(json.dumps(doc,default=str))
finally:
    db.close()
    admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(dbname)))
    admin.close()
