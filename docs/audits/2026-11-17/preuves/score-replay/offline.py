"""Re-evaluate the sampled match grades without a database or AWS access."""
import argparse
import csv
import hashlib
import json
import math
import pathlib
import subprocess
import sys
import types

here = pathlib.Path(__file__).resolve().parent
args = argparse.ArgumentParser(description=__doc__)
args.add_argument('repository', type=pathlib.Path)
args.add_argument('--table', type=pathlib.Path, help='optional tab-separated report')
args = args.parse_args()
rec = json.loads((here/'sample.json').read_text())
source = subprocess.check_output(['git','-C',str(args.repository),'show',
                                  '8018e0836ca0f32e8b2eb51fc2847154abff7f13:backend/vega/power.py'])
assert hashlib.sha256(source).hexdigest() == rec['source_sha256']
power = types.ModuleType('deployed_power')
exec(compile(source, 'power.py', 'exec'), power.__dict__)
gr = rec['grade_refs']
grade_refs = {'roles': gr['roles'], 'quantiles': gr['quantiles'],
              'spreads': {(role,c):(n,s) for role,c,n,s in gr['spreads']}}

def agrees(a,b):
    return a is None and b is None or (a is not None and b is not None and math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12))

rows=[]
for case in rec['sample']:
    row=case['prepared'];role=row['role'];comp=row['competition_id']
    indicator_refs = {(role,ind):(lambda r,expectation=v['expectation']:expectation,v['dispersion'])
                      for ind,v in case['indicators'].items()}
    blocks, c = power.match_contribution(row,indicator_refs) if role else ({},None)
    z = power.match_index(role,comp,c,grade_refs)
    grade = None if z is None else power.score_of(z)
    assert blocks.keys()==case['blocks'].keys()
    assert all(agrees(v,case['blocks'][k]) for k,v in blocks.items())
    assert all(agrees(expected,actual) for expected,actual in
               [(c,case['contribution']),(z,case['z']),(grade,case['grade'])])
    pick=case['pick']
    assert pick['missing_intermediate'] and pick['persisted_z'] is None
    rows.append(dict(match=pick['match_id'],player=pick['player_id'],team=pick['team_id'],
                     edition=pick['edition_id'],bucket=pick['bucket'],role=role or '',minutes=row['minutes_played'],
                     contribution=c,z=z,grade=grade,display=case['displayable'],last_run_id=pick['last_run_id'],
                     source_update=pick['stat_updated'],last_match_update=pick['match_updated']))
if args.table:
    with args.table.open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]),delimiter='\t');w.writeheader();w.writerows(rows)
from collections import Counter
print(json.dumps(dict(at=rec['at'],source_sha256=rec['source_sha256'],verified=len(rows),
                      new_grades=sum(x['grade'] is not None for x in rows),still_ungradable=sum(x['grade'] is None for x in rows),
                      by_role=Counter(x['role'] or 'unresolved' for x in rows),
                      by_edition=Counter(x['edition'] for x in rows),
                      historical_run_ids=sorted({x['last_run_id'] for x in rows})),indent=2))
