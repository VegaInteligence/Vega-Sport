-- Only latest current UEFA club coefficients with an exact canonical club link. FIFA rankings supply FLAGS, not official crests.
SELECT t.id,t.name,p.provider_key AS uefa_team_id,rr.provider_key AS ranked_team_id,e.label AS edition,a.source_url,a.s3_key
FROM core.teams t JOIN core.ranking_rows rr ON rr.team_id=t.id JOIN core.ranking_editions e ON e.id=rr.edition_id AND e.provider='uefa' AND e.kind::text='uefa_clubs' AND e.is_current
JOIN core.assets a ON a.id=rr.image_asset_id JOIN core.provider_ids p ON p.entity_type='team' AND p.entity_id=t.id AND p.provider='uefa' AND p.is_current
WHERE t.is_national IS NOT TRUE AND t.merged_into IS NULL AND t.crest_asset_id IS NULL
ORDER BY t.id
