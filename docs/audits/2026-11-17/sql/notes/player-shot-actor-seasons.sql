SELECT season_id,count(*) AS shots_with_named_actor FROM core.shots WHERE player_id IS NOT NULL OR keeper_id IS NOT NULL GROUP BY season_id ORDER BY season_id
