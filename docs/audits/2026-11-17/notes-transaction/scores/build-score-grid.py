"""Regenerate one row per catalog edition × entity type from the saved read-only results.
Empty audit cells are deliberately unknown or irrelevant. Fill zeroes only from a completed
query over that edition/season or the global partition-universe proving no source data.
Usage: python3 build-score-grid.py (from any directory).
"""
import csv
import json
import re
from collections import Counter,defaultdict
from pathlib import Path
base=Path(__file__).resolve().parent
db=base.parent/'db'

used_results={}
def results(stem):
    files=list(db.glob('*/'+stem+'.json'))
    if not files:return [],set(),False
    rows=[]; partitions=set();ok=False
    newest={}
    for p in sorted(files):
        if p.parent.name.startswith('freshness'):
            continue  # later observations track queue convergence separately from the audit grid
        d=json.loads(p.read_text())
        if 'error' in d or 'columns' not in d:continue
        key=(str(d.get('at','')),p.stat().st_mtime_ns)
        if p.stem not in newest or key>newest[p.stem][0]:newest[p.stem]=(key,p,d)
    for _,p,d in newest.values():
        used_results[p.stem]={'query':p.stem,'receipt':str(p.relative_to(base.parent)),'sampled_at':d.get('at',''),'result_rows':len(d['rows'])}
        ok=True; m=re.fullmatch(r'.+-(\d{4})',p.stem)
        if m:partitions.add(int(m.group(1)))
        rows.extend(dict(zip(d['columns'],r)) for r in d['rows'])
    return rows,partitions,ok

def mapping(rows,keys):
    out={}
    for row in rows:
        k=tuple(row[x] for x in keys)
        if k in out:raise ValueError(('duplicated result key',k))
        out[k]=row
    return out

def number(r,k):
    return int(r.get(k,0) or 0)

def save(name,rows):
    fields=list(dict.fromkeys(k for row in rows for k in row))
    with (base/name).open('w',newline='') as f:
        out=csv.DictWriter(f,fields);out.writeheader();out.writerows(rows)

editions=results('editions')[0]; universe,_,universal=results('season-universe')
support=defaultdict(set)
for row in universe:support[row['domain']].add(int(row['season_id']))
shot_seasons,_,shot_ok=results('player-shot-actor-seasons')
support['shot_actor']={int(x['season_id']) for x in shot_seasons}
score_rows,ss,_=results('player-scores-*');score=mapping(score_rows,['edition_id'])
parts_rows,ps,_=results('player-participations-*');parts=mapping(parts_rows,['edition_id'])
cue_rows,cs,_=results('player-event-cues-*');cues=mapping(cue_rows,['edition_id'])
pend_rows,pys,_=results('player-pending-*');pending=defaultdict(Counter)
for row in pend_rows:
    for k in ('pending_inputs','definitely_assignable_role','with_role_and_measured_touches','need_role_history','no_published_award','stats_newer_than_run','role_before_published_run'):
        pending[row['edition_id']][k]+=number(row,k)
tm,_,tm_ok=results('team-sides-all');team=mapping(tm,['edition_id','entity_type'])
ex,_,ex_ok=results('team-exact');exact=mapping(ex,['edition_id','entity_type'])
dist,_,d_ok=results('player-distributions');dist=mapping(dist,['edition_id'])
grid=[]; season_summary=defaultdict(Counter)
for ed in editions:
    eid=ed['edition_id']; year=int(ed['season_id'])
    common={k:ed[k] for k in ('season_id','season','competition_id','competition','edition_id','country_code','competition_kind','cup_key','archive_key','recorded_matches','finished','finished_unknown_score','finished_unknown_team')}
    for kind in ('club','national team','player'):
        row={**common,'entity_type':kind}
        if kind=='player':
            s=score.get((eid,),{}); p=parts.get((eid,),{}); c=cues.get((eid,),{})
            score_verified=year in ss or universal and year not in (support['stats']|support['player_grade'])
            base_verified=year in ps or universal and year not in (support['stats']|support['lineup']|support['substitution_or_goal_actor'])
            # Event and shot dedup query was not required in historical years if every positive cue holder is absent.
            all_cues_verified=year in cs or universal and shot_ok and year not in (support['stats']|support['lineup']|support['substitution_or_goal_actor']|support['shot_actor'])
            if score_verified:
                for k in ('stats_records','positive_minutes','minutes_unknown','algorithm_inputs_before_coverage','admitted_without_power_match','insufficient_contribution','insufficient_role_reference','missing_grade_for_computed_index','stored_on_stats','stale_grade_metadata','intentionally_hidden_cameo','displayed_under_current_rule','positive_minutes_in_excluded_domain','positive_minutes_outside_award_window'): row[k]=number(s,k)
                row.update(expected_proven=number(s,'proven_scorable'),actual_valid=number(s,'scorable_valid_persisted'),
                           genuine_missing_after_computation=number(s,'missing_grade_for_computed_index'),invalid_or_mismatched=number(s,'proven_scorable')-number(s,'scorable_valid_persisted')-number(s,'missing_grade_for_computed_index'),
                           insufficient_processed=number(s,'insufficient_contribution')+number(s,'insufficient_role_reference'))
            if base_verified:
                row['known_participations_minimum']=number(p,'confirmed_participations')+number(c,'additional_confirmed_participations')
                row['known_participants_without_stats']=number(p,'participants_without_stats')+number(c,'additional_without_stats')
                row['known_participants_without_measured_minutes']=number(p,'participants_without_measured_minutes')+number(c,'additional_without_measured_minutes')
                row['matches_no_starter_sub_or_positive_minute']=number(p,'matches_without_confirmed_participants') if year in ps else ed['finished']
                row['lineup_presence_unconfirmed_before_event_enrichment']=number(p,'lineup_presence_unconfirmed')
            if year in pys or score_verified and not number(s,'admitted_without_power_match'):
                for k in ('definitely_assignable_role','with_role_and_measured_touches','need_role_history','no_published_award','stats_newer_than_run','role_before_published_run'):row[k]=pending[eid][k]
            if d_ok and (eid,) in dist:
                row.update({k:v for k,v in dist[(eid,)].items() if k!='edition_id'})
            row['participation_evidence']='minutes, starters, substitutions, goals and shots' if base_verified and all_cues_verified else 'minutes, starters and substitutions; additional event evidence unverified' if base_verified else 'not fully measured'
            row['coverage_basis']='own finite match_index; input rows without index are separate' if score_verified else 'unverified edition'
        else:
            s=team.get((eid,kind),{}); x=exact.get((eid,kind),{})
            if tm_ok:
                for k in ('finished_sides','archive_policy_excluded','insufficient_result_or_identity','excluded_date_or_team_type','self_pair','excluded_folder','candidate_sides_before_copy_rules','stored_matched_sides','rated_outside_current_gate'):row[k]=number(s,k)
                row['unknown_team_sides_unattributed']=number(team.get((eid,'unknown side'),{}),'finished_sides')
                row['known_participations_minimum']=number(s,'finished_sides')
            if ex_ok:
                row.update(expected_proven=number(x,'expected_sides'),actual_valid=number(x,'stored_valid'),
                           genuine_missing_after_computation=number(x,'missing'),invalid_or_mismatched=number(x,'invalid'))
                for k in ('refused_self','refused_folder','matched_copy','stored_on_excluded_side','canonical_id_differed','wrong_result','invalid_strength_or_probability','pre_post_unchanged','movement_exceeds_100'):row[k]=number(x,k)
            row['coverage_basis']='deployed identity and exact Elo eligibility replay' if ex_ok else 'structural Elo candidates; exact copy/identity replay pending' if tm_ok else 'unverified edition'
        grid.append(row)
save('coverage-by-edition-and-entity.csv',grid)
for row in grid:
    g=season_summary[row['season_id'],row['season'],row['entity_type']]
    g['editions']+=1
    for k in ('finished','expected_proven','actual_valid','genuine_missing_after_computation','invalid_or_mismatched','algorithm_inputs_before_coverage','admitted_without_power_match','definitely_assignable_role','known_participations_minimum','known_participants_without_stats','known_participants_without_measured_minutes','archive_policy_excluded','matched_copy'):
        if k in row:
            g[k+'_verified_editions']+=1;g[k]+=int(row[k] or 0)
rows=[{'season_id':year,'season':label,'entity_type':kind,**counts} for (year,label,kind),counts in sorted(season_summary.items())]
save('coverage-by-season-and-entity.csv',rows)
save('score-query-snapshots.csv',[used_results[k] for k in sorted(used_results)])
print('editions',len(editions),'entity cells',len(grid),'team policy replay',ex_ok,'season universe',universal,'player score partitions',sorted(ss),'event enrichment partitions',sorted(cs))
