"""Transactional typed persistence into a dedicated local v2 PostgreSQL database."""

from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

import psycopg
from psycopg import sql

from .normalize import NormalizedFamily, number
from .seasons import FIRST_SEASON, LAST_ARCHIVE_SEASON, season_id, sporting_season

FAMILY_TABLES = {
    "shots": ("shots",),
    "events": ("match_events",),
    "lineups": ("lineups", "lineup_players"),
    "momentum": ("match_momentum",),
    "team_stats": ("team_match_stats",),
    "player_stats": ("player_match_stats",),
    "player_halves": ("player_match_half_stats",),
    "advanced": ("team_match_advanced",),
    "advanced_players": ("player_match_advanced",),
    "network": ("pass_network_teams", "pass_network_nodes", "pass_network_edges"),
    "heatmaps": ("team_heatmaps", "player_heatmaps"),
    "h2h": ("match_h2h", "match_h2h_meetings"),
}
ENTITY_TABLE = {
    "competition": "competitions",
    "team": "teams",
    "player": "players",
    "coach": "coaches",
    "referee": "referees",
    "venue": "venues",
    "match": "matches",
}
FOREIGN_KIND = {
    "team_id": "team",
    "home_team_id": "team",
    "away_team_id": "team",
    "player_id": "player",
    "related_player_id": "player",
    "keeper_id": "player",
    "from_player_id": "player",
    "to_player_id": "player",
    "coach_id": "coach",
    "referee_id": "referee",
    "venue_id": "venue",
}


class StoreError(RuntimeError):
    """Messages are codes, never provider values or SQL rejected-row details."""


# Order matters: "Quarter-final" is a knockout round, not the final.
_STAGES = (
    (r"\b(qualif\w*|preliminary|prelim\w*)\b", "qualifying"),
    (r"\b(play-?offs?|barrage\w*)\b", "playoff"),
    (r"\b(group|groupe|league phase|phase de ligue)\b", "group"),
    (
        r"(\bround of \d+|\b1/\d+|\bquarter|\bsemi|\bhuiti\w*|\bquarts?\b|\bdemi\w*|\bseizi\w*|\bknockout)",
        "knockout",
    ),
    (r"\b(final|finale)\b", "final"),
)


def round_stage(name):
    """Stage of a round from its provider name; a plain matchday is a regular round."""
    plain = name.lower()
    for pattern, stage in _STAGES:
        if re.search(pattern, plain):
            return stage
    return "regular"


# A database restart (memory recovery, resize) can replace the host without closing its
# connections: with the system's defaults a task then waits about two hours on a dead
# socket (9 November 2026: the worker and the backfill stayed 40 minutes without one
# call after a recovery). With these the loss is seen within a minute and raises
# psycopg.OperationalError, which worker.keep_running answers by reconnecting.
CONNECTION = {
    "connect_timeout": 10,
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 3,
    "tcp_user_timeout": 60000,  # ms a sent query may stay unacknowledged
}


def connect_local(dsn):
    parsed = urlparse(dsn)
    if (
        parsed.scheme not in ("postgres", "postgresql")
        or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
        or not re.fullmatch(r"/vega_v2_[a-z0-9_]+", parsed.path)
        or parsed.query
    ):
        raise StoreError("LOCAL_V2_DATABASE_REQUIRED")
    return psycopg.connect(dsn, autocommit=True, **CONNECTION)


def migrate(conn, *, vector=False):
    """Apply immutable checksummed migrations; never touch an existing legacy schema.

    Each file commits on its own: a value added to an enum (ALTER TYPE ... ADD VALUE)
    can only be used once that transaction has committed, so a later file may rely on
    it. A failing file rolls back alone and stops the run. On a new database, the
    files up to the one creating ops.schema_migrations run as one transaction.
    """
    directory = Path(__file__).resolve().parents[1] / "sql"
    files = sorted(
        p for p in directory.glob("*.sql") if vector or "vector_optional" not in p.name
    )
    sources = [(p.name, p.read_text(encoding="utf-8")) for p in files]
    lock = "SELECT pg_advisory_xact_lock(hashtextextended('vega_v2_migrate',0))"
    table = "SELECT to_regclass('ops.schema_migrations')"
    with conn.transaction():
        conn.execute(lock)
        if not conn.execute(table).fetchone()[0]:
            if conn.execute(
                "SELECT 1 FROM pg_namespace WHERE nspname IN ('core','agg','ops')"
            ).fetchone():
                raise StoreError("UNMANAGED_SCHEMA")
            done = []
            for name, source in sources:
                conn.execute(source)
                done.append((name, hashlib.sha256(source.encode()).digest()))
                if conn.execute(table).fetchone()[0]:
                    break
            for version, checksum in done:
                conn.execute(
                    "INSERT INTO ops.schema_migrations(version,checksum) VALUES(%s,%s)",
                    (version, checksum),
                )
    for name, source in sources:
        checksum = hashlib.sha256(source.encode()).digest()
        with conn.transaction():
            conn.execute(lock)
            applied = conn.execute(
                "SELECT checksum FROM ops.schema_migrations WHERE version=%s", (name,)
            ).fetchone()
            if applied:
                if bytes(applied[0]) != checksum:
                    raise StoreError("MIGRATION_CHECKSUM_CHANGED")
                continue
            conn.execute(source)
            conn.execute(
                "INSERT INTO ops.schema_migrations(version,checksum) VALUES(%s,%s)",
                (name, checksum),
            )


def digest(batch):
    # JSON is a transient canonical serializer for a hash, never a stored response.
    def encode(value):
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
            default=lambda x: (
                x.isoformat() if isinstance(x, (date, datetime)) else str(x)
            ),
        )

    # Row ordering has no SQL meaning. Events/shots retain explicit sequence keys.
    value = {
        "coverage": batch.coverage,
        "rows": {table: sorted(rows, key=encode) for table, rows in batch.rows.items()},
    }
    return hashlib.sha256(encode(value).encode()).digest()


class Store:
    def __init__(self, conn):
        self.conn = conn
        self._versions = set()
        self.columns = {}
        for table, col in conn.execute(
            "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='core'"
        ):
            self.columns.setdefault(table, set()).add(col)
        self.partitions = [
            r[0]
            for r in conn.execute(
                "SELECT c.relname FROM pg_partitioned_table p JOIN pg_class c ON c.oid=p.partrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core'"
            )
        ]

    def resolve(self, kind, key):
        if key is None:
            return None
        # Coaches, referees and venues have only a name at PitchAPI: that name is their
        # provider key, so homonyms can later be split by another source (Wikidata QID).
        row = self.conn.execute(
            "SELECT entity_id FROM core.provider_ids WHERE entity_type=%s AND provider='pitchapi' AND provider_key=%s",
            (kind, key),
        ).fetchone()
        if not row:
            raise StoreError("UNRESOLVED_REFERENCE")
        return row[0]

    def has(self, kind, key):
        try:
            self.resolve(kind, key)
            return True
        except StoreError:
            return False

    def _upsert(self, table, row, conflict):
        if table not in self.columns or set(row) - self.columns[table]:
            raise StoreError("UNKNOWN_COLUMN")
        keys = list(row)
        changed = [k for k in keys if k not in conflict]
        action = (
            sql.SQL("DO UPDATE SET {}").format(
                sql.SQL(",").join(
                    sql.SQL("{}=EXCLUDED.{}").format(
                        sql.Identifier(k), sql.Identifier(k)
                    )
                    for k in changed
                )
            )
            if changed
            else sql.SQL("DO NOTHING")
        )
        return self.conn.execute(
            sql.SQL(
                "INSERT INTO core.{} ({}) VALUES ({}) ON CONFLICT ({}) {} RETURNING id"
            ).format(
                sql.Identifier(table),
                sql.SQL(",").join(map(sql.Identifier, keys)),
                sql.SQL(",").join(sql.Placeholder() for _ in keys),
                sql.SQL(",").join(map(sql.Identifier, conflict)),
                action,
            ),
            list(row.values()),
        ).fetchone()

    def entity(self, kind, key, fields):
        if kind == "match":
            return
        table = ENTITY_TABLE[kind]
        self.conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
            ("pitchapi:" + kind + ":" + key,),
        )
        row = {
            k: v
            for k, v in fields.items()
            if k in self.columns[table] and k not in ("id", "updated_at")
        }
        if (
            kind == "player"
            and isinstance(row.get("name"), str)
            and not row["name"].strip()
        ):
            row["name"] = None
        for name in ("shirt_number", "position_id"):
            if name in row:
                row[name] = number(row[name], "smallint")
        if row.get("country_code"):
            self.conn.execute(
                "INSERT INTO core.countries(code) VALUES(%s) ON CONFLICT DO NOTHING",
                (row["country_code"],),
            )
        if fields.get("image_url") and kind in ("competition", "team", "player"):
            asset_kind, col = {
                "competition": ("logo", "logo_asset_id"),
                "team": ("crest", "crest_asset_id"),
                "player": ("photo", "photo_asset_id"),
            }[kind]
            aid = self.conn.execute(
                "INSERT INTO core.assets(kind,source_url) VALUES(%s,%s) ON CONFLICT(source_url) DO UPDATE SET source_url=EXCLUDED.source_url RETURNING id",
                (asset_kind, fields["image_url"]),
            ).fetchone()[0]
            row[col] = aid
        try:
            ident = self.resolve(kind, key)
        except StoreError:
            ident = None
        changed = ident is None
        if ident is None:
            if kind == "player" and row.get("name") is None:
                # An observed provider ID is a fact even if its profile is absent.
                row["name"] = None
            elif not isinstance(row.get("name"), str) or not row["name"].strip():
                raise StoreError("REFERENCE_NAME_REQUIRED")
            keys = list(row)
            ident = self.conn.execute(
                sql.SQL("INSERT INTO core.{} ({}) VALUES ({}) RETURNING id").format(
                    sql.Identifier(table),
                    sql.SQL(",").join(map(sql.Identifier, keys)),
                    sql.SQL(",").join(sql.Placeholder() for _ in keys),
                ),
                list(row.values()),
            ).fetchone()[0]
            self.conn.execute(
                "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES(%s,'pitchapi',%s,%s)",
                (kind, key, ident),
            )
        elif row:
            # Omitted metadata is preserved; explicit source null remains null except required name.
            if row.get("name", True) is None:
                row.pop("name")
            current = (
                self.conn.execute(
                    sql.SQL("SELECT {} FROM core.{} WHERE id=%s").format(
                        sql.SQL(",").join(map(sql.Identifier, row)),
                        sql.Identifier(table),
                    ),
                    (ident,),
                ).fetchone()
                if row
                else ()
            )
            changed = tuple(row.values()) != current
            if changed:
                self.conn.execute(
                    sql.SQL(
                        "UPDATE core.{} SET {},updated_at=now() WHERE id=%s"
                    ).format(
                        sql.Identifier(table),
                        sql.SQL(",").join(
                            sql.SQL("{}=%s").format(sql.Identifier(k)) for k in row
                        ),
                    ),
                    [*row.values(), ident],
                )
        if changed and kind in ("team", "player", "competition"):
            if kind != "competition":
                self._bump(kind, ident)
            else:
                for (edition,) in self.conn.execute(
                    "SELECT id FROM core.competition_seasons WHERE competition_id=%s",
                    (ident,),
                ):
                    self._bump("competition_season", edition)
            self._bump("home", 1)
        if kind in ("team", "player"):
            from .profiles import queue_first_seen

            queue_first_seen(self.conn, kind, ident)
        return ident

    def references(self, batch):
        grouped = {}
        for ref in batch.references:
            if ref.entity_type == "match":
                continue
            key = ref.provider_key or ref.natural_name
            if key is None:
                continue
            fields = grouped.setdefault((ref.entity_type, key), {})
            fields.update({k: v for k, v in ref.fields.items() if v is not None})
            if ref.natural_name:
                fields["name"] = ref.natural_name
        for (kind, key), fields in sorted(grouped.items()):
            self.entity(kind, key, fields)

    def season(self, label):
        """Create a Vega season ("YYYY/YYYY+1", id = start year) and its partitions."""
        sid = season_id(label)
        if sid is None:
            raise StoreError("INVALID_SEASON")
        self.conn.execute(
            "INSERT INTO core.seasons(id,label) VALUES(%s,%s) ON CONFLICT(id) DO NOTHING",
            (sid, label),
        )
        archive = sid <= LAST_ARCHIVE_SEASON
        suffix = "archive" if archive else f"s{sid}"
        # One catalog read instead of one DDL per partitioned table when all exist
        # (the weekly league catalogue names thousands of editions).
        if self.conn.execute(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core' AND c.relname=ANY(%s)",
            ([f"{table}_{suffix}" for table in self.partitions],),
        ).fetchone()[0] == len(self.partitions):
            return sid
        # One partition per season since 2021/2022, one shared partition for the
        # archives; created by the tables' owner (017_roles.sql).
        self.conn.execute("SELECT core.ensure_season_partitions(%s)", (sid,))
        return sid
        self.conn.execute(
            "SELECT pg_advisory_xact_lock(92001,%s)", (0 if archive else sid,)
        )
        # One partition per season since 2021/2022; one shared partition for the archives.
        values = (
            sql.SQL(",").join(
                sql.Literal(y) for y in range(FIRST_SEASON, LAST_ARCHIVE_SEASON + 1)
            )
            if archive
            else sql.Literal(sid)
        )
        for table in self.partitions:
            self.conn.execute(
                sql.SQL(
                    "CREATE TABLE IF NOT EXISTS core.{} PARTITION OF core.{} FOR VALUES IN ({})"
                ).format(
                    sql.Identifier(f"{table}_{suffix}"),
                    sql.Identifier(table),
                    values,
                )
            )
        return sid

    def edition(self, competition_id, native_label):
        """A provider edition becomes a competition-season of its Vega sporting season."""
        found = self.conn.execute(
            "SELECT c.name,p.provider_key FROM core.competitions c LEFT JOIN core.provider_ids p ON p.entity_type='competition' AND p.provider='pitchapi' AND p.entity_id=c.id AND p.is_current WHERE c.id=%s",
            (competition_id,),
        ).fetchone()
        name, key = found if found else (None, None)
        label = sporting_season(native_label, key, name)
        if label is None:
            raise StoreError("INVALID_SEASON")
        sid = self.season(label)
        eid = self.conn.execute(
            "INSERT INTO core.competition_seasons(competition_id,season_id,native_label) VALUES(%s,%s,%s) ON CONFLICT(competition_id,season_id) DO UPDATE SET native_label=EXCLUDED.native_label RETURNING id",
            (competition_id, sid, native_label),
        ).fetchone()[0]
        return eid, sid

    def round(self, competition_season_id, name):
        """A matchday, cup round or group stage, keyed by its name within the edition."""
        if not isinstance(name, str) or not name.strip():
            return None
        name = name.strip()
        return self.conn.execute(
            "INSERT INTO core.rounds(competition_season_id,name,stage) VALUES(%s,%s,%s) ON CONFLICT(competition_season_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
            (competition_season_id, name, round_stage(name)),
        ).fetchone()[0]

    def _row(self, row):
        return {
            k: self.resolve(FOREIGN_KIND[k], v) if k in FOREIGN_KIND else v
            for k, v in row.items()
        }

    def _bump(self, kind, ident):
        self._versions.add((kind, ident))

    def _flush_versions(self):
        # Acquire shared version rows only after all entity locks. Otherwise a
        # worker holding home could wait on an entity held by a home waiter.
        for kind, ident in sorted(self._versions):
            self.conn.execute(
                "INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES(%s,%s) ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1,updated_at=now()",
                (kind, ident),
            )
        self._versions.clear()

    def _scopes(self, mid, tables):
        scopes = set()
        for table in tables:
            cols = self.columns[table]
            if "team_id" not in cols:
                continue
            select = (
                "player_id,team_id" if "player_id" in cols else "NULL::integer,team_id"
            )
            scopes.update(
                self.conn.execute(
                    sql.SQL(
                        "SELECT DISTINCT " + select + " FROM core.{} WHERE match_id=%s"
                    ).format(sql.Identifier(table)),
                    (mid,),
                )
            )
        return scopes

    def _dirty(self, mid, edition, scopes):
        self._bump("match", mid)
        self._bump("competition_season", edition)
        self._bump("home", 1)
        targets = {("competition_season", None, None)}
        for player, team in scopes:
            if team:
                targets.add(("team_season", None, team))
                self._bump("team", team)
            if player and team:
                targets.add(("player_season", player, team))
                self._bump("player", player)
        for kind, player, team in sorted(
            targets, key=lambda item: (item[0], item[1] or 0, item[2] or 0)
        ):
            self.conn.execute(
                "INSERT INTO ops.dirty_scopes(scope_kind,player_id,team_id,competition_season_id) VALUES(%s,%s,%s,%s) ON CONFLICT(scope_kind,player_id,team_id,competition_season_id,cohort_id) DO UPDATE SET revision=ops.dirty_scopes.revision+1,queued_at=now()",
                (kind, player, team, edition),
            )

    def _unknown(self, family, batch):
        for path in sorted(batch.unknown_paths):
            self.conn.execute(
                "INSERT INTO ops.unknown_fields(family,field_path) VALUES(%s,%s) ON CONFLICT(family,field_path) DO UPDATE SET last_seen_at=now(),occurrences=ops.unknown_fields.occurrences+1",
                (family, path),
            )

    def save_references(self, batch, *, family="league"):
        with self.conn.transaction():
            self._versions.clear()
            self._unknown(family, batch)
            self.references(batch)
            for table, rows in batch.rows.items():
                kind = {
                    "core.competitions": "competition",
                    "core.teams": "team",
                    "core.players": "player",
                }.get(table)
                if kind:
                    for row in rows:
                        self.entity(kind, row["id"], row)
                elif table == "core.competition_seasons":
                    for row in rows:
                        competition = self.resolve("competition", row["competition_id"])
                        edition, _ = self.edition(competition, row["native_label"])
                        if row.get("is_current"):
                            self.conn.execute(
                                "UPDATE core.competition_seasons SET is_current = (id = %s) WHERE competition_id = %s AND is_current IS DISTINCT FROM (id = %s)",
                                (edition, competition, edition),
                            )
                else:
                    raise StoreError("UNEXPECTED_REFERENCE_TABLE")
            self._flush_versions()

    def save_matches(self, batch, competition_season_id, *, family="summary"):
        """Catalogue/summary match anchors, with explicit season identity."""
        with self.conn.transaction():
            self._versions.clear()
            self._unknown(family, batch)
            for source in sorted(
                batch.rows.get("core.matches", []), key=lambda row: row["id"]
            ):
                self.conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                    ("pitchapi:match:" + source["id"],),
                )
                self.conn.execute(
                    "SELECT m.id FROM core.matches m JOIN core.provider_ids p ON p.entity_type='match' AND p.provider='pitchapi' AND p.entity_id=m.id WHERE p.provider_key=%s FOR UPDATE OF m",
                    (source["id"],),
                )
            self.references(batch)
            # The provider edition is compared with the edition it was stored under,
            # not with the Vega season label (a calendar-year "2026" is 2026/2027).
            sid, competition_id, label = self.conn.execute(
                "SELECT cs.season_id,cs.competition_id,cs.native_label FROM core.competition_seasons cs WHERE cs.id=%s",
                (competition_season_id,),
            ).fetchone()
            ids = []
            for source in batch.rows.get("core.matches", []):
                key = source["id"]
                if (
                    source.get("provider_season") is not None
                    and source["provider_season"] != label
                ):
                    raise StoreError("MATCH_SEASON_CHANGED")
                if (
                    source.get("provider_competition_id")
                    and self.resolve("competition", source["provider_competition_id"])
                    != competition_id
                ):
                    raise StoreError("MATCH_COMPETITION_CHANGED")
                row = self._row(
                    {
                        k: v
                        for k, v in source.items()
                        if k
                        not in (
                            "id",
                            "provider_season",
                            "provider_competition_id",
                            "round_name",
                        )
                    }
                )
                if "round_name" in source:
                    row["round_id"] = self.round(
                        competition_season_id, source["round_name"]
                    )
                row.update(
                    competition_season_id=competition_season_id,
                    season_id=sid,
                    source="pitchapi",
                )
                try:
                    mid = self.resolve("match", key)
                except StoreError:
                    mid = None
                changed = True
                old_scopes = set()
                if mid:
                    current = self.conn.execute(
                        "SELECT competition_season_id,season_id,home_team_id,away_team_id FROM core.matches WHERE id=%s FOR UPDATE",
                        (mid,),
                    ).fetchone()
                    old_scopes = {(None, current[2]), (None, current[3])}
                    moved = current[:2] != (competition_season_id, sid)
                    if moved:
                        # The provider names another edition (or /date had none and the
                        # current one was assumed): move the match while it has no
                        # after-match facts; otherwise refuse, visibly.
                        self._move(mid, current[0], current[1], competition_season_id, sid)
                        self._dirty(mid, current[0], old_scopes)
                    cols = list(row)
                    old = self.conn.execute(
                        sql.SQL("SELECT {} FROM core.matches WHERE id=%s").format(
                            sql.SQL(",").join(map(sql.Identifier, cols))
                        ),
                        (mid,),
                    ).fetchone()
                    changed = moved or tuple(row.values()) != old
                    if changed:
                        self.conn.execute(
                            sql.SQL(
                                "UPDATE core.matches SET {},revision=revision+1,updated_at=now() WHERE id=%s"
                            ).format(
                                sql.SQL(",").join(
                                    sql.SQL("{}=%s").format(sql.Identifier(k))
                                    for k in row
                                )
                            ),
                            [*row.values(), mid],
                        )
                else:
                    cols = list(row)
                    mid = self.conn.execute(
                        sql.SQL(
                            "INSERT INTO core.matches ({}) VALUES ({}) RETURNING id"
                        ).format(
                            sql.SQL(",").join(map(sql.Identifier, cols)),
                            sql.SQL(",").join(sql.Placeholder() for _ in cols),
                        ),
                        list(row.values()),
                    ).fetchone()[0]
                    self.conn.execute(
                        "INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('match','pitchapi',%s,%s)",
                        (key, mid),
                    )
                if row.get("status") == "finished":
                    self.conn.execute(
                        "UPDATE core.matches SET first_finished_at=COALESCE(first_finished_at,now()) WHERE id=%s",
                        (mid,),
                    )
                self.conn.execute(
                    "INSERT INTO core.match_coverage(season_id,match_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                    (sid, mid),
                )
                for tid in (row.get("home_team_id"), row.get("away_team_id")):
                    if tid:
                        self.conn.execute(
                            "INSERT INTO core.team_seasons(team_id,competition_season_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                            (tid, competition_season_id),
                        )
                if changed:
                    self._dirty(
                        mid,
                        competition_season_id,
                        old_scopes
                        | {
                            (None, row.get("home_team_id")),
                            (None, row.get("away_team_id")),
                        },
                    )
                if family == "summary":
                    fingerprint = digest(
                        NormalizedFamily(rows={"core.matches": [source]})
                    )
                    self.conn.execute(
                        "INSERT INTO ops.family_state(match_id,family,fingerprint,status,last_success_at,last_attempt_at) VALUES(%s,'summary',%s,'ok',now(),now()) ON CONFLICT(match_id,family) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,status='ok',last_success_at=now(),last_attempt_at=now(),updated_at=now()",
                        (mid, fingerprint),
                    )
                ids.append(mid)
            self._flush_versions()
            return ids

    PRE_MATCH_FAMILIES = ("lineups", "h2h")

    def _move(self, mid, old_edition, old_season, edition, season):
        """Move a match to another edition; its detail rows live in the season's partition."""
        if self.conn.execute(
            "SELECT 1 FROM ops.family_state WHERE match_id=%s AND family <> 'summary' AND NOT (family = ANY(%s)) AND status IN ('ok','unavailable')",
            (mid, list(self.PRE_MATCH_FAMILIES)),
        ).fetchone():
            raise StoreError("MATCH_SEASON_CHANGED")
        # Forecast lineups and h2h are fetched again after the final whistle.
        for family in self.PRE_MATCH_FAMILIES:
            for table in FAMILY_TABLES[family]:
                self.conn.execute(
                    sql.SQL("DELETE FROM core.{} WHERE match_id=%s AND season_id=%s").format(sql.Identifier(table)),
                    (mid, old_season),
                )
        self.conn.execute(
            "DELETE FROM ops.family_state WHERE match_id=%s AND family = ANY(%s)",
            (mid, list(self.PRE_MATCH_FAMILIES)),
        )
        self.conn.execute(
            "DELETE FROM core.match_coverage WHERE match_id=%s AND season_id=%s", (mid, old_season)
        )
        round_name = self.conn.execute(
            "SELECT r.name FROM core.matches m JOIN core.rounds r ON r.id = m.round_id WHERE m.id=%s", (mid,)
        ).fetchone()
        self.conn.execute(
            "UPDATE core.matches SET competition_season_id=%s, season_id=%s, round_id=%s, revision=revision+1, updated_at=now() WHERE id=%s",
            (edition, season, self.round(edition, round_name[0]) if round_name else None, mid),
        )
        self.conn.execute(
            "INSERT INTO core.match_coverage(season_id,match_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
            (season, mid),
        )

    def save_family(self, mid, family, batch, *, lease=None):
        if family not in FAMILY_TABLES or batch.coverage not in ("ok", "unavailable"):
            raise StoreError("INVALID_FAMILY")
        tables = FAMILY_TABLES[family]
        if set(batch.rows) - {"core." + t for t in tables}:
            raise StoreError("UNEXPECTED_FAMILY_TABLE")
        with self.conn.transaction():
            self._versions.clear()
            if lease:
                job_id, token = lease
                if not self.conn.execute(
                    "SELECT id FROM ops.fetch_jobs WHERE id=%s AND lease_token=%s AND state='leased' AND lease_until>clock_timestamp() AND family=%s AND entity_type='match' AND entity_id=%s FOR UPDATE",
                    (job_id, token, family, mid),
                ).fetchone():
                    raise StoreError("LEASE_LOST")
            key = self.conn.execute(
                "SELECT provider_key FROM core.provider_ids WHERE entity_type='match' AND provider='pitchapi' AND entity_id=%s",
                (mid,),
            ).fetchone()[0]
            self.conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                ("pitchapi:match:" + key,),
            )
            sid, eid, home, away = self.conn.execute(
                "SELECT season_id,competition_season_id,home_team_id,away_team_id FROM core.matches WHERE id=%s FOR UPDATE",
                (mid,),
            ).fetchone()
            self.references(batch)
            self._unknown(family, batch)
            fingerprint = digest(batch)
            prior = self.conn.execute(
                "SELECT fingerprint,status FROM ops.family_state WHERE match_id=%s AND family=%s",
                (mid, family),
            ).fetchone()
            changed = not prior or bytes(prior[0] or b"") != fingerprint
            if changed:
                scopes = self._scopes(mid, tables) | {(None, home), (None, away)}
                for table in reversed(tables):
                    self.conn.execute(
                        sql.SQL(
                            "DELETE FROM core.{} WHERE season_id=%s AND match_id=%s"
                        ).format(sql.Identifier(table)),
                        (sid, mid),
                    )
                for table in tables:
                    for item in batch.rows.get("core." + table, []):
                        row = self._row(item)
                        row.update(season_id=sid, match_id=mid)
                        if set(row) - self.columns[table]:
                            raise StoreError("UNKNOWN_COLUMN")
                        cols = list(row)
                        self.conn.execute(
                            sql.SQL("INSERT INTO core.{} ({}) VALUES ({})").format(
                                sql.Identifier(table),
                                sql.SQL(",").join(map(sql.Identifier, cols)),
                                sql.SQL(",").join(sql.Placeholder() for _ in cols),
                            ),
                            list(row.values()),
                        )
                self.conn.execute(
                    sql.SQL(
                        "UPDATE core.match_coverage SET {}=%s,updated_at=now() WHERE season_id=%s AND match_id=%s"
                    ).format(sql.Identifier(family)),
                    (batch.coverage, sid, mid),
                )
                self.conn.execute(
                    "UPDATE core.matches SET revision=revision+1,updated_at=now() WHERE id=%s",
                    (mid,),
                )
                self._dirty(mid, eid, scopes | self._scopes(mid, tables))
            self.conn.execute(
                "INSERT INTO ops.family_state(match_id,family,fingerprint,status,last_success_at,last_attempt_at) VALUES(%s,%s,%s,%s,now(),now()) ON CONFLICT(match_id,family) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,status=EXCLUDED.status,last_success_at=now(),last_attempt_at=now(),updated_at=now()",
                (mid, family, fingerprint, batch.coverage),
            )
            if lease:
                from .jobs import ack

                ack(self.conn, *lease)
            self._flush_versions()
            return changed

    def record_failure(self, mid, family, code, *, lease=None):
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code):
            code = "INGESTION_ERROR"
        with self.conn.transaction():
            if (
                lease
                and not self.conn.execute(
                    "SELECT id FROM ops.fetch_jobs WHERE id=%s AND lease_token=%s AND state='leased' AND lease_until>clock_timestamp() AND family=%s AND entity_type='match' AND entity_id=%s FOR UPDATE",
                    (*lease, family, mid),
                ).fetchone()
            ):
                raise StoreError("LEASE_LOST")
            self.conn.execute(
                "SELECT id FROM core.matches WHERE id=%s FOR UPDATE", (mid,)
            )
            self.conn.execute(
                "INSERT INTO ops.parse_failures(family,entity_type,entity_id,error_code,message) VALUES(%s,'match',%s,%s,%s)",
                (family, mid, code, code),
            )
            self.conn.execute(
                "INSERT INTO ops.family_state(match_id,family,status,last_attempt_at) VALUES(%s,%s,'error',now()) ON CONFLICT(match_id,family) DO UPDATE SET status='error',last_attempt_at=now(),updated_at=now()",
                (mid, family),
            )
            # An attempt failure belongs to ops; core coverage describes the last
            # committed facts. Neither successful data nor its cache version changes.

    def log_attempt(
        self,
        family,
        event,
        *,
        entity_type=None,
        entity_id=None,
        competition_season_id=None,
        target_date=None,
        global_key=None,
    ):
        at = event["fetched_at"]
        with self.conn.transaction():
            self.conn.execute("SELECT ops.ensure_fetch_log_partition(%s)", (at,))
            self.conn.execute(
                "INSERT INTO ops.fetch_log(family,entity_type,entity_id,competition_season_id,target_date,global_key,http_status,error_code,request_id,duration_ms,fetched_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    family,
                    entity_type,
                    entity_id,
                    competition_season_id,
                    target_date,
                    global_key,
                    event["status"],
                    event["error_code"],
                    event["request_id"],
                    event["duration_ms"],
                    at,
                ),
            )
