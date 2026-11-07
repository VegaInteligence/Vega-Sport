-- A publication update marks projections dirty; expensive work runs after commit.
CREATE TABLE IF NOT EXISTS statarena_app.home_projection (
  scope_key text PRIMARY KEY,
  stamp text NOT NULL,
  computed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  snapshot jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS statarena_app.home_projection_queue (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation bigint NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION statarena_app.queue_home_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, statarena_app AS $$
BEGIN
  INSERT INTO statarena_app.home_projection_queue(singleton,generation,queued_at)
  VALUES (true, NEW.generation, clock_timestamp())
  ON CONFLICT(singleton) DO UPDATE SET generation=EXCLUDED.generation, queued_at=EXCLUDED.queued_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION statarena_app.queue_home_projection() FROM PUBLIC;
DROP TRIGGER IF EXISTS queue_home_projection ON statarena_app.publications;
CREATE TRIGGER queue_home_projection AFTER UPDATE OF generation ON statarena_app.publications
FOR EACH ROW WHEN (OLD.generation IS DISTINCT FROM NEW.generation)
EXECUTE FUNCTION statarena_app.queue_home_projection();
INSERT INTO statarena_app.home_projection_queue(singleton,generation)
SELECT true,generation FROM statarena_app.publications WHERE singleton
ON CONFLICT(singleton) DO UPDATE SET generation=EXCLUDED.generation,queued_at=clock_timestamp();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='statarena_runtime') THEN
  GRANT SELECT ON statarena_app.home_projection TO statarena_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='statarena_ingest') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON statarena_app.home_projection,statarena_app.home_projection_queue TO statarena_ingest;
 END IF;
END $$;
