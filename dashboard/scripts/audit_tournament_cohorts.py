#!/usr/bin/env python3
"""Read-only reconciliation of native tournament seasons and published AWS rows."""
import json
import os
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
import psycopg
from football_seasons import tournament_kind, fixture_sporting_season

def main():
    parsed=urlsplit(os.environ["DATABASE_URL"])
    if parsed.path!="/statarena_prod" or parse_qs(parsed.query).get("sslmode")!=["verify-full"] or not parsed.hostname.endswith(".us-east-2.rds.amazonaws.com"):
        raise SystemExit("Only the verified AWS RDS read-only target is supported")
    with psycopg.connect(os.environ["DATABASE_URL"],autocommit=True,
                         options="-c default_transaction_read_only=on -c statement_timeout=12000") as db:
        db.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        leagues=db.execute("SELECT id,name FROM statarena_app.competitions").fetchall()
        candidates=[(league,name) for league,name in leagues if tournament_kind(league,name)]
        if not any(league=="l_1XLtP0" for league,_ in candidates):
            candidates.append(("l_1XLtP0","World Cup"))
        results=[]
        for league,name in candidates:
            raw=db.execute("""
              SELECT id,season,day,body->>'season',
                     COALESCE(body#>>'{league,name}',body->>'league_name',%s)
              FROM statarena.fixtures WHERE league_id=%s ORDER BY id LIMIT 3000
            """,(name,league)).fetchall()
            proposed=[]
            current=Counter()
            for mid,season,day,source,native_name in raw:
                current[season]+=1
                if not source: continue
                normalized=fixture_sporting_season({
                    "season":source,"date":str(day or ""),
                    "league":{"id":league,"name":native_name or name},
                })
                if normalized != season:
                    proposed.append({"match_id":mid,"current":season,"proposed":normalized,"native":source})
            published=db.execute("""
              SELECT season, count(*) FROM statarena_app.matches
              WHERE league_id=%s GROUP BY season ORDER BY season
            """,(league,)).fetchall()
            published_fixtures=db.execute("""
              SELECT season,count(*) FROM statarena_app.fixtures
              WHERE league_id=%s GROUP BY season ORDER BY season
            """,(league,)).fetchall()
            scopes=db.execute("""
              SELECT season FROM statarena_app.partitions
              WHERE league_id=%s ORDER BY season
            """,(league,)).fetchall()
            results.append({
                "league":league,"name":name,"kind":tournament_kind(league,name),
                "staging_fixtures":len(raw),"staging_seasons":dict(current),
                "mismatch_count":len(proposed),"sample":proposed[:10],
                "published_matches":dict(published),
                "published_fixtures":dict(published_fixtures),
                "published_partitions":[x[0] for x in scopes]
            })
        db.execute("COMMIT")
    report={"checked_at_utc":datetime.now(timezone.utc).isoformat(),
            "database":"statarena_prod","read_only":True,"leagues":results}
    with open("tournament-audit.json","w") as file:
        json.dump(report,file,indent=2,ensure_ascii=False)
    print(json.dumps({
        "read_only":True,
        "tournaments":len(results),
        "mismatches":sum(x["mismatch_count"] for x in results),
        "summaries":[{"league":r["league"],"name":r["name"],"staging":r["staging_seasons"],
                      "published":r["published_matches"],"mismatches":r["mismatch_count"]}
                     for r in results],
    },ensure_ascii=False))

if __name__=="__main__":
    main()
