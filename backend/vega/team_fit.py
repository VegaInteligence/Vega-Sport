"""What a player brings to his team, for « Remplaçant » (VI-40): his share of his club's play,
his defensive work, his effort and his discipline, each placed among his role.

The read (/api/players/{id}/similar, replacement mode) compares a candidate's row with the row
of the player he would replace; this module only writes each player's own row, once a day after
the profile vectors (models.py). Method and edge cases: docs/calculs/05-joueurs/
13-remplacant-compatibilite-equipe.md.

- Main club: the club (not a national team) where he played the most minutes of the season, all
  competitions; at least MIN_MINUTES there, else no row.
- Shares of the club's play (touches, passes attempted, passes into the final third, chances,
  shots, defensive actions): Σ his_k / Σ_matches (team_k × his minutes / 90), on the matches of his
  club where both are known (at least MIN_MINUTES of them).
- Defensive work: tackles + interceptions + recoveries per 90, each match weighted by 50 / the
  opponents' possession. Replays of runs back are not measured: tracking without the ball is not
  in the base.
- Effort: distance, running and sprints per 90 where the distance is known (only the Premier
  League has them in 2026/27).
- Discipline: his fouls per 90 against his team's per player-90, and his card points (yellow 1,
  second yellow or red 2) pulled to his role's mean by CARD_PRIOR_MINUTES against his team's;
  from DISCIPLINE_MINUTES.
- Every value is placed among his role (MIN_PEERS players with it), else his line, else nowhere.
"""

from math import isfinite

MODEL_VERSION = "team-fit-v1"
MIN_MINUTES = 450
DISCIPLINE_MINUTES = 900
CARD_PRIOR_MINUTES = 900
MIN_PEERS = 30
TEAM_COVERAGE = 0.8  # a team total counts when the players measured hold this share of the team's minutes
SHARES = ("touches", "accurate_passes_total", "passes_into_final_third", "chances_created", "total_shots", "defensive_actions")
LINE = {"goalkeeper": "G", "centre_back": "D", "full_back": "D", "defensive_midfielder": "M", "central_midfielder": "M",
        "winger": "A", "centre_forward": "A"}


def known(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value)


def centile(peers, value):
    """The share of `peers` strictly below `value` plus half of those equal to it, out of 100."""
    if not peers or not known(value):
        return None
    below = sum(1 for p in peers if p < value)
    ties = sum(1 for p in peers if p == value)
    return round(100 * (below + ties / 2) / len(peers))


def cohort_centiles(rows):
    """Centiles of (role, value) rows: among the role when MIN_PEERS rows of it have a value,
    else among the line when it has MIN_PEERS, else None."""
    by_role, by_line = {}, {}
    for role, value in rows:
        if role in LINE and known(value):
            by_role.setdefault(role, []).append(value)
            by_line.setdefault(LINE[role], []).append(value)
    out = []
    for role, value in rows:
        if role not in LINE or not known(value):
            out.append(None)
            continue
        peers = by_role[role] if len(by_role[role]) >= MIN_PEERS else by_line[LINE[role]]
        out.append(centile(peers, value) if len(peers) >= MIN_PEERS else None)
    return out


def share(own_total, team_expected):
    """His total over the team's totals spread over his minutes (Σ team_k × minutes / 90)."""
    if not known(own_total) or not known(team_expected) or team_expected <= 0:
        return None
    return own_total / team_expected


def defensive_rate(matches):
    """(actions, his team's possession %, minutes) per match → actions per 90 weighted by
    50 / the opponents' possession; matches without possession or at 100 % are left out."""
    kept = [(a, p, m) for a, p, m in matches if known(a) and known(p) and p < 100 and known(m) and m > 0]
    minutes = sum(m for _, _, m in kept)
    if minutes < MIN_MINUTES:
        return None
    return 90 * sum(a * 50 / (100 - p) for a, p, _ in kept) / minutes


def shrunk_rate(points, minutes, role_rate, prior_minutes=CARD_PRIOR_MINUTES):
    """Card points per 90 pulled to the role's mean by `prior_minutes` of it."""
    return (points + role_rate * prior_minutes / 90) / ((minutes + prior_minutes) / 90)


def ratio(own_rate, team_rate):
    if not known(own_rate) or not known(team_rate) or team_rate <= 0:
        return None
    return own_rate / team_rate


def discipline_index(fouls_ratio, cards_ratio):
    """The mean of the known ratios (1 = as his team; higher = less disciplined)."""
    values = [v for v in (fouls_ratio, cards_ratio) if known(v)]
    return sum(values) / len(values) if values else None


def effort(distance_centile, running_centile, sprints_centile):
    """The mean of the known centiles; the distance is required."""
    if distance_centile is None:
        return None
    values = [v for v in (distance_centile, running_centile, sprints_centile) if v is not None]
    return round(sum(values) / len(values))


# Plain reads, summed in Python: one statement joining them all ran past two minutes on the
# 2026/27 base (20 Nov 2026).
# A blank the source left where it means zero (agg.match_zeros, 068: the row is measured and the
# match shows the statistic) reads as 0, as the list and the ranking read it.
ZEROS = ("passes_into_final_third", "chances_created", "total_shots")
_STATS = f"""
SELECT s.player_id, s.team_id, s.match_id, s.minutes_played,
  {", ".join(f"coalesce(s.{k}, CASE WHEN z.{k} AND s.touches IS NOT NULL THEN 0 END)" if k in ZEROS else f"s.{k}" for k in SHARES)},
  s.tackles, s.interceptions, s.recoveries, s.fouls, s.distance_m, s.running_m, s.sprints
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id AND m.status = 'finished'
JOIN core.teams t ON t.id = s.team_id AND t.is_national IS NOT TRUE
LEFT JOIN agg.match_zeros z ON z.season_id = s.season_id AND z.match_id = s.match_id
WHERE s.season_id = %(season)s AND s.minutes_played > 0
"""
_POSSESSION = "SELECT team_id, match_id, possession_pct FROM core.team_match_stats WHERE season_id = %(season)s AND period = 'all'"
_POINTS = """
SELECT match_id, player_id, sum(CASE WHEN event_type::text = 'yellow_card' THEN 1 ELSE 2 END)
FROM core.match_events
WHERE season_id = %(season)s AND player_id IS NOT NULL AND event_type::text IN ('yellow_card', 'second_yellow', 'red_card')
GROUP BY match_id, player_id
"""
_ROLES = "SELECT player_id, role FROM agg.player_power WHERE season_id = %(season)s"


def players_of(stats, possession, points, roles):
    """Each player's sums at his main club from the plain reads (same tuples as rows_of reads)."""
    possession = {(t, m): p for t, m, p in possession}
    points = {(m, p): n for m, p, n in points}
    roles = dict(roles)
    n = len(SHARES)
    # Team totals per match: known when the players measured hold TEAM_COVERAGE of the team's minutes
    # (a substitute without the figure no longer hides the whole match; 20 Nov 2026, on 2026/27 the
    # strict rule kept the shot share of 4 686 players out of 12 522).
    teams = {}
    for row in stats:
        player, team, match, minutes = row[:4]
        values = row[4:4 + n]
        fouls = row[4 + n + 3]
        t = teams.setdefault((team, match), {"minutes": 0, "rows": 0, "known": [0] * n, "known_minutes": [0] * n, "sums": [0.0] * n, "fouls": 0, "fouls_known": 0, "points": 0})
        t["minutes"] += minutes
        t["rows"] += 1
        for i, v in enumerate(values):
            if known(v):
                t["known"][i] += 1
                t["known_minutes"][i] += minutes
                t["sums"][i] += v
        if known(fouls):
            t["fouls_known"] += 1
            t["fouls"] += fouls
        t["points"] += points.get((match, player), 0)
    # The main club: most minutes.
    minutes_at = {}
    for row in stats:
        minutes_at[(row[0], row[1])] = minutes_at.get((row[0], row[1]), 0) + row[3]
    main = {}
    for (player, team), minutes in sorted(minutes_at.items()):
        if player not in main or minutes > main[player][1]:
            main[player] = (team, minutes)
    # Team season rates per player-90: fouls and card points.
    team_season = {}
    for (team, _), t in teams.items():
        r = team_season.setdefault(team, {"minutes": 0, "fouls": 0, "foul_minutes": 0, "points": 0})
        r["minutes"] += t["minutes"]
        r["points"] += t["points"]
        if t["fouls_known"] == t["rows"]:
            r["fouls"] += t["fouls"]
            r["foul_minutes"] += t["minutes"]
    acc = {}
    for row in sorted(stats, key=lambda r: (r[0], r[2])):
        player, team, match, minutes = row[:4]
        if main.get(player, (None,))[0] != team or main[player][1] < MIN_MINUTES:
            continue
        values = row[4:4 + n]
        tackles, interceptions, recoveries, fouls, distance, running, sprints = row[4 + n:]
        t = teams[(team, match)]
        a = acc.setdefault(player, {"own": [0.0] * n, "expected": [0.0] * n, "measured": [0] * n, "actions": [], "possession": [], "mins": [],
                                     "distance": 0.0, "running": 0.0, "sprints": 0.0, "phys": 0, "fouls": 0.0, "foul_minutes": 0, "points": 0})
        for i, v in enumerate(values):
            if known(v) and t["known_minutes"][i] >= TEAM_COVERAGE * t["minutes"]:
                a["own"][i] += v
                a["expected"][i] += t["sums"][i] * minutes / 90
                a["measured"][i] += minutes
        a["actions"].append(tackles + interceptions + recoveries if all(known(v) for v in (tackles, interceptions, recoveries)) else None)
        a["possession"].append(possession.get((team, match)))
        a["mins"].append(minutes)
        if known(distance):
            a["distance"] += distance
            a["phys"] += minutes
            a["running"] += running if known(running) else 0
            a["sprints"] += sprints if known(sprints) else 0
        if known(fouls):
            a["fouls"] += fouls
            a["foul_minutes"] += minutes
        a["points"] += points.get((match, player), 0)
    out = []
    for player in sorted(acc):
        team, minutes = main[player]
        a, r = acc[player], team_season[team]
        shares = [x for i in range(n) for x in (a["own"][i], a["expected"][i], a["measured"][i])]
        team_fouls = 90 * r["fouls"] / r["foul_minutes"] if r["foul_minutes"] else None
        team_points = 90 * r["points"] / r["minutes"] if r["minutes"] else None
        out.append((player, team, minutes, roles.get(player), *shares, a["actions"], a["possession"], a["mins"],
                    a["distance"] if a["phys"] else None, a["running"] if a["phys"] else None, a["sprints"] if a["phys"] else None,
                    a["phys"] or None, a["fouls"] if a["foul_minutes"] else None, a["foul_minutes"] or None, a["points"], team_fouls, team_points))
    return out


COLUMNS = ("season_id", "player_id", "team_id", "role", "minutes",
           "share_touches", "share_passes", "share_final_third", "share_chances", "share_shots", "share_defensive",
           "role_touches", "role_passes", "role_final_third", "role_chances", "role_shots", "role_defensive",
           "defensive_p90", "defensive", "distance_p90", "running_p90", "sprints_p90", "physical_minutes", "effort",
           "fouls_p90", "card_points_p90", "discipline_index", "discipline", "version")


def rows_of(raw):
    """Each player's row from the read's tuples (pure: the centiles need every player)."""
    players = []
    for r in raw:
        player, team, minutes, role = r[0], r[1], r[2], r[3]
        rest = r[4:]
        shares = []
        for i in range(len(SHARES)):
            own, expected, measured = rest[3 * i], rest[3 * i + 1], rest[3 * i + 2]
            shares.append(share(own, expected) if known(measured) and measured >= MIN_MINUTES else None)
        rest = rest[3 * len(SHARES):]
        actions, possession, mins, distance, running, sprints, phys_minutes, fouls, foul_minutes, points, team_fouls, team_points = rest
        defence = defensive_rate(list(zip(actions or [], possession or [], mins or [])))
        physical = phys_minutes if known(phys_minutes) and phys_minutes >= MIN_MINUTES else None
        per = (lambda total: 90 * total / physical if physical and known(total) else None)
        fouls_p90 = 90 * fouls / foul_minutes if known(fouls) and known(foul_minutes) and foul_minutes > 0 else None
        players.append({"player": player, "team": team, "minutes": minutes, "role": role, "shares": shares, "defence": defence,
                        "distance": per(distance), "running": per(running), "sprints": per(sprints), "physical": physical,
                        "fouls_p90": fouls_p90, "points": float(points or 0), "team_fouls": team_fouls, "team_points": team_points})
    # Card points pulled to the role's mean (per 90, over the role's players with a row).
    role_points = {}
    for p in players:
        if p["role"]:
            total, minutes = role_points.get(p["role"], (0.0, 0))
            role_points[p["role"]] = (total + p["points"], minutes + p["minutes"])
    for p in players:
        total, minutes = role_points.get(p["role"], (0.0, 0))
        mean = 90 * total / minutes if minutes else 0.0
        p["cards_p90"] = shrunk_rate(p["points"], p["minutes"], mean)
        index = discipline_index(ratio(p["fouls_p90"], p["team_fouls"]), ratio(p["cards_p90"], p["team_points"]))
        p["index"] = index if p["minutes"] >= DISCIPLINE_MINUTES else None
    place = lambda key: cohort_centiles([(p["role"], key(p)) for p in players])
    shares_c = [place(lambda p, i=i: p["shares"][i]) for i in range(len(SHARES))]
    defence_c, distance_c, running_c, sprints_c = place(lambda p: p["defence"]), place(lambda p: p["distance"]), \
        place(lambda p: p["running"]), place(lambda p: p["sprints"])
    index_c = place(lambda p: p["index"])
    out = []
    for n, p in enumerate(players):
        out.append((p["player"], p["team"], p["role"], p["minutes"], *p["shares"], *[shares_c[i][n] for i in range(len(SHARES))],
                    p["defence"], defence_c[n], p["distance"], p["running"], p["sprints"], p["physical"],
                    effort(distance_c[n], running_c[n], sprints_c[n]),
                    p["fouls_p90"], p["cards_p90"], p["index"], None if index_c[n] is None else 100 - index_c[n], MODEL_VERSION))
    return out


def refresh(conn, season):
    """Write the season's rows; returns how many. Read, compute, write: no transaction stays
    open while the centiles are computed (the base ends a session idle in a transaction)."""
    params = {"season": season}
    raw = players_of(conn.execute(_STATS, params).fetchall(), conn.execute(_POSSESSION, params).fetchall(),
                     conn.execute(_POINTS, params).fetchall(), conn.execute(_ROLES, params).fetchall())
    rows = rows_of(raw)
    with conn.transaction():
        conn.execute("DELETE FROM agg.player_team_fit WHERE season_id = %s", (season,))
        if rows:
            with conn.cursor().copy(f"COPY agg.player_team_fit({', '.join(COLUMNS)}) FROM STDIN") as copy:
                for row in rows:
                    copy.write_row((season, *row))
    return len(rows)
