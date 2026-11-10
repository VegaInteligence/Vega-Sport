-- Copies of display images in S3 (doc, core.assets: "images copiées dans S3"). An
-- asset keeps its source URL; the worker stores the image once under a key made of
-- its SHA-256, and the read API maps source URLs to those copies (media=1, as on main).
CREATE TABLE ops.asset_mirror (
  asset_id integer PRIMARY KEY REFERENCES core.assets ON DELETE CASCADE,
  attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  error_code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_mirror_due ON ops.asset_mirror(next_attempt_at);
CREATE INDEX assets_unmirrored ON core.assets(id) WHERE s3_key IS NULL AND source_url IS NOT NULL;

CREATE VIEW api.media_assets AS
SELECT source_url, s3_key, content_type FROM core.assets
WHERE s3_key IS NOT NULL AND source_url IS NOT NULL;
