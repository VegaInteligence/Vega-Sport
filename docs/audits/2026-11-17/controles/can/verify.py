"""Verify match alignment, per-side Elo, substitutions, roles and score coverage from the CSVs."""
import csv
from collections import Counter, defaultdict
from pathlib import Path

folder=Path(__file__).resolve().parent
def read(name):return list(csv.DictReader((folder/name).open()))
matches={r["id"]:r for r in read("matches-rds.csv")}
sources={r["key"]:r for r in read("sources-espn.csv")}
assert len(matches)==len(sources)==156
sides={}; by_match=defaultdict(set)
for r in read("sides-espn.csv"):
    g=matches[r["rds_match"]]
    assert (g["match_date"],g["edition"],g["status"])==(r["day"],r["edition"],"finished")
    assert sources["ESPN-"+r["espn_event"]]["status"]=="200"
    orientation="home" if g["home_team_id"]==r["rds_team"] else "away"
    assert (g[orientation+"_team_id"],g[orientation+"_score"])==(r["rds_team"],r["espn_score"])
    assert set(g["elo_teams"].split("|"))=={g["home_team_id"],g["away_team_id"]}
    assert all(int(g[k])==0 for k in ("team_sheets","lineups","stats","halves","advanced","events","shots","player_intermediates","player_grades"))
    source_key=(r["espn_event"],r["espn_team"])
    assert source_key not in sides
    sides[source_key]=r
    by_match[g["id"]].add(r["rds_team"])
assert len(sides)==312 and set(matches)==set(by_match) and all(len(v)==2 for v in by_match.values())
roles=defaultdict(dict); incoming=set(); outgoing=set(); count=defaultdict(Counter)
for r in read("registrations-espn.csv"):
    k=(r["espn_event"],r["espn_team"]); p=r["espn_player"]; side=sides[k]
    assert (r["rds_match"],r["rds_team"],r["edition"])==(side["rds_match"],side["rds_team"],side["edition"])
    assert p not in roles[k] and r["role"] in ("starter","entered","listed")
    roles[k][p]=r["role"]; count[r["edition"]][r["role"]]+=1
    if r["role"]=="entered": incoming.add((*k,p))
    if r["subbed_out"]=="1":outgoing.add((*k,p))
assert roles.keys()==sides.keys() and all(Counter(v.values())["starter"]==11 for v in roles.values())
events=read("substitutions-espn.csv")
assert len(events)==len({(r["espn_event"],r["espn_substitution"]) for r in events})==1354
for field,expected in (("incoming",incoming),("outgoing",outgoing)):
    assert {(r["espn_event"],r["espn_team"],r[field]) for r in events}==expected
actual={e:(v["starter"],v["entered"],v["listed"]) for e,v in count.items()}
assert actual=={"53152":(1144,423,753),"53155":(1144,463,767),"53156":(1144,468,1059)}
for k,v in sorted(actual.items()):print(k,"starters",v[0],"entrants",v[1],"appeared",sum(v[:2]),"unused",v[2])
print("156 finished, 312 own Elo, 4786 observed participations, 0 stored player grades, 1354 substitutions")
