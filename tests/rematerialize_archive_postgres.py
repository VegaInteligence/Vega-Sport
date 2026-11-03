"""PostgreSQL materialization workflow: stored archive responses to published tables.

Run only through the temporary-local-Postgres runner. No production fixture writes.
"""
import argparse,copy,json,os,sys
from pathlib import Path
from urllib.parse import urlparse
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'dashboard/scripts'),str(ROOT/'tests')]
from daily_refresh_postgres import MemoryStore
from test_dashboard_data import synthetic,metric
from build_dashboard_data import build_snapshot,EXTRA_PLAYER_METRICS,ATTEMPTED_METRICS
from build_dashboard_views import pack_table
from bootstrap_neon import unpack
from neon_materialize import materialize

p=argparse.ArgumentParser();p.add_argument('--report',required=True);a=p.parse_args()
url=os.environ['TEST_DATABASE_URL'];target=urlparse(url)
assert target.hostname=='127.0.0.1' and target.path=='/archive_materialization_e2e', 'Temporary local database required'
report={'setup':'Isolated temporary PostgreSQL 18, actual schema/materializer/normalizer/packing; stored object fixtures implement the same JSON/SQL publication contract. No provider or production writes.','command':'node output/playwright/rematerialization-completion-20261103/run_archive_postgres.mjs <before|after>','expected':'Archived-only and recent responses rebuild enrichment with correct precedence; partial families preserve old data and references.','cases':[],'status':'failed'}
with psycopg.connect(url,autocommit=True) as db:
 db.execute((ROOT/'dashboard/backend/migrations/001_neon.sql').read_text())
 for kind in ['archive-only','fixture-without-summary','recent-precedence','partial-families']:
  case={'name':kind,'checks':[],'status':'failed'};report['cases'].append(case)
  def check(name,passed,actual):
   case['checks'].append({'name':name,'passed':passed,'actual':actual})
   if not passed:raise AssertionError(name+': '+repr(actual))
  try:
   db.execute('TRUNCATE statarena.objects,statarena.shards,statarena.observations,statarena.fixtures,statarena.resources,statarena.dirty_partitions CASCADE')
   raw,catalog=synthetic();sample=copy.deepcopy(raw['samples'][0]);sid='2021/2022';league='l_000001';mid='m_000001'
   sample['season']=sid;fixture=sample['match'];fixture.update(season=sid,date='2022-01-01',time_utc='2022-01-01T12:00:00Z',league={'id':league,'name':'Example'})
   player=sample['players']['data'][0];player['stats'][0]['stats']['Speed']=metric('physical_metrics_topspeed',33.2)
   sample['lineups']['data']['home'].update(coach={'name':'Archived Coach'},confirmed=True)
   sample['lineups']['data']['home']['starters'][0]['is_captain']=True
   shot=sample['shots']['data']['periods'][0]['shots'][0]
   shot.update(event_type='Goal',is_own_goal=False,team_id='t_000001',x=90,y=30,expected_goals=.3,goal_crossed_y=32.2,goal_crossed_z=1.4,minute=25)
   snapshot=build_snapshot({'samples':[sample]},catalog);match=snapshot['matches'][0];appearance=snapshot['appearances'][0]
   old_player={k:v for k,v in appearance.items() if k not in set(EXTRA_PLAYER_METRICS)|set(ATTEMPTED_METRICS)|{'isCaptain','name','imageUrl'}};old_player['playerRef']='p_old'
   old_match={k:v for k,v in match.items() if k not in {'shots','stats','referee','stadium','roundName'}}
   for side in ['home','away']:
    for key in ['coach','lineupConfirmed']:old_match[side].pop(key,None)
   old_shot={k:v for k,v in match['shots'][0].items() if k not in {'goalCrossedY','goalCrossedZ','isBlocked','blockedX','blockedY','insideBox','keeperId','keeperName','minuteAdded','period'}}
   competition={'id':league,'name':'Example','country':'FRA','seasons':[sid]}
   tables={'players':[{'id':'p_old','playerId':appearance['playerId'],'name':'Player','imageUrl':None}],'performances':[old_player],'matches':[old_match],'shots':[{**old_shot,'matchId':mid}],'team_statistics':[{'matchId':mid,'values':match['stats']}],'teams':snapshot['teams'],'competitions':[competition],'fixtures':[fixture]}
   packed={'format':'orion-packed-tables-v1','meta':snapshot['meta'],'metrics':snapshot['metrics'],'tables':{k:pack_table(v) for k,v in tables.items()}}
   documents=[{'id':'archive_doc','metadata':{'fixture':fixture,'season':sid}}]
   objects={'computed/dashboard/index.json':{'seasons':[{'id':sid,'chunks':[{'leagueId':league,'path':'old-packed','competitions':[competition]}]}]},'raw/index.json':{'seasons':[]},'old-packed':packed,'archive-documents':documents}
   refs={}
   for family,key in [('players','players'),('shots','shots'),('lineups','lineups'),('stats','team_stats')]:
    if kind=='partial-families' and family=='players':continue
    objects['archive-'+family]=[{'documentId':'archive_doc','response':{'status':200,'data':sample[key]['data']}}]
    refs[family]={'path':'archive-'+family}
   if kind!='fixture-without-summary':
    objects['archive-match']=[{'documentId':'archive_doc','response':{'status':200,'data':{**fixture,'referee':{'name':'Archive Referee'},'stadium':{'name':'Archive Stadium'},'round_name':'12'}}}];refs['match']={'path':'archive-match'}
   store=MemoryStore(db,objects);store.put_json('old-packed',packed)
   db.execute('INSERT INTO statarena.fixtures(id,league_id,season,day,status,body) VALUES(%s,%s,%s,%s,%s,%s)',(mid,league,sid,fixture['date'],'finished',Jsonb(fixture)))
   db.execute('INSERT INTO statarena.shards(id,ref) VALUES(%s,%s)',('archive-shard',Jsonb({'document':{'path':'archive-documents'},'tables':refs})))
   db.execute('INSERT INTO statarena.observations(id,shard,ordinal) VALUES(%s,%s,0)',(mid,'archive-shard'))
   if kind=='recent-precedence':
    fresh=copy.deepcopy(sample['players']['data']);fresh[0]['stats'][0]['stats']['Goals']['stat']['value']=2
    for suffix,data in [('/players',fresh),('',{**fixture,'stadium':{'name':'Recent Stadium'},'referee':{'name':'Recent Referee'},'round_name':'13'})]:
     path='recent'+suffix;objects[path]={'data':data};store.objects[path]=copy.deepcopy(objects[path]);db.execute('INSERT INTO statarena.resources(endpoint,params,status,ref) VALUES(%s,\'{}\',200,%s)',('/matches/'+mid+suffix,Jsonb({'path':path})))
    db.execute('INSERT INTO statarena.resources(endpoint,params,status) VALUES(%s,\'{}\',404)',('/matches/'+mid+'/lineups',))
   db.execute('INSERT INTO statarena.dirty_partitions(season,league_id) VALUES(%s,%s)',(sid,league))
   materialize(store,max_partitions=1)
   manifest=store.objects['computed/dashboard/index.json'];chunk=manifest['seasons'][0]['chunks'][0];published=store.objects[chunk['path']];rows={k:unpack(t) for k,t in published['tables'].items()}
   p_row=rows['performances'][0];s_row=rows['shots'][0];m_row=rows['matches'][0]
   check('published shot endpoint and height',s_row.get('goalCrossedY')==32.2 and s_row.get('goalCrossedZ')==1.4,{k:s_row.get(k) for k in ['goalCrossedY','goalCrossedZ']})
   if kind!='partial-families':
    check('published physical statistic, attempts and captain',p_row.get('topSpeed')==33.2 and p_row.get('passesAttempted')==5 and p_row.get('isCaptain') is True,{k:p_row.get(k) for k in ['topSpeed','passesAttempted','isCaptain']})
   check('player references remain consistent',m_row['players']==[p_row['id']],m_row['players'])
   if kind!='fixture-without-summary':
    expected='Recent Stadium' if kind=='recent-precedence' else 'Archive Stadium';check('stored summary metadata merged',m_row.get('stadium',{}).get('name')==expected,m_row.get('stadium'))
   else:check('missing summary remains unknown',m_row.get('stadium') is None,m_row.get('stadium'))
   check('current successful response wins / previous players preserved',p_row['goals']==(2 if kind=='recent-precedence' else 1),p_row['goals'])
   check('dirty queue cleared after actual publication',db.execute('SELECT count(*) FROM statarena.dirty_partitions').fetchone()[0]==0,db.execute('SELECT count(*) FROM statarena.dirty_partitions').fetchone()[0])
   check('no provider jobs created',db.execute('SELECT count(*) FROM statarena.jobs').fetchone()[0]==0,db.execute('SELECT count(*) FROM statarena.jobs').fetchone()[0]);case['status']='passed'
  except Exception as error:case['error']=str(error)
report['status']='passed' if all(c['status']=='passed' for c in report['cases']) else 'failed'
Path(a.report).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'cases':[{k:c.get(k) for k in ['name','status','error']} for c in report['cases']]}));raise SystemExit(report['status']!='passed')
