SET LOCAL lock_timeout = '3s';

-- A club can announce a season without publishing the exact expiration day.
ALTER TABLE core.player_contracts
  ADD COLUMN end_season_year smallint,
  ADD COLUMN end_season_competition text,
  ADD CONSTRAINT player_contract_season_precision CHECK (
    (end_season_year IS NULL AND end_season_competition IS NULL) OR
    (end_date IS NULL AND end_season_year IS NOT NULL AND end_season_year BETWEEN 1900 AND 2200
      AND end_season_competition IS NOT NULL AND btrim(end_season_competition) <> '')
  );

CREATE VIEW api.confirmed_player_contracts AS
SELECT c.player_id, min(c.team_id) AS team_id, min(c.end_date) AS end_date,
  min(c.end_season_year) AS end_season_year, min(c.end_season_competition) AS end_season_competition
FROM core.player_contracts c
WHERE c.as_of <= current_date AND c.start_date <= current_date
  AND CASE WHEN c.end_date IS NOT NULL THEN c.end_date >= current_date
           WHEN c.end_season_year IS NOT NULL THEN c.end_season_year >= extract(year FROM current_date)
           ELSE true END
GROUP BY c.player_id
HAVING count(DISTINCT c.team_id) = 1
  AND count(DISTINCT (c.end_date, c.end_season_year, c.end_season_competition)) = 1
  AND bool_and(c.end_date IS NOT NULL OR c.end_season_year IS NOT NULL);

CREATE VIEW api.player_market_values AS
SELECT player_id, valued_at, value_eur::float8 AS value_eur
FROM core.player_market_values WHERE source = 'transfermarkt' AND value_eur >= 0;

CREATE OR REPLACE VIEW api.player_profiles AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name, p.position_id, p.country_code,
  p.shirt_number, ph.source_url AS image_url, p.birth_date::text AS birth_date, p.height_cm,
  p.preferred_foot::text AS preferred_foot, contract.end_date::text AS contract_until,
  t.name AS contract_team,
  observed.contract_until::text AS observed_contract_until,
  observed.club_name AS observed_contract_team,
  observed.observed_on::text AS observed_contract_on,
  contract.end_season_year AS contract_until_season,
  contract.end_season_competition AS contract_season_competition,
  market.value_eur AS market_value_eur, market.valued_at::text AS market_value_updated_at
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN api.confirmed_player_contracts contract ON contract.player_id = p.id
LEFT JOIN core.teams t ON t.id = contract.team_id
LEFT JOIN core.player_fact_observations observed
  ON observed.player_id = p.id AND observed.source = 'transfermarkt_snapshot'
  AND observed.contract_until IS NOT NULL AND observed.club_name IS NOT NULL
  AND (observed.birth_date IS NULL OR observed.birth_date = p.birth_date)
LEFT JOIN LATERAL (
  SELECT v.value_eur, v.valued_at FROM api.player_market_values v
  WHERE v.player_id = p.id ORDER BY v.valued_at DESC LIMIT 1
) market ON true;

CREATE OR REPLACE VIEW api.player_fact_coverage AS
SELECT count(*)::int AS players, count(p.birth_date)::int AS birth_dates,
  count(p.preferred_foot)::int AS preferred_feet,
  (SELECT count(*)::int FROM core.player_fact_observations) AS snapshot_matches,
  (SELECT count(*)::int FROM core.player_fact_observations
    WHERE contract_until IS NOT NULL AND club_name IS NOT NULL) AS observed_expiries,
  (SELECT count(*)::int FROM api.confirmed_player_contracts) AS confirmed_expiries,
  (SELECT count(DISTINCT player_id)::int FROM api.player_market_values) AS market_value_players,
  (SELECT count(*)::int FROM api.player_market_values) AS market_value_points
FROM core.players p;
GRANT SELECT ON api.confirmed_player_contracts, api.player_market_values TO vega_read;

UPDATE ops.source_runs
SET last_success_at = NULL, last_attempt_at = least(last_attempt_at, now() - interval '1 day')
WHERE source = 'vega' AND scope = 'player_facts';
