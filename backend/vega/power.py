"""Power rankings of clubs and players: docs/METHODE_CLASSEMENT_BALLON_D_OR.md (main).

Club power ranking (§ 3): an Elo strength, updated chronologically over every finished
match the base holds; a match is contextualised with the strengths *before* it. Leagues are tied
together by the European club matches; clubs and national teams are ranked apart.

Player power ranking (§§ 4–8), the role-relative method:
  x̂ = expected value for the role, the minutes and the opponent;
  c = d · (x − x̂) / s           (§ 6.1)
  C = Σ_b W_r,b · mean_k∈b(c)    (§ 6.2, over the blocks the match has)
  T = Σ_m C,  R* = 90 T / (M + λ),  B = 0.75 Pct_r(T) + 0.25 Pct_r(R*)   (§ 8)

The method leaves points open (its § 12). Each choice is a named setting below, stored
with every run (agg.power_runs) and listed in backend/README.md:
- Elo: initial 1500, K 20, home advantage 60 points (none on neutral ground), expected
  score 1 / (1 + 10^((R_opp − R_own − h) / 400)), result after extra time (a shoot-out
  is a draw), every finished club or national-team match of the PitchAPI era (archives
  and complementary cup sources join once their teams are linked to the same clubs).
- Universe of a season: its finished club matches, national teams excluded; a
  player-match counts when the player played.
- Roles: the line-up slot of the match (core.power_role); a substitute takes his most
  played role of the season, else his line's default.
- Volume indicators: x̂ = (t / 90) · exp(α + β Δ), Δ = (Elo_opp − Elo_own) / 400 before
  the match, α and β fitted by Poisson maximum likelihood per role and indicator on the
  season (β = 0 below MIN_FIT matches): the "régression simple" of § 5.1.
- Conditional indicators: x̂ = attempts × the role's success rate (§ 5.2).
- Goals prevented (§ 7.2): already measured against the xGOT faced, x̂ = 0.
- s: the root mean square of x − x̂ for the role; an indicator with s = 0 or fewer than
  MIN_REFERENCE matches is left out. A missing value is never a zero: its indicator, or
  its block, is left out of that match, the block weights renormalised.
- Blocks: the indicators below, with equal weights inside a block.
- Main role: the role with the most minutes; eligibility 900 minutes; percentiles are
  the site's "rang moyen" (#below + ½ #equal) / n within the main role.
"""

from collections import defaultdict
from math import exp, log, sqrt

METHOD_VERSION = "power-ranking-v1"
ELO_INITIAL = 1500.0
ELO_K = 20.0
ELO_HOME = 60.0
LAMBDA = 450.0
ELIGIBILITY = 900.0
TOTAL_WEIGHT = 0.75
RATE_WEIGHT = 0.25
MIN_REFERENCE = 30
MIN_FIT = 200
LINE_DEFAULT = {0: "goalkeeper", 1: "centre_back", 2: "central_midfielder", 3: "centre_forward"}

# Blocks and their indicators: (name, kind, direction[, attempts column]).
# kind: "volume" (per minutes and opponent), "conditional" (per attempt), "relative" (x̂ = 0).
OUTFIELD_BLOCKS = {
    "finishing": [("np_goals", "volume", 1), ("npxg", "volume", 1), ("shots_on_target", "volume", 1), ("big_chances_missed", "volume", -1)],
    "creation": [("assists", "volume", 1), ("xa", "volume", 1), ("chances_created", "volume", 1), ("big_chances_created", "volume", 1)],
    "progression": [("passes_into_final_third", "volume", 1), ("progressive_passes", "volume", 1), ("progressive_carries", "volume", 1),
                    ("dribbles_succeeded", "conditional", 1, "dribbles_total")],
    "defence": [("tackles", "volume", 1), ("interceptions", "volume", 1), ("recoveries", "volume", 1), ("clearances", "volume", 1),
                ("shot_blocks", "volume", 1), ("duels_won", "conditional", 1, "duels_attempted"), ("aerials_won", "conditional", 1, "aerials_total"),
                ("dribbled_past", "volume", -1), ("errors_led_to_goal", "volume", -1)],
    "retention": [("accurate_passes", "conditional", 1, "accurate_passes_total"), ("dispossessed", "volume", -1), ("touches", "volume", 1)],
}
KEEPER_BLOCKS = {
    "shot_stopping": [("goals_prevented", "relative", 1)],
    "aerial": [("high_claims", "volume", 1), ("punches", "volume", 1)],
    "depth": [("sweeper_actions", "volume", 1)],
    "distribution": [("accurate_passes", "conditional", 1, "accurate_passes_total"), ("long_balls_accurate", "conditional", 1, "long_balls_total")],
}
# § 6.2 and § 7.3 block weights.
WEIGHTS = {
    "centre_forward": {"finishing": 0.45, "creation": 0.20, "progression": 0.15, "defence": 0.10, "retention": 0.10},
    "winger": {"finishing": 0.20, "creation": 0.35, "progression": 0.25, "defence": 0.10, "retention": 0.10},
    "central_midfielder": {"finishing": 0.10, "creation": 0.25, "progression": 0.25, "defence": 0.20, "retention": 0.20},
    "defensive_midfielder": {"finishing": 0.05, "creation": 0.15, "progression": 0.20, "defence": 0.40, "retention": 0.20},
    "full_back": {"finishing": 0.05, "creation": 0.25, "progression": 0.25, "defence": 0.30, "retention": 0.15},
    "centre_back": {"finishing": 0.05, "creation": 0.05, "progression": 0.15, "defence": 0.55, "retention": 0.20},
    "goalkeeper": {"shot_stopping": 0.60, "aerial": 0.15, "depth": 0.10, "distribution": 0.15},
}
BLOCK_COLUMNS = ("finishing", "creation", "progression", "defence", "retention", "shot_stopping", "aerial", "depth", "distribution")
assert all(abs(sum(w.values()) - 1) < 1e-9 for w in WEIGHTS.values())


def blocks_of(role):
    return KEEPER_BLOCKS if role == "goalkeeper" else OUTFIELD_BLOCKS


def _start(conn, kind, season=None, **counts):
    return conn.execute(
        """INSERT INTO agg.power_runs(kind, season_id, method_version, elo_initial, elo_k, elo_home_advantage, regularisation_minutes,
             eligibility_minutes, total_weight, rate_weight, min_reference_matches)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (kind, season, METHOD_VERSION, ELO_INITIAL, ELO_K, ELO_HOME, LAMBDA, ELIGIBILITY, TOTAL_WEIGHT, RATE_WEIGHT, MIN_REFERENCE),
    ).fetchone()[0]


def _publish(conn, run, kind, season, matches, players=None):
    conn.execute(
        "UPDATE agg.power_runs SET status='superseded' WHERE kind=%s AND season_id IS NOT DISTINCT FROM %s AND status='published'",
        (kind, season),
    )
    conn.execute("UPDATE agg.power_runs SET status='published', finished_at=now(), matches=%s, players=%s WHERE id=%s", (matches, players, run))


# Clubs: Elo (§ 3) ----------------------------------------------------------


def expected_score(own, opponent, home_advantage):
    return 1 / (1 + 10 ** ((opponent - own - home_advantage) / 400))


def elo_updates(matches, *, initial=ELO_INITIAL, k=ELO_K, home=ELO_HOME):
    """`matches`: (match, season, kickoff, home team, away team, home score, away score,
    neutral) in match order. Yields one row per side: (match, team, season, kickoff,
    before, after, expected, result)."""
    rating = defaultdict(lambda: initial)
    for mid, season, kickoff, h, a, hs, as_, neutral in matches:
        rh, ra = rating[h], rating[a]
        advantage = 0.0 if neutral else home
        eh = expected_score(rh, ra, advantage)
        result = 1.0 if hs > as_ else 0.0 if hs < as_ else 0.5
        rating[h] = rh + k * (result - eh)
        rating[a] = ra + k * ((1 - result) - (1 - eh))
        yield (mid, h, season, kickoff, rh, rating[h], eh, result)
        yield (mid, a, season, kickoff, ra, rating[a], 1 - eh, 1 - result)


ELO_MATCHES = """
SELECT m.id, m.season_id, m.kickoff_at, m.home_team_id, m.away_team_id, m.home_score, m.away_score, coalesce(m.is_neutral, false)
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
ORDER BY m.kickoff_at NULLS LAST, m.match_date NULLS LAST, m.id"""


def refresh_elo(conn):
    """Recompute every strength in match order, then each season's club power ranking."""
    with conn.transaction():
        run = _start(conn, "elo")
        rows = list(elo_updates(conn.execute(ELO_MATCHES).fetchall()))
        conn.execute("DELETE FROM agg.team_power")
        conn.execute("DELETE FROM agg.team_elo")
        with conn.cursor().copy(
            "COPY agg.team_elo(match_id, team_id, season_id, kickoff_at, elo_before, elo_after, expected, result, run_id) FROM STDIN"
        ) as copy:
            for row in rows:
                copy.write_row((*row, run))
        conn.execute(
            """WITH season AS (
                 SELECT season_id, team_id, max(elo_after) AS peak, min(elo_after) AS low,
                   count(*) FILTER (WHERE result = 1) AS wins, count(*) FILTER (WHERE result = 0.5) AS draws,
                   count(*) FILTER (WHERE result = 0) AS losses, sum(result) AS result_sum, sum(expected) AS expected_sum
                 FROM agg.team_elo GROUP BY season_id, team_id),
               last AS (
                 SELECT DISTINCT ON (e.season_id, e.team_id) e.season_id, e.team_id, e.elo_after, e.kickoff_at,
                   count(*) OVER (PARTITION BY e.season_id, e.team_id) AS matches,
                   first_value(e.elo_before) OVER (PARTITION BY e.season_id, e.team_id ORDER BY e.kickoff_at NULLS FIRST, e.match_id) AS start
                 FROM agg.team_elo e
                 ORDER BY e.season_id, e.team_id, e.kickoff_at DESC NULLS LAST, e.match_id DESC)
               INSERT INTO agg.team_power(season_id, team_id, scope, elo, elo_change, matches, rank, last_match_at, run_id,
                 elo_start, elo_peak, elo_low, wins, draws, losses, result_sum, expected_sum)
               SELECT l.season_id, l.team_id, CASE WHEN t.is_national THEN 'nations' ELSE 'clubs' END, l.elo_after, l.elo_after - l.start,
                 l.matches, rank() OVER (PARTITION BY l.season_id, t.is_national IS TRUE ORDER BY l.elo_after DESC), l.kickoff_at, %s,
                 l.start, s.peak, s.low, s.wins, s.draws, s.losses, s.result_sum, s.expected_sum
               FROM last l JOIN season s USING (season_id, team_id) JOIN core.teams t ON t.id = l.team_id""",
            (run,),
        )
        _publish(conn, run, "elo", None, len(rows) // 2)
    return len(rows) // 2


# Players: the role-relative method (§§ 4–8) --------------------------------

PLAYER_MATCHES = """
SELECT s.match_id, s.player_id, s.team_id, s.minutes_played, coalesce(lp.position_id, s.position_id) AS position_id, lp.is_starter,
  own.elo_before AS own_elo, opp.elo_before AS opponent_elo,
  CASE WHEN mc.events = 'ok' THEN s.goals - (SELECT count(*) FROM core.match_events e
    WHERE e.season_id = s.season_id AND e.match_id = s.match_id AND e.player_id = s.player_id
      AND e.event_type = 'goal' AND e.is_penalty AND e.is_own_goal IS NOT TRUE) END AS np_goals,
  s.npxg, s.shots_on_target, s.big_chances_missed, s.assists, s.xa, s.chances_created, s.big_chances_created,
  s.passes_into_final_third, a.progressive_passes, a.progressive_carries, s.dribbles_succeeded, s.dribbles_total,
  s.tackles, s.interceptions, s.recoveries, s.clearances, s.shot_blocks, s.duels_won, s.duels_won + s.duels_lost AS duels_attempted,
  s.aerials_won, s.aerials_total, s.dribbled_past, s.errors_led_to_goal, s.accurate_passes, s.accurate_passes_total,
  s.dispossessed, s.touches, s.goals_prevented, s.high_claims, s.punches, s.sweeper_actions, s.long_balls_accurate, s.long_balls_total
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id AND m.status = 'finished'
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
JOIN core.teams t ON t.id = s.team_id AND t.is_national IS NOT TRUE
LEFT JOIN core.match_coverage mc ON mc.season_id = s.season_id AND mc.match_id = s.match_id
LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
LEFT JOIN core.player_match_advanced a ON a.season_id = s.season_id AND a.match_id = s.match_id AND a.player_id = s.player_id
LEFT JOIN agg.team_elo own ON own.match_id = s.match_id AND own.team_id = s.team_id
LEFT JOIN agg.team_elo opp ON opp.match_id = s.match_id AND opp.team_id <> s.team_id
WHERE s.season_id = %s AND s.minutes_played > 0"""


def _num(v):
    return None if v is None else float(v)


def assign_roles(rows):
    """The role of each player-match: its slot's, else the player's most played role."""
    slot_role = {}
    minutes = defaultdict(lambda: defaultdict(float))
    for r in rows:
        pos = r["position_id"]
        role = None
        if pos is not None and pos > 3:
            role = ROLE_OF_SLOT(pos)
        slot_role[(r["match_id"], r["player_id"])] = role
        if role:
            minutes[r["player_id"]][role] += r["minutes_played"]
    for r in rows:
        role = slot_role[(r["match_id"], r["player_id"])]
        if role is None:
            played = minutes.get(r["player_id"])
            pos = r["position_id"]
            if pos == 0:
                role = "goalkeeper"
            elif played:
                role = max(sorted(played), key=lambda x: played[x])
            else:
                role = LINE_DEFAULT.get(pos)
            if role is None and r.get("goals_prevented") is not None:
                role = "goalkeeper"
        r["role"] = role
    return [r for r in rows if r["role"]]


def ROLE_OF_SLOT(pos):  # core.power_role, mirrored for the in-memory pass (tested equal)
    if pos in (0, 11):
        return "goalkeeper"
    if pos in (51, 59):
        return "full_back"
    if 30 <= pos <= 39:
        return "full_back" if pos % 10 in (1, 2, 8, 9) else "centre_back"
    if 50 <= pos <= 69:
        return "defensive_midfielder"
    if 70 <= pos <= 79:
        return "central_midfielder"
    if 80 <= pos <= 89:
        return "winger"
    if 90 <= pos <= 119:
        return "winger" if pos % 10 in (1, 2, 8, 9) else "centre_forward"
    return None


def fit_poisson(obs, iterations=25):
    """α, β of x ~ Poisson((t/90) · exp(α + β Δ)); obs = [(x, t/90, Δ)]."""
    sx = sum(x for x, _, _ in obs)
    sw = sum(w for _, w, _ in obs)
    if sx <= 0 or sw <= 0:
        return None
    a, b = log(sx / sw), 0.0
    if len(obs) < MIN_FIT or all(d == 0 for _, _, d in obs):
        return a, 0.0
    for _ in range(iterations):
        ga = gb = haa = hab = hbb = 0.0
        for x, w, d in obs:
            mu = w * exp(a + b * d)
            ga += x - mu
            gb += (x - mu) * d
            haa += mu
            hab += mu * d
            hbb += mu * d * d
        det = haa * hbb - hab * hab
        if det <= 1e-12:
            return log(sx / sw), 0.0
        da = (hbb * ga - hab * gb) / det
        db = (haa * gb - hab * ga) / det
        a, b = a + da, max(-3.0, min(3.0, b + db))
        if abs(da) < 1e-9 and abs(db) < 1e-9:
            break
    return a, b


def references(rows):
    """Per role and indicator: how to expect a value, and the dispersion s (§§ 5–6)."""
    by_role = defaultdict(list)
    for r in rows:
        by_role[r["role"]].append(r)
    refs = {}
    for role, items in by_role.items():
        for indicators in blocks_of(role).values():
            for spec in indicators:
                name, kind = spec[0], spec[1]
                if kind == "volume":
                    obs = [(r[name], r["minutes_played"] / 90, r["delta"]) for r in items if r[name] is not None]
                    if len(obs) < MIN_REFERENCE:
                        continue
                    fit = fit_poisson(obs)
                    if fit is None:
                        continue
                    a, b = fit
                    expect = (lambda a, b: lambda r: r["minutes_played"] / 90 * exp(a + b * r["delta"]))(a, b)
                elif kind == "conditional":
                    attempts = spec[3]
                    obs = [r for r in items if r[name] is not None and r[attempts] is not None]
                    made, tried = sum(r[name] for r in obs), sum(r[attempts] for r in obs)
                    if len(obs) < MIN_REFERENCE or tried <= 0:
                        continue
                    p = made / tried
                    expect = (lambda p, attempts: lambda r: r[attempts] * p)(p, attempts)
                else:
                    obs = [r for r in items if r[name] is not None]
                    if len(obs) < MIN_REFERENCE:
                        continue
                    expect = lambda r: 0.0
                values = [r for r in items if r[name] is not None and (kind != "conditional" or r[spec[3]] is not None)]
                s = sqrt(sum((r[name] - expect(r)) ** 2 for r in values) / len(values))
                if s > 1e-9:
                    refs[(role, name)] = (expect, s)
    return refs


def match_contribution(r, refs):
    """Block scores and C of one player-match; None when no block can be measured."""
    role = r["role"]
    scores = {}
    for block, indicators in blocks_of(role).items():
        cs = []
        for spec in indicators:
            name, direction = spec[0], spec[2]
            ref = refs.get((role, name))
            if ref is None or r[name] is None or (spec[1] == "conditional" and r[spec[3]] is None):
                continue
            expect, s = ref
            cs.append(direction * (r[name] - expect(r)) / s)
        if cs:
            scores[block] = sum(cs) / len(cs)
    weights = {b: w for b, w in WEIGHTS[role].items() if b in scores}
    if not weights:
        return scores, None
    return scores, sum(w * scores[b] for b, w in weights.items()) / sum(weights.values())


def block_shares(role, scores):
    """Each block's part of C (weights renormalised over the measured blocks): they add up to C."""
    weights = {b: w for b, w in WEIGHTS[role].items() if b in scores}
    total = sum(weights.values())
    return {b: w * scores[b] / total for b, w in weights.items()} if total else {}


def season_details(contributions, scored, *, lam=LAMBDA):
    """Block totals and block percentiles within the main role (eligible players), and one
    row per role played. contributions: {player: [(role, minutes, C, team, shares)]}."""
    blocks, roles = {}, {}
    for player, items in contributions.items():
        totals = defaultdict(float)
        by_role = defaultdict(lambda: [0, 0.0, 0.0])
        for role, minutes, c, _, shares in items:
            for b, v in shares.items():
                totals[b] += v
            row = by_role[role]
            row[0] += 1
            row[1] += minutes
            row[2] += c
        blocks[player] = {"totals": dict(totals), "percentiles": {}}
        roles[player] = {role: {"matches": n, "minutes": m, "total": t, "rate": 90 * t / (m + lam)} for role, (n, m, t) in by_role.items()}
    for role in {r["role"] for r in scored.values()}:
        group = [p for p, r in scored.items() if r["role"] == role and r["eligible"]]
        for b in blocks_of(role):
            values = [blocks[p]["totals"].get(b, 0.0) for p in group]
            for p in group:
                blocks[p]["percentiles"][b] = percentile(values, blocks[p]["totals"].get(b, 0.0))
    return blocks, roles


def percentile(values, mine):
    below = sum(1 for v in values if v < mine)
    equal = sum(1 for v in values if v == mine)
    return 100.0 * (below + 0.5 * equal) / len(values)


def season_scores(contributions, *, eligibility=ELIGIBILITY, lam=LAMBDA):
    """contributions: {player: [(role, minutes, C, team)]} -> {player: row} (§ 8)."""
    out = {}
    for player, items in contributions.items():
        minutes = sum(m for _, m, _, _ in items)
        total = sum(c for _, _, c, _ in items)
        by_role, by_team = defaultdict(float), defaultdict(float)
        for role, m, _, team in items:
            by_role[role] += m
            by_team[team] += m
        role = max(sorted(by_role), key=lambda x: by_role[x])
        team = max(sorted(by_team, key=str), key=lambda x: by_team[x])
        out[player] = {"role": role, "team": team, "matches": len(items), "minutes": minutes, "total": total,
                       "rate": 90 * total / (minutes + lam), "eligible": minutes >= eligibility}
    for role in {r["role"] for r in out.values()}:
        group = [r for r in out.values() if r["role"] == role and r["eligible"]]
        totals, rates = [r["total"] for r in group], [r["rate"] for r in group]
        for r in group:
            r["total_percentile"] = percentile(totals, r["total"])
            r["rate_percentile"] = percentile(rates, r["rate"])
            r["score"] = TOTAL_WEIGHT * r["total_percentile"] + RATE_WEIGHT * r["rate_percentile"]
    ranked = sorted((p for p, r in out.items() if r["eligible"]), key=lambda p: (-out[p]["score"], -out[p]["total"], -out[p]["minutes"], p))
    role_seen = defaultdict(int)
    previous = None
    for i, p in enumerate(ranked, 1):
        r = out[p]
        key = (round(r["score"], 9), round(r["total"], 9))
        r["rank"] = previous[1] if previous and previous[0] == key else i
        previous = (key, r["rank"])
        role_seen[r["role"]] += 1
        r["role_rank"] = role_seen[r["role"]]
    return out


def refresh_players(conn, season, *, eligibility=ELIGIBILITY):
    """The player power ranking of one season (after refresh_elo).

    Three steps, and no transaction open during the second: the base ends a session that
    stays idle inside a transaction (60 s, infra/aws/database.yaml), and fitting the
    references of a large season takes longer than that."""
    # 1. Read. Through a server-side cursor (it needs a transaction, a short one): the
    # season's rows are held once, as the dicts below, never a second time as the result.
    with conn.transaction():
        with conn.cursor(name="power_player_matches") as cur:
            cur.execute(PLAYER_MATCHES, (season,))
            names = [d.name for d in cur.description]
            rows = [{k: (_num(v) if k not in ("match_id", "player_id", "team_id", "position_id", "is_starter") else v) for k, v in zip(names, row)}
                    for row in cur]
    # 2. Compute, outside any transaction.
    for r in rows:
        r["delta"] = 0.0 if r["own_elo"] is None or r["opponent_elo"] is None else (r["opponent_elo"] - r["own_elo"]) / 400
    rows = assign_roles(rows)
    refs = references(rows)
    count = len(rows)
    matches = []
    detailed = defaultdict(list)
    for i, r in enumerate(rows):
        scores, c = match_contribution(r, refs)
        matches.append((r["match_id"], r["player_id"], r["team_id"], r["role"], int(r["minutes_played"]), r["opponent_elo"],
                        *[scores.get(b) for b in BLOCK_COLUMNS], c))
        if c is not None:
            detailed[r["player_id"]].append((r["role"], r["minutes_played"], c, r["team_id"], block_shares(r["role"], scores)))
        rows[i] = None  # the match's row is its tuple from here on: the season is not held twice
    del rows
    contributions = {p: [item[:4] for item in items] for p, items in detailed.items()}
    scored = season_scores(contributions, eligibility=eligibility)
    blocks, roles = season_details(detailed, scored)
    # 3. Write, in one transaction: the season's ranking changes at once or not at all.
    with conn.transaction():
        run = _start(conn, "players", season)
        conn.execute("DELETE FROM agg.player_power WHERE season_id=%s", (season,))
        conn.execute("DELETE FROM agg.player_power_matches WHERE season_id=%s", (season,))
        with conn.cursor().copy(
            f"COPY agg.player_power_matches(season_id, match_id, player_id, team_id, role, minutes, opponent_elo, {', '.join(BLOCK_COLUMNS)}, contribution, run_id) FROM STDIN"
        ) as copy:
            for match in matches:
                copy.write_row((season, *match, run))
        conn.execute("DELETE FROM agg.player_power_roles WHERE season_id=%s", (season,))
        with conn.cursor().copy(
            f"""COPY agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, total_percentile,
                 rate_percentile, score, rank, role_rank, run_id, {', '.join(b + '_total' for b in BLOCK_COLUMNS)},
                 {', '.join(b + '_percentile' for b in BLOCK_COLUMNS)}) FROM STDIN"""
        ) as copy:
            for player, r in scored.items():
                b = blocks[player]
                copy.write_row((season, player, r["role"], r["team"], r["matches"], int(r["minutes"]), r["total"], r["rate"], r["eligible"],
                                r.get("total_percentile"), r.get("rate_percentile"), r.get("score"), r.get("rank"), r.get("role_rank"), run,
                                *[b["totals"].get(k) for k in BLOCK_COLUMNS], *[b["percentiles"].get(k) for k in BLOCK_COLUMNS]))
        with conn.cursor().copy("COPY agg.player_power_roles(season_id, player_id, role, matches, minutes, total, rate, run_id) FROM STDIN") as copy:
            for player, by_role in roles.items():
                for role, x in by_role.items():
                    copy.write_row((season, player, role, x["matches"], int(x["minutes"]), x["total"], x["rate"], run))
        _publish(conn, run, "players", season, count, len(scored))
        write_award(conn, season, scored)
    return len(scored)


AWARD_SIZE = 30  # the race shown on the home (ballon-dor.js reads the first 30)


def award_race(scored, size=AWARD_SIZE):
    """The award race: the first eligible players of the power ranking, numbered 1..size
    (agg.player_award_ranking keys a season's award by rank, so ties take the ranking order)."""
    ranked = sorted((p for p, r in scored.items() if r["eligible"] and r.get("rank") is not None),
                    key=lambda p: (scored[p]["rank"], -scored[p]["total"], -scored[p]["minutes"], p))
    return [(i, p, scored[p]["team"], scored[p]["score"]) for i, p in enumerate(ranked[:size], 1)]


def write_award(conn, season, scored):
    """Store the season's Ballon d'Or race with the agg.calc_runs row that produced it."""
    definition = f"ballon_dor:{season}"
    run = conn.execute(
        """INSERT INTO agg.calc_runs(kind, model_version, formula_version, data_revision, cohort_definition, cutoff_at)
           VALUES ('award', %s, %s, (SELECT coalesce(max(revision), 0) FROM core.matches), %s, now()) RETURNING id""",
        (METHOD_VERSION, METHOD_VERSION, definition),
    ).fetchone()[0]
    conn.execute("DELETE FROM agg.player_award_ranking WHERE season_id=%s AND award='ballon_dor'", (season,))
    race = award_race(scored)
    if race:
        with conn.cursor().copy("COPY agg.player_award_ranking(season_id, award, rank, player_id, team_id, score, calc_run_id) FROM STDIN") as copy:
            for rank, player, team, score in race:
                copy.write_row((season, "ballon_dor", rank, player, team, score, run))
    conn.execute(
        "UPDATE agg.calc_runs SET status='superseded' WHERE kind='award' AND cohort_definition=%s AND status='published' AND id<>%s", (definition, run)
    )
    conn.execute("UPDATE agg.calc_runs SET status='published', finished_at=now() WHERE id=%s", (run,))
    return len(race)


def refresh_power(conn, season):
    """Both rankings: strengths first (they contextualise the players' matches)."""
    refresh_elo(conn)
    return refresh_players(conn, season)
