"""Replay of the SportScore standings cases (sportscore_cases.py) on a migrated local base.

`build` writes every case's competition, `play` runs one step through `sources.run_due`, and
`observe` reads back what a step's `expect` describes. The modules of the tree under test are
passed in, so the in-process test and the track's end-to-end script share this replay. It also
runs on a tree without migration 138: the basis then reads "no column".
"""

import copy
from urllib.parse import parse_qs, urlsplit

from sportscore_cases import CASES, CURRENT, NEXT, PREVIOUS, T0, TEAMS, VEGA, VEGA_AT

NAMES = ("Aster City", "Birch Town", "Cedar Athletic", "Fjord Rovers", "Dune Town", "Elm Park")
SOURCE_NAMES = {"sportscore": "SportScore", "vega": "Vega"}
FIELDS = ("pos", "p", "w", "d", "l", "gf", "ga", "pts")
MATCHES = {}  # (case index, label) -> match id


def ids(index):
    """The competition, editions and teams of the index-th case (1-based)."""
    return dict(competition=400 + index, editions={CURRENT: 5000 + index, PREVIOUS: 6000 + index, NEXT: 7000 + index},
                teams={name: 100 * index + n for n, name in enumerate(NAMES, 1)})


def _vega(db, edition, rows, at):
    """Vega's own table of an edition, as the calculator writes it (a group stage per group)."""
    db.execute("DELETE FROM agg.standings WHERE competition_season_id=%s", (edition,))
    for r in rows:
        db.execute(
            """INSERT INTO agg.standings(competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost,
                 goals_for, goals_against, points, updated_at)
               SELECT %s, %s, %s, t.id, %s, %s, %s, %s, %s, %s, %s, %s, %s FROM core.teams t
               JOIN core.team_seasons ts ON ts.team_id = t.id AND ts.competition_season_id = %s WHERE t.name = %s""",
            (edition, "group" if r.get("group") else None, r.get("group"), r["pos"], r["p"], r["w"], r["d"], r["l"], r["gf"],
             r["ga"], r["pts"], at, edition, r["team"]),
        )


def _bump(db, edition):
    # As the store does for a written match: the edition's version moves.
    db.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('competition_season', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1""",
        (edition,),
    )


def _game(db, index, label, g):
    """One stored match of the case's `label` edition (sportscore_cases.game)."""
    k = ids(index)
    edition = k["editions"][label]
    round_id = db.execute("INSERT INTO core.rounds(competition_season_id, name, stage) VALUES (%s, %s, %s::core.stage_kind) RETURNING id",
                          (edition, g["label"], g["stage"])).fetchone()[0]
    home, away = g["score"] or (None, None)
    MATCHES[(index, g["label"])] = db.execute(
        """INSERT INTO core.matches(competition_season_id, season_id, round_id, group_name, kickoff_at, match_date, status,
             home_team_id, away_team_id, home_score, away_score, source, first_finished_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s::core.match_status, %s, %s, %s, %s, 'pitchapi', %s, %s) RETURNING id""",
        (edition, int(label[:4]), round_id, g["group"], g["kickoff"], g["kickoff"].date(), g["status"], k["teams"][g["home"]],
         k["teams"][g["away"]], home, away, g["finished"], g["finished"] or g["kickoff"]),
    ).fetchone()[0]


def build(db, store):
    for label in (PREVIOUS, CURRENT, NEXT):
        store.season(label)
    x = db.execute
    for index, case in enumerate(CASES, 1):
        k = ids(index)
        x("INSERT INTO core.competitions(id, name, kind) VALUES (%s, %s, 'league')", (k["competition"], "Demo " + case["id"]))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi',%s,%s)",
          (case["key"], k["competition"]))
        for label, edition in k["editions"].items():
            x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current)
                 VALUES (%s, %s, %s, %s, %s)""", (edition, k["competition"], int(label[:4]), label, label == CURRENT))
        members = dict(TEAMS, **{CURRENT: TEAMS[CURRENT] + tuple(case["extra"])})
        for name, team in k["teams"].items():
            x("INSERT INTO core.teams(id, name) VALUES (%s, %s)", (team, name))
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi',%s,%s)",
              ("t_" + str(team).zfill(6), team))
            for label, clubs in members.items():
                if name in clubs:
                    x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (%s, %s)", (team, k["editions"][label]))
        for g in case["matches"]:
            _game(db, index, CURRENT, g)
        if case["vega"]:
            _vega(db, k["editions"][CURRENT], VEGA if case["vega"] is True else case["vega"], VEGA_AT)
        if case["alias"]:
            spelling, name = case["alias"]
            x("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                 VALUES ('team', %s, %s, %s, 'alias', 'vega')""", (k["teams"][name], spelling, spelling.lower()))
        if case["legacy"]:
            # Rows the writer stored before migration 138: no basis; published once.
            for r in case["legacy"]:
                x("""INSERT INTO core.standings_official(competition_season_id, team_id, position, played, won, drawn, lost,
                       goals_for, goals_against, points, source, as_of)
                     VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'sportscore', %s)""",
                  (k["editions"][CURRENT], k["teams"][r["team"]], *(r[f] for f in FIELDS), T0))
            _bump(db, k["editions"][CURRENT])


def apply(db, index, event):
    """One event of a step's `before`: a match written, a result written again, or the season flip."""
    kind, e = event
    k = ids(index)
    current = k["editions"][CURRENT]
    if kind == "match":
        _game(db, index, CURRENT, e)
        _bump(db, current)
        if e["vega"]:
            _vega(db, current, e["vega"], e["vega_at"])
    elif kind == "result":
        home, away = e["score"] or (None, None)
        db.execute(
            """UPDATE core.matches SET status = %s::core.match_status, home_score = %s, away_score = %s, revision = revision + 1,
                 updated_at = %s, first_finished_at = CASE WHEN %s = 'finished' THEN coalesce(first_finished_at, %s) ELSE first_finished_at END
               WHERE id = %s""",
            (e["status"], home, away, e["at"], e["status"], e["at"], MATCHES[(index, e["label"])]),
        )
        _bump(db, current)
        if e["vega"]:
            _vega(db, current, e["vega"], e["vega_at"])
    elif kind == "flip":
        db.execute("UPDATE core.competition_seasons SET is_current = (id = %s) WHERE competition_id = %s",
                   (k["editions"][NEXT], k["competition"]))
        for g in e["matches"]:
            _game(db, index, NEXT, g)
        if e["vega"]:
            _vega(db, k["editions"][NEXT], e["vega"], e["vega_at"])
    elif kind == "official":
        # A row another writer stored; its basis only where the column exists (138).
        r = e["row"]
        columns = "competition_season_id, stage, group_name, team_id, position, played, won, drawn, lost, goals_for, goals_against, points, source, as_of"
        values = [current, e["stage"], e["group"], k["teams"][r["team"]], *(r[f] for f in FIELDS), e["source"], e["as_of"]]
        if _has_basis(db):
            columns, values = columns + ", basis", values + [list(e["basis"])]
        db.execute(f"INSERT INTO core.standings_official({columns}) VALUES ({', '.join(['%s'] * len(values))})", values)
    else:
        raise ValueError(kind)


def _plain(values):
    """A sort key for rows holding NULLs."""
    return tuple("" if v is None else str(v) for v in values)


def _has_basis(db):
    return db.execute("""SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'core' AND table_name = 'standings_official' AND column_name = 'basis'""").fetchone() is not None


def widget(body, slug):
    """The widget's answer to a step: its body with the envelope, or an HTTP status."""
    if isinstance(body, int):
        return body
    return {"sport": "football", "competition_slug": slug, **copy.deepcopy(body)}


def play(sources, sportscore, db, case, step, get):
    """One sources.run_due pass on the case's scope only (the adapter's other scopes are not due
    for this case). Returns the step's code: None, a SourceError code, "NOT_DUE", or the class
    name of an exception that escaped run_due."""
    scope = "standings:" + case["key"]
    period = sportscore.PERIOD
    original = sportscore.scopes
    retired, retired_rows = getattr(sportscore, "RETIRED_TABLES", {}), getattr(sportscore, "RETIRED_ROWS", {})
    sportscore.scopes = lambda now: {scope: period}
    # The case's reviewed retirements, as entries of sportscore.RETIRED_TABLES (S37) and RETIRED_ROWS
    # (S46, S47, by the club's public id) would read. Other callers (the track's World Cup replays)
    # pass a case with its key only.
    sportscore.RETIRED_TABLES = {**retired, **{(case["key"], CURRENT, name): why for name, why in case.get("retired", ())}}
    teams = ids(next(i for i, c in enumerate(CASES, 1) if c["key"] == case["key"]))["teams"] if case.get("retired_rows") else {}
    sportscore.RETIRED_ROWS = {**retired_rows, **{(case["key"], CURRENT, table, "t_" + str(teams[team]).zfill(6)): why
                                                  for table, team, why in case.get("retired_rows", ())}}
    try:
        results = sources.run_due(db, get, step["at"], names={"sportscore"})
    except Exception as error:  # the baseline lets some bodies escape run_due (S25)
        return "ESCAPED:" + type(error).__name__
    finally:
        sportscore.scopes, sportscore.RETIRED_TABLES, sportscore.RETIRED_ROWS = original, retired, retired_rows
    outcome = results.get(("sportscore", scope))
    return "NOT_DUE" if outcome is None else (None if outcome == "ok" else outcome)


def slug_of(url):
    return parse_qs(urlsplit(url).query)["slug"][0]


def _edition_state(db, edition):
    # The writer's own rows: SportScore's, without a stage. Every other official row is `others`.
    official = db.execute(
        """SELECT t.name, o.group_name, o.position, o.played, o.won, o.drawn, o.lost, o.goals_for, o.goals_against, o.points
           FROM core.standings_official o JOIN core.teams t ON t.id = o.team_id
           WHERE o.competition_season_id = %s AND o.source = 'sportscore' AND o.stage IS NULL""",
        (edition,),
    ).fetchall()
    others = sorted((tuple(r) for r in db.execute(
        """SELECT o.source::text, o.stage, o.group_name, t.name, o.position, o.points
           FROM core.standings_official o JOIN core.teams t ON t.id = o.team_id
           WHERE o.competition_season_id = %s AND (o.source <> 'sportscore' OR o.stage IS NOT NULL)""", (edition,)).fetchall()),
                    key=_plain)
    stamps = {r[0] for r in db.execute(
        "SELECT as_of FROM core.standings_official WHERE competition_season_id = %s AND source = 'sportscore' AND stage IS NULL",
        (edition,)).fetchall()}
    version = db.execute(
        "SELECT version FROM ops.resource_versions WHERE resource_kind = 'competition_season' AND resource_id = %s", (edition,)
    ).fetchone()
    rows = db.execute(
        """SELECT source, as_of, group_name, name, position, points FROM api.standing_rows WHERE competition_season_id = %s
           ORDER BY stage NULLS FIRST, group_name NULLS FIRST, position, name""",
        (edition,),
    ).fetchall()
    served = None
    if rows:
        sources = sorted({SOURCE_NAMES.get(r[0], r[0]) for r in rows})
        served = (",".join(sources), max(r[1] for r in rows if r[1] is not None),
                  sorted([(r[2], r[3], r[4], r[5]) for r in rows], key=lambda t: (t[0] or "", t[2], t[1])))
    if _has_basis(db):
        basis = {name: (tuple(b) if b is not None else None) for name, b in db.execute(
            """SELECT t.name, o.basis FROM core.standings_official o JOIN core.teams t ON t.id = o.team_id
               WHERE o.competition_season_id = %s AND o.source = 'sportscore' AND o.stage IS NULL""", (edition,)).fetchall()}
    else:
        basis = "no column"
    return dict(official=sorted([tuple(r) for r in official], key=lambda t: (t[1] or "", t[2], t[0])),
                as_of=(stamps.pop() if len(stamps) == 1 else sorted(stamps) or None),
                version=version and version[0], served=served, basis=basis, others=others)


def observe(db, index, case, code, flipped):
    """The state a step's `expect` describes, read from the base."""
    k = ids(index)
    edition = k["editions"][NEXT if flipped else CURRENT]
    state = _edition_state(db, edition)
    success = db.execute("SELECT last_success_at FROM ops.source_runs WHERE source = 'sportscore' AND scope = %s",
                         ("standings:" + case["key"],)).fetchone()
    spellings = {tuple(r) for r in db.execute(
        """SELECT n.name, t.name FROM core.entity_names n JOIN core.teams t ON t.id = n.entity_id
           WHERE n.entity_type = 'team' AND t.id = ANY(%s)""", (list(k["teams"].values()),)).fetchall()}
    state.update(code=code, success=success and success[0], spellings=spellings,
                 closed=_edition_state(db, k["editions"][CURRENT]) if flipped else None)
    return state


def compare(expect, seen):
    """{assertion: (expected, seen)} of every assertion that fails; empty when the step holds."""
    failed = {}
    for key in ("code", "official", "as_of", "version", "success", "served"):
        if expect[key] != seen[key]:
            failed[key] = (expect[key], seen[key])
    if expect["basis"] is not None and expect["basis"] != seen["basis"]:
        failed["basis"] = (expect["basis"], seen["basis"])
    if expect["others"] is not None and sorted(map(tuple, expect["others"]), key=_plain) != seen["others"]:
        failed["others"] = (expect["others"], seen["others"])
    for pair in expect["absent_spellings"]:
        if tuple(pair) in seen["spellings"]:
            failed["absent_spelling " + " / ".join(pair)] = ("absent", "stored")
    if expect["closed"]:
        for key in ("official", "as_of", "version", "served"):
            if expect["closed"][key] != (seen["closed"] or {}).get(key):
                failed["closed " + key] = (expect["closed"][key], (seen["closed"] or {}).get(key))
    return failed
