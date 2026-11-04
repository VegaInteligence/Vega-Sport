"""Turn structured files into JSON documents without changing their source bytes."""
import base64
import csv
import gzip
import io
import json
import sqlite3
import tarfile
import tempfile
import zipfile
from urllib.parse import quote

SUPPORTED_SUFFIXES = (".json", ".json.gz", ".jsonl", ".jsonl.gz", ".ndjson", ".ndjson.gz", ".csv", ".csv.gz", ".tar.gz", ".tgz", ".zip", ".sqlite", ".txt", ".md", ".html")


def supports_documents(path):
    return path.lower().endswith(SUPPORTED_SUFFIXES)


def _reject_constant(value):
    raise ValueError("Non-standard JSON number: " + value)


def _validate_strings(value):
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if "\x00" in item:
                raise ValueError("JSON contains a NUL character")
            item.encode("utf-8")
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)


def _json_record(path, kind, payload):
    try:
        text = payload.decode("utf-8-sig")
        value = json.loads(text, parse_constant=_reject_constant)
        _validate_strings(value)
        return path, kind, text, None
    except (ValueError, UnicodeError, RecursionError) as error:
        return path, kind, None, type(error).__name__ + ": " + str(error)[:300]


def _csv_record(path, payload):
    try:
        text = payload.decode("utf-8-sig")
        try:
            dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(text, newline=""), dialect))
        content = {"headers": rows[0] if rows else [], "rows": rows[1:] if rows else []}
        _validate_strings(content)
        return path, "csv", json.dumps(content, ensure_ascii=False, separators=(",", ":")), None
    except (ValueError, UnicodeError, csv.Error) as error:
        return path, "csv", None, type(error).__name__ + ": " + str(error)[:300]


def _sql_value(value):
    if isinstance(value, bytes):
        return {"base64": base64.b64encode(value).decode("ascii")}
    return value


def _sqlite_records(path, payload):
    with tempfile.NamedTemporaryFile(suffix=".sqlite") as file:
        file.write(payload)
        file.flush()
        connection = sqlite3.connect("file:" + quote(file.name) + "?mode=ro&immutable=1", uri=True)
        try:
            tables = connection.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").fetchall()
            for (name,) in tables:
                safe_name = '"' + name.replace('"', '""') + '"'
                cursor = connection.execute("select * from " + safe_name)
                names = [column[0] for column in cursor.description]
                for row_number, row in enumerate(cursor, 1):
                    key = path + "!sqlite/" + quote(name, safe="") + "/" + str(row_number)
                    try:
                        doc = {name: _sql_value(value) for name, value in zip(names, row)}
                        _validate_strings(doc)
                        yield key, "sqlite-row", json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":")), None
                    except (ValueError, UnicodeError, TypeError) as error:
                        yield key, "sqlite-row", None, type(error).__name__ + ": " + str(error)[:300]
        finally:
            connection.close()


def iter_documents(path, payload):
    """Yield (virtual path, format, JSON text or None, error or None)."""
    lower = path.lower()
    try:
        if lower.endswith((".jsonl.gz", ".ndjson.gz", ".jsonl", ".ndjson")):
            stream = gzip.GzipFile(fileobj=io.BytesIO(payload)) if lower.endswith(".gz") else io.BytesIO(payload)
            with stream:
                for number, line in enumerate(stream, 1):
                    if line.strip():
                        yield _json_record(path + "!line/" + str(number), "jsonl", line)
        elif lower.endswith(".json.gz"):
            yield _json_record(path, "json", gzip.decompress(payload))
        elif lower.endswith(".json"):
            yield _json_record(path, "json", payload)
        elif lower.endswith((".csv", ".csv.gz")):
            yield _csv_record(path, gzip.decompress(payload) if lower.endswith(".gz") else payload)
        elif lower.endswith(".tar.gz") or lower.endswith(".tgz"):
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
                seen = {}
                for member in archive:
                    if member.isfile():
                        stream = archive.extractfile(member)
                        if stream is not None:
                            name = quote(member.name, safe="/._-")
                            seen[name] = seen.get(name, 0) + 1
                            if seen[name] > 1:
                                name = "duplicate-" + str(seen[name]) + "/" + name
                            yield from iter_documents(path + "!/" + name, stream.read())
        elif lower.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                seen = {}
                for member in archive.infolist():
                    if not member.is_dir():
                        name = quote(member.filename, safe="/._-")
                        seen[name] = seen.get(name, 0) + 1
                        if seen[name] > 1:
                            name = "duplicate-" + str(seen[name]) + "/" + name
                        yield from iter_documents(path + "!/" + name, archive.read(member))
        elif lower.endswith(".sqlite"):
            yield from _sqlite_records(path, payload)
        elif lower.endswith((".txt", ".md", ".html")):
            text = payload.decode("utf-8-sig")
            _validate_strings(text)
            yield path, "text", json.dumps(text, ensure_ascii=False), None
    except (OSError, EOFError, OverflowError, ValueError, UnicodeError, sqlite3.Error, tarfile.TarError, zipfile.BadZipFile) as error:
        yield path, "parse-error", None, type(error).__name__ + ": " + str(error)[:300]
