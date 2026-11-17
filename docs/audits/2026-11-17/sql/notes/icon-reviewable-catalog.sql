-- Matches reviewed source URLs to exact production provider IDs. Never merge by display names.
WITH known(site_key,provider_key,reviewed_url) AS (VALUES
('open-matchday:AUT_CUP_ofb-cup','cup:open-matchday:AUT_CUP_ofb-cup','https://img.thesports.com/football/competition/6f803b0ca5b52b392cb3fb4225ad7186.png'),
('open-matchday:ENG_CUP_efl-cup','cup:open-matchday:ENG_CUP_efl-cup','https://img.thesports.com/football/competition/8aa596d6e755efdca6776d946ebfcd32.png'),
('open-matchday:ENG_CUP_fa-cup','cup:open-matchday:ENG_CUP_fa-cup','https://img.thesports.com/football/competition/184d1f93aac0dd0326583286c208c8cc.png'),
('open-matchday:ESP_CUP_copa-del-rey','cup:open-matchday:ESP_CUP_copa-del-rey','https://img.thesports.com/football/competition/7067abeb61660895f3ca0227675ef16f.png'),
('open-matchday:GER_CUP_dfb-pokal','cup:open-matchday:GER_CUP_dfb-pokal','https://img.thesports.com/football/competition/1cded13e781ed1f7c2514a3413506960.png'),
('open-matchday:ITA_CUP_coppa-italia','cup:open-matchday:ITA_CUP_coppa-italia','https://img.thesports.com/football/competition/e7d8a305f30ef391501720bf30326072.png'),
('open-matchday:NED_CUP_knvb-beker','cup:open-matchday:NED_CUP_knvb-beker','https://img.thesports.com/football/competition/586b92fac30a40698596b596577f4121.png'),
('open-matchday:POR_CUP_taca-de-portugal','cup:open-matchday:POR_CUP_taca-de-portugal','https://img.thesports.com/football/competition/8a441eec56ff81f47f8e927fe2708587.png'),
('open-matchday:SCO_CUP_league-cup','cup:open-matchday:SCO_CUP_league-cup','https://img.thesports.com/football/competition/0dba3e58b18a4e9b9dd3c287e9abcccd.png'),
('open-matchday:SCO_CUP_scottish-cup','cup:open-matchday:SCO_CUP_scottish-cup','https://img.thesports.com/football/competition/eefcb931a53e8505e956fd20678918f6.png'),
('open-matchday:SUI_CUP_swiss-cup','cup:open-matchday:SUI_CUP_swiss-cup','https://img.thesports.com/football/competition/9be46b717fad6d632b37c9f8b0155a0e.png')
)
SELECT k.site_key,k.provider_key,c.id AS competition_id,c.name AS competition,
       c.logo_asset_id IS NULL AND c.id IS NOT NULL AS fill_if_missing,
       a.source_url AS current_url,k.reviewed_url,other.id AS existing_reviewed_asset_id,
       other.s3_key IS NOT NULL AS reviewed_asset_has_recorded_mirror
FROM known k LEFT JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='vega' AND p.provider_key=k.provider_key
LEFT JOIN core.competitions c ON c.id=p.entity_id LEFT JOIN core.assets a ON a.id=c.logo_asset_id
LEFT JOIN core.assets other ON other.source_url=k.reviewed_url
ORDER BY k.site_key