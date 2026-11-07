"""Typed application read models. Publication is owned by rematerialize's transaction."""
import hashlib
import json
import os
import re
from pathlib import Path
from psycopg import sql
from build_dashboard_data import PLAYER_METRICS, EXTRA_PLAYER_METRICS, ATTEMPTED_METRICS
from player_rollups import refresh_player_rollups

ROOT = Path(__file__).resolve().parents[2]

def snake(value):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()

METRIC_FIELDS = list(dict.fromkeys([*PLAYER_METRICS, *EXTRA_PLAYER_METRICS, *ATTEMPTED_METRICS]))
APPEARANCE_TEXT = ['playerId','teamId','team','matchId','leagueId','league','country','season','date','role','positionId']
APPEARANCE_NUMBER = ['rawPitchX','rawPitchY','shirtNumber', *METRIC_FIELDS]
APPEARANCE_BOOL = ['starter','statsReliable','isCaptain']
SHOT_TEXT = ['playerId','playerName','teamId','type','shotType','situation','keeperId','keeperName','period']
SHOT_NUMBER = ['x','y','xg','xgot','minute','goalCrossedY','goalCrossedZ','blockedX','blockedY','minuteAdded']
SHOT_BOOL = ['isGoal','isOwnGoal','isOnTarget','isBlocked','insideBox']
SIDE_TEXT = ['id','name','imageUrl','formation','coach']
SIDE_NUMBER = ['score','xg','shots','shotsOnTarget','possession']
SIDE_BOOL = ['lineupConfirmed']
FIXTURE_TEXT = ['league_id','native_season','day','time_utc','status','round_name','home_team_id','home_name','home_image_url','away_team_id','away_name','away_image_url','league_name','league_image_url']
FIXTURE_NUMBER = ['score_home','score_away','score_penalty_home','score_penalty_away']


def schema_sql():
    def columns(keys, kind): return ','.join(snake(k)+' '+kind for k in keys)
    sides = ','.join(f'{side}_{snake(k)} {kind}' for side in ['home','away'] for keys,kind in [(SIDE_TEXT,'text'),(SIDE_NUMBER,'double precision'),(SIDE_BOOL,'boolean')] for k in keys)
    return f"""-- Backend-owned relational models. Original migration/import tables stay untouched.
CREATE SCHEMA IF NOT EXISTS statarena_app;
CREATE TABLE IF NOT EXISTS statarena_app.publications(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),generation bigint NOT NULL DEFAULT 0,schema_version integer NOT NULL DEFAULT 1,published_at timestamptz NOT NULL DEFAULT now());
INSERT INTO statarena_app.publications(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS statarena_app.partitions(season text NOT NULL,league_id text NOT NULL,source_digest text NOT NULL,source text,retrieved_at text,rating_source text,ranking_available boolean,start_date text,end_date text,published_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(season,league_id));
CREATE TABLE IF NOT EXISTS statarena_app.partition_counts(season text NOT NULL,league_id text NOT NULL,metric_key text NOT NULL,value double precision,PRIMARY KEY(season,league_id,metric_key),FOREIGN KEY(season,league_id) REFERENCES statarena_app.partitions ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS statarena_app.partition_notes(season text NOT NULL,league_id text NOT NULL,ordinal integer NOT NULL,note text NOT NULL,PRIMARY KEY(season,league_id,ordinal),FOREIGN KEY(season,league_id) REFERENCES statarena_app.partitions ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS statarena_app.competitions(id text PRIMARY KEY,name text,country text,provider_country text,image_url text,latest_season text NOT NULL);
CREATE TABLE IF NOT EXISTS statarena_app.competition_seasons(competition_id text REFERENCES statarena_app.competitions,season text NOT NULL,sample_matches integer NOT NULL DEFAULT 0,PRIMARY KEY(competition_id,season));
CREATE TABLE IF NOT EXISTS statarena_app.teams(id text PRIMARY KEY,name text,image_url text,country text,latest_season text NOT NULL);
CREATE TABLE IF NOT EXISTS statarena_app.team_seasons(team_id text REFERENCES statarena_app.teams,season text NOT NULL,league_id text NOT NULL,name text,image_url text,sample_matches integer NOT NULL DEFAULT 0,PRIMARY KEY(team_id,season,league_id));
CREATE TABLE IF NOT EXISTS statarena_app.players(id text PRIMARY KEY,player_id text NOT NULL,name text,image_url text);
CREATE INDEX IF NOT EXISTS app_players_provider ON statarena_app.players(player_id);
CREATE TABLE IF NOT EXISTS statarena_app.matches(id text PRIMARY KEY,season text NOT NULL,league_id text NOT NULL,league text,country text,day date,date text,time_utc text,status text,round_name text,has_playoff boolean,detail_collected boolean,referee text,referee_id text,referee_object boolean,stadium text,stadium_id text,stadium_object boolean,{sides});
CREATE INDEX IF NOT EXISTS app_matches_partition ON statarena_app.matches(season,league_id,day,id);
CREATE TABLE IF NOT EXISTS statarena_app.match_coverage(match_id text REFERENCES statarena_app.matches ON DELETE CASCADE,coverage_key text NOT NULL,flag boolean,count integer,PRIMARY KEY(match_id,coverage_key));
CREATE TABLE IF NOT EXISTS statarena_app.match_warnings(match_id text REFERENCES statarena_app.matches ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN('warning','code')),ordinal integer NOT NULL,value text,PRIMARY KEY(match_id,kind,ordinal));
CREATE TABLE IF NOT EXISTS statarena_app.appearances(id text PRIMARY KEY,player_ref text NOT NULL REFERENCES statarena_app.players,ordinal integer NOT NULL DEFAULT 0,position_id_type text,{columns(APPEARANCE_TEXT,'text')},{columns(APPEARANCE_NUMBER,'double precision')},{columns(APPEARANCE_BOOL,'boolean')},FOREIGN KEY(match_id) REFERENCES statarena_app.matches(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS app_appearances_partition ON statarena_app.appearances(season,league_id,match_id,id);
CREATE INDEX IF NOT EXISTS app_appearances_player ON statarena_app.appearances(player_id,season,league_id);
CREATE INDEX IF NOT EXISTS app_appearances_team ON statarena_app.appearances(team_id,season,league_id);
CREATE TABLE IF NOT EXISTS statarena_app.appearance_metrics(appearance_id text REFERENCES statarena_app.appearances ON DELETE CASCADE,metric_key text NOT NULL,value double precision,PRIMARY KEY(appearance_id,metric_key));
CREATE TABLE IF NOT EXISTS statarena_app.shots(id text NOT NULL,match_id text REFERENCES statarena_app.matches ON DELETE CASCADE,ordinal integer NOT NULL DEFAULT 0,{columns(SHOT_TEXT,'text')},{columns(SHOT_NUMBER,'double precision')},{columns(SHOT_BOOL,'boolean')},PRIMARY KEY(match_id,id));
CREATE INDEX IF NOT EXISTS app_shots_player ON statarena_app.shots(player_id,match_id);
CREATE TABLE IF NOT EXISTS statarena_app.team_statistics(match_id text REFERENCES statarena_app.matches ON DELETE CASCADE,metric_key text NOT NULL,ordinal integer NOT NULL,label text,home_value double precision,away_value double precision,home_raw text,away_raw text,home_raw_type text,away_raw_type text,format text,reliable boolean,PRIMARY KEY(match_id,metric_key));
CREATE TABLE IF NOT EXISTS statarena_app.fixtures(id text PRIMARY KEY,season text NOT NULL,day date,{columns([k for k in FIXTURE_TEXT if k!='day'],'text')},{columns(FIXTURE_NUMBER,'double precision')},has_playoff boolean);
CREATE INDEX IF NOT EXISTS app_fixtures_partition ON statarena_app.fixtures(season,league_id,day,id);
CREATE INDEX IF NOT EXISTS app_fixtures_date ON statarena_app.fixtures(day,id);
CREATE INDEX IF NOT EXISTS app_fixtures_home ON statarena_app.fixtures(home_team_id,season);
CREATE INDEX IF NOT EXISTS app_fixtures_away ON statarena_app.fixtures(away_team_id,season);
CREATE TABLE IF NOT EXISTS statarena_app.match_appearance_members(match_id text REFERENCES statarena_app.matches ON DELETE CASCADE,appearance_id text REFERENCES statarena_app.appearances ON DELETE CASCADE,ordinal integer NOT NULL,PRIMARY KEY(match_id,appearance_id));
CREATE TABLE IF NOT EXISTS statarena_app.competition_catalog_seasons(competition_id text REFERENCES statarena_app.competitions,native_season text NOT NULL,ordinal integer NOT NULL,PRIMARY KEY(competition_id,native_season));
CREATE TABLE IF NOT EXISTS statarena_app.assets(url text PRIMARY KEY,path text NOT NULL,content_type text NOT NULL,size bigint NOT NULL,sha256 text NOT NULL,etag text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS statarena_app.workflow_state(workflow text PRIMARY KEY,status text NOT NULL,remaining integer,started_at timestamptz,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS statarena_app.metric_definitions(metric_key text PRIMARY KEY,label text,unit text,decimals integer);
CREATE TABLE IF NOT EXISTS statarena_app.partition_metrics(season text NOT NULL,league_id text NOT NULL,metric_key text REFERENCES statarena_app.metric_definitions,ordinal integer NOT NULL,PRIMARY KEY(season,league_id,metric_key),FOREIGN KEY(season,league_id) REFERENCES statarena_app.partitions ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS statarena_app.publication_jobs(season text NOT NULL,league_id text NOT NULL,changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(season,league_id));
"""


def install_schema(db):
    db.execute((ROOT/'dashboard/backend/migrations/003_relational_core.sql').read_text())
    db.execute((ROOT/'dashboard/backend/migrations/011_appearance_shirt_numbers.sql').read_text())
    db.execute((ROOT/'dashboard/backend/migrations/020_publication_foreign_key_indexes.sql').read_text())
    db.execute((ROOT/'dashboard/backend/migrations/025_player_season_rollups.sql').read_text())
    db.execute((ROOT/'dashboard/backend/migrations/030_player_directory_index.sql').read_text())
    db.execute((ROOT/'dashboard/backend/migrations/031_indexed_performance_cohorts.sql').read_text())


MAX_CORE_WRITE_ROWS = 500
MAX_CORE_WRITE_BYTES = 512 * 1024


def row_batches(rows, *, max_rows=MAX_CORE_WRITE_ROWS, max_bytes=MAX_CORE_WRITE_BYTES):
    """Bound every statement independently of the number of matches in a season."""
    batch, size = [], 0
    for row in rows:
        weight = len(json.dumps(row, ensure_ascii=False, allow_nan=False, default=str).encode())
        if weight > max_bytes:
            raise ValueError("Core row exceeds the bounded publication envelope")
        if batch and (len(batch) >= max_rows or size + weight > max_bytes):
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += weight
    if batch:
        yield batch


def _many(db, table, rows, update=True):
    for batch in row_batches(rows):
        _many_batch(db, table, batch, update=update)


def _many_batch(db, table, rows, update=True):
    if not rows: return
    keys = list(rows[0]); columns = sql.SQL(',').join(map(sql.Identifier,keys))
    # Bounded multi-row INSERT needs no scratch table, bulk transaction or COPY
    # transport. It applies the same target constraints and conflict policy.
    maximum = max(1, 60000 // len(keys))
    if len(rows) > maximum:
        for start in range(0, len(rows), maximum):
            _many_batch(db, table, rows[start:start + maximum], update=update)
        return
    values = sql.SQL('(') + sql.SQL(',').join(sql.Placeholder() for _ in keys) + sql.SQL(')')
    statement = sql.SQL('INSERT INTO statarena_app.{} ({}) VALUES {}').format(
        sql.Identifier(table), columns, sql.SQL(',').join(values for _ in rows))
    if update:
        statement += sql.SQL(' ON CONFLICT DO NOTHING')
    db.execute(statement, [r.get(k) for r in rows for k in keys])


def _finite(value):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) else None


def _identity(value):
    return (value.get('name'),value.get('id'),True) if isinstance(value,dict) else (value,None,False)


def publication_digest(snapshot):
    encoded = json.dumps(snapshot,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    return hashlib.sha256(b'statarena-core-011\0' + encoded.encode()).hexdigest()


def _partition_metadata(db, season, league_id, digest, meta, *, update=False):
    if update:
        db.execute('''UPDATE statarena_app.partitions SET source_digest=%s,source=%s,retrieved_at=%s,
            rating_source=%s,ranking_available=%s,start_date=%s,end_date=%s,published_at=clock_timestamp()
            WHERE season=%s AND league_id=%s''',
            (digest,meta.get('source'),meta.get('retrievedAt'),meta.get('ratingSource'),
             meta.get('rankingAvailable'),meta.get('startDate'),meta.get('endDate'),season,league_id))
    else:
        _many(db,'partitions',[dict(season=season,league_id=league_id,source_digest=digest,source=meta.get('source'),retrieved_at=meta.get('retrievedAt'),rating_source=meta.get('ratingSource'),ranking_available=meta.get('rankingAvailable'),start_date=meta.get('startDate'),end_date=meta.get('endDate'))])
    _many(db,'partition_counts',[dict(season=season,league_id=league_id,metric_key=k,value=v) for k,v in meta.items() if isinstance(v,(int,float)) and not isinstance(v,bool)])
    _many(db,'partition_notes',[dict(season=season,league_id=league_id,ordinal=i,note=str(n)) for i,n in enumerate(meta.get('notes') or [])])


def _publish_full_snapshot(db, season, league_id, snapshot, *, metadata_only=False):
    """Caller owns transaction + ingestion lease and proves facts unchanged for metadata_only."""
    digest = publication_digest(snapshot)
    prior = db.execute('SELECT source_digest FROM statarena_app.partitions WHERE season=%s AND league_id=%s',(season,league_id)).fetchone()
    if prior and prior[0] == digest: return 0
    meta=snapshot.get('meta') or {}
    if prior and metadata_only:
        # Never delete the partition row: its cascades include published metadata.
        # The caller has compared all facts, identities, list orders and metric definitions.
        db.execute('DELETE FROM statarena_app.partition_counts WHERE season=%s AND league_id=%s',(season,league_id))
        db.execute('DELETE FROM statarena_app.partition_notes WHERE season=%s AND league_id=%s',(season,league_id))
        _partition_metadata(db, season, league_id, digest, meta, update=True)
        refresh_player_rollups(db, season, league_id)
        db.execute('UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()')
        return 1
    db.execute('DELETE FROM statarena_app.matches WHERE season=%s AND league_id=%s',(season,league_id))
    db.execute('DELETE FROM statarena_app.fixtures WHERE season=%s AND league_id=%s',(season,league_id))
    db.execute('DELETE FROM statarena_app.partitions WHERE season=%s AND league_id=%s',(season,league_id))
    _partition_metadata(db, season, league_id, digest, meta)
    competitions = {c['id']:c for c in snapshot.get('competitions') or []}
    for m in snapshot.get('matches') or []: competitions.setdefault(m.get('leagueId') or league_id,dict(id=m.get('leagueId') or league_id,name=m.get('league'),country=m.get('country')))
    for c in competitions.values():
        db.execute('INSERT INTO statarena_app.competitions(id,name,country,provider_country,image_url,latest_season) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET name=coalesce(excluded.name,statarena_app.competitions.name),country=coalesce(excluded.country,statarena_app.competitions.country),provider_country=coalesce(excluded.provider_country,statarena_app.competitions.provider_country),image_url=coalesce(excluded.image_url,statarena_app.competitions.image_url),latest_season=excluded.latest_season WHERE excluded.latest_season>=statarena_app.competitions.latest_season',(c['id'],c.get('name'),c.get('country'),c.get('providerCountry'),c.get('imageUrl'),season))
        db.execute('INSERT INTO statarena_app.competition_seasons(competition_id,season,sample_matches) VALUES(%s,%s,%s) ON CONFLICT(competition_id,season) DO UPDATE SET sample_matches=excluded.sample_matches',(c['id'],season,c.get('sampleMatches') or 0))
    teams={t['id']:t for t in snapshot.get('teams') or []}
    for m in snapshot.get('matches') or []:
        for side in ['home','away']:
            t=m.get(side) or {}
            if t.get('id'): teams.setdefault(t['id'],t)
    for t in teams.values():
        db.execute('INSERT INTO statarena_app.teams(id,name,image_url,country,latest_season) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET name=coalesce(excluded.name,statarena_app.teams.name),image_url=coalesce(excluded.image_url,statarena_app.teams.image_url),country=coalesce(excluded.country,statarena_app.teams.country),latest_season=excluded.latest_season WHERE excluded.latest_season>=statarena_app.teams.latest_season',(t['id'],t.get('name'),t.get('imageUrl'),t.get('country'),season))
        db.execute('INSERT INTO statarena_app.team_seasons(team_id,season,league_id,name,image_url,sample_matches) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(team_id,season,league_id) DO UPDATE SET name=excluded.name,image_url=excluded.image_url,sample_matches=excluded.sample_matches',(t['id'],season,league_id,t.get('name'),t.get('imageUrl'),t.get('sampleMatches') or 0))
    matches=[]; shots=[]; statistics=[]; coverage=[]; warnings=[]
    for m in snapshot.get('matches') or []:
        referee,referee_id,referee_object=_identity(m.get('referee'));stadium,stadium_id,stadium_object=_identity(m.get('stadium'))
        row=dict(id=m['id'],season=season,league_id=league_id,league=m.get('league'),country=m.get('country'),day=m.get('date'),date=m.get('date'),time_utc=m.get('timeUtc'),status=m.get('status'),round_name=None if m.get('roundName') is None else str(m['roundName']),has_playoff=m.get('hasPlayoff'),detail_collected=m.get('detailCollected'),referee=referee,referee_id=referee_id,referee_object=referee_object,stadium=stadium,stadium_id=stadium_id,stadium_object=stadium_object)
        for side in ['home','away']:
            t=m.get(side) or {}
            for k in SIDE_TEXT+SIDE_NUMBER+SIDE_BOOL: row[side+'_'+snake(k)]=t.get(k)
        matches.append(row)
        for k,v in (m.get('coverage') or {}).items(): coverage.append(dict(match_id=m['id'],coverage_key=k,flag=v if isinstance(v,bool) else None,count=v if isinstance(v,int) and not isinstance(v,bool) else None))
        for kind,key in [('warning','warnings'),('code','warningCodes')]:
            warnings.extend(dict(match_id=m['id'],kind=kind,ordinal=i,value=v) for i,v in enumerate(m.get(key) or []))
        for ordinal,s in enumerate(m.get('shots') or []):
            shots.append(dict(id=s['id'],match_id=m['id'],ordinal=ordinal,**{snake(k):s.get(k) for k in SHOT_TEXT+SHOT_NUMBER+SHOT_BOOL}))
        for i,s in enumerate(m.get('stats') or []):
            statistics.append(dict(match_id=m['id'],metric_key=s['key'],ordinal=i,label=s.get('label'),home_value=s.get('home'),away_value=s.get('away'),home_raw=None if s.get('homeRaw') is None else str(s['homeRaw']),away_raw=None if s.get('awayRaw') is None else str(s['awayRaw']),home_raw_type=type(s.get('homeRaw')).__name__,away_raw_type=type(s.get('awayRaw')).__name__,format=s.get('format'),reliable=s.get('reliable')))
    _many(db,'matches',matches); _many(db,'match_coverage',coverage);_many(db,'match_warnings',warnings);_many(db,'shots',shots);_many(db,'team_statistics',statistics)
    appearances=[]; extras=[]; identities=[]; shirts=[]
    reserved={'id','name','imageUrl','playerRef',*APPEARANCE_TEXT,*APPEARANCE_NUMBER,*APPEARANCE_BOOL}
    for ordinal,p in enumerate(snapshot.get('appearances') or []):
        identity=dict(playerId=p['playerId'],name=p.get('name'),imageUrl=p.get('imageUrl'))
        ref=p.get('playerRef') or p['playerId']+':'+hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()[:16]
        identities.append(dict(id=ref,player_id=p['playerId'],name=p.get('name'),image_url=p.get('imageUrl')))
        row=dict(id=p['id'],player_ref=ref,ordinal=ordinal,position_id_type=type(p.get('positionId')).__name__,**{snake(k):p.get(k) for k in APPEARANCE_TEXT+APPEARANCE_NUMBER+APPEARANCE_BOOL})
        row['season']=season;row['league_id']=league_id
        if row.get('position_id') is not None:row['position_id']=str(row['position_id'])
        jersey = p.get('shirtNumber')
        if jersey is not None and type(jersey) not in (str, int, float, bool):
            raise ValueError('Shirt number must be a native scalar')
        shirts.append(dict(appearance_id=p['id'],value_text=None if jersey is None else str(jersey),value_type=type(jersey).__name__))
        row['shirt_number'] = _finite(jersey)
        appearances.append(row)
        extras.extend(dict(appearance_id=p['id'],metric_key=k,value=_finite(v)) for k,v in p.items() if k not in reserved and (v is None or isinstance(v,(int,float)) and not isinstance(v,bool)))
    _many(db,'players',identities);_many(db,'appearances',appearances);_many(db,'appearance_metrics',extras)
    _many(db,'appearance_shirt_numbers',shirts)
    _many(db,'match_appearance_members',[dict(match_id=m['id'],appearance_id=pid,ordinal=i) for m in snapshot.get('matches') or [] for i,pid in enumerate(m.get('players') or [a['id'] for a in appearances if a['match_id']==m['id']])])
    _many(db,'competition_catalog_seasons',[dict(competition_id=c['id'],native_season=native,ordinal=i) for c in competitions.values() for i,native in enumerate(c.get('seasons') or [season])])
    fixtures=snapshot.get('fixtures')
    if fixtures is None:
        fixtures=[dict(id=m['id'],league=dict(id=league_id,name=m.get('league')),season=m.get('season') or season,date=m.get('date'),time_utc=m.get('timeUtc'),status=m.get('status'),home_team=dict(id=(m.get('home') or {}).get('id'),name=(m.get('home') or {}).get('name'),image_url=(m.get('home') or {}).get('imageUrl')),away_team=dict(id=(m.get('away') or {}).get('id'),name=(m.get('away') or {}).get('name'),image_url=(m.get('away') or {}).get('imageUrl')),score_home=(m.get('home') or {}).get('score'),score_away=(m.get('away') or {}).get('score'),round_name=m.get('roundName'),has_playoff=m.get('hasPlayoff')) for m in snapshot.get('matches') or []]
    fixture_rows=[]
    for f in fixtures or []:
        l=f.get('league') or {};h=f.get('home_team') or {};a=f.get('away_team') or {}
        fixture_rows.append(dict(id=f['id'],season=season,league_id=l.get('id') or league_id,native_season=f.get('season'),day=f.get('date'),time_utc=f.get('time_utc'),status=f.get('status'),round_name=None if f.get('round_name') is None else str(f['round_name']),home_team_id=h.get('id'),home_name=h.get('name'),home_image_url=h.get('image_url'),away_team_id=a.get('id'),away_name=a.get('name'),away_image_url=a.get('image_url'),league_name=l.get('name'),league_image_url=l.get('image_url'),score_home=f.get('score_home'),score_away=f.get('score_away'),score_penalty_home=f.get('score_penalty_home'),score_penalty_away=f.get('score_penalty_away'),has_playoff=f.get('has_playoff')))
    _many(db,'fixtures',fixture_rows)
    metrics=snapshot.get('metrics') or []
    for i,m in enumerate(metrics):
        db.execute('INSERT INTO statarena_app.metric_definitions(metric_key,label,unit,decimals) VALUES(%s,%s,%s,%s) ON CONFLICT(metric_key) DO UPDATE SET label=excluded.label,unit=excluded.unit,decimals=excluded.decimals',(m['key'],m.get('label'),m.get('unit'),m.get('decimals')))
        _many(db,'partition_metrics',[dict(season=season,league_id=league_id,metric_key=m['key'],ordinal=i)])
    refresh_player_rollups(db, season, league_id)
    db.execute('UPDATE statarena_app.publications SET generation=generation+1,published_at=clock_timestamp()')
    return 1


def publish_snapshot(db, season, league_id, snapshot, *, metadata_only=False, previous_state=None):
    """Publish one atomic scope; the legacy path remains an explicit rollback option."""
    mode = os.environ.get("STATARENA_INCREMENTAL_CORE", "1")
    if mode not in {"0", "1"}:
        raise ValueError("STATARENA_INCREMENTAL_CORE must be 0 or 1")
    if metadata_only or mode == "0":
        return _publish_full_snapshot(db, season, league_id, snapshot, metadata_only=metadata_only)
    from relational_core_delta import publish_incremental

    return publish_incremental(db, season, league_id, snapshot, previous_state=previous_state)
