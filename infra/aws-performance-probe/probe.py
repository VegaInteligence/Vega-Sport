"""Temporary public-HTTP acceptance probe. No credentials or business writes."""
import datetime
import gzip
import hashlib
import http.client
import json
import math
import os
import random
import ssl
import time
import urllib.parse
import uuid

HOST = "d317dq37z1tacb.cloudfront.net"
PATHS = {"/api/read/home", "/api/read/players", "/api/read/clubs"}


def handler(event, context):
    path = event["path"]
    parsed = urllib.parse.urlsplit(path)
    if parsed.scheme or parsed.netloc or parsed.fragment or parsed.path not in PATHS:
        raise ValueError("Only the three public compact read paths are accepted")
    if len(path) > 2048 or any(c in path for c in "\r\n"):
        raise ValueError("Invalid path")
    count = int(event.get("count", 50))
    mode = event.get("mode", "warm")
    if not 1 <= count <= 50 or mode not in {"warm", "miss"}:
        raise ValueError("Invalid bounded probe parameters")
    ssl_context = ssl.create_default_context()
    probe_id = uuid.uuid4().hex
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    leagues = dict(query).get("leagues", "").split(",")
    if mode == "miss" and len(set(leagues)) < 5:
        raise ValueError("Miss sampling requires at least five equivalent league permutations")
    randomizer = random.Random(probe_id)
    seen_orders = {tuple(leagues)}
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def request(target):
        connection = http.client.HTTPSConnection(HOST, timeout=15, context=ssl_context)
        start = time.perf_counter()
        try:
            connection.request("GET", target, headers={
                "Accept": "application/json", "Accept-Encoding": "gzip",
                "User-Agent": "VegaAcceptance/20261107", "Connection": "close",
            })
            response = connection.getresponse()
            headers_ms = (time.perf_counter() - start) * 1000
            body = response.read(2 * 1024 * 1024 + 1)
            total_ms = (time.perf_counter() - start) * 1000
            if len(body) > 2 * 1024 * 1024:
                raise ValueError("Response exceeded probe bound")
            raw = gzip.decompress(body) if response.getheader("Content-Encoding") == "gzip" else body
            payload = json.loads(raw)
            return {
                "status": response.status, "headers_ms": round(headers_ms, 3),
                "total_ms": round(total_ms, 3), "wire_body_bytes": len(body),
                "json_bytes": len(raw), "body_sha256": hashlib.sha256(raw).hexdigest(),
                "generation": payload.get("meta", {}).get("generation"),
                "cache_status": response.getheader("X-Cache"),
                "cache_age": response.getheader("Age"),
                "pop": response.getheader("X-Amz-Cf-Pop"),
                "server_timing": response.getheader("Server-Timing"),
                "cache_control": response.getheader("Cache-Control"),
            }
        finally:
            connection.close()

    warmup = request(path) if mode == "warm" else None
    trials = []
    for index in range(count):
        if context.get_remaining_time_in_millis() < 20000:
            break
        target = path
        if mode == "miss":
            # CloudFront keys the raw query; parseReadScope normalizes league
            # IDs with Set + sort. Each order selects precisely the same data.
            order = list(leagues)
            while tuple(order) in seen_orders:
                randomizer.shuffle(order)
            seen_orders.add(tuple(order))
            target = parsed.path + "?" + urllib.parse.urlencode([
                (key, ",".join(order) if key == "leagues" else value)
                for key, value in query
            ])
        trial_started = time.perf_counter()
        try:
            trials.append(request(target))
        except Exception as error:
            trials.append({"status": None, "error_type": type(error).__name__,
                           "total_ms": round((time.perf_counter() - trial_started) * 1000, 3)})
            break
        if trials[-1]["status"] != 200:
            break
        time.sleep(0.15)
    durations = sorted(t["total_ms"] for t in trials)
    return {
        "started_at": started_at,
        "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "region": os.environ["AWS_REGION"], "runtime": "python3.13", "memory_mb": 512,
        "host": HOST, "path": path, "mode": mode, "requested": count,
        "completed": len(trials), "connection_policy": "new HTTPS connection per trial",
        "quantile_method": "nearest rank ceil(0.95*n)",
        "p50_ms": durations[math.ceil(0.5 * len(durations)) - 1] if durations else None,
        "p95_ms": durations[math.ceil(0.95 * len(durations)) - 1] if durations else None,
        "max_ms": max(durations) if durations else None,
        "warmup": warmup, "trials": trials,
        "limits": ["AWS Paris synthetic client, not a residential connection or browser render",
                   "A shared-cache miss does not imply a cold Lambda or cold PostgreSQL cache"],
    }
