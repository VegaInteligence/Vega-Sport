-- 26 Nov 2026 (FAILURE_MODES.md § 79, GitHub #252; hugo: « je veux pas qu'on les enlève de la page d'un match pour
-- savoir quels joueurs étaient suspendus ou blessés pendant ce match »): each side's absent players on a match's day,
-- for the « Absents » card of a match that has kicked off (GET /api/matches/{id}/absences). The episodes are those 160
-- and 174 keep and never delete (core.player_injuries, core.player_suspensions), read as of the match day instead of
-- today. Additive: two views and their read grant; nothing is written, no table or column changes, api.team_absences
-- (the card before the kick-off) is untouched.
-- vega:online
SET LOCAL lock_timeout = '3s';

-- A match's sides on its day (79.2, 79.3): one row per member. A club linked to Transfermarkt: its squad of the match's
-- season when the base holds one, else the season before's (a calendar-year league is the provider's year before; the
-- reader queues both, vega/transfermarkt.py), its members not marked gone on or before the day nor, by their dated
-- moves, at another club that day (an arrival after the match, a move away before it). A national team not
-- linked: the players its page shows (api.nation_players, 119), each by his usual Transfermarkt link (as 174). A member
-- is read when his injuries' accepted read is no older than 45 days before the day. day: the match's date, else its
-- kick-off's UTC day.
CREATE VIEW api.match_absence_players AS
WITH settings AS (SELECT 45 AS fresh_days)
SELECT m.id AS match_key, m.day, s.side, s.team_key, q.is_national, q.provider_key, q.player_key,
  api.public_id('player', q.player_key) AS player_id, p.name, ph.source_url AS image_url, w.role,
  ri.read_at AS injuries_read_at, rs.read_at AS suspensions_read_at,
  (q.player_key IS NOT NULL AND ri.read_at::date >= m.day - st.fresh_days) IS TRUE AS is_read
FROM (SELECT mm.id, mm.season_id, coalesce(mm.match_date, (mm.kickoff_at AT TIME ZONE 'UTC')::date) AS day, mm.home_team_id,
        mm.away_team_id
      FROM core.matches mm) m
CROSS JOIN settings st
CROSS JOIN LATERAL (VALUES ('home'::text, m.home_team_id), ('away'::text, m.away_team_id)) s(side, team_key)
CROSS JOIN LATERAL (
  SELECT false AS is_national, q.player_key AS provider_key, l.player_key
  FROM core.provider_ids i
  CROSS JOIN LATERAL (
    SELECT max(y.season_year) AS season_year FROM core.provider_squads y
    WHERE y.provider = 'transfermarkt' AND y.club_key = i.provider_key AND y.season_year IN (m.season_id, m.season_id - 1)
      AND (y.absent_since IS NULL OR y.absent_since > m.day)
  ) c
  JOIN core.provider_squads q ON q.provider = 'transfermarkt' AND q.club_key = i.provider_key AND q.season_year = c.season_year
    AND (q.absent_since IS NULL OR q.absent_since > m.day)
  LEFT JOIN LATERAL (
    SELECT j.entity_id AS player_key FROM core.provider_ids j
    WHERE j.entity_type = 'player' AND j.provider = 'transfermarkt' AND j.provider_key = q.player_key AND j.is_current
      AND NOT EXISTS (SELECT 1 FROM ops.provider_links k WHERE k.entity_type = 'player' AND k.provider = 'transfermarkt'
                      AND k.provider_key = q.player_key AND k.quarantined_at IS NOT NULL)
  ) l ON true
  WHERE i.entity_type = 'team' AND i.provider = 'transfermarkt' AND i.is_current AND i.entity_id = s.team_key
    AND NOT EXISTS (SELECT 1 FROM ops.provider_links k WHERE k.entity_type = 'team' AND k.provider = 'transfermarkt'
                    AND k.provider_key = i.provider_key AND k.quarantined_at IS NOT NULL)
    -- The season's squad is not membership on every day of it (79.2): by his dated moves (core.player_transfers, not
    -- pending, still listed), a player whose last move on or before the day took him to another of our clubs, or who
    -- moved to this club only after the day, was not one of its members that day. A move to a club the base does not
    -- know (to_team_id empty) proves nothing; a player without a known move stays a member.
    AND NOT EXISTS (
      SELECT 1 FROM (SELECT x.to_team_id FROM core.player_transfers x
                     WHERE x.player_id = l.player_key AND x.source = 'transfermarkt' AND NOT x.pending AND x.absent_since IS NULL
                       AND x.transfer_date <= m.day
                     ORDER BY x.transfer_date DESC, x.id DESC LIMIT 1) last
      WHERE last.to_team_id IS NOT NULL AND last.to_team_id <> s.team_key)
    AND NOT (
      EXISTS (SELECT 1 FROM core.player_transfers x
              WHERE x.player_id = l.player_key AND x.source = 'transfermarkt' AND NOT x.pending AND x.absent_since IS NULL
                AND x.to_team_id = s.team_key AND x.transfer_date > m.day)
      AND NOT EXISTS (SELECT 1 FROM core.player_transfers x
                      WHERE x.player_id = l.player_key AND x.source = 'transfermarkt' AND NOT x.pending AND x.absent_since IS NULL
                        AND x.to_team_id = s.team_key AND x.transfer_date <= m.day))
  UNION ALL
  SELECT true, k.provider_key, CASE WHEN k.provider_key IS NOT NULL THEN n.player_key END
  FROM core.teams t
  CROSS JOIN LATERAL (SELECT DISTINCT api.internal_id('player', np.player_id) AS player_key FROM api.nation_players(t.id) np) n
  LEFT JOIN LATERAL (
    SELECT j.provider_key FROM core.provider_ids j
    WHERE j.entity_type = 'player' AND j.provider = 'transfermarkt' AND j.entity_id = n.player_key AND j.is_current
      AND NOT EXISTS (SELECT 1 FROM ops.provider_links x WHERE x.entity_type = 'player' AND x.provider = 'transfermarkt'
                      AND x.provider_key = j.provider_key AND x.quarantined_at IS NOT NULL)
    LIMIT 1
  ) k ON true
  WHERE t.id = s.team_key AND t.is_national IS TRUE
    AND NOT EXISTS (SELECT 1 FROM core.provider_ids j WHERE j.entity_type = 'team' AND j.provider = 'transfermarkt'
                    AND j.entity_id = t.id AND j.is_current)
) q
LEFT JOIN core.players p ON p.id = q.player_key
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
LEFT JOIN LATERAL (SELECT w.role FROM agg.player_power w WHERE w.player_id = q.player_key ORDER BY w.season_id DESC LIMIT 1) w ON true
LEFT JOIN ops.transfermarkt_reads ri ON q.player_key IS NOT NULL AND ri.kind = 'injuries' AND ri.provider_key = q.provider_key
  AND ri.read_at IS NOT NULL
LEFT JOIN ops.transfermarkt_reads rs ON q.player_key IS NOT NULL AND rs.kind = 'suspensions' AND rs.provider_key = q.provider_key
  AND rs.read_at IS NOT NULL;

-- The episodes that kept a member out on the match day (79.4, 79.5), one row per episode:
-- - an injury, an illness or an unclassified one: started on the day or before, not marked absent_since, its end on the
--   day or later; with no end, only while his injuries were read no more than 45 days before the day (as 174 before
--   the kick-off) and he played no match after its start and before the day;
-- - a suspension (clubs only, as 174): of the match's own competition, started on the day or before, its end on the day
--   or later, or with no end while his suspensions were read no more than 45 days before the day;
-- - never a player named on the match's sheet or who played in it.
CREATE VIEW api.match_absences AS
WITH settings AS (SELECT 45 AS fresh_days)
SELECT s.match_key, s.day, s.side, s.team_key, s.player_key, s.player_id, s.name, s.image_url, s.role, e.kind, e.label,
  e.start_date, e.end_date, e.matches_missed, e.competition_code, e.competition_id, e.competition_name, e.read_on
FROM api.match_absence_players s
CROSS JOIN settings st
JOIN core.matches m ON m.id = s.match_key
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.season_id = m.season_id
CROSS JOIN LATERAL (
  SELECT i.kind::text AS kind, i.label, i.start_date, i.end_date, i.matches_missed::integer AS matches_missed,
    NULL::text AS competition_code, NULL::text AS competition_id, NULL::text AS competition_name, s.injuries_read_at::date AS read_on
  FROM core.player_injuries i
  WHERE i.player_id = s.player_key AND i.source = 'transfermarkt' AND s.injuries_read_at IS NOT NULL
    AND i.absent_since IS NULL AND i.start_date <= s.day
    AND (i.end_date >= s.day
         OR (i.end_date IS NULL AND s.injuries_read_at::date >= s.day - st.fresh_days
             AND NOT EXISTS (SELECT 1 FROM core.player_match_stats ms
                             JOIN core.matches mm ON mm.id = ms.match_id AND mm.season_id = ms.season_id
                             WHERE ms.player_id = s.player_key AND ms.season_id >= extract(year FROM i.start_date)::int - 1
                               AND ms.minutes_played > 0 AND mm.match_date > i.start_date AND mm.match_date < s.day)))
  UNION ALL
  SELECT 'suspension', u.label, u.start_date, u.end_date, u.matches_missed::integer, u.competition_code,
    api.public_id('competition', u.competition_id), c.name, s.suspensions_read_at::date
  FROM core.player_suspensions u
  JOIN core.competitions c ON c.id = u.competition_id
  WHERE u.player_id = s.player_key AND u.source = 'transfermarkt' AND s.suspensions_read_at IS NOT NULL AND NOT s.is_national
    AND u.absent_since IS NULL AND u.competition_id = cs.competition_id AND u.start_date <= s.day
    AND (u.end_date >= s.day OR (u.end_date IS NULL AND s.suspensions_read_at::date >= s.day - st.fresh_days))
) e
WHERE s.player_key IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM core.lineup_players lp
                  WHERE lp.season_id = m.season_id AND lp.match_id = m.id AND lp.player_id = s.player_key)
  AND NOT EXISTS (SELECT 1 FROM core.player_match_stats ms
                  WHERE ms.season_id = m.season_id AND ms.match_id = m.id AND ms.player_id = s.player_key AND ms.minutes_played > 0);

GRANT SELECT ON api.match_absence_players, api.match_absences TO vega_read;
