"""Power rankings of clubs and players: docs/METHODE_CLASSEMENT_BALLON_D_OR.md (main).

Club power ranking (§ 3): an Elo strength, updated chronologically over every finished
match the base holds; a match is contextualised with the strengths *before* it. Clubs and
national teams are ranked apart.

Player power ranking (§§ 4–8), the role-relative method:
  x̂ = expected value for the role, the minutes and the opponent;
  c = d · (x − x̂) / s           (§ 6.1)
  C = Σ_b W_r,b · mean_k∈b(c)    (§ 6.2, over the blocks the match has)
  T = Σ_m I_m (C + κ L),  R* = 90 T / (M + λ)                              (§ 8, annex A.4)

The method leaves points open (its § 12). Each choice is a named setting below, stored
with every run (agg.power_runs) and listed in backend/README.md. Version 2 (12 November
2026) answers four of them from what version 1 gave on the base (docs/calculs/05-joueurs/
08-audit-classement-puissance.md): the leagues' common scale, the role of a slot, the
period, and the comparison between roles.
- Stakes (version 3, 12 November 2026; § 9 leaves a match's stakes out "au départ" and
  calls a bonus "un choix de récompense à expliciter": this is that choice). A match
  counts for I_m = its competition's prestige × its round's (PRESTIGE, CUP_PRESTIGE,
  STAGE; annex A.4 for the rounds): 1 for a league match, 1.15 for a Champions League
  match, 1.30 for a World Cup match; ×1.05 from the first knockout round, ×1.10 in a
  semi-final, ×1.15 in a final. So a Champions League final (1.32) outweighs any other
  club final and the World Cup final (1.50) every match. The clubs' and the national
  teams' Elo moves by K × I_m; a player's match adds I_m (C + κ L), "pénalités comprises"
  (A.5). The World Cup's matches therefore enter the players' ranking: their level L is
  that of the national team among the national teams, the clubs' among the clubs.
- Elo: K 20, home advantage 60 points (none on neutral ground), expected score
  1 / (1 + 10^((R_opp − R_own − h) / 400)), result after extra time (a shoot-out is a
  draw), every finished club or national-team match of the PitchAPI era, and the matches
  of the complementary cups between two clubs the PitchAPI editions know (they tie the
  divisions of a country together).
- Common scale (§ 3: "des Elo calculés séparément avec la même moyenne ne créent pas
  automatiquement une échelle commune"): a club enters at its league's level, not at 1500
  whatever the league. The levels are the fixed point of the Elo itself: run it, take
  each league's mean, start again from those means, until they stop moving. A level
  drawn from few matches against other leagues is held towards 1500 (links / (links +
  LEVEL_PRIOR_MATCHES)). The common scale starts from the league with the most matches
  against others and takes in, step by step, every league whose clubs played
  LINK_MATCHES matches against the clubs of the leagues already on it. Another keeps
  its own scale: its players have a score, and no rank among the others.
- Universe of a season: the finished matches of the PitchAPI editions from 1 August of
  its first year to 31 July of the next (the award's year), the national teams' (the
  World Cup) with the clubs' since version 3; a calendar-year league gives the second
  half of one edition and the first half of the next. A player-match counts when the
  player played. A player is ranked through his club: one the base knows by his
  national team alone has a score and no rank.
- Roles: the line-up slot of the match read with its formation (role_of); a substitute
  takes his most played role of the season, else his line's default.
- Volume indicators: x̂ = (t / 90) · exp(α + β Δ), Δ = (Elo_opp − Elo_own) / 400 before
  the match, α and β fitted by Poisson maximum likelihood per role and indicator on the
  season (β = 0 below MIN_FIT matches): the "régression simple" of § 5.1.
- Conditional indicators: x̂ = attempts × the role's success rate (§ 5.2).
- Goals prevented (§ 7.2): already measured against the xGOT faced, x̂ = 0.
- s: the root mean square of x − x̂ for the role; an indicator with s = 0 or fewer than
  MIN_REFERENCE matches is left out. A missing value is never a zero: its indicator, or
  its block, is left out of that match, the block weights renormalised.
- A zero the source leaves out is a zero (restore_zeros). PitchAPI never publishes an
  expected goal, an expected assist or a big chance at 0 and leaves a count blank as
  often as it writes 0: on the 259,937 player-matches of 45 minutes or more of season
  2026, xG is blank on 48 % and never 0, shots on target blank on 75 %. Read as unknown,
  a striker without a shot had no finishing that day, and a missed big chance was only
  ever compared with other missed big chances. A blank is a zero when the player's row
  carries statistics (his touches are known) and the source shows it publishes that
  statistic: in the same match for the common ones, in the same edition for the rare.
- Blocks: the indicators below, with equal weights inside a block.
- Club level: C measures a player against what is expected of his role in his club's
  situation, so it says how far he stands from his club's own level, not where that
  level is. L = (t / 90) · (Elo_own − mean) / 400 puts it back, and κ gives the two
  parts the same spread among the eligible players (LEVEL_SHARE: half of what separates
  two players is the level they play at, half what they do there).
- Main role: the role with the most minutes; eligibility 900 minutes, or half the
  minutes of the most used player while the period is young; percentiles are the site's
  "rang moyen" (#below + ½ #equal) / n within the main role.
- The award race (the site's Ballon d'Or): the ranked players of a top division, the
  highest league of its country on the common scale.
- Ranking between roles: the percentile score B of § 8.3 reaches its ceiling for the
  first players of every role, and a larger role gave a higher ceiling. The rank is that
  of the standardised index Z = 0.75 z_r(T) + 0.25 z_r(R*), z within the main role; the
  score shown is 100 / (1 + 10^(−Z / 4)).
"""

from collections import defaultdict
from datetime import date, timedelta
from math import exp, log, sqrt

METHOD_VERSION = "power-ranking-v3"
ELO_INITIAL = 1500.0
ELO_K = 20.0
ELO_HOME = 60.0
SEED_ROUNDS = 200  # passes of the Elo to settle the leagues' levels
SEED_TOLERANCE = 0.5  # Elo points: the levels have stopped moving
LINK_MATCHES = 10  # matches against the clubs of the leagues on the common scale that put a league on it
LEVEL_PRIOR_MATCHES = 30  # a league's level counts for links / (links + this), the rest stays at ELO_INITIAL
LAMBDA = 450.0
ELIGIBILITY = 900.0
ELIGIBILITY_SHARE = 0.5  # of the most used player's minutes, while that is less than ELIGIBILITY
TOTAL_WEIGHT = 0.75
RATE_WEIGHT = 0.25
LEVEL_SHARE = 0.5  # of the spread between players given to the level of their club
SCORE_SCALE = 4.0  # standard deviations of the index for ten to one, as the Elo's 400 points
MIN_REFERENCE = 30
MIN_FIT = 200
# Stakes: a competition's prestige, by its PitchAPI key, and a complementary cup's, by the
# competition of its cup key; 1 for every other (the leagues, the national cups).
PRESTIGE = {"l_1XLtP0": 1.30,  # World Cup
            "l_0bfbkO": 1.15,  # Champions League
            "l_38d9HA": 1.08,  # Europa League
            "l_2WZ2tt": 1.04}  # Conference League
CUP_PRESTIGE = {"world-cup-history": 1.30, "euro": 1.20, "club-world-cup": 1.10, "nations-league": 1.05,
                "UEFA_1_champions-league": 1.15, "UEFA_1_europa-league": 1.08, "UEFA_1_conference-league": 1.04}
# A round's (annex A.4; the round before the round of 16 counts as it does).
STAGE = {"knockout": 1.05, "semi_final": 1.10, "final": 1.15}
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


def _start(conn, kind, season=None, *, started_at=None):
    return conn.execute(
        """INSERT INTO agg.power_runs(kind, season_id, method_version, elo_initial, elo_k, elo_home_advantage, regularisation_minutes,
             eligibility_minutes, total_weight, rate_weight, min_reference_matches, started_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,coalesce(%s, now())) RETURNING id""",
        (kind, season, METHOD_VERSION, ELO_INITIAL, ELO_K, ELO_HOME, LAMBDA, ELIGIBILITY, TOTAL_WEIGHT, RATE_WEIGHT, MIN_REFERENCE, started_at),
    ).fetchone()[0]


def _publish(conn, run, kind, season, matches, players=None):
    conn.execute(
        "UPDATE agg.power_runs SET status='superseded' WHERE kind=%s AND season_id IS NOT DISTINCT FROM %s AND status='published'",
        (kind, season),
    )
    # clock_timestamp(): now() is the transaction's start, which is also the run's started_at.
    conn.execute("UPDATE agg.power_runs SET status='published', finished_at=clock_timestamp(), matches=%s, players=%s WHERE id=%s", (matches, players, run))


# Stakes (§ 9, annex A.4) ----------------------------------------------------

_SEMI_WORDS = ("semi", "halbfinal", "demi")
_KNOCKOUT_WORDS = ("quarter", "viertelfinal", "achtelfinal", "quarts de finale", "huitièmes", "huitiemes", "seizièmes", "seiziemes",
                   "round of 16", "round of 32", "last 16", "last 32")


def round_of(stage, name):
    """A round's place in STAGE, or None for an ordinary one: PitchAPI's stage and name
    ("knockout" and "1/8", "final" and "final"), or a cup source's name ("Semifinals",
    "Round of 16"; it has no stage). A league round, a third-place match, a qualifying
    round and a play-off's rounds before its semi-finals are ordinary."""
    name = (name or "").strip().lower()
    if stage == "regular":
        return None
    if name == "1/2" or any(word in name for word in _SEMI_WORDS):
        return "semi_final"
    if name in ("1/4", "1/8", "1/16") or any(word in name for word in _KNOCKOUT_WORDS):
        return "knockout"
    if name in ("final", "finale", "finals", "the final") or name.endswith(" - final"):
        return "final"
    return None


def stakes(competition_key, cup_key, stage, name):
    """I_m: the competition's prestige × the round's. A complementary cup's rounds carry
    no stage of their own (their rows hold the default): they are read by their name."""
    cup = (cup_key or "").split(":")
    prestige = PRESTIGE.get(competition_key, CUP_PRESTIGE.get(cup[1], 1.0) if len(cup) == 3 else 1.0)
    return prestige * STAGE.get(round_of(None if cup_key else stage, name), 1.0)


# The finished matches of the PitchAPI and complementary editions with what their stakes
# are read from; `seasons` None is every season.
MATCH_STAKES = """
SELECT m.id, cp.provider_key, cs.cup_key, r.stage::text, r.name
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.entity_id = cs.competition_id
  AND cp.provider = 'pitchapi' AND cp.is_current
LEFT JOIN core.rounds r ON r.id = m.round_id
WHERE m.status = 'finished' AND (%(seasons)s::smallint[] IS NULL OR m.season_id = ANY(%(seasons)s::smallint[]))
  AND (r.stage IS DISTINCT FROM 'regular' OR cs.cup_key IS NOT NULL OR cp.provider_key = ANY(%(keys)s))"""


def match_stakes(conn, seasons=None):
    """{match: I_m} for the matches whose stakes are not 1."""
    out = {}
    for match, key, cup, stage, name in conn.execute(MATCH_STAKES, {"seasons": seasons, "keys": sorted(PRESTIGE)}):
        weight = stakes(key, cup, stage, name)
        if weight != 1.0:
            out[match] = weight
    return out


# Clubs: Elo (§ 3) ----------------------------------------------------------


def expected_score(own, opponent, home_advantage):
    return 1 / (1 + 10 ** ((opponent - own - home_advantage) / 400))


def elo_updates(matches, *, initial=ELO_INITIAL, k=ELO_K, home=ELO_HOME, seeds=None, leagues=None, weights=None):
    """`matches`: (match, season, kickoff, home team, away team, home score, away score,
    neutral, …) in match order. Yields one row per side: (match, team, season, kickoff,
    before, after, expected, result). A club's first strength is its league's level
    (`seeds`, by `leagues[team]`), `initial` without one. A match moves the strengths by
    `k` × its stakes (`weights`: {match: I_m}, 1 without one)."""
    rating = {}
    seeds, leagues, weights = seeds or {}, leagues or {}, weights or {}
    for mid, season, kickoff, h, a, hs, as_, neutral, *_ in matches:
        rh = rating[h] if h in rating else seeds.get(leagues.get(h), initial)
        ra = rating[a] if a in rating else seeds.get(leagues.get(a), initial)
        advantage = 0.0 if neutral else home
        eh = expected_score(rh, ra, advantage)
        result = 1.0 if hs > as_ else 0.0 if hs < as_ else 0.5
        step = k * weights.get(mid, 1.0)
        rating[h] = rh + step * (result - eh)
        rating[a] = ra + step * ((1 - result) - (1 - eh))
        yield (mid, h, season, kickoff, rh, rating[h], eh, result)
        yield (mid, a, season, kickoff, ra, rating[a], 1 - eh, 1 - result)


# Columns 8 to 11: the match's day, its competition, whether it comes from a complementary
# source (a cup-source edition), whether it is international (a European competition, or
# national teams). A complementary match counts between two clubs the PitchAPI editions know.
ELO_MATCHES = """
WITH known AS (
  SELECT DISTINCT v.team_id FROM core.matches m
  JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
  CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) v(team_id))
SELECT m.id, m.season_id, coalesce(m.kickoff_at, m.match_date::timestamp AT TIME ZONE 'UTC') AS kickoff,
  m.home_team_id, m.away_team_id, m.home_score, m.away_score, coalesce(m.is_neutral, false),
  m.match_date, cs.competition_id, cs.cup_key IS NOT NULL,
  coalesce(left(c.country_code, 3) = 'INT', false) OR coalesce(th.is_national, false)
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL
JOIN core.competitions c ON c.id = cs.competition_id
JOIN core.teams th ON th.id = m.home_team_id
WHERE m.status = 'finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
  AND (cs.cup_key IS NULL OR (m.match_date IS NOT NULL
       AND m.home_team_id IN (SELECT team_id FROM known) AND m.away_team_id IN (SELECT team_id FROM known)))
ORDER BY 3 NULLS LAST, m.match_date NULLS LAST, m.id"""


def elo_matches(rows):
    """The Elo's matches, in order: the PitchAPI ones, and the complementary ones that copy
    neither one of them (the same clubs within three days: a league both sources hold) nor
    one another (two sources of one cup)."""
    played = defaultdict(list)
    for r in rows:
        if not r[10] and r[8] is not None:
            played[(r[3], r[4])].append(r[8])
    kept, seen = [], set()
    for r in rows:
        if r[10]:
            day = r[8]
            if any(abs((d - day).days) <= 3 for d in played.get((r[3], r[4]), ())):
                continue
            if any((r[3], r[4], day + timedelta(days=x)) in seen for x in (-1, 0, 1)):
                continue
            seen.add((r[3], r[4], day))
        kept.append(r)
    return kept


def home_leagues(matches):
    """A club's league: the domestic PitchAPI competition it played most in its first season."""
    first = {}
    for m in matches:
        if m[10] or m[11]:
            continue
        for team in (m[3], m[4]):
            season, counts = first.setdefault(team, (m[1], defaultdict(int)))
            if season == m[1]:
                counts[m[9]] += 1
    return {team: max(sorted(counts), key=lambda c: counts[c]) for team, (_, counts) in first.items()}


def league_links(matches, leagues):
    """The matches between clubs of two leagues: {(league, league): matches}, each pair once."""
    pairs = defaultdict(int)
    for m in matches:
        a, b = leagues.get(m[3]), leagues.get(m[4])
        if a is not None and b is not None and a != b:
            pairs[(a, b) if a < b else (b, a)] += 1
    return pairs


def links_of(pairs):
    """Per league, its matches against the clubs of every other league."""
    links = defaultdict(int)
    for (a, b), n in pairs.items():
        links[a] += n
        links[b] += n
    return links


def common_scale(pairs, *, link=LINK_MATCHES):
    """The leagues on the common scale: the league with the most matches against others,
    then, step by step, every league whose clubs played `link` matches against the clubs
    of the leagues already there (a champion meets a different league every European night)."""
    links = links_of(pairs)
    if not links:
        return set()
    reached = {max(sorted(links), key=lambda league: links[league])}
    while True:
        tied = defaultdict(int)
        for (a, b), n in pairs.items():
            if (a in reached) != (b in reached):
                tied[b if a in reached else a] += n
        joining = {league for league, n in tied.items() if n >= link}
        if not joining:
            return reached if links[next(iter(reached))] >= link or len(reached) > 1 else set()
        reached |= joining


def league_means(strengths, leagues):
    sums = defaultdict(lambda: [0.0, 0])
    for team, value in strengths.items():
        if team in leagues:
            entry = sums[leagues[team]]
            entry[0] += value
            entry[1] += 1
    return {league: (total / n, n) for league, (total, n) in sums.items()}


def league_seasons(rows, matches):
    """Each league's level at the end of each season: {(league, season): (mean, clubs)},
    the mean strength, after their last match of the season, of the clubs that played the
    league that season (a relegated club leaves it, a promoted one joins). `rows` are
    elo_updates', in match order; a league match is neither complementary nor
    international."""
    last, members = {}, defaultdict(set)
    for _, team, season, _, _, after, _, _ in rows:
        last[(season, team)] = after
    for m in matches:
        if not m[10] and not m[11]:
            members[(m[9], m[1])].update((m[3], m[4]))
    out = {}
    for (league, season), teams in members.items():
        values = [last[(season, team)] for team in teams if (season, team) in last]
        if values:
            out[(league, season)] = (sum(values) / len(values), len(values))
    return out


def league_levels(matches, leagues, *, rounds=SEED_ROUNDS, tolerance=SEED_TOLERANCE, initial=ELO_INITIAL, prior=LEVEL_PRIOR_MATCHES, weights=None):
    """The level each league's clubs enter at: the mean strength of its clubs after an Elo
    started from the levels themselves, repeated (half a step at a time) until no level
    moves by `tolerance`. A league without a match against another keeps `initial` (its
    Elo is zero-sum), and one with few keeps a part of it: links / (links + `prior`) of
    its mean. Returns (levels, rounds done, last move)."""
    links = links_of(league_links(matches, leagues))
    seeds, done, shift = {}, 0, 0.0
    for done in range(1, rounds + 1):
        strengths = {}
        for _, team, _, _, _, after, _, _ in elo_updates(matches, initial=initial, seeds=seeds, leagues=leagues, weights=weights):
            strengths[team] = after
        new = {}
        for league, (mean, _) in league_means(strengths, leagues).items():
            weight = links[league] / (links[league] + prior) if links[league] + prior > 0 else 0.0
            new[league] = 0.5 * (initial + weight * (mean - initial) + seeds.get(league, initial))
        shift = max((abs(v - seeds.get(k, initial)) for k, v in new.items()), default=0.0)
        seeds = new
        if shift < tolerance:
            break
    return seeds, done, shift


def refresh_elo(conn):
    """Recompute every strength in match order, then each season's club power ranking."""
    with conn.transaction():
        run = _start(conn, "elo")
        matches = elo_matches(conn.execute(ELO_MATCHES).fetchall())
        leagues = home_leagues(matches)
        weights = match_stakes(conn)
        seeds, rounds, _ = league_levels(matches, leagues, weights=weights)
        rows = list(elo_updates(matches, seeds=seeds, leagues=leagues, weights=weights))
        conn.execute("DELETE FROM agg.team_power")
        conn.execute("DELETE FROM agg.team_elo")
        with conn.cursor().copy(
            "COPY agg.team_elo(match_id, team_id, season_id, kickoff_at, elo_before, elo_after, expected, result, run_id, stakes) FROM STDIN"
        ) as copy:
            for row in rows:
                copy.write_row((*row, run, weights.get(row[0], 1.0)))
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
        # Each league's place on the common scale, for the players' ranking and the reads.
        strengths = {}
        for _, team, _, _, _, after, _, _ in rows:
            strengths[team] = after
        pairs = league_links(matches, leagues)
        # A base whose leagues never met has nothing to tie: each league is its own scale.
        links, scale = links_of(pairs), common_scale(pairs) or set(leagues.values())
        conn.execute("DELETE FROM agg.league_levels")
        for league, (mean, teams) in sorted(league_means(strengths, leagues).items()):
            conn.execute(
                "INSERT INTO agg.league_levels(competition_id, entry_level, level, teams, links, linked, run_id) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (league, seeds.get(league, ELO_INITIAL), mean, teams, links.get(league, 0), league in scale, run),
            )
        # The same level season by season (the site's league strength index and its trend).
        conn.execute("DELETE FROM agg.league_level_seasons")
        for (league, season), (mean, teams) in sorted(league_seasons(rows, matches).items()):
            conn.execute(
                "INSERT INTO agg.league_level_seasons(competition_id, season_id, level, teams, run_id) VALUES (%s,%s,%s,%s,%s)",
                (league, season, mean, teams, run),
            )
        conn.execute(
            "UPDATE agg.power_runs SET seed_rounds=%s, link_matches=%s, level_prior_matches=%s WHERE id=%s",
            (rounds, LINK_MATCHES, LEVEL_PRIOR_MATCHES, run),
        )
        _publish(conn, run, "elo", None, len(rows) // 2)
    return len(rows) // 2


# Players: the role-relative method (§§ 4–8) --------------------------------

# The first parameters: the seasons read (the award year spans two), then the year's first
# day and the day after its last.
PLAYER_MATCHES = """
SELECT s.match_id, s.player_id, s.team_id, s.minutes_played, coalesce(lp.position_id, s.position_id) AS position_id, lp.is_starter,
  l.formation, cs.competition_id, m.competition_season_id, s.touches IS NOT NULL AS measured, t.is_national IS TRUE AS national,
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
JOIN core.teams t ON t.id = s.team_id
LEFT JOIN core.match_coverage mc ON mc.season_id = s.season_id AND mc.match_id = s.match_id
LEFT JOIN core.lineup_players lp ON lp.season_id = s.season_id AND lp.match_id = s.match_id AND lp.player_id = s.player_id
LEFT JOIN core.lineups l ON l.season_id = s.season_id AND l.match_id = s.match_id AND l.team_id = s.team_id
LEFT JOIN core.player_match_advanced a ON a.season_id = s.season_id AND a.match_id = s.match_id AND a.player_id = s.player_id
LEFT JOIN agg.team_elo own ON own.match_id = s.match_id AND own.team_id = s.team_id
LEFT JOIN agg.team_elo opp ON opp.match_id = s.match_id AND opp.team_id <> s.team_id
WHERE s.season_id = ANY(%s) AND s.minutes_played > 0 AND m.match_date >= %s AND m.match_date < %s"""
_KEPT = ("match_id", "player_id", "team_id", "position_id", "is_starter", "formation", "competition_id", "competition_season_id", "measured", "national")
# The statistics the source leaves blank at zero. A match of a few dozen players shows the
# common ones whenever the source publishes them; the rare ones need the edition.
ZERO_IN_MATCH = ("npxg", "shots_on_target", "xa", "chances_created", "passes_into_final_third", "dribbles_succeeded", "dribbles_total",
                 "shot_blocks", "duels_won", "duels_attempted", "aerials_won", "aerials_total", "dribbled_past", "dispossessed")
ZERO_IN_EDITION = ("np_goals", "assists", "big_chances_missed", "big_chances_created", "errors_led_to_goal")


def restore_zeros(rows):
    """Give a blank its zero where the source publishes the statistic (see the module's
    notes): `rows` are changed in place, and the number of values restored is returned."""
    in_match, in_edition = defaultdict(set), defaultdict(set)
    for r in rows:
        for name in ZERO_IN_MATCH:
            if (r.get(name) or 0) > 0:
                in_match[r["match_id"]].add(name)
        for name in ZERO_IN_EDITION:
            if (r.get(name) or 0) > 0:
                in_edition[r.get("competition_season_id")].add(name)
    restored = 0
    for r in rows:
        if not r.get("measured"):
            continue
        seen = in_match.get(r["match_id"], ())
        for name in ZERO_IN_MATCH:
            if r.get(name) is None and name in seen:
                r[name] = 0.0
                restored += 1
        seen = in_edition.get(r.get("competition_season_id"), ())
        for name in ZERO_IN_EDITION:
            if r.get(name) is None and name in seen:
                r[name] = 0.0
                restored += 1
    return restored


def award_year(season):
    """The award's year of a season: from 1 August of its first year to 31 July of the next
    (the day after, excluded). The matches are those of the season and of the next one."""
    return date(season, 8, 1), date(season + 1, 8, 1)


def _num(v):
    return None if v is None else float(v)


def role_of(formation, pos, top):
    """The role of a starter's slot, read with his team's formation and its highest slot.

    A slot is a row (its tens: 3 the defence … 10 and 11 the attack) and a place across
    the pitch (its units: 1 and 9 the touchlines, 5 the axis). The same slot is not the
    same role everywhere: 103 and 107 are the wingers of a 4-3-3 and the strikers of a
    4-2-4; 72 and 78 the wide midfielders of a 4-4-2 and the wing-backs of a 3-4-3; 84 and
    86 the interiors of a 4-1-4-1 and the playmakers of a 3-4-2-1 (slots seen on the base,
    12 November 2026)."""
    if pos is None or pos <= 3:
        return None
    if pos == 11:
        return "goalkeeper"
    try:
        lines = [int(x) for x in (formation or "").split("-")]
    except ValueError:
        lines = []
    back_three = bool(lines) and lines[0] == 3
    row, place = pos // 10, pos % 10
    wide = place in (1, 2, 8, 9)
    if row == 3:
        return "full_back" if wide else "centre_back"
    if row == 4:
        return "full_back"
    if row == 5:
        return "full_back" if place in (1, 9) else "defensive_midfielder"
    if row in (6, 7):
        if wide:
            return "full_back" if back_three else "winger"
        if row == 7:
            return "central_midfielder"
        return "central_midfielder" if place in (3, 7) else "defensive_midfielder"
    if row == 8:
        if wide:
            return "full_back" if back_three else "winger"
        # Behind a single holding midfielder the row is the midfield itself.
        return "central_midfielder" if len(lines) >= 3 and lines[1] == 1 else "winger"
    if row == 9:
        if wide:
            return "winger"
        return "centre_forward" if (top or pos) // 10 == 9 else "winger"
    if row in (10, 11):
        if wide:
            return "winger"
        if place in (3, 7):
            return "centre_forward" if lines and lines[-1] == 4 else "winger"
        return "centre_forward"
    return None


def assign_roles(rows):
    """The role of each player-match: its slot's, else the player's most played role."""
    top = defaultdict(int)
    for r in rows:
        if r["position_id"]:
            key = (r["match_id"], r["team_id"])
            top[key] = max(top[key], r["position_id"])
    slot_role = {}
    minutes = defaultdict(lambda: defaultdict(float))
    for r in rows:
        role = role_of(r.get("formation"), r["position_id"], top[(r["match_id"], r["team_id"])])
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
        for role, minutes, c, _, shares, *_ in items:
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


def _spread(values):
    mean = sum(values) / len(values)
    return mean, sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def eligibility_minutes(minutes, *, eligibility=ELIGIBILITY, share=ELIGIBILITY_SHARE):
    """The minutes that make a player eligible: `eligibility` for a full season (§ 8.3),
    `share` of the most used player's minutes while the period is younger than that."""
    return min(eligibility, share * max(minutes, default=0.0))


def level_weight(players, *, share=LEVEL_SHARE):
    """κ: the weight of the club level that gives it `share` of the spread between the
    eligible players. `players`: (role, regularised rate of C, regularised rate of L). The
    rate of C is centred by role (the roles do not share a scale), the level is not."""
    if len(players) < 2 or not 0 < share < 1:
        return 0.0
    by_role = defaultdict(list)
    for role, rate, _ in players:
        by_role[role].append(rate)
    centre = {role: sum(v) / len(v) for role, v in by_role.items()}
    own = sqrt(sum((rate - centre[role]) ** 2 for role, rate, _ in players) / len(players))
    _, level = _spread([lv for _, _, lv in players])
    return sqrt(share / (1 - share)) * own / level if level > 1e-9 else 0.0


def score_of(index, *, scale=SCORE_SCALE):
    """The score shown for an index: 50 at the role's mean, ten to one every `scale`
    standard deviations (the form of the Elo's expected score)."""
    return 100 / (1 + 10 ** (-index / scale))


def season_scores(contributions, *, eligibility=ELIGIBILITY, lam=LAMBDA, linked=None, top=None, share=LEVEL_SHARE):
    """contributions: {player: [(role, minutes, C, team, level)]} -> ({player: row}, settings)
    (§ 8). `level` is the club-level part of the match, (t / 90) · (Elo_own − mean) / 400,
    or None; `linked` the teams whose league is on the common scale and `top` those of a
    top division (None: every team)."""
    out = {}
    for player, items in contributions.items():
        minutes = sum(i[1] for i in items)
        by_role, by_team = defaultdict(float), defaultdict(float)
        for role, m, _, team, *_ in items:
            by_role[role] += m
            by_team[team] += m
        role = max(sorted(by_role), key=lambda x: by_role[x])
        team = max(sorted(by_team, key=str), key=lambda x: by_team[x])
        out[player] = {"role": role, "team": team, "matches": len(items), "minutes": minutes,
                       "own": sum(i[2] for i in items), "level": sum(i[4] or 0.0 for i in items if len(i) > 4),
                       "linked": linked is None or team in linked, "top_division": top is None or team in top}
    threshold = eligibility_minutes([r["minutes"] for r in out.values()], eligibility=eligibility)
    for r in out.values():
        r["eligible"] = r["minutes"] >= threshold and r["minutes"] > 0
    ranked = [r for r in out.values() if r["eligible"] and r["linked"]]
    kappa = level_weight([(r["role"], 90 * r["own"] / (r["minutes"] + lam), 90 * r["level"] / (r["minutes"] + lam)) for r in ranked], share=share)
    for r in out.values():
        r["total"] = r["own"] + kappa * r["level"]
        r["rate"] = 90 * r["total"] / (r["minutes"] + lam)
    for role in {r["role"] for r in out.values()}:
        group = [r for r in out.values() if r["role"] == role and r["eligible"]]
        if not group:
            continue
        totals, rates = [r["total"] for r in group], [r["rate"] for r in group]
        scale = [r for r in group if r["linked"]] or group
        (mt, st), (mr, sr) = _spread([r["total"] for r in scale]), _spread([r["rate"] for r in scale])
        for r in group:
            r["total_percentile"] = percentile(totals, r["total"])
            r["rate_percentile"] = percentile(rates, r["rate"])
            r["index"] = TOTAL_WEIGHT * ((r["total"] - mt) / st if st > 1e-9 else 0.0) + RATE_WEIGHT * ((r["rate"] - mr) / sr if sr > 1e-9 else 0.0)
            r["score"] = score_of(r["index"])
    order = sorted((p for p, r in out.items() if r["eligible"] and r["linked"]), key=lambda p: (-out[p]["index"], -out[p]["total"], -out[p]["minutes"], p))
    role_seen = defaultdict(int)
    previous = None
    for i, p in enumerate(order, 1):
        r = out[p]
        key = (round(r["index"], 9), round(r["total"], 9))
        r["rank"] = previous[1] if previous and previous[0] == key else i
        previous = (key, r["rank"])
        role_seen[r["role"]] += 1
        r["role_rank"] = role_seen[r["role"]]
    return out, {"eligibility": threshold, "level_weight": kappa}


def team_leagues(rows, leagues):
    """The teams of a league on the common scale, and those of a top division: a team's
    league of the year is the league (`leagues`: {competition: (on the scale, top)}) it
    played most player-matches in; the European competitions are no league."""
    played = defaultdict(lambda: defaultdict(int))
    for r in rows:
        if r.get("competition_id") in leagues:
            played[r["team_id"]][r["competition_id"]] += 1
    linked, top = set(), set()
    for team, counts in played.items():
        on_scale, is_top = leagues[max(sorted(counts), key=lambda c: counts[c])]
        if on_scale:
            linked.add(team)
        if is_top:
            top.add(team)
    return linked, top


def level_centres(rows):
    """The mean strength the level L is measured from, by minutes played: the clubs'
    (False) and the national teams' (True), each on its own Elo."""
    sums = {False: [0.0, 0.0], True: [0.0, 0.0]}
    for r in rows:
        if r["own_elo"] is not None:
            entry = sums[bool(r.get("national"))]
            entry[0] += r["minutes_played"] * r["own_elo"]
            entry[1] += r["minutes_played"]
    return {k: (total / minutes if minutes else ELO_INITIAL) for k, (total, minutes) in sums.items()}


def staked(role, minutes, c, team, shares, level, weight):
    """A player-match as the season reads it, its contribution, its blocks' shares and its
    level counted for the match's stakes (annex A.5: "l'enjeu multiplie l'ensemble")."""
    return (role, minutes, weight * c, team, {b: weight * v for b, v in shares.items()}, None if level is None else weight * level)


def previous_year_changed(conn, season):
    """`season` holds the first half of the calendar-year editions, which belongs to the
    award year before: has one of those matches changed since that year's last ranking?
    Only for a year whose own season has statistics: the first half of the calendar-year
    leagues alone would rank a year the European seasons are missing from."""
    start, _ = award_year(season)
    row = conn.execute(
        """SELECT max(m.updated_at) > coalesce((SELECT max(r.started_at) FROM agg.power_runs r
                    WHERE r.kind = 'players' AND r.season_id = %(previous)s AND r.status = 'published'), '-infinity'::timestamptz)
           FROM core.matches m
           JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL AND cs.cup_key IS NULL
           WHERE m.season_id = %(season)s AND m.status = 'finished' AND m.match_date < %(start)s
             AND EXISTS (SELECT 1 FROM core.player_match_stats s WHERE s.season_id = %(previous)s)""",
        {"season": season, "previous": season - 1, "start": start},
    ).fetchone()
    return bool(row and row[0])


def refresh_players(conn, season, *, eligibility=ELIGIBILITY):
    """The player power ranking of one season's award year (after refresh_elo).

    Three steps, and no transaction open during the second: the base ends a session that
    stays idle inside a transaction (60 s, infra/aws/database.yaml), and fitting the
    references of a large season takes longer than that."""
    # The run starts here, before the read and the computation: its row is only written
    # in step 3, so it is given this time.
    started = conn.execute("SELECT clock_timestamp()").fetchone()[0]
    start, end = award_year(season)
    # 1. Read. Through a server-side cursor (it needs a transaction, a short one): the
    # year's rows are held once, as the dicts below, never a second time as the result.
    with conn.transaction():
        with conn.cursor(name="power_player_matches") as cur:
            cur.execute(PLAYER_MATCHES, ([season, season + 1], start, end))
            names = [d.name for d in cur.description]
            rows = [{k: (_num(v) if k not in _KEPT else v) for k, v in zip(names, row)} for row in cur]
        # The leagues: on the common scale or not, and the highest of each country on it.
        leagues = {league: (on_scale, is_top) for league, on_scale, is_top in conn.execute(
            """SELECT l.competition_id, l.linked,
                      l.linked AND l.level = max(l.level) FILTER (WHERE l.linked) OVER (PARTITION BY coalesce(c.country_code, 'competition ' || c.id))
               FROM agg.league_levels l JOIN core.competitions c ON c.id = l.competition_id"""
        ).fetchall()}
        weights = match_stakes(conn, [season, season + 1])
    # 2. Compute, outside any transaction.
    for r in rows:
        r["delta"] = 0.0 if r["own_elo"] is None or r["opponent_elo"] is None else (r["opponent_elo"] - r["own_elo"]) / 400
    restore_zeros(rows)
    rows = assign_roles(rows)
    refs = references(rows)
    count = len(rows)
    linked, top = team_leagues(rows, leagues)
    centre = level_centres(rows)
    matches = []
    detailed = defaultdict(list)
    for i, r in enumerate(rows):
        scores, c = match_contribution(r, refs)
        level = None if r["own_elo"] is None else r["minutes_played"] / 90 * (r["own_elo"] - centre[bool(r.get("national"))]) / 400
        weight = weights.get(r["match_id"], 1.0)
        matches.append((r["match_id"], r["player_id"], r["team_id"], r["role"], int(r["minutes_played"]), r["opponent_elo"],
                        *[scores.get(b) for b in BLOCK_COLUMNS], c, level, weight))
        if c is not None:
            detailed[r["player_id"]].append(staked(r["role"], r["minutes_played"], c, r["team_id"], block_shares(r["role"], scores), level, weight))
        rows[i] = None  # the match's row is its tuple from here on: the year is not held twice
    del rows
    contributions = {p: [(role, m, c, team, level) for role, m, c, team, _, level in items] for p, items in detailed.items()}
    scored, settings = season_scores(contributions, eligibility=eligibility, linked=linked, top=top)
    blocks, roles = season_details(detailed, scored)
    # 3. Write, in one transaction: the season's ranking changes at once or not at all.
    with conn.transaction():
        run = _start(conn, "players", season, started_at=started)
        conn.execute(
            """UPDATE agg.power_runs SET eligibility_minutes=%s, eligibility_share=%s, level_share=%s, level_weight=%s, score_scale=%s,
                 year_start=%s, year_end=%s, linked_leagues=%s WHERE id=%s""",
            (settings["eligibility"], ELIGIBILITY_SHARE, LEVEL_SHARE, settings["level_weight"], SCORE_SCALE, start, end - timedelta(days=1),
             sum(1 for on_scale, _ in leagues.values() if on_scale), run),
        )
        conn.execute("DELETE FROM agg.player_power WHERE season_id=%s", (season,))
        conn.execute("DELETE FROM agg.player_power_matches WHERE season_id=%s", (season,))
        with conn.cursor().copy(
            f"COPY agg.player_power_matches(season_id, match_id, player_id, team_id, role, minutes, opponent_elo, {', '.join(BLOCK_COLUMNS)}, contribution, level, stakes, run_id) FROM STDIN"
        ) as copy:
            for match in matches:
                copy.write_row((season, *match, run))
        conn.execute("DELETE FROM agg.player_power_roles WHERE season_id=%s", (season,))
        with conn.cursor().copy(
            f"""COPY agg.player_power(season_id, player_id, role, team_id, matches, minutes, total, rate, eligible, total_percentile,
                 rate_percentile, score, rank, role_rank, run_id, own_total, level_total, index, linked, top_division,
                 {', '.join(b + '_total' for b in BLOCK_COLUMNS)}, {', '.join(b + '_percentile' for b in BLOCK_COLUMNS)}) FROM STDIN"""
        ) as copy:
            for player, r in scored.items():
                b = blocks[player]
                copy.write_row((season, player, r["role"], r["team"], r["matches"], int(r["minutes"]), r["total"], r["rate"], r["eligible"],
                                r.get("total_percentile"), r.get("rate_percentile"), r.get("score"), r.get("rank"), r.get("role_rank"), run,
                                r["own"], settings["level_weight"] * r["level"], r.get("index"), r["linked"], r["top_division"],
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
    ranked = sorted((p for p, r in scored.items() if r["eligible"] and r.get("rank") is not None and r.get("top_division", True)),
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
    conn.execute("UPDATE agg.calc_runs SET status='published', finished_at=clock_timestamp() WHERE id=%s", (run,))
    return len(race)


def refresh_power(conn, season):
    """Both rankings: strengths first (they contextualise the players' matches)."""
    refresh_elo(conn)
    return refresh_players(conn, season)
