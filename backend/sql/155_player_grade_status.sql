-- Why a participation has a Vega match grade or not, by key (VI-21, E04l; docs/calculs/09-audit-2026-11/FAILURE_MODES.md
-- §38). The players' run (vega/power.py, refresh_players) records the player-matches of the award year it read and could
-- not grade: a statistics row whose team is neither side of its match (it joined both sides as « opponent » and stopped
-- the publication on 23505), and a player-match left without a role. Its rows are replaced with the year's run.
SET LOCAL lock_timeout = '3s';

CREATE TABLE agg.player_grade_exclusions (
  season_id smallint NOT NULL,
  match_id integer NOT NULL,
  player_id integer NOT NULL,
  award_season smallint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('team_not_in_match', 'role_undetermined')),
  run_id integer NOT NULL REFERENCES agg.power_runs,
  PRIMARY KEY (season_id, match_id, player_id)
);
CREATE INDEX player_grade_exclusions_award ON agg.player_grade_exclusions (award_season);
GRANT SELECT, INSERT, UPDATE, DELETE ON agg.player_grade_exclusions TO vega_calc;

-- One row per participation key of the statistics or the line-ups (internal ids, the edition's season), its award
-- year (1 August – 31 July of the match date) and the first status that applies. graded / below_display_threshold: a
-- grade exists and the readers' one rule (from 20 minutes, or |z| >= 1) shows or hides it. Then why none exists: an
-- edition the run does not read (archive or cup), a match not finished, no statistics row (the match's player
-- statistics not collected) or none while they are (not played), 0 minutes, no minutes, a team that is not a side of
-- the match, a date or an edition outside the award year's read, the run's recorded reason, no contribution (the
-- role's inputs missing), no reference for the role, no published run of the award year, or a row newer than the run.
CREATE VIEW api.player_grade_status AS
SELECT k.season_id, k.match_id, k.player_id, y.award_season,
  CASE
    WHEN g.player_id IS NOT NULL THEN CASE WHEN g.minutes >= 20 OR abs(g.z) >= 1 THEN 'graded' ELSE 'below_display_threshold' END
    WHEN cs.archive_key IS NOT NULL OR cs.cup_key IS NOT NULL THEN 'competition_not_admitted'
    WHEN m.status <> 'finished' THEN 'match_not_finished'
    WHEN s.player_id IS NULL THEN CASE WHEN mc.player_stats = 'ok' THEN 'not_played' ELSE 'no_statistics' END
    WHEN s.minutes_played IS NULL THEN 'no_minutes'
    WHEN s.minutes_played <= 0 THEN 'not_played'
    WHEN s.team_id IS NULL OR s.team_id NOT IN (m.home_team_id, m.away_team_id) THEN 'team_not_in_match'
    WHEN y.award_season IS NULL OR k.season_id NOT IN (y.award_season, y.award_season + 1) THEN 'outside_award_window'
    WHEN x.reason IS NOT NULL THEN x.reason
    WHEN p.player_id IS NOT NULL AND p.contribution IS NULL THEN 'missing_inputs'
    WHEN p.player_id IS NOT NULL AND p.match_index IS NULL THEN 'no_reference'
    WHEN NOT EXISTS (SELECT 1 FROM agg.power_runs r WHERE r.kind = 'players' AND r.season_id = y.award_season AND r.status = 'published')
      THEN 'award_year_not_computed'
    ELSE 'pending'
  END AS grade_status
FROM (SELECT season_id, match_id, player_id FROM core.player_match_stats
      UNION ALL
      SELECT l.season_id, l.match_id, l.player_id FROM core.lineup_players l
      WHERE NOT EXISTS (SELECT 1 FROM core.player_match_stats x
                        WHERE x.season_id = l.season_id AND x.match_id = l.match_id AND x.player_id = l.player_id)) k
JOIN core.matches m ON m.id = k.match_id AND m.season_id = k.season_id
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
CROSS JOIN LATERAL (SELECT extract(year FROM m.match_date - interval '7 months')::smallint AS award_season) y
LEFT JOIN core.player_match_stats s ON s.season_id = k.season_id AND s.match_id = k.match_id AND s.player_id = k.player_id
LEFT JOIN core.match_coverage mc ON mc.season_id = k.season_id AND mc.match_id = k.match_id
LEFT JOIN agg.player_match_grades g ON g.season_id = k.season_id AND g.match_id = k.match_id AND g.player_id = k.player_id
LEFT JOIN agg.player_grade_exclusions x ON x.season_id = k.season_id AND x.match_id = k.match_id AND x.player_id = k.player_id
LEFT JOIN agg.player_power_matches p ON p.season_id = y.award_season AND p.match_id = k.match_id AND p.player_id = k.player_id;
GRANT SELECT ON api.player_grade_status TO vega_read;
