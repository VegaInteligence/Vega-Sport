"""One entity per real team, whatever the sources (v2 doc, « Match » and « Référentiel »).

A team first seen in a complementary cup source (OpenFootball, OpenLigaDB, International
Results) is the same team as a PitchAPI one when the rule below names exactly one:
- national teams: the PitchAPI national team of the same normalized name, or of a name
  Vega knows for it (core.entity_names);
- clubs: the PitchAPI club of the same normalized name, or of a reviewed spelling
  (curated.CLUB_ALIASES), in the same country when both countries are known.
The source's team is then merged into the PitchAPI one: its matches, provider ids and
names move, its spelling stays as a `source_spelling` name of that source (the cup reads
show it), and the source-only row is removed. A team no rule names stays as it is.

A cup-source match between two merged teams that PitchAPI also has (same two teams, within
a day) exists for the site once: PitchAPI-era reads leave cup editions out. The pair is
noted in ops.data_warnings (duplicate_match, and score_disagreement when the final
scores differ), the PitchAPI match id in the detail.

Archive teams (seasons up to 2020/2021, before PitchAPI) are not merged by this pass.
"""

from datetime import timedelta

import psycopg

from . import normalize

CUP_PROVIDERS = ("openfootball", "openligadb", "international_results")


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


def merge_team(conn, keep, drop, provider, spelling):
    """Move every fact of `drop` (a source-only team) onto `keep`, then remove it."""
    for table, column in conn.execute(
        """SELECT c.conrelid::regclass::text, a.attname FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
           WHERE c.contype = 'f' AND c.confrelid = 'core.teams'::regclass AND c.conparentid = 0
             AND c.conrelid::regclass::text LIKE 'core.%%' ORDER BY 1, 2"""
    ).fetchall():
        conn.execute(f"UPDATE {table} SET {column} = %s WHERE {column} = %s", (keep, drop))
    conn.execute("UPDATE core.provider_ids SET entity_id = %s WHERE entity_type = 'team' AND entity_id = %s", (keep, drop))
    conn.execute(
        """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
           SELECT 'team', %s, e.name, e.normalized, e.kind, e.source FROM core.entity_names e
           WHERE e.entity_type = 'team' AND e.entity_id = %s ON CONFLICT DO NOTHING""",
        (keep, drop),
    )
    conn.execute("DELETE FROM core.entity_names WHERE entity_type = 'team' AND entity_id = %s", (drop,))
    spelling_row(conn, keep, provider, spelling)
    conn.execute("DELETE FROM core.teams WHERE id = %s", (drop,))


def spelling_row(conn, team, provider, name):
    if name and name.strip():
        conn.execute(
            """INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source)
               VALUES ('team', %s, %s, %s, 'source_spelling', %s) ON CONFLICT DO NOTHING""",
            (team, name, name.lower(), provider),
        )


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
    pitch = _pitch_teams(conn)
    merged = unmatched = 0
    for team, name, provider, national, country in _candidates(conn):
        keep = match_team(pitch, name, bool(national), country)
        if keep is None:
            unmatched += 1
            continue
        try:
            with conn.transaction():
                merge_team(conn, keep, team, provider, name)
        except psycopg.errors.IntegrityError:
            # Something computed still names the source-only team: merged on a later run.
            unmatched += 1
            continue
        merged += 1
    duplicates(conn)
    return merged, unmatched
