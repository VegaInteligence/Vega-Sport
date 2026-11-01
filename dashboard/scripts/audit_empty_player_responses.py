#!/usr/bin/env python3
"""Recheck the player-list payloads observed empty in the 1 November audit."""
import json,time,urllib.error,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];ids='m_1ySYdb m_1F4Csk m_1DsZ5C m_1xeekl m_4RnUAZ m_1u036j m_3bqJOI m_1fzmOE m_34xCTa m_0Bnyfs m_0A37jP m_1ppWN3 m_40ApCs'.split();out=[]
for id in ids:
 try:
  with urllib.request.urlopen('https://statarena-analytics.vercel.app/api/pitchapi/matches/'+id+'/players',timeout=15) as response:
   data=json.load(response);out.append({'id':id,'status':response.status,'rows':len(data['data']) if isinstance(data.get('data'),list) else None})
 except urllib.error.HTTPError as e:out.append({'id':id,'status':e.code})
 time.sleep(.3)
report={'setup':'13 match IDs with stored 200 and empty player list; live STATARENA PitchAPI proxy.','command':'python3 dashboard/scripts/audit_empty_player_responses.py','expected':'Distinguish provider lists still empty from rows now available and failed checks.','results':out};(ROOT/'dashboard/outputs/pitchapi-coverage/empty-player-rechecks.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
