"""Publish structured document content and its source version atomically."""
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
    status = "ready" if count else "unsupported"
    db.execute("""insert into statarena.file_document_sources(source_path,source_sha256,status,document_count,error_count)
                  values(%s,%s,%s,%s,%s) on conflict(source_path) do update set
                  source_sha256=excluded.source_sha256,status=excluded.status,document_count=excluded.document_count,
                  error_count=excluded.error_count,indexed_at=now()""", (source_path, source_sha, status, count, errors))
    return count, errors
