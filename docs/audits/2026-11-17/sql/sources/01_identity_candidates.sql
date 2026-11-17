WITH flags AS (
  SELECT 'player_same_name_dob' AS signal, count(*) AS copies
  FROM core.players WHERE birth_date IS NOT NULL AND nullif(btrim(name),'') IS NOT NULL
  GROUP BY lower(btrim(name)), birth_date HAVING count(*) > 1
  UNION ALL SELECT CASE WHEN is_national IS TRUE THEN 'nation_same_name_country'
                    WHEN is_national IS FALSE THEN 'club_same_name_country' ELSE 'team_unspecified_kind_same_name_country' END, count(*)
  FROM core.teams WHERE merged_into IS NULL AND country_code IS NOT NULL AND nullif(btrim(name),'') IS NOT NULL
  GROUP BY lower(btrim(name)), country_code, is_national HAVING count(*) > 1
  UNION ALL SELECT 'competition_same_name_country_kind', count(*) FROM core.competitions
  WHERE country_code IS NOT NULL GROUP BY lower(btrim(name)),country_code,kind HAVING count(*) > 1
  UNION ALL SELECT 'edition_same_competition_season',count(*) FROM core.competition_seasons
  GROUP BY competition_id,season_id HAVING count(*) > 1
  UNION ALL SELECT 'season_same_normalized_label',count(*) FROM core.seasons
  GROUP BY lower(btrim(label)) HAVING count(*) > 1
), signals(signal) AS (VALUES ('player_same_name_dob'),('nation_same_name_country'),('club_same_name_country'),('team_unspecified_kind_same_name_country'),('competition_same_name_country_kind'),('edition_same_competition_season'),('season_same_normalized_label'))
SELECT s.signal, count(f.copies) AS candidate_groups,coalesce(sum(f.copies),0) AS rows_in_groups,
       coalesce(sum(f.copies-1),0) AS rows_above_one
FROM signals s LEFT JOIN flags f USING(signal) GROUP BY s.signal ORDER BY s.signal
