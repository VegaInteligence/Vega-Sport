#!/usr/bin/env python3
"""Read-only audit of year-only published AWS seasons; no business row values."""
import json
import os
from datetime import datetime, timezone
import psycopg

QUERY = """
SELECT p.season,p.league_id,
  (SELECT count(*) FROM statarena_app.matches m
   WHERE m.season=p.season AND m.league_id=p.league_id) AS matches,
  (SELECT count(*) FROM statarena_app.fixtures f
   WHERE f.season=p.season AND f.league_id=p.league_id) AS fixtures,
  (SELECT count(*) FROM statarena_app.appearances a
   WHERE a.season=p.season AND a.league_id=p.league_id) AS appearances,
  (SELECT count(*) FROM statarena_app.team_seasons t
   WHERE t.season=p.season AND t.league_id=p.league_id) AS team_seasons,
  (SELECT count(*) FROM statarena_app.partition_bootstrap_sources b
   WHERE b.season=p.season AND b.league_id=p.league_id) AS bootstrap_sources,
  (SELECT count(*) FROM statarena_app.partition_notes n
   WHERE n.season=p.season AND n.league_id=p.league_id) AS notes,
  (SELECT count(*) FROM statarena_app.partition_counts c
   WHERE c.season=p.season AND c.league_id=p.league_id AND c.value<>0) AS nonzero_counts,
  (SELECT count(*) FROM statarena_app.partition_metrics r
   WHERE r.season=p.season AND r.league_id=p.league_id) AS metric_definitions,
  (SELECT count(*) FROM statarena_app.matches m
   WHERE m.league_id=p.league_id
     AND m.season=(p.season||'/'||(p.season::int+1)::text)) AS next_season_matches,
  (SELECT count(*) FROM statarena_app.fixtures f
   WHERE f.league_id=p.league_id
     AND f.season=(p.season||'/'||(p.season::int+1)::text)) AS next_season_fixtures,
  EXISTS(SELECT 1 FROM statarena_app.partitions p2
   WHERE p2.season=(p.season||'/'||(p.season::int+1)::text) AND p2.league_id=p.league_id) AS next_partition,
  (SELECT count(*) FROM statarena_app.competition_seasons cs
   WHERE cs.competition_id=p.league_id AND cs.season=p.season
     AND cs.sample_matches<>0) AS nonzero_catalog,
  (SELECT count(*) FROM statarena_app.publication_jobs j
   WHERE j.season=p.season AND j.league_id=p.league_id) AS pending_jobs
FROM statarena_app.partitions p
WHERE p.season ~ '^[0-9]{4}$'
ORDER BY p.season,p.league_id
"""

def main():
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10,
                         options="-c default_transaction_read_only=on -c statement_timeout=10000") as db:
        if db.execute("SELECT current_database()").fetchone()[0] != "statarena_prod":
            raise RuntimeError("Unexpected RDS database")
        rows = db.execute(QUERY).fetchall()
    names=["season","league","matches","fixtures","appearances","team_seasons",
           "bootstrap_sources","notes","nonzero_counts","metric_definitions",
           "next_season_matches","next_season_fixtures","next_partition",
           "nonzero_catalog","pending_jobs"]
    entries=[dict(zip(names,row)) for row in rows]
    for e in entries:
        e["empty_alias_candidate"] = bool(
            not any(e[k] for k in ("matches","fixtures","appearances","team_seasons",
                "bootstrap_sources","notes","nonzero_counts","nonzero_catalog","pending_jobs"))
            and e["next_partition"]
            and (e["next_season_matches"] or e["next_season_fixtures"])
        )
    out={"checked_at":datetime.now(timezone.utc).isoformat(),
         "read_only":True,"year_only_partitions":len(entries),
         "empty_alias_candidates":sum(e["empty_alias_candidate"] for e in entries),
         "entries":entries}
    with open("year-alias-audit.json","w") as f:json.dump(out,f,indent=2)
    print(json.dumps({"year_only_partitions":len(entries),
                      "empty_alias_candidates":out["empty_alias_candidates"],
                      "retained":[x for x in entries if not x["empty_alias_candidate"]]},default=str))

if __name__=="__main__":
    main()
