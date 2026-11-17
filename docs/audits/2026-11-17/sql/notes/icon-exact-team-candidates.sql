-- Count exactly linked fallback image evidence. Multiple distinct asset IDs or an unsupported HTTP host require review.
-- Include historical alias links; a historical crest can differ from today's, so those alone cannot imply current branding.
WITH target AS (
 SELECT t.id,CASE WHEN t.is_national THEN 'national team' ELSE 'club' END AS entity_type
 FROM core.teams t WHERE t.merged_into IS NULL AND t.crest_asset_id IS NULL
), ranked AS (
 SELECT x.id,rr.image_asset_id AS asset_id
 FROM target x JOIN core.ranking_rows rr ON rr.team_id=x.id JOIN core.ranking_editions e ON e.id=rr.edition_id AND e.is_current
 WHERE rr.image_asset_id IS NOT NULL AND ((x.entity_type='club' AND e.provider='uefa' AND e.kind::text='uefa_clubs')
 OR (x.entity_type='national team' AND e.provider='fifa'))
), aliases AS (
 SELECT x.id,t.crest_asset_id AS asset_id FROM target x JOIN core.teams t ON t.merged_into=x.id WHERE t.crest_asset_id IS NOT NULL
), candidates AS (SELECT id,asset_id,'current_ranking' AS provenance FROM ranked UNION ALL SELECT id,asset_id,'merged_historical_crest' FROM aliases),
per_entity AS (
 SELECT x.entity_type,x.id,count(DISTINCT k.asset_id) AS choices,count(DISTINCT k.asset_id) FILTER(WHERE k.provenance='current_ranking') AS ranking_choices,
 bool_or(a.s3_key IS NOT NULL) AS already_mirrored, bool_or(a.source_url ~ '^https://(cdn\.pitchapi\.dev/|upload\.wikimedia\.org/wikipedia/commons/|img\.thesports\.com/football/(team|competition)/)') AS mirror_allowlisted
 FROM target x LEFT JOIN candidates k ON k.id=x.id LEFT JOIN core.assets a ON a.id=k.asset_id GROUP BY x.entity_type,x.id
)
SELECT entity_type,count(*) AS missing_crests,count(*) FILTER(WHERE choices=0) AS no_candidate_these_routes,
 count(*) FILTER(WHERE choices=1 AND ranking_choices=1) AS unique_current_ranking,
 count(*) FILTER(WHERE choices=1 AND ranking_choices=1 AND already_mirrored) AS unique_current_verified_key,
 count(*) FILTER(WHERE choices=1 AND ranking_choices=1 AND mirror_allowlisted) AS unique_current_allowlisted,
 count(*) FILTER(WHERE choices=1 AND ranking_choices=0) AS historic_crest_only,
 count(*) FILTER(WHERE choices>1) AS conflicting_candidates
FROM per_entity GROUP BY entity_type ORDER BY entity_type
