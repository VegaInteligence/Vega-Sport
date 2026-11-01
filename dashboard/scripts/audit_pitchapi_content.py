#!/usr/bin/env python3
"""Measure null/empty provider payloads for stored match statistics and shots."""
import collections,glob,gzip,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];counts=collections.defaultdict(collections.Counter)
for family in ('players','shots','stats','events','momentum'):
 for file in glob.glob(str(ROOT/'data/raw/seasons/*/observations'/family/'*.gz')):
  season=Path(file).parts[-4]
  with gzip.open(file,'rt') as stream:rows=json.load(stream)
  for row in rows:
   r=row['response'];c=counts[(season,family)];c['responses']+=1
   if r.get('status')!=200:c['non_200']+=1;continue
   value=r.get('data');c['http_200']+=1
   if value is None:c['null_data']+=1
   elif value==[] or value=={}:c['empty_data']+=1
   elif family=='shots' and isinstance(value,dict):
    periods=value.get('periods')
    if isinstance(periods,list) and not any(p.get('shots') for p in periods if isinstance(p,dict)):c['no_shots_in_periods']+=1
   elif family=='players' and isinstance(value,list) and not value:c['empty_players']+=1
report={'setup':'All locally stored match endpoint response versions, including versions of fixtures and historical source snapshots.','command':'python3 dashboard/scripts/audit_pitchapi_content.py','expected':'Count explicitly null or empty 200 payloads; an empty dataset is not assumed incorrect or equivalent to a zero.','rows':[{'season':s,'family':f,**dict(v)} for (s,f),v in sorted(counts.items())]}
out=ROOT/'dashboard/outputs/pitchapi-coverage/content-quality.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
