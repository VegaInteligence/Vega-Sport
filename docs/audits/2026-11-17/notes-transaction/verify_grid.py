"""Check the follow-up grid against independent raw grouped figures."""
import csv,json,itertools
from pathlib import Path
from collections import Counter
P=Path(__file__).resolve().parent
def get(p): return json.loads(p.read_bytes())
grid=list(csv.DictReader((P/'scores/coverage-by-edition-and-entity.csv').open()))
cat=get(P/'db/catalog_verified/editions.json')
assert len(grid)==len(cat['rows'])*3
assert len({(r['edition_id'],r['entity_type']) for r in grid})==len(grid)
assert {r['entity_type'] for r in grid}=={'club','national team','player'}
agg={}
for i in ('club','national team','player'):
 rows=[r for r in grid if r['entity_type']==i]
 agg[i]={k:sum(int(r[k]) for r in rows if r.get(k)) for k in ['expected_proven','actual_valid','recorded_matches','finished','algorithm_inputs_before_coverage','admitted_without_power_match','known_participations_minimum','known_participants_without_stats','known_participants_without_measured_minutes','intentionally_hidden_cameo']}
r=get(P/'db/team_exact/team-exact.json')
for i in ('club','national team'):
 rows=[dict(zip(r['columns'],rr)) for rr in r['rows'] if rr[r['columns'].index('entity_type')]==i]
 assert (sum(x['expected_sides'] for x in rows),sum(x['stored_valid'] for x in rows))==(agg[i]['expected_proven'],agg[i]['actual_valid'])
files=list((P/'db/grade_integrity_verified').glob('player*json'));assert len(files)==6
integrity=[r for f in files for r in get(f)['rows']]
assert sum(x[1] for x in integrity)==agg['player']['actual_valid']
assert all(v==0 for row in integrity for v in row[2:])
assert agg['player']['algorithm_inputs_before_coverage']==agg['player']['expected_proven']+agg['player']['admitted_without_power_match']
summary={'edition_entity_rows':len(grid),'editions':len(cat['rows']),'competitions':len({x['competition_id'] for x in grid}),'seasons':len({x['season_id'] for x in grid}),'receipts':'scores/score-query-snapshots.csv','known_population':agg,'team_as_of':r['at'],'grade_integrity_partition_rows':integrity,'rerun':'python3 scores/build-score-grid.py && python3 verify_grid.py'}
(P/'scores/grid-validation.json').write_text(json.dumps(summary,indent=1)+'\n')
print(len(grid),[(k,v['expected_proven'],v['actual_valid']) for k,v in agg.items()])
