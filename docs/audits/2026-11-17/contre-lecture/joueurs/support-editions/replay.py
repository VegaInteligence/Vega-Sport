"""Summarize actual input support across editions without substituting a primitive."""
import csv
import hashlib
import json
import zlib
from collections import Counter, defaultdict
from pathlib import Path

p=Path(__file__).resolve().parent
receipt=json.loads((p/'rds/receipt.json').read_bytes())
b=(p/'rds/inputs.json.zlib').read_bytes()
assert receipt['sha256']==hashlib.sha256(b).hexdigest() and receipt['exit_code']==0
assert receipt['probe_sha256']==hashlib.sha256((p/'probe.py').read_bytes()).hexdigest()
d=json.loads(zlib.decompress(b));groups=defaultdict(Counter);rows=[];editions=defaultdict(set)
for year,t in d['groups'].items():
    for values in t['rows']:
        r=dict(zip(t['columns'],values,strict=True))
        r['partition']=int(year);rows.append(r)
        k=(r['blocks'],r['missing_block'])
        groups[k].update({f:r[f] for f in t['columns'][6:-1]})
        editions[k].add(r['competition_season_id'])
assert sum(v['graded'] for v in groups.values())==157066
assert groups[(1,True)]['graded']==groups[(1,True)]['distribution']==52665
assert groups[(3,True)]['graded']==52051 and groups[(4,False)]['graded']==52350
assert groups[(3,True)]['both_primitives']==47990
assert sum(v['measured_prevented'] for (n,missing),v in groups.items() if missing)==0
with (p/'keepers-by-edition.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['partition',*t['columns']],lineterminator='\n');w.writeheader();w.writerows(rows)
out=dict(snapshot=d['snapshot'],source_sha256=receipt['sha256'],lines=len(rows),distinct_editions=len(set.union(*editions.values())),rows=[dict(blocks=k[0],missing_stopping=k[1],editions=len(editions[k]),**groups[k]) for k in sorted(groups)],mismatched_to_cent=groups[(4,False)]['three_primitives']-groups[(4,False)]['three_agree_to_cent'])
(p/'summary.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
