"""Validate each frozen source and write additive support counts with the complete partition and award axes."""
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import zlib

p = Path(__file__).resolve().parent
def sha(b):
    return hashlib.sha256(b).hexdigest()
raw = (p/'rds/inputs.json.zlib').read_bytes()
r = json.loads((p/'rds/receipt.json').read_bytes())
assert r['exit_code'] == 0 and r['definition_end_state']=='INACTIVE'
assert sha(raw)==r['sha256'] and sha((p/'probe.py').read_bytes())==r['probe_sha256']
d = json.loads(zlib.decompress(raw))
out=[]; total=Counter()
for partition, tab in sorted(d['support'].items()):
    for values in tab['rows']:
        row=dict(zip(tab['columns'],values,strict=True))
        row['partition']=int(partition)
        out.append(row)
        n=row['graded']
        full=4 if row['role']=='goalkeeper' else 5
        assert 1 <= row['measured_blocks'] <= full
        total['graded']+=n
        if row['measured_blocks'] < full:
            total['partial']+=n
        for k in ('missing_or_wrong_power','no_stopping','no_stats_row','unmeasured_touches'):
            total[k]+=row[k]
        if row['role']=='goalkeeper':
            total['keepers']+=n
            total[f"keeper_blocks_{row['measured_blocks']}"]+=n
        elif row['measured_blocks'] < full:
            total['outfield_partial']+=n
assert total['graded']==2282580 and total['partial']==104792 and total['no_stopping']==104716
assert total['no_stats_row']==total['unmeasured_touches']==total['missing_or_wrong_power']==0
with (p/'support-by-partition-award-role.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(out[0]),lineterminator='\n')
    w.writeheader();w.writerows(out)
result=dict(snapshot=d['snapshot'],source_sha256=sha(raw),counts=total,ungraded_by_award=json.loads((p/'pending-by-award.json').read_bytes())['by_award'],runs=d['runs'],earliest=d['historic'])
(p/'support-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(dict(total))
