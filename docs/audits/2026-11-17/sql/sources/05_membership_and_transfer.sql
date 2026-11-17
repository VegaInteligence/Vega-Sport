WITH events AS (
 SELECT player_id,source,transfer_date, from_provider_club,to_provider_club, from_team_id,to_team_id,kind,count(*) AS n
 FROM core.player_transfers WHERE transfer_date IS NOT NULL AND (from_team_id IS NOT NULL OR from_provider_club IS NOT NULL) AND (to_team_id IS NOT NULL OR to_provider_club IS NOT NULL)
 GROUP BY 1,2,3,4,5,6,7,8 HAVING count(*)>1
), current_contracts AS (
 SELECT player_id, count(DISTINCT team_id) AS teams FROM core.player_contracts
 WHERE as_of<=CURRENT_DATE AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE)
 GROUP BY player_id HAVING count(DISTINCT team_id)>1
), anomalies AS (
 SELECT 'transfer_exact_known_date_endpoints_and_kind_groups' AS signal,count(*) AS records FROM events
 UNION ALL SELECT 'players_with_conflicting_current_contract_teams',count(*) FROM current_contracts
 UNION ALL SELECT 'same_day_same_team_transfer_candidate',count(*) FROM core.player_transfers
 WHERE from_team_id=to_team_id AND from_team_id IS NOT NULL AND transfer_date IS NOT NULL
 UNION ALL SELECT 'contracts_negative_interval',count(*) FROM core.player_contracts WHERE end_date<start_date
 UNION ALL SELECT 'provider_squad_entries_without_provider_player_record',count(*) FROM core.provider_squads s
 WHERE NOT EXISTS(SELECT 1 FROM core.provider_players p WHERE p.provider=s.provider AND p.provider_key=s.player_key)
 UNION ALL SELECT 'provider_squad_entries_without_provider_club_record',count(*) FROM core.provider_squads s
 WHERE NOT EXISTS(SELECT 1 FROM core.provider_clubs p WHERE p.provider=s.provider AND p.provider_key=s.club_key)
 UNION ALL SELECT 'merged_team_pointers_to_other_pointers',count(*) FROM core.teams t JOIN core.teams k ON k.id=t.merged_into WHERE k.merged_into IS NOT NULL
 UNION ALL SELECT 'quarantined_provider_links',count(*) FROM ops.provider_links WHERE quarantined_at IS NOT NULL
 UNION ALL SELECT 'unresolved_provider_conflict_records',count(*) FROM ops.provider_link_conflicts
) SELECT * FROM anomalies ORDER BY signal
