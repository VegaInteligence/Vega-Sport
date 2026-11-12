-- The league strength index: each league's level on the Elo's scale (agg.league_levels,
-- 067) is shown on its page, with its level at the end of each season, which the Elo run
-- now keeps: the mean strength of the league's clubs after their last match of the
-- season (power.league_seasons).
CREATE TABLE agg.league_level_seasons (
  competition_id integer NOT NULL REFERENCES core.competitions ON DELETE CASCADE,
  season_id smallint NOT NULL REFERENCES core.seasons,
  level real NOT NULL,
  teams integer NOT NULL,
  run_id integer NOT NULL REFERENCES agg.power_runs,
  PRIMARY KEY (competition_id, season_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.league_level_seasons TO vega_calc;

CREATE VIEW api.league_levels AS
SELECT coalesce(cp.provider_key, 'l_v' || lpad(l.competition_id::text, 7, '0')) AS competition_id, c.name, c.country_code AS country,
  l.level::numeric::float8 AS level, l.entry_level::numeric::float8 AS entry_level, l.teams, l.links, l.linked,
  r.finished_at AS computed_at, r.method_version, l.competition_id AS competition_key
FROM agg.league_levels l
JOIN core.competitions c ON c.id = l.competition_id
JOIN agg.power_runs r ON r.id = l.run_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = l.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current;

CREATE VIEW api.league_level_seasons AS
SELECT s.competition_id AS competition_key, se.label AS season, s.season_id, s.level::numeric::float8 AS level, s.teams
FROM agg.league_level_seasons s
JOIN core.seasons se ON se.id = s.season_id;

GRANT SELECT ON api.league_levels, api.league_level_seasons TO vega_read;
