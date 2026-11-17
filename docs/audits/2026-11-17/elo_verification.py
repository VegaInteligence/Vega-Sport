"""Read-only production audit. In the deployed worker, under a psycopg read-only transaction,
call team_exact.audit(db). No connection creation, files, network calls, refresh or writes here.
All queries come from the deployed identity.pairs / power.ELO_MATCHES or the SELECTs below.
"""
from collections import Counter, defaultdict
import hashlib
import inspect
import math

def audit(db):
    from vega import power
    from vega.sources import identity
    from vega.sources.open_matchday import COVERED

    if db.execute("SHOW transaction_read_only").fetchone()[0] != "on":
        raise RuntimeError("a read-only session is required")
    db.execute("SELECT 1")
    # Reuse the deployed gate exactly, append metadata that its pure functions leave untouched.
    needle = 'cs.cup_key\nFROM core.matches m'
    if power.ELO_MATCHES.count(needle) != 1:
        raise RuntimeError("deployed model assembly differs; capture the new ELO_MATCHES contract")
    sql = power.ELO_MATCHES.replace(needle, 'cs.cup_key,m.competition_season_id,th.is_national IS TRUE,ta.is_national IS TRUE\nFROM core.matches m')
    # Avoid an unbounded memory audit on an unexpected dataset. Keep the ordered original query.
    limit = 250000
    rows = db.execute(sql + ' LIMIT %s', (limit + 1,)).fetchall()
    if len(rows) > limit:
        raise RuntimeError("candidate limit exceeded")
    choices, examined = identity.pairs(db)
    merge = {team: kept for team, kept, *_ in choices}
    merged = power.merged_rows(rows, merge)
    kept = power.elo_matches(merged)
    raw_ids = {(r[1],r[0]): (r[3],r[4]) for r in rows}
    canonical_ids = {(r[1],r[0]) for r in merged}
    kept_ids = {(r[1],r[0]) for r in kept}
    if len(raw_ids) != len(rows) or len(canonical_ids) != len(merged) or len(kept_ids) != len(kept):
        raise RuntimeError("ambiguous match identity")
    del merged, kept
    cols = ('edition_id','entity_type','structurally_admissible','refused_self','refused_folder','matched_copy',
            'expected_sides','stored_valid','missing','invalid','stored_on_excluded_side','canonical_id_differed',
            'wrong_result','invalid_strength_or_probability','pre_post_unchanged','movement_exceeds_100')
    groups = defaultdict(Counter)
    # Elo records outside model entry are covered separately in team-grade-integrity.sql and team-sides-all.sql.
    actual = db.execute('SELECT season_id,match_id,team_id,elo_before,elo_after,expected,result FROM agg.team_elo LIMIT %s',
                        (2 * limit + 1,)).fetchall()
    if len(actual) > 2 * limit:
        raise RuntimeError("rating limit exceeded")
    grades = {(s,m,t):(before,after,prob,result) for s,m,t,before,after,prob,result in actual}
    del actual
    if len(grades) >= 2*limit + 1:
        raise RuntimeError("rating limit exceeded")
    omitted = set(COVERED) | power.SUPERSEDED
    for row in rows:
        mid, sid = row[0], row[1]
        key = (sid,mid)
        is_self = key not in canonical_ids
        is_folder = power._folder(row[12]) in omitted
        for orig,national,score,other in ((row[3],row[14],row[5],row[6]),(row[4],row[15],row[6],row[5])):
            g = groups[row[13], 'national team' if national else 'club']
            g['structurally_admissible'] += 1
            team = merge.get(orig, orig)
            g['canonical_id_differed'] += int(team != orig)
            existing = grades.get((sid,mid,team))
            if key not in kept_ids:
                reason = 'refused_self' if is_self else 'refused_folder' if is_folder else 'matched_copy'
                g[reason] += 1
                g['stored_on_excluded_side'] += int(existing is not None)
                continue
            g['expected_sides'] += 1
            if existing is None:
                g['missing'] += 1
                continue
            before,after,prob,result = existing
            expected_result = 1.0 if score>other else 0.0 if score<other else 0.5
            wrong = result != expected_result
            bad = not all(math.isfinite(v) for v in (before,after,prob)) or not 0<=prob<=1
            g['wrong_result'] += int(wrong)
            g['invalid_strength_or_probability'] += int(bad)
            g['invalid' if wrong or bad else 'stored_valid'] += 1
            g['pre_post_unchanged'] += int(after==before)
            g['movement_exceeds_100'] += int(abs(after-before)>100)
    return {'columns':list(cols),
            'rows':[[*k, *[n[c] for c in cols[2:]]] for k,n in sorted(groups.items())],
            'metadata':{'identity_teams_examined':examined,'projected_aliases':len(merge),
                        'raw_candidates':len(rows),'published_policy_matches':len(kept_ids),
                        'method':power.METHOD_VERSION,
                        'deployed_code_sha256':{name:hashlib.sha256(inspect.getsource(module).encode()).hexdigest() for name,module in [('power',power),('identity',identity)]}}}
