"""Read-only bounded follow-up, to be run by the coordinator with the existing capture wrapper.
All SQL and parameters are retained. No write, scheduler invocation or production recalculation.
"""
from datetime import date, timedelta
WITNESSES = [(8049, 2552, 2558, '2026-08-31', 0, 1, 332), (8050, 2566, 2546, '2026-08-31', 2, 1, 332), (8051, 2607, 5548, '2026-08-31', 0, 1, 332), (8052, 2557, 2559, '2026-08-31', 2, 2, 332), (8053, 2580, 2590, '2026-08-31', 2, 1, 332), (8054, 3386, 2589, '2026-08-31', 3, 1, 332), (8055, 2588, 3387, '2026-08-31', 3, 0, 332), (8056, 3388, 2593, '2026-08-31', 0, 1, 332), (8057, 2567, 2565, '2026-08-31', 1, 1, 332), (8058, 3389, 3390, '2026-08-31', 0, 1, 332), (8059, 2606, 3391, '2026-08-31', 1, 1, 332), (8060, 2551, 2596, '2026-08-31', 0, 1, 332), (8290, 3392, 2532, '2026-09-05', 4, 1, 333), (8291, 3393, 2535, '2026-09-05', 3, 3, 333), (8292, 2560, 2602, '2026-09-05', 1, 1, 333), (8293, 2579, 3394, '2026-09-05', 0, 3, 333), (8294, 2537, 2613, '2026-09-05', 0, 4, 333), (8295, 2550, 2539, '2026-09-05', 1, 1, 333), (8296, 2599, 2533, '2026-09-05', 1, 1, 333), (8297, 2543, 2548, '2026-09-05', 1, 0, 333), (8298, 3395, 2527, '2026-09-05', 1, 2, 333), (8299, 2614, 3396, '2026-09-05', 3, 2, 333), (8300, 2545, 2570, '2026-09-05', 3, 1, 333), (8301, 3397, 2573, '2026-09-05', 0, 2, 333), (8534, 3411, 3412, '2026-08-31', 2, 0, 334), (8535, 3408, 2576, '2026-08-31', 0, 4, 334), (8536, 2620, 3400, '2026-08-31', 3, 4, 334), (8537, 2541, 3413, '2026-08-31', 0, 3, 334), (8538, 3403, 2562, '2026-08-31', 2, 1, 334), (8539, 3404, 3405, '2026-08-31', 0, 2, 334), (8540, 3414, 3409, '2026-08-31', 0, 3, 334), (8541, 3401, 3407, '2026-08-31', 0, 2, 334), (8542, 3399, 3402, '2026-08-31', 3, 1, 334), (8543, 3406, 3398, '2026-08-31', 1, 4, 334), (8544, 3410, 2591, '2026-09-01', 1, 2, 334)]
def collect(db):
    from vega import power, worker
    from vega.sources import identity
    with db.transaction():
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        at,snap,ro=db.execute("SELECT transaction_timestamp(),pg_current_snapshot()::text,current_setting('transaction_read_only')").fetchone()
        assert ro == 'on'
        out={'at':str(at),'snapshot':snap,'read_only':ro,'old_witnesses':WITNESSES}
        def get(k,q,args=()):
            cur=db.execute(q,args or None)
            rows=cur.fetchall()
            out[k]={'sql':q,'params':args,'columns':[c.name for c in cur.description],'rows':rows}
            return rows
        ids=[r[0] for r in WITNESSES]
        values=','.join(['(%s::bigint,%s::bigint,%s::bigint,%s::date,%s::int,%s::int,%s::bigint)']*len(WITNESSES))
        args=[v for row in WITNESSES for v in row]
        q="""WITH w(old_id,home,away,day,hs,aws,edition) AS (VALUES """+values+""")
          SELECT w.old_id,w.day AS old_day,w.home AS old_home,w.away AS old_away,w.hs AS old_hs,w.aws AS old_as,
                 m.id,m.competition_season_id,m.season_id,m.match_date,m.kickoff_at,m.status,m.home_team_id,h.name AS home,
                 m.away_team_id,a.name AS away,m.home_score,m.away_score,m.revision,m.first_finished_at,m.updated_at,m.source,
                 cs.cup_key,cs.archive_key,c.name AS competition,h.merged_into AS home_merged,a.merged_into AS away_merged
          FROM w JOIN core.matches m ON m.id=w.old_id OR
            ((m.home_team_id=w.home AND m.away_team_id=w.away OR m.home_team_id=w.away AND m.away_team_id=w.home)
             AND m.match_date BETWEEN w.day-31 AND w.day+31)
          JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
          JOIN core.competitions c ON c.id=cs.competition_id
          LEFT JOIN core.teams h ON h.id=m.home_team_id LEFT JOIN core.teams a ON a.id=m.away_team_id
          ORDER BY w.old_id,m.match_date,m.id"""
        found=get('global_facts',q,args)
        candidates=sorted(set(ids+[r[6] for r in found]))
        get('provider_ids',"SELECT entity_type,entity_id,provider,provider_key,is_current FROM core.provider_ids WHERE entity_type='match' AND entity_id=ANY(%s) ORDER BY entity_id,provider,provider_key",(candidates,))
        get('elo_all_ids',"SELECT match_id,season_id,team_id,run_id,kickoff_at,elo_before,elo_after,expected,result FROM agg.team_elo WHERE match_id=ANY(%s) ORDER BY match_id,team_id",(candidates,))
        get('team_names',"SELECT id,name,merged_into FROM core.teams WHERE id=ANY(%s) ORDER BY id",(sorted({r[n] for r in WITNESSES for n in (1,2)}),))
        get('levels_runs',"SELECT to_jsonb(r) AS row FROM agg.calc_runs r WHERE kind='levels' AND cohort_definition IN ('season:2025','season:2026') ORDER BY id DESC LIMIT 30")
        get('power_runs',"SELECT to_jsonb(r) AS row FROM agg.power_runs r WHERE kind='elo' ORDER BY id DESC LIMIT 10")
        get('collect_runs',"SELECT to_jsonb(r) AS row FROM ops.source_runs r WHERE source='open_matchday' ORDER BY scope")
        get('native_clock',"""SELECT m.season_id,max(m.updated_at) FILTER(WHERE m.status='finished') AS finished_update,
             max(m.kickoff_at) FILTER(WHERE m.kickoff_at<=%s) AS last_kickoff,count(*) FILTER(WHERE m.status='finished') AS finished
             FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
             WHERE cs.cup_key IS NULL AND cs.archive_key IS NULL AND m.season_id IN(2025,2026) GROUP BY m.season_id""",(at,))
        out['due_seasons']=worker.due_seasons(db,at)
        pairs,examined=identity.pairs(db);out['identity_pairs']=pairs
        needle='cs.cup_key\nFROM core.matches m'
        q=power.ELO_MATCHES.replace(needle,'cs.cup_key,m.competition_season_id\nFROM core.matches m')
        assert q != power.ELO_MATCHES
        raw=db.execute(q+' LIMIT 250001').fetchall();assert len(raw)<=250000
        merge={a:b for a,b,*_ in pairs};kept=power.elo_matches(power.merged_rows(raw,merge))
        target_ids=set(candidates)
        out['eligible_candidate_rows']=[r for r in kept if r[0] in target_ids]
        out['eligible_total']=len(kept)
        out['elo_selection_sql']=q
        return out
