# Dictionnaire de la proposition StatArena / Orion

**Proposition non déployée.** Toutes les tables, colonnes, types, clés et contraintes de la version proposée sont décrits ci-dessous. `!` signifie NOT NULL ; une PK composée porte sur l’ensemble indiqué. Les règles intertables restent à implémenter après approbation.

## Sources et médias

### ingest.document_lineage

Origines des documents dérivés.

Grain physique : Document dérivé × document parent.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `derived_document_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.source_documents(id). |
| `parent_document_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.source_documents(id). |
| `transform_version` | `text` | non |  | Version de la transformation de données. |
| `parameters` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |

PK : `derived_document_id, parent_document_id`.

- FK `ingest_document_lineage_derived_document_id_fk` : `derived_document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- FK `ingest_document_lineage_parent_document_id_fk` : `parent_document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_document_lineage_parameters_kind_ck` : `jsonb_typeof(parameters) = 'object'`.
- CHECK `ingest_document_lineage_no_self_parent_ck` : `derived_document_id <> parent_document_id`.
- CHECK `ingest_document_lineage_parameters_bounded_ck` : `octet_length(parameters::text)<=16384`.
- INDEX `ingest_document_lineage_parent_document_id_derived_do_77500dee2` : `btree : [{"column": "parent_document_id", "order": "ASC"}, {"column": "derived_document_id", "order": "ASC"}]`.


### ingest.media_assets

Références de médias et attribution, sans duplication du fichier.

Grain physique : Version conservée d’un média.

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

PK : `id`.

- UNIQUE `ingest_media_assets_storage_bucket_storage_key_conten_e6078ca76` : `storage_bucket, storage_key, content_sha256 ; NULLS NOT DISTINCT`.
- CHECK `ingest_media_assets_sha256_ck` : `content_sha256 ~ '^[0-9a-f]{64}$'`.

- Réutiliser statarena.assets comme catalogue de téléchargement; cette table porte la référence métier et la licence.

### ingest.resource_fetches

Historique des tentatives de collecte, distinct de la file de jobs existante.

Grain physique : Une tentative HTTP ou une lecture d’archive.

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

- UNIQUE `ingest_resource_fetches_run_id_source_id_request_fing_086b49db3` : `run_id, source_id, request_fingerprint, attempt_no`.
- FK `ingest_resource_fetches_run_id_fk` : `run_id → ingest.import_runs(id) ; ON DELETE RESTRICT`.
- FK `ingest_resource_fetches_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `ingest_resource_fetches_document_id_source_id_fk` : `document_id, source_id → ingest.source_documents(id, source_id) ; ON DELETE RESTRICT`.
- CHECK `ingest_resource_fetches_canonical_params_kind_ck` : `jsonb_typeof(canonical_params) = 'object'`.
- CHECK `ingest_resource_fetches_error_details_kind_ck` : `jsonb_typeof(error_details) = 'object'`.
- CHECK `ingest_resource_fetches_response_state_ck` : `response_state IN ('available', 'empty_response', 'unavailable', 'failed', 'invalid')`.
- CHECK `ingest_resource_fetches_http_status_ck` : `http_status BETWEEN 100 AND 599`.
- CHECK `ingest_resource_fetches_attempt_positive_ck` : `attempt_no > 0`.
- CHECK `ingest_resource_fetches_finished_at_after_requested_at_ck` : `finished_at >= requested_at`.
- CHECK `ingest_resource_fetches_canonical_params_bounded_ck` : `octet_length(canonical_params::text)<=16384`.
- CHECK `ingest_resource_fetches_error_details_bounded_ck` : `octet_length(error_details::text)<=16384`.
- CHECK `ingest_resource_fetches_pro_request_fingerprint_ck` : `request_fingerprint ~ '^[0-9a-f]{64}$'`.
- INDEX `ingest_resource_fetches_source_id_request_fingerprint_4d06f729a` : `btree : [{"column": "source_id", "order": "ASC"}, {"column": "request_fingerprint", "order": "ASC"}, {"column": "requested_at", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.


### ingest.source_datasets

Corpus et versions de contrat d’une source.

Grain physique : Source × clé de corpus × version de contrat.

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

PK : `id`.

- UNIQUE `ingest_source_datasets_source_id_dataset_key_contract_17e4a5946` : `source_id, dataset_key, contract_version`.
- UNIQUE `ingest_source_datasets_id_source_id_uq` : `id, source_id`.
- FK `ingest_source_datasets_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_source_datasets_schema_description_kind_ck` : `jsonb_typeof(schema_description) = 'object'`.
- CHECK `ingest_source_datasets_schema_description_bounded_ck` : `octet_length(schema_description::text)<=16384`.


### ingest.source_documents

Reçu d’observation HTTP directe ou métadonnées d’un ancien artefact source ; jamais le contenu d’une réponse ou d’un fichier.

Grain physique : Version de contenu d’un objet dans un corpus.

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
| `content_sha256` | `text` | non |  | SHA-256 hexadécimal minuscule des octets reçus et hachés en mémoire, ou de l’ancien artefact vérifié. Empreinte seulement ; aucune réponse conservée. |
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
| `request_fingerprint` | `text` | oui |  | SHA-256 hexadécimal minuscule de la requête canonique sans secret ; obligatoire en HTTP direct, NULL pour un ancien fichier. Aucun body conservé. |

PK : `id`.

- UNIQUE `ingest_source_documents_dataset_id_storage_bucket_sto_c2e712c21` : `dataset_id, storage_bucket, storage_key, content_sha256`.
- UNIQUE `ingest_source_documents_id_source_id_uq` : `id, source_id`.
- FK `ingest_source_documents_dataset_id_source_id_fk` : `dataset_id, source_id → ingest.source_datasets(id, source_id) ; ON DELETE RESTRICT`.
- FK `ingest_source_documents_import_run_id_fk` : `import_run_id → ingest.import_runs(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_source_documents_sha256_ck` : `content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `ingest_source_documents_byte_length_nonnegative_ck` : `byte_length >= 0`.
- CHECK `ingest_source_documents_retention_state_ck` : `retention_state IN ('not_stored','staged','reconciled','deleted')`.
- CHECK `ingest_source_documents_direct_ingestion_no_file_ck` : `(origin_kind='http_response' AND storage_provider='http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND retention_state='not_stored') OR (origin_kind='legacy_file' AND retention_state IN ('staged','reconciled','deleted'))`.
- CHECK `ingest_source_documents_deleted_metadata_ck` : `(retention_state='deleted') = (deleted_at IS NOT NULL)`.
- CHECK `ingest_source_documents_pro_request_origin_identity_ck` : `(origin_kind = 'http_response' AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$' AND storage_provider = 'http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND storage_version IS NULL AND retention_state = 'not_stored') OR (origin_kind = 'legacy_file' AND request_fingerprint IS NULL AND retention_state IN ('staged','reconciled','deleted'))`.
- INDEX `ingest_source_documents_content_sha256_idx` : `btree : [{"column": "content_sha256", "order": "ASC"}]`.
- INDEX `ingest_source_documents_sv_http_request_content_idx` : `UNIQUE btree : [{"column": "dataset_id", "order": "ASC"}, {"column": "request_fingerprint", "order": "ASC"}, {"column": "content_sha256", "order": "ASC"}] WHERE origin_kind = 'http_response'`.

- Aucun body, payload ou contenu métier JSONB. Une nouvelle collecte ne crée ni clé S3 ni fichier temporaire de données ; la réponse est décodée en mémoire puis écrite dans ses tables typées.
- Les anciennes coordonnées de stockage sont seulement des métadonnées. Leur conservation temporaire s’applique aux fichiers déjà présents, pas aux nouveaux appels PitchAPI.
- Le scellement dépend de faits SQL typés immuables ; aucun contrôle n’exige des octets encore accessibles après purge.
- Un reçu HTTP dédupliqué peut être référencé par plusieurs tentatives resource_fetches. Le fingerprint est calculé sur la requête canonique versionnée, le hash de contenu pendant le décodage en mémoire ; aucun octet de réponse n’est conservé.

### ingest.source_records

Métadonnées d’observation et correspondance vers les faits SQL conservés ; ancien localisateur sans dépendance à des octets supprimés.

Grain physique : Document × localisateur.

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

- UNIQUE `ingest_source_records_document_id_locator_uq` : `document_id, locator`.
- UNIQUE `ingest_source_records_source_id_id_uq` : `source_id, id`.
- FK `ingest_source_records_document_id_source_id_fk` : `document_id, source_id → ingest.source_documents(id, source_id) ; ON DELETE RESTRICT`.
- CHECK `ingest_source_records_locator_kind_ck` : `locator_kind IN ('json_pointer','jsonl_line','array_ordinal','archive_member','whole_document','csv_row','sqlite_row')`.
- CHECK `ingest_source_records_ordinal_nonnegative_ck` : `ordinal >= 0`.


### ingest.sources

Espaces stables d’identifiants fournisseurs.

Grain physique : Un espace fournisseur.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Code stable du référentiel, avec sa définition explicite. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `base_url` | `text` | oui |  | Adresse publique de base du fournisseur ; aucune clé ou secret inclus. |
| `upstream_source_id` | `bigint` | oui | FK | Origine amont éventuelle; une copie ne devient pas une source indépendante. |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |

PK : `id`.

- UNIQUE `ingest_sources_code_uq` : `code`.
- FK `ingest_sources_upstream_source_id_fk` : `upstream_source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_sources_no_self_parent_ck` : `upstream_source_id <> id`.


## Provenance et publications

### ingest.dataset_snapshot_documents

Provenance des documents ayant contribué à un instantané SQL ; aucun fichier requis après purge.

Grain physique : Instantané × document.

Écriture : `immutable_after_snapshot_seal` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.dataset_snapshots(id). |
| `document_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.source_documents(id). |

PK : `snapshot_id, document_id`.

- FK `ingest_dataset_snapshot_documents_snapshot_id_fk` : `snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `ingest_dataset_snapshot_documents_document_id_fk` : `document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.


### ingest.dataset_snapshots

Registre léger des générations de commit et de leur scellement ; aucune copie de lignes ni sélection universelle.

Grain physique : Un instantané logique scellé.

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
| `generation` | `bigint` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `ingest_dataset_snapshots_snapshot_key_uq` : `snapshot_key`.
- UNIQUE `ingest_dataset_snapshots_sv_generation_uq` : `generation`.
- CHECK `ingest_dataset_snapshots_status_ck` : `status IN ('draft', 'sealed', 'invalid')`.
- CHECK `ingest_dataset_snapshots_sha256_ck` : `manifest_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `ingest_dataset_snapshots_sealed_metadata_ck` : `status <> 'sealed' OR (sealed_at IS NOT NULL AND manifest_sha256 IS NOT NULL)`.
- CHECK `ingest_dataset_snapshots_sv_generation_positive_ck` : `generation > 0`.


### ingest.field_contracts

Champs sémantiques enregistrés et leur destination ; aucun chemin arbitraire autorisé.

Grain physique : Relation × code de champ.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `relation_code` | `text` | non | PK/FK | Relation du fait normalisé. |
| `field_code` | `text` | non | PK | Code sémantique déclaré, pas une propriété JSON libre. |
| `target_column` | `text` | non |  | Colonne typée ou relation enfant explicitement correspondante. |
| `definition` | `text` | non |  | Sens, unité et règle de conservation du champ. |
| `contract_version` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `relation_code, contract_version, field_code`.

- FK `ingest_field_contracts_sv_relation_code_contract_ver_b45b99309f` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.


### ingest.relation_contracts

Catalogue des relations métier et de leurs grains autorisés.

Grain physique : Une relation enregistrée.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `relation_code` | `text` | non | PK | Nom SQL qualifié autorisé, stable dans une version du contrat. |
| `relation_name` | `text` | non |  | Relation métier concernée ; aucune table sœur history. |
| `contract_version` | `text` | non | PK | Version du contrat de colonnes, clés et sémantique. |
| `grain_definition` | `text` | non |  | Définition explicite de la clé logique. |

PK : `relation_code, contract_version`.



## Ingestion et reprise

### ingest.asset_jobs

File existante de téléchargement des seuls médias indispensables.

Grain physique : Une URL de média.

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

Grain physique : Source × endpoint × paramètres canoniques.

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

- FK `ingest_collection_jobs_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_collection_jobs_pro_state_ck` : `state IN ('pending','running','done','unavailable')`.
- CHECK `ingest_collection_jobs_pro_attempts_ck` : `attempts >= 0`.
- CHECK `ingest_collection_jobs_pro_lease_ck` : `(state = 'running' AND lease_owner IS NOT NULL AND btrim(lease_owner) <> '' AND lease_expires_at IS NOT NULL AND attempts > 0) OR (state <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)`.
- INDEX `ingest_collection_jobs_pro_pending_claim_idx` : `btree : [{"column": "priority", "order": "ASC"}, {"column": "available_at", "order": "ASC"}, {"column": "source_id", "order": "ASC"}, {"column": "endpoint", "order": "ASC"}, {"column": "params", "order": "ASC"}] WHERE state = 'pending'`.
- INDEX `ingest_collection_jobs_pro_running_expiry_idx` : `btree : [{"column": "lease_expires_at", "order": "ASC"}] WHERE state = 'running'`.


### ingest.dirty_editions

Éditions affectées par des changements ; remplace dirty_partitions après mapping des identités.

Grain physique : Une édition métier.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non | PK/FK | Édition à reconstruire. |
| `generation` | `bigint` | non |  | Génération demandée ; protège des pertes d’invalidation. |
| `changed_at` | `timestamptz` | non |  | Dernière modification pertinente. |
| `reason` | `text` | non |  | Origine de l’invalidation. |
| `competition_season_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `competition_season_id`.

- FK `ingest_dirty_editions_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.


### ingest.import_runs

Exécutions traçables de collecte ou de transformation.

Grain physique : Une exécution.

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

- CHECK `ingest_import_runs_parameters_kind_ck` : `jsonb_typeof(parameters) = 'object'`.
- CHECK `ingest_import_runs_counters_kind_ck` : `jsonb_typeof(counters) = 'object'`.
- CHECK `ingest_import_runs_checkpoint_kind_ck` : `jsonb_typeof(checkpoint) = 'object'`.
- CHECK `ingest_import_runs_error_kind_ck` : `jsonb_typeof(error) = 'object'`.
- CHECK `ingest_import_runs_mode_ck` : `mode IN ('daily', 'backfill', 'rebuild', 'repair')`.
- CHECK `ingest_import_runs_status_ck` : `status IN ('running', 'succeeded', 'partial', 'failed', 'cancelled')`.
- CHECK `ingest_import_runs_finished_at_after_started_at_ck` : `finished_at >= started_at`.
- CHECK `ingest_import_runs_parameters_bounded_ck` : `octet_length(parameters::text)<=16384`.
- CHECK `ingest_import_runs_counters_bounded_ck` : `octet_length(counters::text)<=16384`.
- CHECK `ingest_import_runs_checkpoint_bounded_ck` : `octet_length(checkpoint::text)<=16384`.
- CHECK `ingest_import_runs_error_bounded_ck` : `octet_length(error::text)<=16384`.


### ingest.match_coverage

Disponibilité réelle par match, source et famille; indépendante du HTTP. Grain physique : une observation complète de collection, y compris son état vide/null/absent, PK (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; clé logique (match_id, source_id, feature_code, variant_key), variante variant_key ; sélection canonique (match_id, feature_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une observation complète de collection, y compris son état vide/null/absent, PK (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; clé logique (match_id, source_id, feature_code, variant_key), variante variant_key ; sélection canonique (match_id, feature_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `atomic_collection`.

Clé logique : `match_id, source_id, feature_code, variant_key`.

Responsabilité métier : Match × source × famille.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id, revision_id). |
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_documents(id, source_id); ingest.source_records(source_id, id). |
| `feature_code` | `text` | non | PK | Famille fonctionnelle de couverture, par exemple lineups, shots ou heatmaps. |
| `coverage_state` | `text` | non |  | Disponibilité réelle de la famille, indépendante du statut HTTP : disponible, vide, indisponible, invalide, etc. |
| `http_status` | `smallint` | oui |  | Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP. |
| `error_code` | `text` | oui |  | Code d’erreur technique/fournisseur conservé exactement. |
| `observed_row_count` | `integer` | oui |  | Nombre de « observed row » du périmètre de cette ligne ; absence distincte de zéro. |
| `document_id` | `bigint` | oui | FK | Référence SQL vers ingest.source_documents(id, source_id). |
| `checked_at` | `timestamptz` | non |  | Instant UTC « checked_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `is_stale` | `boolean` | non |  | Indique une donnée périmée selon sa politique de fraîcheur. |
| `data_revision` | `bigint` | non |  | Révision du grain ou de la famille, incrémentée seulement lorsque son contenu change. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non | PK | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `collection_state` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `match_id, source_id, feature_code, variant_key, recorded_from_gen`.

- FK `ingest_match_coverage_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `ingest_match_coverage_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `ingest_match_coverage_document_id_source_id_fk` : `document_id, source_id → ingest.source_documents(id, source_id) ; ON DELETE RESTRICT`.
- FK `ingest_match_coverage_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `ingest_match_coverage_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `ingest_match_coverage_sv_relation_code_contract_vers_0e14cc4af3` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `ingest_match_coverage_sv_source_id_source_record_id__4e45ae96af` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `ingest_match_coverage_coverage_state_ck` : `coverage_state IN ('not_requested', 'pending', 'available', 'empty_response', 'unavailable', 'failed', 'invalid')`.
- CHECK `ingest_match_coverage_http_status_ck` : `http_status BETWEEN 100 AND 599`.
- CHECK `ingest_match_coverage_observed_row_count_nonnegative_ck` : `observed_row_count >= 0`.
- CHECK `ingest_match_coverage_revision_positive_ck` : `data_revision > 0`.
- CHECK `ingest_match_coverage_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `ingest_match_coverage_sv_collection_shape_ck` : `(collection_state IN ('absent','null','unavailable') AND observed_row_count IS NULL) OR (collection_state = 'empty' AND observed_row_count IS NOT NULL AND observed_row_count = 0) OR (collection_state = 'present' AND observed_row_count IS NOT NULL AND observed_row_count > 0)`.
- CHECK `ingest_match_coverage_sv_relation_binding_ck` : `relation_code = 'ingest.match_coverage'`.
- CHECK `ingest_match_coverage_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `ingest_match_coverage_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `ingest_match_coverage_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `ingest_match_coverage_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `ingest_match_coverage_coverage_state_checked_at_match_id_idx` : `btree : [{"column": "coverage_state", "order": "ASC"}, {"column": "checked_at", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.
- INDEX `ingest_match_coverage_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "source_id", "order": "ASC"}, {"column": "feature_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `ingest_match_coverage_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "feature_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### ingest.schema_migrations

Journal des migrations appliquées et de leurs empreintes ; reprend les versions scellées existantes.

Grain physique : Une migration versionnée.

Écriture : `append_only` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `version` | `text` | non | PK | Nom/version immuable de la migration. |
| `content_sha256` | `text` | non |  | Empreinte du SQL effectivement appliqué. |
| `applied_at` | `timestamptz` | oui |  | Date réelle d’application, sans inventer celle des anciens reçus inconnus. |
| `code_commit` | `text` | oui |  | Commit qui porte cette migration, si connu. |

PK : `version`.

- CHECK `ingest_schema_migrations_content_hash_ck` : `content_sha256 ~ '^[0-9a-f]{64}$'`.


## Qualité, alias et nettoyage

### ingest.cleanup_items

Inventaire des copies physiques supprimées et des vérifications de disparition.

Grain physique : Campagne × copie physique recensée.

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

- UNIQUE `ingest_cleanup_items_physical_copy_uq` : `reconciliation_run_id, storage_kind, storage_location, storage_version ; NULLS NOT DISTINCT`.
- FK `ingest_cleanup_items_reconciliation_run_id_fk` : `reconciliation_run_id → ingest.reconciliation_runs(id) ; ON DELETE RESTRICT`.
- FK `ingest_cleanup_items_document_id_fk` : `document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.


### ingest.document_reconciliations

Couverture exhaustive d’un ancien artefact avant suppression de ses octets.

Grain physique : Campagne × métadonnée de document.

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

- FK `ingest_document_reconciliations_run_id_fk` : `run_id → ingest.reconciliation_runs(id) ; ON DELETE RESTRICT`.
- FK `ingest_document_reconciliations_document_id_fk` : `document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_document_reconciliations_counts_ck` : `records_expected >= 0 AND records_linked >= 0 AND unmapped_fields >= 0 AND mismatches >= 0`.


### ingest.identity_candidates

File de rapprochements ambigus; aucune identité publiée via ce JSON.

Grain physique : Source × type d’entité × identifiant externe non résolu.

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

- UNIQUE `ingest_identity_candidates_source_id_entity_kind_external_id_uq` : `source_id, entity_kind, external_id`.
- FK `ingest_identity_candidates_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `ingest_identity_candidates_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `ingest_identity_candidates_candidate_evidence_kind_ck` : `jsonb_typeof(candidate_evidence) = 'array'`.
- CHECK `ingest_identity_candidates_entity_kind_ck` : `entity_kind IN ('competition', 'team', 'player', 'match', 'association', 'venue', 'coach')`.
- CHECK `ingest_identity_candidates_status_ck` : `status IN ('pending', 'resolved', 'rejected')`.
- CHECK `ingest_identity_candidates_resolved_at_after_created_at_ck` : `resolved_at >= created_at`.
- CHECK `ingest_identity_candidates_candidate_evidence_bounded_ck` : `octet_length(candidate_evidence::text)<=16384`.


### ingest.public_aliases

Correspondances stables des liens publics existants vers les identités internes. Grain physique : une résolution datée, PK (route_kind, public_key, recorded_from_gen) ; clé logique (route_kind, public_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (route_kind, public_key, recorded_from_gen) ; clé logique (route_kind, public_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `route_kind, public_key`.

Responsabilité métier : Type de route × clé publique.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

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
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `venue_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `coach_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `route_kind, public_key, recorded_from_gen`.

- FK `ingest_public_aliases_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_competition_id_fk` : `competition_id, competition_revision_id → football.competitions(id, revision_id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_venue_id_fk` : `venue_id, venue_revision_id → football.venues(id, revision_id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_coach_id_fk` : `coach_id, coach_revision_id → football.coaches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_profile_version_id_player_id_fk` : `profile_version_id, player_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_sv_relation_code_contract_vers_f94ff4a100` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `ingest_public_aliases_sv_source_id_source_record_id__464a1eaac7` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `ingest_public_aliases_one_identity_ck` : `num_nonnulls(player_id,team_id,competition_id,match_id,association_id,venue_id,coach_id)=1`.
- CHECK `ingest_public_aliases_profile_route_ck` : `profile_version_id IS NULL OR route_kind='profile'`.
- CHECK `ingest_public_aliases_route_identity_ck` : `(route_kind='profile' AND player_id IS NOT NULL AND profile_version_id IS NOT NULL) OR (route_kind='player' AND player_id IS NOT NULL AND profile_version_id IS NULL) OR (route_kind='team' AND team_id IS NOT NULL) OR (route_kind='competition' AND competition_id IS NOT NULL) OR (route_kind='match' AND match_id IS NOT NULL) OR (route_kind='association' AND association_id IS NOT NULL) OR (route_kind='venue' AND venue_id IS NOT NULL) OR (route_kind='coach' AND coach_id IS NOT NULL)`.
- CHECK `ingest_public_aliases_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `ingest_public_aliases_sv_relation_binding_ck` : `relation_code = 'ingest.public_aliases'`.
- CHECK `ingest_public_aliases_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `ingest_public_aliases_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `ingest_public_aliases_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `ingest_public_aliases_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `ingest_public_aliases_sv_competition_revision_id_pair_ck` : `(competition_revision_id IS NULL AND (competition_id IS NULL)) OR (competition_revision_id IS NOT NULL AND competition_id IS NOT NULL)`.
- CHECK `ingest_public_aliases_sv_match_revision_id_pair_ck` : `(match_revision_id IS NULL AND (match_id IS NULL)) OR (match_revision_id IS NOT NULL AND match_id IS NOT NULL)`.
- CHECK `ingest_public_aliases_sv_venue_revision_id_pair_ck` : `(venue_revision_id IS NULL AND (venue_id IS NULL)) OR (venue_revision_id IS NOT NULL AND venue_id IS NOT NULL)`.
- CHECK `ingest_public_aliases_sv_coach_revision_id_pair_ck` : `(coach_revision_id IS NULL AND (coach_id IS NULL)) OR (coach_revision_id IS NOT NULL AND coach_id IS NOT NULL)`.
- INDEX `ingest_public_aliases_sv_current_idx` : `UNIQUE btree : [{"column": "route_kind", "order": "ASC"}, {"column": "public_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- Contrainte différée : la route et la colonne d’identité doivent correspondre ; profile exige player_id + profile_version_id.
- Les IDs BIGINT ne traversent jamais une conversion JavaScript Number pour conserver les contrats publics.

### ingest.quality_issues

Anomalies et corrections traçables.

Grain physique : Une anomalie détectée.

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

- FK `ingest_quality_issues_run_id_fk` : `run_id → ingest.import_runs(id) ; ON DELETE RESTRICT`.
- FK `ingest_quality_issues_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- CHECK `ingest_quality_issues_context_kind_ck` : `jsonb_typeof(context) = 'object'`.
- CHECK `ingest_quality_issues_severity_ck` : `severity IN ('info', 'warning', 'error', 'blocking')`.
- CHECK `ingest_quality_issues_status_ck` : `status IN ('open', 'resolved', 'accepted')`.
- CHECK `ingest_quality_issues_resolved_at_after_detected_at_ck` : `resolved_at >= detected_at`.
- CHECK `ingest_quality_issues_context_bounded_ck` : `octet_length(context::text)<=16384`.
- INDEX `ingest_quality_issues_severity_detected_at_id_idx` : `btree : [{"column": "severity", "order": "ASC"}, {"column": "detected_at", "order": "ASC"}, {"column": "id", "order": "ASC"}] WHERE status = 'open'`.


### ingest.reconciliation_runs

Preuves de complétude et différences entre origines, observations et SQL final.

Grain physique : Une campagne de rapprochement.

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

- CHECK `ingest_reconciliation_runs_counts_ck` : `missing_records >= 0 AND different_fields >= 0 AND unverified_records >= 0`.
- CHECK `ingest_reconciliation_runs_status_ck` : `status IN ('running','failed','accepted')`.
- CHECK `ingest_reconciliation_runs_sv_mapping_version_nonempty_ck` : `btrim(mapping_version) <> ''`.


## Compétitions et référentiels

### football.associations

Fédérations sportives.

Grain physique : Une fédération.

Classe de version : `stable_identity`.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `federation_code` | `text` | oui |  | Code de la fédération sportive, distinct d’un ISO. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `confederation_code` | `text` | oui |  | Code de la confédération sportive. |
| `country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- FK `football_associations_country_id_fk` : `country_id, country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- CHECK `football_associations_sv_country_revision_id_pair_ck` : `(country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)`.


### football.competition_groups

Groupes rattachés à une phase de la même édition. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Phase × clé de groupe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_stages(id, competition_season_id, revision_id). |
| `stage_id` | `bigint` | non | FK | Référence SQL vers football.competition_stages(id, competition_season_id, revision_id). |
| `group_key` | `text` | non |  | Clé de groupe unique dans sa phase. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `stage_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_competition_groups_sv_natural_0_generation_uq` : `stage_id, group_key, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_groups_sv_natural_1_generation_uq` : `id, stage_id, competition_season_id, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_groups_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_competition_groups_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_groups_sv_anchor_id_stage_id_co_23e1e2ea41` : `id, stage_id, competition_season_id, revision_id`.
- FK `football_competition_groups_stage_id_competition_season_id_fk` : `stage_id, competition_season_id, stage_revision_id → football.competition_stages(id, competition_season_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competition_groups_sv_recorded_from_gen_dat_f4af4d896c` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_groups_sv_recorded_to_gen_datas_90f93f986f` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_groups_sv_relation_code_contrac_85a95a46e9` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_competition_groups_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_competition_groups_sv_source_id_source_reco_68fb522565` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_competition_groups_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_competition_groups_sv_relation_binding_ck` : `relation_code = 'football.competition_groups'`.
- CHECK `football_competition_groups_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_competition_groups_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_competition_groups_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_competition_groups_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_competition_groups_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_competition_groups_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "stage_id", "order": "ASC"}, {"column": "group_key", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_groups_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "stage_id", "order": "ASC"}, {"column": "group_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_competition_groups_sv_natural_1_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "stage_id", "order": "ASC"}, {"column": "competition_season_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_groups_sv_natural_1_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "stage_id", "order": "ASC"}, {"column": "competition_season_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_competition_groups_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_groups_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.competition_seasons

Éditions métier; leur clé ne se déduit pas du nom du dossier. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Compétition × édition.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_id` | `bigint` | non | FK | Référence SQL vers football.competitions(id, revision_id). |
| `season_key` | `text` | non |  | Saison métier de l’édition : par exemple 2026 ou 2026/2027 ; jamais déduite du seul répertoire. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `start_date` | `date` | oui |  | Première date métier connue de l’édition. |
| `end_date` | `date` | oui |  | Dernière date métier connue de l’édition. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_competition_seasons_sv_natural_0_generation_uq` : `competition_id, season_key, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_seasons_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_competition_seasons_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_competition_seasons_competition_id_fk` : `competition_id, competition_revision_id → football.competitions(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competition_seasons_sv_recorded_from_gen_da_6973e17826` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_seasons_sv_recorded_to_gen_data_15f92d12a9` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_seasons_sv_relation_code_contra_a8f54cc1e4` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_competition_seasons_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_competition_seasons_sv_source_id_source_rec_273a980217` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_competition_seasons_status_ck` : `status IN ('planned', 'active', 'completed', 'cancelled', 'unknown')`.
- CHECK `football_competition_seasons_end_date_after_start_date_ck` : `end_date >= start_date`.
- CHECK `football_competition_seasons_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_competition_seasons_sv_relation_binding_ck` : `relation_code = 'football.competition_seasons'`.
- CHECK `football_competition_seasons_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_competition_seasons_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_competition_seasons_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_competition_seasons_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_competition_seasons_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_competition_seasons_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "competition_id", "order": "ASC"}, {"column": "season_key", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_seasons_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "competition_id", "order": "ASC"}, {"column": "season_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_competition_seasons_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_seasons_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.competition_stages

Phases d’une édition et leur hiérarchie. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Édition × clé de phase.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id, revision_id); football.competition_stages(id, competition_season_id, revision_id). |
| `parent_stage_id` | `bigint` | oui | FK | Référence SQL vers football.competition_stages(id, competition_season_id, revision_id). |
| `stage_key` | `text` | non |  | Clé de phase unique dans son édition. |
| `stage_type` | `text` | non |  | Type de phase défini par les valeurs autorisées. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `sequence_no` | `integer` | oui |  | Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_season_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `parent_stage_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_competition_stages_sv_natural_0_generation_uq` : `competition_season_id, stage_key, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_stages_sv_natural_1_generation_uq` : `id, competition_season_id, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_stages_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_competition_stages_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- UNIQUE `football_competition_stages_sv_anchor_id_competition_053cfa703e` : `id, competition_season_id, revision_id`.
- FK `football_competition_stages_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competition_stages_parent_stage_id_competiti_eb6dbca0e` : `parent_stage_id, competition_season_id, parent_stage_revision_id → football.competition_stages(id, competition_season_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competition_stages_sv_recorded_from_gen_dat_463a4aaa6e` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_stages_sv_recorded_to_gen_datas_9b7e826636` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_stages_sv_relation_code_contrac_0141c58d1d` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_competition_stages_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_competition_stages_sv_source_id_source_reco_1ebf9fd51c` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_competition_stages_no_self_parent_ck` : `parent_stage_id <> id`.
- CHECK `football_competition_stages_stage_type_ck` : `stage_type IN ('league', 'group', 'knockout', 'qualifying', 'playoff', 'final', 'other', 'unknown')`.
- CHECK `football_competition_stages_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_competition_stages_sv_relation_binding_ck` : `relation_code = 'football.competition_stages'`.
- CHECK `football_competition_stages_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_competition_stages_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_competition_stages_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_competition_stages_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_competition_stages_sv_parent_stage_revision_id_pair_ck` : `(parent_stage_revision_id IS NULL AND (parent_stage_id IS NULL)) OR (parent_stage_revision_id IS NOT NULL AND parent_stage_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- CHECK `football_competition_stages_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_competition_stages_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "stage_key", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_stages_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "stage_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_competition_stages_sv_natural_1_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "competition_season_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_stages_sv_natural_1_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "competition_season_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_competition_stages_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_stages_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.competition_teams

Engagements d’une équipe dans une édition. Grain physique : une révision typée, PK (revision_id) ; clé logique (competition_season_id, team_id), variante variant_key ; sélection canonique (competition_season_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (competition_season_id, team_id), variante variant_key ; sélection canonique (competition_season_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `competition_season_id, team_id`.

Responsabilité métier : Édition × équipe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `entered_on` | `date` | oui |  | Date d’engagement de l’équipe dans l’édition si réellement connue. |
| `exited_on` | `date` | oui |  | Date de sortie de l’édition si réellement connue. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_season_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_competition_teams_sv_logical_revision_uq` : `competition_season_id, team_id, revision_id`.
- UNIQUE `football_competition_teams_sv_variant_generation_uq` : `competition_season_id, team_id, variant_key, recorded_from_gen`.
- FK `football_competition_teams_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competition_teams_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_competition_teams_sv_recorded_from_gen_data_ce41f7c9f8` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_teams_sv_recorded_to_gen_datase_ab05e2e388` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_teams_sv_relation_code_contract_c893d98603` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_competition_teams_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_competition_teams_sv_source_id_source_recor_04a7b96a27` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_competition_teams_status_ck` : `status IN ('observed', 'confirmed', 'withdrawn', 'disqualified')`.
- CHECK `football_competition_teams_exited_on_after_entered_on_ck` : `exited_on >= entered_on`.
- CHECK `football_competition_teams_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_competition_teams_sv_relation_binding_ck` : `relation_code = 'football.competition_teams'`.
- CHECK `football_competition_teams_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_competition_teams_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_competition_teams_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_competition_teams_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_competition_teams_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_competition_teams_team_id_competition_season_id_idx` : `btree : [{"column": "team_id", "order": "ASC"}, {"column": "competition_season_id", "order": "ASC"}]`.
- INDEX `football_competition_teams_sv_variant_current_idx` : `UNIQUE btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competition_teams_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.competitions

Compétitions stables indépendamment des saisons. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Une compétition.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `slug` | `text` | non |  | Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases. |
| `competition_type` | `text` | non |  | Nature league, cup, tournament, supercup, friendly, other ou unknown. |
| `association_id` | `bigint` | oui | FK | Référence SQL vers football.associations(id). |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `gender` | `text` | non |  | Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `age_category` | `text` | oui |  | Catégorie d’âge déclarée ; ne pas la déduire sans preuve. |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_competitions_sv_natural_0_generation_uq` : `slug, variant_key, recorded_from_gen`.
- UNIQUE `football_competitions_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_competitions_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_competitions_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `football_competitions_country_id_fk` : `country_id, country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competitions_image_asset_id_fk` : `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_competitions_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competitions_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competitions_sv_relation_code_contract_vers_029ca21826` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_competitions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_competitions_sv_source_id_source_record_id__79976f94dd` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_competitions_competition_type_ck` : `competition_type IN ('league', 'cup', 'tournament', 'supercup', 'friendly', 'other', 'unknown')`.
- CHECK `football_competitions_gender_ck` : `gender IN ('men', 'women', 'mixed', 'unknown')`.
- CHECK `football_competitions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_competitions_sv_relation_binding_ck` : `relation_code = 'football.competitions'`.
- CHECK `football_competitions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_competitions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_competitions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_competitions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_competitions_sv_country_revision_id_pair_ck` : `(country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)`.
- CHECK `football_competitions_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_competitions_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "slug", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competitions_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "slug", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_competitions_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_competitions_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.countries

Territoires géographiques; les fédérations sportives sont séparées. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un territoire.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `iso2` | `text` | oui |  | Code ISO à deux lettres uniquement lorsqu’il existe. |
| `iso3` | `text` | oui |  | Code ISO à trois lettres uniquement lorsqu’il existe. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_countries_sv_natural_0_generation_uq` : `iso2, variant_key, recorded_from_gen`.
- UNIQUE `football_countries_sv_natural_1_generation_uq` : `iso3, variant_key, recorded_from_gen`.
- UNIQUE `football_countries_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_countries_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_countries_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_countries_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_countries_sv_relation_code_contract_version_45494cfdbf` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_countries_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_countries_sv_source_id_source_record_id_sou_52c9dff644` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_countries_iso2_format_ck` : `iso2 ~ '^[A-Z]{2}$'`.
- CHECK `football_countries_iso3_format_ck` : `iso3 ~ '^[A-Z]{3}$'`.
- CHECK `football_countries_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_countries_sv_relation_binding_ck` : `relation_code = 'football.countries'`.
- CHECK `football_countries_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_countries_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_countries_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_countries_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_countries_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_countries_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "iso2", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_countries_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "iso2", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_countries_sv_natural_1_variant_current_idx` : `UNIQUE btree : [{"column": "iso3", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_countries_sv_natural_1_canonical_current_idx` : `UNIQUE btree : [{"column": "iso3", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_countries_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_countries_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.venues

Stades et caractéristiques datées lorsqu’elles évoluent. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un stade.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `city` | `text` | oui |  | Ville du stade, si connue. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `latitude` | `double precision` | oui |  | Latitude géographique du stade, entre −90 et 90. |
| `longitude` | `double precision` | oui |  | Longitude géographique du stade, entre −180 et 180. |
| `capacity` | `integer` | oui |  | Capacité du stade observée à capacity_as_of. |
| `capacity_as_of` | `date` | oui |  | Date de validité connue de la capacité. |
| `opened_year` | `integer` | oui |  | Année d’ouverture connue ; une date imprécise ne devient pas une année inventée. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_venues_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_venues_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_venues_country_id_fk` : `country_id, country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_venues_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_venues_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_venues_sv_relation_code_contract_version_re_0ab377157a` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_venues_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_venues_sv_source_id_source_record_id_source_records_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_venues_latitude_ck` : `latitude BETWEEN -90 AND 90`.
- CHECK `football_venues_longitude_ck` : `longitude BETWEEN -180 AND 180`.
- CHECK `football_venues_capacity_nonnegative_ck` : `capacity >= 0`.
- CHECK `football_venues_opened_year_ck` : `opened_year > 0`.
- CHECK `football_venues_latitude_finite_ck` : `latitude NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_venues_longitude_finite_ck` : `longitude NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_venues_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_venues_sv_relation_binding_ck` : `relation_code = 'football.venues'`.
- CHECK `football_venues_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_venues_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_venues_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_venues_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_venues_sv_country_revision_id_pair_ck` : `(country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)`.
- CHECK `football_venues_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_venues_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_venues_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


## Identités et profils

### football.association_profile_versions

Versions observées des noms, codes, emblèmes et affiliations d’un association. Grain physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (association_id, profile_context), variante variant_key ; sélection canonique (association_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (association_id, profile_context), variante variant_key ; sélection canonique (association_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `profile_observation`.

Clé logique : `association_id, profile_context`.

Responsabilité métier : Identité × observation de profil.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `association_id` | `bigint` | non | FK | Identité canonique observée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
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
| `federation_code` | `text` | oui |  | Code de la fédération sportive, distinct d’un ISO. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `confederation_code` | `text` | oui |  | Code de la confédération sportive. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `profile_context` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_association_profile_versions_sv_natural_0_g_65033fbd3d` : `association_id, source_record_id, variant_key, recorded_from_gen`.
- UNIQUE `football_association_profile_versions_sv_profile_actor_uq` : `id, association_id`.
- UNIQUE `football_association_profile_versions_sv_profile_generation_uq` : `association_id, profile_context, variant_key, recorded_from_gen`.
- FK `football_association_profile_versions_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_image_asset_id_fk` : `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_sv_country_id__6bd74b4891` : `country_id, country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_sv_recorded_fr_325271d6ad` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_sv_recorded_to_d7b6024d5c` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_sv_relation_co_180f989475` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_association_profile_versions_sv_source_id_s_e25275c61a` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_association_profile_versions_validity_ck` : `valid_to>=valid_from`.
- CHECK `football_association_profile_versions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_association_profile_versions_sv_relation_binding_ck` : `relation_code = 'football.association_profile_versions'`.
- CHECK `football_association_profile_versions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_association_profile_versions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_association_profile_versions_sv_provider_ob_74a6546f7e` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_association_profile_versions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_association_profile_versions_sv_country_rev_98b1c5f08e` : `(country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)`.
- CHECK `football_association_profile_versions_sv_variant_key_227e0becbd` : `btrim(variant_key) <> ''`.
- CHECK `football_association_profile_versions_sv_profile_con_06d06ec076` : `btrim(profile_context) <> ''`.
- INDEX `football_association_profile_versions_sv_natural_0_v_d499b52381` : `UNIQUE btree : [{"column": "association_id", "order": "ASC"}, {"column": "source_record_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_association_profile_versions_sv_natural_0_c_7c3e692e06` : `UNIQUE btree : [{"column": "association_id", "order": "ASC"}, {"column": "source_record_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_association_profile_versions_sv_variant_current_idx` : `UNIQUE btree : [{"column": "association_id", "order": "ASC"}, {"column": "profile_context", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_association_profile_versions_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "association_id", "order": "ASC"}, {"column": "profile_context", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.association_source_ids

Identifiants externes typés de association. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `association_id` | `bigint` | non | FK | Référence SQL vers football.associations(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_association_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_association_source_ids_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `football_association_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_association_source_ids_sv_recorded_from_gen_5ed9784e43` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_association_source_ids_sv_recorded_to_gen_d_5e6da52895` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_association_source_ids_sv_relation_code_con_e1a1a1bb8c` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_association_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_association_source_ids_sv_relation_binding_ck` : `relation_code = 'football.association_source_ids'`.
- CHECK `football_association_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_association_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_association_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_association_source_ids_association_id_idx` : `btree : [{"column": "association_id", "order": "ASC"}]`.
- INDEX `football_association_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.coach_source_ids

Identifiants externes typés de coach. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `coach_id` | `bigint` | non | FK | Référence SQL vers football.coaches(id, revision_id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `coach_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_coach_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_coach_source_ids_coach_id_fk` : `coach_id, coach_revision_id → football.coaches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_coach_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_coach_source_ids_sv_recorded_from_gen_datas_3aaf1d81f0` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_coach_source_ids_sv_recorded_to_gen_dataset_924cbfbe6f` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_coach_source_ids_sv_relation_code_contract__7d08951b22` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_coach_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_coach_source_ids_sv_relation_binding_ck` : `relation_code = 'football.coach_source_ids'`.
- CHECK `football_coach_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_coach_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_coach_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_coach_source_ids_coach_id_idx` : `btree : [{"column": "coach_id", "order": "ASC"}]`.
- INDEX `football_coach_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.competition_source_ids

Identifiants externes typés de competition. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `competition_id` | `bigint` | non | FK | Référence SQL vers football.competitions(id, revision_id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_competition_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_competition_source_ids_competition_id_fk` : `competition_id, competition_revision_id → football.competitions(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_competition_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_competition_source_ids_sv_recorded_from_gen_6137a9c639` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_source_ids_sv_recorded_to_gen_d_6511a5a19d` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_competition_source_ids_sv_relation_code_con_0b05071f98` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_competition_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_competition_source_ids_sv_relation_binding_ck` : `relation_code = 'football.competition_source_ids'`.
- CHECK `football_competition_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_competition_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_competition_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_competition_source_ids_competition_id_idx` : `btree : [{"column": "competition_id", "order": "ASC"}]`.
- INDEX `football_competition_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.match_source_ids

Identifiants externes typés de match. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.matches(id, revision_id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_match_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_match_source_ids_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_source_ids_sv_recorded_from_gen_datas_3b1d452565` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_source_ids_sv_recorded_to_gen_dataset_5a66977e8f` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_source_ids_sv_relation_code_contract__1e6559f837` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_match_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_match_source_ids_sv_relation_binding_ck` : `relation_code = 'football.match_source_ids'`.
- CHECK `football_match_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_match_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_match_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_match_source_ids_match_id_idx` : `btree : [{"column": "match_id", "order": "ASC"}]`.
- INDEX `football_match_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.player_profile_versions

Profils observés versionnés, distincts de playerId. Grain physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (player_id, profile_context), variante variant_key ; sélection canonique (player_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (player_id, profile_context), variante variant_key ; sélection canonique (player_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `profile_observation`.

Clé logique : `player_id, profile_context`.

Responsabilité métier : Source × identifiant de version de profil.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `external_profile_version_id` | `text` | non |  | Ancien identifiant public de version de profil, distinct de l’identité joueur. |
| `display_name` | `text` | non |  | Nom d’affichage observé ou sélectionné pour cette identité. |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `observed_at` | `timestamptz` | non |  | Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `short_name` | `text` | oui |  | Nom court fournisseur. |
| `country_code_source` | `text` | oui |  | Code pays natif, distinct d’un ISO déduit. |
| `raw_position_code` | `text` | oui |  | Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local. |
| `shirt_number` | `text` | oui |  | Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local. |
| `birth_date` | `date` | oui |  | Date de naissance observée dans cette version, si disponible. |
| `height_cm` | `smallint` | oui |  | Taille observée dans cette version, en centimètres. |
| `dominant_foot` | `text` | oui |  | Pied dominant observé dans cette version, si disponible. |
| `profile_content_sha256` | `text` | non |  | Empreinte des attributs typés du profil ; l’ancien ID peut être réutilisé avec d’autres attributs. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `primary_position_code` | `text` | oui | FK | Référence SQL vers football.positions(code, definition_version). |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `profile_context` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `nationality_country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `primary_position_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `raw_position_code_state` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `raw_position_code_source_number` | `numeric` | oui |  | Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé. |
| `shirt_number_state` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `shirt_number_source_number` | `numeric` | oui |  | Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé. |

PK : `id`.

- UNIQUE `football_player_profile_versions_sv_natural_0_generation_uq` : `source_id, external_profile_version_id, profile_content_sha256, variant_key, recorded_from_gen`.
- UNIQUE `football_player_profile_versions_id_player_id_uq` : `id, player_id`.
- UNIQUE `football_player_profile_versions_sv_profile_generation_uq` : `player_id, profile_context, variant_key, recorded_from_gen`.
- FK `football_player_profile_versions_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_image_asset_id_fk` : `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_sv_nationality_coun_9e69dcc629` : `nationality_country_id, nationality_country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_sv_primary_position_6ee6c7d787` : `primary_position_code, primary_position_definition_version → football.positions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_sv_recorded_from_ge_f3ce392e05` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_sv_recorded_to_gen__49a68e1de8` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_sv_relation_code_co_615148ec35` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_player_profile_versions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_player_profile_versions_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_player_profile_versions_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_player_profile_versions_profile_hash_ck` : `profile_content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_profile_versions_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_player_profile_versions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_profile_versions_sv_relation_binding_ck` : `relation_code = 'football.player_profile_versions'`.
- CHECK `football_player_profile_versions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_profile_versions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_profile_versions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_player_profile_versions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_player_profile_versions_sv_nationality_coun_d7f227f69f` : `(nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)`.
- CHECK `football_player_profile_versions_sv_primary_position_dddf33aa6f` : `(primary_position_code IS NULL) = (primary_position_definition_version IS NULL)`.
- CHECK `football_player_profile_versions_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_player_profile_versions_sv_profile_context_nonempty_ck` : `btrim(profile_context) <> ''`.
- CHECK `football_player_profile_versions_sv_primary_position_461cfcf7be` : `primary_position_definition_version IS NULL OR (btrim(primary_position_definition_version) <> '')`.
- CHECK `football_player_profile_versions_sv_raw_position_cod_79888c775b` : `(raw_position_code_state IN ('absent','null') AND raw_position_code IS NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'string' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'number' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NOT NULL AND raw_position_code_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN raw_position_code ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN raw_position_code::numeric = raw_position_code_source_number ELSE false END)`.
- CHECK `football_player_profile_versions_sv_shirt_number_nat_a2b1604cc3` : `(shirt_number_state IN ('absent','null') AND shirt_number IS NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'string' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'number' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NOT NULL AND shirt_number_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN shirt_number ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN shirt_number::numeric = shirt_number_source_number ELSE false END)`.
- INDEX `football_player_profile_versions_player_id_observed_at_id_idx` : `btree : [{"column": "player_id", "order": "ASC"}, {"column": "observed_at", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.
- INDEX `football_player_profile_versions_sv_natural_0_varian_b412e957e1` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_profile_version_id", "order": "ASC"}, {"column": "profile_content_sha256", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_profile_versions_sv_natural_0_canoni_1135793f83` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_profile_version_id", "order": "ASC"}, {"column": "profile_content_sha256", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_player_profile_versions_sv_variant_current_idx` : `UNIQUE btree : [{"column": "player_id", "order": "ASC"}, {"column": "profile_context", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_profile_versions_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "player_id", "order": "ASC"}, {"column": "profile_context", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.player_source_ids

Identifiants externes typés de player. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_player_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_player_source_ids_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_player_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_player_source_ids_sv_recorded_from_gen_data_fc1770447a` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_source_ids_sv_recorded_to_gen_datase_cd5636c326` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_source_ids_sv_relation_code_contract_8936b61a90` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_player_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_source_ids_sv_relation_binding_ck` : `relation_code = 'football.player_source_ids'`.
- CHECK `football_player_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_player_source_ids_player_id_idx` : `btree : [{"column": "player_id", "order": "ASC"}]`.
- INDEX `football_player_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.player_team_memberships

Appartenances confirmées ou observations de participation. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un épisode d’appartenance ou d’observation.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `membership_type` | `text` | non |  | Appartenance club, prêt, sélection, observation ou autre ; simultanéité club/sélection permise. |
| `valid_from` | `date` | oui |  | Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Fin de validité connue ; NULL conserve une borne inconnue. |
| `date_precision` | `text` | non |  | Précision réelle des dates : day, month, year ou unknown. |
| `observed_from` | `date` | oui |  | Première observation de l’appartenance. |
| `observed_to` | `date` | oui |  | Dernière observation de l’appartenance. |
| `evidence_kind` | `text` | non |  | Nature de preuve : contrat, effectif, match, profil ou revue manuelle. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_player_team_memberships_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_player_team_memberships_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_player_team_memberships_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_player_team_memberships_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_player_team_memberships_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_player_team_memberships_sv_recorded_from_ge_64aa9b231c` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_team_memberships_sv_recorded_to_gen__321bb77fe8` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_team_memberships_sv_relation_code_co_4986391520` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_player_team_memberships_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_player_team_memberships_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_player_team_memberships_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_player_team_memberships_membership_type_ck` : `membership_type IN ('club', 'loan', 'national', 'observed', 'other')`.
- CHECK `football_player_team_memberships_date_precision_ck` : `date_precision IN ('day', 'month', 'year', 'unknown')`.
- CHECK `football_player_team_memberships_evidence_kind_ck` : `evidence_kind IN ('official_roster', 'contract', 'match_observation', 'provider_profile', 'manual_review')`.
- CHECK `football_player_team_memberships_valid_to_after_valid_from_ck` : `valid_to >= valid_from`.
- CHECK `football_player_team_memberships_observed_to_after_ob_e94e46fcc` : `observed_to >= observed_from`.
- CHECK `football_player_team_memberships_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_player_team_memberships_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_team_memberships_sv_relation_binding_ck` : `relation_code = 'football.player_team_memberships'`.
- CHECK `football_player_team_memberships_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_team_memberships_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_team_memberships_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_player_team_memberships_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_player_team_memberships_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_player_team_memberships_player_id_observed_from_idx` : `btree : [{"column": "player_id", "order": "ASC"}, {"column": "observed_from", "order": "ASC"}]`.
- INDEX `football_player_team_memberships_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_team_memberships_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.

- Aucune exclusivité globale: club et sélection peuvent coexister.
- Une première apparition ne prouve pas une date de signature.

### football.players

Identités stables de joueurs; une ligne indépendante des profils source.

Grain physique : Une personne joueur.

Classe de version : `stable_identity`.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `display_name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `birth_date` | `date` | oui |  | Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `dominant_foot` | `text` | oui |  | Pied dominant connu : left, right, both ou unknown. |
| `height_cm` | `smallint` | oui |  | Taille connue en centimètres. |
| `primary_position_code` | `text` | oui | FK | Référence SQL vers football.positions(code, definition_version). |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `nationality_country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `primary_position_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- FK `football_players_nationality_country_id_fk` : `nationality_country_id, nationality_country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_players_primary_position_code_fk` : `primary_position_code, primary_position_definition_version → football.positions(code, definition_version) ; ON DELETE RESTRICT`.
- CHECK `football_players_dominant_foot_ck` : `dominant_foot IN ('left', 'right', 'both', 'unknown')`.
- CHECK `football_players_height_ck` : `height_cm > 0`.
- CHECK `football_players_sv_nationality_country_revision_id_pair_ck` : `(nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)`.
- CHECK `football_players_sv_primary_position_definition_version_pair_ck` : `(primary_position_code IS NULL) = (primary_position_definition_version IS NULL)`.
- CHECK `football_players_sv_primary_position_definition_vers_0e8990b2c3` : `primary_position_definition_version IS NULL OR (btrim(primary_position_definition_version) <> '')`.


### football.position_mappings

Traductions versionnées des codes de poste fournisseur. Grain physique : un mapping immuable identifié par mapping_version, PK (source_id, raw_position_code, mapping_version) ; clé logique (source_id, raw_position_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : un mapping immuable identifié par mapping_version, PK (source_id, raw_position_code, mapping_version) ; clé logique (source_id, raw_position_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_mapping`.

Clé logique : `source_id, raw_position_code`.

Clé de version : `mapping_version`.

Responsabilité métier : Source × code brut × version de mapping.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `raw_position_code` | `text` | non | PK | Code natif du poste ; résolution uniquement avec une version de mapping validée. |
| `mapping_version` | `text` | non | PK | Version de la traduction des valeurs fournisseur. |
| `position_code` | `text` | oui | FK | Référence SQL vers football.positions(code, definition_version). |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `evidence` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `position_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, raw_position_code, mapping_version`.

- UNIQUE `football_position_mappings_sv_mapped_definition_anchor_uq` : `source_id, raw_position_code, mapping_version, position_code, position_definition_version`.
- FK `football_position_mappings_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_position_mappings_position_code_fk` : `position_code, position_definition_version → football.positions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_position_mappings_sv_recorded_from_gen_data_b70009d5c1` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_position_mappings_sv_recorded_to_gen_datase_854a35ce70` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_position_mappings_sv_relation_code_contract_998854d327` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_position_mappings_sv_source_id_source_recor_6b0041981b` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_position_mappings_evidence_kind_ck` : `jsonb_typeof(evidence) = 'object'`.
- CHECK `football_position_mappings_status_ck` : `status IN ('unresolved', 'validated', 'rejected')`.
- CHECK `football_position_mappings_validated_position_ck` : `status <> 'validated' OR position_code IS NOT NULL`.
- CHECK `football_position_mappings_evidence_bounded_ck` : `octet_length(evidence::text)<=16384`.
- CHECK `football_position_mappings_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_position_mappings_sv_relation_binding_ck` : `relation_code = 'football.position_mappings'`.
- CHECK `football_position_mappings_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_position_mappings_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_position_mappings_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_position_mappings_sv_position_definition_ve_8ba3ff4bca` : `(position_code IS NULL) = (position_definition_version IS NULL)`.
- CHECK `football_position_mappings_sv_mapping_version_nonempty_ck` : `btrim(mapping_version) <> ''`.
- CHECK `football_position_mappings_sv_position_definition_ve_d44ae052be` : `position_definition_version IS NULL OR (btrim(position_definition_version) <> '')`.
- INDEX `football_position_mappings_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "raw_position_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.positions

Rôles canoniques dont la définition est validée. Grain physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_definition`.

Clé logique : `code`.

Clé de version : `definition_version`.

Responsabilité métier : Un code de rôle.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non | PK | Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `family` | `text` | non |  | Famille de poste : gardien, défenseur, milieu ou attaquant. |
| `definition` | `text` | non |  | Définition sémantique du code et de ses conditions d’utilisation. |
| `definition_version` | `text` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `code, definition_version`.

- FK `football_positions_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_positions_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_positions_sv_relation_code_contract_version_8da17264b7` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_positions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_positions_sv_source_id_source_record_id_sou_30ad130c7a` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_positions_family_ck` : `family IN ('goalkeeper', 'defender', 'midfielder', 'forward')`.
- CHECK `football_positions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_positions_sv_relation_binding_ck` : `relation_code = 'football.positions'`.
- CHECK `football_positions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_positions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_positions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_positions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_positions_sv_definition_version_nonempty_ck` : `btrim(definition_version) <> ''`.
- INDEX `football_positions_sv_current_idx` : `UNIQUE btree : [{"column": "code", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.


### football.team_aliases

Noms alternatifs ou historiques pour l’affichage et la résolution. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un alias observé dans un contexte source.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `alias` | `text` | non |  | Nom alternatif ou historique d’une équipe, conservé avec langue, source et validité. |
| `language_code` | `text` | oui |  | Langue de cet alias lorsqu’elle est connue. |
| `source_id` | `bigint` | oui | FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `valid_from` | `date` | oui |  | Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Fin de validité connue ; NULL conserve une borne inconnue. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_team_aliases_sv_natural_0_generation_uq` : `team_id, alias, language_code, source_id, valid_from, variant_key, recorded_from_gen ; NULLS NOT DISTINCT`.
- UNIQUE `football_team_aliases_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_team_aliases_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_team_aliases_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_team_aliases_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_team_aliases_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_aliases_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_aliases_sv_relation_code_contract_vers_d23a7877a4` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_aliases_sv_source_id_source_record_id__bf2e069ad5` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_team_aliases_valid_to_after_valid_from_ck` : `valid_to >= valid_from`.
- CHECK `football_team_aliases_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_aliases_sv_relation_binding_ck` : `relation_code = 'football.team_aliases'`.
- CHECK `football_team_aliases_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_aliases_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_aliases_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_aliases_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_aliases_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_team_aliases_team_id_idx` : `btree : [{"column": "team_id", "order": "ASC"}]`.
- INDEX `football_team_aliases_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "alias", "order": "ASC"}, {"column": "language_code", "order": "ASC"}, {"column": "source_id", "order": "ASC"}, {"column": "valid_from", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_aliases_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "alias", "order": "ASC"}, {"column": "language_code", "order": "ASC"}, {"column": "source_id", "order": "ASC"}, {"column": "valid_from", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_team_aliases_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_aliases_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.team_profile_versions

Versions observées des noms, codes, emblèmes et affiliations d’un team. Grain physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (team_id, profile_context), variante variant_key ; sélection canonique (team_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (team_id, profile_context), variante variant_key ; sélection canonique (team_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `profile_observation`.

Clé logique : `team_id, profile_context`.

Responsabilité métier : Identité × observation de profil.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne de la ligne, jamais substitué aux identifiants publics existants. |
| `team_id` | `bigint` | non | FK | Identité canonique observée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
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
| `slug` | `text` | oui |  | Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases. |
| `team_type` | `text` | oui |  | Club, sélection nationale, équipe représentative ou type inconnu. |
| `gender` | `text` | oui |  | Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `age_category` | `text` | oui |  | Catégorie d’âge déclarée ; ne pas la déduire sans preuve. |
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `founded_year` | `integer` | oui |  | Année de fondation lorsqu’elle est sourcée. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `profile_context` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_team_profile_versions_sv_natural_0_generation_uq` : `team_id, source_record_id, variant_key, recorded_from_gen`.
- UNIQUE `football_team_profile_versions_sv_profile_actor_uq` : `id, team_id`.
- UNIQUE `football_team_profile_versions_sv_profile_generation_uq` : `team_id, profile_context, variant_key, recorded_from_gen`.
- FK `football_team_profile_versions_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_image_asset_id_fk` : `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_sv_country_id_countries_fk` : `country_id, country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_sv_recorded_from_gen__bd66f910d2` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_sv_recorded_to_gen_da_f299fd9bf1` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_sv_relation_code_cont_28a9efc856` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_team_profile_versions_sv_source_id_source_r_9cc2d04542` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_team_profile_versions_validity_ck` : `valid_to>=valid_from`.
- CHECK `football_team_profile_versions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_profile_versions_sv_relation_binding_ck` : `relation_code = 'football.team_profile_versions'`.
- CHECK `football_team_profile_versions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_profile_versions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_profile_versions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_profile_versions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_profile_versions_sv_country_revision_id_pair_ck` : `(country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)`.
- CHECK `football_team_profile_versions_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_team_profile_versions_sv_profile_context_nonempty_ck` : `btrim(profile_context) <> ''`.
- INDEX `football_team_profile_versions_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "source_record_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_profile_versions_sv_natural_0_canonica_674cc75c60` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "source_record_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_team_profile_versions_sv_variant_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "profile_context", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_profile_versions_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "profile_context", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.team_source_ids

Identifiants externes typés de team. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_team_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_team_source_ids_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_team_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_team_source_ids_sv_recorded_from_gen_datase_74e032a278` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_source_ids_sv_recorded_to_gen_dataset__85249261f5` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_source_ids_sv_relation_code_contract_v_6f816f4fca` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_team_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_source_ids_sv_relation_binding_ck` : `relation_code = 'football.team_source_ids'`.
- CHECK `football_team_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_team_source_ids_team_id_idx` : `btree : [{"column": "team_id", "order": "ASC"}]`.
- INDEX `football_team_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.teams

Équipes sportives, distinctes des fédérations et des organisations futures.

Grain physique : Une équipe.

Classe de version : `stable_identity`.

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
| `country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `association_id` | `bigint` | oui | FK | Référence SQL vers football.associations(id). |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `founded_year` | `integer` | oui |  | Année de fondation lorsqu’elle est sourcée. |
| `country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_teams_slug_uq` : `slug`.
- FK `football_teams_country_id_fk` : `country_id, country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_teams_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `football_teams_image_asset_id_fk` : `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- CHECK `football_teams_team_type_ck` : `team_type IN ('club', 'national', 'representative', 'unknown')`.
- CHECK `football_teams_gender_ck` : `gender IN ('men', 'women', 'mixed', 'unknown')`.
- CHECK `football_teams_founded_year_ck` : `founded_year > 0`.
- CHECK `football_teams_sv_country_revision_id_pair_ck` : `(country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)`.


### football.venue_source_ids

Identifiants externes typés de venue. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_resolution`.

Clé logique : `source_id, external_id`.

Responsabilité métier : Source × identifiant externe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `external_id` | `text` | non | PK | Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom. |
| `venue_id` | `bigint` | non | FK | Référence SQL vers football.venues(id, revision_id). |
| `first_seen_at` | `timestamptz` | non |  | Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `venue_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, external_id, recorded_from_gen`.

- FK `football_venue_source_ids_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_venue_source_ids_venue_id_fk` : `venue_id, venue_revision_id → football.venues(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_venue_source_ids_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_venue_source_ids_sv_recorded_from_gen_datas_853835d0ad` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_venue_source_ids_sv_recorded_to_gen_dataset_3238973a75` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_venue_source_ids_sv_relation_code_contract__8dd534865c` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- CHECK `football_venue_source_ids_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_venue_source_ids_sv_relation_binding_ck` : `relation_code = 'football.venue_source_ids'`.
- CHECK `football_venue_source_ids_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_venue_source_ids_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_venue_source_ids_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- INDEX `football_venue_source_ids_venue_id_idx` : `btree : [{"column": "venue_id", "order": "ASC"}]`.
- INDEX `football_venue_source_ids_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "external_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

## Matchs et participations

### football.match_events

Flux courant d’événements remplacé atomiquement lors d’une correction. Grain physique : un enfant (event_seq) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, event_seq). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Grain physique : Ligne physique : un enfant (event_seq) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, event_seq). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Classe de version : `parent_version_child`.

Clé logique : `event_seq`.

Responsabilité métier : Match × ordinal dans la version courante.

Ancrage de version parente : `{"columns": ["match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"], "references": {"table": "ingest.match_coverage", "columns": ["match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"]}, "enforced_by": ["football_match_events_sv_match_id_source_id_feature__b755fa8806"]}`.

Écriture : `immutable_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id, revision_id); football.match_teams(match_id, team_id, revision_id); ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen). |
| `event_seq` | `integer` | non | PK | Ordre dans une version du flux ; ne constitue pas une identité stable entre corrections. |
| `event_type` | `text` | non |  | Type d’événement observé ; mapping versionné si normalisé. |
| `period_code` | `text` | oui | FK | Référence SQL vers football.periods(code, definition_version). |
| `minute` | `integer` | oui |  | Minute source dans la période indiquée ; précision conservée. |
| `minute_added` | `integer` | oui |  | Temps additionnel distinct de la minute principale. |
| `second` | `smallint` | oui |  | Seconde dans la minute, de 0 à 59. |
| `team_id` | `bigint` | oui | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id). |
| `related_player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id). |
| `is_penalty` | `boolean` | oui |  | Penalty explicitement signalé dans l’observation. |
| `is_own_goal` | `boolean` | oui |  | But contre son camp explicitement signalé. |
| `source_event_id` | `text` | oui |  | Identifiant natif d’événement s’il existe ; sinon ordre dans la famille versionnée. |
| `source_ordinal` | `integer` | non |  | Position native dans la collection source, conservée pour la compatibilité. |
| `source_id` | `bigint` | non | PK/FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `score_home` | `integer` | oui |  | Score observé après l’événement, sans supposer sa portée si la source ne la donne pas. |
| `score_away` | `integer` | oui |  | Score observé après l’événement, sans supposer sa portée si la source ne la donne pas. |
| `feature_code` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `variant_key` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `match_id, source_id, feature_code, variant_key, recorded_from_gen, event_seq`.

- FK `football_match_events_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_events_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_events_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_match_events_related_player_id_fk` : `related_player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_match_events_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_match_events_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_events_sv_match_id_source_id_feature__b755fa8806` : `match_id, source_id, feature_code, variant_key, recorded_from_gen → ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen) ; ON DELETE RESTRICT`.
- CHECK `football_match_events_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_events_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_events_event_seq_nonnegative_ck` : `event_seq >= 0`.
- CHECK `football_match_events_source_ordinal_nonnegative_ck` : `source_ordinal >= 0`.
- CHECK `football_match_events_minute_nonnegative_ck` : `minute >= 0`.
- CHECK `football_match_events_minute_added_nonnegative_ck` : `minute_added >= 0`.
- CHECK `football_match_events_second_ck` : `second BETWEEN 0 AND 59`.
- CHECK `football_match_events_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_events_sv_collection_family_ck` : `feature_code = 'events'`.
- CHECK `football_match_events_sv_match_team_revision_id_pair_ck` : `(match_team_revision_id IS NULL AND (match_id IS NULL OR team_id IS NULL)) OR (match_team_revision_id IS NOT NULL AND match_id IS NOT NULL AND team_id IS NOT NULL)`.
- CHECK `football_match_events_sv_period_definition_version_pair_ck` : `(period_code IS NULL) = (period_definition_version IS NULL)`.
- CHECK `football_match_events_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_match_events_sv_period_definition_version_nonempty_ck` : `period_definition_version IS NULL OR (btrim(period_definition_version) <> '')`.

- event_seq n’est pas une identité entre deux versions du payload.
- Ne pas rendre unique minute + joueur + type.
- Les joueurs liés sont des identités; une ligne de statistiques complète n’est pas exigée.

### football.match_h2h_entries

Rencontres précédentes effectivement observées dans une réponse H2H, y compris une identité non encore résolue. Grain physique : un enfant (entry_ordinal) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, entry_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Grain physique : Ligne physique : un enfant (entry_ordinal) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, entry_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Classe de version : `parent_version_child`.

Clé logique : `entry_ordinal`.

Responsabilité métier : Match contexte × ordinal dans une version de H2H.

Ancrage de version parente : `{"columns": ["match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"], "references": {"table": "ingest.match_coverage", "columns": ["match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"]}, "enforced_by": ["football_match_h2h_entries_sv_match_id_source_id_fea_8ba4929553"]}`.

Écriture : `immutable_with_parent` ; phase : `enrichment`.

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
| `source_id` | `bigint` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `feature_code` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `variant_key` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `previous_match_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `match_id, source_id, feature_code, variant_key, recorded_from_gen, entry_ordinal`.

- FK `football_match_h2h_entries_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_previous_match_id_fk` : `previous_match_id, previous_match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_home_team_id_fk` : `home_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_away_team_id_fk` : `away_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_home_image_asset_id_fk` : `home_image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_away_image_asset_id_fk` : `away_image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_sv_match_id_source_id_fea_8ba4929553` : `match_id, source_id, feature_code, variant_key, recorded_from_gen → ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen) ; ON DELETE RESTRICT`.
- FK `football_match_h2h_entries_sv_source_id_source_recor_d8a524c561` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_match_h2h_entries_sv_collection_family_ck` : `feature_code = 'h2h'`.
- CHECK `football_match_h2h_entries_sv_previous_match_revisio_effe2df9bc` : `(previous_match_revision_id IS NULL AND (previous_match_id IS NULL)) OR (previous_match_revision_id IS NOT NULL AND previous_match_id IS NOT NULL)`.
- CHECK `football_match_h2h_entries_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.


### football.match_lineups

Composition retenue d’une équipe. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id), variante variant_key ; sélection canonique (match_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id), variante variant_key ; sélection canonique (match_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, team_id`.

Responsabilité métier : Match × équipe.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `formation` | `text` | oui |  | Formation observée, conservée comme libellé. |
| `confirmed` | `boolean` | oui |  | Confirmation explicite de la composition ; une prédiction ne vaut pas confirmation. |
| `lineup_type` | `text` | non |  | Nature confirmed, predicted, observed ou unknown de la composition. |
| `published_at` | `timestamptz` | oui |  | Publication déclarée ou activation, selon le grain de cette table. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_match_lineups_sv_logical_revision_uq` : `match_id, team_id, revision_id`.
- UNIQUE `football_match_lineups_sv_variant_generation_uq` : `match_id, team_id, variant_key, recorded_from_gen`.
- FK `football_match_lineups_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_lineups_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_lineups_sv_recorded_from_gen_dataset__3c97843dc7` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_lineups_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_lineups_sv_relation_code_contract_ver_31217aaa32` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_match_lineups_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_match_lineups_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_lineups_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_lineups_lineup_type_ck` : `lineup_type IN ('confirmed', 'predicted', 'observed', 'unknown')`.
- CHECK `football_match_lineups_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_lineups_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_match_lineups_sv_relation_binding_ck` : `relation_code = 'football.match_lineups'`.
- CHECK `football_match_lineups_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_match_lineups_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_match_lineups_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_match_lineups_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_match_lineups_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_match_lineups_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_lineups_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.match_observation_details

Faits contextuels observés dans les résultats et archives complémentaires.

Grain physique : Un enregistrement source × génération de normalisation ; une correction conserve la ligne antérieure et sélectionne la nouvelle à partir de sa génération.

Classe de version : `existing_append_only`.

Clé logique : `source_record_id`.

Clé de version : `recorded_from_gen`.

Sélection historique : `latest recorded_from_gen <= g per source_record_id`.

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
| `recorded_from_gen` | `bigint` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_record_id, recorded_from_gen`.

- FK `football_match_observation_details_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `football_match_observation_details_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_observation_details_sv_recorded_from__b000818524` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- CHECK `football_match_observation_details_sv_match_revision_id_pair_ck` : `(match_revision_id IS NULL AND (match_id IS NULL)) OR (match_revision_id IS NOT NULL AND match_id IS NOT NULL)`.

- Scores, événements, métriques et affiliations vont dans leurs tables métier ; aucune colonne sourceFields/extra JSONB.
- Les codes supplémentaires doivent recevoir un contrat de champ et une destination typée avant purge ; pas de conservation opaque de la ligne d’archive.

### football.match_players

Joueurs listés ou observés; le banc ne prouve pas une apparition. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id), variante variant_key ; sélection canonique (match_id, player_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id), variante variant_key ; sélection canonique (match_id, player_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, player_id`.

Responsabilité métier : Match × joueur.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id); football.player_profile_versions(id, player_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `profile_version_id` | `bigint` | oui | FK | Référence SQL vers football.player_profile_versions(id, player_id). |
| `is_starter` | `boolean` | oui |  | Statut titulaire observé ; ne pas le déduire de statistiques manquantes. |
| `squad_status` | `text` | non |  | Titulaire, remplaçant, remplaçant inutilisé, observation ou état inconnu. |
| `played` | `boolean` | oui |  | Participation prouvée dans match_players ; dans un classement, nombre de matchs joués. |
| `participation_evidence` | `text` | oui |  | Preuve explicite qui justifie played ; une ligne de performance ne suffit pas. |
| `shirt_number` | `text` | oui |  | Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local. |
| `raw_position_code` | `text` | oui | FK | Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local. |
| `position_code` | `text` | oui | FK | Référence SQL vers football.positions(code, definition_version); football.position_mappings(source_id, raw_position_code, mapping_version, position_code, position_definition_version). |
| `position_mapping_version` | `text` | oui | FK | Référence SQL vers football.position_mappings(source_id, raw_position_code, mapping_version); football.position_mappings(source_id, raw_position_code, mapping_version, position_code, position_definition_version). |
| `raw_pitch_x` | `double precision` | oui |  | Coordonnée native de placement du joueur ; pas une distance en mètres supposée. |
| `raw_pitch_y` | `double precision` | oui |  | Seconde coordonnée native de placement du joueur. |
| `coordinate_frame` | `text` | oui |  | Repère spatial déclaré par la source, propre à cette famille. |
| `is_captain` | `boolean` | oui |  | Capitanat explicitement indiqué dans la composition. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `position_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `raw_position_code_state` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `raw_position_code_source_number` | `numeric` | oui |  | Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé. |
| `shirt_number_state` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `shirt_number_source_number` | `numeric` | oui |  | Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé. |

PK : `revision_id`.

- UNIQUE `football_match_players_sv_natural_0_generation_uq` : `match_id, player_id, team_id, variant_key, recorded_from_gen`.
- UNIQUE `football_match_players_sv_logical_revision_uq` : `match_id, player_id, revision_id`.
- UNIQUE `football_match_players_sv_variant_generation_uq` : `match_id, player_id, variant_key, recorded_from_gen`.
- UNIQUE `football_match_players_sv_anchor_match_id_player_id_team_id_uq` : `match_id, player_id, team_id, revision_id`.
- FK `football_match_players_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_players_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_match_players_profile_version_id_player_id_fk` : `profile_version_id, player_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `football_match_players_position_code_fk` : `position_code, position_definition_version → football.positions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_match_players_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_players_source_id_raw_position_code_po_5b3997f77` : `source_id, raw_position_code, position_mapping_version → football.position_mappings(source_id, raw_position_code, mapping_version) ; ON DELETE RESTRICT`.
- FK `football_match_players_sv_recorded_from_gen_dataset__97b20cb775` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_players_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_players_sv_relation_code_contract_ver_f3c3bcd04a` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_match_players_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_match_players_sv_source_id_raw_position_cod_d20ac20ff0` : `source_id, raw_position_code, position_mapping_version, position_code, position_definition_version → football.position_mappings(source_id, raw_position_code, mapping_version, position_code, position_definition_version) ; ON DELETE RESTRICT`.
- CHECK `football_match_players_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_players_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_players_squad_status_ck` : `squad_status IN ('starter', 'substitute', 'unused_substitute', 'observed', 'unknown')`.
- CHECK `football_match_players_position_mapping_context_ck` : `position_mapping_version IS NULL OR raw_position_code IS NOT NULL`.
- CHECK `football_match_players_played_evidence_ck` : `played IS NULL OR participation_evidence IS NOT NULL`.
- CHECK `football_match_players_coords_frame_ck` : `(raw_pitch_x IS NULL AND raw_pitch_y IS NULL) OR coordinate_frame IS NOT NULL`.
- CHECK `football_match_players_raw_pitch_x_finite_ck` : `raw_pitch_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_match_players_raw_pitch_y_finite_ck` : `raw_pitch_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_match_players_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_players_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_match_players_sv_relation_binding_ck` : `relation_code = 'football.match_players'`.
- CHECK `football_match_players_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_match_players_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_match_players_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_match_players_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_match_players_sv_position_definition_version_pair_ck` : `(position_code IS NULL) = (position_definition_version IS NULL)`.
- CHECK `football_match_players_sv_mapping_source_context_ck` : `position_mapping_version IS NULL OR (raw_position_code IS NOT NULL AND source_id IS NOT NULL)`.
- CHECK `football_match_players_sv_position_mapping_version_nonempty_ck` : `position_mapping_version IS NULL OR (btrim(position_mapping_version) <> '')`.
- CHECK `football_match_players_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_match_players_sv_position_definition_versio_2a3a1087d6` : `position_definition_version IS NULL OR (btrim(position_definition_version) <> '')`.
- CHECK `football_match_players_sv_raw_position_code_native_state_ck` : `(raw_position_code_state IN ('absent','null') AND raw_position_code IS NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'string' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'number' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NOT NULL AND raw_position_code_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN raw_position_code ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN raw_position_code::numeric = raw_position_code_source_number ELSE false END)`.
- CHECK `football_match_players_sv_shirt_number_native_state_ck` : `(shirt_number_state IN ('absent','null') AND shirt_number IS NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'string' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'number' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NOT NULL AND shirt_number_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN shirt_number ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN shirt_number::numeric = shirt_number_source_number ELSE false END)`.
- INDEX `football_match_players_player_id_match_id_idx` : `btree : [{"column": "player_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.
- INDEX `football_match_players_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_players_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_match_players_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_players_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.match_scores

Scores à périmètre explicite; les valeurs cumulées ne s’additionnent pas. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, side, score_scope), variante variant_key ; sélection canonique (match_id, side, score_scope) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, side, score_scope), variante variant_key ; sélection canonique (match_id, side, score_scope) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, side, score_scope`.

Responsabilité métier : Match × côté × portée du score.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, side, revision_id). |
| `side` | `text` | non | FK | Référence SQL vers football.match_teams(match_id, side, revision_id). |
| `score_scope` | `text` | non |  | Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance. |
| `goals` | `integer` | oui |  | Buts observés dans le grain et la période de cette table ; zéro est une observation. |
| `score_basis` | `text` | non |  | Score effectivement joué, attribué administrativement ou de base inconnue. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_match_scores_sv_logical_revision_uq` : `match_id, side, score_scope, revision_id`.
- UNIQUE `football_match_scores_sv_variant_generation_uq` : `match_id, side, score_scope, variant_key, recorded_from_gen`.
- FK `football_match_scores_match_id_side_fk` : `match_id, side, match_team_revision_id → football.match_teams(match_id, side, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_scores_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_scores_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_scores_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_scores_sv_relation_code_contract_vers_da21b42b07` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_match_scores_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_match_scores_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_scores_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_scores_score_scope_ck` : `score_scope IN ('half_time', 'regulation', 'after_extra_time', 'shootout', 'final_without_shootout')`.
- CHECK `football_match_scores_score_basis_ck` : `score_basis IN ('played', 'awarded', 'unknown')`.
- CHECK `football_match_scores_goals_nonnegative_ck` : `goals >= 0`.
- CHECK `football_match_scores_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_scores_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_match_scores_sv_relation_binding_ck` : `relation_code = 'football.match_scores'`.
- CHECK `football_match_scores_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_match_scores_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_match_scores_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_match_scores_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_match_scores_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_match_scores_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "side", "order": "ASC"}, {"column": "score_scope", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_scores_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "side", "order": "ASC"}, {"column": "score_scope", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.match_teams

Places domicile/extérieur: seul emplacement canonique des participants. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, side), variante variant_key ; sélection canonique (match_id, side) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, side), variante variant_key ; sélection canonique (match_id, side) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, side`.

Responsabilité métier : Match × côté.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.matches(id, revision_id). |
| `side` | `text` | non |  | Place home ou away du participant dans ce match. |
| `team_id` | `bigint` | oui | FK | Référence SQL vers football.teams(id). |
| `participant_label` | `text` | oui |  | Libellé de participant encore non résolu, par exemple vainqueur d’une demi-finale. |
| `coach_id` | `bigint` | oui | FK | Référence SQL vers football.coaches(id, revision_id). |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `coach_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_match_teams_sv_natural_0_generation_uq` : `match_id, team_id, variant_key, recorded_from_gen`.
- UNIQUE `football_match_teams_sv_logical_revision_uq` : `match_id, side, revision_id`.
- UNIQUE `football_match_teams_sv_variant_generation_uq` : `match_id, side, variant_key, recorded_from_gen`.
- UNIQUE `football_match_teams_sv_anchor_match_id_team_id_uq` : `match_id, team_id, revision_id`.
- FK `football_match_teams_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_teams_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_match_teams_coach_id_fk` : `coach_id, coach_revision_id → football.coaches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_teams_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_teams_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_teams_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_teams_sv_relation_code_contract_versi_0717091192` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_match_teams_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_match_teams_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_teams_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_teams_side_ck` : `side IN ('home', 'away')`.
- CHECK `football_match_teams_participant_identity_ck` : `team_id IS NOT NULL OR participant_label IS NOT NULL`.
- CHECK `football_match_teams_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_teams_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_match_teams_sv_relation_binding_ck` : `relation_code = 'football.match_teams'`.
- CHECK `football_match_teams_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_match_teams_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_match_teams_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_match_teams_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_match_teams_sv_coach_revision_id_pair_ck` : `(coach_revision_id IS NULL AND (coach_id IS NULL)) OR (coach_revision_id IS NOT NULL AND coach_id IS NOT NULL)`.
- CHECK `football_match_teams_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_match_teams_team_id_match_id_idx` : `btree : [{"column": "team_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}] WHERE team_id IS NOT NULL`.
- INDEX `football_match_teams_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_teams_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_match_teams_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "side", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_teams_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "side", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.matches

Matchs canoniques; date civile et instant de coup d’envoi restent distincts. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un match.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id, revision_id); football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id). |
| `stage_id` | `bigint` | oui | FK | Référence SQL vers football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id). |
| `group_id` | `bigint` | oui | FK | Référence SQL vers football.competition_groups(id, stage_id, competition_season_id, revision_id). |
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
| `venue_id` | `bigint` | oui | FK | Référence SQL vers football.venues(id, revision_id). |
| `neutral_venue` | `boolean` | oui |  | Terrain neutre si explicitement connu. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_season_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `stage_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `group_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `venue_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_matches_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_matches_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_matches_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_matches_stage_id_competition_season_id_fk` : `stage_id, competition_season_id, stage_revision_id → football.competition_stages(id, competition_season_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_matches_group_id_stage_id_competition_season_id_fk` : `group_id, stage_id, competition_season_id, group_revision_id → football.competition_groups(id, stage_id, competition_season_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_matches_venue_id_fk` : `venue_id, venue_revision_id → football.venues(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_matches_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_matches_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_matches_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_matches_sv_relation_code_contract_version_r_2ae8cc5c17` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_matches_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_matches_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_matches_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_matches_group_requires_stage_ck` : `group_id IS NULL OR stage_id IS NOT NULL`.
- CHECK `football_matches_kickoff_precision_ck` : `kickoff_precision IN ('unknown', 'date', 'minute', 'second')`.
- CHECK `football_matches_kickoff_precision_consistent_ck` : `(kickoff_precision = 'unknown' AND kickoff_at IS NULL) OR (kickoff_precision = 'date' AND match_date IS NOT NULL AND kickoff_at IS NULL) OR (kickoff_precision IN ('minute','second') AND kickoff_at IS NOT NULL)`.
- CHECK `football_matches_status_ck` : `status IN ('not_started', 'in_play', 'half_time', 'extra_time', 'shootout', 'finished', 'postponed', 'suspended', 'abandoned', 'awarded', 'canceled', 'unknown')`.
- CHECK `football_matches_publication_state_ck` : `publication_state IN ('draft', 'published', 'quarantined')`.
- CHECK `football_matches_leg_positive_ck` : `leg_number > 0`.
- CHECK `football_matches_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_matches_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_matches_sv_relation_binding_ck` : `relation_code = 'football.matches'`.
- CHECK `football_matches_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_matches_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_matches_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_matches_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_matches_sv_stage_revision_id_pair_ck` : `(stage_revision_id IS NULL AND (stage_id IS NULL)) OR (stage_revision_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- CHECK `football_matches_sv_group_revision_id_pair_ck` : `(group_revision_id IS NULL AND (group_id IS NULL)) OR (group_revision_id IS NOT NULL AND group_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- CHECK `football_matches_sv_venue_revision_id_pair_ck` : `(venue_revision_id IS NULL AND (venue_id IS NULL)) OR (venue_revision_id IS NOT NULL AND venue_id IS NOT NULL)`.
- CHECK `football_matches_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_matches_competition_season_id_match_date_id_idx` : `btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "match_date", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.
- INDEX `football_matches_match_date_status_id_idx` : `btree : [{"column": "match_date", "order": "ASC"}, {"column": "status", "order": "ASC"}, {"column": "id", "order": "ASC"}]`.
- INDEX `football_matches_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_matches_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


## Statistiques et périodes

### football.metric_definitions

Définitions de métriques et règles d’agrégation. Grain physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_definition`.

Clé logique : `code`.

Clé de version : `definition_version`.

Responsabilité métier : Un code de métrique avec définition stable.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

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
| `numerator_code` | `text` | oui | FK | Référence SQL vers football.metric_definitions(code, definition_version). |
| `denominator_code` | `text` | oui | FK | Référence SQL vers football.metric_definitions(code, definition_version). |
| `definition_version` | `text` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `numerator_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `denominator_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `code, definition_version`.

- FK `football_metric_definitions_numerator_code_fk` : `numerator_code, numerator_definition_version → football.metric_definitions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_metric_definitions_denominator_code_fk` : `denominator_code, denominator_definition_version → football.metric_definitions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_metric_definitions_sv_recorded_from_gen_dat_0aec767513` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_metric_definitions_sv_recorded_to_gen_datas_d6b0be80de` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_metric_definitions_sv_relation_code_contrac_e64afb5233` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_metric_definitions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_metric_definitions_sv_source_id_source_reco_bcf6134006` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_metric_definitions_scope_ck` : `scope IN ('player', 'team', 'shot', 'network', 'ranking')`.
- CHECK `football_metric_definitions_aggregation_ck` : `aggregation IN ('sum', 'weighted_mean', 'ratio_of_sums', 'last', 'none')`.
- CHECK `football_metric_definitions_bounds_ck` : `maximum >= minimum`.
- CHECK `football_metric_definitions_minimum_finite_ck` : `minimum NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_metric_definitions_maximum_finite_ck` : `maximum NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_metric_definitions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_metric_definitions_sv_relation_binding_ck` : `relation_code = 'football.metric_definitions'`.
- CHECK `football_metric_definitions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_metric_definitions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_metric_definitions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_metric_definitions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_metric_definitions_sv_numerator_definition__08a2f634cb` : `(numerator_code IS NULL) = (numerator_definition_version IS NULL)`.
- CHECK `football_metric_definitions_sv_denominator_definitio_f3ff2d6c72` : `(denominator_code IS NULL) = (denominator_definition_version IS NULL)`.
- CHECK `football_metric_definitions_sv_definition_version_nonempty_ck` : `btrim(definition_version) <> ''`.
- CHECK `football_metric_definitions_sv_numerator_definition__b971cb1a86` : `numerator_definition_version IS NULL OR (btrim(numerator_definition_version) <> '')`.
- CHECK `football_metric_definitions_sv_denominator_definitio_20b3573f5f` : `denominator_definition_version IS NULL OR (btrim(denominator_definition_version) <> '')`.
- INDEX `football_metric_definitions_sv_current_idx` : `UNIQUE btree : [{"column": "code", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.


### football.periods

Périodes explicites; full_match ne s’ajoute pas à ses composantes. Grain physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_definition`.

Clé logique : `code`.

Clé de version : `definition_version`.

Responsabilité métier : Une période canonique.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `code` | `text` | non | PK | Code stable du référentiel, avec sa définition explicite. |
| `label` | `text` | non |  | Libellé d’affichage du code ou de l’édition. |
| `sequence_no` | `integer` | non |  | Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire. |
| `is_aggregate` | `boolean` | non |  | Indique qu’une période recouvre d’autres périodes ; empêche leur addition naïve. |
| `definition` | `text` | non |  | Définition sémantique du code et de ses conditions d’utilisation. |
| `definition_version` | `text` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `code, definition_version`.

- FK `football_periods_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_periods_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_periods_sv_relation_code_contract_version_r_35e7343ca2` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_periods_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_periods_sv_source_id_source_record_id_sourc_b1c0d4d034` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_periods_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_periods_sv_relation_binding_ck` : `relation_code = 'football.periods'`.
- CHECK `football_periods_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_periods_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_periods_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_periods_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_periods_sv_definition_version_nonempty_ck` : `btrim(definition_version) <> ''`.
- INDEX `football_periods_sv_current_idx` : `UNIQUE btree : [{"column": "code", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.


### football.player_match_advanced

Mesures avancées joueur avec modèle fournisseur identifié. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, player_id, period_code`.

Responsabilité métier : Match × player × période.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id). |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id). |
| `period_code` | `text` | non | FK | Référence SQL vers football.periods(code, definition_version). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id). |
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
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
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
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_player_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_player_match_advanced_sv_logical_revision_uq` : `match_id, player_id, period_code, revision_id`.
- UNIQUE `football_player_match_advanced_sv_variant_generation_uq` : `match_id, player_id, period_code, variant_key, recorded_from_gen`.
- FK `football_player_match_advanced_match_id_player_id_team_id_fk` : `match_id, player_id, team_id, match_player_revision_id → football.match_players(match_id, player_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_player_match_advanced_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_advanced_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_player_match_advanced_sv_recorded_from_gen__6bc2b489cd` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_match_advanced_sv_recorded_to_gen_da_5d7c1c9f10` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_match_advanced_sv_relation_code_cont_ea86b05fbc` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_advanced_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_player_match_advanced_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_player_match_advanced_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_player_match_advanced_progressive_passes_non_e869e1d7c` : `progressive_passes >= 0`.
- CHECK `football_player_match_advanced_passes_into_box_nonnegative_ck` : `passes_into_box >= 0`.
- CHECK `football_player_match_advanced_key_passes_nonnegative_ck` : `key_passes >= 0`.
- CHECK `football_player_match_advanced_through_balls_nonnegative_ck` : `through_balls >= 0`.
- CHECK `football_player_match_advanced_crosses_nonnegative_ck` : `crosses >= 0`.
- CHECK `football_player_match_advanced_switches_nonnegative_ck` : `switches >= 0`.
- CHECK `football_player_match_advanced_carries_nonnegative_ck` : `carries >= 0`.
- CHECK `football_player_match_advanced_progressive_carries_no_ab2d020d6` : `progressive_carries >= 0`.
- CHECK `football_player_match_advanced_carries_into_final_thi_a9e3b4fc2` : `carries_into_final_third >= 0`.
- CHECK `football_player_match_advanced_carries_into_box_nonnegative_ck` : `carries_into_box >= 0`.
- CHECK `football_player_match_advanced_take_ons_nonnegative_ck` : `take_ons >= 0`.
- CHECK `football_player_match_advanced_take_ons_won_nonnegative_ck` : `take_ons_won >= 0`.
- CHECK `football_player_match_advanced_miscontrols_nonnegative_ck` : `miscontrols >= 0`.
- CHECK `football_player_match_advanced_dispossessed_nonnegative_ck` : `dispossessed >= 0`.
- CHECK `football_player_match_advanced_sca_nonnegative_ck` : `sca >= 0`.
- CHECK `football_player_match_advanced_gca_nonnegative_ck` : `gca >= 0`.
- CHECK `football_player_match_advanced_second_assists_nonnegative_ck` : `second_assists >= 0`.
- CHECK `football_player_match_advanced_progressive_pass_dista_0fa1f5d07` : `progressive_pass_distance >= 0`.
- CHECK `football_player_match_advanced_carry_distance_nonnegative_ck` : `carry_distance >= 0`.
- CHECK `football_player_match_advanced_progressive_carry_dist_ad0a414ef` : `progressive_carry_distance >= 0`.
- CHECK `football_player_match_advanced_xag_nonnegative_ck` : `xag >= 0`.
- CHECK `football_player_match_advanced_xg_chain_nonnegative_ck` : `xg_chain >= 0`.
- CHECK `football_player_match_advanced_xg_buildup_nonnegative_ck` : `xg_buildup >= 0`.
- CHECK `football_player_match_advanced_take_ons_bounded_ck` : `take_ons_won <= take_ons`.
- CHECK `football_player_match_advanced_xt_total_finite_ck` : `xt_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_vaep_total_finite_ck` : `vaep_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_vaep_offensive_finite_ck` : `vaep_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_vaep_defensive_finite_ck` : `vaep_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_pv_total_finite_ck` : `pv_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_pv_offensive_finite_ck` : `pv_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_pv_defensive_finite_ck` : `pv_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_progressive_pass_dist_f89e6f743e` : `progressive_pass_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_carry_distance_finite_ck` : `carry_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_progressive_carry_dis_04f483a27c` : `progressive_carry_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_xag_finite_ck` : `xag NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_xg_chain_finite_ck` : `xg_chain NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_xg_buildup_finite_ck` : `xg_buildup NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_sca_pass_live_finite_ck` : `sca_pass_live NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_sca_pass_dead_finite_ck` : `sca_pass_dead NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_sca_take_on_finite_ck` : `sca_take_on NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_sca_shot_finite_ck` : `sca_shot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_sca_foul_drawn_finite_ck` : `sca_foul_drawn NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_sca_defensive_finite_ck` : `sca_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_advanced_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_player_match_advanced_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_match_advanced_sv_relation_binding_ck` : `relation_code = 'football.player_match_advanced'`.
- CHECK `football_player_match_advanced_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_match_advanced_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_match_advanced_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_player_match_advanced_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_player_match_advanced_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_player_match_advanced_sv_period_definition__9cc57a1556` : `btrim(period_definition_version) <> ''`.
- INDEX `football_player_match_advanced_player_id_period_code__f96697137` : `btree : [{"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.
- INDEX `football_player_match_advanced_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_match_advanced_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.player_match_metric_values

Observations typées de métriques enregistrées et de leur état natif, avec unité et fractions explicites ; une projection numérique commune ne remplace pas cet état. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, player_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, player_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, player_id, period_code, family_code, metric_code`.

Responsabilité métier : Match × player × période × famille standard/advanced × métrique.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Match du fait. |
| `player_id` | `bigint` | non | FK | Identité concernée. |
| `team_id` | `bigint` | non | FK | Équipe du joueur dans ce match. |
| `period_code` | `text` | non | FK | Période explicitement définie. |
| `family_code` | `text` | non |  | standard ou advanced. |
| `metric_code` | `text` | non | FK | Métrique enregistrée et définie ; aucune clé arbitraire. |
| `value_kind` | `text` | non |  | number, string, boolean, null ou absent. null/absent n’ont ni scalaire primaire, ni fraction, ni affichage source. Une ligne absente signifie une observation inconnue ; absent exige un champ attendu et une couverture acceptée prouvés. |
| `numeric_value` | `numeric` | oui |  | Valeur numérique exacte de cette métrique. |
| `text_value` | `text` | oui |  | Valeur textuelle si le contrat de métrique l’autorise. |
| `boolean_value` | `boolean` | oui |  | Valeur booléenne si définie comme telle. |
| `numerator` | `numeric` | oui |  | Numérateur fourni, sans le déduire d’un taux arrondi. |
| `denominator` | `numeric` | oui |  | Dénominateur observé. |
| `source_display` | `text` | oui |  | Forme affichée native d’un scalaire, par exemple 12/15 ou 75%. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `metric_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_player_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_player_match_metric_values_sv_logical_revision_uq` : `match_id, player_id, period_code, family_code, metric_code, revision_id`.
- UNIQUE `football_player_match_metric_values_sv_variant_generation_uq` : `match_id, player_id, period_code, family_code, metric_code, variant_key, recorded_from_gen`.
- FK `football_player_match_metric_values_metric_code_fk` : `metric_code, metric_definition_version → football.metric_definitions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_match_id_player__ce4af89a9f` : `match_id, player_id, team_id, match_player_revision_id → football.match_players(match_id, player_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_sv_recorded_from_b2acf1260b` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_sv_recorded_to_g_e6e4f1e403` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_sv_relation_code_728ccb3f5f` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_player_match_metric_values_sv_source_id_sou_1409e98f9a` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_player_match_metric_values_one_value_ck` : `(value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0) OR (value_kind IN ('number','string','boolean') AND num_nonnulls(numeric_value,text_value,boolean_value)=1)`.
- CHECK `football_player_match_metric_values_family_ck` : `family_code IN ('standard','advanced')`.
- CHECK `football_player_match_metric_values_value_kind_ck` : `(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL) OR (value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0)`.
- CHECK `football_player_match_metric_values_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_match_metric_values_sv_relation_binding_ck` : `relation_code = 'football.player_match_metric_values'`.
- CHECK `football_player_match_metric_values_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_match_metric_values_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_match_metric_values_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_player_match_metric_values_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_player_match_metric_values_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_player_match_metric_values_sv_metric_defini_d29d784fae` : `btrim(metric_definition_version) <> ''`.
- CHECK `football_player_match_metric_values_sv_period_defini_3ff75afe06` : `btrim(period_definition_version) <> ''`.
- INDEX `football_player_match_metric_values_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "family_code", "order": "ASC"}, {"column": "metric_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_match_metric_values_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "family_code", "order": "ASC"}, {"column": "metric_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.player_match_stats

Statistiques joueur canoniques, NULL si non observées. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, player_id, period_code`.

Responsabilité métier : Match × player × période.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id). |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id). |
| `period_code` | `text` | non | FK | Référence SQL vers football.periods(code, definition_version). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id). |
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
| `xg` | `numeric` | oui |  | Buts attendus de la source ; probabilité pour un tir, total pour une participation/période. |
| `non_penalty_xg` | `double precision` | oui |  | Buts attendus hors penalties selon la définition source. |
| `xa` | `double precision` | oui |  | Passes décisives attendues ; une valeur indisponible reste indisponible. |
| `xgot` | `double precision` | oui |  | Buts attendus sur tirs cadrés selon le modèle fournisseur. |
| `minutes_played` | `double precision` | oui |  | Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation. |
| `provider_rating` | `double precision` | oui |  | Note du fournisseur ; distincte d’un score Orion. |
| `goals_prevented` | `double precision` | oui |  | Buts évités selon le modèle gardien du fournisseur ; valeur signée. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_player_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_player_match_stats_sv_logical_revision_uq` : `match_id, player_id, period_code, revision_id`.
- UNIQUE `football_player_match_stats_sv_variant_generation_uq` : `match_id, player_id, period_code, variant_key, recorded_from_gen`.
- FK `football_player_match_stats_match_id_player_id_team_id_fk` : `match_id, player_id, team_id, match_player_revision_id → football.match_players(match_id, player_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_player_match_stats_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_stats_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_player_match_stats_sv_recorded_from_gen_dat_008fe7a8bd` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_match_stats_sv_recorded_to_gen_datas_6e54fb2aeb` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_match_stats_sv_relation_code_contrac_473d2bcee5` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_player_match_stats_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_player_match_stats_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_player_match_stats_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_player_match_stats_goals_nonnegative_ck` : `goals >= 0`.
- CHECK `football_player_match_stats_assists_nonnegative_ck` : `assists >= 0`.
- CHECK `football_player_match_stats_shots_nonnegative_ck` : `shots >= 0`.
- CHECK `football_player_match_stats_shots_on_target_nonnegative_ck` : `shots_on_target >= 0`.
- CHECK `football_player_match_stats_chances_created_nonnegative_ck` : `chances_created >= 0`.
- CHECK `football_player_match_stats_big_chances_created_nonnegative_ck` : `big_chances_created >= 0`.
- CHECK `football_player_match_stats_passes_completed_nonnegative_ck` : `passes_completed >= 0`.
- CHECK `football_player_match_stats_passes_attempted_nonnegative_ck` : `passes_attempted >= 0`.
- CHECK `football_player_match_stats_passes_final_third_nonnegative_ck` : `passes_final_third >= 0`.
- CHECK `football_player_match_stats_defensive_actions_nonnegative_ck` : `defensive_actions >= 0`.
- CHECK `football_player_match_stats_interceptions_nonnegative_ck` : `interceptions >= 0`.
- CHECK `football_player_match_stats_tackles_nonnegative_ck` : `tackles >= 0`.
- CHECK `football_player_match_stats_recoveries_nonnegative_ck` : `recoveries >= 0`.
- CHECK `football_player_match_stats_duels_won_nonnegative_ck` : `duels_won >= 0`.
- CHECK `football_player_match_stats_duels_lost_nonnegative_ck` : `duels_lost >= 0`.
- CHECK `football_player_match_stats_aerial_duels_won_nonnegative_ck` : `aerial_duels_won >= 0`.
- CHECK `football_player_match_stats_aerial_duels_attempted_no_a9e59e21f` : `aerial_duels_attempted >= 0`.
- CHECK `football_player_match_stats_touches_nonnegative_ck` : `touches >= 0`.
- CHECK `football_player_match_stats_touches_box_nonnegative_ck` : `touches_box >= 0`.
- CHECK `football_player_match_stats_clearances_nonnegative_ck` : `clearances >= 0`.
- CHECK `football_player_match_stats_blocks_nonnegative_ck` : `blocks >= 0`.
- CHECK `football_player_match_stats_dribbles_completed_nonnegative_ck` : `dribbles_completed >= 0`.
- CHECK `football_player_match_stats_dribbles_attempted_nonnegative_ck` : `dribbles_attempted >= 0`.
- CHECK `football_player_match_stats_saves_nonnegative_ck` : `saves >= 0`.
- CHECK `football_player_match_stats_xg_nonnegative_ck` : `xg >= 0`.
- CHECK `football_player_match_stats_non_penalty_xg_nonnegative_ck` : `non_penalty_xg >= 0`.
- CHECK `football_player_match_stats_xa_nonnegative_ck` : `xa >= 0`.
- CHECK `football_player_match_stats_xgot_nonnegative_ck` : `xgot >= 0`.
- CHECK `football_player_match_stats_minutes_played_nonnegative_ck` : `minutes_played >= 0`.
- CHECK `football_player_match_stats_passes_completed_bounded_ck` : `passes_completed <= passes_attempted`.
- CHECK `football_player_match_stats_aerial_duels_won_bounded_ck` : `aerial_duels_won <= aerial_duels_attempted`.
- CHECK `football_player_match_stats_dribbles_completed_bounded_ck` : `dribbles_completed <= dribbles_attempted`.
- CHECK `football_player_match_stats_xg_finite_ck` : `xg NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)`.
- CHECK `football_player_match_stats_non_penalty_xg_finite_ck` : `non_penalty_xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_stats_xa_finite_ck` : `xa NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_stats_xgot_finite_ck` : `xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_stats_minutes_played_finite_ck` : `minutes_played NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_stats_provider_rating_finite_ck` : `provider_rating NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_stats_goals_prevented_finite_ck` : `goals_prevented NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_player_match_stats_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_player_match_stats_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_match_stats_sv_relation_binding_ck` : `relation_code = 'football.player_match_stats'`.
- CHECK `football_player_match_stats_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_match_stats_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_match_stats_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_player_match_stats_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_player_match_stats_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_player_match_stats_sv_period_definition_ver_701262fbd2` : `btrim(period_definition_version) <> ''`.
- INDEX `football_player_match_stats_player_id_period_code_match_id_idx` : `btree : [{"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.
- INDEX `football_player_match_stats_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_match_stats_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.

- provider_rating est la note fournisseur, jamais une note Orion.
- goals_prevented est signé.
- Aucune valeur absente ne devient zéro.
- Les dénominateurs inconnus restent NULL, même si un pourcentage arrondi est affiché.

### football.source_metric_mappings

Traduction versionnée des clés techniques fournisseur. Grain physique : un mapping immuable identifié par mapping_version, PK (source_id, family_code, raw_key, mapping_version) ; clé logique (source_id, family_code, raw_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : un mapping immuable identifié par mapping_version, PK (source_id, family_code, raw_key, mapping_version) ; clé logique (source_id, family_code, raw_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_mapping`.

Clé logique : `source_id, family_code, raw_key`.

Clé de version : `mapping_version`.

Responsabilité métier : Source × famille × clé brute × version.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `source_id` | `bigint` | non | PK/FK | Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id). |
| `family_code` | `text` | non | PK | Famille de données dont le contrat définit cette clé. |
| `raw_key` | `text` | non | PK | Clé technique native de la métrique. |
| `mapping_version` | `text` | non | PK | Version de la traduction des valeurs fournisseur. |
| `metric_code` | `text` | non | FK | Référence SQL vers football.metric_definitions(code, definition_version). |
| `parse_rule` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `period_rule` | `jsonb` | non |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `definition_notes` | `text` | oui |  | Limites et définition particulières de la correspondance. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `metric_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `source_id, family_code, raw_key, mapping_version`.

- FK `football_source_metric_mappings_source_id_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_source_metric_mappings_metric_code_fk` : `metric_code, metric_definition_version → football.metric_definitions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_source_metric_mappings_sv_recorded_from_gen_0db08775bf` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_source_metric_mappings_sv_recorded_to_gen_d_d4187ff638` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_source_metric_mappings_sv_relation_code_con_eda3974750` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_source_metric_mappings_sv_source_id_source__9bf23b59b1` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_source_metric_mappings_parse_rule_kind_ck` : `jsonb_typeof(parse_rule) = 'object'`.
- CHECK `football_source_metric_mappings_period_rule_kind_ck` : `jsonb_typeof(period_rule) = 'object'`.
- CHECK `football_source_metric_mappings_parse_rule_bounded_ck` : `octet_length(parse_rule::text)<=16384`.
- CHECK `football_source_metric_mappings_period_rule_bounded_ck` : `octet_length(period_rule::text)<=16384`.
- CHECK `football_source_metric_mappings_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_source_metric_mappings_sv_relation_binding_ck` : `relation_code = 'football.source_metric_mappings'`.
- CHECK `football_source_metric_mappings_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_source_metric_mappings_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_source_metric_mappings_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_source_metric_mappings_sv_mapping_version_nonempty_ck` : `btrim(mapping_version) <> ''`.
- CHECK `football_source_metric_mappings_sv_metric_definition_19ab5398d1` : `btrim(metric_definition_version) <> ''`.
- INDEX `football_source_metric_mappings_sv_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "family_code", "order": "ASC"}, {"column": "raw_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.

- source_id appartient ici au grain de résolution fournisseur, même pour une correspondance manuelle ; source_record_id est requis pour une provenance provider.

### football.team_match_advanced

Mesures avancées équipe; possession d’actions distincte de la possession standard. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, team_id, period_code`.

Responsabilité métier : Match × team × période.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `period_code` | `text` | non | FK | Référence SQL vers football.periods(code, definition_version). |
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
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_team_match_advanced_sv_logical_revision_uq` : `match_id, team_id, period_code, revision_id`.
- UNIQUE `football_team_match_advanced_sv_variant_generation_uq` : `match_id, team_id, period_code, variant_key, recorded_from_gen`.
- FK `football_team_match_advanced_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_match_advanced_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_advanced_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_team_match_advanced_sv_recorded_from_gen_da_650150fb65` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_match_advanced_sv_recorded_to_gen_data_271604b630` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_match_advanced_sv_relation_code_contra_7eb4d7d75a` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_advanced_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_team_match_advanced_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_team_match_advanced_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_team_match_advanced_opponent_passes_nonnegative_ck` : `opponent_passes >= 0`.
- CHECK `football_team_match_advanced_defensive_actions_nonnegative_ck` : `defensive_actions >= 0`.
- CHECK `football_team_match_advanced_high_turnovers_nonnegative_ck` : `high_turnovers >= 0`.
- CHECK `football_team_match_advanced_counterpress_regains_5s__9682520d4` : `counterpress_regains_5s >= 0`.
- CHECK `football_team_match_advanced_final_third_entries_nonnegative_ck` : `final_third_entries >= 0`.
- CHECK `football_team_match_advanced_box_entries_nonnegative_ck` : `box_entries >= 0`.
- CHECK `football_team_match_advanced_buildup_attacks_nonnegative_ck` : `buildup_attacks >= 0`.
- CHECK `football_team_match_advanced_direct_attacks_nonnegative_ck` : `direct_attacks >= 0`.
- CHECK `football_team_match_advanced_challenges_nonnegative_ck` : `challenges >= 0`.
- CHECK `football_team_match_advanced_aerials_nonnegative_ck` : `aerials >= 0`.
- CHECK `football_team_match_advanced_aerials_won_nonnegative_ck` : `aerials_won >= 0`.
- CHECK `football_team_match_advanced_ppda_nonnegative_ck` : `ppda >= 0`.
- CHECK `football_team_match_advanced_ball_recovery_time_secon_6ddd21422` : `ball_recovery_time_seconds >= 0`.
- CHECK `football_team_match_advanced_passes_per_sequence_nonnegative_ck` : `passes_per_sequence >= 0`.
- CHECK `football_team_match_advanced_sequence_time_seconds_no_7a946098e` : `sequence_time_seconds >= 0`.
- CHECK `football_team_match_advanced_direct_speed_nonnegative_ck` : `direct_speed >= 0`.
- CHECK `football_team_match_advanced_possession_pct_ck` : `possession_pct BETWEEN 0 AND 100`.
- CHECK `football_team_match_advanced_field_tilt_ck` : `field_tilt BETWEEN 0 AND 100`.
- CHECK `football_team_match_advanced_aerials_bounded_ck` : `aerials_won <= aerials`.
- CHECK `football_team_match_advanced_xt_total_finite_ck` : `xt_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_vaep_total_finite_ck` : `vaep_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_vaep_offensive_finite_ck` : `vaep_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_vaep_defensive_finite_ck` : `vaep_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_pv_total_finite_ck` : `pv_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_pv_offensive_finite_ck` : `pv_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_pv_defensive_finite_ck` : `pv_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_ppda_finite_ck` : `ppda NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_field_tilt_finite_ck` : `field_tilt NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_possession_pct_finite_ck` : `possession_pct NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_avg_action_x_finite_ck` : `avg_action_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_avg_defensive_action_x_finite_ck` : `avg_defensive_action_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_ball_recovery_time_seco_3df4f4665d` : `ball_recovery_time_seconds NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_passes_per_sequence_finite_ck` : `passes_per_sequence NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_sequence_time_seconds_finite_ck` : `sequence_time_seconds NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_direct_speed_finite_ck` : `direct_speed NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_advanced_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_team_match_advanced_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_match_advanced_sv_relation_binding_ck` : `relation_code = 'football.team_match_advanced'`.
- CHECK `football_team_match_advanced_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_match_advanced_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_match_advanced_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_match_advanced_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_match_advanced_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_team_match_advanced_sv_period_definition_ve_99c1b03313` : `btrim(period_definition_version) <> ''`.
- INDEX `football_team_match_advanced_team_id_period_code_match_id_idx` : `btree : [{"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.
- INDEX `football_team_match_advanced_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_match_advanced_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.team_match_metric_values

Observations typées de métriques enregistrées et de leur état natif, avec unité et fractions explicites ; une projection numérique commune ne remplace pas cet état. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, team_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, team_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, team_id, period_code, family_code, metric_code`.

Responsabilité métier : Match × team × période × famille standard/advanced × métrique.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Match du fait. |
| `team_id` | `bigint` | non | FK | Identité concernée. |
| `period_code` | `text` | non | FK | Période explicitement définie. |
| `family_code` | `text` | non |  | standard ou advanced. |
| `metric_code` | `text` | non | FK | Métrique enregistrée et définie ; aucune clé arbitraire. |
| `value_kind` | `text` | non |  | number, string, boolean, null ou absent. null/absent n’ont ni scalaire primaire, ni fraction, ni affichage source. Une ligne absente signifie une observation inconnue ; absent exige un champ attendu et une couverture acceptée prouvés. |
| `numeric_value` | `numeric` | oui |  | Valeur numérique exacte de cette métrique. |
| `text_value` | `text` | oui |  | Valeur textuelle si le contrat de métrique l’autorise. |
| `boolean_value` | `boolean` | oui |  | Valeur booléenne si définie comme telle. |
| `numerator` | `numeric` | oui |  | Numérateur fourni, sans le déduire d’un taux arrondi. |
| `denominator` | `numeric` | oui |  | Dénominateur observé. |
| `source_display` | `text` | oui |  | Forme affichée native d’un scalaire, par exemple 12/15 ou 75%. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `metric_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_team_match_metric_values_sv_logical_revision_uq` : `match_id, team_id, period_code, family_code, metric_code, revision_id`.
- UNIQUE `football_team_match_metric_values_sv_variant_generation_uq` : `match_id, team_id, period_code, family_code, metric_code, variant_key, recorded_from_gen`.
- FK `football_team_match_metric_values_metric_code_fk` : `metric_code, metric_definition_version → football.metric_definitions(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_sv_recorded_from_g_7f58f148a9` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_sv_recorded_to_gen_111c92d7bd` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_sv_relation_code_c_63d6e251b9` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_team_match_metric_values_sv_source_id_sourc_f2c511c7e6` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_team_match_metric_values_one_value_ck` : `(value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0) OR (value_kind IN ('number','string','boolean') AND num_nonnulls(numeric_value,text_value,boolean_value)=1)`.
- CHECK `football_team_match_metric_values_family_ck` : `family_code IN ('standard','advanced')`.
- CHECK `football_team_match_metric_values_value_kind_ck` : `(value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL) OR (value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0)`.
- CHECK `football_team_match_metric_values_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_match_metric_values_sv_relation_binding_ck` : `relation_code = 'football.team_match_metric_values'`.
- CHECK `football_team_match_metric_values_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_match_metric_values_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_match_metric_values_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_match_metric_values_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_match_metric_values_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_team_match_metric_values_sv_metric_definiti_92713fe7e1` : `btrim(metric_definition_version) <> ''`.
- CHECK `football_team_match_metric_values_sv_period_definiti_ffba81504a` : `btrim(period_definition_version) <> ''`.
- INDEX `football_team_match_metric_values_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "family_code", "order": "ASC"}, {"column": "metric_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_match_metric_values_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "family_code", "order": "ASC"}, {"column": "metric_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.team_match_stats

Statistiques d’équipe par période selon la définition standard. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `match_id, team_id, period_code`.

Responsabilité métier : Match × team × période.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `period_code` | `text` | non | FK | Référence SQL vers football.periods(code, definition_version). |
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
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_team_match_stats_sv_logical_revision_uq` : `match_id, team_id, period_code, revision_id`.
- UNIQUE `football_team_match_stats_sv_variant_generation_uq` : `match_id, team_id, period_code, variant_key, recorded_from_gen`.
- FK `football_team_match_stats_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_match_stats_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_stats_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_team_match_stats_sv_recorded_from_gen_datas_dfd03c0275` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_match_stats_sv_recorded_to_gen_dataset_6693cb4260` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_match_stats_sv_relation_code_contract__e5eb997f61` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_match_stats_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_team_match_stats_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_team_match_stats_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_team_match_stats_shots_nonnegative_ck` : `shots >= 0`.
- CHECK `football_team_match_stats_shots_on_target_nonnegative_ck` : `shots_on_target >= 0`.
- CHECK `football_team_match_stats_shots_off_target_nonnegative_ck` : `shots_off_target >= 0`.
- CHECK `football_team_match_stats_shots_blocked_nonnegative_ck` : `shots_blocked >= 0`.
- CHECK `football_team_match_stats_corners_nonnegative_ck` : `corners >= 0`.
- CHECK `football_team_match_stats_offsides_nonnegative_ck` : `offsides >= 0`.
- CHECK `football_team_match_stats_fouls_nonnegative_ck` : `fouls >= 0`.
- CHECK `football_team_match_stats_yellow_cards_nonnegative_ck` : `yellow_cards >= 0`.
- CHECK `football_team_match_stats_red_cards_nonnegative_ck` : `red_cards >= 0`.
- CHECK `football_team_match_stats_passes_completed_nonnegative_ck` : `passes_completed >= 0`.
- CHECK `football_team_match_stats_passes_attempted_nonnegative_ck` : `passes_attempted >= 0`.
- CHECK `football_team_match_stats_crosses_completed_nonnegative_ck` : `crosses_completed >= 0`.
- CHECK `football_team_match_stats_crosses_attempted_nonnegative_ck` : `crosses_attempted >= 0`.
- CHECK `football_team_match_stats_tackles_nonnegative_ck` : `tackles >= 0`.
- CHECK `football_team_match_stats_interceptions_nonnegative_ck` : `interceptions >= 0`.
- CHECK `football_team_match_stats_recoveries_nonnegative_ck` : `recoveries >= 0`.
- CHECK `football_team_match_stats_duels_won_nonnegative_ck` : `duels_won >= 0`.
- CHECK `football_team_match_stats_saves_nonnegative_ck` : `saves >= 0`.
- CHECK `football_team_match_stats_touches_box_nonnegative_ck` : `touches_box >= 0`.
- CHECK `football_team_match_stats_xg_nonnegative_ck` : `xg >= 0`.
- CHECK `football_team_match_stats_non_penalty_xg_nonnegative_ck` : `non_penalty_xg >= 0`.
- CHECK `football_team_match_stats_xgot_nonnegative_ck` : `xgot >= 0`.
- CHECK `football_team_match_stats_possession_pct_ck` : `possession_pct BETWEEN 0 AND 100`.
- CHECK `football_team_match_stats_passes_bounded_ck` : `passes_completed <= passes_attempted`.
- CHECK `football_team_match_stats_crosses_bounded_ck` : `crosses_completed <= crosses_attempted`.
- CHECK `football_team_match_stats_xg_finite_ck` : `xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_stats_non_penalty_xg_finite_ck` : `non_penalty_xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_stats_xgot_finite_ck` : `xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_stats_possession_pct_finite_ck` : `possession_pct NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_team_match_stats_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_team_match_stats_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_match_stats_sv_relation_binding_ck` : `relation_code = 'football.team_match_stats'`.
- CHECK `football_team_match_stats_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_match_stats_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_match_stats_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_match_stats_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_match_stats_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_team_match_stats_sv_period_definition_versi_15eda0345f` : `btrim(period_definition_version) <> ''`.
- INDEX `football_team_match_stats_team_id_period_code_match_id_idx` : `btree : [{"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "match_id", "order": "ASC"}]`.
- INDEX `football_team_match_stats_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_match_stats_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


## Tirs et analyses spatiales

### football.match_heatmap_cells

Cellules spatiales typées ; parent conserve grille, repère et disponibilité. Grain physique : un enfant (cell_ordinal) de la version parente football.match_heatmaps(id), liée par (heatmap_id) ; PK (heatmap_id, cell_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Grain physique : Ligne physique : un enfant (cell_ordinal) de la version parente football.match_heatmaps(id), liée par (heatmap_id) ; PK (heatmap_id, cell_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Classe de version : `parent_version_child`.

Clé logique : `cell_ordinal`.

Responsabilité métier : Heatmap × ordinal source de cellule.

Ancrage de version parente : `{"columns": ["heatmap_id"], "references": {"table": "football.match_heatmaps", "columns": ["id"]}, "enforced_by": ["football_match_heatmap_cells_heatmap_id_fk"]}`.

Écriture : `immutable_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `heatmap_id` | `bigint` | non | PK/FK | Carte parente. |
| `cell_ordinal` | `integer` | non | PK | Ordre natif dans cette version. |
| `column_index` | `smallint` | non |  | Colonne de grille, base zéro. |
| `row_index` | `smallint` | non |  | Ligne de grille, base zéro. |
| `action_count` | `integer` | non |  | Actions observées dans la cellule. |

PK : `heatmap_id, cell_ordinal`.

- UNIQUE `football_match_heatmap_cells_pro_grid_coordinate_uq` : `heatmap_id, column_index, row_index`.
- FK `football_match_heatmap_cells_heatmap_id_fk` : `heatmap_id → football.match_heatmaps(id) ; ON DELETE RESTRICT`.
- CHECK `football_match_heatmap_cells_bounds_ck` : `cell_ordinal>=0 AND column_index>=0 AND row_index>=0 AND action_count>=0`.

- Contrôle intertable de dimensions et unicité des coordonnées dans une famille publiée ; un conflit source reste une anomalie, pas une suppression silencieuse.
- heatmap_id identifie la grille parente retenue exacte. Les bornes supérieures et cells_state se contrôlent séparément sous verrou parent, sur les mutations des cellules comme des dimensions ; aucun CHECK local ne lit une autre table.

### football.match_heatmaps

Cartes spatiales typées : grille et repère ici, cellules dans football.match_heatmap_cells. Grain physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, player_id, period_code, map_kind), variante variant_key ; sélection canonique (match_id, team_id, player_id, period_code, map_kind) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, player_id, period_code, map_kind), variante variant_key ; sélection canonique (match_id, team_id, player_id, period_code, map_kind) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `immutable_family_parent`.

Clé logique : `match_id, team_id, player_id, period_code, map_kind`.

Responsabilité métier : Match × équipe × joueur facultatif × période × type de carte.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id). |
| `period_code` | `text` | non | FK | Référence SQL vers football.periods(code, definition_version). |
| `map_kind` | `text` | non |  | Nature de la carte spatiale. |
| `grid_columns` | `smallint` | non |  | Nombre de colonnes de la grille spatiale. |
| `grid_rows` | `smallint` | non |  | Nombre de lignes de la grille spatiale. |
| `cell_length_m` | `double precision` | non |  | Longueur en mètres d’une cellule. |
| `cell_width_m` | `double precision` | non |  | Largeur en mètres d’une cellule. |
| `coordinate_frame` | `text` | non |  | Repère spatial déclaré par la source, propre à cette famille. |
| `actions` | `integer` | oui |  | Nombre d’actions couvertes, si renseigné. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `cells_state` | `text` | non |  | absent, null, empty ou available ; aucun tableau vide interprété comme une grille de zéros. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_match_heatmaps_sv_natural_0_generation_uq` : `match_id, team_id, player_id, period_code, map_kind, variant_key, recorded_from_gen ; NULLS NOT DISTINCT`.
- FK `football_match_heatmaps_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_sv_recorded_from_gen_dataset_89eff967ec` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_sv_relation_code_contract_ve_7fc0dfc1e1` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_match_heatmaps_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_match_heatmaps_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_heatmaps_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_heatmaps_grid_positive_ck` : `grid_columns > 0 AND grid_rows > 0 AND cell_length_m > 0 AND cell_width_m > 0`.
- CHECK `football_match_heatmaps_actions_nonnegative_ck` : `actions >= 0`.
- CHECK `football_match_heatmaps_cells_state_ck` : `cells_state IN ('absent','null','empty','available')`.
- CHECK `football_match_heatmaps_cell_length_m_finite_ck` : `cell_length_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_match_heatmaps_cell_width_m_finite_ck` : `cell_width_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_match_heatmaps_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_heatmaps_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_match_heatmaps_sv_relation_binding_ck` : `relation_code = 'football.match_heatmaps'`.
- CHECK `football_match_heatmaps_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_match_heatmaps_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_match_heatmaps_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_match_heatmaps_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_match_heatmaps_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_match_heatmaps_sv_period_definition_version_6a320558cc` : `btrim(period_definition_version) <> ''`.
- INDEX `football_match_heatmaps_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "map_kind", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_heatmaps_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "map_kind", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_match_heatmaps_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "map_kind", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_match_heatmaps_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "player_id", "order": "ASC"}, {"column": "period_code", "order": "ASC"}, {"column": "map_kind", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.match_momentum

Séries de momentum observées; un tableau vide ne crée pas des zéros. Grain physique : un enfant (series_code, sample_index) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, series_code, sample_index). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Grain physique : Ligne physique : un enfant (series_code, sample_index) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, series_code, sample_index). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Classe de version : `parent_version_child`.

Clé logique : `series_code, sample_index`.

Responsabilité métier : Match × série × index de point.

Ancrage de version parente : `{"columns": ["match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"], "references": {"table": "ingest.match_coverage", "columns": ["match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"]}, "enforced_by": ["football_match_momentum_sv_match_id_source_id_featur_94bc9ad5bd"]}`.

Écriture : `immutable_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id, revision_id); ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen). |
| `series_code` | `text` | non | PK | Série de momentum concernée, conservée distinctement des autres séries. |
| `sample_index` | `integer` | non | PK | Index du point dans l’ordre natif de la série de momentum. |
| `minute` | `double precision` | oui |  | Minute source dans la période indiquée ; précision conservée. |
| `period_code` | `text` | oui | FK | Référence SQL vers football.periods(code, definition_version). |
| `value` | `double precision` | non |  | Valeur fournie dans le grain et l’unité définis par la table. |
| `source_id` | `bigint` | non | PK/FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `feature_code` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `variant_key` | `text` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | PK/FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `match_id, source_id, feature_code, variant_key, recorded_from_gen, series_code, sample_index`.

- FK `football_match_momentum_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_match_momentum_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_match_momentum_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_match_momentum_sv_match_id_source_id_featur_94bc9ad5bd` : `match_id, source_id, feature_code, variant_key, recorded_from_gen → ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen) ; ON DELETE RESTRICT`.
- CHECK `football_match_momentum_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_match_momentum_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_match_momentum_sample_index_nonnegative_ck` : `sample_index >= 0`.
- CHECK `football_match_momentum_minute_nonnegative_ck` : `minute >= 0`.
- CHECK `football_match_momentum_minute_finite_ck` : `minute NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_match_momentum_value_finite_ck` : `value NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_match_momentum_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_match_momentum_sv_collection_family_ck` : `feature_code = 'momentum'`.
- CHECK `football_match_momentum_sv_period_definition_version_pair_ck` : `(period_code IS NULL) = (period_definition_version IS NULL)`.
- CHECK `football_match_momentum_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_match_momentum_sv_period_definition_version_1ddca542c9` : `period_definition_version IS NULL OR (btrim(period_definition_version) <> '')`.


### football.pass_network_edges

Passes dirigées entre deux nœuds du même réseau. Grain physique : un enfant (from_player_id, to_player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, from_player_id, to_player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Grain physique : Ligne physique : un enfant (from_player_id, to_player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, from_player_id, to_player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Classe de version : `parent_version_child`.

Clé logique : `from_player_id, to_player_id`.

Responsabilité métier : Réseau × passeur × receveur.

Ancrage de version parente : `{"columns": ["network_id"], "references": {"table": "football.pass_networks", "columns": ["id"]}, "via": "football.pass_network_nodes", "enforced_by": ["football_pass_network_edges_network_id_from_player_id_fk", "football_pass_network_edges_network_id_to_player_id_fk", "football_pass_network_nodes_network_id_fk"]}`.

Écriture : `immutable_with_parent` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `network_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_network_nodes(network_id, player_id); football.pass_network_nodes(network_id, player_id). |
| `from_player_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_network_nodes(network_id, player_id). |
| `to_player_id` | `bigint` | non | PK/FK | Référence SQL vers football.pass_network_nodes(network_id, player_id). |
| `passes` | `integer` | non |  | Passes observées pour le nœud, l’arête ou le périmètre de cette table. |

PK : `network_id, from_player_id, to_player_id`.

- FK `football_pass_network_edges_network_id_from_player_id_fk` : `network_id, from_player_id → football.pass_network_nodes(network_id, player_id) ; ON DELETE CASCADE`.
- FK `football_pass_network_edges_network_id_to_player_id_fk` : `network_id, to_player_id → football.pass_network_nodes(network_id, player_id) ; ON DELETE CASCADE`.
- CHECK `football_pass_network_edges_different_players_ck` : `from_player_id <> to_player_id`.
- CHECK `football_pass_network_edges_passes_positive_ck` : `passes > 0`.


### football.pass_network_nodes

Joueurs présents dans un réseau. Grain physique : un enfant (player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Grain physique : Ligne physique : un enfant (player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.

Classe de version : `parent_version_child`.

Clé logique : `player_id`.

Responsabilité métier : Réseau × joueur.

Ancrage de version parente : `{"columns": ["network_id"], "references": {"table": "football.pass_networks", "columns": ["id"]}, "enforced_by": ["football_pass_network_nodes_network_id_fk"]}`.

Écriture : `immutable_with_parent` ; phase : `enrichment`.

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

PK : `network_id, player_id`.

- FK `football_pass_network_nodes_network_id_fk` : `network_id → football.pass_networks(id) ; ON DELETE CASCADE`.
- FK `football_pass_network_nodes_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `football_pass_network_nodes_passes_nonnegative_ck` : `passes >= 0`.
- CHECK `football_pass_network_nodes_passes_received_nonnegative_ck` : `passes_received >= 0`.
- CHECK `football_pass_network_nodes_degree_nonnegative_ck` : `degree >= 0`.
- CHECK `football_pass_network_nodes_strength_nonnegative_ck` : `strength >= 0`.
- CHECK `football_pass_network_nodes_betweenness_nonnegative_ck` : `betweenness >= 0`.
- CHECK `football_pass_network_nodes_clustering_nonnegative_ck` : `clustering >= 0`.
- CHECK `football_pass_network_nodes_avg_x_finite_ck` : `avg_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_pass_network_nodes_avg_y_finite_ck` : `avg_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_pass_network_nodes_strength_finite_ck` : `strength NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_pass_network_nodes_betweenness_finite_ck` : `betweenness NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_pass_network_nodes_clustering_finite_ck` : `clustering NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.


### football.pass_networks

Réseaux de passes pour une fenêtre explicitement conservée. Grain physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, window_kind, from_seconds, until_seconds), variante variant_key ; sélection canonique (match_id, team_id, window_kind, from_seconds, until_seconds) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, window_kind, from_seconds, until_seconds), variante variant_key ; sélection canonique (match_id, team_id, window_kind, from_seconds, until_seconds) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `immutable_family_parent`.

Clé logique : `match_id, team_id, window_kind, from_seconds, until_seconds`.

Responsabilité métier : Match × équipe × fenêtre.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `window_kind` | `text` | non |  | Contrat de la fenêtre temporelle du réseau. |
| `from_seconds` | `integer` | oui |  | Début connu de la fenêtre du réseau, en secondes de match. |
| `until_seconds` | `integer` | oui |  | Fin de la fenêtre ; first_substitution ne décrit pas tout le match. |
| `centralization` | `double precision` | oui |  | Centralisation collective fournie pour cette fenêtre. |
| `coordinate_frame` | `text` | oui |  | Repère spatial déclaré par la source, propre à cette famille. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_pass_networks_sv_natural_0_generation_uq` : `match_id, team_id, window_kind, from_seconds, until_seconds, variant_key, recorded_from_gen ; NULLS NOT DISTINCT`.
- FK `football_pass_networks_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_pass_networks_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_pass_networks_sv_recorded_from_gen_dataset__d3576cc8ac` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_pass_networks_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_pass_networks_sv_relation_code_contract_ver_af45a6b5ad` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_pass_networks_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_pass_networks_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_pass_networks_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_pass_networks_from_seconds_nonnegative_ck` : `from_seconds >= 0`.
- CHECK `football_pass_networks_until_seconds_nonnegative_ck` : `until_seconds >= 0`.
- CHECK `football_pass_networks_until_seconds_after_from_seconds_ck` : `until_seconds >= from_seconds`.
- CHECK `football_pass_networks_centralization_finite_ck` : `centralization NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_pass_networks_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_pass_networks_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_pass_networks_sv_relation_binding_ck` : `relation_code = 'football.pass_networks'`.
- CHECK `football_pass_networks_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_pass_networks_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_pass_networks_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_pass_networks_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_pass_networks_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_pass_networks_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "window_kind", "order": "ASC"}, {"column": "from_seconds", "order": "ASC"}, {"column": "until_seconds", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_pass_networks_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "window_kind", "order": "ASC"}, {"column": "from_seconds", "order": "ASC"}, {"column": "until_seconds", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_pass_networks_sv_variant_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "window_kind", "order": "ASC"}, {"column": "from_seconds", "order": "ASC"}, {"column": "until_seconds", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_pass_networks_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "match_id", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "window_kind", "order": "ASC"}, {"column": "from_seconds", "order": "ASC"}, {"column": "until_seconds", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.shots

Tirs canoniques; l’identifiant externe est limité au match. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un tir de la famille canonique du match.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `match_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.match_teams(match_id, team_id, revision_id). |
| `player_id` | `bigint` | oui | FK | Référence SQL vers football.players(id); football.player_profile_versions(id, player_id). |
| `external_shot_id` | `text` | non |  | Identifiant de tir limité à son match et sa source. |
| `period_code` | `text` | oui | FK | Référence SQL vers football.periods(code, definition_version). |
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
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
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
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `match_team_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `period_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_shots_sv_natural_0_generation_uq` : `source_id, match_id, external_shot_id, variant_key, recorded_from_gen`.
- UNIQUE `football_shots_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_shots_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_shots_match_id_team_id_fk` : `match_id, team_id, match_team_revision_id → football.match_teams(match_id, team_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_shots_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_shots_period_code_fk` : `period_code, period_definition_version → football.periods(code, definition_version) ; ON DELETE RESTRICT`.
- FK `football_shots_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_shots_keeper_id_fk` : `keeper_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_shots_player_profile_version_id_player_id_fk` : `player_profile_version_id, player_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `football_shots_keeper_profile_version_id_keeper_id_fk` : `keeper_profile_version_id, keeper_id → football.player_profile_versions(id, player_id) ; ON DELETE RESTRICT`.
- FK `football_shots_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_shots_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_shots_sv_relation_code_contract_version_rel_0b9184316b` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_shots_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_shots_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_shots_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_shots_minute_nonnegative_ck` : `minute >= 0`.
- CHECK `football_shots_minute_added_nonnegative_ck` : `minute_added >= 0`.
- CHECK `football_shots_xg_ck` : `xg BETWEEN 0 AND 1`.
- CHECK `football_shots_xgot_ck` : `xgot BETWEEN 0 AND 1`.
- CHECK `football_shots_coordinate_frame_ck` : `(x_m IS NULL AND y_m IS NULL AND goal_crossed_y IS NULL AND goal_crossed_z IS NULL) OR coordinate_frame IS NOT NULL`.
- CHECK `football_shots_pitch_length_ck` : `pitch_length_m > 0`.
- CHECK `football_shots_pitch_width_ck` : `pitch_width_m > 0`.
- CHECK `football_shots_blocked_frame_ck` : `(blocked_x IS NULL AND blocked_y IS NULL) OR coordinate_frame IS NOT NULL`.
- CHECK `football_shots_x_m_finite_ck` : `x_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_y_m_finite_ck` : `y_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_pitch_length_m_finite_ck` : `pitch_length_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_pitch_width_m_finite_ck` : `pitch_width_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_xg_finite_ck` : `xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_xgot_finite_ck` : `xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_goal_crossed_y_finite_ck` : `goal_crossed_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_goal_crossed_z_finite_ck` : `goal_crossed_z NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_blocked_x_finite_ck` : `blocked_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_blocked_y_finite_ck` : `blocked_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)`.
- CHECK `football_shots_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_shots_pro_player_profile_version_id_identity_ck` : `player_profile_version_id IS NULL OR player_id IS NOT NULL`.
- CHECK `football_shots_pro_keeper_profile_version_id_identity_ck` : `keeper_profile_version_id IS NULL OR keeper_id IS NOT NULL`.
- CHECK `football_shots_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_shots_sv_relation_binding_ck` : `relation_code = 'football.shots'`.
- CHECK `football_shots_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_shots_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_shots_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_shots_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_shots_sv_period_definition_version_pair_ck` : `(period_code IS NULL) = (period_definition_version IS NULL)`.
- CHECK `football_shots_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- CHECK `football_shots_sv_period_definition_version_nonempty_ck` : `period_definition_version IS NULL OR (btrim(period_definition_version) <> '')`.
- INDEX `football_shots_match_id_idx` : `btree : [{"column": "match_id", "order": "ASC"}]`.
- INDEX `football_shots_player_id_match_id_idx` : `btree : [{"column": "player_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}] WHERE player_id IS NOT NULL`.
- INDEX `football_shots_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}, {"column": "external_shot_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_shots_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "source_id", "order": "ASC"}, {"column": "match_id", "order": "ASC"}, {"column": "external_shot_id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_shots_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_shots_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


## Classements

### football.association_ranking_components

Contributions annuelles du classement lorsque la source les fournit.

Grain physique : Instantané × association × période de contribution.

Classe de version : `existing_append_only`.

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

PK : `snapshot_id, association_id, component_period`.

- FK `football_association_ranking_components_snapshot_id_a_4f9cdbb37` : `snapshot_id, association_id → football.association_ranking_entries(snapshot_id, association_id) ; ON DELETE RESTRICT`.
- CHECK `football_association_ranking_components_rank_positive_ck` : `component_rank > 0`.


### football.association_ranking_entries

Entrées typées des classements d’autorité.

Grain physique : Instantané × association.

Classe de version : `existing_append_only`.

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

PK : `snapshot_id, association_id`.

- FK `football_association_ranking_entries_snapshot_id_subj_203386287` : `snapshot_id, subject_kind → football.ranking_snapshots(id, subject_kind) ; ON DELETE RESTRICT`.
- FK `football_association_ranking_entries_association_id_fk` : `association_id → football.associations(id) ; ON DELETE RESTRICT`.
- FK `football_association_ranking_entries_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- CHECK `football_association_ranking_entries_subject_kind_ck` : `subject_kind = 'association'`.
- CHECK `football_association_ranking_entries_rank_positive_ck` : `rank > 0`.
- CHECK `football_association_ranking_entries_previous_rank_positive_ck` : `previous_rank > 0`.


### football.ranking_snapshots

Éditions et révisions de classements externes avec leurs différentes dates.

Grain physique : Système × édition × révision.

Classe de version : `existing_append_only`.

Clé logique : `system_id, edition_key`.

Clé de version : `revision`.

Sélection historique : `latest revision per system_id, edition_key with recorded_from_gen <= g`.

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
| `revision` | `integer` | non |  | Révision interne retenue de l’édition du système, couvrant corrections fournisseur, parseur et mapping ; strictement croissante avec sa génération, jamais limitée au numéro du fournisseur. |
| `source_document_id` | `bigint` | non | FK | Référence SQL vers ingest.source_documents(id). |
| `quality_flags` | `jsonb` | non |  | Codes de qualité et booléens enregistrés ; aucun fait sportif ou document complet. |
| `base_season_year` | `integer` | oui |  | Année de référence native base_season_year, distincte des dates de publication et récupération. |
| `target_season_year` | `integer` | oui |  | Année de référence native target_season_year, distincte des dates de publication et récupération. |
| `recorded_from_gen` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_ranking_snapshots_system_id_edition_key_revision_uq` : `system_id, edition_key, revision`.
- UNIQUE `football_ranking_snapshots_id_subject_kind_uq` : `id, subject_kind`.
- FK `football_ranking_snapshots_system_id_subject_kind_fk` : `system_id, subject_kind → football.ranking_systems(id, subject_kind) ; ON DELETE RESTRICT`.
- FK `football_ranking_snapshots_source_document_id_fk` : `source_document_id → ingest.source_documents(id) ; ON DELETE RESTRICT`.
- FK `football_ranking_snapshots_sv_recorded_from_gen_data_56271677bf` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- CHECK `football_ranking_snapshots_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_ranking_snapshots_revision_positive_ck` : `revision > 0`.
- CHECK `football_ranking_snapshots_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- INDEX `football_ranking_snapshots_system_id_published_at_id_idx` : `btree : [{"column": "system_id", "order": "ASC"}, {"column": "published_at", "order": "DESC", "nulls": "LAST"}, {"column": "id", "order": "DESC"}]`.

- Le libellé historique ne garantit pas une disponibilité à cette date.
- Le contrôle temporel du scoring doit suivre une politique explicite, pas COALESCE de dates de sens différents.

### football.ranking_systems

Classements externes FIFA, UEFA et leurs définitions.

Grain physique : Un système et sa version de méthode.

Classe de version : `existing_append_only`.

Clé logique : `code, methodology_version`.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Code stable du référentiel, avec sa définition explicite. |
| `authority` | `text` | non |  | Organisme qui publie ce classement, par exemple FIFA ou UEFA. |
| `subject_kind` | `text` | non |  | Type d’entité classée ou agrégée ; les fédérations restent distinctes des équipes. |
| `gender` | `text` | non |  | Catégorie sportive déclarée : men, women, mixed ou unknown. |
| `methodology_version` | `text` | non |  | Version immuable de méthode ; une nouvelle méthode conserve un nouvel id de système sous le même code. |
| `recorded_from_gen` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_ranking_systems_code_methodology_version_uq` : `code, methodology_version`.
- UNIQUE `football_ranking_systems_id_subject_kind_uq` : `id, subject_kind`.
- FK `football_ranking_systems_sv_recorded_from_gen_datase_2eaa049988` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- CHECK `football_ranking_systems_subject_kind_ck` : `subject_kind IN ('team', 'association')`.
- CHECK `football_ranking_systems_gender_ck` : `gender IN ('men', 'women', 'mixed', 'unknown')`.
- CHECK `football_ranking_systems_sv_methodology_version_nonempty_ck` : `btrim(methodology_version) <> ''`.


### football.standing_rows

Lignes des classements de championnat publiés.

Grain physique : Instantané × équipe.

Classe de version : `existing_append_only`.

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

PK : `snapshot_id, team_id`.

- FK `football_standing_rows_snapshot_id_fk` : `snapshot_id → football.standing_snapshots(id) ; ON DELETE RESTRICT`.
- FK `football_standing_rows_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `football_standing_rows_played_nonnegative_ck` : `played >= 0`.
- CHECK `football_standing_rows_wins_nonnegative_ck` : `wins >= 0`.
- CHECK `football_standing_rows_draws_nonnegative_ck` : `draws >= 0`.
- CHECK `football_standing_rows_losses_nonnegative_ck` : `losses >= 0`.
- CHECK `football_standing_rows_goals_for_nonnegative_ck` : `goals_for >= 0`.
- CHECK `football_standing_rows_goals_against_nonnegative_ck` : `goals_against >= 0`.
- CHECK `football_standing_rows_rank_positive_ck` : `rank > 0`.

- Les points peuvent inclure sanctions et bonus; ne pas imposer points = 3 × victoires + nuls.

### football.standing_snapshots

Classements de championnat observés, datés et rattachés à une édition.

Grain physique : Une révision interne de normalisation d’un tableau source/contextuel ; nouvel id physique et nouvelles lignes enfants pour chaque correction retenue.

Classe de version : `existing_append_only`.

Clé logique : `source_record_id, competition_season_id, stage_id, group_id, group_label, scope`.

Clé de version : `data_revision`.

Sélection historique : `latest data_revision per source context with recorded_from_gen <= g`.

Écriture : `append_only` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id, revision_id); football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id). |
| `stage_id` | `bigint` | oui | FK | Référence SQL vers football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id). |
| `group_id` | `bigint` | oui | FK | Référence SQL vers football.competition_groups(id, stage_id, competition_season_id, revision_id). |
| `group_label` | `text` | oui |  | Libellé historique du groupe si aucune identité de groupe n’est encore résolue. |
| `scope` | `text` | non |  | Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent. |
| `effective_at` | `timestamptz` | oui |  | Instant d’effet connu de ce tableau de classement. |
| `observed_at` | `timestamptz` | non |  | Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | non | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | non | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision interne de normalisation du tableau complet, couvrant corrections fournisseur, parseur et mapping ; strictement croissante avec sa génération. Un réimport identique réutilise la révision existante. |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `recorded_from_gen` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_season_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `stage_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `group_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `football_standing_snapshots_sv_normalization_revision_uq` : `source_record_id, competition_season_id, stage_id, group_id, group_label, scope, data_revision ; NULLS NOT DISTINCT`.
- FK `football_standing_snapshots_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_standing_snapshots_stage_id_competition_season_id_fk` : `stage_id, competition_season_id, stage_revision_id → football.competition_stages(id, competition_season_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_standing_snapshots_group_id_stage_id_competi_f64b0944f` : `group_id, stage_id, competition_season_id, group_revision_id → football.competition_groups(id, stage_id, competition_season_id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_standing_snapshots_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_standing_snapshots_sv_recorded_from_gen_dat_d648faf338` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- CHECK `football_standing_snapshots_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_standing_snapshots_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_standing_snapshots_group_requires_stage_ck` : `group_id IS NULL OR stage_id IS NOT NULL`.
- CHECK `football_standing_snapshots_scope_ck` : `scope IN ('overall', 'home', 'away')`.
- CHECK `football_standing_snapshots_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_standing_snapshots_sv_stage_revision_id_pair_ck` : `(stage_revision_id IS NULL AND (stage_id IS NULL)) OR (stage_revision_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- CHECK `football_standing_snapshots_sv_group_revision_id_pair_ck` : `(group_revision_id IS NULL AND (group_id IS NULL)) OR (group_revision_id IS NOT NULL AND group_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- INDEX `football_standing_snapshots_competition_season_id_obs_2e324ca49` : `btree : [{"column": "competition_season_id", "order": "ASC"}, {"column": "observed_at", "order": "DESC"}, {"column": "id", "order": "DESC"}]`.


### football.team_ranking_components

Contributions annuelles du classement lorsque la source les fournit.

Grain physique : Instantané × team × période de contribution.

Classe de version : `existing_append_only`.

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

PK : `snapshot_id, team_id, component_period`.

- FK `football_team_ranking_components_snapshot_id_team_id_fk` : `snapshot_id, team_id → football.team_ranking_entries(snapshot_id, team_id) ; ON DELETE RESTRICT`.
- CHECK `football_team_ranking_components_rank_positive_ck` : `component_rank > 0`.


### football.team_ranking_entries

Entrées typées des classements d’autorité.

Grain physique : Instantané × team.

Classe de version : `existing_append_only`.

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

PK : `snapshot_id, team_id`.

- FK `football_team_ranking_entries_snapshot_id_subject_kind_fk` : `snapshot_id, subject_kind → football.ranking_snapshots(id, subject_kind) ; ON DELETE RESTRICT`.
- FK `football_team_ranking_entries_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_team_ranking_entries_source_record_id_fk` : `source_record_id → ingest.source_records(id) ; ON DELETE RESTRICT`.
- CHECK `football_team_ranking_entries_subject_kind_ck` : `subject_kind = 'team'`.
- CHECK `football_team_ranking_entries_rank_positive_ck` : `rank > 0`.
- CHECK `football_team_ranking_entries_previous_rank_positive_ck` : `previous_rank > 0`.


## Entraîneurs et palmarès

### football.coaches

Identités d’entraîneurs; ne pas fusionner sur le seul nom. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Une personne entraîneur.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `display_name` | `text` | oui |  | Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif. |
| `birth_date` | `date` | oui |  | Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `image_asset_id` | `bigint` | oui | FK | Référence SQL vers ingest.media_assets(id). |
| `created_at` | `timestamptz` | non |  | Création de cette ligne dans le système. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `nationality_country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_coaches_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_coaches_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_coaches_nationality_country_id_fk` : `nationality_country_id, nationality_country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_coaches_image_asset_id_fk` : `image_asset_id → ingest.media_assets(id) ; ON DELETE RESTRICT`.
- FK `football_coaches_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_coaches_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_coaches_sv_relation_code_contract_version_r_edceb74867` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_coaches_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_coaches_sv_source_id_source_record_id_sourc_382ffbe37a` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_coaches_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_coaches_sv_relation_binding_ck` : `relation_code = 'football.coaches'`.
- CHECK `football_coaches_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_coaches_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_coaches_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_coaches_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_coaches_sv_nationality_country_revision_id_pair_ck` : `(nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)`.
- CHECK `football_coaches_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_coaches_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_coaches_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.honour_definitions

Définitions des titres collectifs et distinctions individuelles. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un titre ou prix.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `code` | `text` | non |  | Code stable du référentiel, avec sa définition explicite. |
| `name` | `text` | non |  | Nom de l’entité dans le contexte défini par cette table. |
| `honour_type` | `text` | non |  | Titre collectif ou distinction individuelle. |
| `competition_id` | `bigint` | oui | FK | Référence SQL vers football.competitions(id, revision_id). |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_honour_definitions_sv_natural_0_generation_uq` : `code, variant_key, recorded_from_gen`.
- UNIQUE `football_honour_definitions_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_honour_definitions_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_honour_definitions_competition_id_fk` : `competition_id, competition_revision_id → football.competitions(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_honour_definitions_sv_recorded_from_gen_dat_a62016d637` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_honour_definitions_sv_recorded_to_gen_datas_8160f96d22` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_honour_definitions_sv_relation_code_contrac_c3c56e95c2` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_honour_definitions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `football_honour_definitions_sv_source_id_source_reco_01b8fc3a36` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `football_honour_definitions_honour_type_ck` : `honour_type IN ('team', 'individual')`.
- CHECK `football_honour_definitions_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_honour_definitions_sv_relation_binding_ck` : `relation_code = 'football.honour_definitions'`.
- CHECK `football_honour_definitions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_honour_definitions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_honour_definitions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_honour_definitions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_honour_definitions_sv_competition_revision_id_pair_ck` : `(competition_revision_id IS NULL AND (competition_id IS NULL)) OR (competition_revision_id IS NOT NULL AND competition_id IS NOT NULL)`.
- CHECK `football_honour_definitions_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_honour_definitions_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "code", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_honour_definitions_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "code", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_honour_definitions_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_honour_definitions_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.player_honours

Distinctions attribuées avec leur contexte historique. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : player × titre × édition × résultat × équipe de contexte si applicable.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `player_id` | `bigint` | non | FK | Référence SQL vers football.players(id). |
| `honour_id` | `bigint` | non | FK | Référence SQL vers football.honour_definitions(id, revision_id). |
| `competition_season_id` | `bigint` | oui | FK | Référence SQL vers football.competition_seasons(id, revision_id). |
| `season_label` | `text` | oui |  | Libellé historique conservé lorsqu’aucune édition canonique n’est résolue. |
| `edition_key` | `text` | non |  | Clé d’édition de la distinction, conservée même sans édition de compétition résolue. |
| `outcome` | `text` | non |  | Résultat du tir selon un mapping documenté. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `team_id` | `bigint` | oui | FK | Référence SQL vers football.teams(id). |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `honour_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_season_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_player_honours_sv_natural_0_generation_uq` : `player_id, honour_id, edition_key, outcome, team_id, variant_key, recorded_from_gen ; NULLS NOT DISTINCT`.
- UNIQUE `football_player_honours_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_player_honours_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_player_honours_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `football_player_honours_honour_id_fk` : `honour_id, honour_revision_id → football.honour_definitions(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_player_honours_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_player_honours_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_player_honours_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_player_honours_sv_recorded_from_gen_dataset_211f081c26` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_honours_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_player_honours_sv_relation_code_contract_ve_b93c7eba65` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_player_honours_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_player_honours_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_player_honours_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_player_honours_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_player_honours_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_player_honours_sv_relation_binding_ck` : `relation_code = 'football.player_honours'`.
- CHECK `football_player_honours_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_player_honours_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_player_honours_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_player_honours_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_player_honours_sv_competition_season_revisi_333c5e2849` : `(competition_season_revision_id IS NULL AND (competition_season_id IS NULL)) OR (competition_season_revision_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- CHECK `football_player_honours_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_player_honours_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "player_id", "order": "ASC"}, {"column": "honour_id", "order": "ASC"}, {"column": "edition_key", "order": "ASC"}, {"column": "outcome", "order": "ASC"}, {"column": "team_id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_honours_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "player_id", "order": "ASC"}, {"column": "honour_id", "order": "ASC"}, {"column": "edition_key", "order": "ASC"}, {"column": "outcome", "order": "ASC"}, {"column": "team_id", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_player_honours_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_player_honours_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.team_coach_tenures

Périodes d’exercice des entraîneurs; séparées de l’attribution d’un match. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : Un épisode équipe/entraîneur.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `coach_id` | `bigint` | non | FK | Référence SQL vers football.coaches(id, revision_id). |
| `role` | `text` | non |  | Fonction effectivement observée de l’entraîneur durant cet épisode. |
| `valid_from` | `date` | oui |  | Début de validité connu, sans remplacer une observation par une date de signature. |
| `valid_to` | `date` | oui |  | Fin de validité connue ; NULL conserve une borne inconnue. |
| `date_precision` | `text` | non |  | Précision réelle des dates : day, month, year ou unknown. |
| `observed_at` | `timestamptz` | non |  | Instant auquel l’information a été observée ; ne prouve pas une date de validité métier. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `coach_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_team_coach_tenures_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_team_coach_tenures_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_team_coach_tenures_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_team_coach_tenures_coach_id_fk` : `coach_id, coach_revision_id → football.coaches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_coach_tenures_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_team_coach_tenures_sv_recorded_from_gen_dat_2f8a87c199` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_coach_tenures_sv_recorded_to_gen_datas_fe9cef784b` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_coach_tenures_sv_relation_code_contrac_905377f0ff` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_coach_tenures_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_team_coach_tenures_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_team_coach_tenures_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_team_coach_tenures_valid_to_after_valid_from_ck` : `valid_to >= valid_from`.
- CHECK `football_team_coach_tenures_date_precision_ck` : `date_precision IN ('day', 'month', 'year', 'unknown')`.
- CHECK `football_team_coach_tenures_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_team_coach_tenures_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_coach_tenures_sv_relation_binding_ck` : `relation_code = 'football.team_coach_tenures'`.
- CHECK `football_team_coach_tenures_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_coach_tenures_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_coach_tenures_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_coach_tenures_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_coach_tenures_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_team_coach_tenures_team_id_valid_from_idx` : `btree : [{"column": "team_id", "order": "ASC"}, {"column": "valid_from", "order": "ASC"}]`.
- INDEX `football_team_coach_tenures_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_coach_tenures_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


### football.team_honours

Distinctions attribuées avec leur contexte historique. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.

Classe de version : `inline_fact`.

Clé logique : `id`.

Responsabilité métier : team × titre × édition × résultat × équipe de contexte si applicable.

Écriture : `immutable_values_close_interval_once` ; phase : `enrichment`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non |  | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `honour_id` | `bigint` | non | FK | Référence SQL vers football.honour_definitions(id, revision_id). |
| `competition_season_id` | `bigint` | oui | FK | Référence SQL vers football.competition_seasons(id, revision_id). |
| `season_label` | `text` | oui |  | Libellé historique conservé lorsqu’aucune édition canonique n’est résolue. |
| `edition_key` | `text` | non |  | Clé d’édition de la distinction, conservée même sans édition de compétition résolue. |
| `outcome` | `text` | non |  | Résultat du tir selon un mapping documenté. |
| `source_id` | `bigint` | oui | FK | Espace fournisseur de la famille canonique retenue. |
| `source_record_id` | `bigint` | oui | FK | Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers. |
| `canonical_policy_version` | `text` | non |  | Version de la règle de sélection entre sources. |
| `data_revision` | `bigint` | non |  | Révision croissante au grain ou à la famille publié(e). |
| `quality_flags` | `jsonb` | non |  | Drapeaux de qualité; jamais un remplacement des colonnes métier. |
| `updated_at` | `timestamptz` | non |  | Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement. |
| `revision_id` | `bigint` | non | PK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `recorded_from_gen` | `bigint` | non | FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `recorded_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `variant_key` | `text` | non |  | Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse. |
| `is_canonical` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `is_deleted` | `boolean` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `honour_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `competition_season_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `revision_id`.

- UNIQUE `football_team_honours_sv_natural_0_generation_uq` : `team_id, honour_id, edition_key, outcome, variant_key, recorded_from_gen ; NULLS NOT DISTINCT`.
- UNIQUE `football_team_honours_sv_logical_revision_uq` : `id, revision_id`.
- UNIQUE `football_team_honours_sv_variant_generation_uq` : `id, variant_key, recorded_from_gen`.
- FK `football_team_honours_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `football_team_honours_honour_id_fk` : `honour_id, honour_revision_id → football.honour_definitions(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_honours_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `football_team_honours_source_id_source_record_id_fk` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- FK `football_team_honours_sv_recorded_from_gen_dataset_snapshots_fk` : `recorded_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_honours_sv_recorded_to_gen_dataset_snapshots_fk` : `recorded_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `football_team_honours_sv_relation_code_contract_vers_091bec67f8` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `football_team_honours_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- CHECK `football_team_honours_quality_flags_kind_ck` : `jsonb_typeof(quality_flags) = 'object'`.
- CHECK `football_team_honours_revision_positive_ck` : `data_revision > 0`.
- CHECK `football_team_honours_quality_flags_bounded_ck` : `octet_length(quality_flags::text)<=16384`.
- CHECK `football_team_honours_sv_interval_ck` : `recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen`.
- CHECK `football_team_honours_sv_relation_binding_ck` : `relation_code = 'football.team_honours'`.
- CHECK `football_team_honours_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `football_team_honours_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `football_team_honours_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `football_team_honours_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- CHECK `football_team_honours_sv_competition_season_revision_id_pair_ck` : `(competition_season_revision_id IS NULL AND (competition_season_id IS NULL)) OR (competition_season_revision_id IS NOT NULL AND competition_season_id IS NOT NULL)`.
- CHECK `football_team_honours_sv_variant_key_nonempty_ck` : `btrim(variant_key) <> ''`.
- INDEX `football_team_honours_sv_natural_0_variant_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "honour_id", "order": "ASC"}, {"column": "edition_key", "order": "ASC"}, {"column": "outcome", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_honours_sv_natural_0_canonical_current_idx` : `UNIQUE btree : [{"column": "team_id", "order": "ASC"}, {"column": "honour_id", "order": "ASC"}, {"column": "edition_key", "order": "ASC"}, {"column": "outcome", "order": "ASC"}] NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical`.
- INDEX `football_team_honours_sv_variant_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}, {"column": "variant_key", "order": "ASC"}] WHERE recorded_to_gen IS NULL`.
- INDEX `football_team_honours_sv_canonical_current_idx` : `UNIQUE btree : [{"column": "id", "order": "ASC"}] WHERE recorded_to_gen IS NULL AND is_canonical`.


## Lectures et publication

### analytics.aggregation_builds

Calculs cohérents d’agrégats pour une édition.

Grain physique : Une construction pour une édition.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `id` | `bigint` | non | PK | Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes. |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers football.competition_seasons(id, revision_id). |
| `dataset_snapshot_id` | `bigint` | non | FK | Référence SQL vers ingest.dataset_snapshots(id). |
| `transform_version` | `text` | non |  | Version de la transformation de données. |
| `status` | `text` | non |  | État explicite de l’objet, limité aux valeurs du CHECK de cette table. |
| `started_at` | `timestamptz` | non |  | Instant UTC « started_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `finished_at` | `timestamptz` | oui |  | Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée. |
| `metrics_contract_version` | `text` | non |  | Version des définitions et règles d’agrégation appliquées. |
| `error` | `jsonb` | oui |  | Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source. |
| `competition_season_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `catalog_snapshot_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `representation_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `code_commit` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `code_content_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `dependencies_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `environment_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `analytics_aggregation_builds_id_competition_season_id_uq` : `id, competition_season_id`.
- FK `analytics_aggregation_builds_competition_season_id_fk` : `competition_season_id, competition_season_revision_id → football.competition_seasons(id, revision_id) ; ON DELETE RESTRICT`.
- FK `analytics_aggregation_builds_dataset_snapshot_id_fk` : `dataset_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `analytics_aggregation_builds_sv_catalog_snapshot_id__f69472e772` : `catalog_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_aggregation_builds_error_kind_ck` : `jsonb_typeof(error) = 'object'`.
- CHECK `analytics_aggregation_builds_status_ck` : `status IN ('building', 'validating', 'ready', 'failed')`.
- CHECK `analytics_aggregation_builds_finished_at_after_started_at_ck` : `finished_at >= started_at`.
- CHECK `analytics_aggregation_builds_error_bounded_ck` : `octet_length(error::text)<=16384`.
- CHECK `analytics_aggregation_builds_sv_code_content_sha256_ck` : `code_content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `analytics_aggregation_builds_sv_dependencies_sha256_ck` : `dependencies_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `analytics_aggregation_builds_sv_environment_sha256_ck` : `environment_sha256 ~ '^[0-9a-f]{64}$'`.


### analytics.catalog_publication

Version publiée des identités et métadonnées communes à toutes les éditions.

Grain physique : Un pointeur global actif.

Écriture : `mutable` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `singleton` | `boolean` | non | PK | Clé singleton toujours true. |
| `catalog_snapshot_id` | `bigint` | non | FK | Instantané SQL scellé du référentiel commun. |
| `representation_version` | `text` | non |  | Version de sérialisation des métadonnées. |
| `published_at` | `timestamptz` | non |  | Activation atomique avec les éditions touchées. |

PK : `singleton`.

- FK `analytics_catalog_publication_catalog_snapshot_id_fk` : `catalog_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_catalog_publication_singleton_ck` : `singleton IS TRUE`.


### analytics.competition_summary

Vue d’ensemble d’une édition avec couverture de chaque indicateur.

Grain physique : Une ligne par construction.

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

- FK `analytics_competition_summary_build_id_competition_season_id_fk` : `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- CHECK `analytics_competition_summary_teams_count_nonnegative_ck` : `teams_count >= 0`.
- CHECK `analytics_competition_summary_matches_count_nonnegative_ck` : `matches_count >= 0`.
- CHECK `analytics_competition_summary_finished_matches_count__f06838c3d` : `finished_matches_count >= 0`.
- CHECK `analytics_competition_summary_players_count_nonnegative_ck` : `players_count >= 0`.
- CHECK `analytics_competition_summary_goals_nonnegative_ck` : `goals >= 0`.


### analytics.match_summary

Projection pour les cartes de match, obtenue depuis les faits canoniques.

Grain physique : Construction × match.

Écriture : `derived_immutable_per_build` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `build_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `competition_season_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id, revision_id). |
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
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `build_id, match_id`.

- FK `analytics_match_summary_build_id_competition_season_id_fk` : `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `analytics_match_summary_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `analytics_match_summary_home_team_id_fk` : `home_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `analytics_match_summary_away_team_id_fk` : `away_team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_match_summary_home_goals_nonnegative_ck` : `home_goals >= 0`.
- CHECK `analytics_match_summary_away_goals_nonnegative_ck` : `away_goals >= 0`.
- CHECK `analytics_match_summary_home_shootout_goals_nonnegative_ck` : `home_shootout_goals >= 0`.
- CHECK `analytics_match_summary_away_shootout_goals_nonnegative_ck` : `away_shootout_goals >= 0`.
- INDEX `analytics_match_summary_build_id_match_date_match_id_idx` : `btree : [{"column": "build_id", "order": "ASC"}, {"column": "match_date", "order": "DESC"}, {"column": "match_id", "order": "DESC"}]`.


### analytics.metric_totals

Totaux secondaires et couverture explicites d’une construction publiée.

Grain physique : Build × sujet typé × métrique.

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
| `match_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `metric_definition_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `analytics_metric_totals_subject_metric_uq` : `build_id, subject_kind, match_id, player_id, team_id, metric_code ; NULLS NOT DISTINCT`.
- FK `analytics_metric_totals_build_id_fk` : `build_id → analytics.aggregation_builds(id) ; ON DELETE RESTRICT`.
- FK `analytics_metric_totals_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `analytics_metric_totals_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `analytics_metric_totals_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- FK `analytics_metric_totals_metric_code_fk` : `metric_code, metric_definition_version → football.metric_definitions(code, definition_version) ; ON DELETE RESTRICT`.
- CHECK `analytics_metric_totals_coverage_counts_ck` : `observed_count>=0 AND eligible_count>=0 AND observed_count<=eligible_count`.
- CHECK `analytics_metric_totals_subject_kind_ck` : `subject_kind IN ('competition','match','player','player_team','team')`.
- CHECK `analytics_metric_totals_typed_subject_ck` : `(subject_kind='competition' AND num_nonnulls(match_id,player_id,team_id)=0) OR (subject_kind='match' AND match_id IS NOT NULL AND num_nonnulls(player_id,team_id)=0) OR (subject_kind='player' AND player_id IS NOT NULL AND num_nonnulls(match_id,team_id)=0) OR (subject_kind='player_team' AND match_id IS NULL AND player_id IS NOT NULL AND team_id IS NOT NULL) OR (subject_kind='team' AND team_id IS NOT NULL AND num_nonnulls(match_id,player_id)=0)`.
- CHECK `analytics_metric_totals_sv_match_revision_id_pair_ck` : `(match_revision_id IS NULL AND (match_id IS NULL)) OR (match_revision_id IS NOT NULL AND match_id IS NOT NULL)`.
- CHECK `analytics_metric_totals_sv_metric_definition_version_a91415e7f8` : `btrim(metric_definition_version) <> ''`.


### analytics.player_competition_stats

Totaux joueur calculés sur périodes compatibles et participation prouvée.

Grain physique : Construction × joueur, toutes équipes de l’édition réunies.

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

- FK `analytics_player_competition_stats_build_id_competiti_756192c31` : `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `analytics_player_competition_stats_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_player_competition_stats_appearances_nonnegative_ck` : `appearances >= 0`.
- CHECK `analytics_player_competition_stats_starts_nonnegative_ck` : `starts >= 0`.
- CHECK `analytics_player_competition_stats_minutes_played_non_0d703d372` : `minutes_played >= 0`.
- CHECK `analytics_player_competition_stats_goals_nonnegative_ck` : `goals >= 0`.
- CHECK `analytics_player_competition_stats_assists_nonnegative_ck` : `assists >= 0`.
- CHECK `analytics_player_competition_stats_shots_nonnegative_ck` : `shots >= 0`.
- CHECK `analytics_player_competition_stats_shots_on_target_no_8a2fe1f17` : `shots_on_target >= 0`.
- CHECK `analytics_player_competition_stats_passes_completed_n_715a4544c` : `passes_completed >= 0`.
- CHECK `analytics_player_competition_stats_passes_attempted_n_bff7c2584` : `passes_attempted >= 0`.
- CHECK `analytics_player_competition_stats_xg_nonnegative_ck` : `xg >= 0`.
- CHECK `analytics_player_competition_stats_xa_nonnegative_ck` : `xa >= 0`.
- CHECK `analytics_player_competition_stats_starts_bounded_ck` : `starts <= appearances`.
- INDEX `analytics_player_competition_stats_build_id_goals_player_id_idx` : `btree : [{"column": "build_id", "order": "ASC"}, {"column": "goals", "order": "DESC", "nulls": "LAST"}, {"column": "player_id", "order": "ASC"}]`.


### analytics.player_competition_team_stats

Totaux joueur calculés sur périodes compatibles et participation prouvée.

Grain physique : Construction × joueur × équipe.

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

- FK `analytics_player_competition_team_stats_build_id_comp_42efbe50b` : `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `analytics_player_competition_team_stats_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `analytics_player_competition_team_stats_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_player_competition_team_stats_appearances_n_de84478b1` : `appearances >= 0`.
- CHECK `analytics_player_competition_team_stats_starts_nonnegative_ck` : `starts >= 0`.
- CHECK `analytics_player_competition_team_stats_minutes_playe_66b5f8490` : `minutes_played >= 0`.
- CHECK `analytics_player_competition_team_stats_goals_nonnegative_ck` : `goals >= 0`.
- CHECK `analytics_player_competition_team_stats_assists_nonnegative_ck` : `assists >= 0`.
- CHECK `analytics_player_competition_team_stats_shots_nonnegative_ck` : `shots >= 0`.
- CHECK `analytics_player_competition_team_stats_shots_on_targ_cff806d10` : `shots_on_target >= 0`.
- CHECK `analytics_player_competition_team_stats_passes_comple_ca6c9abc4` : `passes_completed >= 0`.
- CHECK `analytics_player_competition_team_stats_passes_attemp_b72cf3363` : `passes_attempted >= 0`.
- CHECK `analytics_player_competition_team_stats_xg_nonnegative_ck` : `xg >= 0`.
- CHECK `analytics_player_competition_team_stats_xa_nonnegative_ck` : `xa >= 0`.
- CHECK `analytics_player_competition_team_stats_starts_bounded_ck` : `starts <= appearances`.


### analytics.player_search

Projection légère pour rechercher des joueurs.

Grain physique : Un joueur.

Écriture : `derived_replace` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `display_name` | `text` | non |  | Nom d’affichage observé ou sélectionné pour cette identité. |
| `search_text` | `text` | non |  | Texte préparé pour la recherche, issu des identités/alias retenus. |
| `search_vector` | `tsvector` | non |  | Vecteur plein texte PostgreSQL généré de search_text avec dictionnaire simple. |
| `birth_date` | `date` | oui |  | Date de naissance connue de la personne. |
| `nationality_country_id` | `bigint` | oui | FK | Référence SQL vers football.countries(id, revision_id). |
| `primary_position_code` | `text` | oui | FK | Référence SQL vers football.positions(code, definition_version). |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |
| `nationality_country_revision_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `primary_position_definition_version` | `text` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `player_id`.

- FK `analytics_player_search_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `analytics_player_search_nationality_country_id_fk` : `nationality_country_id, nationality_country_revision_id → football.countries(id, revision_id) ; ON DELETE RESTRICT`.
- FK `analytics_player_search_primary_position_code_fk` : `primary_position_code, primary_position_definition_version → football.positions(code, definition_version) ; ON DELETE RESTRICT`.
- CHECK `analytics_player_search_sv_nationality_country_revis_87adcc31c2` : `(nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)`.
- CHECK `analytics_player_search_sv_primary_position_definiti_09aa48ce7a` : `(primary_position_code IS NULL) = (primary_position_definition_version IS NULL)`.
- CHECK `analytics_player_search_sv_primary_position_definiti_8761ce7d03` : `primary_position_definition_version IS NULL OR (btrim(primary_position_definition_version) <> '')`.
- INDEX `analytics_player_search_search_vector_idx` : `gin : [{"column": "search_vector"}]`.

- Recherche de départ sans extension obligatoire. Ajouter pg_trgm seulement si la recherche approximative est réellement nécessaire.

### analytics.publication_versions

Version active de l’ensemble des agrégats d’une édition. Grain physique : un pointeur de publication daté, PK (competition_season_id, published_from_gen) ; clé logique (competition_season_id) ; intervalle de connaissance [published_from_gen, published_to_gen), fin NULL pour la version courante.

Grain physique : Ligne physique : un pointeur de publication daté, PK (competition_season_id, published_from_gen) ; clé logique (competition_season_id) ; intervalle de connaissance [published_from_gen, published_to_gen), fin NULL pour la version courante.

Classe de version : `inline_publication_pointer`.

Clé logique : `competition_season_id`.

Responsabilité métier : Une publication active par édition.

Écriture : `immutable_values_close_interval_once` ; phase : `core`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `competition_season_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `build_id` | `bigint` | non | FK | Référence SQL vers analytics.aggregation_builds(id, competition_season_id). |
| `published_at` | `timestamptz` | non |  | Publication déclarée ou activation, selon le grain de cette table. |
| `catalog_snapshot_id` | `bigint` | non | FK | Instantané scellé des seules identités et métadonnées communes utilisées par cette édition ; réutilisé si ces dépendances restent identiques. |
| `representation_version` | `text` | non |  | Version du contrat de sérialisation et du format compact. |
| `published_from_gen` | `bigint` | non | PK/FK | Première génération de connaissance, incluse ; allouée après verrou transactionnel global. |
| `published_to_gen` | `bigint` | oui | FK | Fin exclusive de connaissance ; seule fermeture unique autorisée. |
| `relation_code` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `contract_version` | `text` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `transform_code_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `source_record_id` | `bigint` | oui | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `provenance_kind` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `competition_season_id, published_from_gen`.

- FK `analytics_publication_versions_build_id_competition_s_f172d792b` : `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `analytics_publication_versions_catalog_snapshot_id_fk` : `catalog_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `analytics_publication_versions_sv_published_from_gen_cd9d4989f4` : `published_from_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `analytics_publication_versions_sv_published_to_gen_d_5a057e144b` : `published_to_gen → ingest.dataset_snapshots(generation) ; ON DELETE RESTRICT`.
- FK `analytics_publication_versions_sv_relation_code_cont_41b234f393` : `relation_code, contract_version → ingest.relation_contracts(relation_code, contract_version) ; ON DELETE RESTRICT`.
- FK `analytics_publication_versions_sv_source_id_sources_fk` : `source_id → ingest.sources(id) ; ON DELETE RESTRICT`.
- FK `analytics_publication_versions_sv_source_id_source_r_1bce13d845` : `source_id, source_record_id → ingest.source_records(source_id, id) ; ON DELETE RESTRICT`.
- CHECK `analytics_publication_versions_sv_interval_ck` : `published_to_gen IS NULL OR published_to_gen > published_from_gen`.
- CHECK `analytics_publication_versions_sv_relation_binding_ck` : `relation_code = 'analytics.publication_versions'`.
- CHECK `analytics_publication_versions_sv_code_binding_ck` : `contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `analytics_publication_versions_sv_provenance_kind_ck` : `provenance_kind IN ('provider','manual','derived')`.
- CHECK `analytics_publication_versions_sv_provider_observation_ck` : `provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)`.
- CHECK `analytics_publication_versions_sv_provenance_pair_ck` : `(source_id IS NULL) = (source_record_id IS NULL)`.
- INDEX `analytics_publication_versions_sv_publication_current_idx` : `UNIQUE btree : [{"column": "competition_season_id", "order": "ASC"}] WHERE published_to_gen IS NULL`.


### analytics.team_competition_stats

Totaux équipe calculés pour une édition.

Grain physique : Construction × équipe.

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

- FK `analytics_team_competition_stats_build_id_competition_88c4c4e60` : `build_id, competition_season_id → analytics.aggregation_builds(id, competition_season_id) ; ON DELETE RESTRICT`.
- FK `analytics_team_competition_stats_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_team_competition_stats_matches_played_nonnegative_ck` : `matches_played >= 0`.
- CHECK `analytics_team_competition_stats_wins_nonnegative_ck` : `wins >= 0`.
- CHECK `analytics_team_competition_stats_draws_nonnegative_ck` : `draws >= 0`.
- CHECK `analytics_team_competition_stats_losses_nonnegative_ck` : `losses >= 0`.
- CHECK `analytics_team_competition_stats_goals_for_nonnegative_ck` : `goals_for >= 0`.
- CHECK `analytics_team_competition_stats_goals_against_nonnegative_ck` : `goals_against >= 0`.
- CHECK `analytics_team_competition_stats_xg_for_nonnegative_ck` : `xg_for >= 0`.
- CHECK `analytics_team_competition_stats_xg_against_nonnegative_ck` : `xg_against >= 0`.

- points_calculated ne remplace pas les points d’un classement officiel avec sanctions ou règles spéciales.

## Modèles : réserve hors nouvelles formules

### analytics.feature_versions

Contrats de features reproductibles.

Grain physique : Nom × version du jeu de variables.

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

- UNIQUE `analytics_feature_versions_name_version_uq` : `name, version`.
- CHECK `analytics_feature_versions_definition_kind_ck` : `jsonb_typeof(definition) = 'object'`.
- CHECK `analytics_feature_versions_definition_bounded_ck` : `octet_length(definition::text)<=16384`.


### analytics.model_versions

Versions immuables des modèles Orion, distinctes des notes fournisseur.

Grain physique : Modèle × version.

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

- UNIQUE `analytics_model_versions_name_version_uq` : `name, version`.
- FK `analytics_model_versions_feature_version_id_fk` : `feature_version_id → analytics.feature_versions(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_model_versions_configuration_kind_ck` : `jsonb_typeof(configuration) = 'object'`.
- CHECK `analytics_model_versions_role_definition_kind_ck` : `jsonb_typeof(role_definition) = 'object'`.
- CHECK `analytics_model_versions_score_definition_kind_ck` : `jsonb_typeof(score_definition) = 'object'`.
- CHECK `analytics_model_versions_configuration_bounded_ck` : `octet_length(configuration::text)<=16384`.
- CHECK `analytics_model_versions_role_definition_bounded_ck` : `octet_length(role_definition::text)<=16384`.
- CHECK `analytics_model_versions_score_definition_bounded_ck` : `octet_length(score_definition::text)<=16384`.


### analytics.player_match_scores

Résultats immuables d’une exécution, sans écraser les scores antérieurs.

Grain physique : Exécution × match × player.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id, revision_id). |
| `player_id` | `bigint` | non | PK/FK | Référence SQL vers football.players(id). |
| `team_id` | `bigint` | non | FK | Référence SQL vers football.teams(id). |
| `score` | `double precision` | non |  | Résultat du modèle versionné ; l’échelle appartient à la définition du modèle. |
| `components` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `role_code` | `text` | oui |  | Rôle retenu pour l’évaluation, selon une définition versionnée. |
| `coverage` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `run_id, match_id, player_id`.

- FK `analytics_player_match_scores_run_id_fk` : `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `analytics_player_match_scores_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `analytics_player_match_scores_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- FK `analytics_player_match_scores_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_player_match_scores_components_kind_ck` : `jsonb_typeof(components) = 'object'`.
- CHECK `analytics_player_match_scores_coverage_kind_ck` : `jsonb_typeof(coverage) = 'object'`.
- CHECK `analytics_player_match_scores_components_bounded_ck` : `octet_length(components::text)<=16384`.
- CHECK `analytics_player_match_scores_coverage_bounded_ck` : `octet_length(coverage::text)<=16384`.

- Aucune borne universelle 0–100: l’échelle appartient à model_versions.score_definition.
- La cohérence match/joueur/équipe est validée contre le snapshot du run. Les FK visent les identités stables, pas les faits courants corrigibles; une correction ne doit pas invalider un ancien résultat reproductible.

### analytics.player_window_scores

Scores et classements de joueurs pour la fenêtre exacte du run.

Grain physique : Exécution × joueur.

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

- FK `analytics_player_window_scores_run_id_fk` : `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `analytics_player_window_scores_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_player_window_scores_components_kind_ck` : `jsonb_typeof(components) = 'object'`.
- CHECK `analytics_player_window_scores_coverage_kind_ck` : `jsonb_typeof(coverage) = 'object'`.
- CHECK `analytics_player_window_scores_rank_positive_ck` : `rank > 0`.
- CHECK `analytics_player_window_scores_appearances_eligible_n_fd2538720` : `appearances_eligible >= 0`.
- CHECK `analytics_player_window_scores_minutes_eligible_nonnegative_ck` : `minutes_eligible >= 0`.
- CHECK `analytics_player_window_scores_components_bounded_ck` : `octet_length(components::text)<=16384`.
- CHECK `analytics_player_window_scores_coverage_bounded_ck` : `octet_length(coverage::text)<=16384`.
- INDEX `analytics_player_window_scores_run_id_score_player_id_idx` : `btree : [{"column": "run_id", "order": "ASC"}, {"column": "score", "order": "DESC"}, {"column": "player_id", "order": "ASC"}]`.


### analytics.published_score_runs

Pointeur vers une exécution validée pour un produit et un périmètre.

Grain physique : Produit × périmètre.

Écriture : `mutable` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `product_key` | `text` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id, product_key, scope_key). |
| `scope_key` | `text` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id, product_key, scope_key). |
| `run_id` | `bigint` | non | FK | Référence SQL vers analytics.scoring_runs(id, product_key, scope_key). |
| `published_at` | `timestamptz` | non |  | Publication déclarée ou activation, selon le grain de cette table. |

PK : `product_key, scope_key`.

- FK `analytics_published_score_runs_run_id_product_key_scope_key_fk` : `run_id, product_key, scope_key → analytics.scoring_runs(id, product_key, scope_key) ; ON DELETE RESTRICT`.


### analytics.scoring_run_ranking_inputs

Éditions de classements externes effectivement utilisées par un calcul.

Grain physique : Exécution × instantané de classement.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `ranking_snapshot_id` | `bigint` | non | PK/FK | Référence SQL vers football.ranking_snapshots(id). |
| `usage_definition` | `jsonb` | non |  | Matches/périmètres d’utilisation et règle temporelle. |

PK : `run_id, ranking_snapshot_id`.

- FK `analytics_scoring_run_ranking_inputs_run_id_fk` : `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `analytics_scoring_run_ranking_inputs_ranking_snapshot_id_fk` : `ranking_snapshot_id → football.ranking_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_scoring_run_ranking_inputs_usage_definition_kind_ck` : `jsonb_typeof(usage_definition) = 'object'`.
- CHECK `analytics_scoring_run_ranking_inputs_usage_definitio_8756d551ff` : `octet_length(usage_definition::text)<=16384`.


### analytics.scoring_runs

Calculs de scores reproductibles pour une fenêtre et un périmètre explicites.

Grain physique : Une exécution de modèle.

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
| `catalog_snapshot_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `representation_version` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `code_commit` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `code_content_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `dependencies_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |
| `environment_sha256` | `text` | non |  | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `id`.

- UNIQUE `analytics_scoring_runs_id_product_key_scope_key_uq` : `id, product_key, scope_key`.
- FK `analytics_scoring_runs_model_version_id_fk` : `model_version_id → analytics.model_versions(id) ; ON DELETE RESTRICT`.
- FK `analytics_scoring_runs_dataset_snapshot_id_fk` : `dataset_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `analytics_scoring_runs_sv_catalog_snapshot_id_datase_e91e96e35c` : `catalog_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_scoring_runs_scope_definition_kind_ck` : `jsonb_typeof(scope_definition) = 'object'`.
- CHECK `analytics_scoring_runs_parameters_kind_ck` : `jsonb_typeof(parameters) = 'object'`.
- CHECK `analytics_scoring_runs_error_kind_ck` : `jsonb_typeof(error) = 'object'`.
- CHECK `analytics_scoring_runs_temporal_policy_ck` : `temporal_policy IN ('observed_by_cutoff', 'published_by_cutoff', 'retrospective')`.
- CHECK `analytics_scoring_runs_status_ck` : `status IN ('running', 'validating', 'ready', 'failed')`.
- CHECK `analytics_scoring_runs_window_end_after_window_start_ck` : `window_end >= window_start`.
- CHECK `analytics_scoring_runs_finished_at_after_started_at_ck` : `finished_at >= started_at`.
- CHECK `analytics_scoring_runs_scope_definition_bounded_ck` : `octet_length(scope_definition::text)<=16384`.
- CHECK `analytics_scoring_runs_parameters_bounded_ck` : `octet_length(parameters::text)<=16384`.
- CHECK `analytics_scoring_runs_error_bounded_ck` : `octet_length(error::text)<=16384`.
- CHECK `analytics_scoring_runs_sv_code_content_sha256_ck` : `code_content_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `analytics_scoring_runs_sv_dependencies_sha256_ck` : `dependencies_sha256 ~ '^[0-9a-f]{64}$'`.
- CHECK `analytics_scoring_runs_sv_environment_sha256_ck` : `environment_sha256 ~ '^[0-9a-f]{64}$'`.


### analytics.scouting_features

Variables préparées pour une fenêtre de joueur et un instantané donné.

Grain physique : Version de features × instantané × joueur × fenêtre × périmètre.

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

- UNIQUE `analytics_scouting_features_feature_version_id_datase_bce1445d3` : `feature_version_id, dataset_snapshot_id, player_id, window_start, window_end, scope_key`.
- FK `analytics_scouting_features_feature_version_id_fk` : `feature_version_id → analytics.feature_versions(id) ; ON DELETE RESTRICT`.
- FK `analytics_scouting_features_dataset_snapshot_id_fk` : `dataset_snapshot_id → ingest.dataset_snapshots(id) ; ON DELETE RESTRICT`.
- FK `analytics_scouting_features_player_id_fk` : `player_id → football.players(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_scouting_features_features_kind_ck` : `jsonb_typeof(features) = 'object'`.
- CHECK `analytics_scouting_features_coverage_kind_ck` : `jsonb_typeof(coverage) = 'object'`.
- CHECK `analytics_scouting_features_window_end_after_window_start_ck` : `window_end >= window_start`.
- CHECK `analytics_scouting_features_features_bounded_ck` : `octet_length(features::text)<=16384`.
- CHECK `analytics_scouting_features_coverage_bounded_ck` : `octet_length(coverage::text)<=16384`.


### analytics.team_match_scores

Résultats immuables d’une exécution, sans écraser les scores antérieurs.

Grain physique : Exécution × match × team.

Écriture : `append_only` ; phase : `models`.

| Colonne | Type | NULL | Clés | Signification |
|---|---|---|---|---|
| `run_id` | `bigint` | non | PK/FK | Référence SQL vers analytics.scoring_runs(id). |
| `match_id` | `bigint` | non | PK/FK | Référence SQL vers football.matches(id, revision_id). |
| `team_id` | `bigint` | non | PK/FK | Référence SQL vers football.teams(id). |
| `score` | `double precision` | non |  | Résultat du modèle versionné ; l’échelle appartient à la définition du modèle. |
| `components` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `role_code` | `text` | oui |  | Rôle retenu pour l’évaluation, selon une définition versionnée. |
| `coverage` | `jsonb` | non |  | Réserve future : vecteur/composantes numériques sous contrat de modèle versionné, aucun développement de formule autorisé. Les filtres/tri publics restent en colonnes score/rank. |
| `computed_at` | `timestamptz` | non |  | Instant de calcul effectif du résultat dérivé. |
| `match_revision_id` | `bigint` | non | FK | Valeur typée du contrat de versions sélectives ; aucune copie documentaire. |

PK : `run_id, match_id, team_id`.

- FK `analytics_team_match_scores_run_id_fk` : `run_id → analytics.scoring_runs(id) ; ON DELETE RESTRICT`.
- FK `analytics_team_match_scores_match_id_fk` : `match_id, match_revision_id → football.matches(id, revision_id) ; ON DELETE RESTRICT`.
- FK `analytics_team_match_scores_team_id_fk` : `team_id → football.teams(id) ; ON DELETE RESTRICT`.
- CHECK `analytics_team_match_scores_components_kind_ck` : `jsonb_typeof(components) = 'object'`.
- CHECK `analytics_team_match_scores_coverage_kind_ck` : `jsonb_typeof(coverage) = 'object'`.
- CHECK `analytics_team_match_scores_components_bounded_ck` : `octet_length(components::text)<=16384`.
- CHECK `analytics_team_match_scores_coverage_bounded_ck` : `octet_length(coverage::text)<=16384`.

- Aucune borne universelle 0–100: l’échelle appartient à model_versions.score_definition.
- La cohérence match/joueur/équipe est validée contre le snapshot du run. Les FK visent les identités stables, pas les faits courants corrigibles; une correction ne doit pas invalider un ancien résultat reproductible.
