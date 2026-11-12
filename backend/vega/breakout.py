"""Players the ranking does not rank yet, already playing like its regulars.

A player below the ranking's minutes (but with MIN_MINUTES or more) in a league on the
common scale is flagged when his regularised rate per 90 minutes (the ranking's own, § 8)
is at or above TOP_SHARE of the regulars of his role. Two conditions keep established
players out: he was never a regular in an earlier season of the base, and he is known to
be under MAX_AGE at the start of the season. A birth date is known for a minority of
players (Wikidata, club by club): a player whose age is unknown is not flagged. The
first list, without that condition, opened on an international back from injury and two
players in their mid-thirties: the base holds neither their earlier seasons nor their age.

Checked on 2025/26 against 2026/27 (docs/calculs/05-joueurs/10-revelations.md): flagged
players play the next season more often and for longer, and keep a higher rate. They do
not join stronger clubs more often than the others: the flag says nothing of transfers.
"""

MODEL_VERSION = "breakout-v2"
MIN_MINUTES = 270
TOP_SHARE = 0.8
MIN_REGULARS = 30  # regulars of a role below which nobody is placed among them
MAX_AGE = 23

_CANDIDATES = "p.season_id = %(season)s AND NOT p.eligible AND p.linked AND p.minutes >= %(minutes)s AND p.rate IS NOT NULL"
FLAG = f"""
WITH regular AS (
  SELECT role, rate FROM agg.player_power WHERE season_id = %(season)s AND eligible AND linked AND rate IS NOT NULL),
cut AS (
  SELECT role, percentile_cont(%(top)s) WITHIN GROUP (ORDER BY rate) AS threshold, count(*) AS regulars FROM regular GROUP BY role),
candidate AS (
  SELECT p.player_id, p.role, p.team_id, p.minutes, p.rate, c.regulars
  FROM agg.player_power p
  JOIN cut c ON c.role = p.role AND c.regulars >= %(regulars)s
  JOIN core.players pl ON pl.id = p.player_id
  WHERE {_CANDIDATES} AND p.rate >= c.threshold
    AND NOT EXISTS (SELECT 1 FROM agg.player_power e WHERE e.player_id = p.player_id AND e.season_id < p.season_id AND e.eligible)
    AND pl.birth_date > make_date(%(season)s - %(age)s, 8, 1)),
placed AS (
  SELECT c.*, (SELECT count(*) FILTER (WHERE r.rate < c.rate) * 100.0 / count(*) FROM regular r WHERE r.role = c.role) AS percentile
  FROM candidate c)
INSERT INTO agg.player_breakouts(season_id, player_id, role, team_id, minutes, rate, percentile, regulars, rank)
SELECT %(season)s, player_id, role, team_id, minutes, rate, percentile, regulars,
  row_number() OVER (ORDER BY percentile DESC, rate DESC, player_id)
FROM placed
"""


def refresh(conn, season):
    """Flag the season's players (after its ranking); returns (candidates, flagged). The run
    is recorded even when nobody is flagged, so that a season is not computed again for it."""
    params = {"season": season, "minutes": MIN_MINUTES, "top": TOP_SHARE, "regulars": MIN_REGULARS, "age": MAX_AGE}
    with conn.transaction():
        conn.execute("DELETE FROM agg.player_breakouts WHERE season_id = %s", (season,))
        flagged = conn.execute(FLAG, params).rowcount
        candidates = conn.execute(f"SELECT count(*) FROM agg.player_power p WHERE {_CANDIDATES}", params).fetchone()[0]
        conn.execute(
            """INSERT INTO agg.breakout_runs(season_id, version, candidates, flagged) VALUES (%s, %s, %s, %s)
               ON CONFLICT (season_id) DO UPDATE SET version = EXCLUDED.version, computed_at = now(),
                 candidates = EXCLUDED.candidates, flagged = EXCLUDED.flagged""",
            (season, MODEL_VERSION, candidates, flagged),
        )
    return candidates, flagged
