#!/usr/bin/env python3
"""Resumable PitchAPI collection: all catalogue seasons, then complete matches.

Default: collect every fixture index with status=all. --details (or --all) then
collects 13 nonredundant match payloads and unique league/team/player profiles.
Only the Python standard library is used. --plan is entirely offline.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
import math
import os
from pathlib import Path
import re
import shlex
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[2]
BASE_URL = "https://api.pitchapi.dev/v1"
DEFAULT_OUTPUT = ROOT / "data/sources/pitchapi/full"
LOCAL_CATALOG = ROOT / "data/sources/pitchapi/archives/europe_2026_2027/catalogue.json"
ID_PATTERN = re.compile(r"^[ltpm]_[A-Za-z0-9]{6}$")
KEY_PATTERN = re.compile(r"^pk_(?:live|test)_[A-Za-z0-9_-]+$")
CREDENTIAL_PATTERN = re.compile(r"pk_(?:live|test)_[A-Za-z0-9_-]+")
MATCH_ENDPOINTS = (
    ("summary", ""), ("shots", "/shots"), ("momentum", "/momentum"),
    ("events", "/events"), ("players", "/players"),
    ("players_halves", "/players/halves"), ("lineups", "/lineups"),
    ("h2h", "/h2h"), ("stats", "/stats"), ("advanced", "/advanced"),
    ("advanced_players", "/advanced/players"),
    ("advanced_network", "/advanced/network"), ("heatmaps", "/heatmaps"),
)


class CollectionError(Exception):
    """A collection cannot be marked complete."""


class AuthenticationError(CollectionError):
    """Stop immediately instead of retrying a bad key across the catalogue."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # Never forward the credential to a redirect destination.
        return None


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_api_key(environ=None, env_path=None):
    environ = os.environ if environ is None else environ
    key = environ.get("PITCHAPI_API_KEY", "").strip()
    if not key:
        env_path = Path(env_path or ROOT / "dashboard/.env")
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8-sig").splitlines():
                match = re.match(r"^\s*(?:export\s+)?PITCHAPI_API_KEY\s*=\s*(.*?)\s*$", line)
                if match:
                    try:
                        parts = shlex.split(match.group(1), comments=True)
                    except ValueError:
                        parts = []
                    key = parts[0] if len(parts) == 1 else ""
                    break
    if not KEY_PATTERN.fullmatch(key):
        raise AuthenticationError("Configure PITCHAPI_API_KEY in the environment or the repository .env file.")
    return key


def sanitize(value, secret=None):
    """Retain all data except credential-like strings, including echoed errors."""
    if isinstance(value, str):
        if secret:
            value = value.replace(secret, "[REDACTED]")
        return CREDENTIAL_PATTERN.sub("[REDACTED]", value)
    if isinstance(value, dict):
        return {sanitize(str(key), secret): sanitize(item, secret) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item, secret) for item in value]
    return value


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(sanitize(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


def retry_after_seconds(value, now=None):
    if not value:
        return None
    try:
        seconds = float(value)
        if math.isfinite(seconds):
            return max(0.0, seconds)
    except (TypeError, ValueError):
        pass
    try:
        date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        current = datetime.now(timezone.utc) if now is None else now
        return max(0.0, (date - current).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return None


class PitchClient:
    """Serial HTTP client with bounded retries and a conservative request pace."""

    def __init__(self, api_key, interval=0.5, max_retries=4, timeout=30, transport=None, sleep=time.sleep, monotonic=time.monotonic):
        self._api_key = api_key
        self.interval = interval
        self.max_retries = max_retries
        self.timeout = timeout
        self._transport = transport or self._http_transport
        self._sleep = sleep
        self._monotonic = monotonic
        self._last_request = None
        self.requests = 0
        self._opener = build_opener(NoRedirects())

    def _http_transport(self, request, timeout):
        try:
            with self._opener.open(request, timeout=timeout) as response:
                return response.status, dict(response.headers), response.read()
        except HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def fetch(self, endpoint, params=None):
        params = dict(params or {})
        url = BASE_URL + endpoint
        if params:
            url += "?" + urlencode(params, quote_via=quote)
        history = []
        for attempt in range(self.max_retries + 1):
            if self._last_request is not None:
                wait = self.interval - (self._monotonic() - self._last_request)
                if wait > 0:
                    self._sleep(wait)
            self._last_request = self._monotonic()
            self.requests += 1
            response = None
            body_text = None
            headers = {}
            error_info = None
            try:
                request = Request(url, headers={"X-API-KEY": self._api_key, "Accept": "application/json", "User-Agent": "Orion-Football-Ranking/1.0"}, method="GET")
                status, headers, body = self._transport(request, self.timeout)
                text = body.decode("utf-8-sig", errors="replace")
                try:
                    response = json.loads(text)
                except ValueError:
                    body_text = text
                    error_info = {"code": "INVALID_JSON", "message": "The upstream response was not JSON."}
                ok = 200 <= status < 300 and isinstance(response, dict) and "data" in response and "error" not in response
                if not ok and error_info is None:
                    upstream = response.get("error") if isinstance(response, dict) else None
                    error_info = upstream if isinstance(upstream, dict) else {"code": "UPSTREAM_ERROR", "message": "The upstream response was unsuccessful or had no data envelope."}
            except (URLError, OSError, TimeoutError) as error:
                status = None
                ok = False
                error_info = {"code": "NETWORK_ERROR", "message": type(error).__name__}
            retry_header = next((value for name, value in headers.items() if name.lower() == "retry-after"), None)
            delay = retry_after_seconds(retry_header)
            history.append({
                "status": status,
                "retryAfter": retry_header,
                "errorCode": error_info.get("code") if isinstance(error_info, dict) else None,
                **({"response": response, "error": error_info} if not ok else {}),
                **({"bodyText": body_text} if body_text is not None else {}),
            })
            observed_at = datetime.now(timezone.utc)
            record = sanitize({
                "schemaVersion": 1,
                "request": {"endpoint": endpoint, "params": params},
                "retrievedAt": observed_at.isoformat().replace("+00:00", "Z"),
                "status": status,
                "ok": ok,
                "response": response,
                "error": error_info,
                "attempts": history,
                **({"retryNotBefore": (observed_at + timedelta(seconds=delay)).isoformat().replace("+00:00", "Z")} if not ok and delay is not None and (status == 429 or status is not None and 500 <= status < 600) else {}),
                **({"bodyText": body_text} if body_text is not None else {}),
            }, self._api_key)
            retryable = status is None or status == 429 or (status is not None and 500 <= status < 600)
            if ok or not retryable or attempt == self.max_retries:
                return record
            # Retry-After is a lower bound; it is never shortened by backoff.
            self._sleep(max(delay or 0, min(60.0, 2.0 ** attempt)))
        raise AssertionError("Unreachable request state")


class Checkpoints:
    def __init__(self, output, client, retry_errors=False):
        self.root = Path(output)
        self.client = client
        self.retry_errors = retry_errors
        self.cached = 0

    def get(self, relative_path, endpoint, params=None, refresh=False):
        path = self.root / relative_path
        previous = read_json(path)
        request = {"endpoint": endpoint, "params": dict(params or {})}
        if not refresh and isinstance(previous, dict) and previous.get("request") == request:
            status = previous.get("status")
            permanent_error = isinstance(status, int) and 400 <= status < 500 and status not in {401, 403, 429}
            if previous.get("ok") or (permanent_error and not self.retry_errors):
                self.cached += 1
                return previous
        if isinstance(previous, dict) and previous.get("request") == request and previous.get("retryNotBefore"):
            try:
                not_before = datetime.fromisoformat(previous["retryNotBefore"].replace("Z", "+00:00"))
                wait = (not_before - datetime.now(timezone.utc)).total_seconds()
                if wait > 0:
                    self.client._sleep(wait)
            except (TypeError, ValueError):
                pass
        record = self.client.fetch(endpoint, params)
        atomic_json(path, record)
        if record["status"] in {401, 403}:
            raise AuthenticationError("PitchAPI refused authentication or access. Check the server-side API key.")
        return record


def payload(record):
    response = record.get("response") if isinstance(record, dict) else None
    return response.get("data") if record.get("ok") and isinstance(response, dict) else None


def catalogue_pairs(catalogue):
    data = catalogue.get("data", catalogue) if isinstance(catalogue, dict) else None
    leagues = data.get("leagues") if isinstance(data, dict) else None
    if not isinstance(leagues, list):
        raise CollectionError("The catalogue has no leagues array.")
    pairs = []
    seen = set()
    for league in leagues:
        league_id = league.get("id") if isinstance(league, dict) else None
        if not isinstance(league_id, str) or not re.fullmatch(r"l_[A-Za-z0-9]{6}", league_id):
            raise CollectionError("The catalogue contains an invalid league ID.")
        seasons = league.get("seasons")
        if not isinstance(seasons, list):
            raise CollectionError("A catalogue league has no seasons array.")
        for season in seasons:
            if not isinstance(season, str) or not re.fullmatch(r"\d{4}(?:/\d{4})?", season):
                raise CollectionError("The catalogue contains an unsupported season format.")
            if (league_id, season) not in seen:
                seen.add((league_id, season))
                pairs.append((league_id, season))
    return leagues, pairs


def season_index_path(league_id, season):
    return Path("seasons") / league_id / quote(season, safe="") / "matches.json"


def discover_ids(value, team_ids, player_ids):
    if isinstance(value, str):
        if re.fullmatch(r"t_[A-Za-z0-9]{6}", value):
            team_ids.add(value)
        elif re.fullmatch(r"p_[A-Za-z0-9]{6}", value):
            player_ids.add(value)
    elif isinstance(value, dict):
        for item in value.values():
            discover_ids(item, team_ids, player_ids)
    elif isinstance(value, list):
        for item in value:
            discover_ids(item, team_ids, player_ids)


def response_category(record):
    if record.get("ok"):
        return "ok"
    if record.get("status") == 404:
        return "unavailable"
    return "failed"


def collect(client, output, details=False, refresh_indexes=False, refresh_details=False, retry_errors=False, progress=print):
    """Collect every advertised season before starting any finished-match detail."""
    output = Path(output)
    checkpoints = Checkpoints(output, client, retry_errors)
    previous = read_json(output / "manifest.json") or {}
    manifest = {
        "schemaVersion": 1,
        "source": BASE_URL,
        "startedAt": previous.get("startedAt") or utc_now(),
        "updatedAt": utc_now(),
        "status": "running",
        "mode": "all" if details else "indexes",
        "stage": "catalogue",
        "catalogue": {"leagues": 0, "seasonPairs": 0},
        "indexes": {"ok": 0, "failed": 0, "listedFixtures": 0, "uniqueMatches": 0, "finishedMatches": 0},
        "details": {"matchesProcessed": 0, "payloadsPerMatch": len(MATCH_ENDPOINTS), "ok": 0, "unavailable": 0, "failed": 0},
        "profiles": {"leagues": 0, "teams": 0, "players": 0, "ok": 0, "unavailable": 0, "failed": 0},
        "networkRequestsThisRun": 0,
        "cachedResponsesThisRun": 0,
        "problems": [],
    }

    def checkpoint():
        manifest["updatedAt"] = utc_now()
        manifest["networkRequestsThisRun"] = client.requests
        manifest["cachedResponsesThisRun"] = checkpoints.cached
        atomic_json(output / "manifest.json", manifest)

    checkpoint()
    try:
        catalog = checkpoints.get("catalog.json", "/leagues", refresh=refresh_indexes)
        if not catalog.get("ok"):
            raise CollectionError("The catalogue request failed; collection stopped.")
        leagues, pairs = catalogue_pairs(catalog["response"])
        manifest["catalogue"] = {"leagues": len(leagues), "seasonPairs": len(pairs)}
        manifest["stage"] = "indexes"
        checkpoint()
        fixtures = {}
        team_ids, player_ids = set(), set()
        for index, (league_id, season) in enumerate(pairs, 1):
            result = checkpoints.get(season_index_path(league_id, season), f"/leagues/{league_id}/matches", {"season": season, "status": "all"}, refresh=refresh_indexes)
            season_data = payload(result)
            matches = season_data.get("matches") if isinstance(season_data, dict) else None
            if isinstance(matches, list):
                manifest["indexes"]["ok"] += 1
                manifest["indexes"]["listedFixtures"] += len(matches)
                for match in matches:
                    match_id = match.get("id") if isinstance(match, dict) else None
                    if not isinstance(match_id, str) or not re.fullmatch(r"m_[A-Za-z0-9]{6}", match_id):
                        manifest["problems"].append({"leagueId": league_id, "season": season, "code": "INVALID_MATCH_ID"})
                        continue
                    existing = fixtures.get(match_id)
                    if existing is None or match.get("status") == "finished":
                        fixtures[match_id] = match
                    discover_ids(match, team_ids, player_ids)
            else:
                manifest["indexes"]["failed"] += 1
                manifest["problems"].append({"leagueId": league_id, "season": season, "status": result.get("status"), "code": "INDEX_UNAVAILABLE"})
            manifest["indexes"]["uniqueMatches"] = len(fixtures)
            manifest["indexes"]["finishedMatches"] = sum(m.get("status") == "finished" for m in fixtures.values())
            progress(f"Index {index}/{len(pairs)} | {league_id} | {season} | {'ok' if isinstance(matches, list) else 'unavailable'}")
            checkpoint()
        if manifest["indexes"]["failed"] or manifest["problems"]:
            manifest["status"] = "index_incomplete"
            manifest["stage"] = "indexes"
            checkpoint()
            return manifest
        if not details:
            manifest["status"] = "index_complete"
            manifest["stage"] = "done"
            checkpoint()
            return manifest

        finished = sorted(match_id for match_id, match in fixtures.items() if match.get("status") == "finished")
        manifest["stage"] = "details"
        for index, match_id in enumerate(finished, 1):
            for name, suffix in MATCH_ENDPOINTS:
                result = checkpoints.get(Path("matches") / match_id / f"{name}.json", f"/matches/{match_id}{suffix}", refresh=refresh_details)
                manifest["details"][response_category(result)] += 1
                discover_ids(payload(result), team_ids, player_ids)
            manifest["details"]["matchesProcessed"] = index
            progress(f"Match {index}/{len(finished)} | {match_id} | 13 payload checkpoints")
            checkpoint()

        manifest["stage"] = "profiles"
        for league in leagues:
            league_id = league["id"]
            result = checkpoints.get(Path("leagues") / f"{league_id}.json", f"/leagues/{league_id}", refresh=refresh_details)
            manifest["profiles"]["leagues"] += 1
            manifest["profiles"][response_category(result)] += 1
            checkpoint()
        seen_teams, seen_players = set(), set()
        while team_ids - seen_teams or player_ids - seen_players:
            for kind, identifiers, seen in (("teams", team_ids, seen_teams), ("players", player_ids, seen_players)):
                for identity in sorted(identifiers - seen):
                    result = checkpoints.get(Path(kind) / f"{identity}.json", f"/{kind}/{identity}", refresh=refresh_details)
                    seen.add(identity)
                    manifest["profiles"][kind] += 1
                    manifest["profiles"][response_category(result)] += 1
                    discover_ids(payload(result), team_ids, player_ids)
                    progress(f"Profile {kind} | {identity} | {response_category(result)}")
                    checkpoint()
        manifest["stage"] = "done"
        manifest["status"] = "partial" if manifest["details"]["failed"] or manifest["profiles"]["failed"] else "complete"
        checkpoint()
        return manifest
    except KeyboardInterrupt:
        manifest["status"] = "interrupted"
        checkpoint()
        raise
    except AuthenticationError:
        manifest["status"] = "authentication_failed"
        checkpoint()
        raise
    except Exception:
        manifest["status"] = "failed"
        checkpoint()
        raise


def nonnegative_float(value):
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise argparse.ArgumentTypeError("Must be a finite nonnegative number.")
    return result


def nonnegative_int(value):
    result = int(value)
    if result < 0:
        raise argparse.ArgumentTypeError("Must be nonnegative.")
    return result


def positive_float(value):
    result = nonnegative_float(value)
    if result == 0:
        raise argparse.ArgumentTypeError("Must be greater than zero.")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Checkpoint directory.")
    parser.add_argument("--details", "--all", dest="details", action="store_true", help="After all indexes, collect finished-match details and profiles.")
    parser.add_argument("--plan", action="store_true", help="Print the scope from the local catalogue; no network or key access.")
    parser.add_argument("--catalog", type=Path, default=LOCAL_CATALOG, help="Local catalogue used only by --plan.")
    parser.add_argument("--refresh-indexes", action="store_true", help="Refresh the catalogue and season fixture indexes.")
    parser.add_argument("--refresh-details", action="store_true", help="Refresh match payloads and profiles, including successful checkpoints.")
    parser.add_argument("--retry-errors", action="store_true", help="Retry stored terminal 4xx responses as well as transient failures.")
    parser.add_argument("--interval", type=nonnegative_float, default=0.5, help="Minimum seconds between requests (default: 0.5, serial).")
    parser.add_argument("--max-retries", type=nonnegative_int, default=4, help="Retries after the initial request (default: 4).")
    parser.add_argument("--timeout", type=positive_float, default=30, help="Request timeout in seconds (default: 30).")
    args = parser.parse_args(argv)
    try:
        if args.plan:
            catalogue = read_json(args.catalog)
            if catalogue is None and args.catalog == LOCAL_CATALOG:
                import gzip
                bundled = ROOT / 'data/sources/pitchapi/bundles/europe_2026_2027/metadata/catalogue.json.gz'
                if bundled.is_file():
                    catalogue = json.loads(gzip.decompress(bundled.read_bytes()).decode('utf-8-sig'))
            if catalogue is None:
                raise CollectionError("The local catalogue could not be read.")
            leagues, pairs = catalogue_pairs(catalogue)
            print(f"Offline plan: {len(leagues)} leagues, {len(pairs)} league-season fixture indexes (status=all).")
            print(f"Full mode: {len(MATCH_ENDPOINTS)} payloads per finished match, plus unique league/team/player profiles.")
            print("The number of finished matches is unknown until the indexes have been collected.")
            return 0
        client = PitchClient(load_api_key(), interval=args.interval, max_retries=args.max_retries, timeout=args.timeout)
        manifest = collect(client, args.output, details=args.details, refresh_indexes=args.refresh_indexes, refresh_details=args.refresh_details, retry_errors=args.retry_errors)
        print(f"Collection status: {manifest['status']} | indexes {manifest['indexes']['ok']}/{manifest['catalogue']['seasonPairs']} | finished matches {manifest['indexes']['finishedMatches']} | HTTP requests this run {manifest['networkRequestsThisRun']} | cached {manifest['cachedResponsesThisRun']}")
        return 0 if manifest["status"] in {"index_complete", "complete"} else 1
    except KeyboardInterrupt:
        print("Collection interrupted. Completed response checkpoints are preserved for the next run.")
        return 130
    except (AuthenticationError, CollectionError) as error:
        print(str(error))
        return 1
    except Exception as error:
        # Do not leak a request object, local .env contents, or upstream body.
        print(f"Collection stopped ({type(error).__name__}). Inspect the sanitized checkpoint and resume.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
