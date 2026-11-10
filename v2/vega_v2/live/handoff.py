"""The hand-over to core (doc "Live", steps after the final whistle).

1. At the whistle in the live feed the state turns `finished`: the site shows a
   provisional result.
2. The site moves from live to core family by family (score, events, stats) as soon as
   PitchAPI has each one: the live state carries the families core already has.
3. On a difference between the live feed and PitchAPI (score, scorer), PitchAPI wins and
   the difference goes to ops.live_discrepancies; the live data itself is not kept.
4. The live data is deleted 24 h after core is complete, and 72 h after the match at the
   latest when a family never arrives (reads filter on expires_at).
"""

from datetime import timedelta

from .model import GOAL_TYPES

KEEP_AFTER_CORE = timedelta(hours=24)
KEEP_AT_MOST = timedelta(hours=72)


def core_view(conn, match_id):
    """What core has of the match: its final score, and whether events and team stats are
    in, with its goals as (team id, minute, player id), internal ids."""
    row = conn.execute(
        """SELECT m.status::text, m.home_score, m.away_score, mc.events::text, mc.team_stats::text, m.season_id
           FROM core.matches m LEFT JOIN core.match_coverage mc ON mc.season_id = m.season_id AND mc.match_id = m.id WHERE m.id = %s""",
        (match_id,),
    ).fetchone()
    if row is None:
        return None
    status, home_score, away_score, events, stats, season = row
    goals = []
    if events == "ok":
        goals = conn.execute(
            """SELECT e.team_id, e.minute, e.player_id FROM core.match_events e
               WHERE e.season_id = %s AND e.match_id = %s AND e.event_type = 'goal' ORDER BY e.seq""",
            (season, match_id),
        ).fetchall()
    return {
        "score": (home_score, away_score) if status == "finished" and home_score is not None and away_score is not None else None,
        "events": events == "ok",
        "stats": stats == "ok",
        "goals": goals,
    }


def families(view):
    """The families the site reads from core now (in FAMILIES order)."""
    if view is None:
        return []
    return [f for f, ok in (("score", view["score"] is not None), ("events", view["events"]), ("stats", view["stats"])) if ok]


def discrepancies(state, events, view, public=None):
    """[(field, live value, final value)] where the live feed and core disagree. `events`
    are the live items (cancelled goals left out); `public` maps core ids to public ids."""
    public = public or {}
    out = []
    if view is None:
        return out
    if view["score"] is not None and state.get("home_score") is not None:
        live = f"{state['home_score']}-{state['away_score']}"
        final = f"{view['score'][0]}-{view['score'][1]}"
        if live != final:
            out.append(("score", live, final))
    if view["events"]:
        live_goals = [e for e in events if e["event_type"] in GOAL_TYPES and not e.get("is_cancelled")]
        if len(live_goals) != len(view["goals"]):
            out.append(("goals", str(len(live_goals)), str(len(view["goals"]))))
        else:
            for n, (live, (team, minute, player_id)) in enumerate(zip(live_goals, view["goals"]), 1):
                final_team = public.get(("team", team))
                if live.get("team_id") and final_team and live["team_id"] != final_team:
                    out.append((f"goal:{n}:team", live["team_id"], final_team))
                final_player = public.get(("player", player_id))
                if live.get("player_id") and final_player and live["player_id"] != final_player:
                    out.append((f"goal:{n}:scorer", live["player_id"], final_player))
    return out


def record(conn, match_id, provider, found, now):
    with conn.transaction():
        for field, live, final in found:
            conn.execute(
                """INSERT INTO ops.live_discrepancies(match_id, provider, field, live_value, final_value, detected_at)
                   VALUES (%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (match_id, provider, field) DO UPDATE SET live_value=EXCLUDED.live_value,
                     final_value=EXCLUDED.final_value, detected_at=EXCLUDED.detected_at""",
                (match_id, provider, field, live, final, now),
            )


def expiry(kickoff_at, complete_at=None):
    """When the live data goes: 24 h after core is complete, 72 h after the match at most."""
    latest = kickoff_at + KEEP_AT_MOST
    return min(latest, complete_at + KEEP_AFTER_CORE) if complete_at else latest
