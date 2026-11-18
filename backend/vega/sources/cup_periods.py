"""Typed OpenLigaDB DFB-Pokal periods. Other sources keep their own conventions."""
from hashlib import sha256
import json
from pathlib import Path

from psycopg.types.json import Jsonb

from . import SourceError

LEDGER_BYTES = Path(__file__).with_name("dfb_pokal_periods.json").read_bytes()
DECISIONS = json.loads(LEDGER_BYTES)["decisions"]
LEDGER_SHA256 = sha256(LEDGER_BYTES).hexdigest()
DFB_SEASONS = {"2025/2026": (3, "Unknown", "Nachspielzeit"),
               "2026/2027": (4, "AfterExtraTime", "Verlängerung")}
TYPES = {
    (1, "HalfTime", "Halbzeit"): "ht",
    (2, "After90Minutes", "Endergebnis"): "ft",
    (5, "AfterPenalties", "Elfmeterschießen"): "p",
}
COLUMNS = {"final": "score", "ft": "score_90", "ht": "score_ht", "et": "score_et", "p": "penalty_score"}


def applies(kind, competition, season):
    return kind == "openligadb" and competition == "germany-cup" and season in DFB_SEASONS


def typed_results(season, key, raw):
    if not isinstance(raw, list):
        raise SourceError("INVALID_PERIODS", f"{key}: missing matchResults")
    parts = {}
    for result in raw:
        if not isinstance(result, dict):
            raise SourceError("INVALID_PERIODS", f"{key}: invalid result row")
        kind = (result.get("resultTypeID"), result.get("resultTypeKind"), result.get("resultName"))
        home, away = result.get("pointsTeam1"), result.get("pointsTeam2")
        if type(kind[0]) is not int or not all(isinstance(s, str) for s in kind[1:]):
            raise SourceError("INVALID_PERIODS", f"{key}: malformed result type")
        label = "et" if kind == DFB_SEASONS[season] else TYPES.get(kind)
        if label is None or not all(type(p) is int and 0 <= p <= 32767 for p in (home, away)):
            raise SourceError("INVALID_PERIODS", f"{key}: unknown result type or invalid points {kind}")
        pair = [home, away]
        if label in parts and parts[label] != pair:
            raise SourceError("INVALID_PERIODS", f"{key}: contradictory {label} rows")
        parts[label] = pair
    return parts


def read(season, key, match):
    parts = typed_results(season, key, match.get("results"))
    decision = DECISIONS.get(key)
    if decision:
        if (season != decision["edition"] or match.get("date") != decision["date"]
                or [match.get("homeId"), match.get("awayId")] != decision["sides"]
                or match.get("status") != "finished"):
            raise SourceError("PERIODS_CONFLICT", f"{key}: attested edition, sides, date or status changed")
        official, observed = decision["official"], decision["observed"]
        for label in COLUMNS.keys() - {"final"}:
            if parts.get(label) not in (observed.get(label), official.get(label)):
                raise SourceError("PERIODS_CONFLICT", f"{key}: {label} differs from native and DFB pairs")
        # A converged 90-minute row (79584) can temporarily leave the old reader with
        # no ET row and an incorrect final. The scoped attestation proves the actual final.
        return dict(official, final=official["et"])
    if match.get("status") != "finished":
        return {}
    ft, ht, et, shootout = (parts.get(k) for k in ("ft", "ht", "et", "p"))
    final = et or ft
    if final is None:
        raise SourceError("PERIODS_UNREVIEWED", f"{key}: no playing result")
    if final != match.get("score") or ht and any(a > b for a, b in zip(ht, final)):
        raise SourceError("INVALID_PERIODS", f"{key}: playing result or half-time inconsistent")
    kicks = None
    if shootout:
        if not et or et[0] != et[1] or shootout[0] == shootout[1] or any(a < b for a, b in zip(shootout, et)):
            raise SourceError("PERIODS_UNREVIEWED", f"{key}: unproved cumulative shoot-out")
        kicks = [a - b for a, b in zip(shootout, et)]
    # For an unattested ET match, type 2 has no reliable interpretation as the 90-minute score.
    return {"final": final, "ht": ht, "et": et, "p": kicks}


def score_columns(parts):
    return {f"{side}_{column}": parts[label][index] if parts.get(label) is not None else None
            for label, column in COLUMNS.items() for index, side in enumerate(("home", "away"))}


def guard(conn, provider, before, rows):
    keys = {m[k] for _, m in rows for k in ("home_key", "away_key")}
    bindings = dict(conn.execute(
        "SELECT provider_key, entity_id FROM core.provider_ids WHERE entity_type='team' AND provider=%s AND provider_key=ANY(%s)",
        (provider, list(keys)),
    ).fetchall())
    for key, new in rows:
        old = before.get(key)
        if not old or old["status"] != "finished":
            continue
        # Preserve the exact route's side identity. An alias already merged by the identity
        # workflow can keep its published canonical id when it agrees with the provider binding.
        for side in ("home", "away"):
            previous = old[f"{side}_team_id"]
            bound = bindings.get(new[f"{side}_key"])
            if bound != previous:
                merged = None if bound is None else conn.execute(
                    "SELECT merged_into FROM core.teams WHERE id=%s", (bound,),
                ).fetchone()
                if not merged or merged[0] != previous:
                    raise SourceError("PERIODS_CONFLICT", f"{key}: {side} identity changed")
                new[f"{side}_existing_id"] = previous
        if new["date"] != old["match_date"]:
            raise SourceError("PERIODS_CONFLICT", f"{key}: match date changed")
        decision = DECISIONS.get(key)
        for label, column in COLUMNS.items():
            frozen = [old[f"{side}_{column}"] for side in ("home", "away")]
            candidate = [new[f"{side}_{column}"] for side in ("home", "away")]
            # Only one of the ledger's known historical pre-images may change. An ET marker
            # that was absent can be added, but an existing phase cannot be erased or guessed.
            if frozen == [None, None] or frozen == candidate:
                continue
            if decision and label == "p" and frozen == decision["observed"].get(label):
                continue
            if decision and label in ("ht", "ft", "et") and frozen == decision["observed"].get(label):
                continue
            raise SourceError("PERIODS_CONFLICT", f"{key}: previously accepted {label} would change")


def record(conn, scope, now, observation, status, code="", detail=None):
    conn.execute(
        """INSERT INTO ops.dfb_period_observations
           (scope,source_sha256,ledger_sha256,status,code,observed_at,observation,detail)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
        (scope, observation["sourceSha256"], LEDGER_SHA256, status, code, now, Jsonb(observation), detail),
    )


class Refusal(SourceError):
    def __init__(self, error, scope, now, observation):
        super().__init__(error.code, error.detail)
        self.scope = scope
        self.now = now
        self.observation = observation

    def record_refusal(self, conn):
        record(conn, self.scope, self.now, self.observation, "refused", self.code, self.detail)
