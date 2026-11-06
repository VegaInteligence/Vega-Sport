"""Expose the stored MLS calendar season under the dashboard season bucket."""
import hashlib
import re
from psycopg.types.json import Jsonb
from aws_store import canonical

MLS_ID = "l_0eg6C9"


def publish_mls_fixture_alias(store, league_id, label, fixtures):
    if league_id != MLS_ID or not re.fullmatch(r"\d{4}/\d{4}", label):
        return False
    year, end = label.split("/")
    if int(end) != int(year) + 1 or not fixtures:
        return False
    # Only alias a partition when every row carries the provider's native year.
    if any(str(row.get("season") or "") != year for row in fixtures):
        return False
    league = fixtures[0].get("league") or {"id": league_id, "name": "MLS"}
    payload = {"data": {"league": league, "matches": fixtures}}
    digest = hashlib.sha256(canonical(payload).encode()).hexdigest()
    ref = store.put_json(
        f"raw/neon/league-aliases/{league_id}/{year}-{digest[:24]}.json.gz",
        payload,
    )
    store.db.execute(
        "insert into statarena.resources(endpoint,params,status,ref,error) values(%s,%s,200,%s,null) on conflict(endpoint,params) do update set status=200,ref=excluded.ref,error=null,updated_at=now()",
        ("/leagues/" + league_id + "/matches", canonical({"season": label, "status": "all"}), Jsonb(ref)),
    )
    return True
