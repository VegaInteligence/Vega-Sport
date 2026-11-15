"""Attach an immutable, dated Transfermarkt snapshot to confirmed player identities."""
from collections import Counter, defaultdict
from datetime import date, timedelta
import gzip
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from . import SourceError, normalize

VINTAGE = date(2026, 7, 6)
SOURCE = 'transfermarkt_snapshot'
PATH = Path(__file__).parent / 'data' / 'transfermarkt-player-facts-20260706.jsonl.gz'


def scopes(now):
    return {f'transfermarkt:{VINTAGE.isoformat()}': timedelta(days=1)}


def _date(value):
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise SourceError('INVALID_SNAPSHOT')


def load(path=PATH):
    rows = []
    ids = set()
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as stream:
            for line in stream:
                raw = json.loads(line)
                sid = str(raw['id'])
                if not sid.isdigit() or sid in ids:
                    raise SourceError('INVALID_SNAPSHOT')
                ids.add(sid)
                names = {normalize(n) for n in raw['names'] if isinstance(n, str)} - {''}
                url = raw.get('url') or f'https://www.transfermarkt.com/-/profil/spieler/{sid}'
                parsed = urlparse(url)
                if (parsed.scheme != 'https' or parsed.netloc != 'www.transfermarkt.com'
                        or parsed.query or parsed.fragment
                        or not re.fullmatch(r'/[^/]+/profil/spieler/' + re.escape(sid), parsed.path)):
                    raise SourceError('INVALID_SNAPSHOT')
                foot = raw.get('foot')
                if foot not in (None, 'left', 'right', 'both'):
                    raise SourceError('INVALID_SNAPSHOT')
                evidence = {(normalize(club), _date(day)) for club, day in raw.get('evidence', []) if club and day}
                rows.append({'id': sid, 'names': names, 'birth': _date(raw.get('birth')),
                             'foot': foot, 'club': raw.get('club'), 'expires': _date(raw.get('expires')),
                             'evidence': evidence, 'url': url})
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        raise SourceError('INVALID_SNAPSHOT')
    if not rows:
        raise SourceError('INVALID_SNAPSHOT')
    return rows


def pair(rows, players, played, existing):
    """Return source IDs mapped to players; every edge must be mutually unique.

    Existing associations are immutable, and names on both sides must be unique for
    the fallback. Evidence is an exact club/date match to two distinct line-ups.
    """
    by_name = defaultdict(set)
    for pid, name, short, birth in players:
        for name_key in {normalize(name), normalize(short)} - {''}:
            by_name[name_key].add(pid)
    by_source_name = defaultdict(set)
    for row in rows:
        for name in row['names']:
            by_source_name[name].add(row['id'])
    info = {pid: birth for pid, _, _, birth in players}
    owned = {pid: sid for sid, pid in existing.items()}
    candidates = {}
    for row in rows:
        sid, birth = row['id'], row['birth']
        possible = set().union(*(by_name.get(n, set()) for n in row['names']))
        exact = {pid for pid in possible if birth and info[pid] == birth}
        if exact:
            options = exact
        else:
            options = {pid for pid in possible if (birth is None or info[pid] is None)
                       and any(by_name[n] == {pid} and by_source_name[n] == {sid} for n in row['names'])
                       and len(row['evidence'] & played.get(pid, set())) >= 2}
        # A prior link is never moved, and an already linked player is never claimed again.
        options = {pid for pid in options if existing.get(sid, pid) == pid and owned.get(pid, sid) == sid}
        candidates[sid] = options
    claims = Counter(pid for options in candidates.values() for pid in options)
    return {sid: next(iter(options)) for sid, options in candidates.items()
            if len(options) == 1 and claims[next(iter(options))] == 1}


def run(conn, get, scope, now):
    if scope != f'transfermarkt:{VINTAGE.isoformat()}':
        raise SourceError('INVALID_SCOPE')
    rows = load()
    players = conn.execute('SELECT id, name, short_name, birth_date FROM core.players').fetchall()
    existing = dict(conn.execute('SELECT source_player_id, player_id FROM core.player_fact_observations WHERE source=%s', (SOURCE,)).fetchall())
    # Limit the potentially large match scan to players whose names occur in the snapshot
    # and whose birth dates do not already establish an exact identity.
    fallback_names = defaultdict(set)
    for row in rows:
        if len(row['evidence']) >= 2:
            for name in row['names']:
                fallback_names[name].add(row['birth'])
    possible = [pid for pid, name, short, birth in players
                if any(key in fallback_names and (birth is None or None in fallback_names[key])
                       for key in (normalize(name), normalize(short)))]
    played = defaultdict(set)
    if possible:
        dates = sorted({day for row in rows for _, day in row['evidence'] if day <= VINTAGE})
        matches = conn.execute('''SELECT lp.player_id, t.name, m.match_date FROM core.lineup_players lp
            JOIN core.matches m ON m.id=lp.match_id AND m.season_id=lp.season_id
            JOIN core.teams t ON t.id=lp.team_id
            LEFT JOIN core.player_match_stats ps ON ps.player_id=lp.player_id
              AND ps.match_id=lp.match_id AND ps.season_id=lp.season_id
            WHERE lp.player_id = ANY(%s) AND m.match_date = ANY(%s)
              AND (lp.is_starter IS TRUE OR ps.minutes_played > 0)''', (possible, dates)).fetchall()
        for pid, club, day in matches:
            played[pid].add((normalize(club), day))
    pairs = pair(rows, players, played, existing)
    conn.execute('''CREATE TEMP TABLE player_fact_snapshot_stage (
        source_player_id text, player_id integer, source_url text, birth_date date,
        preferred_foot core.foot, club_name text, contract_until date
    ) ON COMMIT DROP''')
    with conn.cursor() as cursor:
        with cursor.copy('COPY player_fact_snapshot_stage FROM STDIN') as copy:
            for row in rows:
                if row['id'] in pairs:
                    copy.write_row((row['id'], pairs[row['id']], row['url'], row['birth'], row['foot'], row['club'], row['expires']))
    changed = conn.execute('''INSERT INTO core.player_fact_observations
        (source, source_player_id, player_id, source_url, observed_on, birth_date, preferred_foot, club_name, contract_until)
        SELECT %s, source_player_id, player_id, source_url, %s, birth_date, preferred_foot, club_name, contract_until
        FROM player_fact_snapshot_stage
        ON CONFLICT (source, source_player_id) DO UPDATE SET
          source_url=EXCLUDED.source_url, observed_on=EXCLUDED.observed_on, birth_date=EXCLUDED.birth_date,
          preferred_foot=EXCLUDED.preferred_foot, club_name=EXCLUDED.club_name, contract_until=EXCLUDED.contract_until
        WHERE core.player_fact_observations.player_id=EXCLUDED.player_id AND
          (core.player_fact_observations.source_url, core.player_fact_observations.observed_on,
           core.player_fact_observations.birth_date, core.player_fact_observations.preferred_foot,
           core.player_fact_observations.club_name, core.player_fact_observations.contract_until)
          IS DISTINCT FROM (EXCLUDED.source_url, EXCLUDED.observed_on, EXCLUDED.birth_date,
                            EXCLUDED.preferred_foot, EXCLUDED.club_name, EXCLUDED.contract_until)''', (SOURCE, VINTAGE)).rowcount
    changed += conn.execute('''UPDATE core.players p SET
        birth_date = coalesce(p.birth_date, s.birth_date),
        birth_date_source_url = CASE WHEN p.birth_date IS NULL AND s.birth_date IS NOT NULL THEN s.source_url ELSE p.birth_date_source_url END,
        preferred_foot = coalesce(p.preferred_foot, s.preferred_foot),
        preferred_foot_source_url = CASE WHEN p.preferred_foot IS NULL AND s.preferred_foot IS NOT NULL THEN s.source_url ELSE p.preferred_foot_source_url END,
        updated_at=now()
        FROM player_fact_snapshot_stage s WHERE p.id=s.player_id AND
          ((p.birth_date IS NULL AND s.birth_date IS NOT NULL) OR
           (p.preferred_foot IS NULL AND s.preferred_foot IS NOT NULL))''').rowcount
    return changed, len(rows) - len(pairs)
