-- A profile snapshot can supply an expiry without a contract's signing date.
SET LOCAL lock_timeout = '3s';
ALTER TABLE core.players ADD COLUMN birth_date_source_url text;

CREATE TABLE core.player_fact_observations (
  source text NOT NULL,
  source_player_id text NOT NULL,
  player_id integer NOT NULL REFERENCES core.players ON DELETE CASCADE,
  source_url text NOT NULL,
  observed_on date NOT NULL,
  birth_date date,
  preferred_foot core.foot,
  club_name text,
  contract_until date,
  PRIMARY KEY (source, source_player_id),
  UNIQUE (source, player_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON core.player_fact_observations TO vega_collect;

CREATE OR REPLACE VIEW api.player_profiles AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name, p.position_id, p.country_code,
  p.shirt_number, ph.source_url AS image_url, p.birth_date::text AS birth_date, p.height_cm,
  p.preferred_foot::text AS preferred_foot, contract.end_date::text AS contract_until,
  t.name AS contract_team,
  observed.contract_until::text AS observed_contract_until,
  observed.club_name AS observed_contract_team,
  observed.observed_on::text AS observed_contract_on
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN LATERAL (
  SELECT min(c.team_id) AS team_id, min(c.end_date) AS end_date
  FROM core.player_contracts c
  WHERE c.player_id = p.id AND c.as_of <= current_date
    AND c.start_date <= current_date AND (c.end_date IS NULL OR c.end_date >= current_date)
  HAVING count(DISTINCT c.team_id) = 1 AND count(DISTINCT c.end_date) = 1
    AND count(c.end_date) = count(*)
) contract ON true
LEFT JOIN core.teams t ON t.id = contract.team_id
LEFT JOIN core.player_fact_observations observed
  ON observed.player_id = p.id AND observed.source = 'transfermarkt_snapshot'
  AND observed.contract_until IS NOT NULL AND observed.club_name IS NOT NULL
  AND (observed.birth_date IS NULL OR observed.birth_date = p.birth_date);

CREATE VIEW api.player_fact_coverage AS
SELECT count(*)::int AS players,
  count(p.birth_date)::int AS birth_dates,
  count(p.preferred_foot)::int AS preferred_feet,
  (SELECT count(*)::int FROM core.player_fact_observations) AS snapshot_matches,
  (SELECT count(*)::int FROM core.player_fact_observations
    WHERE contract_until IS NOT NULL AND club_name IS NOT NULL) AS observed_expiries,
  (SELECT count(*)::int FROM (
    SELECT c.player_id FROM core.player_contracts c
    WHERE c.as_of <= current_date AND c.start_date <= current_date
      AND (c.end_date IS NULL OR c.end_date >= current_date)
    GROUP BY c.player_id
    HAVING count(DISTINCT c.team_id) = 1 AND count(DISTINCT c.end_date) = 1
      AND count(c.end_date) = count(*)
  ) confirmed) AS confirmed_expiries
FROM core.players p;
GRANT SELECT ON api.player_fact_coverage TO vega_read;
