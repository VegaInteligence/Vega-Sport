-- Domain columns for the eight supporting public API families.
-- Missing/nullable source structure is recorded separately from football values.
CREATE SCHEMA IF NOT EXISTS statarena_app;
CREATE TABLE IF NOT EXISTS statarena_app.support_projection (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL, params text NOT NULL, digest text NOT NULL,
  UNIQUE(name, params)
);

CREATE TABLE IF NOT EXISTS statarena_app.support_standing (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  competition text,
  season text,
  source text,
  fetched_at text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_standing_table (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  name text,
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_standing (projection_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_standing_row (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  ordinal_2 integer NOT NULL CHECK (ordinal_2 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  team_id text,
  uefa_id text,
  image_url text,
  name text,
  wins integer,
  draws integer,
  losses integer,
  played integer,
  points integer,
  goals_for integer,
  goals_against integer,
  difference integer,
  position integer,
  PRIMARY KEY (projection_id, ordinal_1, ordinal_2),
  FOREIGN KEY (projection_id, ordinal_1) REFERENCES statarena_app.support_standing_table (projection_id, ordinal_1) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_club (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  coach_name text,
  coach_photo_url text,
  coach_photo_author text,
  coach_photo_license text,
  coach_photo_source_url text,
  founded text,
  stadium text,
  stadium_alias text,
  stadium_id text,
  fetched_at text,
  source_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_coach (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  name text,
  lookup_version integer,
  photo_url text,
  photo_author text,
  photo_license text,
  photo_source_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_stadium (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  stadium_id text,
  capacity integer,
  capacity_as_of text,
  coordinates_lat double precision,
  coordinates_lon double precision,
  created text,
  opened text,
  fetched_at text,
  source_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_stadium_plan (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  title text,
  url text,
  image_url text,
  source text,
  detail text,
  format text,
  allow_geolocation boolean,
  embedded boolean,
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_stadium (projection_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_honours (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  available boolean,
  fetched_at text,
  identity_source_url text,
  revision integer,
  source text,
  source_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_honour_display_group (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  team_or_distinction text,
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_honours (projection_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_honour_display_item (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  ordinal_2 integer NOT NULL CHECK (ordinal_2 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  title text,
  title_count integer,
  edition_labels text,
  trophy_year integer,
  PRIMARY KEY (projection_id, ordinal_1, ordinal_2),
  FOREIGN KEY (projection_id, ordinal_1) REFERENCES statarena_app.support_honour_display_group (projection_id, ordinal_1) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_honour (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  category text,
  name text,
  team text,
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_honours (projection_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_honour_season (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  ordinal_2 integer NOT NULL CHECK (ordinal_2 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  season text,
  PRIMARY KEY (projection_id, ordinal_1, ordinal_2),
  FOREIGN KEY (projection_id, ordinal_1) REFERENCES statarena_app.support_honour (projection_id, ordinal_1) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_cup (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  name text,
  season text,
  source_license text,
  source_name text,
  source_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_cup_fixture (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  fixture_date date,
  group_name text,
  num integer,
  round text,
  team1 text,
  team2 text,
  score integer[] CHECK (score IS NULL OR cardinality(score) = 2),
  full_time integer[] CHECK (full_time IS NULL OR cardinality(full_time) = 2),
  half_time integer[] CHECK (half_time IS NULL OR cardinality(half_time) = 2),
  extra_time integer[] CHECK (extra_time IS NULL OR cardinality(extra_time) = 2),
  penalties integer[] CHECK (penalties IS NULL OR cardinality(penalties) = 2),
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_cup (projection_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_nations (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  season text,
  source_license text,
  source_name text,
  source_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_nations_fixture (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  fixture_date date,
  fixture_key text,
  home text,
  away text,
  home_id text,
  away_id text,
  league text,
  status text,
  group_number integer,
  round text,
  score integer[] CHECK (score IS NULL OR cardinality(score) = 2),
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_nations (projection_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_openliga (
  projection_id bigint NOT NULL,
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  competition text,
  season text,
  source_license text,
  source_name text,
  source_url text,
  source_data_url text,
  PRIMARY KEY (projection_id),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_projection (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS statarena_app.support_openliga_fixture (
  projection_id bigint NOT NULL,
  ordinal_1 integer NOT NULL CHECK (ordinal_1 >= 0),
  missing text[] NOT NULL,
  null_groups text[] NOT NULL,
  fixture_date date,
  fixture_key text,
  home text,
  away text,
  home_id text,
  away_id text,
  status text,
  group_number integer,
  round text,
  round_name text,
  score integer[] CHECK (score IS NULL OR cardinality(score) = 2),
  penalties integer[] CHECK (penalties IS NULL OR cardinality(penalties) = 2),
  notes text[],
  PRIMARY KEY (projection_id, ordinal_1),
  FOREIGN KEY (projection_id) REFERENCES statarena_app.support_openliga (projection_id) ON DELETE CASCADE
);
