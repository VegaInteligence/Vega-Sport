-- Search and actor reads that timed out on 10 November 2026 (GET /api/search: 38 s;
-- GET /api/read/club: 93 s), for what the schema can do; the routes do the rest.
--
-- 1. The name a search compares is stored. The search folded every name on every request
--    (lower case, NFD, accents removed; for a club its initials too): 29,000 players and
--    11,500 clubs, two regular expressions each, 250 ms before the first comparison. The
--    stored columns are the same expressions (search.mjs normalizes the needle the same
--    way), computed when the name is written.
ALTER TABLE core.players
  ADD COLUMN search_name text GENERATED ALWAYS AS (
    regexp_replace(normalize(lower(name), NFD), U&'[\0300-\036F]', '', 'g')) STORED;

ALTER TABLE core.teams
  ADD COLUMN search_name text GENERATED ALWAYS AS (
    regexp_replace(normalize(lower(name), NFD), U&'[\0300-\036F]', '', 'g')) STORED,
  -- "Paris Saint-Germain" answers "psg": the first letter of each word.
  ADD COLUMN search_initials text GENERATED ALWAYS AS (
    regexp_replace(regexp_replace(normalize(lower(name), NFD), U&'[\0300-\036F]', '', 'g'),
      '([[:alpha:]])[[:alpha:]]*[^[:alpha:]]*', '\1', 'g')) STORED;

-- 2. The key views give the public id by a join (the rule of api.public_id, as
--    api.fixtures does since 021), not by one function call per row: the function is
--    SECURITY DEFINER, so never inlined, and a read of every club paid 11,500 calls
--    (175 ms). A read that does not use the id pays nothing: the join is removed. They
--    also carry the stored search names, and a club its country (api.team_countries
--    is keyed by the public id, which a join can only reach through the function).
CREATE OR REPLACE VIEW api.player_keys AS
SELECT p.id AS player_id, coalesce(pk.provider_key, 'p_v' || lpad(p.id::text, 7, '0')) AS public_id,
  p.name, ph.source_url AS image_url, p.search_name
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN core.provider_ids pk ON pk.entity_type = 'player' AND pk.entity_id = p.id
  AND pk.provider = 'pitchapi' AND pk.is_current;

CREATE OR REPLACE VIEW api.team_keys AS
SELECT t.id AS team_id, coalesce(tk.provider_key, 't_v' || lpad(t.id::text, 7, '0')) AS public_id,
  t.name, cr.source_url AS image_url, t.country_code AS country, t.search_name, t.search_initials
FROM core.teams t
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.provider_ids tk ON tk.entity_type = 'team' AND tk.entity_id = t.id
  AND tk.provider = 'pitchapi' AND tk.is_current;

-- 3. A club's matches of one season. core.matches is not partitioned and holds the
--    archives: a club found in them has thousands of matches, and (team, kick-off) reads
--    them all to keep one season's 40. (team, season) reads exactly those.
CREATE INDEX matches_home_season ON core.matches(home_team_id, season_id);
CREATE INDEX matches_away_season ON core.matches(away_team_id, season_id);

-- 4. Where a player played, by ids: one row per statistics row and per line-up row. The
--    search checks each name it found against the season (did he play, and for a club or
--    in a league the other words name?). Through api.player_appearances that check paid
--    eight lookups per appearance to compare two names; here it reads the row's own ids,
--    and the match (for its edition) only when the edition is asked for.
CREATE VIEW api.player_match_keys AS
SELECT s.season_id, s.match_id, s.player_id, s.team_id,
  (SELECT m.competition_season_id FROM core.matches m WHERE m.id = s.match_id) AS competition_season_id
FROM core.player_match_stats s
UNION ALL
SELECT l.season_id, l.match_id, l.player_id, l.team_id,
  (SELECT m.competition_season_id FROM core.matches m WHERE m.id = l.match_id)
FROM core.lineup_players l;
GRANT SELECT ON api.player_match_keys TO vega_read;

--    The editions carry their league's name, so the search finds the editions a word
--    names without reading an appearance.
CREATE OR REPLACE VIEW api.edition_keys AS
SELECT cs.id AS competition_season_id, cs.season_id, se.label AS season,
  coalesce(cp.provider_key, 'l_v' || lpad(cs.competition_id::text, 7, '0')) AS league_id, c.name AS league
FROM core.competition_seasons cs
JOIN core.seasons se ON se.id = cs.season_id
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.provider = 'pitchapi' AND cp.entity_id = cs.competition_id AND cp.is_current;
