-- Entire edition universe in one query. Fall back to team-sides.sql one season at a time if 90s exceeded.
WITH f AS MATERIALIZED (
 SELECT m.season_id,m.id AS match_id,m.competition_season_id AS edition_id,cs.cup_key,cs.archive_key,
        m.match_date,m.home_team_id,m.away_team_id,m.home_score,m.away_score,
        th.is_national AS home_national,ta.is_national AS away_national,
        coalesce(th.merged_into,th.id) AS home_canonical,coalesce(ta.merged_into,ta.id) AS away_canonical
 FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
 LEFT JOIN core.teams th ON th.id=m.home_team_id LEFT JOIN core.teams ta ON ta.id=m.away_team_id
 WHERE m.status='finished'
), nations AS (
 SELECT DISTINCT m.competition_season_id AS edition_id FROM core.matches m JOIN core.teams t ON t.id=m.home_team_id AND t.is_national IS TRUE
), gate AS (
 SELECT f.*,CASE
 WHEN archive_key IS NOT NULL THEN 'archive'
 WHEN home_team_id IS NULL OR away_team_id IS NULL OR home_score IS NULL OR away_score IS NULL THEN 'insufficient'
 WHEN cup_key IS NOT NULL AND (match_date IS NULL OR (home_national IS TRUE)<>(away_national IS TRUE)
      OR (home_national IS NOT TRUE AND n.edition_id IS NOT NULL)) THEN 'scope'
 WHEN home_canonical=away_canonical THEN 'same_identity'
 WHEN cup_key LIKE 'open-matchday:%:%' AND split_part(cup_key,':',2) IN ('AUT_1_bundesliga','BEL_1_pro-league','CRO_1_hnl','CZE_1_chance-liga','DEN_1_superliga','ENG_1_premier-league','ENG_2_championship','ENG_3_league-one','ENG_4_league-two','ESP_1_la-liga','ESP_2_segunda-division','FIN_1_veikkausliiga','FRA_1_ligue-1','FRA_2_ligue-2','GER_1_bundesliga','GER_2_2-bundesliga','GER_3_3-liga','GRE_1_super-league','ITA_1_serie-a','ITA_2_serie-b','NED_1_eredivisie','NED_2_eerste-divisie','NOR_1_eliteserien','POL_1_ekstraklasa','POR_1_primeira-liga','ROU_1_liga-1','RUS_1_premier-liga','SCO_1_premiership','SUI_1_super-league','SVK_1_nike-liga','SWE_1_allsvenskan','TUR_1_super-lig','UEFA_1_champions-league','UEFA_1_europa-league','UEFA_1_conference-league','GER_CUP_dfb-pokal') THEN 'skipped_folder'
 ELSE 'candidate' END AS reason
 FROM f LEFT JOIN nations n USING(edition_id)
), sides AS (
 SELECT g.*,v.team_id,v.canonical,v.national FROM gate g CROSS JOIN LATERAL (VALUES
 (g.home_team_id,g.home_canonical,g.home_national),(g.away_team_id,g.away_canonical,g.away_national)) v(team_id,canonical,national)
), actual AS MATERIALIZED (
 SELECT e.match_id,e.team_id,e.season_id,e.elo_before,e.elo_after,e.expected,e.result
 FROM agg.team_elo e
), rated_matches AS (
 SELECT season_id,match_id,count(*) AS stored_sides FROM actual GROUP BY season_id,match_id
)
SELECT s.edition_id,CASE WHEN s.team_id IS NULL THEN 'unknown side' WHEN s.national IS TRUE THEN 'national team' ELSE 'club' END entity_type,
 count(*) AS finished_sides,count(*) FILTER(WHERE reason='candidate') AS candidate_sides_before_copy_rules,
 count(*) FILTER(WHERE reason='archive') AS archive_policy_excluded,count(*) FILTER(WHERE reason='insufficient') AS insufficient_result_or_identity,
 count(*) FILTER(WHERE reason='scope') AS excluded_date_or_team_type,count(*) FILTER(WHERE reason='same_identity') AS self_pair,
 count(*) FILTER(WHERE reason='skipped_folder') AS excluded_folder,
 count(*) FILTER(WHERE a.team_id IS NOT NULL) AS stored_matched_sides,
 count(*) FILTER(WHERE reason='candidate' AND a.team_id IS NOT NULL AND a.elo_before BETWEEN '-1e30'::real AND '1e30'::real
   AND a.elo_after BETWEEN '-1e30'::real AND '1e30'::real AND a.expected BETWEEN 0 AND 1 AND a.result IN(0,0.5,1)) AS candidate_valid_stored,
 count(*) FILTER(WHERE reason='candidate' AND rm.stored_sides IS NULL AND cup_key IS NULL) AS primary_candidate_no_elo,
 count(*) FILTER(WHERE reason='candidate' AND rm.stored_sides IS NULL AND cup_key IS NOT NULL) AS complementary_candidate_no_elo_before_dedup,
 count(*) FILTER(WHERE reason='candidate' AND rm.stored_sides>0 AND a.team_id IS NULL) AS stored_match_team_mismatch,
 count(*) FILTER(WHERE reason='candidate' AND rm.stored_sides IS NOT NULL AND rm.stored_sides<>2) AS candidate_on_partial_or_extra_pair,
 count(*) FILTER(WHERE reason<>'candidate' AND a.team_id IS NOT NULL) AS rated_outside_current_gate
FROM sides s LEFT JOIN actual a ON a.season_id=s.season_id AND a.match_id=s.match_id AND a.team_id=s.canonical
LEFT JOIN rated_matches rm ON rm.season_id=s.season_id AND rm.match_id=s.match_id GROUP BY s.edition_id,2 ORDER BY s.edition_id,2
