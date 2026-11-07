-- A disposable read projection of canonical appearances. No source row is removed.
-- Rebuilt per changed partition in the same transaction as its publication.
ALTER TABLE statarena_app.partitions ADD COLUMN IF NOT EXISTS player_rollup_digest text;
ALTER TABLE statarena_app.partitions ADD COLUMN IF NOT EXISTS player_rollup_ambiguous boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS statarena_app.player_season_rollups (
 season text NOT NULL,league_id text NOT NULL,player_id text NOT NULL,
 matches integer NOT NULL,total_minutes double precision NOT NULL,
 rating_sum double precision,rating_count integer NOT NULL,
 starts integer NOT NULL,known_starts integer NOT NULL,unknown_minutes integer NOT NULL,
 team_ids text[] NOT NULL,league_ids text[] NOT NULL,
 identity jsonb NOT NULL,latest jsonb,
 teams jsonb NOT NULL,leagues jsonb NOT NULL,roles jsonb NOT NULL,
 metrics jsonb NOT NULL,
 PRIMARY KEY(season,league_id,player_id),
 FOREIGN KEY(season,league_id) REFERENCES statarena_app.partitions ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS app_player_rollups_actor ON statarena_app.player_season_rollups(player_id,season,league_id);

CREATE OR REPLACE FUNCTION statarena_app.refresh_player_season_rollups(target_season text,target_league text,force_refresh boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog,statarena_app AS $refresh$
DECLARE current_digest text; retained_digest text; changed_rows integer; ambiguous boolean;
BEGIN
 SELECT source_digest,player_rollup_digest INTO current_digest,retained_digest
 FROM statarena_app.partitions WHERE season=target_season AND league_id=target_league FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 IF NOT force_refresh AND retained_digest=current_digest THEN RETURN 0; END IF;
 DELETE FROM statarena_app.player_season_rollups WHERE season=target_season AND league_id=target_league;
 INSERT INTO statarena_app.player_season_rollups
 WITH source AS MATERIALIZED (
  SELECT a.*,CASE WHEN a.position_id IS NULL OR a.position_id_type='NoneType' THEN NULL
 WHEN a.position_id_type='bool' THEN CASE WHEN a.position_id='True' THEN 1 ELSE 0 END
 WHEN btrim(a.position_id)='' THEN 0
 WHEN btrim(a.position_id)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
 AND pg_input_is_valid(a.position_id,'double precision') THEN a.position_id::float8 END position_number,
   row_number() OVER(ORDER BY a.date NULLS LAST,a.match_id,a.ordinal,a.id) source_order
  FROM statarena_app.appearances a WHERE a.season=target_season AND a.league_id=target_league
   AND a.player_id IS NOT NULL AND a.player_id<>''
 ), played AS MATERIALIZED (
  SELECT DISTINCT ON(player_id,match_id) s.*,CASE WHEN s.position_number IN(0,11) THEN 'G'
 WHEN s.position_number=1 OR s.position_number>=30 AND s.position_number<40 OR s.position_number IN(51,59) THEN 'D'
 WHEN s.position_number=2 OR s.position_number>=50 AND s.position_number<80 THEN 'M'
 WHEN s.position_number>=80 AND s.position_number<90 THEN 'AM'
 WHEN s.position_number=3 OR s.position_number>=90 AND s.position_number<120 THEN 'A' END role_code
  FROM source s WHERE s.match_id IS NOT NULL AND s.match_id<>'' AND (s.minutes IS NOT NULL AND s.minutes NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND s.minutes>0
  ORDER BY player_id,match_id,source_order
 ), identities AS (
  SELECT DISTINCT ON(player_id) * FROM source ORDER BY player_id,coalesce(date,'') DESC,source_order
 ), latest AS (
  SELECT DISTINCT ON(player_id) * FROM played ORDER BY player_id,coalesce(date,'') DESC,source_order
 ), unknown AS (
  SELECT s.player_id,count(DISTINCT s.match_id)::int amount FROM source s
  LEFT JOIN played p ON p.player_id=s.player_id AND p.match_id=s.match_id
  WHERE s.match_id IS NOT NULL AND s.match_id<>'' AND NOT (s.minutes IS NOT NULL AND s.minutes NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.id IS NULL GROUP BY s.player_id
 ), teams AS (
  SELECT player_id,jsonb_agg(jsonb_build_object('name',team,'first',first_order) ORDER BY first_order) names
  FROM (SELECT player_id,team,min(source_order) first_order FROM played WHERE team IS NOT NULL AND team<>'' GROUP BY player_id,team) t GROUP BY player_id
 ), leagues AS (
  SELECT player_id,jsonb_agg(jsonb_build_object('name',league,'first',first_order) ORDER BY first_order) names
  FROM (SELECT player_id,league,min(source_order) first_order FROM source WHERE league IS NOT NULL AND league<>'' GROUP BY player_id,league) l GROUP BY player_id
 ), roles AS (
  SELECT player_id,jsonb_agg(jsonb_build_object('code',role_code,'minutes',minutes,'first',first_order)) roles
  FROM (SELECT player_id,role_code,sum(minutes) minutes,min(source_order) first_order FROM played WHERE role_code IS NOT NULL GROUP BY player_id,role_code) p GROUP BY player_id
 ), aggregates AS (
  SELECT p.player_id,count(*)::int matches,sum(p.minutes) total_minutes,
   sum(p.rating) FILTER(WHERE (p.rating IS NOT NULL AND p.rating NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))) rating_sum,count(*) FILTER(WHERE (p.rating IS NOT NULL AND p.rating NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))::int rating_count,
   count(*) FILTER(WHERE p.starter IS TRUE)::int starts,count(*) FILTER(WHERE p.starter IS NOT NULL)::int known_starts,
   array_agg(DISTINCT p.team_id) FILTER(WHERE p.team_id IS NOT NULL AND p.team_id<>'') team_ids,
   array_agg(DISTINCT p.league_id) FILTER(WHERE p.league_id IS NOT NULL AND p.league_id<>'') league_ids,
   jsonb_strip_nulls(jsonb_build_object(
    'goals',jsonb_build_object('sum',sum(p.goals) FILTER(WHERE (p.goals IS NOT NULL AND p.goals NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.goals IS NOT NULL AND p.goals NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.goals IS NOT NULL AND p.goals NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'assists',jsonb_build_object('sum',sum(p.assists) FILTER(WHERE (p.assists IS NOT NULL AND p.assists NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.assists IS NOT NULL AND p.assists NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.assists IS NOT NULL AND p.assists NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'xg',jsonb_build_object('sum',sum(p.xg) FILTER(WHERE (p.xg IS NOT NULL AND p.xg NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.xg IS NOT NULL AND p.xg NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.xg IS NOT NULL AND p.xg NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'npxg',jsonb_build_object('sum',sum(p.npxg) FILTER(WHERE (p.npxg IS NOT NULL AND p.npxg NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.npxg IS NOT NULL AND p.npxg NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.npxg IS NOT NULL AND p.npxg NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'xgot',jsonb_build_object('sum',sum(p.xgot) FILTER(WHERE (p.xgot IS NOT NULL AND p.xgot NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.xgot IS NOT NULL AND p.xgot NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.xgot IS NOT NULL AND p.xgot NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'xa',jsonb_build_object('sum',sum(p.xa) FILTER(WHERE (p.xa IS NOT NULL AND p.xa NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.xa IS NOT NULL AND p.xa NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.xa IS NOT NULL AND p.xa NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'shots',jsonb_build_object('sum',sum(p.shots) FILTER(WHERE (p.shots IS NOT NULL AND p.shots NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.shots IS NOT NULL AND p.shots NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.shots IS NOT NULL AND p.shots NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'shotsOnTarget',jsonb_build_object('sum',sum(p.shots_on_target) FILTER(WHERE (p.shots_on_target IS NOT NULL AND p.shots_on_target NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.shots_on_target IS NOT NULL AND p.shots_on_target NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.shots_on_target IS NOT NULL AND p.shots_on_target NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'touchesBox',jsonb_build_object('sum',sum(p.touches_box) FILTER(WHERE (p.touches_box IS NOT NULL AND p.touches_box NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.touches_box IS NOT NULL AND p.touches_box NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.touches_box IS NOT NULL AND p.touches_box NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'chancesCreated',jsonb_build_object('sum',sum(p.chances_created) FILTER(WHERE (p.chances_created IS NOT NULL AND p.chances_created NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.chances_created IS NOT NULL AND p.chances_created NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.chances_created IS NOT NULL AND p.chances_created NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'bigChancesCreated',jsonb_build_object('sum',sum(p.big_chances_created) FILTER(WHERE (p.big_chances_created IS NOT NULL AND p.big_chances_created NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.big_chances_created IS NOT NULL AND p.big_chances_created NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.big_chances_created IS NOT NULL AND p.big_chances_created NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'passesFinalThird',jsonb_build_object('sum',sum(p.passes_final_third) FILTER(WHERE (p.passes_final_third IS NOT NULL AND p.passes_final_third NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.passes_final_third IS NOT NULL AND p.passes_final_third NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.passes_final_third IS NOT NULL AND p.passes_final_third NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'dribbles',jsonb_build_object('sum',sum(p.dribbles) FILTER(WHERE (p.dribbles IS NOT NULL AND p.dribbles NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.dribbles IS NOT NULL AND p.dribbles NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.dribbles IS NOT NULL AND p.dribbles NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'touches',jsonb_build_object('sum',sum(p.touches) FILTER(WHERE (p.touches IS NOT NULL AND p.touches NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.touches IS NOT NULL AND p.touches NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.touches IS NOT NULL AND p.touches NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'passesAccurate',jsonb_build_object('sum',sum(p.passes_accurate) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'passesAttempted',jsonb_build_object('sum',sum(p.passes_attempted) FILTER(WHERE (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'duelsWon',jsonb_build_object('sum',sum(p.duels_won) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'duelsLost',jsonb_build_object('sum',sum(p.duels_lost) FILTER(WHERE (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'tackles',jsonb_build_object('sum',sum(p.tackles) FILTER(WHERE (p.tackles IS NOT NULL AND p.tackles NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.tackles IS NOT NULL AND p.tackles NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.tackles IS NOT NULL AND p.tackles NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'interceptions',jsonb_build_object('sum',sum(p.interceptions) FILTER(WHERE (p.interceptions IS NOT NULL AND p.interceptions NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.interceptions IS NOT NULL AND p.interceptions NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.interceptions IS NOT NULL AND p.interceptions NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'recoveries',jsonb_build_object('sum',sum(p.recoveries) FILTER(WHERE (p.recoveries IS NOT NULL AND p.recoveries NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.recoveries IS NOT NULL AND p.recoveries NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.recoveries IS NOT NULL AND p.recoveries NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'clearances',jsonb_build_object('sum',sum(p.clearances) FILTER(WHERE (p.clearances IS NOT NULL AND p.clearances NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.clearances IS NOT NULL AND p.clearances NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.clearances IS NOT NULL AND p.clearances NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'defensiveActions',jsonb_build_object('sum',sum(p.defensive_actions) FILTER(WHERE (p.defensive_actions IS NOT NULL AND p.defensive_actions NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.defensive_actions IS NOT NULL AND p.defensive_actions NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.defensive_actions IS NOT NULL AND p.defensive_actions NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'blocks',jsonb_build_object('sum',sum(p.blocks) FILTER(WHERE (p.blocks IS NOT NULL AND p.blocks NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.blocks IS NOT NULL AND p.blocks NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.blocks IS NOT NULL AND p.blocks NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'saves',jsonb_build_object('sum',sum(p.saves) FILTER(WHERE (p.saves IS NOT NULL AND p.saves NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.saves IS NOT NULL AND p.saves NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.saves IS NOT NULL AND p.saves NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'goalsPrevented',jsonb_build_object('sum',sum(p.goals_prevented) FILTER(WHERE (p.goals_prevented IS NOT NULL AND p.goals_prevented NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'count',count(*) FILTER(WHERE (p.goals_prevented IS NOT NULL AND p.goals_prevented NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8))),'minutes',sum(p.minutes) FILTER(WHERE (p.goals_prevented IS NOT NULL AND p.goals_prevented NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)))),
    'passAccuracy',jsonb_build_object('numerator',sum(p.passes_accurate) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.passes_attempted>0),'denominator',sum(p.passes_attempted) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.passes_attempted>0),'count',count(*) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.passes_attempted>0),'minutes',sum(p.minutes) FILTER(WHERE (p.passes_accurate IS NOT NULL AND p.passes_accurate NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.passes_attempted IS NOT NULL AND p.passes_attempted NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.passes_attempted>0)),
    'duelRate',jsonb_build_object('numerator',sum(p.duels_won) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.duels_won+p.duels_lost>0),'denominator',sum((p.duels_won+p.duels_lost)) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.duels_won+p.duels_lost>0),'count',count(*) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.duels_won+p.duels_lost>0),'minutes',sum(p.minutes) FILTER(WHERE (p.duels_won IS NOT NULL AND p.duels_won NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND (p.duels_lost IS NOT NULL AND p.duels_lost NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)) AND p.duels_won+p.duels_lost>0))
   )) metrics
  FROM played p GROUP BY p.player_id
 )
 SELECT target_season,target_league,i.player_id,coalesce(a.matches,0),coalesce(a.total_minutes,0),a.rating_sum,coalesce(a.rating_count,0),
  coalesce(a.starts,0),coalesce(a.known_starts,0),coalesce(u.amount,0),coalesce(a.team_ids,'{}'::text[]),coalesce(a.league_ids,'{}'::text[]),
  jsonb_build_object('id',i.id,'player_ref',i.player_ref,'date',i.date,'team',i.team,'team_id',i.team_id,'league_id',i.league_id,'league',i.league,'position_number',i.position_number,'source_order',i.source_order),CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id',l.id,'player_ref',l.player_ref,'date',l.date,'team',l.team,'team_id',l.team_id,'league_id',l.league_id,'league',l.league,'position_number',l.position_number,'source_order',l.source_order) END,
  coalesce(t.names,'[]'::jsonb),coalesce(le.names,'[]'::jsonb),coalesce(r.roles,'[]'::jsonb),coalesce(a.metrics,'{}'::jsonb)
 FROM identities i LEFT JOIN latest l USING(player_id) LEFT JOIN aggregates a USING(player_id)
 LEFT JOIN unknown u USING(player_id) LEFT JOIN teams t USING(player_id) LEFT JOIN leagues le USING(player_id) LEFT JOIN roles r USING(player_id);
 GET DIAGNOSTICS changed_rows=ROW_COUNT;
 -- Per-partition totals are additive only while one actor/match belongs to one
 -- selected partition. Imported conflicting league observations keep the exact
 -- fact query until repaired; they never silently double a player's totals.
 SELECT EXISTS(SELECT 1 FROM statarena_app.appearances a
  JOIN statarena_app.appearances other ON other.player_id=a.player_id AND other.match_id=a.match_id AND other.season=a.season
  WHERE a.season=target_season AND a.league_id=target_league AND other.league_id<>target_league)
 INTO ambiguous;
 UPDATE statarena_app.partitions SET player_rollup_digest=current_digest,player_rollup_ambiguous=ambiguous
 WHERE season=target_season AND league_id=target_league;
 RETURN changed_rows;
END $refresh$;

-- Mirror canonical partition access; refresh remains a writer-only operation.
REVOKE ALL ON FUNCTION statarena_app.refresh_player_season_rollups(text,text,boolean) FROM PUBLIC;
DO $grants$ DECLARE grant_row record; recipient text; BEGIN
 FOR grant_row IN SELECT a.grantee,a.privilege_type FROM pg_class c
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='statarena_app.partitions'::regclass
   AND a.privilege_type IN('SELECT','INSERT','UPDATE','DELETE')
 LOOP
  recipient:=CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END;
  EXECUTE 'GRANT '||grant_row.privilege_type||' ON statarena_app.player_season_rollups TO '||recipient;
  IF grant_row.privilege_type IN('INSERT','UPDATE') AND grant_row.grantee<>0 THEN
   EXECUTE 'GRANT EXECUTE ON FUNCTION statarena_app.refresh_player_season_rollups(text,text,boolean) TO '||recipient;
  END IF;
 END LOOP;
END $grants$;
