"""Evidence and retention checks for completed Open Matchday results (FAILURE_MODES.md §41).

Two pinned files attest finals:
- open_matchday_history.json, the 35 results withdrawn on 18 November 2026, with the ids the restore tool
  (vega.open_matchday_restore) brings back: never created here;
- open_matchday_published.json, the results the source published, then dropped from its sliding window, rebuilt from
  its Git history (each with the commit that published it; the English ones and 8625's final with the organizer's
  proof): created once in their edition when the base does not hold them.

The source's results file is a sliding window. A result that leaves it by its left edge stays as stored
(`left_edge`); an attested result the base holds stays as stored wherever its day (`retained`).
"""
from datetime import date
from hashlib import sha256
import json
from pathlib import Path

from . import SourceError

FILES = {
    "open_matchday_history.json": "2b92073f69f52809b618e2b94c86ca6f50f0e9721f12fe056b6e00cedc1c1377",
    "open_matchday_published.json": "7c9639c1204504e2e27cc59313384e600546dc912b90504fce058f26555a3d3c",
}
EVIDENCE_SHA256 = FILES["open_matchday_history.json"]
# A result leaving the window whose two sides, in the same order, arrive under another key this close is a moved
# result (the source corrected its day), not a slide.
MOVED_WITHIN = 31


def _load():
    out = {}
    for name, digest in FILES.items():
        raw = (Path(__file__).parent / "data" / name).read_bytes()
        if sha256(raw).hexdigest() != digest:
            raise ValueError(f"Open Matchday attested results changed: {name}")
        for row in json.loads(raw)["results"]:
            if row["provider_key"] in out:
                raise ValueError(f"Open Matchday result attested twice: {row['provider_key']}")
            out[row["provider_key"]] = row
    return out


RESULTS = _load()


def for_edition(folder, season):
    prefix = f"{folder}:{season}:"
    return {key: row for key, row in RESULTS.items() if key.startswith(prefix)}


def organizer(proof):
    """Whether the attested final carries the organizer's proof (not the source's publication alone)."""
    return bool(proof.get("official_match_id"))


def final_score(key, incoming, proof, report=None):
    """The score a live result line is written with (§41): its own when it agrees with the attested final; the
    organizer's final when it does not, the contradiction added to `report`; a source attestation contradicted, or an
    organizer's one without `report`, refuses the version."""
    score = tuple(proof["score"])
    if tuple(incoming) == score:
        return tuple(incoming)
    if organizer(proof) and report is not None:
        report.append(("ATTESTED_FINAL_KEPT", f"{key}: the source reports {incoming[0]}–{incoming[1]}, "
                                              f"the organizer's final {score[0]}–{score[1]} is kept"))
        return score
    raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: a reported score contradicts the attested final")


def _day(key):
    return key.split(":", 2)[2].split("|")


def left_edge(before, incoming, declared_results, attested=()):
    """{stored key} of the results the version dropped by its left edge, which stay as stored (§41); empty when the
    version is not that complete window (the guard then decides). The version holds exactly its declared results, every
    stored result from its first day on (attested ones aside), and at least one of them; no result leaving has its two
    sides, in the same order, arriving under another key within MOVED_WITHIN days."""
    played = {key: row for key, row in incoming.items() if row["status"] == "finished"}
    if not played or len(played) != declared_results:
        return set()
    start = min(row["date"] for row in played.values())
    gone, shared = set(), False
    for key, former in before.items():
        if former["status"] != "finished" or key in attested:
            continue
        if former["match_date"] is None:
            return set()
        if key in incoming:
            shared = shared or key in played
        elif former["match_date"] >= start:
            return set()  # a result missing inside the window
        else:
            gone.add(key)
    if not shared:
        return set()
    arriving = {}
    for key, row in played.items():
        if key not in before:
            arriving.setdefault((row["home"], row["away"]), []).append(date.fromisoformat(row["date"]))
    for key in gone:
        former = before[key]
        day = date.fromisoformat(former["match_date"])
        if any(abs((other - day).days) <= MOVED_WITHIN
               for other in arriving.get((former["home_team_name"], former["away_team_name"]), ())):
            return set()
    return gone


def retained(conn, edition, before, incoming, attested, declared_results):
    """{stored key} kept as stored: the results that left by the version's left edge, and the attested results the
    base holds (exact, already-stored sporting observations, checked against the base). Never creates one."""
    prefix = left_edge(before, incoming, declared_results, attested)
    if not attested:
        return prefix
    anchor_keys = sorted(set(attested) | prefix)
    linked = dict((key, (current, match, scope)) for key, current, match, scope in conn.execute("""
        SELECT p.provider_key,p.is_current,m.id,m.competition_season_id
          FROM core.provider_ids p LEFT JOIN core.matches m ON m.id=p.entity_id
         WHERE p.entity_type='match' AND p.provider='open_matchday' AND p.provider_key=ANY(%s)
         FOR SHARE OF p
    """, (anchor_keys,)))
    names = {row[side] for row in incoming.values() for side in ("home", "away")}
    for key in anchor_keys:
        names.update(_day(key)[1:])
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
            final_score(key, (item["home_score"], item["away_score"]), proof)
        if key not in linked:
            if proof and proof.get("id_at_incident") and edition is not None and item is not None:
                raise SourceError("ATTESTED_HISTORY_RESTORE_REQUIRED", f"{key}: published physical identity missing")
            continue
        current, ident, scope = linked[key]
        old = before.get(key)
        if not current or old is None or scope != edition or ident != old["id"]:
            if proof and not proof.get("id_at_incident") and old is None and item is None:
                continue  # another match holds or held its key: not created (missing)
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: existing provider link is inconsistent")
        day, home, away = _day(key)
        clubs = (teams.get("name:" + home), teams.get("name:" + away))
        score = (old["home_score"], old["away_score"])
        if proof and list(score) != list(proof["score"]) and not organizer(proof):
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: the stored score contradicts the attested final")
        live = conn.execute("""
            SELECT status::text,source::text,season_id,competition_season_id,match_date::text,home_team_id,away_team_id,
                   home_team_name,away_team_name,home_score,away_score,archive_position
              FROM core.matches WHERE id=%s FOR SHARE
        """, (ident,)).fetchone()
        season = int(key.split(":")[1][:4])
        if (None in clubs or clubs[0] == clubs[1] or live is None or
                live != ("finished", "open_matchday", season, edition, day, *clubs, home, away, *score, old["archive_position"])):
            raise SourceError("ATTESTED_HISTORY_CONFLICT", f"{key}: stored edition, sides, score or position disagree")
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


def missing(conn, before, incoming, attested):
    """([key], [(code, detail)]): the attested results of the edition to create once (§41), after the version's rows are
    written, and those not created with why. Never one of the 35 (the restore tool's), one the version lists or the base
    holds, one whose key another match holds or held, one whose day and two teams (either way round) a match of any
    edition has, nor, without an organizer's proof, one dated on or after the version's first result (inside its
    window)."""
    candidates = sorted(k for k, proof in attested.items()
                        if k not in before and k not in incoming and not proof.get("id_at_incident"))
    if not candidates:
        return [], []
    days = [row["date"] for row in incoming.values() if row["status"] == "finished"]
    start = min(days) if days else None
    held = {key for (key,) in conn.execute(
        "SELECT provider_key FROM core.provider_ids WHERE entity_type='match' AND provider='open_matchday' AND provider_key=ANY(%s)",
        (candidates,))}
    names = sorted({name for key in candidates for name in _day(key)[1:]})
    teams = dict(conn.execute(
        "SELECT provider_key,entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='open_matchday' AND provider_key=ANY(%s)",
        (["name:" + name for name in names],)))
    create, report = [], []
    for key in candidates:
        day, home, away = _day(key)
        sides = (teams.get("name:" + home), teams.get("name:" + away))
        if key in held:
            why = "another match holds or held its key"
        elif not organizer(attested[key]) and start is not None and day >= start:
            why = "inside the version's window without the organizer's proof"
        elif None not in sides and conn.execute(
                """SELECT 1 FROM core.matches WHERE match_date=%s AND ((home_team_id=%s AND away_team_id=%s)
                   OR (home_team_id=%s AND away_team_id=%s)) LIMIT 1""", (day, *sides, *reversed(sides))).fetchone():
            why = "a match of its day already has its two teams"
        else:
            create.append(key)
            continue
        report.append(("ATTESTED_RESULT_NOT_CREATED", f"{key}: {why}; not created"))
    return create, report
