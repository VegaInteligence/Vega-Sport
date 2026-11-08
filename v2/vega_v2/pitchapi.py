"""In-memory PitchAPI transport. Never persists provider responses or credentials."""

from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE_URL = "https://api.pitchapi.dev/v1"
_ID = r"[A-Za-z0-9]{6}"
_ENDPOINTS = (
    r"/leagues",
    rf"/leagues/l_{_ID}",
    rf"/leagues/l_{_ID}/matches",
    r"/date/\d{4}-\d{2}-\d{2}",
    rf"/teams/t_{_ID}",
    rf"/players/p_{_ID}",
    *(
        rf"/matches/m_{_ID}" + suffix
        for suffix in (
            "",
            "/shots",
            "/events",
            "/lineups",
            "/momentum",
            "/stats",
            "/players",
            "/players/halves",
            "/h2h",
            "/advanced",
            "/advanced/players",
            "/advanced/network",
            "/heatmaps",
        )
    ),
)
assert len(_ENDPOINTS) == 19


class PitchError(Exception):
    def __init__(self, code, status=None, envelope_shape=None, access_reason=None):
        super().__init__(code)
        self.code, self.status, self.envelope_shape, self.access_reason = (
            code,
            status,
            envelope_shape,
            access_reason,
        )


@dataclass(frozen=True)
class PitchResult:
    data: object = None
    coverage: str = "ok"
    code: str | None = None


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _retry_delay(value):
    if not value:
        return None
    try:
        number = float(value)
        return max(0, number) if math.isfinite(number) else None
    except (ValueError, TypeError):
        try:
            timestamp = parsedate_to_datetime(value)
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            return max(0, (timestamp - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return None


def _access_reason(value):
    # Only classify documented top-level diagnostic fields; never retain their text.
    if not isinstance(value, dict):
        return "unspecified"
    parts = [
        value.get(k) for k in ("message", "detail") if isinstance(value.get(k), str)
    ]
    text = " ".join(parts).lower()[:2048]
    if re.search(r"\b(expired|expiration|expiry)\b", text) and re.search(
        r"\b(key|token|credential)\b", text
    ):
        return "credential_expired"
    if re.search(r"\b(invalid|revoked|unauthori[sz]ed)\b", text) and re.search(
        r"\b(key|token|credential|auth)", text
    ):
        return "credential_invalid"
    if re.search(r"\b(rate.limit|too many requests|quota)\b", text):
        return "rate_limited"
    if re.search(r"\b(ip|address)\b", text) and re.search(
        r"\b(block|denied|allow|restrict)", text
    ):
        return "ip_restricted"
    if re.search(r"\b(firewall|waf|cloudflare)\b", text):
        return "firewall"
    if re.search(r"\b(auth|permission|access denied|forbidden)", text):
        return "access_denied"
    return "unspecified"


class PitchClient:
    def __init__(
        self,
        key,
        *,
        interval=0.5,
        retries=3,
        timeout=30,
        transport=None,
        sleep=time.sleep,
        monotonic=time.monotonic,
        on_attempt=None,
    ):
        if not isinstance(key, str) or not re.fullmatch(
            r"pk_(?:live|test)_[A-Za-z0-9_-]+", key
        ):
            raise PitchError("INVALID_API_KEY")
        self._key, self.interval, self.retries, self.timeout = (
            key,
            interval,
            retries,
            timeout,
        )
        self._transport, self._sleep, self._clock = (
            transport or self._request,
            sleep,
            monotonic,
        )
        self._last = None
        self._on_attempt = on_attempt
        self._opener = build_opener(_NoRedirect())
        self.requests = 0

    def _request(self, request, timeout):
        try:
            with self._opener.open(request, timeout=timeout) as response:
                return response.status, response.headers, response.read()
        except HTTPError as error:
            return error.code, error.headers, error.read()

    def fetch(self, endpoint, params=None):
        if not isinstance(endpoint, str) or not any(
            re.fullmatch(pattern, endpoint) for pattern in _ENDPOINTS
        ):
            raise PitchError("INVALID_ENDPOINT")
        params = dict(params or {})
        allowed = (
            {"season", "status"}
            if endpoint.endswith("/matches") and endpoint.startswith("/leagues/")
            else (
                {"status"}
                if endpoint.startswith("/date/")
                else {"frame"} if endpoint.endswith("/heatmaps") else set()
            )
        )
        if set(params) - allowed:
            raise PitchError("INVALID_PARAMETER")
        if endpoint.endswith("/heatmaps"):
            if params.get("frame", "acting_ltr") != "acting_ltr":
                raise PitchError("INVALID_FRAME")
            params["frame"] = "acting_ltr"
        if "status" in params and params["status"] not in ("all", "played", "upcoming"):
            raise PitchError("INVALID_PARAMETER")
        if "season" in params and not re.fullmatch(
            r"\d{4}(?:/\d{4})?", str(params["season"])
        ):
            raise PitchError("INVALID_PARAMETER")
        url = BASE_URL + endpoint + ("?" + urlencode(params) if params else "")
        for attempt in range(self.retries + 1):
            if self._last is not None:
                self._sleep(max(0, self.interval - (self._clock() - self._last)))
            self._last = self._clock()
            self.requests += 1
            started = self._clock()

            def emit(status, code=None, request_id=None):
                if self._on_attempt:
                    self._on_attempt(
                        {
                            "status": status,
                            "error_code": code,
                            "duration_ms": max(
                                0, round((self._clock() - started) * 1000)
                            ),
                            "fetched_at": datetime.now(timezone.utc),
                            "request_id": request_id,
                        }
                    )

            try:
                status, headers, raw = self._transport(
                    Request(
                        url,
                        headers={
                            "X-API-KEY": self._key,
                            "Accept": "application/json",
                            "User-Agent": "VegaSport-V2Pilot/1.0",
                        },
                    ),
                    self.timeout,
                )
            except (URLError, OSError, TimeoutError):
                emit(None, "TRANSPORT_ERROR")
                raise PitchError("TRANSPORT_ERROR") from None
            request_id = headers.get("X-Request-ID") or headers.get("X-Request-Id")
            if (
                not isinstance(request_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", request_id)
                or request_id.startswith("pk_")
                or self._key in request_id
            ):
                request_id = None
            try:
                value = json.loads(raw)
            except (ValueError, TypeError):
                value = None
            code = (
                value.get("error", {}).get("code")
                if isinstance(value, dict) and isinstance(value.get("error"), dict)
                else None
            )
            known = (
                "RESOURCE_NOT_FOUND",
                "INVALID_PARAMETER",
                "UNAUTHORIZED",
                "RATE_LIMIT_EXCEEDED",
                "ANALYTICS_UNAVAILABLE",
                "HALVES_UNAVAILABLE",
                "INTERNAL_SERVER_ERROR",
            )
            data_present = (
                isinstance(value, dict)
                and "data" in value
                and value["data"] is not None
            )
            error_present = (
                isinstance(value, dict)
                and "error" in value
                and value["error"] is not None
            )
            valid = isinstance(value, dict) and data_present != error_present
            if value is None:
                shape = "root_null_or_invalid_json"
            elif isinstance(value, list):
                shape = "root_array"
            elif not isinstance(value, dict):
                shape = "root_scalar"
            elif data_present and error_present:
                shape = "object_both"
            elif not data_present and not error_present:
                shape = "object_neither"
            elif data_present:
                shape = "object_data"
            else:
                shape = "object_error"
            safe_code = (
                code
                if code in known
                else (
                    (
                        "INVALID_JSON"
                        if value is None
                        else "INVALID_ENVELOPE" if not valid else "PROVIDER_ERROR"
                    )
                    if not (200 <= status < 300 and valid and data_present)
                    else None
                )
            )
            if status == 403 and code not in known:
                safe_code = "HTTP_ACCESS_DENIED"
            emit(status, safe_code, request_id)
            if status in (429, 500, 502, 503, 504) and attempt < self.retries:
                delay = _retry_delay(headers.get("Retry-After"))
                self._sleep(max(0.5 * 2**attempt, delay or 0))
                continue
            if status == 403 and code not in known:
                raise PitchError(
                    "HTTP_ACCESS_DENIED", status, shape, _access_reason(value)
                )
            if value is None:
                raise PitchError("INVALID_JSON", status, shape)
            if not valid:
                raise PitchError("INVALID_ENVELOPE", status, shape)
            if 200 <= status < 300 and data_present:
                return PitchResult(data=value["data"])
            if status == 404 and code in (
                "ANALYTICS_UNAVAILABLE",
                "HALVES_UNAVAILABLE",
            ):
                return PitchResult(coverage="unavailable", code=code)
            raise PitchError(
                (
                    code
                    if code
                    in (
                        "RESOURCE_NOT_FOUND",
                        "INVALID_PARAMETER",
                        "UNAUTHORIZED",
                        "RATE_LIMIT_EXCEEDED",
                    )
                    else "PROVIDER_ERROR"
                ),
                status,
            )
        raise PitchError("PROVIDER_ERROR")
