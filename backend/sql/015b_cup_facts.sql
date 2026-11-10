-- Cup editions of the sources other than PitchAPI (doc: "les coupes … que PitchAPI ne
-- couvre pas", in core.matches with their source): OpenFootball cups, OpenLigaDB,
-- International Results. Like the archives, they stay out of the PitchAPI-era reads
-- (applied before the read views 016…); their reads are in 028_cups.sql.
ALTER TABLE core.competition_seasons
  ADD COLUMN cup_key text UNIQUE CHECK (cup_key ~ '^(open-cups|openligadb|nations-results):[A-Za-z0-9_-]+:\d{4}(/\d{4})?$'),
  ADD COLUMN cup_name text,
  ADD COLUMN cup_source_url text,
  ADD COLUMN cup_data_url text,
  ADD COLUMN cup_digest text,
  ADD COLUMN cup_checked_at timestamptz,
  ADD COLUMN cup_updated_at timestamptz;

-- The match number a cup source gives (OpenFootball "num").
ALTER TABLE core.matches ADD COLUMN match_number smallint CHECK (match_number > 0);
-- The score after 90 minutes when extra time was played (the match score is the final one).
ALTER TABLE core.matches
  ADD COLUMN home_score_90 smallint CHECK (home_score_90 >= 0),
  ADD COLUMN away_score_90 smallint CHECK (away_score_90 >= 0);
