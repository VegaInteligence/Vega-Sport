-- Historical archives, their facts (doc: "environ 495 000 matchs d'archives … dans la même table
-- core.matches, avec source renseigné ; leurs buteurs dans core.match_events").
--
-- The archive is the season edition main builds (shared/archive.js): results of the
-- results sources, goals of the scorers source attached to the match they belong to,
-- goal-only matches kept as their own rows. These columns hold the facts that edition
-- shows and that no other column carries; nothing is stored as a document.

-- schochastics/football-data (World Club Ratings): Scottish results and the scorers.
ALTER TYPE core.provider ADD VALUE IF NOT EXISTS 'worldclub';

-- An archive edition: its key in the archive (e.g. "2015-16/en.1"), and how that
-- season's edition is named and placed by the source.
ALTER TABLE core.competition_seasons
  ADD COLUMN archive_key text UNIQUE,
  ADD COLUMN archive_name text,
  ADD COLUMN archive_country text,
  ADD COLUMN archive_position smallint;

-- An archive match: its key and place in the season edition, and its source facts.
ALTER TABLE core.matches
  ADD COLUMN archive_key text,
  ADD COLUMN archive_position integer,
  ADD COLUMN date_unverified boolean,
  ADD COLUMN is_neutral boolean,
  ADD COLUMN decided_on_penalties boolean;
CREATE UNIQUE INDEX matches_archive_key ON core.matches(season_id, archive_key) WHERE archive_key IS NOT NULL;

-- A goal of the scorers source: the minute as written ("45+2"), and whether the
-- match's goal count disagrees with its final score in that source.
ALTER TABLE core.match_events
  ADD COLUMN source_minute text,
  ADD COLUMN score_disagreement boolean;

-- Revision and licence of each imported source, for attribution (archive index).
CREATE TABLE core.source_revisions(
  source text PRIMARY KEY CHECK (source ~ '^[a-z0-9_./-]{1,80}$'),
  name text NOT NULL,
  url text,
  license text,
  revision text,
  archive_sha256 text,
  coverage text,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

-- Applied before the read views (016…): the PitchAPI-era views leave archive editions
-- out by these columns; the archive reads are in 025_archives.sql.
