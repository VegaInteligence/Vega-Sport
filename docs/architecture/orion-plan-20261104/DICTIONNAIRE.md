# Dictionnaire de la proposition StatArena / Orion

**Proposition non déployée.** Toutes les tables, colonnes, types, clés et contraintes de la version proposée sont décrits ci-dessous. `!` signifie NOT NULL ; une PK composée porte sur l’ensemble indiqué. Les règles intertables restent à implémenter après approbation.

## Sources et médias

### ingest.document_lineage

Origines des documents dérivés.

Grain : Document dérivé × document parent.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `derived_document_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.source_documents(id). |
| `parent_document_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.source_documents(id). |
| `transform_version` | `text` | non |  | Version de la transformation de données. |
| `parameters` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |

PK : `derived_document_id, parent_document_id`.

- FK `derived_document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- FK `parent_document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(parameters) = 'object'`.
- CHECK `derived_document_id <> parent_document_id`.
- CHECK `octet_length(parameters::text)<=16384`.
- INDEX `btree : [{"column": "parent_document_id", "order": "ASC"}, {"column": "derived_document_id", "order": "ASC"}]`.


### ingest.media_assets

Références de médias et attribution, sans duplication du fichier.

Grain : Version conservée d’un média.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `storage_bucket` | `text` | non |  | Bucket du média conservé ou ancienne localisation de source supprimée. |
| `storage_key` | `text` | non |  | Clé du média conservé ou ancienne localisation de source ; aucun contenu incorporé. |
| `content_sha256` | `text` | oui |  | Empreinte SHA-256 hexadécimale du contenu effectivement vérifié ; aucune capacité de reconstruction par ce hash seul. |
| `source_url` | `text` | oui |  | Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité. |
| `content_type` | `text` | non |  | Type MIME du média ou de l’ancien artefact. |
| `author` | `text` | oui |  | Auteur ou crédit du média tel que sourcé. |
| `license_code` | `text` | oui |  | Licence ou conditions d’utilisation identifiées pour le corpus/média. |
| `attribution_url` | `text` | oui |  | Lien de crédit/licence à présenter pour le média. |
| `retrieved_at` | `timestamptz` | non |  | Récupération effective de la donnée source. |
| `legacy_asset_url` | `text` | oui |  | Ancienne URL publique à continuer de résoudre vers le média. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `storage_bucket, storage_key, content_sha256 ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `content_sha256 ~ '^[0-9a-f]{64}$'`.

- Réutiliser statarena.assets comme catalogue de téléchargement; cette table porte la référence métier et la licence.

### ingest.resource_fetches

Historique des tentatives de collecte, distinct de la file de jobs existante.

Grain : Une tentative HTTP ou une lecture d’archive.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `run_id` | `bigint` | non | FK | Référence SQL vers ingest.import_runs(id). |
| `source_id` | `bigint` | non | FK | Référence SQL vers ingest.sources(id); ingest.source_documents(id, source_id). |
| `endpoint` | `text` | non |  | Endpoint de collecte ; jamais appelé par une requête utilisateur. |
| `canonical_params` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `request_fingerprint` | `text` | non |  | Empreinte stable de la requête canonique, incluant la source, sans secret. |
| `attempt_no` | `integer` | non |  | Numéro strictement positif de tentative dans ce run et pour cette ressource. |
| `requested_at` | `timestamptz` | non |  | Instant UTC « requested_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `finished_at` | `timestamptz` | oui |  | Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `http_status` | `smallint` | oui |  | Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP. |
| `error_code` | `text` | oui |  | Code d’erreur technique/fournisseur conservé exactement. |
| `error_details` | `jsonb` | oui |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `document_id` | `bigint` | oui | FK | Référence SQL vers ingest.source_documents(id, source_id). |
| `response_state` | `text` | non |  | Résultat réel de la collecte : donnée disponible, réponse vide, indisponibilité, échec ou invalidité. |

PK : `id`.

- UNIQUE `run_id, source_id, request_fingerprint, attempt_no`.
- FK `run_id → ingest.import_runs(id) ; ON DELETE RESTRICT`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `document_id, source_id → ingest.source_documents(id, source_id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(canonical_params) = 'object'`.
- CHECK `jsonb_typeof(error_details) = 'object'`.
- CHECK `response_state IN ('available', 'empty_response', 'unavailable', 'failed', 'invalid')`.
- CHECK `http_status BETWEEN 100 AND 599`.
- CHECK `attempt_no > 0`.
- CHECK `finished_at >= requested_at`.
- CHECK `octet_length(canonical_params::text)<=16384`.
- CHECK `octet_length(error_details::text)<=16384`.
- INDEX `btree : [{"column": "source_id", "order": "ASC"}, {"column": "request_fingerprint", "order": "ASC"}, {"column": "requested_at", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.


### ingest.source_datasets

Corpus et versions de contrat d’une source.

Grain : Source × clé de corpus × version de contrat.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `source_id` | `bigint` | non | FK | Référence SQL vers ingest.sources(id). |
| `dataset_key` | `text` | non |  | Clé stable du corpus de cette source. |
| `contract_version` | `text` | non |  | Version du contrat de ce corpus, figée pour les observations qui l’utilisent. |
| `source_url` | `text` | oui |  | Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité. |
| `license_code` | `text` | oui |  | Licence ou conditions d’utilisation identifiées pour le corpus/média. |
| `schema_description` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `source_id, dataset_key, contract_version`.
- UNIQUE `id, source_id`.
- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(schema_description) = 'object'`.
- CHECK `octet_length(schema_description::text)<=16384`.


### ingest.source_documents

Reçu d’observation HTTP directe ou métadonnées d’un ancien artefact source ; jamais le contenu d’une réponse ou d’un fichier.

Grain : Version de contenu d’un objet dans un corpus.

Écriture : `immutable_content_metadata_with_audited_retention_transition` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `dataset_id` | `bigint` | non | FK | Référence SQL vers ingest.source_datasets(id, source_id). |
| `source_id` | `bigint` | non | FK | Référence SQL vers ingest.source_datasets(id, source_id). |
| `storage_provider` | `text` | non |  | http_direct pour les nouvelles collectes sans fichier ; aws_s3 uniquement pour les sources historiques déjà présentes. |
| `storage_bucket` | `text` | oui |  | Ancien emplacement à titre de provenance ; ne constitue pas une dépendance de lecture. |
| `storage_key` | `text` | oui |  | Ancien emplacement à titre de provenance ; ne constitue pas une dépendance de lecture. |
| `storage_version` | `text` | oui |  | Version exacte du stockage si réellement disponible ; une clé mutable n’est pas une version. |
| `content_sha256` | `text` | non |  | SHA-256 hexadécimal minuscule du contenu effectivement conservé. |
| `byte_length` | `bigint` | oui |  | Nombre d’octets vérifiés de l’ancien artefact ; métadonnée sans conservation de son contenu. |
| `content_type` | `text` | oui |  | Type MIME du média ou de l’ancien artefact. |
| `encoding` | `text` | oui |  | Encodage/compression source identifié. |
| `retrieved_at` | `timestamptz` | non |  | Récupération effective de la donnée source. |
| `source_updated_at` | `timestamptz` | oui |  | Dernière mise à jour déclarée par la source, distincte de sa récupération. |
| `source_published_at` | `timestamptz` | oui |  | Publication déclarée par la source ; reste inconnue en l’absence de preuve. |
| `source_url` | `text` | oui |  | Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité. |
| `legacy_object_path` | `text` | oui |  | Ancien chemin, conservé comme provenance uniquement après purge. |
| `import_run_id` | `bigint` | oui | FK | Référence SQL vers ingest.import_runs(id). |
| `origin_kind` | `text` | non |  | http_response directe ou legacy_file déjà existant. |
| `content_verified_at` | `timestamptz` | oui |  | Date de la dernière vérification effective des octets avant suppression. |
| `retention_state` | `text` | non |  | not_stored pour une nouvelle réponse HTTP ; staged/reconciled/deleted uniquement pour un ancien fichier. |
| `deleted_at` | `timestamptz` | oui |  | Suppression vérifiée de l’original et des copies recensées. |

PK : `id`.

- UNIQUE `dataset_id, storage_bucket, storage_key, content_sha256`.
- UNIQUE `id, source_id`.
- FK `dataset_id, source_id → ingest.source_datasets(id, source_id) ; ON DELETE RESTRICT`.
- FK `import_run_id → ingest.import_runs(id) ; ON DELETE RESTRICT`.
- CHECK `content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `byte_length >= 0`.
- CHECK `retention_state IN ('not_stored','staged','reconciled','deleted')`.
- CHECK `(origin_kind='http_response' AND storage_provider='http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND retention_state='not_stored') OR (origin_kind='legacy_file' AND retention_state IN ('staged','reconciled','deleted'))`.
- CHECK `(retention_state='deleted') = (deleted_at IS NOT NULL)`.
- INDEX `btree : [{"column": "content_sha256", "order": "ASC"}]`.

- Aucun body, payload ou contenu métier JSONB. Une nouvelle collecte ne crée ni clé S3 ni fichier temporaire de données ; la réponse est décodée en mémoire puis écrite dans ses tables typées.
- Les anciennes coordonnées de stockage sont seulement des métadonnées. Leur conservation temporaire s’applique aux fichiers déjà présents, pas aux nouveaux appels PitchAPI.
- Le scellement dépend de faits SQL typés immuables ; aucun contrôle n’exige des octets encore accessibles après purge.

### ingest.source_records

Métadonnées d’observation et correspondance vers les faits SQL conservés ; ancien localisateur sans dépendance à des octets supprimés.

Grain : Document × localisateur.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `source_id` | `bigint` | non | FK | Référence SQL vers ingest.source_documents(id, source_id). |
| `document_id` | `bigint` | non | FK | Référence SQL vers ingest.source_documents(id, source_id). |
| `locator_kind` | `text` | non |  | Nature du localisateur : pointeur JSON, ligne JSONL, ordinal, membre d’archive ou document entier. |
| `locator` | `text` | non |  | Pointeur JSON, ligne, ordinal ou chemin membre + ordinal, canonisé sans ambiguïté. |
| `ordinal` | `integer` | oui |  | Position d’un enregistrement dans son ancien conteneur, utilisée comme provenance. |
| `record_kind` | `text` | non |  | Type sémantique de l’observation source. |
| `external_key` | `text` | oui |  | Clé native de cet enregistrement lorsqu’elle existe. |

PK : `id`.

- UNIQUE `document_id, locator`.
- UNIQUE `source_id, id`.
- FK `document_id, source_id → ingest.source_documents(id, source_id) ; ON DELETE RESTRICT`.
- CHECK `locator_kind IN ('json_pointer','jsonl_line','array_ordinal','archive_member','whole_document','csv_row','sqlite_row')`.
- CHECK `ordinal >= 0`.


### ingest.sources

Espaces stables d’identifiants fournisseurs.

Grain : Un espace fournisseur.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Code stable du référentiel, avec sa définition explicite. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `base_url` | `text` | oui |  | Adresse publique de base du fournisseur ; aucune clé ou secret inclus. |
| `upstream_source_id` | `bigint` | oui | FK | Origine amont éventuelle; une copie ne devient pas une source indépendante. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `code`.
- UNIQUE `row_version_id`.
- FK `upstream_source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `upstream_source_id <> id`.


## Historique et instantanés SQL

### ingest.dataset_snapshot_documents

Provenance des documents ayant contribué à un instantané SQL ; aucun fichier requis après purge.

Grain : Instantané × document.

Écriture : `immutable_after_snapshot_seal` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.dataset_snapshots(id). |
| `document_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.source_documents(id). |

PK : `snapshot_id, document_id`.

- FK `snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.


### ingest.dataset_snapshot_rows

Composition exacte et immuable des instantanés en versions de faits SQL.

Grain : Instantané × relation × clé logique.

Écriture : `immutable_after_snapshot_seal` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Instantané qui sélectionne cette valeur. |
| `relation_code` | `text` | non | PK/FK | Relation métier sélectionnée. |
| `logical_key` | `text` | non | PK/FK | Clé métier de la ligne sélectionnée. |
| `row_version_id` | `bigint` | non | FK | Version SQL typée retenue. |

PK : `snapshot_id, relation_code, logical_key`.

- FK `snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `row_version_id, relation_code, logical_key → ingest.row_versions(id, relation_code, logical_key) ; ON DELETE RESTRICT`.


### ingest.dataset_snapshots

Instantané logique de faits SQL typés et de leur provenance.

Grain : Un instantané logique scellé.

Écriture : `mutable_until_sealed` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `snapshot_key` | `text` | non |  | Clé unique de l’instantané SQL ; sa composition devient immuable après scellement. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `manifest_sha256` | `text` | oui |  | Empreinte du manifeste SQL scellé ; ne contient pas les fichiers supprimés. |
| `transform_version` | `text` | non |  | Version de la transformation de données. |
| `source_priority_version` | `text` | non |  | Version de la politique de priorité/déduplication entre sources utilisée par cet instantané. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `sealed_at` | `timestamptz` | oui |  | Instant UTC « sealed_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `knowledge_cutoff_at` | `timestamptz` | oui |  | Dernier instant auquel les informations sont admissibles pour ce calcul. |

PK : `id`.

- UNIQUE `snapshot_key`.
- CHECK `status IN ('draft', 'sealed', 'invalid')`.
- CHECK `manifest_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `status <> 'sealed' OR (sealed_at IS NOT NULL AND manifest_sha256 IS NOT NULL)`.


### ingest.field_contracts

Champs sémantiques enregistrés et leur destination ; aucun chemin arbitraire autorisé.

Grain : Relation × code de champ.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `relation_code` | `text` | non | PK/FK | Relation du fait normalisé. |
| `field_code` | `text` | non | PK | Code sémantique déclaré, pas une propriété JSON libre. |
| `target_column` | `text` | non |  | Colonne typée ou relation enfant explicitement correspondante. |
| `definition` | `text` | non |  | Sens, unité et règle de conservation du champ. |

PK : `relation_code, field_code`.

- FK `relation_code → ingest.relation_contracts(relation_code) ; ON DELETE RESTRICT`.


### ingest.field_states

États et exceptions scalaires nécessaires pour préserver absent/null/vide/type natif.

Grain : Version de fait × champ enregistré.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `row_version_id` | `bigint` | non | PK/FK | Version SQL du fait. |
| `relation_code` | `text` | non | FK | Relation du contrat. |
| `field_code` | `text` | non | PK/FK | Champ sémantique enregistré. |
| `source_state` | `text` | non |  | absent, null, number, string, boolean, empty_array ou empty_object. |
| `source_text` | `text` | oui |  | Texte natif uniquement si nécessaire à une conversion, y compris chaîne vide et 07. |
| `source_number` | `numeric` | oui |  | Valeur numérique native exacte lorsqu’une conversion de type demande sa conservation. |
| `source_boolean` | `boolean` | oui |  | Booléen natif si la colonne normalisée a un autre type. |

PK : `row_version_id, field_code`.

- FK `row_version_id, relation_code → ingest.row_versions(id, relation_code) ; ON DELETE RESTRICT`.
- FK `relation_code, field_code → ingest.field_contracts(relation_code, field_code) ; ON DELETE RESTRICT`.
- CHECK `source_state IN ('absent','null','number','string','boolean','empty_array','empty_object')`.
- CHECK `num_nonnulls(source_text,source_number,source_boolean) <= 1`.

- Validation différée : relation_code doit être celui de row_versions ; la valeur scalaire doit correspondre à source_state.
- Objets/arrays complets interdits ; aucun ancien document, sérialisation de sous-arbre ou attribut arbitraire. Les tableaux non vides sont des relations métier.

### ingest.record_row_links

Correspondance vérifiable des observations vers toutes leurs représentations métier typées.

Grain : Enregistrement source × version de fait.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_record_id` | `bigint` | non | PK/FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Fait typé conservé, canonique ou variante source. |
| `mapping_version` | `text` | non |  | Version vérifiable de la correspondance des champs. |

PK : `source_record_id, row_version_id`.

- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.


### ingest.relation_contracts

Catalogue des relations métier/historiques autorisées.

Grain : Une relation enregistrée.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `relation_code` | `text` | non | PK | Nom SQL qualifié autorisé, stable dans une version du contrat. |
| `history_relation` | `text` | non |  | Relation SQL typée qui conserve ses versions immuables. |
| `contract_version` | `text` | non |  | Version du contrat de colonnes, clés et sémantique. |
| `grain_definition` | `text` | non |  | Définition explicite de la clé logique. |

PK : `relation_code`.



### ingest.row_versions

Identités des versions de lignes ; leurs valeurs sont dans les tables historiques typées.

Grain : Relation × clé logique × numéro de révision.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `relation_code` | `text` | non | FK | Relation métier concernée. |
| `logical_key` | `text` | non |  | Encodage canonique des colonnes de clé ; aucun document source. |
| `revision_no` | `bigint` | non |  | Révision croissante de cette clé logique. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `provenance_kind` | `text` | non |  | provider, derived ou manual ; contexte obligatoire pour une valeur manuelle. |
| `transform_version` | `text` | non |  | Version du code de normalisation. |
| `content_sha256` | `text` | non |  | Hash sémantique de la ligne typée, de ses états et des enfants référencés. |
| `recorded_at` | `timestamptz` | non |  | Instant d’enregistrement de cette version SQL. |
| `is_tombstone` | `boolean` | non |  | Retrait logique ; les anciennes valeurs restent dans l’historique. |

PK : `id`.

- UNIQUE `relation_code, logical_key, revision_no`.
- UNIQUE `id, relation_code, logical_key`.
- UNIQUE `id, relation_code`.
- FK `relation_code → ingest.relation_contracts(relation_code) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- CHECK `revision_no > 0 AND content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `provenance_kind IN ('provider','derived','manual')`.


## Ingestion et reprise

### ingest.asset_jobs

File existante de téléchargement des seuls médias indispensables.

Grain : Une URL de média.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `url` | `text` | non | PK | URL de collecte du média. |
| `attempts` | `integer` | non |  | Tentatives. |
| `next_attempt` | `timestamptz` | non |  | Prochaine tentative autorisée. |
| `error` | `text` | oui |  | Dernière erreur opérationnelle. |

PK : `url`.



### ingest.collection_jobs

File quotidienne/historique issue de statarena.jobs, avec baux de reprise.

Grain : Source × endpoint × paramètres canoniques.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Fournisseur de la requête. |
| `endpoint` | `text` | non | PK | Endpoint d’ingestion uniquement. |
| `params` | `text` | non | PK | Paramètres canoniques de la requête ; jamais une réponse fournisseur. |
| `priority` | `smallint` | non |  | Priorité de traitement. |
| `state` | `text` | non |  | État de file, distinct de disponibilité de la donnée. |
| `attempts` | `integer` | non |  | Tentatives exécutées. |
| `available_at` | `timestamptz` | non |  | Prochaine exécution éligible. |
| `lease_owner` | `text` | oui |  | Worker propriétaire du bail courant. |
| `lease_expires_at` | `timestamptz` | oui |  | Expiration du bail ; reprise contrôlée après interruption. |

PK : `source_id, endpoint, params`.

- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.


### ingest.dirty_editions

Éditions affectées par des changements ; remplace dirty_partitions après mapping des identités.

Grain : Une édition métier.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non | PK/FK | Édition à reconstruire. |
| `generation` | `bigint` | non |  | Génération demandée ; protège des pertes d’invalidation. |
| `changed_at` | `timestamptz` | non |  | Dernière modification pertinente. |
| `reason` | `text` | non |  | Origine de l’invalidation. |

PK : `competition_season_id`.

- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.


### ingest.import_runs

Exécutions traçables de collecte ou de transformation.

Grain : Une exécution.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `mode` | `text` | non |  | Nature du run : daily, backfill, rebuild ou repair. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `transform_version` | `text` | non |  | Version de la transformation de données. |
| `code_commit` | `text` | oui |  | Révision du code effectivement employée. |
| `started_at` | `timestamptz` | non |  | Instant UTC « started_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `finished_at` | `timestamptz` | oui |  | Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `parameters` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `counters` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `checkpoint` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `error` | `jsonb` | oui |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |

PK : `id`.

- CHECK `jsonb_typeof(parameters) = 'object'`.
- CHECK `jsonb_typeof(counters) = 'object'`.
- CHECK `jsonb_typeof(checkpoint) = 'object'`.
- CHECK `jsonb_typeof(error) = 'object'`.
- CHECK `mode IN ('daily', 'backfill', 'rebuild', 'repair')`.
- CHECK `status IN ('running', 'succeeded', 'partial', 'failed', 'cancelled')`.
- CHECK `finished_at >= started_at`.
- CHECK `octet_length(parameters::text)<=16384`.
- CHECK `octet_length(counters::text)<=16384`.
- CHECK `octet_length(checkpoint::text)<=16384`.
- CHECK `octet_length(error::text)<=16384`.


### ingest.match_coverage

Disponibilité réelle par match, source et famille; indépendante du HTTP.

Grain : Match × source × famille.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id). |
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_documents(id, source_id). |
| `feature_code` | `text` | non | PK | Famille fonctionnelle de couverture, par exemple lineups, shots ou heatmaps. |
| `coverage_state` | `text` | non |  | Disponibilité réelle de la famille, indépendante du statut HTTP : disponible, vide, indisponible, invalide, etc. |
| `http_status` | `smallint` | oui |  | Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP. |
| `error_code` | `text` | oui |  | Code d’erreur technique/fournisseur conservé exactement. |
| `observed_row_count` | `integer` | oui |  | Nombre de « observed row » du périmètre de cette ligne ; absence distincte de zéro. |
| `document_id` | `bigint` | oui | FK | Référence SQL vers ingest.source_documents(id, source_id). |
| `checked_at` | `timestamptz` | non |  | Instant UTC « checked_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `is_stale` | `boolean` | non |  | Indique une donnée périmée selon sa politique de fraîcheur. |
| `data_revision` | `bigint` | non |  | Révision du grain ou de la famille, incrémentée seulement lorsque son contenu change. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, source_id, feature_code`.

- UNIQUE `row_version_id`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `document_id, source_id → ingest.source_documents(id, source_id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `coverage_state IN ('not_requested', 'pending', 'available', 'empty_response', 'unavailable', 'failed', 'invalid')`.
- CHECK `http_status BETWEEN 100 AND 599`.
- CHECK `observed_row_count >= 0`.
- CHECK `data_revision > 0`.
- INDEX `btree : [{"column": "coverage_state", "order": "ASC"}, {"column": "checked_at", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.


### ingest.schema_migrations

Journal des migrations appliquées et de leurs empreintes ; reprend les versions scellées existantes.

Grain : Une migration versionnée.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `version` | `text` | non | PK | Nom/version immuable de la migration. |
| `content_sha256` | `text` | non |  | Empreinte du SQL effectivement appliqué. |
| `applied_at` | `timestamptz` | oui |  | Date réelle d’application, sans inventer celle des anciens reçus inconnus. |
| `code_commit` | `text` | oui |  | Commit qui porte cette migration, si connu. |

PK : `version`.

- CHECK `content_sha256 ~ '^[0-9a-f]{64}$'`.


## Qualité, alias et nettoyage

### ingest.cleanup_items

Inventaire des copies physiques supprimées et des vérifications de disparition.

Grain : Campagne × copie physique recensée.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `reconciliation_run_id` | `bigint` | non | FK | Campagne acceptée qui autorise ce nettoyage. |
| `document_id` | `bigint` | oui | FK | Métadonnée de source ; nullable pour copie technique de dump/ZIP. |
| `storage_kind` | `text` | non |  | rds_relation, rds_payload ou s3_object. |
| `storage_location` | `text` | non |  | Ancienne table/clé exacte ; métadonnée seule. |
| `storage_version` | `text` | oui |  | Version S3 exacte si versioning activé. |
| `bytes_before` | `bigint` | non |  | Volume réel avant suppression. |
| `status` | `text` | non |  | planned, deleted, verified_absent ou failed. |
| `deleted_at` | `timestamptz` | oui |  | Suppression effective. |
| `verified_at` | `timestamptz` | oui |  | Vérification de disparition et absence de dépendance. |
| `reason` | `text` | non |  | Motif et périmètre du nettoyage. |

PK : `id`.

- UNIQUE `reconciliation_run_id, storage_kind, storage_location, storage_version ; NULLS NOT DISTINCT`.
- FK `reconciliation_run_id → ingest.reconciliation_runs(id) ; ON DELETE RESTRICT`.
- FK `document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.


### ingest.document_reconciliations

Couverture exhaustive d’un ancien artefact avant suppression de ses octets.

Grain : Campagne × métadonnée de document.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Campagne de contrôle. |
| `document_id` | `bigint` | non | PK/FK | Métadonnée d’origine. |
| `records_expected` | `bigint` | non |  | Nombre de records à représenter. |
| `records_linked` | `bigint` | non |  | Records reliés à des faits typés ou métadonnées documentées. |
| `unmapped_fields` | `bigint` | non |  | Champs utiles sans destination typée. |
| `mismatches` | `bigint` | non |  | Valeurs ou états différents après projection inverse définie. |
| `status` | `text` | non |  | pending, failed ou accepted. |
| `semantic_sha256` | `text` | oui |  | Hash de comparaison sémantique ; ne restaure pas les octets supprimés. |

PK : `run_id, document_id`.

- FK `run_id → ingest.reconciliation_runs(id) ; ON DELETE RESTRICT`.
- FK `document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- CHECK `records_expected >= 0 AND records_linked >= 0 AND unmapped_fields >= 0 AND mismatches >= 0`.


### ingest.identity_candidates

File de rapprochements ambigus; aucune identité publiée via ce JSON.

Grain : Source × type d’entité × identifiant externe non résolu.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `source_id` | `bigint` | non | FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `entity_kind` | `text` | non |  | Type d’identité concerné par le rapprochement en attente. |
| `external_id` | `text` | non |  | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `candidate_evidence` | `jsonb` | non |  | Candidats et indices; propositions sans valeur de FK métier. |
| `reason` | `text` | non |  | Motif documenté de l’anomalie ou du rapprochement. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `resolved_at` | `timestamptz` | oui |  | Instant UTC « resolved_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `resolution_notes` | `text` | oui |  | Justification humaine ou automatisée de la décision de rapprochement. |

PK : `id`.

- UNIQUE `source_id, entity_kind, external_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(candidate_evidence) = 'array'`.
- CHECK `entity_kind IN ('competition', 'team', 'player', 'match', 'association', 'venue', 'coach')`.
- CHECK `status IN ('pending', 'resolved', 'rejected')`.
- CHECK `resolved_at >= created_at`.
- CHECK `octet_length(candidate_evidence::text)<=16384`.


### ingest.public_aliases

Correspondances stables des liens publics existants vers les identités internes.

Grain : Type de route × clé publique.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `route_kind` | `text` | non | PK | player, profile, team, competition, match, association, venue ou coach. |
| `public_key` | `text` | non | PK | Identifiant ou slug public historique conservé exactement. |
| `player_id` | `bigint` | oui | FK | Identité interne si route de type player. |
| `team_id` | `bigint` | oui | FK | Identité interne si route de type team. |
| `competition_id` | `bigint` | oui | FK | Identité interne si route de type competition. |
| `match_id` | `bigint` | oui | FK | Identité interne si route de type match. |
| `association_id` | `bigint` | oui | FK | Identité interne si route de type association. |
| `venue_id` | `bigint` | oui | FK | Identité interne si route de type venue. |
| `coach_id` | `bigint` | oui | FK | Identité interne si route de type coach. |
| `profile_version_id` | `bigint` | oui | FK | Version de profil si l’ancien lien porte un suffixe de version. |

PK : `route_kind, public_key`.

- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `competition_id → football.competitions(id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `venue_id → football.venues(id) ; ON DELETE RESTRICT`.
- FK `coach_id → football.coaches(id) ; ON DELETE RESTRICT`.
- FK `profile_version_id, player_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- CHECK `num_nonnulls(player_id,team_id,competition_id,match_id,association_id,venue_id,coach_id)=1`.
- CHECK `profile_version_id IS NULL OR route_kind='profile'`.
- CHECK `(route_kind='profile' AND player_id IS NOT NULL AND profile_version_id IS NOT NULL) OR (route_kind='player' AND player_id IS NOT NULL AND profile_version_id IS NULL) OR (route_kind='team' AND team_id IS NOT NULL) OR (route_kind='competition' AND competition_id IS NOT NULL) OR (route_kind='match' AND match_id IS NOT NULL) OR (route_kind='association' AND association_id IS NOT NULL) OR (route_kind='venue' AND venue_id IS NOT NULL) OR (route_kind='coach' AND coach_id IS NOT NULL)`.

- Contrainte différée : la route et la colonne d’identité doivent correspondre ; profile exige player_id + profile_version_id.
- Les IDs BIGINT ne traversent jamais une conversion JavaScript Number pour conserver les contrats publics.

### ingest.quality_issues

Anomalies et corrections traçables.

Grain : Une anomalie détectée.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `run_id` | `bigint` | oui | FK | Référence SQL vers ingest.import_runs(id). |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `rule_code` | `text` | non |  | Règle de contrôle identifiée et versionnée qui a détecté le problème. |
| `severity` | `text` | non |  | Gravité info, warning, error ou blocking de l’anomalie. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `context` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `detected_at` | `timestamptz` | non |  | Instant UTC « detected_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `resolved_at` | `timestamptz` | oui |  | Instant UTC « resolved_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `resolution` | `text` | oui |  | Traitement réellement effectué pour résoudre ou accepter une anomalie. |

PK : `id`.

- FK `run_id → ingest.import_runs(id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(context) = 'object'`.
- CHECK `severity IN ('info', 'warning', 'error', 'blocking')`.
- CHECK `status IN ('open', 'resolved', 'accepted')`.
- CHECK `resolved_at >= detected_at`.
- CHECK `octet_length(context::text)<=16384`.
- INDEX `btree : [{"column": "severity", "order": "ASC"}, {"column": "detected_at", "order": "ASC"}, {"column": "id", "order": "ASC"}] WHERE status = 'open'`.


### ingest.reconciliation_runs

Preuves de complétude et différences entre origines, observations et SQL final.

Grain : Une campagne de rapprochement.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `status` | `text` | non |  | running, failed ou accepted après vérification de tous les périmètres. |
| `started_at` | `timestamptz` | non |  | Début de campagne. |
| `finished_at` | `timestamptz` | oui |  | Fin effective de campagne. |
| `catalog_fingerprint` | `text` | non |  | Empreinte du catalogue exact attendu au point de coupure. |
| `mapping_version` | `text` | non |  | Version de l’adaptateur et des règles de comparaison. |
| `missing_records` | `bigint` | non |  | Nombre d’observations attendues manquantes. |
| `different_fields` | `bigint` | non |  | Nombre de champs non conformes. |
| `unverified_records` | `bigint` | non |  | Nombre d’observations non vérifiées. |

PK : `id`.

- CHECK `missing_records >= 0 AND different_fields >= 0 AND unverified_records >= 0`.
- CHECK `status IN ('running','failed','accepted')`.


## Compétitions et référentiels

### football.associations

Fédérations sportives.

Grain : Une fédération.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `federation_code` | `text` | oui |  | Code de la fédération sportive, distinct d’un ISO. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `confederation_code` | `text` | oui |  | Code de la confédération sportive. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.


### football.competition_groups

Groupes rattachés à une phase de la même édition.

Grain : Phase × clé de groupe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_stages(id, competition_season_id). |
| `stage_id` | `bigint` | non | FK | Référence SQL vers football.competition_stages(id, competition_season_id). |
| `group_key` | `text` | non |  | Clé de groupe unique dans sa phase. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `stage_id, group_key`.
- UNIQUE `id, stage_id, competition_season_id`.
- UNIQUE `row_version_id`.
- FK `stage_id, competition_season_id → football.competition_stages(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.


### football.competition_seasons

Éditions métier; leur clé ne se déduit pas du nom du dossier.

Grain : Compétition × édition.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_id` | `bigint` | non | FK | Référence SQL vers football.competitions(id). |
| `season_key` | `text` | non |  | Saison métier de l’édition : par exemple 2026 ou 2026/2027 ; jamais déduite du seul répertoire. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `start_date` | `date` | oui |  | Première date métier connue de l’édition. |
| `end_date` | `date` | oui |  | Dernière date métier connue de l’édition. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `competition_id, season_key`.
- UNIQUE `row_version_id`.
- FK `competition_id → football.competitions(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `status IN ('planned', 'active', 'completed', 'cancelled', 'unknown')`.
- CHECK `end_date >= start_date`.


### football.competition_stages

Phases d’une édition et leur hiérarchie.

Grain : Édition × clé de phase.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id); football.competition_stages(id, competition_season_id). |
| `parent_stage_id` | `bigint` | oui | FK | Référence SQL vers football.competition_stages(id, competition_season_id). |
| `stage_key` | `text` | non |  | Clé de phase unique dans son édition. |
| `stage_type` | `text` | non |  | Type de phase défini par les valeurs autorisées. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `sequence_no` | `integer` | oui |  | Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `competition_season_id, stage_key`.
- UNIQUE `id, competition_season_id`.
- UNIQUE `row_version_id`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `parent_stage_id, competition_season_id → football.competition_stages(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `parent_stage_id <> id`.
- CHECK `stage_type IN ('league', 'group', 'knockout', 'qualifying', 'playoff', 'final', 'other', 'unknown')`.


### football.competition_teams

Engagements d’une équipe dans une édition.

Grain : Édition × équipe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non | PK/FK | Référence SQL vers football.competition_seasons(id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `entered_on` | `date` | oui |  | Date d’engagement de l’équipe dans l’édition si réellement connue. |
| `exited_on` | `date` | oui |  | Date de sortie de l’édition si réellement connue. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `competition_season_id, team_id`.

- UNIQUE `row_version_id`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `status IN ('observed', 'confirmed', 'withdrawn', 'disqualified')`.
- CHECK `exited_on >= entered_on`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}, {"column": "competition_season_id", "order": "ASC"}]`.


### football.competitions

Compétitions stables indépendamment des saisons.

Grain : Une compétition.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `slug` | `text` | non |  | Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases. |
| `competition_type` | `text` | non |  | Nature league, cup, tournament, supercup, friendly, other ou unknown. |
| `association_id` | `bigint` | oui | FK | Référence SQL vers football.associations(id). |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `gender` | `text` | non |  | Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `age_category` | `text` | oui |  | Catégorie d’âge déclarée ; ne pas la déduire sans preuve. |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `slug`.
- UNIQUE `row_version_id`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `competition_type IN ('league', 'cup', 'tournament', 'supercup', 'friendly', 'other', 'unknown')`.
- CHECK `gender IN ('men', 'women', 'mixed', 'unknown')`.


### football.countries

Territoires géographiques; les fédérations sportives sont séparées.

Grain : Un territoire.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `iso2` | `text` | oui |  | Code ISO à deux lettres uniquement lorsqu’il existe. |
| `iso3` | `text` | oui |  | Code ISO à trois lettres uniquement lorsqu’il existe. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `iso2`.
- UNIQUE `iso3`.
- UNIQUE `row_version_id`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `iso2 ~ '^[A-Z]{2}$'`.
- CHECK `iso3 ~ '^[A-Z]{3}$'`.


### football.venues

Stades et caractéristiques datées lorsqu’elles évoluent.

Grain : Un stade.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `city` | `text` | oui |  | Ville du stade, si connue. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `latitude` | `double precision` | oui |  | Latitude géographique du stade, entre −90 et 90. |
| `longitude` | `double precision` | oui |  | Longitude géographique du stade, entre −180 et 180. |
| `capacity` | `integer` | oui |  | Capacité du stade observée à capacity_as_of. |
| `capacity_as_of` | `date` | oui |  | Date de validité connue de la capacité. |
| `opened_year` | `integer` | oui |  | Année d’ouverture connue ; une date imprécise ne devient pas une année inventée. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `latitude BETWEEN -90 AND 90`.
- CHECK `longitude BETWEEN -180 AND 180`.
- CHECK `capacity >= 0`.
- CHECK `opened_year > 0`.
- CHECK `latitude NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `longitude NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.


## Identités et profils

### football.association_profile_versions

Versions observées des noms, codes, emblèmes et affiliations d’un association.

Grain : Identité × observation de profil.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `association_id` | `bigint` | non | FK | Identité canonique observée. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `observed_at` | `timestamptz` | non |  | Date de récupération effective. |
| `display_name` | `text` | oui |  | Nom affiché dans cette version. |
| `short_name` | `text` | oui |  | Nom court natif. |
| `official_name` | `text` | oui |  | Nom officiel natif. |
| `international_name` | `text` | oui |  | Nom international natif. |
| `country_code_source` | `text` | oui |  | Code pays natif, sans assimilation automatique à un ISO. |
| `team_code_source` | `text` | oui |  | Code fournisseur observé. |
| `image_asset_id` | `bigint` | oui | FK | Emblème ou portrait référencé. |
| `valid_from` | `date` | oui |  | Début de validité déclaré par la source, si connu. |
| `valid_to` | `date` | oui |  | Fin de validité déclarée. |
| `from_year` | `integer` | oui |  | Année de validité native si la date précise est inconnue. |
| `to_year` | `integer` | oui |  | Année de fin native. |
| `from_phases` | `text[]` | oui |  | Codes de phase fournisseur de début, ordre conservé. |
| `to_phases` | `text[]` | oui |  | Codes de phase fournisseur de fin. |
| `inherit_team_external_id` | `text` | oui |  | Identifiant d’héritage natif ; rapprochement contrôlé. |
| `is_placeholder` | `boolean` | oui |  | Identité temporaire explicitement indiquée par la source. |
| `is_national` | `boolean` | oui |  | Indicateur natif d’équipe nationale. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `association_id, source_record_id`.
- UNIQUE `row_version_id`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `valid_to>=valid_from`.


### football.association_source_ids

Identifiants externes typés de association.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `association_id` | `bigint` | non | FK | Référence SQL vers football.associations(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "association_id", "order": "ASC"}]`.


### football.coach_source_ids

Identifiants externes typés de coach.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `coach_id` | `bigint` | non | FK | Référence SQL vers football.coaches(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `coach_id → football.coaches(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "coach_id", "order": "ASC"}]`.


### football.competition_source_ids

Identifiants externes typés de competition.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `competition_id` | `bigint` | non | FK | Référence SQL vers football.competitions(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `competition_id → football.competitions(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "competition_id", "order": "ASC"}]`.


### football.match_source_ids

Identifiants externes typés de match.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.matches(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "match_id", "order": "ASC"}]`.


### football.player_profile_versions

Profils observés versionnés, distincts de playerId.

Grain : Source × identifiant de version de profil.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `external_profile_version_id` | `text` | non |  | Ancien identifiant public de version de profil, distinct de l’identité joueur. |
| `display_name` | `text` | non |  | Nom d’affichage observé ou sélectionné pour cette identité. |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `observed_at` | `timestamptz` | non |  | Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `short_name` | `text` | oui |  | Nom court fournisseur. |
| `country_code_source` | `text` | oui |  | Code pays natif, distinct d’un ISO déduit. |
| `raw_position_code` | `text` | oui |  | Code de poste natif avant mapping validé. |
| `shirt_number` | `text` | oui |  | Numéro de profil conservé comme texte, y compris chaîne vide. |
| `birth_date` | `date` | oui |  | Date de naissance observée dans cette version, si disponible. |
| `height_cm` | `smallint` | oui |  | Taille observée dans cette version, en centimètres. |
| `dominant_foot` | `text` | oui |  | Pied dominant observé dans cette version, si disponible. |
| `profile_content_sha256` | `text` | non |  | Empreinte des attributs typés du profil ; l’ancien ID peut être réutilisé avec d’autres attributs. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `source_id, external_profile_version_id, profile_content_sha256`.
- UNIQUE `id, player_id`.
- UNIQUE `row_version_id`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `profile_content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}, {"column": "observed_at", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.


### football.player_source_ids

Identifiants externes typés de player.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}]`.


### football.player_team_memberships

Appartenances confirmées ou observations de participation.

Grain : Un épisode d’appartenance ou d’observation.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `membership_type` | `text` | non |  | Appartenance club, prêt, sélection, observation ou autre ; simultanéité club/sélection permise. |
| `valid_from` | `date` | oui |  | Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Fin de validité connue ; NULL conserve une borne inconnue. |
| `date_precision` | `text` | non |  | Précision réelle des dates : day, month, year ou unknown. |
| `observed_from` | `date` | oui |  | Première observation de l’appartenance. |
| `observed_to` | `date` | oui |  | Dernière observation de l’appartenance. |
| `evidence_kind` | `text` | non |  | Nature de preuve : contrat, effectif, match, profil ou revue manuelle. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `membership_type IN ('club', 'loan', 'national', 'observed', 'other')`.
- CHECK `date_precision IN ('day', 'month', 'year', 'unknown')`.
- CHECK `evidence_kind IN ('official_roster', 'contract', 'match_observation', 'provider_profile', 'manual_review')`.
- CHECK `valid_to >= valid_from`.
- CHECK `observed_to >= observed_from`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}, {"column": "observed_from", "order": "ASC"}]`.

- Aucune exclusivité globale: club et sélection peuvent coexister.
- Une première apparition ne prouve pas une date de signature.

### football.players

Identités stables de joueurs; une ligne indépendante des profils source.

Grain : Une personne joueur.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `display_name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `birth_date` | `date` | oui |  | Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `dominant_foot` | `text` | oui |  | Pied dominant connu : left, right, both ou unknown. |
| `height_cm` | `smallint` | oui |  | Taille connue en centimètres. |
| `primary_position_code` | `text` | oui | FK | Référence SQL vers football.positions(code). |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `nationality_country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `primary_position_code → football.positions(code) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `dominant_foot IN ('left', 'right', 'both', 'unknown')`.
- CHECK `height_cm > 0`.


### football.position_mappings

Traductions versionnées des codes de poste fournisseur.

Grain : Source × code brut × version de mapping.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id). |
| `raw_position_code` | `text` | non | PK | Code natif du poste ; résolution uniquement avec une version de mapping validée. |
| `mapping_version` | `text` | non | PK | Version de la traduction des valeurs fournisseur. |
| `position_code` | `text` | oui | FK | Référence SQL vers football.positions(code). |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `evidence` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, raw_position_code, mapping_version`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `position_code → football.positions(code) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(evidence) = 'object'`.
- CHECK `status IN ('unresolved', 'validated', 'rejected')`.
- CHECK `status <> 'validated' OR position_code IS NOT NULL`.
- CHECK `octet_length(evidence::text)<=16384`.


### football.positions

Rôles canoniques dont la définition est validée.

Grain : Un code de rôle.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non | PK | Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `family` | `text` | non |  | Famille de poste : gardien, défenseur, milieu ou attaquant. |
| `definition` | `text` | non |  | Définition sémantique du code et de ses conditions d’utilisation. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `code`.

- UNIQUE `row_version_id`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `family IN ('goalkeeper', 'defender', 'midfielder', 'forward')`.


### football.team_aliases

Noms alternatifs ou historiques pour l’affichage et la résolution.

Grain : Un alias observé dans un contexte source.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `alias` | `text` | non |  | Nom alternatif ou historique d’une équipe, conservé avec langue, source et validité. |
| `language_code` | `text` | oui |  | Langue de cet alias lorsqu’elle est connue. |
| `source_id` | `bigint` | oui | FK | Référence SQL vers ingest.sources(id). |
| `valid_from` | `date` | oui |  | Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Fin de validité connue ; NULL conserve une borne inconnue. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `team_id, alias, language_code, source_id, valid_from ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `valid_to >= valid_from`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}]`.


### football.team_profile_versions

Versions observées des noms, codes, emblèmes et affiliations d’un team.

Grain : Identité × observation de profil.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `team_id` | `bigint` | non | FK | Identité canonique observée. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `observed_at` | `timestamptz` | non |  | Date de récupération effective. |
| `display_name` | `text` | oui |  | Nom affiché dans cette version. |
| `short_name` | `text` | oui |  | Nom court natif. |
| `official_name` | `text` | oui |  | Nom officiel natif. |
| `international_name` | `text` | oui |  | Nom international natif. |
| `country_code_source` | `text` | oui |  | Code pays natif, sans assimilation automatique à un ISO. |
| `team_code_source` | `text` | oui |  | Code fournisseur observé. |
| `image_asset_id` | `bigint` | oui | FK | Emblème ou portrait référencé. |
| `association_id` | `bigint` | oui | FK | Affiliation sportive si connue. |
| `valid_from` | `date` | oui |  | Début de validité déclaré par la source, si connu. |
| `valid_to` | `date` | oui |  | Fin de validité déclarée. |
| `from_year` | `integer` | oui |  | Année de validité native si la date précise est inconnue. |
| `to_year` | `integer` | oui |  | Année de fin native. |
| `from_phases` | `text[]` | oui |  | Codes de phase fournisseur de début, ordre conservé. |
| `to_phases` | `text[]` | oui |  | Codes de phase fournisseur de fin. |
| `inherit_team_external_id` | `text` | oui |  | Identifiant d’héritage natif ; rapprochement contrôlé. |
| `is_placeholder` | `boolean` | oui |  | Identité temporaire explicitement indiquée par la source. |
| `is_national` | `boolean` | oui |  | Indicateur natif d’équipe nationale. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `team_id, source_record_id`.
- UNIQUE `row_version_id`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `valid_to>=valid_from`.


### football.team_source_ids

Identifiants externes typés de team.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}]`.


### football.teams

Équipes sportives, distinctes des fédérations et des organisations futures.

Grain : Une équipe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `short_name` | `text` | oui |  | Nom court observé. |
| `slug` | `text` | non |  | Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases. |
| `team_type` | `text` | non |  | Club, sélection nationale, équipe représentative ou type inconnu. |
| `gender` | `text` | non |  | Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `age_category` | `text` | oui |  | Catégorie d’âge déclarée ; ne pas la déduire sans preuve. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `association_id` | `bigint` | oui | FK | Référence SQL vers football.associations(id). |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `founded_year` | `integer` | oui |  | Année de fondation lorsqu’elle est sourcée. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `slug`.
- UNIQUE `row_version_id`.
- FK `country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `team_type IN ('club', 'national', 'representative', 'unknown')`.
- CHECK `gender IN ('men', 'women', 'mixed', 'unknown')`.
- CHECK `founded_year > 0`.


### football.venue_source_ids

Identifiants externes typés de venue.

Grain : Source × identifiant externe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `venue_id` | `bigint` | non | FK | Référence SQL vers football.venues(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, external_id`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `venue_id → football.venues(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- INDEX `btree : [{"column": "venue_id", "order": "ASC"}]`.


## Matchs et participations

### football.match_events

Flux courant d’événements remplacé atomiquement lors d’une correction.

Grain : Match × ordinal dans la version courante.

Écriture : `replace_family_atomically` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id); football.match_teams(match_id, team_id). |
| `event_seq` | `integer` | non | PK | Ordre dans une version du flux ; ne constitue pas une identité stable entre corrections. |
| `event_type` | `text` | non |  | Type d’événement observé ; mapping versionné si normalisé. |
| `period_code` | `text` | oui | FK | Référence SQL vers football.periods(code). |
| `minute` | `integer` | oui |  | Minute source dans la période indiquée ; précision conservée. |
| `minute_added` | `integer` | oui |  | Temps additionnel distinct de la minute principale. |
| `second` | `smallint` | oui |  | Seconde dans la minute, de 0 à 59. |
| `team_id` | `bigint` | oui | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id). |
| `related_player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id). |
| `is_penalty` | `boolean` | oui |  | Penalty explicitement signalé dans l’observation. |
| `is_own_goal` | `boolean` | oui |  | But contre son camp explicitement signalé. |
| `source_event_id` | `text` | oui |  | Identifiant natif d’événement s’il existe ; sinon ordre dans la famille versionnée. |
| `source_ordinal` | `integer` | non |  | Position native dans la collection source, conservée pour la compatibilité. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `score_home` | `integer` | oui |  | Score observé après l’événement, sans supposer sa portée si la source ne la donne pas. |
| `score_away` | `integer` | oui |  | Score observé après l’événement, sans supposer sa portée si la source ne la donne pas. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, event_seq`.

- UNIQUE `row_version_id`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `related_player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `event_seq >= 0`.
- CHECK `source_ordinal >= 0`.
- CHECK `minute >= 0`.
- CHECK `minute_added >= 0`.
- CHECK `second BETWEEN 0 AND 59`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- event_seq n’est pas une identité entre deux versions du payload.
- Ne pas rendre unique minute + joueur + type.
- Les joueurs liés sont des identités; une ligne de statistiques complète n’est pas exigée.

### football.match_h2h_entries

Rencontres précédentes effectivement observées dans une réponse H2H, y compris une identité non encore résolue.

Grain : Match contexte × ordinal dans une version de H2H.

Écriture : `replace_family_atomically` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Rencontre pour laquelle le H2H a été collecté. |
| `entry_ordinal` | `integer` | non | PK | Ordre du fournisseur. |
| `previous_match_id` | `bigint` | oui | FK | Rencontre antérieure résolue si possible ; aucune identité inventée. |
| `external_match_id` | `text` | oui |  | Identifiant public natif de la rencontre antérieure. |
| `match_date` | `date` | oui |  | Date connue de cette rencontre. |
| `time_utc_source` | `text` | oui |  | Heure native ; chaîne vide distincte d’absence. |
| `status_source` | `text` | oui |  | Statut natif observé. |
| `home_team_id` | `bigint` | oui | FK | Équipe domicile si résolue. |
| `away_team_id` | `bigint` | oui | FK | Équipe extérieure si résolue. |
| `home_label` | `text` | oui |  | Libellé domicile observé. |
| `away_label` | `text` | oui |  | Libellé extérieur observé. |
| `home_score` | `integer` | oui |  | Score natif connu ; portée non inventée. |
| `away_score` | `integer` | oui |  | Score natif connu. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `home_image_asset_id` | `bigint` | oui | FK | Média de l’équipe effectivement observé dans cette ligne H2H. |
| `away_image_asset_id` | `bigint` | oui | FK | Média de l’équipe effectivement observé dans cette ligne H2H. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, entry_ordinal`.

- UNIQUE `row_version_id`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `previous_match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `home_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `away_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `home_image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `away_image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.


### football.match_lineups

Composition retenue d’une équipe.

Grain : Match × équipe.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `formation` | `text` | oui |  | Formation observée, conservée comme libellé. |
| `confirmed` | `boolean` | oui |  | Confirmation explicite de la composition ; une prédiction ne vaut pas confirmation. |
| `lineup_type` | `text` | non |  | Nature confirmed, predicted, observed ou unknown de la composition. |
| `published_at` | `timestamptz` | oui |  | Publication déclarée ou activation, selon le grain de cette table. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, team_id`.

- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `lineup_type IN ('confirmed', 'predicted', 'observed', 'unknown')`.
- CHECK `octet_length(quality_flags::text)<=16384`.


### football.match_observation_details

Faits contextuels observés dans les résultats et archives complémentaires.

Grain : Un enregistrement source décrivant une rencontre.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_record_id` | `bigint` | non | PK/FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `match_id` | `bigint` | oui | FK | Match résolu ; rapprochement incertain conservé explicitement. |
| `source_competition_label` | `text` | oui |  | Libellé de compétition observé. |
| `source_season_label` | `text` | oui |  | Saison métier native. |
| `source_match_key` | `text` | oui |  | Clé ou numéro local de rencontre. |
| `source_home_label` | `text` | oui |  | Nom domicile observé. |
| `source_away_label` | `text` | oui |  | Nom extérieur observé. |
| `source_date_text` | `text` | oui |  | Date native, y compris annotations et précision. |
| `date_note` | `text` | oui |  | Note de date ou d’incertitude. |
| `source_time_text` | `text` | oui |  | Heure native sans conversion abusive. |
| `source_round_label` | `text` | oui |  | Tour/journée natif. |
| `source_stage_label` | `text` | oui |  | Phase native. |
| `source_group_label` | `text` | oui |  | Groupe natif. |
| `source_venue_label` | `text` | oui |  | Stade observé. |
| `attendance` | `integer` | oui |  | Affluence si l’entier est réellement fourni. |
| `attendance_text` | `text` | oui |  | Forme native de l’affluence si imprécise. |
| `result_code` | `text` | oui |  | Code de résultat source. |
| `notes` | `text` | oui |  | Commentaires métier du match. |
| `resolution_state` | `text` | non |  | resolved, ambiguous ou unavailable. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_record_id`.

- UNIQUE `row_version_id`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Scores, événements, métriques et affiliations vont dans leurs tables métier ; aucune colonne sourceFields/extra JSONB.
- Les codes supplémentaires doivent recevoir un contrat de champ et une destination typée avant purge ; pas de conservation opaque de la ligne d’archive.

### football.match_players

Joueurs listés ou observés; le banc ne prouve pas une apparition.

Grain : Match × joueur.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id); football.player_profile_versions(id, player_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `profile_version_id` | `bigint` | oui | FK | Référence SQL vers football.player_profile_versions(id, player_id). |
| `is_starter` | `boolean` | oui |  | Statut titulaire observé ; ne pas le déduire de statistiques manquantes. |
| `squad_status` | `text` | non |  | Titulaire, remplaçant, remplaçant inutilisé, observation ou état inconnu. |
| `played` | `boolean` | oui |  | Participation prouvée dans match_players ; dans un classement, nombre de matchs joués. |
| `participation_evidence` | `text` | oui |  | Preuve explicite qui justifie played ; une ligne de performance ne suffit pas. |
| `shirt_number` | `text` | oui |  | Numéro natif conservé en texte ; la forme et le type d’origine sont traçables par field_states. |
| `raw_position_code` | `text` | oui | FK | Référence SQL vers football.position_mappings(source_id, raw_position_code, mapping_version). |
| `position_code` | `text` | oui | FK | Référence SQL vers football.positions(code). |
| `position_mapping_version` | `text` | oui | FK | Référence SQL vers football.position_mappings(source_id, raw_position_code, mapping_version). |
| `raw_pitch_x` | `double precision` | oui |  | Coordonnée native de placement du joueur ; pas une distance en mètres supposée. |
| `raw_pitch_y` | `double precision` | oui |  | Seconde coordonnée native de placement du joueur. |
| `coordinate_frame` | `text` | oui |  | Repère spatial déclaré par la source, propre à cette famille. |
| `is_captain` | `boolean` | oui |  | Capitanat explicitement indiqué dans la composition. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, player_id`.

- UNIQUE `match_id, player_id, team_id`.
- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `profile_version_id, player_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `position_code → football.positions(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `source_id, raw_position_code, position_mapping_version → football.position_mappings(source_id, raw_position_code, mapping_version) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `squad_status IN ('starter', 'substitute', 'unused_substitute', 'observed', 'unknown')`.
- CHECK `position_mapping_version IS NULL OR raw_position_code IS NOT NULL`.
- CHECK `played IS NULL OR participation_evidence IS NOT NULL`.
- CHECK `(raw_pitch_x IS NULL AND raw_pitch_y IS NULL) OR coordinate_frame IS NOT NULL`.
- CHECK `raw_pitch_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `raw_pitch_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.


### football.match_scores

Scores à périmètre explicite; les valeurs cumulées ne s’additionnent pas.

Grain : Match × côté × portée du score.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, side). |
| `side` | `text` | non | PK/FK | Référence SQL vers football.match_teams(match_id, side). |
| `score_scope` | `text` | non | PK | Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance. |
| `goals` | `integer` | oui |  | Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `score_basis` | `text` | non |  | Score effectivement joué, attribué administrativement ou de base inconnue. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, side, score_scope`.

- UNIQUE `row_version_id`.
- FK `match_id, side → football.match_teams(match_id, side) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `score_scope IN ('half_time', 'regulation', 'after_extra_time', 'shootout', 'final_without_shootout')`.
- CHECK `score_basis IN ('played', 'awarded', 'unknown')`.
- CHECK `goals >= 0`.
- CHECK `octet_length(quality_flags::text)<=16384`.


### football.match_teams

Places domicile/extérieur: seul emplacement canonique des participants.

Grain : Match × côté.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id). |
| `side` | `text` | non | PK | Place home ou away du participant dans ce match. |
| `team_id` | `bigint` | oui | FK | Référence SQL vers football.teams(id). |
| `participant_label` | `text` | oui |  | Libellé de participant encore non résolu, par exemple vainqueur d’une demi-finale. |
| `coach_id` | `bigint` | oui | FK | Référence SQL vers football.coaches(id). |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, side`.

- UNIQUE `match_id, team_id`.
- UNIQUE `row_version_id`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `coach_id → football.coaches(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `side IN ('home', 'away')`.
- CHECK `team_id IS NOT NULL OR participant_label IS NOT NULL`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}] WHERE team_id IS NOT NULL`.


### football.matches

Matchs canoniques; date civile et instant de coup d’envoi restent distincts.

Grain : Un match.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id); football.competition_stages(id, competition_season_id); football.competition_groups(id, stage_id, competition_season_id). |
| `stage_id` | `bigint` | oui | FK | Référence SQL vers football.competition_stages(id, competition_season_id); football.competition_groups(id, stage_id, competition_season_id). |
| `group_id` | `bigint` | oui | FK | Référence SQL vers football.competition_groups(id, stage_id, competition_season_id). |
| `round_label` | `text` | oui |  | Tour ou journée tel qu’observé ; ne présume pas un ordre numérique. |
| `round_number` | `integer` | oui |  | Numéro de journée/tour lorsqu’il est explicitement connu. |
| `leg_number` | `smallint` | oui |  | Manche d’une confrontation aller/retour. |
| `tie_key` | `text` | oui |  | Clé qui regroupe les manches d’une confrontation. |
| `match_date` | `date` | oui |  | Date civile connue du match ; une heure inconnue ne crée pas un instant minuit fictif. |
| `kickoff_at` | `timestamptz` | oui |  | Instant UTC du coup d’envoi, uniquement lorsque l’heure est connue. |
| `kickoff_precision` | `text` | non |  | Précision réellement fournie : unknown, date, minute ou second. |
| `source_timezone` | `text` | oui |  | Fuseau de la date/heure source si connu, utilisé pour la conversion explicite. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `publication_state` | `text` | non |  | draft, published ou quarantined ; les invariants renforcés s’appliquent à la publication. |
| `venue_id` | `bigint` | oui | FK | Référence SQL vers football.venues(id). |
| `neutral_venue` | `boolean` | oui |  | Terrain neutre si explicitement connu. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `stage_id, competition_season_id → football.competition_stages(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `group_id, stage_id, competition_season_id → football.competition_groups(id, stage_id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `venue_id → football.venues(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `group_id IS NULL OR stage_id IS NOT NULL`.
- CHECK `kickoff_precision IN ('unknown', 'date', 'minute', 'second')`.
- CHECK `(kickoff_precision = 'unknown' AND kickoff_at IS NULL) OR (kickoff_precision = 'date' AND match_date IS NOT NULL AND kickoff_at IS NULL) OR (kickoff_precision IN ('minute','second') AND kickoff_at IS NOT NULL)`.
- CHECK `status IN ('not_started', 'in_play', 'half_time', 'extra_time', 'shootout', 'finished', 'postponed', 'suspended', 'abandoned', 'awarded', 'canceled', 'unknown')`.
- CHECK `publication_state IN ('draft', 'published', 'quarantined')`.
- CHECK `leg_number > 0`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "match_date", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.
- INDEX `btree : [{"column": "match_date", "order": "ASC"}, {"column": "status", "order": "ASC"}, {"column": "id", "order": "ASC"}]`.


## Statistiques et périodes

### football.metric_definitions

Définitions de métriques et règles d’agrégation.

Grain : Un code de métrique avec définition stable.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non | PK | Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `definition` | `text` | non |  | Définition sémantique du code et de ses conditions d’utilisation. |
| `unit` | `text` | non |  | Unité déclarée et versionnée de la métrique. |
| `scope` | `text` | non |  | Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent. |
| `aggregation` | `text` | non |  | Règle sum, weighted_mean, ratio_of_sums, last ou none de cette métrique. |
| `minimum` | `double precision` | oui |  | Borne inférieure documentée de cette métrique. |
| `maximum` | `double precision` | oui |  | Borne supérieure documentée de cette métrique. |
| `allows_negative` | `boolean` | non |  | Autorisation explicite de valeurs signées pour cette métrique. |
| `numerator_code` | `text` | oui | FK | Référence SQL vers football.metric_definitions(code). |
| `denominator_code` | `text` | oui | FK | Référence SQL vers football.metric_definitions(code). |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `code`.

- UNIQUE `row_version_id`.
- FK `numerator_code → football.metric_definitions(code) ; ON DELETE RESTRICT`.
- FK `denominator_code → football.metric_definitions(code) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `scope IN ('player', 'team', 'shot', 'network', 'ranking')`.
- CHECK `aggregation IN ('sum', 'weighted_mean', 'ratio_of_sums', 'last', 'none')`.
- CHECK `maximum >= minimum`.
- CHECK `minimum NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `maximum NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.


### football.periods

Périodes explicites; full_match ne s’ajoute pas à ses composantes.

Grain : Une période canonique.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non | PK | Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `sequence_no` | `integer` | non |  | Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire. |
| `is_aggregate` | `boolean` | non |  | Indique qu’une période recouvre d’autres périodes ; empêche leur addition naïve. |
| `definition` | `text` | non |  | Définition sémantique du code et de ses conditions d’utilisation. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `code`.

- UNIQUE `row_version_id`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.


### football.player_match_advanced

Mesures avancées joueur avec modèle fournisseur identifié.

Grain : Match × player × période.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `period_code` | `text` | non | PK/FK | Référence SQL vers football.periods(code). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `progressive_passes` | `integer` | oui |  | Passes progressives selon la définition du fournisseur. |
| `passes_into_box` | `integer` | oui |  | Passes dans la surface. |
| `key_passes` | `integer` | oui |  | Passes clés selon le fournisseur. |
| `through_balls` | `integer` | oui |  | Passes en profondeur. |
| `crosses` | `integer` | oui |  | Centres du contrat avancé. |
| `switches` | `integer` | oui |  | Renversements de jeu du contrat avancé. |
| `carries` | `integer` | oui |  | Conduites de balle observées. |
| `progressive_carries` | `integer` | oui |  | Conduites progressives. |
| `carries_into_final_third` | `integer` | oui |  | Conduites dans le dernier tiers. |
| `carries_into_box` | `integer` | oui |  | Conduites dans la surface. |
| `take_ons` | `integer` | oui |  | Tentatives de duel offensif. |
| `take_ons_won` | `integer` | oui |  | Duels offensifs réussis. |
| `miscontrols` | `integer` | oui |  | Mauvais contrôles observés. |
| `dispossessed` | `integer` | oui |  | Pertes sur dépossession. |
| `sca` | `integer` | oui |  | Actions menant à un tir selon la méthode du fournisseur. |
| `gca` | `integer` | oui |  | Actions menant à un but selon cette méthode. |
| `second_assists` | `integer` | oui |  | Avant-dernières passes décisives attribuées. |
| `xt_total` | `double precision` | oui |  | Expected threat fournisseur, valeur signée ; modèle identifié séparément. |
| `vaep_total` | `double precision` | oui |  | Valeur VAEP totale fournisseur, signée. |
| `vaep_offensive` | `double precision` | oui |  | Composante offensive VAEP, signée. |
| `vaep_defensive` | `double precision` | oui |  | Composante défensive VAEP, signée. |
| `pv_total` | `double precision` | oui |  | Valeur totale de possession du modèle fournisseur. |
| `pv_offensive` | `double precision` | oui |  | Composante offensive de possession. |
| `pv_defensive` | `double precision` | oui |  | Composante défensive de possession. |
| `progressive_pass_distance` | `double precision` | oui |  | Distance des passes progressives, unité fournisseur à valider. |
| `carry_distance` | `double precision` | oui |  | Distance de conduite, unité fournisseur à valider. |
| `progressive_carry_distance` | `double precision` | oui |  | Distance des conduites progressives selon ce contrat. |
| `xag` | `double precision` | oui |  | Expected assisted goals selon le modèle fournisseur. |
| `xg_chain` | `double precision` | oui |  | Contribution xG de chaîne de possession selon ce modèle. |
| `xg_buildup` | `double precision` | oui |  | Contribution xG de construction selon ce modèle. |
| `provider_model_version` | `text` | oui |  | Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `sca_pass_live` | `double precision` | oui |  | Contribution SCA de type pass_live, valeur observée selon la définition fournisseur. |
| `sca_pass_dead` | `double precision` | oui |  | Contribution SCA de type pass_dead, valeur observée selon la définition fournisseur. |
| `sca_take_on` | `double precision` | oui |  | Contribution SCA de type take_on, valeur observée selon la définition fournisseur. |
| `sca_shot` | `double precision` | oui |  | Contribution SCA de type shot, valeur observée selon la définition fournisseur. |
| `sca_foul_drawn` | `double precision` | oui |  | Contribution SCA de type foul_drawn, valeur observée selon la définition fournisseur. |
| `sca_defensive` | `double precision` | oui |  | Contribution SCA de type defensive, valeur observée selon la définition fournisseur. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, player_id, period_code`.

- UNIQUE `row_version_id`.
- FK `match_id, player_id, team_id → football.match_players(match_id, player_id, team_id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `progressive_passes >= 0`.
- CHECK `passes_into_box >= 0`.
- CHECK `key_passes >= 0`.
- CHECK `through_balls >= 0`.
- CHECK `crosses >= 0`.
- CHECK `switches >= 0`.
- CHECK `carries >= 0`.
- CHECK `progressive_carries >= 0`.
- CHECK `carries_into_final_third >= 0`.
- CHECK `carries_into_box >= 0`.
- CHECK `take_ons >= 0`.
- CHECK `take_ons_won >= 0`.
- CHECK `miscontrols >= 0`.
- CHECK `dispossessed >= 0`.
- CHECK `sca >= 0`.
- CHECK `gca >= 0`.
- CHECK `second_assists >= 0`.
- CHECK `progressive_pass_distance >= 0`.
- CHECK `carry_distance >= 0`.
- CHECK `progressive_carry_distance >= 0`.
- CHECK `xag >= 0`.
- CHECK `xg_chain >= 0`.
- CHECK `xg_buildup >= 0`.
- CHECK `take_ons_won <= take_ons`.
- CHECK `xt_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `vaep_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `vaep_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `vaep_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pv_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pv_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pv_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `progressive_pass_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `carry_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `progressive_carry_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xag NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xg_chain NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xg_buildup NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sca_pass_live NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sca_pass_dead NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sca_take_on NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sca_shot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sca_foul_drawn NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sca_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.


### football.player_match_metric_values

Métriques secondaires enregistrées, avec types, unité et fractions explicites.

Grain : Match × player × période × famille standard/advanced × métrique.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Match du fait. |
| `player_id` | `bigint` | non | PK/FK | Identité concernée. |
| `team_id` | `bigint` | non | FK | Équipe du joueur dans ce match. |
| `period_code` | `text` | non | PK/FK | Période explicitement définie. |
| `family_code` | `text` | non | PK | standard ou advanced. |
| `metric_code` | `text` | non | PK/FK | Métrique enregistrée et définie ; aucune clé arbitraire. |
| `value_kind` | `text` | non |  | number, string ou boolean ; NULL/absence distingués par les états de champ. |
| `numeric_value` | `numeric` | oui |  | Valeur numérique exacte de cette métrique. |
| `text_value` | `text` | oui |  | Valeur textuelle si le contrat de métrique l’autorise. |
| `boolean_value` | `boolean` | oui |  | Valeur booléenne si définie comme telle. |
| `numerator` | `numeric` | oui |  | Numérateur fourni, sans le déduire d’un taux arrondi. |
| `denominator` | `numeric` | oui |  | Dénominateur observé. |
| `source_display` | `text` | oui |  | Forme affichée native d’un scalaire, par exemple 12/15 ou 75%. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, player_id, period_code, family_code, metric_code`.

- UNIQUE `row_version_id`.
- FK `metric_code → football.metric_definitions(code) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `match_id, player_id, team_id → football.match_players(match_id, player_id, team_id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `num_nonnulls(numeric_value,text_value,boolean_value)=1`.
- CHECK `family_code IN ('standard','advanced')`.
- CHECK `(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL)`.


### football.player_match_stats

Statistiques joueur canoniques, NULL si non observées.

Grain : Match × player × période.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `period_code` | `text` | non | PK/FK | Référence SQL vers football.periods(code). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `goals` | `integer` | oui |  | Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `assists` | `integer` | oui |  | Passes décisives attribuées par le fournisseur dans cette période. |
| `shots` | `integer` | oui |  | Nombre de tirs observés selon la définition source. |
| `shots_on_target` | `integer` | oui |  | Tirs cadrés observés selon la définition source. |
| `chances_created` | `integer` | oui |  | Occasions créées attribuées par la source. |
| `big_chances_created` | `integer` | oui |  | Grosses occasions créées selon la définition source. |
| `passes_completed` | `integer` | oui |  | Passes réussies observées. |
| `passes_attempted` | `integer` | oui |  | Passes tentées observées, dénominateur des taux. |
| `passes_final_third` | `integer` | oui |  | Passes dans le dernier tiers selon le contrat source. |
| `defensive_actions` | `integer` | oui |  | Actions défensives selon le contrat de la mesure. |
| `interceptions` | `integer` | oui |  | Interceptions observées. |
| `tackles` | `integer` | oui |  | Tacles selon la définition source. |
| `recoveries` | `integer` | oui |  | Ballons récupérés. |
| `duels_won` | `integer` | oui |  | Duels gagnés observés. |
| `duels_lost` | `integer` | oui |  | Duels perdus observés. |
| `aerial_duels_won` | `integer` | oui |  | Duels aériens gagnés. |
| `aerial_duels_attempted` | `integer` | oui |  | Duels aériens disputés, dénominateur connu. |
| `touches` | `integer` | oui |  | Ballons touchés selon le fournisseur. |
| `touches_box` | `integer` | oui |  | Ballons touchés dans la surface. |
| `clearances` | `integer` | oui |  | Dégagements observés. |
| `blocks` | `integer` | oui |  | Actions bloquées selon la définition source. |
| `dribbles_completed` | `integer` | oui |  | Dribbles réussis. |
| `dribbles_attempted` | `integer` | oui |  | Dribbles tentés. |
| `saves` | `integer` | oui |  | Arrêts du gardien observés. |
| `xg` | `double precision` | oui |  | Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `non_penalty_xg` | `double precision` | oui |  | Buts attendus hors penalties selon la définition source. |
| `xa` | `double precision` | oui |  | Passes décisives attendues ; une valeur indisponible reste indisponible. |
| `xgot` | `double precision` | oui |  | Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `minutes_played` | `double precision` | oui |  | Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation. |
| `provider_rating` | `double precision` | oui |  | Note du fournisseur ; distincte d’un score Orion. |
| `goals_prevented` | `double precision` | oui |  | Buts évités selon le modèle gardien du fournisseur ; valeur signée. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, player_id, period_code`.

- UNIQUE `row_version_id`.
- FK `match_id, player_id, team_id → football.match_players(match_id, player_id, team_id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `goals >= 0`.
- CHECK `assists >= 0`.
- CHECK `shots >= 0`.
- CHECK `shots_on_target >= 0`.
- CHECK `chances_created >= 0`.
- CHECK `big_chances_created >= 0`.
- CHECK `passes_completed >= 0`.
- CHECK `passes_attempted >= 0`.
- CHECK `passes_final_third >= 0`.
- CHECK `defensive_actions >= 0`.
- CHECK `interceptions >= 0`.
- CHECK `tackles >= 0`.
- CHECK `recoveries >= 0`.
- CHECK `duels_won >= 0`.
- CHECK `duels_lost >= 0`.
- CHECK `aerial_duels_won >= 0`.
- CHECK `aerial_duels_attempted >= 0`.
- CHECK `touches >= 0`.
- CHECK `touches_box >= 0`.
- CHECK `clearances >= 0`.
- CHECK `blocks >= 0`.
- CHECK `dribbles_completed >= 0`.
- CHECK `dribbles_attempted >= 0`.
- CHECK `saves >= 0`.
- CHECK `xg >= 0`.
- CHECK `non_penalty_xg >= 0`.
- CHECK `xa >= 0`.
- CHECK `xgot >= 0`.
- CHECK `minutes_played >= 0`.
- CHECK `passes_completed <= passes_attempted`.
- CHECK `aerial_duels_won <= aerial_duels_attempted`.
- CHECK `dribbles_completed <= dribbles_attempted`.
- CHECK `xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `non_penalty_xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xa NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `minutes_played NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `provider_rating NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `goals_prevented NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.

- provider_rating est la note fournisseur, jamais une note Orion.
- goals_prevented est signé.
- Aucune valeur absente ne devient zéro.
- Les dénominateurs inconnus restent NULL, même si un pourcentage arrondi est affiché.

### football.source_metric_mappings

Traduction versionnée des clés techniques fournisseur.

Grain : Source × famille × clé brute × version.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id). |
| `family_code` | `text` | non | PK | Famille de données dont le contrat définit cette clé. |
| `raw_key` | `text` | non | PK | Clé technique native de la métrique. |
| `mapping_version` | `text` | non | PK | Version de la traduction des valeurs fournisseur. |
| `metric_code` | `text` | non | FK | Référence SQL vers football.metric_definitions(code). |
| `parse_rule` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `period_rule` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `definition_notes` | `text` | oui |  | Limites et définition particulières de la correspondance. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `source_id, family_code, raw_key, mapping_version`.

- UNIQUE `row_version_id`.
- FK `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `metric_code → football.metric_definitions(code) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(parse_rule) = 'object'`.
- CHECK `jsonb_typeof(period_rule) = 'object'`.
- CHECK `octet_length(parse_rule::text)<=16384`.
- CHECK `octet_length(period_rule::text)<=16384`.


### football.team_match_advanced

Mesures avancées équipe; possession d’actions distincte de la possession standard.

Grain : Match × team × période.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `period_code` | `text` | non | PK/FK | Référence SQL vers football.periods(code). |
| `opponent_passes` | `integer` | oui |  | Passes adverses entrant dans le périmètre de la mesure. |
| `defensive_actions` | `integer` | oui |  | Actions défensives selon le contrat de la mesure. |
| `high_turnovers` | `integer` | oui |  | Récupérations hautes selon le fournisseur. |
| `counterpress_regains_5s` | `integer` | oui |  | Récupérations dans les cinq secondes du contre-pressing. |
| `final_third_entries` | `integer` | oui |  | Entrées dans le dernier tiers. |
| `box_entries` | `integer` | oui |  | Entrées dans la surface. |
| `buildup_attacks` | `integer` | oui |  | Attaques construites selon la définition source. |
| `direct_attacks` | `integer` | oui |  | Attaques directes selon cette définition. |
| `challenges` | `integer` | oui |  | Duels/interventions du contrat avancé. |
| `aerials` | `integer` | oui |  | Duels aériens selon le contrat avancé. |
| `aerials_won` | `integer` | oui |  | Duels aériens gagnés du contrat avancé. |
| `xt_total` | `double precision` | oui |  | Expected threat fournisseur, valeur signée ; modèle identifié séparément. |
| `vaep_total` | `double precision` | oui |  | Valeur VAEP totale fournisseur, signée. |
| `vaep_offensive` | `double precision` | oui |  | Composante offensive VAEP, signée. |
| `vaep_defensive` | `double precision` | oui |  | Composante défensive VAEP, signée. |
| `pv_total` | `double precision` | oui |  | Valeur totale de possession du modèle fournisseur. |
| `pv_offensive` | `double precision` | oui |  | Composante offensive de possession. |
| `pv_defensive` | `double precision` | oui |  | Composante défensive de possession. |
| `ppda` | `double precision` | oui |  | Passes adverses par action défensive selon le contrat source ; dénominateur conservé lorsqu’il existe. |
| `field_tilt` | `double precision` | oui |  | Part territoriale normalisée sous contrat, échelle 0–100. |
| `possession_pct` | `double precision` | oui |  | Possession en pourcentage 0–100, selon la définition de cette table. |
| `avg_action_x` | `double precision` | oui |  | Position longitudinale moyenne des actions, repère déclaré. |
| `avg_defensive_action_x` | `double precision` | oui |  | Position longitudinale moyenne des actions défensives. |
| `ball_recovery_time_seconds` | `double precision` | oui |  | Temps de récupération en secondes selon le contrat source. |
| `passes_per_sequence` | `double precision` | oui |  | Passes par séquence selon le contrat source. |
| `sequence_time_seconds` | `double precision` | oui |  | Durée de séquence en secondes. |
| `direct_speed` | `double precision` | oui |  | Vitesse de progression directe ; unité de la définition fournisseur. |
| `provider_model_version` | `text` | oui |  | Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue. |
| `coordinate_frame` | `text` | oui |  | Repère spatial déclaré par la source, propre à cette famille. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, team_id, period_code`.

- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `opponent_passes >= 0`.
- CHECK `defensive_actions >= 0`.
- CHECK `high_turnovers >= 0`.
- CHECK `counterpress_regains_5s >= 0`.
- CHECK `final_third_entries >= 0`.
- CHECK `box_entries >= 0`.
- CHECK `buildup_attacks >= 0`.
- CHECK `direct_attacks >= 0`.
- CHECK `challenges >= 0`.
- CHECK `aerials >= 0`.
- CHECK `aerials_won >= 0`.
- CHECK `ppda >= 0`.
- CHECK `ball_recovery_time_seconds >= 0`.
- CHECK `passes_per_sequence >= 0`.
- CHECK `sequence_time_seconds >= 0`.
- CHECK `direct_speed >= 0`.
- CHECK `possession_pct BETWEEN 0 AND 100`.
- CHECK `field_tilt BETWEEN 0 AND 100`.
- CHECK `aerials_won <= aerials`.
- CHECK `xt_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `vaep_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `vaep_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `vaep_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pv_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pv_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pv_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `ppda NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `field_tilt NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `possession_pct NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `avg_action_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `avg_defensive_action_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `ball_recovery_time_seconds NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `passes_per_sequence NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `sequence_time_seconds NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `direct_speed NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.


### football.team_match_metric_values

Métriques secondaires enregistrées, avec types, unité et fractions explicites.

Grain : Match × team × période × famille standard/advanced × métrique.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Match du fait. |
| `team_id` | `bigint` | non | PK/FK | Identité concernée. |
| `period_code` | `text` | non | PK/FK | Période explicitement définie. |
| `family_code` | `text` | non | PK | standard ou advanced. |
| `metric_code` | `text` | non | PK/FK | Métrique enregistrée et définie ; aucune clé arbitraire. |
| `value_kind` | `text` | non |  | number, string ou boolean ; NULL/absence distingués par les états de champ. |
| `numeric_value` | `numeric` | oui |  | Valeur numérique exacte de cette métrique. |
| `text_value` | `text` | oui |  | Valeur textuelle si le contrat de métrique l’autorise. |
| `boolean_value` | `boolean` | oui |  | Valeur booléenne si définie comme telle. |
| `numerator` | `numeric` | oui |  | Numérateur fourni, sans le déduire d’un taux arrondi. |
| `denominator` | `numeric` | oui |  | Dénominateur observé. |
| `source_display` | `text` | oui |  | Forme affichée native d’un scalaire, par exemple 12/15 ou 75%. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, team_id, period_code, family_code, metric_code`.

- UNIQUE `row_version_id`.
- FK `metric_code → football.metric_definitions(code) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `num_nonnulls(numeric_value,text_value,boolean_value)=1`.
- CHECK `family_code IN ('standard','advanced')`.
- CHECK `(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL)`.


### football.team_match_stats

Statistiques d’équipe par période selon la définition standard.

Grain : Match × team × période.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `period_code` | `text` | non | PK/FK | Référence SQL vers football.periods(code). |
| `shots` | `integer` | oui |  | Nombre de tirs observés selon la définition source. |
| `shots_on_target` | `integer` | oui |  | Tirs cadrés observés selon la définition source. |
| `shots_off_target` | `integer` | oui |  | Tirs non cadrés observés. |
| `shots_blocked` | `integer` | oui |  | Tirs bloqués observés. |
| `corners` | `integer` | oui |  | Corners observés. |
| `offsides` | `integer` | oui |  | Hors-jeu observés. |
| `fouls` | `integer` | oui |  | Fautes observées. |
| `yellow_cards` | `integer` | oui |  | Avertissements attribués dans cette période. |
| `red_cards` | `integer` | oui |  | Expulsions attribuées dans cette période. |
| `passes_completed` | `integer` | oui |  | Passes réussies observées. |
| `passes_attempted` | `integer` | oui |  | Passes tentées observées, dénominateur des taux. |
| `crosses_completed` | `integer` | oui |  | Centres réussis. |
| `crosses_attempted` | `integer` | oui |  | Centres tentés. |
| `tackles` | `integer` | oui |  | Tacles selon la définition source. |
| `interceptions` | `integer` | oui |  | Interceptions observées. |
| `recoveries` | `integer` | oui |  | Ballons récupérés. |
| `duels_won` | `integer` | oui |  | Duels gagnés observés. |
| `saves` | `integer` | oui |  | Arrêts du gardien observés. |
| `touches_box` | `integer` | oui |  | Ballons touchés dans la surface. |
| `xg` | `double precision` | oui |  | Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `non_penalty_xg` | `double precision` | oui |  | Buts attendus hors penalties selon la définition source. |
| `xgot` | `double precision` | oui |  | Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `possession_pct` | `double precision` | oui |  | Possession en pourcentage 0–100, selon la définition de cette table. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, team_id, period_code`.

- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `shots >= 0`.
- CHECK `shots_on_target >= 0`.
- CHECK `shots_off_target >= 0`.
- CHECK `shots_blocked >= 0`.
- CHECK `corners >= 0`.
- CHECK `offsides >= 0`.
- CHECK `fouls >= 0`.
- CHECK `yellow_cards >= 0`.
- CHECK `red_cards >= 0`.
- CHECK `passes_completed >= 0`.
- CHECK `passes_attempted >= 0`.
- CHECK `crosses_completed >= 0`.
- CHECK `crosses_attempted >= 0`.
- CHECK `tackles >= 0`.
- CHECK `interceptions >= 0`.
- CHECK `recoveries >= 0`.
- CHECK `duels_won >= 0`.
- CHECK `saves >= 0`.
- CHECK `touches_box >= 0`.
- CHECK `xg >= 0`.
- CHECK `non_penalty_xg >= 0`.
- CHECK `xgot >= 0`.
- CHECK `possession_pct BETWEEN 0 AND 100`.
- CHECK `passes_completed <= passes_attempted`.
- CHECK `crosses_completed <= crosses_attempted`.
- CHECK `xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `non_penalty_xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `possession_pct NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.


## Tirs et analyses spatiales

### football.match_heatmap_cells

Cellules spatiales typées ; parent conserve grille, repère et disponibilité.

Grain : Heatmap × ordinal source de cellule.

Écriture : `replace_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `heatmap_id` | `bigint` | non | PK/FK | Carte parente. |
| `cell_ordinal` | `integer` | non | PK | Ordre natif dans cette version. |
| `column_index` | `smallint` | non |  | Colonne de grille, base zéro. |
| `row_index` | `smallint` | non |  | Ligne de grille, base zéro. |
| `action_count` | `integer` | non |  | Actions observées dans la cellule. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `heatmap_id, cell_ordinal`.

- UNIQUE `row_version_id`.
- FK `heatmap_id → football.match_heatmaps(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `cell_ordinal>=0 AND column_index>=0 AND row_index>=0 AND action_count>=0`.

- Contrôle intertable de dimensions et unicité des coordonnées dans une famille publiée ; un conflit source reste une anomalie, pas une suppression silencieuse.

### football.match_heatmaps

Cartes spatiales compactes; cellules éparses conservées en JSONB.

Grain : Match × équipe × joueur facultatif × période × type de carte.

Écriture : `replace_family_atomically` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id). |
| `period_code` | `text` | non | FK | Référence SQL vers football.periods(code). |
| `map_kind` | `text` | non |  | Nature de la carte spatiale. |
| `grid_columns` | `smallint` | non |  | Nombre de colonnes de la grille spatiale. |
| `grid_rows` | `smallint` | non |  | Nombre de lignes de la grille spatiale. |
| `cell_length_m` | `double precision` | non |  | Longueur en mètres d’une cellule. |
| `cell_width_m` | `double precision` | non |  | Largeur en mètres d’une cellule. |
| `coordinate_frame` | `text` | non |  | Repère spatial déclaré par la source, propre à cette famille. |
| `actions` | `integer` | oui |  | Nombre d’actions couvertes, si renseigné. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `cells_state` | `text` | non |  | absent, null, empty ou available ; aucun tableau vide interprété comme une grille de zéros. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `match_id, team_id, player_id, period_code, map_kind ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `grid_columns > 0 AND grid_rows > 0 AND cell_length_m > 0 AND cell_width_m > 0`.
- CHECK `actions >= 0`.
- CHECK `cells_state IN ('absent','null','empty','available')`.
- CHECK `cell_length_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `cell_width_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.


### football.match_momentum

Séries de momentum observées; un tableau vide ne crée pas des zéros.

Grain : Match × série × index de point.

Écriture : `replace_family_atomically` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id). |
| `series_code` | `text` | non | PK | Série de momentum concernée, conservée distinctement des autres séries. |
| `sample_index` | `integer` | non | PK | Index du point dans l’ordre natif de la série de momentum. |
| `minute` | `double precision` | oui |  | Minute source dans la période indiquée ; précision conservée. |
| `period_code` | `text` | oui | FK | Référence SQL vers football.periods(code). |
| `value` | `double precision` | non |  | Valeur fournie dans le grain et l’unité définis par la table. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `match_id, series_code, sample_index`.

- UNIQUE `row_version_id`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `sample_index >= 0`.
- CHECK `minute >= 0`.
- CHECK `minute NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `value NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.


### football.pass_network_edges

Passes dirigées entre deux nœuds du même réseau.

Grain : Réseau × passeur × receveur.

Écriture : `replace_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `network_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_network_nodes(network_id, player_id); football.pass_network_nodes(network_id, player_id). |
| `from_player_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_network_nodes(network_id, player_id). |
| `to_player_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_network_nodes(network_id, player_id). |
| `passes` | `integer` | non |  | Passes observées pour le nœud, l’arête ou le périmètre de cette table. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `network_id, from_player_id, to_player_id`.

- UNIQUE `row_version_id`.
- FK `network_id, from_player_id → football.pass_network_nodes(network_id, player_id) ; ON DELETE CASCADE`.
- FK `network_id, to_player_id → football.pass_network_nodes(network_id, player_id) ; ON DELETE CASCADE`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `from_player_id <> to_player_id`.
- CHECK `passes > 0`.


### football.pass_network_nodes

Joueurs présents dans un réseau.

Grain : Réseau × joueur.

Écriture : `replace_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `network_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_networks(id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `avg_x` | `double precision` | oui |  | Position longitudinale moyenne dans le repère du réseau. |
| `avg_y` | `double precision` | oui |  | Position transversale moyenne dans ce repère. |
| `passes` | `integer` | oui |  | Passes observées pour le nœud, l’arête ou le périmètre de cette table. |
| `passes_received` | `integer` | oui |  | Passes reçues par ce nœud du réseau. |
| `degree` | `integer` | oui |  | Degré du nœud selon le contrat réseau. |
| `strength` | `double precision` | oui |  | Force pondérée du nœud selon le contrat fournisseur. |
| `betweenness` | `double precision` | oui |  | Centralité d’intermédiarité fournie. |
| `clustering` | `double precision` | oui |  | Coefficient de clustering fourni. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `network_id, player_id`.

- UNIQUE `row_version_id`.
- FK `network_id → football.pass_networks(id) ; ON DELETE CASCADE`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `passes >= 0`.
- CHECK `passes_received >= 0`.
- CHECK `degree >= 0`.
- CHECK `strength >= 0`.
- CHECK `betweenness >= 0`.
- CHECK `clustering >= 0`.
- CHECK `avg_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `avg_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `strength NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `betweenness NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `clustering NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.


### football.pass_networks

Réseaux de passes pour une fenêtre explicitement conservée.

Grain : Match × équipe × fenêtre.

Écriture : `replace_family_atomically` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `window_kind` | `text` | non |  | Contrat de la fenêtre temporelle du réseau. |
| `from_seconds` | `integer` | oui |  | Début connu de la fenêtre du réseau, en secondes de match. |
| `until_seconds` | `integer` | oui |  | Fin de la fenêtre ; first_substitution ne décrit pas tout le match. |
| `centralization` | `double precision` | oui |  | Centralisation collective fournie pour cette fenêtre. |
| `coordinate_frame` | `text` | oui |  | Repère spatial déclaré par la source, propre à cette famille. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `match_id, team_id, window_kind, from_seconds, until_seconds ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `from_seconds >= 0`.
- CHECK `until_seconds >= 0`.
- CHECK `until_seconds >= from_seconds`.
- CHECK `centralization NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.


### football.shots

Tirs canoniques; l’identifiant externe est limité au match.

Grain : Un tir de la famille canonique du match.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id); football.player_profile_versions(id, player_id). |
| `external_shot_id` | `text` | non |  | Identifiant de tir limité à son match et sa source. |
| `period_code` | `text` | oui | FK | Référence SQL vers football.periods(code). |
| `minute` | `integer` | oui |  | Minute source dans la période indiquée ; précision conservée. |
| `minute_added` | `integer` | oui |  | Temps additionnel distinct de la minute principale. |
| `x_m` | `double precision` | oui |  | Coordonnée longitudinale du tir, en mètres seulement si conversion vérifiée ; le repère est explicite. |
| `y_m` | `double precision` | oui |  | Coordonnée transversale du tir dans le repère déclaré. |
| `coordinate_frame` | `text` | oui |  | Repère spatial déclaré par la source, propre à cette famille. |
| `pitch_length_m` | `double precision` | oui |  | Longueur du terrain en mètres lorsqu’elle est explicitement connue. |
| `pitch_width_m` | `double precision` | oui |  | Largeur du terrain en mètres lorsqu’elle est connue. |
| `xg` | `double precision` | oui |  | Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `xgot` | `double precision` | oui |  | Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `outcome` | `text` | oui |  | Résultat du tir selon un mapping documenté. |
| `body_part` | `text` | oui |  | Partie du corps si fournie ; ne pas l’inférer d’un code de tir non défini. |
| `situation` | `text` | oui |  | Contexte du tir : jeu ouvert, phase arrêtée, etc., selon les codes source. |
| `is_goal` | `boolean` | oui |  | Indicateur de but observé ou dérivé sous règle versionnée. |
| `is_own_goal` | `boolean` | oui |  | But contre son camp explicitement signalé. |
| `is_on_target` | `boolean` | oui |  | Indicateur natif de tir cadré. |
| `is_inside_box` | `boolean` | oui |  | Tir dans la surface selon la source. |
| `goal_crossed_y` | `double precision` | oui |  | Coordonnée du franchissement de la ligne de but dans le repère du fournisseur. |
| `goal_crossed_z` | `double precision` | oui |  | Hauteur du franchissement de la ligne de but dans le repère du fournisseur. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `keeper_id` | `bigint` | oui | FK | Gardien associé au tir dans l’observation. |
| `blocked_x` | `double precision` | oui |  | Coordonnée du point de blocage, dans le repère source déclaré. |
| `blocked_y` | `double precision` | oui |  | Seconde coordonnée du point de blocage. |
| `is_blocked` | `boolean` | oui |  | Indicateur natif de tir bloqué. |
| `is_saved_off_line` | `boolean` | oui |  | Indicateur natif de sauvetage sur la ligne. |
| `source_shot_type` | `text` | oui |  | Type natif ; aucune confusion automatique avec la partie du corps. |
| `source_event_type` | `text` | oui |  | Résultat/type natif du tir. |
| `source_ordinal` | `integer` | oui |  | Ordre de présentation dans cette version de la famille. |
| `player_profile_version_id` | `bigint` | oui | FK | Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte. |
| `keeper_profile_version_id` | `bigint` | oui | FK | Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `source_id, match_id, external_shot_id`.
- UNIQUE `row_version_id`.
- FK `match_id, team_id → football.match_teams(match_id, team_id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `period_code → football.periods(code) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `keeper_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `player_profile_version_id, player_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `keeper_profile_version_id, keeper_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `minute >= 0`.
- CHECK `minute_added >= 0`.
- CHECK `xg BETWEEN 0 AND 1`.
- CHECK `xgot BETWEEN 0 AND 1`.
- CHECK `(x_m IS NULL AND y_m IS NULL AND goal_crossed_y IS NULL AND goal_crossed_z IS NULL) OR coordinate_frame IS NOT NULL`.
- CHECK `pitch_length_m > 0`.
- CHECK `pitch_width_m > 0`.
- CHECK `(blocked_x IS NULL AND blocked_y IS NULL) OR coordinate_frame IS NOT NULL`.
- CHECK `x_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `y_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pitch_length_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `pitch_width_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `goal_crossed_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `goal_crossed_z NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `blocked_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `blocked_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "match_id", "order": "ASC"}]`.
- INDEX `btree : [{"column": "player_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}] WHERE player_id IS NOT NULL`.


## Classements

### football.association_ranking_components

Contributions annuelles du classement lorsque la source les fournit.

Grain : Instantané × association × période de contribution.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.association_ranking_entries(snapshot_id, association_id). |
| `association_id` | `bigint` | non | PK/FK | Référence SQL vers football.association_ranking_entries(snapshot_id, association_id). |
| `component_period` | `text` | non | PK | Période annuelle de contribution au coefficient, distincte de la date de récupération. |
| `value` | `numeric(16,6)` | oui |  | Valeur fournie dans le grain et l’unité définis par la table. |
| `component_rank` | `integer` | oui |  | Rang publié de cette composante lorsqu’il existe. |
| `national_association_points` | `numeric(16,6)` | oui |  | Points nationaux fournis pour la contribution. |
| `total_value` | `numeric(16,6)` | oui |  | Valeur totale native de la contribution. |
| `total_points_with_bonus` | `numeric(16,6)` | oui |  | Points incluant les bonus explicitement fournis. |
| `factor_bonus_for_title_held` | `numeric(16,6)` | oui |  | Facteur natif de bonus lié au titre. |
| `factor_total_bonus` | `numeric(16,6)` | oui |  | Total des facteurs de bonus fournis. |
| `matches_count` | `integer` | oui |  | Nombre de matchs indiqué pour cette composante. |
| `teams_count` | `integer` | oui |  | Nombre d’équipes indiqué. |
| `teams_still_playing` | `integer` | oui |  | Nombre d’équipes encore engagées lors de l’observation. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `snapshot_id, association_id, component_period`.

- UNIQUE `row_version_id`.
- FK `snapshot_id, association_id → football.association_ranking_entries(snapshot_id, association_id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `component_rank > 0`.


### football.association_ranking_entries

Entrées typées des classements d’autorité.

Grain : Instantané × association.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.ranking_snapshots(id, subject_kind). |
| `association_id` | `bigint` | non | PK/FK | Référence SQL vers football.associations(id). |
| `subject_kind` | `text` | non | FK | Référence SQL vers football.ranking_snapshots(id, subject_kind). |
| `rank` | `integer` | non |  | Rang publié ; les ex aequo ne sont pas interdits sans règle de la source. |
| `coefficient` | `numeric(16,6)` | oui |  | Coefficient de fédération publié par l’autorité. |
| `earned_points` | `numeric(16,6)` | oui |  | Points acquis indiqués séparément par la source. |
| `previous_rank` | `integer` | oui |  | Rang de l’édition précédente selon la source. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `snapshot_id, association_id`.

- UNIQUE `row_version_id`.
- FK `snapshot_id, subject_kind → football.ranking_snapshots(id, subject_kind) ; ON DELETE RESTRICT`.
- FK `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `subject_kind = 'association'`.
- CHECK `rank > 0`.
- CHECK `previous_rank > 0`.


### football.ranking_snapshots

Éditions et révisions de classements externes avec leurs différentes dates.

Grain : Système × édition × révision.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `system_id` | `bigint` | non | FK | Référence SQL vers football.ranking_systems(id, subject_kind). |
| `subject_kind` | `text` | non | FK | Référence SQL vers football.ranking_systems(id, subject_kind). |
| `edition_key` | `text` | non |  | Clé native de l’édition du classement ou de la distinction. |
| `period_label` | `text` | oui |  | Période de référence déclarée ; ne prouve pas la disponibilité historique. |
| `effective_on` | `date` | oui |  | Date d’effet connue du classement, distincte de publication/récupération. |
| `published_at` | `timestamptz` | oui |  | Publication déclarée ou activation, selon le grain de cette table. |
| `source_updated_at` | `timestamptz` | oui |  | Dernière mise à jour déclarée par la source, distincte de sa récupération. |
| `retrieved_at` | `timestamptz` | non |  | Récupération effective de la donnée source. |
| `official_edition` | `boolean` | oui |  | Édition officielle si explicitement attestée par la source. |
| `revision` | `integer` | non |  | Révision explicite de cette édition. |
| `source_document_id` | `bigint` | non | FK | Référence SQL vers ingest.source_documents(id). |
| `quality_flags` | `jsonb` | non |  | Codes de qualité et booléens enregistrés ; aucun fait sportif ou document complet. |
| `base_season_year` | `integer` | oui |  | Année de référence native base_season_year, distincte des dates de publication et récupération. |
| `target_season_year` | `integer` | oui |  | Année de référence native target_season_year, distincte des dates de publication et récupération. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `system_id, edition_key, revision`.
- UNIQUE `id, subject_kind`.
- UNIQUE `row_version_id`.
- FK `system_id, subject_kind → football.ranking_systems(id, subject_kind) ; ON DELETE RESTRICT`.
- FK `source_document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `revision > 0`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "system_id", "order": "ASC"}, {"column": "published_at", "order": "DESC", "nulls": "LAST"}, {"column": "id", "order": "DESC"}]`.

- Le libellé historique ne garantit pas une disponibilité à cette date.
- Le contrôle temporel du scoring doit suivre une politique explicite, pas COALESCE de dates de sens différents.

### football.ranking_systems

Classements externes FIFA, UEFA et leurs définitions.

Grain : Un système et sa version de méthode.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Code stable du référentiel, avec sa définition explicite. |
| `authority` | `text` | non |  | Organisme qui publie ce classement, par exemple FIFA ou UEFA. |
| `subject_kind` | `text` | non |  | Type d’entité classée ou agrégée ; les fédérations restent distinctes des équipes. |
| `gender` | `text` | non |  | Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `methodology_version` | `text` | non |  | Version de la méthode de l’autorité de classement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `code, methodology_version`.
- UNIQUE `id, subject_kind`.
- UNIQUE `row_version_id`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `subject_kind IN ('team', 'association')`.
- CHECK `gender IN ('men', 'women', 'mixed', 'unknown')`.


### football.standing_rows

Lignes des classements de championnat publiés.

Grain : Instantané × équipe.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.standing_snapshots(id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `rank` | `integer` | oui |  | Rang publié ; les ex aequo ne sont pas interdits sans règle de la source. |
| `played` | `integer` | oui |  | Participation prouvée dans match_players ; dans un classement, nombre de matchs joués. |
| `wins` | `integer` | oui |  | Victoires observées/calculées dans le périmètre de cette table. |
| `draws` | `integer` | oui |  | Matchs nuls dans ce périmètre. |
| `losses` | `integer` | oui |  | Défaites dans ce périmètre. |
| `goals_for` | `integer` | oui |  | Buts marqués dans ce périmètre. |
| `goals_against` | `integer` | oui |  | Buts encaissés dans ce périmètre. |
| `points` | `numeric(12,3)` | oui |  | Points publiés ; peuvent inclure bonus et sanctions selon le classement. |
| `points_adjustment` | `numeric(12,3)` | oui |  | Bonus ou sanction publiés ; valeur signée. |
| `source_label` | `text` | oui |  | Libellé natif de la ligne de classement, conservé pour le contexte. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `snapshot_id, team_id`.

- UNIQUE `row_version_id`.
- FK `snapshot_id → football.standing_snapshots(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `played >= 0`.
- CHECK `wins >= 0`.
- CHECK `draws >= 0`.
- CHECK `losses >= 0`.
- CHECK `goals_for >= 0`.
- CHECK `goals_against >= 0`.
- CHECK `rank > 0`.

- Les points peuvent inclure sanctions et bonus; ne pas imposer points = 3 × victoires + nuls.

### football.standing_snapshots

Classements de championnat observés, datés et rattachés à une édition.

Grain : Une observation d’un tableau de classement.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id); football.competition_stages(id, competition_season_id); football.competition_groups(id, stage_id, competition_season_id). |
| `stage_id` | `bigint` | oui | FK | Référence SQL vers football.competition_stages(id, competition_season_id); football.competition_groups(id, stage_id, competition_season_id). |
| `group_id` | `bigint` | oui | FK | Référence SQL vers football.competition_groups(id, stage_id, competition_season_id). |
| `group_label` | `text` | oui |  | Libellé historique du groupe si aucune identité de groupe n’est encore résolue. |
| `scope` | `text` | non |  | Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent. |
| `effective_at` | `timestamptz` | oui |  | Instant d’effet connu de ce tableau de classement. |
| `observed_at` | `timestamptz` | non |  | Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `source_record_id, competition_season_id, stage_id, group_id, group_label, scope ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `stage_id, competition_season_id → football.competition_stages(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `group_id, stage_id, competition_season_id → football.competition_groups(id, stage_id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `group_id IS NULL OR stage_id IS NOT NULL`.
- CHECK `scope IN ('overall', 'home', 'away')`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "observed_at", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.


### football.team_ranking_components

Contributions annuelles du classement lorsque la source les fournit.

Grain : Instantané × team × période de contribution.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.team_ranking_entries(snapshot_id, team_id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.team_ranking_entries(snapshot_id, team_id). |
| `component_period` | `text` | non | PK | Période annuelle de contribution au coefficient, distincte de la date de récupération. |
| `value` | `numeric(16,6)` | oui |  | Valeur fournie dans le grain et l’unité définis par la table. |
| `component_rank` | `integer` | oui |  | Rang publié de cette composante lorsqu’il existe. |
| `national_association_points` | `numeric(16,6)` | oui |  | Points nationaux fournis pour la contribution. |
| `total_value` | `numeric(16,6)` | oui |  | Valeur totale native de la contribution. |
| `total_points_with_bonus` | `numeric(16,6)` | oui |  | Points incluant les bonus explicitement fournis. |
| `factor_bonus_for_title_held` | `numeric(16,6)` | oui |  | Facteur natif de bonus lié au titre. |
| `factor_total_bonus` | `numeric(16,6)` | oui |  | Total des facteurs de bonus fournis. |
| `matches_count` | `integer` | oui |  | Nombre de matchs indiqué pour cette composante. |
| `teams_count` | `integer` | oui |  | Nombre d’équipes indiqué. |
| `teams_still_playing` | `integer` | oui |  | Nombre d’équipes encore engagées lors de l’observation. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `snapshot_id, team_id, component_period`.

- UNIQUE `row_version_id`.
- FK `snapshot_id, team_id → football.team_ranking_entries(snapshot_id, team_id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `component_rank > 0`.


### football.team_ranking_entries

Entrées typées des classements d’autorité.

Grain : Instantané × team.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.ranking_snapshots(id, subject_kind). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `subject_kind` | `text` | non | FK | Référence SQL vers football.ranking_snapshots(id, subject_kind). |
| `rank` | `integer` | non |  | Rang publié ; les ex aequo ne sont pas interdits sans règle de la source. |
| `points` | `numeric(16,6)` | oui |  | Points publiés ; peuvent inclure bonus et sanctions selon le classement. |
| `earned_points` | `numeric(16,6)` | oui |  | Points acquis indiqués séparément par la source. |
| `previous_rank` | `integer` | oui |  | Rang de l’édition précédente selon la source. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `snapshot_id, team_id`.

- UNIQUE `row_version_id`.
- FK `snapshot_id, subject_kind → football.ranking_snapshots(id, subject_kind) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `subject_kind = 'team'`.
- CHECK `rank > 0`.
- CHECK `previous_rank > 0`.


## Entraîneurs et palmarès

### football.coaches

Identités d’entraîneurs; ne pas fusionner sur le seul nom.

Grain : Une personne entraîneur.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `display_name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `birth_date` | `date` | oui |  | Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `nationality_country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.


### football.honour_definitions

Définitions des titres collectifs et distinctions individuelles.

Grain : Un titre ou prix.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Code stable du référentiel, avec sa définition explicite. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `honour_type` | `text` | non |  | Titre collectif ou distinction individuelle. |
| `competition_id` | `bigint` | oui | FK | Référence SQL vers football.competitions(id). |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `code`.
- UNIQUE `row_version_id`.
- FK `competition_id → football.competitions(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `honour_type IN ('team', 'individual')`.


### football.player_honours

Distinctions attribuées avec leur contexte historique.

Grain : player × titre × édition × résultat × équipe de contexte si applicable.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `honour_id` | `bigint` | non | FK | Référence SQL vers football.honour_definitions(id). |
| `competition_season_id` | `bigint` | oui | FK | Référence SQL vers football.competition_seasons(id). |
| `season_label` | `text` | oui |  | Libellé historique conservé lorsqu’aucune édition canonique n’est résolue. |
| `edition_key` | `text` | non |  | Clé d’édition de la distinction, conservée même sans édition de compétition résolue. |
| `outcome` | `text` | non |  | Résultat du tir selon un mapping documenté. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `team_id` | `bigint` | oui | FK | Référence SQL vers football.teams(id). |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `player_id, honour_id, edition_key, outcome, team_id ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `honour_id → football.honour_definitions(id) ; ON DELETE RESTRICT`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `octet_length(quality_flags::text)<=16384`.


### football.team_coach_tenures

Périodes d’exercice des entraîneurs; séparées de l’attribution d’un match.

Grain : Un épisode équipe/entraîneur.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `coach_id` | `bigint` | non | FK | Référence SQL vers football.coaches(id). |
| `role` | `text` | non |  | Fonction effectivement observée de l’entraîneur durant cet épisode. |
| `valid_from` | `date` | oui |  | Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Fin de validité connue ; NULL conserve une borne inconnue. |
| `date_precision` | `text` | non |  | Précision réelle des dates : day, month, year ou unknown. |
| `observed_at` | `timestamptz` | non |  | Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `row_version_id`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `coach_id → football.coaches(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `valid_to >= valid_from`.
- CHECK `date_precision IN ('day', 'month', 'year', 'unknown')`.
- CHECK `octet_length(quality_flags::text)<=16384`.
- INDEX `btree : [{"column": "team_id", "order": "ASC"}, {"column": "valid_from", "order": "ASC"}]`.


### football.team_honours

Distinctions attribuées avec leur contexte historique.

Grain : team × titre × édition × résultat × équipe de contexte si applicable.

Écriture : `mutable` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `honour_id` | `bigint` | non | FK | Référence SQL vers football.honour_definitions(id). |
| `competition_season_id` | `bigint` | oui | FK | Référence SQL vers football.competition_seasons(id). |
| `season_label` | `text` | oui |  | Libellé historique conservé lorsqu’aucune édition canonique n’est résolue. |
| `edition_key` | `text` | non |  | Clé d’édition de la distinction, conservée même sans édition de compétition résolue. |
| `outcome` | `text` | non |  | Résultat du tir selon un mapping documenté. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `id`.

- UNIQUE `team_id, honour_id, edition_key, outcome ; NULLS NOT DISTINCT`.
- UNIQUE `row_version_id`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `honour_id → football.honour_definitions(id) ; ON DELETE RESTRICT`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `data_revision > 0`.
- CHECK `octet_length(quality_flags::text)<=16384`.


## Lectures et publication

### analytics.aggregation_builds

Calculs cohérents d’agrégats pour une édition.

Grain : Une construction pour une édition.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id). |
| `dataset_snapshot_id` | `bigint` | non | FK | Référence SQL vers ingest.dataset_snapshots(id). |
| `transform_version` | `text` | non |  | Version de la transformation de données. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `started_at` | `timestamptz` | non |  | Instant UTC « started_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `finished_at` | `timestamptz` | oui |  | Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `metrics_contract_version` | `text` | non |  | Version des définitions et règles d’agrégation appliquées. |
| `error` | `jsonb` | oui |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |

PK : `id`.

- UNIQUE `id, competition_season_id`.
- FK `competition_season_id → football.competition_seasons(id) ; ON DELETE RESTRICT`.
- FK `dataset_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(error) = 'object'`.
- CHECK `status IN ('building', 'validating', 'ready', 'failed')`.
- CHECK `finished_at >= started_at`.
- CHECK `octet_length(error::text)<=16384`.


### analytics.catalog_publication

Version publiée des identités et métadonnées communes à toutes les éditions.

Grain : Un pointeur global actif.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `singleton` | `boolean` | non | PK | Clé singleton toujours true. |
| `catalog_snapshot_id` | `bigint` | non | FK | Instantané SQL scellé du référentiel commun. |
| `representation_version` | `text` | non |  | Version de sérialisation des métadonnées. |
| `published_at` | `timestamptz` | non |  | Activation atomique avec les éditions touchées. |

PK : `singleton`.

- FK `catalog_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `singleton IS TRUE`.


### analytics.competition_summary

Vue d’ensemble d’une édition avec couverture de chaque indicateur.

Grain : Une ligne par construction.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `build_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `teams_count` | `integer` | oui |  | Nombre de « teams » du périmètre de cette ligne ; absence distincte de zéro. |
| `matches_count` | `integer` | oui |  | Nombre de « matches » du périmètre de cette ligne ; absence distincte de zéro. |
| `finished_matches_count` | `integer` | oui |  | Nombre de « finished matches » du périmètre de cette ligne ; absence distincte de zéro. |
| `players_count` | `integer` | oui |  | Nombre de « players » du périmètre de cette ligne ; absence distincte de zéro. |
| `goals` | `integer` | oui |  | Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `build_id`.

- FK `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- CHECK `teams_count >= 0`.
- CHECK `matches_count >= 0`.
- CHECK `finished_matches_count >= 0`.
- CHECK `players_count >= 0`.
- CHECK `goals >= 0`.


### analytics.match_summary

Projection pour les cartes de match, obtenue depuis les faits canoniques.

Grain : Construction × match.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `build_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id). |
| `match_date` | `date` | oui |  | Date civile connue du match ; une heure inconnue ne crée pas un instant minuit fictif. |
| `kickoff_at` | `timestamptz` | oui |  | Instant UTC du coup d’envoi, uniquement lorsque l’heure est connue. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `home_team_id` | `bigint` | oui | FK | Référence SQL vers football.teams(id). |
| `away_team_id` | `bigint` | oui | FK | Référence SQL vers football.teams(id). |
| `home_label` | `text` | oui |  | Libellé domicile figé dans la publication, y compris participant encore inconnu. |
| `away_label` | `text` | oui |  | Libellé extérieur figé dans la publication. |
| `home_goals` | `integer` | oui |  | Score domicile du scope explicite de ce résumé. |
| `away_goals` | `integer` | oui |  | Score extérieur du même scope. |
| `score_scope` | `text` | oui |  | Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance. |
| `home_shootout_goals` | `integer` | oui |  | Tirs au but réussis par l’équipe domicile, séparés du score joué. |
| `away_shootout_goals` | `integer` | oui |  | Tirs au but réussis par l’équipe extérieure. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `build_id, match_id`.

- FK `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `home_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `away_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `home_goals >= 0`.
- CHECK `away_goals >= 0`.
- CHECK `home_shootout_goals >= 0`.
- CHECK `away_shootout_goals >= 0`.
- INDEX `btree : [{"column": "build_id", "order": "ASC"}, {"column": "match_date", "order": "DESC"}, {"column": "match_id", "order": "DESC"}]`.


### analytics.metric_totals

Totaux secondaires et couverture explicites d’une construction publiée.

Grain : Build × sujet typé × métrique.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `build_id` | `bigint` | non | FK | Construction immuable. |
| `subject_kind` | `text` | non |  | competition, match, player, player_team ou team. |
| `match_id` | `bigint` | oui | FK | Match si le sujet est une carte de rencontre. |
| `player_id` | `bigint` | oui | FK | Joueur du total. |
| `team_id` | `bigint` | oui | FK | Équipe du total. |
| `metric_code` | `text` | non | FK | Métrique ou indicateur de couverture enregistré. |
| `numeric_value` | `numeric` | oui |  | Valeur calculée ; NULL si non disponible. |
| `observed_count` | `bigint` | non |  | Observations couvertes. |
| `eligible_count` | `bigint` | oui |  | Observations éligibles selon le contrat ; NULL si ce nombre reste inconnu. |
| `eligible_minutes` | `numeric` | oui |  | Minutes éligibles propres à cette métrique. |
| `numerator` | `numeric` | oui |  | Somme des numérateurs connus. |
| `denominator` | `numeric` | oui |  | Somme des dénominateurs connus. |
| `coverage_state` | `text` | non |  | available, partial, unavailable ou unknown. |

PK : `id`.

- UNIQUE `build_id, subject_kind, match_id, player_id, team_id, metric_code ; NULLS NOT DISTINCT`.
- FK `build_id → analytics.aggregation_builds(id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `metric_code → football.metric_definitions(code) ; ON DELETE RESTRICT`.
- CHECK `observed_count>=0 AND eligible_count>=0 AND observed_count<=eligible_count`.
- CHECK `subject_kind IN ('competition','match','player','player_team','team')`.
- CHECK `(subject_kind='competition' AND num_nonnulls(match_id,player_id,team_id)=0) OR (subject_kind='match' AND match_id IS NOT NULL AND num_nonnulls(player_id,team_id)=0) OR (subject_kind='player' AND player_id IS NOT NULL AND num_nonnulls(match_id,team_id)=0) OR (subject_kind='player_team' AND match_id IS NULL AND player_id IS NOT NULL AND team_id IS NOT NULL) OR (subject_kind='team' AND team_id IS NOT NULL AND num_nonnulls(match_id,player_id)=0)`.


### analytics.player_competition_stats

Totaux joueur calculés sur périodes compatibles et participation prouvée.

Grain : Construction × joueur, toutes équipes de l’édition réunies.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `build_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `appearances` | `integer` | oui |  | Participations prouvées, sans compter automatiquement tous les joueurs listés. |
| `starts` | `integer` | oui |  | Titularisations prouvées. |
| `minutes_played` | `double precision` | oui |  | Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation. |
| `goals` | `integer` | oui |  | Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `assists` | `integer` | oui |  | Passes décisives attribuées par le fournisseur dans cette période. |
| `shots` | `integer` | oui |  | Nombre de tirs observés selon la définition source. |
| `shots_on_target` | `integer` | oui |  | Tirs cadrés observés selon la définition source. |
| `passes_completed` | `integer` | oui |  | Passes réussies observées. |
| `passes_attempted` | `integer` | oui |  | Passes tentées observées, dénominateur des taux. |
| `xg` | `double precision` | oui |  | Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `xa` | `double precision` | oui |  | Passes décisives attendues ; une valeur indisponible reste indisponible. |
| `goals_prevented` | `double precision` | oui |  | Buts évités selon le modèle gardien du fournisseur ; valeur signée. |
| `provider_rating_weighted` | `double precision` | oui |  | Moyenne de la note fournisseur pondérée selon le contrat et sa couverture. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `build_id, player_id`.

- FK `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `appearances >= 0`.
- CHECK `starts >= 0`.
- CHECK `minutes_played >= 0`.
- CHECK `goals >= 0`.
- CHECK `assists >= 0`.
- CHECK `shots >= 0`.
- CHECK `shots_on_target >= 0`.
- CHECK `passes_completed >= 0`.
- CHECK `passes_attempted >= 0`.
- CHECK `xg >= 0`.
- CHECK `xa >= 0`.
- CHECK `starts <= appearances`.
- INDEX `btree : [{"column": "build_id", "order": "ASC"}, {"column": "goals", "order": "DESC", "nulls": "LAST"}, {"column": "player_id", "order": "ASC"}]`.


### analytics.player_competition_team_stats

Totaux joueur calculés sur périodes compatibles et participation prouvée.

Grain : Construction × joueur × équipe.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `build_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `appearances` | `integer` | oui |  | Participations prouvées, sans compter automatiquement tous les joueurs listés. |
| `starts` | `integer` | oui |  | Titularisations prouvées. |
| `minutes_played` | `double precision` | oui |  | Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation. |
| `goals` | `integer` | oui |  | Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `assists` | `integer` | oui |  | Passes décisives attribuées par le fournisseur dans cette période. |
| `shots` | `integer` | oui |  | Nombre de tirs observés selon la définition source. |
| `shots_on_target` | `integer` | oui |  | Tirs cadrés observés selon la définition source. |
| `passes_completed` | `integer` | oui |  | Passes réussies observées. |
| `passes_attempted` | `integer` | oui |  | Passes tentées observées, dénominateur des taux. |
| `xg` | `double precision` | oui |  | Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `xa` | `double precision` | oui |  | Passes décisives attendues ; une valeur indisponible reste indisponible. |
| `goals_prevented` | `double precision` | oui |  | Buts évités selon le modèle gardien du fournisseur ; valeur signée. |
| `provider_rating_weighted` | `double precision` | oui |  | Moyenne de la note fournisseur pondérée selon le contrat et sa couverture. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `build_id, player_id, team_id`.

- FK `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `appearances >= 0`.
- CHECK `starts >= 0`.
- CHECK `minutes_played >= 0`.
- CHECK `goals >= 0`.
- CHECK `assists >= 0`.
- CHECK `shots >= 0`.
- CHECK `shots_on_target >= 0`.
- CHECK `passes_completed >= 0`.
- CHECK `passes_attempted >= 0`.
- CHECK `xg >= 0`.
- CHECK `xa >= 0`.
- CHECK `starts <= appearances`.


### analytics.player_search

Projection légère pour rechercher des joueurs.

Grain : Un joueur.

Écriture : `derived_replace` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `display_name` | `text` | non |  | Nom d’affichage observé ou sélectionné pour cette identité. |
| `search_text` | `text` | non |  | Texte préparé pour la recherche, issu des identités/alias retenus. |
| `search_vector` | `tsvector` | non |  | Vecteur plein texte PostgreSQL généré de search_text avec dictionnaire simple. |
| `birth_date` | `date` | oui |  | Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id). |
| `primary_position_code` | `text` | oui | FK | Référence SQL vers football.positions(code). |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `player_id`.

- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `nationality_country_id → football.countries(id) ; ON DELETE RESTRICT`.
- FK `primary_position_code → football.positions(code) ; ON DELETE RESTRICT`.
- INDEX `gin : [{"column": "search_vector"}]`.

- Recherche de départ sans extension obligatoire. Ajouter pg_trgm seulement si la recherche approximative est réellement nécessaire.

### analytics.publication_versions

Version active de l’ensemble des agrégats d’une édition.

Grain : Une publication active par édition.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `build_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `published_at` | `timestamptz` | non |  | Publication déclarée ou activation, selon le grain de cette table. |
| `catalog_snapshot_id` | `bigint` | non | FK | Instantané scellé des seules identités et métadonnées communes utilisées par cette édition ; réutilisé si ces dépendances restent identiques. |
| `representation_version` | `text` | non |  | Version du contrat de sérialisation et du format compact. |

PK : `competition_season_id`.

- FK `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `catalog_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.


### analytics.team_competition_stats

Totaux équipe calculés pour une édition.

Grain : Construction × équipe.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `build_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `matches_played` | `integer` | oui |  | Rencontres jouées éligibles dans cette édition. |
| `wins` | `integer` | oui |  | Victoires observées/calculées dans le périmètre de cette table. |
| `draws` | `integer` | oui |  | Matchs nuls dans ce périmètre. |
| `losses` | `integer` | oui |  | Défaites dans ce périmètre. |
| `goals_for` | `integer` | oui |  | Buts marqués dans ce périmètre. |
| `goals_against` | `integer` | oui |  | Buts encaissés dans ce périmètre. |
| `xg_for` | `double precision` | oui |  | xG produits connus dans le périmètre de l’équipe. |
| `xg_against` | `double precision` | oui |  | xG concédés connus dans ce périmètre. |
| `points_calculated` | `integer` | oui |  | Points issus des résultats ; ne remplace pas un classement officiel incluant sanctions. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `build_id, team_id`.

- FK `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `matches_played >= 0`.
- CHECK `wins >= 0`.
- CHECK `draws >= 0`.
- CHECK `losses >= 0`.
- CHECK `goals_for >= 0`.
- CHECK `goals_against >= 0`.
- CHECK `xg_for >= 0`.
- CHECK `xg_against >= 0`.

- points_calculated ne remplace pas les points d’un classement officiel avec sanctions ou règles spéciales.

## Modèles : réserve hors nouvelles formules

### analytics.feature_versions

Contrats de features reproductibles.

Grain : Nom × version du jeu de variables.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `version` | `text` | non |  | Version immuable du contrat, de la feature ou du modèle. |
| `definition` | `jsonb` | non |  | Définition sémantique du code et de ses conditions d’utilisation. |
| `code_commit` | `text` | non |  | Révision du code effectivement employée. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |

PK : `id`.

- UNIQUE `name, version`.
- CHECK `jsonb_typeof(definition) = 'object'`.
- CHECK `octet_length(definition::text)<=16384`.


### analytics.model_versions

Versions immuables des modèles Orion, distinctes des notes fournisseur.

Grain : Modèle × version.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `version` | `text` | non |  | Version immuable du contrat, de la feature ou du modèle. |
| `feature_version_id` | `bigint` | non | FK | Référence SQL vers analytics.feature_versions(id). |
| `configuration` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `code_commit` | `text` | non |  | Révision du code effectivement employée. |
| `role_definition` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `score_definition` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |

PK : `id`.

- UNIQUE `name, version`.
- FK `feature_version_id → analytics.feature_versions(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(configuration) = 'object'`.
- CHECK `jsonb_typeof(role_definition) = 'object'`.
- CHECK `jsonb_typeof(score_definition) = 'object'`.
- CHECK `octet_length(configuration::text)<=16384`.
- CHECK `octet_length(role_definition::text)<=16384`.
- CHECK `octet_length(score_definition::text)<=16384`.


### analytics.player_match_scores

Résultats immuables d’une exécution, sans écraser les scores antérieurs.

Grain : Exécution × match × player.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `score` | `double precision` | non |  | Résultat du modèle versionné ; l’échelle appartient à la définition du modèle. |
| `components` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `role_code` | `text` | oui |  | Rôle retenu pour l’évaluation, selon une définition versionnée. |
| `coverage` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `run_id, match_id, player_id`.

- FK `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(components) = 'object'`.
- CHECK `jsonb_typeof(coverage) = 'object'`.
- CHECK `octet_length(components::text)<=16384`.
- CHECK `octet_length(coverage::text)<=16384`.

- Aucune borne universelle 0–100: l’échelle appartient à model_versions.score_definition.
- La cohérence match/joueur/équipe est validée contre le snapshot du run. Les FK visent les identités stables, pas les faits courants corrigibles; une correction ne doit pas invalider un ancien résultat reproductible.

### analytics.player_window_scores

Scores et classements de joueurs pour la fenêtre exacte du run.

Grain : Exécution × joueur.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `score` | `double precision` | non |  | Résultat du modèle versionné ; l’échelle appartient à la définition du modèle. |
| `rank` | `integer` | oui |  | Rang publié ; les ex aequo ne sont pas interdits sans règle de la source. |
| `role_code` | `text` | oui |  | Rôle retenu pour l’évaluation, selon une définition versionnée. |
| `appearances_eligible` | `integer` | oui |  | Participations retenues selon les critères explicites du modèle. |
| `minutes_eligible` | `double precision` | oui |  | Minutes admissibles selon les critères explicites du modèle. |
| `components` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `coverage` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `run_id, player_id`.

- FK `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(components) = 'object'`.
- CHECK `jsonb_typeof(coverage) = 'object'`.
- CHECK `rank > 0`.
- CHECK `appearances_eligible >= 0`.
- CHECK `minutes_eligible >= 0`.
- CHECK `octet_length(components::text)<=16384`.
- CHECK `octet_length(coverage::text)<=16384`.
- INDEX `btree : [{"column": "run_id", "order": "ASC"}, {"column": "score", "order": "DESC"}, {"column": "player_id", "order": "ASC"}]`.


### analytics.published_score_runs

Pointeur vers une exécution validée pour un produit et un périmètre.

Grain : Produit × périmètre.

Écriture : `mutable` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `product_key` | `text` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id, product_key, scope_key). |
| `scope_key` | `text` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id, product_key, scope_key). |
| `run_id` | `bigint` | non | FK | Référence SQL vers analytics.scoring_runs(id, product_key, scope_key). |
| `published_at` | `timestamptz` | non |  | Publication déclarée ou activation, selon le grain de cette table. |

PK : `product_key, scope_key`.

- FK `run_id, product_key, scope_key → analytics.scoring_runs(id, product_key, scope_key) ; ON DELETE RESTRICT`.


### analytics.scoring_run_ranking_inputs

Éditions de classements externes effectivement utilisées par un calcul.

Grain : Exécution × instantané de classement.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `ranking_snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.ranking_snapshots(id). |
| `usage_definition` | `jsonb` | non |  | Matches/périmètres d’utilisation et règle temporelle. |

PK : `run_id, ranking_snapshot_id`.

- FK `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `ranking_snapshot_id → football.ranking_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(usage_definition) = 'object'`.
- CHECK `octet_length(usage_definition::text)<=16384`.


### analytics.scoring_runs

Calculs de scores reproductibles pour une fenêtre et un périmètre explicites.

Grain : Une exécution de modèle.

Écriture : `mutable` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `model_version_id` | `bigint` | non | FK | Référence SQL vers analytics.model_versions(id). |
| `dataset_snapshot_id` | `bigint` | non | FK | Référence SQL vers ingest.dataset_snapshots(id). |
| `product_key` | `text` | non |  | Produit ou publication de scores concerné. |
| `scope_key` | `text` | non |  | Identifiant stable d’un périmètre de calcul et de sa population. |
| `scope_definition` | `jsonb` | non |  | Compétitions, population, règles d’éligibilité et filtres réellement utilisés. |
| `window_start` | `date` | non |  | Première date inclusive de la fenêtre d’évaluation. |
| `window_end` | `date` | non |  | Dernière date inclusive de cette fenêtre. |
| `knowledge_cutoff_at` | `timestamptz` | non |  | Dernier instant auquel les informations sont admissibles pour ce calcul. |
| `temporal_policy` | `text` | non |  | Politique de disponibilité de l’information : observée, publiée avant cutoff ou rétrospective. |
| `parameters` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `started_at` | `timestamptz` | non |  | Instant UTC « started_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `finished_at` | `timestamptz` | oui |  | Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `error` | `jsonb` | oui |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |

PK : `id`.

- UNIQUE `id, product_key, scope_key`.
- FK `model_version_id → analytics.model_versions(id) ; ON DELETE RESTRICT`.
- FK `dataset_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(scope_definition) = 'object'`.
- CHECK `jsonb_typeof(parameters) = 'object'`.
- CHECK `jsonb_typeof(error) = 'object'`.
- CHECK `temporal_policy IN ('observed_by_cutoff', 'published_by_cutoff', 'retrospective')`.
- CHECK `status IN ('running', 'validating', 'ready', 'failed')`.
- CHECK `window_end >= window_start`.
- CHECK `finished_at >= started_at`.
- CHECK `octet_length(scope_definition::text)<=16384`.
- CHECK `octet_length(parameters::text)<=16384`.
- CHECK `octet_length(error::text)<=16384`.


### analytics.scouting_features

Variables préparées pour une fenêtre de joueur et un instantané donné.

Grain : Version de features × instantané × joueur × fenêtre × périmètre.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `feature_version_id` | `bigint` | non | FK | Référence SQL vers analytics.feature_versions(id). |
| `dataset_snapshot_id` | `bigint` | non | FK | Référence SQL vers ingest.dataset_snapshots(id). |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `window_start` | `date` | non |  | Première date inclusive de la fenêtre d’évaluation. |
| `window_end` | `date` | non |  | Dernière date inclusive de cette fenêtre. |
| `scope_key` | `text` | non |  | Identifiant stable d’un périmètre de calcul et de sa population. |
| `features` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `coverage` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `id`.

- UNIQUE `feature_version_id, dataset_snapshot_id, player_id, window_start, window_end, scope_key`.
- FK `feature_version_id → analytics.feature_versions(id) ; ON DELETE RESTRICT`.
- FK `dataset_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(features) = 'object'`.
- CHECK `jsonb_typeof(coverage) = 'object'`.
- CHECK `window_end >= window_start`.
- CHECK `octet_length(features::text)<=16384`.
- CHECK `octet_length(coverage::text)<=16384`.


### analytics.team_match_scores

Résultats immuables d’une exécution, sans écraser les scores antérieurs.

Grain : Exécution × match × team.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `score` | `double precision` | non |  | Résultat du modèle versionné ; l’échelle appartient à la définition du modèle. |
| `components` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `role_code` | `text` | oui |  | Rôle retenu pour l’évaluation, selon une définition versionnée. |
| `coverage` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |

PK : `run_id, match_id, team_id`.

- FK `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `match_id → football.matches(id) ; ON DELETE RESTRICT`.
- FK `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `jsonb_typeof(components) = 'object'`.
- CHECK `jsonb_typeof(coverage) = 'object'`.
- CHECK `octet_length(components::text)<=16384`.
- CHECK `octet_length(coverage::text)<=16384`.

- Aucune borne universelle 0–100: l’échelle appartient à model_versions.score_definition.
- La cohérence match/joueur/équipe est validée contre le snapshot du run. Les FK visent les identités stables, pas les faits courants corrigibles; une correction ne doit pas invalider un ancien résultat reproductible.

## Historiques SQL typés 01

### football.associations_history

Versions immuables typées de football.associations.

Grain : Une révision SQL de la clé logique de football.associations.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Valeur historique immuable. Nom de l’entité dans le contexte défini par cette table. |
| `federation_code` | `text` | oui |  | Valeur historique immuable. Code de la fédération sportive, distinct d’un ISO. |
| `country_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.countries(id). |
| `confederation_code` | `text` | oui |  | Valeur historique immuable. Code de la confédération sportive. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.countries_history

Versions immuables typées de football.countries.

Grain : Une révision SQL de la clé logique de football.countries.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Valeur historique immuable. Nom de l’entité dans le contexte défini par cette table. |
| `iso2` | `text` | oui |  | Valeur historique immuable. Code ISO à deux lettres uniquement lorsqu’il existe. |
| `iso3` | `text` | oui |  | Valeur historique immuable. Code ISO à trois lettres uniquement lorsqu’il existe. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### ingest.match_coverage_history

Versions immuables typées de ingest.match_coverage.

Grain : Une révision SQL de la clé logique de ingest.match_coverage.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.matches(id). |
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_documents(id, source_id). |
| `feature_code` | `text` | non |  | Valeur historique immuable. Famille fonctionnelle de couverture, par exemple lineups, shots ou heatmaps. |
| `coverage_state` | `text` | non |  | Valeur historique immuable. Disponibilité réelle de la famille, indépendante du statut HTTP : disponible, vide, indisponible, invalide, etc. |
| `http_status` | `smallint` | oui |  | Valeur historique immuable. Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP. |
| `error_code` | `text` | oui |  | Valeur historique immuable. Code d’erreur technique/fournisseur conservé exactement. |
| `observed_row_count` | `integer` | oui |  | Valeur historique immuable. Nombre de « observed row » du périmètre de cette ligne ; absence distincte de zéro. |
| `document_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers ingest.source_documents(id, source_id). |
| `checked_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « checked_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `is_stale` | `boolean` | non |  | Valeur historique immuable. Indique une donnée périmée selon sa politique de fraîcheur. |
| `data_revision` | `bigint` | non |  | Valeur historique immuable. Révision du grain ou de la famille, incrémentée seulement lorsque son contenu change. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### ingest.media_assets_history

Versions immuables typées de ingest.media_assets.

Grain : Une révision SQL de la clé logique de ingest.media_assets.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `storage_bucket` | `text` | non |  | Valeur historique immuable. Bucket du média conservé ou ancienne localisation de source supprimée. |
| `storage_key` | `text` | non |  | Valeur historique immuable. Clé du média conservé ou ancienne localisation de source ; aucun contenu incorporé. |
| `content_sha256` | `text` | oui |  | Valeur historique immuable. Empreinte SHA-256 hexadécimale du contenu effectivement vérifié ; aucune capacité de reconstruction par ce hash seul. |
| `source_url` | `text` | oui |  | Valeur historique immuable. Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité. |
| `content_type` | `text` | non |  | Valeur historique immuable. Type MIME du média ou de l’ancien artefact. |
| `author` | `text` | oui |  | Valeur historique immuable. Auteur ou crédit du média tel que sourcé. |
| `license_code` | `text` | oui |  | Valeur historique immuable. Licence ou conditions d’utilisation identifiées pour le corpus/média. |
| `attribution_url` | `text` | oui |  | Valeur historique immuable. Lien de crédit/licence à présenter pour le média. |
| `retrieved_at` | `timestamptz` | non |  | Valeur historique immuable. Récupération effective de la donnée source. |
| `legacy_asset_url` | `text` | oui |  | Valeur historique immuable. Ancienne URL publique à continuer de résoudre vers le média. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### ingest.source_datasets_history

Versions immuables typées de ingest.source_datasets.

Grain : Une révision SQL de la clé logique de ingest.source_datasets.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id). |
| `dataset_key` | `text` | non |  | Valeur historique immuable. Clé stable du corpus de cette source. |
| `contract_version` | `text` | non |  | Valeur historique immuable. Version du contrat de ce corpus, figée pour les observations qui l’utilisent. |
| `source_url` | `text` | oui |  | Valeur historique immuable. Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité. |
| `license_code` | `text` | oui |  | Valeur historique immuable. Licence ou conditions d’utilisation identifiées pour le corpus/média. |
| `schema_description` | `jsonb` | non |  | Valeur historique immuable. Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `created_at` | `timestamptz` | non |  | Valeur historique immuable. Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(schema_description::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### ingest.sources_history

Versions immuables typées de ingest.sources.

Grain : Une révision SQL de la clé logique de ingest.sources.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Valeur historique immuable. Code stable du référentiel, avec sa définition explicite. |
| `name` | `text` | non |  | Valeur historique immuable. Nom de l’entité dans le contexte défini par cette table. |
| `base_url` | `text` | oui |  | Valeur historique immuable. Adresse publique de base du fournisseur ; aucune clé ou secret inclus. |
| `upstream_source_id` | `bigint` | oui |  | Origine amont éventuelle; une copie ne devient pas une source indépendante. |
| `created_at` | `timestamptz` | non |  | Valeur historique immuable. Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 02

### football.coaches_history

Versions immuables typées de football.coaches.

Grain : Une révision SQL de la clé logique de football.coaches.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `display_name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `birth_date` | `date` | oui |  | Valeur historique immuable. Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.countries(id). |
| `image_asset_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers ingest.media_assets(id). |
| `created_at` | `timestamptz` | non |  | Valeur historique immuable. Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.competition_seasons_history

Versions immuables typées de football.competition_seasons.

Grain : Une révision SQL de la clé logique de football.competition_seasons.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competitions(id). |
| `season_key` | `text` | non |  | Valeur historique immuable. Saison métier de l’édition : par exemple 2026 ou 2026/2027 ; jamais déduite du seul répertoire. |
| `label` | `text` | non |  | Valeur historique immuable. Libellé d’affichage du code ou de l’édition. |
| `start_date` | `date` | oui |  | Valeur historique immuable. Première date métier connue de l’édition. |
| `end_date` | `date` | oui |  | Valeur historique immuable. Dernière date métier connue de l’édition. |
| `status` | `text` | non |  | Valeur historique immuable. État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.competitions_history

Versions immuables typées de football.competitions.

Grain : Une révision SQL de la clé logique de football.competitions.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `slug` | `text` | non |  | Valeur historique immuable. Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases. |
| `competition_type` | `text` | non |  | Valeur historique immuable. Nature league, cup, tournament, supercup, friendly, other ou unknown. |
| `association_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.associations(id). |
| `country_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.countries(id). |
| `gender` | `text` | non |  | Valeur historique immuable. Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `age_category` | `text` | oui |  | Valeur historique immuable. Catégorie d’âge déclarée ; ne pas la déduire sans preuve. |
| `image_asset_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers ingest.media_assets(id). |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.periods_history

Versions immuables typées de football.periods.

Grain : Une révision SQL de la clé logique de football.periods.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non |  | Valeur historique immuable. Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Valeur historique immuable. Libellé d’affichage du code ou de l’édition. |
| `sequence_no` | `integer` | non |  | Valeur historique immuable. Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire. |
| `is_aggregate` | `boolean` | non |  | Valeur historique immuable. Indique qu’une période recouvre d’autres périodes ; empêche leur addition naïve. |
| `definition` | `text` | non |  | Valeur historique immuable. Définition sémantique du code et de ses conditions d’utilisation. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.positions_history

Versions immuables typées de football.positions.

Grain : Une révision SQL de la clé logique de football.positions.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non |  | Valeur historique immuable. Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Valeur historique immuable. Libellé d’affichage du code ou de l’édition. |
| `family` | `text` | non |  | Valeur historique immuable. Famille de poste : gardien, défenseur, milieu ou attaquant. |
| `definition` | `text` | non |  | Valeur historique immuable. Définition sémantique du code et de ses conditions d’utilisation. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.venues_history

Versions immuables typées de football.venues.

Grain : Une révision SQL de la clé logique de football.venues.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `city` | `text` | oui |  | Valeur historique immuable. Ville du stade, si connue. |
| `country_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.countries(id). |
| `latitude` | `double precision` | oui |  | Valeur historique immuable. Latitude géographique du stade, entre −90 et 90. |
| `longitude` | `double precision` | oui |  | Valeur historique immuable. Longitude géographique du stade, entre −180 et 180. |
| `capacity` | `integer` | oui |  | Valeur historique immuable. Capacité du stade observée à capacity_as_of. |
| `capacity_as_of` | `date` | oui |  | Valeur historique immuable. Date de validité connue de la capacité. |
| `opened_year` | `integer` | oui |  | Valeur historique immuable. Année d’ouverture connue ; une date imprécise ne devient pas une année inventée. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 03

### football.competition_groups_history

Versions immuables typées de football.competition_groups.

Grain : Une révision SQL de la clé logique de football.competition_groups.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competition_stages(id, competition_season_id). |
| `stage_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competition_stages(id, competition_season_id). |
| `group_key` | `text` | non |  | Valeur historique immuable. Clé de groupe unique dans sa phase. |
| `name` | `text` | non |  | Valeur historique immuable. Nom de l’entité dans le contexte défini par cette table. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.competition_stages_history

Versions immuables typées de football.competition_stages.

Grain : Une révision SQL de la clé logique de football.competition_stages.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competition_seasons(id); football.competition_stages(id, competition_season_id). |
| `parent_stage_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.competition_stages(id, competition_season_id). |
| `stage_key` | `text` | non |  | Valeur historique immuable. Clé de phase unique dans son édition. |
| `stage_type` | `text` | non |  | Valeur historique immuable. Type de phase défini par les valeurs autorisées. |
| `name` | `text` | non |  | Valeur historique immuable. Nom de l’entité dans le contexte défini par cette table. |
| `sequence_no` | `integer` | oui |  | Valeur historique immuable. Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.competition_teams_history

Versions immuables typées de football.competition_teams.

Grain : Une révision SQL de la clé logique de football.competition_teams.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competition_seasons(id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `entered_on` | `date` | oui |  | Valeur historique immuable. Date d’engagement de l’équipe dans l’édition si réellement connue. |
| `exited_on` | `date` | oui |  | Valeur historique immuable. Date de sortie de l’édition si réellement connue. |
| `status` | `text` | non |  | Valeur historique immuable. État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.players_history

Versions immuables typées de football.players.

Grain : Une révision SQL de la clé logique de football.players.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `display_name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `birth_date` | `date` | oui |  | Valeur historique immuable. Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.countries(id). |
| `dominant_foot` | `text` | oui |  | Valeur historique immuable. Pied dominant connu : left, right, both ou unknown. |
| `height_cm` | `smallint` | oui |  | Valeur historique immuable. Taille connue en centimètres. |
| `primary_position_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.positions(code). |
| `created_at` | `timestamptz` | non |  | Valeur historique immuable. Création de cette ligne dans le système. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.position_mappings_history

Versions immuables typées de football.position_mappings.

Grain : Une révision SQL de la clé logique de football.position_mappings.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id). |
| `raw_position_code` | `text` | non |  | Valeur historique immuable. Code natif du poste ; résolution uniquement avec une version de mapping validée. |
| `mapping_version` | `text` | non |  | Valeur historique immuable. Version de la traduction des valeurs fournisseur. |
| `position_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.positions(code). |
| `status` | `text` | non |  | Valeur historique immuable. État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `evidence` | `jsonb` | non |  | Valeur historique immuable. Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(evidence::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.teams_history

Versions immuables typées de football.teams.

Grain : Une révision SQL de la clé logique de football.teams.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `short_name` | `text` | oui |  | Valeur historique immuable. Nom court observé. |
| `slug` | `text` | non |  | Valeur historique immuable. Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases. |
| `team_type` | `text` | non |  | Valeur historique immuable. Club, sélection nationale, équipe représentative ou type inconnu. |
| `gender` | `text` | non |  | Valeur historique immuable. Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `age_category` | `text` | oui |  | Valeur historique immuable. Catégorie d’âge déclarée ; ne pas la déduire sans preuve. |
| `country_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.countries(id). |
| `association_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.associations(id). |
| `image_asset_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers ingest.media_assets(id). |
| `founded_year` | `integer` | oui |  | Valeur historique immuable. Année de fondation lorsqu’elle est sourcée. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 04

### football.association_source_ids_history

Versions immuables typées de football.association_source_ids.

Grain : Une révision SQL de la clé logique de football.association_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `association_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.associations(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.competition_source_ids_history

Versions immuables typées de football.competition_source_ids.

Grain : Une révision SQL de la clé logique de football.competition_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `competition_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competitions(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.player_source_ids_history

Versions immuables typées de football.player_source_ids.

Grain : Une révision SQL de la clé logique de football.player_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.player_team_memberships_history

Versions immuables typées de football.player_team_memberships.

Grain : Une révision SQL de la clé logique de football.player_team_memberships.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `membership_type` | `text` | non |  | Valeur historique immuable. Appartenance club, prêt, sélection, observation ou autre ; simultanéité club/sélection permise. |
| `valid_from` | `date` | oui |  | Valeur historique immuable. Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Valeur historique immuable. Fin de validité connue ; NULL conserve une borne inconnue. |
| `date_precision` | `text` | non |  | Valeur historique immuable. Précision réelle des dates : day, month, year ou unknown. |
| `observed_from` | `date` | oui |  | Valeur historique immuable. Première observation de l’appartenance. |
| `observed_to` | `date` | oui |  | Valeur historique immuable. Dernière observation de l’appartenance. |
| `evidence_kind` | `text` | non |  | Valeur historique immuable. Nature de preuve : contrat, effectif, match, profil ou revue manuelle. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_aliases_history

Versions immuables typées de football.team_aliases.

Grain : Une révision SQL de la clé logique de football.team_aliases.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `alias` | `text` | non |  | Valeur historique immuable. Nom alternatif ou historique d’une équipe, conservé avec langue, source et validité. |
| `language_code` | `text` | oui |  | Valeur historique immuable. Langue de cet alias lorsqu’elle est connue. |
| `source_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers ingest.sources(id). |
| `valid_from` | `date` | oui |  | Valeur historique immuable. Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Valeur historique immuable. Fin de validité connue ; NULL conserve une borne inconnue. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_source_ids_history

Versions immuables typées de football.team_source_ids.

Grain : Une révision SQL de la clé logique de football.team_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 05

### football.coach_source_ids_history

Versions immuables typées de football.coach_source_ids.

Grain : Une révision SQL de la clé logique de football.coach_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `coach_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.coaches(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_scores_history

Versions immuables typées de football.match_scores.

Grain : Une révision SQL de la clé logique de football.match_scores.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, side). |
| `side` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, side). |
| `score_scope` | `text` | non |  | Valeur historique immuable. Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance. |
| `goals` | `integer` | oui |  | Valeur historique immuable. Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `score_basis` | `text` | non |  | Valeur historique immuable. Score effectivement joué, attribué administrativement ou de base inconnue. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_source_ids_history

Versions immuables typées de football.match_source_ids.

Grain : Une révision SQL de la clé logique de football.match_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.matches(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_teams_history

Versions immuables typées de football.match_teams.

Grain : Une révision SQL de la clé logique de football.match_teams.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.matches(id). |
| `side` | `text` | non |  | Valeur historique immuable. Place home ou away du participant dans ce match. |
| `team_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `participant_label` | `text` | oui |  | Valeur historique immuable. Libellé de participant encore non résolu, par exemple vainqueur d’une demi-finale. |
| `coach_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.coaches(id). |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.matches_history

Versions immuables typées de football.matches.

Grain : Une révision SQL de la clé logique de football.matches.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.competition_seasons(id); football.competition_stages(id, competition_season_id); football.competition_groups(id, stage_id, competition_season_id). |
| `stage_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.competition_stages(id, competition_season_id); football.competition_groups(id, stage_id, competition_season_id). |
| `group_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.competition_groups(id, stage_id, competition_season_id). |
| `round_label` | `text` | oui |  | Valeur historique immuable. Tour ou journée tel qu’observé ; ne présume pas un ordre numérique. |
| `round_number` | `integer` | oui |  | Valeur historique immuable. Numéro de journée/tour lorsqu’il est explicitement connu. |
| `leg_number` | `smallint` | oui |  | Valeur historique immuable. Manche d’une confrontation aller/retour. |
| `tie_key` | `text` | oui |  | Valeur historique immuable. Clé qui regroupe les manches d’une confrontation. |
| `match_date` | `date` | oui |  | Valeur historique immuable. Date civile connue du match ; une heure inconnue ne crée pas un instant minuit fictif. |
| `kickoff_at` | `timestamptz` | oui |  | Valeur historique immuable. Instant UTC du coup d’envoi, uniquement lorsque l’heure est connue. |
| `kickoff_precision` | `text` | non |  | Valeur historique immuable. Précision réellement fournie : unknown, date, minute ou second. |
| `source_timezone` | `text` | oui |  | Valeur historique immuable. Fuseau de la date/heure source si connu, utilisé pour la conversion explicite. |
| `status` | `text` | non |  | Valeur historique immuable. État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `publication_state` | `text` | non |  | Valeur historique immuable. draft, published ou quarantined ; les invariants renforcés s’appliquent à la publication. |
| `venue_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.venues(id). |
| `neutral_venue` | `boolean` | oui |  | Valeur historique immuable. Terrain neutre si explicitement connu. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.venue_source_ids_history

Versions immuables typées de football.venue_source_ids.

Grain : Une révision SQL de la clé logique de football.venue_source_ids.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non |  | Valeur historique immuable. Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `venue_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.venues(id). |
| `first_seen_at` | `timestamptz` | non |  | Valeur historique immuable. Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 06

### football.match_lineups_history

Versions immuables typées de football.match_lineups.

Grain : Une révision SQL de la clé logique de football.match_lineups.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `formation` | `text` | oui |  | Valeur historique immuable. Formation observée, conservée comme libellé. |
| `confirmed` | `boolean` | oui |  | Valeur historique immuable. Confirmation explicite de la composition ; une prédiction ne vaut pas confirmation. |
| `lineup_type` | `text` | non |  | Valeur historique immuable. Nature confirmed, predicted, observed ou unknown de la composition. |
| `published_at` | `timestamptz` | oui |  | Valeur historique immuable. Publication déclarée ou activation, selon le grain de cette table. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_players_history

Versions immuables typées de football.match_players.

Grain : Une révision SQL de la clé logique de football.match_players.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.players(id); football.player_profile_versions(id, player_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `profile_version_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.player_profile_versions(id, player_id). |
| `is_starter` | `boolean` | oui |  | Valeur historique immuable. Statut titulaire observé ; ne pas le déduire de statistiques manquantes. |
| `squad_status` | `text` | non |  | Valeur historique immuable. Titulaire, remplaçant, remplaçant inutilisé, observation ou état inconnu. |
| `played` | `boolean` | oui |  | Valeur historique immuable. Participation prouvée dans match_players ; dans un classement, nombre de matchs joués. |
| `participation_evidence` | `text` | oui |  | Valeur historique immuable. Preuve explicite qui justifie played ; une ligne de performance ne suffit pas. |
| `shirt_number` | `text` | oui |  | Valeur historique immuable. Numéro natif conservé en texte ; la forme et le type d’origine sont traçables par field_states. |
| `raw_position_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.position_mappings(source_id, raw_position_code, mapping_version). |
| `position_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.positions(code). |
| `position_mapping_version` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.position_mappings(source_id, raw_position_code, mapping_version). |
| `raw_pitch_x` | `double precision` | oui |  | Valeur historique immuable. Coordonnée native de placement du joueur ; pas une distance en mètres supposée. |
| `raw_pitch_y` | `double precision` | oui |  | Valeur historique immuable. Seconde coordonnée native de placement du joueur. |
| `coordinate_frame` | `text` | oui |  | Valeur historique immuable. Repère spatial déclaré par la source, propre à cette famille. |
| `is_captain` | `boolean` | oui |  | Valeur historique immuable. Capitanat explicitement indiqué dans la composition. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.metric_definitions_history

Versions immuables typées de football.metric_definitions.

Grain : Une révision SQL de la clé logique de football.metric_definitions.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non |  | Valeur historique immuable. Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Valeur historique immuable. Libellé d’affichage du code ou de l’édition. |
| `definition` | `text` | non |  | Valeur historique immuable. Définition sémantique du code et de ses conditions d’utilisation. |
| `unit` | `text` | non |  | Valeur historique immuable. Unité déclarée et versionnée de la métrique. |
| `scope` | `text` | non |  | Valeur historique immuable. Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent. |
| `aggregation` | `text` | non |  | Valeur historique immuable. Règle sum, weighted_mean, ratio_of_sums, last ou none de cette métrique. |
| `minimum` | `double precision` | oui |  | Valeur historique immuable. Borne inférieure documentée de cette métrique. |
| `maximum` | `double precision` | oui |  | Valeur historique immuable. Borne supérieure documentée de cette métrique. |
| `allows_negative` | `boolean` | non |  | Valeur historique immuable. Autorisation explicite de valeurs signées pour cette métrique. |
| `numerator_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.metric_definitions(code). |
| `denominator_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.metric_definitions(code). |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.player_match_stats_history

Versions immuables typées de football.player_match_stats.

Grain : Une révision SQL de la clé logique de football.player_match_stats.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `period_code` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `goals` | `integer` | oui |  | Valeur historique immuable. Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `assists` | `integer` | oui |  | Valeur historique immuable. Passes décisives attribuées par le fournisseur dans cette période. |
| `shots` | `integer` | oui |  | Valeur historique immuable. Nombre de tirs observés selon la définition source. |
| `shots_on_target` | `integer` | oui |  | Valeur historique immuable. Tirs cadrés observés selon la définition source. |
| `chances_created` | `integer` | oui |  | Valeur historique immuable. Occasions créées attribuées par la source. |
| `big_chances_created` | `integer` | oui |  | Valeur historique immuable. Grosses occasions créées selon la définition source. |
| `passes_completed` | `integer` | oui |  | Valeur historique immuable. Passes réussies observées. |
| `passes_attempted` | `integer` | oui |  | Valeur historique immuable. Passes tentées observées, dénominateur des taux. |
| `passes_final_third` | `integer` | oui |  | Valeur historique immuable. Passes dans le dernier tiers selon le contrat source. |
| `defensive_actions` | `integer` | oui |  | Valeur historique immuable. Actions défensives selon le contrat de la mesure. |
| `interceptions` | `integer` | oui |  | Valeur historique immuable. Interceptions observées. |
| `tackles` | `integer` | oui |  | Valeur historique immuable. Tacles selon la définition source. |
| `recoveries` | `integer` | oui |  | Valeur historique immuable. Ballons récupérés. |
| `duels_won` | `integer` | oui |  | Valeur historique immuable. Duels gagnés observés. |
| `duels_lost` | `integer` | oui |  | Valeur historique immuable. Duels perdus observés. |
| `aerial_duels_won` | `integer` | oui |  | Valeur historique immuable. Duels aériens gagnés. |
| `aerial_duels_attempted` | `integer` | oui |  | Valeur historique immuable. Duels aériens disputés, dénominateur connu. |
| `touches` | `integer` | oui |  | Valeur historique immuable. Ballons touchés selon le fournisseur. |
| `touches_box` | `integer` | oui |  | Valeur historique immuable. Ballons touchés dans la surface. |
| `clearances` | `integer` | oui |  | Valeur historique immuable. Dégagements observés. |
| `blocks` | `integer` | oui |  | Valeur historique immuable. Actions bloquées selon la définition source. |
| `dribbles_completed` | `integer` | oui |  | Valeur historique immuable. Dribbles réussis. |
| `dribbles_attempted` | `integer` | oui |  | Valeur historique immuable. Dribbles tentés. |
| `saves` | `integer` | oui |  | Valeur historique immuable. Arrêts du gardien observés. |
| `xg` | `double precision` | oui |  | Valeur historique immuable. Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `non_penalty_xg` | `double precision` | oui |  | Valeur historique immuable. Buts attendus hors penalties selon la définition source. |
| `xa` | `double precision` | oui |  | Valeur historique immuable. Passes décisives attendues ; une valeur indisponible reste indisponible. |
| `xgot` | `double precision` | oui |  | Valeur historique immuable. Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `minutes_played` | `double precision` | oui |  | Valeur historique immuable. Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation. |
| `provider_rating` | `double precision` | oui |  | Valeur historique immuable. Note du fournisseur ; distincte d’un score Orion. |
| `goals_prevented` | `double precision` | oui |  | Valeur historique immuable. Buts évités selon le modèle gardien du fournisseur ; valeur signée. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.source_metric_mappings_history

Versions immuables typées de football.source_metric_mappings.

Grain : Une révision SQL de la clé logique de football.source_metric_mappings.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers ingest.sources(id). |
| `family_code` | `text` | non |  | Valeur historique immuable. Famille de données dont le contrat définit cette clé. |
| `raw_key` | `text` | non |  | Valeur historique immuable. Clé technique native de la métrique. |
| `mapping_version` | `text` | non |  | Valeur historique immuable. Version de la traduction des valeurs fournisseur. |
| `metric_code` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.metric_definitions(code). |
| `parse_rule` | `jsonb` | non |  | Valeur historique immuable. Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `period_rule` | `jsonb` | non |  | Valeur historique immuable. Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `definition_notes` | `text` | oui |  | Valeur historique immuable. Limites et définition particulières de la correspondance. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(parse_rule::text)<=16384`.
- CHECK `octet_length(period_rule::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_match_stats_history

Versions immuables typées de football.team_match_stats.

Grain : Une révision SQL de la clé logique de football.team_match_stats.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `period_code` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `shots` | `integer` | oui |  | Valeur historique immuable. Nombre de tirs observés selon la définition source. |
| `shots_on_target` | `integer` | oui |  | Valeur historique immuable. Tirs cadrés observés selon la définition source. |
| `shots_off_target` | `integer` | oui |  | Valeur historique immuable. Tirs non cadrés observés. |
| `shots_blocked` | `integer` | oui |  | Valeur historique immuable. Tirs bloqués observés. |
| `corners` | `integer` | oui |  | Valeur historique immuable. Corners observés. |
| `offsides` | `integer` | oui |  | Valeur historique immuable. Hors-jeu observés. |
| `fouls` | `integer` | oui |  | Valeur historique immuable. Fautes observées. |
| `yellow_cards` | `integer` | oui |  | Valeur historique immuable. Avertissements attribués dans cette période. |
| `red_cards` | `integer` | oui |  | Valeur historique immuable. Expulsions attribuées dans cette période. |
| `passes_completed` | `integer` | oui |  | Valeur historique immuable. Passes réussies observées. |
| `passes_attempted` | `integer` | oui |  | Valeur historique immuable. Passes tentées observées, dénominateur des taux. |
| `crosses_completed` | `integer` | oui |  | Valeur historique immuable. Centres réussis. |
| `crosses_attempted` | `integer` | oui |  | Valeur historique immuable. Centres tentés. |
| `tackles` | `integer` | oui |  | Valeur historique immuable. Tacles selon la définition source. |
| `interceptions` | `integer` | oui |  | Valeur historique immuable. Interceptions observées. |
| `recoveries` | `integer` | oui |  | Valeur historique immuable. Ballons récupérés. |
| `duels_won` | `integer` | oui |  | Valeur historique immuable. Duels gagnés observés. |
| `saves` | `integer` | oui |  | Valeur historique immuable. Arrêts du gardien observés. |
| `touches_box` | `integer` | oui |  | Valeur historique immuable. Ballons touchés dans la surface. |
| `xg` | `double precision` | oui |  | Valeur historique immuable. Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `non_penalty_xg` | `double precision` | oui |  | Valeur historique immuable. Buts attendus hors penalties selon la définition source. |
| `xgot` | `double precision` | oui |  | Valeur historique immuable. Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `possession_pct` | `double precision` | oui |  | Valeur historique immuable. Possession en pourcentage 0–100, selon la définition de cette table. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 07

### football.match_events_history

Versions immuables typées de football.match_events.

Grain : Une révision SQL de la clé logique de football.match_events.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.matches(id); football.match_teams(match_id, team_id). |
| `event_seq` | `integer` | non |  | Valeur historique immuable. Ordre dans une version du flux ; ne constitue pas une identité stable entre corrections. |
| `event_type` | `text` | non |  | Valeur historique immuable. Type d’événement observé ; mapping versionné si normalisé. |
| `period_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `minute` | `integer` | oui |  | Valeur historique immuable. Minute source dans la période indiquée ; précision conservée. |
| `minute_added` | `integer` | oui |  | Valeur historique immuable. Temps additionnel distinct de la minute principale. |
| `second` | `smallint` | oui |  | Valeur historique immuable. Seconde dans la minute, de 0 à 59. |
| `team_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `related_player_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `is_penalty` | `boolean` | oui |  | Valeur historique immuable. Penalty explicitement signalé dans l’observation. |
| `is_own_goal` | `boolean` | oui |  | Valeur historique immuable. But contre son camp explicitement signalé. |
| `source_event_id` | `text` | oui |  | Valeur historique immuable. Identifiant natif d’événement s’il existe ; sinon ordre dans la famille versionnée. |
| `source_ordinal` | `integer` | non |  | Valeur historique immuable. Position native dans la collection source, conservée pour la compatibilité. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `score_home` | `integer` | oui |  | Score observé après l’événement, sans supposer sa portée si la source ne la donne pas. |
| `score_away` | `integer` | oui |  | Score observé après l’événement, sans supposer sa portée si la source ne la donne pas. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_momentum_history

Versions immuables typées de football.match_momentum.

Grain : Une révision SQL de la clé logique de football.match_momentum.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.matches(id). |
| `series_code` | `text` | non |  | Valeur historique immuable. Série de momentum concernée, conservée distinctement des autres séries. |
| `sample_index` | `integer` | non |  | Valeur historique immuable. Index du point dans l’ordre natif de la série de momentum. |
| `minute` | `double precision` | oui |  | Valeur historique immuable. Minute source dans la période indiquée ; précision conservée. |
| `period_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `value` | `double precision` | non |  | Valeur historique immuable. Valeur fournie dans le grain et l’unité définis par la table. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.pass_networks_history

Versions immuables typées de football.pass_networks.

Grain : Une révision SQL de la clé logique de football.pass_networks.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `window_kind` | `text` | non |  | Valeur historique immuable. Contrat de la fenêtre temporelle du réseau. |
| `from_seconds` | `integer` | oui |  | Valeur historique immuable. Début connu de la fenêtre du réseau, en secondes de match. |
| `until_seconds` | `integer` | oui |  | Valeur historique immuable. Fin de la fenêtre ; first_substitution ne décrit pas tout le match. |
| `centralization` | `double precision` | oui |  | Valeur historique immuable. Centralisation collective fournie pour cette fenêtre. |
| `coordinate_frame` | `text` | oui |  | Valeur historique immuable. Repère spatial déclaré par la source, propre à cette famille. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.player_match_advanced_history

Versions immuables typées de football.player_match_advanced.

Grain : Une révision SQL de la clé logique de football.player_match_advanced.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `period_code` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_players(match_id, player_id, team_id). |
| `progressive_passes` | `integer` | oui |  | Valeur historique immuable. Passes progressives selon la définition du fournisseur. |
| `passes_into_box` | `integer` | oui |  | Valeur historique immuable. Passes dans la surface. |
| `key_passes` | `integer` | oui |  | Valeur historique immuable. Passes clés selon le fournisseur. |
| `through_balls` | `integer` | oui |  | Valeur historique immuable. Passes en profondeur. |
| `crosses` | `integer` | oui |  | Valeur historique immuable. Centres du contrat avancé. |
| `switches` | `integer` | oui |  | Valeur historique immuable. Renversements de jeu du contrat avancé. |
| `carries` | `integer` | oui |  | Valeur historique immuable. Conduites de balle observées. |
| `progressive_carries` | `integer` | oui |  | Valeur historique immuable. Conduites progressives. |
| `carries_into_final_third` | `integer` | oui |  | Valeur historique immuable. Conduites dans le dernier tiers. |
| `carries_into_box` | `integer` | oui |  | Valeur historique immuable. Conduites dans la surface. |
| `take_ons` | `integer` | oui |  | Valeur historique immuable. Tentatives de duel offensif. |
| `take_ons_won` | `integer` | oui |  | Valeur historique immuable. Duels offensifs réussis. |
| `miscontrols` | `integer` | oui |  | Valeur historique immuable. Mauvais contrôles observés. |
| `dispossessed` | `integer` | oui |  | Valeur historique immuable. Pertes sur dépossession. |
| `sca` | `integer` | oui |  | Valeur historique immuable. Actions menant à un tir selon la méthode du fournisseur. |
| `gca` | `integer` | oui |  | Valeur historique immuable. Actions menant à un but selon cette méthode. |
| `second_assists` | `integer` | oui |  | Valeur historique immuable. Avant-dernières passes décisives attribuées. |
| `xt_total` | `double precision` | oui |  | Valeur historique immuable. Expected threat fournisseur, valeur signée ; modèle identifié séparément. |
| `vaep_total` | `double precision` | oui |  | Valeur historique immuable. Valeur VAEP totale fournisseur, signée. |
| `vaep_offensive` | `double precision` | oui |  | Valeur historique immuable. Composante offensive VAEP, signée. |
| `vaep_defensive` | `double precision` | oui |  | Valeur historique immuable. Composante défensive VAEP, signée. |
| `pv_total` | `double precision` | oui |  | Valeur historique immuable. Valeur totale de possession du modèle fournisseur. |
| `pv_offensive` | `double precision` | oui |  | Valeur historique immuable. Composante offensive de possession. |
| `pv_defensive` | `double precision` | oui |  | Valeur historique immuable. Composante défensive de possession. |
| `progressive_pass_distance` | `double precision` | oui |  | Valeur historique immuable. Distance des passes progressives, unité fournisseur à valider. |
| `carry_distance` | `double precision` | oui |  | Valeur historique immuable. Distance de conduite, unité fournisseur à valider. |
| `progressive_carry_distance` | `double precision` | oui |  | Valeur historique immuable. Distance des conduites progressives selon ce contrat. |
| `xag` | `double precision` | oui |  | Valeur historique immuable. Expected assisted goals selon le modèle fournisseur. |
| `xg_chain` | `double precision` | oui |  | Valeur historique immuable. Contribution xG de chaîne de possession selon ce modèle. |
| `xg_buildup` | `double precision` | oui |  | Valeur historique immuable. Contribution xG de construction selon ce modèle. |
| `provider_model_version` | `text` | oui |  | Valeur historique immuable. Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `sca_pass_live` | `double precision` | oui |  | Contribution SCA de type pass_live, valeur observée selon la définition fournisseur. |
| `sca_pass_dead` | `double precision` | oui |  | Contribution SCA de type pass_dead, valeur observée selon la définition fournisseur. |
| `sca_take_on` | `double precision` | oui |  | Contribution SCA de type take_on, valeur observée selon la définition fournisseur. |
| `sca_shot` | `double precision` | oui |  | Contribution SCA de type shot, valeur observée selon la définition fournisseur. |
| `sca_foul_drawn` | `double precision` | oui |  | Contribution SCA de type foul_drawn, valeur observée selon la définition fournisseur. |
| `sca_defensive` | `double precision` | oui |  | Contribution SCA de type defensive, valeur observée selon la définition fournisseur. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.shots_history

Versions immuables typées de football.shots.

Grain : Une révision SQL de la clé logique de football.shots.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.players(id); football.player_profile_versions(id, player_id). |
| `external_shot_id` | `text` | non |  | Valeur historique immuable. Identifiant de tir limité à son match et sa source. |
| `period_code` | `text` | oui |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `minute` | `integer` | oui |  | Valeur historique immuable. Minute source dans la période indiquée ; précision conservée. |
| `minute_added` | `integer` | oui |  | Valeur historique immuable. Temps additionnel distinct de la minute principale. |
| `x_m` | `double precision` | oui |  | Valeur historique immuable. Coordonnée longitudinale du tir, en mètres seulement si conversion vérifiée ; le repère est explicite. |
| `y_m` | `double precision` | oui |  | Valeur historique immuable. Coordonnée transversale du tir dans le repère déclaré. |
| `coordinate_frame` | `text` | oui |  | Valeur historique immuable. Repère spatial déclaré par la source, propre à cette famille. |
| `pitch_length_m` | `double precision` | oui |  | Valeur historique immuable. Longueur du terrain en mètres lorsqu’elle est explicitement connue. |
| `pitch_width_m` | `double precision` | oui |  | Valeur historique immuable. Largeur du terrain en mètres lorsqu’elle est connue. |
| `xg` | `double precision` | oui |  | Valeur historique immuable. Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `xgot` | `double precision` | oui |  | Valeur historique immuable. Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `outcome` | `text` | oui |  | Valeur historique immuable. Résultat du tir selon un mapping documenté. |
| `body_part` | `text` | oui |  | Valeur historique immuable. Partie du corps si fournie ; ne pas l’inférer d’un code de tir non défini. |
| `situation` | `text` | oui |  | Valeur historique immuable. Contexte du tir : jeu ouvert, phase arrêtée, etc., selon les codes source. |
| `is_goal` | `boolean` | oui |  | Valeur historique immuable. Indicateur de but observé ou dérivé sous règle versionnée. |
| `is_own_goal` | `boolean` | oui |  | Valeur historique immuable. But contre son camp explicitement signalé. |
| `is_on_target` | `boolean` | oui |  | Valeur historique immuable. Indicateur natif de tir cadré. |
| `is_inside_box` | `boolean` | oui |  | Valeur historique immuable. Tir dans la surface selon la source. |
| `goal_crossed_y` | `double precision` | oui |  | Valeur historique immuable. Coordonnée du franchissement de la ligne de but dans le repère du fournisseur. |
| `goal_crossed_z` | `double precision` | oui |  | Valeur historique immuable. Hauteur du franchissement de la ligne de but dans le repère du fournisseur. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `keeper_id` | `bigint` | oui |  | Gardien associé au tir dans l’observation. |
| `blocked_x` | `double precision` | oui |  | Coordonnée du point de blocage, dans le repère source déclaré. |
| `blocked_y` | `double precision` | oui |  | Seconde coordonnée du point de blocage. |
| `is_blocked` | `boolean` | oui |  | Indicateur natif de tir bloqué. |
| `is_saved_off_line` | `boolean` | oui |  | Indicateur natif de sauvetage sur la ligne. |
| `source_shot_type` | `text` | oui |  | Type natif ; aucune confusion automatique avec la partie du corps. |
| `source_event_type` | `text` | oui |  | Résultat/type natif du tir. |
| `source_ordinal` | `integer` | oui |  | Ordre de présentation dans cette version de la famille. |
| `player_profile_version_id` | `bigint` | oui |  | Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte. |
| `keeper_profile_version_id` | `bigint` | oui |  | Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_match_advanced_history

Versions immuables typées de football.team_match_advanced.

Grain : Une révision SQL de la clé logique de football.team_match_advanced.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `period_code` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `opponent_passes` | `integer` | oui |  | Valeur historique immuable. Passes adverses entrant dans le périmètre de la mesure. |
| `defensive_actions` | `integer` | oui |  | Valeur historique immuable. Actions défensives selon le contrat de la mesure. |
| `high_turnovers` | `integer` | oui |  | Valeur historique immuable. Récupérations hautes selon le fournisseur. |
| `counterpress_regains_5s` | `integer` | oui |  | Valeur historique immuable. Récupérations dans les cinq secondes du contre-pressing. |
| `final_third_entries` | `integer` | oui |  | Valeur historique immuable. Entrées dans le dernier tiers. |
| `box_entries` | `integer` | oui |  | Valeur historique immuable. Entrées dans la surface. |
| `buildup_attacks` | `integer` | oui |  | Valeur historique immuable. Attaques construites selon la définition source. |
| `direct_attacks` | `integer` | oui |  | Valeur historique immuable. Attaques directes selon cette définition. |
| `challenges` | `integer` | oui |  | Valeur historique immuable. Duels/interventions du contrat avancé. |
| `aerials` | `integer` | oui |  | Valeur historique immuable. Duels aériens selon le contrat avancé. |
| `aerials_won` | `integer` | oui |  | Valeur historique immuable. Duels aériens gagnés du contrat avancé. |
| `xt_total` | `double precision` | oui |  | Valeur historique immuable. Expected threat fournisseur, valeur signée ; modèle identifié séparément. |
| `vaep_total` | `double precision` | oui |  | Valeur historique immuable. Valeur VAEP totale fournisseur, signée. |
| `vaep_offensive` | `double precision` | oui |  | Valeur historique immuable. Composante offensive VAEP, signée. |
| `vaep_defensive` | `double precision` | oui |  | Valeur historique immuable. Composante défensive VAEP, signée. |
| `pv_total` | `double precision` | oui |  | Valeur historique immuable. Valeur totale de possession du modèle fournisseur. |
| `pv_offensive` | `double precision` | oui |  | Valeur historique immuable. Composante offensive de possession. |
| `pv_defensive` | `double precision` | oui |  | Valeur historique immuable. Composante défensive de possession. |
| `ppda` | `double precision` | oui |  | Valeur historique immuable. Passes adverses par action défensive selon le contrat source ; dénominateur conservé lorsqu’il existe. |
| `field_tilt` | `double precision` | oui |  | Valeur historique immuable. Part territoriale normalisée sous contrat, échelle 0–100. |
| `possession_pct` | `double precision` | oui |  | Valeur historique immuable. Possession en pourcentage 0–100, selon la définition de cette table. |
| `avg_action_x` | `double precision` | oui |  | Valeur historique immuable. Position longitudinale moyenne des actions, repère déclaré. |
| `avg_defensive_action_x` | `double precision` | oui |  | Valeur historique immuable. Position longitudinale moyenne des actions défensives. |
| `ball_recovery_time_seconds` | `double precision` | oui |  | Valeur historique immuable. Temps de récupération en secondes selon le contrat source. |
| `passes_per_sequence` | `double precision` | oui |  | Valeur historique immuable. Passes par séquence selon le contrat source. |
| `sequence_time_seconds` | `double precision` | oui |  | Valeur historique immuable. Durée de séquence en secondes. |
| `direct_speed` | `double precision` | oui |  | Valeur historique immuable. Vitesse de progression directe ; unité de la définition fournisseur. |
| `provider_model_version` | `text` | oui |  | Valeur historique immuable. Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue. |
| `coordinate_frame` | `text` | oui |  | Valeur historique immuable. Repère spatial déclaré par la source, propre à cette famille. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 08

### football.honour_definitions_history

Versions immuables typées de football.honour_definitions.

Grain : Une révision SQL de la clé logique de football.honour_definitions.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Valeur historique immuable. Code stable du référentiel, avec sa définition explicite. |
| `name` | `text` | non |  | Valeur historique immuable. Nom de l’entité dans le contexte défini par cette table. |
| `honour_type` | `text` | non |  | Valeur historique immuable. Titre collectif ou distinction individuelle. |
| `competition_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.competitions(id). |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_heatmaps_history

Versions immuables typées de football.match_heatmaps.

Grain : Une révision SQL de la clé logique de football.match_heatmaps.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.match_teams(match_id, team_id). |
| `player_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `period_code` | `text` | non |  | Valeur historique immuable. Référence SQL vers football.periods(code). |
| `map_kind` | `text` | non |  | Valeur historique immuable. Nature de la carte spatiale. |
| `grid_columns` | `smallint` | non |  | Valeur historique immuable. Nombre de colonnes de la grille spatiale. |
| `grid_rows` | `smallint` | non |  | Valeur historique immuable. Nombre de lignes de la grille spatiale. |
| `cell_length_m` | `double precision` | non |  | Valeur historique immuable. Longueur en mètres d’une cellule. |
| `cell_width_m` | `double precision` | non |  | Valeur historique immuable. Largeur en mètres d’une cellule. |
| `coordinate_frame` | `text` | non |  | Valeur historique immuable. Repère spatial déclaré par la source, propre à cette famille. |
| `actions` | `integer` | oui |  | Valeur historique immuable. Nombre d’actions couvertes, si renseigné. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `cells_state` | `text` | non |  | absent, null, empty ou available ; aucun tableau vide interprété comme une grille de zéros. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.pass_network_edges_history

Versions immuables typées de football.pass_network_edges.

Grain : Une révision SQL de la clé logique de football.pass_network_edges.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `network_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.pass_network_nodes(network_id, player_id); football.pass_network_nodes(network_id, player_id). |
| `from_player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.pass_network_nodes(network_id, player_id). |
| `to_player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.pass_network_nodes(network_id, player_id). |
| `passes` | `integer` | non |  | Valeur historique immuable. Passes observées pour le nœud, l’arête ou le périmètre de cette table. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.pass_network_nodes_history

Versions immuables typées de football.pass_network_nodes.

Grain : Une révision SQL de la clé logique de football.pass_network_nodes.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `network_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.pass_networks(id). |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `avg_x` | `double precision` | oui |  | Valeur historique immuable. Position longitudinale moyenne dans le repère du réseau. |
| `avg_y` | `double precision` | oui |  | Valeur historique immuable. Position transversale moyenne dans ce repère. |
| `passes` | `integer` | oui |  | Valeur historique immuable. Passes observées pour le nœud, l’arête ou le périmètre de cette table. |
| `passes_received` | `integer` | oui |  | Valeur historique immuable. Passes reçues par ce nœud du réseau. |
| `degree` | `integer` | oui |  | Valeur historique immuable. Degré du nœud selon le contrat réseau. |
| `strength` | `double precision` | oui |  | Valeur historique immuable. Force pondérée du nœud selon le contrat fournisseur. |
| `betweenness` | `double precision` | oui |  | Valeur historique immuable. Centralité d’intermédiarité fournie. |
| `clustering` | `double precision` | oui |  | Valeur historique immuable. Coefficient de clustering fourni. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.player_honours_history

Versions immuables typées de football.player_honours.

Grain : Une révision SQL de la clé logique de football.player_honours.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.players(id). |
| `honour_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.honour_definitions(id). |
| `competition_season_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.competition_seasons(id). |
| `season_label` | `text` | oui |  | Valeur historique immuable. Libellé historique conservé lorsqu’aucune édition canonique n’est résolue. |
| `edition_key` | `text` | non |  | Clé d’édition de la distinction, conservée même sans édition de compétition résolue. |
| `outcome` | `text` | non |  | Valeur historique immuable. Résultat du tir selon un mapping documenté. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `team_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_coach_tenures_history

Versions immuables typées de football.team_coach_tenures.

Grain : Une révision SQL de la clé logique de football.team_coach_tenures.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `coach_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.coaches(id). |
| `role` | `text` | non |  | Valeur historique immuable. Fonction effectivement observée de l’entraîneur durant cet épisode. |
| `valid_from` | `date` | oui |  | Valeur historique immuable. Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Valeur historique immuable. Fin de validité connue ; NULL conserve une borne inconnue. |
| `date_precision` | `text` | non |  | Valeur historique immuable. Précision réelle des dates : day, month, year ou unknown. |
| `observed_at` | `timestamptz` | non |  | Valeur historique immuable. Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

## Historiques SQL typés 09

### football.match_h2h_entries_history

Versions immuables typées de football.match_h2h_entries.

Grain : Une révision SQL de la clé logique de football.match_h2h_entries.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Rencontre pour laquelle le H2H a été collecté. |
| `entry_ordinal` | `integer` | non |  | Ordre du fournisseur. |
| `previous_match_id` | `bigint` | oui |  | Rencontre antérieure résolue si possible ; aucune identité inventée. |
| `external_match_id` | `text` | oui |  | Identifiant public natif de la rencontre antérieure. |
| `match_date` | `date` | oui |  | Date connue de cette rencontre. |
| `time_utc_source` | `text` | oui |  | Heure native ; chaîne vide distincte d’absence. |
| `status_source` | `text` | oui |  | Statut natif observé. |
| `home_team_id` | `bigint` | oui |  | Équipe domicile si résolue. |
| `away_team_id` | `bigint` | oui |  | Équipe extérieure si résolue. |
| `home_label` | `text` | oui |  | Libellé domicile observé. |
| `away_label` | `text` | oui |  | Libellé extérieur observé. |
| `home_score` | `integer` | oui |  | Score natif connu ; portée non inventée. |
| `away_score` | `integer` | oui |  | Score natif connu. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `home_image_asset_id` | `bigint` | oui |  | Média de l’équipe effectivement observé dans cette ligne H2H. |
| `away_image_asset_id` | `bigint` | oui |  | Média de l’équipe effectivement observé dans cette ligne H2H. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.match_heatmap_cells_history

Versions immuables typées de football.match_heatmap_cells.

Grain : Une révision SQL de la clé logique de football.match_heatmap_cells.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `heatmap_id` | `bigint` | non |  | Carte parente. |
| `cell_ordinal` | `integer` | non |  | Ordre natif dans cette version. |
| `column_index` | `smallint` | non |  | Colonne de grille, base zéro. |
| `row_index` | `smallint` | non |  | Ligne de grille, base zéro. |
| `action_count` | `integer` | non |  | Actions observées dans la cellule. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.player_match_metric_values_history

Versions immuables typées de football.player_match_metric_values.

Grain : Une révision SQL de la clé logique de football.player_match_metric_values.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Match du fait. |
| `player_id` | `bigint` | non |  | Identité concernée. |
| `team_id` | `bigint` | non |  | Équipe du joueur dans ce match. |
| `period_code` | `text` | non |  | Période explicitement définie. |
| `family_code` | `text` | non |  | standard ou advanced. |
| `metric_code` | `text` | non |  | Métrique enregistrée et définie ; aucune clé arbitraire. |
| `value_kind` | `text` | non |  | number, string ou boolean ; NULL/absence distingués par les états de champ. |
| `numeric_value` | `numeric` | oui |  | Valeur numérique exacte de cette métrique. |
| `text_value` | `text` | oui |  | Valeur textuelle si le contrat de métrique l’autorise. |
| `boolean_value` | `boolean` | oui |  | Valeur booléenne si définie comme telle. |
| `numerator` | `numeric` | oui |  | Numérateur fourni, sans le déduire d’un taux arrondi. |
| `denominator` | `numeric` | oui |  | Dénominateur observé. |
| `source_display` | `text` | oui |  | Forme affichée native d’un scalaire, par exemple 12/15 ou 75%. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.ranking_systems_history

Versions immuables typées de football.ranking_systems.

Grain : Une révision SQL de la clé logique de football.ranking_systems.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Valeur historique immuable. Code stable du référentiel, avec sa définition explicite. |
| `authority` | `text` | non |  | Valeur historique immuable. Organisme qui publie ce classement, par exemple FIFA ou UEFA. |
| `subject_kind` | `text` | non |  | Valeur historique immuable. Type d’entité classée ou agrégée ; les fédérations restent distinctes des équipes. |
| `gender` | `text` | non |  | Valeur historique immuable. Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `methodology_version` | `text` | non |  | Valeur historique immuable. Version de la méthode de l’autorité de classement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_honours_history

Versions immuables typées de football.team_honours.

Grain : Une révision SQL de la clé logique de football.team_honours.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Valeur historique immuable. Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.teams(id). |
| `honour_id` | `bigint` | non |  | Valeur historique immuable. Référence SQL vers football.honour_definitions(id). |
| `competition_season_id` | `bigint` | oui |  | Valeur historique immuable. Référence SQL vers football.competition_seasons(id). |
| `season_label` | `text` | oui |  | Valeur historique immuable. Libellé historique conservé lorsqu’aucune édition canonique n’est résolue. |
| `edition_key` | `text` | non |  | Clé d’édition de la distinction, conservée même sans édition de compétition résolue. |
| `outcome` | `text` | non |  | Valeur historique immuable. Résultat du tir selon un mapping documenté. |
| `source_id` | `bigint` | non |  | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Valeur historique immuable. Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.
- CHECK `octet_length(quality_flags::text)<=16384`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.

### football.team_match_metric_values_history

Versions immuables typées de football.team_match_metric_values.

Grain : Une révision SQL de la clé logique de football.team_match_metric_values.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non |  | Match du fait. |
| `team_id` | `bigint` | non |  | Identité concernée. |
| `period_code` | `text` | non |  | Période explicitement définie. |
| `family_code` | `text` | non |  | standard ou advanced. |
| `metric_code` | `text` | non |  | Métrique enregistrée et définie ; aucune clé arbitraire. |
| `value_kind` | `text` | non |  | number, string ou boolean ; NULL/absence distingués par les états de champ. |
| `numeric_value` | `numeric` | oui |  | Valeur numérique exacte de cette métrique. |
| `text_value` | `text` | oui |  | Valeur textuelle si le contrat de métrique l’autorise. |
| `boolean_value` | `boolean` | oui |  | Valeur booléenne si définie comme telle. |
| `numerator` | `numeric` | oui |  | Numérateur fourni, sans le déduire d’un taux arrondi. |
| `denominator` | `numeric` | oui |  | Dénominateur observé. |
| `source_display` | `text` | oui |  | Forme affichée native d’un scalaire, par exemple 12/15 ou 75%. |
| `source_record_id` | `bigint` | non |  | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `row_version_id` | `bigint` | non | PK/FK | Version immuable du contenu typé ; conservée dans l’historique ou dans cette relation append-only. |

PK : `row_version_id`.

- FK `row_version_id → ingest.row_versions(id) ; ON DELETE RESTRICT`.

- Toutes les colonnes métier sont copiées avec leurs types ; aucun document ou payload archivé.
- Pas de FK vers un fait courant corrigible : la cohérence historique est contrôlée entre versions appartenant au même snapshot.
- Trigger différé : relation_code, clé logique et existence de cette ligne doivent correspondre à row_versions ; une version ne possède qu’une représentation typée.
