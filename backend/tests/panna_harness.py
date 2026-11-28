"""Stand-ins for test_panna.py (backend/panna/FAILURE_MODES.md): a loopback GitHub release API with its assets, a TCP
relay between the loader and PostgreSQL that throttles, drops or cuts the answer to a COMMIT, and synthetic Parquet
files with the real schemas of `opta_fixtures.parquet` and `events_<competition>.parquet` (no PannaData row)."""

import hashlib
import http.server
import io
import json
import socket
import socketserver
import threading
import time
from urllib.parse import parse_qs, urlparse

import pyarrow as pa
import pyarrow.parquet as pq

# The 13 columns of opta_fixtures.parquet and the 17 of events_<competition>.parquet, as the release of 28 Nov 2026
# holds them (measured-schema-inventory.json of the coordinator's freeze).
FIXTURE_SCHEMA = pa.schema([(name, pa.string()) for name in (
    "match_id", "match_date", "match_status", "home_team", "away_team", "home_team_id", "away_team_id",
    "home_score", "away_score", "home_score_ht", "away_score_ht", "competition", "season")])
# The 14 columns opta_fixtures.parquet holds after those 13 since the release asset of 28 Nov 2026, 14:18 UTC
# (asset 804814591, backend/panna/FAILURE_MODES.md section 9), in its order and types.
FIXTURE_ADDED = [("venue_id", pa.string()), ("venue_name", pa.string()), ("venue_latitude", pa.float64()),
                 ("venue_longitude", pa.float64()), ("venue_neutral", pa.bool_()), ("local_date", pa.string()),
                 ("local_time", pa.string()), ("match_week", pa.string()), ("coverage_level", pa.string()),
                 ("var", pa.string()), ("referee_id", pa.string()), ("referee_name", pa.string()),
                 ("attendance", pa.float64()), ("match_officials_json", pa.string())]
FIXTURE_EXT_SCHEMA = pa.schema(list(FIXTURE_SCHEMA) + [pa.field(n, t) for n, t in FIXTURE_ADDED])


def extended(row, **values):
    """A fixture row with the 14 added columns, NULL unless given."""
    return {**row, **{name: values.get(name) for name, _ in FIXTURE_ADDED}}


EVENT_SCHEMA = pa.schema([
    ("match_id", pa.string()), ("event_id", pa.int64()), ("type_id", pa.int64()), ("player_id", pa.string()),
    ("player_name", pa.string()), ("team_id", pa.string()), ("minute", pa.int64()), ("second", pa.int64()),
    ("x", pa.float64()), ("y", pa.float64()), ("end_x", pa.float64()), ("end_y", pa.float64()),
    ("outcome", pa.int64()), ("period_id", pa.int64()), ("qualifier_json", pa.string()),
    ("competition", pa.large_string()), ("season", pa.large_string())])


def fixture(match_id, day, competition, season, status="Played", home="Home FC", away="Away FC", home_score="1",
            away_score="0", ht=("0", "0")):
    return {"match_id": match_id, "match_date": f"{day}Z", "match_status": status, "home_team": home,
            "away_team": away, "home_team_id": f"t-{home[:4]}", "away_team_id": f"t-{away[:4]}",
            "home_score": home_score, "away_score": away_score, "home_score_ht": ht[0], "away_score_ht": ht[1],
            "competition": competition, "season": season}


def events_for(match_id, competition, season, n, start=1, x=None, names=None, qualifier=None):
    """n deterministic events of one match; x, names and qualifier override the values of the first rows."""
    rows = []
    for i in range(n):
        k = start + i
        rows.append({"match_id": match_id, "event_id": 10_000 + k, "type_id": 1 + k % 70,
                     "player_id": f"p{k % 23}", "player_name": f"Player {k % 23}", "team_id": f"t{k % 2}",
                     "minute": k % 95, "second": (k * 7) % 60, "x": (k % 100) + 0.25, "y": (k * 3 % 100) / 3,
                     "end_x": None if k % 5 == 0 else (k % 90) + 0.5, "end_y": (k % 77) * 1.5,
                     "outcome": k % 2, "period_id": 1 + (k % 90 > 45), "qualifier_json": json.dumps({"q": k}),
                     "competition": competition, "season": season})
    for i, value in enumerate(x or []):
        rows[i]["x"] = value
    for i, value in enumerate(names or []):
        rows[i]["player_name"] = value
    for i, value in enumerate(qualifier or []):
        rows[i]["qualifier_json"] = value
    return rows


def parquet_bytes(rows, schema, row_group_size=None, compression="snappy", extra_columns=None, drop=()):
    """The Parquet file of `rows` (the order kept) with `schema`; extra_columns adds (name, type, values)."""
    fields = [f for f in schema if f.name not in drop]
    arrays = [pa.array([r[f.name] for r in rows], type=f.type) for f in fields]
    for name, kind, values in extra_columns or ():
        fields.append(pa.field(name, kind))
        arrays.append(pa.array(values, type=kind))
    table = pa.Table.from_arrays(arrays, schema=pa.schema(fields))
    sink = io.BytesIO()
    pq.write_table(table, sink, row_group_size=row_group_size or max(1, len(rows)), compression=compression)
    return sink.getvalue()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class Upstream:
    """A GitHub release API (`/repos/<repo>/releases`, `/releases/<id>/assets`, paginated) and its download URLs, which
    redirect to the bytes as GitHub's do. `serve` replaces the release's assets; `corrupt` serves other bytes under an
    asset's listed digest; `requests` records each request (path only)."""

    def __init__(self, repo="peteowen1/pannadata", page=2):
        self.repo, self.page = repo, page
        self.releases = {}  # tag -> {name: bytes}
        self.corrupt = {}  # (tag, name) -> bytes actually served
        self.no_digest = set()  # names listed without a digest (older GitHub assets have none)
        self.requests = []
        upstream = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                upstream.requests.append(self.path)
                url = urlparse(self.path)
                query = parse_qs(url.query)
                parts = url.path.strip("/").split("/")
                page = int(query.get("page", ["1"])[0])
                per = int(query.get("per_page", ["30"])[0])
                if url.path == f"/api/repos/{upstream.repo}/releases":
                    tags = sorted(upstream.releases)
                    body = [{"id": i + 1, "tag_name": t, "name": t, "assets": []} for i, t in enumerate(tags)]
                    return self.json(body[(page - 1) * per: page * per])
                if len(parts) == 7 and parts[:4] == ["api", "repos", *upstream.repo.split("/")] and parts[4] == "releases" and parts[6] == "assets":
                    tag = sorted(upstream.releases)[int(parts[5]) - 1]
                    names = sorted(upstream.releases[tag])
                    assets = [upstream.asset(tag, n, i) for i, n in enumerate(names)]
                    # GitHub caps per_page at 100; this stand-in pages by `page_size` to exercise the paging.
                    per = min(per, upstream.page)
                    return self.json(assets[(page - 1) * per: page * per])
                if parts[:1] == ["download"] and len(parts) == 3:
                    tag, name = parts[1], parts[2]
                    if name not in upstream.releases.get(tag, {}):
                        return self.send_error(404)
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{upstream.port}/blob/{tag}/{name}")
                    self.end_headers()
                    return
                if parts[:1] == ["blob"] and len(parts) == 3:
                    tag, name = parts[1], parts[2]
                    data = upstream.corrupt.get((tag, name), upstream.releases.get(tag, {}).get(name))
                    if data is None:
                        return self.send_error(404)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self.send_error(404)

            def json(self, body):
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def api(self):
        return f"http://127.0.0.1:{self.port}/api"

    def asset(self, tag, name, index):
        data = self.releases[tag][name]
        return {"id": 1000 + index, "name": name, "size": len(data),
                "digest": None if name in self.no_digest else "sha256:" + sha256(data),
                "updated_at": "2026-11-28T03:00:00Z",
                "browser_download_url": f"http://127.0.0.1:{self.port}/download/{tag}/{name}"}

    def serve(self, tag, assets):
        self.releases[tag] = dict(assets)

    def downloads(self):
        return [p for p in self.requests if p.startswith("/blob/")]

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class Relay:
    """A TCP relay to PostgreSQL. `rate` bytes per second each way (0: as fast as it goes); `drop_after` cuts every
    connection once that many client bytes have passed (once, then relays normally); `cut_commit` cuts once the client
    sends a COMMIT, before the server's answer comes back (the statement reaches the server)."""

    def __init__(self, target_host, target_port):
        self.target = (target_host, target_port)
        self.rate = 0
        self.drop_after = None
        self.cut_commit = False
        # S1 (test_panna_s1.py, GH278.S1-o): cut only the COMMIT that follows a message holding these bytes (the name
        # of a function the transaction called), not the first COMMIT of the run.
        self.cut_commit_after = None
        self.drops = 0
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(32)
        self.port = self.listener.getsockname()[1]
        self.lock = threading.Lock()
        self.alive = True
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        while self.alive:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            try:
                server = socket.create_connection(self.target)
            except OSError:
                client.close()
                continue
            state = {"sent": 0, "closed": False, "cut": None}
            threading.Thread(target=self.pipe, args=(client, server, state, True), daemon=True).start()
            threading.Thread(target=self.pipe, args=(server, client, state, False), daemon=True).start()

    def pipe(self, src, dst, state, upstream):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                if upstream:
                    with self.lock:
                        if self.drop_after is not None and state["sent"] + len(data) >= self.drop_after:
                            self.drop_after = None
                            self.drops += 1
                            break
                        if self.cut_commit_after is not None and self.cut_commit_after in data:
                            self.cut_commit_after = None
                            self.cut_commit = True
                        # The simple-query message of a COMMIT ('Q', its length, the text, NUL), as psycopg sends it.
                        if self.cut_commit and b"Q\x00\x00\x00\x0bCOMMIT\x00" in data:
                            self.cut_commit = False
                            self.drops += 1
                            state["cut"] = time.monotonic()
                    state["sent"] += len(data)
                elif state["cut"] is not None:
                    break
                if self.rate:
                    time.sleep(len(data) / self.rate)
                dst.sendall(data)
                if upstream and state["cut"] is not None:
                    # The COMMIT is delivered; its answer never comes back to the loader.
                    time.sleep(0.3)
                    break
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                s.close()

    def close(self):
        self.alive = False
        self.listener.close()
