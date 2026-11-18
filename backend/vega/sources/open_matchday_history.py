"""Evidence and retention checks for completed Open Matchday results."""
from datetime import date
from hashlib import sha256
import json
from pathlib import Path

from . import SourceError

EVIDENCE_SHA256 = "2b92073f69f52809b618e2b94c86ca6f50f0e9721f12fe056b6e00cedc1c1377"
raw = (Path(__file__).parent / "data" / "open_matchday_history.json").read_bytes()
if sha256(raw).hexdigest() != EVIDENCE_SHA256:
    raise ValueError("Open Matchday historical results evidence changed")
RESULTS = {row["provider_key"]: row for row in json.loads(raw)["results"]}


def for_edition(folder, season):
    prefix = f"{folder}:{season}:"
    return {key: row for key, row in RESULTS.items() if key.startswith(prefix)}


def final_score(key, incoming, score):
    if incoming != tuple(score):
        raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: a reported score contradicts the attested final")



def rolling_prefix(before, incoming, declared_results):
    """At a proved moving left boundary, the older results remain in the edition."""
    # This is a local minimum of corroborating observations, not the provider's
    # retention rule. It applies only to the three 2026/27 folders attested here.
    played = {key: row for key, row in incoming.items() if row["status"] == "finished"}
    if not played or len(played) != declared_results:
        return set()
    try:
        days = {date.fromisoformat(row["date"]) for row in played.values()}
    except ValueError:
        return set()
    if min(days) < date(2026, 7, 1) or max(days) >= date(2027, 7, 1):
        return set()
    start = min(days).isoformat()
    gone, overlapping_dates = set(), []
    for key, former in before.items():
        if former["status"] != "finished":
            continue
        if former["match_date"] is None:
            return set()
        if key not in incoming and former["match_date"] < start:
            gone.add(key)
            continue
        if former["match_date"] < start:
            continue
        actual = played.get(key)
        if actual is None or (actual["date"], actual["home"], actual["away"], actual["home_score"], actual["away_score"]) != (
                former["match_date"], former["home_team_name"], former["away_team_name"], former["home_score"], former["away_score"]):
            return set()
        overlapping_dates.append(former["match_date"])
    if len(overlapping_dates) >= max(50, (declared_results + 1) // 2) and len(set(overlapping_dates)) >= 4:
        return gone
    return set()


def retained(conn, edition, before, incoming, attested, declared_results):
    """Keep only exact, already-stored sporting observations. The manifest never creates one."""
    if not attested:
        return set()
    prefix = rolling_prefix(before, incoming, declared_results)
    anchor_keys = sorted(set(attested) | prefix)
    linked = dict((key, (current, match, scope)) for key, current, match, scope in conn.execute("""
        SELECT p.provider_key,p.is_current,m.id,m.competition_season_id
          FROM core.provider_ids p LEFT JOIN core.matches m ON m.id=p.entity_id
         WHERE p.entity_type='match' AND p.provider='open_matchday' AND p.provider_key=ANY(%s)
         FOR SHARE OF p
    """, (anchor_keys,)))
    names = {row[side] for row in incoming.values() for side in ("home", "away")}
    for key in anchor_keys:
        names.update(key.split(":", 2)[2].split("|")[1:])
    teams = dict(conn.execute("""
        SELECT provider_key,entity_id FROM core.provider_ids
         WHERE entity_type='team' AND provider='open_matchday' AND provider_key=ANY(%s)
         FOR SHARE
    """, (["name:" + name for name in sorted(names)],)))
    preserved = set()
    pairs = {}
    for key in anchor_keys:
        proof = attested.get(key)
        item = incoming.get(key)
        if item is not None and proof:
            if item["status"] != "finished":
                raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: an attested final is listed as unplayed")
            final_score(key, (item["home_score"], item["away_score"]), proof["score"])
        if key not in linked:
            if key in prefix or (edition is not None and item is not None):
                raise SourceError("ATTESTED_HISTORY_RESTORE_REQUIRED", f"{key}: published physical identity missing")
            continue
        current, ident, scope = linked[key]
        old = before.get(key)
        if not current or old is None or scope != edition or ident != old["id"]:
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: existing provider link is inconsistent")
        day, home, away = key.split(":", 2)[2].split("|")
        clubs = (teams.get("name:" + home), teams.get("name:" + away))
        score = proof["score"] if proof else (old["home_score"], old["away_score"])
        live = conn.execute("""
            SELECT status::text,source::text,season_id,competition_season_id,match_date::text,home_team_id,away_team_id,
                   home_team_name,away_team_name,home_score,away_score,archive_position
              FROM core.matches WHERE id=%s FOR SHARE
        """, (ident,)).fetchone()
        if (None in clubs or clubs[0] == clubs[1] or live is None or
                live != ("finished", "open_matchday", 2026, edition, day, *clubs, home, away, *score, old["archive_position"])):
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: stored edition, sides, score or position disagree")
        if key in prefix or item is not None:
            preserved.add(key)
        pair = (day, frozenset(clubs))
        if pair in pairs:
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: two attested keys identify the same match")
        pairs[pair] = key
    for key, item in incoming.items():
        if key not in preserved and (item["date"], frozenset(teams.get("name:" + item[s]) for s in ("home", "away"))) in pairs:
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: another key names a retained match")
    positions = [before[key]["archive_position"] for key in preserved]
    if len(set(positions)) != len(positions):
        raise SourceError("ATTESTED_HISTORY_CONFLICT", "retained match positions disagree")
    return preserved
