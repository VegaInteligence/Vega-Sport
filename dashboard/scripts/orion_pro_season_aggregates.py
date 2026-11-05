#!/usr/bin/env python3
"""Per-build season read models (approved design: docs/architecture/orion-read-models-20261105/PLAN.md).

Written inside the publisher's build transaction, before the build turns READY,
for one edition at the build's dataset generation ``g``. One statement computes
the played performances and their observed native values once, then fills:

* analytics.player_competition_team_stats  (build × player × team)
* analytics.player_competition_stats       (build × player)
* analytics.team_competition_stats         (build × team, from the build's match_summary)
* analytics.metric_totals                  (build × {player, player_team, team, competition} × 31 metrics)

Semantics mirror the site's current client aggregation (season-player.js):
a performance counts as played when its native minutes is a number > 0; a stat
total sums only observed numeric values; eligible_minutes are the minutes of the
performances where that value was observed; a metric never observed gives NULL,
never 0. Participants are resolved by logical identity at ``g`` (admission may
re-revise them without re-anchoring facts). numerator/denominator carry the
minutes-weighted form (sum(value*minutes), sum(minutes)).
"""
from __future__ import annotations

CONTRACT = 'orion_pro_season_aggregates_v1'
PREFIX = 'legacy_normalized_'


def selected(alias):
    return (f"{alias}.recorded_from_gen<=%(g)s AND ({alias}.recorded_to_gen IS NULL OR %(g)s<{alias}.recorded_to_gen) "
            f"AND {alias}.is_canonical AND NOT {alias}.is_deleted")


def metric(name):
    return f"metric_code='{PREFIX}{name}'"


SUBJECTS = {  # subject_kind: (group keys, player expression, team expression)
    'player': (['player_id'], 'e.player_id', 'NULL::bigint'),
    'player_team': (['player_id', 'team_id'], 'e.player_id', 'e.team_id'),
    'team': (['team_id'], 'NULL::bigint', 'e.team_id'),
    'competition': ([], 'NULL::bigint', 'NULL::bigint'),
}

STAT_COLUMNS = {  # target column: (native field, SQL cast)
    'goals': ('goals', 'integer'), 'assists': ('assists', 'integer'), 'shots': ('shots', 'integer'),
    'shots_on_target': ('shotsOnTarget', 'integer'), 'passes_completed': ('passesAccurate', 'integer'),
    'passes_attempted': ('passesAttempted', 'integer'), 'xg': ('xg', 'double precision'),
    'xa': ('xa', 'double precision'), 'goals_prevented': ('goalsPrevented', 'double precision'),
}


def player_stats(keys, table):
    group = ','.join(keys)
    sums = ','.join(f"(sum(v.numeric_value) FILTER (WHERE v.{metric(field)}))::{cast}" for field, cast in STAT_COLUMNS.values())
    join = ' AND '.join(f'pv.{k}=pt.{k}' for k in keys)
    return f"""{table}_rows AS (
 INSERT INTO analytics.{table} (build_id,competition_season_id,{group},appearances,starts,minutes_played,{','.join(STAT_COLUMNS)},provider_rating_weighted)
 SELECT %(build)s,%(eid)s,{','.join('pt.' + k for k in keys)},pt.apps,pt.starts,pt.minutes,{','.join('pv.' + c for c in STAT_COLUMNS)},
  pv.rating_num/NULLIF(pv.rating_den,0)
 FROM (SELECT {group},count(*)::integer apps,(count(*) FILTER (WHERE is_starter))::integer starts,sum(minutes)::double precision minutes
       FROM perf GROUP BY {group}) pt
 LEFT JOIN (SELECT {','.join('v.' + k for k in keys)},{sums.replace(')::', ')::')} {''},
       sum(v.numeric_value*v.minutes) FILTER (WHERE v.{metric('rating')}) rating_num,
       sum(v.minutes) FILTER (WHERE v.{metric('rating')}) rating_den
       FROM vals v GROUP BY {','.join('v.' + k for k in keys)}) pv ON {join}
 RETURNING 1)"""


def player_stat_select_fix(sql):
    # Name the conditional sums after their target columns.
    for column, (field, cast) in STAT_COLUMNS.items():
        expr = f"(sum(v.numeric_value) FILTER (WHERE v.{metric(field)}))::{cast}"
        sql = sql.replace(expr, expr + ' ' + column, 1)
    return sql


def metric_rows(kind):
    keys, player, team = SUBJECTS[kind]
    group = ','.join(keys)
    by_keys = f'GROUP BY {group}' if keys else ''
    elig_cols = (group + ',') if keys else ''
    agg_cols = (','.join('v.' + k for k in keys) + ',') if keys else ''
    join = ' AND '.join([f'a.{k}=e.{k}' for k in keys] + ['a.metric_code=d.code'])
    return f"""{kind}_metrics AS (
 INSERT INTO analytics.metric_totals (build_id,subject_kind,match_id,player_id,team_id,metric_code,numeric_value,observed_count,
  eligible_count,eligible_minutes,numerator,denominator,coverage_state,match_revision_id,metric_definition_version)
 SELECT %(build)s,'{kind}',NULL,{player},{team},d.code,a.total,coalesce(a.observed,0),e.eligible,a.minutes,a.numerator,a.minutes,
  CASE WHEN coalesce(a.observed,0)=0 THEN 'unavailable' WHEN a.observed<e.eligible THEN 'partial' ELSE 'available' END,
  NULL,d.definition_version
 FROM (SELECT {elig_cols}count(*) eligible FROM perf {by_keys}) e CROSS JOIN defs d
 LEFT JOIN (SELECT {agg_cols}v.metric_code,sum(v.numeric_value) total,count(*) observed,sum(v.minutes) minutes,
       sum(v.numeric_value*v.minutes) numerator FROM vals v GROUP BY {agg_cols}v.metric_code) a ON {join}
 RETURNING 1)"""


def statement():
    return f"""WITH m AS (
 SELECT m.id FROM football.matches m
 WHERE m.competition_season_id=%(eid)s AND m.publication_state='published' AND {selected('m')}
), perf AS (
 SELECT s.match_id,s.player_id,s.team_id,s.period_code,mn.numeric_value AS minutes,mp.is_starter
 FROM m JOIN football.player_match_stats s ON s.match_id=m.id AND s.period_code='full_match' AND {selected('s')}
 JOIN football.match_players mp ON mp.match_id=s.match_id AND mp.player_id=s.player_id AND mp.team_id=s.team_id AND {selected('mp')}
 JOIN football.player_match_metric_values mn ON mn.match_id=s.match_id AND mn.player_id=s.player_id AND mn.team_id=s.team_id
  AND mn.period_code=s.period_code AND mn.family_code='standard' AND mn.{metric('minutes')} AND {selected('mn')}
  AND mn.value_kind='number' AND mn.numeric_value>0
), vals AS (
 SELECT p.match_id,p.player_id,p.team_id,p.minutes,n.metric_code,n.numeric_value
 FROM perf p JOIN football.player_match_metric_values n ON n.match_id=p.match_id AND n.player_id=p.player_id
  AND n.team_id=p.team_id AND n.period_code=p.period_code AND n.family_code='standard' AND {selected('n')}
  AND n.value_kind='number' AND n.metric_code LIKE '{PREFIX}%%'
), defs AS (
 SELECT d.code,d.definition_version FROM football.metric_definitions d
 WHERE d.code LIKE '{PREFIX}%%' AND d.recorded_from_gen<=%(g)s AND (d.recorded_to_gen IS NULL OR %(g)s<d.recorded_to_gen)
), sides AS (
 SELECT q.match_id,q.home_team_id AS team_id,q.away_team_id AS opponent_id,q.home_goals AS gf,q.away_goals AS ga,q.status,q.score_scope
 FROM analytics.match_summary q WHERE q.build_id=%(build)s
 UNION ALL
 SELECT q.match_id,q.away_team_id,q.home_team_id,q.away_goals,q.home_goals,q.status,q.score_scope
 FROM analytics.match_summary q WHERE q.build_id=%(build)s
), match_xg AS (
 SELECT match_id,team_id,sum(numeric_value) xg FROM vals WHERE {metric('xg')} GROUP BY match_id,team_id
), team_rows AS (
 INSERT INTO analytics.team_competition_stats (build_id,competition_season_id,team_id,matches_played,wins,draws,losses,
  goals_for,goals_against,xg_for,xg_against,points_calculated)
 SELECT %(build)s,%(eid)s,t.team_id,
  count(*) FILTER (WHERE t.played)::integer,count(*) FILTER (WHERE t.played AND t.gf>t.ga)::integer,
  count(*) FILTER (WHERE t.played AND t.gf=t.ga)::integer,count(*) FILTER (WHERE t.played AND t.gf<t.ga)::integer,
  (sum(t.gf) FILTER (WHERE t.played))::integer,(sum(t.ga) FILTER (WHERE t.played))::integer,
  (sum(own.xg) FILTER (WHERE t.played))::double precision,(sum(opp.xg) FILTER (WHERE t.played))::double precision,
  (3*count(*) FILTER (WHERE t.played AND t.gf>t.ga)+count(*) FILTER (WHERE t.played AND t.gf=t.ga))::integer
 FROM (SELECT s.*,(s.status='finished' AND s.score_scope='final_without_shootout' AND s.gf IS NOT NULL AND s.ga IS NOT NULL) played
       FROM sides s) t
 LEFT JOIN match_xg own ON own.match_id=t.match_id AND own.team_id=t.team_id
 LEFT JOIN match_xg opp ON opp.match_id=t.match_id AND opp.team_id=t.opponent_id
 GROUP BY t.team_id
 RETURNING 1
), {player_stat_select_fix(player_stats(['player_id', 'team_id'], 'player_competition_team_stats'))},
{player_stat_select_fix(player_stats(['player_id'], 'player_competition_stats'))},
{','.join(metric_rows(kind) for kind in SUBJECTS)}
SELECT (SELECT count(*) FROM perf) performances,(SELECT count(*) FROM vals) observed_values,
 (SELECT count(*) FROM team_rows) teams,(SELECT count(*) FROM player_competition_team_stats_rows) player_teams,
 (SELECT count(*) FROM player_competition_stats_rows) players,
 {'+'.join(f'(SELECT count(*) FROM {kind}_metrics)' for kind in SUBJECTS)} metric_rows"""


def write(conn, build_id, edition_id, generation):
    """Fill the four read models for one build; returns the row counts."""
    row = conn.execute(statement(), {'build': build_id, 'eid': edition_id, 'g': generation}).fetchone()
    return dict(zip(['performances', 'observedValues', 'teams', 'playerTeams', 'players', 'metricRows'], row))


if __name__ == '__main__':
    print(statement())
