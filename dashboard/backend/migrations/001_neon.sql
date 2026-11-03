-- Additive migration: original sources stay in private Neon Object Storage.
CREATE SCHEMA IF NOT EXISTS statarena;
CREATE TABLE IF NOT EXISTS statarena.objects (
 path text PRIMARY KEY, size bigint NOT NULL CHECK(size>=0), sha256 bytea NOT NULL,
 etag text NOT NULL, body bytea, content_type text NOT NULL DEFAULT 'application/json',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS statarena.resources (
 endpoint text NOT NULL, params text NOT NULL DEFAULT '{}', status smallint NOT NULL,
 ref jsonb, error jsonb, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(endpoint,params)
);
CREATE TABLE IF NOT EXISTS statarena.shards (id text PRIMARY KEY, ref jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS statarena.observations (id text PRIMARY KEY, shard text NOT NULL REFERENCES statarena.shards(id), ordinal integer NOT NULL);
CREATE TABLE IF NOT EXISTS statarena.fixtures (
 id text PRIMARY KEY, league_id text NOT NULL, season text NOT NULL, day date,
 status text, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixtures_day ON statarena.fixtures(day,status);
CREATE INDEX IF NOT EXISTS fixtures_league_season ON statarena.fixtures(league_id,season,status);
CREATE TABLE IF NOT EXISTS statarena.jobs (
 endpoint text NOT NULL, params text NOT NULL DEFAULT '{}', priority smallint NOT NULL DEFAULT 3,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','done','unavailable')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, last_status smallint, last_error text, PRIMARY KEY(endpoint,params)
);
CREATE INDEX IF NOT EXISTS jobs_pending ON statarena.jobs(priority,available_at) WHERE state='pending';
CREATE INDEX IF NOT EXISTS jobs_leases ON statarena.jobs(lease_until) WHERE state='running';
CREATE TABLE IF NOT EXISTS statarena.state (name text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS statarena.projections (name text NOT NULL, params text NOT NULL DEFAULT '{}', body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(name,params));
CREATE TABLE IF NOT EXISTS statarena.assets (url text PRIMARY KEY, path text NOT NULL REFERENCES statarena.objects(path), content_type text NOT NULL);
CREATE TABLE IF NOT EXISTS statarena.dirty_partitions (season text NOT NULL, league_id text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(season,league_id));
INSERT INTO statarena.state(name,value) VALUES('revision','1'::jsonb) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS statarena.asset_jobs(url text PRIMARY KEY,attempts int NOT NULL DEFAULT 0,next_attempt timestamptz NOT NULL DEFAULT now(),error text);
CREATE TABLE IF NOT EXISTS statarena.ingest_failures(endpoint text NOT NULL,params text NOT NULL,status smallint NOT NULL,error jsonb,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(endpoint,params));
