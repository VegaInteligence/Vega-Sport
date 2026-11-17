-- The SPFL official club directory is league-specific. Cross-check a native club key, observed participation
-- in the same country/division/season, and exact unique normalized current name (or independently verified alias).
WITH sides AS (
 SELECT cs.id AS edition_id,c.id AS competition_id,c.name AS competition,m.season_id,t.id AS team_id,t.name,t.country_code,t.crest_asset_id
 FROM core.competition_seasons cs JOIN core.competitions c ON cs.competition_id=c.id
 JOIN core.matches m ON m.competition_season_id=cs.id AND m.season_id=cs.season_id AND m.status='finished'
 CROSS JOIN LATERAL (VALUES(m.home_team_id),(m.away_team_id)) v(id)
 JOIN core.teams t ON t.id=v.id AND t.merged_into IS NULL
 WHERE cs.cup_key IN ('open-matchday:SCO_2_championship:2026/2027','open-matchday:SCO_3_league-one:2026/2027','open-matchday:SCO_4_league-two:2026/2027')
)
SELECT edition_id,competition_id,competition,season_id,team_id,name,country_code,crest_asset_id,count(*) AS completed_team_matches
FROM sides GROUP BY edition_id,competition_id,competition,season_id,team_id,name,country_code,crest_asset_id ORDER BY competition_id,team_id
