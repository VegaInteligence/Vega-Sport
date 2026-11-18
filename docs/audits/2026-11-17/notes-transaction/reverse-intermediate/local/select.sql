-- Four exclusive source buckets across every stored award year.
-- Cross-year appearances are counted separately at match/player grain.
WITH classified AS (
    SELECT pm.match_id, pm.player_id, pm.season_id AS stored_award,
           CASE
             WHEN m.id IS NULL OR s.player_id IS NULL THEN 'missing_source'
             WHEN m.status IS DISTINCT FROM 'finished' OR m.match_date IS NULL
               OR cs.id IS NULL OR cs.cup_key IS NOT NULL OR cs.archive_key IS NOT NULL
               OR s.team_id IS NULL OR s.minutes_played IS NULL OR s.minutes_played <= 0
               THEN 'ineligible_source'
             WHEN pm.season_id <> EXTRACT(YEAR FROM m.match_date - INTERVAL '7 months')::int
               OR m.season_id NOT IN (pm.season_id, pm.season_id + 1) THEN 'wrong_award'
             ELSE 'admitted_source'
           END AS reason
    FROM agg.player_power_matches pm
    LEFT JOIN core.matches m ON m.id = pm.match_id
    LEFT JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
    LEFT JOIN core.player_match_stats s
      ON (s.season_id, s.match_id, s.player_id) = (m.season_id, pm.match_id, pm.player_id)
), pairs AS (
    SELECT match_id, player_id, COUNT(*) AS award_rows,
           COUNT(*) FILTER (WHERE reason = 'admitted_source') AS admitted,
           COUNT(*) FILTER (WHERE reason = 'missing_source') AS missing,
           COUNT(*) FILTER (WHERE reason = 'ineligible_source') AS ineligible,
           COUNT(*) FILTER (WHERE reason = 'wrong_award') AS wrong_award,
           MIN(stored_award) AS first_award, MAX(stored_award) AS last_award
    FROM classified
    GROUP BY match_id, player_id
)
SELECT COALESCE(SUM(award_rows), 0)::bigint AS stored_rows,
       COUNT(*) AS distinct_match_player_pairs,
       COALESCE(SUM(admitted), 0)::bigint AS admitted_source_rows,
       COALESCE(SUM(missing), 0)::bigint AS missing_source_rows,
       COALESCE(SUM(ineligible), 0)::bigint AS ineligible_source_rows,
       COALESCE(SUM(wrong_award), 0)::bigint AS wrong_award_rows,
       COUNT(*) FILTER (WHERE first_award <> last_award) AS multiple_award_pairs,
       COALESCE(SUM(award_rows - 1), 0)::bigint AS excess_award_rows,
       MIN(format('%s/%s',match_id,player_id)) FILTER (WHERE missing > 0) AS example_missing,
       MIN(format('%s/%s',match_id,player_id)) FILTER (WHERE ineligible > 0) AS example_ineligible,
       MIN(format('%s/%s',match_id,player_id)) FILTER (WHERE wrong_award > 0) AS example_wrong_award,
       MIN(format('%s/%s [%s,%s]',match_id,player_id,first_award,last_award))
           FILTER (WHERE first_award <> last_award) AS example_multiple_awards
FROM pairs
