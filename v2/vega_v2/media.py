"""Copies of display images in S3, same rules as dashboard/scripts/aws_assets.py (main).

Only images of the known providers are copied (PitchAPI CDN, Wikimedia Commons,
TheSports team and competition logos). A copy is a PNG, JPEG or WebP file of at
most 4 MB, recognised by its bytes (never by the announced type), stored once under
sources/v2/images/<sha256>.<ext>; CloudFront serves it at data/<key>, the pattern
the read API accepts. A failure is retried later (1 h, doubling, at most 30 days).
"""

from datetime import timedelta
import hashlib
import re
import struct
import time
from urllib.parse import urlsplit
import urllib.error
import urllib.request

ALLOWED = r"^https://(cdn\.pitchapi\.dev/|upload\.wikimedia\.org/wikipedia/commons/|img\.thesports\.com/football/(team|competition)/)"
MAX_BYTES = 4 * 1024 * 1024
PREFIX = "sources/v2/images/"
OBJECT_PREFIX = "data/"
USER_AGENT = "VegaSport/2.0 (https://github.com/VegaInteligence/Vega-Sport)"
TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class MediaError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def sniff(body):
    """(extension, width, height) of a PNG, JPEG or WebP image; MediaError otherwise."""
    if body[:8] == b"\x89PNG\r\n\x1a\n" and body[12:16] == b"IHDR" and len(body) >= 24:
        width, height = struct.unpack(">II", body[16:24])
        return "png", width, height
    if body[:3] == b"\xff\xd8\xff":
        i = 2
        while i + 9 < len(body):
            if body[i] != 0xFF:
                i += 1
                continue
            marker = body[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                i += 1 if marker == 0xFF else 2
                continue
            length = struct.unpack(">H", body[i + 2:i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack(">HH", body[i + 5:i + 9])
                return "jpg", width, height
            i += 2 + length
        return "jpg", None, None
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP" and len(body) >= 30:
        chunk = body[12:16]
        if chunk == b"VP8X":
            return "webp", 1 + int.from_bytes(body[24:27], "little"), 1 + int.from_bytes(body[27:30], "little")
        if chunk == b"VP8L" and body[20] == 0x2F:
            bits = int.from_bytes(body[21:25], "little")
            return "webp", 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
        if chunk == b"VP8 " and body[23:26] == b"\x9d\x01\x2a":
            width, height = struct.unpack("<HH", body[26:30])
            return "webp", width & 0x3FFF, height & 0x3FFF
        return "webp", None, None
    raise MediaError("NOT_AN_IMAGE")


def _dimension(value):
    return value if value is not None and 0 < value <= 32767 else None


def downloader(*, timeout=20, commons_interval=0.3):
    """HTTPS GET of an allowed URL, at most MAX_BYTES, no redirect to another host;
    Wikimedia requests are spaced as on main."""
    last = {}

    class SameHost(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if urlsplit(newurl).scheme != "https" or urlsplit(newurl).hostname != urlsplit(req.full_url).hostname:
                raise MediaError("REDIRECT_REFUSED")
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    opener = urllib.request.build_opener(SameHost)

    def get(url):
        if not re.match(ALLOWED, url):
            raise MediaError("SOURCE_NOT_ALLOWED")
        host = urlsplit(url).hostname
        if host == "upload.wikimedia.org":
            time.sleep(max(0.0, commons_interval - (time.monotonic() - last.get(host, 0.0))))
            last[host] = time.monotonic()
        try:
            with opener.open(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as response:
                body = response.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise MediaError(f"HTTP_{error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise MediaError("TRANSPORT_ERROR") from None
        if len(body) > MAX_BYTES:
            raise MediaError("TOO_LARGE")
        return body

    return get


def s3_writer(bucket, client=None):
    """put(key, body, content_type): idempotent, content-addressed, checked by MD5."""
    import base64
    import boto3
    from botocore.exceptions import ClientError

    s3 = client or boto3.client("s3")

    def put(key, body, content_type):
        name = OBJECT_PREFIX + key
        try:
            s3.head_object(Bucket=bucket, Key=name)
            return False
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey", "NotFound"):
                raise MediaError("STORAGE_ERROR") from None
        md5 = hashlib.md5(body).digest()
        result = s3.put_object(
            Bucket=bucket, Key=name, Body=body, ContentType=content_type,
            ContentMD5=base64.b64encode(md5).decode(), CacheControl="public, max-age=31536000, immutable",
        )
        if result.get("ETag", "").strip('"') != md5.hex():
            raise MediaError("STORAGE_CHECKSUM")
        return True

    return put


def mirror(conn, get, put, now, *, limit=200):
    """Copy up to `limit` due images; returns {code: count} ("ok" for copies)."""
    rows = conn.execute(
        """SELECT a.id, a.source_url FROM core.assets a
           LEFT JOIN ops.asset_mirror m ON m.asset_id = a.id
           WHERE a.s3_key IS NULL AND a.source_url IS NOT NULL AND a.source_url ~ %s
             AND (m.asset_id IS NULL OR m.next_attempt_at <= %s)
           ORDER BY m.attempts NULLS FIRST, a.id LIMIT %s""",
        (ALLOWED, now, limit),
    ).fetchall()
    outcomes = {}
    for asset_id, url in rows:
        try:
            body = get(url)
            ext, width, height = sniff(body)
            digest = hashlib.sha256(body).digest()
            key = f"{PREFIX}{digest.hex()}.{ext}"
            put(key, body, TYPES[ext])
            with conn.transaction():
                conn.execute(
                    """UPDATE core.assets SET s3_key=%s, sha256=%s, content_type=%s, width=%s, height=%s, updated_at=now()
                       WHERE id=%s""",
                    (key, digest, TYPES[ext], _dimension(width), _dimension(height), asset_id),
                )
                conn.execute("DELETE FROM ops.asset_mirror WHERE asset_id=%s", (asset_id,))
            code = "ok"
        except MediaError as error:
            code = error.code
            with conn.transaction():
                conn.execute(
                    """INSERT INTO ops.asset_mirror(asset_id, attempts, next_attempt_at, error_code, updated_at)
                       VALUES (%s, 1, %s, %s, now())
                       ON CONFLICT (asset_id) DO UPDATE SET attempts = least(ops.asset_mirror.attempts + 1, 32000),
                         next_attempt_at = %s + least(interval '30 days', interval '1 hour' * power(2, ops.asset_mirror.attempts)),
                         error_code = EXCLUDED.error_code, updated_at = now()""",
                    (asset_id, now + timedelta(hours=1), code, now),
                )
        outcomes[code] = outcomes.get(code, 0) + 1
    return outcomes
