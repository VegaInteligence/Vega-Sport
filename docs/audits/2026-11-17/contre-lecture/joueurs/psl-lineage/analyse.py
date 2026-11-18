"""Offline joins for the PSL edition; no historical individual classification is constructed."""
import argparse
from collections import Counter
import csv
from datetime import datetime
import gzip,hashlib,json,zlib
from pathlib import Path
D=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=D);args=p.parse_args();O=args.output.resolve();assert O.is_relative_to(D);O.mkdir(exist_ok=True,parents=True)
def j(x):return json.loads(x.read_bytes())
def write(name,data):(O/name).write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
def rows(t):return [dict(zip(t['columns'],r,strict=True)) for r in t['rows']]
def unique(lst,key):
    a={r[key]:r for r in lst};assert len(a)==len(lst);return a
def h(b):return hashlib.sha256(b).hexdigest()
def ms(a,b):return round((datetime.fromisoformat(a)-datetime.fromisoformat(b)).total_seconds()*1000,3)
def csvout(name,lst):
    with (O/name).open('w',newline='') as f:
        w=csv.DictWriter(f,lst[0].keys(),lineterminator='\n');w.writeheader();w.writerows(lst)
def capture(root):
    r=j(root/'rds/receipt.json');f=(root/'rds/inputs.json.zlib').read_bytes()
    assert r['exit_code']==0 and h(f)==r['sha256'] and r['probe_sha256']==h((root/'probe.py').read_bytes())
    z=json.loads(zlib.decompress(f));assert z['snapshot'][0]=='vega_v2' and z['snapshot'][3]=='on';return z
def digest_hist_inputs():
    for name,s in j(D/'history/source-index.json').items():
        assert h((D/'history'/name).read_bytes())==s['projection_sha256']
digest_hist_inputs()
before=j(D/'history/22h07.json'); early=j(D/'history/21h05.json')
second=j(D/'history/02h02.json');later=j(D/'history/04h22.json')
b0,=rows(before);assert b0['edition_id']==911 and b0['award']==2025 and b0['no_model_role_after_award_history']==b0['pending']==1110
for timed in [second,later]:
    now,=rows(timed);assert now['pending']==now['no_model_role_after_award_history']==14 and now['latest_player_run']==2096
parent=json.loads(gzip.decompress((D/'history/07h12.json.gz').read_bytes()))
s=rows(parent['psl']); keys={(x['season_id'],x['match_id'],x['player_id']) for x in s};assert len(keys)==len(s)==5537
d=capture(D);q=capture(D/'fetch-jobs');hist=capture(D/'parse-history')
fixtures=unique(rows(d['match_keys']),'id')
assert len(fixtures)==182 and all(m['provider']=='pitchapi' and m['is_current'] and m['status']=='finished' for m in fixtures.values())
fetch=unique(rows(d['fetch_interval']),'entity_id')
old=unique([r for r in rows(hist['old_fetch']) if r['family']=='lineups'],'entity_id')
oldstats=unique([r for r in rows(hist['old_fetch']) if r['family']=='player_stats'],'entity_id')
assert old.keys()==oldstats.keys()==fixtures.keys()
errors=unique(rows(hist['parse']),'entity_id');jobs=unique(rows(q['jobs']),'entity_id')
states=unique([r for r in rows(d['state']) if r['family']=='lineups'],'match_id')
lineups=unique(rows(d['lineups']),'match_id'); assert set(states)==set(lineups)==set(fixtures)
assert set(fetch)==set(errors)==set(jobs) and len(fetch)==132 and {r['family'] for r in fetch.values()}=={'lineups'} and len({r['request_id'] for r in fetch.values()})==132
assert all(r['error_code']=='INVALID_REFERENCE' and r['family']=='lineups' for r in errors.values())
assert all(r['http_status']==200 for r in [*fetch.values(),*old.values(),*oldstats.values()])
assert all(r['job_id'] is None and r['parser_version'] is None and r['response_sha256'] is None and r['rows_written'] is None and r['is_empty'] is None for r in fetch.values())
assert all(r['lane']=='backfill' and r['state']=='done' and r['last_error_code']=='INVALID_REFERENCE' and r['last_http'] is None and r['attempts']==1 for r in jobs.values())
runs=unique(rows(d['runs']),'id')
l=[];since=[];ack=[]
for mid,m in fixtures.items():
    f=fetch.get(mid,{});err=errors.get(mid,{});job=jobs.get(mid,{});st=states[mid];lp=lineups[mid]
    assert st['status']=='ok' and st['last_success_at']==lp['updated_at']
    if f:
        assert err['at']<f['fetched_at'] and st['updated_at']==st['last_success_at'] and old[mid]['fetched_at']<err['at']
        end=ms(lp['updated_at'],f['fetched_at']);delay=ms(job['updated_at'],f['fetched_at']);assert 0<end<delay
        since.append(end);ack.append(delay)
    else:
        assert lp['updated_at']<before['at']
    played=[x for x in s if x['match_id']==mid];missing=[r for r in played if r['power_run'] is None]
    l.append(dict(match_id=mid,season_id=m['season_id'],pitchapi_match=m['provider_key'],day=m['match_date'],home_id=m['home_team_id'],away_id=m['away_team_id'],initial_lineups_fetch=old[mid]['id'],initial_http=old[mid]['http_status'],initial_at=old[mid]['fetched_at'],initial_parse_failure_id=err.get('id'),initial_parse_code=err.get('error_code'),initial_parse_at=err.get('at'),initial_stats_fetch=oldstats[mid]['id'],initial_stats_at=oldstats[mid]['fetched_at'],second_lineups_fetch=f.get('id'),second_request_id=f.get('request_id'),second_at=f.get('fetched_at'),http=f.get('http_status'),backfill_job=job.get('id'),backfill_due=job.get('run_after'),backfill_done=job.get('updated_at'),last_job_error=job.get('last_error_code'),state_success=st['last_success_at'],normalised_family_digest=st['fingerprint'],lineup_written=lp['updated_at'],lineup_slots=lp['slots'],positions_present=lp['known'],detailed_positions=lp['detailed'],starter_slots=lp['starters'],positive_minute_stats=len(played),positive_stats_with_lineup=sum(r['lineup_last_changed'] is not None for r in played),current_pending=len(missing)))
csvout('fixture-lineage-182.csv',l)
assert all(x['stats_pos'] is None for x in s)
assert max(x['stats_last_changed'] for x in s)<before['at'] and all(x['grade_run'] is None if x['power_run'] is None else x['grade_run'] is not None and x['power_run']==2096 for x in s)
refreshed=[x for x in s if x['lineup_last_changed'] and x['lineup_last_changed']>before['at']];assert len(refreshed)==4002
assert all(x['match_id'] in fetch and x['role'] and x['lineup_pos'] is not None and x['lineup_last_changed']==lineups[x['match_id']]['updated_at'] for x in refreshed)
newkeys=[v for v in l if v['second_lineups_fetch']];assert sum(v['detailed_positions'] for v in newkeys)==2903 and sum(v['positive_minute_stats'] for v in newkeys)==4014
nondirect=[x for x in s if x['lineup_pos'] is None];assert len(nondirect)==19
resid=[x for x in s if x['power_run'] is None]
assert len(resid)==14 and {x['team_id'] for x in resid}=={5301} and {x['player_id'] for x in resid}=={37009}
assert len([r for r in s if r['player_id']==37009])==14
checked=d['pending_current']['rows']
assert keys.issuperset({tuple(x[:3]) for x in checked}) and {tuple(x[:3]) for x in checked}=={(x['season_id'],x['match_id'],x['player_id']) for x in resid}
named={r['entity_type']:r['provider_key'] for r in rows(q['identities']) if r['provider']=='pitchapi' and r['is_current']}
assert named=={'competition':'l_1Kknkl','team':'t_1qdq3x','player':'p_3OP9kH'}
pending=[]
for x in checked:
    y=next(r for r in resid if r['match_id']==x[1])
    assert x[:6]==[y[k] for k in ('season_id','match_id','player_id','team_id','match_date','minutes_played')] and x[6:8]==[None,None] and x[9] is None and x[11] is None and x[8] is not None
    f=fixtures[x[1]];side='home' if x[3]==f['home_team_id'] else 'away';assert x[3]==f[side+'_team_id']
    pending.append(dict(edition=911,award=2025,season=x[0],match=x[1],native_match=f['provider_key'],player=x[2],native_player=named['player'],stats_team=x[3],native_team=named['team'],side=side,match_date=x[4],minutes=x[5],touches=x[8],stats_position=x[6],lineup_position=x[7],goals_prevented=x[9],stats_timestamp=x[10],lineup_timestamp=x[11],roles_or_grades_at_0712=y['role'],match_in_132=x[1] in fetch))
csvout('pending-current-14.csv',pending)
regional=rows(d['coverage'])[0];assert regional['games']==182 and regional['outside']==regional['null_team']==0
summs=dict(edition=911,competition=195,pitchapi=named,award=2025,clocks={'early':early['at'],'old':before['at'],'02h02':second['at'],'04h22':later['at'],'morning':parent['snapshot'],'independent':d['snapshot'],'jobs':q['snapshot'],'parse':hist['snapshot']},timeline=[{'source':name,'row':rows(obj)[0]} for name,obj in [('21h05',early),('22h07',before),('02h02',second),('04h22',later)]],old_aggregate_only=True,net_pending_decrease=1110-14,edition_counts=regional,observed_players=len({x['player_id'] for x in s}),observed_teams=len({x['team_id'] for x in s}),
    older={'http200_lineups':len(old),'http200_stats':len(oldstats),'lineups_parse_failures':len(errors),'failure_first':min(x['at'] for x in errors.values()),'failure_last':max(x['at'] for x in errors.values())},
    refetch={'unique_http200':len(fetch),'job_target_matches':len(jobs),'request_ids':len({f['request_id'] for f in fetch.values()}),'direct_fetch_job_fks':0,'first_http':min(x['fetched_at'] for x in fetch.values()),'last_http':max(x['fetched_at'] for x in fetch.values()),'first_lineup_write':min(lineups[k]['updated_at'] for k in fetch),'last_lineup_write':max(lineups[k]['updated_at'] for k in fetch),'fetch_to_lineup_ms':[min(since),max(since)],'fetch_to_job_done_ms':[min(ack),max(ack)],'queue_run_after_bounds':[min(x['run_after'] for x in jobs.values()),max(x['run_after'] for x in jobs.values())],
    'lineups_slots':sum(lineups[x]['slots'] for x in fetch),'slots_with_positions':sum(lineups[x]['known'] for x in fetch),'detailed':sum(lineups[x]['detailed'] for x in fetch),'positive_minute_stats':4014,'positive_with_lineup_new':len(refreshed),'detailed_played':sum(x['lineup_pos']==11 or 30<=x['lineup_pos']<=119 for x in refreshed),'generic_played':sum(x['lineup_pos'] in (0,1,2,3) for x in refreshed),'unchanged_fixture_lineups':len(fixtures)-len(fetch),'first_match_updates_before_2093_start':sum(lineups[k]['updated_at']<runs[2093]['started_at'] for k in fetch),'stats_updated_bounds':[min(x['stats_last_changed'] for x in s),max(x['stats_last_changed'] for x in s)]},
    current={'graded':sum(bool(x['grade_run']) for x in s),'not_graded':len(resid),'refetched_matches_containing_residuals':sum(x['match_id'] in fetch for x in resid),'without_lineup_but_graded':sum(x['grade_run'] is not None for x in nondirect),'grade_runs':dict(Counter(x['grade_run'] for x in s if x['grade_run'])),'grade_runs_on_new_lineup_rows':dict(Counter(x['grade_run'] for x in refreshed)),'all_power_runs':dict(Counter(x['power_run'] for x in s if x['power_run']))},
    award_runs=sorted(runs.values(),key=lambda r:r['id']))
write('findings.json',summs)
print(json.dumps({'historic_pending':1110,'same_02h02_04h22':14,'remaining_exact_keys':len(resid),'new_lineup_fetches':len(fetch),'matching_parse_failures':len(errors),'matching_jobs_by_target_time':len(jobs),'new_lineup_positions_played':len(refreshed),'applicable_stats':len(s),'elapsed_fetch_ms':summs['refetch']['fetch_to_lineup_ms']},ensure_ascii=False))
