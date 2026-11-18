SELECT cs.id,c.name,cs.cup_key,cs.native_label,m.source,count(m.id) AS fixtures,
 count(m.id) FILTER(WHERE m.status='finished') AS finished,count(m.round_id) AS rounds
FROM core.competition_seasons cs JOIN core.competitions c ON c.id=cs.competition_id
LEFT JOIN core.matches m ON m.competition_season_id=cs.id
WHERE split_part(cs.cup_key,':',2) IN ('afcon','copa-america','gold-cup','asian-cup')
GROUP BY 1,2,3,4,5 ORDER BY 1,5
