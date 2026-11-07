-- Additive, zero-copy consolidation of the actively served lineup family.
-- Native member values, missing/null flags, order and resource provenance remain
-- in their current constrained tables. Side/role make their grain explicit.
-- This does NOT switch the public reader. lineup_consolidation.py verifies every
-- resource before a transactional, reversible function switch. No data is dropped.

CREATE OR REPLACE VIEW statarena_app.lineup_members AS
SELECT 'home'::text AS side,'starter'::text AS role, m.*
FROM statarena_app.lineup_home_starters m
UNION ALL
SELECT 'home'::text AS side,'substitute'::text AS role, m.*
FROM statarena_app.lineup_home_substitutes m
UNION ALL
SELECT 'away'::text AS side,'starter'::text AS role, m.*
FROM statarena_app.lineup_away_starters m
UNION ALL
SELECT 'away'::text AS side,'substitute'::text AS role, m.*
FROM statarena_app.lineup_away_substitutes m;

CREATE OR REPLACE FUNCTION statarena_app.lineup_member_array(
  rid bigint, parent integer, member_side text, member_role text
) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'player_id',m.player_id,'name',m.name,'shirt_number',m.shirt_number,
  'position_id',m.position_id,'pitch_x',m.pitch_x,'pitch_y',m.pitch_y,
  'is_captain',m.is_captain) - m.missing ORDER BY m.position), '[]'::jsonb)
FROM statarena_app.lineup_members m
WHERE m.resource_id=rid AND m.parent_no=parent AND m.side=member_side AND m.role=member_role;
$$;

-- Frozen compatibility reader for parity and reversible rollback.
CREATE OR REPLACE FUNCTION statarena_app.detail_data_lineups_legacy(rid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT (jsonb_build_object('match_id', r."match_id",
'home_team', CASE WHEN 'home_team'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('id', r."home_team_id",
'name', r."home_team_name",
'image_url', r."home_team_image_url") - array_remove(ARRAY[CASE WHEN 'home_team.id'=ANY(r.missing) THEN 'id' END, CASE WHEN 'home_team.name'=ANY(r.missing) THEN 'name' END, CASE WHEN 'home_team.image_url'=ANY(r.missing) THEN 'image_url' END],NULL)) END,
'away_team', CASE WHEN 'away_team'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('id', r."away_team_id",
'name', r."away_team_name",
'image_url', r."away_team_image_url") - array_remove(ARRAY[CASE WHEN 'away_team.id'=ANY(r.missing) THEN 'id' END, CASE WHEN 'away_team.name'=ANY(r.missing) THEN 'name' END, CASE WHEN 'away_team.image_url'=ANY(r.missing) THEN 'image_url' END],NULL)) END,
'home', CASE WHEN 'home'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('formation', r."home_formation",
'lineup_type', r."home_lineup_type",
'confirmed', r."home_confirmed",
'coach', CASE WHEN 'home.coach'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('name', r."home_coach_name") - array_remove(ARRAY[CASE WHEN 'home.coach.name'=ANY(r.missing) THEN 'name' END],NULL)) END,
'starters', CASE WHEN 'home.starters'=ANY(r.null_groups) THEN NULL ELSE (SELECT coalesce(jsonb_agg((jsonb_build_object('player_id', r1."player_id",
'name', r1."name",
'shirt_number', r1."shirt_number",
'position_id', r1."position_id",
'pitch_x', r1."pitch_x",
'pitch_y', r1."pitch_y",
'is_captain', r1."is_captain") - r1.missing) ORDER BY r1.position), '[]'::jsonb) FROM statarena_app.lineup_home_starters r1
 WHERE r1.resource_id=r.resource_id AND r1.parent_no=r.record_no) END,
'subs', CASE WHEN 'home.subs'=ANY(r.null_groups) THEN NULL ELSE (SELECT coalesce(jsonb_agg((jsonb_build_object('player_id', r1."player_id",
'name', r1."name",
'shirt_number', r1."shirt_number",
'position_id', r1."position_id",
'pitch_x', r1."pitch_x",
'pitch_y', r1."pitch_y",
'is_captain', r1."is_captain") - r1.missing) ORDER BY r1.position), '[]'::jsonb) FROM statarena_app.lineup_home_substitutes r1
 WHERE r1.resource_id=r.resource_id AND r1.parent_no=r.record_no) END) - array_remove(ARRAY[CASE WHEN 'home.formation'=ANY(r.missing) THEN 'formation' END, CASE WHEN 'home.lineup_type'=ANY(r.missing) THEN 'lineup_type' END, CASE WHEN 'home.confirmed'=ANY(r.missing) THEN 'confirmed' END, CASE WHEN 'home.coach'=ANY(r.missing) THEN 'coach' END, CASE WHEN 'home.starters'=ANY(r.missing) THEN 'starters' END, CASE WHEN 'home.subs'=ANY(r.missing) THEN 'subs' END],NULL)) END,
'away', CASE WHEN 'away'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('formation', r."away_formation",
'lineup_type', r."away_lineup_type",
'confirmed', r."away_confirmed",
'coach', CASE WHEN 'away.coach'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('name', r."away_coach_name") - array_remove(ARRAY[CASE WHEN 'away.coach.name'=ANY(r.missing) THEN 'name' END],NULL)) END,
'starters', CASE WHEN 'away.starters'=ANY(r.null_groups) THEN NULL ELSE (SELECT coalesce(jsonb_agg((jsonb_build_object('player_id', r1."player_id",
'name', r1."name",
'shirt_number', r1."shirt_number",
'position_id', r1."position_id",
'pitch_x', r1."pitch_x",
'pitch_y', r1."pitch_y",
'is_captain', r1."is_captain") - r1.missing) ORDER BY r1.position), '[]'::jsonb) FROM statarena_app.lineup_away_starters r1
 WHERE r1.resource_id=r.resource_id AND r1.parent_no=r.record_no) END,
'subs', CASE WHEN 'away.subs'=ANY(r.null_groups) THEN NULL ELSE (SELECT coalesce(jsonb_agg((jsonb_build_object('player_id', r1."player_id",
'name', r1."name",
'shirt_number', r1."shirt_number",
'position_id', r1."position_id",
'pitch_x', r1."pitch_x",
'pitch_y', r1."pitch_y",
'is_captain', r1."is_captain") - r1.missing) ORDER BY r1.position), '[]'::jsonb) FROM statarena_app.lineup_away_substitutes r1
 WHERE r1.resource_id=r.resource_id AND r1.parent_no=r.record_no) END) - array_remove(ARRAY[CASE WHEN 'away.formation'=ANY(r.missing) THEN 'formation' END, CASE WHEN 'away.lineup_type'=ANY(r.missing) THEN 'lineup_type' END, CASE WHEN 'away.confirmed'=ANY(r.missing) THEN 'confirmed' END, CASE WHEN 'away.coach'=ANY(r.missing) THEN 'coach' END, CASE WHEN 'away.starters'=ANY(r.missing) THEN 'starters' END, CASE WHEN 'away.subs'=ANY(r.missing) THEN 'subs' END],NULL)) END) - r.missing) FROM statarena_app.lineup_sheets r WHERE r.resource_id=rid;
$$;

-- Candidate reader sharing one member contract across both sides and roles.
CREATE OR REPLACE FUNCTION statarena_app.detail_data_lineups_unified(rid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT (jsonb_build_object('match_id', r."match_id",
'home_team', CASE WHEN 'home_team'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('id', r."home_team_id",
'name', r."home_team_name",
'image_url', r."home_team_image_url") - array_remove(ARRAY[CASE WHEN 'home_team.id'=ANY(r.missing) THEN 'id' END, CASE WHEN 'home_team.name'=ANY(r.missing) THEN 'name' END, CASE WHEN 'home_team.image_url'=ANY(r.missing) THEN 'image_url' END],NULL)) END,
'away_team', CASE WHEN 'away_team'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('id', r."away_team_id",
'name', r."away_team_name",
'image_url', r."away_team_image_url") - array_remove(ARRAY[CASE WHEN 'away_team.id'=ANY(r.missing) THEN 'id' END, CASE WHEN 'away_team.name'=ANY(r.missing) THEN 'name' END, CASE WHEN 'away_team.image_url'=ANY(r.missing) THEN 'image_url' END],NULL)) END,
'home', CASE WHEN 'home'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('formation', r."home_formation",
'lineup_type', r."home_lineup_type",
'confirmed', r."home_confirmed",
'coach', CASE WHEN 'home.coach'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('name', r."home_coach_name") - array_remove(ARRAY[CASE WHEN 'home.coach.name'=ANY(r.missing) THEN 'name' END],NULL)) END,
'starters', CASE WHEN 'home.starters'=ANY(r.null_groups) THEN NULL ELSE statarena_app.lineup_member_array(r.resource_id,r.record_no,'home','starter') END,
'subs', CASE WHEN 'home.subs'=ANY(r.null_groups) THEN NULL ELSE statarena_app.lineup_member_array(r.resource_id,r.record_no,'home','substitute') END) - array_remove(ARRAY[CASE WHEN 'home.formation'=ANY(r.missing) THEN 'formation' END, CASE WHEN 'home.lineup_type'=ANY(r.missing) THEN 'lineup_type' END, CASE WHEN 'home.confirmed'=ANY(r.missing) THEN 'confirmed' END, CASE WHEN 'home.coach'=ANY(r.missing) THEN 'coach' END, CASE WHEN 'home.starters'=ANY(r.missing) THEN 'starters' END, CASE WHEN 'home.subs'=ANY(r.missing) THEN 'subs' END],NULL)) END,
'away', CASE WHEN 'away'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('formation', r."away_formation",
'lineup_type', r."away_lineup_type",
'confirmed', r."away_confirmed",
'coach', CASE WHEN 'away.coach'=ANY(r.null_groups) THEN NULL ELSE (jsonb_build_object('name', r."away_coach_name") - array_remove(ARRAY[CASE WHEN 'away.coach.name'=ANY(r.missing) THEN 'name' END],NULL)) END,
'starters', CASE WHEN 'away.starters'=ANY(r.null_groups) THEN NULL ELSE statarena_app.lineup_member_array(r.resource_id,r.record_no,'away','starter') END,
'subs', CASE WHEN 'away.subs'=ANY(r.null_groups) THEN NULL ELSE statarena_app.lineup_member_array(r.resource_id,r.record_no,'away','substitute') END) - array_remove(ARRAY[CASE WHEN 'away.formation'=ANY(r.missing) THEN 'formation' END, CASE WHEN 'away.lineup_type'=ANY(r.missing) THEN 'lineup_type' END, CASE WHEN 'away.confirmed'=ANY(r.missing) THEN 'confirmed' END, CASE WHEN 'away.coach'=ANY(r.missing) THEN 'coach' END, CASE WHEN 'away.starters'=ANY(r.missing) THEN 'starters' END, CASE WHEN 'away.subs'=ANY(r.missing) THEN 'subs' END],NULL)) END) - r.missing) FROM statarena_app.lineup_sheets r WHERE r.resource_id=rid;
$$;
