WITH mapping(folder,league) AS (VALUES
 ('AUT_1_bundesliga','l_3zsMpo'),
 ('BEL_1_pro-league','l_2L6d1F'),
 ('CRO_1_hnl','l_2tFk9k'),
 ('CZE_1_chance-liga','l_0F4I4F'),
 ('DEN_1_superliga','l_49Zmno'),
 ('ENG_1_premier-league','l_4WFCIZ'),
 ('ENG_2_championship','l_4DWyTT'),
 ('ENG_3_league-one','l_0ahLw8'),
 ('ENG_4_league-two','l_1W6idJ'),
 ('ESP_1_la-liga','l_0ErfuF'),
 ('ESP_2_segunda-division','l_3kyHLd'),
 ('FIN_1_veikkausliiga','l_3Ci5Cg'),
 ('FRA_1_ligue-1','l_3FJFUl'),
 ('FRA_2_ligue-2','l_0275VP'),
 ('GER_1_bundesliga','l_1Isor4'),
 ('GER_2_2-bundesliga','l_3hvsne'),
 ('GER_3_3-liga','l_47077Y'),
 ('GRE_1_super-league','l_3xwVF2'),
 ('ITA_1_serie-a','l_0ALvwF'),
 ('ITA_2_serie-b','l_0jy5yE'),
 ('NED_1_eredivisie','l_4H43wr'),
 ('NED_2_eerste-divisie','l_49KZaB'),
 ('NOR_1_eliteserien','l_0uqFK8'),
 ('POL_1_ekstraklasa','l_214sqK'),
 ('POR_1_primeira-liga','l_4QexZg'),
 ('ROU_1_liga-1','l_0kSJLz'),
 ('RUS_1_premier-liga','l_2Mh0jT'),
 ('SCO_1_premiership','l_1LMdEO'),
 ('SUI_1_super-league','l_4d6Bwl'),
 ('SVK_1_nike-liga','l_4MU9Yh'),
 ('SWE_1_allsvenskan','l_1XsMdH'),
 ('TUR_1_super-lig','l_0S1uaf'),
 ('UEFA_1_champions-league','l_0bfbkO'),
 ('UEFA_1_europa-league','l_38d9HA'),
 ('UEFA_1_conference-league','l_2WZ2tt')
), current_edition AS (
 SELECT t.folder, t.league,cs.id,cs.season_id
 FROM mapping t LEFT JOIN core.provider_ids p ON p.provider='pitchapi' AND p.entity_type='competition' AND p.provider_key=t.league
 LEFT JOIN core.competition_seasons cs ON cs.competition_id=p.entity_id AND cs.season_id=2026 AND cs.cup_key IS NULL AND cs.archive_key IS NULL
)
SELECT e.folder,e.league,e.id AS pitch_edition_2026,count(m.id) AS pitch_rows,count(m.id) FILTER(WHERE m.status='finished') AS pitch_finished,
 (SELECT count(*) FROM core.competition_seasons copy WHERE copy.cup_key='open-matchday:'||e.folder||':2026/2027') AS supplemental_editions_still_stored
FROM current_edition e LEFT JOIN core.matches m ON m.competition_season_id=e.id AND m.season_id=2026
GROUP BY e.folder,e.league,e.id ORDER BY e.folder
