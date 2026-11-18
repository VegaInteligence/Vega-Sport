"""Read four real match subjects. All production traffic uses signed GETs via the statarena profile."""
from origin import concurrent,get,json,out
matches={
    'm_4GBxjP':('p_3g5SiT','p_49Ge47'),  # Miguel Belem, Ben Old
    'm_21GTbJ':('p_3QGh4v','p_4PIWyK'),  # Oscar and Emil Hojlund
}
cameos={'m_21vqiJ':'p_1FvzRt','m_0mceOR':'p_2jnb4H'}
routes=['api/matches/'+m+'/'+s for m in matches for s in ('events','shots','players','lineups')]
routes+=['api/rankings/match?match='+m for m in cameos]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=dict(zip(routes,pool.map(get,routes),strict=True))
def bodies(m,k):
    receipt,body=results['api/matches/'+m+'/'+k]
    assert receipt['status']==200
    return body
def has_id(value,pid):
    if isinstance(value,list): return any(has_id(x,pid) for x in value)
    if isinstance(value,dict): return any(has_id(x,pid) for x in value.values())
    return value==pid
rows=[]
for m,pair in matches.items():
    ev=bodies(m,'events')['events']
    shots=[s for g in bodies(m,'shots')['periods'] for s in g['shots']]
    for p in pair:
        rows.append(dict(match=m,player=p,in_lineup=has_id(bodies(m,'lineups'),p),
            in_players=any(r['player']['id']==p for r in bodies(m,'players')),
            events=[(x.get('minute'),x.get('event_type'),x.get('player',{}).get('id'),x.get('sub_in_player',{}).get('id')) for x in ev if has_id(x,p)],
            shots=[(s.get('minute'),s.get('minute_added'),s.get('event_type')) for s in shots if s.get('player',{}).get('id')==p]))
assert not rows[0]['in_lineup'] and not rows[0]['in_players'] and (51,'goal','p_3g5SiT',None) in rows[0]['events']
assert rows[1]['in_lineup'] and rows[1]['in_players'] and any(x[0]==51 for x in rows[1]['shots'])
assert not rows[2]['in_lineup'] and not rows[2]['in_players'] and any(x[0]==90 for x in rows[2]['shots'])
assert rows[3]['in_lineup'] and rows[3]['in_players'] and any(x[0]==86 for x in rows[3]['events'])
ranks=[]
for m,p in cameos.items():
    receipt,body=results['api/rankings/match?match='+m]
    g=[x for x in body['grades'] if x['playerId']==p]
    assert receipt['status']==200 and len(g)==1 and g[0]['grade'] is None
    ranks.append(g[0])
res={'actor_observations':rows,'ranking_rows':ranks,'receipts':[r[0] for r in results.values()]}
(out/'actor-ranking.json').write_text(json.dumps(res,indent=2)+'\n')
print(json.dumps({'actor_observations':rows,'ranking_grades':[row['grade'] for row in ranks]},indent=2))

