-- Performance percentiles read the selected position cohort, not every wide
-- appearance in a season. The one-character group is derived from existing facts.
CREATE OR REPLACE FUNCTION statarena_app.performance_profile_group(
  position_text text, position_type text, saves_value double precision
) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog AS $group$
DECLARE position_number double precision;
BEGIN
  IF position_text IS NULL OR position_type='NoneType' THEN
    position_number := NULL;
  ELSIF position_type='bool' THEN
    position_number := CASE WHEN position_text='True' THEN 1 ELSE 0 END;
  ELSIF btrim(position_text)='' THEN
    position_number := 0;
  ELSIF btrim(position_text)~'^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
    AND pg_input_is_valid(btrim(position_text),'double precision') THEN
    -- Only ASCII decimal float input is accepted. Its validity and value do
    -- not depend on DateStyle, collation or session settings.
    position_number := btrim(position_text)::double precision;
  END IF;
  IF position_number IN (0,11) THEN RETURN 'G';
  ELSIF position_number=1 OR (position_number>=30 AND position_number<40)
    OR position_number IN (51,59) THEN RETURN 'D';
  ELSIF position_number=2 OR (position_number>=50 AND position_number<80) THEN RETURN 'M';
  ELSIF (position_number>=80 AND position_number<120) OR position_number=3 THEN RETURN 'O';
  ELSIF saves_value IS NOT NULL AND saves_value NOT IN ('NaN'::float8,'Infinity'::float8,'-Infinity'::float8)
    AND saves_value>0 THEN RETURN 'G';
  ELSE RETURN 'F'; END IF;
END
$group$;

ALTER TABLE statarena_app.appearances ADD COLUMN IF NOT EXISTS performance_group text
  GENERATED ALWAYS AS (statarena_app.performance_profile_group(position_id,position_id_type,saves)) STORED;

CREATE INDEX IF NOT EXISTS app_appearances_performance_cohort
ON statarena_app.appearances (season,performance_group,league_id)
INCLUDE (minutes,xg,shots,shots_on_target,touches_box,
  chances_created,dribbles,touches,passes_accurate,passes_attempted,passes_final_third,
  tackles,interceptions,recoveries,clearances,blocks,duels_won,duels_lost,saves,goals_prevented)
WHERE minutes>=30;

REVOKE ALL ON FUNCTION statarena_app.performance_profile_group(text,text,double precision) FROM PUBLIC;
DO $grants$ DECLARE grant_row record; recipient text; BEGIN
  FOR grant_row IN SELECT DISTINCT a.grantee FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid='statarena_app.appearances'::regclass
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
  LOOP
    recipient := CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END;
    EXECUTE 'GRANT EXECUTE ON FUNCTION statarena_app.performance_profile_group(text,text,double precision) TO '||recipient;
  END LOOP;
END $grants$;
