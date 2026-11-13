"""The source's action values of a player's league season, set among his role.

The source sends, for each player of a match, sums that value his actions rather than
count them: "vaep" and "pv", each with an offensive and a defensive part, and "xt"
(docs/METHODE_CLASSEMENT_BALLON_D_OR.md § 10 gives the principle of such values). The
base keeps the sums as they come: nothing here computes them, and the base holds no
action to check them against.

A player's reading is that of his league: each sum per 90 minutes over the league he
played the most in the season, and its place among the players of his role in that
league. A league is a competition the ranking gives a level to (agg.league_levels: the
domestic competition a club plays the most), so a cup or an international competition is
none. The values are not corrected for a league's level, which is why a player is set
among his own league only. Goalkeepers have no reading.

The ranking does not read these values (docs/calculs/05-joueurs/11-valeur-des-actions.md
gives the measures behind that choice and behind the goalkeepers' exclusion).
"""

# v2: a league is a competition the ranking gives a level to. v1 asked for a competition
# of kind "league", which the collected competitions do not carry: it read nobody.
MODEL_VERSION = "actions-v2"
MIN_MINUTES = 450  # of a league, measured; the site's lowest threshold for a rate per 90
MIN_PEERS = 20  # players of a role in a league below which nobody is placed among them
EXCLUDED_ROLES = ("goalkeeper",)

# The values kept, each with the season statistic it is read from (agg.player_season_stats).
VALUES = {
    "vaep": "adv_vaep_total", "vaep_offensive": "adv_vaep_offensive", "vaep_defensive": "adv_vaep_defensive",
    "pv": "adv_pv_total", "pv_offensive": "adv_pv_offensive", "pv_defensive": "adv_pv_defensive",
    "xt": "adv_xt_total",
}
PLACED = ("vaep", "pv", "xt")  # the totals: a part is read beside its total, not ranked

_SUMS = ", ".join(f"sum(s.{column}_sum)::float8 AS {name}_sum, sum(s.{column}_min)::float8 AS {name}_min" for name, column in VALUES.items())
_MEASURED = " AND ".join(f"sum(s.adv_{name}_total_min) >= %(minutes)s" for name in PLACED)
_RATES = ", ".join(f"90 * m.{name}_sum / nullif(m.{name}_min, 0) AS {name}" for name in VALUES)
# Rank 1 is the highest value; the percentile is the mean rank (below + half the equals) / peers.
_PLACES = ", ".join(
    f"""CASE WHEN r.peers >= %(peers)s THEN rank() OVER (w ORDER BY r.{name} DESC) END AS {name}_rank,
    CASE WHEN r.peers >= %(peers)s THEN
      (rank() OVER (w ORDER BY r.{name}) - 1 + 0.5 * count(*) OVER (PARTITION BY r.competition_id, r.role, r.{name})) * 100.0 / r.peers
    END AS {name}_percentile"""
    for name in PLACED
)
COLUMNS = ("season_id", "player_id", "competition_id", "role", "minutes", *VALUES, "peers",
           *(f"{name}_{what}" for name in PLACED for what in ("rank", "percentile")))

# A season's readings: one row per outfield player with MIN_MINUTES measured in a league.
SELECT = f"""
WITH league AS (
  SELECT s.player_id, cs.competition_id, {_SUMS}
  FROM agg.player_season_stats s
  JOIN core.competition_seasons cs ON cs.id = s.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
  JOIN agg.league_levels ll ON ll.competition_id = cs.competition_id
  WHERE s.season_id = %(season)s
  GROUP BY s.player_id, cs.competition_id
  HAVING {_MEASURED}),
main AS (
  SELECT DISTINCT ON (l.player_id) l.*, p.role
  FROM league l
  JOIN agg.player_power p ON p.season_id = %(season)s AND p.player_id = l.player_id AND p.role <> ALL(%(excluded)s)
  ORDER BY l.player_id, l.vaep_min DESC, l.competition_id),
rated AS (
  SELECT m.player_id, m.competition_id, m.role, m.vaep_min AS minutes, {_RATES},
    count(*) OVER (PARTITION BY m.competition_id, m.role) AS peers
  FROM main m)
SELECT %(season)s::smallint, r.player_id, r.competition_id, r.role, r.minutes::integer, {", ".join(f"r.{name}" for name in VALUES)}, r.peers::integer,
  {_PLACES}
FROM rated r
WINDOW w AS (PARTITION BY r.competition_id, r.role)
"""


def parameters(season):
    return {"season": season, "minutes": MIN_MINUTES, "peers": MIN_PEERS, "excluded": list(EXCLUDED_ROLES)}


def refresh(conn, season):
    """Read the season's action values (after its ranking, which gives each player's role);
    returns (players read, players placed among their role). The run is recorded even when
    the season has no value, so that it is not looked at again for it."""
    with conn.transaction():
        conn.execute("DELETE FROM agg.player_action_values WHERE season_id = %s", (season,))
        players = conn.execute(f"INSERT INTO agg.player_action_values({', '.join(COLUMNS)}) {SELECT}", parameters(season)).rowcount
        placed = conn.execute(
            "SELECT count(*) FROM agg.player_action_values WHERE season_id = %s AND vaep_percentile IS NOT NULL", (season,)
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO agg.action_value_runs(season_id, version, players, placed) VALUES (%s, %s, %s, %s)
               ON CONFLICT (season_id) DO UPDATE SET version = EXCLUDED.version, computed_at = now(),
                 players = EXCLUDED.players, placed = EXCLUDED.placed""",
            (season, MODEL_VERSION, players, placed),
        )
    return players, placed


def pending(conn):
    """The seasons with a published player ranking and no reading of the present version,
    the most recent first: a reading is one statement, so such a season gets it without
    waiting for a whole pass of its models."""
    return [
        season
        for (season,) in conn.execute(
            """SELECT DISTINCT r.season_id FROM agg.power_runs r
               WHERE r.kind = 'players' AND r.status = 'published' AND r.season_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM agg.action_value_runs a WHERE a.season_id = r.season_id AND a.version = %s)
               ORDER BY 1 DESC""",
            (MODEL_VERSION,),
        ).fetchall()
    ]
