-- Replace 2021 by one integer from editions.sql before execution. Output stable by edition.
-- Counts stored z independent of UI's 20-minute/exceptional-cameo gate. Source season is the edition;
-- the ranking clock is August to July and its source query reads award_year and award_year+1 partitions.
WITH f AS MATERIALIZED (
 SELECT m.id,m.competition_season_id AS edition_id,m.match_date,m.home_team_id,m.away_team_id,
        extract(year FROM m.match_date - interval '7 months')::int AS award,
        cs.cup_key IS NOT NULL AS cup,cs.archive_key IS NOT NULL AS archive
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
 WHERE m.season_id=2021 AND m.status='finished'
), s AS (
 SELECT f.*,p.player_id,p.minutes_played,p.team_id,
        p.team_id IN(f.home_team_id,f.away_team_id) AS team_on_field,
        NOT f.cup AND NOT f.archive AND 2021 IN (f.award,f.award+1)
        AND p.minutes_played>0 AND p.team_id IS NOT NULL AS input_admitted
 FROM f JOIN core.player_match_stats p ON p.season_id=2021 AND p.match_id=f.id
), evidence AS (
 SELECT s.*,pm.match_id IS NOT NULL AS processed,pm.contribution,pm.match_index,
        g.match_id IS NOT NULL AS grade_row,g.z,g.minutes AS grade_minutes,
        g.award_season,g.team_id AS grade_team_id
 FROM s LEFT JOIN agg.player_power_matches pm ON pm.season_id=s.award AND pm.match_id=s.id AND pm.player_id=s.player_id
 LEFT JOIN agg.player_match_grades g ON g.season_id=2021 AND g.match_id=s.id AND g.player_id=s.player_id
)
SELECT edition_id,count(*) AS stats_records,count(DISTINCT id) AS matches_with_stats,
 count(*) FILTER(WHERE minutes_played>0) AS positive_minutes,
 count(*) FILTER(WHERE minutes_played IS NULL) AS minutes_unknown,
 count(*) FILTER(WHERE minutes_played<=0) AS zero_or_negative_minutes,
 count(*) FILTER(WHERE minutes_played>0 AND team_on_field IS NOT TRUE) AS unknown_or_wrong_team,
 count(*) FILTER(WHERE minutes_played>0 AND (cup OR archive)) AS positive_minutes_in_excluded_domain,
 count(*) FILTER(WHERE minutes_played>0 AND NOT cup AND NOT archive AND (award IS NULL OR 2021 NOT IN (award,award+1))) AS positive_minutes_outside_award_window,
 count(*) FILTER(WHERE input_admitted) AS algorithm_inputs_before_coverage,
 count(*) FILTER(WHERE input_admitted AND NOT processed) AS admitted_without_power_match,
 count(*) FILTER(WHERE input_admitted AND processed AND contribution IS NULL) AS insufficient_contribution,
 count(*) FILTER(WHERE input_admitted AND processed AND contribution IS NOT NULL AND match_index IS NULL) AS insufficient_role_reference,
 count(*) FILTER(WHERE input_admitted AND match_index IS NOT NULL AND match_index::float8 BETWEEN '-1e308'::float8 AND '1e308'::float8) AS proven_scorable,
 count(*) FILTER(WHERE input_admitted AND match_index IS NOT NULL AND match_index::float8 BETWEEN '-1e308'::float8 AND '1e308'::float8
                      AND z::float8 BETWEEN '-1e308'::float8 AND '1e308'::float8 AND grade_team_id IS NOT DISTINCT FROM team_id AND award_season=award AND grade_minutes=minutes_played
                      AND abs(z::float8-match_index::float8)<=0.00011) AS scorable_valid_persisted,
 count(*) FILTER(WHERE input_admitted AND match_index IS NOT NULL AND NOT grade_row) AS missing_grade_for_computed_index,
 count(*) FILTER(WHERE grade_row) AS stored_on_stats,
 count(*) FILTER(WHERE grade_row AND (award_season IS DISTINCT FROM award OR grade_team_id IS DISTINCT FROM team_id OR grade_minutes IS DISTINCT FROM minutes_played)) AS stale_grade_metadata,
 count(*) FILTER(WHERE grade_row AND (grade_minutes>=20 OR abs(z)>=1)) AS displayed_under_current_rule,
 count(*) FILTER(WHERE grade_row AND grade_minutes<20 AND abs(z)<1) AS intentionally_hidden_cameo
FROM evidence GROUP BY edition_id ORDER BY edition_id
