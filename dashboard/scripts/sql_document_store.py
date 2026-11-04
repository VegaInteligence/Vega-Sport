"""Publish structured document content and its source version atomically."""
from psycopg.errors import UniqueViolation

from sql_document_parser import iter_documents


def publish_documents(db, source_path, source_sha, body):
    """Call inside the transaction that publishes statarena.objects."""
    db.execute("delete from statarena.file_documents where source_path=%s", (source_path,))
    count = 0
    errors = 0
    pending = []
    statement = """insert into statarena.file_documents(document_path,source_path,source_sha256,format,document,error)
                   values(%s,%s,%s,%s,%s::jsonb,%s)
                   on conflict(document_path) do update set source_path=excluded.source_path,
                   source_sha256=excluded.source_sha256,format=excluded.format,document=excluded.document,
                   error=excluded.error,indexed_at=now()"""
    def batches():
        nonlocal count, errors
        count = errors = 0
        pending.clear()
        with db.cursor() as cursor:
            for doc_path, kind, text, error in iter_documents(source_path, body):
                count += 1
                errors += bool(error)
                pending.append((doc_path, source_path, source_sha, kind, text, error))
                if len(pending) >= 256:
                    cursor.executemany(statement, pending)
                    pending.clear()
            if pending:
                cursor.executemany(statement, pending)

    # SQLite inventories and JSONL files can contain millions of records.
    # COPY avoids millions of individual insert commands. A savepoint allows
    # the normal upsert path to handle a colliding virtual document path.
    if source_path.lower().endswith((".sqlite", ".jsonl", ".jsonl.gz", ".ndjson", ".ndjson.gz")):
        try:
            with db.transaction():
                with db.cursor() as cursor:
                    with cursor.copy("""copy statarena.file_documents
                        (document_path,source_path,source_sha256,format,document,error) from stdin""") as copy:
                        for doc_path, kind, text, error in iter_documents(source_path, body):
                            count += 1
                            errors += bool(error)
                            copy.write_row((doc_path, source_path, source_sha, kind, text, error))
        except UniqueViolation:
            batches()
    else:
        batches()
    status = "ready" if count else "unsupported"
    db.execute("""insert into statarena.file_document_sources(source_path,source_sha256,status,document_count,error_count)
                  values(%s,%s,%s,%s,%s) on conflict(source_path) do update set
                  source_sha256=excluded.source_sha256,status=excluded.status,document_count=excluded.document_count,
                  error_count=excluded.error_count,indexed_at=now()""", (source_path, source_sha, status, count, errors))
    return count, errors
