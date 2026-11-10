"""Generate backend/sql/012_api_views.sql: the read contract of the API.

Run `PYTHONPATH=backend python -m vega.api_schema > backend/sql/012_api_views.sql` after a change;
a test fails when the committed migration drifts from this output.

Rules from the validated document: a view reads tables (never another view), keeps
season_id and indexed keys visible so filters prune partitions, and shared formulas are
SQL functions. Public identifiers are the current ones (p_, t_, l_, m_); an entity
without a PitchAPI key gets a Vega key of another length, so the two never collide.
"""

import re
from .metric_catalog import (
    PLAYER_METRICS,
    PLAYER_RATIOS,
    TEAM_BASE,
    TEAM_METRICS,
    TEAM_RATIOS,
)

PREFIX = {"player": "p", "team": "t", "competition": "l", "match": "m", "coach": "c", "referee": "r", "venue": "v"}


def _public_id_function():
    whens = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in PREFIX.items())
    return f"""
-- Public identifier: the current PitchAPI key, else a Vega key (prefix_v + 7 digits),
-- whose length differs from PitchAPI's 6 characters.
CREATE FUNCTION api.public_id(kind core.entity_type, ident integer)
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    (SELECT p.provider_key FROM core.provider_ids p
      WHERE p.entity_type = kind AND p.entity_id = ident AND p.provider = 'pitchapi' AND p.is_current),
    (CASE kind {whens} END) || '_v' || lpad(ident::text, 7, '0'))
  WHERE ident IS NOT NULL
$$;
"""


def _player_season_select(*, legacy=False):
    out = []
    for m in PLAYER_METRICS:
        if m.rule == "sum":
            out.append(f"core.per90(s.{m.key}_sum, s.{m.key}_min) AS {m.key}_p90")
        elif m.rule == "rating" and not legacy:
            out.append(f"s.{m.key}_sum / nullif(s.{m.key}_minutes, 0) AS {m.key}_avg")
        elif m.rule in ("weighted_mean", "rating"):
            out.append(f"s.{m.key}_wsum / nullif(s.{m.key}_w, 0) AS {m.key}_avg")
        elif m.rule == "match_mean":
            out.append(f"s.{m.key}_sum / nullif(s.{m.key}_n, 0) AS {m.key}_avg")
    for r in PLAYER_RATIOS:
        out.append(f"core.pct(s.{r.key}_num, s.{r.key}_den) AS {r.key}_pct")
    return ",\n  ".join(out)


def _team_per_match():
    out = []
    for side in ("for_", "against_"):
        for m in TEAM_METRICS:
            stem = side + m.key
            if m.rule == "weighted_mean":
                out.append(f"t.{stem}_wsum / nullif(t.{stem}_w, 0) AS {stem}_avg")
            elif m.rule in ("sum", "match_mean"):
                out.append(f"t.{stem}_sum / nullif(t.{stem}_n, 0)::double precision AS {stem}_pm")
        for r in TEAM_RATIOS:
            stem = side + r.key
            if r.key == "ppda":
                out.append(f"t.{stem}_num / nullif(t.{stem}_den, 0) AS {stem}")
            else:
                out.append(f"core.pct(t.{stem}_num, t.{stem}_den) AS {stem}_pct")
    return ",\n  ".join(out)


# The ~45 club indicators of the current club page (club-scout.js METRICS), by key.
CLUB_INDICATORS = {
    "ppm": "t.points::double precision / nullif(t.matches, 0)",
    "xpts_pm": "t.xpts / nullif(t.xpts_matches, 0)",
    "goals_for_pm": "t.goals_for::double precision / nullif(t.matches, 0)",
    "goals_against_pm": "t.goals_against::double precision / nullif(t.matches, 0)",
    "xg_pm": "t.for_xg_sum / nullif(t.for_xg_n, 0)",
    "npxg_pm": "t.for_npxg_sum / nullif(t.for_npxg_n, 0)",
    "xg_open_pm": "t.for_xg_open_play_sum / nullif(t.for_xg_open_play_n, 0)",
    "big_chances_pm": "t.for_big_chances_sum::double precision / nullif(t.for_big_chances_n, 0)",
    "shots_pm": "t.for_total_shots_sum::double precision / nullif(t.for_total_shots_n, 0)",
    "shots_on_target_pm": "t.for_shots_on_target_sum::double precision / nullif(t.for_shots_on_target_n, 0)",
    "xg_per_shot": "t.for_npxg_sum / nullif(t.for_total_shots_sum, 0)",
    "box_shots_pct": "core.pct(t.for_shots_inside_box_sum, t.for_total_shots_sum)",
    "touches_box_pm": "t.for_touches_opp_box_sum::double precision / nullif(t.for_touches_opp_box_n, 0)",
    "finishing_pm": "(t.has_goals_for - t.has_xg_for) / nullif(t.xpts_matches, 0)",
    "keeper_pm": "(t.keeper_xgot_against - t.keeper_goals_against) / nullif(t.keeper_matches, 0)",
    "conversion_pct": "core.pct(t.goals_for, t.for_total_shots_sum)",
    "xga_pm": "t.against_xg_sum / nullif(t.against_xg_n, 0)",
    "npxga_pm": "t.against_npxg_sum / nullif(t.against_npxg_n, 0)",
    "shots_against_pm": "t.against_total_shots_sum::double precision / nullif(t.against_total_shots_n, 0)",
    "big_chances_against_pm": "t.against_big_chances_sum::double precision / nullif(t.against_big_chances_n, 0)",
    "touches_box_against_pm": "t.against_touches_opp_box_sum::double precision / nullif(t.against_touches_opp_box_n, 0)",
    "shots_on_target_against_pm": "t.against_shots_on_target_sum::double precision / nullif(t.against_shots_on_target_n, 0)",
    "xg_open_against_pm": "t.against_xg_open_play_sum / nullif(t.against_xg_open_play_n, 0)",
    "passes_against_pm": "t.against_passes_sum::double precision / nullif(t.against_passes_n, 0)",
    "xgot_pm": "t.for_xgot_sum / nullif(t.for_xgot_n, 0)",
    "placement_pm": "t.placement_sum / nullif(t.placement_matches, 0)",
    "clean_sheets_pct": "core.pct(t.clean_sheets, t.matches)",
    "possession_pct": "t.for_possession_pct_sum / nullif(t.for_possession_pct_n, 0)",
    "passes_pm": "t.for_passes_sum::double precision / nullif(t.for_passes_n, 0)",
    "pass_accuracy_pct": "core.pct(t.for_pass_completion_num, t.for_pass_completion_den)",
    "field_tilt_pct": "core.pct(t.for_opposition_half_passes_sum, t.for_opposition_half_passes_sum + t.against_opposition_half_passes_sum)",
    "box_share_pct": "core.pct(t.for_touches_opp_box_sum, t.for_touches_opp_box_sum + t.against_touches_opp_box_sum)",
    "directness_pct": "core.pct(t.for_long_balls_accurate_sum, t.for_accurate_passes_sum)",
    "crosses_pm": "t.for_accurate_crosses_sum::double precision / nullif(t.for_accurate_crosses_n, 0)",
    "ppda_approx": "t.against_own_half_passes_sum::double precision / nullif(t.for_tackles_sum + t.for_interceptions_sum + t.for_fouls_sum, 0)",
    "def_actions_adj": "(t.for_tackles_sum + t.for_interceptions_sum)::double precision / nullif(t.for_tackles_n, 0) * 50 / nullif(100 - t.for_possession_pct_sum / nullif(t.for_possession_pct_n, 0), 0)",
    "duels_pct": "core.pct(t.for_duels_won_sum, t.for_duels_won_sum + t.against_duels_won_sum)",
    "aerials_pct": "core.pct(t.for_aerials_won_sum, t.for_aerials_won_sum + t.against_aerials_won_sum)",
    "fouls_pm": "t.for_fouls_sum::double precision / nullif(t.for_fouls_n, 0)",
    "xg_set_pm": "t.for_xg_set_play_sum / nullif(t.for_xg_set_play_n, 0)",
    "xg_set_against_pm": "t.against_xg_set_play_sum / nullif(t.against_xg_set_play_n, 0)",
    "set_share_pct": "core.pct(t.for_xg_set_play_sum, t.for_xg_sum)",
    "corners_pm": "t.for_corners_sum::double precision / nullif(t.for_corners_n, 0)",
    "corners_against_pm": "t.against_corners_sum::double precision / nullif(t.against_corners_n, 0)",
    "yellow_pm": "t.for_yellow_cards_sum::double precision / nullif(t.for_yellow_cards_n, 0)",
    "red_total": "t.for_red_cards_sum",
}


def _team_columns(alias, prefix):
    cols = [m.column for m in TEAM_METRICS if m.table == TEAM_BASE]
    return ", ".join(f"{alias}.{c} AS {prefix}{c}" for c in cols)


STATIC = """
CREATE VIEW api.versions AS
SELECT resource_kind::text AS resource_kind, resource_id, version, facts_revision, published_at
FROM ops.resource_versions;

CREATE VIEW api.catalog AS
SELECT cs.id AS competition_season_id, api.public_id('competition', c.id) AS competition_public_id,
  c.id AS competition_id, c.name, c.country_code, c.kind::text AS kind, c.tier, c.calendar_year,
  la.s3_key AS logo_key, cs.season_id, s.label AS season, cs.native_label, cs.is_current,
  x.matches, x.finished, x.upcoming, x.first_kickoff, x.last_kickoff,
  x.with_events, x.with_shots, x.with_player_stats, x.with_advanced
FROM core.competition_seasons cs
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.seasons s ON s.id = cs.season_id
LEFT JOIN core.assets la ON la.id = c.logo_asset_id
CROSS JOIN LATERAL (
  SELECT count(*) AS matches, count(*) FILTER (WHERE m.status = 'finished') AS finished,
    count(*) FILTER (WHERE m.status = 'not_started') AS upcoming,
    min(m.kickoff_at) AS first_kickoff, max(m.kickoff_at) AS last_kickoff,
    count(*) FILTER (WHERE mc.events = 'ok') AS with_events,
    count(*) FILTER (WHERE mc.shots = 'ok') AS with_shots,
    count(*) FILTER (WHERE mc.player_stats = 'ok') AS with_player_stats,
    count(*) FILTER (WHERE mc.advanced = 'ok') AS with_advanced
  FROM core.matches m
  LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id
  WHERE m.competition_season_id = cs.id
) x;

CREATE VIEW api.search AS
SELECT n.entity_type::text AS entity_type, n.entity_id, api.public_id(n.entity_type, n.entity_id) AS public_id,
  n.name, n.normalized, n.kind::text AS name_kind
FROM core.entity_names n
UNION ALL
SELECT 'player', p.id, api.public_id('player', p.id), p.name, lower(p.name), 'official'
FROM core.players p WHERE p.name IS NOT NULL
UNION ALL
SELECT 'team', t.id, api.public_id('team', t.id), t.name, lower(t.name), 'official' FROM core.teams t
UNION ALL
SELECT 'competition', c.id, api.public_id('competition', c.id), c.name, lower(c.name), 'official'
FROM core.competitions c;

CREATE VIEW api.players AS
SELECT p.id AS player_id, api.public_id('player', p.id) AS public_id, p.name, p.short_name,
  p.shirt_number, p.position_id, p.country_code, ph.s3_key AS photo_key, p.birth_date,
  core.age_on(p.birth_date, current_date) AS age, p.height_cm, p.weight_kg, p.preferred_foot::text AS preferred_foot,
  last.team_id AS last_observed_team_id, api.public_id('team', last.team_id) AS last_observed_team_public_id,
  last.kickoff_at AS last_observed_at
FROM core.players p
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN LATERAL (
  -- Last observed club: the latest club match played, never a national team.
  SELECT s.team_id, m.kickoff_at
  FROM core.player_match_stats s
  JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
  JOIN core.teams t ON t.id = s.team_id AND t.is_national IS NOT TRUE
  WHERE s.player_id = p.id AND s.minutes_played > 0
  ORDER BY m.kickoff_at DESC NULLS LAST, m.id DESC LIMIT 1
) last ON true;

CREATE VIEW api.teams AS
SELECT t.id AS team_id, api.public_id('team', t.id) AS public_id, t.name, t.short_name, t.country_code,
  t.is_national, cr.s3_key AS crest_key, t.founded_year,
  v.id AS venue_id, v.name AS venue_name, v.commercial_name AS venue_commercial_name, v.city AS venue_city,
  v.capacity AS venue_capacity, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
  coalesce(tenure.coach_id, seen.coach_id) AS coach_id, co.name AS coach_name, cp.s3_key AS coach_photo_key,
  cp.author AS coach_photo_author, cp.license AS coach_photo_license, cp.source_page_url AS coach_photo_source,
  (tenure.coach_id IS NULL AND seen.coach_id IS NOT NULL) AS coach_observed_only, seen.kickoff_at AS coach_observed_at,
  uefa.position AS uefa_position, uefa.points AS uefa_points, uefa.label AS uefa_edition
FROM core.teams t
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.venues v ON v.id = t.home_venue_id
LEFT JOIN LATERAL (
  SELECT k.coach_id FROM core.team_coach_tenures k
  WHERE k.team_id = t.id AND k.end_date IS NULL ORDER BY k.start_date DESC LIMIT 1
) tenure ON true
LEFT JOIN LATERAL (
  SELECT l.coach_id, m.kickoff_at FROM core.lineups l
  JOIN core.matches m ON m.id = l.match_id AND m.season_id = l.season_id
  WHERE l.team_id = t.id AND l.coach_id IS NOT NULL ORDER BY m.kickoff_at DESC NULLS LAST LIMIT 1
) seen ON true
LEFT JOIN core.coaches co ON co.id = coalesce(tenure.coach_id, seen.coach_id)
LEFT JOIN core.assets cp ON cp.id = co.photo_asset_id
LEFT JOIN LATERAL (
  SELECT r.position, r.points, e.label FROM core.ranking_rows r
  JOIN core.ranking_editions e ON e.id = r.edition_id AND e.kind = 'uefa_clubs'
  WHERE r.team_id = t.id ORDER BY e.is_current DESC, e.published_on DESC NULLS LAST, e.id DESC LIMIT 1
) uefa ON true;

CREATE VIEW api.match_list AS
SELECT m.id AS match_id, api.public_id('match', m.id) AS public_id, m.season_id, m.competition_season_id,
  cs.competition_id, api.public_id('competition', cs.competition_id) AS competition_public_id, c.name AS competition_name,
  m.round_id, r.name AS round_name, r.stage::text AS stage, m.group_name, m.leg,
  m.kickoff_at, m.match_date, m.status::text AS status,
  m.home_team_id, api.public_id('team', m.home_team_id) AS home_public_id, ht.name AS home_name, hc.s3_key AS home_crest_key,
  m.away_team_id, api.public_id('team', m.away_team_id) AS away_public_id, awt.name AS away_name, ac.s3_key AS away_crest_key,
  m.home_score, m.away_score, m.home_score_ht, m.away_score_ht, m.home_score_et, m.away_score_et,
  m.home_penalty_score, m.away_penalty_score, m.attendance, m.note,
  v.name AS venue_name, ref.name AS referee_name, m.source::text AS source, m.revision, m.first_finished_at,
  mc.shots::text AS shots_coverage, mc.events::text AS events_coverage, mc.lineups::text AS lineups_coverage,
  mc.team_stats::text AS team_stats_coverage, mc.player_stats::text AS player_stats_coverage,
  mc.advanced::text AS advanced_coverage, mc.heatmaps::text AS heatmaps_coverage
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.rounds r ON r.id = m.round_id
LEFT JOIN core.teams ht ON ht.id = m.home_team_id
LEFT JOIN core.teams awt ON awt.id = m.away_team_id
LEFT JOIN core.assets hc ON hc.id = ht.crest_asset_id
LEFT JOIN core.assets ac ON ac.id = awt.crest_asset_id
LEFT JOIN core.venues v ON v.id = m.venue_id
LEFT JOIN core.referees ref ON ref.id = m.referee_id
LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id;

CREATE VIEW api.match_goals AS
SELECT e.season_id, e.match_id, e.seq, e.minute, e.minute_added, e.period::text AS period, e.team_id,
  e.player_id, api.public_id('player', e.player_id) AS player_public_id, coalesce(p.name, e.player_name) AS scorer,
  e.is_own_goal, e.is_penalty, e.score_home, e.score_away
FROM core.match_events e
LEFT JOIN core.players p ON p.id = e.player_id
WHERE e.event_type = 'goal' AND e.period IS DISTINCT FROM 'penalties';

CREATE VIEW api.match_xpts AS
SELECT o.season_id, o.match_id, o.team_id, p.team_id AS opponent_id, o.xg, p.xg AS xg_against,
  (agg.xpts_v1(o.xg, p.xg)).p_win, (agg.xpts_v1(o.xg, p.xg)).p_draw,
  (agg.xpts_v1(o.xg, p.xg)).p_loss, (agg.xpts_v1(o.xg, p.xg)).xpts
FROM core.team_match_stats o
JOIN core.team_match_stats p ON p.season_id = o.season_id AND p.match_id = o.match_id
  AND p.period = o.period AND p.team_id <> o.team_id
WHERE o.period = 'all';

CREATE VIEW api.cup_ties AS
WITH legs AS (
  SELECT m.competition_season_id, m.round_id, least(m.home_team_id, m.away_team_id) AS team_a,
    greatest(m.home_team_id, m.away_team_id) AS team_b, m.id, m.leg, m.kickoff_at, m.status,
    CASE WHEN m.home_team_id < m.away_team_id THEN coalesce(m.home_score_et, m.home_score) ELSE coalesce(m.away_score_et, m.away_score) END AS goals_a,
    CASE WHEN m.home_team_id < m.away_team_id THEN coalesce(m.away_score_et, m.away_score) ELSE coalesce(m.home_score_et, m.home_score) END AS goals_b,
    CASE WHEN m.home_team_id < m.away_team_id THEN m.home_penalty_score ELSE m.away_penalty_score END AS pens_a,
    CASE WHEN m.home_team_id < m.away_team_id THEN m.away_penalty_score ELSE m.home_penalty_score END AS pens_b
  FROM core.matches m
  JOIN core.rounds r ON r.id = m.round_id AND r.stage IN ('knockout', 'final', 'playoff', 'qualifying')
  WHERE m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
), ties AS (
  SELECT competition_season_id, round_id, team_a, team_b, count(*) AS legs,
    count(*) FILTER (WHERE status = 'finished') AS legs_played,
    sum(goals_a) FILTER (WHERE status = 'finished') AS goals_a, sum(goals_b) FILTER (WHERE status = 'finished') AS goals_b,
    (array_agg(pens_a ORDER BY kickoff_at DESC NULLS LAST))[1] AS pens_a,
    (array_agg(pens_b ORDER BY kickoff_at DESC NULLS LAST))[1] AS pens_b,
    min(kickoff_at) AS first_kickoff, max(kickoff_at) AS last_kickoff
  FROM legs GROUP BY competition_season_id, round_id, team_a, team_b
)
SELECT t.*, api.public_id('team', t.team_a) AS team_a_public_id, api.public_id('team', t.team_b) AS team_b_public_id,
  CASE WHEN t.legs_played < t.legs THEN NULL
       WHEN t.goals_a <> t.goals_b THEN CASE WHEN t.goals_a > t.goals_b THEN t.team_a ELSE t.team_b END
       WHEN t.pens_a IS NOT NULL AND t.pens_b IS NOT NULL AND t.pens_a <> t.pens_b
         THEN CASE WHEN t.pens_a > t.pens_b THEN t.team_a ELSE t.team_b END END AS winner_team_id,
  CASE WHEN t.legs_played < t.legs THEN 'pending'
       WHEN t.goals_a <> t.goals_b THEN 'score'
       WHEN t.pens_a IS NOT NULL THEN 'penalties' ELSE 'undecided' END AS decided_by
FROM ties t;

CREATE VIEW api.matchdays AS
SELECT r.id AS round_id, r.competition_season_id, r.name, r.stage::text AS stage, r.seq,
  min(m.kickoff_at) AS starts_at, max(m.kickoff_at) AS ends_at, count(m.id) AS matches,
  count(m.id) FILTER (WHERE m.status = 'finished') AS finished,
  count(m.id) FILTER (WHERE m.status = 'not_started') AS upcoming
FROM core.rounds r
LEFT JOIN core.matches m ON m.round_id = r.id
GROUP BY r.id;

CREATE VIEW api.standings AS
WITH official AS (
  -- The latest observation of one source per edition, phase and group.
  SELECT DISTINCT ON (o.competition_season_id, o.stage, o.group_name, o.team_id)
    o.competition_season_id, o.stage, o.group_name, o.team_id, o.position, o.played, o.won, o.drawn,
    o.lost, o.goals_for, o.goals_against, o.points, o.source::text AS source, o.as_of
  FROM core.standings_official o
  ORDER BY o.competition_season_id, o.stage, o.group_name, o.team_id, o.as_of DESC NULLS LAST, o.source
), merged AS (
  SELECT * FROM official
  UNION ALL
  SELECT a.competition_season_id, a.stage, a.group_name, a.team_id, a.position, a.played, a.won, a.drawn,
    a.lost, a.goals_for, a.goals_against, a.points, 'vega', a.updated_at
  FROM agg.standings a
  WHERE NOT EXISTS (SELECT 1 FROM core.standings_official o WHERE o.competition_season_id = a.competition_season_id)
)
SELECT merged.*, api.public_id('team', merged.team_id) AS team_public_id, t.name AS team_name,
  cr.s3_key AS crest_key, z.zone::text AS zone
FROM merged
JOIN core.teams t ON t.id = merged.team_id
LEFT JOIN core.assets cr ON cr.id = t.crest_asset_id
LEFT JOIN core.competition_zones z ON z.competition_season_id = merged.competition_season_id
  AND merged.position BETWEEN z.position_from AND z.position_to AND merged.group_name IS NULL;

CREATE VIEW api.player_match_log AS
SELECT s.season_id, s.match_id, api.public_id('match', s.match_id) AS match_public_id, m.competition_season_id,
  m.kickoff_at, s.player_id, s.team_id,
  CASE WHEN m.home_team_id = s.team_id THEN m.away_team_id ELSE m.home_team_id END AS opponent_id,
  (m.home_team_id = s.team_id) AS is_home,
  CASE WHEN m.home_team_id = s.team_id THEN m.home_score ELSE m.away_score END AS goals_for,
  CASE WHEN m.home_team_id = s.team_id THEN m.away_score ELSE m.home_score END AS goals_against,
  lp.is_starter, s.minutes_played, s.rating, s.goals, s.assists, s.xg, s.xa, s.total_shots,
  core.pct(s.accurate_passes, s.accurate_passes_total) AS pass_completion_pct
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id;

CREATE VIEW api.player_positions AS
SELECT lp.player_id, m.competition_season_id, m.season_id, fs.position_code,
  count(*) AS matches, count(*) FILTER (WHERE lp.is_starter) AS starts,
  coalesce(sum(s.minutes_played), 0) AS minutes
FROM core.lineup_players lp
JOIN core.lineups l ON l.season_id = lp.season_id AND l.match_id = lp.match_id AND l.team_id = lp.team_id
JOIN core.formation_slots fs ON fs.formation = l.formation AND fs.position_id = lp.position_id
JOIN core.matches m ON m.id = lp.match_id AND m.season_id = lp.season_id
LEFT JOIN core.player_match_stats s ON s.season_id = lp.season_id AND s.match_id = lp.match_id AND s.player_id = lp.player_id
GROUP BY lp.player_id, m.competition_season_id, m.season_id, fs.position_code;

CREATE VIEW api.player_season_heatmap AS
WITH cells AS (
  SELECT h.player_id, m.competition_season_id, h.season_id, u.idx, sum(u.v) AS v, count(DISTINCT h.match_id) AS matches
  FROM core.player_heatmaps h
  JOIN core.matches m ON m.id = h.match_id AND m.season_id = h.season_id
  CROSS JOIN LATERAL unnest(h.cells) WITH ORDINALITY AS u(v, idx)
  GROUP BY h.player_id, m.competition_season_id, h.season_id, u.idx
)
SELECT player_id, competition_season_id, season_id, max(matches) AS matches,
  array_agg(v::integer ORDER BY idx) AS cells
FROM cells GROUP BY player_id, competition_season_id, season_id;

CREATE VIEW api.team_shot_situations AS
WITH own AS (
  SELECT s.season_id, m.competition_season_id, s.team_id, 'for' AS side, s.situation::text AS situation,
    count(*) AS shots, sum(s.xg) AS xg, count(*) FILTER (WHERE s.outcome = 'goal') AS goals
  FROM core.shots s JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
  WHERE s.is_own_goal IS NOT TRUE
  GROUP BY s.season_id, m.competition_season_id, s.team_id, s.situation
), conceded AS (
  SELECT s.season_id, m.competition_season_id,
    CASE WHEN s.team_id = m.home_team_id THEN m.away_team_id ELSE m.home_team_id END AS team_id,
    'against' AS side, s.situation::text AS situation,
    count(*) AS shots, sum(s.xg) AS xg, count(*) FILTER (WHERE s.outcome = 'goal') AS goals
  FROM core.shots s JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
  WHERE s.is_own_goal IS NOT TRUE
  GROUP BY s.season_id, m.competition_season_id, 3, s.situation
)
SELECT * FROM own UNION ALL SELECT * FROM conceded;

CREATE VIEW api.team_squad AS
SELECT s.team_id, s.competition_season_id, s.season_id, s.player_id, api.public_id('player', s.player_id) AS player_public_id,
  p.name, core.age_on(p.birth_date, current_date) AS age, s.appearances, s.starts, s.minutes,
  core.pct(s.minutes, 90 * t.matches) AS minutes_share_pct,
  s.goals_sum AS goals, s.assists_sum AS assists, s.xg_sum AS xg, s.xa_sum AS xa,
  s.rating_wsum / nullif(s.rating_w, 0) AS rating
FROM agg.player_season_stats s
JOIN core.players p ON p.id = s.player_id
LEFT JOIN agg.team_season_stats t ON t.team_id = s.team_id AND t.competition_season_id = s.competition_season_id;

CREATE VIEW api.rankings AS
SELECT e.kind::text AS kind, e.provider::text AS provider, e.label, e.period, e.published_on, e.is_current,
  r.row_no, r.position, r.previous_position, r.position - r.previous_position AS position_change, r.points,
  r.team_id, api.public_id('team', r.team_id) AS team_public_id, t.name AS team_name, r.country_code
FROM core.ranking_editions e
JOIN core.ranking_rows r ON r.edition_id = e.id
LEFT JOIN core.teams t ON t.id = r.team_id
WHERE e.id = (SELECT e2.id FROM core.ranking_editions e2 WHERE e2.kind = e.kind AND e2.provider = e.provider
              ORDER BY e2.is_current DESC, e2.published_on DESC NULLS LAST, e2.id DESC LIMIT 1);

-- Operations: freshness of scores and families, collection backlog, coverage gaps.
CREATE VIEW ops.v_freshness AS
SELECT m.id AS match_id, m.kickoff_at, m.first_finished_at,
  m.first_finished_at - m.kickoff_at AS kickoff_to_score,
  max(f.last_success_at) AS last_family_at, max(f.last_success_at) - m.first_finished_at AS score_to_details,
  w.state::text AS watch_state, w.checks
FROM core.matches m
LEFT JOIN ops.family_state f ON f.match_id = m.id
LEFT JOIN ops.match_watch w ON w.match_id = m.id
WHERE m.first_finished_at IS NOT NULL
GROUP BY m.id, w.state, w.checks;

CREATE VIEW ops.v_backlog AS
SELECT lane::text AS lane, family::text AS family, state::text AS state, count(*) AS jobs,
  min(run_after) AS oldest_run_after, now() - min(run_after) AS oldest_age
FROM ops.fetch_jobs WHERE state <> 'done'
GROUP BY lane, family, state;

CREATE VIEW ops.v_coverage_gaps AS
SELECT m.id AS match_id, m.season_id, m.kickoff_at, m.first_finished_at, c.shots, c.events, c.lineups,
  c.momentum, c.team_stats, c.player_stats, c.player_halves, c.advanced, c.advanced_players, c.network, c.heatmaps, c.h2h
FROM core.matches m
JOIN core.match_coverage c ON c.season_id = m.season_id AND c.match_id = m.id
WHERE m.status = 'finished' AND m.first_finished_at < now() - interval '24 hours'
  AND ('pending' IN (c.shots::text, c.events::text, c.lineups::text, c.team_stats::text, c.player_stats::text,
                    c.player_halves::text, c.advanced::text, c.advanced_players::text, c.network::text, c.heatmaps::text)
   OR 'error' IN (c.shots::text, c.events::text, c.lineups::text, c.team_stats::text, c.player_stats::text,
                  c.player_halves::text, c.advanced::text, c.advanced_players::text, c.network::text, c.heatmaps::text));
"""


def migration_sql():
    match_team_sides = f"""
CREATE VIEW api.match_team_sides AS
SELECT o.season_id, o.match_id, o.team_id, p.team_id AS opponent_id, o.period::text AS period,
  {_team_columns("o", "for_")},
  {_team_columns("p", "against_")},
  core.pct(o.accurate_passes, o.passes) AS for_pass_completion_pct,
  core.pct(p.accurate_passes, p.passes) AS against_pass_completion_pct
FROM core.team_match_stats o
JOIN core.team_match_stats p ON p.season_id = o.season_id AND p.match_id = o.match_id
  AND p.period = o.period AND p.team_id <> o.team_id;
"""
    match_player_stats = """
CREATE VIEW api.match_player_stats AS
SELECT s.*, api.public_id('player', s.player_id) AS player_public_id, p.name AS player_name,
  core.pct(s.accurate_passes, s.accurate_passes_total) AS pass_completion_pct,
  core.pct(s.duels_won, s.duels_won + s.duels_lost) AS duel_success_pct,
  core.pct(s.aerials_won, s.aerials_total) AS aerial_success_pct,
  core.pct(s.dribbles_succeeded, s.dribbles_total) AS dribble_success_pct,
  rank() OVER (PARTITION BY s.season_id, s.match_id ORDER BY s.rating DESC NULLS LAST) AS rating_rank,
  count(s.rating) OVER (PARTITION BY s.season_id, s.match_id) AS rated_players,
  a.xt_total AS adv_xt_total, a.progressive_passes AS adv_progressive_passes,
  a.progressive_carries AS adv_progressive_carries, a.sca AS adv_sca, a.gca AS adv_gca,
  a.xg_chain AS adv_xg_chain, a.xg_buildup AS adv_xg_buildup
FROM core.player_match_stats s
JOIN core.players p ON p.id = s.player_id
LEFT JOIN core.player_match_advanced a ON a.season_id = s.season_id AND a.match_id = s.match_id AND a.player_id = s.player_id;
"""
    player_season = _player_season_view(legacy=True)
    indicators = ",\n  ".join(f"{expr} AS {key}" for key, expr in CLUB_INDICATORS.items())
    team_season = f"""
CREATE VIEW api.team_season AS
SELECT t.*, api.public_id('team', t.team_id) AS team_public_id, tm.name AS team_name,
  {indicators},
  {_team_per_match()}
FROM agg.team_season_stats t
JOIN core.teams tm ON tm.id = t.team_id;
"""
    return (
        "-- GENERATED by `python -m vega_v2.api_schema` from vega_v2/api_schema.py: do not edit.\n"
        + _public_id_function()
        + STATIC
        + match_team_sides
        + match_player_stats
        + player_season
        + team_season
    )


def _player_season_view(*, legacy=False):
    return f"""
CREATE VIEW api.player_season AS
SELECT s.*, api.public_id('player', s.player_id) AS player_public_id, p.name AS player_name,
  core.age_on(p.birth_date, current_date) AS age,
  {_player_season_select(legacy=legacy)}
FROM agg.player_season_stats s
JOIN core.players p ON p.id = s.player_id;
"""


def rating_rename_sql():
    """Migration 049: the rating as the doc names it (rating_sum real, rating_minutes
    integer). The three views over those columns are dropped and created again on the
    new names; the others are unchanged."""
    squad = re.search(r"\nCREATE VIEW api\.team_squad AS.*?;\n", STATIC, re.S).group(0)
    old = "s.rating_wsum / nullif(s.rating_w, 0) AS rating"
    assert old in squad
    return (
        "-- GENERATED by `python -m vega_v2.api_schema rating` from vega_v2/api_schema.py: do not edit.\n"
        "-- agg.player_season_stats stores the minutes-weighted rating as the doc names it:\n"
        "-- rating_sum (rating x minutes of rated matches) and rating_minutes (those minutes).\n"
        "DROP VIEW api.home_season_players;\n"
        "DROP VIEW api.team_squad;\n"
        "DROP VIEW api.player_season;\n"
        "ALTER TABLE agg.player_season_stats RENAME COLUMN rating_wsum TO rating_sum;\n"
        "ALTER TABLE agg.player_season_stats RENAME COLUMN rating_w TO rating_minutes;\n"
        "ALTER TABLE agg.player_season_stats ALTER COLUMN rating_minutes TYPE integer USING round(rating_minutes)::integer;\n"
        + _player_season_view()
        + squad.replace(old, "s.rating_sum / nullif(s.rating_minutes, 0) AS rating")
        + """
CREATE VIEW api.home_season_players AS
SELECT s.competition_season_id, s.season_id, s.player_id, s.team_id, s.appearances, s.minutes,
  coalesce(s.goals_sum, 0) AS goals, coalesce(s.assists_sum, 0) AS assists,
  s.xg_sum AS xg, coalesce(s.xg_n, 0) AS xg_matches, s.xa_sum AS xa, coalesce(s.xa_n, 0) AS xa_matches,
  coalesce(s.rating_sum, 0) AS rating_sum, coalesce(s.rating_minutes, 0) AS rating_minutes
FROM agg.player_season_stats s;
"""
    )


if __name__ == "__main__":
    import sys

    print(rating_rename_sql() if sys.argv[1:] == ["rating"] else migration_sql(), end="")
