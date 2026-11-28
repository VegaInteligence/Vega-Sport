"""Where the assets come from, exactly (backend/panna/FAILURE_MODES.md, section 5): the named assets of one GitHub
release, or a frozen manifest; each file read into the scratch, outside AWS, its size and SHA-256 checked against the
listing before anything is decoded."""

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

from . import registry


class SourceError(Exception):
    def __init__(self, code, name=None, detail=None):
        super().__init__(code)
        self.code, self.name, self.detail = code, name, detail


@dataclass
class Asset:
    origin: str
    container: str
    name: str
    sha256: str
    bytes: int
    asset_id: int | None = None
    updated_at: str | None = None
    url: str | None = None
    path: str | None = None  # a local file the run reads in place (never removed)
    dataset: str | None = None

    def to_plan(self):
        return {k: v for k, v in asdict(self).items() if v is not None}


def _request(url, token=None, accept="application/vnd.github+json"):
    headers = {"Accept": accept, "User-Agent": "vega-panna-loader"}
    if token and urllib.parse.urlparse(url).hostname == "api.github.com":
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, headers=headers)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _get_json(url, token=None, attempts=4):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(_request(url, token), timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code in (403, 429, 500, 502, 503, 504) and attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise SourceError("LISTING_FAILED", detail=f"HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise SourceError("LISTING_FAILED", detail=type(error).__name__) from None


def list_release(api, repo, release, token=None):
    """{name: Asset} of one release, every page of releases and of its assets read."""
    api = api.rstrip("/")
    found = None
    page = 1
    while found is None:
        releases = _get_json(f"{api}/repos/{repo}/releases?per_page=100&page={page}", token)
        if not releases:
            raise SourceError("RELEASE_MISSING", release)
        found = next((r for r in releases if r.get("tag_name") == release), None)
        page += 1
    assets = {}
    page = 1
    while True:
        batch = _get_json(f"{api}/repos/{repo}/releases/{found['id']}/assets?per_page=100&page={page}", token)
        if not batch:
            break
        for a in batch:
            digest = (a.get("digest") or "")
            assets[a["name"]] = Asset(
                origin="github", container=release, name=a["name"],
                sha256=digest.removeprefix("sha256:") if digest.startswith("sha256:") else "",
                bytes=int(a["size"]), asset_id=a.get("id"), updated_at=a.get("updated_at"),
                url=a.get("browser_download_url"))
        page += 1
    return assets


def select(available, names=(), families=()):
    """The assets named, then every asset of each family named (sorted by name), fixtures before their children,
    each once. A name absent from the release stops the selection (ASSET_MISSING)."""
    chosen = {}
    for name in names:
        if name not in available:
            raise SourceError("ASSET_MISSING", name)
        chosen[name] = available[name]
    for family in families:
        dataset = registry.FAMILIES.get(family)
        if dataset is None:
            raise SourceError("FAMILY_UNKNOWN", family)
        for name in sorted(available):
            if dataset.matches(available[name].container, name):
                chosen.setdefault(name, available[name])
    out = []
    for asset in chosen.values():
        dataset = registry.dataset_of(asset.container, asset.name)
        if dataset is None:
            raise SourceError("NOT_IN_H1", asset.name)
        if len(asset.sha256 or "") != 64:
            raise SourceError("NO_DECLARED_DIGEST", asset.name)
        asset.dataset = dataset.name
        out.append(asset)
    order = {name: i for i, name in enumerate(registry.DATASETS)}
    return sorted(out, key=lambda a: (order[a.dataset], a.name))


def read_manifest(path, blobs=None):
    """{name: Asset} of a frozen manifest: {"assets": [{origin, container, name, sha256, bytes, path | url}]}; an entry
    without path or url is read from <blobs>/<sha256>."""
    body = json.loads(Path(path).read_text())
    assets = {}
    for entry in body.get("assets", []):
        asset = Asset(origin=entry.get("origin", "github"), container=entry.get("container", registry.RELEASE),
                      name=entry["name"], sha256=(entry.get("sha256") or "").removeprefix("sha256:"), bytes=int(entry["bytes"]),
                      asset_id=entry.get("asset_id"), updated_at=entry.get("updated_at"), url=entry.get("url"),
                      path=entry.get("path"))
        if not asset.path and not asset.url and blobs:
            asset.path = str(Path(blobs) / asset.sha256)
        if asset.name in assets:
            raise SourceError("MANIFEST_DUPLICATE", asset.name)
        assets[asset.name] = asset
    return assets


def file_digest(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def fetch(asset, scratch, ceiling=None):
    """The verified local file of `asset`, and whether the run owns it (a scratch file, removed once loaded)."""
    if asset.path and Path(asset.path).is_file():
        path = Path(asset.path)
        if path.stat().st_size != asset.bytes or file_digest(path) != asset.sha256:
            raise SourceError("DIGEST_MISMATCH", asset.name, "local file")
        return path, False
    scratch = Path(scratch)
    scratch.mkdir(parents=True, exist_ok=True)
    if len(asset.sha256 or "") != 64:
        raise SourceError("NO_DECLARED_DIGEST", asset.name)
    final = scratch / f"{asset.sha256}.parquet"
    if final.is_file() and final.stat().st_size == asset.bytes and file_digest(final) == asset.sha256:
        return final, True
    if not asset.url:
        raise SourceError("ASSET_UNREACHABLE", asset.name, "no path or url")
    if ceiling is not None:
        used = sum(p.stat().st_size for p in scratch.glob("*") if p.is_file())
        if used + asset.bytes > ceiling:
            raise SourceError("SCRATCH_CEILING", asset.name)
    part = scratch / f"{asset.sha256}.part"
    url, hops = asset.url, 0
    try:
        while True:
            try:
                response = _OPENER.open(_request(url, os.environ.get("GITHUB_TOKEN"), accept="application/octet-stream"), timeout=120)
            except urllib.error.HTTPError as error:
                if error.code in (301, 302, 303, 307, 308) and hops < 5:
                    url, hops = urllib.parse.urljoin(url, error.headers["Location"]), hops + 1
                    continue
                raise SourceError("DOWNLOAD_FAILED", asset.name, f"HTTP {error.code}") from None
            break
        h = hashlib.sha256()
        size = 0
        with response, open(part, "wb") as out:
            while chunk := response.read(1 << 20):
                h.update(chunk)
                size += len(chunk)
                out.write(chunk)
        if size != asset.bytes or h.hexdigest() != asset.sha256:
            raise SourceError("DIGEST_MISMATCH", asset.name, "downloaded bytes")
        part.replace(final)
        return final, True
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise SourceError("DOWNLOAD_FAILED", asset.name, type(error).__name__) from None
    finally:
        part.unlink(missing_ok=True)
