"""Cup editions of OpenFootball, OpenLigaDB and International Results, read by main's own
source projections (scripts/source-projections, through v2/sources/bridge.mjs) for the
editions main refreshes (scripts/aws_refresh_sources.mjs), written as typed matches.

A source answer that is not 200 keeps the last edition written (main: "une source
temporairement indisponible ne remplace pas son dernier instantané valide").
"""

from datetime import timedelta
import hashlib
import json
from urllib.parse import urlencode

from . import SourceError
from ..seasons import sporting_season
from ..store import Store

WORLD_CUP_YEARS = ("1930", "1934", "1938", "1950", "1954", "1958", "1962", "1966", "1970", "1974", "1978", "1982",
                   "1986", "1990", "1994", "1998", "2002", "2006", "2010", "2014", "2018", "2022", "2026")
# frontend/src/services/cup-archives.js (NATIONAL_CUP_ARCHIVES keys and seasons).
NATIONAL_CUP_ARCHIVES = ("austria-cup-archive", "germany-cup-archive", "fa-cup-archive", "efl-cup-archive", "copa-del-rey-archive",
                         "coppa-italia-archive", "knvb-beker-archive", "portugal-cup-archive", "swiss-cup-archive")
# The editions main refreshes (aws_refresh_sources.mjs); drift-tested.
EDITIONS = (
    *[("open-cups", "euro", s) for s in ("2020", "2024", "2028")],
    *[("open-cups", "world-cup-history", s) for s in WORLD_CUP_YEARS],
    ("open-cups", "club-world-cup", "2025"),
    ("open-cups", "france-cup", "2024/2025"),
    ("nations-results", "nations-league", "2026/2027"),
    *[("open-cups", key, "2024/2025") for key in NATIONAL_CUP_ARCHIVES],
    ("openligadb", "nations-league", "2026/2027"),
    ("openligadb", "germany-cup", "2025/2026"),
    ("openligadb", "germany-cup", "2026/2027"),
)
PROVIDER = {"open-cups": "openfootball", "openligadb": "openligadb", "nations-results": "international_results"}
# The tournament each summer cup is, for its Vega season (seasons.py: played in June/July,
# it belongs to the season that ends then).
TOURNAMENTS = {"euro": "Euro", "world-cup-history": "World Cup", "club-world-cup": "Club World Cup"}


def scopes(now):
    """Running editions every two hours, finished ones weekly."""
    out = {}
    for kind, competition, season in EDITIONS:
        recent = int(season[:4]) >= now.year - 1
        out[f"{kind}:{competition}:{season}"] = timedelta(hours=2) if recent else timedelta(days=7)
    return out


def bridge(command, *args):
    from . import wikidata

    return wikidata.bridge(command, *args)


def _pair(value):
    return value if isinstance(value, list) and len(value) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value) else None


def match_rows(kind, competition, season, body):
    """(provider key, row) per source match, in source order."""
    out = []
    for position, m in enumerate(body.get("matches") or []):
        if kind == "open-cups":
            score = m.get("score") if isinstance(m.get("score"), dict) else {}
            ft, ht, et, p = (_pair(score.get(k)) for k in ("ft", "ht", "et", "p"))
            final = et or ft
            key = f"{competition}:{season}:{m.get('date') or ''}|{m.get('team1') or ''}|{m.get('team2') or ''}|{m.get('num') or ''}"
            row = {
                "home": m.get("team1"), "away": m.get("team2"), "home_key": f"name:{m.get('team1')}", "away_key": f"name:{m.get('team2')}",
                "date": m.get("date") or None, "round": m.get("round") or None, "group": m.get("group"), "number": m.get("num"),
                "status": "finished" if final else "not_started",
                "home_score": final and final[0], "away_score": final and final[1],
                "home_score_90": ft[0] if ft and et else None, "away_score_90": ft[1] if ft and et else None,
                "home_score_ht": ht and ht[0], "away_score_ht": ht and ht[1],
                "home_score_et": et and et[0], "away_score_et": et and et[1],
                "home_penalty_score": p and p[0], "away_penalty_score": p and p[1],
            }
        else:
            score, penalties = _pair(m.get("score")), _pair(m.get("penalties"))
            extra = "après prolongation" in (m.get("notes") or [])
            row = {
                "home": m.get("home"), "away": m.get("away"), "home_key": str(m.get("homeId")), "away_key": str(m.get("awayId")),
                "date": m.get("date") or None, "round": m.get("round") or None,
                "group": (f"{m['league']}{m['group']}" if kind == "nations-results" else str(m["group"])) if m.get("group") is not None else None,
                "number": None, "status": "finished" if m.get("status") == "finished" else "not_started",
                "home_score": score and score[0], "away_score": score and score[1], "home_score_90": None, "away_score_90": None,
                "home_score_ht": None, "away_score_ht": None,
                "home_score_et": score[0] if score and extra else None, "away_score_et": score[1] if score and extra else None,
                "home_penalty_score": penalties and penalties[0], "away_penalty_score": penalties and penalties[1],
            }
            key = str(m["key"]).split(":", 1)[1]
        out.append((key, dict(row, position=position)))
    return out


def _team(conn, provider, key, name):
    row = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider=%s AND provider_key=%s", (provider, key)).fetchone()
    if row:
        if name:
            conn.execute("UPDATE core.teams SET name=%s WHERE id=%s AND name<>%s", (name, row[0], name))
        return row[0]
    team = conn.execute("INSERT INTO core.teams(name) VALUES (%s) RETURNING id", (name or key,)).fetchone()[0]
    conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team',%s,%s,%s)", (provider, key, team))
    return team


def save(conn, kind, competition, season, body, now):
    provider = PROVIDER[kind]
    name = body.get("name") or competition
    label = sporting_season(season, league_name=TOURNAMENTS.get(competition))
    if label is None:
        raise SourceError("INVALID_SEASON")
    season_id = Store(conn).season(label)
    family = f"cup:{kind}:{competition}"
    row = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='competition' AND provider='vega' AND provider_key=%s", (family,)).fetchone()
    comp = row[0] if row else conn.execute("INSERT INTO core.competitions(name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]
    if not row:
        conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','vega',%s,%s)", (family, comp))
    digest = hashlib.sha256(json.dumps([body.get("name"), body.get("matches")], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    source = body.get("source") or {}
    edition, changed = conn.execute(
        """INSERT INTO core.competition_seasons(competition_id, season_id, native_label, cup_key, cup_name, cup_source_url, cup_data_url,
             cup_digest, cup_checked_at, cup_updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (cup_key) DO UPDATE SET cup_name=EXCLUDED.cup_name, cup_source_url=EXCLUDED.cup_source_url,
             cup_data_url=EXCLUDED.cup_data_url, cup_checked_at=EXCLUDED.cup_checked_at,
             cup_updated_at=CASE WHEN core.competition_seasons.cup_digest IS DISTINCT FROM EXCLUDED.cup_digest
                                 THEN EXCLUDED.cup_updated_at ELSE core.competition_seasons.cup_updated_at END,
             cup_digest=EXCLUDED.cup_digest, updated_at=now()
           RETURNING id, cup_updated_at = %s""",
        (comp, season_id, season, f"{kind}:{competition}:{season}", body.get("name"), source.get("url"), source.get("dataUrl"),
         digest, now, now, now),
    ).fetchone()
    if not changed:
        return 0
    rows = match_rows(kind, competition, season, body)
    keep = []
    for key, m in rows:
        found = conn.execute("SELECT entity_id FROM core.provider_ids WHERE entity_type='match' AND provider=%s AND provider_key=%s", (provider, key)).fetchone()
        home = _team(conn, provider, m["home_key"], m["home"]) if m["home"] else None
        away = _team(conn, provider, m["away_key"], m["away"]) if m["away"] else None
        round_id = conn.execute(
            """INSERT INTO core.rounds(competition_season_id, name) VALUES (%s,%s)
               ON CONFLICT (competition_season_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id""",
            (edition, m["round"]),
        ).fetchone()[0] if m["round"] else None
        values = {k: m[k] for k in ("status", "home_score", "away_score", "home_score_90", "away_score_90", "home_score_ht",
                                     "away_score_ht", "home_score_et", "away_score_et", "home_penalty_score", "away_penalty_score")}
        values.update(competition_season_id=edition, season_id=season_id, match_date=m["date"], home_team_id=home, away_team_id=away,
                      round_id=round_id, group_name=m["group"], match_number=m["number"], archive_position=m["position"], source=provider)
        columns = list(values)
        if found:
            conn.execute(f"UPDATE core.matches SET {', '.join(f'{c}=%s' for c in columns)}, revision=revision+1, updated_at=now() WHERE id=%s",
                         [values[c] for c in columns] + [found[0]])
            mid = found[0]
        else:
            mid = conn.execute(f"INSERT INTO core.matches({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))}) RETURNING id",
                               [values[c] for c in columns]).fetchone()[0]
            conn.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('match',%s,%s,%s)", (provider, key, mid))
        keep.append(mid)
    conn.execute("DELETE FROM core.matches WHERE competition_season_id=%s AND NOT id = ANY(%s)", (edition, keep))
    conn.execute("DELETE FROM core.provider_ids p WHERE p.entity_type='match' AND p.provider=%s AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id=p.entity_id)", (provider,))
    return len(rows)


def run(conn, get, scope, now):
    kind, competition, season = scope.split(":", 2)
    if (kind, competition, season) not in EDITIONS:
        raise ValueError(scope)
    query = {"competition": competition, "season": season} if kind != "nations-results" else {"season": season}
    answer = bridge("projection", kind, urlencode(query)) or {}
    if answer.get("status") != 200 or not isinstance(answer.get("body"), dict):
        raise SourceError(f"HTTP_{answer.get('status') or 'ERROR'}")
    return save(conn, kind, competition, season, answer["body"], now), 0


class For:
    """The adapter of one cup source (ops.source_runs keys runs by provider)."""

    def __init__(self, kind):
        self.kind = kind

    def scopes(self, now):
        return {scope: period for scope, period in scopes(now).items() if scope.startswith(self.kind + ":")}

    def run(self, conn, get, scope, now):
        return run(conn, get, scope, now)
