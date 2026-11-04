"""Build a REVIEW-ONLY blueprint from the untouched user JSON. Never connects to DB."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

OUT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--fixture-phase", choices=("before_constraints", "before_versions"))
parser.add_argument("--output", type=Path, help="Explicit temporary fixture destination; never overwrites the published model")
args = parser.parse_args()
if bool(args.fixture_phase) != bool(args.output):
    parser.error("--fixture-phase and --output must be supplied together")
if args.output and (args.output.resolve() == OUT or OUT in args.output.resolve().parents):
    parser.error("A fixture destination must be outside the review folder")

def write_fixture():
    body = json.dumps(proposal, indent=2, ensure_ascii=False) + "\n"
    args.output.write_text(body)
    print(json.dumps({"fixture_phase": args.fixture_phase, "sha256": hashlib.sha256(body.encode()).hexdigest(), "tables": sum(len(s["tables"]) for s in proposal["schemas"]), "scope": "Pre-transform in-memory fixture only; published artifacts and services unchanged."}))

original = json.loads((OUT / "inputs/Orion_schema_bdd.original.json").read_text())
proposal = copy.deepcopy(original)
proposal.update(status="proposal_awaiting_user_approval", title="StatArena — proposition Orion adaptée à AWS", format_version="1.1.0-proposed")
proposal["validation"] = {"implementation": "not_performed", "migrations": "not_created_or_applied", "user_approval": "required_before_reorganization"}
proposal["database"].update(provider="AWS RDS", existing_database="statarena_prod", project_name="StatArena", observed_engine_version="18.6", target_major_version=18)
proposal["database"]["object_storage"] = {"existing_bucket": "statarena-football-333rosky-70db6e5f", "permanent_purpose": ["referenced_essential_media"], "temporary_purpose": ["EXISTING legacy sources only, pending reconciliation and deletion"], "new_pitchapi_data": "response in memory -> typed RDS transaction; never S3, never raw response document in SQL", "structured_sources": "delete_existing_sources_after_complete_reconciliation; prohibit new structured file writes", "code_release_bucket": "deployment artifacts, outside football source retention"}
proposal["database"]["existing_schemas_preserved"] = ["statarena and statarena_app temporarily until accepted replacement", "neon_auth pending usage verification"]
proposal["conventions"].update(nulls="SQL NULL is supplemented by registered field states to distinguish absent, explicit null, empty string, native type and unavailable observations. Zero remains an observed value.", provenance="Source/record identifiers and hashes are metadata only. No separate history table or hidden replacement store. Policy for prior corrected values remains to be chosen.", revisions="No separate history tables. A revision hash does not retain prior values; snapshot reproducibility awaits the explicit version-retention policy.", jsonb="Only listed bounded technical configuration, quality annotations and deferred model vectors. No sports facts or archived source bodies.")
tables = {t["qualified_name"]: t for s in proposal["schemas"] for t in s["tables"]}
changes = []


def short(name):
    return name if len(name) <= 63 else name[:52] + "_" + hashlib.sha256(name.encode()).hexdigest()[:10]


def col(kind, description, nullable=True, **kw):
    return dict(type=kind, nullable=nullable, description=description, **kw)


def add(table, name, value, reason):
    old = table["columns"].get(name)
    table["columns"][name] = value
    changes.append(dict(table=table["qualified_name"], operation="add_column" if old is None else "change_column", column=name, before=old, after=value, reason=reason))


def remove(table, name, reason):
    if name not in table["columns"]:
        return
    old = table["columns"].pop(name)
    table["checks"] = [c for c in table["checks"] if not re.search(r"\b" + re.escape(name) + r"\b", c["sql"])]
    changes.append(dict(table=table["qualified_name"], operation="remove_column", column=name, before=old, reason=reason))


def check(table, expression, label):
    table["checks"].append({"name": short(table["qualified_name"].replace(".", "_") + "_" + label + "_ck"), "sql": expression})


def fk(table, columns, parent, parent_columns, on_delete="RESTRICT"):
    table["foreign_keys"].append(dict(name=short(table["qualified_name"].replace(".", "_") + "_" + "_".join(columns) + "_fk"), columns=columns, references=dict(table=parent, columns=parent_columns), match="SIMPLE", on_delete=on_delete, on_update="NO ACTION", deferrable=False))


def unique(table, columns, label, nulls=False):
    table["unique_constraints"].append(dict(name=short(table["qualified_name"].replace(".", "_") + "_" + label + "_uq"), columns=columns, nulls_not_distinct=nulls))


def new(name, description, grain, columns, pk, phase="core", write="mutable", reason="Targeted extension of supplied model"):
    schema, simple = name.split(".")
    table = dict(name=simple, qualified_name=name, phase=phase, description=description, grain=grain, write_mode=write, columns=columns,
                 primary_key=dict(name=short(schema + "_" + simple + "_pk"), columns=pk), unique_constraints=[], foreign_keys=[], checks=[], indexes=[])
    next(s for s in proposal["schemas"] if s["name"] == schema)["tables"].append(table)
    tables[name] = table
    changes.append(dict(table=name, operation="add_table", reason=reason))
    return table


def identity():
    return col("bigint", "Identifiant interne de la ligne, jamais substitué aux identifiants publics existants.", False, identity="GENERATED ALWAYS AS IDENTITY")


for name, field in (("football.players", "display_name"), ("football.teams", "name"), ("football.coaches", "display_name"), ("football.competitions", "name"), ("football.venues", "name")):
    add(tables[name], field, col("text", "Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif."), "Préserver une identité connue même lorsque le libellé source est absent")


# Permanent metadata can describe deleted files; bytes and access are not required.
t = tables["ingest.source_documents"]
t["description"] = "Reçu d’observation HTTP directe ou métadonnées d’un ancien artefact source ; jamais le contenu d’une réponse ou d’un fichier."
t["write_mode"] = "immutable_content_metadata_with_audited_retention_transition"
for name in ("storage_bucket", "storage_key"):
    add(t, name, col("text", "Ancien emplacement à titre de provenance ; ne constitue pas une dépendance de lecture.", True), "Suppression finale des fichiers autorisée après réconciliation complète")
add(t, "storage_provider", col("text", "http_direct pour les nouvelles collectes sans fichier ; aws_s3 uniquement pour les sources historiques déjà présentes.", False, default_sql="'http_direct'"), "Les nouvelles données PitchAPI sont normalisées directement dans RDS")
add(t, "origin_kind", col("text", "http_response directe ou legacy_file déjà existant.", False, default_sql="'http_response'"), "Séparer reçu HTTP sans fichier et provenance des anciens fichiers")
remove(t, "immutable_reference", "Une référence à un fichier supprimé ne doit plus promettre sa disponibilité")
add(t, "content_verified_at", col("timestamptz", "Date de la dernière vérification effective des octets avant suppression."), "Conserver la preuve sans inventer un accès futur")
add(t, "retention_state", col("text", "not_stored pour une nouvelle réponse HTTP ; staged/reconciled/deleted uniquement pour un ancien fichier.", False, default_sql="'not_stored'"), "Aucune nouvelle réponse structurée stockée comme fichier ou document")
add(t, "deleted_at", col("timestamptz", "Suppression vérifiée de l’original et des copies recensées."), "Traçabilité du nettoyage")
check(t, "retention_state IN ('not_stored','staged','reconciled','deleted')", "retention_state")
check(t, "(origin_kind='http_response' AND storage_provider='http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND retention_state='not_stored') OR (origin_kind='legacy_file' AND retention_state IN ('staged','reconciled','deleted'))", "direct_ingestion_no_file")
check(t, "(retention_state='deleted') = (deleted_at IS NOT NULL)", "deleted_metadata")
t["notes"] = ["Aucun body, payload ou contenu métier JSONB. Une nouvelle collecte ne crée ni clé S3 ni fichier temporaire de données ; la réponse est décodée en mémoire puis écrite dans ses tables typées.", "Les anciennes coordonnées de stockage sont seulement des métadonnées. Leur conservation temporaire s’applique aux fichiers déjà présents, pas aux nouveaux appels PitchAPI.", "Le scellement dépend de faits SQL typés immuables ; aucun contrôle n’exige des octets encore accessibles après purge."]
t = tables["ingest.source_records"]
t["description"] = "Métadonnées d’observation et correspondance vers les faits SQL conservés ; ancien localisateur sans dépendance à des octets supprimés."
t["columns"]["locator_kind"]["allowed_values"] += ["csv_row", "sqlite_row"]
for c in t["checks"]:
    if c["name"].endswith("locator_kind_ck"):
        c["sql"] = "locator_kind IN ('json_pointer','jsonl_line','array_ordinal','archive_member','whole_document','csv_row','sqlite_row')"
for name in ("ingest.dataset_snapshots", "ingest.dataset_snapshot_documents"):
    t = tables[name]
    remove(t, "selection_manifest" if name.endswith("dataset_snapshots") else "selection", "Sélection des faits exprimée par dataset_snapshot_rows et des références SQL")
    t["description"] = "Manifeste de publication SQL et de provenance ; aucune ancienne valeur conservée par ce manifeste seul." if name.endswith("dataset_snapshots") else "Provenance des documents ayant contribué à un instantané SQL ; aucun fichier requis après purge."

# Technical revision metadata only; never prior business-row copies.
t = new("ingest.relation_contracts", "Catalogue des relations métier et de leurs grains autorisés.", "Une relation enregistrée.", {
    "relation_code": col("text", "Nom SQL qualifié autorisé, stable dans une version du contrat.", False),
    "relation_name": col("text", "Relation métier concernée ; aucune table sœur history.", False),
    "contract_version": col("text", "Version du contrat de colonnes, clés et sémantique.", False),
    "grain_definition": col("text", "Définition explicite de la clé logique.", False)}, ["relation_code"], write="append_only")
t = new("ingest.row_versions", "Registre technique de révisions et de provenance ; ne contient aucune ancienne valeur métier.", "Relation × clé logique × numéro de révision.", {
    "id": identity(), "relation_code": col("text", "Relation métier concernée.", False),
    "logical_key": col("text", "Encodage canonique des colonnes de clé ; aucun document source.", False),
    "revision_no": col("bigint", "Révision croissante de cette clé logique.", False),
    "source_record_id": col("bigint", "Observation source, si fournisseur ; nullable pour référentiel manuel documenté."),
    "provenance_kind": col("text", "provider, derived ou manual ; contexte obligatoire pour une valeur manuelle.", False),
    "transform_version": col("text", "Version du code de normalisation.", False),
    "content_sha256": col("text", "Hash sémantique de la ligne typée, de ses états et des enfants référencés.", False),
    "recorded_at": col("timestamptz", "Instant d’enregistrement de cette version SQL.", False, default_sql="CURRENT_TIMESTAMP"),
    "is_tombstone": col("boolean", "Marqueur de retrait logique ; ne conserve aucune ancienne valeur métier.", False, default_sql="false")}, ["id"], write="append_only", reason="Provenance et révisions techniques, sans promettre de reconstruction de valeurs remplacées")
fk(t, ["relation_code"], "ingest.relation_contracts", ["relation_code"])
fk(t, ["source_record_id"], "ingest.source_records", ["id"])
unique(t, ["relation_code", "logical_key", "revision_no"], "logical_revision")
unique(t, ["id", "relation_code", "logical_key"], "version_binding")
unique(t, ["id", "relation_code"], "relation_binding")
check(t, "revision_no > 0 AND content_sha256 ~ '^[0-9a-f]{64}$'", "revision_hash")
check(t, "provenance_kind IN ('provider','derived','manual')", "provenance_kind")
t = new("ingest.dataset_snapshot_rows", "Sélection de clés et révisions dans un manifeste ; conservation des anciennes valeurs à trancher.", "Instantané × relation × clé logique.", {
    "snapshot_id": col("bigint", "Instantané qui sélectionne cette valeur.", False),
    "relation_code": col("text", "Relation métier sélectionnée.", False),
    "logical_key": col("text", "Clé métier de la ligne sélectionnée.", False),
    "row_version_id": col("bigint", "Identifiant de révision sélectionné ; son hash ne constitue pas une copie des valeurs.", False)}, ["snapshot_id", "relation_code", "logical_key"], write="immutable_after_snapshot_seal")
fk(t, ["snapshot_id"], "ingest.dataset_snapshots", ["id"])
fk(t, ["row_version_id", "relation_code", "logical_key"], "ingest.row_versions", ["id", "relation_code", "logical_key"])
t = new("ingest.field_contracts", "Champs sémantiques enregistrés et leur destination ; aucun chemin arbitraire autorisé.", "Relation × code de champ.", {
    "relation_code": col("text", "Relation du fait normalisé.", False), "field_code": col("text", "Code sémantique déclaré, pas une propriété JSON libre.", False),
    "target_column": col("text", "Colonne typée ou relation enfant explicitement correspondante.", False),
    "definition": col("text", "Sens, unité et règle de conservation du champ.", False)}, ["relation_code", "field_code"], write="append_only")
fk(t, ["relation_code"], "ingest.relation_contracts", ["relation_code"])
t = new("ingest.field_states", "États et exceptions scalaires nécessaires pour préserver absent/null/vide/type natif.", "Version de fait × champ enregistré.", {
    "row_version_id": col("bigint", "Version SQL du fait.", False), "relation_code": col("text", "Relation du contrat.", False),
    "field_code": col("text", "Champ sémantique enregistré.", False), "source_state": col("text", "absent, null, number, string, boolean, empty_array ou empty_object.", False),
    "source_text": col("text", "Texte natif uniquement si nécessaire à une conversion, y compris chaîne vide et 07."),
    "source_number": col("numeric", "Valeur numérique native exacte lorsqu’une conversion de type demande sa conservation."),
    "source_boolean": col("boolean", "Booléen natif si la colonne normalisée a un autre type.")}, ["row_version_id", "field_code"], write="append_only")
fk(t, ["row_version_id", "relation_code"], "ingest.row_versions", ["id", "relation_code"])
fk(t, ["relation_code", "field_code"], "ingest.field_contracts", ["relation_code", "field_code"])
check(t, "source_state IN ('absent','null','number','string','boolean','empty_array','empty_object')", "source_state")
check(t, "num_nonnulls(source_text,source_number,source_boolean) <= 1", "scalar_exclusive")
t["notes"] = ["Validation différée : relation_code doit être celui de row_versions ; la valeur scalaire doit correspondre à source_state.", "Objets/arrays complets interdits ; aucun ancien document, sérialisation de sous-arbre ou attribut arbitraire. Les tableaux non vides sont des relations métier."]
t = new("ingest.record_row_links", "Correspondance vérifiable des observations vers toutes leurs représentations métier typées.", "Enregistrement source × version de fait.", {
    "source_record_id": col("bigint", "Observation source concernée.", False), "row_version_id": col("bigint", "Révision de fait liée à cette observation ; ce lien ne stocke pas les anciennes valeurs.", False),
    "mapping_version": col("text", "Version vérifiable de la correspondance des champs.", False)}, ["source_record_id", "row_version_id"], write="append_only")
fk(t, ["source_record_id"], "ingest.source_records", ["id"])
fk(t, ["row_version_id"], "ingest.row_versions", ["id"])
t = new("ingest.reconciliation_runs", "Preuves de complétude et différences entre origines, observations et SQL final.", "Une campagne de rapprochement.", {
    "id": identity(), "status": col("text", "running, failed ou accepted après vérification de tous les périmètres.", False),
    "started_at": col("timestamptz", "Début de campagne.", False), "finished_at": col("timestamptz", "Fin effective de campagne."),
    "catalog_fingerprint": col("text", "Empreinte du catalogue exact attendu au point de coupure.", False),
    "mapping_version": col("text", "Version de l’adaptateur et des règles de comparaison.", False),
    "missing_records": col("bigint", "Nombre d’observations attendues manquantes.", False),
    "different_fields": col("bigint", "Nombre de champs non conformes.", False),
    "unverified_records": col("bigint", "Nombre d’observations non vérifiées.", False)}, ["id"])
check(t, "missing_records >= 0 AND different_fields >= 0 AND unverified_records >= 0", "counts")
check(t, "status IN ('running','failed','accepted')", "status")
t = new("ingest.document_reconciliations", "Couverture exhaustive d’un ancien artefact avant suppression de ses octets.", "Campagne × métadonnée de document.", {
    "run_id": col("bigint", "Campagne de contrôle.", False), "document_id": col("bigint", "Métadonnée d’origine.", False),
    "records_expected": col("bigint", "Nombre de records à représenter.", False), "records_linked": col("bigint", "Records reliés à des faits typés ou métadonnées documentées.", False),
    "unmapped_fields": col("bigint", "Champs utiles sans destination typée.", False), "mismatches": col("bigint", "Valeurs ou états différents après projection inverse définie.", False),
    "status": col("text", "pending, failed ou accepted.", False), "semantic_sha256": col("text", "Hash de comparaison sémantique ; ne restaure pas les octets supprimés." )}, ["run_id", "document_id"])
fk(t, ["run_id"], "ingest.reconciliation_runs", ["id"])
fk(t, ["document_id"], "ingest.source_documents", ["id"])
check(t, "records_expected >= 0 AND records_linked >= 0 AND unmapped_fields >= 0 AND mismatches >= 0", "counts")
t = new("ingest.cleanup_items", "Inventaire des copies physiques supprimées et des vérifications de disparition.", "Campagne × copie physique recensée.", {
    "id": identity(), "reconciliation_run_id": col("bigint", "Campagne acceptée qui autorise ce nettoyage.", False),
    "document_id": col("bigint", "Métadonnée de source ; nullable pour copie technique de dump/ZIP."),
    "storage_kind": col("text", "rds_relation, rds_payload ou s3_object.", False),
    "storage_location": col("text", "Ancienne table/clé exacte ; métadonnée seule.", False),
    "storage_version": col("text", "Version S3 exacte si versioning activé."), "bytes_before": col("bigint", "Volume réel avant suppression.", False),
    "status": col("text", "planned, deleted, verified_absent ou failed.", False), "deleted_at": col("timestamptz", "Suppression effective."),
    "verified_at": col("timestamptz", "Vérification de disparition et absence de dépendance."), "reason": col("text", "Motif et périmètre du nettoyage.", False)}, ["id"])
fk(t, ["reconciliation_run_id"], "ingest.reconciliation_runs", ["id"])
fk(t, ["document_id"], "ingest.source_documents", ["id"])
unique(t, ["reconciliation_run_id", "storage_kind", "storage_location", "storage_version"], "physical_copy", True)

# Preserve the three existing operational responsibilities; migrate, do not clone queues.
t = new("ingest.collection_jobs", "File quotidienne/historique issue de statarena.jobs, avec baux de reprise.", "Source × endpoint × paramètres canoniques.", {
    "source_id": col("bigint", "Fournisseur de la requête.", False), "endpoint": col("text", "Endpoint d’ingestion uniquement.", False),
    "params": col("text", "Paramètres canoniques de la requête ; jamais une réponse fournisseur.", False),
    "priority": col("smallint", "Priorité de traitement.", False), "state": col("text", "État de file, distinct de disponibilité de la donnée.", False),
    "attempts": col("integer", "Tentatives exécutées.", False), "available_at": col("timestamptz", "Prochaine exécution éligible.", False),
    "lease_owner": col("text", "Worker propriétaire du bail courant."), "lease_expires_at": col("timestamptz", "Expiration du bail ; reprise contrôlée après interruption.")}, ["source_id", "endpoint", "params"])
fk(t, ["source_id"], "ingest.sources", ["id"])
t = new("ingest.asset_jobs", "File existante de téléchargement des seuls médias indispensables.", "Une URL de média.", {
    "url": col("text", "URL de collecte du média.", False), "attempts": col("integer", "Tentatives.", False),
    "next_attempt": col("timestamptz", "Prochaine tentative autorisée.", False), "error": col("text", "Dernière erreur opérationnelle." )}, ["url"])
t = new("ingest.dirty_editions", "Éditions affectées par des changements ; remplace dirty_partitions après mapping des identités.", "Une édition métier.", {
    "competition_season_id": col("bigint", "Édition à reconstruire.", False), "generation": col("bigint", "Génération demandée ; protège des pertes d’invalidation.", False),
    "changed_at": col("timestamptz", "Dernière modification pertinente.", False), "reason": col("text", "Origine de l’invalidation.", False)}, ["competition_season_id"])
fk(t, ["competition_season_id"], "football.competition_seasons", ["id"])
t = new("ingest.schema_migrations", "Journal des migrations appliquées et de leurs empreintes ; reprend les versions scellées existantes.", "Une migration versionnée.", {
    "version": col("text", "Nom/version immuable de la migration.", False), "content_sha256": col("text", "Empreinte du SQL effectivement appliqué.", False),
    "applied_at": col("timestamptz", "Date réelle d’application, sans inventer celle des anciens reçus inconnus."),
    "code_commit": col("text", "Commit qui porte cette migration, si connu.")}, ["version"], write="append_only")
check(t, "content_sha256 ~ '^[0-9a-f]{64}$'", "content_hash")

# Typed business additions found in actual existing SQL models and broad source inventories.
t = tables["football.player_profile_versions"]
remove(t, "profile_attributes", "Les attributs réellement présents sont explicitement typés")
for name, kind, description in [
    ("short_name", "text", "Nom court fournisseur."), ("country_code_source", "text", "Code pays natif, distinct d’un ISO déduit."),
    ("raw_position_code", "text", "Code de poste natif avant mapping validé."), ("shirt_number", "text", "Numéro de profil conservé comme texte, y compris chaîne vide."),
    ("birth_date", "date", "Date de naissance observée dans cette version, si disponible."), ("height_cm", "smallint", "Taille observée dans cette version, en centimètres."),
    ("dominant_foot", "text", "Pied dominant observé dans cette version, si disponible.")]:
    add(t, name, col(kind, description), "Conservation du profil sans JSONB métier")
t = tables["football.shots"]
for name, kind, description in [
    ("keeper_id", "bigint", "Gardien associé au tir dans l’observation."), ("blocked_x", "double precision", "Coordonnée du point de blocage, dans le repère source déclaré."),
    ("blocked_y", "double precision", "Seconde coordonnée du point de blocage."), ("is_blocked", "boolean", "Indicateur natif de tir bloqué."),
    ("is_saved_off_line", "boolean", "Indicateur natif de sauvetage sur la ligne."), ("source_shot_type", "text", "Type natif ; aucune confusion automatique avec la partie du corps."),
    ("source_event_type", "text", "Résultat/type natif du tir."), ("source_ordinal", "integer", "Ordre de présentation dans cette version de la famille.")]:
    add(t, name, col(kind, description), "Champs présents dans les anciennes tables et dans l’inventaire de 1 203 718 tirs")
fk(t, ["keeper_id"], "football.players", ["id"])
for name, player_column in (("player_profile_version_id", "player_id"), ("keeper_profile_version_id", "keeper_id")):
    add(t, name, col("bigint", "Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte."), "Conserver le contexte des deux acteurs sans le dupliquer dans un document")
    fk(t, [name, player_column], "football.player_profile_versions", ["id", "player_id"])
check(t, "(blocked_x IS NULL AND blocked_y IS NULL) OR coordinate_frame IS NOT NULL", "blocked_frame")
t = tables["football.match_events"]
remove(t, "extra", "Les faits du flux sont typés ; toute nouvelle propriété bloque sa purge tant qu’elle n’a pas de destination")
for name in ("score_home", "score_away"):
    add(t, name, col("integer", "Score observé après l’événement, sans supposer sa portée si la source ne la donne pas."), "Champ actuel du flux à conserver")
t = tables["football.player_match_advanced"]
remove(t, "sca_breakdown", "Décomposition connue en six colonnes numériques signées selon contrat")
for name in ("pass_live", "pass_dead", "take_on", "shot", "foul_drawn", "defensive"):
    add(t, "sca_" + name, col("double precision", "Contribution SCA de type " + name + ", valeur observée selon la définition fournisseur."), "Décomposition SCA connue dans le code actuel")

for entity in ("player", "team"):
    t = new("football." + entity + "_match_metric_values", "Métriques secondaires enregistrées, avec types, unité et fractions explicites.", "Match × " + entity + " × période × famille standard/advanced × métrique.", {
        "match_id": col("bigint", "Match du fait.", False), entity + "_id": col("bigint", "Identité concernée.", False),
        **({"team_id": col("bigint", "Équipe du joueur dans ce match.", False)} if entity == "player" else {}),
        "period_code": col("text", "Période explicitement définie.", False), "family_code": col("text", "standard ou advanced.", False),
        "metric_code": col("text", "Métrique enregistrée et définie ; aucune clé arbitraire.", False),
        "value_kind": col("text", "number, string ou boolean ; NULL/absence distingués par les états de champ.", False),
        "numeric_value": col("numeric", "Valeur numérique exacte de cette métrique."), "text_value": col("text", "Valeur textuelle si le contrat de métrique l’autorise."),
        "boolean_value": col("boolean", "Valeur booléenne si définie comme telle."), "numerator": col("numeric", "Numérateur fourni, sans le déduire d’un taux arrondi."),
        "denominator": col("numeric", "Dénominateur observé."), "source_display": col("text", "Forme affichée native d’un scalaire, par exemple 12/15 ou 75%."),
        "source_record_id": col("bigint", "Observation d’origine.", False)}, ["match_id", entity + "_id", "period_code", "family_code", "metric_code"])
    fk(t, ["metric_code"], "football.metric_definitions", ["code"])
    fk(t, ["period_code"], "football.periods", ["code"])
    fk(t, ["match_id", "player_id", "team_id"] if entity == "player" else ["match_id", "team_id"], "football.match_players" if entity == "player" else "football.match_teams", ["match_id", "player_id", "team_id"] if entity == "player" else ["match_id", "team_id"])
    fk(t, ["source_record_id"], "ingest.source_records", ["id"])
    check(t, "num_nonnulls(numeric_value,text_value,boolean_value)=1", "one_value")
    check(t, "family_code IN ('standard','advanced')", "family")
    check(t, "(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL)", "value_kind")
for name in ("football.player_match_stats", "football.team_match_stats", "football.player_match_advanced", "football.team_match_advanced", "analytics.team_competition_stats"):
    remove(tables[name], "extra_metrics", "Faits secondaires déplacés vers des métriques typées et définies ; les agrégats utilisent metric_totals")
t = tables["football.match_heatmaps"]
remove(t, "cells", "Cellules directement interrogeables et contrôlables en SQL")
add(t, "cells_state", col("text", "absent, null, empty ou available ; aucun tableau vide interprété comme une grille de zéros.", False), "Conserver disponibilité et forme vide")
check(t, "cells_state IN ('absent','null','empty','available')", "cells_state")
t = new("football.match_heatmap_cells", "Cellules spatiales typées ; parent conserve grille, repère et disponibilité.", "Heatmap × ordinal source de cellule.", {
    "heatmap_id": col("bigint", "Carte parente.", False), "cell_ordinal": col("integer", "Ordre natif dans cette version.", False),
    "column_index": col("smallint", "Colonne de grille, base zéro.", False), "row_index": col("smallint", "Ligne de grille, base zéro.", False),
    "action_count": col("integer", "Actions observées dans la cellule.", False)}, ["heatmap_id", "cell_ordinal"], phase="enrichment", write="replace_with_parent")
fk(t, ["heatmap_id"], "football.match_heatmaps", ["id"])
check(t, "cell_ordinal>=0 AND column_index>=0 AND row_index>=0 AND action_count>=0", "bounds")
t["notes"] = ["Contrôle intertable de dimensions et unicité des coordonnées dans une famille publiée ; un conflit source reste une anomalie, pas une suppression silencieuse."]
t = new("football.match_h2h_entries", "Rencontres précédentes effectivement observées dans une réponse H2H, y compris une identité non encore résolue.", "Match contexte × ordinal dans une version de H2H.", {
    "match_id": col("bigint", "Rencontre pour laquelle le H2H a été collecté.", False), "entry_ordinal": col("integer", "Ordre du fournisseur.", False),
    "previous_match_id": col("bigint", "Rencontre antérieure résolue si possible ; aucune identité inventée."),
    "external_match_id": col("text", "Identifiant public natif de la rencontre antérieure."),
    "match_date": col("date", "Date connue de cette rencontre."), "time_utc_source": col("text", "Heure native ; chaîne vide distincte d’absence."),
    "status_source": col("text", "Statut natif observé."), "home_team_id": col("bigint", "Équipe domicile si résolue."), "away_team_id": col("bigint", "Équipe extérieure si résolue."),
    "home_label": col("text", "Libellé domicile observé."), "away_label": col("text", "Libellé extérieur observé."),
    "home_score": col("integer", "Score natif connu ; portée non inventée."), "away_score": col("integer", "Score natif connu."),
    "source_record_id": col("bigint", "Observation d’origine.", False)}, ["match_id", "entry_ordinal"], phase="enrichment", write="replace_family_atomically")
for c, parent in (("match_id", "football.matches"), ("previous_match_id", "football.matches"), ("home_team_id", "football.teams"), ("away_team_id", "football.teams"), ("source_record_id", "ingest.source_records")):
    fk(t, [c], parent, ["id"])

# Per-metric coverage and numerators are facts; move them out of JSONB projections.
t = new("analytics.metric_totals", "Totaux secondaires et couverture explicites d’une construction publiée.", "Build × sujet typé × métrique.", {
    "id": identity(), "build_id": col("bigint", "Construction immuable.", False),
    "subject_kind": col("text", "competition, match, player, player_team ou team.", False),
    "match_id": col("bigint", "Match si le sujet est une carte de rencontre."), "player_id": col("bigint", "Joueur du total."), "team_id": col("bigint", "Équipe du total."),
    "metric_code": col("text", "Métrique ou indicateur de couverture enregistré.", False),
    "numeric_value": col("numeric", "Valeur calculée ; NULL si non disponible."), "observed_count": col("bigint", "Observations couvertes.", False),
    "eligible_count": col("bigint", "Observations éligibles selon le contrat ; NULL si ce nombre reste inconnu."), "eligible_minutes": col("numeric", "Minutes éligibles propres à cette métrique."),
    "numerator": col("numeric", "Somme des numérateurs connus."), "denominator": col("numeric", "Somme des dénominateurs connus."),
    "coverage_state": col("text", "available, partial, unavailable ou unknown.", False)}, ["id"], write="derived_immutable_per_build")
for c, parent in (("build_id", "analytics.aggregation_builds"), ("match_id", "football.matches"), ("player_id", "football.players"), ("team_id", "football.teams")):
    fk(t, [c], parent, ["id"])
fk(t, ["metric_code"], "football.metric_definitions", ["code"])
unique(t, ["build_id", "subject_kind", "match_id", "player_id", "team_id", "metric_code"], "subject_metric", True)
check(t, "observed_count>=0 AND eligible_count>=0 AND observed_count<=eligible_count", "coverage_counts")
check(t, "subject_kind IN ('competition','match','player','player_team','team')", "subject_kind")
check(t, "(subject_kind='competition' AND num_nonnulls(match_id,player_id,team_id)=0) OR (subject_kind='match' AND match_id IS NOT NULL AND num_nonnulls(player_id,team_id)=0) OR (subject_kind='player' AND player_id IS NOT NULL AND num_nonnulls(match_id,team_id)=0) OR (subject_kind='player_team' AND match_id IS NULL AND player_id IS NOT NULL AND team_id IS NOT NULL) OR (subject_kind='team' AND team_id IS NOT NULL AND num_nonnulls(match_id,player_id)=0)", "typed_subject")
for name in ("analytics.match_summary", "analytics.player_competition_team_stats", "analytics.player_competition_stats", "analytics.team_competition_stats", "analytics.competition_summary"):
    remove(tables[name], "coverage", "Couverture et dénominateurs directement interrogeables dans metric_totals")
remove(tables["analytics.aggregation_builds"], "coverage_summary", "Le build doit publier des compteurs de couverture typés")
for name in ("analytics.publication_versions",):
    t = tables[name]
    add(t, "catalog_snapshot_id", col("bigint", "Instantané scellé des seules identités et métadonnées communes utilisées par cette édition ; réutilisé si ces dépendances restent identiques.", False), "Un ETag d’édition couvre ses dimensions partagées sans dépendre des changements sans rapport d’autres éditions")
    add(t, "representation_version", col("text", "Version du contrat de sérialisation et du format compact.", False), "Cache et curseurs prennent toutes les dépendances en compte")
    fk(t, ["catalog_snapshot_id"], "ingest.dataset_snapshots", ["id"])
t = new("analytics.catalog_publication", "Version publiée des identités et métadonnées communes à toutes les éditions.", "Un pointeur global actif.", {
    "singleton": col("boolean", "Clé singleton toujours true.", False, default_sql="true"),
    "catalog_snapshot_id": col("bigint", "Instantané SQL scellé du référentiel commun.", False),
    "representation_version": col("text", "Version de sérialisation des métadonnées.", False),
    "published_at": col("timestamptz", "Activation atomique avec les éditions touchées.", False)}, ["singleton"])
fk(t, ["catalog_snapshot_id"], "ingest.dataset_snapshots", ["id"])
check(t, "singleton IS TRUE", "singleton")

# Stable public routes continue to resolve external identifiers, never JavaScript BIGINTs.
cols = {"route_kind": col("text", "player, profile, team, competition, match, association, venue ou coach.", False), "public_key": col("text", "Identifiant ou slug public historique conservé exactement.", False)}
for entity in ("player", "team", "competition", "match", "association", "venue", "coach"):
    cols[entity + "_id"] = col("bigint", "Identité interne si route de type " + entity + ".")
cols["profile_version_id"] = col("bigint", "Version de profil si l’ancien lien porte un suffixe de version.")
t = new("ingest.public_aliases", "Correspondances stables des liens publics existants vers les identités internes.", "Type de route × clé publique.", cols, ["route_kind", "public_key"])
for entity, plural in (("player", "players"), ("team", "teams"), ("competition", "competitions"), ("match", "matches"), ("association", "associations"), ("venue", "venues"), ("coach", "coaches")):
    fk(t, [entity + "_id"], "football." + plural, ["id"])
fk(t, ["profile_version_id", "player_id"], "football.player_profile_versions", ["id", "player_id"])
check(t, "num_nonnulls(player_id,team_id,competition_id,match_id,association_id,venue_id,coach_id)=1", "one_identity")
check(t, "profile_version_id IS NULL OR route_kind='profile'", "profile_route")
check(t, "(route_kind='profile' AND player_id IS NOT NULL AND profile_version_id IS NOT NULL) OR (route_kind='player' AND player_id IS NOT NULL AND profile_version_id IS NULL) OR (route_kind='team' AND team_id IS NOT NULL) OR (route_kind='competition' AND competition_id IS NOT NULL) OR (route_kind='match' AND match_id IS NOT NULL) OR (route_kind='association' AND association_id IS NOT NULL) OR (route_kind='venue' AND venue_id IS NOT NULL) OR (route_kind='coach' AND coach_id IS NOT NULL)", "route_identity")
t["notes"] = ["Contrainte différée : la route et la colonne d’identité doivent correspondre ; profile exige player_id + profile_version_id.", "Les IDs BIGINT ne traversent jamais une conversion JavaScript Number pour conserver les contrats publics."]

# Explicit supplementary scalar facts: preserve historical strings instead of dumping sourceFields.
t = new("football.match_observation_details", "Faits contextuels observés dans les résultats et archives complémentaires.", "Un enregistrement source décrivant une rencontre.", {
    "source_record_id": col("bigint", "Observation structurée d’origine.", False), "match_id": col("bigint", "Match résolu ; rapprochement incertain conservé explicitement."),
    "source_competition_label": col("text", "Libellé de compétition observé."), "source_season_label": col("text", "Saison métier native."),
    "source_match_key": col("text", "Clé ou numéro local de rencontre."), "source_home_label": col("text", "Nom domicile observé."), "source_away_label": col("text", "Nom extérieur observé."),
    "source_date_text": col("text", "Date native, y compris annotations et précision."), "date_note": col("text", "Note de date ou d’incertitude."),
    "source_time_text": col("text", "Heure native sans conversion abusive."), "source_round_label": col("text", "Tour/journée natif."),
    "source_stage_label": col("text", "Phase native."), "source_group_label": col("text", "Groupe natif."), "source_venue_label": col("text", "Stade observé."),
    "attendance": col("integer", "Affluence si l’entier est réellement fourni."), "attendance_text": col("text", "Forme native de l’affluence si imprécise."),
    "result_code": col("text", "Code de résultat source."), "notes": col("text", "Commentaires métier du match."),
    "resolution_state": col("text", "resolved, ambiguous ou unavailable.", False)}, ["source_record_id"], phase="enrichment", write="append_only")
fk(t, ["source_record_id"], "ingest.source_records", ["id"])
fk(t, ["match_id"], "football.matches", ["id"])
t["notes"] = ["Scores, événements, métriques et affiliations vont dans leurs tables métier ; aucune colonne sourceFields/extra JSONB.", "Les codes supplémentaires doivent recevoir un contrat de champ et une destination typée avant purge ; pas de conservation opaque de la ligne d’archive."]

# Exact observed supplementary contexts, plus fields omitted by the sampled blueprint.
for entity, parent in (("team", "football.teams"), ("association", "football.associations")):
    t = new("football." + entity + "_profile_versions", "Versions observées des noms, codes, emblèmes et affiliations d’un " + entity + ".", "Identité × observation de profil.", {
        "id": identity(), entity + "_id": col("bigint", "Identité canonique observée.", False),
        "source_record_id": col("bigint", "Observation du fournisseur.", False), "observed_at": col("timestamptz", "Date de récupération effective.", False),
        "display_name": col("text", "Nom affiché dans cette version."), "short_name": col("text", "Nom court natif."),
        "official_name": col("text", "Nom officiel natif."), "international_name": col("text", "Nom international natif."),
        "country_code_source": col("text", "Code pays natif, sans assimilation automatique à un ISO."),
        "team_code_source": col("text", "Code fournisseur observé."), "image_asset_id": col("bigint", "Emblème ou portrait référencé."),
        **({"association_id": col("bigint", "Affiliation sportive si connue.")} if entity == "team" else {}),
        "valid_from": col("date", "Début de validité déclaré par la source, si connu."), "valid_to": col("date", "Fin de validité déclarée."),
        "from_year": col("integer", "Année de validité native si la date précise est inconnue."), "to_year": col("integer", "Année de fin native."),
        "from_phases": col("text[]", "Codes de phase fournisseur de début, ordre conservé."), "to_phases": col("text[]", "Codes de phase fournisseur de fin."),
        "inherit_team_external_id": col("text", "Identifiant d’héritage natif ; rapprochement contrôlé."),
        "is_placeholder": col("boolean", "Identité temporaire explicitement indiquée par la source."), "is_national": col("boolean", "Indicateur natif d’équipe nationale.")}, ["id"], phase="enrichment", write="append_only")
    fk(t, [entity + "_id"], parent, ["id"])
    fk(t, ["source_record_id"], "ingest.source_records", ["id"])
    fk(t, ["image_asset_id"], "ingest.media_assets", ["id"])
    if entity == "team":
        fk(t, ["association_id"], "football.associations", ["id"])
    check(t, "valid_to>=valid_from", "validity")
    unique(t, [entity + "_id", "source_record_id"], "observed_identity")
for name in ("football.team_ranking_components", "football.association_ranking_components"):
    t = tables[name]
    remove(t, "extra", "Composantes de classement fournisseur directement typées")
    for column, kind, definition in [
        ("national_association_points", "numeric(16,6)", "Points nationaux fournis pour la contribution."),
        ("total_value", "numeric(16,6)", "Valeur totale native de la contribution."), ("total_points_with_bonus", "numeric(16,6)", "Points incluant les bonus explicitement fournis."),
        ("factor_bonus_for_title_held", "numeric(16,6)", "Facteur natif de bonus lié au titre."), ("factor_total_bonus", "numeric(16,6)", "Total des facteurs de bonus fournis."),
        ("matches_count", "integer", "Nombre de matchs indiqué pour cette composante."), ("teams_count", "integer", "Nombre d’équipes indiqué."),
        ("teams_still_playing", "integer", "Nombre d’équipes encore engagées lors de l’observation.")]:
        add(t, column, col(kind, definition), "Champs des seasonRankings actuels à conserver")
t = tables["football.ranking_snapshots"]
for name in ("base_season_year", "target_season_year"):
    add(t, name, col("integer", "Année de référence native " + name + ", distincte des dates de publication et récupération."), "Conserver le contexte des coefficients UEFA")
t = tables["football.player_profile_versions"]
add(t, "profile_content_sha256", col("text", "Empreinte des attributs typés du profil ; l’ancien ID peut être réutilisé avec d’autres attributs.", False), "La version historique nom/image ne versionne pas tous les attributs")
for constraint in t["unique_constraints"]:
    if constraint["columns"] == ["source_id", "external_profile_version_id"]:
        constraint["columns"].append("profile_content_sha256")
check(t, "profile_content_sha256 ~ '^[0-9a-f]{64}$'", "profile_hash")
for name in ("home_image_asset_id", "away_image_asset_id"):
    t = tables["football.match_h2h_entries"]
    add(t, name, col("bigint", "Média de l’équipe effectivement observé dans cette ligne H2H."), "Conserver les médias historiques du contrat H2H")
    fk(t, [name], "ingest.media_assets", ["id"])

# The only substantial extension: immutable typed copies for mutable business facts.
for table in tables.values():
    if "source_record_id" in table["columns"]:
        table["columns"]["source_record_id"]["description"] = "Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers."
    if table["qualified_name"].startswith("football."):
        for name, value in table["columns"].items():
            if value["type"] == "double precision":
                check(table, name + " NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)", name + "_finite")
for t in list(tables.values()):
    if t["qualified_name"].startswith("football.") or t["qualified_name"] in ("ingest.sources", "ingest.source_datasets", "ingest.media_assets", "ingest.match_coverage"):
        add(t, "row_version_id", col("bigint", "Révision de la ligne métier ; aucune copie dans une table history. La politique des anciennes valeurs reste à décider.", False), "Snapshots SQL indépendants des fichiers")
        unique(t, ["row_version_id"], "row_version")
        fk(t, ["row_version_id"], "ingest.row_versions", ["id"])
# Mark permitted JSONB exceptions individually, bounded and prohibited from storing source payloads.
jsonb_exceptions = []
for t in tables.values():
    for name, value in t["columns"].items():
        if value["type"] != "jsonb":
            continue
        purpose = "Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source."
        if name == "quality_flags":
            purpose = "Codes de qualité et indicateurs booléens enregistrés ; détails dans quality_issues, aucun fait sportif."
        if t["phase"] == "models" and name in ("features", "components", "coverage"):
            purpose = "Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank."
        value["jsonb_exception"] = purpose
        value["maximum_encoded_bytes"] = 16384
        jsonb_exceptions.append(dict(table=t["qualified_name"], column=name, phase=t["phase"], purpose=purpose, max_bytes=16384))
        check(t, "octet_length(" + name + "::text)<=16384", name + "_bounded")

proposal["required_cross_row_rules"] = [r for r in proposal["required_cross_row_rules"] if r["id"] != "immutable_history"]
for rule in proposal["required_cross_row_rules"]:
    if rule["id"] == "spatial_contract":
        rule["tables"].append("football.match_heatmap_cells")
        rule["rule"] = "Repères distincts par famille ; coordonnées finies et bornes selon repère. Les cellules sont des colonnes entières liées à leur grille, avec contrôles intertables des indices, compteurs et doublons. Un vide ne devient pas une grille de zéros."
    if rule["id"] == "family_selection":
        rule["implementation"] = "Verrouiller le périmètre, remplacer atomiquement la famille courante et mettre à jour couverture/éditions sales. La conservation des valeurs antérieures dépend du choix de versionnement, sans table history."
for mapping in proposal["migration_mapping"]:
    if mapping["source"] == "statarena.objects + bucket data/<path>":
        mapping["transformation"] = "Conserver les métadonnées et relations aux faits SQL ; originaux temporaires jusqu’à réconciliation, puis suppression des octets et copies."
    if mapping["source"] == "observations/events":
        mapping["transformation"] = "Flux SQL typés, ordre et scores conservés ; remplacement courant atomique. Aucune copie technique history ; conservation des corrections antérieures à trancher."
proposal["format_notes"] = ["Proposition documentaire non déployée, construite depuis le JSON utilisateur intégral.", "Core et enrichment restent obligatoires pour la mission complète ; les neuf tables de modèles sont une réserve sans nouvelle formule.", "PK/FK/CHECK sont décrits ; les règles intertables, migrations et parcours devront être effectivement implémentés et testés après approbation.", "Les54tables history ont été retirées sur instruction utilisateur ; aucun stockage équivalent renommé ou opaque. La conservation des anciennes valeurs reste à trancher avant reprise du pilote."]
proposal["required_cross_row_rules"].append({"id": "no_separate_history_tables", "enforcement": "schema_generation_and_review", "rule": "No table named *_history, no history_of relation and no renamed/opaque replacement copy store. Revision/provenance metadata never replaces retained values. Version retention inside business tables versus current-state-only remains a user decision before pilot restart."})
proposal["implementation_order"] = {"procedure": ["User removed all54separate history tables after initial pilot approval. Resolve the remaining version-retention policy before restarting the dependent implementation.", "Create versioned migrations and E2E failure cases before implementation; test on disposable local PostgreSQL18.6, no new RDS or Neon branch.", "Create tables/keys/checks first, then FK and deferred cross-row rules; resolve the source_records/row_versions cycle in the FK installation stage.", "Normalize and reconcile existing AWS sources; do not start another Neon-to-AWS transfer.", "Stabilize schema, then advance backend adaptation and data reconciliation independently.", "Finalize publication/snapshot guarantees according to the chosen retention policy; do not claim old values are reproducible from hashes alone. Verify coherent aggregates and Vercel-to-RDS through CloudFront.", "Only then cut over, remove structured source files/copies and unused old relations, verify recovered space and continued SQL-only operation."]}
proposal["operational_decisions"].update(new_collection="PitchAPI -> in-memory decode/validation -> typed RDS facts in a transaction, without separate history tables. No raw response file/document persisted. Data collector has no S3 data credentials; media worker is separate.", retention="EXISTING raw originals only until complete accepted reconciliation. New collections never create raw files. Remove legacy RDS/S3 copies only after reconciliation under the chosen value-retention policy; provenance metadata is not a replay store. Exact raw bytes and arbitrary future reparsing cannot be reproduced.", rollout="Single existing RDS. Git main only. User-approved plan gate first. Existing originals/reader retained for bounded migration rollback; post-purge rollback depends on the explicit retention choice and must not assume unavailable prior facts.")
# Pro review is now the user's explicit priority. Apply constraints before the
# selective transform, which removes the universal registry/state/link tables.
from apply_pro_constraints import apply as apply_pro_constraints
from apply_pro_versions import apply as apply_pro_versions
if args.fixture_phase == "before_constraints":
    write_fixture()
    raise SystemExit(0)
apply_pro_constraints(proposal, changes)
if args.fixture_phase == "before_versions":
    write_fixture()
    raise SystemExit(0)
apply_pro_versions(proposal, changes)
tables = {t["qualified_name"]: t for schema in proposal["schemas"] for t in schema["tables"]}
proposal["format_version"] = "1.2.0-pro-review"
proposal["conventions"].update(
    canonical_grain="Une sélection canonique par grain/périmètre/génération ; variantes utiles dans les tables métier typées, sans magasin documentaire.",
    nulls="États locaux typés inventoriés pour distinguer absence, null explicite, chaîne vide et type natif lorsque nécessaire ; zéro reste une valeur observée. La matrice exhaustive reste à terminer avant purge.",
    provenance="Provenance directe et typée ; les valeurs nécessaires restent dans les tables métier avec leurs dépendances. Les hashes ne remplacent pas les valeurs.",
    revisions="Versions sélectives à bornes de génération, enfants versionnés par leur parent lorsqu’une famille est atomique ; aucun registre universel row_versions ni table sœur history.",
    updated_at="Pour une version retenue, insérer une nouvelle ligne lors d’une correction et fermer seulement la borne de l’ancienne. Pour les états opérationnels courants, UPDATE explicite de updated_at.")
proposal["required_cross_row_rules"] = [r for r in proposal["required_cross_row_rules"] if r["id"] != "no_separate_history_tables"]
proposal["required_cross_row_rules"].append({"id":"selective_inline_versions","enforcement":"transactional_generation_and_typed_fk_gates","rule":"Retain actual typed values and dependencies inside selected business tables. Serialize generation allocation through commit, prohibit overlaps/sealed reuse/value mutation, validate selected parent membership at the same generation, and freeze builds/representations. Current views are internal; public reads resolve the published build first. No universal row registry or hidden history copies."})
for rule in proposal["required_cross_row_rules"]:
    if rule["id"] == "family_selection":
        rule["rule"] = "Sélectionner une famille canonique au périmètre déclaré et à la même génération que ses dépendances. Conserver les variantes et valeurs retenues dans leurs tables métier typées ; les enfants atomiques appartiennent à une version parente immuable. Une réponse partielle ou une tentative échouée n'est pas une liste vide ni une suppression."
        rule["implementation"] = "Sous verrou transactionnel de génération, fermer les sélections remplacées et insérer les nouvelles versions/collections sans effacer les anciennes ; contrôler complétude, appartenance, absence de chevauchement et publication avant scellement/commit."
for mapping in proposal["migration_mapping"]:
    if mapping["source"] == "observations/events":
        mapping["transformation"] = "Flux typés immuables liés à la version complète de collection ; ordre, scores et anciennes collections conservés, sélection canonique à une génération donnée."
proposal["format_notes"] = ["Revue GPT Pro explicitement prioritaire sur le choix intermédiaire état courant seul.", "Versions sélectives dans les tables métier, sans54tables sœurs history ni registre universel de versions par cellule.", "Modèle de conception à vérifier dans PostgreSQL : aucun statut de ce JSON ne vaut preuve d’exécution ou de migration.", "Le socle84tables est une référence de responsabilités, pas un quota ; les9tables de modèles restent une réserve sans nouvelle formule.", "Matrice exhaustive des champs/variantes et contributions encore requise avant purge ; les seuls états ciblés présents ne prouvent pas la couverture complète."]
proposal["operational_decisions"].update(
    new_collection="PitchAPI -> in-memory decode/validation -> selected typed RDS facts/dependencies in one bounded generation transaction. No raw response file/document persisted; separate essential-media worker.",
    retention="Retain accepted typed inputs, variants and dependencies needed for reproducibility; existing raw originals only until full reconciliation, then remove RDS/S3 copies. A hash never restores deleted bytes.",
    rollout="One existing RDS, main only. Present the materially revised inline key model before remote reorganization. Availability repair is a separate lot; public partialAWS cutover is not justified by health200.")
proposal["implementation_order"]["procedure"][0] = "Coherent revised Pro model must be presented before remote reorganization; the old54history approval is superseded. Run meaningful bounded local pilot and actual integrity checks before full migration or purge."
proposal["implementation_order"]["procedure"][2] = "Create schemas/sequences and actual nonnullable PK/nonpartial unique keys, then typed version-anchor FK and deferred cross-row gates; bind bootstrap generations/code digests before dependent seed rows. No universal row registry."
proposal["implementation_order"]["procedure"][5] = "Build/publish against retained data, shared dependencies and code/numeric contracts; verify full Vercel-to-RDS flows and immutable representations."
# Recompute exceptions after all transforms; never report removed tables or columns.
jsonb_exceptions = [dict(table=t["qualified_name"],column=n,phase=t["phase"],purpose=c["jsonb_exception"],max_bytes=c["maximum_encoded_bytes"])
    for t in tables.values() for n,c in t["columns"].items() if c["type"]=="jsonb"]
# The review follows responsibilities; retaining an arbitrary table count is not a gate.
baseline_tables = {t["qualified_name"]:t for schema in original["schemas"] for t in schema["tables"]}
baseline_dispositions = {name:dict(action="deferred" if t["phase"]=="models" else "retained_adapted",targets=[name],reason="Réserve de modèles sans nouvelle formule." if t["phase"]=="models" else "Responsabilité du socle couverte ; clés/contraintes adaptées selon la revue Pro.")
    for name,t in baseline_tables.items() if name in tables}
# Avoid presenting temporary builder steps (e.g. add then remove row_version_id)
# as final schema amendments. The full recursive diff is generated separately.
prior_reasons = {}
for item in changes:
    prior_reasons.setdefault((item["table"],item.get("column")),item.get("reason","Adaptation à la revue Pro."))
final_changes=[]
for name,t in tables.items():
    old=baseline_tables.get(name)
    if old is None:
        final_changes.append(dict(table=name,operation="add_table",column=None,reason=prior_reasons.get((name,None),t["description"])))
        continue
    for n in sorted(set(old["columns"])|set(t["columns"])):
        a,b=old["columns"].get(n),t["columns"].get(n)
        semantic=lambda v: None if v is None else {k:x for k,x in v.items() if k!="description"}
        if semantic(a)!=semantic(b):
            final_changes.append(dict(table=name,operation="add_column" if a is None else "remove_column" if b is None else "change_column",column=n,before=a,after=b,reason=prior_reasons.get((name,n),"Versions sélectives, dépendances et contraintes précisées par la revue Pro.")))
    for section in ("primary_key","unique_constraints","foreign_keys","checks","indexes","write_mode","versioning","historical_read_policy","grain","description"):
        if old.get(section)!=t.get(section):
            final_changes.append(dict(table=name,operation="change_"+section,column=None,before=old.get(section),after=t.get(section),reason="Clés physiques, ancres de versions et contraintes de la revue Pro ; voir le diff intégral."))
changes=final_changes
proposal["planning"] = {"baseline_sha256": hashlib.sha256((OUT / "inputs/Orion_schema_bdd.original.json").read_bytes()).hexdigest(), "baseline_tables": len(baseline_tables), "baseline_columns": sum(len(t["columns"]) for t in baseline_tables.values()), "history_tables": 0, "version_policy": "selective_inline_versions_per_pro", "baseline_dispositions": baseline_dispositions, "models_scope": "9 original model tables shown as deferred preparation only; preserve existing client scouting formulas without inventing a new Orion model.", "jsonb_exceptions": jsonb_exceptions}
proposal["planning"]["version_classes"] = {key: len(proposal["selective_versioning"][key]) for key in ("selected_relations", "parent_version_children", "existing_append_only", "stable_identities")}
proposal["planning"]["tables"] = len(tables)
proposal["planning"]["columns"] = sum(len(t["columns"]) for t in tables.values())
proposal["planning"]["foreign_keys"] = sum(len(t["foreign_keys"]) for t in tables.values())
for phase in proposal["delivery_phases"]:
    phase["tables_count"] = sum(t["phase"] == phase["code"] for t in tables.values())
    phase["in_mission_scope"] = phase["code"] != "models"
proposal["delivery_phases"][1]["objective"] += " — obligatoire pour la livraison complète, pas hors périmètre."
proposal["status"] = "pro_review_selective_inline_proposal_not_deployed"
assert not any(t.get("history_of") or t["name"].endswith("_history") for t in tables.values())
(OUT / "target-schema.proposed.json").write_text(json.dumps(proposal, indent=2, ensure_ascii=False) + "\n")
(OUT / "changes.json").write_text(json.dumps(changes, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({k:v for k,v in proposal["planning"].items() if k not in ("baseline_dispositions", "jsonb_exceptions")} | {"jsonb_exceptions": len(jsonb_exceptions), "baseline_dispositions": len(baseline_dispositions)}, ensure_ascii=False))
