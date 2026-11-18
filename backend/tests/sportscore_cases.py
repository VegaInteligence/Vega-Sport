"""SportScore standings cases: docs/calculs/09-audit-2026-11/FAILURE_MODES_SPORTSCORE.md §3.

Data only, one competition each. test_sportscore_standings.py replays them in process; the VI-27
track's end-to-end script replays them over HTTPS and the read API. The code under test is the
tree that runs them.

Each case has a current edition (2026/2027) holding Aster City, Birch Town and Cedar Athletic (and
the clubs of its `extra`), a previous one (2025/2026) holding Fjord Rovers only, and a next one
(2027/2028, not current until a "flip") holding Aster City, Birch Town and Dune Town. Vega's own
table of the current edition is written at VEGA_AT: VEGA, the case's own `vega` rows, or none
(`vega=False`). `matches` are the edition's stored matches; `legacy` rows are official rows stored
before migration 138, without a basis.

A step is one `sources.run_due` pass at `at`, the widget answering `body` (a dict) or an HTTP
status (an int). `before` lists the events applied to the base first. `expect` is the state after
the pass:
- code: None (accepted), a SourceError code, or "NOT_DUE" (the pass did not run the scope);
- official: the edition's SportScore rows, (team, group, pos, p, w, d, l, gf, ga, pts) sorted;
- as_of, version, success: their `as_of`, the edition's resource version, the scope's last success;
- served: (source, fetchedAt, [(group, team, position, points)]) of the current edition, or None
  when it has no standing rows;
- closed: official, as_of, version and served of the 2026/2027 edition once it is closed;
- absent_spellings: (spelling, team) pairs that must not be stored;
- basis (when given): {team: the stored basis, or None};
- every 200 is asked again with its own ETag, and 304 is expected.
"""

from datetime import datetime, timedelta, timezone

T0 = datetime(2026, 11, 17, 8, tzinfo=timezone.utc)
H = timedelta(hours=1)
VEGA_AT = T0 - timedelta(minutes=10)
CURRENT, PREVIOUS, NEXT = "2026/2027", "2025/2026", "2027/2028"
TEAMS = {CURRENT: ("Aster City", "Birch Town", "Cedar Athletic"), PREVIOUS: ("Fjord Rovers",),
         NEXT: ("Aster City", "Birch Town", "Dune Town")}


def row(team, pos, w, d, l, gf, ga, pts):
    return {"team": team, "pos": pos, "p": w + d + l, "w": w, "d": d, "l": l, "gf": gf, "ga": ga, "pts": pts}


def tables(*groups):
    """A widget body without its envelope (the replay adds sport and slug): (group, rows) tables."""
    return {"tables": [{"group": group, "rows": rows} for group, rows in groups]}


def stored(*groups):
    """The rows a body stores: one table is kept without its name."""
    keep = len(groups) > 1
    out = [(r["team"], (g or None) if keep else None, r["pos"], r["p"], r["w"], r["d"], r["l"], r["gf"], r["ga"], r["pts"])
           for g, rows in groups for r in rows]
    return sorted(out, key=lambda t: (t[1] or "", t[2], t[0]))


def served(source, at, *groups, keep=None):
    keep = len(groups) > 1 if keep is None else keep
    out = [((g or None) if keep else None, r["team"], r["pos"], r["pts"]) for g, rows in groups for r in rows]
    return (source, at, sorted(out, key=lambda t: (t[0] or "", t[2], t[1])))


def vega_rows(points):
    """Vega's table: [(team, pos, w, d, l, gf, ga)] as rows with their computed points."""
    return [row(t, pos, w, d, l, gf, ga, 3 * w + d) for t, pos, w, d, l, gf, ga in points]


# Aster City has 10 points by its results; the official table deducts 2.
START = [row("Aster City", 1, 3, 1, 0, 8, 1, 8), row("Birch Town", 2, 2, 1, 1, 5, 4, 7),
         row("Cedar Athletic", 3, 0, 1, 3, 2, 7, 1)]
VEGA = vega_rows([("Aster City", 1, 3, 1, 0, 8, 1), ("Birch Town", 2, 2, 1, 1, 5, 4), ("Cedar Athletic", 3, 0, 1, 3, 2, 7)])
# Aster City 1-0 Birch Town, then Vega's table counting it.
VEGA_AFTER = vega_rows([("Aster City", 1, 4, 1, 0, 9, 1), ("Birch Town", 2, 2, 1, 2, 5, 5), ("Cedar Athletic", 3, 0, 1, 3, 2, 7)])
AFTER = [row("Aster City", 1, 4, 1, 0, 9, 1, 11), row("Birch Town", 2, 2, 1, 2, 5, 5, 7),
         row("Cedar Athletic", 3, 0, 1, 3, 2, 7, 1)]
# 2027/2028, first matchday.
NEXT_TABLE = [row("Aster City", 1, 1, 0, 0, 2, 0, 3), row("Dune Town", 2, 0, 1, 0, 1, 1, 1),
              row("Birch Town", 3, 0, 1, 0, 0, 0, 1)]
NEXT_VEGA = vega_rows([("Aster City", 1, 1, 0, 0, 2, 0), ("Dune Town", 2, 0, 1, 0, 1, 1), ("Birch Town", 3, 0, 1, 0, 0, 0)])


def replace(rows, index, **values):
    out = [dict(r) for r in rows]
    out[index].update(values)
    return out


def without(rows, index, field):
    out = [dict(r) for r in rows]
    del out[index][field]
    return out


ACCEPTED = dict(code=None, official=stored((None, START)), as_of=T0, version=1, success=T0,
                served=served("SportScore", T0, (None, START)))
UNCHANGED = dict(ACCEPTED, code=None)
VEGA_SERVED = served("Vega", VEGA_AT, (None, VEGA))
TWO_UNKNOWN = replace(replace(START, 1, team="Ghost Wanderers"), 2, team="Harbour United")
LATER = T0 + 3 * H


def refused(code, **changes):
    return dict(UNCHANGED, code=code, **changes)


def game(label, home, away, score, kickoff, status="finished", stage="regular", group=None, finished=None):
    """A stored match: `score` (home, away) or None; first finished `finished` (kickoff + 1 h 50 by default)."""
    if status == "finished" and finished is None:
        finished = kickoff + timedelta(minutes=110)
    return dict(label=label, home=home, away=away, score=score, kickoff=kickoff, status=status, stage=stage, group=group,
                finished=finished if status == "finished" else None)


def match(kickoff, stage="regular", vega=None, vega_at=None, label=None, home="Aster City", away="Birch Town", score=(1, 0)):
    """A match written by the store (the edition's version moves): finished, in a round of `stage`;
    Vega's table rewritten if given. Aster City 1-0 Birch Town by default."""
    return ("match", dict(game(label or "event " + kickoff.isoformat(), home, away, score, kickoff, stage=stage), vega=vega, vega_at=vega_at))


def result(label, score, at, status="finished", vega=None, vega_at=None):
    """A stored match's result written again at `at` (finished, corrected, or annulled with status canceled)."""
    return ("result", dict(label=label, score=score, status=status, at=at, vega=vega, vega_at=vega_at))


def flip(vega=None, vega_at=None, matches=()):
    """2026/2027 closes and 2027/2028 becomes the current edition, with its `matches`."""
    return ("flip", dict(vega=vega, vega_at=vega_at, matches=list(matches)))


def official(source, base, points, basis, as_of, stage=None, group=None):
    """An official row stored by another writer (a schema-valid canary): `base`'s numbers, `points`."""
    return ("official", dict(source=source, row=dict(base, pts=points), basis=basis, as_of=as_of, stage=stage, group=group))


# The edition's double round-robin: Vega counts Aster 10, Birch 4, Cedar 3; the table deducts 2 from Aster.
DAY = timedelta(days=1)
REAL_GAMES = [game("m1", "Aster City", "Birch Town", (2, 0), T0 - 6 * DAY), game("m2", "Birch Town", "Aster City", (1, 1), T0 - 5 * DAY),
              game("m3", "Aster City", "Cedar Athletic", (3, 0), T0 - 4 * DAY), game("m4", "Cedar Athletic", "Aster City", (0, 2), T0 - 3 * DAY),
              game("m5", "Birch Town", "Cedar Athletic", (2, 1), T0 - 2 * DAY), game("m6", "Cedar Athletic", "Birch Town", (1, 0), T0 - DAY)]
REAL = [row("Aster City", 1, 3, 1, 0, 8, 1, 8), row("Birch Town", 2, 1, 1, 2, 3, 5, 4), row("Cedar Athletic", 3, 1, 0, 3, 2, 7, 3)]
REAL_VEGA = vega_rows([("Aster City", 1, 3, 1, 0, 8, 1), ("Birch Town", 2, 1, 1, 2, 3, 5), ("Cedar Athletic", 3, 1, 0, 3, 2, 7)])
REAL_BASIS = {"Aster City": (4, 3, 1, 0, 8, 1), "Birch Town": (4, 1, 1, 2, 3, 5), "Cedar Athletic": (4, 1, 0, 3, 2, 7)}
# Cedar 1-0 Birch corrected to 0-0.
CORRECTED = [row("Aster City", 1, 3, 1, 0, 8, 1, 8), row("Birch Town", 2, 1, 2, 1, 3, 4, 5), row("Cedar Athletic", 3, 0, 1, 3, 1, 7, 1)]
CORRECTED_VEGA = vega_rows([("Aster City", 1, 3, 1, 0, 8, 1), ("Birch Town", 2, 1, 2, 1, 3, 4), ("Cedar Athletic", 3, 0, 1, 3, 1, 7)])
# Cedar 1-0 Birch annulled.
ANNULLED = [row("Aster City", 1, 3, 1, 0, 8, 1, 8), row("Birch Town", 2, 1, 1, 1, 3, 4, 4), row("Cedar Athletic", 3, 0, 0, 3, 1, 7, 0)]
ANNULLED_VEGA = vega_rows([("Aster City", 1, 3, 1, 0, 8, 1), ("Birch Town", 2, 1, 1, 1, 3, 4), ("Cedar Athletic", 3, 0, 0, 3, 1, 7)])
# A new phase from Aster 1-0 Cedar, counted alone by the official table.
PHASE = [row("Aster City", 1, 1, 0, 0, 1, 0, 3), row("Birch Town", 2, 0, 0, 0, 0, 0, 0), row("Cedar Athletic", 3, 0, 0, 1, 0, 1, 0)]
PHASE_VEGA = vega_rows([("Aster City", 1, 4, 1, 0, 9, 1), ("Birch Town", 2, 1, 1, 2, 3, 5), ("Cedar Athletic", 3, 1, 0, 4, 2, 8)])
# A group stage: A (Aster 1-0 Birch), B (Cedar 2-2 Elm Park).
GROUP_GAMES = [game("g1", "Aster City", "Birch Town", (1, 0), T0 - DAY, stage="group", group="A"),
               game("g2", "Cedar Athletic", "Elm Park", (2, 2), T0 - DAY, stage="group", group="B")]
GROUP_A = [row("Aster City", 1, 1, 0, 0, 1, 0, 3), row("Birch Town", 2, 0, 0, 1, 0, 1, 0)]
GROUP_B = [row("Cedar Athletic", 1, 0, 1, 0, 2, 2, 1), row("Elm Park", 2, 0, 1, 0, 2, 2, 1)]
GROUP_VEGA = [dict(r, group="A") for r in vega_rows([("Aster City", 1, 1, 0, 0, 1, 0), ("Birch Town", 2, 0, 0, 1, 0, 1)])] + \
             [dict(r, group="B") for r in vega_rows([("Cedar Athletic", 1, 0, 1, 0, 2, 2), ("Elm Park", 2, 0, 1, 0, 2, 2)])]
# 2027/2028 under way (closed league: the same clubs), and a table of ten matches each.
NEXT_GAMES = [game("n1", "Aster City", "Birch Town", (1, 0), T0 - DAY), game("n2", "Dune Town", "Aster City", (0, 0), T0 - 2 * DAY)]
NEXT_GAMES_VEGA = vega_rows([("Aster City", 1, 1, 1, 0, 1, 0), ("Dune Town", 2, 0, 1, 0, 0, 0), ("Birch Town", 3, 0, 0, 1, 0, 1)])
TEN = [row("Aster City", 1, 7, 2, 1, 20, 8, 23), row("Dune Town", 2, 5, 3, 2, 15, 10, 18), row("Birch Town", 3, 2, 2, 6, 9, 18, 8)]
# Birch and Cedar level on points only.
TIED = [row("Aster City", 1, 3, 1, 0, 8, 1, 8), row("Birch Town", 2, 1, 1, 2, 3, 5, 4), row("Cedar Athletic", 2, 1, 1, 2, 2, 7, 4)]
MINUTE = timedelta(minutes=1)
TEN_MIN = 10 * MINUTE
REAL_ACCEPTED = dict(code=None, official=stored((None, REAL)), as_of=T0, version=1, success=T0, served=served("SportScore", T0, (None, REAL)))
CORRECTED_BASIS = dict(REAL_BASIS, **{"Birch Town": (4, 1, 2, 1, 3, 4), "Cedar Athletic": (4, 0, 1, 3, 1, 7)})
ANNULLED_BASIS = dict(REAL_BASIS, **{"Birch Town": (3, 1, 1, 1, 3, 4), "Cedar Athletic": (3, 0, 0, 3, 1, 7)})
PHASE_BASIS = dict(REAL_BASIS, **{"Aster City": (5, 4, 1, 0, 9, 1), "Cedar Athletic": (5, 1, 0, 4, 2, 8)})
NO_BASIS = {"Aster City": None, "Birch Town": None, "Cedar Athletic": None}
AFTER_BASIS = {"Aster City": (1, 1, 0, 0, 1, 0), "Birch Town": (1, 0, 0, 1, 0, 1), "Cedar Athletic": (0, 0, 0, 0, 0, 0)}
# A ranking across groups, as the World Cup's of third-placed teams: its clubs are also in their group.
SECOND_NAME = "Ranking of second placed teams"
SECOND = [row("Elm Park", 1, 0, 1, 0, 2, 2, 1), row("Birch Town", 2, 0, 0, 1, 0, 1, 0)]
GROUPS = (("Group A", GROUP_A), ("Group B", GROUP_B))
GROUPS_AND_SECOND = GROUPS + ((SECOND_NAME, SECOND),)
EARLY_GAMES = [game("ab", "Aster City", "Birch Town", (1, 0), T0 - DAY),
               game("ca", "Cedar Athletic", "Aster City", None, T0 + DAY, status="not_started")]
EARLY = GROUP_A + [row("Cedar Athletic", 3, 0, 0, 0, 0, 0, 0)]
ZERO = [row(team, position, 0, 0, 0, 0, 0, 0) for position, team in enumerate(TEAMS[CURRENT], 1)]
# Stage 4: the group stage accepted whole, then Birch 2-0 Aster moving Aster to group A's 2nd place.
THREE_ACCEPTED = dict(code=None, official=stored(*GROUPS_AND_SECOND), as_of=T0, version=1, success=T0,
                      served=served("SportScore", T0, *GROUPS_AND_SECOND))
GROUP_A2 = [row("Birch Town", 1, 1, 0, 1, 2, 1, 3), row("Aster City", 2, 1, 0, 1, 1, 2, 3)]
SECOND2 = [row("Aster City", 1, 1, 0, 1, 1, 2, 3), row("Elm Park", 2, 0, 1, 0, 2, 2, 1)]
MOVED = (("Group A", GROUP_A2), ("Group B", GROUP_B), (SECOND_NAME, SECOND2))
GROUP_VEGA2 = [dict(r, group="A") for r in vega_rows([("Birch Town", 1, 1, 0, 1, 2, 1), ("Aster City", 2, 1, 0, 1, 1, 2)])] + \
              GROUP_VEGA[2:]
MOVED_BASIS = {"Aster City": (2, 1, 0, 1, 1, 2), "Birch Town": (2, 1, 0, 1, 2, 1), "Cedar Athletic": (1, 0, 1, 0, 2, 2),
               "Elm Park": (1, 0, 1, 0, 2, 2)}
# Elm Park loses its point (a deduction), in its group and in the ranking.
DEDUCTED = (("Group A", GROUP_A), ("Group B", [GROUP_B[0], dict(GROUP_B[1], pts=0)]),
            (SECOND_NAME, [dict(SECOND[0], pts=0), SECOND[1]]))
RENAMED = (("Round 1 / Group A", GROUP_A), ("Round 1 / Group B", GROUP_B))
# The rows other writers left (source, stage, group, team, position, points), and a stale basis.
ZERO_BASIS = (0, 0, 0, 0, 0, 0)
OTHER_ASTER = ("other", None, None, "Aster City", 1, 777)
STAGED_ASTER = ("sportscore", "old-playoff", None, "Aster City", 1, 777)


CASES = [
    dict(id="S1", key="l_0275VP", note="first observation, complete, with a deduction", steps=[]),
    dict(id="S2", key="l_0aEfof", note="HTTP 200 without a table",
         steps=[dict(at=LATER, body=tables(), expect=refused("EMPTY_TABLE"))]),
    dict(id="S3", key="l_0ahLw8", note="3 -> 2 rows, both linkable",
         steps=[dict(at=LATER, body=tables(("", START[:2])), expect=refused("INCOMPLETE_TABLE"))]),
    dict(id="S4", key="l_0ALvwF", note="two names the base does not know",
         steps=[dict(at=LATER, body=tables(("", TWO_UNKNOWN)), expect=refused("UNMATCHED_TEAMS"))]),
    dict(id="S5", key="l_0bfbkO", note="third row: a club of the previous edition",
         steps=[dict(at=LATER, body=tables(("", replace(START, 2, team="Fjord Rovers", d=2, l=3, p=5, pts=2))),
                     expect=refused("WRONG_EDITION", absent_spellings=[("Fjord Rovers", "Cedar Athletic")]))]),
    dict(id="S6", key="l_0eg6C9", note="a reviewed alias, corrected to 2 points", alias=("Bluebirds", "Cedar Athletic"),
         steps=[dict(at=LATER, body=tables(("", replace(START, 2, team="Bluebirds", d=2, l=3, p=5, pts=2))),
                     expect=dict(code=None, as_of=LATER, version=2, success=LATER,
                                 official=stored((None, replace(START, 2, team="Cedar Athletic", d=2, l=3, p=5, pts=2))),
                                 served=served("SportScore", LATER, (None, replace(START, 2, team="Cedar Athletic", pts=2)))))]),
    dict(id="S7", key="l_0ErfuF", note="goals scored missing for a club, known before",
         steps=[dict(at=LATER, body=tables(("", without(START, 0, "gf"))), expect=refused("MISSING_FIELD"))]),
    dict(id="S8", key="l_0F4I4F", note="points given as a string",
         steps=[dict(at=LATER, body=tables(("", replace(START, 1, pts="7"))), expect=refused("INVALID_ROW"))]),
    dict(id="S9", key="l_0jy5yE", note="a club listed twice",
         steps=[dict(at=LATER, body=tables(("", START + [row("Birch Town", 4, 0, 0, 4, 0, 6, 0)])), expect=refused("DUPLICATE_ROW"))]),
    dict(id="S10", key="l_0kSJLz", note="two clubs 2nd, not level",
         steps=[dict(at=LATER, body=tables(("", replace(START, 2, pos=2))), expect=refused("DUPLICATE_POSITION"))]),
    dict(id="S11", key="l_0Lpz1f", note="first observation: two level clubs share 2nd", accepted=False,
         steps=[dict(at=T0, body=tables(("", replace(START, 2, pos=2, w=2, d=1, l=1, p=4, gf=5, ga=4, pts=7))),
                     expect=dict(code=None, as_of=T0, version=1, success=T0,
                                 official=stored((None, replace(START, 2, pos=2, w=2, d=1, l=1, p=4, gf=5, ga=4, pts=7))),
                                 served=served("SportScore", T0, (None, replace(START, 2, pos=2, pts=7)))))]),
    dict(id="S12", key="l_0S1uaf", note="first observation: two groups, a 1st in each", accepted=False,
         steps=[dict(at=T0, body=tables(("Group A", START[:2]), ("Group B", [dict(START[2], pos=1)])),
                     expect=dict(code=None, as_of=T0, version=1, success=T0,
                                 official=stored(("Group A", START[:2]), ("Group B", [dict(START[2], pos=1)])),
                                 served=served("SportScore", T0, ("Group A", START[:2]), ("Group B", [dict(START[2], pos=1)]))))]),
    dict(id="S13", key="l_0uqFK8", note="the table splits into two named tables",
         steps=[dict(at=LATER, body=tables(("Top", START[:2]), ("Bottom", START[2:])),
                     expect=dict(code=None, as_of=LATER, version=2, success=LATER,
                                 official=stored(("Top", START[:2]), ("Bottom", START[2:])),
                                 served=served("SportScore", LATER, ("Top", START[:2]), ("Bottom", START[2:]))))]),
    dict(id="S14", key="l_16Sq13", note="complete correction: 3 points deducted from Birch Town",
         steps=[dict(at=LATER, body=tables(("", replace(START, 1, pts=4))),
                     expect=dict(code=None, as_of=LATER, version=2, success=LATER, official=stored((None, replace(START, 1, pts=4))),
                                 served=served("SportScore", LATER, (None, replace(START, 1, pts=4)))))]),
    dict(id="S15", key="l_1BFfna", note="identical table: a valid repeat",
         steps=[dict(at=LATER, body=tables(("", START)),
                     expect=dict(UNCHANGED, as_of=LATER, success=LATER, served=served("SportScore", LATER, (None, START))))]),
    dict(id="S16", key="l_1D8Xrl", note="identical table after a counted match",
         steps=[dict(at=LATER, before=[match(T0 + H, vega=VEGA_AFTER, vega_at=T0 + 2 * H)], body=tables(("", START)),
                     expect=dict(UNCHANGED, version=2, success=LATER, served=served("Vega", T0 + 2 * H, (None, VEGA_AFTER))))]),
    dict(id="S17", key="l_1dmt9H", note="the same refusal again, and the bounded retry",
         steps=[dict(at=LATER, body=tables(), expect=refused("EMPTY_TABLE")),
                dict(at=LATER + H / 2, body=tables(), expect=refused("NOT_DUE")),
                dict(at=LATER + H, body=tables(), expect=refused("EMPTY_TABLE"))]),
    dict(id="S18", key="l_1eJSA7", note="HTTP 503",
         steps=[dict(at=LATER, body=503, expect=refused("HTTP_503"))]),
    dict(id="S19", key="l_1Isor4", note="no accepted table, the first response refused", accepted=False,
         steps=[dict(at=T0, body=tables(("", TWO_UNKNOWN)),
                     expect=dict(code="UNMATCHED_TEAMS", official=[], as_of=None, version=None, success=None, served=VEGA_SERVED))]),
    dict(id="S20", key="l_1Kknkl", note="no accepted table, no Vega table, the first response refused", accepted=False, vega=False,
         steps=[dict(at=T0, body=tables(("", TWO_UNKNOWN)),
                     expect=dict(code="UNMATCHED_TEAMS", official=[], as_of=None, version=None, success=None, served=None))]),
    dict(id="S21", key="l_1LMdEO", note="behind after a counted match, refused, then a new complete table",
         steps=[dict(at=LATER, before=[match(T0 + H, vega=VEGA_AFTER, vega_at=T0 + 2 * H)], body=tables(),
                     expect=refused("EMPTY_TABLE", version=2, served=served("Vega", T0 + 2 * H, (None, VEGA_AFTER)))),
                dict(at=T0 + 6 * H, body=tables(("", AFTER)),
                     expect=dict(code=None, official=stored((None, AFTER)), as_of=T0 + 6 * H, version=3, success=T0 + 6 * H,
                                 served=served("SportScore", T0 + 6 * H, (None, AFTER))))]),
    dict(id="S22", key="l_1pQOHK", note="a finished play-off match does not age the table",
         steps=[dict(at=LATER, before=[match(T0 + H, stage="playoff")], body=503, expect=refused("HTTP_503", version=2))]),
    dict(id="S23", key="l_1qpFVw", note="next season: a new current edition and SportScore's new table",
         steps=[dict(at=LATER, before=[flip()], body=tables(("", NEXT_TABLE)),
                     expect=dict(code=None, official=stored((None, NEXT_TABLE)), as_of=LATER, version=1, success=LATER,
                                 served=served("SportScore", LATER, (None, NEXT_TABLE)),
                                 closed=dict(official=stored((None, START)), as_of=T0, version=1,
                                             served=served("SportScore", T0, (None, START)))))]),
    dict(id="S24", key="l_1rPvVD", note="a new current edition while SportScore still shows last season",
         steps=[dict(at=LATER, before=[flip(vega=NEXT_VEGA, vega_at=T0 + 2 * H)], body=tables(("", START)),
                     expect=dict(code="WRONG_EDITION", official=[], as_of=None, version=None, success=T0,
                                 served=served("Vega", T0 + 2 * H, (None, NEXT_VEGA)),
                                 absent_spellings=[("Cedar Athletic", "Dune Town")],
                                 closed=dict(official=stored((None, START)), as_of=T0, version=1,
                                             served=served("SportScore", T0, (None, START)))))]),
    dict(id="S25", key="l_1TTHxD", note="a table that is not an object",
         steps=[dict(at=LATER, body={"tables": ["oops"]}, expect=refused("INVALID_ROW"))]),
    dict(id="S26", key="l_1TVRZW", note="the same clubs, every club's played count lower (a fresh start)",
         steps=[dict(at=LATER, body=tables(("", [row("Aster City", 1, 1, 0, 0, 2, 0, 3), row("Birch Town", 2, 0, 1, 0, 1, 1, 1),
                                                  row("Cedar Athletic", 3, 0, 0, 1, 0, 2, 0)])),
                     expect=refused("PLAYED_DECREASED"))]),
    # Stage 2 (FAILURE_MODES_SPORTSCORE.md §3, S27-S35): the edition's matches are stored.
    dict(id="S27", key="l_1W6idJ", note="first observation: rows 1-2 of 3, the third club has counted results", accepted=False,
         matches=REAL_GAMES, vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL[:2])),
                     expect=dict(code="INCOMPLETE_TABLE", official=[], as_of=None, version=None, success=None,
                                 served=served("Vega", VEGA_AT, (None, REAL_VEGA))))]),
    dict(id="S28", key="l_1XLtP0", note="first observation without a whole group, then both groups", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(("Group A", GROUP_A)),
                     expect=dict(code="INCOMPLETE_TABLE", official=[], as_of=None, version=None, success=None,
                                 served=served("Vega", VEGA_AT, ("A", GROUP_VEGA[:2]), ("B", GROUP_VEGA[2:])))),
                dict(at=LATER, body=tables(("Group A", GROUP_A), ("Group B", GROUP_B)),
                     expect=dict(code=None, official=stored(("Group A", GROUP_A), ("Group B", GROUP_B)), as_of=LATER, version=1,
                                 success=LATER, served=served("SportScore", LATER, ("Group A", GROUP_A), ("Group B", GROUP_B))))]),
    dict(id="S29", key="l_1XsMdH", note="a match in play at the observation finishes after it",
         matches=[game("ip", "Aster City", "Birch Town", (1, 0), T0 - H, status="in_play")],
         steps=[dict(at=LATER, before=[result("ip", (1, 0), T0 + timedelta(minutes=50), vega=VEGA_AFTER, vega_at=T0 + H)],
                     body=tables(("", START)), expect=dict(UNCHANGED, version=2, success=LATER, served=served("Vega", T0 + H, (None, VEGA_AFTER)))),
                dict(at=T0 + 6 * H, body=tables(("", AFTER)),
                     expect=dict(code=None, official=stored((None, AFTER)), as_of=T0 + 6 * H, version=3, success=T0 + 6 * H,
                                 served=served("SportScore", T0 + 6 * H, (None, AFTER))))]),
    dict(id="S30", key="l_1xXulJ", note="a stored result corrected after the observation", accepted=False,
         matches=REAL_GAMES, vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL)), expect=dict(REAL_ACCEPTED, basis=REAL_BASIS)),
                dict(at=LATER, before=[result("m6", (0, 0), T0 + H, vega=CORRECTED_VEGA, vega_at=T0 + H + TEN_MIN)], body=tables(("", REAL)),
                     expect=dict(REAL_ACCEPTED, version=2, success=LATER, basis=REAL_BASIS,
                                 served=served("Vega", T0 + H + TEN_MIN, (None, CORRECTED_VEGA)))),
                dict(at=T0 + 6 * H, body=tables(("", CORRECTED)),
                     expect=dict(code=None, official=stored((None, CORRECTED)), as_of=T0 + 6 * H, version=3, success=T0 + 6 * H,
                                 served=served("SportScore", T0 + 6 * H, (None, CORRECTED)), basis=CORRECTED_BASIS))]),
    dict(id="S31", key="l_20pNSc", note="an annulled result: a lower played count the results attest", accepted=False,
         matches=REAL_GAMES, vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL)), expect=REAL_ACCEPTED),
                dict(at=LATER, before=[result("m6", None, T0 + H, status="canceled", vega=ANNULLED_VEGA, vega_at=T0 + H + TEN_MIN)],
                     body=tables(("", ANNULLED)),
                     expect=dict(code=None, official=stored((None, ANNULLED)), as_of=LATER, version=3, success=LATER,
                                 served=served("SportScore", LATER, (None, ANNULLED)), basis=ANNULLED_BASIS))]),
    dict(id="S32", key="l_214sqK", note="a new phase counted from the observation", accepted=False,
         matches=REAL_GAMES, vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL)), expect=REAL_ACCEPTED),
                dict(at=LATER, before=[match(T0 + H, label="p1", away="Cedar Athletic", vega=PHASE_VEGA, vega_at=T0 + 2 * H + 55 * MINUTE)],
                     body=tables(("", PHASE)),
                     expect=dict(code=None, official=stored((None, PHASE)), as_of=LATER, version=3, success=LATER,
                                 served=served("SportScore", LATER, (None, PHASE)), basis=PHASE_BASIS))]),
    dict(id="S33", key="l_271pqa", note="a closed league: ten matches a club while the next edition has kicked off one or two",
         steps=[dict(at=LATER, before=[flip(vega=NEXT_GAMES_VEGA, vega_at=T0 + 2 * H, matches=NEXT_GAMES)], body=tables(("", TEN)),
                     expect=dict(code="WRONG_EDITION", official=[], as_of=None, version=None, success=T0,
                                 served=served("Vega", T0 + 2 * H, (None, NEXT_GAMES_VEGA)),
                                 closed=dict(official=stored((None, START)), as_of=T0, version=1,
                                             served=served("SportScore", T0, (None, START)))))]),
    dict(id="S34", key="l_2ApGa4", note="first observation: equal points share 2nd, different goal difference", accepted=False,
         steps=[dict(at=T0, body=tables(("", TIED)),
                     expect=dict(code=None, official=stored((None, TIED)), as_of=T0, version=1, success=T0,
                                 served=served("SportScore", T0, (None, TIED))))]),
    dict(id="S35", key="l_2EKrnc", note="rows stored before migration 138, without a basis", accepted=False, legacy=START,
         steps=[dict(at=T0 + H / 2, body=503,
                     expect=dict(code="HTTP_503", official=stored((None, START)), as_of=T0, version=1, success=None,
                                 served=served("SportScore", T0, (None, START)), basis=NO_BASIS)),
                dict(at=LATER, before=[match(T0 + H, vega=VEGA_AFTER, vega_at=T0 + 2 * H + 55 * MINUTE)], body=tables(("", START)),
                     expect=dict(code=None, official=stored((None, START)), as_of=T0, version=2, success=LATER,
                                 served=served("Vega", T0 + 2 * H + 55 * MINUTE, (None, VEGA_AFTER)), basis=NO_BASIS)),
                dict(at=T0 + 6 * H, body=tables(("", AFTER)),
                     expect=dict(code=None, official=stored((None, AFTER)), as_of=T0 + 6 * H, version=3, success=T0 + 6 * H,
                                 served=served("SportScore", T0 + 6 * H, (None, AFTER)), basis=AFTER_BASIS))]),
    # Stage 3 (FAILURE_MODES_SPORTSCORE.md §3, S36-S40): table identity and one authority.
    dict(id="S36", key="l_2L6d1F", note="a ranking across groups added, then dropped while its clubs stay in their groups",
         accepted=False, extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS),
                     expect=dict(code=None, official=stored(*GROUPS), as_of=T0, version=1, success=T0, served=served("SportScore", T0, *GROUPS))),
                dict(at=LATER, body=tables(*GROUPS_AND_SECOND),
                     expect=dict(code=None, official=stored(*GROUPS_AND_SECOND), as_of=LATER, version=2, success=LATER,
                                 served=served("SportScore", LATER, *GROUPS_AND_SECOND))),
                dict(at=T0 + 6 * H, body=tables(*GROUPS),
                     expect=dict(code="INCOMPLETE_TABLE", official=stored(*GROUPS_AND_SECOND), as_of=LATER, version=2, success=LATER,
                                 served=served("SportScore", LATER, *GROUPS_AND_SECOND))),
                dict(at=T0 + 9 * H, body=tables(*GROUPS_AND_SECOND),
                     expect=dict(code=None, official=stored(*GROUPS_AND_SECOND), as_of=T0 + 9 * H, version=2, success=T0 + 9 * H,
                                 served=served("SportScore", T0 + 9 * H, *GROUPS_AND_SECOND)))]),
    dict(id="S37", key="l_2Mh0jT", note="a ranking across groups retired by review", accepted=False, extra=("Elm Park",),
         matches=GROUP_GAMES, vega=GROUP_VEGA, retired=[(SECOND_NAME, "audit, 18 Nov 2026: synthetic case S37")],
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND),
                     expect=dict(code=None, official=stored(*GROUPS_AND_SECOND), as_of=T0, version=1, success=T0,
                                 served=served("SportScore", T0, *GROUPS_AND_SECOND))),
                dict(at=LATER, body=tables(*GROUPS),
                     expect=dict(code=None, official=stored(*GROUPS), as_of=LATER, version=2, success=LATER,
                                 served=served("SportScore", LATER, *GROUPS)))]),
    dict(id="S38", key="l_2tFk9k", note="a stale row of another provider", accepted=False, matches=REAL_GAMES, vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL)), expect=REAL_ACCEPTED),
                dict(at=LATER, before=[official("other", REAL[0], 777, ZERO_BASIS, T0 - DAY)], body=503,
                     expect=dict(REAL_ACCEPTED, code="HTTP_503", others=[OTHER_ASTER])),
                dict(at=T0 + 6 * H, body=tables(("", REAL)),
                     expect=dict(REAL_ACCEPTED, as_of=T0 + 6 * H, success=T0 + 6 * H, others=[OTHER_ASTER],
                                 served=served("SportScore", T0 + 6 * H, (None, REAL))))]),
    dict(id="S39", key="l_2WZ2tt", note="a later row of another provider for one club", accepted=False, matches=REAL_GAMES,
         vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL)), expect=REAL_ACCEPTED),
                dict(at=LATER, before=[official("other", REAL[0], 777, REAL_BASIS["Aster City"], T0 + DAY)], body=503,
                     expect=dict(REAL_ACCEPTED, code="HTTP_503", others=[OTHER_ASTER]))]),
    dict(id="S40", key="l_2xBPKk", note="a stale stage of the same provider", accepted=False, matches=REAL_GAMES, vega=REAL_VEGA,
         steps=[dict(at=T0, body=tables(("", REAL)), expect=REAL_ACCEPTED),
                dict(at=LATER, before=[official("sportscore", REAL[0], 777, ZERO_BASIS, T0 - DAY, stage="old-playoff")], body=503,
                     expect=dict(REAL_ACCEPTED, code="HTTP_503", others=[STAGED_ASTER])),
                dict(at=T0 + 6 * H, body=tables(("", REAL)),
                     expect=dict(REAL_ACCEPTED, as_of=T0 + 6 * H, success=T0 + 6 * H, others=[STAGED_ASTER],
                                 served=served("SportScore", T0 + 6 * H, (None, REAL))))]),
    # Stage 4 (FAILURE_MODES_SPORTSCORE.md §3, S41-S47): completeness within a table, partition and cross tables.
    dict(id="S41", key="l_38d9HA", note="the cross table loses a row while its club stays in its group", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(*GROUPS, (SECOND_NAME, SECOND[:1])), expect=dict(THREE_ACCEPTED, code="INCOMPLETE_TABLE")),
                dict(at=T0 + 6 * H, body=tables(*GROUPS_AND_SECOND),
                     expect=dict(THREE_ACCEPTED, as_of=T0 + 6 * H, success=T0 + 6 * H,
                                 served=served("SportScore", T0 + 6 * H, *GROUPS_AND_SECOND)))]),
    dict(id="S42", key="l_3CB6qX", note="the cross table's members change as the stage advances, same count", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, before=[match(T0 + H, stage="group", label="g3", home="Birch Town", away="Aster City", score=(2, 0),
                                             vega=GROUP_VEGA2, vega_at=T0 + 2 * H)],
                     body=tables(*MOVED),
                     expect=dict(code=None, official=stored(*MOVED), as_of=LATER, version=3, success=LATER,
                                 served=served("SportScore", LATER, *MOVED), basis=MOVED_BASIS))]),
    dict(id="S43", key="l_3Ci5Cg", note="a complete correction across a group and the cross table", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(*DEDUCTED),
                     expect=dict(code=None, official=stored(*DEDUCTED), as_of=LATER, version=2, success=LATER,
                                 served=served("SportScore", LATER, *DEDUCTED)))]),
    dict(id="S44", key="l_3fglZv", note="the groups renamed, the cross table left out: no new phase", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(*RENAMED), expect=dict(THREE_ACCEPTED, code="INCOMPLETE_TABLE"))]),
    dict(id="S45", key="l_3hW1NO", note="a group loses a club that stays in the cross table", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(("Group A", GROUP_A[:1]), ("Group B", GROUP_B), (SECOND_NAME, SECOND)),
                     expect=dict(THREE_ACCEPTED, code="INCOMPLETE_TABLE"))]),
    dict(id="S46", key="l_3Kf7Ni", note="a reviewed retirement lets one row leave the cross table", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         retired_rows=[(SECOND_NAME, "Birch Town", "audit, 18 Nov 2026: synthetic case S46")],
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(*GROUPS, (SECOND_NAME, SECOND[:1])),
                     expect=dict(code=None, official=stored(*GROUPS, (SECOND_NAME, SECOND[:1])), as_of=LATER, version=2,
                                 success=LATER, served=served("SportScore", LATER, *GROUPS, (SECOND_NAME, SECOND[:1]))))]),
    dict(id="S47", key="l_3kyHLd", note="the same retirement does not let another row leave", accepted=False,
         extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         retired_rows=[(SECOND_NAME, "Birch Town", "audit, 18 Nov 2026: synthetic case S47")],
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(*GROUPS, (SECOND_NAME, SECOND[1:])), expect=dict(THREE_ACCEPTED, code="INCOMPLETE_TABLE"))]),
    dict(id="S48", key="l_3xwVF2", note="renamed and reshuffled groups do not prove retirement of the cross table",
         accepted=False, extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(("Round 1 / Group A", [GROUP_A[0], dict(GROUP_B[1], pos=2)]),
                                           ("Round 1 / Group B", [GROUP_B[0], GROUP_A[1]])),
                     expect=dict(THREE_ACCEPTED, code="INCOMPLETE_TABLE"))]),
    dict(id="S49", key="l_4MU9Yh", note="a complete group rename retains all memberships and the cross table",
         accepted=False, extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(*GROUPS_AND_SECOND), expect=THREE_ACCEPTED),
                dict(at=LATER, body=tables(*RENAMED, (SECOND_NAME, SECOND)),
                     expect=dict(code=None, official=stored(*RENAMED, (SECOND_NAME, SECOND)), as_of=LATER, version=2,
                                 success=LATER, served=served("SportScore", LATER, *RENAMED, (SECOND_NAME, SECOND))))]),
    dict(id="S50", key="l_49KZaB", note="first league response omits a member without a played result",
         accepted=False, vega=False, matches=EARLY_GAMES,
         steps=[dict(at=T0, body=tables(("", EARLY[:2])),
                     expect=dict(code="INCOMPLETE_TABLE", official=[], as_of=None, version=None, success=None, served=None)),
                dict(at=LATER, body=tables(("", EARLY)),
                     expect=dict(code=None, official=stored((None, EARLY)), as_of=LATER, version=1, success=LATER,
                                 served=served("SportScore", LATER, (None, EARLY))))]),
    dict(id="S51", key="l_49Zmno", note="full roster accepted at zero before a calendar is reported",
         accepted=False, vega=False,
         steps=[dict(at=T0, body=tables(("", ZERO)),
                     expect=dict(code=None, official=stored((None, ZERO)), as_of=T0, version=1, success=T0,
                                 served=served("SportScore", T0, (None, ZERO))))]),
    dict(id="S52", key="l_4auCPk", kind="cup", note="known initial group phase excludes a qualifying-only club",
         accepted=False, extra=("Elm Park", "Fjord Rovers"), vega=GROUP_VEGA,
         matches=GROUP_GAMES + [game("q1", "Fjord Rovers", "Aster City", None, T0 + DAY, status="not_started", stage="qualifying")],
         steps=[dict(at=T0, body=tables(*GROUPS),
                     expect=dict(code=None, official=stored(*GROUPS), as_of=T0, version=1, success=T0,
                                 served=served("SportScore", T0, *GROUPS)))]),
    dict(id="S53", key="l_4d6Bwl", kind="cup", note="first observed cup table with no independently known phase",
         accepted=False, vega=False,
         steps=[dict(at=T0, body=tables(("Group A", ZERO)),
                     expect=dict(code="UNVERIFIED_TABLE", official=[], as_of=None, version=None, success=None, served=None))]),
    dict(id="S54", key="l_4DWyTT", kind="cup", note="the first table swaps two known groups without a phase change",
         accepted=False, extra=("Elm Park",), matches=GROUP_GAMES, vega=GROUP_VEGA,
         steps=[dict(at=T0, body=tables(("Group A", GROUP_B), ("Group B", GROUP_A)),
                     expect=dict(code="INCOMPLETE_TABLE", official=[], as_of=None, version=None, success=None,
                                 served=served("Vega", VEGA_AT, ("A", GROUP_VEGA[:2]), ("B", GROUP_VEGA[2:]))))]),
]

for _case in CASES:
    # The accepted observation every case starts from, unless it starts from none.
    if _case.setdefault("accepted", True):
        _case["steps"] = [dict(at=T0, body=tables(("", START)), expect=ACCEPTED)] + _case["steps"]
    _case.setdefault("vega", True)
    _case.setdefault("alias", None)
    _case.setdefault("extra", ())
    _case.setdefault("matches", [])
    _case.setdefault("legacy", None)
    _case.setdefault("retired", [])
    _case.setdefault("retired_rows", [])
    for _step in _case["steps"]:
        _step.setdefault("before", [])
        _step["expect"] = dict({"absent_spellings": [], "closed": None, "basis": None, "others": None}, **_step["expect"])
