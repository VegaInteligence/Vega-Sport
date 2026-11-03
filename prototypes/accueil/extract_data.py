import json,gzip,sys,collections
ROOT=sys.argv[1]
FOCUS=["l_4WFCIZ","l_0ErfuF","l_1Isor4","l_0ALvwF","l_3FJFUl","l_4QexZg","l_4H43wr","l_0bfbkO","l_38d9HA","l_2WZ2tt"]
idx=json.load(open(ROOT+'/data/computed/dashboard/index.json'))
s=[x for x in idx['seasons'] if x['id']=='2026/2027'][0]
def table(t):
    keys=t['keys'];dic=t.get('dictionaries',{})
    out=[]
    for r in t['rows']:
        o={}
        for i,k in enumerate(keys):
            v=r[i]
            if str(i) in dic and isinstance(v,int): v=dic[str(i)][v]
            o[k]=v
        out.append(o)
    return out
data={}
for c in s['chunks']:
    if c['leagueId'] not in FOCUS: continue
    d=json.load(gzip.open(ROOT+'/data/'+c['path']))
    data[c['leagueId']]={k:table(v) for k,v in d['tables'].items() if k!='shots' and k!='team_statistics'}
    data[c['leagueId']]['imageUrl']=c['competitions'][0]['imageUrl']
l=None

FEAT=set("t_1gkhxH t_4R934X t_0BrMnM t_0UCNPX t_2I313i t_2eQl9k t_4A7FfD t_41iFW3 t_2s2eyG t_0xMlRV t_13gLEF t_0tnX1I t_4NZcri t_32jSEF t_3NIiXl t_1cpjqO t_386iz1 t_2lHR8t t_4ZwKDn t_3CPHHF t_1DYf1D t_2toJRF t_0RhqmW t_0Mzm1V t_0dVrhE t_1TAfIz t_3t08JG t_1jOgDP t_4KvHFN".split())
TODAY="2026-11-02"
SHORT={"l_4WFCIZ":"Premier League","l_0ErfuF":"LaLiga","l_1Isor4":"Bundesliga","l_0ALvwF":"Serie A","l_3FJFUl":"Ligue 1","l_4QexZg":"Liga Portugal","l_4H43wr":"Eredivisie","l_0bfbkO":"Ligue des champions","l_38d9HA":"Ligue Europa","l_2WZ2tt":"Ligue Conférence"}
out={"leagues":[],"results":[],"upcoming":[],"standings":{},"top":[],"leaders":{}}
teamimg={}
players={}
for lid in FOCUS:
    L=data[lid]
    out["leagues"].append({"id":lid,"name":SHORT[lid],"img":L["imageUrl"]})
    for t in L["teams"]: teamimg[t["id"]]=t["imageUrl"]
    for p in L["players"]: players[p["playerId"]]={"name":p["name"],"img":p["imageUrl"]}
def team(t): return {"id":t["id"],"name":t["name"],"img":t.get("imageUrl") or t.get("image_url"),"big":t["id"] in FEAT}
matchinfo={}
for lid in FOCUS:
    L=data[lid]
    for m in L["matches"]:
        matchinfo[m["id"]]=m
        if m["status"]=="finished" and "2026-10-27"<=m["date"]<=TODAY and m["home"].get("score") is not None:
            h,a=team(m["home"]),team(m["away"])
            h["score"]=m["home"]["score"];a["score"]=m["away"]["score"]
            h["xg"]=m["home"].get("xg");a["xg"]=m["away"].get("xg")
            out["results"].append({"id":m["id"],"lid":lid,"date":m["date"],"t":m["timeUtc"],"home":h,"away":a})
    # upcoming
    for f in L["fixtures"]:
        if f["status"]=="not_started" and TODAY<=f["date"]<="2026-11-09":
            out["upcoming"].append({"id":f["id"],"lid":lid,"date":f["date"],"t":f["time_utc"],"home":team(f["home_team"]),"away":team(f["away_team"])})
    # standings for domestic
    if lid in ("l_0bfbkO","l_38d9HA","l_2WZ2tt"): continue
    tab=collections.defaultdict(lambda:{"P":0,"W":0,"D":0,"L":0,"GF":0,"GA":0,"form":[]})
    fin=sorted([f for f in L["fixtures"] if f["status"]=="finished" and f["score_home"] is not None],key=lambda f:f["time_utc"] or f["date"])
    for f in fin:
        for side,opp,gf,ga in ((f["home_team"],f["away_team"],f["score_home"],f["score_away"]),(f["away_team"],f["home_team"],f["score_away"],f["score_home"])):
            r=tab[side["id"]];r["name"]=side["name"];r["img"]=side["image_url"]
            r["P"]+=1;r["GF"]+=gf;r["GA"]+=ga
            res="W" if gf>ga else "D" if gf==ga else "L";r[res]+=1;r["form"].append(res)
    rows=[]
    for tid,r in tab.items():
        r["Pts"]=3*r["W"]+r["D"];r["id"]=tid;r["form"]=r["form"][-5:];rows.append(r)
    rows.sort(key=lambda r:(-r["Pts"],-(r["GF"]-r["GA"]),-r["GF"]))
    out["standings"][lid]=rows[:6]
# performances
agg=collections.defaultdict(lambda:{"min":0,"g":0,"a":0,"xg":0,"xa":0,"rs":0,"rn":0,"apps":0,"team":None})
week=[]
for lid in FOCUS:
    for p in data[lid]["performances"]:
        mins=p["minutes"] or 0
        if mins<=0: continue
        A=agg[p["playerId"]];A["min"]+=mins;A["g"]+=p["goals"] or 0;A["a"]+=p["assists"] or 0
        A["xg"]+=p["xg"] or 0;A["xa"]+=p["xa"] or 0;A["apps"]+=1
        if p["rating"] is not None: A["rs"]+=p["rating"]*mins;A["rn"]+=mins
        if lid not in ("l_0bfbkO","l_38d9HA","l_2WZ2tt") or A["team"] is None: A["team"]=p["team"];A["teamId"]=p["teamId"]
        if "2026-10-27"<=p["date"]<=TODAY and mins>=60 and p["rating"] is not None:
            m=matchinfo.get(p["matchId"])
            opp=None;score=None
            if m:
                home=m["home"]["id"]==p["teamId"];o=m["away"] if home else m["home"];opp=o["name"]
                score=f'{m["home"]["score"]}–{m["away"]["score"]}';
            week.append({"pid":p["playerId"],"team":p["team"],"teamImg":teamimg.get(p["teamId"]),"lid":lid,"date":p["date"],"rating":p["rating"],"g":p["goals"] or 0,"a":p["assists"] or 0,"xg":p["xg"],"min":mins,"opp":opp,"score":score,"home":m and m["home"]["name"],"away":m and m["away"]["name"],"matchId":p["matchId"]})
week.sort(key=lambda r:-r["rating"])
seen=set();top=[]
for w in week:
    if w["pid"] in seen: continue
    seen.add(w["pid"]);w.update(players[w["pid"]]);top.append(w)
    if len(top)>=10: break
out["top"]=top
def lead(key,n=8,minmin=0):
    rows=[(pid,A) for pid,A in agg.items() if A["min"]>=minmin]
    rows.sort(key=key)
    res=[]
    for pid,A in rows[:n]:
        res.append({"pid":pid,**players[pid],"team":A["team"],"teamImg":teamimg.get(A.get("teamId")),"min":A["min"],"g":A["g"],"a":A["a"],"xg":round(A["xg"],2),"xa":round(A["xa"],2),"rating":round(A["rs"]/A["rn"],2) if A["rn"] else None,"apps":A["apps"]})
    return res
out["leaders"]["goals"]=lead(lambda x:(-x[1]["g"],-x[1]["xg"]))
out["leaders"]["assists"]=lead(lambda x:(-x[1]["a"],-x[1]["xa"]))
out["leaders"]["rating"]=lead(lambda x:-(x[1]["rs"]/x[1]["rn"] if x[1]["rn"] else 0),minmin=700)
out["leaders"]["xgxa"]=lead(lambda x:-(x[1]["xg"]+x[1]["xa"]))
out["results"].sort(key=lambda r:r["t"] or r["date"],reverse=True)
out["upcoming"].sort(key=lambda r:r["t"] or r["date"])
out["stats"]={"matches":sum(1 for lid in FOCUS for m in data[lid]["matches"] if m["status"]=="finished"),"players":len([1 for A in agg.values() if A["min"]>0])}
json.dump(out,open(sys.argv[2],"w"),ensure_ascii=False,separators=(",",":"))
