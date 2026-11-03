"""Incremental packed views, using the existing metric normalizer and contracts."""

import hashlib
from neon_store import canonical
from bootstrap_neon import unpack
from build_dashboard_data import build_snapshot, METRICS
from build_dashboard_views import pack_table
from neon_ingest import saved
from mls_fixture_alias import publish_mls_fixture_alias


def competition_metadata(existing, profile, league, label, fixtures):
    """Fill missing identity fields from the saved provider league profile."""
    competition = dict(existing or {})
    fixture_league = (fixtures[0].get("league") or {}) if fixtures else {}
    competition.setdefault("id", league)
    if not competition.get("name") or competition["name"] == league:
        competition["name"] = profile.get("name") or fixture_league.get("name") or league
    for field in ("country", "providerCountry"):
        if not competition.get(field) and profile.get("country_code"):
            competition[field] = profile["country_code"]
    if not competition.get("imageUrl"):
        competition["imageUrl"] = profile.get("image_url") or fixture_league.get("image_url")
    competition["seasons"] = sorted(set(competition.get("seasons", []) + [label]))
    return competition


def _materialize(store, max_partitions=20, league_id=None, recent_first=False):
    manifest = store.json("computed/dashboard/index.json")
    raw = store.json("raw/index.json")
    changed = 0
    routing = (
        store.json(manifest["scouting"]["playerRoutes"]["path"])
        if manifest.get("scouting", {}).get("playerRoutes")
        else {"version": 1, "routes": {}, "clubRoutes": {}}
    )

    def prior_response(mid, family):
        return archive_responses.get(mid, {}).get(family)

    partitions_query = "select season,league_id,changed_at from statarena.dirty_partitions"
    params = (max_partitions,)
    if league_id:
        partitions_query += " where league_id=%s"
        params = (league_id, max_partitions)
    partitions_query += " order by changed_at " + ("desc" if recent_first else "asc") + " limit %s"
    for label, league, marked in store.db.execute(partitions_query, params).fetchall():
        season = next((s for s in manifest["seasons"] if s["id"] == label), None)
        if not season:
            season = {"id": label, "chunks": []}
            manifest["seasons"].append(season)
        old = next((c for c in season["chunks"] if c["leagueId"] == league), None)
        doc = store.json(old["path"]) if old else None
        tables = (
            {name: unpack(t) for name, t in doc["tables"].items()}
            if doc
            else {
                name: []
                for name in [
                    "players",
                    "performances",
                    "matches",
                    "shots",
                    "team_statistics",
                    "teams",
                    "competitions",
                    "fixtures",
                ]
            }
        )
        original_digests = {
            name: hashlib.sha256(canonical(rows).encode()).hexdigest()
            for name, rows in tables.items()
        }
        previous_raw = next(
            (
                c
                for season in raw["seasons"]
                if season["id"] == label
                for c in season["chunks"]
                if c["leagueId"] == league
            ),
            None,
        )
        fixtures = [
            r[0]
            for r in store.db.execute(
                "select body from statarena.fixtures where league_id=%s and season=any(%s) order by day,id",
                (league, [label, label.split("/")[0]]),
            ).fetchall()
        ]
        tables["fixtures"] = fixtures
        profile_row = store.db.execute(
            "select ref from statarena.resources where endpoint=%s and params='{}' and status=200",
            ("/leagues/" + league,),
        ).fetchone()
        profile = saved(store, profile_row[0]) if profile_row else {}
        profile = profile or {}
        competition = competition_metadata(
            tables["competitions"][0] if tables["competitions"] else None,
            profile, league, label, fixtures,
        )
        if competition["name"] == "1. Lig" and competition.get("country") == "INT":
            competition["country"] = "TUR"
        finished_ids = [f["id"] for f in fixtures if f.get("status") == "finished"]
        # Imported archives live in observation shards, while recent collection
        # uses standalone resources. Load both indexes once for this partition.
        observations = store.db.execute(
            "select id,shard,ordinal from statarena.observations where id=any(%s)",
            (finished_ids,),
        ).fetchall()
        shards = dict(store.db.execute(
            "select id,ref from statarena.shards where id=any(%s)",
            (list({row[1] for row in observations}),),
        ).fetchall())
        endpoints = [
            "/matches/" + mid + suffix
            for mid in finished_ids
            for suffix in ("", "/players", "/shots", "/lineups", "/stats")
        ]
        resources = {
            endpoint: (status, ref)
            for endpoint, status, ref in store.db.execute(
                "select endpoint,status,ref from statarena.resources where params='{}' and endpoint=any(%s)",
                (endpoints,),
            ).fetchall()
        }
        # Process one shard at a time, retaining only this partition's missing
        # responses. Interleaved match dates must not repeatedly evict/reload
        # entire archive tables or retain other leagues' decoded payloads.
        archive_responses = {}
        by_shard = {}
        for mid, shard, ordinal in observations:
            by_shard.setdefault(shard, []).append((mid, ordinal))
        for shard, entries in by_shard.items():
            ref = shards[shard]
            documents = store.json(ref["document"]["path"])
            identities = {documents[ordinal]["id"]: mid for mid, ordinal in entries}
            for family, suffix in (
                ("match", ""), ("players", "/players"), ("shots", "/shots"),
                ("lineups", "/lineups"), ("stats", "/stats"),
            ):
                if family not in ref["tables"]:
                    continue
                needed = {
                    docid: mid for docid, mid in identities.items()
                    if resources.get("/matches/" + mid + suffix, (None,))[0] != 200
                }
                if not needed:
                    continue
                for row in store.json(ref["tables"][family]["path"]):
                    mid = needed.get(row["documentId"])
                    if mid:
                        archive_responses.setdefault(mid, {})[family] = row.get("response")
        normalized = []
        rounds = {}
        round_path = "computed/matchdays/" + label.replace("/", "-") + ".json.gz"
        try:
            rounds = store.json(round_path)
        except FileNotFoundError:
            pass
        for fixture in fixtures:
            mid = fixture["id"]
            if fixture.get("status") != "finished":
                continue
            resource = resources.get("/matches/" + mid)
            if resource and resource[0] == 200:
                detail = saved(store, resource[1])
            else:
                previous = prior_response(mid, "match")
                detail = previous.get("data") if previous and previous.get("status") == 200 else None
            if (
                detail
                and detail.get("id") == mid
                and detail.get("round_name") is not None
            ):
                rounds.setdefault(league, {})[mid] = {
                    "name": str(detail["round_name"]),
                    "playoff": detail.get("has_playoff") is True,
                }
            # The match detail adds the referee, the stadium and the round to the fixture.
            details = {
                k: detail.get(k)
                for k in ("round_name", "has_playoff", "referee", "stadium")
                if detail and detail.get("id") == mid and k in detail
            }
            sample = {
                "match": dict(fixture, **details),
                "country": competition.get("country"),
                "league": competition["name"],
                "league_id": league,
                "season": label,
            }
            for name, endpoint in [
                ("players", "players"),
                ("shots", "shots"),
                ("lineups", "lineups"),
                ("team_stats", "stats"),
            ]:
                row = resources.get("/matches/" + mid + "/" + endpoint)
                if row and row[0] == 200:
                    sample[name] = {"ok": True, "data": saved(store, row[1])}
                else:
                    previous = prior_response(
                        mid, "stats" if name == "team_stats" else name
                    )
                    if previous and previous.get("status") == 200:
                        sample[name] = {"ok": True, "data": previous.get("data")}
            # Replacing a partial response must not erase already normalized statistics.
            available = {
                k
                for k in ["players", "shots", "team_stats"]
                if sample.get(k, {}).get("ok")
            }
            if not available:
                continue
            one = build_snapshot({"samples": [sample]}, {"data": {"leagues": []}})
            for m in one["matches"]:
                previous = next((v for v in tables["matches"] if v["id"] == mid), {})
                if "players" not in available:
                    m["players"] = previous.get("players", [])
                if "team_stats" not in available or not sample.get("lineups", {}).get("ok"):
                    for side in ("home", "away"):
                        old_side = previous.get(side, {})
                        m[side] = {
                            **old_side,
                            **{k: v for k, v in m[side].items() if v is not None or k not in old_side},
                        }
                if "shots" not in available:
                    m["shots"] = []
                m["detailCollected"] = all(
                    k in available for k in ["players", "shots", "team_stats"]
                )
                tables["matches"] = [v for v in tables["matches"] if v["id"] != mid] + [
                    {k: v for k, v in m.items() if k not in {"shots", "stats"}}
                ]
                if "shots" in available:
                    tables["shots"] = [
                        v for v in tables["shots"] if v["matchId"] != mid
                    ] + [dict(v, matchId=mid) for v in m["shots"]]
                if "team_stats" in available:
                    tables["team_statistics"] = [
                        v for v in tables["team_statistics"] if v["matchId"] != mid
                    ] + [{"matchId": mid, "values": m["stats"]}]
            if "players" in available:
                tables["performances"] = [
                    v for v in tables["performances"] if v["matchId"] != mid
                ]
                players = {v["id"]: v for v in tables["players"]}
                for row in one["appearances"]:
                    player = {
                        "playerId": row["playerId"],
                        "name": row.get("name"),
                        "imageUrl": row.get("imageUrl"),
                    }
                    ref = (
                        row["playerId"]
                        + ":"
                        + hashlib.sha256(canonical(player).encode()).hexdigest()[:16]
                    )
                    players[ref] = dict(id=ref, **player)
                    tables["performances"].append(
                        dict(
                            {
                                k: v
                                for k, v in row.items()
                                if k not in {"name", "imageUrl"}
                            },
                            playerRef=ref,
                        )
                    )
                used = {p["playerRef"] for p in tables["performances"]}
                tables["players"] = [v for k, v in players.items() if k in used]
            teams = {t["id"]: t for t in tables["teams"]}
            for team in one["teams"]:
                teams[team["id"]] = dict(teams.get(team["id"], {}), **team)
            tables["teams"] = list(teams.values())
            normalized.append(mid)
        for team in tables["teams"]:
            team["sampleMatches"] = sum(
                team["id"] in {m["home"]["id"], m["away"]["id"]}
                for m in tables["matches"]
            )
            team["seasons"] = sorted(set(team.get("seasons", []) + [label]))
            team["leagueIds"] = sorted(set(team.get("leagueIds", []) + [league]))
        tables["matches"].sort(
            key=lambda m: (m.get("timeUtc") or "", m["id"]), reverse=True
        )
        tables["performances"].sort(key=lambda p: (p["matchId"], p["playerId"]))
        competition["sampleMatches"] = len(tables["matches"])
        competition["sampleSeasons"] = sorted(
            set(competition.get("sampleSeasons", []) + [label])
        )
        tables["competitions"] = [competition]
        meta = dict(
            doc.get("meta", {}) if doc else {},
            matchCount=len(tables["matches"]),
            collectedMatches=sum(
                m.get("detailCollected") is True for m in tables["matches"]
            ),
            expectedFinishedMatches=sum(
                m.get("status") == "finished" for m in fixtures
            ),
            playerCount=len({p["playerId"] for p in tables["players"]}),
            listedAppearanceCount=len(tables["performances"]),
            appearanceCount=sum(
                (p.get("minutes") or 0) > 0 for p in tables["performances"]
            ),
            shotCount=len(tables["shots"]),
        )
        metrics = doc.get("metrics", METRICS) if doc else METRICS
        stamp = hashlib.sha256(
            canonical({"tables": tables, "meta": meta, "metrics": metrics}).encode()
        ).hexdigest()
        if old and old.get("neonDigest") == stamp:
            store.db.execute(
                "delete from statarena.dirty_partitions where season=%s and league_id=%s and changed_at=%s",
                (label, league, marked),
            )
            continue
        with store.db.transaction():
            refs = {}
            for name, rows in tables.items():
                full_digest = hashlib.sha256(canonical(rows).encode()).hexdigest()
                if previous_raw and full_digest == original_digests[name]:
                    refs[name] = previous_raw["tables"][name]
                    continue
                digest = full_digest[:24]
                refs[name] = store.put_json(
                    f"raw/neon/seasons/{label.replace('/', '-')}/{league}/{name}-{digest}.json.gz",
                    rows,
                )
            packed = {
                "format": "orion-packed-tables-v1",
                "meta": meta,
                "metrics": metrics,
                "tables": {k: pack_table(v) for k, v in tables.items()},
            }
            path = f"computed/dashboard/{label.replace('/', '-')}/{league}-{stamp[:24]}.json.gz"
            ref = store.put_json(path, packed, hot=True)
            size = store.db.execute(
                "select size from statarena.objects where path=%s", (path,)
            ).fetchone()[0]
            chunk = {
                "leagueId": league,
                "path": path,
                "sha256": ref["sha256"],
                "bytes": size,
                "sourceDigest": stamp,
                "neonDigest": stamp,
                "competitions": tables["competitions"],
            }
            if old and old["path"] != path:
                store.db.execute(
                    "update statarena.objects set body=null where path=%s",
                    (old["path"],),
                )
            season["chunks"] = [
                c for c in season["chunks"] if c["leagueId"] != league
            ] + [chunk]
            raw_season = next((s for s in raw["seasons"] if s["id"] == label), None)
            if not raw_season:
                raw_season = {"id": label, "chunks": []}
                raw["seasons"].append(raw_season)
            raw_season["chunks"] = [
                c for c in raw_season["chunks"] if c["leagueId"] != league
            ] + [{"leagueId": league, "meta": meta, "metrics": metrics, "tables": refs}]
            for name, column, target in [
                ("players", "playerId", "routes"),
                ("teams", "id", "clubRoutes"),
            ]:
                for row in tables[name]:
                    identity = row.get(column)
                    if identity:
                        routes = routing[target].setdefault(identity, {})
                        routes[label] = sorted(set(routes.get(label, []) + [league]))
            if rounds:
                store.put_json(round_path, rounds, hot=True)
            publish_mls_fixture_alias(store, league, label, fixtures)
            store.put_json("raw/index.json", raw, hot=True)
            store.put_json("computed/dashboard/index.json", manifest, hot=True)
            store.db.execute(
                "delete from statarena.dirty_partitions where season=%s and league_id=%s and changed_at=%s",
                (label, league, marked),
            )
            changed += 1
        print(
            canonical(
                {
                    "materialized": league,
                    "season": label,
                    "fixtures": len(fixtures),
                    "updatedMatches": len(normalized),
                }
            ),
            flush=True,
        )
    if changed:
        digest = hashlib.sha256(canonical(routing).encode()).hexdigest()
        ref = store.put_json(
            "computed/scouting/player-routes-" + digest[:24] + ".json.gz",
            routing,
            hot=True,
        )
        manifest["scouting"] = {
            "version": 1,
            "sourceDigest": digest,
            "playerRoutes": ref,
            "players": len(routing["routes"]),
            "clubs": len(routing["clubRoutes"]),
        }
        store.put_json("computed/dashboard/index.json", manifest, hot=True)
    return changed


def materialize(store, max_partitions=20, league_id=None, recent_first=False):
    # Catalog, manifests, routes and completion markers become visible atomically.
    with store.db.transaction():
        return _materialize(store, max_partitions, league_id, recent_first)


def mark_all(store):
    """Queue every published season and competition for a fresh materialization."""
    manifest = store.json("computed/dashboard/index.json")
    pairs = sorted(
        {(s["id"], c["leagueId"]) for s in manifest["seasons"] for c in s["chunks"]}
    )
    for season, league in pairs:
        store.db.execute(
            "insert into statarena.dirty_partitions(season,league_id) values(%s,%s) on conflict(season,league_id) do update set changed_at=now()",
            (season, league),
        )
    return len(pairs)


def main():
    import argparse, os, time
    from neon_store import Store

    p = argparse.ArgumentParser(
        description="Rebuild the published dashboard partitions from the responses stored in Neon."
    )
    p.add_argument("--all", action="store_true", help="queue every published partition first")
    p.add_argument("--batch", type=int, default=10)
    p.add_argument("--minutes", type=float, default=100)
    a = p.parse_args()
    if not os.environ.get("GITHUB_ACTIONS"):
        raise RuntimeError("Materialization writes to Neon and must run in GitHub Actions")
    store = Store()
    if not store.db.execute("select pg_try_advisory_lock(97813003)").fetchone()[0]:
        print("Another ingestion owns the lease; nothing was queued")
        return
    try:
        if a.all:
            print(canonical({"queued": mark_all(store)}), flush=True)
        stop = time.monotonic() + a.minutes * 60
        while time.monotonic() < stop:
            left = store.db.execute(
                "select count(*) from statarena.dirty_partitions"
            ).fetchone()[0]
            if not left:
                break
            materialize(store, max_partitions=a.batch)
        left = store.db.execute("select count(*) from statarena.dirty_partitions").fetchone()[0]
        store.state("materialize", {"remaining": left})
        store.revision()
        print(canonical({"remaining": left}), flush=True)
    finally:
        store.db.execute("select pg_advisory_unlock(97813003)")
        store.db.close()


if __name__ == "__main__":
    main()
