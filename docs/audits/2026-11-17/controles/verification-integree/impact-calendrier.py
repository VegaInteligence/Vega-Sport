"""Replay the sport-only counterfactual from the two peer-verified public evidence bundles."""
from collections import Counter
import csv
from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from zipfile import ZipFile
import zlib

def sha(b):
    return sha256(b).hexdigest()

def compare(base):
    with ZipFile(base/'angleterre-575.zip') as official:
        candidates=list(csv.DictReader(io.StringIO(official.read('outputs/VI21-prior-201.csv').decode())))
        discrepancy=list(csv.DictReader(io.StringIO(official.read('outputs/VI21-score-1.csv').decode())))
        controls=json.loads(official.read('outputs/verification.json'))
    with ZipFile(base/'35-matchs-identites-et-elo.zip') as input_archive:
        current=json.loads(zlib.decompress(input_archive.read('elo/capture-globale.zlib')))
        params=json.loads(input_archive.read('elo/parametres.json'))
        originals=json.loads(input_archive.read('elo/35-matchs.json'))['restored_rows']
        source=input_archive.read('elo/power.py')
    assert len(candidates)==201 and len(discrepancy)==1 and len(originals)==35
    assert controls['global_exact_countermatches']==0 and controls['official_finished']==575
    assert sha(source)==current['module_hashes']['vega.power']
    with tempfile.TemporaryDirectory() as scratch:
        p=Path(scratch)/'vega_power.py'
        p.write_bytes(source)
        spec=importlib.util.spec_from_file_location('vega_calendar_power',p)
        power=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(power)

    seeds={int(k):v for k,v in params['seeds'].items()}
    weights={int(k):v for k,v in params['weights'].items()}
    leagues={k:k for k in seeds}
    run=current['elo_run']
    ids={int(r['home_team_id']) for r in candidates}|{int(r['away_team_id']) for r in candidates}
    assert ids<=seeds.keys() and ids.isdisjoint(current['national_ids'])
    initial=current['matches']
    base_matches=[*initial,*originals]
    assert len(initial)==81898 and len(base_matches)==81933
    assert len({m[0] for m in base_matches})==len(base_matches)
    cohort=[r for r in base_matches if r[10] in (332,333,334)]
    assert len(cohort)==374 and all(r[11]==1 and r[7] is False for r in cohort)
    assigned=Counter((m[8],team) for m in base_matches for team in m[3:5])
    new=[]
    for r in candidates:
        assert not r['historical_match_id'] and not r['current_match_id']
        assert r['global_same_known_pair_plus_minus_31_days_count']=='0'
        day=r['match_date']
        sides=[int(r['home_team_id']),int(r['away_team_id'])]
        assert len(set(sides))==2 and all(not assigned[(day,t)] for t in sides)
        assigned.update((day,t) for t in sides)
        assert power.stakes(None,r['cup_key'],None,None)==1.0
        # A tuple of organizer identifiers lives only in this numerical experiment.
        # It is never assigned a production match ID.
        key=(r['league'],r['official_id'])
        new.append([key,2026,day+' 00:00:00+00:00',*sides,int(r['home_score_official']),int(r['away_score_official']),
                    False,day,int(r['competition_id']),int(r['competition_season_id']),1.0])
    assert len({m[0] for m in new})==201
    change=discrepancy[0]
    target=int(change['current_match_id'])
    original=next(m for m in initial if m[0]==target)
    assert target==8625 and original[5:7]==[1,2]
    revised=[*original[:5],int(change['home_score_official']),int(change['away_score_official']),*original[7:]]
    assert revised[5:7]==[0,1]
    def replay(matches):
        def order(m):
            stamp=datetime.fromisoformat(m[2]) if m[2] else datetime.max.replace(tzinfo=timezone.utc)
            # Same-time/same-day tie order for new rows cannot influence their teams:
            # the two sides of every added row have been proved absent elsewhere that day.
            return (m[2] is None,stamp,m[8] is None,m[8] or '',isinstance(m[0],tuple),m[0])
        ordered=sorted(matches,key=order)
        result={(r[0],r[1]):r[4:8] for r in power.elo_updates(ordered,initial=run[5],k=run[6],home=run[7],seeds=seeds,leagues=leagues,weights=weights)}
        latest={team:(m[0],team) for m in ordered for team in m[3:5]}
        return result,latest
    def replaced(ms):
        return [revised if m[0]==target else m for m in ms]
    root,root_latest=replay(initial)
    retained,retained_latest=replay(base_matches)
    corrected,_=replay(replaced(base_matches))
    assert corrected==retained
    combined,combined_latest=replay([*replaced(base_matches),*new])
    added_sides=set(combined)-set(retained)
    assert len(added_sides)==402 and {r[0] for r in added_sides}=={r[0] for r in new}
    later=[[*m[:2],m[8]+' 23:59:59+00:00',*m[3:]] for m in new]
    before_and_after_day,_=replay([*replaced(base_matches),*later])
    assert combined==before_and_after_day
    def difference(old, latest):
        changed={k:combined[k][1]-vals[1] for k,vals in old.items() if abs(combined[k][1]-vals[1])>0.01}
        assert all(k[1] not in current['national_ids'] for k in changed)
        teams={t:combined[combined_latest[t]][1]-old[k][1] for t,k in latest.items() if t not in current['national_ids']}
        effect={t:d for t,d in teams.items() if abs(d)>0.01}
        return {'common_sides':len(old),'sides_abs_change_gt_001':len(changed),'matches_abs_change_gt_001':len({k[0] for k in changed}),
                'last_club_elo_abs_change_gt_001':len(effect),'max_abs_common_side':round(max(map(abs,changed.values())),5),
                'max_abs_last_club':round(max(map(abs,effect.values())),5),
                'largest_last_club_deltas':[{'team_id':t,'delta':round(d,5)} for t,d in sorted(effect.items(),key=lambda item:abs(item[1]),reverse=True)[:5]]}
    return {'source_rds':current['at'],'function_sha256':sha(source),'run':run[0],
            'reference':'Current or restored population versus all 236 admitted. Same fixed per-team starting seeds and stakes.',
            'conditions':['All 201 additional fixtures enter as ordinary domestic home games in their evidenced competition/season. They have no historical Vega match ID.',
                          'Both observed clubs have no other game on that date in either population. First-to-last-second sensitivity is identical.',
                          'No level refit, extra stats, individual grade or production writes. The 35 historical rows keep their original identifiers.'],
            'official_fixtures':575,'missing_current':236,'historical_ids_kept':35,'new_official_references':len(new),
            'baseline_admitted_matches':len(initial),'scenario_matches':len(replaced(base_matches))+len(new),'new_team_sides_all_236':472,
            'admitting_201_after_restoring_35':difference(retained,retained_latest),'admitting_all_236_from_current':difference(root,root_latest),
            'full_global_elo_movement_from_only_fixing_8625':0,'same_club_same_day_conflicts':0,
            'identical_if_all_201_played_at_end_of_utc_day':True}

if __name__=='__main__':
    base=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent
    print(json.dumps(compare(base),ensure_ascii=False,indent=2))
