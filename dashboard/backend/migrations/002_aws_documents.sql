-- Query structured S3 file contents in PostgreSQL while preserving original files.
CREATE TABLE IF NOT EXISTS statarena.file_documents (
    document_path text PRIMARY KEY,
    source_path text NOT NULL REFERENCES statarena.objects(path) ON DELETE CASCADE,
    source_sha256 bytea NOT NULL,
    format text NOT NULL,
    document jsonb,
    error text,
    indexed_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((document IS NOT NULL AND error IS NULL) OR (document IS NULL AND error IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS file_documents_source_path ON statarena.file_documents(source_path);
CREATE TABLE IF NOT EXISTS statarena.file_document_sources (
    source_path text PRIMARY KEY REFERENCES statarena.objects(path) ON DELETE CASCADE,
    source_sha256 bytea NOT NULL,
    status text NOT NULL CHECK (status IN ('ready', 'unsupported')),
    document_count bigint NOT NULL,
    error_count bigint NOT NULL,
    indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixtures_home_team_id ON statarena.fixtures ((body->'home_team'->>'id'));
CREATE INDEX IF NOT EXISTS fixtures_away_team_id ON statarena.fixtures ((body->'away_team'->>'id'));

-- A file version is queryable only while its checksum matches the live catalog.
CREATE OR REPLACE VIEW statarena.current_file_documents AS
SELECT d.document_path, d.source_path, d.format, d.document, d.indexed_at
FROM statarena.file_documents AS d
JOIN statarena.objects AS o ON o.path=d.source_path AND o.sha256=d.source_sha256
JOIN statarena.file_document_sources AS s ON s.source_path=d.source_path AND s.source_sha256=d.source_sha256
WHERE d.error IS NULL AND s.status='ready';
