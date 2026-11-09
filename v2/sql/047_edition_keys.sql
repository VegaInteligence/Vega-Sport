-- Every edition (PitchAPI, cups, archives) with its season and its public league id: a
-- read resolves its scope (season and leagues) to edition ids before its query, so the
-- query filters core.matches and the appearance tables on indexed ids and the planner
-- prunes the other seasons' partitions (the home's fixtures used to be built for every
-- match of the season, then filtered on the computed league id: 20 s for Ligue 1).
CREATE VIEW api.edition_keys AS
SELECT cs.id AS competition_season_id, cs.season_id, se.label AS season,
  coalesce(cp.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id
FROM core.competition_seasons cs
JOIN core.seasons se ON se.id = cs.season_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.provider = 'pitchapi' AND cp.entity_id = cs.competition_id AND cp.is_current;
