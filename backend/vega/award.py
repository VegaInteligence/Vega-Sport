"""The Ballon d'Or race on the Score Vega v9.1 with the three criteria, stage 1 (issue #105,
docs/calculs/09-audit-2026-11/FAILURE_MODES.md §60, docs/calculs/10-score-vega-v9/04).

The owner's weights: individual performance 60 %, collective performances and trophies 30 %,
class and fair play 10 %. Stage 1 computes the race and stores it beside the v8 race
(power.award_race, agg.player_award_ranking, /api/rankings/power?kind=players), which it never
writes; the new race is served by its own reads (/api/rankings/award).

- I, the individual part: the award year's v9.1 level alone (no year before), each match's block
  values times its stakes, the national teams' matches included (level.read(..., stakes=)).
- C, the collective part: Σ share × value over the player's honours of the year (league,
  national cup, international competition), one per player, team and edition.
- F, fair play: minus the FIFA team conduct points per 90 of his covered matches, pulled to his
  position's mean by CARD_PRIOR_MINUTES.
- z_I and z_F over the year's men's reference players (eligible, linked), z_F within ± Z_CAP; z_C = k × C,
  k = mean of the SCALE_TOP highest z_I / mean of the SCALE_TOP highest C of the ranked players (§60.3, stage 1.1;
  a year that is not its own reference takes its reference year's k); B = 0.6 z_I + 0.3 z_C + 0.1 z_F; A = μ_I + σ_I B / 0.6; score on the level's curve around the
  median I of the year's reference players.

write() runs inside power.refresh_players' write transaction; refresh() computes C, F, the z and
the race again from the stored rows without reading a match; reread() reads the honours and the
cards again (results and events, not the player statistics), then stores; due() lists the years
whose editions changed after their race; stale() the years whose race is missing or out of date.
"""

from collections import defaultdict
from datetime import date

from . import level, power

AWARD_VERSION = "vega-award-v1.1"  # a race of another version is computed again (stale)
WEIGHTS = {"individual": 0.6, "collective": 0.3, "fair_play": 0.1}
Z_CAP = 4.0  # standard deviations, for z_F (z_C has no cap since v1.1, §60.3)
SCALE_TOP = 30  # z_C = k × C, k the mean of this many highest z_I over that of this many highest C: the award's list of 30
# The national cups of an award year are counted only when the year's editions hold one of each of these countries
# (power._cup_country's codes; the owner's decision, §60.3): one country's cup alone would be a bonus no one else can get.
NATIONAL_CUP_COUNTRIES = ("ENG", "ESP", "GER", "ITA", "FRA")
LEAGUE_VALUE = 0.5  # a top division's title, its factor 1 and the season complete
CUP_VALUE = 0.15  # a national cup won, its factor 1
LEAGUE_RANKS = {1: 1.0, 2: 0.4, 3: 0.2, 4: 0.1}  # a league's value by final rank; any other rank 0
ROUNDS = ("round_of_16", "quarter_final", "semi_final", "final", "winner")  # the best last
ROUND_VALUE = {"winner": 1.0, "final": 0.6, "semi_final": 0.4, "quarter_final": 0.25, "round_of_16": 0.15}
TOP_PRESTIGE = power.PRESTIGE["l_1XLtP0"]  # the World Cup's: an international competition's value 1
CARD_PRIOR_MINUTES = 900  # minutes of the position's mean a player's card rate is pulled with
NATIONAL_MATCHES = True  # the national teams' matches enter I, with their stakes
NATIONAL_PROXY_SHARE = 0.5  # a national tournament without player rows, for a player seen with that team
KEEPER_IN_RACE = False  # a keeper not measured (level.keeper_measured) is computed, not ranked
LEAGUE, NATIONAL_CUP, INTERNATIONAL = "league", "national_cup", "international"


def settings():
    """The settings a run keeps (agg.award_runs.settings) and stale() compares, read from the
    tables above each time: a table changed is a race to compute again."""
    return {"weights": dict(WEIGHTS), "z_cap": Z_CAP, "collective_scale": "proportional", "scale_top": SCALE_TOP,
            "national_cup_countries": list(NATIONAL_CUP_COUNTRIES), "league_value": LEAGUE_VALUE, "cup_value": CUP_VALUE,
            "league_ranks": {str(rank): value for rank, value in sorted(LEAGUE_RANKS.items())},
            "round_value": dict(ROUND_VALUE), "card_prior_minutes": CARD_PRIOR_MINUTES, "national_matches": NATIONAL_MATCHES,
            "national_proxy_share": NATIONAL_PROXY_SHARE, "keeper_in_race": KEEPER_IN_RACE, "level_version": level.LEVEL_VERSION}


SETTINGS = settings()


# Formulas ----------------------------------------------------------------------


def competition_value(prestige):
    """An international competition's value on 0..1: (prestige − 1) / (1.30 − 1)."""
    return max(0.0, (prestige - 1.0) / (TOP_PRESTIGE - 1.0))


def league_factor(league, strongest):
    """A league's weight against the strongest men's top division: 2 / (1 + 10^(gap / 400))."""
    return 2 / (1 + 10 ** ((strongest - league) / 400))


def honour_value(kind, *, reached=None, league_rank=None, progress=1.0, factor=1.0, prestige=1.0):
    """The value of one honour, before the player's share."""
    factor = 1.0 if factor is None else factor
    if kind == LEAGUE:
        return LEAGUE_VALUE * factor * LEAGUE_RANKS.get(league_rank, 0.0) * (1.0 if progress is None else progress)
    if kind == NATIONAL_CUP:
        return CUP_VALUE * factor * ROUND_VALUE.get(reached, 0.0)
    if kind == INTERNATIONAL:
        return competition_value(1.0 if prestige is None else prestige) * ROUND_VALUE.get(reached, 0.0)
    return 0.0


def share(minutes, matches):
    """A player's share of his team's edition: his minutes over its matches of 90, at most 1."""
    return min(1.0, minutes / (90 * matches)) if matches > 0 else 0.0


def national_share(seen):
    """A national tournament without player rows: NATIONAL_PROXY_SHARE for a player seen with that team."""
    return NATIONAL_PROXY_SHARE if seen else 0.0


def final_winner(score, extra, shootout):
    """'home', 'away' or None: the score, then extra time, then the shoot-out; each (home, away) or None."""
    if score is None or None in score:
        return None
    for pair in (score, extra, shootout):
        if pair is not None and None not in pair and pair[0] != pair[1]:
            return "home" if pair[0] > pair[1] else "away"
    return None


_QUARTER = ("1/4", "quarter", "viertelfinal", "quarts de finale")
_LAST_16 = ("1/8", "achtelfinal", "round of 16", "last 16", "huitièmes", "huitiemes")


def reached_round(stage, name):
    """The round of ROUNDS a match is of (the round of 16 or later), or None: power.round_of's
    reading of PitchAPI's stage and name or of a cup source's name."""
    kind = power.round_of(stage, name)
    if kind in ("semi_final", "final"):
        return kind
    if kind is None and stage != "regular" and (name or "").strip().lower() == "finals, final":
        return "final"  # OpenFootball's « Finals, Final », that name only (§60.3); power.round_of, the v8 stakes' reading, is not changed
    if kind == "knockout":
        name = (name or "").strip().lower()
        if any(word in name for word in _QUARTER):
            return "quarter_final"
        if any(word in name for word in _LAST_16):
            return "round_of_16"
    return None


def card_points(events):
    """The FIFA team conduct points of one player-match: yellow 1, second yellow (its red not
    counted again) 3, direct red 4, yellow and direct red 5. events: [(minute, kind)]."""
    return _points({kind for _, kind in events})


def _points(kinds):
    if "second_yellow" in kinds:
        return 3
    if "red_card" in kinds:
        return 5 if "yellow_card" in kinds else 4
    return 1 if "yellow_card" in kinds else 0


def pulled_rate(points, minutes, mean, prior=None):
    """Card points per 90, pulled to `mean` (the position's, per 90) by `prior` minutes."""
    prior = CARD_PRIOR_MINUTES if prior is None else prior
    return 90 * (points + mean * prior / 90) / (minutes + prior)


def zscore(x, mean, sd, cap=None):
    if not sd:
        return 0.0
    z = (x - mean) / sd
    return z if cap is None else max(-cap, min(cap, z))


def combined(z_individual, z_collective, z_fair_play):
    return WEIGHTS["individual"] * z_individual + WEIGHTS["collective"] * z_collective + WEIGHTS["fair_play"] * z_fair_play


def award_level(b, mean, sd):
    """A = μ_I + σ_I B / 0.6: B back on the individual part's Elo points."""
    return mean + sd * b / WEIGHTS["individual"]


def score(a, median):
    return 100 / (1 + 10 ** (-(a - median) / level.SCALE))


def race_reason(person):
    """Why a men's player is out of the race, the first that holds, or None."""
    if not person.get("eligible"):
        return "minutes"
    if not person.get("linked"):
        return "league"
    if not person.get("top_division"):
        return "not_top_division"
    if not person.get("measured", True) and not KEEPER_IN_RACE:
        return "keeper_data"
    return None


def individual(cells, refs, people):
    """The individual part: the level (level.levels) of the award cells alone, no year before."""
    return level.levels(cells, {}, refs, people)


def _spread(values):
    if not values:
        return [0.0, 0.0]
    mean = sum(values) / len(values)
    return [mean, (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5]


def _reference(people):
    return ([p for p, r in people.items() if r.get("reference")] or [p for p, r in people.items() if r.get("eligible")] or list(people))


def own_spreads(people):
    """The means and spreads of the year's men's reference players: I and C on all of them,
    F within the main position (a position no reference player holds: all its players)."""
    men = {p: r for p, r in people.items() if r.get("universe", "men") == "men"}
    reference = _reference(men)
    fair_play = {pos: _spread(values) for pos, values in _by_position(men, reference, lambda r: [r["fair_play"]]).items()}
    return {"individual": _spread([men[p]["individual"] for p in reference]),
            "collective": _spread([men[p]["collective"] for p in reference]), "fair_play": fair_play}


def combine(people, spreads=None):
    """The race from each men's player's parts. people: {player: {"individual", "collective",
    "fair_play", "position", "universe", "reference", "eligible", "linked", "top_division",
    "measured"}}; spreads, as award.reference_spreads gives them (§60.3), one of three cases:
    - None: the year is its own reference year: its own spreads (own_spreads()) and its own k
      (collective_scale on its ranked players, `source` own);
    - a reference run's spreads (non-empty): that run's spreads and its k (`source` reference);
    - {}: placed on a reference year without a published run of this version: the year's own
      spreads, k = 0 (`source` none).
    -> ({player: {"z_individual", "z_collective", "z_fair_play", "level", "score", "rank",
    "reason"}}, the spreads used)."""
    men = {p: r for p, r in people.items() if r.get("universe", "men") == "men"}
    own = own_spreads(men)
    used = own if not spreads else spreads
    individual_spread = used.get("individual") or own["individual"]
    collective_spread = used.get("collective") or own["collective"]
    reference = _reference(men)
    ordered = sorted(men[p]["individual"] for p in reference)
    median = ordered[len(ordered) // 2] if ordered else 0.0
    del collective_spread  # kept with the spreads (own_spreads), it places nothing since v1.1 (§60.3)
    z_individual = {p: zscore(r["individual"], individual_spread[0], individual_spread[1]) for p, r in men.items()}
    if spreads:  # the reference year's run: its k, never the year's own
        given = spreads.get("collective_scale")
        scale = {**given, "source": "reference"} if given else {**collective_scale([], []), "source": "none"}
    elif spreads is None:  # the year is its own reference
        ranked = [p for p, r in men.items() if race_reason(r) is None]
        scale = {**collective_scale([z_individual[p] for p in ranked], [men[p]["collective"] for p in ranked]), "source": "own"}
    else:  # placed on a reference year without a published run of this version: no k of its own
        scale = {**collective_scale([], []), "source": "none"}
    used = {**used, "collective_scale": scale}
    out = {}
    for p, r in men.items():
        fair = (used.get("fair_play") or {}).get(r["position"]) or own["fair_play"].get(r["position"], [0.0, 0.0])
        zi = z_individual[p]
        zc = scale["k"] * r["collective"]
        zf = zscore(r["fair_play"], fair[0], fair[1], cap=Z_CAP)
        a = award_level(combined(zi, zc, zf), individual_spread[0], individual_spread[1])
        out[p] = {"z_individual": zi, "z_collective": zc, "z_fair_play": zf, "level": a, "score": score(a, median), "rank": None,
                  "reason": race_reason(r)}
    for rank, p in enumerate(sorted((p for p, r in out.items() if r["reason"] is None), key=lambda p: (-out[p]["level"], p)), 1):
        out[p]["rank"] = rank
    return out, used


def collective_scale(top_individual, top_collective, size=None):
    """z_C's slope (§60.3): k = mean of the `size` (SCALE_TOP) highest z_I / mean of the `size` highest C, the two taken
    separately among the year's ranked players (all of them when fewer); 0 when either mean is not positive."""
    size = SCALE_TOP if size is None else size
    zi, c = sorted(top_individual, reverse=True)[:size], sorted(top_collective, reverse=True)[:size]
    mean_i, mean_c = (sum(zi) / len(zi) if zi else 0.0), (sum(c) / len(c) if c else 0.0)
    k = mean_i / mean_c if mean_i > 0 and mean_c > 0 else 0.0
    return {"k": k, "mean_top_individual": mean_i, "mean_top_collective": mean_c, "top": len(zi)}


def _by_position(people, reference, values):
    """{position: the values of its reference players}, a position no reference player holds
    read on all its players."""
    out = defaultdict(list)
    for p in reference:
        out[people[p]["position"]].extend(values(people[p]))
    wide = defaultdict(list)
    for p, r in people.items():
        if r["position"] not in out:
            wide[r["position"]].extend(values(r))
    return {**out, **wide}


def card_means(people, cards):
    """{position: the mean card points per 90 of its reference players' covered minutes}.
    cards: {player: (points, covered minutes)}."""
    men = {p: {**r, "cards": cards.get(p, (0, 0.0))} for p, r in people.items() if r.get("universe", "men") == "men"}
    out = {}
    for pos, pairs in _by_position(men, _reference(men), lambda r: [r["cards"]]).items():
        points, minutes = sum(x for x, _ in pairs), sum(m for _, m in pairs)
        out[pos] = 90 * points / minutes if minutes > 0 else 0.0
    return out


def evaluate(people, honours, cards, spreads=None):
    """The year's race from its people (their individual part, position and flags), honours
    (their parameters and shares) and cards ({player: (points, covered minutes)}). Each honour
    is given its value from the present tables. spreads: combine()'s three cases (None: the
    year's own spreads and k; a reference run's spreads: that run's spreads and k; {}: placed on
    a reference year without a published run of this version, k = 0, `source` none); the card
    rates are pulled to the reference run's position means when it kept them, else the year's own.
    -> (rows, honours, spreads), the spreads those used (the reference year's, else the year's
    own, each position's mean card rate third)."""
    collective = defaultdict(float)
    for h in honours:
        h["value"] = h["share"] * honour_value(h["kind"], reached=h["reached"], league_rank=h["league_rank"], progress=h["progress"],
                                               factor=h["factor"], prestige=h["prestige"])
        collective[h["player"]] += h["value"]
    own_means = card_means(people, cards)
    given = (spreads or {}).get("fair_play") or {}
    means = {pos: (given[pos][2] if pos in given and len(given[pos]) > 2 else m) for pos, m in own_means.items()}
    parts = {}
    for p, r in people.items():
        points, minutes = cards.get(p, (0, 0.0))
        parts[p] = {**r, "collective": collective.get(p, 0.0), "card_points": points, "fair_play_minutes": minutes,
                    "fair_play": -pulled_rate(points, minutes, means.get(r["position"], 0.0))}
    rows, used = combine(parts, spreads)
    if not spreads:
        used = {**used, "fair_play": {pos: [*v[:2], own_means.get(pos, 0.0)] for pos, v in used["fair_play"].items()}}
    for p, r in rows.items():
        r.update({k: parts[p][k] for k in ("collective", "card_points", "fair_play_minutes", "fair_play")})
    return rows, honours, used


# Reading the year's honours and cards ---------------------------------------------

def _prestige(provider_key, cup_key):
    cup = (cup_key or "").split(":")
    return power.PRESTIGE.get(provider_key, power.CUP_PRESTIGE.get(cup[1], 1.0) if len(cup) == 3 else 1.0)


# The editions of the award year: those whose last match, played or to play, falls in it.
EDITIONS = """
SELECT cs.id, cs.competition_id, c.kind::text, cs.cup_key, cp.provider_key, l.level, coalesce(l.tier, 1) = 1 AND l.universe = 'men'
FROM core.competition_seasons cs
JOIN core.competitions c ON c.id = cs.competition_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.provider = 'pitchapi' AND cp.is_current AND cp.entity_id = cs.competition_id
LEFT JOIN agg.league_levels l ON l.competition_id = cs.competition_id
JOIN LATERAL (SELECT max(m.match_date) AS last FROM core.matches m
              WHERE m.competition_season_id = cs.id AND m.status <> 'canceled') e ON true
WHERE cs.season_id = ANY(%(seasons)s) AND cs.archive_key IS NULL AND e.last >= %(start)s AND e.last < %(end)s"""
# Each team's matches of those editions: finished, all, the first and the last.
TEAM_MATCHES = """
SELECT m.competition_season_id, t.team, count(*) FILTER (WHERE m.status = 'finished'), count(*), min(m.match_date), max(m.match_date),
  bool_or(tm.is_national)
FROM core.matches m
CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) t(team)
JOIN core.teams tm ON tm.id = t.team
WHERE m.competition_season_id = ANY(%(editions)s) AND m.status <> 'canceled'
GROUP BY 1, 2"""
# The rounds of the cups and the international competitions (the match's id last: §60.3's shoot-outs).
KNOCKOUTS = """
SELECT m.competition_season_id, m.match_date, m.home_team_id, m.away_team_id, m.status = 'finished', m.home_score, m.away_score,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score, r.stage::text, r.name, m.id
FROM core.matches m JOIN core.rounds r ON r.id = m.round_id
WHERE m.competition_season_id = ANY(%(editions)s) AND m.status <> 'canceled'"""
# The final tables of the leagues, from the base tables of these editions alone (the table of the whole league first):
# the official one (sportscore) when its ranks do not contradict themselves (api.standings's rule) and it counts, club
# by club, the matches Vega's own table counts when Vega has one; else Vega's. api.standings reads every official
# table through that rule whatever edition is asked (§60, 60ad): the race reads nothing of the api schema.
STANDINGS = """
WITH official AS (
  SELECT o.competition_season_id, o.team_id, o.group_name, o.position, o.played,
    min(o.points) OVER (PARTITION BY o.competition_season_id, o.group_name, o.position)
      <> max(o.points) OVER (PARTITION BY o.competition_season_id, o.group_name, o.position)
    OR (bool_and(o.group_name IS NULL) OVER w AND max(o.position) OVER w > count(*) OVER w) AS conflict
  FROM core.standings_official o
  WHERE o.competition_season_id = ANY(%(editions)s) AND o.source = 'sportscore' AND o.stage IS NULL
  WINDOW w AS (PARTITION BY o.competition_season_id)
), own AS (
  SELECT a.competition_season_id, a.team_id, a.group_name, a.position, a.played
  FROM agg.standings a WHERE a.competition_season_id = ANY(%(editions)s) AND a.stage IS NULL
), trusted AS (
  SELECT coalesce(o.competition_season_id, a.competition_season_id) AS competition_season_id
  FROM official o FULL JOIN own a ON a.competition_season_id = o.competition_season_id AND a.team_id = o.team_id
    AND a.group_name IS NOT DISTINCT FROM o.group_name
  GROUP BY 1
  HAVING bool_and(o.team_id IS NOT NULL) AND NOT bool_or(coalesce(o.conflict, false))
     AND (bool_and(a.team_id IS NULL) OR coalesce(bool_and(o.played = a.played), false))
)
SELECT DISTINCT ON (competition_season_id, team_id) competition_season_id, team_id, position FROM (
  SELECT o.competition_season_id, o.team_id, o.group_name, o.position FROM official o
  WHERE o.competition_season_id IN (SELECT competition_season_id FROM trusted)
  UNION ALL
  SELECT a.competition_season_id, a.team_id, a.group_name, a.position FROM own a
  WHERE a.competition_season_id NOT IN (SELECT competition_season_id FROM trusted)
) t
WHERE position IS NOT NULL
ORDER BY competition_season_id, team_id, (group_name IS NULL) DESC, position"""
# A club's league of the year: the measured league it played most finished matches of.
CLUB_LEAGUES = """
SELECT DISTINCT ON (t.team) t.team, l.level
FROM core.matches m
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL
JOIN agg.league_levels l ON l.competition_id = cs.competition_id
CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) t(team)
WHERE m.season_id = ANY(%(seasons)s) AND m.status = 'finished' AND m.match_date >= %(start)s AND m.match_date < %(end)s
  AND t.team = ANY(%(teams)s)
GROUP BY t.team, cs.competition_id, l.level
ORDER BY t.team, count(*) DESC, cs.competition_id"""
# Each player's minutes for his team in the editions' player rows.
EDITION_MINUTES = """
SELECT m.competition_season_id, s.team_id, s.player_id, sum(s.minutes_played)::float8
FROM core.player_match_stats s
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id AND m.status = 'finished'
WHERE s.season_id = ANY(%(seasons)s) AND m.competition_season_id = ANY(%(editions)s) AND s.minutes_played > 0
GROUP BY 1, 2, 3"""
# A club edition without player rows: the club's PitchAPI matches between its first and last match of the edition.
WINDOW_MINUTES = """
WITH w AS (SELECT * FROM unnest(%(editions)s::integer[], %(teams)s::integer[], %(firsts)s::date[], %(lasts)s::date[]) AS w(edition, team, first, last)),
g AS (SELECT w.edition, w.team, m.id, m.season_id
      FROM core.matches m
      JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NULL AND cs.archive_key IS NULL
      CROSS JOIN LATERAL (VALUES (m.home_team_id), (m.away_team_id)) t(team)
      JOIN w ON w.team = t.team AND m.match_date BETWEEN w.first AND w.last
      WHERE m.season_id = ANY(%(seasons)s) AND m.status = 'finished'),
n AS (SELECT edition, team, count(*) AS games FROM g GROUP BY 1, 2)
SELECT g.edition, g.team, s.player_id, sum(s.minutes_played)::float8, n.games
FROM g JOIN n USING (edition, team)
JOIN core.player_match_stats s ON s.season_id = g.season_id AND s.match_id = g.id AND s.team_id = g.team AND s.minutes_played > 0
GROUP BY 1, 2, 3, 5"""
# The players seen with a national team: a PitchAPI match for it, or a linked scorer of the tournament (§57).
SEEN = """
SELECT DISTINCT s.team_id, s.player_id
FROM core.matches m JOIN core.player_match_stats s ON s.season_id = m.season_id AND s.match_id = m.id AND s.team_id = ANY(%(nations)s)
WHERE m.home_team_id = ANY(%(nations)s) OR m.away_team_id = ANY(%(nations)s)
UNION
SELECT CASE g.side WHEN 'home' THEN m.home_team_id ELSE m.away_team_id END, g.player_id
FROM core.international_goals g JOIN core.matches m ON m.id = g.match_id
WHERE m.competition_season_id = ANY(%(editions)s) AND g.player_id IS NOT NULL AND NOT g.own_goal"""
# The cards of the covered player-matches of the year, and each player's covered minutes.
CARDS = """
SELECT e.player_id, bool_or(e.event_type::text = 'yellow_card'), bool_or(e.event_type::text = 'second_yellow'), bool_or(e.event_type::text = 'red_card')
FROM core.match_events e
JOIN core.match_coverage mc ON mc.season_id = e.season_id AND mc.match_id = e.match_id AND mc.events = 'ok'
JOIN core.matches m ON m.id = e.match_id AND m.season_id = e.season_id AND m.status = 'finished' AND m.match_date >= %(start)s AND m.match_date < %(end)s
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL
WHERE e.season_id = ANY(%(seasons)s) AND e.player_id IS NOT NULL AND e.event_type::text IN ('yellow_card', 'second_yellow', 'red_card')
GROUP BY e.player_id, e.match_id"""
COVERED = """
SELECT s.player_id, sum(s.minutes_played)::float8
FROM core.player_match_stats s
JOIN core.match_coverage mc ON mc.season_id = s.season_id AND mc.match_id = s.match_id AND mc.events = 'ok'
JOIN core.matches m ON m.id = s.match_id AND m.season_id = s.season_id AND m.status = 'finished' AND m.match_date >= %(start)s AND m.match_date < %(end)s
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.archive_key IS NULL
WHERE s.season_id = ANY(%(seasons)s) AND s.minutes_played > 0
GROUP BY 1"""


# The copies of the finals without a shoot-out (§60.3): a finished match of another edition, any year, of the same two
# teams, at most a day apart, with both shoot-out scores; award.lent_shootouts keeps those of the same real competition
# and score. Through the teams' indexes (matches_home_season, matches_away_season).
COPIES = """
WITH f AS (SELECT * FROM unnest(%(ids)s::integer[], %(editions)s::integer[], %(homes)s::integer[], %(aways)s::integer[], %(days)s::date[])
           AS f(final, edition, home, away, day))
SELECT f.final, m.competition_season_id, cs.cup_key, cp.provider_key, m.match_date, m.home_team_id, m.away_team_id, m.home_score, m.away_score,
  m.home_score_et, m.away_score_et, m.home_penalty_score, m.away_penalty_score
FROM f
JOIN core.matches m ON m.home_team_id IN (f.home, f.away) AND m.away_team_id IN (f.home, f.away) AND m.home_team_id <> m.away_team_id
  AND m.match_date BETWEEN f.day - 1 AND f.day + 1 AND m.id <> f.final AND m.competition_season_id <> f.edition AND m.status = 'finished'
  AND m.home_penalty_score IS NOT NULL AND m.away_penalty_score IS NOT NULL
JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
LEFT JOIN core.provider_ids cp ON cp.entity_type = 'competition' AND cp.provider = 'pitchapi' AND cp.is_current AND cp.entity_id = cs.competition_id"""
# The PitchAPI key and the two teams' names of the finals REVIEWED_SHOOTOUTS may name (§60.3).
LISTED = """
SELECT m.id, p.provider_key, h.name, a.name
FROM core.matches m
JOIN core.provider_ids p ON p.entity_type = 'match' AND p.provider = 'pitchapi' AND p.is_current AND p.entity_id = m.id
JOIN core.teams h ON h.id = m.home_team_id
JOIN core.teams a ON a.id = m.away_team_id
WHERE m.id = ANY(%(ids)s) AND p.provider_key = ANY(%(keys)s)"""

# Shoot-outs a reviewed list gives the race (§60.3; hugo, 24 Nov 2026, 21:05 Paris, decision card « Donner par une liste
# relue le vainqueur de trois finales européennes ? »: « Oui, une liste relue »: these three finals and no other). PitchAPI's
# rows hold no shoot-out, their events no shoot-out goal, and no other edition holds a copy. The shape of
# archives.VERIFIED_SHOOTOUTS (date, team1, team2, score, kicks, the source), which types a goal-only archive's rows at
# import: the race writes no match row, so it keeps its own list. Keyed by PitchAPI's match key (the source's own id,
# api.public_id's), bound to its competition, its date, the two teams by name (team1's kicks first, as OpenFootball's
# line reads: the base may put the other at home) and the score after extra time: an entry is used only for that
# match, when its row holds no shoot-out and no copy lends one. Values read in OpenFootball's files on 24 Nov 2026
# (/mnt/project-files/vega-ballon-dor/evidence/shootouts_openfootball_2026-11-24.txt).
OPENFOOTBALL_UEFA = "https://raw.githubusercontent.com/openfootball/champions-league/master/"
REVIEWED_SHOOTOUTS = {
    key: {"competition": competition, "date": day, "team1": team1, "team2": team2, "score": score, "kicks": kicks,
          "source": OPENFOOTBALL_UEFA + path, "line": line}
    for key, competition, day, team1, team2, score, kicks, path, line in (
        ("m_0mZCDy", "l_38d9HA", "2022-05-18", "Eintracht Frankfurt", "Rangers FC", [1, 1], [5, 4], "2021-22/el.txt",
         "Eintracht Frankfurt (GER) v Rangers FC (SCO)         5-4 pen. 1-1 a.e.t. (1-1, 0-0)"),
        ("m_2JTU0J", "l_38d9HA", "2023-05-31", "Sevilla FC", "AS Roma", [1, 1], [4, 1], "2022-23/el.txt",
         "Sevilla FC (ESP)        v AS Roma (ITA)            4-1 pen. 1-1 a.e.t. (1-1, 0-1)"),
        ("m_0DIsqq", "l_0bfbkO", "2026-05-30", "Paris Saint-Germain FC", "Arsenal FC", [1, 1], [4, 3], "2025-26/cl.txt",
         "Paris Saint-Germain FC (FRA) v Arsenal FC (ENG)         4-3 pen. 1-1 a.e.t. (1-1, 0-1)"),
    )
}


def _played(score, extra):
    """A match's score after extra time when it has one, else its score: (home, away)."""
    return tuple(extra) if extra is not None and None not in extra else tuple(score)


def lent_shootouts(finals, copies, competitions):
    """{final: (home, away) shoot-out} its copy lends (§60.3, the copy test of rule 43.2). finals: [(match, edition,
    home, away, day, score home, score away, extra home, extra away)] without a shoot-out; copies: [(final, edition,
    cup key, PitchAPI key, day, home, away, score home, score away, extra home, extra away, kicks home, kicks away)];
    competitions: {edition: _competition()} of the finals' editions. Copies that disagree lend nothing."""
    out = {}
    for match, edition, home, away, day, hs, as_, he, ae in finals:
        played = _played((hs, as_), (he, ae))
        lent = set()
        for final, c_edition, cup_key, provider_key, c_day, c_home, c_away, chs, cas, che, cae, chp, cap in copies:
            if final != match or c_edition == edition or {c_home, c_away} != {home, away} or day is None or c_day is None:
                continue
            if abs((c_day - day).days) > 1 or None in (chp, cap) or chp == cap or _competition(c_edition, provider_key, cup_key)[0] != competitions[edition][0]:
                continue
            c_played = _played((chs, cas), (che, cae))
            same = c_home == home
            if (c_played if same else c_played[::-1]) != played:
                continue
            lent.add((chp, cap) if same else (cap, chp))
        if len(lent) == 1:
            out[match] = lent.pop()
    return out


_NAME_NOISE = {"fc", "cf", "sc", "as", "ac", "afc", "club", "de"}


def _name(text):
    import unicodedata

    plain = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return frozenset(w for w in plain.replace("-", " ").replace(".", " ").split() if w not in _NAME_NOISE)


def same_team(listed, base):
    """Whether a list's team name and the base's name one club: their words, less « FC », « AS »…, equal or one within the other."""
    a, b = _name(listed), _name(base)
    return bool(a and b) and (a <= b or b <= a)


def listed_shootouts(finals, keys, competitions, entries=None):
    """{final: (home, away) shoot-out} REVIEWED_SHOOTOUTS gives (§60.3). finals as lent_shootouts'; keys: {match:
    (PitchAPI key, home's name, away's name)}. An entry is used for its match alone, when its competition, date, the two
    teams (by name, either at home) and the score after extra time agree."""
    entries = REVIEWED_SHOOTOUTS if entries is None else entries
    out = {}
    for match, edition, home, away, day, hs, as_, he, ae in finals:
        key, home_name, away_name = keys.get(match, (None, None, None))
        entry = entries.get(key)
        if entry is None or competitions[edition][0] != entry["competition"] or day is None or day.isoformat() != entry["date"]:
            continue
        straight = same_team(entry["team1"], home_name) and same_team(entry["team2"], away_name)
        crossed = same_team(entry["team1"], away_name) and same_team(entry["team2"], home_name)
        if straight == crossed:
            continue  # neither orientation, or both: not this match
        score, kicks = (entry["score"], entry["kicks"]) if straight else (entry["score"][::-1], entry["kicks"][::-1])
        if _played((hs, as_), (he, ae)) != tuple(score):
            continue  # the base wins: another score, the entry ignored
        out[match] = tuple(kicks)
    return out


def national_cups(held):
    """The year's national cups fact (§60.3): counted only when every NATIONAL_CUP_COUNTRIES's cup is held."""
    held = sorted(c for c in held if c)
    return {"counted": set(NATIONAL_CUP_COUNTRIES) <= set(held), "held": held}


# One real competition two sources hold for the same year (§60, 60ae): an edition of the left source is the right one's
# competition. open-matchday's copies of PitchAPI's leagues and UEFA competitions (open_matchday.COVERED) are added by
# _competition.
SAME_COMPETITION = {
    "open-cups:world-cup-history": "l_1XLtP0",  # OpenFootball's World Cup (2022, 2026) is PitchAPI's
    "open-matchday:GER_CUP_dfb-pokal": "openligadb:germany-cup",  # power.SUPERSEDED: the German cup is OpenLigaDB's
}


SOURCE_ORDER = {"openligadb": 1, "open-cups": 2}  # PitchAPI 0; open-matchday, International Results and the others 3


def _cup_groups():
    """{family: the family of the group's source read first}: the national cups curated.CUP_LOGO_ALSO names as one cup
    (§60.3; a group with a key power._cup_country names: the Nations League pair is no national cup)."""
    from .sources.curated import CUP_LOGO_ALSO

    out = {}
    for site, also in CUP_LOGO_ALSO.items():
        members = [site, *(key.removeprefix("cup:") for key in also)]
        if not any(power._cup_country(f"{m}:-") for m in members):
            continue
        first = min(members, key=lambda m: (SOURCE_ORDER.get(m.split(":")[0], 3), m))
        out.update({m: first for m in members})
    return out


def _competition(edition, provider_key, cup_key):
    """(the real competition an edition is of, the order its source is read in: PitchAPI's 0, OpenLigaDB's 1,
    OpenFootball's 2, the others 3). An edition of no named source is a competition of its own."""
    from .sources.open_matchday import COVERED

    if provider_key:
        return provider_key, 0
    parts = str(cup_key or "").split(":")
    if len(parts) != 3:
        return ("edition", edition), 0
    family = f"{parts[0]}:{parts[1]}"
    same = SAME_COMPETITION.get(family) or (COVERED.get(parts[1]) if parts[0] == "open-matchday" else None) or _cup_groups().get(family)
    return same or family, SOURCE_ORDER.get(parts[0], 3)


def one_per_competition(teams, competitions):
    """`teams` ({(edition, team): facts}) less the editions a team has of a competition another source holds for it
    first (competitions: {edition: _competition()})."""
    first = {}
    for edition, team in teams:
        key, order = competitions[edition]
        first[(key, team)] = min(first.get((key, team), order), order)
    return {(e, t): x for (e, t), x in teams.items() if competitions[e][1] == first[(competitions[e][0], t)]}


def read_inputs(conn, season):
    """The year's honours, before the players' shares are kept, and its cards: set-based reads of
    the results, the rounds, the tables and the events (a dozen queries whatever the year's size)."""
    start, end = power.award_year(season)
    seasons = [season, season + 1]
    window = {"seasons": seasons, "start": start, "end": end}
    editions, competitions, held = {}, {}, set()
    for edition, competition, kind, cup_key, provider_key, league_level, top in conn.execute(EDITIONS, window).fetchall():
        competitions[edition] = _competition(edition, provider_key, cup_key)
        prestige = _prestige(provider_key, cup_key)
        if prestige > 1.0:
            editions[edition] = (INTERNATIONAL, None, prestige, cup_key)
        elif league_level is not None and top and cup_key is None:
            editions[edition] = (LEAGUE, float(league_level), None, cup_key)
        elif kind == "cup" or power._cup_country(cup_key):
            editions[edition] = (NATIONAL_CUP, None, None, cup_key)
            held.add(power._cup_country(cup_key))
    cups = national_cups(held)
    if not cups["counted"]:  # not the five countries' cups: none counted that year, to anyone (§60.3)
        editions = {e: x for e, x in editions.items() if x[0] != NATIONAL_CUP}
    ids = sorted(editions)
    teams, progress = {}, defaultdict(lambda: [0, 0])
    for edition, team, finished, total, first, last, national in conn.execute(TEAM_MATCHES, {"editions": ids}).fetchall():
        teams[(edition, team)] = {"played": finished, "matches": total, "first": first, "last": last, "national": bool(national)}
    teams = one_per_competition(teams, competitions)
    knockouts = with_shootouts(conn, editions, competitions, conn.execute(KNOCKOUTS, {"editions": [e for e in ids if editions[e][0] != LEAGUE]}).fetchall())
    leagues = [e for e in ids if editions[e][0] == LEAGUE]
    for edition, finished, total in conn.execute(
            "SELECT competition_season_id, count(*) FILTER (WHERE status = 'finished'), count(*) FROM core.matches "
            "WHERE competition_season_id = ANY(%s) AND status <> 'canceled' GROUP BY 1", (leagues,)).fetchall():
        progress[edition] = [finished, total]
    ranks = {(e, t): pos for e, t, pos in conn.execute(STANDINGS, {"editions": leagues}).fetchall()} if leagues else {}
    strongest = conn.execute("SELECT max(level) FROM agg.league_levels WHERE coalesce(tier, 1) = 1 AND universe = 'men'").fetchone()[0]
    cup_clubs = sorted({t for (e, t), x in teams.items() if editions[e][0] == NATIONAL_CUP and not x["national"]})
    club_leagues = dict(conn.execute(CLUB_LEAGUES, {**window, "teams": cup_clubs}).fetchall()) if cup_clubs else {}
    minutes = defaultdict(dict)
    for edition, team, player, total in conn.execute(EDITION_MINUTES, {"seasons": seasons, "editions": ids}).fetchall():
        minutes[(edition, team)][player] = total
    honoured = _reached(editions, knockouts)
    wanted = [(e, t) for (e, t), x in teams.items() if (e, t) not in minutes and (editions[e][0] == LEAGUE or (e, t) in honoured)]
    window_rows = [(e, t) for e, t in wanted if not teams[(e, t)]["national"]]
    windows = {}
    if window_rows:
        for edition, team, player, total, games in conn.execute(WINDOW_MINUTES, {
                "seasons": seasons, "editions": [e for e, _ in window_rows], "teams": [t for _, t in window_rows],
                "firsts": [teams[k]["first"] for k in window_rows], "lasts": [teams[k]["last"] for k in window_rows]}).fetchall():
            windows.setdefault((edition, team), [games, {}])[1][player] = total
    nations = sorted({t for e, t in wanted if teams[(e, t)]["national"]})
    seen = set()
    if nations:
        seen = {(t, p) for t, p in conn.execute(SEEN, {"nations": nations, "editions": [e for e, _ in wanted]}).fetchall()}
    cards = defaultdict(int)
    for player, yellow, second, red in conn.execute(CARDS, window).fetchall():
        cards[player] += _points({k for k, on in (("yellow_card", yellow), ("second_yellow", second), ("red_card", red)) if on})
    covered = dict(conn.execute(COVERED, window).fetchall())
    return {"editions": editions, "teams": teams, "progress": dict(progress), "ranks": ranks, "strongest": strongest, "club_leagues": club_leagues,
            "minutes": dict(minutes), "honoured": honoured, "windows": windows, "seen": seen, "national_cups": cups,
            "cards": {p: (cards.get(p, 0), covered.get(p, 0.0)) for p in set(cards) | set(covered)}}


def with_shootouts(conn, editions, competitions, rows):
    """KNOCKOUTS' rows, less the match id, a finished final without a shoot-out given the one its copy lends, else the
    one REVIEWED_SHOOTOUTS gives (§60.3). Nothing is written to the match rows."""
    finals = [(r[13], r[0], r[2], r[3], r[1], r[5], r[6], r[7], r[8]) for r in rows
              if r[4] and (r[9] is None or r[10] is None) and reached_round(None if editions[r[0]][3] else r[11], r[12]) == "final"]
    lent = {}
    if finals:
        copies = conn.execute(COPIES, {"ids": [f[0] for f in finals], "editions": [f[1] for f in finals], "homes": [f[2] for f in finals],
                                       "aways": [f[3] for f in finals], "days": [f[4] for f in finals]}).fetchall()
        lent = lent_shootouts(finals, copies, competitions)
        rest = [f for f in finals if f[0] not in lent]
        if rest and REVIEWED_SHOOTOUTS:
            keys = {m: (key, h, a) for m, key, h, a in conn.execute(LISTED, {"ids": [f[0] for f in rest], "keys": sorted(REVIEWED_SHOOTOUTS)}).fetchall()}
            lent.update(listed_shootouts(rest, keys, competitions))
    return [(*r[:9], *lent[r[13]], *r[11:13]) if r[13] in lent else tuple(r[:13]) for r in rows]


def _reached(editions, knockouts):
    """{(edition, team): (reached, reason)} of the cups and international competitions: the furthest
    round a team has a match of, played or to play; the winner of the last final played."""
    best, finals = {}, defaultdict(list)
    for edition, day, home, away, finished, hs, as_, he, ae, hp, ap, stage, name in knockouts:
        reached = reached_round(None if editions[edition][3] else stage, name)  # a cup source's round: its name alone
        if reached is None:
            continue
        for team in (home, away):
            if team is not None and ((edition, team) not in best or ROUNDS.index(reached) > ROUNDS.index(best[(edition, team)][0])):
                best[(edition, team)] = (reached, None)
        if reached == "final":
            finals[edition].append((day, finished, home, away, (hs, as_), (he, ae), (hp, ap)))
    for edition, matches in finals.items():
        day, finished, home, away, score_, extra, shootout = max(matches, key=lambda m: (m[1], m[0] is not None, m[0] or date.min))
        legs = sorted((m for m in matches if {m[2], m[3]} == {home, away}), key=lambda m: m[0] or date.min)
        if len(legs) == 2 and legs[0][2] == legs[1][3]:
            # A final of two legs, each side at home once: won on aggregate, then the second leg's shoot-out.
            if not all(m[1] for m in legs):
                continue  # a leg still to play: no winner yet
            winner = aggregate_winner(legs)
            if winner is None:
                best[(edition, home)] = best[(edition, away)] = ("final", "no_winner")
            else:
                best[(edition, winner)] = ("winner", None)
            continue
        if not finished:
            continue
        winner = final_winner(score_, extra if None not in extra else None, shootout if None not in shootout else None)
        if winner is None:
            best[(edition, home)] = best[(edition, away)] = ("final", "no_winner")
        else:
            best[(edition, home if winner == "home" else away)] = ("winner", None)
    return best


def aggregate_winner(legs):
    """The team that wins a final of two legs [(day, finished, home, away, score, extra, shootout)], in order: the
    goals of both legs (a leg's score after extra time when it has one), then the second leg's shoot-out; None when
    level without one, or when a leg has no score."""
    total = defaultdict(int)
    for _, _, home, away, score_, extra, _ in legs:
        goals = extra if None not in extra else score_
        if None in goals:
            return None
        total[home] += goals[0]
        total[away] += goals[1]
    home, away = legs[1][2], legs[1][3]
    if total[home] != total[away]:
        return home if total[home] > total[away] else away
    shootout = legs[1][6]
    if None not in shootout and shootout[0] != shootout[1]:
        return home if shootout[0] > shootout[1] else away
    return None


def honours_of(inputs, players):
    """The honours of `players` (a set): one per player, team and edition, with its parameters and the
    player's share (no value yet: evaluate() gives it)."""
    out = []
    editions, teams = inputs["editions"], inputs["teams"]
    strongest = inputs["strongest"]
    for (edition, team), facts in sorted(teams.items()):
        kind, league_level, prestige, _ = editions[edition]
        reason, reached, rank, progress, factor = None, None, None, None, None
        if kind == LEAGUE:
            finished, total = inputs["progress"].get(edition, (0, 0))
            rank, progress = inputs["ranks"].get((edition, team)), (finished / total if total else 0.0)
            factor = league_factor(league_level, strongest) if strongest is not None else 1.0
        else:
            if (edition, team) not in inputs["honoured"]:
                continue
            reached, reason = inputs["honoured"][(edition, team)]
            if kind == NATIONAL_CUP:
                if facts["national"]:
                    continue
                club = inputs["club_leagues"].get(team)
                factor = league_factor(float(club), strongest) if club is not None and strongest is not None else 0.0
                if club is None:
                    reason = reason or "no_league"
            else:
                factor = 1.0
        shares = {}
        if (edition, team) in inputs["minutes"]:
            shares = {p: share(m, facts["played"]) for p, m in inputs["minutes"][(edition, team)].items() if p in players}
        elif facts["national"]:
            shares = {p: national_share(True) for t, p in inputs["seen"] if t == team and p in players}
        elif (edition, team) in inputs["windows"]:
            games, mins = inputs["windows"][(edition, team)]
            shares = {p: share(m, games) for p, m in mins.items() if p in players}
        for p, s in sorted(shares.items()):
            if s > 0:
                out.append({"player": p, "team": team, "edition": edition, "kind": kind, "reached": reached, "league_rank": rank, "progress": progress,
                            "factor": factor, "prestige": prestige, "share": s, "value": None, "reason": reason})
    return out


# Storing ------------------------------------------------------------------------

_ROW = ("player_id", "team_id", "position", "universe", "eligible", "linked", "top_division", "measured", "individual", "collective", "card_points",
        "fair_play_minutes", "fair_play", "z_individual", "z_collective", "z_fair_play", "level", "score", "rank", "reason")
_HONOUR = ("player_id", "team_id", "competition_season_id", "kind", "reached", "league_rank", "progress", "factor", "prestige", "share", "value", "reason")


def reference_spreads(conn, season, reference_season):
    """The spreads a year is placed on: None for a year that is its own reference (it measures its own); else those its
    reference year's published race of this version kept, when that year has a race of players; else {} (§60.3): the
    year's own spreads, and no k of its own (a year in progress never measures its k)."""
    if reference_season == season:
        return None
    if reference_season is None:
        return {}
    row = conn.execute("""SELECT spreads FROM agg.award_runs WHERE season_id = %s AND status = 'published' AND version = %s
                            AND reference_season = season_id AND players > 0""", (reference_season, AWARD_VERSION)).fetchone()
    return row[0] if row and row[0] else {}


def _store(conn, season, started, level_run, reference_season, people, rows, honours, spreads):
    from psycopg.types.json import Jsonb

    run = conn.execute(
        """INSERT INTO agg.award_runs(season_id, version, started_at, level_run_id, reference_season, players, settings, spreads)
           VALUES (%s, %s, coalesce(%s, clock_timestamp()), %s, %s, %s, %s, %s) RETURNING id""",
        (season, AWARD_VERSION, started, level_run, reference_season if rows else None, len(rows), Jsonb(settings()), Jsonb(spreads) if rows else None),
    ).fetchone()[0]
    conn.execute("DELETE FROM agg.player_award_honours WHERE season_id = %s", (season,))
    conn.execute("DELETE FROM agg.player_award WHERE season_id = %s", (season,))
    with conn.cursor().copy(f"COPY agg.player_award(season_id, {', '.join(_ROW)}, run_id) FROM STDIN") as copy:
        for p, r in rows.items():
            person = people[p]
            copy.write_row((season, p, person["team"], person["position"], person.get("universe", "men"), bool(person.get("eligible")),
                            bool(person.get("linked")), bool(person.get("top_division")), bool(person.get("measured", True)), person["individual"],
                            r["collective"], r["card_points"], r["fair_play_minutes"], r["fair_play"], r["z_individual"], r["z_collective"],
                            r["z_fair_play"], r["level"], r["score"], r["rank"], r["reason"], run))
    with conn.cursor().copy(f"COPY agg.player_award_honours(season_id, {', '.join(_HONOUR)}, run_id) FROM STDIN") as copy:
        for h in honours:
            if h["player"] in rows:
                copy.write_row((season, h["player"], h["team"], h["edition"], h["kind"], h["reached"], h["league_rank"], h["progress"], h["factor"],
                                h["prestige"], h["share"], h["value"], h["reason"], run))
    conn.execute("UPDATE agg.award_runs SET status = 'superseded' WHERE season_id = %s AND status = 'published'", (season,))
    conn.execute("UPDATE agg.award_runs SET status = 'published', finished_at = clock_timestamp() WHERE id = %s", (run,))
    return run


def people_of(individual_rows, level_rows, scored):
    """The race's men's players: those with an individual part and a level row of the year, at the
    level's main position and club, with the v8 ranking's flags (minutes bar, measured league, top
    division). No row for a player without a level row (national-team matches alone) or of another
    universe (§60, 60ac)."""
    out = {}
    for p, r in individual_rows.items():
        mine = level_rows.get(p)
        if mine is None or mine.get("universe", "men") != "men":
            continue
        v8 = scored.get(p, {})
        eligible, linked = bool(v8.get("eligible")), bool(v8.get("linked"))
        out[p] = {"individual": r["level"], "position": mine["position"], "team": mine.get("team"), "universe": "men", "reference": eligible and linked,
                  "eligible": eligible, "linked": linked, "top_division": bool(v8.get("top_division")), "measured": bool(mine.get("measured", True))}
    return out


def compute(people, inputs, spreads):
    """The race of `people` from the year's read (read_inputs) and the spreads it is placed on."""
    if not people:
        return {}, [], {}
    rows, honours, used = evaluate(people, honours_of(inputs, set(people)), {p: inputs["cards"].get(p, (0, 0.0)) for p in people}, spreads)
    if inputs.get("national_cups") is not None:
        used = {**used, "national_cups": inputs["national_cups"]}
    return rows, honours, used


def write(conn, season, started, people, computed, level_run, reference_season):
    """Store the race computed for the ranking's run, inside its write transaction (started: the
    run's start; people: people_of(); computed: compute()'s result)."""
    rows, honours, spreads = computed
    return _store(conn, season, started, level_run, reference_season, people, rows, honours, spreads)


def _stored(conn, season):
    """The published race's run (id, level run, reference year, its national_cups fact, version) and its people as stored."""
    run = conn.execute("""SELECT id, level_run_id, reference_season, spreads -> 'national_cups', version FROM agg.award_runs
                          WHERE season_id = %s AND status = 'published'""", (season,)).fetchone()
    if run is None:
        return None, {}, {}
    people, cards = {}, {}
    for (p, team, position, universe, eligible, linked, top, measured, individual_part, card_points_, minutes) in conn.execute(
            """SELECT player_id, team_id, position, universe, eligible, linked, top_division, measured, individual, card_points, fair_play_minutes
               FROM agg.player_award WHERE season_id = %s""", (season,)).fetchall():
        people[p] = {"individual": individual_part, "position": position, "team": team, "universe": universe, "reference": eligible and linked,
                     "eligible": eligible, "linked": linked, "top_division": top, "measured": measured}
        cards[p] = (card_points_, minutes)
    return run, people, cards


def refresh(conn, season):
    """The race again from its stored rows (the individual parts, the honours' parameters and
    shares, the card points and covered minutes), with the present tables: no match is read. A
    run of another AWARD_VERSION is left as it is (§60.3, 60au): its honours were read under
    that version's rules, so nothing is stored and stale() goes on listing the year for the
    ranking's run. The run's own national_cups fact is kept, and a run without one stays without
    one: a placed year never takes its reference year's (60av)."""
    run, people, cards = _stored(conn, season)
    if run is None or run[4] != AWARD_VERSION:
        return 0
    names = ("player", "team", "edition", "kind", "reached", "league_rank", "progress", "factor", "prestige", "share", "reason")
    honours = [dict(zip(names, r)) for r in conn.execute(
        """SELECT player_id, team_id, competition_season_id, kind, reached, league_rank, progress, factor, prestige, share, reason
           FROM agg.player_award_honours WHERE season_id = %s ORDER BY player_id, competition_season_id, team_id""", (season,)).fetchall()]
    _, level_run, reference_season, cups, _ = run
    spreads = reference_spreads(conn, season, reference_season)
    rows, honours, used = evaluate(people, honours, cards, spreads) if people else ({}, [], {})
    used = {k: v for k, v in used.items() if k != "national_cups"}  # never the reference run's fact
    if people and cups is not None:
        used["national_cups"] = cups  # the published run's own fact: refresh reads no edition
    with conn.transaction():
        _store(conn, season, None, level_run, reference_season, people, rows, honours, used)
    return len(rows)


def reread(conn, season):
    """The race again with the year's honours and cards read again (results, rounds, tables,
    events), the individual parts as stored: the ranking and the level are not run again."""
    run, people, _ = _stored(conn, season)
    if run is None:
        return 0
    _, level_run, reference_season, _, _ = run
    started = conn.execute("SELECT clock_timestamp()").fetchone()[0]
    inputs = read_inputs(conn, season)
    spreads = reference_spreads(conn, season, reference_season)
    rows, honours, used = compute(people, inputs, spreads)
    with conn.transaction():
        _store(conn, season, started, level_run, reference_season, people, rows, honours, used)
    return len(rows)


def due(conn):
    """The years whose published race has players and a match of the award year (of its season or the
    next, dated from 1 August to 31 July: power.award_year) or an event of such a match changed after
    the race started: their honours and cards are read again (§60, 60y)."""
    return [s for (s,) in conn.execute(
        """SELECT r.season_id FROM agg.award_runs r
           CROSS JOIN LATERAL (SELECT make_date(r.season_id, 8, 1) AS start, make_date(r.season_id + 1, 8, 1) AS stop) y
           WHERE r.status = 'published' AND r.players > 0
             AND (EXISTS (SELECT 1 FROM core.matches m WHERE m.season_id IN (r.season_id, r.season_id + 1)
                            AND m.match_date >= y.start AND m.match_date < y.stop AND m.updated_at > r.started_at)
                  OR EXISTS (SELECT 1 FROM core.match_events e
                             JOIN core.matches m ON m.season_id = e.season_id AND m.id = e.match_id
                               AND m.match_date >= y.start AND m.match_date < y.stop
                             WHERE e.season_id IN (r.season_id, r.season_id + 1) AND e.updated_at > r.started_at))
           ORDER BY 1""").fetchall()]


def stale(conn):
    """The years whose published ranking and level of the present version have players and whose
    race is missing, of another AWARD_VERSION or other settings(), or started before that level; not
    a year whose last run failed with this version and these settings at or after that level's start
    (§60, 60z): the next level run, another version or other settings list it again. Also a year placed on another
    year whose k it did not take (§60.3: `collective_scale.source` not `reference`) once that year has a published race
    of this version with players: whatever the order of the years, the year in progress ends on its reference's k."""
    from psycopg.types.json import Jsonb

    return [s for (s,) in conn.execute(
        """SELECT l.season_id FROM agg.level_runs l
           JOIN agg.power_runs p ON p.season_id = l.season_id AND p.kind = 'players' AND p.status = 'published' AND p.players > 0
           LEFT JOIN agg.award_runs a ON a.season_id = l.season_id AND a.status = 'published'
           LEFT JOIN LATERAL (SELECT f.status, f.version, f.settings, f.started_at FROM agg.award_runs f
                              WHERE f.season_id = l.season_id ORDER BY f.id DESC LIMIT 1) last ON true
           WHERE l.status = 'published' AND l.version = %(level)s AND l.players > 0
             AND (a.id IS NULL OR a.version <> %(version)s OR a.settings IS DISTINCT FROM %(settings)s OR a.started_at < l.started_at
                  OR (a.reference_season <> a.season_id AND coalesce(a.spreads #>> '{collective_scale,source}', '') <> 'reference'
                      AND EXISTS (SELECT 1 FROM agg.award_runs r WHERE r.season_id = a.reference_season AND r.status = 'published'
                                    AND r.version = %(version)s AND r.reference_season = r.season_id AND r.players > 0)))
             AND NOT coalesce(last.status = 'failed' AND last.version = %(version)s AND last.settings = %(settings)s
                              AND last.started_at >= l.started_at, false)
           ORDER BY 1""", {"level": level.LEVEL_VERSION, "version": AWARD_VERSION, "settings": Jsonb(settings())}).fetchall()]


def write_failed(conn, season, started, level_run):
    """Keep the run of a ranking whose race failed (§60, 60z): its version, settings, start and level
    run, no player. The race published before stays published."""
    from psycopg.types.json import Jsonb

    return conn.execute(
        """INSERT INTO agg.award_runs(season_id, version, status, started_at, finished_at, level_run_id, players, settings)
           VALUES (%s, %s, 'failed', %s, clock_timestamp(), %s, NULL, %s) RETURNING id""",
        (season, AWARD_VERSION, started, level_run, Jsonb(settings()))).fetchone()[0]
