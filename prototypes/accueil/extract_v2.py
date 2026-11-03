"""Données de la maquette d'accueil v2 (saison 2026/27, Top 7 + coupes d'Europe).
Usage : python3 extract_v2.py <racine du dépôt> <sortie.json> [AAAA-MM-JJ]"""
import json, gzip, sys, collections
ROOT, OUT = sys.argv[1], sys.argv[2]
TODAY = sys.argv[3] if len(sys.argv) > 3 else "2026-11-02"
WEEK_START = "2026-10-27"
FOCUS = ["l_4WFCIZ","l_0ErfuF","l_1Isor4","l_0ALvwF","l_3FJFUl","l_4QexZg","l_4H43wr","l_0bfbkO","l_38d9HA","l_2WZ2tt"]
BIG5 = FOCUS[:5]; DOMESTIC = FOCUS[:7]; UEFA = FOCUS[7:]
SHORT = {"l_4WFCIZ":"Premier League","l_0ErfuF":"LaLiga","l_1Isor4":"Bundesliga","l_0ALvwF":"Serie A","l_3FJFUl":"Ligue 1","l_4QexZg":"Liga Portugal","l_4H43wr":"Eredivisie","l_0bfbkO":"Ligue des champions","l_38d9HA":"Ligue Europa","l_2WZ2tt":"Ligue Conférence"}
ABBR = {"l_4WFCIZ":"PL","l_0ErfuF":"LIGA","l_1Isor4":"BUN","l_0ALvwF":"SA","l_3FJFUl":"L1","l_4QexZg":"POR","l_4H43wr":"ERE","l_0bfbkO":"LDC","l_38d9HA":"LE","l_2WZ2tt":"LC"}
GAMES = {"l_4WFCIZ":38,"l_0ErfuF":38,"l_1Isor4":34,"l_0ALvwF":38,"l_3FJFUl":34,"l_4QexZg":34,"l_4H43wr":34}
FEAT = set("t_1gkhxH t_4R934X t_0BrMnM t_0UCNPX t_2I313i t_2eQl9k t_4A7FfD t_41iFW3 t_2s2eyG t_0xMlRV t_13gLEF t_0tnX1I t_4NZcri t_32jSEF t_3NIiXl t_1cpjqO t_386iz1 t_2lHR8t t_4ZwKDn t_3CPHHF t_1DYf1D t_2toJRF t_0RhqmW t_0Mzm1V t_0dVrhE t_1TAfIz t_3t08JG t_1jOgDP t_4KvHFN".split())

def table(t):
    keys, dic = t["keys"], t.get("dictionaries", {})
    return [{k: (dic[str(i)][r[i]] if str(i) in dic and isinstance(r[i], int) else r[i]) for i, k in enumerate(keys)} for r in t["rows"]]

idx = json.load(open(ROOT + "/data/computed/dashboard/index.json"))
season = next(x for x in idx["seasons"] if x["id"] == "2026/2027")
data = {}
for c in season["chunks"]:
    if c["leagueId"] in FOCUS:
        d = json.load(gzip.open(ROOT + "/data/" + c["path"]))
        data[c["leagueId"]] = {k: table(v) for k, v in d["tables"].items() if k != "team_statistics"}
        data[c["leagueId"]]["img"] = c["competitions"][0]["imageUrl"]

teamimg, players, matches = {}, {}, {}
for lid in FOCUS:
    for t in data[lid]["teams"]: teamimg[t["id"]] = t["imageUrl"]
    for p in data[lid]["players"]: players[p["playerId"]] = {"name": p["name"], "img": p["imageUrl"]}
    for m in data[lid]["matches"]: matches[m["id"]] = m

def team(t, extra=None):
    o = {"id": t["id"], "name": t["name"], "img": t.get("imageUrl") or t.get("image_url") or teamimg.get(t["id"]), "big": t["id"] in FEAT}
    if extra: o.update(extra)
    return o

out = {"today": TODAY, "leagues": [{"id": l, "name": SHORT[l], "abbr": ABBR[l], "img": data[l]["img"]} for l in FOCUS]}

# --- standings, title race, form, team rank -------------------------------------------------
standings, race, rank_of, form_of, streaks = {}, {}, {}, {}, []
for lid in DOMESTIC:
    fin = sorted([f for f in data[lid]["fixtures"] if f["status"] == "finished" and f["score_home"] is not None], key=lambda f: f["time_utc"] or f["date"])
    tab = collections.defaultdict(lambda: {"P":0,"W":0,"D":0,"L":0,"GF":0,"GA":0,"form":[],"cum":[]})
    for f in fin:
        for side, gf, ga in ((f["home_team"], f["score_home"], f["score_away"]), (f["away_team"], f["score_away"], f["score_home"])):
            r = tab[side["id"]]; r["name"] = side["name"]; r["img"] = side["image_url"]
            r["P"] += 1; r["GF"] += gf; r["GA"] += ga
            res = "W" if gf > ga else "D" if gf == ga else "L"; r[res] += 1; r["form"].append(res)
            r["cum"].append(3*r["W"] + r["D"])
    rows = []
    for tid, r in tab.items():
        r["id"] = tid; r["Pts"] = 3*r["W"] + r["D"]; rows.append(r)
    rows.sort(key=lambda r: (-r["Pts"], -(r["GF"]-r["GA"]), -r["GF"]))
    for i, r in enumerate(rows):
        rank_of[r["id"]] = (i+1, lid); form_of[r["id"]] = r["form"][-5:]
        streak = 0
        for x in reversed(r["form"]):
            if x != "W": break
            streak += 1
        streaks.append({"name": r["name"], "img": r["img"], "lid": lid, "streak": streak, "rank": i+1})
    standings[lid] = [{k: r[k] for k in ("id","name","img","P","W","D","L","GF","GA","Pts")} | {"form": r["form"][-5:]} for r in rows[:8]]
    race[lid] = {"played": max(r["P"] for r in rows), "games": GAMES[lid],
                 "teams": [{"name": r["name"], "img": r["img"], "cum": r["cum"]} for r in rows[:4]]}
out["standings"], out["race"] = standings, race
streaks.sort(key=lambda s: (-s["streak"], s["rank"]))
out["streak"] = streaks[0]

# --- results & upcoming -------------------------------------------------------------------
res, up = [], []
for lid in FOCUS:
    for m in data[lid]["matches"]:
        if m["status"] == "finished" and WEEK_START <= m["date"] <= TODAY and m["home"].get("score") is not None:
            res.append({"id": m["id"], "lid": lid, "date": m["date"], "t": m["timeUtc"],
                        "home": team(m["home"], {k: m["home"].get(k) for k in ("score","xg","shots","shotsOnTarget","possession")}),
                        "away": team(m["away"], {k: m["away"].get(k) for k in ("score","xg","shots","shotsOnTarget","possession")})})
    for f in data[lid]["fixtures"]:
        if f["status"] == "not_started" and TODAY <= f["date"] <= "2026-11-09":
            h, a = team(f["home_team"]), team(f["away_team"])
            for t in (h, a):
                if t["id"] in rank_of: t["rank"] = rank_of[t["id"]][0]; t["form"] = form_of[t["id"]]
            up.append({"id": f["id"], "lid": lid, "date": f["date"], "t": f["time_utc"], "home": h, "away": a})
res.sort(key=lambda r: r["t"] or r["date"], reverse=True); up.sort(key=lambda r: r["t"] or r["date"])
out["results"], out["upcoming"] = res, up

# --- featured match: big-vs-big in a top-5 league, best combined league rank ----------------
def rk(t): return rank_of.get(t["id"], (20,))[0]
cands = [m for m in res if m["home"]["big"] and m["away"]["big"] and m["lid"] in BIG5]
feat = min(cands, key=lambda m: (rk(m["home"]) + rk(m["away"]), -(m["home"]["xg"] or 0) - (m["away"]["xg"] or 0)))
fm = matches[feat["id"]]
shots = [s for s in data[feat["lid"]]["shots"] if s["matchId"] == feat["id"]]
feat["shots"] = sorted([{"m": s["minute"], "x": s["x"], "y": s["y"], "xg": s["xg"], "goal": bool(s["isGoal"]), "own": bool(s["isOwnGoal"]),
                  "on": bool(s["isOnTarget"]), "side": "h" if s["teamId"] == feat["home"]["id"] else "a", "p": s["playerName"], "sit": s["situation"]} for s in shots], key=lambda s: s["m"] or 0)
for t in (feat["home"], feat["away"]):
    t["rank"] = rk(t); t["form"] = form_of.get(t["id"], [])
# best player of the featured match
fperf = [p for p in data[feat["lid"]]["performances"] if p["matchId"] == feat["id"] and p["rating"] is not None]
fperf.sort(key=lambda p: -p["rating"])
feat["motm"] = [{"name": players[p["playerId"]]["name"], "img": players[p["playerId"]]["img"], "team": p["team"], "rating": p["rating"], "g": p["goals"] or 0, "a": p["assists"] or 0} for p in fperf[:3]]
out["featured"] = feat

# --- player aggregates -------------------------------------------------------------------
agg = collections.defaultdict(lambda: {"min":0,"g":0,"a":0,"xg":0.0,"xa":0.0,"rs":0.0,"rn":0,"apps":0,"team":None,"teamId":None})
week = []
for lid in FOCUS:
    for p in data[lid]["performances"]:
        mins = p["minutes"] or 0
        if mins <= 0: continue
        A = agg[p["playerId"]]
        A["min"] += mins; A["g"] += p["goals"] or 0; A["a"] += p["assists"] or 0
        A["xg"] += p["xg"] or 0; A["xa"] += p["xa"] or 0; A["apps"] += 1
        if p["rating"] is not None: A["rs"] += p["rating"]*mins; A["rn"] += mins
        if lid in DOMESTIC or A["team"] is None: A["team"], A["teamId"] = p["team"], p["teamId"]
        if WEEK_START <= p["date"] <= TODAY and mins >= 60 and p["rating"] is not None:
            m = matches.get(p["matchId"])
            week.append({"pid": p["playerId"], "team": p["team"], "teamImg": teamimg.get(p["teamId"]), "lid": lid, "date": p["date"],
                         "rating": p["rating"], "g": p["goals"] or 0, "a": p["assists"] or 0, "xg": p["xg"], "xa": p["xa"], "min": mins,
                         "shots": p["shots"], "chances": p["chancesCreated"], "touches": p["touches"], "duels": p["duelsWon"], "def": p["defensiveActions"],
                         "home": m and m["home"]["name"], "away": m and m["away"]["name"],
                         "score": m and f'{m["home"]["score"]}–{m["away"]["score"]}', "matchId": p["matchId"]})
def pl(pid, A):
    return {"pid": pid, **players[pid], "team": A["team"], "teamImg": teamimg.get(A["teamId"]), "min": A["min"], "apps": A["apps"],
            "g": A["g"], "a": A["a"], "xg": round(A["xg"], 2), "xa": round(A["xa"], 2), "rating": round(A["rs"]/A["rn"], 2) if A["rn"] else None}
week.sort(key=lambda r: -r["rating"])
seen, top = set(), []
for w in week:
    if w["pid"] in seen: continue
    seen.add(w["pid"]); w.update(players[w["pid"]]); w["season"] = pl(w["pid"], agg[w["pid"]]); top.append(w)
out["top"] = top[:12]
# player of the week: best rating in a top-5 league or UEFA, the rest stay as runners-up
out["potw"] = next(w for w in top if w["lid"] in BIG5 + UEFA)
def lead(key, n=8, minmin=0, cond=lambda A: True):
    rows = [(pid, A) for pid, A in agg.items() if A["min"] >= minmin and cond(A)]
    rows.sort(key=key)
    return [pl(pid, A) for pid, A in rows[:n]]
L = out["leaders"] = {}
L["goals"] = lead(lambda x: (-x[1]["g"], -x[1]["xg"]))
L["assists"] = lead(lambda x: (-x[1]["a"], -x[1]["xa"]))
L["rating"] = lead(lambda x: -(x[1]["rs"]/x[1]["rn"] if x[1]["rn"] else 0), n=10, minmin=700)
L["xgxa"] = lead(lambda x: -(x[1]["xg"] + x[1]["xa"]))
L["clinical"] = lead(lambda x: -(x[1]["g"] - x[1]["xg"]), n=5, cond=lambda A: A["g"] >= 5)
L["wasteful"] = lead(lambda x: (x[1]["g"] - x[1]["xg"]), n=5, cond=lambda A: A["xg"] >= 4)

# --- number of the week: biggest margin ----------------------------------------------------
big = max(res, key=lambda m: (abs(m["home"]["score"] - m["away"]["score"]), m["home"]["score"] + m["away"]["score"]))
out["bigwin"] = big
out["stats"] = {"matches": sum(1 for l in FOCUS for m in data[l]["matches"] if m["status"] == "finished"),
                "weekMatches": len(res), "weekGoals": sum(m["home"]["score"] + m["away"]["score"] for m in res),
                "weekXg": round(sum((m["home"]["xg"] or 0) + (m["away"]["xg"] or 0) for m in res), 1),
                "players": sum(1 for A in agg.values() if A["min"] > 0)}
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print("ok", len(json.dumps(out)))
print("featured", feat["home"]["name"], feat["home"]["score"], feat["away"]["score"], feat["away"]["name"], len(feat["shots"]), feat["motm"][0]["name"])
print("potw", out["potw"]["name"], out["potw"]["rating"], out["potw"]["g"], out["potw"]["a"])
print("bigwin", big["home"]["name"], big["home"]["score"], big["away"]["score"], big["away"]["name"])
print("streak", out["streak"]); print("stats", out["stats"])
print("clinical", [(p["name"], p["g"], p["xg"]) for p in L["clinical"]]); print("wasteful", [(p["name"], p["g"], p["xg"]) for p in L["wasteful"]])
for l, r in race.items(): print(l, r["played"], [(t["name"], t["cum"][-1]) for t in r["teams"]])
