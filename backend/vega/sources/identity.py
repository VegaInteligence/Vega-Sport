"""One entity per real team, whatever the sources (design doc, « Match » and « Référentiel »).

A team first seen in a complementary cup source (OpenFootball, OpenLigaDB, International
Results, the open matchday feed) is the same team as a PitchAPI one when the rule below
names exactly one:
- national teams: the PitchAPI national team of the same normalized name, or of a name
  Vega knows for it (core.entity_names);
- clubs: the PitchAPI club of the same normalized name, or of a reviewed spelling
  (curated.CLUB_ALIASES), in the same country when both countries are known.

Archive teams (every archive season, the ones after 2020/2021 included) are keyed by their
country's French name and their own name. One is the PitchAPI club of that country
(core.countries.name_fr) that has the same name; when no club has it, the club that has the
same name once the club-form words at either end are set aside ("West Ham United FC" and
"West Ham United") — provided the archive's name carries every form word PitchAPI's does:
a word PitchAPI keeps tells two clubs apart ("Wimbledon", 1929-2003, and "Wimbledon FC"
are not "AFC Wimbledon"; "CA Bastia" is not "SC Bastia"). The few archive spellings that
only lack such a word are reviewed one by one (ARCHIVE_SPELLINGS). A European cup edition
names no country: its teams are matched the same way among every PitchAPI club. In every
case exactly one club must answer; two archive teams whose form words contradict ("Parma
AC", "Parma FC") are not both the same club, and a merge that would make a club play
itself (two teams of one match naming the same club) is refused.

The source's team is then merged into the PitchAPI one: its matches and their facts, its
provider ids and its names move, its spelling stays as a `source_spelling` name of that
source, and the source-only row is removed. A team's matches keep the names their source
gave (core.matches.home_team_name, away_team_name, 034): the archive and cup reads show
them. A club known to a source under several spellings holds one key per spelling, one of
them current (core.provider_ids.is_current). A team no rule names stays as it is.

Removing a team row makes PostgreSQL look for it in every table that names teams, most of
them without an index on the team: a fraction of a second per team on 10 November 2026,
more as the match facts grow. Merges run by sets (CHUNK), each in its own savepoint; a set
PostgreSQL refuses (something computed still names one of its teams, or another writer
holds its rows) is halved down to the refused pair, which waits for a later run.

A cup-source match between two merged teams that PitchAPI also has (same two teams, within
a day) exists for the site once: PitchAPI-era reads leave cup editions out. The pair is
noted in ops.data_warnings (duplicate_match, and score_disagreement when the final
scores differ), the PitchAPI match id in the detail.
"""

import re
import unicodedata

from datetime import timedelta

import psycopg

from . import normalize

CUP_PROVIDERS = ("openfootball", "openligadb", "international_results", "open_matchday")
# The country of an archive key whose edition is a European cup.
EUROPE = "europe"
CHUNK = 100


def scopes(now):
    return {"teams": timedelta(days=1)}


def _candidates(conn):
    """Source-only cup teams: (team, name, provider, national?, country of their editions)."""
    return conn.execute(
        """SELECT t.id, t.name, p.provider::text, bool_or(c.kind = 'international' OR cs.cup_key LIKE 'nations-results:%%'
                 OR cs.cup_key LIKE 'open-cups:euro:%%' OR cs.cup_key LIKE 'open-cups:world-cup-history:%%'
                 OR cs.cup_key LIKE 'openligadb:nations-league:%%') AS national,
             min(c.country_code) AS country
           FROM core.teams t
           JOIN core.provider_ids p ON p.entity_type = 'team' AND p.entity_id = t.id AND p.provider = ANY(%s::core.provider[])
           JOIN core.matches m ON t.id IN (m.home_team_id, m.away_team_id)
           JOIN core.competition_seasons cs ON cs.id = m.competition_season_id AND cs.cup_key IS NOT NULL
           JOIN core.competitions c ON c.id = cs.competition_id
           WHERE NOT EXISTS (SELECT 1 FROM core.provider_ids x WHERE x.entity_type = 'team' AND x.entity_id = t.id AND x.provider = 'pitchapi')
           GROUP BY t.id, t.name, p.provider ORDER BY t.id""",
        (list(CUP_PROVIDERS),),
    ).fetchall()


def _pitch_teams(conn):
    """PitchAPI teams by normalized name (official and known names), national or not."""
    out = {}
    for team, name, national, country in conn.execute(
        """SELECT t.id, n.name, coalesce(t.is_national, false), t.country_code FROM core.teams t
           JOIN core.provider_ids p ON p.entity_type = 'team' AND p.entity_id = t.id AND p.provider = 'pitchapi'
           CROSS JOIN LATERAL (SELECT t.name UNION SELECT e.name FROM core.entity_names e
             WHERE e.entity_type = 'team' AND e.entity_id = t.id AND e.kind <> 'source_spelling') n(name)"""
    ):
        out.setdefault((normalize(name), national), set()).add((team, country))
    return out


def match_team(pitch, name, national, country):
    from .curated import CLUB_ALIASES

    names = {normalize(name)}
    if not national and name in CLUB_ALIASES:
        names.add(normalize(CLUB_ALIASES[name]))
    found = set()
    for n in names:
        for team, team_country in pitch.get((n, national), ()):
            if national or not country or not team_country or team_country == country:
                found.add(team)
    return found.pop() if len(found) == 1 else None


def spelling_row(conn, team, provider, name):
    if name and name.strip():
        conn.execute(
            """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
               VALUES ('team', %s, %s, lower(%s), 'source_spelling', %s) ON CONFLICT DO NOTHING""",
            (team, name, name, provider),
        )


# Club-form words set aside at either end of a club's name, never inside it.
CLUB_FORMS = {"fc", "afc", "cf", "sc", "ac", "ssc", "cd", "ud", "sv", "fk", "sk", "bk", "if", "as", "us", "rc", "ca", "cfc", "club",
              "calcio", "football", "futbol", "fussball", "1"}


def club_parts(name):
    """A club's name without the club-form words at either end, and those words.

    The ordinal of "1. FC Köln" says nothing of the club's form, and "FK" is how some
    sources write "FC": neither can contradict.
    """
    folded = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    words = [w for w in re.split(r"[^a-z0-9]+", folded) if w]
    forms = set()
    while words and words[0] in CLUB_FORMS:
        forms.add(words.pop(0))
    while words and words[-1] in CLUB_FORMS:
        forms.add(words.pop())
    forms.discard("1")
    return "".join(words), frozenset("fc" if form == "fk" else form for form in forms)


def club_core(name):
    return club_parts(name)[0]


# Archive spellings that only lack the form word of PitchAPI's name, reviewed one by one on
# the 10 November 2026 list. Unreviewed, the word decides: "Beveren" (1995-2006), "AD Ceuta"
# (2000-2010) and "Erzurumspor" (1999-2000) are older clubs than "SK Beveren", "AD Ceuta FC"
# and "Erzurumspor FK".
ARCHIVE_SPELLINGS = {"Porto": "FC Porto", "Dundee": "Dundee FC", "Panserraikos": "Panserraikos FC",
                     "Crvena Zvezda": "FK Crvena Zvezda", "Houston Dynamo": "Houston Dynamo FC"}


def _archive_candidates(conn):
    """Archive-only teams: (team, name, normalized country of their key)."""
    rows = conn.execute(
        """SELECT t.id, t.name, p.provider_key FROM core.teams t
           JOIN core.provider_ids p ON p.entity_type = 'team' AND p.entity_id = t.id AND p.provider = 'vega' AND p.provider_key LIKE 'archive:%%'
           WHERE NOT EXISTS (SELECT 1 FROM core.provider_ids x WHERE x.entity_type = 'team' AND x.entity_id = t.id AND x.provider = 'pitchapi')
           ORDER BY t.id, p.provider_key"""
    ).fetchall()
    # The key keeps the spaces of the country's name ("pays bas"); the clubs are indexed without.
    return [(team, name, normalize(key.split(":")[1])) for team, name, key in rows if key.count(":") == 2]


def _pitch_clubs(conn):
    """PitchAPI clubs by normalized name, and by core name with the club forms of each of
    their names: under their country's normalized French name, and under None (every club)."""
    exact, core = {}, {}
    for team, name, country in conn.execute(
        """SELECT t.id, n.name, c.name_fr FROM core.teams t
           JOIN core.provider_ids p ON p.entity_type = 'team' AND p.entity_id = t.id AND p.provider = 'pitchapi'
           LEFT JOIN core.countries c ON c.code = t.country_code
           CROSS JOIN LATERAL (SELECT t.name UNION SELECT e.name FROM core.entity_names e
             WHERE e.entity_type = 'team' AND e.entity_id = t.id AND e.kind <> 'source_spelling') n(name)
           WHERE t.is_national IS NOT TRUE"""
    ):
        key, forms = club_parts(name)
        for where in {normalize(country) or None, None}:
            exact.setdefault((where, normalize(name)), set()).add(team)
            core.setdefault((where, key), {}).setdefault(team, set()).add(forms)
    return exact, core


def _archive_match(clubs, name, country):
    """(club, found by its exact name?) for an archive team, or (None, False)."""
    if not country:
        return None, False
    exact, core = clubs
    where = None if country == EUROPE else country
    found = exact.get((where, normalize(name)), ()) or exact.get((where, normalize(ARCHIVE_SPELLINGS.get(name, name))), ())
    if found:
        return (next(iter(found)), True) if len(found) == 1 else (None, False)
    key, forms = club_parts(name)
    found = core.get((where, key), {}) if key else {}
    if len(found) != 1:
        return None, False
    ((team, known),) = found.items()
    return (team, False) if all(other <= forms for other in known) else (None, False)


def match_archive_team(clubs, name, country):
    return _archive_match(clubs, name, country)[0]


def pairs(conn):
    """Every merge the rules name, as (source-only team, PitchAPI team, provider, spelling),
    and the number of source-only teams looked at."""
    pitch = _pitch_teams(conn)
    found, seen = {}, set()
    for team, name, provider, national, country in _candidates(conn):
        seen.add(team)
        keep = match_team(pitch, name, bool(national), country)
        if keep is not None:
            found.setdefault(team, (keep, provider, name))
    clubs = _pitch_clubs(conn)
    by_club = {}
    for team, name, country in _archive_candidates(conn):
        seen.add(team)
        if team in found:
            continue
        keep, exact = _archive_match(clubs, name, country)
        if keep is not None:
            found[team] = (keep, "vega", name)
            by_club.setdefault(keep, []).append((team, club_parts(name)[1], exact))
    # A club PitchAPI names without a form ("Parma") cannot be both "Parma AC" and "Parma FC";
    # "Sassuolo Calcio" and "US Sassuolo Calcio" say nothing against each other.
    for teams in by_club.values():
        known = {forms for _, forms, _ in teams}
        if any(not (a <= b or b <= a) for a in known for b in known):
            for team, forms, exact in teams:
                if forms and not exact:
                    del found[team]
    drops = list(found)
    refused = set()
    if drops:
        for home, away in conn.execute(
            """WITH m AS (SELECT * FROM unnest(%s::int[], %s::int[]) m(team, club)),
                 x AS (SELECT team, club FROM m UNION SELECT club, club FROM m)
               SELECT DISTINCT a.team, b.team FROM core.matches mm
               JOIN x a ON a.team = mm.home_team_id JOIN x b ON b.team = mm.away_team_id WHERE a.club = b.club""",
            (drops, [found[team][0] for team in drops]),
        ):
            refused.update((home, away))
    return [(team, *found[team]) for team in drops if team not in refused], len(seen)


def team_columns(conn, teams):
    """The core columns naming a team in which one of these teams has rows."""
    columns = conn.execute(
        """SELECT c.conrelid::regclass::text, a.attname FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
           WHERE c.contype = 'f' AND c.confrelid = 'core.teams'::regclass AND c.conparentid = 0
             AND c.conrelid::regclass::text LIKE 'core.%%' ORDER BY 1, 2"""
    ).fetchall()
    return [
        (table, column)
        for table, column in columns
        if conn.execute(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE {column} = ANY(%s))", (teams,)).fetchone()[0]
    ]


def merge_teams(conn, found, columns):
    """Move every fact of each source-only team onto its PitchAPI team, then remove it."""
    drops, keeps = [row[0] for row in found], [row[1] for row in found]
    for table, column in columns:
        conn.execute(
            f"""UPDATE {table} x SET {column} = m.kept FROM unnest(%s::int[], %s::int[]) m(gone, kept)
                WHERE x.{column} = m.gone""",
            (drops, keeps),
        )
    # One current key per provider and team: a moved key stays current only where the
    # PitchAPI team has none of that provider yet.
    conn.execute(
        """WITH moved AS (
             SELECT p.provider, p.provider_key, m.kept,
               row_number() OVER (PARTITION BY m.kept, p.provider ORDER BY p.is_current DESC, p.provider_key) AS n
             FROM core.provider_ids p JOIN unnest(%s::int[], %s::int[]) m(gone, kept) ON p.entity_id = m.gone
             WHERE p.entity_type = 'team'
           )
           UPDATE core.provider_ids p SET entity_id = moved.kept,
             is_current = moved.n = 1 AND NOT EXISTS (SELECT 1 FROM core.provider_ids k WHERE k.entity_type = 'team'
               AND k.entity_id = moved.kept AND k.provider = moved.provider AND k.is_current)
           FROM moved WHERE p.entity_type = 'team' AND p.provider = moved.provider AND p.provider_key = moved.provider_key""",
        (drops, keeps),
    )
    conn.execute(
        """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
           SELECT 'team', m.kept, e.name, e.normalized, e.kind, e.source
           FROM unnest(%s::int[], %s::int[]) m(gone, kept)
           JOIN core.entity_names e ON e.entity_type = 'team' AND e.entity_id = m.gone
           ON CONFLICT DO NOTHING""",
        (drops, keeps),
    )
    conn.execute("DELETE FROM core.entity_names WHERE entity_type = 'team' AND entity_id = ANY(%s)", (drops,))
    conn.execute(
        """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
           SELECT 'team', m.kept, m.name, lower(m.name), 'source_spelling', m.provider::core.provider
           FROM unnest(%s::int[], %s::text[], %s::text[]) m(kept, name, provider) WHERE btrim(m.name) <> ''
           ON CONFLICT DO NOTHING""",
        (keeps, [row[3] or "" for row in found], [row[2] for row in found]),
    )
    conn.execute("DELETE FROM core.teams WHERE id = ANY(%s)", (drops,))


def _merge(conn, found, columns):
    try:
        with conn.transaction():
            merge_teams(conn, found, columns)
        return len(found)
    except (psycopg.errors.IntegrityError, psycopg.errors.DeadlockDetected):
        if len(found) == 1:
            return 0
        half = len(found) // 2
        return _merge(conn, found[:half], columns) + _merge(conn, found[half:], columns)


def duplicates(conn):
    """Cup-source matches PitchAPI also has, noted once in ops.data_warnings."""
    rows = conn.execute(
        """SELECT c.id, p.id, (SELECT k.provider_key FROM core.provider_ids k WHERE k.entity_type = 'match' AND k.entity_id = p.id
             AND k.provider = 'pitchapi' AND k.is_current), c.home_score, c.away_score,
             CASE WHEN p.home_team_id = c.home_team_id THEN p.home_score ELSE p.away_score END,
             CASE WHEN p.home_team_id = c.home_team_id THEN p.away_score ELSE p.home_score END
           FROM core.matches c
           JOIN core.competition_seasons cc ON cc.id = c.competition_season_id AND cc.cup_key IS NOT NULL
           JOIN core.matches p ON p.source = 'pitchapi'
             AND ((p.home_team_id = c.home_team_id AND p.away_team_id = c.away_team_id)
               OR (p.home_team_id = c.away_team_id AND p.away_team_id = c.home_team_id))
             AND p.match_date BETWEEN c.match_date - 1 AND c.match_date + 1
           WHERE c.source = ANY(%s::core.provider[])""",
        (list(CUP_PROVIDERS),),
    ).fetchall()
    for cup, _, public, ch, ca, ph, pa in rows:
        conn.execute(
            """INSERT INTO ops.data_warnings(match_id, kind, detail) VALUES (%s, 'duplicate_match', %s)
               ON CONFLICT (match_id, kind) DO UPDATE SET detail = EXCLUDED.detail""",
            (cup, public),
        )
        if None not in (ch, ca, ph, pa) and (ch, ca) != (ph, pa):
            conn.execute(
                """INSERT INTO ops.data_warnings(match_id, kind, detail) VALUES (%s, 'score_disagreement', %s)
                   ON CONFLICT (match_id, kind) DO UPDATE SET detail = EXCLUDED.detail""",
                (cup, f"{public} {ph}-{pa} / {ch}-{ca}"),
            )
    return len(rows)


def run(conn, get, scope, now):
    if scope != "teams":
        raise ValueError(scope)
    found, candidates = pairs(conn)
    columns = team_columns(conn, [row[0] for row in found]) if found else []
    merged = sum(_merge(conn, found[start:start + CHUNK], columns) for start in range(0, len(found), CHUNK))
    duplicates(conn)
    return merged, candidates - merged
