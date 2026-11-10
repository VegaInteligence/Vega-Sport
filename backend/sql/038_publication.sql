-- The publication generation advances at a set rhythm, not at every write. It was the sum
-- of every resource version, so with the worker writing all the time it changed every few
-- seconds, and a page whose reads are pinned to one generation (the club profile reads a
-- whole league) failed with 409 "Les données ont été actualisées". The worker now
-- publishes (vega_v2/worker.py, publish): at most every PUBLISH_EVERY, and only when a
-- resource changed, the generation takes the sum of the versions at that moment. Reads
-- stay live; the generation is the fence and the cache key of the site, as main's
-- publisher made it.
CREATE TABLE ops.publication (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  generation bigint NOT NULL,
  published_at timestamptz NOT NULL,
  source_version bigint NOT NULL
);

INSERT INTO ops.publication(generation, published_at, source_version)
SELECT coalesce(sum(version), 0), coalesce(max(coalesce(published_at, updated_at)), now()), coalesce(sum(version), 0)
FROM ops.resource_versions;

CREATE OR REPLACE VIEW api.publication AS
SELECT generation, published_at FROM ops.publication;
