-- 141 introduced the pointer and its archive deletion guard. The approved pack
-- records attribution per edition even where two editions share an asset.
SET LOCAL lock_timeout = '3s';
CREATE TABLE core.edition_artwork_provenance (
    competition_season_id integer PRIMARY KEY REFERENCES core.competition_seasons(id),
    asset_id integer NOT NULL REFERENCES core.assets(id),
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    certificate jsonb NOT NULL CHECK (certificate ->> 'asset_role' = 'edition_emblem'),
    linked_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON core.edition_artwork_provenance FROM PUBLIC, vega_collect, vega_read;
GRANT SELECT, INSERT ON core.edition_artwork_provenance TO vega_collect;
