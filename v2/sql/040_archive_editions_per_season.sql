-- An archive edition is unique within its sporting season, not across seasons. A
-- calendar-year competition appears in the archive data of the two sporting seasons it
-- spans, under the same key; main shows it in each season with that season's matches.
-- With one key across seasons, the second season's matches pointed at the first
-- season's edition and broke the (competition_season_id, season_id) foreign key (the
-- full archive import stopped at 1964).
ALTER TABLE core.competition_seasons DROP CONSTRAINT competition_seasons_archive_key_key;
CREATE UNIQUE INDEX competition_seasons_season_archive_key ON core.competition_seasons(season_id, archive_key)
  WHERE archive_key IS NOT NULL;
