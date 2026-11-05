-- The approved native cohort rules apply only to new observations in this generation.
-- Physical children keep their original parent and source pointers after later corrections.
CREATE FUNCTION ingest.native107_id_matches(state text, native_id text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $native107$
 SELECT coalesce((state='value' AND native_id IS NOT NULL)
      OR (state IN ('absent','null') AND native_id IS NULL), false)
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_id_matches(text,text) FROM PUBLIC;

CREATE FUNCTION ingest.native107_field_id_matches(sid bigint, did bigint, path text, state text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $native107$
 SELECT ingest.native107_id_matches(state,(SELECT r.external_key FROM ingest.source_records r
  WHERE r.source_id=sid AND r.document_id=did AND r.locator_kind='json_pointer' AND r.locator=path))
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_field_id_matches(bigint,bigint,text,text) FROM PUBLIC;

CREATE FUNCTION ingest.native107_player_profile_matches(pid bigint, actor bigint, sid bigint, did bigint,
 path text, slot integer, g bigint) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $native107$
 SELECT EXISTS (SELECT 1 FROM football.player_profile_versions p JOIN ingest.source_records r ON r.id=p.source_record_id
  WHERE p.id=pid AND p.player_id=actor AND p.source_id=sid AND r.source_id=sid AND r.document_id=did
   AND r.locator_kind='json_pointer' AND r.locator=path AND r.ordinal IS NOT DISTINCT FROM slot
   AND p.profile_context='native_match_observation_v1:'||r.id::text AND p.variant_key='source:exact'
   AND p.recorded_from_gen<=g AND (p.recorded_to_gen IS NULL OR g<p.recorded_to_gen) AND NOT p.is_deleted
   AND p.source_name_state<>'unrecorded' AND p.source_image_url_state<>'unrecorded'
   AND ingest.native107_id_matches(p.source_external_id_state,r.external_key))
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_player_profile_matches(bigint,bigint,bigint,bigint,text,integer,bigint) FROM PUBLIC;

CREATE FUNCTION ingest.native107_team_profile_matches(pid bigint, actor bigint, sid bigint, did bigint,
 path text, g bigint) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $native107$
 SELECT EXISTS (SELECT 1 FROM football.team_profile_versions p JOIN ingest.source_records r ON r.id=p.source_record_id
  WHERE p.id=pid AND p.team_id=actor AND p.source_id=sid AND r.source_id=sid AND r.document_id=did
   AND r.locator_kind='json_pointer' AND r.locator=path AND r.ordinal IS NULL
   AND p.profile_context='native_match_observation_v1:'||r.id::text AND p.variant_key='source:exact'
   AND p.recorded_from_gen<=g AND (p.recorded_to_gen IS NULL OR g<p.recorded_to_gen) AND NOT p.is_deleted
   AND p.source_name_state<>'unrecorded' AND p.source_image_url_state<>'unrecorded'
   AND ingest.native107_id_matches(p.source_external_id_state,r.external_key))
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_team_profile_matches(bigint,bigint,bigint,bigint,text,bigint) FROM PUBLIC;

CREATE FUNCTION ingest.native107_slots(expected integer, actual bigint, distinct_slots bigint,
 first_slot integer, last_slot integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $native107$
 SELECT actual=coalesce(expected,0) AND distinct_slots=actual
   AND (actual=0 OR coalesce(first_slot=0 AND last_slot=actual-1,false))
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_slots(integer,bigint,bigint,integer,integer) FROM PUBLIC;

-- Layout occurrences have exact document/locator checks below. Their immutable
-- scalar facts may come from an earlier observation of the same typed cohort.
CREATE FUNCTION ingest.native107_team_scalar_matches(rev bigint, mid bigint, actor bigint, sid bigint,
 raw_key text, period_state text, period_label text, g bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $native107$
 SELECT EXISTS (SELECT 1 FROM football.team_match_metric_values s
   JOIN ingest.source_records r ON r.id=s.source_record_id
   JOIN football.periods p ON p.code=s.period_code AND p.definition_version=s.period_definition_version
   JOIN football.source_metric_mappings m ON m.source_id=s.source_id AND m.family_code=s.family_code
    AND m.raw_key=native107_team_scalar_matches.raw_key AND m.metric_code=s.metric_code
    AND m.metric_definition_version=s.metric_definition_version
  WHERE s.revision_id=rev AND s.match_id=mid AND s.team_id=actor AND s.source_id=sid
   AND r.source_id=sid AND r.locator_kind='json_pointer'
   AND s.recorded_from_gen<=g AND (s.recorded_to_gen IS NULL OR g<s.recorded_to_gen) AND NOT s.is_deleted
   AND p.recorded_from_gen<=g AND (p.recorded_to_gen IS NULL OR g<p.recorded_to_gen)
   AND m.recorded_from_gen<=g AND (m.recorded_to_gen IS NULL OR g<m.recorded_to_gen)
   AND ((period_state='value' AND period_label=s.period_code)
    OR m.period_rule->'native107'->>(period_state||':'||coalesce(period_label,''))=s.period_code)
   AND coalesce(s.numeric_value::text,'') NOT IN ('NaN','Infinity','-Infinity')
   AND coalesce(s.numerator::text,'') NOT IN ('NaN','Infinity','-Infinity')
   AND coalesce(s.denominator::text,'') NOT IN ('NaN','Infinity','-Infinity'))
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_team_scalar_matches(bigint,bigint,bigint,bigint,text,text,text,bigint) FROM PUBLIC;

CREATE FUNCTION ingest.validate_native107_generation(g bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $native107$
DECLARE
 cov ingest.match_coverage%ROWTYPE;
 root ingest.source_records%ROWTYPE;
 home_actor bigint;
 away_actor bigint;
 header record;
 list_name text;
 wanted integer;
BEGIN
 -- These rows can only change their interval end. A later draft may not append
 -- members or layouts to a previously sealed physical native observation.
 IF EXISTS (SELECT 1 FROM football.match_lineups l WHERE l.recorded_from_gen=g
   AND (l.source_collection_from_gen IS NOT NULL OR l.source_object_state<>'unrecorded')
   AND (l.source_collection_from_gen IS DISTINCT FROM g OR NOT EXISTS (
    SELECT 1 FROM ingest.match_coverage c WHERE c.match_id=l.match_id AND c.source_id=l.source_id
     AND c.feature_code='lineups' AND c.variant_key=l.variant_key AND c.recorded_from_gen=g
     AND c.source_match_id_state<>'unrecorded'))) THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: lineup header requires its new exact native collection';
 END IF;
 IF EXISTS (SELECT 1 FROM football.match_players p WHERE p.recorded_from_gen=g
   AND (p.lineup_revision_id IS NOT NULL OR p.source_is_captain_state<>'unrecorded'
        OR p.source_raw_pitch_x_state<>'unrecorded' OR p.source_raw_pitch_y_state<>'unrecorded')
   AND NOT EXISTS (SELECT 1 FROM football.match_lineups l WHERE l.revision_id=p.lineup_revision_id
     AND l.match_id=p.match_id AND l.team_id=p.team_id AND l.source_id=p.source_id
     AND l.recorded_from_gen=g AND l.source_collection_from_gen=g)) THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: lineup member requires its new exact header';
 END IF;

 FOR cov IN SELECT c.* FROM ingest.match_coverage c WHERE c.recorded_from_gen=g
  AND c.feature_code IN ('events','lineups','stats','h2h') AND (
    c.contract_version='match-native-v1' OR c.source_match_id_state<>'unrecorded'
    OR c.source_home_team_state<>'unrecorded' OR c.source_away_team_state<>'unrecorded'
    OR EXISTS (SELECT 1 FROM football.match_team_stat_periods p WHERE
       (p.match_id,p.source_id,p.feature_code,p.variant_key,p.recorded_from_gen)=
       (c.match_id,c.source_id,c.feature_code,c.variant_key,c.recorded_from_gen))
    OR EXISTS (SELECT 1 FROM football.match_h2h_summaries h WHERE
       (h.match_id,h.source_id,h.feature_code,h.variant_key,h.recorded_from_gen)=
       (c.match_id,c.source_id,c.feature_code,c.variant_key,c.recorded_from_gen)))
 LOOP
  IF 'unrecorded' IN (cov.source_match_id_state,cov.source_home_team_state,cov.source_away_team_state)
     OR cov.collection_state NOT IN ('present','empty','null','absent') THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: admission requires recorded root and collection states';
  END IF;
  SELECT r.* INTO root FROM ingest.source_records r WHERE r.id=cov.source_record_id
    AND r.source_id=cov.source_id AND r.document_id=cov.document_id
    AND r.locator_kind='json_pointer' AND r.locator='/data' AND r.ordinal IS NULL;
  IF NOT FOUND OR NOT ingest.native107_id_matches(cov.source_match_id_state,root.external_key) THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: identity root record or ID state differs';
  END IF;
  SELECT max(t.team_id) FILTER (WHERE t.side='home'),max(t.team_id) FILTER (WHERE t.side='away')
   INTO home_actor,away_actor FROM football.match_teams t WHERE t.match_id=cov.match_id
    AND t.recorded_from_gen<=g AND (t.recorded_to_gen IS NULL OR g<t.recorded_to_gen) AND t.is_canonical AND NOT t.is_deleted;
  IF (cov.source_home_team_state='object' AND NOT ingest.native107_team_profile_matches(
        cov.source_home_team_profile_version_id,home_actor,cov.source_id,cov.document_id,root.locator||'/home_team',g))
    OR (cov.source_away_team_state='object' AND NOT ingest.native107_team_profile_matches(
        cov.source_away_team_profile_version_id,away_actor,cov.source_id,cov.document_id,root.locator||'/away_team',g)) THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: profile root team observation differs';
  END IF;

  IF cov.feature_code='events' THEN
   IF EXISTS (SELECT 1 FROM football.match_events e WHERE
      (e.match_id,e.source_id,e.feature_code,e.variant_key,e.recorded_from_gen)=
      (cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
      AND 'unrecorded' IN (e.source_event_type_state,e.source_minute_state,e.source_minute_added_state,
       e.source_second_state,e.source_is_penalty_state,e.source_is_own_goal_state,e.source_score_home_state,
       e.source_score_away_state,e.source_period_label_state,e.source_player_state,e.source_sub_in_player_state,
       e.source_event_id_state,e.source_team_id_state)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: admission unrecorded event field';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_events e LEFT JOIN ingest.source_records r ON r.id=e.source_record_id
      WHERE (e.match_id,e.source_id,e.feature_code,e.variant_key,e.recorded_from_gen)=
       (cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
      AND NOT coalesce(r.source_id=cov.source_id AND r.document_id=cov.document_id AND r.locator_kind='json_pointer'
       AND r.locator=root.locator||'/events/'||e.source_ordinal::text AND r.ordinal=e.source_ordinal AND e.source_ordinal>=0,false))
     OR NOT (SELECT ingest.native107_slots(cov.observed_row_count,count(*),count(DISTINCT e.source_ordinal),
           min(e.source_ordinal),max(e.source_ordinal)) FROM football.match_events e WHERE
           (e.match_id,e.source_id,e.feature_code,e.variant_key,e.recorded_from_gen)=
           (cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: locator event order or record differs';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_events e JOIN ingest.source_records r ON r.id=e.source_record_id
       WHERE (e.match_id,e.source_id,e.feature_code,e.variant_key,e.recorded_from_gen)=
        (cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
       AND (NOT ingest.native107_id_matches(e.source_event_id_state,r.external_key)
        OR e.source_event_id IS DISTINCT FROM r.external_key
        OR NOT ingest.native107_field_id_matches(cov.source_id,cov.document_id,r.locator||'/team_id',e.source_team_id_state))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: identity event field witness differs';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_events e JOIN ingest.source_records r ON r.id=e.source_record_id
       WHERE (e.match_id,e.source_id,e.feature_code,e.variant_key,e.recorded_from_gen)=
        (cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
       AND ((e.source_player_state='object' AND NOT ingest.native107_player_profile_matches(e.player_profile_version_id,
          e.player_id,cov.source_id,cov.document_id,r.locator||'/player',NULL,g))
        OR (e.source_sub_in_player_state='object' AND NOT ingest.native107_player_profile_matches(e.sub_in_player_profile_version_id,
          e.sub_in_player_id,cov.source_id,cov.document_id,r.locator||'/sub_in_player',NULL,g)))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: profile event actor observation differs';
   END IF;

  ELSIF cov.feature_code='lineups' THEN
   IF (SELECT count(*) FROM football.match_lineups l WHERE l.match_id=cov.match_id AND l.source_id=cov.source_id
      AND l.source_feature_code='lineups' AND l.variant_key=cov.variant_key AND l.source_collection_from_gen=g)<>2 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: lineup requires exactly two explicit side states';
   END IF;
   FOR header IN SELECT l.*,r.locator,r.ordinal,r.locator_kind,r.document_id,r.source_id AS record_source,t.side
     FROM football.match_lineups l LEFT JOIN ingest.source_records r ON r.id=l.source_record_id
     LEFT JOIN football.match_teams t ON t.revision_id=l.match_team_revision_id
     WHERE l.match_id=cov.match_id AND l.source_id=cov.source_id AND l.source_feature_code='lineups'
       AND l.variant_key=cov.variant_key AND l.source_collection_from_gen=g
   LOOP
    IF NOT coalesce(header.side IN ('home','away') AND header.team_id=CASE header.side WHEN 'home' THEN home_actor ELSE away_actor END
       AND header.locator=root.locator||'/'||header.side AND header.ordinal IS NULL
       AND header.locator_kind='json_pointer' AND header.document_id=cov.document_id AND header.record_source=cov.source_id,false)
       OR 'unrecorded' IN (header.source_object_state,header.source_formation_state,header.source_confirmed_state,
          header.source_lineup_type_state,header.source_coach_state,header.source_coach_name_state,
          header.source_starters_state,header.source_subs_state) THEN
     RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: lineup side, record or field state differs';
    END IF;
    IF EXISTS (SELECT 1 FROM football.match_players p LEFT JOIN ingest.source_records r ON r.id=p.source_record_id
       LEFT JOIN football.player_profile_versions v ON v.id=p.profile_version_id
       WHERE p.lineup_revision_id=header.revision_id AND p.recorded_from_gen=g
        AND (p.is_deleted OR p.source_id<>cov.source_id OR p.match_team_revision_id IS DISTINCT FROM header.match_team_revision_id
        OR p.squad_status NOT IN ('starter','substitute')
        OR 'unrecorded' IN (p.source_is_captain_state,p.source_raw_pitch_x_state,p.source_raw_pitch_y_state)
        OR NOT coalesce(r.ordinal>=0 AND ingest.native107_player_profile_matches(p.profile_version_id,p.player_id,
           cov.source_id,cov.document_id,header.locator||CASE p.squad_status WHEN 'starter' THEN '/starters/' ELSE '/subs/' END||r.ordinal::text,r.ordinal,g),false)
        OR (p.raw_position_code_state NOT IN ('absent','null') AND v.raw_position_code_state NOT IN ('absent','null')
           AND ROW(p.raw_position_code_state,p.raw_position_code,p.raw_position_code_source_number)
             IS DISTINCT FROM ROW(v.raw_position_code_state,v.raw_position_code,v.raw_position_code_source_number))
        OR (p.shirt_number_state NOT IN ('absent','null') AND v.shirt_number_state NOT IN ('absent','null')
           AND ROW(p.shirt_number_state,p.shirt_number,p.shirt_number_source_number)
             IS DISTINCT FROM ROW(v.shirt_number_state,v.shirt_number,v.shirt_number_source_number)))) THEN
     RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: lineup member, physical profile or scalar differs';
    END IF;
    FOREACH list_name IN ARRAY ARRAY['starter','substitute'] LOOP
     wanted=CASE list_name WHEN 'starter' THEN header.source_starters_count ELSE header.source_subs_count END;
     IF NOT (SELECT ingest.native107_slots(wanted,count(*),count(DISTINCT r.ordinal),min(r.ordinal),max(r.ordinal))
        FROM football.match_players p JOIN ingest.source_records r ON r.id=p.source_record_id
        WHERE p.lineup_revision_id=header.revision_id AND p.recorded_from_gen=g AND p.squad_status=list_name) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: lineup member list has a gap or wrong count';
     END IF;
    END LOOP;
   END LOOP;

  ELSIF cov.feature_code='stats' THEN
   IF NOT (SELECT ingest.native107_slots(cov.observed_row_count,count(*),count(DISTINCT r.ordinal),min(r.ordinal),max(r.ordinal))
      AND coalesce(bool_and(r.source_id=cov.source_id AND r.document_id=cov.document_id AND r.locator_kind='json_pointer'
       AND r.locator=root.locator||'/periods/'||r.ordinal::text),true)
      FROM football.match_team_stat_periods p JOIN ingest.source_records r ON r.id=p.source_record_id WHERE
       (p.match_id,p.source_id,p.feature_code,p.variant_key,p.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: stats period records or order differ';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_team_stat_periods p JOIN ingest.source_records r ON r.id=p.source_record_id
     WHERE (p.match_id,p.source_id,p.feature_code,p.variant_key,p.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
     AND NOT (SELECT ingest.native107_slots(p.groups_count,count(*),count(DISTINCT gr.ordinal),min(gr.ordinal),max(gr.ordinal))
        AND coalesce(bool_and(gr.source_id=cov.source_id AND gr.document_id=cov.document_id AND gr.locator_kind='json_pointer'
          AND gr.locator=r.locator||'/groups/'||gr.ordinal::text),true)
       FROM football.match_team_stat_groups x JOIN ingest.source_records gr ON gr.id=x.source_record_id WHERE
        (x.match_id,x.source_id,x.feature_code,x.variant_key,x.recorded_from_gen,x.period_source_record_id)=
        (p.match_id,p.source_id,p.feature_code,p.variant_key,p.recorded_from_gen,p.source_record_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: stats group records or order differ';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_team_stat_groups x JOIN ingest.source_records r ON r.id=x.source_record_id
     WHERE (x.match_id,x.source_id,x.feature_code,x.variant_key,x.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
     AND NOT (SELECT ingest.native107_slots(x.items_count,count(*),count(DISTINCT ir.ordinal),min(ir.ordinal),max(ir.ordinal))
        AND coalesce(bool_and(ir.source_id=cov.source_id AND ir.document_id=cov.document_id AND ir.locator_kind='json_pointer'
          AND ir.locator=r.locator||'/items/'||ir.ordinal::text),true)
       FROM football.match_team_stat_items i JOIN ingest.source_records ir ON ir.id=i.source_record_id WHERE
        (i.match_id,i.source_id,i.feature_code,i.variant_key,i.recorded_from_gen,i.group_source_record_id)=
        (x.match_id,x.source_id,x.feature_code,x.variant_key,x.recorded_from_gen,x.source_record_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: stats item records or order differ';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_team_stat_items i
      JOIN football.match_team_stat_groups x ON (x.match_id,x.source_id,x.feature_code,x.variant_key,x.recorded_from_gen,x.source_record_id)=
         (i.match_id,i.source_id,i.feature_code,i.variant_key,i.recorded_from_gen,i.group_source_record_id)
      JOIN football.match_team_stat_periods p ON (p.match_id,p.source_id,p.feature_code,p.variant_key,p.recorded_from_gen,p.source_record_id)=
         (x.match_id,x.source_id,x.feature_code,x.variant_key,x.recorded_from_gen,x.period_source_record_id)
      WHERE (i.match_id,i.source_id,i.feature_code,i.variant_key,i.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
      AND (i.raw_key_state<>'value' OR NOT ingest.native107_team_scalar_matches(i.home_metric_revision_id,cov.match_id,home_actor,
          cov.source_id,i.raw_key,p.source_period_label_state,p.source_period_label,g)
       OR NOT ingest.native107_team_scalar_matches(i.away_metric_revision_id,cov.match_id,away_actor,
          cov.source_id,i.raw_key,p.source_period_label_state,p.source_period_label,g))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: stats scalar side, period, mapping, source or numeric state differs';
   END IF;

  ELSIF cov.feature_code='h2h' THEN
   IF NOT EXISTS (SELECT 1 FROM football.match_h2h_summaries h WHERE
     (h.match_id,h.source_id,h.feature_code,h.variant_key,h.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g))
     OR NOT (SELECT ingest.native107_slots(cov.observed_row_count,count(*),count(DISTINCT r.ordinal),min(r.ordinal),max(r.ordinal))
       AND coalesce(bool_and(r.source_id=cov.source_id AND r.document_id=cov.document_id AND r.locator_kind='json_pointer'
         AND r.locator=root.locator||'/recent_matches/'||r.ordinal::text AND r.ordinal=h.entry_ordinal),true)
       FROM football.match_h2h_entries h JOIN ingest.source_records r ON r.id=h.source_record_id WHERE
        (h.match_id,h.source_id,h.feature_code,h.variant_key,h.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: h2h summary or entry order differs';
   END IF;
   IF EXISTS (SELECT 1 FROM football.match_h2h_entries h JOIN ingest.source_records r ON r.id=h.source_record_id WHERE
       (h.match_id,h.source_id,h.feature_code,h.variant_key,h.recorded_from_gen)=(cov.match_id,cov.source_id,cov.feature_code,cov.variant_key,g)
       AND ('unrecorded' IN (h.source_finished_state,h.source_home_score_state,h.source_away_score_state,h.source_time_utc_source_state,
         h.source_status_source_state,h.source_home_label_state,h.source_away_label_state,h.source_home_state,h.source_away_state,
         h.source_home_image_url_state,h.source_away_image_url_state,h.source_external_match_id_state,h.source_home_id_state,h.source_away_id_state)
       OR NOT ingest.native107_id_matches(h.source_external_match_id_state,r.external_key)
       OR h.external_match_id IS DISTINCT FROM r.external_key
       OR NOT ingest.native107_field_id_matches(cov.source_id,cov.document_id,r.locator||'/home/id',h.source_home_id_state)
       OR NOT ingest.native107_field_id_matches(cov.source_id,cov.document_id,r.locator||'/away/id',h.source_away_id_state))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: h2h field or identity witness differs';
   END IF;
  END IF;
 END LOOP;
END;
$native107$;
REVOKE ALL ON FUNCTION ingest.validate_native107_generation(bigint) FROM PUBLIC;

CREATE FUNCTION ingest.native107_no_publication_downgrade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $native107$
BEGIN
 IF EXISTS (SELECT 1 FROM analytics.publication_versions p JOIN analytics.aggregation_builds b ON b.id=p.build_id
     WHERE p.competition_season_id=NEW.competition_season_id AND p.published_to_gen=NEW.published_from_gen
      AND b.metrics_contract_version='orion_pro_native107_v1')
   AND NOT EXISTS (SELECT 1 FROM analytics.aggregation_builds b WHERE b.id=NEW.build_id
      AND b.metrics_contract_version='orion_pro_native107_v1'
      AND b.transform_version='orion_pro_publish_native107_v1') THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: publication cannot downgrade to the previous contract';
 END IF;
 RETURN NEW;
END;
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_no_publication_downgrade() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER native107_publication_contract AFTER INSERT ON analytics.publication_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ingest.native107_no_publication_downgrade();
