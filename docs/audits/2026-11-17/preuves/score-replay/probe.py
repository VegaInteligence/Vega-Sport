import collections
import hashlib
import inspect
import json
import math
import time
from vega import power as p


def audit(db):
    since = time.monotonic()
    keys = lambda r: (r["match_id"], r["player_id"])
    def emit(stage):
        print("CHECKPOINT", stage, round(time.monotonic()-since, 2), flush=True)
    def rowdict(cur):
        names = [d.name for d in cur.description]
        return [dict(zip(names, row)) for row in cur]
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        assert db.execute("SHOW transaction_read_only").fetchone()[0] == "on"
        stamp, database, pg_snap = db.execute("SELECT current_timestamp,current_database(),pg_current_snapshot()::text").fetchone()
        picks = rowdict(db.execute(SAMPLE_SQL))
        assert 10 <= len(picks) <= 25, len(picks)
        emit(["sample",len(picks)])
        row_ids = set(map(keys, picks))
        with db.cursor(name="score_replay_production_inputs") as cur:
            cur.itersize = 4000
            cur.execute(p.PLAYER_MATCHES, ([2021,2022], *p.award_year(2021)))
            names = [d.name for d in cur.description]
            rows = [{k: (p._num(v) if k not in p._KEPT else v) for k,v in zip(names,row)} for row in cur]
    emit(["closed_read_transaction",len(rows)])
    raw = {keys(r):r.copy() for r in rows if keys(r) in row_ids}
    assert set(raw) == row_ids
    stated_roles = collections.defaultdict(list)
    for r in rows:
        r["delta"] = 0.0 if r["own_elo"] is None or r["opponent_elo"] is None else (r["opponent_elo"]-r["own_elo"])/400
    restored = p.restore_zeros(rows)
    assigned = p.assign_roles(rows)
    for r in rows:
        if r["player_id"] in {pick["player_id"] for pick in picks if pick["bucket"] == "unresolved_slot"}:
            stated_roles[r["player_id"]].append({k:r[k] for k in ("match_id","player_id","position_id","role","goals_prevented","minutes_played","formation","edition","team_id")})
    current = {keys(r):r for r in rows if keys(r) in row_ids}
    roles = {r["role"] for r in current.values() if r["role"]}
    year_role_rows = [r for r in assigned if r["role"] in roles]
    emit(["fit",sorted(roles),len(year_role_rows)])
    refs = p.references(year_role_rows)
    contributions = []
    for r in year_role_rows:
        _, c = p.match_contribution(r, refs)
        contributions.append((r["role"], r["competition_id"], r["minutes_played"], c))
    assert p.grade_reference_year(2021,stamp.date()) == 2021
    grade_refs = p.grade_references(contributions)
    emit(["quantiles",len(grade_refs["roles"])])
    evidence = []
    for pick in picks:
        key=keys(pick);r=current[key]; role=r['role']
        scores,c = p.match_contribution(r,refs) if role else ({},None)
        z = p.match_index(role,r["competition_id"],c,grade_refs)
        grade = p.score_of(z) if z is not None else None
        assert grade is None or (math.isfinite(grade) and 0 < grade < 100)
        indicators={}
        if role:
            for block in p.blocks_of(role).values():
                for spec in block:
                    name=spec[0]
                    if (role,name) in refs and r[name] is not None and (spec[1]!="conditional" or r[spec[3]] is not None):
                        expect, dispersion = refs[(role,name)]
                        indicators[name]={"expectation":expect(r),"dispersion":dispersion}
        evidence.append(dict(pick=pick, raw=raw[key], prepared=r,indicators=indicators,blocks=scores,contribution=c,z=z,grade=grade,
                             displayable=z is not None and (r["minutes_played"]>=20 or abs(z)>=1),
                             role_season_history=stated_roles[r["player_id"]] if pick["bucket"]=="unresolved_slot" else []))
    return dict(at=str(stamp),snapshot=pg_snap,database=database,award=2021,year_read_count=len(rows),year_assigned_count=len(assigned),
                zeros_restored=restored,shared_role_cohort=len(year_role_rows),role_counts=collections.Counter(r["role"] for r in year_role_rows),
                grade_refs={"roles":grade_refs["roles"],"quantiles":grade_refs["quantiles"],
                "spreads":[[role,comp,n,sd] for (role,comp),(n,sd) in grade_refs["spreads"].items() if comp in {r["competition_id"] for r in current.values()}]},
                source_sha256=hashlib.sha256(inspect.getsource(p).encode()).hexdigest(),elapsed_seconds=round(time.monotonic()-since,2),sample=evidence)
