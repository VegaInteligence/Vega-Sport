"""Official league tables of SportScore (sportscore.com widget), as main's
/api/standings source (frontend/src/services/sportscore-standings.js).

SportScore gives the current table of a competition, without a season, and names
without ids. A table is written for the competition's current edition only when every
row designates exactly one team of that edition (normalized name, short name, a
known spelling, or the last team left); otherwise nothing official is kept and the
API serves Vega's own table. A table that names other clubs (a new season on one side
only) therefore never lands on the wrong edition.
"""

from datetime import timedelta
from urllib.parse import urlencode

from . import SourceError, normalize

URL = "https://sportscore.com/api/widget/standings/"
PERIOD = timedelta(hours=2)

# dashboard/frontend/src/services/sportscore-standings.js (main); a drift test compares them.
LEAGUES = {
    "l_0275VP": "french-ligue-2",
    "l_0aEfof": "united-arab-emirates-adnoc-pro-league",
    "l_0ahLw8": "english-football-league-one",
    "l_0ALvwF": "italian-serie-a",
    "l_0bfbkO": "uefa-champions-league",
    "l_0eg6C9": "united-states-major-league-soccer",
    "l_0ErfuF": "spanish-la-liga",
    "l_0F4I4F": "czech-chance-liga",
    "l_0jy5yE": "italian-serie-b",
    "l_0kSJLz": "romanian-super-liga",
    "l_0Lpz1f": "saudi-professional-league",
    "l_0S1uaf": "turkish-super-league",
    "l_0uqFK8": "norwegian-eliteserien",
    "l_16Sq13": "israel-premier-league",
    "l_1BFfna": "turkish-first-league",
    "l_1D8Xrl": "brazilian-serie-a",
    "l_1dmt9H": "ligapro-serie-a",
    "l_1eJSA7": "ireland-premier-division",
    "l_1Isor4": "bundesliga",
    "l_1Kknkl": "south-africa-premier-soccer-league",
    "l_1LMdEO": "scottish-premiership",
    "l_1pQOHK": "belgian-challenger-pro-league",
    "l_1qpFVw": "indian-super-league",
    "l_1rPvVD": "danish-1st-division",
    "l_1TTHxD": "iceland-besta-deild-karla",
    "l_1TVRZW": "venezuela-primera-division",
    "l_1W6idJ": "english-football-league-two",
    "l_1XLtP0": "fifa-world-cup",
    "l_1XsMdH": "sweden-allsvenskan",
    "l_1xXulJ": "categoria-primera-a",
    "l_20pNSc": "chinese-football-super-league",
    "l_214sqK": "pko-bank-polski-ekstraklasa",
    "l_271pqa": "korean-k-league-2",
    "l_2ApGa4": "japanese-j1-league",
    "l_2EKrnc": "korean-k-league-1",
    "l_2L6d1F": "belgian-pro-league",
    "l_2Mh0jT": "russian-premier-league",
    "l_2tFk9k": "croatian-football-league",
    "l_2WZ2tt": "uefa-europa-conference-league",
    "l_2xBPKk": "serbian-mozzart-bet-superliga",
    "l_38d9HA": "uefa-europa-league",
    "l_3CB6qX": "saudi-arabia-division-1",
    "l_3Ci5Cg": "finnish-veikkausliiga",
    "l_3fglZv": "japanese-j3-league",
    "l_3FJFUl": "french-ligue-1",
    "l_3hvsne": "german-bundesliga-2",
    "l_3hW1NO": "thai-league-1",
    "l_3Kf7Ni": "usl-league-one",
    "l_3kyHLd": "spanish-segunda-division",
    "l_3qNjzC": "chi-liga-de-primera",
    "l_3qUkB8": "brazilian-serie-b",
    "l_3Tn1kG": "mls-next-pro",
    "l_3UiOcj": "canadian-premier-league",
    "l_3uNwVX": "peruvian-liga-1",
    "l_3v84VE": "mexico-liga-mx",
    "l_3wr44B": "qatar-stars-league",
    "l_3xwVF2": "greek-super-league",
    "l_3yVUAO": "usl-championship",
    "l_3zsMpo": "austrian-bundesliga",
    "l_45VZuL": "argentine-division-1",
    "l_45xKXM": "latvian-higher-league",
    "l_46aZMC": "egyptian-premier-league",
    "l_47077Y": "german-3liga",
    "l_49KZaB": "netherlands-eerste-divisie",
    "l_49Zmno": "danish-superliga",
    "l_4auCPk": "switzerland-challenge-league",
    "l_4d6Bwl": "switzerland-super-league",
    "l_4DWyTT": "english-football-league-championship",
    "l_4dzm4e": "bolivian-primera-division",
    "l_4FPF2L": "paraguayan-primera-division",
    "l_4H43wr": "netherlands-eredivisie",
    "l_4MPd7x": "australia-a-league",
    "l_4MU9Yh": "slovak-nike-liga",
    "l_4QexZg": "portuguese-primera-liga",
    "l_4V6jPs": "brazilian-campeonato-paulista-a1",
    "l_4WFCIZ": "english-premier-league",
}


def scopes(now):
    return {f"standings:{key}": PERIOD for key in LEAGUES}


def _number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else (
        int(value) if isinstance(value, float) and value.is_integer() else None)


def parse(payload, slug):
    """[(group name or None, [row dict])] of a widget response; SourceError if it is not one."""
    if not isinstance(payload, dict) or payload.get("sport") != "football" or payload.get("competition_slug") != slug \
            or not isinstance(payload.get("tables"), list):
        raise SourceError("UNEXPECTED_RESPONSE")
    tables = []
    for table in payload["tables"][:30]:
        rows = [
            {"name": row["team"].strip(), "position": _number(row.get("pos")), "played": _number(row.get("p")),
             "won": _number(row.get("w")), "drawn": _number(row.get("d")), "lost": _number(row.get("l")),
             "goals_for": _number(row.get("gf")), "goals_against": _number(row.get("ga")), "points": _number(row.get("pts"))}
            for row in (table.get("rows") or [])[:100]
            if isinstance(row, dict) and isinstance(row.get("team"), str) and row["team"].strip()
        ]
        if rows:
            group = table.get("group").strip() if isinstance(table.get("group"), str) else ""
            tables.append((group or None, rows))
    return tables


def _edition_teams(conn, edition):
    names = {}
    for team, *spellings in conn.execute(
        """SELECT t.id, t.name, t.short_name, n.name FROM core.team_seasons ts JOIN core.teams t ON t.id = ts.team_id
           LEFT JOIN core.entity_names n ON n.entity_type = 'team' AND n.entity_id = t.id
           WHERE ts.competition_season_id = %s""",
        (edition,),
    ).fetchall():
        names.setdefault(team, set()).update(normalize(s) for s in spellings if s)
    return names


def link(conn, edition, tables):
    """{row name: team id} when every row designates one team, else None (and the count)."""
    teams = _edition_teams(conn, edition)
    wanted = {row["name"] for _, rows in tables for row in rows}
    found = {}
    for name in wanted:
        hits = [team for team, keys in teams.items() if normalize(name) in keys]
        if len(hits) == 1:
            found[name] = hits[0]
    left_rows = wanted - set(found)
    left_teams = set(teams) - set(found.values())
    if len(left_rows) == 1 and len(left_teams) == 1:
        found[left_rows.pop()] = left_teams.pop()
    if len(set(found.values())) != len(found):
        return None, len(wanted)
    missing = len(wanted) - len(found)
    return (found if not missing else None), missing


def run(conn, get, scope, now):
    key = scope.split(":", 1)[1]
    slug = LEAGUES[key]
    edition = conn.execute(
        """SELECT cs.id FROM core.provider_ids p JOIN core.competition_seasons cs ON cs.competition_id = p.entity_id
           WHERE p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.provider_key = %s AND p.is_current AND cs.is_current""",
        (key,),
    ).fetchone()
    if edition is None:  # not collected by v2 (yet): no call
        return 0, 0
    edition = edition[0]
    tables = parse(get(URL + "?" + urlencode({"sport": "football", "slug": slug})), slug)
    teams, unmatched = link(conn, edition, tables) if tables else (None, 0)
    fresh = sorted(
        (group if len(tables) > 1 else None, teams[row["name"]], row["position"], row["played"], row["won"], row["drawn"],
         row["lost"], row["goals_for"], row["goals_against"], row["points"])
        for group, rows in tables for row in rows
    ) if teams else []
    columns = "group_name, team_id, position, played, won, drawn, lost, goals_for, goals_against, points"
    stored = sorted(conn.execute(
        f"SELECT {columns} FROM core.standings_official WHERE competition_season_id = %s AND source = 'sportscore'", (edition,)
    ).fetchall(), key=lambda r: tuple((x is None, x) for x in r))
    fresh = sorted(set(fresh), key=lambda r: tuple((x is None, x) for x in r))
    if fresh == [tuple(r) for r in stored]:
        # Same table: only the observation time moves; no new publication.
        conn.execute("UPDATE core.standings_official SET as_of = %s WHERE competition_season_id = %s AND source = 'sportscore'", (now, edition))
        return 0, unmatched
    conn.execute("DELETE FROM core.standings_official WHERE competition_season_id = %s AND source = 'sportscore'", (edition,))
    for row in fresh:
        conn.execute(
            f"""INSERT INTO core.standings_official(competition_season_id, stage, {columns}, source, as_of)
                VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'sportscore', %s) ON CONFLICT DO NOTHING""",
            (edition, *row, now),
        )
    for group, rows in tables if teams else []:
        for row in rows:
            conn.execute(
                """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
                   VALUES ('team', %s, %s, %s, 'source_spelling', 'sportscore') ON CONFLICT DO NOTHING""",
                (teams[row["name"]], row["name"], normalize(row["name"]) or row["name"].lower()),
            )
    conn.execute(
        """INSERT INTO ops.resource_versions(resource_kind, resource_id) VALUES ('competition_season', %s)
           ON CONFLICT (resource_kind, resource_id) DO UPDATE SET version = ops.resource_versions.version + 1, updated_at = now()""",
        (edition,),
    )
    return len(fresh), unmatched
