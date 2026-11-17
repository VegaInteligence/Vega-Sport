-- Use only established links to the same competition. This identifies current canonical competition identity;
-- a current avatar must not be described as the official logo of a historical season.
WITH mapping(vega_ref,origin,pitch_ref,checked_url,crosswalk) AS (VALUES
('archive:g:aut-bundesliga','pitchapi','l_3zsMpo',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:bel-pro-league','pitchapi','l_2L6d1F',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:bundesliga','pitchapi','l_1Isor4',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:champions-league','pitchapi','l_0bfbkO',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:cze-1-fotbalova-liga','pitchapi','l_0F4I4F',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:eng-premier-league','pitchapi','l_4WFCIZ',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:esp-primera-division','pitchapi','l_0ErfuF',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:europa-league','pitchapi','l_38d9HA',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:fra-ligue-1','pitchapi','l_3FJFUl',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:gre-super-league','pitchapi','l_3xwVF2',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:ita-serie-a','pitchapi','l_0ALvwF',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:ned-eredivisie','pitchapi','l_4H43wr',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:nor-eliteserien','pitchapi','l_0uqFK8',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:pol-ekstraklasa','pitchapi','l_214sqK',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:por-primeira-liga','pitchapi','l_4QexZg',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:sco-premiership','pitchapi','l_1LMdEO',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:sui-super-league','pitchapi','l_4d6Bwl',NULL,'archives.PITCHAPI_COMPETITIONS'),
('archive:g:tur-sueperlig','pitchapi','l_0S1uaf',NULL,'archives.PITCHAPI_COMPETITIONS'),
('cup:open-cups:austria-cup-archive','reviewed',NULL,'https://img.thesports.com/football/competition/6f803b0ca5b52b392cb3fb4225ad7186.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:germany-cup-archive','reviewed',NULL,'https://img.thesports.com/football/competition/1cded13e781ed1f7c2514a3413506960.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:fa-cup-archive','reviewed',NULL,'https://img.thesports.com/football/competition/184d1f93aac0dd0326583286c208c8cc.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:efl-cup-archive','reviewed',NULL,'https://img.thesports.com/football/competition/8aa596d6e755efdca6776d946ebfcd32.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:copa-del-rey-archive','reviewed',NULL,'https://img.thesports.com/football/competition/7067abeb61660895f3ca0227675ef16f.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:coppa-italia-archive','reviewed',NULL,'https://img.thesports.com/football/competition/e7d8a305f30ef391501720bf30326072.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:knvb-beker-archive','reviewed',NULL,'https://img.thesports.com/football/competition/586b92fac30a40698596b596577f4121.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:portugal-cup-archive','reviewed',NULL,'https://img.thesports.com/football/competition/8a441eec56ff81f47f8e927fe2708587.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:open-cups:swiss-cup-archive','reviewed',NULL,'https://img.thesports.com/football/competition/9be46b717fad6d632b37c9f8b0155a0e.png','cup-archives.NATIONAL_CUP_ARCHIVES'),
('cup:openligadb:germany-cup','reviewed',NULL,'https://img.thesports.com/football/competition/1cded13e781ed1f7c2514a3413506960.png','cup-projection.GERMAN_CUP_FOLDER'),
('cup:nations-results:nations-league','reviewed',NULL,'https://img.thesports.com/football/competition/245bff452fbdc34d417164e361097ae7.png','UEFA Nations League native families'),
('archive:g:dfb-pokal','reviewed',NULL,'https://img.thesports.com/football/competition/1cded13e781ed1f7c2514a3413506960.png','historical_goals source competition and country'),
('archive:g:eng-fa-cup','reviewed',NULL,'https://img.thesports.com/football/competition/184d1f93aac0dd0326583286c208c8cc.png','historical_goals source competition and country'),
('archive:g:eng-league-cup','reviewed',NULL,'https://img.thesports.com/football/competition/8aa596d6e755efdca6776d946ebfcd32.png','historical_goals source competition and country'),
('archive:g:esp-copa-del-rey','reviewed',NULL,'https://img.thesports.com/football/competition/7067abeb61660895f3ca0227675ef16f.png','historical_goals source competition and country'),
('archive:g:fra-coupe-de-france','reviewed',NULL,'https://img.thesports.com/football/competition/5598719801fa02e53b44827f791be316.png','historical_goals source competition and country')
)
SELECT c.id,c.name,c.country_code,m.vega_ref,m.crosswalk,m.origin,p.provider_key AS primary_ref,primary_comp.name AS primary_name,
       coalesce(m.checked_url,a.source_url) AS source_url,coalesce(checked.s3_key,a.s3_key) AS existing_mirror_key
FROM mapping m JOIN core.provider_ids v ON v.entity_type='competition' AND v.provider='vega' AND v.provider_key=m.vega_ref
JOIN core.competitions c ON c.id=v.entity_id AND c.logo_asset_id IS NULL
LEFT JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.provider_key=m.pitch_ref AND p.is_current
LEFT JOIN core.competitions primary_comp ON primary_comp.id=p.entity_id LEFT JOIN core.assets a ON a.id=primary_comp.logo_asset_id
LEFT JOIN core.assets checked ON checked.source_url=m.checked_url ORDER BY c.id