"""Pure PostgreSQL integrity DDL for the approved selective-inline typed model.

The failure protocol and executable PostgreSQL E2E contract precede this module.
No connection, source payload, shadow history or universal row registry is used.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping


def _ident(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-z_][a-z0-9_]*", value) or len(value.encode()) > 63:
        raise ValueError("Invalid approved SQL identifier")
    return '"' + value + '"'


def _relation(value: str) -> str:
    parts = value.split(".")
    if len(parts) != 2 or parts[0] not in {"ingest", "football", "analytics"}:
        raise ValueError("Relation outside the approved typed schemas")
    return ".".join(_ident(part) for part in parts)


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _field(alias: str, column: str) -> str:
    return alias + "." + _ident(column)


def _row(alias: str, columns: Iterable[str]) -> str:
    return "ROW(" + ",".join(_field(alias, column) for column in columns) + ")"


def _equal(left: str, right: str, columns: Iterable[str], *, nulls_equal: bool = True) -> str:
    operator = " IS NOT DISTINCT FROM " if nulls_equal else " = "
    return " AND ".join(_field(left, column) + operator + _field(right, column) for column in columns) or "TRUE"


def _table_map(model: dict, active_tables) -> dict:
    known = {table["qualified_name"]: table for schema in model["schemas"] for table in schema["tables"]}
    supplied = active_tables.values() if isinstance(active_tables, Mapping) else active_tables
    names = [item if isinstance(item, str) else item["qualified_name"] for item in supplied]
    if len(names) != len(set(names)) or any(name not in known for name in names):
        raise ValueError("Active tables must be a unique subset of the supplied model")
    tables = {name: known[name] for name in names}
    for name, table in tables.items():
        _relation(name)
        for column in table["columns"]:
            _ident(column)
        for fk in table["foreign_keys"]:
            if fk["references"]["table"] not in tables:
                raise ValueError("Active typed integrity requires complete FK dependency closure")
    if "ingest.dataset_snapshots" not in tables:
        raise ValueError("Typed integrity requires the model generation receipt table")
    return tables


def _function(name: str, args: str, result: str, body: str, *, language: str = "plpgsql", attributes: str = "") -> str:
    # All relation and function identifiers are fixed here or validated model identifiers.
    return (f"CREATE OR REPLACE FUNCTION {_relation(name)}({args}) RETURNS {result}\n"
            f"LANGUAGE {language} SECURITY DEFINER SET search_path = pg_catalog {attributes}\n"
            f"AS $orion_pro$\n{body}\n$orion_pro$;\n"
            f"REVOKE ALL ON FUNCTION {_relation(name)}({', '.join(_argument_types(args))}) FROM PUBLIC;")


def _argument_types(args: str) -> list[str]:
    if not args:
        return []
    return [argument.strip().split()[1] for argument in args.split(",")]


def _guard_function(name: str, body: str) -> str:
    return _function(name, "", "trigger", "BEGIN\n" + body + "\nEND;")


def _trigger(table: str, function: str, *, name: str = "pro_typed_guard", event: str = "BEFORE INSERT OR UPDATE OR DELETE", deferred: bool = False) -> str:
    prefix = "CREATE CONSTRAINT TRIGGER" if deferred else "CREATE TRIGGER"
    timing = " DEFERRABLE INITIALLY DEFERRED" if deferred else ""
    return (f"{prefix} {_ident(name)} {event} ON {_relation(table)}{timing}\n"
            f"FOR EACH ROW EXECUTE FUNCTION {_relation(function)}();")


def _interval(table: dict) -> tuple[str, str]:
    return ("published_from_gen", "published_to_gen") if "published_from_gen" in table["columns"] else ("recorded_from_gen", "recorded_to_gen")


def _at(table: dict, alias: str, generation: str, *, canonical: bool = True) -> str:
    start, end = _interval(table)
    parts = [f"ingest.selected_at({generation},{_field(alias,start)},{_field(alias,end)})"]
    if canonical and "is_canonical" in table["columns"]:
        parts.append(_field(alias, "is_canonical"))
    if "is_deleted" in table["columns"]:
        parts.append("NOT " + _field(alias, "is_deleted"))
    return " AND ".join(parts)


def _append_parent(table: dict, tables: dict):
    for fk in table["foreign_keys"]:
        target = tables[fk["references"]["table"]]
        if target.get("versioning", {}).get("kind") == "existing_append_only":
            return fk, target
    return None


def _selected(table: dict, alias: str, generation: str, tables: dict, rules: dict, depth: int = 0) -> str | None:
    kind = table.get("versioning", {}).get("kind")
    name = table["qualified_name"]
    if table["write_mode"] == "immutable_values_close_interval_once":
        return _at(table, alias, generation)
    if kind == "parent_version_child":
        binding = table["versioning"]["parent_version_binding"]
        target = tables[binding["references"]["table"]]
        parent_alias = f"selection_parent_{depth}"
        relation = " AND ".join(f"{_field(parent_alias,p)} = {_field(alias,c)}" for c,p in zip(binding["columns"],binding["references"]["columns"]))
        return f"EXISTS (SELECT 1 FROM {_relation(target['qualified_name'])} {parent_alias} WHERE {relation} AND {_at(target,parent_alias,generation)})"
    if kind == "existing_append_only":
        if "recorded_from_gen" in table["columns"]:
            answer = f"{_field(alias,'recorded_from_gen')} <= {generation}"
            if name in rules:
                other = f"newer_observation_{depth}"
                key = rules[name]["logical_key"]
                answer += (f" AND NOT EXISTS (SELECT 1 FROM {_relation(name)} {other} WHERE {_equal(alias,other,key)} "
                           f"AND {_field(other,'recorded_from_gen')} <= {generation} "
                           f"AND {_field(other,'recorded_from_gen')} > {_field(alias,'recorded_from_gen')})")
            return answer
        parent = _append_parent(table, tables)
        if parent:
            fk, target = parent
            parent_alias = f"selection_parent_{depth}"
            joins = " AND ".join(f"{_field(parent_alias,p)} = {_field(alias,c)}" for c,p in zip(fk["columns"],fk["references"]["columns"]))
            active = _selected(target,parent_alias,generation,tables,rules,depth+1)
            return f"EXISTS (SELECT 1 FROM {_relation(target['qualified_name'])} {parent_alias} WHERE {joins} AND {active})"
    return None


def _assertion(query: str, message: str) -> str:
    return f"IF EXISTS ({query}) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE={_literal(message)}; END IF;"


def _generation_sql(tables: dict) -> list[str]:
    snapshot = tables["ingest.dataset_snapshots"]
    xid = "((pg_current_xact_id()::text::numeric % 4294967296)::text)"
    out = [_function("ingest.selected_at", "g bigint, from_gen bigint, to_gen bigint", "boolean",
                     "SELECT from_gen <= g AND (to_gen IS NULL OR g < to_gen)", language="sql", attributes="IMMUTABLE PARALLEL SAFE"),
           _function("ingest.assert_draft_generation", "g bigint", "void", f"""BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.generation=g AND s.status='draft' AND s.xmin::text={xid}) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Generation must be draft and owned by the current transaction';
    END IF;
END;"""),
           _function("ingest.begin_generation", "snapshot_key text, transform_version text, source_priority_version text, knowledge_cutoff_at timestamptz DEFAULT NULL", "bigint", f"""DECLARE g bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.xmin::text={xid}) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A retained transaction has exactly one generation';
    END IF;
    IF btrim(snapshot_key)='' OR btrim(transform_version)='' OR btrim(source_priority_version)='' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Generation contract identifiers must be nonempty';
    END IF;
    g := nextval('ingest.commit_generation_seq'::regclass);
    INSERT INTO ingest.dataset_snapshots(snapshot_key,transform_version,source_priority_version,knowledge_cutoff_at,generation)
      VALUES (snapshot_key,transform_version,source_priority_version,knowledge_cutoff_at,g);
    RETURN g;
END;"""),
           _function("ingest.seal_generation", "g bigint, manifest text", "void", """BEGIN
    PERFORM ingest.assert_draft_generation(g);
    IF manifest IS NULL OR manifest !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A sealed generation requires its manifest digest';
    END IF;
    UPDATE ingest.dataset_snapshots SET status='sealed', manifest_sha256=manifest, sealed_at=CURRENT_TIMESTAMP WHERE generation=g;
END;""")]
    unchanged = [column for column in snapshot["columns"] if column not in {"status","manifest_sha256","sealed_at"}]
    out.extend([_guard_function("ingest.pro_guard_dataset_snapshots", f"""    PERFORM pg_advisory_xact_lock(20261104,1);
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Generation receipts cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        IF NEW.status <> 'draft' OR NEW.sealed_at IS NOT NULL OR NEW.manifest_sha256 IS NOT NULL
           OR NEW.generation <> currval('ingest.commit_generation_seq'::regclass)
           OR EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.generation >= NEW.generation OR s.xmin::text={xid}) THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Allocate one draft generation after the global transaction lock';
        END IF;
    ELSE
        PERFORM ingest.assert_draft_generation(OLD.generation);
        IF {_row('NEW',unchanged)} IS DISTINCT FROM {_row('OLD',unchanged)} OR NEW.status <> 'sealed' THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Only sealing an owned draft generation is allowed';
        END IF;
        PERFORM ingest.validate_generation(OLD.generation);
    END IF;
    RETURN NEW;"""),
                _trigger("ingest.dataset_snapshots", "ingest.pro_guard_dataset_snapshots"),
                _guard_function("ingest.pro_generation_commit", """    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.id=NEW.id AND s.status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A retained generation must be sealed before commit';
    END IF;
    PERFORM ingest.validate_generation(NEW.generation);
    RETURN NULL;"""),
                _trigger("ingest.dataset_snapshots", "ingest.pro_generation_commit", name="pro_generation_commit",event="AFTER INSERT",deferred=True)])
    return out


def _version_guard(table: dict) -> list[str]:
    name = table["qualified_name"]
    start, end = _interval(table)
    function = "ingest.pro_guard_" + name.replace(".","_")
    immutable = [column for column in table["columns"] if column != end]
    body = f"""    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW.{_ident(start)});
        IF NEW.{_ident(end)} IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF {_row('NEW',immutable)} IS DISTINCT FROM {_row('OLD',immutable)}
           OR OLD.{_ident(end)} IS NOT NULL OR NEW.{_ident(end)} IS NULL
           OR NEW.{_ident(end)} <= OLD.{_ident(start)} THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW.{_ident(end)});
    END IF;
    RETURN NEW;"""
    if name == "analytics.publication_versions":
        body = body.replace("    RETURN NEW;", """    IF TG_OP='INSERT' AND NOT EXISTS (
        SELECT 1 FROM analytics.aggregation_builds b JOIN ingest.dataset_snapshots s ON s.id=b.dataset_snapshot_id
        JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id
        WHERE b.id=NEW.build_id AND b.competition_season_id=NEW.competition_season_id AND b.status='ready'
          AND s.status='sealed' AND c.status='sealed' AND b.catalog_snapshot_id=NEW.catalog_snapshot_id
          AND b.representation_version=NEW.representation_version
    ) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Publication requires its ready build, edition, sealed catalogue and representation';
    END IF;
    RETURN NEW;""")
    return [_guard_function(function,body), _trigger(name,function)]


def _retained_insert_guard(table: dict, tables: dict, revision_rules: dict) -> list[str]:
    name = table["qualified_name"]
    function = "ingest.pro_guard_" + name.replace(".","_")
    kind = table.get("versioning",{}).get("kind")
    setup = ""
    if kind == "parent_version_child":
        binding = table["versioning"]["parent_version_binding"]
        parent = tables[binding["references"]["table"]]
        joins = " AND ".join(f"{_field('p',p)} = {_field('NEW',c)}" for c,p in zip(binding["columns"],binding["references"]["columns"]))
        setup += (f"    SELECT p.recorded_from_gen INTO parent_generation FROM {_relation(parent['qualified_name'])} p WHERE {joins};\n"
                  "    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;\n"
                  "    PERFORM ingest.assert_draft_generation(parent_generation);\n")
    elif "recorded_from_gen" in table["columns"]:
        setup += "    PERFORM ingest.assert_draft_generation(NEW.recorded_from_gen);\n"
    elif kind == "existing_append_only":
        ancestry = []
        current, alias = table, "NEW"
        seen = set()
        while "recorded_from_gen" not in current["columns"]:
            parent = _append_parent(current,tables)
            if not parent or current["qualified_name"] in seen:
                raise ValueError("Missing generation ancestry for append-only typed child")
            seen.add(current["qualified_name"])
            fk,target = parent
            new_alias = f"p{len(ancestry)}"
            join = " AND ".join(f"{_field(new_alias,p)} = {_field(alias,c)}" for c,p in zip(fk["columns"],fk["references"]["columns"]))
            ancestry.append((target,new_alias,join))
            current,alias = target,new_alias
        first,*rest = ancestry
        source = f"{_relation(first[0]['qualified_name'])} {first[1]}"
        for target,parent_alias,join in rest:
            source += f" JOIN {_relation(target['qualified_name'])} {parent_alias} ON {join}"
        setup += (f"    SELECT {_field(alias,'recorded_from_gen')} INTO parent_generation FROM {source} WHERE {first[2]};\n"
                  "    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact append-only parent'; END IF;\n"
                  "    PERFORM ingest.assert_draft_generation(parent_generation);\n")
    if name in revision_rules:
        rule = revision_rules[name]
        comparison = _equal("prior","NEW",rule["logical_key"])
        revision = _ident(rule["revision_column"])
        setup += (f"    IF EXISTS (SELECT 1 FROM {_relation(name)} prior WHERE {comparison} "
                  f"AND (prior.recorded_from_gen >= NEW.recorded_from_gen OR prior.{revision} >= NEW.{revision})) THEN\n"
                  "        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Same-grain corrections require strictly increasing revision and generation';\n"
                  "    END IF;\n")
    body = """    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
""" + setup + "    RETURN NEW;"
    definition = _function(function,"","trigger","DECLARE parent_generation bigint;\nBEGIN\n" + body + "\nEND;")
    return [definition,_trigger(name,function)]


def _overlap_checks(table: dict) -> list[str]:
    name = table["qualified_name"]
    start,end = _interval(table)
    physical = table["primary_key"]["columns"]
    out = []
    for index in table["versioning"].get("selection_indexes",[]):
        predicate = index["where_sql"]
        accepted = {f"{end} IS NULL",f"{end} IS NULL AND is_canonical"}
        if predicate not in accepted:
            raise ValueError("Unsupported selection predicate in approved model")
        canonical = " AND a.is_canonical AND b.is_canonical" if predicate.endswith("AND is_canonical") else ""
        same = _equal("a","b",index["columns"],nulls_equal=index.get("nulls_not_distinct",False))
        query = (f"SELECT 1 FROM {_relation(name)} a JOIN {_relation(name)} b ON {same} "
                 f"WHERE {_row('a',physical)} < {_row('b',physical)} "
                 f"AND a.{_ident(start)} < COALESCE(b.{_ident(end)},9223372036854775807) "
                 f"AND b.{_ident(start)} < COALESCE(a.{_ident(end)},9223372036854775807) "
                 f"AND (a.{_ident(start)}=g OR a.{_ident(end)}=g OR b.{_ident(start)}=g OR b.{_ident(end)}=g){canonical}")
        out.append(_assertion(query,f"Historical interval overlap: {name} / {index['name']}"))
    return out


_NO_OP_CLOCKS = {"updated_at","observed_at","checked_at","retrieved_at","computed_at","created_at"}


def _content_columns(table: dict, extra_ignored=()) -> list[str]:
    ignored = _NO_OP_CLOCKS | {"revision_id","recorded_from_gen","recorded_to_gen","published_from_gen","published_to_gen","data_revision","revision"} | set(extra_ignored)
    if table.get("versioning",{}).get("kind") in {"profile_observation","immutable_family_parent"}:
        ignored.add("id")
    if table["qualified_name"] == "analytics.publication_versions":
        ignored.add("published_at")
    return [column for column in table["columns"] if column not in ignored]


def _child_sets_equal(parent: dict, child: dict) -> str:
    binding = child["versioning"]["parent_version_binding"]
    columns = _content_columns(child,binding["columns"])
    projection = ",".join(_ident(column) for column in columns)
    filters = {}
    for alias in ("old","fresh"):
        filters[alias] = " AND ".join(f"{_ident(c)} = {_field(alias,p)}" for c,p in zip(binding["columns"],binding["references"]["columns"]))
    a = f"SELECT {projection} FROM {_relation(child['qualified_name'])} WHERE {filters['old']}"
    b = f"SELECT {projection} FROM {_relation(child['qualified_name'])} WHERE {filters['fresh']}"
    return f"NOT EXISTS (({a} EXCEPT {b}) UNION ALL ({b} EXCEPT {a}))"


def _no_op_check(table: dict, tables: dict) -> str:
    name = table["qualified_name"]
    start,end = _interval(table)
    version = table["versioning"]
    key = version.get("variant_selection",{}).get("current_variant_key",version["logical_key"])
    columns = _content_columns(table)
    equal = _row("old",columns) + " IS NOT DISTINCT FROM " + _row("fresh",columns)
    children = [child for child in tables.values() if child.get("versioning",{}).get("parent") == name]
    for child in children:
        equal += " AND " + _child_sets_equal(table,child)
    # Shots retain individual revisions. Their coverage receipt need not be replaced
    # when only a shot's values change without changing list completeness/selection.
    query = (f"SELECT 1 FROM {_relation(name)} fresh JOIN {_relation(name)} old ON {_equal('fresh','old',key)} "
             f"WHERE fresh.{_ident(start)}=g AND old.{_ident(end)}=g AND {equal}")
    return _assertion(query,f"Identical typed reimport must reuse the retained version: {name}")


_MEMBERSHIP = {"competition_id","competition_season_id","stage_id","parent_stage_id","group_id","match_id","side",
               "team_id","player_id","association_id","honour_id","position_code","metric_code","profile_context"}


def _membership_checks(tables: dict, revision_rules: dict) -> list[str]:
    out = []
    for name,child in tables.items():
        active = _selected(child,"child","g",tables,revision_rules)
        if active is None:
            continue
        for fk in child["foreign_keys"]:
            parent = tables[fk["references"]["table"]]
            if parent["write_mode"] != "immutable_values_close_interval_once":
                continue
            # A profile URL deliberately identifies an exact retained observation.
            # Its composite (profile id, player id) FK enforces identity ownership.
            if name == "ingest.public_aliases" and parent["qualified_name"] == "football.player_profile_versions":
                continue
            refs = fk["references"]["columns"]
            joins = " AND ".join(f"{_field('anchor',p)} = {_field('child',c)}" for c,p in zip(fk["columns"],refs))
            present = " AND ".join(f"{_field('child',c)} IS NOT NULL" for c in fk["columns"])
            logical = parent["versioning"]["logical_key"]
            structural = sorted(_MEMBERSHIP.intersection(parent["columns"]))
            match = _equal("selected_parent","anchor",list(dict.fromkeys(logical+structural)))
            query = (f"SELECT 1 FROM {_relation(name)} child JOIN {_relation(parent['qualified_name'])} anchor ON {joins} "
                     f"WHERE {active} AND {present} AND NOT EXISTS (SELECT 1 FROM {_relation(parent['qualified_name'])} selected_parent "
                     f"WHERE {_at(parent,'selected_parent','g')} AND {match})")
            out.append(_assertion(query,f"Selected parent membership differs at generation: {name} / {fk['name']}"))
    return out


def _collection_checks(tables: dict) -> list[str]:
    out = []
    coverage = tables.get("ingest.match_coverage")
    if coverage:
        out.append(_assertion("""SELECT 1 FROM ingest.match_coverage fresh WHERE fresh.recorded_from_gen=g AND fresh.is_canonical
            AND fresh.coverage_state IN ('failed','invalid','pending','not_requested')""",
                              "A failed or partial request cannot become an accepted canonical collection"))
        out.append(_assertion("""SELECT 1 FROM ingest.match_coverage fresh JOIN ingest.match_coverage prior
            ON prior.match_id=fresh.match_id AND prior.feature_code=fresh.feature_code AND prior.recorded_to_gen=g AND prior.is_canonical
            WHERE fresh.recorded_from_gen=g AND fresh.is_canonical AND fresh.collection_state IN ('absent','unavailable')
            AND prior.collection_state IN ('present','empty')""", "An absent/unavailable request cannot clear an accepted collection"))
        for name in ("football.match_events","football.match_momentum","football.match_h2h_entries"):
            if name not in tables:
                continue
            child = tables[name]
            binding = child["versioning"]["parent_version_binding"]
            feature = {"football.match_events":"events","football.match_momentum":"momentum","football.match_h2h_entries":"h2h"}[name]
            keys = " AND ".join(f"{_field('c',c)} = {_field('p',p)}" for c,p in zip(binding["columns"],binding["references"]["columns"]))
            query = (f"SELECT 1 FROM ingest.match_coverage p WHERE p.recorded_from_gen=g AND p.feature_code={_literal(feature)} "
                     f"AND (SELECT count(*) FROM {_relation(name)} c WHERE {keys}) <> COALESCE(p.observed_row_count,0)")
            out.append(_assertion(query,f"Collection child count differs from its full typed parent: {name}"))
        if "football.shots" in tables:
            shot = tables["football.shots"]
            query = ("SELECT 1 FROM ingest.match_coverage p WHERE " + _at(coverage,"p","g",canonical=False) + " AND p.feature_code='shots' "
                     "AND (SELECT count(*) FROM football.shots s WHERE " + _at(shot,"s","g",canonical=False) +
                     " AND s.match_id=p.match_id AND s.source_id=p.source_id AND s.variant_key=p.variant_key) <> COALESCE(p.observed_row_count,0)")
            out.append(_assertion(query,"Shot count differs from selected source/variant coverage"))
            out.append(_assertion("SELECT 1 FROM football.shots s WHERE " + _at(shot,"s","g") +
                                  " AND NOT EXISTS (SELECT 1 FROM ingest.match_coverage p WHERE " + _at(coverage,"p","g") +
                                  " AND p.feature_code='shots' AND p.match_id=s.match_id AND p.source_id=s.source_id "
                                  "AND p.variant_key=s.variant_key AND p.collection_state='present')", "Canonical shots require the selected complete source/variant family"))
    if "football.match_heatmap_cells" in tables:
        out.append(_assertion("""SELECT 1 FROM football.match_heatmap_cells c JOIN football.match_heatmaps p ON p.id=c.heatmap_id
            WHERE p.recorded_from_gen=g AND (p.cells_state <> 'available' OR c.column_index >= p.grid_columns OR c.row_index >= p.grid_rows)""",
                              "Heatmap cells must be present and bounded by their exact parent grid"))
        out.append(_assertion("""SELECT 1 FROM football.match_heatmaps p WHERE p.recorded_from_gen=g AND p.cells_state='available'
            AND NOT EXISTS (SELECT 1 FROM football.match_heatmap_cells c WHERE c.heatmap_id=p.id)""", "An available heatmap has at least one typed cell"))
    return out


def _participant_checks(tables: dict) -> list[str]:
    if not {"football.matches","football.match_teams"}.issubset(tables):
        return []
    match,teams = tables["football.matches"],tables["football.match_teams"]
    m = _at(match,"m","g")
    t = _at(teams,"t","g")
    out = [_assertion(f"""SELECT 1 FROM football.matches m WHERE {m} AND m.publication_state='published' AND (
        (SELECT count(*) FROM football.match_teams t WHERE t.match_id=m.id AND {t}) <> 2 OR
        NOT EXISTS (SELECT 1 FROM football.match_teams t WHERE t.match_id=m.id AND t.side='home' AND {t}) OR
        NOT EXISTS (SELECT 1 FROM football.match_teams t WHERE t.match_id=m.id AND t.side='away' AND {t}) OR
        EXISTS (SELECT 1 FROM football.match_teams t WHERE t.match_id=m.id AND {t} AND t.team_id IS NULL
            AND (m.status NOT IN ('not_started','postponed','canceled','unknown') OR t.participant_label IS NULL OR btrim(t.participant_label)='')) OR
        (SELECT count(DISTINCT t.team_id) FROM football.match_teams t WHERE t.match_id=m.id AND {t}) <
        (SELECT count(t.team_id) FROM football.match_teams t WHERE t.match_id=m.id AND {t})
    )""","A published match requires two valid, distinct participants")]
    for name in ("football.player_match_stats","football.team_match_stats","football.shots"):
        if name in tables:
            out.append(_assertion(f"SELECT 1 FROM {_relation(name)} f WHERE {_at(tables[name],'f','g')} AND "
                                  f"(SELECT count(*) FROM football.match_teams t WHERE t.match_id=f.match_id AND {t} AND t.team_id IS NOT NULL) <> 2",
                                  f"Accepted facts require two known match teams: {name}"))
    return out


def _cycle_query(source: str, identity: str, parent: str, where: str = "TRUE") -> str:
    return f"""WITH RECURSIVE nodes AS (SELECT {identity} AS id,{parent} AS parent FROM {source} WHERE {where}),
      walk(root,node,path) AS (
        SELECT id,parent,ARRAY[id] FROM nodes WHERE parent IS NOT NULL
        UNION ALL SELECT w.root,n.parent,w.path||n.id FROM walk w JOIN nodes n ON n.id=w.node
          WHERE w.node IS NOT NULL AND NOT w.node=ANY(w.path)
      ) SELECT 1 FROM walk WHERE node=ANY(path)"""


def _context_checks(tables: dict) -> list[str]:
    out = []
    if "football.competition_stages" in tables:
        t = tables["football.competition_stages"]
        out.append(_assertion(_cycle_query("football.competition_stages s","s.id","s.parent_stage_id",_at(t,"s","g")),"Selected competition stages must be acyclic"))
    if {"football.honour_definitions","football.team_honours","football.player_honours"}.issubset(tables):
        honours = tables["football.honour_definitions"]
        for name in ("football.team_honours","football.player_honours"):
            table = tables[name]
            wrong_type = " OR h.honour_type <> 'team'" if name == "football.team_honours" else ""
            query = (f"SELECT 1 FROM {_relation(name)} f JOIN football.honour_definitions h ON h.id=f.honour_id AND {_at(honours,'h','g')} "
                     f"LEFT JOIN football.competition_seasons cs ON cs.id=f.competition_season_id AND {_at(tables['football.competition_seasons'],'cs','g')} "
                     f"WHERE {_at(table,'f','g')} AND ((f.competition_season_id IS NOT NULL AND h.competition_id IS NOT NULL AND cs.competition_id IS DISTINCT FROM h.competition_id){wrong_type})")
            out.append(_assertion(query,f"Honour edition/type disagrees with selected definition: {name}"))
    for name in ("football.team_ranking_entries","football.association_ranking_entries"):
        if name in tables:
            query = f"""SELECT 1 FROM {_relation(name)} e JOIN football.ranking_snapshots s ON s.id=e.snapshot_id
              JOIN ingest.source_records r ON r.id=e.source_record_id WHERE s.recorded_from_gen=g AND NOT EXISTS (
                WITH RECURSIVE documents(id) AS (SELECT s.source_document_id UNION
                  SELECT l.parent_document_id FROM ingest.document_lineage l JOIN documents d ON l.derived_document_id=d.id)
                SELECT 1 FROM documents WHERE id=r.document_id)"""
            out.append(_assertion(query,f"Ranking entry source record requires the snapshot document or declared ancestor lineage: {name}"))
    return out


def _graph_triggers(tables: dict) -> list[str]:
    checks = []
    for name,identity,parent in (("ingest.sources","s.id","s.upstream_source_id"),("ingest.document_lineage","s.derived_document_id","s.parent_document_id")):
        if name in tables:
            checks.append(_assertion(_cycle_query(_relation(name)+" s",identity,parent),f"Acyclic provenance required: {name}"))
    if not checks:
        return []
    out = [_guard_function("ingest.pro_graph_lock","    PERFORM pg_advisory_xact_lock(20261104,1);\n    IF TG_OP='DELETE' THEN RETURN OLD; END IF;\n    RETURN NEW;"),
           _guard_function("ingest.pro_graph_commit","\n".join(checks)+"\n    RETURN NULL;")]
    for name in ("ingest.sources","ingest.document_lineage"):
        if name in tables:
            out += [_trigger(name,"ingest.pro_graph_lock",name="pro_graph_lock"),
                    _trigger(name,"ingest.pro_graph_commit",name="pro_graph_commit",event="AFTER INSERT OR UPDATE OR DELETE",deferred=True)]
    return out


def _source_document_sql(tables: dict) -> list[str]:
    if "ingest.source_documents" not in tables:
        return []
    table = tables["ingest.source_documents"]
    stable = [column for column in table["columns"] if column not in {"retention_state","content_verified_at","deleted_at"}]
    body = f"""    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Source receipt metadata cannot be deleted';
    END IF;
    IF {_row('NEW',stable)} IS DISTINCT FROM {_row('OLD',stable)} THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Source receipt content, request and provenance metadata are immutable';
    END IF;
    IF OLD.content_verified_at IS NOT NULL AND NEW.content_verified_at IS DISTINCT FROM OLD.content_verified_at THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A source content verification timestamp is set once';
    END IF;
    IF OLD.retention_state='deleted' AND ROW(NEW.retention_state,NEW.content_verified_at,NEW.deleted_at)
        IS DISTINCT FROM ROW(OLD.retention_state,OLD.content_verified_at,OLD.deleted_at) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Deleted legacy receipt metadata is immutable';
    END IF;
    IF NEW.retention_state=OLD.retention_state THEN
        IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A deletion timestamp is bound to its audited retention transition';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.origin_kind<>'legacy_file' OR NOT ((OLD.retention_state='staged' AND NEW.retention_state='reconciled')
        OR (OLD.retention_state='reconciled' AND NEW.retention_state='deleted')) OR NEW.content_verified_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Only verified forward legacy retention transitions are allowed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ingest.document_reconciliations d JOIN ingest.reconciliation_runs r ON r.id=d.run_id
        WHERE d.document_id=OLD.id AND r.status='accepted' AND r.finished_at IS NOT NULL
          AND r.missing_records=0 AND r.different_fields=0 AND r.unverified_records=0
          AND d.status='accepted' AND d.records_expected=d.records_linked AND d.unmapped_fields=0 AND d.mismatches=0
          AND d.semantic_sha256 ~ '^[0-9a-f]{{64}}$') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Legacy retention requires its accepted document reconciliation audit';
    END IF;
    IF NEW.retention_state='deleted' AND NOT EXISTS (
        SELECT 1 FROM ingest.cleanup_items c JOIN ingest.document_reconciliations d
          ON d.run_id=c.reconciliation_run_id AND d.document_id=c.document_id
        JOIN ingest.reconciliation_runs r ON r.id=c.reconciliation_run_id
        WHERE c.document_id=OLD.id AND r.status='accepted' AND r.finished_at IS NOT NULL
          AND r.missing_records=0 AND r.different_fields=0 AND r.unverified_records=0
          AND d.status='accepted' AND d.records_expected=d.records_linked AND d.unmapped_fields=0 AND d.mismatches=0
          AND d.semantic_sha256 ~ '^[0-9a-f]{{64}}$' AND c.status IN ('deleted','verified')
          AND c.deleted_at=NEW.deleted_at AND c.verified_at IS NOT NULL AND c.verified_at>=c.deleted_at
          AND c.storage_version IS NOT DISTINCT FROM OLD.storage_version
          AND (OLD.byte_length IS NULL OR c.bytes_before=OLD.byte_length) AND btrim(c.reason)<>''
    ) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A deleted legacy receipt requires its verified cleanup audit';
    END IF;
    RETURN NEW;"""
    return [_guard_function("ingest.pro_guard_source_documents",body),
            _trigger("ingest.source_documents","ingest.pro_guard_source_documents",event="BEFORE UPDATE OR DELETE")]


def _build_sql(tables: dict) -> list[str]:
    if "analytics.aggregation_builds" not in tables:
        return []
    matches, sides, players = (tables[name] for name in ("football.matches","football.match_teams","football.match_players"))
    m, side, player = _at(matches,"m","g"),_at(sides,"t","g"),_at(players,"p","g")
    published = f"m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND {m}"
    checks = [_assertion(f"""SELECT 1 FROM analytics.match_summary q
      LEFT JOIN football.matches m ON m.id=q.match_id AND {m}
      LEFT JOIN football.match_teams h ON h.match_id=m.id AND h.side='home' AND {_at(sides,'h','g')}
      LEFT JOIN football.match_teams a ON a.match_id=m.id AND a.side='away' AND {_at(sides,'a','g')}
      WHERE q.build_id=b.id AND (m.id IS NULL OR m.competition_season_id<>b.competition_season_id OR m.publication_state<>'published'
        OR q.competition_season_id<>b.competition_season_id OR q.status IS DISTINCT FROM m.status
        OR q.match_date IS DISTINCT FROM m.match_date OR q.kickoff_at IS DISTINCT FROM m.kickoff_at
        OR q.home_team_id IS DISTINCT FROM h.team_id OR q.away_team_id IS DISTINCT FROM a.team_id
        OR q.home_label IS DISTINCT FROM h.participant_label OR q.away_label IS DISTINCT FROM a.participant_label)""",
                         "Build match summaries must match selected edition, status and participants at its dataset snapshot"),
              _assertion(f"""SELECT 1 FROM football.matches m WHERE {published} AND NOT EXISTS
                (SELECT 1 FROM analytics.match_summary q WHERE q.build_id=b.id AND q.match_id=m.id)""",
                         "A ready build must cover every selected published match in its edition"),
              _assertion("SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM analytics.competition_summary q WHERE q.build_id=b.id AND q.competition_season_id=b.competition_season_id)",
                         "A ready build requires its edition summary")]
    if "football.match_scores" in tables:
        scores = tables["football.match_scores"]
        checks.append(_assertion(f"""SELECT 1 FROM analytics.match_summary q WHERE q.build_id=b.id AND (
          q.home_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='home' AND s.score_scope=q.score_scope AND {_at(scores,'s','g')}) OR
          q.away_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='away' AND s.score_scope=q.score_scope AND {_at(scores,'s','g')}) OR
          q.home_shootout_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='home' AND s.score_scope='shootout' AND {_at(scores,'s','g')}) OR
          q.away_shootout_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='away' AND s.score_scope='shootout' AND {_at(scores,'s','g')})
        )""", "Build scores must match selected typed scores at its dataset snapshot"))
    engagements = tables["football.competition_teams"]
    engagement = _at(engagements,"engagement","g")
    checks.append(_assertion(f"""SELECT 1 FROM football.match_teams t JOIN football.matches m ON m.id=t.match_id
      WHERE {published} AND {side} AND t.team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM football.competition_teams engagement WHERE engagement.competition_season_id=b.competition_season_id
          AND engagement.team_id=t.team_id AND {engagement})""",
                             "A ready build requires each selected participant's explicit edition engagement"))
    checks.append(_assertion(f"""SELECT 1 FROM analytics.competition_summary q WHERE q.build_id=b.id AND (
        (q.matches_count IS NOT NULL AND q.matches_count<>(SELECT count(*) FROM football.matches m WHERE {published})) OR
        (q.finished_matches_count IS NOT NULL AND q.finished_matches_count<>(SELECT count(*) FROM football.matches m WHERE {published} AND m.status='finished')) OR
        (q.teams_count IS NOT NULL AND q.teams_count<>(SELECT count(*) FROM football.competition_teams engagement WHERE engagement.competition_season_id=b.competition_season_id AND {engagement})) OR
        (q.players_count IS NOT NULL AND q.players_count<>(SELECT count(DISTINCT p.player_id) FROM football.match_players p JOIN football.matches m ON m.id=p.match_id WHERE {published} AND {player}))
    )""", "Build summary counters must match the selected edition inputs"))
    for name in ("analytics.player_competition_team_stats","analytics.player_competition_stats","analytics.team_competition_stats"):
        if name not in tables:
            continue
        table = tables[name]
        if "player_id" in table["columns"]:
            member = " AND p.player_id=q.player_id" + (" AND p.team_id=q.team_id" if "team_id" in table["columns"] else "")
            membership = f"SELECT 1 FROM football.match_players p JOIN football.matches m ON m.id=p.match_id WHERE {published} AND {player}{member}"
        else:
            membership = f"SELECT 1 FROM football.match_teams t JOIN football.matches m ON m.id=t.match_id WHERE {published} AND {side} AND t.team_id=q.team_id"
        checks.append(_assertion(f"SELECT 1 FROM {_relation(name)} q WHERE q.build_id=b.id AND "
                                 f"(q.competition_season_id<>b.competition_season_id OR NOT EXISTS ({membership}))",
                                 f"Build output membership must match its edition snapshot: {name}"))
    if "analytics.metric_totals" in tables:
        checks.append(_assertion(f"""SELECT 1 FROM analytics.metric_totals q WHERE q.build_id=b.id AND q.match_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM football.matches m WHERE m.id=q.match_id AND {published})""", "Metric totals cannot reference a match outside their build snapshot"))
    body = """DECLARE b analytics.aggregation_builds%ROWTYPE; g bigint;
BEGIN
    SELECT * INTO b FROM analytics.aggregation_builds WHERE id=build_key FOR UPDATE;
    IF b.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown typed aggregation build'; END IF;
    SELECT generation INTO g FROM ingest.dataset_snapshots WHERE id=b.dataset_snapshot_id AND status='sealed';
    IF g IS NULL OR NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots WHERE id=b.catalog_snapshot_id AND status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Aggregation requires sealed dataset and catalogue snapshots';
    END IF;
""" + "\n".join(checks) + "\nEND;"
    out = [_function("ingest.validate_aggregation_build","build_key bigint","void",body)]
    build_body = """    IF TG_OP='DELETE' THEN
        IF OLD.status='ready' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A ready build is immutable'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP='UPDATE' AND OLD.status='ready' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A ready build is immutable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.id=NEW.dataset_snapshot_id AND s.status='sealed')
       OR NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.id=NEW.catalog_snapshot_id AND s.status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A build uses only sealed dataset and catalogue snapshots';
    END IF;
    IF btrim(NEW.representation_version)='' OR btrim(NEW.code_commit)='' OR btrim(NEW.transform_version)='' OR btrim(NEW.metrics_contract_version)='' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build code, representation and numeric contracts must be bound';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM football.competition_seasons selected JOIN football.competition_seasons anchor
      ON anchor.id=NEW.competition_season_id AND anchor.revision_id=NEW.competition_season_revision_id
      JOIN ingest.dataset_snapshots s ON s.id=NEW.dataset_snapshot_id
      WHERE selected.id=anchor.id AND selected.competition_id=anchor.competition_id
        AND ingest.selected_at(s.generation,selected.recorded_from_gen,selected.recorded_to_gen) AND selected.is_canonical AND NOT selected.is_deleted) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build edition anchor must agree with the selected snapshot edition';
    END IF;
    RETURN NEW;"""
    out += [_guard_function("ingest.pro_guard_aggregation_builds",build_body),
            _trigger("analytics.aggregation_builds","ingest.pro_guard_aggregation_builds"),
            _guard_function("ingest.pro_validate_ready_build","""    IF NEW.status='ready' THEN
        IF NEW.finished_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A ready build requires its completion timestamp'; END IF;
        PERFORM ingest.validate_aggregation_build(NEW.id);
    END IF;
    RETURN NULL;"""),
            _trigger("analytics.aggregation_builds","ingest.pro_validate_ready_build",name="pro_ready_build",event="AFTER INSERT OR UPDATE",deferred=True)]
    for name,table in tables.items():
        if table["write_mode"] != "derived_immutable_per_build":
            continue
        function = "ingest.pro_guard_" + name.replace(".","_")
        body = """DECLARE parent_status text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        SELECT status INTO parent_status FROM analytics.aggregation_builds WHERE id=OLD.build_id FOR UPDATE;
        IF parent_status='ready' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Ready build outputs are immutable'; END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        SELECT status INTO parent_status FROM analytics.aggregation_builds WHERE id=NEW.build_id FOR UPDATE;
        IF parent_status IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact aggregation build'; END IF;
        IF parent_status='ready' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Ready build outputs are immutable'; END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;"""
        out += [_function(function,"","trigger",body),_trigger(name,function)]
    if "analytics.catalog_publication" in tables:
        out += [_guard_function("ingest.pro_guard_catalog_publication","""    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF btrim(NEW.representation_version)='' OR NOT EXISTS
      (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.id=NEW.catalog_snapshot_id AND s.status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A catalogue publication requires a sealed snapshot and representation';
    END IF;
    RETURN NEW;"""),_trigger("analytics.catalog_publication","ingest.pro_guard_catalog_publication")]
    if "ingest.dataset_snapshot_documents" in tables:
        out += [_function("ingest.pro_guard_snapshot_documents","","trigger","""DECLARE g bigint;
BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Snapshot document inputs are immutable'; END IF;
    SELECT generation INTO g FROM ingest.dataset_snapshots WHERE id=NEW.snapshot_id;
    IF g IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact dataset snapshot'; END IF;
    PERFORM ingest.assert_draft_generation(g);
    RETURN NEW;
END;"""),_trigger("ingest.dataset_snapshot_documents","ingest.pro_guard_snapshot_documents")]
    return out


def _queue_sql(tables: dict) -> list[str]:
    if "ingest.collection_jobs" not in tables:
        return []
    return [_function("ingest.claim_collection_job","worker text, lease_seconds integer","SETOF ingest.collection_jobs","""BEGIN
    IF worker IS NULL OR btrim(worker)='' OR lease_seconds IS NULL OR lease_seconds<=0 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A queue claim requires its worker and positive lease duration';
    END IF;
    RETURN QUERY
      WITH candidate AS (
        SELECT source_id,endpoint,params FROM ingest.collection_jobs
        WHERE ((state='pending' AND available_at<=statement_timestamp())
          OR (state='running' AND lease_expires_at<=statement_timestamp())) AND attempts<2147483647
        ORDER BY priority,available_at,source_id,endpoint,params LIMIT 1 FOR UPDATE SKIP LOCKED
      ) UPDATE ingest.collection_jobs job
        SET state='running',attempts=job.attempts+1,lease_owner=worker,
            lease_expires_at=statement_timestamp()+make_interval(secs=>lease_seconds)
        FROM candidate WHERE (job.source_id,job.endpoint,job.params)=(candidate.source_id,candidate.endpoint,candidate.params)
        RETURNING job.*;
END;"""),
            _function("ingest.complete_collection_job","source_key bigint, endpoint_key text, params_key text, worker text, target_state text, claimed_attempt integer","void","""BEGIN
    IF target_state IS NULL OR target_state NOT IN ('pending','done','unavailable') OR claimed_attempt IS NULL OR claimed_attempt<=0 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A queue completion requires its target state and claimed attempt';
    END IF;
    UPDATE ingest.collection_jobs job SET state=target_state,lease_owner=NULL,lease_expires_at=NULL
      WHERE job.source_id=source_key AND job.endpoint=endpoint_key AND job.params=params_key
        AND job.state='running' AND job.lease_owner=worker AND job.attempts=claimed_attempt
        AND job.lease_expires_at>statement_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Queue lease ownership, attempt or expiry no longer matches'; END IF;
END;""")]


def role_grants_sql(model: dict, ingest_role: str, runtime_role: str, *, build_role: str | None = None) -> str:
    """Return grants for caller-owned roles; create no roles and trust no session flag.

    A separate build role can be bound by a deployment. The local two-role pilot
    uses the ingest role for its typed ingestion/build workflow, never the web role.
    """
    writer,reader,builder = _ident(ingest_role),_ident(runtime_role),_ident(build_role or ingest_role)
    if ingest_role == runtime_role or (build_role is not None and build_role == runtime_role):
        raise ValueError("The web reader must be distinct from typed writers")
    tables = {table["qualified_name"]:table for schema in model["schemas"] for table in schema["tables"] if table["phase"]!='models'}
    out = []
    for schema in ("ingest","football","analytics"):
        quoted = _ident(schema)
        out += [f"REVOKE ALL ON SCHEMA {quoted} FROM PUBLIC;",f"GRANT USAGE ON SCHEMA {quoted} TO {writer}, {reader};",
                f"REVOKE ALL ON ALL TABLES IN SCHEMA {quoted} FROM {writer}, {reader};",
                f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA {quoted} FROM {writer}, {reader};",
                f"REVOKE ALL ON ALL FUNCTIONS IN SCHEMA {quoted} FROM PUBLIC, {reader};",
                f"GRANT SELECT ON ALL TABLES IN SCHEMA {quoted} TO {writer}, {reader};",
                f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA {quoted} TO {writer};"]
        if build_role is not None:
            out += [f"GRANT USAGE ON SCHEMA {quoted} TO {builder};",f"GRANT SELECT ON ALL TABLES IN SCHEMA {quoted} TO {builder};",
                    f"GRANT USAGE ON ALL SEQUENCES IN SCHEMA {quoted} TO {builder};"]
    out += [f"REVOKE ALL ON SEQUENCE ingest.commit_generation_seq FROM PUBLIC, {writer}, {reader}, {builder};"]
    for name,table in tables.items():
        if name in {"ingest.dataset_snapshots","ingest.schema_migrations"}:
            continue
        target = builder if name.startswith("analytics.") else writer
        # Queue updates are only exposed by owner/attempt/expiry-fenced helpers.
        if name == "ingest.collection_jobs":
            out.append(f"GRANT INSERT ON {_relation(name)} TO {target};")
        elif table["write_mode"] == "immutable_content_metadata_with_audited_retention_transition":
            out += [f"GRANT INSERT ON {_relation(name)} TO {target};",
                    f"GRANT UPDATE (retention_state, content_verified_at, deleted_at) ON {_relation(name)} TO {target};"]
        elif table["write_mode"] == "immutable_values_close_interval_once":
            _,end = _interval(table)
            out += [f"GRANT INSERT ON {_relation(name)} TO {target};",f"GRANT UPDATE ({_ident(end)}) ON {_relation(name)} TO {target};"]
        elif table["write_mode"] in {"append_only","immutable_with_parent","immutable_after_snapshot_seal"}:
            out.append(f"GRANT INSERT ON {_relation(name)} TO {target};")
        else:
            out.append(f"GRANT INSERT, UPDATE ON {_relation(name)} TO {target};")
    for signature in ("ingest.begin_generation(text,text,text,timestamptz)","ingest.seal_generation(bigint,text)","ingest.validate_generation(bigint)"):
        out += [f"GRANT EXECUTE ON FUNCTION {signature} TO {writer};"]
        if build_role is not None:
            out.append(f"GRANT EXECUTE ON FUNCTION {signature} TO {builder};")
    out += [f"GRANT EXECUTE ON FUNCTION ingest.selected_at(bigint,bigint,bigint) TO {writer}, {reader}, {builder};",
            f"GRANT EXECUTE ON FUNCTION ingest.claim_collection_job(text,integer) TO {writer};",
            f"GRANT EXECUTE ON FUNCTION ingest.complete_collection_job(bigint,text,text,text,text,integer) TO {writer};"]
    return "\n".join(out) + "\n"


def _validate_generation_sql(model: dict, tables: dict) -> str:
    rules = model["selective_versioning"].get("append_only_revision_rules",{})
    xid = "((pg_current_xact_id()::text::numeric % 4294967296)::text)"
    checks = []
    for table in tables.values():
        if table["write_mode"] == "immutable_values_close_interval_once":
            checks += _overlap_checks(table)
            checks.append(_no_op_check(table,tables))
    checks += _membership_checks(tables,rules)
    checks += _participant_checks(tables)
    checks += _collection_checks(tables)
    checks += _context_checks(tables)
    body = f"""BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.generation=g AND s.status IN ('draft','sealed') AND s.xmin::text={xid}) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Validation requires this transaction generation receipt';
    END IF;
""" + "\n".join(checks) + "\nEND;"
    return _function("ingest.validate_generation","g bigint","void",body)


def integrity_sql(model: dict, active_tables) -> str:
    """Return SQL only; the caller creates tables first and owns its transaction."""
    tables = _table_map(model,active_tables)
    rules = model["selective_versioning"].get("append_only_revision_rules",{})
    out = ["-- Typed selective-inline integrity; no payload copies or universal row registry."]
    out += _generation_sql(tables)
    for name,table in tables.items():
        if table["write_mode"] == "immutable_values_close_interval_once":
            out += _version_guard(table)
        elif table["write_mode"] in {"append_only","immutable_with_parent"}:
            out += _retained_insert_guard(table,tables,rules)
    out += _graph_triggers(tables)
    out += _source_document_sql(tables)
    out += _build_sql(tables)
    out += _queue_sql(tables)
    out.append(_validate_generation_sql(model,tables))
    return "\n\n".join(out) + "\n"
