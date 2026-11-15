-- What became of each club of a finished league edition, read from the next season in the
-- base: a club that plays the Champions League, the Europa League or the Conference League
-- next season (cl, el, ecl; cl-q, el-q when it played their qualifying rounds only), else a
-- club that plays a league of its country on a higher tier (promotion) or a lower one
-- (relegation). A club of a top division (tier 1) that plays no league of its country on a
-- known tier and is absent from the next edition left that division: relegation, read only
-- when the next edition holds at least three quarters as many clubs as this one (its
-- fixtures are in the base, not the first rounds only). The table of a past season is
-- coloured by these observed fates where the league's rules are not recorded or no longer
-- fit its size (a league of 20 clubs then).
-- An edition whose competition has no edition the next season has no fate.
CREATE VIEW api.league_team_fates AS
SELECT e.id AS competition_season_id, api.public_id('team', x.team_id) AS team_id,
  CASE
    WHEN eu.cl THEN 'cl' WHEN eu.cl_q THEN 'cl-q' WHEN eu.el THEN 'el' WHEN eu.el_q THEN 'el-q' WHEN eu.ecl THEN 'ecl'
    WHEN nx.tier < l.tier THEN 'promotion'
    WHEN nx.tier > l.tier THEN 'relegation'
    WHEN l.tier = 1 AND nx.tier IS NULL AND NOT st.stayed AND nc.next_clubs >= 0.75 * nc.clubs THEN 'relegation'
  END AS fate
FROM core.competition_seasons e
JOIN core.competitions c ON c.id = e.competition_id
JOIN agg.league_levels l ON l.competition_id = e.competition_id AND l.tier IS NOT NULL
CROSS JOIN LATERAL (
  SELECT count(DISTINCT t.team_id) FILTER (WHERE m.competition_season_id = e.id) AS clubs,
    count(DISTINCT t.team_id) FILTER (WHERE n.season_id = e.season_id + 1) AS next_clubs
  FROM core.competition_seasons n JOIN core.matches m ON m.competition_season_id = n.id AND m.season_id = n.season_id
  CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) t(team_id)
  WHERE n.competition_id = e.competition_id AND n.season_id IN (e.season_id, e.season_id + 1) AND n.archive_key IS NULL AND n.cup_key IS NULL
) nc
CROSS JOIN LATERAL (
  SELECT DISTINCT t.team_id FROM core.matches m CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) t(team_id)
  WHERE m.competition_season_id = e.id AND m.season_id = e.season_id AND m.status = 'finished' AND t.team_id IS NOT NULL
) x
CROSS JOIN LATERAL (
  SELECT array_agg(DISTINCT n.competition_season_id) AS editions FROM (
    SELECT m.competition_season_id FROM core.matches m WHERE m.home_team_id = x.team_id AND m.season_id = e.season_id + 1
    UNION SELECT m.competition_season_id FROM core.matches m WHERE m.away_team_id = x.team_id AND m.season_id = e.season_id + 1
  ) n
) played
CROSS JOIN LATERAL (
  SELECT min(l2.tier) AS tier FROM core.competition_seasons cs2
  JOIN core.competitions c2 ON c2.id = cs2.competition_id AND c2.country_code = c.country_code
  JOIN agg.league_levels l2 ON l2.competition_id = cs2.competition_id
  WHERE cs2.id = ANY(played.editions) AND cs2.archive_key IS NULL AND cs2.cup_key IS NULL
) nx
CROSS JOIN LATERAL (
  SELECT EXISTS (SELECT 1 FROM core.competition_seasons cs4 WHERE cs4.id = ANY(played.editions) AND cs4.competition_id = e.competition_id) AS stayed
) st
CROSS JOIN LATERAL (
  SELECT bool_or(c3.name = 'Champions League' AND NOT q.qualifying_only) AS cl, bool_or(c3.name = 'Champions League' AND q.qualifying_only) AS cl_q,
    bool_or(c3.name = 'Europa League' AND NOT q.qualifying_only) AS el, bool_or(c3.name = 'Europa League' AND q.qualifying_only) AS el_q,
    bool_or(c3.name = 'Conference League') AS ecl
  FROM core.competition_seasons cs3
  JOIN core.competitions c3 ON c3.id = cs3.competition_id AND c3.name IN ('Champions League', 'Europa League', 'Conference League')
  CROSS JOIN LATERAL (
    SELECT coalesce(bool_and(r.stage = 'qualifying'), false) AS qualifying_only
    FROM core.matches m LEFT JOIN core.rounds r ON r.id = m.round_id
    WHERE m.competition_season_id = cs3.id AND m.season_id = e.season_id + 1 AND x.team_id IN (m.home_team_id, m.away_team_id)
  ) q
  WHERE cs3.id = ANY(played.editions) AND cs3.archive_key IS NULL
) eu
WHERE e.archive_key IS NULL AND e.cup_key IS NULL
  AND EXISTS (SELECT 1 FROM core.competition_seasons n WHERE n.competition_id = e.competition_id AND n.season_id = e.season_id + 1);
GRANT SELECT ON api.league_team_fates TO vega_read;
