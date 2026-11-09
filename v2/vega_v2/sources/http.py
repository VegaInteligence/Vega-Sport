"""Bounded client for public sources: HTTPS only, no redirect off the host, retries
with backoff on 429/5xx, a minimum interval between calls. JSON by default; an
adapter that reads a page (FIFA's edition catalogue) asks for text."""

import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import SourceError

MAX_BYTES = 8 * 1024 * 1024


class _SameHost(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).hostname != urlparse(req.full_url).hostname:
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def json_getter(*, interval=0.5, retries=3, timeout=30, sleep=time.sleep, clock=time.monotonic):
    opener = build_opener(_SameHost())
    last = [None]

    def get(url, *, as_text=False):
        if urlparse(url).scheme != "https":
            raise SourceError("HTTPS_REQUIRED")
        for attempt in range(retries + 1):
            if last[0] is not None:
                sleep(max(0, interval - (clock() - last[0])))
            last[0] = clock()
            try:
                accept = "text/html" if as_text else "application/json"
                with opener.open(Request(url, headers={"Accept": accept, "User-Agent": "VegaSport-V2/1.0"}), timeout=timeout) as r:
                    body = r.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise SourceError("TOO_LARGE")
                return body.decode("utf-8") if as_text else json.loads(body)
            except HTTPError as error:
                if (error.code == 429 or error.code >= 500) and attempt < retries:
                    sleep(0.5 * 2**attempt)
                    continue
                raise SourceError(f"HTTP_{error.code}") from None
            except (URLError, OSError, TimeoutError):
                if attempt < retries:
                    sleep(0.5 * 2**attempt)
                    continue
                raise SourceError("TRANSPORT_ERROR") from None
            except ValueError:  # JSON, or UTF-8 of a page
                raise SourceError("INVALID_JSON") from None
        raise SourceError("TRANSPORT_ERROR")

    return get
