#!/usr/bin/env python3
"""Durable, idempotent Daily Sync / Historical Backfill; Pitch is ingestion-only."""

import argparse, datetime as dt, gzip, hashlib, json, os, re, time, urllib.parse, urllib.request, urllib.error
from psycopg.types.json import Jsonb
from aws_store import Store, canonical
from functools import lru_cache

ENDPOINTS = [
    "",
    "shots",
    "momentum",
    "events",
    "players",
    "players/halves",
    "lineups",
    "h2h",
    "stats",
    "advanced",
    "advanced/players",
    "advanced/network",
    "heatmaps",
]
PRIORITY_CORE = {"": 0, "players": 1, "lineups": 2, "shots": 3, "stats": 4}
DAILY_DISCOVERY_PRIORITY = -32760
DAILY_MATCH_PRIORITY = -32750
DAILY_AUX_PRIORITY = -32740
DAILY_INVENTORY_PRIORITY = -32730
DAILY_TARGET_LEAGUES = ("l_0eg6C9", "l_0Lpz1f")
PULSE_DISCOVERY_PRIORITY = -32768
PULSE_MATCH_PRIORITY = -32767
PULSE_AUX_PRIORITY = -32766
PULSE_LOOKBACK_HOURS = 14
MATCH_READY_MINUTES = 135


def identities(value):
    found = set()

    def walk(v):
        if isinstance(v, str) and re.fullmatch("[ltpms]_[A-Za-z0-9]{6}", v):
            found.add(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(value)
    return found


def saved(store, row):
    if not row:
        return None
    value = store.json(row["path"])
    if "ordinal" in row:
        value = value[row["ordinal"]]
    if "documentId" in row:
        value = next(v for v in value if v["documentId"] == row["documentId"])
    value = value.get("observation", value.get("response", value))
    return value.get("data")


def matches(store, items, priority=3, enqueue_details=True):
    rows = []
    for m in items:
        if not isinstance(m, dict) or not re.fullmatch(
            "m_[A-Za-z0-9]{6}", m.get("id", "")
        ):
            continue
        league = (m.get("league") or {}).get("id") or m.get("league_id")
        if not league:
            continue
        season = str(m.get("season") or "")
        day = m.get("date") or str(m.get("time_utc") or "")[:10] or None
        rows.append(
            {
                "id": m["id"],
                "league_id": league,
                "season": season,
                "day": day,
                "status": m.get("status"),
                "body": m,
            }
        )
        if enqueue_details:
            for suffix in ENDPOINTS:
                store.enqueue(
                    "/matches/" + m["id"] + ("/" + suffix if suffix else ""),
                    priority=priority,
                )
            store.enqueue(
                "/matches/" + m["id"] + "/heatmaps",
                {"frame": "home_ltr"},
                priority=priority,
            )
    if rows:
        changed = store.db.execute(
            "insert into statarena.fixtures(id,league_id,season,day,status,body) select id,league_id,season,day,status,body from jsonb_to_recordset(%s) as r(id text,league_id text,season text,day date,status text,body jsonb) on conflict(id) do update set body=statarena.fixtures.body||excluded.body,league_id=excluded.league_id,season=case when excluded.season<>'' then excluded.season else statarena.fixtures.season end,day=coalesce(excluded.day,statarena.fixtures.day),status=excluded.status,updated_at=now() where statarena.fixtures.body is distinct from statarena.fixtures.body||excluded.body or (excluded.season<>'' and statarena.fixtures.season<>excluded.season) or statarena.fixtures.league_id<>excluded.league_id returning season,league_id",
            (Jsonb(rows),),
        ).fetchall()
        partitions = set(
            (season if "/" in season else season + "/" + str(int(season) + 1), league)
            for season, league in changed
            if re.fullmatch(r"\d{4}(?:/\d{4})?", season)
        )
        with store.db.cursor() as c:
            c.executemany(
                "insert into statarena.dirty_partitions(season,league_id) values(%s,%s) on conflict(season,league_id) do update set changed_at=now()",
                list(partitions),
            )


def enqueue_daily_match(store, match_id, pulse=False):
    for suffix in ENDPOINTS:
        store.enqueue(
            "/matches/" + match_id + ("/" + suffix if suffix else ""),
            priority=(PULSE_MATCH_PRIORITY if pulse else DAILY_MATCH_PRIORITY)
            if suffix in {"", "players"}
            else (PULSE_AUX_PRIORITY if pulse else DAILY_AUX_PRIORITY),
            force=True,
        )
    store.enqueue(
        "/matches/" + match_id + "/heatmaps",
        {"frame": "home_ltr"},
        priority=PULSE_AUX_PRIORITY if pulse else DAILY_AUX_PRIORITY,
        force=True,
    )


def enqueue_recent_matches(store, items, today=None):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    for match in items:
        if not isinstance(match, dict) or not re.fullmatch(r"m_[A-Za-z0-9]{6}", match.get("id", "")):
            continue
        raw = match.get("date") or str(match.get("time_utc") or "")[:10]
        try:
            day = dt.date.fromisoformat(raw)
        except (TypeError, ValueError):
            continue
        if today - dt.timedelta(days=3) <= day <= today + dt.timedelta(days=2):
            enqueue_daily_match(store, match["id"])


def enqueue_pulse_matches(store, items, now=None):
    """Refresh likely completed games from the previous 14 hours, across leagues."""
    now = now or dt.datetime.now(dt.timezone.utc)
    for match in items:
        if not isinstance(match, dict) or not re.fullmatch(r"m_[A-Za-z0-9]{6}", match.get("id", "")):
            continue
        status = str(match.get("status") or "").lower()
        if status in {"cancelled", "canceled", "postponed", "abandoned"}:
            continue
        try:
            kickoff = dt.datetime.fromisoformat(str(match.get("time_utc") or "").replace("Z", "+00:00"))
            if kickoff.tzinfo is None:
                raise ValueError("Kickoff has no timezone")
        except ValueError:
            # A finished match with no usable kickoff still gets one morning retry.
            try:
                day = dt.date.fromisoformat(match.get("date") or "")
            except (TypeError, ValueError):
                continue
            if status == "finished" and day == now.date() - dt.timedelta(days=1):
                enqueue_daily_match(store, match["id"], pulse=True)
            continue
        age = now - kickoff
        if dt.timedelta(minutes=MATCH_READY_MINUTES) <= age <= dt.timedelta(hours=PULSE_LOOKBACK_HOURS):
            enqueue_daily_match(store, match["id"], pulse=True)


def discover(store, endpoint, data, mode, params=None):
    if not isinstance(data, (dict, list)):
        return
    if endpoint == "/leagues":
        today = dt.datetime.now(dt.timezone.utc)
        start = today.year if today.month >= 7 else today.year - 1
        for league in data.get("leagues", []):
            store.enqueue("/leagues/" + league["id"], priority=2)
            for season in league.get("seasons", []):
                if mode == "daily" and str(season).split("/")[0] not in {
                    str(start),
                    str(today.year),
                }:
                    continue
                store.enqueue(
                    "/leagues/" + league["id"] + "/matches",
                    {"season": season, "status": "all"},
                    priority=DAILY_INVENTORY_PRIORITY if mode == "daily" else 1,
                    refresh=mode == "daily",
                    force=mode == "daily",
                )
    if "/matches" in endpoint and endpoint.startswith("/leagues/"):
        items = [
            dict(
                m,
                league=m.get("league")
                or data.get("league")
                or {"id": endpoint.split("/")[2]},
                season=m.get("season")
                or data.get("season")
                or (params or {}).get("season"),
            )
            for m in data.get("matches", [])
        ]
        matches(store, items, priority=1 if mode == "daily" else 3, enqueue_details=mode != "pulse")
        if mode == "daily":
            enqueue_recent_matches(store, items)
        elif mode == "pulse":
            enqueue_pulse_matches(store, items)
    elif endpoint.startswith("/date/"):
        matches(store, data.get("matches", []), priority=1 if mode == "daily" else 3, enqueue_details=mode != "pulse")
        if mode == "daily":
            enqueue_recent_matches(store, data.get("matches", []))
        elif mode == "pulse":
            enqueue_pulse_matches(store, data.get("matches", []))
    elif re.fullmatch("/matches/m_[A-Za-z0-9]{6}", endpoint):
        matches(store, [data], priority=1 if mode == "daily" else 3, enqueue_details=mode != "pulse")
    ids = identities(data)
    for identity in ids:
        kind = {"p": "players", "t": "teams"}.get(identity[0])
        if kind:
            store.enqueue(
                "/" + kind + "/" + identity, priority=4, refresh=mode == "daily"
            )
    parts = endpoint.strip("/").split("/")
    if (
        len(parts) == 3
        and parts[0] == "matches"
        and parts[2] in {"players", "lineups", "shots"}
    ):
        for identity in ids:
            if identity.startswith("p_"):
                for suffix in ["", "/halves", "/shots"]:
                    store.enqueue(
                        "/matches/" + parts[1] + "/players/" + identity + suffix,
                        priority=5,
                    )
                store.enqueue(
                    "/matches/" + parts[1] + "/advanced/players/" + identity, priority=5
                )
            if identity.startswith("s_"):
                store.enqueue("/matches/" + parts[1] + "/shots/" + identity, priority=5)
    if parts[0] == "matches" and len(parts) >= 2:
        store.db.execute(
            "insert into statarena.dirty_partitions(season,league_id) select case when position('/' in season)>0 then season else season||'/'||(season::int+1)::text end,league_id from statarena.fixtures where id=%s and season ~ '^[0-9]{4}(/[0-9]{4})?$' on conflict(season,league_id) do update set changed_at=now()",
            (parts[1],),
        )


@lru_cache(maxsize=16)
def source_table(store, path):
    return store.json(path)


def existing_observation(store, endpoint, params):
    if params:
        return None
    match = re.fullmatch(r"/matches/(m_[A-Za-z0-9]{6})(?:/(.*))?", endpoint)
    if not match:
        return None
    family = {
        "": "match",
        "players/halves": "player_halves",
        "advanced": "advanced_teams",
        "advanced/players": "advanced_players",
        "advanced/network": "pass_networks",
    }.get(match[2] or "", match[2])
    row = store.db.execute(
        "select o.ordinal,s.ref from statarena.observations o join statarena.shards s on s.id=o.shard where o.id=%s",
        (match[1],),
    ).fetchone()
    if not row or family not in row[1]["tables"]:
        return None
    doc = source_table(store, row[1]["document"]["path"])[row[0]]
    path = row[1]["tables"][family]["path"]
    record = next(
        (r for r in source_table(store, path) if r["documentId"] == doc["id"]), None
    )
    response = record.get("response") if record else None
    if not response or response.get("status") not in [200, 400, 403, 404, 410, 422]:
        return None
    return (
        response["status"],
        {"data": response.get("data"), "error": response.get("error")},
        {"path": path, "documentId": doc["id"]},
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(endpoint, params, key, base):
    for attempt in range(5):
        req = urllib.request.Request(
            base + endpoint + ("?" + urllib.parse.urlencode(params) if params else ""),
            headers={
                "X-API-KEY": key,
                "Accept": "application/json",
                "User-Agent": "STATARENA-AWS-Ingestion/1.0",
            },
        )
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=30) as r:
                status, body, headers = (
                    r.status,
                    r.read(32 * 1024 * 1024 + 1),
                    r.headers,
                )
        except urllib.error.HTTPError as r:
            status, body, headers = r.code, r.read(32 * 1024 * 1024 + 1), r.headers
        except (OSError, TimeoutError):
            if attempt == 4:
                raise RuntimeError("Provider network failure") from None
            time.sleep(2**attempt)
            continue
        if len(body) > 32 * 1024 * 1024:
            raise RuntimeError("Provider response too large")
        if key.encode() in body or re.search(
            rb"pk_(?:live|test)_[A-Za-z0-9_-]{12,}", body
        ):
            raise RuntimeError("Provider echoed credential; refusing persistence")
        if status == 401:
            raise RuntimeError("Pitch authentication refused (401)")
        if status == 429 or status >= 500:
            if attempt == 4:
                raise RuntimeError("Provider transient HTTP " + str(status))
            retry = headers.get("Retry-After", "")
            delay = min(60, float(retry)) if retry.isdigit() else 2**attempt
            time.sleep(delay)
            continue
        value = json.loads(body)
        if status == 200 and "data" not in value:
            raise RuntimeError("Provider response missing data envelope")
        if status == 200:
            data = value["data"]
            if re.fullmatch(
                r"/matches/m_[A-Za-z0-9]{6}/players", endpoint
            ) and not isinstance(data, list):
                raise RuntimeError("Invalid provider list payload")
            if re.fullmatch(r"/matches/m_[A-Za-z0-9]{6}", endpoint) and (
                not isinstance(data, dict)
                or data.get("id") != endpoint.rsplit("/", 1)[1]
            ):
                raise RuntimeError("Invalid provider match identity")
            if re.fullmatch(
                r"/matches/m_[A-Za-z0-9]{6}/shots", endpoint
            ) and not isinstance(data, dict):
                raise RuntimeError("Invalid provider shots payload")
            if endpoint.endswith("/matches") and (
                not isinstance(data, dict) or not isinstance(data.get("matches"), list)
            ):
                raise RuntimeError("Invalid provider fixture payload")
        return status, value


def seed(store, mode):
    if mode in {"daily", "pulse"}:
        # Priorities reserved for a morning pass should not outrank the next run.
        store.db.execute(
            "update statarena.jobs set priority=case when priority=%s then %s when priority=%s then %s else %s end where state='pending' and priority<=%s",
            (PULSE_DISCOVERY_PRIORITY, DAILY_DISCOVERY_PRIORITY, PULSE_MATCH_PRIORITY, DAILY_MATCH_PRIORITY, DAILY_AUX_PRIORITY, PULSE_AUX_PRIORITY),
        )
    if mode != "pulse":
        store.enqueue(
            "/leagues",
            priority=DAILY_DISCOVERY_PRIORITY if mode == "daily" else 0,
            force=mode == "daily",
        )
    if mode == "daily":
        today = dt.datetime.now(dt.timezone.utc).date()
        for delta in range(-2, 3):
            store.enqueue(
                "/date/" + str(today + dt.timedelta(days=delta)),
                {"status": "all"},
                priority=DAILY_DISCOVERY_PRIORITY,
                force=True,
            )
        # Refresh recently changed and upcoming games even if already collected.
        for (mid,) in store.db.execute(
            "select id from statarena.fixtures where day between current_date-3 and current_date+2"
        ):
            enqueue_daily_match(store, mid)
    elif mode == "pulse":
        today = dt.datetime.now(dt.timezone.utc).date()
        for delta in (-1, 0):
            store.enqueue(
                "/date/" + str(today + dt.timedelta(days=delta)),
                {"status": "all"},
                priority=PULSE_DISCOVERY_PRIORITY,
                force=True,
            )
        rows = store.db.execute(
            "select body from statarena.fixtures where day between (now() at time zone 'utc')::date-1 and (now() at time zone 'utc')::date"
        )
        enqueue_pulse_matches(store, [row[0] for row in rows])
    else:
        backlog = store.db.execute(
            "select count(*) from statarena.jobs where state in('pending','running')"
        ).fetchone()[0]
        if backlog >= 5000:
            return
        # Resume discovery from cached successful inventory responses; never re-request them.
        cursor = (
            store.db.execute(
                "select value from statarena.state where name='historical_inventory_cursor'"
            ).fetchone()
            or [""]
        )[0]
        rows = store.db.execute(
            "select endpoint,params,ref from statarena.resources where status=200 and endpoint like '/leagues/%%/matches' and endpoint||params>%s order by endpoint,params limit 50",
            (cursor,),
        ).fetchall()
        for endpoint, params, ref in rows:
            data = saved(store, ref)
            with store.db.transaction():
                if data:
                    discover(store, endpoint, data, mode, json.loads(params))
                store.flush()
                store.state("historical_inventory_cursor", endpoint + params)
        cursor = (
            store.db.execute(
                "select value from statarena.state where name='historical_fixture_cursor'"
            ).fetchone()
            or [""]
        )[0]
        rows = store.db.execute(
            "select body from statarena.fixtures where id>%s order by id limit 100",
            (cursor,),
        ).fetchall()
        if rows:
            with store.db.transaction():
                matches(store, [r[0] for r in rows])
                store.flush()
                store.state("historical_fixture_cursor", rows[-1][0]["id"])
        # Catalogue may predate this worker, so expand its cached seasons once too.
        row = store.db.execute(
            "select ref from statarena.resources where endpoint='/leagues' and params='{}' and status=200"
        ).fetchone()
        if row:
            data = saved(store, row[0])
            discover(store, "/leagues", data, mode)


def prioritize_league(store, league_id):
    """Queue a league's observed finished matches, newest season first."""
    if not re.fullmatch(r"l_[A-Za-z0-9]{6}", league_id or ""):
        raise ValueError("Invalid league ID")
    rows = store.db.execute(
        "select id,season from statarena.fixtures where league_id=%s and status='finished' order by season desc,day desc,id",
        (league_id,),
    ).fetchall()
    if not rows:
        raise ValueError("No finished fixtures are indexed for this league")
    seasons = sorted({str(season or "") for _, season in rows}, reverse=True)
    # Complete recent blocks of matches before moving backwards in time.
    # Keep the ordering in indexed job priority, avoiding a database sort of
    # every pending match on each claim.
    priority = {season: -30000 + 4000 * min(i, 7) for i, season in enumerate(seasons)}
    offsets = {season: 0 for season in seasons}
    for mid, season in rows:
        season = str(season or "")
        base = priority[season]
        batch = min(offsets[season] // 32, 399)
        offsets[season] += 1
        for suffix in ENDPOINTS:
            store.enqueue(
                "/matches/" + mid + ("/" + suffix if suffix else ""),
                priority=base + batch * 8 + PRIORITY_CORE[suffix] if suffix in PRIORITY_CORE else base + 3500,
            )
        store.enqueue("/matches/" + mid + "/heatmaps", {"frame": "home_ltr"}, priority=base + 3500)
    return {"league": league_id, "matches": len(rows), "seasons": seasons}


def claim_job(store, league_id=None, pulse_only=False):
    if league_id:
        return store.db.execute(
            "with next as(select j.endpoint,j.params from statarena.jobs j join statarena.fixtures f on f.id=split_part(j.endpoint,'/',3) where j.endpoint like '/matches/%%' and f.league_id=%s and f.status='finished' and j.state='pending' and j.available_at<=now() order by j.priority,j.available_at limit 1 for update of j skip locked) update statarena.jobs j set state='running',attempts=attempts+1,lease_until=now()+interval '10 minutes' from next where j.endpoint=next.endpoint and j.params=next.params returning j.endpoint,j.params,j.attempts",
            (league_id,),
        ).fetchone()
    if pulse_only:
        return store.db.execute(
            "with next as(select endpoint,params from statarena.jobs where state='pending' and available_at<=now() and priority<=%s order by priority,available_at limit 1 for update skip locked) update statarena.jobs j set state='running',attempts=attempts+1,lease_until=now()+interval '10 minutes' from next where j.endpoint=next.endpoint and j.params=next.params returning j.endpoint,j.params,j.attempts",
            (PULSE_AUX_PRIORITY,),
        ).fetchone()
    return store.db.execute(
        "with next as(select endpoint,params from statarena.jobs where state='pending' and available_at<=now() order by priority,available_at limit 1 for update skip locked) update statarena.jobs j set state='running',attempts=attempts+1,lease_until=now()+interval '10 minutes' from next where j.endpoint=next.endpoint and j.params=next.params returning j.endpoint,j.params,j.attempts"
    ).fetchone()


def capacity(store):
    size = store.db.execute("select pg_database_size(current_database())").fetchone()[0]
    objects = store.db.execute(
        "select coalesce(sum(size),0) from statarena.objects"
    ).fetchone()[0]
    # The old defaults protect AWS quotas, but do not describe AWS capacity.
    # External deployments may opt into limits appropriate to their provisioned storage.
    external = os.environ.get("STATARENA_EXTERNAL_STORAGE") == "1"
    sql_limit = os.environ.get("STATARENA_SQL_LIMIT_BYTES") or (None if external else "900000000")
    object_limit = os.environ.get("STATARENA_OBJECT_LIMIT_BYTES") or (None if external else "4750000000")
    return {
        "sqlBytes": size,
        "objectBytes": int(objects),
        "paused": bool((sql_limit and size > int(sql_limit)) or (object_limit and objects > int(object_limit))),
    }


def publish_pending(store, mode, league_id=None):
    from aws_materialize import materialize

    if mode in {"daily", "pulse"} and not league_id:
        for league in DAILY_TARGET_LEAGUES:
            materialize(store, max_partitions=1, league_id=league, recent_first=True)
        materialize(store, max_partitions=20, recent_first=True)
    else:
        materialize(store, max_partitions=20, league_id=league_id)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["daily", "pulse", "historical"], required=True)
    p.add_argument("--minutes", type=float, default=45)
    p.add_argument("--max-requests", type=int, default=10000)
    p.add_argument("--seed-endpoint")
    p.add_argument("--priority-league", help="Collect indexed finished matches for one league first")
    p.add_argument("--skip-materialize", action="store_true")
    a = p.parse_args()
    base = os.environ.get("PITCHAPI_BASE_URL", "https://api.pitchapi.dev/v1").rstrip(
        "/"
    )
    test = (
        base.startswith("http://127.0.0.1:")
        and os.environ.get("STATARENA_TEST_INGEST") == "1"
    )
    if base != "https://api.pitchapi.dev/v1" and not test:
        raise RuntimeError("Unapproved provider origin")
    if not os.environ.get("GITHUB_ACTIONS") and not test:
        raise RuntimeError("Pitch collection must run in GitHub Actions")
    key = os.environ["PITCHAPI_API_KEY"]
    store = Store()
    started = time.monotonic()
    counts = {}
    processed = 0
    reused = 0
    paused = False
    # A session lock serializes materialization and both workflow modes.
    if not store.db.execute("select pg_try_advisory_lock(97813003)").fetchone()[0]:
        print("Another ingestion owns the lease; leaving pending work intact")
        return
    try:
        store.db.execute(
            "update statarena.jobs set state='pending',lease_until=null where state='running' and lease_until<now()"
        )
        if a.priority_league:
            print(canonical({"prioritized": prioritize_league(store, a.priority_league)}), flush=True)
        elif a.seed_endpoint:
            store.enqueue(a.seed_endpoint, priority=0, refresh=True)
        else:
            seed(store, a.mode)
        store.flush()
        while (
            processed < a.max_requests and time.monotonic() - started < a.minutes * 60
        ):
            if processed % 100 == 0:
                cap = capacity(store)
                if cap["paused"]:
                    paused = True
                    store.state(a.mode, {"state": "paused_capacity", **cap})
                    break
            row = claim_job(store, a.priority_league, pulse_only=a.mode == "pulse")
            if not row:
                break
            endpoint, encoded, attempts = row
            params = json.loads(encoded)
            try:
                previous = (
                    existing_observation(store, endpoint, params)
                    if a.mode == "historical"
                    else None
                )
                if previous:
                    status, body, reference = previous
                    reused += 1
                else:
                    status, body = request(endpoint, params, key, base)
                    reference = None
                with store.db.transaction():
                    if reference is None:
                        raw = canonical(body).encode()
                        compressed = gzip.compress(raw, mtime=0)
                        digest = hashlib.sha256(compressed).hexdigest()
                        path = "raw/neon/blobs/" + digest + ".json.gz"
                        store.put(path, compressed, "application/gzip")
                        reference = {"path": path}
                    store.db.execute(
                        "insert into statarena.resources(endpoint,params,status,ref,error) values(%s,%s,%s,%s,%s) on conflict(endpoint,params) do update set status=excluded.status,ref=excluded.ref,error=excluded.error,updated_at=now() where statarena.resources.status<>200 or excluded.status=200",
                        (
                            endpoint,
                            encoded,
                            status,
                            Jsonb(reference),
                            Jsonb(body.get("error")),
                        ),
                    )
                    if status != 200:
                        store.db.execute(
                            "insert into statarena.ingest_failures(endpoint,params,status,error) values(%s,%s,%s,%s) on conflict(endpoint,params) do update set status=excluded.status,error=excluded.error,updated_at=now()",
                            (endpoint, encoded, status, Jsonb(body.get("error"))),
                        )
                    if status == 200:
                        discover(store, endpoint, body.get("data"), a.mode, params)
                        store.flush()
                        from aws_assets import urls

                        with store.db.cursor() as c:
                            c.executemany(
                                "insert into statarena.asset_jobs(url) values(%s) on conflict do nothing",
                                [(url,) for url in urls(body.get("data"))],
                            )
                    store.db.execute(
                        "delete from statarena.jobs where endpoint=%s and params=%s",
                        (endpoint, encoded),
                    )
                counts[str(status)] = counts.get(str(status), 0) + 1
                processed += 1
                if processed % 25 == 0:
                    print(
                        canonical(
                            {"mode": a.mode, "processed": processed, "statuses": counts}
                        ),
                        flush=True,
                    )
                time.sleep(float(os.environ.get("PITCH_REQUEST_INTERVAL", "0.2")))
            except Exception:
                store.db.execute(
                    "update statarena.jobs set state='pending',available_at=now()+interval '15 minutes',lease_until=null,last_error='Collection interrupted or transient failure' where endpoint=%s and params=%s",
                    (endpoint, encoded),
                )
                raise
        if not a.skip_materialize:
            publish_pending(store, a.mode, a.priority_league)
        report = {
            "state": "paused_capacity" if paused else "success",
            **({"priorityLeague": a.priority_league} if a.priority_league else {}),
            "processed": processed,
            "reused": reused,
            "downloaded": processed - reused,
            "statuses": counts,
            "elapsedSeconds": round(time.monotonic() - started, 2),
            **capacity(store),
        }
        store.state(a.mode, report)
        store.revision()
        print(canonical(report), flush=True)
    finally:
        store.db.execute("select pg_advisory_unlock(97813003)")
        store.db.close()


if __name__ == "__main__":
    main()
