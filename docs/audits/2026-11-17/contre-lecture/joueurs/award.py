"""Reconcile the same transaction's pending and role-history witnesses by award and partition."""
from pathlib import Path
import sys,json,csv,hashlib
from collections import defaultdict,Counter
p=Path(__file__).resolve().parent
root=Path(sys.argv[1]).resolve()
def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
def rows(f):
 d=json.loads(f.read_bytes())
 return [dict(zip(d['columns'],r,strict=True)) for r in d['rows']],d['snapshot']
tot=defaultdict(Counter);out=[];stamps=set();hashes={}
for year in range(2021,2027):
    f=root/f'db/pending_verified/player-pending-{year}.json';g=root/f'db/longitudinal/award-role-{year}.json';hashes.update({v.name:sha(v) for v in [f,g]});pending,s=rows(f);s2,s3=rows(g);stamps.update([s,s3])
    history={(r['edition_id'],r['award']):r for r in s2}
    assert len(history)==len(pending)
    for r in pending:
        q=history[(r['edition_id'],r['award'])]
        assert r['pending_inputs']==q['pending'] and r['definitely_assignable_role']==q['current_assignable']
        assert q['pending']==q['current_assignable']+q['recovered_by_award_history']+q['no_model_role_after_award_history']
        c=dict(pending=q['pending'],assignable_direct=q['current_assignable'],assignable_history=q['recovered_by_award_history'],unknown_role=q['no_model_role_after_award_history'],stats_newer_than_run=r['stats_newer_than_run'],no_published_award=r['no_published_award'])
        tot[r['award']].update(c);out.append(dict(partition=year,edition=r['edition_id'],award=r['award'],run=q['latest_player_run'],run_started=q['latest_player_start'],**c))
assert len(stamps)==1 and sum(v['pending'] for v in tot.values())==15033
with (p/'pending-by-award-edition.csv').open('w',newline='') as h:
 wr=csv.DictWriter(h,fieldnames=out[0].keys(),lineterminator='\n');wr.writeheader();wr.writerows(out)
o={'snapshot':list(stamps),'by_award':tot,'input_sha256':hashes}
(p/'pending-by-award.json').write_text(json.dumps(o,sort_keys=True,indent=2)+'\n');print({k:(v['pending'],v['assignable_direct'],v['assignable_history'],v['unknown_role'],v['stats_newer_than_run']) for k,v in sorted(tot.items())})
