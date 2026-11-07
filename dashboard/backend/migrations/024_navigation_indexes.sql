-- Search predicates are identical to relational-discovery.js. This extension is
-- bootstrapped by the database administrator on RDS; a local/test owner can create it.
DO $extension$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN
   CREATE EXTENSION pg_trgm;
 END IF;
END $extension$;

CREATE INDEX IF NOT EXISTS app_players_search_name ON statarena_app.players
 USING gin ((regexp_replace(normalize(lower(name),NFD),'[̀-ͯ]','','g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS app_teams_search_name ON statarena_app.teams
 USING gin ((regexp_replace(normalize(lower(name),NFD),'[̀-ͯ]','','g')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS app_appearances_player_latest ON statarena_app.appearances
 (player_id,season,date DESC NULLS LAST,id DESC);
CREATE INDEX IF NOT EXISTS app_matches_home_page ON statarena_app.matches(home_id,season,day,id);
CREATE INDEX IF NOT EXISTS app_matches_away_page ON statarena_app.matches(away_id,season,day,id);
