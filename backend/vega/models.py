"""Vega models over agg: cohorts, percentiles, club index, levels, roles, similarity.

Every formula is the one the site uses today, as written in docs/calculs on main:
04-clubs/02 (centiles, phases, indice Vega club), 04-clubs/03 (référentiels, niveau),
04-clubs/04 (clubs similaires), 05-joueurs/02 (centiles saison), 05-joueurs/03 (rôles,
indice Vega joueur) and 05-joueurs/04 (joueurs similaires). Values shown as fictitious
on the site (potential, projections, market value) are not invented here:
their tables stay empty until a source or a validated model exists.

Each published result carries the agg.calc_runs row that produced it.
"""

from math import ceil
import re

from .api_schema import CLUB_INDICATORS

MODEL_VERSION = "statarena-descriptive-v1"
FORMULA_VERSION = "docs-calculs-2026-11-09"
# A club's level is its Elo of the power ranking (power.py), fitted on every result:
# league matches and the European cups that link the leagues.
LEVELS_VERSION = "levels-elo-v1"

EUROPE_LEAGUES = {
    "l_4WFCIZ": "ENG",
    "l_0ErfuF": "ESP",
    "l_1Isor4": "GER",
    "l_0ALvwF": "ITA",
    "l_3FJFUl": "FRA",
    "l_4QexZg": "POR",
    "l_4H43wr": "NED",
}
UEFA_CUPS = ("l_0bfbkO", "l_38d9HA", "l_2WZ2tt")
CUP_NAME = re.compile(
    r"\b(cup|coupe|copa|coppa|pokal|beker|ta[cç]a|super ?cup|supercopa|supercoppa|supercoupe|"
    r"superta[cç]a|community shield|troph[ée]e des champions|johan cruijff schaal)\b",
    re.I,
)

MIN_TEAMS = 5
MIN_PLAYERS = 30
MIN_MINUTES = 450
POSITION_GROUPS = ("G", "D", "M", "O")
GROUP_LABEL = {"G": "Gardiens", "D": "Défenseurs", "M": "Milieux", "O": "Milieux offensifs et attaquants"}

# Club indicators (docs/calculs/04-clubs/01): label, category, direction, decimals, unit.
# Direction 1: higher is better; -1: lower is better (percentile inverted); 0: style.
TEAM_INDICATORS = {
    "ppm": ("Points / match", "results", 1, 2, None),
    "xpts_pm": ("xPts / match", "results", 1, 2, None),
    "goals_for_pm": ("Buts marqués / match", "attack", 1, 2, None),
    "xg_pm": ("xG / match", "attack", 1, 2, None),
    "npxg_pm": ("xG hors penalty / match", "attack", 1, 2, None),
    "xg_open_pm": ("xG en jeu ouvert / match", "attack", 1, 2, None),
    "big_chances_pm": ("Grosses occasions / match", "attack", 1, 1, None),
    "shots_pm": ("Tirs / match", "attack", 1, 1, None),
    "shots_on_target_pm": ("Tirs cadrés / match", "attack", 1, 1, None),
    "xg_per_shot": ("xG par tir (hors penalty)", "attack", 1, 2, None),
    "box_shots_pct": ("Tirs dans la surface", "attack", 1, 0, "%"),
    "touches_box_pm": ("Ballons dans la surface / match", "attack", 1, 1, None),
    "finishing_pm": ("Finition (buts − xG) / match", "finishing", 1, 2, None),
    "keeper_pm": ("Buts évités par le gardien / match", "finishing", 1, 2, None),
    "conversion_pct": ("Conversion des tirs", "finishing", 1, 1, "%"),
    "xgot_pm": ("xG cadrés (xGOT) / match", "finishing", 1, 2, None),
    "placement_pm": ("Qualité de frappe (xGOT − xG) / match", "finishing", 1, 2, None),
    "goals_against_pm": ("Buts encaissés / match", "defence", -1, 2, None),
    "xga_pm": ("xG concédés / match", "defence", -1, 2, None),
    "npxga_pm": ("xG concédés hors penalty / match", "defence", -1, 2, None),
    "shots_against_pm": ("Tirs concédés / match", "defence", -1, 1, None),
    "big_chances_against_pm": ("Grosses occasions concédées / match", "defence", -1, 1, None),
    "touches_box_against_pm": ("Ballons adverses dans la surface / match", "defence", -1, 1, None),
    "shots_on_target_against_pm": ("Tirs cadrés concédés / match", "defence", -1, 1, None),
    "xg_open_against_pm": ("xG concédés en jeu ouvert / match", "defence", -1, 2, None),
    "clean_sheets_pct": ("Matchs sans encaisser", "defence", 1, 0, "%"),
    "possession_pct": ("Possession", "control", 0, 1, "%"),
    "passes_pm": ("Passes / match", "control", 0, 0, None),
    "passes_against_pm": ("Passes adverses / match", "control", 0, 0, None),
    "pass_accuracy_pct": ("Passes réussies", "control", 1, 1, "%"),
    "field_tilt_pct": ("Territoire (field tilt)", "control", 1, 1, "%"),
    "box_share_pct": ("Part des ballons dans les surfaces", "control", 1, 1, "%"),
    "directness_pct": ("Jeu long", "control", 0, 1, "%"),
    "crosses_pm": ("Centres réussis / match", "control", 0, 1, None),
    "ppda_approx": ("PPDA (approx.)", "pressing", -1, 1, None),
    "def_actions_adj": ("Tacles + interceptions (ajusté poss.)", "pressing", 0, 1, None),
    "duels_pct": ("Duels gagnés", "pressing", 1, 1, "%"),
    "aerials_pct": ("Duels aériens gagnés", "pressing", 1, 1, "%"),
    "fouls_pm": ("Fautes / match", "pressing", 0, 1, None),
    "xg_set_pm": ("xG sur CPA / match", "set_pieces", 1, 2, None),
    "xg_set_against_pm": ("xG concédés sur CPA / match", "set_pieces", -1, 2, None),
    "set_share_pct": ("Part des CPA dans les xG", "set_pieces", 0, 0, "%"),
    "corners_pm": ("Corners / match", "set_pieces", 1, 1, None),
    "corners_against_pm": ("Corners concédés / match", "set_pieces", -1, 1, None),
    "yellow_pm": ("Cartons jaunes / match", "discipline", -1, 2, None),
    "red_total": ("Cartons rouges", "discipline", -1, 0, None),
}
assert set(TEAM_INDICATORS) == set(CLUB_INDICATORS), "club indicators drifted"

TEAM_PHASES = {
    "attack": ("xg_pm", "big_chances_pm", "touches_box_pm", "xg_per_shot"),
    "defence": ("xga_pm", "big_chances_against_pm", "touches_box_against_pm", "shots_against_pm"),
    "control": ("field_tilt_pct", "box_share_pct", "pass_accuracy_pct"),
    "pressing": ("ppda_approx", "duels_pct", "aerials_pct"),
    "set_pieces": ("xg_set_pm", "xg_set_against_pm", "corners_pm"),
    "finishing": ("finishing_pm", "keeper_pm"),
}
PHASE_WEIGHTS = {"attack": 0.30, "defence": 0.30, "control": 0.15, "pressing": 0.10, "finishing": 0.10, "set_pieces": 0.05}
TEAM_SIMILARITY_AXES = (
    "possession_pct", "field_tilt_pct", "directness_pct", "ppda_approx", "crosses_pm",
    "set_share_pct", "def_actions_adj", "xg_pm", "xga_pm", "pass_accuracy_pct",
)

# Ranked player metrics (docs/calculs/05-joueurs): per 90, or a ratio in %.
# key: (label, category, direction, decimals, ratio?)
PLAYER_RANKED = {
    "goals": ("Buts", "finishing", 1, 2, False),
    "xg": ("xG", "finishing", 1, 2, False),
    "npxg": ("xG hors penalty", "finishing", 1, 2, False),
    "xgot": ("xG cadrés (xGOT)", "finishing", 1, 2, False),
    "total_shots": ("Tirs", "finishing", 1, 2, False),
    "shots_on_target": ("Tirs cadrés", "finishing", 1, 2, False),
    "touches_opp_box": ("Ballons dans la surface", "finishing", 1, 2, False),
    "assists": ("Passes décisives", "creation", 1, 2, False),
    "chances_created": ("Occasions créées", "creation", 1, 2, False),
    "big_chances_created": ("Grosses occasions créées", "creation", 1, 2, False),
    "passes_into_final_third": ("Passes dans le dernier tiers", "progression", 1, 2, False),
    "dribbles_succeeded": ("Dribbles réussis", "progression", 1, 2, False),
    "touches": ("Ballons touchés", "progression", 1, 1, False),
    "accurate_passes": ("Passes réussies", "passing", 1, 1, False),
    "accurate_passes_total": ("Passes tentées", "passing", 1, 1, False),
    "pass_completion": ("Précision des passes", "passing", 1, 1, True),
    "defensive_actions": ("Actions défensives", "defending", 1, 2, False),
    "tackles": ("Tacles", "defending", 1, 2, False),
    "interceptions": ("Interceptions", "defending", 1, 2, False),
    "recoveries": ("Récupérations", "defending", 1, 2, False),
    "duels_won": ("Duels gagnés", "defending", 1, 2, False),
    "duel_success": ("Duels gagnés %", "defending", 1, 1, True),
    "clearances": ("Dégagements", "defending", 1, 2, False),
    "shot_blocks": ("Tirs bloqués", "defending", 1, 2, False),
    "duels_lost": ("Duels perdus", "security", -1, 2, False),
    "saves": ("Arrêts", "goalkeeping", 1, 2, False),
    "goals_prevented": ("Buts évités", "goalkeeping", 1, 2, False),
}
PLAYER_SIMILARITY_AXES = (
    "total_shots", "touches_opp_box", "chances_created", "passes_into_final_third",
    "dribbles_succeeded", "touches", "accurate_passes", "pass_completion", "duels_won",
    "duel_success", "tackles", "interceptions", "recoveries", "clearances", "saves",
)
ROLE_ORDER = ("recovery", "box_defence", "build_up", "creation", "penetration", "attacking_presence", "shot_stopping")


def half_up(value):
    """Math.round of the site (Python's round() is banker's rounding)."""
    return None if value is None else int(value + 0.5) if value >= 0 else -int(-value + 0.5)


# Runs -------------------------------------------------------------------


def _start_run(conn, kind, definition, *, version=FORMULA_VERSION):
    revision = conn.execute("SELECT coalesce(max(revision), 0) FROM core.matches").fetchone()[0]
    return conn.execute(
        """INSERT INTO agg.calc_runs(kind, model_version, formula_version, data_revision, cohort_definition, cutoff_at)
           VALUES (%s, %s, %s, %s, %s, now()) RETURNING id""",
        (kind, MODEL_VERSION, version, revision, definition),
    ).fetchone()[0]


def _publish(conn, run, kind, definition):
    conn.execute(
        "UPDATE agg.calc_runs SET status='superseded' WHERE kind=%s AND cohort_definition=%s AND status='published' AND id<>%s",
        (kind, definition, run),
    )
    # clock_timestamp(), not now(): inside a transaction now() is its start, the run's own
    # started_at, and every run read as lasting 0 ms.
    conn.execute("UPDATE agg.calc_runs SET status='published', finished_at=clock_timestamp() WHERE id=%s", (run,))


# Cohorts ----------------------------------------------------------------


def _is_league(kind, name, country):
    if kind is not None:
        return kind == "league"
    return not CUP_NAME.search(name or "") and country not in ("INT", "UEFA", "INT-2", None)


def _upsert_cohort(conn, key, *, entity, label, season, universe, scope, group, per_match, competitions):
    cohort = conn.execute(
        """INSERT INTO agg.cohorts(key, entity_type, label, season_id, universe, stat_scope, position_group, min_minutes, per_match)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, universe=EXCLUDED.universe, stat_scope=EXCLUDED.stat_scope,
             per_match=EXCLUDED.per_match, updated_at=now()
           RETURNING id""",
        (key, entity, label, season, universe, scope, group, MIN_MINUTES if entity == "player" else None, per_match),
    ).fetchone()[0]
    for competition in competitions:
        conn.execute(
            "INSERT INTO agg.cohort_competitions(cohort_id, competition_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (cohort, competition),
        )
    return cohort


def ensure_cohorts(conn, edition):
    """The cohorts an edition belongs to: its own (team + 4 position groups) and Europe."""
    found = conn.execute(
        """SELECT cs.season_id, c.id, c.name, c.kind::text, c.country_code, p.provider_key
           FROM core.competition_seasons cs JOIN core.competitions c ON c.id = cs.competition_id
           LEFT JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=c.id AND p.is_current
           WHERE cs.id=%s""",
        (edition,),
    ).fetchone()
    if not found:
        return []
    season, competition, name, kind, country, key = found
    universe = "league" if _is_league(kind, name, country) else "competition"
    cohorts = [
        _upsert_cohort(conn, f"team:{season}:cs:{edition}", entity="team", label=name, season=season,
                       universe=universe, scope="league", group=None, per_match=False, competitions=[competition])
    ]
    for group in POSITION_GROUPS:
        cohorts.append(
            _upsert_cohort(conn, f"player:{season}:cs:{edition}:{group}", entity="player",
                           label=f"{name} · {GROUP_LABEL[group]}", season=season, universe=universe, scope="league",
                           group=group, per_match=False, competitions=[competition])
        )
    if key in EUROPE_LEAGUES or key in UEFA_CUPS:
        label = "Europe · Top 7 et coupes UEFA"
        cohorts.append(
            _upsert_cohort(conn, f"team:{season}:europe", entity="team", label=label, season=season,
                           universe="europe", scope="league_and_uefa", group=None, per_match=True,
                           competitions=[competition])
        )
        for group in POSITION_GROUPS:
            cohorts.append(
                _upsert_cohort(conn, f"player:{season}:europe:{group}", entity="player",
                               label=f"{label} · {GROUP_LABEL[group]}", season=season, universe="europe",
                               scope="league_and_uefa", group=group, per_match=True, competitions=[competition])
            )
    return cohorts


def mark_cohorts(conn, edition):
    """After an edition's aggregates change: its cohorts are queued for recalculation."""
    cohorts = ensure_cohorts(conn, edition)
    for cohort in cohorts:
        conn.execute(
            """INSERT INTO ops.dirty_scopes(scope_kind, cohort_id) VALUES ('cohort', %s)
               ON CONFLICT (scope_kind, player_id, team_id, competition_season_id, cohort_id)
               DO UPDATE SET revision = ops.dirty_scopes.revision + 1, queued_at = now()""",
            (cohort,),
        )
    return cohorts


def _cohort(conn, cohort):
    row = conn.execute(
        "SELECT key, entity_type::text, season_id, universe::text, position_group, min_minutes, per_match FROM agg.cohorts WHERE id=%s",
        (cohort,),
    ).fetchone()
    key, entity, season, universe, group, min_minutes, per_match = row
    editions = [
        r[0]
        for r in conn.execute(
            """SELECT cs.id FROM agg.cohort_competitions cc
               JOIN core.competition_seasons cs ON cs.competition_id = cc.competition_id AND cs.season_id = %s
               WHERE cc.cohort_id = %s ORDER BY cs.id""",
            (season, cohort),
        )
    ]
    # Europe ranks the clubs of the seven leagues (and their players); UEFA matches
    # count in their values but do not bring other clubs in.
    members = editions
    if universe == "europe":
        members = [
            r[0]
            for r in conn.execute(
                """SELECT cs.id FROM core.competition_seasons cs
                   JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=cs.competition_id
                   WHERE cs.id = ANY(%s) AND p.provider_key = ANY(%s)""",
                (editions, list(EUROPE_LEAGUES)),
            )
        ]
    return {
        "id": cohort, "key": key, "entity": entity, "season": season, "universe": universe, "group": group,
        "min_minutes": min_minutes, "per_match": per_match, "editions": editions, "members": members,
    }


# Percentiles --------------------------------------------------------------


def _ranked_insert(table, entity_column, value_column, covered_column, directions, min_n):
    """Shared percentile/rank statement over `u(entity, key, value, covered)`.

    percentile = round(100 × (#below + ½ #equal) / n), inverted for direction -1;
    rank = 1 + number strictly better; no percentile below `min_n` known values.
    """
    dirs = ", ".join(f"('{k}', {d})" for k, d in directions.items())
    return f"""
, d(key, dir) AS (VALUES {dirs})
, r AS (
  SELECT u.*, d.dir, count(u.value) OVER (PARTITION BY u.key) AS n,
    rank() OVER (PARTITION BY u.key ORDER BY u.value ASC NULLS LAST) AS lo,
    count(*) OVER (PARTITION BY u.key, u.value) AS ties,
    rank() OVER (PARTITION BY u.key ORDER BY CASE WHEN d.dir = -1 THEN u.value END ASC NULLS LAST,
                                              CASE WHEN d.dir <> -1 THEN u.value END DESC NULLS LAST) AS rnk
  FROM u JOIN d USING (key)
)
INSERT INTO {table}(cohort_id, {entity_column}, metric_key, {value_column}, {covered_column}, percentile, rank)
SELECT %(cohort)s, entity, key, value, covered,
  CASE WHEN n >= {min_n} THEN
    CASE WHEN dir = -1 THEN 100 - round(100.0 * ((lo - 1) + 0.5 * ties) / n)
         ELSE round(100.0 * ((lo - 1) + 0.5 * ties) / n) END END,
  rnk
FROM r WHERE value IS NOT NULL
"""


_TEAM_COLUMNS = None


def _team_columns(conn):
    global _TEAM_COLUMNS
    if _TEAM_COLUMNS is None:
        _TEAM_COLUMNS = [
            c
            for (c,) in conn.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_schema='agg' AND table_name='team_season_stats'
                     AND data_type IN ('smallint','integer','bigint','real','double precision','numeric')
                     AND column_name NOT IN ('team_id','competition_season_id','season_id')
                   ORDER BY ordinal_position"""
            )
        ]
    return _TEAM_COLUMNS


def _team_values_sql(conn):
    sums = ", ".join(f"sum(s.{c})::double precision AS {c}" for c in _team_columns(conn))
    indicators = ", ".join(f"({expr}) AS {key}" for key, expr in CLUB_INDICATORS.items())
    unpivot = ", ".join(f"('{key}', v.{key})" for key in CLUB_INDICATORS)
    return f"""
WITH t AS (
  SELECT s.team_id, {sums}
  FROM agg.team_season_stats s
  WHERE s.competition_season_id = ANY(%(editions)s)
    AND s.team_id IN (SELECT team_id FROM agg.team_season_stats WHERE competition_season_id = ANY(%(members)s))
  GROUP BY s.team_id
), v AS (SELECT t.team_id, t.matches, {indicators} FROM t)
, u AS (
  SELECT v.team_id AS entity, x.key, x.value::double precision AS value, v.matches::integer AS covered
  FROM v CROSS JOIN LATERAL (VALUES {unpivot}) AS x(key, value)
)"""


def _player_values_sql():
    items = []
    for key, (_, _, _, _, ratio) in PLAYER_RANKED.items():
        if ratio:
            # A rate over the matches where both of its terms exist, all of them played.
            items.append(
                f"('{key}', CASE WHEN m.{key}_n >= m.appearances THEN core.pct(m.{key}_num, m.{key}_den) END, m.minutes)"
            )
        else:
            # Per 90 only if the metric covers every minute played (docs: count = matches
            # and minutes = minutes totales), so 3 matches never rank against 30.
            items.append(
                f"('{key}', CASE WHEN m.{key}_min = m.minutes THEN core.per90(m.{key}_sum, m.minutes) END, m.{key}_min)"
            )
    sums = ["sum(s.appearances)::integer AS appearances", "sum(s.minutes)::integer AS minutes"]
    for key, (_, _, _, _, ratio) in PLAYER_RANKED.items():
        parts = ("num", "den", "n") if ratio else ("sum", "n", "min")
        sums += [f"sum(s.{key}_{p})::double precision AS {key}_{p}" for p in parts]
    return f"""
WITH grp AS (
  SELECT DISTINCT ON (player_id) player_id, g FROM (
    SELECT s.player_id, core.position_group(coalesce(s.position_id, lp.position_id)) AS g, sum(s.minutes_played) AS minutes
    FROM core.player_match_stats s JOIN core.matches mt ON mt.id = s.match_id AND mt.season_id = s.season_id
    -- The line-up carries the position: the statistics rows of PitchAPI have none.
    LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
    WHERE mt.competition_season_id = ANY(%(editions)s) AND s.season_id = %(season)s
      AND core.position_group(coalesce(s.position_id, lp.position_id)) IS NOT NULL
    GROUP BY 1, 2) x
  ORDER BY player_id, minutes DESC NULLS LAST, g
), m AS (
  SELECT s.player_id, {", ".join(sums)}
  FROM agg.player_season_stats s
  WHERE s.competition_season_id = ANY(%(editions)s)
    AND s.player_id IN (SELECT player_id FROM agg.player_season_stats WHERE competition_season_id = ANY(%(members)s))
    AND s.player_id IN (SELECT player_id FROM grp WHERE g = %(group)s)
  GROUP BY s.player_id
  HAVING sum(s.minutes) >= %(min_minutes)s
), u AS (
  SELECT m.player_id AS entity, x.key, x.value::double precision AS value, x.covered::integer AS covered
  FROM m CROSS JOIN LATERAL (VALUES {", ".join(items)}) AS x(key, value, covered)
)"""


def _distributions(conn, cohort, table, value_column):
    conn.execute("DELETE FROM agg.cohort_distributions WHERE cohort_id=%s", (cohort,))
    conn.execute(
        f"""INSERT INTO agg.cohort_distributions(cohort_id, metric_key, p10, p25, p50, p75, p90, min, max, n)
            SELECT %(cohort)s, metric_key, q[1], q[2], q[3], q[4], q[5], lo, hi, n FROM (
              SELECT metric_key,
                percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY {value_column}) AS q,
                min({value_column}) AS lo, max({value_column}) AS hi, count({value_column}) AS n
              FROM {table} WHERE cohort_id = %(cohort)s AND {value_column} IS NOT NULL GROUP BY metric_key) x""",
        {"cohort": cohort},
    )


def refresh_cohort(conn, cohort):
    """Percentiles, distributions, then the cohort's index (clubs) or roles (players)."""
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(92010, %s)", (cohort,))
        c = _cohort(conn, cohort)
        run = _start_run(conn, "percentiles", c["key"])
        params = {"cohort": cohort, "editions": c["editions"], "members": c["members"], "season": c["season"],
                  "group": c["group"], "min_minutes": c["min_minutes"] or 0}
        if c["entity"] == "team":
            conn.execute("DELETE FROM agg.team_percentiles WHERE cohort_id=%s", (cohort,))
            directions = {k: v[2] for k, v in TEAM_INDICATORS.items()}
            conn.execute(
                _team_values_sql(conn) + _ranked_insert("agg.team_percentiles", "team_id", "value", "covered_matches", directions, MIN_TEAMS),
                params,
            )
            _distributions(conn, cohort, "agg.team_percentiles", "value")
            size = conn.execute("SELECT count(DISTINCT team_id) FROM agg.team_percentiles WHERE cohort_id=%s", (cohort,)).fetchone()[0]
        else:
            conn.execute("DELETE FROM agg.player_percentiles WHERE cohort_id=%s", (cohort,))
            directions = {k: v[2] for k, v in PLAYER_RANKED.items()}
            conn.execute(
                _player_values_sql() + _ranked_insert("agg.player_percentiles", "player_id", "value_p90", "covered_minutes", directions, MIN_PLAYERS),
                params,
            )
            _distributions(conn, cohort, "agg.player_percentiles", "value_p90")
            size = conn.execute("SELECT count(DISTINCT player_id) FROM agg.player_percentiles WHERE cohort_id=%s", (cohort,)).fetchone()[0]
        conn.execute("UPDATE agg.cohorts SET size=%s, calc_run_id=%s, updated_at=now() WHERE id=%s", (size, run, cohort))
        _publish(conn, run, "percentiles", c["key"])
        if c["entity"] == "team":
            _team_index(conn, c)
        else:
            _roles(conn, c)
    return c


# Club index ---------------------------------------------------------------


def _better_count(values, mine, key):
    return sum(1 for other in values if key(other) > key(mine))


def _team_index(conn, c):
    cohort = c["id"]
    run = _start_run(conn, "index", c["key"])
    percentiles = {}
    for team, key, pct in conn.execute(
        "SELECT team_id, metric_key, percentile FROM agg.team_percentiles WHERE cohort_id=%s AND percentile IS NOT NULL",
        (cohort,),
    ):
        percentiles.setdefault(team, {})[key] = pct
    standing = {
        team: (points, gf, ga, matches, xpts, xpts_matches)
        for team, points, gf, ga, matches, xpts, xpts_matches in conn.execute(
            """SELECT team_id, sum(points), sum(goals_for), sum(goals_against), sum(matches), sum(xpts), sum(xpts_matches)
               FROM agg.team_season_stats WHERE competition_season_id = ANY(%s)
                 AND team_id IN (SELECT team_id FROM agg.team_percentiles WHERE cohort_id=%s)
               GROUP BY team_id""",
            (c["editions"], cohort),
        )
    }
    rows = {}
    for team in standing:
        phases = {}
        for phase, keys in TEAM_PHASES.items():
            known = [percentiles.get(team, {}).get(k) for k in keys]
            known = [v for v in known if v is not None]
            phases[phase] = half_up(sum(known) / len(known)) if known else None
        weights = {p: w for p, w in PHASE_WEIGHTS.items() if phases[p] is not None}
        index = half_up(sum(w * phases[p] for p, w in weights.items()) / sum(weights.values())) if weights else None
        rows[team] = (phases, index)

    def table_key(team):
        points, gf, ga, matches, _, _ = standing[team]
        if c["per_match"]:
            m = matches or 1
            return (points / m, (gf - ga) / m, gf / m)
        return (points, gf - ga, gf)

    def xpts_key(team):
        _, _, _, matches, xpts, xpts_matches = standing[team]
        if xpts is None:
            return (float("-inf"),)
        return (xpts / xpts_matches if c["per_match"] and xpts_matches else xpts,)

    teams = list(standing)
    indexed = [t for t in teams if rows[t][1] is not None]
    conn.execute("DELETE FROM agg.team_index WHERE cohort_id=%s", (cohort,))
    for team in teams:
        phases, index = rows[team]
        conn.execute(
            """INSERT INTO agg.team_index(team_id, cohort_id, vega_index, vega_rank, position, xpts_position,
                 attack, defence, control, pressing, set_pieces, finishing, calc_run_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                team, cohort, index,
                1 + _better_count(indexed, team, lambda t: rows[t][1]) if index is not None else None,
                1 + _better_count(teams, team, table_key),
                1 + _better_count(teams, team, xpts_key) if standing[team][4] is not None else None,
                phases["attack"], phases["defence"], phases["control"], phases["pressing"],
                phases["set_pieces"], phases["finishing"], run,
            ),
        )
    _publish(conn, run, "index", c["key"])


# Roles and player index ---------------------------------------------------


def _roles(conn, c):
    cohort, group = c["id"], c["group"]
    run = _start_run(conn, "roles", c["key"])
    roles = {}
    for code, groups in conn.execute("SELECT code, position_group FROM agg.role_definitions"):
        if group in groups.split(","):
            roles[code] = []
    for code, metric in conn.execute("SELECT role_code, metric_key FROM agg.role_weights ORDER BY role_code, metric_key"):
        if code in roles:
            roles[code].append(metric)
    percentiles = {}
    for player, key, pct in conn.execute(
        "SELECT player_id, metric_key, percentile FROM agg.player_percentiles WHERE cohort_id=%s AND percentile IS NOT NULL",
        (cohort,),
    ):
        percentiles.setdefault(player, {})[key] = pct
    scores = {}
    for player, known in percentiles.items():
        for code, metrics in roles.items():
            # Every component must exist: no partial average (docs: indice personnalisé).
            if metrics and all(m in known for m in metrics):
                scores.setdefault(code, {})[player] = sum(known[m] for m in metrics) / len(metrics)
    conn.execute("DELETE FROM agg.player_role_scores WHERE cohort_id=%s", (cohort,))
    primary = {}
    for player in percentiles:
        best = None
        for code in ROLE_ORDER:
            value = scores.get(code, {}).get(player)
            if value is not None and (best is None or value > best[1]):
                best = (code, value)
        if best:
            primary[player] = best[0]
    for code, by_player in scores.items():
        values = list(by_player.values())
        for player, value in by_player.items():
            conn.execute(
                """INSERT INTO agg.player_role_scores(player_id, season_id, cohort_id, role_code, score, rank, cohort_size, is_primary, calc_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (player, c["season"], cohort, code, half_up(value), 1 + sum(1 for v in values if v > value),
                 len(values), primary.get(player) == code, run),
            )
    _publish(conn, run, "roles", c["key"])


def refresh_player_index(conn, season):
    """Indice Vega joueur: the best role score in the player's canonical cohort.

    Canonical cohort: Europe for players of the seven leagues, else the league cohort
    where the player has the most minutes. Potential and career stage stay empty:
    the site shows them as fictitious.
    """
    with conn.transaction():
        # One writer of a season's index at a time. The worker, its side process and the
        # backfill each refresh it: two at once both emptied the season and both wrote it,
        # and the second failed on the primary key (eight times in two hours on
        # 10 November 2026, each retried).
        conn.execute("SELECT pg_advisory_xact_lock(92011, %s)", (season,))
        run = _start_run(conn, "index", f"player:{season}")
        conn.execute("DELETE FROM agg.player_index WHERE season_id=%s", (season,))
        conn.execute(
            """WITH minutes AS (
                 SELECT cohort_id, player_id, max(covered_minutes) AS minutes FROM agg.player_percentiles
                 WHERE cohort_id IN (SELECT id FROM agg.cohorts WHERE season_id = %(season)s) GROUP BY 1, 2)
               INSERT INTO agg.player_index(player_id, season_id, vega_index, calc_run_id)
               SELECT DISTINCT ON (r.player_id) r.player_id, r.season_id, r.score, %(run)s
               FROM agg.player_role_scores r JOIN agg.cohorts c ON c.id = r.cohort_id
               LEFT JOIN minutes m ON m.cohort_id = r.cohort_id AND m.player_id = r.player_id
               WHERE r.season_id = %(season)s AND r.is_primary AND c.universe IN ('europe', 'league')
               ORDER BY r.player_id, (c.universe = 'europe') DESC, m.minutes DESC NULLS LAST, r.cohort_id""",
            {"season": season, "run": run},
        )
        _publish(conn, run, "index", f"player:{season}")


# Similarity ---------------------------------------------------------------


def refresh_similarity(conn, cohort):
    """Top 10 most similar clubs or players of a cohort, from percentile distances."""
    with conn.transaction():
        c = _cohort(conn, cohort)
        run = _start_run(conn, "similarity", c["key"])
        if c["entity"] == "team":
            conn.execute("DELETE FROM agg.team_similar WHERE cohort_id=%s", (cohort,))
            conn.execute(
                """WITH p AS (SELECT team_id, metric_key, percentile FROM agg.team_percentiles
                              WHERE cohort_id=%(cohort)s AND metric_key = ANY(%(axes)s) AND percentile IS NOT NULL),
                   pairs AS (SELECT a.team_id, b.team_id AS other, round(100 - avg(abs(a.percentile - b.percentile)))::smallint AS similarity
                             FROM p a JOIN p b ON b.metric_key = a.metric_key AND b.team_id <> a.team_id GROUP BY 1, 2),
                   ranked AS (SELECT *, row_number() OVER (PARTITION BY team_id ORDER BY similarity DESC, other) AS rk FROM pairs)
                   INSERT INTO agg.team_similar(team_id, cohort_id, rank, similar_team_id, similarity, calc_run_id)
                   SELECT team_id, %(cohort)s, rk, other, similarity, %(run)s FROM ranked WHERE rk <= 10""",
                {"cohort": cohort, "axes": list(TEAM_SIMILARITY_AXES), "run": run},
            )
        else:
            conn.execute("DELETE FROM agg.player_similar WHERE cohort_id=%s", (cohort,))
            # A peer needs max(5, ⌈0.75 × the player's ranked axes⌉) axes in common.
            conn.execute(
                """WITH p AS (SELECT player_id, metric_key, percentile FROM agg.player_percentiles
                              WHERE cohort_id=%(cohort)s AND metric_key = ANY(%(axes)s) AND percentile IS NOT NULL),
                   k AS (SELECT player_id, count(*) AS axes FROM p GROUP BY 1),
                   pairs AS (SELECT a.player_id, b.player_id AS other, count(*) AS common,
                                    100 - avg(abs(a.percentile - b.percentile)) AS similarity
                             FROM p a JOIN p b ON b.metric_key = a.metric_key AND b.player_id <> a.player_id GROUP BY 1, 2),
                   ok AS (SELECT pairs.* FROM pairs JOIN k USING (player_id) WHERE common >= greatest(5, ceil(0.75 * k.axes))),
                   ranked AS (SELECT *, row_number() OVER (PARTITION BY player_id ORDER BY similarity DESC, other) AS rk FROM ok)
                   INSERT INTO agg.player_similar(player_id, season_id, cohort_id, rank, similar_player_id, similarity, calc_run_id)
                   SELECT player_id, %(season)s, %(cohort)s, rk, other, similarity, %(run)s FROM ranked WHERE rk <= 10""",
                {"cohort": cohort, "axes": list(PLAYER_SIMILARITY_AXES), "season": c["season"], "run": run},
            )
        _publish(conn, run, "similarity", c["key"])


# Levels and competition strength -----------------------------------------


def refresh_levels(conn, season):
    """Comparable level of every club with a league edition in the season: its Elo after
    its last match of the season (agg.team_power, run just before), split into the Elo it
    carried in (long run) and what the season added (season part)."""
    with conn.transaction():
        run = _start_run(conn, "levels", f"season:{season}", version=LEVELS_VERSION)
        rows = conn.execute(
            """SELECT DISTINCT ON (t.team_id) t.team_id, c.country_code, c.kind::text, c.name, p.elo, p.elo_change
               FROM agg.team_season_stats t
               JOIN core.competition_seasons cs ON cs.id = t.competition_season_id
               JOIN core.competitions c ON c.id = cs.competition_id
               JOIN agg.team_power p ON p.team_id = t.team_id AND p.season_id = t.season_id AND p.scope = 'clubs'
               WHERE t.season_id = %s
               ORDER BY t.team_id, (c.kind = 'league') DESC NULLS LAST, t.matches DESC, t.competition_season_id""",
            (season,),
        ).fetchall()
        conn.execute("DELETE FROM agg.team_levels WHERE season_id=%s", (season,))
        for team, country, kind, name, elo, change in rows:
            if not _is_league(kind, name, country):
                continue
            conn.execute(
                "INSERT INTO agg.team_levels(team_id, season_id, level, season_part, long_run_part, calc_run_id) VALUES (%s,%s,%s,%s,%s,%s)",
                (team, season, elo, change, elo - change, run),
            )
        _publish(conn, run, "levels", f"season:{season}")


def refresh_strength(conn, season):
    """Goals per match and relative strength (percentile of the mean club level)."""
    with conn.transaction():
        run = _start_run(conn, "strength", f"season:{season}", version=LEVELS_VERSION)
        conn.execute(
            "DELETE FROM agg.competition_strength WHERE competition_season_id IN (SELECT id FROM core.competition_seasons WHERE season_id=%s)",
            (season,),
        )
        conn.execute(
            """WITH e AS (
                 SELECT t.competition_season_id AS cs, sum(t.goals_for)::double precision / nullif(sum(t.matches) / 2.0, 0) AS goals,
                        avg(l.level) AS level, count(l.level) AS leveled
                 FROM agg.team_season_stats t LEFT JOIN agg.team_levels l ON l.team_id = t.team_id AND l.season_id = t.season_id
                 WHERE t.season_id = %(season)s GROUP BY 1),
               q AS (SELECT cs, level FROM e WHERE level IS NOT NULL AND leveled >= 6),
               r AS (
                 SELECT cs, round(100.0 * ((rank() OVER (ORDER BY level) - 1) + 0.5 * count(*) OVER (PARTITION BY level))
                                  / count(*) OVER ()) AS strength
                 FROM q)
               INSERT INTO agg.competition_strength(competition_season_id, strength, goals_per90, calc_run_id)
               SELECT e.cs, r.strength, e.goals, %(run)s FROM e LEFT JOIN r USING (cs)""",
            {"season": season, "run": run},
        )
        _publish(conn, run, "strength", f"season:{season}")


def refresh_squad_profiles(conn, season):
    """Minutes by age band (age on the match day) and squad value when sources exist."""
    with conn.transaction():
        conn.execute("DELETE FROM agg.team_squad_profile WHERE season_id=%s", (season,))
        conn.execute(
            """WITH a AS (
                 SELECT s.team_id, s.player_id, s.minutes_played AS minutes, core.age_on(p.birth_date, m.match_date) AS age
                 FROM core.player_match_stats s
                 JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id
                 JOIN core.players p ON p.id = s.player_id
                 WHERE s.season_id = %(season)s AND s.minutes_played > 0 AND s.team_id IS NOT NULL),
               v AS (
                 SELECT team_id, sum(value_eur) AS value FROM (
                   SELECT DISTINCT ON (a.team_id, a.player_id) a.team_id, mv.value_eur
                   FROM (SELECT DISTINCT team_id, player_id FROM a) a
                   JOIN core.player_market_values mv ON mv.player_id = a.player_id
                   ORDER BY a.team_id, a.player_id, mv.valued_at DESC, mv.as_of DESC) x GROUP BY team_id),
               g AS (
                 SELECT team_id,
                   sum(age * minutes)::double precision / nullif(sum(minutes) FILTER (WHERE age IS NOT NULL), 0) AS age_weighted,
                   sum(minutes) FILTER (WHERE age < 21) AS u21, sum(minutes) FILTER (WHERE age BETWEEN 21 AND 23) AS a21,
                   sum(minutes) FILTER (WHERE age BETWEEN 24 AND 26) AS a24, sum(minutes) FILTER (WHERE age BETWEEN 27 AND 29) AS a27,
                   sum(minutes) FILTER (WHERE age BETWEEN 30 AND 32) AS a30, sum(minutes) FILTER (WHERE age >= 33) AS a33,
                   count(age) AS known
                 FROM a GROUP BY team_id)
               INSERT INTO agg.team_squad_profile(team_id, season_id, squad_value_eur, value_rank, age_weighted,
                 minutes_u21, minutes_21_23, minutes_24_26, minutes_27_29, minutes_30_32, minutes_33_plus)
               SELECT g.team_id, %(season)s, v.value,
                 CASE WHEN v.value IS NOT NULL THEN rank() OVER (ORDER BY v.value DESC NULLS LAST) END,
                 g.age_weighted, g.u21, g.a21, g.a24, g.a27, g.a30, g.a33
               FROM g LEFT JOIN v USING (team_id)
               WHERE g.known > 0 OR v.value IS NOT NULL""",
            {"season": season},
        )


# Orchestration -------------------------------------------------------------


def process_cohorts(conn, *, limit=50, min_age_seconds=600):
    """Recalculate queued cohorts. A cohort waits `min_age_seconds` after its last change,
    so a match day recalculates a league a few times, not once per match."""
    claimed = conn.execute(
        """SELECT id, cohort_id, revision FROM ops.dirty_scopes
           WHERE scope_kind='cohort' AND queued_at <= now() - make_interval(secs => %s)
           ORDER BY queued_at, id LIMIT %s""",
        (min_age_seconds, limit),
    ).fetchall()
    seasons = set()
    for ident, cohort, revision in claimed:
        c = refresh_cohort(conn, cohort)
        seasons.add(c["season"])
        conn.execute("DELETE FROM ops.dirty_scopes WHERE id=%s AND revision=%s", (ident, revision))
        conn.execute(
            """INSERT INTO ops.resource_versions(resource_kind, resource_id, published_at) VALUES ('cohort', %s, now())
               ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1,
                 published_at = now(), updated_at = now()""",
            (cohort,),
        )
    for season in sorted(seasons):
        refresh_player_index(conn, season)
    return len(claimed)


def refresh_daily(conn, season, *, elo=True):
    """Once a day per active season: levels, strength, squad profiles, similarity, and
    the club and player power rankings (power.py). The clubs' Elo runs over every match
    at once: a pass over several seasons computes it once first (elo=False here)."""
    from . import power

    if elo:
        power.refresh_power(conn, season)
    else:
        power.refresh_players(conn, season)
    refresh_levels(conn, season)
    refresh_strength(conn, season)
    refresh_squad_profiles(conn, season)
    for (cohort,) in conn.execute("SELECT id FROM agg.cohorts WHERE season_id=%s ORDER BY id", (season,)).fetchall():
        refresh_similarity(conn, cohort)
    # The calculator keeps each edition's performance histogram (055) with its aggregates;
    # this pass recounts them all, so one missed refresh never outlives the day.
    editions = conn.execute(
        "SELECT DISTINCT competition_season_id FROM agg.player_season_stats WHERE season_id=%s ORDER BY 1", (season,)
    ).fetchall()
    for (edition,) in editions:
        with conn.transaction():
            conn.execute("SELECT agg.refresh_performance_distribution(%s)", (edition,))
    # The same for the player list's rows (060): every edition of the season that has a
    # statistics row or a line-up row, and those that still hold rows, so an edition whose
    # appearances are gone is emptied.
    editions = conn.execute(
        """SELECT DISTINCT m.competition_season_id FROM core.matches m
           WHERE m.season_id = %(season)s
             AND (EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.season_id = m.season_id AND s.match_id = m.id)
               OR EXISTS (SELECT 1 FROM core.lineup_players l WHERE l.season_id = m.season_id AND l.match_id = m.id))
           UNION SELECT competition_season_id FROM agg.player_list_editions WHERE season_id = %(season)s
           ORDER BY 1""",
        {"season": season},
    ).fetchall()
    for (edition,) in editions:
        with conn.transaction():
            conn.execute("SELECT agg.refresh_player_list(%s)", (edition,))


def refresh_season(conn, season):
    """Everything for one season, from its aggregates (backfill, tests)."""
    with conn.transaction():
        editions = [r[0] for r in conn.execute(
            "SELECT DISTINCT competition_season_id FROM agg.team_season_stats WHERE season_id=%s ORDER BY 1", (season,)
        )]
        cohorts = sorted({c for e in editions for c in ensure_cohorts(conn, e)})
    for cohort in cohorts:
        refresh_cohort(conn, cohort)
    refresh_player_index(conn, season)
    refresh_daily(conn, season)
    return cohorts


# Labels of displayed metrics (generated migration) ------------------------


def _literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def definitions_sql():
    """French labels, categories, directions and thresholds of every displayed metric.

    Club indicators are derived rows (their formula is the api.team_season expression);
    a key that is also a raw team metric keeps its aggregation rule and gains the label.
    """
    team = ",\n  ".join(
        "(" + ", ".join(_literal(v) for v in ("team", key, label, category, "derived", "recompute", direction, decimals, unit, CLUB_INDICATORS[key])) + ")"
        for key, (label, category, direction, decimals, unit) in TEAM_INDICATORS.items()
    )
    player = "\n".join(
        "UPDATE agg.metric_definitions SET label_fr = {}, category = {}, direction = {}, decimals = {}, min_minutes = {}, unit = {} "
        "WHERE entity_type = 'player' AND key = {};".format(
            _literal(label), _literal(category) + ("::agg.metric_category" if category else ""), direction, decimals,
            MIN_MINUTES, _literal("%" if ratio else "/90"), _literal(key),
        )
        for key, (label, category, direction, decimals, ratio) in PLAYER_RANKED.items()
    )
    return (
        "-- GENERATED by `python -m vega_v2.models` from vega_v2/models.py: do not edit.\n"
        "-- Labels and reading rules of the metrics the site ranks (docs/calculs 04-clubs/01, 05-joueurs/02).\n\n"
        "INSERT INTO agg.metric_definitions(entity_type, key, label_fr, category, source_family, aggregation, direction, decimals, unit, formula) VALUES\n  "
        + team
        + "\nON CONFLICT (entity_type, key) DO UPDATE SET label_fr = EXCLUDED.label_fr, category = EXCLUDED.category,\n"
        "  direction = EXCLUDED.direction, decimals = EXCLUDED.decimals, unit = EXCLUDED.unit, updated_at = now();\n\n"
        + player
        + "\n"
    )


if __name__ == "__main__":
    print(definitions_sql(), end="")
