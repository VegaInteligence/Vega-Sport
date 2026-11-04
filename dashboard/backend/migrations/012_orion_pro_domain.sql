-- Approved Pro selective-inline pilot; no legacy schema/data changes.

-- 94 typed tables; reserved model tables are deferred by default.

CREATE SCHEMA IF NOT EXISTS "ingest";

REVOKE ALL ON SCHEMA "ingest" FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS "football";

REVOKE ALL ON SCHEMA "football" FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS "analytics";

REVOKE ALL ON SCHEMA "analytics" FROM PUBLIC;

CREATE SEQUENCE "ingest"."commit_generation_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."countries_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."venues_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."coaches_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."competitions_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."competition_seasons_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."competition_stages_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."competition_groups_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."player_team_memberships_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."team_aliases_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."matches_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."shots_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."team_coach_tenures_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."honour_definitions_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."player_honours_logical_id_seq" AS bigint MINVALUE 1;

CREATE SEQUENCE "football"."team_honours_logical_id_seq" AS bigint MINVALUE 1;

CREATE TABLE "ingest"."sources" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "base_url" text,
  "upstream_source_id" bigint,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "ingest_sources_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_sources_code_uq" UNIQUE ("code"),
  CONSTRAINT "ingest_sources_no_self_parent_ck" CHECK (upstream_source_id <> id)
);

COMMENT ON TABLE "ingest"."sources" IS 'Espaces stables d’identifiants fournisseurs. Grain: Un espace fournisseur.';

COMMENT ON COLUMN "ingest"."sources"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."sources"."code" IS 'Code stable du référentiel, avec sa définition explicite.';

COMMENT ON COLUMN "ingest"."sources"."name" IS 'Nom de l’entité dans le contexte défini par cette table.';

COMMENT ON COLUMN "ingest"."sources"."base_url" IS 'Adresse publique de base du fournisseur ; aucune clé ou secret inclus.';

COMMENT ON COLUMN "ingest"."sources"."upstream_source_id" IS 'Origine amont éventuelle; une copie ne devient pas une source indépendante.';

COMMENT ON COLUMN "ingest"."sources"."created_at" IS 'Création de cette ligne dans le système.';

CREATE TABLE "ingest"."source_datasets" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_id" bigint NOT NULL,
  "dataset_key" text NOT NULL,
  "contract_version" text NOT NULL,
  "source_url" text,
  "license_code" text,
  "schema_description" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "ingest_source_datasets_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_source_datasets_source_id_dataset_key_contract_17e4a5946" UNIQUE ("source_id", "dataset_key", "contract_version"),
  CONSTRAINT "ingest_source_datasets_id_source_id_uq" UNIQUE ("id", "source_id"),
  CONSTRAINT "ingest_source_datasets_schema_description_kind_ck" CHECK (jsonb_typeof(schema_description) = 'object'),
  CONSTRAINT "ingest_source_datasets_schema_description_bounded_ck" CHECK (octet_length(schema_description::text)<=16384)
);

COMMENT ON TABLE "ingest"."source_datasets" IS 'Corpus et versions de contrat d’une source. Grain: Source × clé de corpus × version de contrat.';

COMMENT ON COLUMN "ingest"."source_datasets"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."source_datasets"."source_id" IS 'Référence SQL vers ingest.sources(id).';

COMMENT ON COLUMN "ingest"."source_datasets"."dataset_key" IS 'Clé stable du corpus de cette source.';

COMMENT ON COLUMN "ingest"."source_datasets"."contract_version" IS 'Version du contrat de ce corpus, figée pour les observations qui l’utilisent.';

COMMENT ON COLUMN "ingest"."source_datasets"."source_url" IS 'Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité.';

COMMENT ON COLUMN "ingest"."source_datasets"."license_code" IS 'Licence ou conditions d’utilisation identifiées pour le corpus/média.';

COMMENT ON COLUMN "ingest"."source_datasets"."schema_description" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."source_datasets"."created_at" IS 'Création de cette ligne dans le système.';

CREATE TABLE "ingest"."import_runs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "transform_version" text NOT NULL,
  "code_commit" text,
  "started_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "finished_at" timestamptz,
  "parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" jsonb,
  CONSTRAINT "ingest_import_runs_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_import_runs_parameters_kind_ck" CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT "ingest_import_runs_counters_kind_ck" CHECK (jsonb_typeof(counters) = 'object'),
  CONSTRAINT "ingest_import_runs_checkpoint_kind_ck" CHECK (jsonb_typeof(checkpoint) = 'object'),
  CONSTRAINT "ingest_import_runs_error_kind_ck" CHECK (jsonb_typeof(error) = 'object'),
  CONSTRAINT "ingest_import_runs_mode_ck" CHECK (mode IN ('daily', 'backfill', 'rebuild', 'repair')),
  CONSTRAINT "ingest_import_runs_status_ck" CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'cancelled')),
  CONSTRAINT "ingest_import_runs_finished_at_after_started_at_ck" CHECK (finished_at >= started_at),
  CONSTRAINT "ingest_import_runs_parameters_bounded_ck" CHECK (octet_length(parameters::text)<=16384),
  CONSTRAINT "ingest_import_runs_counters_bounded_ck" CHECK (octet_length(counters::text)<=16384),
  CONSTRAINT "ingest_import_runs_checkpoint_bounded_ck" CHECK (octet_length(checkpoint::text)<=16384),
  CONSTRAINT "ingest_import_runs_error_bounded_ck" CHECK (octet_length(error::text)<=16384)
);

COMMENT ON TABLE "ingest"."import_runs" IS 'Exécutions traçables de collecte ou de transformation. Grain: Une exécution.';

COMMENT ON COLUMN "ingest"."import_runs"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."import_runs"."mode" IS 'Nature du run : daily, backfill, rebuild ou repair.';

COMMENT ON COLUMN "ingest"."import_runs"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "ingest"."import_runs"."transform_version" IS 'Version de la transformation de données.';

COMMENT ON COLUMN "ingest"."import_runs"."code_commit" IS 'Révision du code effectivement employée.';

COMMENT ON COLUMN "ingest"."import_runs"."started_at" IS 'Instant UTC « started_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."import_runs"."finished_at" IS 'Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."import_runs"."parameters" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."import_runs"."counters" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."import_runs"."checkpoint" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."import_runs"."error" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

CREATE TABLE "ingest"."source_documents" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "dataset_id" bigint NOT NULL,
  "source_id" bigint NOT NULL,
  "storage_provider" text DEFAULT 'http_direct' NOT NULL,
  "storage_bucket" text,
  "storage_key" text,
  "storage_version" text,
  "content_sha256" text NOT NULL,
  "byte_length" bigint,
  "content_type" text,
  "encoding" text,
  "retrieved_at" timestamptz NOT NULL,
  "source_updated_at" timestamptz,
  "source_published_at" timestamptz,
  "source_url" text,
  "legacy_object_path" text,
  "import_run_id" bigint,
  "origin_kind" text DEFAULT 'http_response' NOT NULL,
  "content_verified_at" timestamptz,
  "retention_state" text DEFAULT 'not_stored' NOT NULL,
  "deleted_at" timestamptz,
  "request_fingerprint" text,
  CONSTRAINT "ingest_source_documents_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_source_documents_dataset_id_storage_bucket_sto_c2e712c21" UNIQUE ("dataset_id", "storage_bucket", "storage_key", "content_sha256"),
  CONSTRAINT "ingest_source_documents_id_source_id_uq" UNIQUE ("id", "source_id"),
  CONSTRAINT "ingest_source_documents_sha256_ck" CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ingest_source_documents_byte_length_nonnegative_ck" CHECK (byte_length >= 0),
  CONSTRAINT "ingest_source_documents_retention_state_ck" CHECK (retention_state IN ('not_stored','staged','reconciled','deleted')),
  CONSTRAINT "ingest_source_documents_direct_ingestion_no_file_ck" CHECK ((origin_kind='http_response' AND storage_provider='http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND retention_state='not_stored') OR (origin_kind='legacy_file' AND retention_state IN ('staged','reconciled','deleted'))),
  CONSTRAINT "ingest_source_documents_deleted_metadata_ck" CHECK ((retention_state='deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT "ingest_source_documents_pro_request_origin_identity_ck" CHECK ((origin_kind = 'http_response' AND request_fingerprint IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$' AND storage_provider = 'http_direct' AND storage_bucket IS NULL AND storage_key IS NULL AND storage_version IS NULL AND retention_state = 'not_stored') OR (origin_kind = 'legacy_file' AND request_fingerprint IS NULL AND retention_state IN ('staged','reconciled','deleted')))
);

COMMENT ON TABLE "ingest"."source_documents" IS 'Reçu d’observation HTTP directe ou métadonnées d’un ancien artefact source ; jamais le contenu d’une réponse ou d’un fichier. Grain: Version de contenu d’un objet dans un corpus.';

COMMENT ON COLUMN "ingest"."source_documents"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."source_documents"."dataset_id" IS 'Référence SQL vers ingest.source_datasets(id, source_id).';

COMMENT ON COLUMN "ingest"."source_documents"."source_id" IS 'Référence SQL vers ingest.source_datasets(id, source_id).';

COMMENT ON COLUMN "ingest"."source_documents"."storage_provider" IS 'http_direct pour les nouvelles collectes sans fichier ; aws_s3 uniquement pour les sources historiques déjà présentes.';

COMMENT ON COLUMN "ingest"."source_documents"."storage_bucket" IS 'Ancien emplacement à titre de provenance ; ne constitue pas une dépendance de lecture.';

COMMENT ON COLUMN "ingest"."source_documents"."storage_key" IS 'Ancien emplacement à titre de provenance ; ne constitue pas une dépendance de lecture.';

COMMENT ON COLUMN "ingest"."source_documents"."storage_version" IS 'Version exacte du stockage si réellement disponible ; une clé mutable n’est pas une version.';

COMMENT ON COLUMN "ingest"."source_documents"."content_sha256" IS 'SHA-256 hexadécimal minuscule des octets reçus et hachés en mémoire, ou de l’ancien artefact vérifié. Empreinte seulement ; aucune réponse conservée.';

COMMENT ON COLUMN "ingest"."source_documents"."byte_length" IS 'Nombre d’octets vérifiés de l’ancien artefact ; métadonnée sans conservation de son contenu.';

COMMENT ON COLUMN "ingest"."source_documents"."content_type" IS 'Type MIME du média ou de l’ancien artefact.';

COMMENT ON COLUMN "ingest"."source_documents"."encoding" IS 'Encodage/compression source identifié.';

COMMENT ON COLUMN "ingest"."source_documents"."retrieved_at" IS 'Récupération effective de la donnée source.';

COMMENT ON COLUMN "ingest"."source_documents"."source_updated_at" IS 'Dernière mise à jour déclarée par la source, distincte de sa récupération.';

COMMENT ON COLUMN "ingest"."source_documents"."source_published_at" IS 'Publication déclarée par la source ; reste inconnue en l’absence de preuve.';

COMMENT ON COLUMN "ingest"."source_documents"."source_url" IS 'Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité.';

COMMENT ON COLUMN "ingest"."source_documents"."legacy_object_path" IS 'Ancien chemin, conservé comme provenance uniquement après purge.';

COMMENT ON COLUMN "ingest"."source_documents"."import_run_id" IS 'Référence SQL vers ingest.import_runs(id).';

COMMENT ON COLUMN "ingest"."source_documents"."origin_kind" IS 'http_response directe ou legacy_file déjà existant.';

COMMENT ON COLUMN "ingest"."source_documents"."content_verified_at" IS 'Date de la dernière vérification effective des octets avant suppression.';

COMMENT ON COLUMN "ingest"."source_documents"."retention_state" IS 'not_stored pour une nouvelle réponse HTTP ; staged/reconciled/deleted uniquement pour un ancien fichier.';

COMMENT ON COLUMN "ingest"."source_documents"."deleted_at" IS 'Suppression vérifiée de l’original et des copies recensées.';

COMMENT ON COLUMN "ingest"."source_documents"."request_fingerprint" IS 'SHA-256 hexadécimal minuscule de la requête canonique sans secret ; obligatoire en HTTP direct, NULL pour un ancien fichier. Aucun body conservé.';

CREATE TABLE "ingest"."source_records" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_id" bigint NOT NULL,
  "document_id" bigint NOT NULL,
  "locator_kind" text NOT NULL,
  "locator" text NOT NULL,
  "ordinal" integer,
  "record_kind" text NOT NULL,
  "external_key" text,
  CONSTRAINT "ingest_source_records_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_source_records_document_id_locator_uq" UNIQUE ("document_id", "locator"),
  CONSTRAINT "ingest_source_records_source_id_id_uq" UNIQUE ("source_id", "id"),
  CONSTRAINT "ingest_source_records_locator_kind_ck" CHECK (locator_kind IN ('json_pointer','jsonl_line','array_ordinal','archive_member','whole_document','csv_row','sqlite_row')),
  CONSTRAINT "ingest_source_records_ordinal_nonnegative_ck" CHECK (ordinal >= 0)
);

COMMENT ON TABLE "ingest"."source_records" IS 'Métadonnées d’observation et correspondance vers les faits SQL conservés ; ancien localisateur sans dépendance à des octets supprimés. Grain: Document × localisateur.';

COMMENT ON COLUMN "ingest"."source_records"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."source_records"."source_id" IS 'Référence SQL vers ingest.source_documents(id, source_id).';

COMMENT ON COLUMN "ingest"."source_records"."document_id" IS 'Référence SQL vers ingest.source_documents(id, source_id).';

COMMENT ON COLUMN "ingest"."source_records"."locator_kind" IS 'Nature du localisateur : pointeur JSON, ligne JSONL, ordinal, membre d’archive ou document entier.';

COMMENT ON COLUMN "ingest"."source_records"."locator" IS 'Pointeur JSON, ligne, ordinal ou chemin membre + ordinal, canonisé sans ambiguïté.';

COMMENT ON COLUMN "ingest"."source_records"."ordinal" IS 'Position d’un enregistrement dans son ancien conteneur, utilisée comme provenance.';

COMMENT ON COLUMN "ingest"."source_records"."record_kind" IS 'Type sémantique de l’observation source.';

COMMENT ON COLUMN "ingest"."source_records"."external_key" IS 'Clé native de cet enregistrement lorsqu’elle existe.';

CREATE TABLE "ingest"."document_lineage" (
  "derived_document_id" bigint NOT NULL,
  "parent_document_id" bigint NOT NULL,
  "transform_version" text NOT NULL,
  "parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "ingest_document_lineage_pk" PRIMARY KEY ("derived_document_id", "parent_document_id"),
  CONSTRAINT "ingest_document_lineage_parameters_kind_ck" CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT "ingest_document_lineage_no_self_parent_ck" CHECK (derived_document_id <> parent_document_id),
  CONSTRAINT "ingest_document_lineage_parameters_bounded_ck" CHECK (octet_length(parameters::text)<=16384)
);

COMMENT ON TABLE "ingest"."document_lineage" IS 'Origines des documents dérivés. Grain: Document dérivé × document parent.';

COMMENT ON COLUMN "ingest"."document_lineage"."derived_document_id" IS 'Référence SQL vers ingest.source_documents(id).';

COMMENT ON COLUMN "ingest"."document_lineage"."parent_document_id" IS 'Référence SQL vers ingest.source_documents(id).';

COMMENT ON COLUMN "ingest"."document_lineage"."transform_version" IS 'Version de la transformation de données.';

COMMENT ON COLUMN "ingest"."document_lineage"."parameters" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

CREATE TABLE "ingest"."resource_fetches" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "run_id" bigint NOT NULL,
  "source_id" bigint NOT NULL,
  "endpoint" text NOT NULL,
  "canonical_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "request_fingerprint" text NOT NULL,
  "attempt_no" integer NOT NULL,
  "requested_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "http_status" smallint,
  "error_code" text,
  "error_details" jsonb,
  "document_id" bigint,
  "response_state" text NOT NULL,
  CONSTRAINT "ingest_resource_fetches_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_resource_fetches_run_id_source_id_request_fing_086b49db3" UNIQUE ("run_id", "source_id", "request_fingerprint", "attempt_no"),
  CONSTRAINT "ingest_resource_fetches_canonical_params_kind_ck" CHECK (jsonb_typeof(canonical_params) = 'object'),
  CONSTRAINT "ingest_resource_fetches_error_details_kind_ck" CHECK (jsonb_typeof(error_details) = 'object'),
  CONSTRAINT "ingest_resource_fetches_response_state_ck" CHECK (response_state IN ('available', 'empty_response', 'unavailable', 'failed', 'invalid')),
  CONSTRAINT "ingest_resource_fetches_http_status_ck" CHECK (http_status BETWEEN 100 AND 599),
  CONSTRAINT "ingest_resource_fetches_attempt_positive_ck" CHECK (attempt_no > 0),
  CONSTRAINT "ingest_resource_fetches_finished_at_after_requested_at_ck" CHECK (finished_at >= requested_at),
  CONSTRAINT "ingest_resource_fetches_canonical_params_bounded_ck" CHECK (octet_length(canonical_params::text)<=16384),
  CONSTRAINT "ingest_resource_fetches_error_details_bounded_ck" CHECK (octet_length(error_details::text)<=16384),
  CONSTRAINT "ingest_resource_fetches_pro_request_fingerprint_ck" CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE "ingest"."resource_fetches" IS 'Historique des tentatives de collecte, distinct de la file de jobs existante. Grain: Une tentative HTTP ou une lecture d’archive.';

COMMENT ON COLUMN "ingest"."resource_fetches"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."resource_fetches"."run_id" IS 'Référence SQL vers ingest.import_runs(id).';

COMMENT ON COLUMN "ingest"."resource_fetches"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_documents(id, source_id).';

COMMENT ON COLUMN "ingest"."resource_fetches"."endpoint" IS 'Endpoint de collecte ; jamais appelé par une requête utilisateur.';

COMMENT ON COLUMN "ingest"."resource_fetches"."canonical_params" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."resource_fetches"."request_fingerprint" IS 'Empreinte stable de la requête canonique, incluant la source, sans secret.';

COMMENT ON COLUMN "ingest"."resource_fetches"."attempt_no" IS 'Numéro strictement positif de tentative dans ce run et pour cette ressource.';

COMMENT ON COLUMN "ingest"."resource_fetches"."requested_at" IS 'Instant UTC « requested_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."resource_fetches"."finished_at" IS 'Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."resource_fetches"."http_status" IS 'Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP.';

COMMENT ON COLUMN "ingest"."resource_fetches"."error_code" IS 'Code d’erreur technique/fournisseur conservé exactement.';

COMMENT ON COLUMN "ingest"."resource_fetches"."error_details" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."resource_fetches"."document_id" IS 'Référence SQL vers ingest.source_documents(id, source_id).';

COMMENT ON COLUMN "ingest"."resource_fetches"."response_state" IS 'Résultat réel de la collecte : donnée disponible, réponse vide, indisponibilité, échec ou invalidité.';

CREATE TABLE "ingest"."media_assets" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "storage_bucket" text NOT NULL,
  "storage_key" text NOT NULL,
  "content_sha256" text,
  "source_url" text,
  "content_type" text NOT NULL,
  "author" text,
  "license_code" text,
  "attribution_url" text,
  "retrieved_at" timestamptz NOT NULL,
  "legacy_asset_url" text,
  CONSTRAINT "ingest_media_assets_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_media_assets_storage_bucket_storage_key_conten_e6078ca76" UNIQUE NULLS NOT DISTINCT ("storage_bucket", "storage_key", "content_sha256"),
  CONSTRAINT "ingest_media_assets_sha256_ck" CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE "ingest"."media_assets" IS 'Références de médias et attribution, sans duplication du fichier. Grain: Version conservée d’un média.';

COMMENT ON COLUMN "ingest"."media_assets"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."media_assets"."storage_bucket" IS 'Bucket du média conservé ou ancienne localisation de source supprimée.';

COMMENT ON COLUMN "ingest"."media_assets"."storage_key" IS 'Clé du média conservé ou ancienne localisation de source ; aucun contenu incorporé.';

COMMENT ON COLUMN "ingest"."media_assets"."content_sha256" IS 'Empreinte SHA-256 hexadécimale du contenu effectivement vérifié ; aucune capacité de reconstruction par ce hash seul.';

COMMENT ON COLUMN "ingest"."media_assets"."source_url" IS 'Adresse documentaire de l’origine ; la reproductibilité finale repose sur SQL, pas sur sa disponibilité.';

COMMENT ON COLUMN "ingest"."media_assets"."content_type" IS 'Type MIME du média ou de l’ancien artefact.';

COMMENT ON COLUMN "ingest"."media_assets"."author" IS 'Auteur ou crédit du média tel que sourcé.';

COMMENT ON COLUMN "ingest"."media_assets"."license_code" IS 'Licence ou conditions d’utilisation identifiées pour le corpus/média.';

COMMENT ON COLUMN "ingest"."media_assets"."attribution_url" IS 'Lien de crédit/licence à présenter pour le média.';

COMMENT ON COLUMN "ingest"."media_assets"."retrieved_at" IS 'Récupération effective de la donnée source.';

COMMENT ON COLUMN "ingest"."media_assets"."legacy_asset_url" IS 'Ancienne URL publique à continuer de résoudre vers le média.';

CREATE TABLE "ingest"."dataset_snapshots" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "snapshot_key" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "manifest_sha256" text,
  "transform_version" text NOT NULL,
  "source_priority_version" text NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "sealed_at" timestamptz,
  "knowledge_cutoff_at" timestamptz,
  "generation" bigint NOT NULL,
  CONSTRAINT "ingest_dataset_snapshots_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_dataset_snapshots_snapshot_key_uq" UNIQUE ("snapshot_key"),
  CONSTRAINT "ingest_dataset_snapshots_sv_generation_uq" UNIQUE ("generation"),
  CONSTRAINT "ingest_dataset_snapshots_status_ck" CHECK (status IN ('draft', 'sealed', 'invalid')),
  CONSTRAINT "ingest_dataset_snapshots_sha256_ck" CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ingest_dataset_snapshots_sealed_metadata_ck" CHECK (status <> 'sealed' OR (sealed_at IS NOT NULL AND manifest_sha256 IS NOT NULL)),
  CONSTRAINT "ingest_dataset_snapshots_sv_generation_positive_ck" CHECK (generation > 0)
);

COMMENT ON TABLE "ingest"."dataset_snapshots" IS 'Registre léger des générations de commit et de leur scellement ; aucune copie de lignes ni sélection universelle. Grain: Un instantané logique scellé.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."snapshot_key" IS 'Clé unique de l’instantané SQL ; sa composition devient immuable après scellement.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."manifest_sha256" IS 'Empreinte du manifeste SQL scellé ; ne contient pas les fichiers supprimés.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."transform_version" IS 'Version de la transformation de données.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."source_priority_version" IS 'Version de la politique de priorité/déduplication entre sources utilisée par cet instantané.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."created_at" IS 'Création de cette ligne dans le système.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."sealed_at" IS 'Instant UTC « sealed_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."knowledge_cutoff_at" IS 'Dernier instant auquel les informations sont admissibles pour ce calcul.';

COMMENT ON COLUMN "ingest"."dataset_snapshots"."generation" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "ingest"."dataset_snapshot_documents" (
  "snapshot_id" bigint NOT NULL,
  "document_id" bigint NOT NULL,
  CONSTRAINT "ingest_dataset_snapshot_documents_pk" PRIMARY KEY ("snapshot_id", "document_id")
);

COMMENT ON TABLE "ingest"."dataset_snapshot_documents" IS 'Provenance des documents ayant contribué à un instantané SQL ; aucun fichier requis après purge. Grain: Instantané × document.';

COMMENT ON COLUMN "ingest"."dataset_snapshot_documents"."snapshot_id" IS 'Référence SQL vers ingest.dataset_snapshots(id).';

COMMENT ON COLUMN "ingest"."dataset_snapshot_documents"."document_id" IS 'Référence SQL vers ingest.source_documents(id).';

CREATE TABLE "ingest"."quality_issues" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "run_id" bigint,
  "source_record_id" bigint,
  "rule_code" text NOT NULL,
  "severity" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "detected_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "resolved_at" timestamptz,
  "resolution" text,
  CONSTRAINT "ingest_quality_issues_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_quality_issues_context_kind_ck" CHECK (jsonb_typeof(context) = 'object'),
  CONSTRAINT "ingest_quality_issues_severity_ck" CHECK (severity IN ('info', 'warning', 'error', 'blocking')),
  CONSTRAINT "ingest_quality_issues_status_ck" CHECK (status IN ('open', 'resolved', 'accepted')),
  CONSTRAINT "ingest_quality_issues_resolved_at_after_detected_at_ck" CHECK (resolved_at >= detected_at),
  CONSTRAINT "ingest_quality_issues_context_bounded_ck" CHECK (octet_length(context::text)<=16384)
);

COMMENT ON TABLE "ingest"."quality_issues" IS 'Anomalies et corrections traçables. Grain: Une anomalie détectée.';

COMMENT ON COLUMN "ingest"."quality_issues"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."quality_issues"."run_id" IS 'Référence SQL vers ingest.import_runs(id).';

COMMENT ON COLUMN "ingest"."quality_issues"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "ingest"."quality_issues"."rule_code" IS 'Règle de contrôle identifiée et versionnée qui a détecté le problème.';

COMMENT ON COLUMN "ingest"."quality_issues"."severity" IS 'Gravité info, warning, error ou blocking de l’anomalie.';

COMMENT ON COLUMN "ingest"."quality_issues"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "ingest"."quality_issues"."context" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "ingest"."quality_issues"."detected_at" IS 'Instant UTC « detected_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."quality_issues"."resolved_at" IS 'Instant UTC « resolved_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."quality_issues"."resolution" IS 'Traitement réellement effectué pour résoudre ou accepter une anomalie.';

CREATE TABLE "ingest"."identity_candidates" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "source_id" bigint NOT NULL,
  "entity_kind" text NOT NULL,
  "external_id" text NOT NULL,
  "source_record_id" bigint,
  "candidate_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "resolved_at" timestamptz,
  "resolution_notes" text,
  CONSTRAINT "ingest_identity_candidates_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_identity_candidates_source_id_entity_kind_external_id_uq" UNIQUE ("source_id", "entity_kind", "external_id"),
  CONSTRAINT "ingest_identity_candidates_candidate_evidence_kind_ck" CHECK (jsonb_typeof(candidate_evidence) = 'array'),
  CONSTRAINT "ingest_identity_candidates_entity_kind_ck" CHECK (entity_kind IN ('competition', 'team', 'player', 'match', 'association', 'venue', 'coach')),
  CONSTRAINT "ingest_identity_candidates_status_ck" CHECK (status IN ('pending', 'resolved', 'rejected')),
  CONSTRAINT "ingest_identity_candidates_resolved_at_after_created_at_ck" CHECK (resolved_at >= created_at),
  CONSTRAINT "ingest_identity_candidates_candidate_evidence_bounded_ck" CHECK (octet_length(candidate_evidence::text)<=16384)
);

COMMENT ON TABLE "ingest"."identity_candidates" IS 'File de rapprochements ambigus; aucune identité publiée via ce JSON. Grain: Source × type d’entité × identifiant externe non résolu.';

COMMENT ON COLUMN "ingest"."identity_candidates"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "ingest"."identity_candidates"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "ingest"."identity_candidates"."entity_kind" IS 'Type d’identité concerné par le rapprochement en attente.';

COMMENT ON COLUMN "ingest"."identity_candidates"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "ingest"."identity_candidates"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "ingest"."identity_candidates"."candidate_evidence" IS 'Candidats et indices; propositions sans valeur de FK métier.';

COMMENT ON COLUMN "ingest"."identity_candidates"."reason" IS 'Motif documenté de l’anomalie ou du rapprochement.';

COMMENT ON COLUMN "ingest"."identity_candidates"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "ingest"."identity_candidates"."created_at" IS 'Création de cette ligne dans le système.';

COMMENT ON COLUMN "ingest"."identity_candidates"."resolved_at" IS 'Instant UTC « resolved_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."identity_candidates"."resolution_notes" IS 'Justification humaine ou automatisée de la décision de rapprochement.';

CREATE TABLE "ingest"."match_coverage" (
  "match_id" bigint NOT NULL,
  "source_id" bigint NOT NULL,
  "feature_code" text NOT NULL,
  "coverage_state" text NOT NULL,
  "http_status" smallint,
  "error_code" text,
  "observed_row_count" integer,
  "document_id" bigint,
  "checked_at" timestamptz NOT NULL,
  "is_stale" boolean DEFAULT false NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "collection_state" text NOT NULL,
  "relation_code" text DEFAULT 'ingest.match_coverage' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "match_revision_id" bigint NOT NULL,
  CONSTRAINT "ingest_match_coverage_sv_pk" PRIMARY KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "ingest_match_coverage_coverage_state_ck" CHECK (coverage_state IN ('not_requested', 'pending', 'available', 'empty_response', 'unavailable', 'failed', 'invalid')),
  CONSTRAINT "ingest_match_coverage_http_status_ck" CHECK (http_status BETWEEN 100 AND 599),
  CONSTRAINT "ingest_match_coverage_observed_row_count_nonnegative_ck" CHECK (observed_row_count >= 0),
  CONSTRAINT "ingest_match_coverage_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "ingest_match_coverage_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "ingest_match_coverage_sv_collection_shape_ck" CHECK ((collection_state IN ('absent','null','unavailable') AND observed_row_count IS NULL) OR (collection_state = 'empty' AND observed_row_count IS NOT NULL AND observed_row_count = 0) OR (collection_state = 'present' AND observed_row_count IS NOT NULL AND observed_row_count > 0)),
  CONSTRAINT "ingest_match_coverage_sv_relation_binding_ck" CHECK (relation_code = 'ingest.match_coverage'),
  CONSTRAINT "ingest_match_coverage_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ingest_match_coverage_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "ingest_match_coverage_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "ingest_match_coverage_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "ingest"."match_coverage" IS 'Disponibilité réelle par match, source et famille; indépendante du HTTP. Grain physique : une observation complète de collection, y compris son état vide/null/absent, PK (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; clé logique (match_id, source_id, feature_code, variant_key), variante variant_key ; sélection canonique (match_id, feature_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une observation complète de collection, y compris son état vide/null/absent, PK (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; clé logique (match_id, source_id, feature_code, variant_key), variante variant_key ; sélection canonique (match_id, feature_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "ingest"."match_coverage"."match_id" IS 'Référence SQL vers football.matches(id, revision_id).';

COMMENT ON COLUMN "ingest"."match_coverage"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_documents(id, source_id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "ingest"."match_coverage"."feature_code" IS 'Famille fonctionnelle de couverture, par exemple lineups, shots ou heatmaps.';

COMMENT ON COLUMN "ingest"."match_coverage"."coverage_state" IS 'Disponibilité réelle de la famille, indépendante du statut HTTP : disponible, vide, indisponible, invalide, etc.';

COMMENT ON COLUMN "ingest"."match_coverage"."http_status" IS 'Statut HTTP réellement reçu, de 100 à 599 ; NULL si aucune réponse HTTP.';

COMMENT ON COLUMN "ingest"."match_coverage"."error_code" IS 'Code d’erreur technique/fournisseur conservé exactement.';

COMMENT ON COLUMN "ingest"."match_coverage"."observed_row_count" IS 'Nombre de « observed row » du périmètre de cette ligne ; absence distincte de zéro.';

COMMENT ON COLUMN "ingest"."match_coverage"."document_id" IS 'Référence SQL vers ingest.source_documents(id, source_id).';

COMMENT ON COLUMN "ingest"."match_coverage"."checked_at" IS 'Instant UTC « checked_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "ingest"."match_coverage"."is_stale" IS 'Indique une donnée périmée selon sa politique de fraîcheur.';

COMMENT ON COLUMN "ingest"."match_coverage"."data_revision" IS 'Révision du grain ou de la famille, incrémentée seulement lorsque son contenu change.';

COMMENT ON COLUMN "ingest"."match_coverage"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "ingest"."match_coverage"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "ingest"."match_coverage"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "ingest"."match_coverage"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."collection_state" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."match_coverage"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "ingest"."relation_contracts" (
  "relation_code" text NOT NULL,
  "relation_name" text NOT NULL,
  "contract_version" text NOT NULL,
  "grain_definition" text NOT NULL,
  CONSTRAINT "ingest_relation_contracts_sv_pk" PRIMARY KEY ("relation_code", "contract_version")
);

COMMENT ON TABLE "ingest"."relation_contracts" IS 'Catalogue des relations métier et de leurs grains autorisés. Grain: Une relation enregistrée.';

COMMENT ON COLUMN "ingest"."relation_contracts"."relation_code" IS 'Nom SQL qualifié autorisé, stable dans une version du contrat.';

COMMENT ON COLUMN "ingest"."relation_contracts"."relation_name" IS 'Relation métier concernée ; aucune table sœur history.';

COMMENT ON COLUMN "ingest"."relation_contracts"."contract_version" IS 'Version du contrat de colonnes, clés et sémantique.';

COMMENT ON COLUMN "ingest"."relation_contracts"."grain_definition" IS 'Définition explicite de la clé logique.';

CREATE TABLE "ingest"."field_contracts" (
  "relation_code" text NOT NULL,
  "field_code" text NOT NULL,
  "target_column" text NOT NULL,
  "definition" text NOT NULL,
  "contract_version" text NOT NULL,
  CONSTRAINT "ingest_field_contracts_sv_pk" PRIMARY KEY ("relation_code", "contract_version", "field_code")
);

COMMENT ON TABLE "ingest"."field_contracts" IS 'Champs sémantiques enregistrés et leur destination ; aucun chemin arbitraire autorisé. Grain: Relation × code de champ.';

COMMENT ON COLUMN "ingest"."field_contracts"."relation_code" IS 'Relation du fait normalisé.';

COMMENT ON COLUMN "ingest"."field_contracts"."field_code" IS 'Code sémantique déclaré, pas une propriété JSON libre.';

COMMENT ON COLUMN "ingest"."field_contracts"."target_column" IS 'Colonne typée ou relation enfant explicitement correspondante.';

COMMENT ON COLUMN "ingest"."field_contracts"."definition" IS 'Sens, unité et règle de conservation du champ.';

COMMENT ON COLUMN "ingest"."field_contracts"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "ingest"."reconciliation_runs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "catalog_fingerprint" text NOT NULL,
  "mapping_version" text NOT NULL,
  "missing_records" bigint NOT NULL,
  "different_fields" bigint NOT NULL,
  "unverified_records" bigint NOT NULL,
  CONSTRAINT "ingest_reconciliation_runs_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_reconciliation_runs_counts_ck" CHECK (missing_records >= 0 AND different_fields >= 0 AND unverified_records >= 0),
  CONSTRAINT "ingest_reconciliation_runs_status_ck" CHECK (status IN ('running','failed','accepted')),
  CONSTRAINT "ingest_reconciliation_runs_sv_mapping_version_nonempty_ck" CHECK (btrim(mapping_version) <> '')
);

COMMENT ON TABLE "ingest"."reconciliation_runs" IS 'Preuves de complétude et différences entre origines, observations et SQL final. Grain: Une campagne de rapprochement.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."id" IS 'Identifiant interne de la ligne, jamais substitué aux identifiants publics existants.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."status" IS 'running, failed ou accepted après vérification de tous les périmètres.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."started_at" IS 'Début de campagne.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."finished_at" IS 'Fin effective de campagne.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."catalog_fingerprint" IS 'Empreinte du catalogue exact attendu au point de coupure.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."mapping_version" IS 'Version de l’adaptateur et des règles de comparaison.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."missing_records" IS 'Nombre d’observations attendues manquantes.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."different_fields" IS 'Nombre de champs non conformes.';

COMMENT ON COLUMN "ingest"."reconciliation_runs"."unverified_records" IS 'Nombre d’observations non vérifiées.';

CREATE TABLE "ingest"."document_reconciliations" (
  "run_id" bigint NOT NULL,
  "document_id" bigint NOT NULL,
  "records_expected" bigint NOT NULL,
  "records_linked" bigint NOT NULL,
  "unmapped_fields" bigint NOT NULL,
  "mismatches" bigint NOT NULL,
  "status" text NOT NULL,
  "semantic_sha256" text,
  CONSTRAINT "ingest_document_reconciliations_pk" PRIMARY KEY ("run_id", "document_id"),
  CONSTRAINT "ingest_document_reconciliations_counts_ck" CHECK (records_expected >= 0 AND records_linked >= 0 AND unmapped_fields >= 0 AND mismatches >= 0)
);

COMMENT ON TABLE "ingest"."document_reconciliations" IS 'Couverture exhaustive d’un ancien artefact avant suppression de ses octets. Grain: Campagne × métadonnée de document.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."run_id" IS 'Campagne de contrôle.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."document_id" IS 'Métadonnée d’origine.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."records_expected" IS 'Nombre de records à représenter.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."records_linked" IS 'Records reliés à des faits typés ou métadonnées documentées.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."unmapped_fields" IS 'Champs utiles sans destination typée.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."mismatches" IS 'Valeurs ou états différents après projection inverse définie.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."status" IS 'pending, failed ou accepted.';

COMMENT ON COLUMN "ingest"."document_reconciliations"."semantic_sha256" IS 'Hash de comparaison sémantique ; ne restaure pas les octets supprimés.';

CREATE TABLE "ingest"."cleanup_items" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "reconciliation_run_id" bigint NOT NULL,
  "document_id" bigint,
  "storage_kind" text NOT NULL,
  "storage_location" text NOT NULL,
  "storage_version" text,
  "bytes_before" bigint NOT NULL,
  "status" text NOT NULL,
  "deleted_at" timestamptz,
  "verified_at" timestamptz,
  "reason" text NOT NULL,
  CONSTRAINT "ingest_cleanup_items_pk" PRIMARY KEY ("id"),
  CONSTRAINT "ingest_cleanup_items_physical_copy_uq" UNIQUE NULLS NOT DISTINCT ("reconciliation_run_id", "storage_kind", "storage_location", "storage_version")
);

COMMENT ON TABLE "ingest"."cleanup_items" IS 'Inventaire des copies physiques supprimées et des vérifications de disparition. Grain: Campagne × copie physique recensée.';

COMMENT ON COLUMN "ingest"."cleanup_items"."id" IS 'Identifiant interne de la ligne, jamais substitué aux identifiants publics existants.';

COMMENT ON COLUMN "ingest"."cleanup_items"."reconciliation_run_id" IS 'Campagne acceptée qui autorise ce nettoyage.';

COMMENT ON COLUMN "ingest"."cleanup_items"."document_id" IS 'Métadonnée de source ; nullable pour copie technique de dump/ZIP.';

COMMENT ON COLUMN "ingest"."cleanup_items"."storage_kind" IS 'rds_relation, rds_payload ou s3_object.';

COMMENT ON COLUMN "ingest"."cleanup_items"."storage_location" IS 'Ancienne table/clé exacte ; métadonnée seule.';

COMMENT ON COLUMN "ingest"."cleanup_items"."storage_version" IS 'Version S3 exacte si versioning activé.';

COMMENT ON COLUMN "ingest"."cleanup_items"."bytes_before" IS 'Volume réel avant suppression.';

COMMENT ON COLUMN "ingest"."cleanup_items"."status" IS 'planned, deleted, verified_absent ou failed.';

COMMENT ON COLUMN "ingest"."cleanup_items"."deleted_at" IS 'Suppression effective.';

COMMENT ON COLUMN "ingest"."cleanup_items"."verified_at" IS 'Vérification de disparition et absence de dépendance.';

COMMENT ON COLUMN "ingest"."cleanup_items"."reason" IS 'Motif et périmètre du nettoyage.';

CREATE TABLE "ingest"."collection_jobs" (
  "source_id" bigint NOT NULL,
  "endpoint" text NOT NULL,
  "params" text NOT NULL,
  "priority" smallint DEFAULT 3 NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamptz,
  CONSTRAINT "ingest_collection_jobs_pk" PRIMARY KEY ("source_id", "endpoint", "params"),
  CONSTRAINT "ingest_collection_jobs_pro_state_ck" CHECK (state IN ('pending','running','done','unavailable')),
  CONSTRAINT "ingest_collection_jobs_pro_attempts_ck" CHECK (attempts >= 0),
  CONSTRAINT "ingest_collection_jobs_pro_lease_ck" CHECK ((state = 'running' AND lease_owner IS NOT NULL AND btrim(lease_owner) <> '' AND lease_expires_at IS NOT NULL AND attempts > 0) OR (state <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL))
);

COMMENT ON TABLE "ingest"."collection_jobs" IS 'File quotidienne/historique issue de statarena.jobs, avec baux de reprise. Grain: Source × endpoint × paramètres canoniques.';

COMMENT ON COLUMN "ingest"."collection_jobs"."source_id" IS 'Fournisseur de la requête.';

COMMENT ON COLUMN "ingest"."collection_jobs"."endpoint" IS 'Endpoint d’ingestion uniquement.';

COMMENT ON COLUMN "ingest"."collection_jobs"."params" IS 'Paramètres canoniques de la requête ; jamais une réponse fournisseur.';

COMMENT ON COLUMN "ingest"."collection_jobs"."priority" IS 'Priorité de traitement.';

COMMENT ON COLUMN "ingest"."collection_jobs"."state" IS 'État de file, distinct de disponibilité de la donnée.';

COMMENT ON COLUMN "ingest"."collection_jobs"."attempts" IS 'Tentatives exécutées.';

COMMENT ON COLUMN "ingest"."collection_jobs"."available_at" IS 'Prochaine exécution éligible.';

COMMENT ON COLUMN "ingest"."collection_jobs"."lease_owner" IS 'Worker propriétaire du bail courant.';

COMMENT ON COLUMN "ingest"."collection_jobs"."lease_expires_at" IS 'Expiration du bail ; reprise contrôlée après interruption.';

CREATE TABLE "ingest"."asset_jobs" (
  "url" text NOT NULL,
  "attempts" integer NOT NULL,
  "next_attempt" timestamptz NOT NULL,
  "error" text,
  CONSTRAINT "ingest_asset_jobs_pk" PRIMARY KEY ("url")
);

COMMENT ON TABLE "ingest"."asset_jobs" IS 'File existante de téléchargement des seuls médias indispensables. Grain: Une URL de média.';

COMMENT ON COLUMN "ingest"."asset_jobs"."url" IS 'URL de collecte du média.';

COMMENT ON COLUMN "ingest"."asset_jobs"."attempts" IS 'Tentatives.';

COMMENT ON COLUMN "ingest"."asset_jobs"."next_attempt" IS 'Prochaine tentative autorisée.';

COMMENT ON COLUMN "ingest"."asset_jobs"."error" IS 'Dernière erreur opérationnelle.';

CREATE TABLE "ingest"."dirty_editions" (
  "competition_season_id" bigint NOT NULL,
  "generation" bigint NOT NULL,
  "changed_at" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "competition_season_revision_id" bigint NOT NULL,
  CONSTRAINT "ingest_dirty_editions_pk" PRIMARY KEY ("competition_season_id")
);

COMMENT ON TABLE "ingest"."dirty_editions" IS 'Éditions affectées par des changements ; remplace dirty_partitions après mapping des identités. Grain: Une édition métier.';

COMMENT ON COLUMN "ingest"."dirty_editions"."competition_season_id" IS 'Édition à reconstruire.';

COMMENT ON COLUMN "ingest"."dirty_editions"."generation" IS 'Génération demandée ; protège des pertes d’invalidation.';

COMMENT ON COLUMN "ingest"."dirty_editions"."changed_at" IS 'Dernière modification pertinente.';

COMMENT ON COLUMN "ingest"."dirty_editions"."reason" IS 'Origine de l’invalidation.';

COMMENT ON COLUMN "ingest"."dirty_editions"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "ingest"."schema_migrations" (
  "version" text NOT NULL,
  "content_sha256" text NOT NULL,
  "applied_at" timestamptz,
  "code_commit" text,
  CONSTRAINT "ingest_schema_migrations_pk" PRIMARY KEY ("version"),
  CONSTRAINT "ingest_schema_migrations_content_hash_ck" CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE "ingest"."schema_migrations" IS 'Journal des migrations appliquées et de leurs empreintes ; reprend les versions scellées existantes. Grain: Une migration versionnée.';

COMMENT ON COLUMN "ingest"."schema_migrations"."version" IS 'Nom/version immuable de la migration.';

COMMENT ON COLUMN "ingest"."schema_migrations"."content_sha256" IS 'Empreinte du SQL effectivement appliqué.';

COMMENT ON COLUMN "ingest"."schema_migrations"."applied_at" IS 'Date réelle d’application, sans inventer celle des anciens reçus inconnus.';

COMMENT ON COLUMN "ingest"."schema_migrations"."code_commit" IS 'Commit qui porte cette migration, si connu.';

CREATE TABLE "ingest"."public_aliases" (
  "route_kind" text NOT NULL,
  "public_key" text NOT NULL,
  "player_id" bigint,
  "team_id" bigint,
  "competition_id" bigint,
  "match_id" bigint,
  "association_id" bigint,
  "venue_id" bigint,
  "coach_id" bigint,
  "profile_version_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'ingest.public_aliases' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "competition_revision_id" bigint,
  "match_revision_id" bigint,
  "venue_revision_id" bigint,
  "coach_revision_id" bigint,
  CONSTRAINT "ingest_public_aliases_sv_pk" PRIMARY KEY ("route_kind", "public_key", "recorded_from_gen"),
  CONSTRAINT "ingest_public_aliases_one_identity_ck" CHECK (num_nonnulls(player_id,team_id,competition_id,match_id,association_id,venue_id,coach_id)=1),
  CONSTRAINT "ingest_public_aliases_profile_route_ck" CHECK (profile_version_id IS NULL OR route_kind='profile'),
  CONSTRAINT "ingest_public_aliases_route_identity_ck" CHECK ((route_kind='profile' AND player_id IS NOT NULL AND profile_version_id IS NOT NULL) OR (route_kind='player' AND player_id IS NOT NULL AND profile_version_id IS NULL) OR (route_kind='team' AND team_id IS NOT NULL) OR (route_kind='competition' AND competition_id IS NOT NULL) OR (route_kind='match' AND match_id IS NOT NULL) OR (route_kind='association' AND association_id IS NOT NULL) OR (route_kind='venue' AND venue_id IS NOT NULL) OR (route_kind='coach' AND coach_id IS NOT NULL)),
  CONSTRAINT "ingest_public_aliases_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "ingest_public_aliases_sv_relation_binding_ck" CHECK (relation_code = 'ingest.public_aliases'),
  CONSTRAINT "ingest_public_aliases_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ingest_public_aliases_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "ingest_public_aliases_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "ingest_public_aliases_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "ingest_public_aliases_sv_competition_revision_id_pair_ck" CHECK ((competition_revision_id IS NULL AND (competition_id IS NULL)) OR (competition_revision_id IS NOT NULL AND competition_id IS NOT NULL)),
  CONSTRAINT "ingest_public_aliases_sv_match_revision_id_pair_ck" CHECK ((match_revision_id IS NULL AND (match_id IS NULL)) OR (match_revision_id IS NOT NULL AND match_id IS NOT NULL)),
  CONSTRAINT "ingest_public_aliases_sv_venue_revision_id_pair_ck" CHECK ((venue_revision_id IS NULL AND (venue_id IS NULL)) OR (venue_revision_id IS NOT NULL AND venue_id IS NOT NULL)),
  CONSTRAINT "ingest_public_aliases_sv_coach_revision_id_pair_ck" CHECK ((coach_revision_id IS NULL AND (coach_id IS NULL)) OR (coach_revision_id IS NOT NULL AND coach_id IS NOT NULL))
);

COMMENT ON TABLE "ingest"."public_aliases" IS 'Correspondances stables des liens publics existants vers les identités internes. Grain physique : une résolution datée, PK (route_kind, public_key, recorded_from_gen) ; clé logique (route_kind, public_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (route_kind, public_key, recorded_from_gen) ; clé logique (route_kind, public_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "ingest"."public_aliases"."route_kind" IS 'player, profile, team, competition, match, association, venue ou coach.';

COMMENT ON COLUMN "ingest"."public_aliases"."public_key" IS 'Identifiant ou slug public historique conservé exactement.';

COMMENT ON COLUMN "ingest"."public_aliases"."player_id" IS 'Identité interne si route de type player.';

COMMENT ON COLUMN "ingest"."public_aliases"."team_id" IS 'Identité interne si route de type team.';

COMMENT ON COLUMN "ingest"."public_aliases"."competition_id" IS 'Identité interne si route de type competition.';

COMMENT ON COLUMN "ingest"."public_aliases"."match_id" IS 'Identité interne si route de type match.';

COMMENT ON COLUMN "ingest"."public_aliases"."association_id" IS 'Identité interne si route de type association.';

COMMENT ON COLUMN "ingest"."public_aliases"."venue_id" IS 'Identité interne si route de type venue.';

COMMENT ON COLUMN "ingest"."public_aliases"."coach_id" IS 'Identité interne si route de type coach.';

COMMENT ON COLUMN "ingest"."public_aliases"."profile_version_id" IS 'Version de profil si l’ancien lien porte un suffixe de version.';

COMMENT ON COLUMN "ingest"."public_aliases"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "ingest"."public_aliases"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "ingest"."public_aliases"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."competition_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."venue_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "ingest"."public_aliases"."coach_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."countries" (
  "id" bigint DEFAULT nextval('football.countries_logical_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "iso2" text,
  "iso3" text,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.countries' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_countries_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_countries_sv_natural_0_generation_uq" UNIQUE ("iso2", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_countries_sv_natural_1_generation_uq" UNIQUE ("iso3", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_countries_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_countries_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_countries_iso2_format_ck" CHECK (iso2 ~ '^[A-Z]{2}$'),
  CONSTRAINT "football_countries_iso3_format_ck" CHECK (iso3 ~ '^[A-Z]{3}$'),
  CONSTRAINT "football_countries_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_countries_sv_relation_binding_ck" CHECK (relation_code = 'football.countries'),
  CONSTRAINT "football_countries_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_countries_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_countries_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_countries_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_countries_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."countries" IS 'Territoires géographiques; les fédérations sportives sont séparées. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."countries"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."countries"."name" IS 'Nom de l’entité dans le contexte défini par cette table.';

COMMENT ON COLUMN "football"."countries"."iso2" IS 'Code ISO à deux lettres uniquement lorsqu’il existe.';

COMMENT ON COLUMN "football"."countries"."iso3" IS 'Code ISO à trois lettres uniquement lorsqu’il existe.';

COMMENT ON COLUMN "football"."countries"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."countries"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."countries"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."countries"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."countries"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."associations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name" text NOT NULL,
  "federation_code" text,
  "country_id" bigint,
  "confederation_code" text,
  "country_revision_id" bigint,
  CONSTRAINT "football_associations_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_associations_sv_country_revision_id_pair_ck" CHECK ((country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL))
);

COMMENT ON TABLE "football"."associations" IS 'Fédérations sportives. Grain: Une fédération.';

COMMENT ON COLUMN "football"."associations"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."associations"."name" IS 'Nom de l’entité dans le contexte défini par cette table.';

COMMENT ON COLUMN "football"."associations"."federation_code" IS 'Code de la fédération sportive, distinct d’un ISO.';

COMMENT ON COLUMN "football"."associations"."country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."associations"."confederation_code" IS 'Code de la confédération sportive.';

COMMENT ON COLUMN "football"."associations"."country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."positions" (
  "code" text NOT NULL,
  "label" text NOT NULL,
  "family" text NOT NULL,
  "definition" text NOT NULL,
  "definition_version" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "relation_code" text DEFAULT 'football.positions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_positions_sv_pk" PRIMARY KEY ("code", "definition_version"),
  CONSTRAINT "football_positions_family_ck" CHECK (family IN ('goalkeeper', 'defender', 'midfielder', 'forward')),
  CONSTRAINT "football_positions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_positions_sv_relation_binding_ck" CHECK (relation_code = 'football.positions'),
  CONSTRAINT "football_positions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_positions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_positions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_positions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_positions_sv_definition_version_nonempty_ck" CHECK (btrim(definition_version) <> '')
);

COMMENT ON TABLE "football"."positions" IS 'Rôles canoniques dont la définition est validée. Grain physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."positions"."code" IS 'Code stable du référentiel, avec sa définition explicite.';

COMMENT ON COLUMN "football"."positions"."label" IS 'Libellé d’affichage du code ou de l’édition.';

COMMENT ON COLUMN "football"."positions"."family" IS 'Famille de poste : gardien, défenseur, milieu ou attaquant.';

COMMENT ON COLUMN "football"."positions"."definition" IS 'Définition sémantique du code et de ses conditions d’utilisation.';

COMMENT ON COLUMN "football"."positions"."definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."positions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."positions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."positions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."periods" (
  "code" text NOT NULL,
  "label" text NOT NULL,
  "sequence_no" integer NOT NULL,
  "is_aggregate" boolean NOT NULL,
  "definition" text NOT NULL,
  "definition_version" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "relation_code" text DEFAULT 'football.periods' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_periods_sv_pk" PRIMARY KEY ("code", "definition_version"),
  CONSTRAINT "football_periods_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_periods_sv_relation_binding_ck" CHECK (relation_code = 'football.periods'),
  CONSTRAINT "football_periods_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_periods_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_periods_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_periods_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_periods_sv_definition_version_nonempty_ck" CHECK (btrim(definition_version) <> '')
);

COMMENT ON TABLE "football"."periods" IS 'Périodes explicites; full_match ne s’ajoute pas à ses composantes. Grain physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."periods"."code" IS 'Code stable du référentiel, avec sa définition explicite.';

COMMENT ON COLUMN "football"."periods"."label" IS 'Libellé d’affichage du code ou de l’édition.';

COMMENT ON COLUMN "football"."periods"."sequence_no" IS 'Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire.';

COMMENT ON COLUMN "football"."periods"."is_aggregate" IS 'Indique qu’une période recouvre d’autres périodes ; empêche leur addition naïve.';

COMMENT ON COLUMN "football"."periods"."definition" IS 'Définition sémantique du code et de ses conditions d’utilisation.';

COMMENT ON COLUMN "football"."periods"."definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."periods"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."periods"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."periods"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."venues" (
  "id" bigint DEFAULT nextval('football.venues_logical_id_seq'::regclass) NOT NULL,
  "name" text,
  "city" text,
  "country_id" bigint,
  "latitude" double precision,
  "longitude" double precision,
  "capacity" integer,
  "capacity_as_of" date,
  "opened_year" integer,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.venues' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "country_revision_id" bigint,
  CONSTRAINT "football_venues_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_venues_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_venues_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_venues_latitude_ck" CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT "football_venues_longitude_ck" CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT "football_venues_capacity_nonnegative_ck" CHECK (capacity >= 0),
  CONSTRAINT "football_venues_opened_year_ck" CHECK (opened_year > 0),
  CONSTRAINT "football_venues_latitude_finite_ck" CHECK (latitude NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_venues_longitude_finite_ck" CHECK (longitude NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_venues_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_venues_sv_relation_binding_ck" CHECK (relation_code = 'football.venues'),
  CONSTRAINT "football_venues_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_venues_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_venues_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_venues_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_venues_sv_country_revision_id_pair_ck" CHECK ((country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)),
  CONSTRAINT "football_venues_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."venues" IS 'Stades et caractéristiques datées lorsqu’elles évoluent. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."venues"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."venues"."name" IS 'Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif.';

COMMENT ON COLUMN "football"."venues"."city" IS 'Ville du stade, si connue.';

COMMENT ON COLUMN "football"."venues"."country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."venues"."latitude" IS 'Latitude géographique du stade, entre −90 et 90.';

COMMENT ON COLUMN "football"."venues"."longitude" IS 'Longitude géographique du stade, entre −180 et 180.';

COMMENT ON COLUMN "football"."venues"."capacity" IS 'Capacité du stade observée à capacity_as_of.';

COMMENT ON COLUMN "football"."venues"."capacity_as_of" IS 'Date de validité connue de la capacité.';

COMMENT ON COLUMN "football"."venues"."opened_year" IS 'Année d’ouverture connue ; une date imprécise ne devient pas une année inventée.';

COMMENT ON COLUMN "football"."venues"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."venues"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."venues"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."venues"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venues"."country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."coaches" (
  "id" bigint DEFAULT nextval('football.coaches_logical_id_seq'::regclass) NOT NULL,
  "display_name" text,
  "birth_date" date,
  "nationality_country_id" bigint,
  "image_asset_id" bigint,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.coaches' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "nationality_country_revision_id" bigint,
  CONSTRAINT "football_coaches_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_coaches_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_coaches_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_coaches_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_coaches_sv_relation_binding_ck" CHECK (relation_code = 'football.coaches'),
  CONSTRAINT "football_coaches_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_coaches_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_coaches_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_coaches_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_coaches_sv_nationality_country_revision_id_pair_ck" CHECK ((nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)),
  CONSTRAINT "football_coaches_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."coaches" IS 'Identités d’entraîneurs; ne pas fusionner sur le seul nom. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."coaches"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."coaches"."display_name" IS 'Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif.';

COMMENT ON COLUMN "football"."coaches"."birth_date" IS 'Date de naissance connue de la personne.';

COMMENT ON COLUMN "football"."coaches"."nationality_country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."coaches"."image_asset_id" IS 'Référence SQL vers ingest.media_assets(id).';

COMMENT ON COLUMN "football"."coaches"."created_at" IS 'Création de cette ligne dans le système.';

COMMENT ON COLUMN "football"."coaches"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."coaches"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."coaches"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."coaches"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coaches"."nationality_country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."competitions" (
  "id" bigint DEFAULT nextval('football.competitions_logical_id_seq'::regclass) NOT NULL,
  "name" text,
  "slug" text NOT NULL,
  "competition_type" text NOT NULL,
  "association_id" bigint,
  "country_id" bigint,
  "gender" text NOT NULL,
  "age_category" text,
  "image_asset_id" bigint,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.competitions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "country_revision_id" bigint,
  CONSTRAINT "football_competitions_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_competitions_sv_natural_0_generation_uq" UNIQUE ("slug", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competitions_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_competitions_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competitions_competition_type_ck" CHECK (competition_type IN ('league', 'cup', 'tournament', 'supercup', 'friendly', 'other', 'unknown')),
  CONSTRAINT "football_competitions_gender_ck" CHECK (gender IN ('men', 'women', 'mixed', 'unknown')),
  CONSTRAINT "football_competitions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_competitions_sv_relation_binding_ck" CHECK (relation_code = 'football.competitions'),
  CONSTRAINT "football_competitions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_competitions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_competitions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_competitions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_competitions_sv_country_revision_id_pair_ck" CHECK ((country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)),
  CONSTRAINT "football_competitions_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."competitions" IS 'Compétitions stables indépendamment des saisons. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."competitions"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."competitions"."name" IS 'Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif.';

COMMENT ON COLUMN "football"."competitions"."slug" IS 'Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases.';

COMMENT ON COLUMN "football"."competitions"."competition_type" IS 'Nature league, cup, tournament, supercup, friendly, other ou unknown.';

COMMENT ON COLUMN "football"."competitions"."association_id" IS 'Référence SQL vers football.associations(id).';

COMMENT ON COLUMN "football"."competitions"."country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."competitions"."gender" IS 'Catégorie sportive déclarée : men, women, mixed ou unknown.';

COMMENT ON COLUMN "football"."competitions"."age_category" IS 'Catégorie d’âge déclarée ; ne pas la déduire sans preuve.';

COMMENT ON COLUMN "football"."competitions"."image_asset_id" IS 'Référence SQL vers ingest.media_assets(id).';

COMMENT ON COLUMN "football"."competitions"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."competitions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."competitions"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."competitions"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competitions"."country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."competition_seasons" (
  "id" bigint DEFAULT nextval('football.competition_seasons_logical_id_seq'::regclass) NOT NULL,
  "competition_id" bigint NOT NULL,
  "season_key" text NOT NULL,
  "label" text NOT NULL,
  "start_date" date,
  "end_date" date,
  "status" text DEFAULT 'unknown' NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.competition_seasons' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "competition_revision_id" bigint NOT NULL,
  CONSTRAINT "football_competition_seasons_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_competition_seasons_sv_natural_0_generation_uq" UNIQUE ("competition_id", "season_key", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_seasons_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_competition_seasons_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_seasons_status_ck" CHECK (status IN ('planned', 'active', 'completed', 'cancelled', 'unknown')),
  CONSTRAINT "football_competition_seasons_end_date_after_start_date_ck" CHECK (end_date >= start_date),
  CONSTRAINT "football_competition_seasons_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_competition_seasons_sv_relation_binding_ck" CHECK (relation_code = 'football.competition_seasons'),
  CONSTRAINT "football_competition_seasons_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_competition_seasons_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_competition_seasons_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_competition_seasons_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_competition_seasons_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."competition_seasons" IS 'Éditions métier; leur clé ne se déduit pas du nom du dossier. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."competition_seasons"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."competition_seasons"."competition_id" IS 'Référence SQL vers football.competitions(id, revision_id).';

COMMENT ON COLUMN "football"."competition_seasons"."season_key" IS 'Saison métier de l’édition : par exemple 2026 ou 2026/2027 ; jamais déduite du seul répertoire.';

COMMENT ON COLUMN "football"."competition_seasons"."label" IS 'Libellé d’affichage du code ou de l’édition.';

COMMENT ON COLUMN "football"."competition_seasons"."start_date" IS 'Première date métier connue de l’édition.';

COMMENT ON COLUMN "football"."competition_seasons"."end_date" IS 'Dernière date métier connue de l’édition.';

COMMENT ON COLUMN "football"."competition_seasons"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "football"."competition_seasons"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."competition_seasons"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."competition_seasons"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."competition_seasons"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_seasons"."competition_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."competition_stages" (
  "id" bigint DEFAULT nextval('football.competition_stages_logical_id_seq'::regclass) NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "parent_stage_id" bigint,
  "stage_key" text NOT NULL,
  "stage_type" text NOT NULL,
  "name" text NOT NULL,
  "sequence_no" integer,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.competition_stages' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "competition_season_revision_id" bigint NOT NULL,
  "parent_stage_revision_id" bigint,
  CONSTRAINT "football_competition_stages_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_competition_stages_sv_natural_0_generation_uq" UNIQUE ("competition_season_id", "stage_key", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_stages_sv_natural_1_generation_uq" UNIQUE ("id", "competition_season_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_stages_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_competition_stages_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_stages_sv_anchor_id_competition_053cfa703e" UNIQUE ("id", "competition_season_id", "revision_id"),
  CONSTRAINT "football_competition_stages_no_self_parent_ck" CHECK (parent_stage_id <> id),
  CONSTRAINT "football_competition_stages_stage_type_ck" CHECK (stage_type IN ('league', 'group', 'knockout', 'qualifying', 'playoff', 'final', 'other', 'unknown')),
  CONSTRAINT "football_competition_stages_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_competition_stages_sv_relation_binding_ck" CHECK (relation_code = 'football.competition_stages'),
  CONSTRAINT "football_competition_stages_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_competition_stages_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_competition_stages_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_competition_stages_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_competition_stages_sv_parent_stage_revision_id_pair_ck" CHECK ((parent_stage_revision_id IS NULL AND (parent_stage_id IS NULL)) OR (parent_stage_revision_id IS NOT NULL AND parent_stage_id IS NOT NULL AND competition_season_id IS NOT NULL)),
  CONSTRAINT "football_competition_stages_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."competition_stages" IS 'Phases d’une édition et leur hiérarchie. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."competition_stages"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."competition_stages"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id); football.competition_stages(id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."competition_stages"."parent_stage_id" IS 'Référence SQL vers football.competition_stages(id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."competition_stages"."stage_key" IS 'Clé de phase unique dans son édition.';

COMMENT ON COLUMN "football"."competition_stages"."stage_type" IS 'Type de phase défini par les valeurs autorisées.';

COMMENT ON COLUMN "football"."competition_stages"."name" IS 'Nom de l’entité dans le contexte défini par cette table.';

COMMENT ON COLUMN "football"."competition_stages"."sequence_no" IS 'Ordre explicite de présentation ; ne pas déduire d’une clé arbitraire.';

COMMENT ON COLUMN "football"."competition_stages"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."competition_stages"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."competition_stages"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."competition_stages"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_stages"."parent_stage_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."competition_groups" (
  "id" bigint DEFAULT nextval('football.competition_groups_logical_id_seq'::regclass) NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "stage_id" bigint NOT NULL,
  "group_key" text NOT NULL,
  "name" text NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.competition_groups' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "stage_revision_id" bigint NOT NULL,
  CONSTRAINT "football_competition_groups_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_competition_groups_sv_natural_0_generation_uq" UNIQUE ("stage_id", "group_key", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_groups_sv_natural_1_generation_uq" UNIQUE ("id", "stage_id", "competition_season_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_groups_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_competition_groups_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_groups_sv_anchor_id_stage_id_co_23e1e2ea41" UNIQUE ("id", "stage_id", "competition_season_id", "revision_id"),
  CONSTRAINT "football_competition_groups_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_competition_groups_sv_relation_binding_ck" CHECK (relation_code = 'football.competition_groups'),
  CONSTRAINT "football_competition_groups_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_competition_groups_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_competition_groups_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_competition_groups_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_competition_groups_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."competition_groups" IS 'Groupes rattachés à une phase de la même édition. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."competition_groups"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."competition_groups"."competition_season_id" IS 'Référence SQL vers football.competition_stages(id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."competition_groups"."stage_id" IS 'Référence SQL vers football.competition_stages(id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."competition_groups"."group_key" IS 'Clé de groupe unique dans sa phase.';

COMMENT ON COLUMN "football"."competition_groups"."name" IS 'Nom de l’entité dans le contexte défini par cette table.';

COMMENT ON COLUMN "football"."competition_groups"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."competition_groups"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."competition_groups"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."competition_groups"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_groups"."stage_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."teams" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name" text,
  "short_name" text,
  "slug" text NOT NULL,
  "team_type" text NOT NULL,
  "gender" text NOT NULL,
  "age_category" text,
  "country_id" bigint,
  "association_id" bigint,
  "image_asset_id" bigint,
  "founded_year" integer,
  "country_revision_id" bigint,
  CONSTRAINT "football_teams_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_teams_slug_uq" UNIQUE ("slug"),
  CONSTRAINT "football_teams_team_type_ck" CHECK (team_type IN ('club', 'national', 'representative', 'unknown')),
  CONSTRAINT "football_teams_gender_ck" CHECK (gender IN ('men', 'women', 'mixed', 'unknown')),
  CONSTRAINT "football_teams_founded_year_ck" CHECK (founded_year > 0),
  CONSTRAINT "football_teams_sv_country_revision_id_pair_ck" CHECK ((country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL))
);

COMMENT ON TABLE "football"."teams" IS 'Équipes sportives, distinctes des fédérations et des organisations futures. Grain: Une équipe.';

COMMENT ON COLUMN "football"."teams"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."teams"."name" IS 'Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif.';

COMMENT ON COLUMN "football"."teams"."short_name" IS 'Nom court observé.';

COMMENT ON COLUMN "football"."teams"."slug" IS 'Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases.';

COMMENT ON COLUMN "football"."teams"."team_type" IS 'Club, sélection nationale, équipe représentative ou type inconnu.';

COMMENT ON COLUMN "football"."teams"."gender" IS 'Catégorie sportive déclarée : men, women, mixed ou unknown.';

COMMENT ON COLUMN "football"."teams"."age_category" IS 'Catégorie d’âge déclarée ; ne pas la déduire sans preuve.';

COMMENT ON COLUMN "football"."teams"."country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."teams"."association_id" IS 'Référence SQL vers football.associations(id).';

COMMENT ON COLUMN "football"."teams"."image_asset_id" IS 'Référence SQL vers ingest.media_assets(id).';

COMMENT ON COLUMN "football"."teams"."founded_year" IS 'Année de fondation lorsqu’elle est sourcée.';

COMMENT ON COLUMN "football"."teams"."country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."competition_teams" (
  "competition_season_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "entered_on" date,
  "exited_on" date,
  "status" text DEFAULT 'observed' NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.competition_teams' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "competition_season_revision_id" bigint NOT NULL,
  CONSTRAINT "football_competition_teams_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_competition_teams_sv_logical_revision_uq" UNIQUE ("competition_season_id", "team_id", "revision_id"),
  CONSTRAINT "football_competition_teams_sv_variant_generation_uq" UNIQUE ("competition_season_id", "team_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_competition_teams_status_ck" CHECK (status IN ('observed', 'confirmed', 'withdrawn', 'disqualified')),
  CONSTRAINT "football_competition_teams_exited_on_after_entered_on_ck" CHECK (exited_on >= entered_on),
  CONSTRAINT "football_competition_teams_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_competition_teams_sv_relation_binding_ck" CHECK (relation_code = 'football.competition_teams'),
  CONSTRAINT "football_competition_teams_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_competition_teams_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_competition_teams_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_competition_teams_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_competition_teams_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."competition_teams" IS 'Engagements d’une équipe dans une édition. Grain physique : une révision typée, PK (revision_id) ; clé logique (competition_season_id, team_id), variante variant_key ; sélection canonique (competition_season_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (competition_season_id, team_id), variante variant_key ; sélection canonique (competition_season_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."competition_teams"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id).';

COMMENT ON COLUMN "football"."competition_teams"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."competition_teams"."entered_on" IS 'Date d’engagement de l’équipe dans l’édition si réellement connue.';

COMMENT ON COLUMN "football"."competition_teams"."exited_on" IS 'Date de sortie de l’édition si réellement connue.';

COMMENT ON COLUMN "football"."competition_teams"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "football"."competition_teams"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."competition_teams"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."competition_teams"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."competition_teams"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_teams"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."players" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "display_name" text,
  "birth_date" date,
  "nationality_country_id" bigint,
  "dominant_foot" text,
  "height_cm" smallint,
  "primary_position_code" text,
  "created_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "nationality_country_revision_id" bigint,
  "primary_position_definition_version" text,
  CONSTRAINT "football_players_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_players_dominant_foot_ck" CHECK (dominant_foot IN ('left', 'right', 'both', 'unknown')),
  CONSTRAINT "football_players_height_ck" CHECK (height_cm > 0),
  CONSTRAINT "football_players_sv_nationality_country_revision_id_pair_ck" CHECK ((nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)),
  CONSTRAINT "football_players_sv_primary_position_definition_version_pair_ck" CHECK ((primary_position_code IS NULL) = (primary_position_definition_version IS NULL)),
  CONSTRAINT "football_players_sv_primary_position_definition_vers_0e8990b2c3" CHECK (primary_position_definition_version IS NULL OR (btrim(primary_position_definition_version) <> ''))
);

COMMENT ON TABLE "football"."players" IS 'Identités stables de joueurs; une ligne indépendante des profils source. Grain: Une personne joueur.';

COMMENT ON COLUMN "football"."players"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."players"."display_name" IS 'Nom réellement connu ; NULL si identité référencée sans nom disponible, aucun nom fictif.';

COMMENT ON COLUMN "football"."players"."birth_date" IS 'Date de naissance connue de la personne.';

COMMENT ON COLUMN "football"."players"."nationality_country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."players"."dominant_foot" IS 'Pied dominant connu : left, right, both ou unknown.';

COMMENT ON COLUMN "football"."players"."height_cm" IS 'Taille connue en centimètres.';

COMMENT ON COLUMN "football"."players"."primary_position_code" IS 'Référence SQL vers football.positions(code, definition_version).';

COMMENT ON COLUMN "football"."players"."created_at" IS 'Création de cette ligne dans le système.';

COMMENT ON COLUMN "football"."players"."nationality_country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."players"."primary_position_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."player_profile_versions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "player_id" bigint NOT NULL,
  "external_profile_version_id" text NOT NULL,
  "display_name" text NOT NULL,
  "image_asset_id" bigint,
  "observed_at" timestamptz NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "short_name" text,
  "country_code_source" text,
  "raw_position_code" text,
  "shirt_number" text,
  "birth_date" date,
  "height_cm" smallint,
  "dominant_foot" text,
  "profile_content_sha256" text NOT NULL,
  "nationality_country_id" bigint,
  "primary_position_code" text,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "profile_context" text NOT NULL,
  "relation_code" text DEFAULT 'football.player_profile_versions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "nationality_country_revision_id" bigint,
  "primary_position_definition_version" text,
  "raw_position_code_state" text NOT NULL,
  "raw_position_code_source_number" numeric,
  "shirt_number_state" text NOT NULL,
  "shirt_number_source_number" numeric,
  CONSTRAINT "football_player_profile_versions_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_player_profile_versions_sv_natural_0_generation_uq" UNIQUE ("source_id", "external_profile_version_id", "profile_content_sha256", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_profile_versions_id_player_id_uq" UNIQUE ("id", "player_id"),
  CONSTRAINT "football_player_profile_versions_sv_profile_generation_uq" UNIQUE ("player_id", "profile_context", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_profile_versions_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_player_profile_versions_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_player_profile_versions_profile_hash_ck" CHECK (profile_content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_profile_versions_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_player_profile_versions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_profile_versions_sv_relation_binding_ck" CHECK (relation_code = 'football.player_profile_versions'),
  CONSTRAINT "football_player_profile_versions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_profile_versions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_profile_versions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_player_profile_versions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_player_profile_versions_sv_nationality_coun_d7f227f69f" CHECK ((nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)),
  CONSTRAINT "football_player_profile_versions_sv_primary_position_dddf33aa6f" CHECK ((primary_position_code IS NULL) = (primary_position_definition_version IS NULL)),
  CONSTRAINT "football_player_profile_versions_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_player_profile_versions_sv_profile_context_nonempty_ck" CHECK (btrim(profile_context) <> ''),
  CONSTRAINT "football_player_profile_versions_sv_primary_position_461cfcf7be" CHECK (primary_position_definition_version IS NULL OR (btrim(primary_position_definition_version) <> '')),
  CONSTRAINT "football_player_profile_versions_sv_raw_position_cod_79888c775b" CHECK ((raw_position_code_state IN ('absent','null') AND raw_position_code IS NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'string' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'number' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NOT NULL AND raw_position_code_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN raw_position_code ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN raw_position_code::numeric = raw_position_code_source_number ELSE false END)),
  CONSTRAINT "football_player_profile_versions_sv_shirt_number_nat_a2b1604cc3" CHECK ((shirt_number_state IN ('absent','null') AND shirt_number IS NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'string' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'number' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NOT NULL AND shirt_number_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN shirt_number ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN shirt_number::numeric = shirt_number_source_number ELSE false END))
);

COMMENT ON TABLE "football"."player_profile_versions" IS 'Profils observés versionnés, distincts de playerId. Grain physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (player_id, profile_context), variante variant_key ; sélection canonique (player_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (player_id, profile_context), variante variant_key ; sélection canonique (player_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_profile_versions"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."player_profile_versions"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."player_profile_versions"."external_profile_version_id" IS 'Ancien identifiant public de version de profil, distinct de l’identité joueur.';

COMMENT ON COLUMN "football"."player_profile_versions"."display_name" IS 'Nom d’affichage observé ou sélectionné pour cette identité.';

COMMENT ON COLUMN "football"."player_profile_versions"."image_asset_id" IS 'Référence SQL vers ingest.media_assets(id).';

COMMENT ON COLUMN "football"."player_profile_versions"."observed_at" IS 'Instant auquel l’information a été observée ; ne prouve pas une date de validité métier.';

COMMENT ON COLUMN "football"."player_profile_versions"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."player_profile_versions"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_profile_versions"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."player_profile_versions"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."player_profile_versions"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."player_profile_versions"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."player_profile_versions"."short_name" IS 'Nom court fournisseur.';

COMMENT ON COLUMN "football"."player_profile_versions"."country_code_source" IS 'Code pays natif, distinct d’un ISO déduit.';

COMMENT ON COLUMN "football"."player_profile_versions"."raw_position_code" IS 'Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local.';

COMMENT ON COLUMN "football"."player_profile_versions"."shirt_number" IS 'Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local.';

COMMENT ON COLUMN "football"."player_profile_versions"."birth_date" IS 'Date de naissance observée dans cette version, si disponible.';

COMMENT ON COLUMN "football"."player_profile_versions"."height_cm" IS 'Taille observée dans cette version, en centimètres.';

COMMENT ON COLUMN "football"."player_profile_versions"."dominant_foot" IS 'Pied dominant observé dans cette version, si disponible.';

COMMENT ON COLUMN "football"."player_profile_versions"."profile_content_sha256" IS 'Empreinte des attributs typés du profil ; l’ancien ID peut être réutilisé avec d’autres attributs.';

COMMENT ON COLUMN "football"."player_profile_versions"."nationality_country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."player_profile_versions"."primary_position_code" IS 'Référence SQL vers football.positions(code, definition_version).';

COMMENT ON COLUMN "football"."player_profile_versions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_profile_versions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_profile_versions"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."player_profile_versions"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."profile_context" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."nationality_country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."primary_position_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."raw_position_code_state" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."raw_position_code_source_number" IS 'Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé.';

COMMENT ON COLUMN "football"."player_profile_versions"."shirt_number_state" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_profile_versions"."shirt_number_source_number" IS 'Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé.';

CREATE TABLE "football"."position_mappings" (
  "source_id" bigint NOT NULL,
  "raw_position_code" text NOT NULL,
  "mapping_version" text NOT NULL,
  "position_code" text,
  "status" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "relation_code" text DEFAULT 'football.position_mappings' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "position_definition_version" text,
  CONSTRAINT "football_position_mappings_pk" PRIMARY KEY ("source_id", "raw_position_code", "mapping_version"),
  CONSTRAINT "football_position_mappings_sv_mapped_definition_anchor_uq" UNIQUE ("source_id", "raw_position_code", "mapping_version", "position_code", "position_definition_version"),
  CONSTRAINT "football_position_mappings_evidence_kind_ck" CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT "football_position_mappings_status_ck" CHECK (status IN ('unresolved', 'validated', 'rejected')),
  CONSTRAINT "football_position_mappings_validated_position_ck" CHECK (status <> 'validated' OR position_code IS NOT NULL),
  CONSTRAINT "football_position_mappings_evidence_bounded_ck" CHECK (octet_length(evidence::text)<=16384),
  CONSTRAINT "football_position_mappings_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_position_mappings_sv_relation_binding_ck" CHECK (relation_code = 'football.position_mappings'),
  CONSTRAINT "football_position_mappings_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_position_mappings_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_position_mappings_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_position_mappings_sv_position_definition_ve_8ba3ff4bca" CHECK ((position_code IS NULL) = (position_definition_version IS NULL)),
  CONSTRAINT "football_position_mappings_sv_mapping_version_nonempty_ck" CHECK (btrim(mapping_version) <> ''),
  CONSTRAINT "football_position_mappings_sv_position_definition_ve_d44ae052be" CHECK (position_definition_version IS NULL OR (btrim(position_definition_version) <> ''))
);

COMMENT ON TABLE "football"."position_mappings" IS 'Traductions versionnées des codes de poste fournisseur. Grain physique : un mapping immuable identifié par mapping_version, PK (source_id, raw_position_code, mapping_version) ; clé logique (source_id, raw_position_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : un mapping immuable identifié par mapping_version, PK (source_id, raw_position_code, mapping_version) ; clé logique (source_id, raw_position_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."position_mappings"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."position_mappings"."raw_position_code" IS 'Code natif du poste ; résolution uniquement avec une version de mapping validée.';

COMMENT ON COLUMN "football"."position_mappings"."mapping_version" IS 'Version de la traduction des valeurs fournisseur.';

COMMENT ON COLUMN "football"."position_mappings"."position_code" IS 'Référence SQL vers football.positions(code, definition_version).';

COMMENT ON COLUMN "football"."position_mappings"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "football"."position_mappings"."evidence" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "football"."position_mappings"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."position_mappings"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."position_mappings"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."position_mappings"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."position_mappings"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."position_mappings"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."position_mappings"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."position_mappings"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."position_mappings"."position_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."player_team_memberships" (
  "id" bigint DEFAULT nextval('football.player_team_memberships_logical_id_seq'::regclass) NOT NULL,
  "player_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "membership_type" text NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "date_precision" text NOT NULL,
  "observed_from" date,
  "observed_to" date,
  "evidence_kind" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.player_team_memberships' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_player_team_memberships_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_player_team_memberships_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_player_team_memberships_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_team_memberships_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_player_team_memberships_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_player_team_memberships_membership_type_ck" CHECK (membership_type IN ('club', 'loan', 'national', 'observed', 'other')),
  CONSTRAINT "football_player_team_memberships_date_precision_ck" CHECK (date_precision IN ('day', 'month', 'year', 'unknown')),
  CONSTRAINT "football_player_team_memberships_evidence_kind_ck" CHECK (evidence_kind IN ('official_roster', 'contract', 'match_observation', 'provider_profile', 'manual_review')),
  CONSTRAINT "football_player_team_memberships_valid_to_after_valid_from_ck" CHECK (valid_to >= valid_from),
  CONSTRAINT "football_player_team_memberships_observed_to_after_ob_e94e46fcc" CHECK (observed_to >= observed_from),
  CONSTRAINT "football_player_team_memberships_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_player_team_memberships_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_team_memberships_sv_relation_binding_ck" CHECK (relation_code = 'football.player_team_memberships'),
  CONSTRAINT "football_player_team_memberships_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_team_memberships_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_team_memberships_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_player_team_memberships_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_player_team_memberships_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."player_team_memberships" IS 'Appartenances confirmées ou observations de participation. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_team_memberships"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."player_team_memberships"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."player_team_memberships"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."player_team_memberships"."membership_type" IS 'Appartenance club, prêt, sélection, observation ou autre ; simultanéité club/sélection permise.';

COMMENT ON COLUMN "football"."player_team_memberships"."valid_from" IS 'Début de validité connu, sans remplacer une observation par une date de signature.';

COMMENT ON COLUMN "football"."player_team_memberships"."valid_to" IS 'Fin de validité connue ; NULL conserve une borne inconnue.';

COMMENT ON COLUMN "football"."player_team_memberships"."date_precision" IS 'Précision réelle des dates : day, month, year ou unknown.';

COMMENT ON COLUMN "football"."player_team_memberships"."observed_from" IS 'Première observation de l’appartenance.';

COMMENT ON COLUMN "football"."player_team_memberships"."observed_to" IS 'Dernière observation de l’appartenance.';

COMMENT ON COLUMN "football"."player_team_memberships"."evidence_kind" IS 'Nature de preuve : contrat, effectif, match, profil ou revue manuelle.';

COMMENT ON COLUMN "football"."player_team_memberships"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."player_team_memberships"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_team_memberships"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."player_team_memberships"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."player_team_memberships"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."player_team_memberships"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."player_team_memberships"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_team_memberships"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_team_memberships"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."player_team_memberships"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_team_memberships"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_aliases" (
  "id" bigint DEFAULT nextval('football.team_aliases_logical_id_seq'::regclass) NOT NULL,
  "team_id" bigint NOT NULL,
  "alias" text NOT NULL,
  "language_code" text,
  "source_id" bigint,
  "valid_from" date,
  "valid_to" date,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_aliases' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_team_aliases_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_team_aliases_sv_natural_0_generation_uq" UNIQUE NULLS NOT DISTINCT ("team_id", "alias", "language_code", "source_id", "valid_from", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_aliases_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_team_aliases_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_aliases_valid_to_after_valid_from_ck" CHECK (valid_to >= valid_from),
  CONSTRAINT "football_team_aliases_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_aliases_sv_relation_binding_ck" CHECK (relation_code = 'football.team_aliases'),
  CONSTRAINT "football_team_aliases_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_aliases_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_aliases_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_aliases_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_aliases_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."team_aliases" IS 'Noms alternatifs ou historiques pour l’affichage et la résolution. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_aliases"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."team_aliases"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."team_aliases"."alias" IS 'Nom alternatif ou historique d’une équipe, conservé avec langue, source et validité.';

COMMENT ON COLUMN "football"."team_aliases"."language_code" IS 'Langue de cet alias lorsqu’elle est connue.';

COMMENT ON COLUMN "football"."team_aliases"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."team_aliases"."valid_from" IS 'Début de validité connu, sans remplacer une observation par une date de signature.';

COMMENT ON COLUMN "football"."team_aliases"."valid_to" IS 'Fin de validité connue ; NULL conserve une borne inconnue.';

COMMENT ON COLUMN "football"."team_aliases"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_aliases"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_aliases"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_aliases"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_aliases"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."competition_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "competition_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.competition_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "competition_revision_id" bigint NOT NULL,
  CONSTRAINT "football_competition_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_competition_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_competition_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.competition_source_ids'),
  CONSTRAINT "football_competition_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_competition_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_competition_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."competition_source_ids" IS 'Identifiants externes typés de competition. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."competition_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."competition_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."competition_source_ids"."competition_id" IS 'Référence SQL vers football.competitions(id, revision_id).';

COMMENT ON COLUMN "football"."competition_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."competition_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."competition_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."competition_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."competition_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."competition_source_ids"."competition_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "team_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_team_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_team_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.team_source_ids'),
  CONSTRAINT "football_team_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."team_source_ids" IS 'Identifiants externes typés de team. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."team_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."team_source_ids"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."team_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."team_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."player_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "player_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.player_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_player_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_player_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.player_source_ids'),
  CONSTRAINT "football_player_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."player_source_ids" IS 'Identifiants externes typés de player. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."player_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."player_source_ids"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."player_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."player_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."association_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "association_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.association_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "football_association_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_association_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_association_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.association_source_ids'),
  CONSTRAINT "football_association_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_association_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_association_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."association_source_ids" IS 'Identifiants externes typés de association. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."association_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."association_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."association_source_ids"."association_id" IS 'Référence SQL vers football.associations(id).';

COMMENT ON COLUMN "football"."association_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."association_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."association_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."association_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."association_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."venue_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "venue_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.venue_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "venue_revision_id" bigint NOT NULL,
  CONSTRAINT "football_venue_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_venue_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_venue_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.venue_source_ids'),
  CONSTRAINT "football_venue_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_venue_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_venue_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."venue_source_ids" IS 'Identifiants externes typés de venue. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."venue_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."venue_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."venue_source_ids"."venue_id" IS 'Référence SQL vers football.venues(id, revision_id).';

COMMENT ON COLUMN "football"."venue_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."venue_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."venue_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."venue_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."venue_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venue_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venue_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venue_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venue_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venue_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."venue_source_ids"."venue_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."coach_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "coach_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.coach_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "coach_revision_id" bigint NOT NULL,
  CONSTRAINT "football_coach_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_coach_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_coach_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.coach_source_ids'),
  CONSTRAINT "football_coach_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_coach_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_coach_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."coach_source_ids" IS 'Identifiants externes typés de coach. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."coach_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."coach_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."coach_source_ids"."coach_id" IS 'Référence SQL vers football.coaches(id, revision_id).';

COMMENT ON COLUMN "football"."coach_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."coach_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."coach_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."coach_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."coach_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coach_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coach_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coach_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coach_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coach_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."coach_source_ids"."coach_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."matches" (
  "id" bigint DEFAULT nextval('football.matches_logical_id_seq'::regclass) NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "stage_id" bigint,
  "group_id" bigint,
  "round_label" text,
  "round_number" integer,
  "leg_number" smallint,
  "tie_key" text,
  "match_date" date,
  "kickoff_at" timestamptz,
  "kickoff_precision" text NOT NULL,
  "source_timezone" text,
  "status" text NOT NULL,
  "publication_state" text DEFAULT 'draft' NOT NULL,
  "venue_id" bigint,
  "neutral_venue" boolean,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.matches' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "competition_season_revision_id" bigint NOT NULL,
  "stage_revision_id" bigint,
  "group_revision_id" bigint,
  "venue_revision_id" bigint,
  CONSTRAINT "football_matches_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_matches_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_matches_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_matches_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_matches_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_matches_group_requires_stage_ck" CHECK (group_id IS NULL OR stage_id IS NOT NULL),
  CONSTRAINT "football_matches_kickoff_precision_ck" CHECK (kickoff_precision IN ('unknown', 'date', 'minute', 'second')),
  CONSTRAINT "football_matches_kickoff_precision_consistent_ck" CHECK ((kickoff_precision = 'unknown' AND kickoff_at IS NULL) OR (kickoff_precision = 'date' AND match_date IS NOT NULL AND kickoff_at IS NULL) OR (kickoff_precision IN ('minute','second') AND kickoff_at IS NOT NULL)),
  CONSTRAINT "football_matches_status_ck" CHECK (status IN ('not_started', 'in_play', 'half_time', 'extra_time', 'shootout', 'finished', 'postponed', 'suspended', 'abandoned', 'awarded', 'canceled', 'unknown')),
  CONSTRAINT "football_matches_publication_state_ck" CHECK (publication_state IN ('draft', 'published', 'quarantined')),
  CONSTRAINT "football_matches_leg_positive_ck" CHECK (leg_number > 0),
  CONSTRAINT "football_matches_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_matches_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_matches_sv_relation_binding_ck" CHECK (relation_code = 'football.matches'),
  CONSTRAINT "football_matches_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_matches_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_matches_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_matches_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_matches_sv_stage_revision_id_pair_ck" CHECK ((stage_revision_id IS NULL AND (stage_id IS NULL)) OR (stage_revision_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)),
  CONSTRAINT "football_matches_sv_group_revision_id_pair_ck" CHECK ((group_revision_id IS NULL AND (group_id IS NULL)) OR (group_revision_id IS NOT NULL AND group_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)),
  CONSTRAINT "football_matches_sv_venue_revision_id_pair_ck" CHECK ((venue_revision_id IS NULL AND (venue_id IS NULL)) OR (venue_revision_id IS NOT NULL AND venue_id IS NOT NULL)),
  CONSTRAINT "football_matches_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."matches" IS 'Matchs canoniques; date civile et instant de coup d’envoi restent distincts. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."matches"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."matches"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id); football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."matches"."stage_id" IS 'Référence SQL vers football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."matches"."group_id" IS 'Référence SQL vers football.competition_groups(id, stage_id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."matches"."round_label" IS 'Tour ou journée tel qu’observé ; ne présume pas un ordre numérique.';

COMMENT ON COLUMN "football"."matches"."round_number" IS 'Numéro de journée/tour lorsqu’il est explicitement connu.';

COMMENT ON COLUMN "football"."matches"."leg_number" IS 'Manche d’une confrontation aller/retour.';

COMMENT ON COLUMN "football"."matches"."tie_key" IS 'Clé qui regroupe les manches d’une confrontation.';

COMMENT ON COLUMN "football"."matches"."match_date" IS 'Date civile connue du match ; une heure inconnue ne crée pas un instant minuit fictif.';

COMMENT ON COLUMN "football"."matches"."kickoff_at" IS 'Instant UTC du coup d’envoi, uniquement lorsque l’heure est connue.';

COMMENT ON COLUMN "football"."matches"."kickoff_precision" IS 'Précision réellement fournie : unknown, date, minute ou second.';

COMMENT ON COLUMN "football"."matches"."source_timezone" IS 'Fuseau de la date/heure source si connu, utilisé pour la conversion explicite.';

COMMENT ON COLUMN "football"."matches"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "football"."matches"."publication_state" IS 'draft, published ou quarantined ; les invariants renforcés s’appliquent à la publication.';

COMMENT ON COLUMN "football"."matches"."venue_id" IS 'Référence SQL vers football.venues(id, revision_id).';

COMMENT ON COLUMN "football"."matches"."neutral_venue" IS 'Terrain neutre si explicitement connu.';

COMMENT ON COLUMN "football"."matches"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."matches"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."matches"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."matches"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."matches"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."matches"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."matches"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."matches"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."matches"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."matches"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."stage_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."group_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."matches"."venue_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_source_ids" (
  "source_id" bigint NOT NULL,
  "external_id" text NOT NULL,
  "match_id" bigint NOT NULL,
  "first_seen_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_record_id" bigint,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.match_source_ids' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_revision_id" bigint NOT NULL,
  CONSTRAINT "football_match_source_ids_sv_pk" PRIMARY KEY ("source_id", "external_id", "recorded_from_gen"),
  CONSTRAINT "football_match_source_ids_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_match_source_ids_sv_relation_binding_ck" CHECK (relation_code = 'football.match_source_ids'),
  CONSTRAINT "football_match_source_ids_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_match_source_ids_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_match_source_ids_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL))
);

COMMENT ON TABLE "football"."match_source_ids" IS 'Identifiants externes typés de match. Grain physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une résolution datée, PK (source_id, external_id, recorded_from_gen) ; clé logique (source_id, external_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."match_source_ids"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."match_source_ids"."external_id" IS 'Identifiant fournisseur conservé en TEXT exactement ; pas de fusion sur le nom.';

COMMENT ON COLUMN "football"."match_source_ids"."match_id" IS 'Référence SQL vers football.matches(id, revision_id).';

COMMENT ON COLUMN "football"."match_source_ids"."first_seen_at" IS 'Instant UTC « first_seen_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "football"."match_source_ids"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_source_ids"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."match_source_ids"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."match_source_ids"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_source_ids"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_source_ids"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_source_ids"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_source_ids"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_source_ids"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_source_ids"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_teams" (
  "match_id" bigint NOT NULL,
  "side" text NOT NULL,
  "team_id" bigint,
  "participant_label" text,
  "coach_id" bigint,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.match_teams' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_revision_id" bigint NOT NULL,
  "coach_revision_id" bigint,
  CONSTRAINT "football_match_teams_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_match_teams_sv_natural_0_generation_uq" UNIQUE ("match_id", "team_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_teams_sv_logical_revision_uq" UNIQUE ("match_id", "side", "revision_id"),
  CONSTRAINT "football_match_teams_sv_variant_generation_uq" UNIQUE ("match_id", "side", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_teams_sv_anchor_match_id_team_id_uq" UNIQUE ("match_id", "team_id", "revision_id"),
  CONSTRAINT "football_match_teams_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_teams_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_teams_side_ck" CHECK (side IN ('home', 'away')),
  CONSTRAINT "football_match_teams_participant_identity_ck" CHECK (team_id IS NOT NULL OR participant_label IS NOT NULL),
  CONSTRAINT "football_match_teams_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_teams_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_match_teams_sv_relation_binding_ck" CHECK (relation_code = 'football.match_teams'),
  CONSTRAINT "football_match_teams_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_match_teams_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_match_teams_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_match_teams_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_match_teams_sv_coach_revision_id_pair_ck" CHECK ((coach_revision_id IS NULL AND (coach_id IS NULL)) OR (coach_revision_id IS NOT NULL AND coach_id IS NOT NULL)),
  CONSTRAINT "football_match_teams_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."match_teams" IS 'Places domicile/extérieur: seul emplacement canonique des participants. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, side), variante variant_key ; sélection canonique (match_id, side) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, side), variante variant_key ; sélection canonique (match_id, side) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."match_teams"."match_id" IS 'Référence SQL vers football.matches(id, revision_id).';

COMMENT ON COLUMN "football"."match_teams"."side" IS 'Place home ou away du participant dans ce match.';

COMMENT ON COLUMN "football"."match_teams"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."match_teams"."participant_label" IS 'Libellé de participant encore non résolu, par exemple vainqueur d’une demi-finale.';

COMMENT ON COLUMN "football"."match_teams"."coach_id" IS 'Référence SQL vers football.coaches(id, revision_id).';

COMMENT ON COLUMN "football"."match_teams"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_teams"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_teams"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_teams"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_teams"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_teams"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_teams"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."match_teams"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."match_teams"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."match_teams"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_teams"."coach_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_scores" (
  "match_id" bigint NOT NULL,
  "side" text NOT NULL,
  "score_scope" text NOT NULL,
  "goals" integer,
  "score_basis" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.match_scores' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  CONSTRAINT "football_match_scores_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_match_scores_sv_logical_revision_uq" UNIQUE ("match_id", "side", "score_scope", "revision_id"),
  CONSTRAINT "football_match_scores_sv_variant_generation_uq" UNIQUE ("match_id", "side", "score_scope", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_scores_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_scores_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_scores_score_scope_ck" CHECK (score_scope IN ('half_time', 'regulation', 'after_extra_time', 'shootout', 'final_without_shootout')),
  CONSTRAINT "football_match_scores_score_basis_ck" CHECK (score_basis IN ('played', 'awarded', 'unknown')),
  CONSTRAINT "football_match_scores_goals_nonnegative_ck" CHECK (goals >= 0),
  CONSTRAINT "football_match_scores_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_scores_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_match_scores_sv_relation_binding_ck" CHECK (relation_code = 'football.match_scores'),
  CONSTRAINT "football_match_scores_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_match_scores_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_match_scores_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_match_scores_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_match_scores_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."match_scores" IS 'Scores à périmètre explicite; les valeurs cumulées ne s’additionnent pas. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, side, score_scope), variante variant_key ; sélection canonique (match_id, side, score_scope) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, side, score_scope), variante variant_key ; sélection canonique (match_id, side, score_scope) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."match_scores"."match_id" IS 'Référence SQL vers football.match_teams(match_id, side, revision_id).';

COMMENT ON COLUMN "football"."match_scores"."side" IS 'Référence SQL vers football.match_teams(match_id, side, revision_id).';

COMMENT ON COLUMN "football"."match_scores"."score_scope" IS 'Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance.';

COMMENT ON COLUMN "football"."match_scores"."goals" IS 'Buts observés dans le grain et la période de cette table ; zéro est une observation.';

COMMENT ON COLUMN "football"."match_scores"."score_basis" IS 'Score effectivement joué, attribué administrativement ou de base inconnue.';

COMMENT ON COLUMN "football"."match_scores"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_scores"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_scores"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_scores"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_scores"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_scores"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_scores"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."match_scores"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."match_scores"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."match_scores"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_scores"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_lineups" (
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "formation" text,
  "confirmed" boolean,
  "lineup_type" text NOT NULL,
  "published_at" timestamptz,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.match_lineups' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  CONSTRAINT "football_match_lineups_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_match_lineups_sv_logical_revision_uq" UNIQUE ("match_id", "team_id", "revision_id"),
  CONSTRAINT "football_match_lineups_sv_variant_generation_uq" UNIQUE ("match_id", "team_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_lineups_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_lineups_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_lineups_lineup_type_ck" CHECK (lineup_type IN ('confirmed', 'predicted', 'observed', 'unknown')),
  CONSTRAINT "football_match_lineups_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_lineups_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_match_lineups_sv_relation_binding_ck" CHECK (relation_code = 'football.match_lineups'),
  CONSTRAINT "football_match_lineups_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_match_lineups_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_match_lineups_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_match_lineups_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_match_lineups_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."match_lineups" IS 'Composition retenue d’une équipe. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id), variante variant_key ; sélection canonique (match_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id), variante variant_key ; sélection canonique (match_id, team_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."match_lineups"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_lineups"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_lineups"."formation" IS 'Formation observée, conservée comme libellé.';

COMMENT ON COLUMN "football"."match_lineups"."confirmed" IS 'Confirmation explicite de la composition ; une prédiction ne vaut pas confirmation.';

COMMENT ON COLUMN "football"."match_lineups"."lineup_type" IS 'Nature confirmed, predicted, observed ou unknown de la composition.';

COMMENT ON COLUMN "football"."match_lineups"."published_at" IS 'Publication déclarée ou activation, selon le grain de cette table.';

COMMENT ON COLUMN "football"."match_lineups"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_lineups"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_lineups"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_lineups"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_lineups"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_lineups"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_lineups"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."match_lineups"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."match_lineups"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."match_lineups"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_lineups"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_players" (
  "match_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "profile_version_id" bigint,
  "is_starter" boolean,
  "squad_status" text NOT NULL,
  "played" boolean,
  "participation_evidence" text,
  "shirt_number" text,
  "raw_position_code" text,
  "position_code" text,
  "position_mapping_version" text,
  "raw_pitch_x" double precision,
  "raw_pitch_y" double precision,
  "coordinate_frame" text,
  "is_captain" boolean,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.match_players' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  "position_definition_version" text,
  "raw_position_code_state" text NOT NULL,
  "raw_position_code_source_number" numeric,
  "shirt_number_state" text NOT NULL,
  "shirt_number_source_number" numeric,
  CONSTRAINT "football_match_players_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_match_players_sv_natural_0_generation_uq" UNIQUE ("match_id", "player_id", "team_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_players_sv_logical_revision_uq" UNIQUE ("match_id", "player_id", "revision_id"),
  CONSTRAINT "football_match_players_sv_variant_generation_uq" UNIQUE ("match_id", "player_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_players_sv_anchor_match_id_player_id_team_id_uq" UNIQUE ("match_id", "player_id", "team_id", "revision_id"),
  CONSTRAINT "football_match_players_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_players_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_players_squad_status_ck" CHECK (squad_status IN ('starter', 'substitute', 'unused_substitute', 'observed', 'unknown')),
  CONSTRAINT "football_match_players_position_mapping_context_ck" CHECK (position_mapping_version IS NULL OR raw_position_code IS NOT NULL),
  CONSTRAINT "football_match_players_played_evidence_ck" CHECK (played IS NULL OR participation_evidence IS NOT NULL),
  CONSTRAINT "football_match_players_coords_frame_ck" CHECK ((raw_pitch_x IS NULL AND raw_pitch_y IS NULL) OR coordinate_frame IS NOT NULL),
  CONSTRAINT "football_match_players_raw_pitch_x_finite_ck" CHECK (raw_pitch_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_match_players_raw_pitch_y_finite_ck" CHECK (raw_pitch_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_match_players_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_players_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_match_players_sv_relation_binding_ck" CHECK (relation_code = 'football.match_players'),
  CONSTRAINT "football_match_players_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_match_players_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_match_players_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_match_players_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_match_players_sv_position_definition_version_pair_ck" CHECK ((position_code IS NULL) = (position_definition_version IS NULL)),
  CONSTRAINT "football_match_players_sv_mapping_source_context_ck" CHECK (position_mapping_version IS NULL OR (raw_position_code IS NOT NULL AND source_id IS NOT NULL)),
  CONSTRAINT "football_match_players_sv_position_mapping_version_nonempty_ck" CHECK (position_mapping_version IS NULL OR (btrim(position_mapping_version) <> '')),
  CONSTRAINT "football_match_players_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_match_players_sv_position_definition_versio_2a3a1087d6" CHECK (position_definition_version IS NULL OR (btrim(position_definition_version) <> '')),
  CONSTRAINT "football_match_players_sv_raw_position_code_native_state_ck" CHECK ((raw_position_code_state IN ('absent','null') AND raw_position_code IS NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'string' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NULL) OR (raw_position_code_state = 'number' AND raw_position_code IS NOT NULL AND raw_position_code_source_number IS NOT NULL AND raw_position_code_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN raw_position_code ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN raw_position_code::numeric = raw_position_code_source_number ELSE false END)),
  CONSTRAINT "football_match_players_sv_shirt_number_native_state_ck" CHECK ((shirt_number_state IN ('absent','null') AND shirt_number IS NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'string' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NULL) OR (shirt_number_state = 'number' AND shirt_number IS NOT NULL AND shirt_number_source_number IS NOT NULL AND shirt_number_source_number NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND CASE WHEN shirt_number ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN shirt_number::numeric = shirt_number_source_number ELSE false END))
);

COMMENT ON TABLE "football"."match_players" IS 'Joueurs listés ou observés; le banc ne prouve pas une apparition. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id), variante variant_key ; sélection canonique (match_id, player_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id), variante variant_key ; sélection canonique (match_id, player_id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."match_players"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_players"."player_id" IS 'Référence SQL vers football.players(id); football.player_profile_versions(id, player_id).';

COMMENT ON COLUMN "football"."match_players"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_players"."profile_version_id" IS 'Référence SQL vers football.player_profile_versions(id, player_id).';

COMMENT ON COLUMN "football"."match_players"."is_starter" IS 'Statut titulaire observé ; ne pas le déduire de statistiques manquantes.';

COMMENT ON COLUMN "football"."match_players"."squad_status" IS 'Titulaire, remplaçant, remplaçant inutilisé, observation ou état inconnu.';

COMMENT ON COLUMN "football"."match_players"."played" IS 'Participation prouvée dans match_players ; dans un classement, nombre de matchs joués.';

COMMENT ON COLUMN "football"."match_players"."participation_evidence" IS 'Preuve explicite qui justifie played ; une ligne de performance ne suffit pas.';

COMMENT ON COLUMN "football"."match_players"."shirt_number" IS 'Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local.';

COMMENT ON COLUMN "football"."match_players"."raw_position_code" IS 'Texte natif (y compris chaîne vide et 07) ou représentation textuelle du nombre natif ; type/absence/null distingués par l’état local.';

COMMENT ON COLUMN "football"."match_players"."position_code" IS 'Référence SQL vers football.positions(code, definition_version); football.position_mappings(source_id, raw_position_code, mapping_version, position_code, position_definition_version).';

COMMENT ON COLUMN "football"."match_players"."position_mapping_version" IS 'Référence SQL vers football.position_mappings(source_id, raw_position_code, mapping_version); football.position_mappings(source_id, raw_position_code, mapping_version, position_code, position_definition_version).';

COMMENT ON COLUMN "football"."match_players"."raw_pitch_x" IS 'Coordonnée native de placement du joueur ; pas une distance en mètres supposée.';

COMMENT ON COLUMN "football"."match_players"."raw_pitch_y" IS 'Seconde coordonnée native de placement du joueur.';

COMMENT ON COLUMN "football"."match_players"."coordinate_frame" IS 'Repère spatial déclaré par la source, propre à cette famille.';

COMMENT ON COLUMN "football"."match_players"."is_captain" IS 'Capitanat explicitement indiqué dans la composition.';

COMMENT ON COLUMN "football"."match_players"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_players"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_players"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_players"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_players"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_players"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_players"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."match_players"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."match_players"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."match_players"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."position_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."raw_position_code_state" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."raw_position_code_source_number" IS 'Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé.';

COMMENT ON COLUMN "football"."match_players"."shirt_number_state" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_players"."shirt_number_source_number" IS 'Valeur native exacte si le champ source est un nombre ; aucune réponse ou sous-arbre sérialisé.';

CREATE TABLE "football"."metric_definitions" (
  "code" text NOT NULL,
  "label" text NOT NULL,
  "definition" text NOT NULL,
  "unit" text NOT NULL,
  "scope" text NOT NULL,
  "aggregation" text NOT NULL,
  "minimum" double precision,
  "maximum" double precision,
  "allows_negative" boolean NOT NULL,
  "numerator_code" text,
  "denominator_code" text,
  "definition_version" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "relation_code" text DEFAULT 'football.metric_definitions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "numerator_definition_version" text,
  "denominator_definition_version" text,
  CONSTRAINT "football_metric_definitions_sv_pk" PRIMARY KEY ("code", "definition_version"),
  CONSTRAINT "football_metric_definitions_scope_ck" CHECK (scope IN ('player', 'team', 'shot', 'network', 'ranking')),
  CONSTRAINT "football_metric_definitions_aggregation_ck" CHECK (aggregation IN ('sum', 'weighted_mean', 'ratio_of_sums', 'last', 'none')),
  CONSTRAINT "football_metric_definitions_bounds_ck" CHECK (maximum >= minimum),
  CONSTRAINT "football_metric_definitions_minimum_finite_ck" CHECK (minimum NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_metric_definitions_maximum_finite_ck" CHECK (maximum NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_metric_definitions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_metric_definitions_sv_relation_binding_ck" CHECK (relation_code = 'football.metric_definitions'),
  CONSTRAINT "football_metric_definitions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_metric_definitions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_metric_definitions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_metric_definitions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_metric_definitions_sv_numerator_definition__08a2f634cb" CHECK ((numerator_code IS NULL) = (numerator_definition_version IS NULL)),
  CONSTRAINT "football_metric_definitions_sv_denominator_definitio_f3ff2d6c72" CHECK ((denominator_code IS NULL) = (denominator_definition_version IS NULL)),
  CONSTRAINT "football_metric_definitions_sv_definition_version_nonempty_ck" CHECK (btrim(definition_version) <> ''),
  CONSTRAINT "football_metric_definitions_sv_numerator_definition__b971cb1a86" CHECK (numerator_definition_version IS NULL OR (btrim(numerator_definition_version) <> '')),
  CONSTRAINT "football_metric_definitions_sv_denominator_definitio_20b3573f5f" CHECK (denominator_definition_version IS NULL OR (btrim(denominator_definition_version) <> ''))
);

COMMENT ON TABLE "football"."metric_definitions" IS 'Définitions de métriques et règles d’agrégation. Grain physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une définition immuable identifiée par definition_version, PK (code, definition_version) ; clé logique (code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."metric_definitions"."code" IS 'Code stable du référentiel, avec sa définition explicite.';

COMMENT ON COLUMN "football"."metric_definitions"."label" IS 'Libellé d’affichage du code ou de l’édition.';

COMMENT ON COLUMN "football"."metric_definitions"."definition" IS 'Définition sémantique du code et de ses conditions d’utilisation.';

COMMENT ON COLUMN "football"."metric_definitions"."unit" IS 'Unité déclarée et versionnée de la métrique.';

COMMENT ON COLUMN "football"."metric_definitions"."scope" IS 'Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent.';

COMMENT ON COLUMN "football"."metric_definitions"."aggregation" IS 'Règle sum, weighted_mean, ratio_of_sums, last ou none de cette métrique.';

COMMENT ON COLUMN "football"."metric_definitions"."minimum" IS 'Borne inférieure documentée de cette métrique.';

COMMENT ON COLUMN "football"."metric_definitions"."maximum" IS 'Borne supérieure documentée de cette métrique.';

COMMENT ON COLUMN "football"."metric_definitions"."allows_negative" IS 'Autorisation explicite de valeurs signées pour cette métrique.';

COMMENT ON COLUMN "football"."metric_definitions"."numerator_code" IS 'Référence SQL vers football.metric_definitions(code, definition_version).';

COMMENT ON COLUMN "football"."metric_definitions"."denominator_code" IS 'Référence SQL vers football.metric_definitions(code, definition_version).';

COMMENT ON COLUMN "football"."metric_definitions"."definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."metric_definitions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."metric_definitions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."numerator_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."metric_definitions"."denominator_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."source_metric_mappings" (
  "source_id" bigint NOT NULL,
  "family_code" text NOT NULL,
  "raw_key" text NOT NULL,
  "mapping_version" text NOT NULL,
  "metric_code" text NOT NULL,
  "parse_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "period_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "definition_notes" text,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "relation_code" text DEFAULT 'football.source_metric_mappings' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "metric_definition_version" text NOT NULL,
  CONSTRAINT "football_source_metric_mappings_pk" PRIMARY KEY ("source_id", "family_code", "raw_key", "mapping_version"),
  CONSTRAINT "football_source_metric_mappings_parse_rule_kind_ck" CHECK (jsonb_typeof(parse_rule) = 'object'),
  CONSTRAINT "football_source_metric_mappings_period_rule_kind_ck" CHECK (jsonb_typeof(period_rule) = 'object'),
  CONSTRAINT "football_source_metric_mappings_parse_rule_bounded_ck" CHECK (octet_length(parse_rule::text)<=16384),
  CONSTRAINT "football_source_metric_mappings_period_rule_bounded_ck" CHECK (octet_length(period_rule::text)<=16384),
  CONSTRAINT "football_source_metric_mappings_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_source_metric_mappings_sv_relation_binding_ck" CHECK (relation_code = 'football.source_metric_mappings'),
  CONSTRAINT "football_source_metric_mappings_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_source_metric_mappings_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_source_metric_mappings_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_source_metric_mappings_sv_mapping_version_nonempty_ck" CHECK (btrim(mapping_version) <> ''),
  CONSTRAINT "football_source_metric_mappings_sv_metric_definition_19ab5398d1" CHECK (btrim(metric_definition_version) <> '')
);

COMMENT ON TABLE "football"."source_metric_mappings" IS 'Traduction versionnée des clés techniques fournisseur. Grain physique : un mapping immuable identifié par mapping_version, PK (source_id, family_code, raw_key, mapping_version) ; clé logique (source_id, family_code, raw_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : un mapping immuable identifié par mapping_version, PK (source_id, family_code, raw_key, mapping_version) ; clé logique (source_id, family_code, raw_key) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."source_metric_mappings"."source_id" IS 'Référence SQL vers ingest.sources(id); ingest.source_records(source_id, id).';

COMMENT ON COLUMN "football"."source_metric_mappings"."family_code" IS 'Famille de données dont le contrat définit cette clé.';

COMMENT ON COLUMN "football"."source_metric_mappings"."raw_key" IS 'Clé technique native de la métrique.';

COMMENT ON COLUMN "football"."source_metric_mappings"."mapping_version" IS 'Version de la traduction des valeurs fournisseur.';

COMMENT ON COLUMN "football"."source_metric_mappings"."metric_code" IS 'Référence SQL vers football.metric_definitions(code, definition_version).';

COMMENT ON COLUMN "football"."source_metric_mappings"."parse_rule" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "football"."source_metric_mappings"."period_rule" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "football"."source_metric_mappings"."definition_notes" IS 'Limites et définition particulières de la correspondance.';

COMMENT ON COLUMN "football"."source_metric_mappings"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."source_metric_mappings"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."source_metric_mappings"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."source_metric_mappings"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."source_metric_mappings"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."source_metric_mappings"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."source_metric_mappings"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."source_metric_mappings"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."source_metric_mappings"."metric_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."player_match_stats" (
  "match_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "period_code" text NOT NULL,
  "team_id" bigint NOT NULL,
  "goals" integer,
  "assists" integer,
  "shots" integer,
  "shots_on_target" integer,
  "chances_created" integer,
  "big_chances_created" integer,
  "passes_completed" integer,
  "passes_attempted" integer,
  "passes_final_third" integer,
  "defensive_actions" integer,
  "interceptions" integer,
  "tackles" integer,
  "recoveries" integer,
  "duels_won" integer,
  "duels_lost" integer,
  "aerial_duels_won" integer,
  "aerial_duels_attempted" integer,
  "touches" integer,
  "touches_box" integer,
  "clearances" integer,
  "blocks" integer,
  "dribbles_completed" integer,
  "dribbles_attempted" integer,
  "saves" integer,
  "xg" numeric,
  "non_penalty_xg" double precision,
  "xa" double precision,
  "xgot" double precision,
  "minutes_played" double precision,
  "provider_rating" double precision,
  "goals_prevented" double precision,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.player_match_stats' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_player_revision_id" bigint NOT NULL,
  "period_definition_version" text NOT NULL,
  CONSTRAINT "football_player_match_stats_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_player_match_stats_sv_logical_revision_uq" UNIQUE ("match_id", "player_id", "period_code", "revision_id"),
  CONSTRAINT "football_player_match_stats_sv_variant_generation_uq" UNIQUE ("match_id", "player_id", "period_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_match_stats_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_player_match_stats_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_player_match_stats_goals_nonnegative_ck" CHECK (goals >= 0),
  CONSTRAINT "football_player_match_stats_assists_nonnegative_ck" CHECK (assists >= 0),
  CONSTRAINT "football_player_match_stats_shots_nonnegative_ck" CHECK (shots >= 0),
  CONSTRAINT "football_player_match_stats_shots_on_target_nonnegative_ck" CHECK (shots_on_target >= 0),
  CONSTRAINT "football_player_match_stats_chances_created_nonnegative_ck" CHECK (chances_created >= 0),
  CONSTRAINT "football_player_match_stats_big_chances_created_nonnegative_ck" CHECK (big_chances_created >= 0),
  CONSTRAINT "football_player_match_stats_passes_completed_nonnegative_ck" CHECK (passes_completed >= 0),
  CONSTRAINT "football_player_match_stats_passes_attempted_nonnegative_ck" CHECK (passes_attempted >= 0),
  CONSTRAINT "football_player_match_stats_passes_final_third_nonnegative_ck" CHECK (passes_final_third >= 0),
  CONSTRAINT "football_player_match_stats_defensive_actions_nonnegative_ck" CHECK (defensive_actions >= 0),
  CONSTRAINT "football_player_match_stats_interceptions_nonnegative_ck" CHECK (interceptions >= 0),
  CONSTRAINT "football_player_match_stats_tackles_nonnegative_ck" CHECK (tackles >= 0),
  CONSTRAINT "football_player_match_stats_recoveries_nonnegative_ck" CHECK (recoveries >= 0),
  CONSTRAINT "football_player_match_stats_duels_won_nonnegative_ck" CHECK (duels_won >= 0),
  CONSTRAINT "football_player_match_stats_duels_lost_nonnegative_ck" CHECK (duels_lost >= 0),
  CONSTRAINT "football_player_match_stats_aerial_duels_won_nonnegative_ck" CHECK (aerial_duels_won >= 0),
  CONSTRAINT "football_player_match_stats_aerial_duels_attempted_no_a9e59e21f" CHECK (aerial_duels_attempted >= 0),
  CONSTRAINT "football_player_match_stats_touches_nonnegative_ck" CHECK (touches >= 0),
  CONSTRAINT "football_player_match_stats_touches_box_nonnegative_ck" CHECK (touches_box >= 0),
  CONSTRAINT "football_player_match_stats_clearances_nonnegative_ck" CHECK (clearances >= 0),
  CONSTRAINT "football_player_match_stats_blocks_nonnegative_ck" CHECK (blocks >= 0),
  CONSTRAINT "football_player_match_stats_dribbles_completed_nonnegative_ck" CHECK (dribbles_completed >= 0),
  CONSTRAINT "football_player_match_stats_dribbles_attempted_nonnegative_ck" CHECK (dribbles_attempted >= 0),
  CONSTRAINT "football_player_match_stats_saves_nonnegative_ck" CHECK (saves >= 0),
  CONSTRAINT "football_player_match_stats_xg_nonnegative_ck" CHECK (xg >= 0),
  CONSTRAINT "football_player_match_stats_non_penalty_xg_nonnegative_ck" CHECK (non_penalty_xg >= 0),
  CONSTRAINT "football_player_match_stats_xa_nonnegative_ck" CHECK (xa >= 0),
  CONSTRAINT "football_player_match_stats_xgot_nonnegative_ck" CHECK (xgot >= 0),
  CONSTRAINT "football_player_match_stats_minutes_played_nonnegative_ck" CHECK (minutes_played >= 0),
  CONSTRAINT "football_player_match_stats_passes_completed_bounded_ck" CHECK (passes_completed <= passes_attempted),
  CONSTRAINT "football_player_match_stats_aerial_duels_won_bounded_ck" CHECK (aerial_duels_won <= aerial_duels_attempted),
  CONSTRAINT "football_player_match_stats_dribbles_completed_bounded_ck" CHECK (dribbles_completed <= dribbles_attempted),
  CONSTRAINT "football_player_match_stats_xg_finite_ck" CHECK (xg NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  CONSTRAINT "football_player_match_stats_non_penalty_xg_finite_ck" CHECK (non_penalty_xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_stats_xa_finite_ck" CHECK (xa NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_stats_xgot_finite_ck" CHECK (xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_stats_minutes_played_finite_ck" CHECK (minutes_played NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_stats_provider_rating_finite_ck" CHECK (provider_rating NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_stats_goals_prevented_finite_ck" CHECK (goals_prevented NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_stats_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_player_match_stats_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_match_stats_sv_relation_binding_ck" CHECK (relation_code = 'football.player_match_stats'),
  CONSTRAINT "football_player_match_stats_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_match_stats_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_match_stats_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_player_match_stats_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_player_match_stats_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_player_match_stats_sv_period_definition_ver_701262fbd2" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."player_match_stats" IS 'Statistiques joueur canoniques, NULL si non observées. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_match_stats"."match_id" IS 'Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."player_match_stats"."player_id" IS 'Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."player_match_stats"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."player_match_stats"."team_id" IS 'Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."player_match_stats"."goals" IS 'Buts observés dans le grain et la période de cette table ; zéro est une observation.';

COMMENT ON COLUMN "football"."player_match_stats"."assists" IS 'Passes décisives attribuées par le fournisseur dans cette période.';

COMMENT ON COLUMN "football"."player_match_stats"."shots" IS 'Nombre de tirs observés selon la définition source.';

COMMENT ON COLUMN "football"."player_match_stats"."shots_on_target" IS 'Tirs cadrés observés selon la définition source.';

COMMENT ON COLUMN "football"."player_match_stats"."chances_created" IS 'Occasions créées attribuées par la source.';

COMMENT ON COLUMN "football"."player_match_stats"."big_chances_created" IS 'Grosses occasions créées selon la définition source.';

COMMENT ON COLUMN "football"."player_match_stats"."passes_completed" IS 'Passes réussies observées.';

COMMENT ON COLUMN "football"."player_match_stats"."passes_attempted" IS 'Passes tentées observées, dénominateur des taux.';

COMMENT ON COLUMN "football"."player_match_stats"."passes_final_third" IS 'Passes dans le dernier tiers selon le contrat source.';

COMMENT ON COLUMN "football"."player_match_stats"."defensive_actions" IS 'Actions défensives selon le contrat de la mesure.';

COMMENT ON COLUMN "football"."player_match_stats"."interceptions" IS 'Interceptions observées.';

COMMENT ON COLUMN "football"."player_match_stats"."tackles" IS 'Tacles selon la définition source.';

COMMENT ON COLUMN "football"."player_match_stats"."recoveries" IS 'Ballons récupérés.';

COMMENT ON COLUMN "football"."player_match_stats"."duels_won" IS 'Duels gagnés observés.';

COMMENT ON COLUMN "football"."player_match_stats"."duels_lost" IS 'Duels perdus observés.';

COMMENT ON COLUMN "football"."player_match_stats"."aerial_duels_won" IS 'Duels aériens gagnés.';

COMMENT ON COLUMN "football"."player_match_stats"."aerial_duels_attempted" IS 'Duels aériens disputés, dénominateur connu.';

COMMENT ON COLUMN "football"."player_match_stats"."touches" IS 'Ballons touchés selon le fournisseur.';

COMMENT ON COLUMN "football"."player_match_stats"."touches_box" IS 'Ballons touchés dans la surface.';

COMMENT ON COLUMN "football"."player_match_stats"."clearances" IS 'Dégagements observés.';

COMMENT ON COLUMN "football"."player_match_stats"."blocks" IS 'Actions bloquées selon la définition source.';

COMMENT ON COLUMN "football"."player_match_stats"."dribbles_completed" IS 'Dribbles réussis.';

COMMENT ON COLUMN "football"."player_match_stats"."dribbles_attempted" IS 'Dribbles tentés.';

COMMENT ON COLUMN "football"."player_match_stats"."saves" IS 'Arrêts du gardien observés.';

COMMENT ON COLUMN "football"."player_match_stats"."xg" IS 'Buts attendus de la source ; probabilité pour un tir, total pour une participation/période.';

COMMENT ON COLUMN "football"."player_match_stats"."non_penalty_xg" IS 'Buts attendus hors penalties selon la définition source.';

COMMENT ON COLUMN "football"."player_match_stats"."xa" IS 'Passes décisives attendues ; une valeur indisponible reste indisponible.';

COMMENT ON COLUMN "football"."player_match_stats"."xgot" IS 'Buts attendus sur tirs cadrés selon le modèle fournisseur.';

COMMENT ON COLUMN "football"."player_match_stats"."minutes_played" IS 'Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation.';

COMMENT ON COLUMN "football"."player_match_stats"."provider_rating" IS 'Note du fournisseur ; distincte d’un score Orion.';

COMMENT ON COLUMN "football"."player_match_stats"."goals_prevented" IS 'Buts évités selon le modèle gardien du fournisseur ; valeur signée.';

COMMENT ON COLUMN "football"."player_match_stats"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."player_match_stats"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_match_stats"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."player_match_stats"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."player_match_stats"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."player_match_stats"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."player_match_stats"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_match_stats"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_match_stats"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."player_match_stats"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."match_player_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_stats"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_match_stats" (
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "period_code" text NOT NULL,
  "shots" integer,
  "shots_on_target" integer,
  "shots_off_target" integer,
  "shots_blocked" integer,
  "corners" integer,
  "offsides" integer,
  "fouls" integer,
  "yellow_cards" integer,
  "red_cards" integer,
  "passes_completed" integer,
  "passes_attempted" integer,
  "crosses_completed" integer,
  "crosses_attempted" integer,
  "tackles" integer,
  "interceptions" integer,
  "recoveries" integer,
  "duels_won" integer,
  "saves" integer,
  "touches_box" integer,
  "xg" double precision,
  "non_penalty_xg" double precision,
  "xgot" double precision,
  "possession_pct" double precision,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_match_stats' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  "period_definition_version" text NOT NULL,
  CONSTRAINT "football_team_match_stats_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_team_match_stats_sv_logical_revision_uq" UNIQUE ("match_id", "team_id", "period_code", "revision_id"),
  CONSTRAINT "football_team_match_stats_sv_variant_generation_uq" UNIQUE ("match_id", "team_id", "period_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_match_stats_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_team_match_stats_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_team_match_stats_shots_nonnegative_ck" CHECK (shots >= 0),
  CONSTRAINT "football_team_match_stats_shots_on_target_nonnegative_ck" CHECK (shots_on_target >= 0),
  CONSTRAINT "football_team_match_stats_shots_off_target_nonnegative_ck" CHECK (shots_off_target >= 0),
  CONSTRAINT "football_team_match_stats_shots_blocked_nonnegative_ck" CHECK (shots_blocked >= 0),
  CONSTRAINT "football_team_match_stats_corners_nonnegative_ck" CHECK (corners >= 0),
  CONSTRAINT "football_team_match_stats_offsides_nonnegative_ck" CHECK (offsides >= 0),
  CONSTRAINT "football_team_match_stats_fouls_nonnegative_ck" CHECK (fouls >= 0),
  CONSTRAINT "football_team_match_stats_yellow_cards_nonnegative_ck" CHECK (yellow_cards >= 0),
  CONSTRAINT "football_team_match_stats_red_cards_nonnegative_ck" CHECK (red_cards >= 0),
  CONSTRAINT "football_team_match_stats_passes_completed_nonnegative_ck" CHECK (passes_completed >= 0),
  CONSTRAINT "football_team_match_stats_passes_attempted_nonnegative_ck" CHECK (passes_attempted >= 0),
  CONSTRAINT "football_team_match_stats_crosses_completed_nonnegative_ck" CHECK (crosses_completed >= 0),
  CONSTRAINT "football_team_match_stats_crosses_attempted_nonnegative_ck" CHECK (crosses_attempted >= 0),
  CONSTRAINT "football_team_match_stats_tackles_nonnegative_ck" CHECK (tackles >= 0),
  CONSTRAINT "football_team_match_stats_interceptions_nonnegative_ck" CHECK (interceptions >= 0),
  CONSTRAINT "football_team_match_stats_recoveries_nonnegative_ck" CHECK (recoveries >= 0),
  CONSTRAINT "football_team_match_stats_duels_won_nonnegative_ck" CHECK (duels_won >= 0),
  CONSTRAINT "football_team_match_stats_saves_nonnegative_ck" CHECK (saves >= 0),
  CONSTRAINT "football_team_match_stats_touches_box_nonnegative_ck" CHECK (touches_box >= 0),
  CONSTRAINT "football_team_match_stats_xg_nonnegative_ck" CHECK (xg >= 0),
  CONSTRAINT "football_team_match_stats_non_penalty_xg_nonnegative_ck" CHECK (non_penalty_xg >= 0),
  CONSTRAINT "football_team_match_stats_xgot_nonnegative_ck" CHECK (xgot >= 0),
  CONSTRAINT "football_team_match_stats_possession_pct_ck" CHECK (possession_pct BETWEEN 0 AND 100),
  CONSTRAINT "football_team_match_stats_passes_bounded_ck" CHECK (passes_completed <= passes_attempted),
  CONSTRAINT "football_team_match_stats_crosses_bounded_ck" CHECK (crosses_completed <= crosses_attempted),
  CONSTRAINT "football_team_match_stats_xg_finite_ck" CHECK (xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_stats_non_penalty_xg_finite_ck" CHECK (non_penalty_xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_stats_xgot_finite_ck" CHECK (xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_stats_possession_pct_finite_ck" CHECK (possession_pct NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_stats_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_team_match_stats_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_match_stats_sv_relation_binding_ck" CHECK (relation_code = 'football.team_match_stats'),
  CONSTRAINT "football_team_match_stats_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_match_stats_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_match_stats_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_match_stats_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_match_stats_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_team_match_stats_sv_period_definition_versi_15eda0345f" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."team_match_stats" IS 'Statistiques d’équipe par période selon la définition standard. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_match_stats"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."team_match_stats"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."team_match_stats"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."team_match_stats"."shots" IS 'Nombre de tirs observés selon la définition source.';

COMMENT ON COLUMN "football"."team_match_stats"."shots_on_target" IS 'Tirs cadrés observés selon la définition source.';

COMMENT ON COLUMN "football"."team_match_stats"."shots_off_target" IS 'Tirs non cadrés observés.';

COMMENT ON COLUMN "football"."team_match_stats"."shots_blocked" IS 'Tirs bloqués observés.';

COMMENT ON COLUMN "football"."team_match_stats"."corners" IS 'Corners observés.';

COMMENT ON COLUMN "football"."team_match_stats"."offsides" IS 'Hors-jeu observés.';

COMMENT ON COLUMN "football"."team_match_stats"."fouls" IS 'Fautes observées.';

COMMENT ON COLUMN "football"."team_match_stats"."yellow_cards" IS 'Avertissements attribués dans cette période.';

COMMENT ON COLUMN "football"."team_match_stats"."red_cards" IS 'Expulsions attribuées dans cette période.';

COMMENT ON COLUMN "football"."team_match_stats"."passes_completed" IS 'Passes réussies observées.';

COMMENT ON COLUMN "football"."team_match_stats"."passes_attempted" IS 'Passes tentées observées, dénominateur des taux.';

COMMENT ON COLUMN "football"."team_match_stats"."crosses_completed" IS 'Centres réussis.';

COMMENT ON COLUMN "football"."team_match_stats"."crosses_attempted" IS 'Centres tentés.';

COMMENT ON COLUMN "football"."team_match_stats"."tackles" IS 'Tacles selon la définition source.';

COMMENT ON COLUMN "football"."team_match_stats"."interceptions" IS 'Interceptions observées.';

COMMENT ON COLUMN "football"."team_match_stats"."recoveries" IS 'Ballons récupérés.';

COMMENT ON COLUMN "football"."team_match_stats"."duels_won" IS 'Duels gagnés observés.';

COMMENT ON COLUMN "football"."team_match_stats"."saves" IS 'Arrêts du gardien observés.';

COMMENT ON COLUMN "football"."team_match_stats"."touches_box" IS 'Ballons touchés dans la surface.';

COMMENT ON COLUMN "football"."team_match_stats"."xg" IS 'Buts attendus de la source ; probabilité pour un tir, total pour une participation/période.';

COMMENT ON COLUMN "football"."team_match_stats"."non_penalty_xg" IS 'Buts attendus hors penalties selon la définition source.';

COMMENT ON COLUMN "football"."team_match_stats"."xgot" IS 'Buts attendus sur tirs cadrés selon le modèle fournisseur.';

COMMENT ON COLUMN "football"."team_match_stats"."possession_pct" IS 'Possession en pourcentage 0–100, selon la définition de cette table.';

COMMENT ON COLUMN "football"."team_match_stats"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."team_match_stats"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_match_stats"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."team_match_stats"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."team_match_stats"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."team_match_stats"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."team_match_stats"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_match_stats"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_match_stats"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_match_stats"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_stats"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."shots" (
  "id" bigint DEFAULT nextval('football.shots_logical_id_seq'::regclass) NOT NULL,
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "player_id" bigint,
  "external_shot_id" text NOT NULL,
  "period_code" text,
  "minute" integer,
  "minute_added" integer,
  "x_m" double precision,
  "y_m" double precision,
  "coordinate_frame" text,
  "pitch_length_m" double precision,
  "pitch_width_m" double precision,
  "xg" double precision,
  "xgot" double precision,
  "outcome" text,
  "body_part" text,
  "situation" text,
  "is_goal" boolean,
  "is_own_goal" boolean,
  "is_on_target" boolean,
  "is_inside_box" boolean,
  "goal_crossed_y" double precision,
  "goal_crossed_z" double precision,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "keeper_id" bigint,
  "blocked_x" double precision,
  "blocked_y" double precision,
  "is_blocked" boolean,
  "is_saved_off_line" boolean,
  "source_shot_type" text,
  "source_event_type" text,
  "source_ordinal" integer,
  "player_profile_version_id" bigint,
  "keeper_profile_version_id" bigint,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.shots' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  "period_definition_version" text,
  CONSTRAINT "football_shots_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_shots_sv_natural_0_generation_uq" UNIQUE ("source_id", "match_id", "external_shot_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_shots_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_shots_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_shots_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_shots_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_shots_minute_nonnegative_ck" CHECK (minute >= 0),
  CONSTRAINT "football_shots_minute_added_nonnegative_ck" CHECK (minute_added >= 0),
  CONSTRAINT "football_shots_xg_ck" CHECK (xg BETWEEN 0 AND 1),
  CONSTRAINT "football_shots_xgot_ck" CHECK (xgot BETWEEN 0 AND 1),
  CONSTRAINT "football_shots_coordinate_frame_ck" CHECK ((x_m IS NULL AND y_m IS NULL AND goal_crossed_y IS NULL AND goal_crossed_z IS NULL) OR coordinate_frame IS NOT NULL),
  CONSTRAINT "football_shots_pitch_length_ck" CHECK (pitch_length_m > 0),
  CONSTRAINT "football_shots_pitch_width_ck" CHECK (pitch_width_m > 0),
  CONSTRAINT "football_shots_blocked_frame_ck" CHECK ((blocked_x IS NULL AND blocked_y IS NULL) OR coordinate_frame IS NOT NULL),
  CONSTRAINT "football_shots_x_m_finite_ck" CHECK (x_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_y_m_finite_ck" CHECK (y_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_pitch_length_m_finite_ck" CHECK (pitch_length_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_pitch_width_m_finite_ck" CHECK (pitch_width_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_xg_finite_ck" CHECK (xg NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_xgot_finite_ck" CHECK (xgot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_goal_crossed_y_finite_ck" CHECK (goal_crossed_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_goal_crossed_z_finite_ck" CHECK (goal_crossed_z NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_blocked_x_finite_ck" CHECK (blocked_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_blocked_y_finite_ck" CHECK (blocked_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_shots_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_shots_pro_player_profile_version_id_identity_ck" CHECK (player_profile_version_id IS NULL OR player_id IS NOT NULL),
  CONSTRAINT "football_shots_pro_keeper_profile_version_id_identity_ck" CHECK (keeper_profile_version_id IS NULL OR keeper_id IS NOT NULL),
  CONSTRAINT "football_shots_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_shots_sv_relation_binding_ck" CHECK (relation_code = 'football.shots'),
  CONSTRAINT "football_shots_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_shots_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_shots_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_shots_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_shots_sv_period_definition_version_pair_ck" CHECK ((period_code IS NULL) = (period_definition_version IS NULL)),
  CONSTRAINT "football_shots_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_shots_sv_period_definition_version_nonempty_ck" CHECK (period_definition_version IS NULL OR (btrim(period_definition_version) <> ''))
);

COMMENT ON TABLE "football"."shots" IS 'Tirs canoniques; l’identifiant externe est limité au match. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."shots"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."shots"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."shots"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."shots"."player_id" IS 'Référence SQL vers football.players(id); football.player_profile_versions(id, player_id).';

COMMENT ON COLUMN "football"."shots"."external_shot_id" IS 'Identifiant de tir limité à son match et sa source.';

COMMENT ON COLUMN "football"."shots"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."shots"."minute" IS 'Minute source dans la période indiquée ; précision conservée.';

COMMENT ON COLUMN "football"."shots"."minute_added" IS 'Temps additionnel distinct de la minute principale.';

COMMENT ON COLUMN "football"."shots"."x_m" IS 'Coordonnée longitudinale du tir, en mètres seulement si conversion vérifiée ; le repère est explicite.';

COMMENT ON COLUMN "football"."shots"."y_m" IS 'Coordonnée transversale du tir dans le repère déclaré.';

COMMENT ON COLUMN "football"."shots"."coordinate_frame" IS 'Repère spatial déclaré par la source, propre à cette famille.';

COMMENT ON COLUMN "football"."shots"."pitch_length_m" IS 'Longueur du terrain en mètres lorsqu’elle est explicitement connue.';

COMMENT ON COLUMN "football"."shots"."pitch_width_m" IS 'Largeur du terrain en mètres lorsqu’elle est connue.';

COMMENT ON COLUMN "football"."shots"."xg" IS 'Buts attendus de la source ; probabilité pour un tir, total pour une participation/période.';

COMMENT ON COLUMN "football"."shots"."xgot" IS 'Buts attendus sur tirs cadrés selon le modèle fournisseur.';

COMMENT ON COLUMN "football"."shots"."outcome" IS 'Résultat du tir selon un mapping documenté.';

COMMENT ON COLUMN "football"."shots"."body_part" IS 'Partie du corps si fournie ; ne pas l’inférer d’un code de tir non défini.';

COMMENT ON COLUMN "football"."shots"."situation" IS 'Contexte du tir : jeu ouvert, phase arrêtée, etc., selon les codes source.';

COMMENT ON COLUMN "football"."shots"."is_goal" IS 'Indicateur de but observé ou dérivé sous règle versionnée.';

COMMENT ON COLUMN "football"."shots"."is_own_goal" IS 'But contre son camp explicitement signalé.';

COMMENT ON COLUMN "football"."shots"."is_on_target" IS 'Indicateur natif de tir cadré.';

COMMENT ON COLUMN "football"."shots"."is_inside_box" IS 'Tir dans la surface selon la source.';

COMMENT ON COLUMN "football"."shots"."goal_crossed_y" IS 'Coordonnée du franchissement de la ligne de but dans le repère du fournisseur.';

COMMENT ON COLUMN "football"."shots"."goal_crossed_z" IS 'Hauteur du franchissement de la ligne de but dans le repère du fournisseur.';

COMMENT ON COLUMN "football"."shots"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."shots"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."shots"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."shots"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."shots"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."shots"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."shots"."keeper_id" IS 'Gardien associé au tir dans l’observation.';

COMMENT ON COLUMN "football"."shots"."blocked_x" IS 'Coordonnée du point de blocage, dans le repère source déclaré.';

COMMENT ON COLUMN "football"."shots"."blocked_y" IS 'Seconde coordonnée du point de blocage.';

COMMENT ON COLUMN "football"."shots"."is_blocked" IS 'Indicateur natif de tir bloqué.';

COMMENT ON COLUMN "football"."shots"."is_saved_off_line" IS 'Indicateur natif de sauvetage sur la ligne.';

COMMENT ON COLUMN "football"."shots"."source_shot_type" IS 'Type natif ; aucune confusion automatique avec la partie du corps.';

COMMENT ON COLUMN "football"."shots"."source_event_type" IS 'Résultat/type natif du tir.';

COMMENT ON COLUMN "football"."shots"."source_ordinal" IS 'Ordre de présentation dans cette version de la famille.';

COMMENT ON COLUMN "football"."shots"."player_profile_version_id" IS 'Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte.';

COMMENT ON COLUMN "football"."shots"."keeper_profile_version_id" IS 'Profil observé de l’acteur du tir ; conserve nom, image, poste et numéro dans leur contexte.';

COMMENT ON COLUMN "football"."shots"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."shots"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."shots"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."shots"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."shots"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."player_match_advanced" (
  "match_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "period_code" text NOT NULL,
  "team_id" bigint NOT NULL,
  "progressive_passes" integer,
  "passes_into_box" integer,
  "key_passes" integer,
  "through_balls" integer,
  "crosses" integer,
  "switches" integer,
  "carries" integer,
  "progressive_carries" integer,
  "carries_into_final_third" integer,
  "carries_into_box" integer,
  "take_ons" integer,
  "take_ons_won" integer,
  "miscontrols" integer,
  "dispossessed" integer,
  "sca" integer,
  "gca" integer,
  "second_assists" integer,
  "xt_total" double precision,
  "vaep_total" double precision,
  "vaep_offensive" double precision,
  "vaep_defensive" double precision,
  "pv_total" double precision,
  "pv_offensive" double precision,
  "pv_defensive" double precision,
  "progressive_pass_distance" double precision,
  "carry_distance" double precision,
  "progressive_carry_distance" double precision,
  "xag" double precision,
  "xg_chain" double precision,
  "xg_buildup" double precision,
  "provider_model_version" text,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "sca_pass_live" double precision,
  "sca_pass_dead" double precision,
  "sca_take_on" double precision,
  "sca_shot" double precision,
  "sca_foul_drawn" double precision,
  "sca_defensive" double precision,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.player_match_advanced' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_player_revision_id" bigint NOT NULL,
  "period_definition_version" text NOT NULL,
  CONSTRAINT "football_player_match_advanced_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_player_match_advanced_sv_logical_revision_uq" UNIQUE ("match_id", "player_id", "period_code", "revision_id"),
  CONSTRAINT "football_player_match_advanced_sv_variant_generation_uq" UNIQUE ("match_id", "player_id", "period_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_match_advanced_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_player_match_advanced_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_player_match_advanced_progressive_passes_non_e869e1d7c" CHECK (progressive_passes >= 0),
  CONSTRAINT "football_player_match_advanced_passes_into_box_nonnegative_ck" CHECK (passes_into_box >= 0),
  CONSTRAINT "football_player_match_advanced_key_passes_nonnegative_ck" CHECK (key_passes >= 0),
  CONSTRAINT "football_player_match_advanced_through_balls_nonnegative_ck" CHECK (through_balls >= 0),
  CONSTRAINT "football_player_match_advanced_crosses_nonnegative_ck" CHECK (crosses >= 0),
  CONSTRAINT "football_player_match_advanced_switches_nonnegative_ck" CHECK (switches >= 0),
  CONSTRAINT "football_player_match_advanced_carries_nonnegative_ck" CHECK (carries >= 0),
  CONSTRAINT "football_player_match_advanced_progressive_carries_no_ab2d020d6" CHECK (progressive_carries >= 0),
  CONSTRAINT "football_player_match_advanced_carries_into_final_thi_a9e3b4fc2" CHECK (carries_into_final_third >= 0),
  CONSTRAINT "football_player_match_advanced_carries_into_box_nonnegative_ck" CHECK (carries_into_box >= 0),
  CONSTRAINT "football_player_match_advanced_take_ons_nonnegative_ck" CHECK (take_ons >= 0),
  CONSTRAINT "football_player_match_advanced_take_ons_won_nonnegative_ck" CHECK (take_ons_won >= 0),
  CONSTRAINT "football_player_match_advanced_miscontrols_nonnegative_ck" CHECK (miscontrols >= 0),
  CONSTRAINT "football_player_match_advanced_dispossessed_nonnegative_ck" CHECK (dispossessed >= 0),
  CONSTRAINT "football_player_match_advanced_sca_nonnegative_ck" CHECK (sca >= 0),
  CONSTRAINT "football_player_match_advanced_gca_nonnegative_ck" CHECK (gca >= 0),
  CONSTRAINT "football_player_match_advanced_second_assists_nonnegative_ck" CHECK (second_assists >= 0),
  CONSTRAINT "football_player_match_advanced_progressive_pass_dista_0fa1f5d07" CHECK (progressive_pass_distance >= 0),
  CONSTRAINT "football_player_match_advanced_carry_distance_nonnegative_ck" CHECK (carry_distance >= 0),
  CONSTRAINT "football_player_match_advanced_progressive_carry_dist_ad0a414ef" CHECK (progressive_carry_distance >= 0),
  CONSTRAINT "football_player_match_advanced_xag_nonnegative_ck" CHECK (xag >= 0),
  CONSTRAINT "football_player_match_advanced_xg_chain_nonnegative_ck" CHECK (xg_chain >= 0),
  CONSTRAINT "football_player_match_advanced_xg_buildup_nonnegative_ck" CHECK (xg_buildup >= 0),
  CONSTRAINT "football_player_match_advanced_take_ons_bounded_ck" CHECK (take_ons_won <= take_ons),
  CONSTRAINT "football_player_match_advanced_xt_total_finite_ck" CHECK (xt_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_vaep_total_finite_ck" CHECK (vaep_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_vaep_offensive_finite_ck" CHECK (vaep_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_vaep_defensive_finite_ck" CHECK (vaep_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_pv_total_finite_ck" CHECK (pv_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_pv_offensive_finite_ck" CHECK (pv_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_pv_defensive_finite_ck" CHECK (pv_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_progressive_pass_dist_f89e6f743e" CHECK (progressive_pass_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_carry_distance_finite_ck" CHECK (carry_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_progressive_carry_dis_04f483a27c" CHECK (progressive_carry_distance NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_xag_finite_ck" CHECK (xag NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_xg_chain_finite_ck" CHECK (xg_chain NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_xg_buildup_finite_ck" CHECK (xg_buildup NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_sca_pass_live_finite_ck" CHECK (sca_pass_live NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_sca_pass_dead_finite_ck" CHECK (sca_pass_dead NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_sca_take_on_finite_ck" CHECK (sca_take_on NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_sca_shot_finite_ck" CHECK (sca_shot NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_sca_foul_drawn_finite_ck" CHECK (sca_foul_drawn NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_sca_defensive_finite_ck" CHECK (sca_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_player_match_advanced_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_player_match_advanced_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_match_advanced_sv_relation_binding_ck" CHECK (relation_code = 'football.player_match_advanced'),
  CONSTRAINT "football_player_match_advanced_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_match_advanced_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_match_advanced_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_player_match_advanced_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_player_match_advanced_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_player_match_advanced_sv_period_definition__9cc57a1556" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."player_match_advanced" IS 'Mesures avancées joueur avec modèle fournisseur identifié. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code), variante variant_key ; sélection canonique (match_id, player_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_match_advanced"."match_id" IS 'Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."player_match_advanced"."player_id" IS 'Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."player_match_advanced"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."player_match_advanced"."team_id" IS 'Référence SQL vers football.match_players(match_id, player_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."player_match_advanced"."progressive_passes" IS 'Passes progressives selon la définition du fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."passes_into_box" IS 'Passes dans la surface.';

COMMENT ON COLUMN "football"."player_match_advanced"."key_passes" IS 'Passes clés selon le fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."through_balls" IS 'Passes en profondeur.';

COMMENT ON COLUMN "football"."player_match_advanced"."crosses" IS 'Centres du contrat avancé.';

COMMENT ON COLUMN "football"."player_match_advanced"."switches" IS 'Renversements de jeu du contrat avancé.';

COMMENT ON COLUMN "football"."player_match_advanced"."carries" IS 'Conduites de balle observées.';

COMMENT ON COLUMN "football"."player_match_advanced"."progressive_carries" IS 'Conduites progressives.';

COMMENT ON COLUMN "football"."player_match_advanced"."carries_into_final_third" IS 'Conduites dans le dernier tiers.';

COMMENT ON COLUMN "football"."player_match_advanced"."carries_into_box" IS 'Conduites dans la surface.';

COMMENT ON COLUMN "football"."player_match_advanced"."take_ons" IS 'Tentatives de duel offensif.';

COMMENT ON COLUMN "football"."player_match_advanced"."take_ons_won" IS 'Duels offensifs réussis.';

COMMENT ON COLUMN "football"."player_match_advanced"."miscontrols" IS 'Mauvais contrôles observés.';

COMMENT ON COLUMN "football"."player_match_advanced"."dispossessed" IS 'Pertes sur dépossession.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca" IS 'Actions menant à un tir selon la méthode du fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."gca" IS 'Actions menant à un but selon cette méthode.';

COMMENT ON COLUMN "football"."player_match_advanced"."second_assists" IS 'Avant-dernières passes décisives attribuées.';

COMMENT ON COLUMN "football"."player_match_advanced"."xt_total" IS 'Expected threat fournisseur, valeur signée ; modèle identifié séparément.';

COMMENT ON COLUMN "football"."player_match_advanced"."vaep_total" IS 'Valeur VAEP totale fournisseur, signée.';

COMMENT ON COLUMN "football"."player_match_advanced"."vaep_offensive" IS 'Composante offensive VAEP, signée.';

COMMENT ON COLUMN "football"."player_match_advanced"."vaep_defensive" IS 'Composante défensive VAEP, signée.';

COMMENT ON COLUMN "football"."player_match_advanced"."pv_total" IS 'Valeur totale de possession du modèle fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."pv_offensive" IS 'Composante offensive de possession.';

COMMENT ON COLUMN "football"."player_match_advanced"."pv_defensive" IS 'Composante défensive de possession.';

COMMENT ON COLUMN "football"."player_match_advanced"."progressive_pass_distance" IS 'Distance des passes progressives, unité fournisseur à valider.';

COMMENT ON COLUMN "football"."player_match_advanced"."carry_distance" IS 'Distance de conduite, unité fournisseur à valider.';

COMMENT ON COLUMN "football"."player_match_advanced"."progressive_carry_distance" IS 'Distance des conduites progressives selon ce contrat.';

COMMENT ON COLUMN "football"."player_match_advanced"."xag" IS 'Expected assisted goals selon le modèle fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."xg_chain" IS 'Contribution xG de chaîne de possession selon ce modèle.';

COMMENT ON COLUMN "football"."player_match_advanced"."xg_buildup" IS 'Contribution xG de construction selon ce modèle.';

COMMENT ON COLUMN "football"."player_match_advanced"."provider_model_version" IS 'Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue.';

COMMENT ON COLUMN "football"."player_match_advanced"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."player_match_advanced"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_match_advanced"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."player_match_advanced"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."player_match_advanced"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."player_match_advanced"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca_pass_live" IS 'Contribution SCA de type pass_live, valeur observée selon la définition fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca_pass_dead" IS 'Contribution SCA de type pass_dead, valeur observée selon la définition fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca_take_on" IS 'Contribution SCA de type take_on, valeur observée selon la définition fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca_shot" IS 'Contribution SCA de type shot, valeur observée selon la définition fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca_foul_drawn" IS 'Contribution SCA de type foul_drawn, valeur observée selon la définition fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."sca_defensive" IS 'Contribution SCA de type defensive, valeur observée selon la définition fournisseur.';

COMMENT ON COLUMN "football"."player_match_advanced"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_match_advanced"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_match_advanced"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."player_match_advanced"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."match_player_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_advanced"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_match_advanced" (
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "period_code" text NOT NULL,
  "opponent_passes" integer,
  "defensive_actions" integer,
  "high_turnovers" integer,
  "counterpress_regains_5s" integer,
  "final_third_entries" integer,
  "box_entries" integer,
  "buildup_attacks" integer,
  "direct_attacks" integer,
  "challenges" integer,
  "aerials" integer,
  "aerials_won" integer,
  "xt_total" double precision,
  "vaep_total" double precision,
  "vaep_offensive" double precision,
  "vaep_defensive" double precision,
  "pv_total" double precision,
  "pv_offensive" double precision,
  "pv_defensive" double precision,
  "ppda" double precision,
  "field_tilt" double precision,
  "possession_pct" double precision,
  "avg_action_x" double precision,
  "avg_defensive_action_x" double precision,
  "ball_recovery_time_seconds" double precision,
  "passes_per_sequence" double precision,
  "sequence_time_seconds" double precision,
  "direct_speed" double precision,
  "provider_model_version" text,
  "coordinate_frame" text,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_match_advanced' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  "period_definition_version" text NOT NULL,
  CONSTRAINT "football_team_match_advanced_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_team_match_advanced_sv_logical_revision_uq" UNIQUE ("match_id", "team_id", "period_code", "revision_id"),
  CONSTRAINT "football_team_match_advanced_sv_variant_generation_uq" UNIQUE ("match_id", "team_id", "period_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_match_advanced_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_team_match_advanced_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_team_match_advanced_opponent_passes_nonnegative_ck" CHECK (opponent_passes >= 0),
  CONSTRAINT "football_team_match_advanced_defensive_actions_nonnegative_ck" CHECK (defensive_actions >= 0),
  CONSTRAINT "football_team_match_advanced_high_turnovers_nonnegative_ck" CHECK (high_turnovers >= 0),
  CONSTRAINT "football_team_match_advanced_counterpress_regains_5s__9682520d4" CHECK (counterpress_regains_5s >= 0),
  CONSTRAINT "football_team_match_advanced_final_third_entries_nonnegative_ck" CHECK (final_third_entries >= 0),
  CONSTRAINT "football_team_match_advanced_box_entries_nonnegative_ck" CHECK (box_entries >= 0),
  CONSTRAINT "football_team_match_advanced_buildup_attacks_nonnegative_ck" CHECK (buildup_attacks >= 0),
  CONSTRAINT "football_team_match_advanced_direct_attacks_nonnegative_ck" CHECK (direct_attacks >= 0),
  CONSTRAINT "football_team_match_advanced_challenges_nonnegative_ck" CHECK (challenges >= 0),
  CONSTRAINT "football_team_match_advanced_aerials_nonnegative_ck" CHECK (aerials >= 0),
  CONSTRAINT "football_team_match_advanced_aerials_won_nonnegative_ck" CHECK (aerials_won >= 0),
  CONSTRAINT "football_team_match_advanced_ppda_nonnegative_ck" CHECK (ppda >= 0),
  CONSTRAINT "football_team_match_advanced_ball_recovery_time_secon_6ddd21422" CHECK (ball_recovery_time_seconds >= 0),
  CONSTRAINT "football_team_match_advanced_passes_per_sequence_nonnegative_ck" CHECK (passes_per_sequence >= 0),
  CONSTRAINT "football_team_match_advanced_sequence_time_seconds_no_7a946098e" CHECK (sequence_time_seconds >= 0),
  CONSTRAINT "football_team_match_advanced_direct_speed_nonnegative_ck" CHECK (direct_speed >= 0),
  CONSTRAINT "football_team_match_advanced_possession_pct_ck" CHECK (possession_pct BETWEEN 0 AND 100),
  CONSTRAINT "football_team_match_advanced_field_tilt_ck" CHECK (field_tilt BETWEEN 0 AND 100),
  CONSTRAINT "football_team_match_advanced_aerials_bounded_ck" CHECK (aerials_won <= aerials),
  CONSTRAINT "football_team_match_advanced_xt_total_finite_ck" CHECK (xt_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_vaep_total_finite_ck" CHECK (vaep_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_vaep_offensive_finite_ck" CHECK (vaep_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_vaep_defensive_finite_ck" CHECK (vaep_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_pv_total_finite_ck" CHECK (pv_total NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_pv_offensive_finite_ck" CHECK (pv_offensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_pv_defensive_finite_ck" CHECK (pv_defensive NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_ppda_finite_ck" CHECK (ppda NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_field_tilt_finite_ck" CHECK (field_tilt NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_possession_pct_finite_ck" CHECK (possession_pct NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_avg_action_x_finite_ck" CHECK (avg_action_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_avg_defensive_action_x_finite_ck" CHECK (avg_defensive_action_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_ball_recovery_time_seco_3df4f4665d" CHECK (ball_recovery_time_seconds NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_passes_per_sequence_finite_ck" CHECK (passes_per_sequence NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_sequence_time_seconds_finite_ck" CHECK (sequence_time_seconds NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_direct_speed_finite_ck" CHECK (direct_speed NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_team_match_advanced_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_team_match_advanced_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_match_advanced_sv_relation_binding_ck" CHECK (relation_code = 'football.team_match_advanced'),
  CONSTRAINT "football_team_match_advanced_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_match_advanced_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_match_advanced_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_match_advanced_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_match_advanced_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_team_match_advanced_sv_period_definition_ve_99c1b03313" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."team_match_advanced" IS 'Mesures avancées équipe; possession d’actions distincte de la possession standard. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code), variante variant_key ; sélection canonique (match_id, team_id, period_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_match_advanced"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."team_match_advanced"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."team_match_advanced"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."team_match_advanced"."opponent_passes" IS 'Passes adverses entrant dans le périmètre de la mesure.';

COMMENT ON COLUMN "football"."team_match_advanced"."defensive_actions" IS 'Actions défensives selon le contrat de la mesure.';

COMMENT ON COLUMN "football"."team_match_advanced"."high_turnovers" IS 'Récupérations hautes selon le fournisseur.';

COMMENT ON COLUMN "football"."team_match_advanced"."counterpress_regains_5s" IS 'Récupérations dans les cinq secondes du contre-pressing.';

COMMENT ON COLUMN "football"."team_match_advanced"."final_third_entries" IS 'Entrées dans le dernier tiers.';

COMMENT ON COLUMN "football"."team_match_advanced"."box_entries" IS 'Entrées dans la surface.';

COMMENT ON COLUMN "football"."team_match_advanced"."buildup_attacks" IS 'Attaques construites selon la définition source.';

COMMENT ON COLUMN "football"."team_match_advanced"."direct_attacks" IS 'Attaques directes selon cette définition.';

COMMENT ON COLUMN "football"."team_match_advanced"."challenges" IS 'Duels/interventions du contrat avancé.';

COMMENT ON COLUMN "football"."team_match_advanced"."aerials" IS 'Duels aériens selon le contrat avancé.';

COMMENT ON COLUMN "football"."team_match_advanced"."aerials_won" IS 'Duels aériens gagnés du contrat avancé.';

COMMENT ON COLUMN "football"."team_match_advanced"."xt_total" IS 'Expected threat fournisseur, valeur signée ; modèle identifié séparément.';

COMMENT ON COLUMN "football"."team_match_advanced"."vaep_total" IS 'Valeur VAEP totale fournisseur, signée.';

COMMENT ON COLUMN "football"."team_match_advanced"."vaep_offensive" IS 'Composante offensive VAEP, signée.';

COMMENT ON COLUMN "football"."team_match_advanced"."vaep_defensive" IS 'Composante défensive VAEP, signée.';

COMMENT ON COLUMN "football"."team_match_advanced"."pv_total" IS 'Valeur totale de possession du modèle fournisseur.';

COMMENT ON COLUMN "football"."team_match_advanced"."pv_offensive" IS 'Composante offensive de possession.';

COMMENT ON COLUMN "football"."team_match_advanced"."pv_defensive" IS 'Composante défensive de possession.';

COMMENT ON COLUMN "football"."team_match_advanced"."ppda" IS 'Passes adverses par action défensive selon le contrat source ; dénominateur conservé lorsqu’il existe.';

COMMENT ON COLUMN "football"."team_match_advanced"."field_tilt" IS 'Part territoriale normalisée sous contrat, échelle 0–100.';

COMMENT ON COLUMN "football"."team_match_advanced"."possession_pct" IS 'Possession en pourcentage 0–100, selon la définition de cette table.';

COMMENT ON COLUMN "football"."team_match_advanced"."avg_action_x" IS 'Position longitudinale moyenne des actions, repère déclaré.';

COMMENT ON COLUMN "football"."team_match_advanced"."avg_defensive_action_x" IS 'Position longitudinale moyenne des actions défensives.';

COMMENT ON COLUMN "football"."team_match_advanced"."ball_recovery_time_seconds" IS 'Temps de récupération en secondes selon le contrat source.';

COMMENT ON COLUMN "football"."team_match_advanced"."passes_per_sequence" IS 'Passes par séquence selon le contrat source.';

COMMENT ON COLUMN "football"."team_match_advanced"."sequence_time_seconds" IS 'Durée de séquence en secondes.';

COMMENT ON COLUMN "football"."team_match_advanced"."direct_speed" IS 'Vitesse de progression directe ; unité de la définition fournisseur.';

COMMENT ON COLUMN "football"."team_match_advanced"."provider_model_version" IS 'Version déclarée du modèle statistique fournisseur ; ne pas en inventer une si inconnue.';

COMMENT ON COLUMN "football"."team_match_advanced"."coordinate_frame" IS 'Repère spatial déclaré par la source, propre à cette famille.';

COMMENT ON COLUMN "football"."team_match_advanced"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."team_match_advanced"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_match_advanced"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."team_match_advanced"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."team_match_advanced"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."team_match_advanced"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."team_match_advanced"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_match_advanced"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_match_advanced"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_match_advanced"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_advanced"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_events" (
  "match_id" bigint NOT NULL,
  "event_seq" integer NOT NULL,
  "event_type" text NOT NULL,
  "period_code" text,
  "minute" integer,
  "minute_added" integer,
  "second" smallint,
  "team_id" bigint,
  "player_id" bigint,
  "related_player_id" bigint,
  "is_penalty" boolean,
  "is_own_goal" boolean,
  "source_event_id" text,
  "source_ordinal" integer NOT NULL,
  "source_id" bigint NOT NULL,
  "source_record_id" bigint NOT NULL,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "score_home" integer,
  "score_away" integer,
  "feature_code" text NOT NULL,
  "variant_key" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "match_revision_id" bigint NOT NULL,
  "match_team_revision_id" bigint,
  "period_definition_version" text,
  CONSTRAINT "football_match_events_sv_pk" PRIMARY KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen", "event_seq"),
  CONSTRAINT "football_match_events_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_events_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_events_event_seq_nonnegative_ck" CHECK (event_seq >= 0),
  CONSTRAINT "football_match_events_source_ordinal_nonnegative_ck" CHECK (source_ordinal >= 0),
  CONSTRAINT "football_match_events_minute_nonnegative_ck" CHECK (minute >= 0),
  CONSTRAINT "football_match_events_minute_added_nonnegative_ck" CHECK (minute_added >= 0),
  CONSTRAINT "football_match_events_second_ck" CHECK (second BETWEEN 0 AND 59),
  CONSTRAINT "football_match_events_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_events_sv_collection_family_ck" CHECK (feature_code = 'events'),
  CONSTRAINT "football_match_events_sv_match_team_revision_id_pair_ck" CHECK ((match_team_revision_id IS NULL AND (match_id IS NULL OR team_id IS NULL)) OR (match_team_revision_id IS NOT NULL AND match_id IS NOT NULL AND team_id IS NOT NULL)),
  CONSTRAINT "football_match_events_sv_period_definition_version_pair_ck" CHECK ((period_code IS NULL) = (period_definition_version IS NULL)),
  CONSTRAINT "football_match_events_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_match_events_sv_period_definition_version_nonempty_ck" CHECK (period_definition_version IS NULL OR (btrim(period_definition_version) <> ''))
);

COMMENT ON TABLE "football"."match_events" IS 'Flux courant d’événements remplacé atomiquement lors d’une correction. Grain physique : un enfant (event_seq) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, event_seq). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée. Grain: Ligne physique : un enfant (event_seq) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, event_seq). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.';

COMMENT ON COLUMN "football"."match_events"."match_id" IS 'Référence SQL vers football.matches(id, revision_id); football.match_teams(match_id, team_id, revision_id); ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen).';

COMMENT ON COLUMN "football"."match_events"."event_seq" IS 'Ordre dans une version du flux ; ne constitue pas une identité stable entre corrections.';

COMMENT ON COLUMN "football"."match_events"."event_type" IS 'Type d’événement observé ; mapping versionné si normalisé.';

COMMENT ON COLUMN "football"."match_events"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."match_events"."minute" IS 'Minute source dans la période indiquée ; précision conservée.';

COMMENT ON COLUMN "football"."match_events"."minute_added" IS 'Temps additionnel distinct de la minute principale.';

COMMENT ON COLUMN "football"."match_events"."second" IS 'Seconde dans la minute, de 0 à 59.';

COMMENT ON COLUMN "football"."match_events"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_events"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."match_events"."related_player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."match_events"."is_penalty" IS 'Penalty explicitement signalé dans l’observation.';

COMMENT ON COLUMN "football"."match_events"."is_own_goal" IS 'But contre son camp explicitement signalé.';

COMMENT ON COLUMN "football"."match_events"."source_event_id" IS 'Identifiant natif d’événement s’il existe ; sinon ordre dans la famille versionnée.';

COMMENT ON COLUMN "football"."match_events"."source_ordinal" IS 'Position native dans la collection source, conservée pour la compatibilité.';

COMMENT ON COLUMN "football"."match_events"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_events"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_events"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_events"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_events"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_events"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_events"."score_home" IS 'Score observé après l’événement, sans supposer sa portée si la source ne la donne pas.';

COMMENT ON COLUMN "football"."match_events"."score_away" IS 'Score observé après l’événement, sans supposer sa portée si la source ne la donne pas.';

COMMENT ON COLUMN "football"."match_events"."feature_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_events"."variant_key" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_events"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_events"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_events"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_events"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_momentum" (
  "match_id" bigint NOT NULL,
  "series_code" text NOT NULL,
  "sample_index" integer NOT NULL,
  "minute" double precision,
  "period_code" text,
  "value" double precision NOT NULL,
  "source_id" bigint NOT NULL,
  "source_record_id" bigint NOT NULL,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "feature_code" text NOT NULL,
  "variant_key" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "match_revision_id" bigint NOT NULL,
  "period_definition_version" text,
  CONSTRAINT "football_match_momentum_sv_pk" PRIMARY KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen", "series_code", "sample_index"),
  CONSTRAINT "football_match_momentum_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_momentum_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_momentum_sample_index_nonnegative_ck" CHECK (sample_index >= 0),
  CONSTRAINT "football_match_momentum_minute_nonnegative_ck" CHECK (minute >= 0),
  CONSTRAINT "football_match_momentum_minute_finite_ck" CHECK (minute NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_match_momentum_value_finite_ck" CHECK (value NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_match_momentum_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_momentum_sv_collection_family_ck" CHECK (feature_code = 'momentum'),
  CONSTRAINT "football_match_momentum_sv_period_definition_version_pair_ck" CHECK ((period_code IS NULL) = (period_definition_version IS NULL)),
  CONSTRAINT "football_match_momentum_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_match_momentum_sv_period_definition_version_1ddca542c9" CHECK (period_definition_version IS NULL OR (btrim(period_definition_version) <> ''))
);

COMMENT ON TABLE "football"."match_momentum" IS 'Séries de momentum observées; un tableau vide ne crée pas des zéros. Grain physique : un enfant (series_code, sample_index) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, series_code, sample_index). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée. Grain: Ligne physique : un enfant (series_code, sample_index) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, series_code, sample_index). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.';

COMMENT ON COLUMN "football"."match_momentum"."match_id" IS 'Référence SQL vers football.matches(id, revision_id); ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen).';

COMMENT ON COLUMN "football"."match_momentum"."series_code" IS 'Série de momentum concernée, conservée distinctement des autres séries.';

COMMENT ON COLUMN "football"."match_momentum"."sample_index" IS 'Index du point dans l’ordre natif de la série de momentum.';

COMMENT ON COLUMN "football"."match_momentum"."minute" IS 'Minute source dans la période indiquée ; précision conservée.';

COMMENT ON COLUMN "football"."match_momentum"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."match_momentum"."value" IS 'Valeur fournie dans le grain et l’unité définis par la table.';

COMMENT ON COLUMN "football"."match_momentum"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_momentum"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_momentum"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_momentum"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_momentum"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_momentum"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_momentum"."feature_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_momentum"."variant_key" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_momentum"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_momentum"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_momentum"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."pass_networks" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "window_kind" text NOT NULL,
  "from_seconds" integer,
  "until_seconds" integer,
  "centralization" double precision,
  "coordinate_frame" text,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "relation_code" text DEFAULT 'football.pass_networks' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  CONSTRAINT "football_pass_networks_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_pass_networks_sv_natural_0_generation_uq" UNIQUE NULLS NOT DISTINCT ("match_id", "team_id", "window_kind", "from_seconds", "until_seconds", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_pass_networks_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_pass_networks_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_pass_networks_from_seconds_nonnegative_ck" CHECK (from_seconds >= 0),
  CONSTRAINT "football_pass_networks_until_seconds_nonnegative_ck" CHECK (until_seconds >= 0),
  CONSTRAINT "football_pass_networks_until_seconds_after_from_seconds_ck" CHECK (until_seconds >= from_seconds),
  CONSTRAINT "football_pass_networks_centralization_finite_ck" CHECK (centralization NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_pass_networks_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_pass_networks_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_pass_networks_sv_relation_binding_ck" CHECK (relation_code = 'football.pass_networks'),
  CONSTRAINT "football_pass_networks_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_pass_networks_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_pass_networks_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_pass_networks_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_pass_networks_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."pass_networks" IS 'Réseaux de passes pour une fenêtre explicitement conservée. Grain physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, window_kind, from_seconds, until_seconds), variante variant_key ; sélection canonique (match_id, team_id, window_kind, from_seconds, until_seconds) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, window_kind, from_seconds, until_seconds), variante variant_key ; sélection canonique (match_id, team_id, window_kind, from_seconds, until_seconds) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."pass_networks"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."pass_networks"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."pass_networks"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."pass_networks"."window_kind" IS 'Contrat de la fenêtre temporelle du réseau.';

COMMENT ON COLUMN "football"."pass_networks"."from_seconds" IS 'Début connu de la fenêtre du réseau, en secondes de match.';

COMMENT ON COLUMN "football"."pass_networks"."until_seconds" IS 'Fin de la fenêtre ; first_substitution ne décrit pas tout le match.';

COMMENT ON COLUMN "football"."pass_networks"."centralization" IS 'Centralisation collective fournie pour cette fenêtre.';

COMMENT ON COLUMN "football"."pass_networks"."coordinate_frame" IS 'Repère spatial déclaré par la source, propre à cette famille.';

COMMENT ON COLUMN "football"."pass_networks"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."pass_networks"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."pass_networks"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."pass_networks"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."pass_networks"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."pass_networks"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."pass_networks"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."pass_networks"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."pass_networks"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."pass_networks"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."pass_networks"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."pass_networks"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."pass_networks"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."pass_networks"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."pass_networks"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."pass_networks"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."pass_network_nodes" (
  "network_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "avg_x" double precision,
  "avg_y" double precision,
  "passes" integer,
  "passes_received" integer,
  "degree" integer,
  "strength" double precision,
  "betweenness" double precision,
  "clustering" double precision,
  CONSTRAINT "football_pass_network_nodes_pk" PRIMARY KEY ("network_id", "player_id"),
  CONSTRAINT "football_pass_network_nodes_passes_nonnegative_ck" CHECK (passes >= 0),
  CONSTRAINT "football_pass_network_nodes_passes_received_nonnegative_ck" CHECK (passes_received >= 0),
  CONSTRAINT "football_pass_network_nodes_degree_nonnegative_ck" CHECK (degree >= 0),
  CONSTRAINT "football_pass_network_nodes_strength_nonnegative_ck" CHECK (strength >= 0),
  CONSTRAINT "football_pass_network_nodes_betweenness_nonnegative_ck" CHECK (betweenness >= 0),
  CONSTRAINT "football_pass_network_nodes_clustering_nonnegative_ck" CHECK (clustering >= 0),
  CONSTRAINT "football_pass_network_nodes_avg_x_finite_ck" CHECK (avg_x NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_pass_network_nodes_avg_y_finite_ck" CHECK (avg_y NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_pass_network_nodes_strength_finite_ck" CHECK (strength NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_pass_network_nodes_betweenness_finite_ck" CHECK (betweenness NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_pass_network_nodes_clustering_finite_ck" CHECK (clustering NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision))
);

COMMENT ON TABLE "football"."pass_network_nodes" IS 'Joueurs présents dans un réseau. Grain physique : un enfant (player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée. Grain: Ligne physique : un enfant (player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.';

COMMENT ON COLUMN "football"."pass_network_nodes"."network_id" IS 'Référence SQL vers football.pass_networks(id).';

COMMENT ON COLUMN "football"."pass_network_nodes"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."pass_network_nodes"."avg_x" IS 'Position longitudinale moyenne dans le repère du réseau.';

COMMENT ON COLUMN "football"."pass_network_nodes"."avg_y" IS 'Position transversale moyenne dans ce repère.';

COMMENT ON COLUMN "football"."pass_network_nodes"."passes" IS 'Passes observées pour le nœud, l’arête ou le périmètre de cette table.';

COMMENT ON COLUMN "football"."pass_network_nodes"."passes_received" IS 'Passes reçues par ce nœud du réseau.';

COMMENT ON COLUMN "football"."pass_network_nodes"."degree" IS 'Degré du nœud selon le contrat réseau.';

COMMENT ON COLUMN "football"."pass_network_nodes"."strength" IS 'Force pondérée du nœud selon le contrat fournisseur.';

COMMENT ON COLUMN "football"."pass_network_nodes"."betweenness" IS 'Centralité d’intermédiarité fournie.';

COMMENT ON COLUMN "football"."pass_network_nodes"."clustering" IS 'Coefficient de clustering fourni.';

CREATE TABLE "football"."pass_network_edges" (
  "network_id" bigint NOT NULL,
  "from_player_id" bigint NOT NULL,
  "to_player_id" bigint NOT NULL,
  "passes" integer NOT NULL,
  CONSTRAINT "football_pass_network_edges_pk" PRIMARY KEY ("network_id", "from_player_id", "to_player_id"),
  CONSTRAINT "football_pass_network_edges_different_players_ck" CHECK (from_player_id <> to_player_id),
  CONSTRAINT "football_pass_network_edges_passes_positive_ck" CHECK (passes > 0)
);

COMMENT ON TABLE "football"."pass_network_edges" IS 'Passes dirigées entre deux nœuds du même réseau. Grain physique : un enfant (from_player_id, to_player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, from_player_id, to_player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée. Grain: Ligne physique : un enfant (from_player_id, to_player_id) de la version parente football.pass_networks(id), liée par (network_id) ; PK (network_id, from_player_id, to_player_id). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.';

COMMENT ON COLUMN "football"."pass_network_edges"."network_id" IS 'Référence SQL vers football.pass_network_nodes(network_id, player_id); football.pass_network_nodes(network_id, player_id).';

COMMENT ON COLUMN "football"."pass_network_edges"."from_player_id" IS 'Référence SQL vers football.pass_network_nodes(network_id, player_id).';

COMMENT ON COLUMN "football"."pass_network_edges"."to_player_id" IS 'Référence SQL vers football.pass_network_nodes(network_id, player_id).';

COMMENT ON COLUMN "football"."pass_network_edges"."passes" IS 'Passes observées pour le nœud, l’arête ou le périmètre de cette table.';

CREATE TABLE "football"."match_heatmaps" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "player_id" bigint,
  "period_code" text NOT NULL,
  "map_kind" text NOT NULL,
  "grid_columns" smallint NOT NULL,
  "grid_rows" smallint NOT NULL,
  "cell_length_m" double precision NOT NULL,
  "cell_width_m" double precision NOT NULL,
  "coordinate_frame" text NOT NULL,
  "actions" integer,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "cells_state" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "relation_code" text DEFAULT 'football.match_heatmaps' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  "period_definition_version" text NOT NULL,
  CONSTRAINT "football_match_heatmaps_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_match_heatmaps_sv_natural_0_generation_uq" UNIQUE NULLS NOT DISTINCT ("match_id", "team_id", "player_id", "period_code", "map_kind", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_match_heatmaps_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_match_heatmaps_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_match_heatmaps_grid_positive_ck" CHECK (grid_columns > 0 AND grid_rows > 0 AND cell_length_m > 0 AND cell_width_m > 0),
  CONSTRAINT "football_match_heatmaps_actions_nonnegative_ck" CHECK (actions >= 0),
  CONSTRAINT "football_match_heatmaps_cells_state_ck" CHECK (cells_state IN ('absent','null','empty','available')),
  CONSTRAINT "football_match_heatmaps_cell_length_m_finite_ck" CHECK (cell_length_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_match_heatmaps_cell_width_m_finite_ck" CHECK (cell_width_m NOT IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)),
  CONSTRAINT "football_match_heatmaps_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_match_heatmaps_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_match_heatmaps_sv_relation_binding_ck" CHECK (relation_code = 'football.match_heatmaps'),
  CONSTRAINT "football_match_heatmaps_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_match_heatmaps_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_match_heatmaps_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_match_heatmaps_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_match_heatmaps_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_match_heatmaps_sv_period_definition_version_6a320558cc" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."match_heatmaps" IS 'Cartes spatiales typées : grille et repère ici, cellules dans football.match_heatmap_cells. Grain physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, player_id, period_code, map_kind), variante variant_key ; sélection canonique (match_id, team_id, player_id, period_code, map_kind) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une version complète immuable de famille identifiée par un nouvel id, PK (id) ; clé logique (match_id, team_id, player_id, period_code, map_kind), variante variant_key ; sélection canonique (match_id, team_id, player_id, period_code, map_kind) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."match_heatmaps"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."match_heatmaps"."match_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_heatmaps"."team_id" IS 'Référence SQL vers football.match_teams(match_id, team_id, revision_id).';

COMMENT ON COLUMN "football"."match_heatmaps"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."match_heatmaps"."period_code" IS 'Référence SQL vers football.periods(code, definition_version).';

COMMENT ON COLUMN "football"."match_heatmaps"."map_kind" IS 'Nature de la carte spatiale.';

COMMENT ON COLUMN "football"."match_heatmaps"."grid_columns" IS 'Nombre de colonnes de la grille spatiale.';

COMMENT ON COLUMN "football"."match_heatmaps"."grid_rows" IS 'Nombre de lignes de la grille spatiale.';

COMMENT ON COLUMN "football"."match_heatmaps"."cell_length_m" IS 'Longueur en mètres d’une cellule.';

COMMENT ON COLUMN "football"."match_heatmaps"."cell_width_m" IS 'Largeur en mètres d’une cellule.';

COMMENT ON COLUMN "football"."match_heatmaps"."coordinate_frame" IS 'Repère spatial déclaré par la source, propre à cette famille.';

COMMENT ON COLUMN "football"."match_heatmaps"."actions" IS 'Nombre d’actions couvertes, si renseigné.';

COMMENT ON COLUMN "football"."match_heatmaps"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."match_heatmaps"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_heatmaps"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."match_heatmaps"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."match_heatmaps"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."match_heatmaps"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."match_heatmaps"."cells_state" IS 'absent, null, empty ou available ; aucun tableau vide interprété comme une grille de zéros.';

COMMENT ON COLUMN "football"."match_heatmaps"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."match_heatmaps"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."match_heatmaps"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."match_heatmaps"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_heatmaps"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_coach_tenures" (
  "id" bigint DEFAULT nextval('football.team_coach_tenures_logical_id_seq'::regclass) NOT NULL,
  "team_id" bigint NOT NULL,
  "coach_id" bigint NOT NULL,
  "role" text NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "date_precision" text NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_coach_tenures' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "coach_revision_id" bigint NOT NULL,
  CONSTRAINT "football_team_coach_tenures_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_team_coach_tenures_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_team_coach_tenures_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_coach_tenures_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_team_coach_tenures_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_team_coach_tenures_valid_to_after_valid_from_ck" CHECK (valid_to >= valid_from),
  CONSTRAINT "football_team_coach_tenures_date_precision_ck" CHECK (date_precision IN ('day', 'month', 'year', 'unknown')),
  CONSTRAINT "football_team_coach_tenures_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_team_coach_tenures_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_coach_tenures_sv_relation_binding_ck" CHECK (relation_code = 'football.team_coach_tenures'),
  CONSTRAINT "football_team_coach_tenures_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_coach_tenures_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_coach_tenures_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_coach_tenures_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_coach_tenures_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."team_coach_tenures" IS 'Périodes d’exercice des entraîneurs; séparées de l’attribution d’un match. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_coach_tenures"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."team_coach_tenures"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."team_coach_tenures"."coach_id" IS 'Référence SQL vers football.coaches(id, revision_id).';

COMMENT ON COLUMN "football"."team_coach_tenures"."role" IS 'Fonction effectivement observée de l’entraîneur durant cet épisode.';

COMMENT ON COLUMN "football"."team_coach_tenures"."valid_from" IS 'Début de validité connu, sans remplacer une observation par une date de signature.';

COMMENT ON COLUMN "football"."team_coach_tenures"."valid_to" IS 'Fin de validité connue ; NULL conserve une borne inconnue.';

COMMENT ON COLUMN "football"."team_coach_tenures"."date_precision" IS 'Précision réelle des dates : day, month, year ou unknown.';

COMMENT ON COLUMN "football"."team_coach_tenures"."observed_at" IS 'Instant auquel l’information a été observée ; ne prouve pas une date de validité métier.';

COMMENT ON COLUMN "football"."team_coach_tenures"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."team_coach_tenures"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_coach_tenures"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."team_coach_tenures"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."team_coach_tenures"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."team_coach_tenures"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."team_coach_tenures"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_coach_tenures"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_coach_tenures"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_coach_tenures"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_coach_tenures"."coach_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."honour_definitions" (
  "id" bigint DEFAULT nextval('football.honour_definitions_logical_id_seq'::regclass) NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "honour_type" text NOT NULL,
  "competition_id" bigint,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.honour_definitions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  "competition_revision_id" bigint,
  CONSTRAINT "football_honour_definitions_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_honour_definitions_sv_natural_0_generation_uq" UNIQUE ("code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_honour_definitions_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_honour_definitions_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_honour_definitions_honour_type_ck" CHECK (honour_type IN ('team', 'individual')),
  CONSTRAINT "football_honour_definitions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_honour_definitions_sv_relation_binding_ck" CHECK (relation_code = 'football.honour_definitions'),
  CONSTRAINT "football_honour_definitions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_honour_definitions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_honour_definitions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_honour_definitions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_honour_definitions_sv_competition_revision_id_pair_ck" CHECK ((competition_revision_id IS NULL AND (competition_id IS NULL)) OR (competition_revision_id IS NOT NULL AND competition_id IS NOT NULL)),
  CONSTRAINT "football_honour_definitions_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."honour_definitions" IS 'Définitions des titres collectifs et distinctions individuelles. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."honour_definitions"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."honour_definitions"."code" IS 'Code stable du référentiel, avec sa définition explicite.';

COMMENT ON COLUMN "football"."honour_definitions"."name" IS 'Nom de l’entité dans le contexte défini par cette table.';

COMMENT ON COLUMN "football"."honour_definitions"."honour_type" IS 'Titre collectif ou distinction individuelle.';

COMMENT ON COLUMN "football"."honour_definitions"."competition_id" IS 'Référence SQL vers football.competitions(id, revision_id).';

COMMENT ON COLUMN "football"."honour_definitions"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."honour_definitions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."honour_definitions"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."honour_definitions"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."honour_definitions"."competition_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."player_honours" (
  "id" bigint DEFAULT nextval('football.player_honours_logical_id_seq'::regclass) NOT NULL,
  "player_id" bigint NOT NULL,
  "honour_id" bigint NOT NULL,
  "competition_season_id" bigint,
  "season_label" text,
  "edition_key" text NOT NULL,
  "outcome" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "team_id" bigint,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.player_honours' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "honour_revision_id" bigint NOT NULL,
  "competition_season_revision_id" bigint,
  CONSTRAINT "football_player_honours_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_player_honours_sv_natural_0_generation_uq" UNIQUE NULLS NOT DISTINCT ("player_id", "honour_id", "edition_key", "outcome", "team_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_honours_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_player_honours_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_honours_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_player_honours_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_player_honours_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_player_honours_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_honours_sv_relation_binding_ck" CHECK (relation_code = 'football.player_honours'),
  CONSTRAINT "football_player_honours_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_honours_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_honours_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_player_honours_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_player_honours_sv_competition_season_revisi_333c5e2849" CHECK ((competition_season_revision_id IS NULL AND (competition_season_id IS NULL)) OR (competition_season_revision_id IS NOT NULL AND competition_season_id IS NOT NULL)),
  CONSTRAINT "football_player_honours_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."player_honours" IS 'Distinctions attribuées avec leur contexte historique. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_honours"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."player_honours"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "football"."player_honours"."honour_id" IS 'Référence SQL vers football.honour_definitions(id, revision_id).';

COMMENT ON COLUMN "football"."player_honours"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id).';

COMMENT ON COLUMN "football"."player_honours"."season_label" IS 'Libellé historique conservé lorsqu’aucune édition canonique n’est résolue.';

COMMENT ON COLUMN "football"."player_honours"."edition_key" IS 'Clé d’édition de la distinction, conservée même sans édition de compétition résolue.';

COMMENT ON COLUMN "football"."player_honours"."outcome" IS 'Résultat du tir selon un mapping documenté.';

COMMENT ON COLUMN "football"."player_honours"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."player_honours"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_honours"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."player_honours"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."player_honours"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."player_honours"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."player_honours"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."player_honours"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_honours"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_honours"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."player_honours"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."honour_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_honours"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_honours" (
  "id" bigint DEFAULT nextval('football.team_honours_logical_id_seq'::regclass) NOT NULL,
  "team_id" bigint NOT NULL,
  "honour_id" bigint NOT NULL,
  "competition_season_id" bigint,
  "season_label" text,
  "edition_key" text NOT NULL,
  "outcome" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_honours' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "provenance_kind" text NOT NULL,
  "honour_revision_id" bigint NOT NULL,
  "competition_season_revision_id" bigint,
  CONSTRAINT "football_team_honours_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_team_honours_sv_natural_0_generation_uq" UNIQUE NULLS NOT DISTINCT ("team_id", "honour_id", "edition_key", "outcome", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_honours_sv_logical_revision_uq" UNIQUE ("id", "revision_id"),
  CONSTRAINT "football_team_honours_sv_variant_generation_uq" UNIQUE ("id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_honours_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_team_honours_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_team_honours_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_team_honours_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_honours_sv_relation_binding_ck" CHECK (relation_code = 'football.team_honours'),
  CONSTRAINT "football_team_honours_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_honours_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_honours_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_honours_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_honours_sv_competition_season_revision_id_pair_ck" CHECK ((competition_season_revision_id IS NULL AND (competition_season_id IS NULL)) OR (competition_season_revision_id IS NOT NULL AND competition_season_id IS NOT NULL)),
  CONSTRAINT "football_team_honours_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."team_honours" IS 'Distinctions attribuées avec leur contexte historique. Grain physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (id), variante variant_key ; sélection canonique (id) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_honours"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."team_honours"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."team_honours"."honour_id" IS 'Référence SQL vers football.honour_definitions(id, revision_id).';

COMMENT ON COLUMN "football"."team_honours"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id).';

COMMENT ON COLUMN "football"."team_honours"."season_label" IS 'Libellé historique conservé lorsqu’aucune édition canonique n’est résolue.';

COMMENT ON COLUMN "football"."team_honours"."edition_key" IS 'Clé d’édition de la distinction, conservée même sans édition de compétition résolue.';

COMMENT ON COLUMN "football"."team_honours"."outcome" IS 'Résultat du tir selon un mapping documenté.';

COMMENT ON COLUMN "football"."team_honours"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."team_honours"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_honours"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."team_honours"."data_revision" IS 'Révision croissante au grain ou à la famille publié(e).';

COMMENT ON COLUMN "football"."team_honours"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."team_honours"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."team_honours"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_honours"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_honours"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_honours"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."honour_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_honours"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."standing_snapshots" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "stage_id" bigint,
  "group_id" bigint,
  "group_label" text,
  "scope" text NOT NULL,
  "effective_at" timestamptz,
  "observed_at" timestamptz NOT NULL,
  "source_id" bigint NOT NULL,
  "source_record_id" bigint NOT NULL,
  "canonical_policy_version" text NOT NULL,
  "data_revision" bigint DEFAULT 1 NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "competition_season_revision_id" bigint NOT NULL,
  "stage_revision_id" bigint,
  "group_revision_id" bigint,
  CONSTRAINT "football_standing_snapshots_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_standing_snapshots_sv_normalization_revision_uq" UNIQUE NULLS NOT DISTINCT ("source_record_id", "competition_season_id", "stage_id", "group_id", "group_label", "scope", "data_revision"),
  CONSTRAINT "football_standing_snapshots_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_standing_snapshots_revision_positive_ck" CHECK (data_revision > 0),
  CONSTRAINT "football_standing_snapshots_group_requires_stage_ck" CHECK (group_id IS NULL OR stage_id IS NOT NULL),
  CONSTRAINT "football_standing_snapshots_scope_ck" CHECK (scope IN ('overall', 'home', 'away')),
  CONSTRAINT "football_standing_snapshots_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384),
  CONSTRAINT "football_standing_snapshots_sv_stage_revision_id_pair_ck" CHECK ((stage_revision_id IS NULL AND (stage_id IS NULL)) OR (stage_revision_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL)),
  CONSTRAINT "football_standing_snapshots_sv_group_revision_id_pair_ck" CHECK ((group_revision_id IS NULL AND (group_id IS NULL)) OR (group_revision_id IS NOT NULL AND group_id IS NOT NULL AND stage_id IS NOT NULL AND competition_season_id IS NOT NULL))
);

COMMENT ON TABLE "football"."standing_snapshots" IS 'Classements de championnat observés, datés et rattachés à une édition. Grain: Une révision interne de normalisation d’un tableau source/contextuel ; nouvel id physique et nouvelles lignes enfants pour chaque correction retenue.';

COMMENT ON COLUMN "football"."standing_snapshots"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."standing_snapshots"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id); football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."standing_snapshots"."stage_id" IS 'Référence SQL vers football.competition_stages(id, competition_season_id, revision_id); football.competition_groups(id, stage_id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."standing_snapshots"."group_id" IS 'Référence SQL vers football.competition_groups(id, stage_id, competition_season_id, revision_id).';

COMMENT ON COLUMN "football"."standing_snapshots"."group_label" IS 'Libellé historique du groupe si aucune identité de groupe n’est encore résolue.';

COMMENT ON COLUMN "football"."standing_snapshots"."scope" IS 'Périmètre explicite de la mesure ou du classement ; ne pas additionner des périmètres qui se recouvrent.';

COMMENT ON COLUMN "football"."standing_snapshots"."effective_at" IS 'Instant d’effet connu de ce tableau de classement.';

COMMENT ON COLUMN "football"."standing_snapshots"."observed_at" IS 'Instant auquel l’information a été observée ; ne prouve pas une date de validité métier.';

COMMENT ON COLUMN "football"."standing_snapshots"."source_id" IS 'Espace fournisseur de la famille canonique retenue.';

COMMENT ON COLUMN "football"."standing_snapshots"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."standing_snapshots"."canonical_policy_version" IS 'Version de la règle de sélection entre sources.';

COMMENT ON COLUMN "football"."standing_snapshots"."data_revision" IS 'Révision interne de normalisation du tableau complet, couvrant corrections fournisseur, parseur et mapping ; strictement croissante avec sa génération. Un réimport identique réutilise la révision existante.';

COMMENT ON COLUMN "football"."standing_snapshots"."quality_flags" IS 'Drapeaux de qualité; jamais un remplacement des colonnes métier.';

COMMENT ON COLUMN "football"."standing_snapshots"."updated_at" IS 'Dernière modification explicite par l’ingestion ; le DEFAULT ne met pas ce champ à jour automatiquement.';

COMMENT ON COLUMN "football"."standing_snapshots"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."standing_snapshots"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."standing_snapshots"."stage_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."standing_snapshots"."group_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."standing_rows" (
  "snapshot_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "rank" integer,
  "played" integer,
  "wins" integer,
  "draws" integer,
  "losses" integer,
  "goals_for" integer,
  "goals_against" integer,
  "points" numeric(12,3),
  "points_adjustment" numeric(12,3),
  "source_label" text,
  CONSTRAINT "football_standing_rows_pk" PRIMARY KEY ("snapshot_id", "team_id"),
  CONSTRAINT "football_standing_rows_played_nonnegative_ck" CHECK (played >= 0),
  CONSTRAINT "football_standing_rows_wins_nonnegative_ck" CHECK (wins >= 0),
  CONSTRAINT "football_standing_rows_draws_nonnegative_ck" CHECK (draws >= 0),
  CONSTRAINT "football_standing_rows_losses_nonnegative_ck" CHECK (losses >= 0),
  CONSTRAINT "football_standing_rows_goals_for_nonnegative_ck" CHECK (goals_for >= 0),
  CONSTRAINT "football_standing_rows_goals_against_nonnegative_ck" CHECK (goals_against >= 0),
  CONSTRAINT "football_standing_rows_rank_positive_ck" CHECK (rank > 0)
);

COMMENT ON TABLE "football"."standing_rows" IS 'Lignes des classements de championnat publiés. Grain: Instantané × équipe.';

COMMENT ON COLUMN "football"."standing_rows"."snapshot_id" IS 'Référence SQL vers football.standing_snapshots(id).';

COMMENT ON COLUMN "football"."standing_rows"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."standing_rows"."rank" IS 'Rang publié ; les ex aequo ne sont pas interdits sans règle de la source.';

COMMENT ON COLUMN "football"."standing_rows"."played" IS 'Participation prouvée dans match_players ; dans un classement, nombre de matchs joués.';

COMMENT ON COLUMN "football"."standing_rows"."wins" IS 'Victoires observées/calculées dans le périmètre de cette table.';

COMMENT ON COLUMN "football"."standing_rows"."draws" IS 'Matchs nuls dans ce périmètre.';

COMMENT ON COLUMN "football"."standing_rows"."losses" IS 'Défaites dans ce périmètre.';

COMMENT ON COLUMN "football"."standing_rows"."goals_for" IS 'Buts marqués dans ce périmètre.';

COMMENT ON COLUMN "football"."standing_rows"."goals_against" IS 'Buts encaissés dans ce périmètre.';

COMMENT ON COLUMN "football"."standing_rows"."points" IS 'Points publiés ; peuvent inclure bonus et sanctions selon le classement.';

COMMENT ON COLUMN "football"."standing_rows"."points_adjustment" IS 'Bonus ou sanction publiés ; valeur signée.';

COMMENT ON COLUMN "football"."standing_rows"."source_label" IS 'Libellé natif de la ligne de classement, conservé pour le contexte.';

CREATE TABLE "football"."ranking_systems" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "code" text NOT NULL,
  "authority" text NOT NULL,
  "subject_kind" text NOT NULL,
  "gender" text NOT NULL,
  "methodology_version" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  CONSTRAINT "football_ranking_systems_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_ranking_systems_code_methodology_version_uq" UNIQUE ("code", "methodology_version"),
  CONSTRAINT "football_ranking_systems_id_subject_kind_uq" UNIQUE ("id", "subject_kind"),
  CONSTRAINT "football_ranking_systems_subject_kind_ck" CHECK (subject_kind IN ('team', 'association')),
  CONSTRAINT "football_ranking_systems_gender_ck" CHECK (gender IN ('men', 'women', 'mixed', 'unknown')),
  CONSTRAINT "football_ranking_systems_sv_methodology_version_nonempty_ck" CHECK (btrim(methodology_version) <> '')
);

COMMENT ON TABLE "football"."ranking_systems" IS 'Classements externes FIFA, UEFA et leurs définitions. Grain: Un système et sa version de méthode.';

COMMENT ON COLUMN "football"."ranking_systems"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."ranking_systems"."code" IS 'Code stable du référentiel, avec sa définition explicite.';

COMMENT ON COLUMN "football"."ranking_systems"."authority" IS 'Organisme qui publie ce classement, par exemple FIFA ou UEFA.';

COMMENT ON COLUMN "football"."ranking_systems"."subject_kind" IS 'Type d’entité classée ou agrégée ; les fédérations restent distinctes des équipes.';

COMMENT ON COLUMN "football"."ranking_systems"."gender" IS 'Catégorie sportive déclarée : men, women, mixed ou unknown.';

COMMENT ON COLUMN "football"."ranking_systems"."methodology_version" IS 'Version immuable de méthode ; une nouvelle méthode conserve un nouvel id de système sous le même code.';

COMMENT ON COLUMN "football"."ranking_systems"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."ranking_snapshots" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "system_id" bigint NOT NULL,
  "subject_kind" text NOT NULL,
  "edition_key" text NOT NULL,
  "period_label" text,
  "effective_on" date,
  "published_at" timestamptz,
  "source_updated_at" timestamptz,
  "retrieved_at" timestamptz NOT NULL,
  "official_edition" boolean,
  "revision" integer NOT NULL,
  "source_document_id" bigint NOT NULL,
  "quality_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "base_season_year" integer,
  "target_season_year" integer,
  "recorded_from_gen" bigint NOT NULL,
  CONSTRAINT "football_ranking_snapshots_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_ranking_snapshots_system_id_edition_key_revision_uq" UNIQUE ("system_id", "edition_key", "revision"),
  CONSTRAINT "football_ranking_snapshots_id_subject_kind_uq" UNIQUE ("id", "subject_kind"),
  CONSTRAINT "football_ranking_snapshots_quality_flags_kind_ck" CHECK (jsonb_typeof(quality_flags) = 'object'),
  CONSTRAINT "football_ranking_snapshots_revision_positive_ck" CHECK (revision > 0),
  CONSTRAINT "football_ranking_snapshots_quality_flags_bounded_ck" CHECK (octet_length(quality_flags::text)<=16384)
);

COMMENT ON TABLE "football"."ranking_snapshots" IS 'Éditions et révisions de classements externes avec leurs différentes dates. Grain: Système × édition × révision.';

COMMENT ON COLUMN "football"."ranking_snapshots"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "football"."ranking_snapshots"."system_id" IS 'Référence SQL vers football.ranking_systems(id, subject_kind).';

COMMENT ON COLUMN "football"."ranking_snapshots"."subject_kind" IS 'Référence SQL vers football.ranking_systems(id, subject_kind).';

COMMENT ON COLUMN "football"."ranking_snapshots"."edition_key" IS 'Clé native de l’édition du classement ou de la distinction.';

COMMENT ON COLUMN "football"."ranking_snapshots"."period_label" IS 'Période de référence déclarée ; ne prouve pas la disponibilité historique.';

COMMENT ON COLUMN "football"."ranking_snapshots"."effective_on" IS 'Date d’effet connue du classement, distincte de publication/récupération.';

COMMENT ON COLUMN "football"."ranking_snapshots"."published_at" IS 'Publication déclarée ou activation, selon le grain de cette table.';

COMMENT ON COLUMN "football"."ranking_snapshots"."source_updated_at" IS 'Dernière mise à jour déclarée par la source, distincte de sa récupération.';

COMMENT ON COLUMN "football"."ranking_snapshots"."retrieved_at" IS 'Récupération effective de la donnée source.';

COMMENT ON COLUMN "football"."ranking_snapshots"."official_edition" IS 'Édition officielle si explicitement attestée par la source.';

COMMENT ON COLUMN "football"."ranking_snapshots"."revision" IS 'Révision interne retenue de l’édition du système, couvrant corrections fournisseur, parseur et mapping ; strictement croissante avec sa génération, jamais limitée au numéro du fournisseur.';

COMMENT ON COLUMN "football"."ranking_snapshots"."source_document_id" IS 'Référence SQL vers ingest.source_documents(id).';

COMMENT ON COLUMN "football"."ranking_snapshots"."quality_flags" IS 'Codes de qualité et booléens enregistrés ; aucun fait sportif ou document complet.';

COMMENT ON COLUMN "football"."ranking_snapshots"."base_season_year" IS 'Année de référence native base_season_year, distincte des dates de publication et récupération.';

COMMENT ON COLUMN "football"."ranking_snapshots"."target_season_year" IS 'Année de référence native target_season_year, distincte des dates de publication et récupération.';

COMMENT ON COLUMN "football"."ranking_snapshots"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_ranking_entries" (
  "snapshot_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "subject_kind" text DEFAULT 'team' NOT NULL,
  "rank" integer NOT NULL,
  "points" numeric(16,6),
  "earned_points" numeric(16,6),
  "previous_rank" integer,
  "source_record_id" bigint,
  CONSTRAINT "football_team_ranking_entries_pk" PRIMARY KEY ("snapshot_id", "team_id"),
  CONSTRAINT "football_team_ranking_entries_subject_kind_ck" CHECK (subject_kind = 'team'),
  CONSTRAINT "football_team_ranking_entries_rank_positive_ck" CHECK (rank > 0),
  CONSTRAINT "football_team_ranking_entries_previous_rank_positive_ck" CHECK (previous_rank > 0)
);

COMMENT ON TABLE "football"."team_ranking_entries" IS 'Entrées typées des classements d’autorité. Grain: Instantané × team.';

COMMENT ON COLUMN "football"."team_ranking_entries"."snapshot_id" IS 'Référence SQL vers football.ranking_snapshots(id, subject_kind).';

COMMENT ON COLUMN "football"."team_ranking_entries"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "football"."team_ranking_entries"."subject_kind" IS 'Référence SQL vers football.ranking_snapshots(id, subject_kind).';

COMMENT ON COLUMN "football"."team_ranking_entries"."rank" IS 'Rang publié ; les ex aequo ne sont pas interdits sans règle de la source.';

COMMENT ON COLUMN "football"."team_ranking_entries"."points" IS 'Points publiés ; peuvent inclure bonus et sanctions selon le classement.';

COMMENT ON COLUMN "football"."team_ranking_entries"."earned_points" IS 'Points acquis indiqués séparément par la source.';

COMMENT ON COLUMN "football"."team_ranking_entries"."previous_rank" IS 'Rang de l’édition précédente selon la source.';

COMMENT ON COLUMN "football"."team_ranking_entries"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

CREATE TABLE "football"."team_ranking_components" (
  "snapshot_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "component_period" text NOT NULL,
  "value" numeric(16,6),
  "component_rank" integer,
  "national_association_points" numeric(16,6),
  "total_value" numeric(16,6),
  "total_points_with_bonus" numeric(16,6),
  "factor_bonus_for_title_held" numeric(16,6),
  "factor_total_bonus" numeric(16,6),
  "matches_count" integer,
  "teams_count" integer,
  "teams_still_playing" integer,
  CONSTRAINT "football_team_ranking_components_pk" PRIMARY KEY ("snapshot_id", "team_id", "component_period"),
  CONSTRAINT "football_team_ranking_components_rank_positive_ck" CHECK (component_rank > 0)
);

COMMENT ON TABLE "football"."team_ranking_components" IS 'Contributions annuelles du classement lorsque la source les fournit. Grain: Instantané × team × période de contribution.';

COMMENT ON COLUMN "football"."team_ranking_components"."snapshot_id" IS 'Référence SQL vers football.team_ranking_entries(snapshot_id, team_id).';

COMMENT ON COLUMN "football"."team_ranking_components"."team_id" IS 'Référence SQL vers football.team_ranking_entries(snapshot_id, team_id).';

COMMENT ON COLUMN "football"."team_ranking_components"."component_period" IS 'Période annuelle de contribution au coefficient, distincte de la date de récupération.';

COMMENT ON COLUMN "football"."team_ranking_components"."value" IS 'Valeur fournie dans le grain et l’unité définis par la table.';

COMMENT ON COLUMN "football"."team_ranking_components"."component_rank" IS 'Rang publié de cette composante lorsqu’il existe.';

COMMENT ON COLUMN "football"."team_ranking_components"."national_association_points" IS 'Points nationaux fournis pour la contribution.';

COMMENT ON COLUMN "football"."team_ranking_components"."total_value" IS 'Valeur totale native de la contribution.';

COMMENT ON COLUMN "football"."team_ranking_components"."total_points_with_bonus" IS 'Points incluant les bonus explicitement fournis.';

COMMENT ON COLUMN "football"."team_ranking_components"."factor_bonus_for_title_held" IS 'Facteur natif de bonus lié au titre.';

COMMENT ON COLUMN "football"."team_ranking_components"."factor_total_bonus" IS 'Total des facteurs de bonus fournis.';

COMMENT ON COLUMN "football"."team_ranking_components"."matches_count" IS 'Nombre de matchs indiqué pour cette composante.';

COMMENT ON COLUMN "football"."team_ranking_components"."teams_count" IS 'Nombre d’équipes indiqué.';

COMMENT ON COLUMN "football"."team_ranking_components"."teams_still_playing" IS 'Nombre d’équipes encore engagées lors de l’observation.';

CREATE TABLE "football"."association_ranking_entries" (
  "snapshot_id" bigint NOT NULL,
  "association_id" bigint NOT NULL,
  "subject_kind" text DEFAULT 'association' NOT NULL,
  "rank" integer NOT NULL,
  "coefficient" numeric(16,6),
  "earned_points" numeric(16,6),
  "previous_rank" integer,
  "source_record_id" bigint,
  CONSTRAINT "football_association_ranking_entries_pk" PRIMARY KEY ("snapshot_id", "association_id"),
  CONSTRAINT "football_association_ranking_entries_subject_kind_ck" CHECK (subject_kind = 'association'),
  CONSTRAINT "football_association_ranking_entries_rank_positive_ck" CHECK (rank > 0),
  CONSTRAINT "football_association_ranking_entries_previous_rank_positive_ck" CHECK (previous_rank > 0)
);

COMMENT ON TABLE "football"."association_ranking_entries" IS 'Entrées typées des classements d’autorité. Grain: Instantané × association.';

COMMENT ON COLUMN "football"."association_ranking_entries"."snapshot_id" IS 'Référence SQL vers football.ranking_snapshots(id, subject_kind).';

COMMENT ON COLUMN "football"."association_ranking_entries"."association_id" IS 'Référence SQL vers football.associations(id).';

COMMENT ON COLUMN "football"."association_ranking_entries"."subject_kind" IS 'Référence SQL vers football.ranking_snapshots(id, subject_kind).';

COMMENT ON COLUMN "football"."association_ranking_entries"."rank" IS 'Rang publié ; les ex aequo ne sont pas interdits sans règle de la source.';

COMMENT ON COLUMN "football"."association_ranking_entries"."coefficient" IS 'Coefficient de fédération publié par l’autorité.';

COMMENT ON COLUMN "football"."association_ranking_entries"."earned_points" IS 'Points acquis indiqués séparément par la source.';

COMMENT ON COLUMN "football"."association_ranking_entries"."previous_rank" IS 'Rang de l’édition précédente selon la source.';

COMMENT ON COLUMN "football"."association_ranking_entries"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

CREATE TABLE "football"."association_ranking_components" (
  "snapshot_id" bigint NOT NULL,
  "association_id" bigint NOT NULL,
  "component_period" text NOT NULL,
  "value" numeric(16,6),
  "component_rank" integer,
  "national_association_points" numeric(16,6),
  "total_value" numeric(16,6),
  "total_points_with_bonus" numeric(16,6),
  "factor_bonus_for_title_held" numeric(16,6),
  "factor_total_bonus" numeric(16,6),
  "matches_count" integer,
  "teams_count" integer,
  "teams_still_playing" integer,
  CONSTRAINT "football_association_ranking_components_pk" PRIMARY KEY ("snapshot_id", "association_id", "component_period"),
  CONSTRAINT "football_association_ranking_components_rank_positive_ck" CHECK (component_rank > 0)
);

COMMENT ON TABLE "football"."association_ranking_components" IS 'Contributions annuelles du classement lorsque la source les fournit. Grain: Instantané × association × période de contribution.';

COMMENT ON COLUMN "football"."association_ranking_components"."snapshot_id" IS 'Référence SQL vers football.association_ranking_entries(snapshot_id, association_id).';

COMMENT ON COLUMN "football"."association_ranking_components"."association_id" IS 'Référence SQL vers football.association_ranking_entries(snapshot_id, association_id).';

COMMENT ON COLUMN "football"."association_ranking_components"."component_period" IS 'Période annuelle de contribution au coefficient, distincte de la date de récupération.';

COMMENT ON COLUMN "football"."association_ranking_components"."value" IS 'Valeur fournie dans le grain et l’unité définis par la table.';

COMMENT ON COLUMN "football"."association_ranking_components"."component_rank" IS 'Rang publié de cette composante lorsqu’il existe.';

COMMENT ON COLUMN "football"."association_ranking_components"."national_association_points" IS 'Points nationaux fournis pour la contribution.';

COMMENT ON COLUMN "football"."association_ranking_components"."total_value" IS 'Valeur totale native de la contribution.';

COMMENT ON COLUMN "football"."association_ranking_components"."total_points_with_bonus" IS 'Points incluant les bonus explicitement fournis.';

COMMENT ON COLUMN "football"."association_ranking_components"."factor_bonus_for_title_held" IS 'Facteur natif de bonus lié au titre.';

COMMENT ON COLUMN "football"."association_ranking_components"."factor_total_bonus" IS 'Total des facteurs de bonus fournis.';

COMMENT ON COLUMN "football"."association_ranking_components"."matches_count" IS 'Nombre de matchs indiqué pour cette composante.';

COMMENT ON COLUMN "football"."association_ranking_components"."teams_count" IS 'Nombre d’équipes indiqué.';

COMMENT ON COLUMN "football"."association_ranking_components"."teams_still_playing" IS 'Nombre d’équipes encore engagées lors de l’observation.';

CREATE TABLE "football"."player_match_metric_values" (
  "match_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "period_code" text NOT NULL,
  "family_code" text NOT NULL,
  "metric_code" text NOT NULL,
  "value_kind" text NOT NULL,
  "numeric_value" numeric,
  "text_value" text,
  "boolean_value" boolean,
  "numerator" numeric,
  "denominator" numeric,
  "source_display" text,
  "source_record_id" bigint,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.player_match_metric_values' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "provenance_kind" text NOT NULL,
  "metric_definition_version" text NOT NULL,
  "period_definition_version" text NOT NULL,
  "match_player_revision_id" bigint NOT NULL,
  CONSTRAINT "football_player_match_metric_values_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_player_match_metric_values_sv_logical_revision_uq" UNIQUE ("match_id", "player_id", "period_code", "family_code", "metric_code", "revision_id"),
  CONSTRAINT "football_player_match_metric_values_sv_variant_generation_uq" UNIQUE ("match_id", "player_id", "period_code", "family_code", "metric_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_player_match_metric_values_one_value_ck" CHECK ((value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0) OR (value_kind IN ('number','string','boolean') AND num_nonnulls(numeric_value,text_value,boolean_value)=1)),
  CONSTRAINT "football_player_match_metric_values_family_ck" CHECK (family_code IN ('standard','advanced')),
  CONSTRAINT "football_player_match_metric_values_value_kind_ck" CHECK ((value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL) OR (value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0)),
  CONSTRAINT "football_player_match_metric_values_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_player_match_metric_values_sv_relation_binding_ck" CHECK (relation_code = 'football.player_match_metric_values'),
  CONSTRAINT "football_player_match_metric_values_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_player_match_metric_values_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_player_match_metric_values_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_player_match_metric_values_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_player_match_metric_values_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_player_match_metric_values_sv_metric_defini_d29d784fae" CHECK (btrim(metric_definition_version) <> ''),
  CONSTRAINT "football_player_match_metric_values_sv_period_defini_3ff75afe06" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."player_match_metric_values" IS 'Observations typées de métriques enregistrées et de leur état natif, avec unité et fractions explicites ; une projection numérique commune ne remplace pas cet état. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, player_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, player_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, player_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."player_match_metric_values"."match_id" IS 'Match du fait.';

COMMENT ON COLUMN "football"."player_match_metric_values"."player_id" IS 'Identité concernée.';

COMMENT ON COLUMN "football"."player_match_metric_values"."team_id" IS 'Équipe du joueur dans ce match.';

COMMENT ON COLUMN "football"."player_match_metric_values"."period_code" IS 'Période explicitement définie.';

COMMENT ON COLUMN "football"."player_match_metric_values"."family_code" IS 'standard ou advanced.';

COMMENT ON COLUMN "football"."player_match_metric_values"."metric_code" IS 'Métrique enregistrée et définie ; aucune clé arbitraire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."value_kind" IS 'number, string, boolean, null ou absent. null/absent n’ont ni scalaire primaire, ni fraction, ni affichage source. Une ligne absente signifie une observation inconnue ; absent exige un champ attendu et une couverture acceptée prouvés.';

COMMENT ON COLUMN "football"."player_match_metric_values"."numeric_value" IS 'Valeur numérique exacte de cette métrique.';

COMMENT ON COLUMN "football"."player_match_metric_values"."text_value" IS 'Valeur textuelle si le contrat de métrique l’autorise.';

COMMENT ON COLUMN "football"."player_match_metric_values"."boolean_value" IS 'Valeur booléenne si définie comme telle.';

COMMENT ON COLUMN "football"."player_match_metric_values"."numerator" IS 'Numérateur fourni, sans le déduire d’un taux arrondi.';

COMMENT ON COLUMN "football"."player_match_metric_values"."denominator" IS 'Dénominateur observé.';

COMMENT ON COLUMN "football"."player_match_metric_values"."source_display" IS 'Forme affichée native d’un scalaire, par exemple 12/15 ou 75%.';

COMMENT ON COLUMN "football"."player_match_metric_values"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."player_match_metric_values"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."player_match_metric_values"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."player_match_metric_values"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."player_match_metric_values"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."metric_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."player_match_metric_values"."match_player_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_match_metric_values" (
  "match_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "period_code" text NOT NULL,
  "family_code" text NOT NULL,
  "metric_code" text NOT NULL,
  "value_kind" text NOT NULL,
  "numeric_value" numeric,
  "text_value" text,
  "boolean_value" boolean,
  "numerator" numeric,
  "denominator" numeric,
  "source_display" text,
  "source_record_id" bigint,
  "revision_id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "relation_code" text DEFAULT 'football.team_match_metric_values' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "provenance_kind" text NOT NULL,
  "metric_definition_version" text NOT NULL,
  "period_definition_version" text NOT NULL,
  "match_team_revision_id" bigint NOT NULL,
  CONSTRAINT "football_team_match_metric_values_sv_pk" PRIMARY KEY ("revision_id"),
  CONSTRAINT "football_team_match_metric_values_sv_logical_revision_uq" UNIQUE ("match_id", "team_id", "period_code", "family_code", "metric_code", "revision_id"),
  CONSTRAINT "football_team_match_metric_values_sv_variant_generation_uq" UNIQUE ("match_id", "team_id", "period_code", "family_code", "metric_code", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_match_metric_values_one_value_ck" CHECK ((value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0) OR (value_kind IN ('number','string','boolean') AND num_nonnulls(numeric_value,text_value,boolean_value)=1)),
  CONSTRAINT "football_team_match_metric_values_family_ck" CHECK (family_code IN ('standard','advanced')),
  CONSTRAINT "football_team_match_metric_values_value_kind_ck" CHECK ((value_kind='number' AND numeric_value IS NOT NULL) OR (value_kind='string' AND text_value IS NOT NULL) OR (value_kind='boolean' AND boolean_value IS NOT NULL) OR (value_kind IN ('null','absent') AND num_nonnulls(numeric_value,text_value,boolean_value,numerator,denominator,source_display)=0)),
  CONSTRAINT "football_team_match_metric_values_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_match_metric_values_sv_relation_binding_ck" CHECK (relation_code = 'football.team_match_metric_values'),
  CONSTRAINT "football_team_match_metric_values_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_match_metric_values_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_match_metric_values_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_match_metric_values_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_match_metric_values_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_team_match_metric_values_sv_metric_definiti_92713fe7e1" CHECK (btrim(metric_definition_version) <> ''),
  CONSTRAINT "football_team_match_metric_values_sv_period_definiti_ffba81504a" CHECK (btrim(period_definition_version) <> '')
);

COMMENT ON TABLE "football"."team_match_metric_values" IS 'Observations typées de métriques enregistrées et de leur état natif, avec unité et fractions explicites ; une projection numérique commune ne remplace pas cet état. Grain physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, team_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une révision typée, PK (revision_id) ; clé logique (match_id, team_id, period_code, family_code, metric_code), variante variant_key ; sélection canonique (match_id, team_id, period_code, family_code, metric_code) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_match_metric_values"."match_id" IS 'Match du fait.';

COMMENT ON COLUMN "football"."team_match_metric_values"."team_id" IS 'Identité concernée.';

COMMENT ON COLUMN "football"."team_match_metric_values"."period_code" IS 'Période explicitement définie.';

COMMENT ON COLUMN "football"."team_match_metric_values"."family_code" IS 'standard ou advanced.';

COMMENT ON COLUMN "football"."team_match_metric_values"."metric_code" IS 'Métrique enregistrée et définie ; aucune clé arbitraire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."value_kind" IS 'number, string, boolean, null ou absent. null/absent n’ont ni scalaire primaire, ni fraction, ni affichage source. Une ligne absente signifie une observation inconnue ; absent exige un champ attendu et une couverture acceptée prouvés.';

COMMENT ON COLUMN "football"."team_match_metric_values"."numeric_value" IS 'Valeur numérique exacte de cette métrique.';

COMMENT ON COLUMN "football"."team_match_metric_values"."text_value" IS 'Valeur textuelle si le contrat de métrique l’autorise.';

COMMENT ON COLUMN "football"."team_match_metric_values"."boolean_value" IS 'Valeur booléenne si définie comme telle.';

COMMENT ON COLUMN "football"."team_match_metric_values"."numerator" IS 'Numérateur fourni, sans le déduire d’un taux arrondi.';

COMMENT ON COLUMN "football"."team_match_metric_values"."denominator" IS 'Dénominateur observé.';

COMMENT ON COLUMN "football"."team_match_metric_values"."source_display" IS 'Forme affichée native d’un scalaire, par exemple 12/15 ou 75%.';

COMMENT ON COLUMN "football"."team_match_metric_values"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_match_metric_values"."revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_match_metric_values"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_match_metric_values"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_match_metric_values"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."metric_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."period_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_match_metric_values"."match_team_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_heatmap_cells" (
  "heatmap_id" bigint NOT NULL,
  "cell_ordinal" integer NOT NULL,
  "column_index" smallint NOT NULL,
  "row_index" smallint NOT NULL,
  "action_count" integer NOT NULL,
  CONSTRAINT "football_match_heatmap_cells_pk" PRIMARY KEY ("heatmap_id", "cell_ordinal"),
  CONSTRAINT "football_match_heatmap_cells_pro_grid_coordinate_uq" UNIQUE ("heatmap_id", "column_index", "row_index"),
  CONSTRAINT "football_match_heatmap_cells_bounds_ck" CHECK (cell_ordinal>=0 AND column_index>=0 AND row_index>=0 AND action_count>=0)
);

COMMENT ON TABLE "football"."match_heatmap_cells" IS 'Cellules spatiales typées ; parent conserve grille, repère et disponibilité. Grain physique : un enfant (cell_ordinal) de la version parente football.match_heatmaps(id), liée par (heatmap_id) ; PK (heatmap_id, cell_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée. Grain: Ligne physique : un enfant (cell_ordinal) de la version parente football.match_heatmaps(id), liée par (heatmap_id) ; PK (heatmap_id, cell_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.';

COMMENT ON COLUMN "football"."match_heatmap_cells"."heatmap_id" IS 'Carte parente.';

COMMENT ON COLUMN "football"."match_heatmap_cells"."cell_ordinal" IS 'Ordre natif dans cette version.';

COMMENT ON COLUMN "football"."match_heatmap_cells"."column_index" IS 'Colonne de grille, base zéro.';

COMMENT ON COLUMN "football"."match_heatmap_cells"."row_index" IS 'Ligne de grille, base zéro.';

COMMENT ON COLUMN "football"."match_heatmap_cells"."action_count" IS 'Actions observées dans la cellule.';

CREATE TABLE "football"."match_h2h_entries" (
  "match_id" bigint NOT NULL,
  "entry_ordinal" integer NOT NULL,
  "previous_match_id" bigint,
  "external_match_id" text,
  "match_date" date,
  "time_utc_source" text,
  "status_source" text,
  "home_team_id" bigint,
  "away_team_id" bigint,
  "home_label" text,
  "away_label" text,
  "home_score" integer,
  "away_score" integer,
  "source_record_id" bigint NOT NULL,
  "home_image_asset_id" bigint,
  "away_image_asset_id" bigint,
  "source_id" bigint NOT NULL,
  "feature_code" text NOT NULL,
  "variant_key" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "match_revision_id" bigint NOT NULL,
  "previous_match_revision_id" bigint,
  CONSTRAINT "football_match_h2h_entries_sv_pk" PRIMARY KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen", "entry_ordinal"),
  CONSTRAINT "football_match_h2h_entries_sv_collection_family_ck" CHECK (feature_code = 'h2h'),
  CONSTRAINT "football_match_h2h_entries_sv_previous_match_revisio_effe2df9bc" CHECK ((previous_match_revision_id IS NULL AND (previous_match_id IS NULL)) OR (previous_match_revision_id IS NOT NULL AND previous_match_id IS NOT NULL)),
  CONSTRAINT "football_match_h2h_entries_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> '')
);

COMMENT ON TABLE "football"."match_h2h_entries" IS 'Rencontres précédentes effectivement observées dans une réponse H2H, y compris une identité non encore résolue. Grain physique : un enfant (entry_ordinal) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, entry_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée. Grain: Ligne physique : un enfant (entry_ordinal) de la version parente ingest.match_coverage(match_id, source_id, feature_code, variant_key, recorded_from_gen), liée par (match_id, source_id, feature_code, variant_key, recorded_from_gen) ; PK (match_id, source_id, feature_code, variant_key, recorded_from_gen, entry_ordinal). Aucune révision indépendante de cet enfant ni stabilité interversions de son ordinal supposée.';

COMMENT ON COLUMN "football"."match_h2h_entries"."match_id" IS 'Rencontre pour laquelle le H2H a été collecté.';

COMMENT ON COLUMN "football"."match_h2h_entries"."entry_ordinal" IS 'Ordre du fournisseur.';

COMMENT ON COLUMN "football"."match_h2h_entries"."previous_match_id" IS 'Rencontre antérieure résolue si possible ; aucune identité inventée.';

COMMENT ON COLUMN "football"."match_h2h_entries"."external_match_id" IS 'Identifiant public natif de la rencontre antérieure.';

COMMENT ON COLUMN "football"."match_h2h_entries"."match_date" IS 'Date connue de cette rencontre.';

COMMENT ON COLUMN "football"."match_h2h_entries"."time_utc_source" IS 'Heure native ; chaîne vide distincte d’absence.';

COMMENT ON COLUMN "football"."match_h2h_entries"."status_source" IS 'Statut natif observé.';

COMMENT ON COLUMN "football"."match_h2h_entries"."home_team_id" IS 'Équipe domicile si résolue.';

COMMENT ON COLUMN "football"."match_h2h_entries"."away_team_id" IS 'Équipe extérieure si résolue.';

COMMENT ON COLUMN "football"."match_h2h_entries"."home_label" IS 'Libellé domicile observé.';

COMMENT ON COLUMN "football"."match_h2h_entries"."away_label" IS 'Libellé extérieur observé.';

COMMENT ON COLUMN "football"."match_h2h_entries"."home_score" IS 'Score natif connu ; portée non inventée.';

COMMENT ON COLUMN "football"."match_h2h_entries"."away_score" IS 'Score natif connu.';

COMMENT ON COLUMN "football"."match_h2h_entries"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_h2h_entries"."home_image_asset_id" IS 'Média de l’équipe effectivement observé dans cette ligne H2H.';

COMMENT ON COLUMN "football"."match_h2h_entries"."away_image_asset_id" IS 'Média de l’équipe effectivement observé dans cette ligne H2H.';

COMMENT ON COLUMN "football"."match_h2h_entries"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_h2h_entries"."feature_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_h2h_entries"."variant_key" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_h2h_entries"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_h2h_entries"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_h2h_entries"."previous_match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."match_observation_details" (
  "source_record_id" bigint NOT NULL,
  "match_id" bigint,
  "source_competition_label" text,
  "source_season_label" text,
  "source_match_key" text,
  "source_home_label" text,
  "source_away_label" text,
  "source_date_text" text,
  "date_note" text,
  "source_time_text" text,
  "source_round_label" text,
  "source_stage_label" text,
  "source_group_label" text,
  "source_venue_label" text,
  "attendance" integer,
  "attendance_text" text,
  "result_code" text,
  "notes" text,
  "resolution_state" text NOT NULL,
  "recorded_from_gen" bigint NOT NULL,
  "match_revision_id" bigint,
  CONSTRAINT "football_match_observation_details_sv_pk" PRIMARY KEY ("source_record_id", "recorded_from_gen"),
  CONSTRAINT "football_match_observation_details_sv_match_revision_id_pair_ck" CHECK ((match_revision_id IS NULL AND (match_id IS NULL)) OR (match_revision_id IS NOT NULL AND match_id IS NOT NULL))
);

COMMENT ON TABLE "football"."match_observation_details" IS 'Faits contextuels observés dans les résultats et archives complémentaires. Grain: Un enregistrement source × génération de normalisation ; une correction conserve la ligne antérieure et sélectionne la nouvelle à partir de sa génération.';

COMMENT ON COLUMN "football"."match_observation_details"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."match_observation_details"."match_id" IS 'Match résolu ; rapprochement incertain conservé explicitement.';

COMMENT ON COLUMN "football"."match_observation_details"."source_competition_label" IS 'Libellé de compétition observé.';

COMMENT ON COLUMN "football"."match_observation_details"."source_season_label" IS 'Saison métier native.';

COMMENT ON COLUMN "football"."match_observation_details"."source_match_key" IS 'Clé ou numéro local de rencontre.';

COMMENT ON COLUMN "football"."match_observation_details"."source_home_label" IS 'Nom domicile observé.';

COMMENT ON COLUMN "football"."match_observation_details"."source_away_label" IS 'Nom extérieur observé.';

COMMENT ON COLUMN "football"."match_observation_details"."source_date_text" IS 'Date native, y compris annotations et précision.';

COMMENT ON COLUMN "football"."match_observation_details"."date_note" IS 'Note de date ou d’incertitude.';

COMMENT ON COLUMN "football"."match_observation_details"."source_time_text" IS 'Heure native sans conversion abusive.';

COMMENT ON COLUMN "football"."match_observation_details"."source_round_label" IS 'Tour/journée natif.';

COMMENT ON COLUMN "football"."match_observation_details"."source_stage_label" IS 'Phase native.';

COMMENT ON COLUMN "football"."match_observation_details"."source_group_label" IS 'Groupe natif.';

COMMENT ON COLUMN "football"."match_observation_details"."source_venue_label" IS 'Stade observé.';

COMMENT ON COLUMN "football"."match_observation_details"."attendance" IS 'Affluence si l’entier est réellement fourni.';

COMMENT ON COLUMN "football"."match_observation_details"."attendance_text" IS 'Forme native de l’affluence si imprécise.';

COMMENT ON COLUMN "football"."match_observation_details"."result_code" IS 'Code de résultat source.';

COMMENT ON COLUMN "football"."match_observation_details"."notes" IS 'Commentaires métier du match.';

COMMENT ON COLUMN "football"."match_observation_details"."resolution_state" IS 'resolved, ambiguous ou unavailable.';

COMMENT ON COLUMN "football"."match_observation_details"."recorded_from_gen" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."match_observation_details"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."team_profile_versions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "team_id" bigint NOT NULL,
  "source_record_id" bigint,
  "observed_at" timestamptz NOT NULL,
  "display_name" text,
  "short_name" text,
  "official_name" text,
  "international_name" text,
  "country_code_source" text,
  "team_code_source" text,
  "image_asset_id" bigint,
  "association_id" bigint,
  "valid_from" date,
  "valid_to" date,
  "from_year" integer,
  "to_year" integer,
  "from_phases" text[],
  "to_phases" text[],
  "inherit_team_external_id" text,
  "is_placeholder" boolean,
  "is_national" boolean,
  "slug" text,
  "team_type" text,
  "gender" text,
  "age_category" text,
  "country_id" bigint,
  "founded_year" integer,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "profile_context" text NOT NULL,
  "relation_code" text DEFAULT 'football.team_profile_versions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "provenance_kind" text NOT NULL,
  "country_revision_id" bigint,
  CONSTRAINT "football_team_profile_versions_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_team_profile_versions_sv_natural_0_generation_uq" UNIQUE ("team_id", "source_record_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_profile_versions_sv_profile_actor_uq" UNIQUE ("id", "team_id"),
  CONSTRAINT "football_team_profile_versions_sv_profile_generation_uq" UNIQUE ("team_id", "profile_context", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_team_profile_versions_validity_ck" CHECK (valid_to>=valid_from),
  CONSTRAINT "football_team_profile_versions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_team_profile_versions_sv_relation_binding_ck" CHECK (relation_code = 'football.team_profile_versions'),
  CONSTRAINT "football_team_profile_versions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_team_profile_versions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_team_profile_versions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_team_profile_versions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_team_profile_versions_sv_country_revision_id_pair_ck" CHECK ((country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)),
  CONSTRAINT "football_team_profile_versions_sv_variant_key_nonempty_ck" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_team_profile_versions_sv_profile_context_nonempty_ck" CHECK (btrim(profile_context) <> '')
);

COMMENT ON TABLE "football"."team_profile_versions" IS 'Versions observées des noms, codes, emblèmes et affiliations d’un team. Grain physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (team_id, profile_context), variante variant_key ; sélection canonique (team_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (team_id, profile_context), variante variant_key ; sélection canonique (team_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."team_profile_versions"."id" IS 'Identifiant interne de la ligne, jamais substitué aux identifiants publics existants.';

COMMENT ON COLUMN "football"."team_profile_versions"."team_id" IS 'Identité canonique observée.';

COMMENT ON COLUMN "football"."team_profile_versions"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."team_profile_versions"."observed_at" IS 'Date de récupération effective.';

COMMENT ON COLUMN "football"."team_profile_versions"."display_name" IS 'Nom affiché dans cette version.';

COMMENT ON COLUMN "football"."team_profile_versions"."short_name" IS 'Nom court natif.';

COMMENT ON COLUMN "football"."team_profile_versions"."official_name" IS 'Nom officiel natif.';

COMMENT ON COLUMN "football"."team_profile_versions"."international_name" IS 'Nom international natif.';

COMMENT ON COLUMN "football"."team_profile_versions"."country_code_source" IS 'Code pays natif, sans assimilation automatique à un ISO.';

COMMENT ON COLUMN "football"."team_profile_versions"."team_code_source" IS 'Code fournisseur observé.';

COMMENT ON COLUMN "football"."team_profile_versions"."image_asset_id" IS 'Emblème ou portrait référencé.';

COMMENT ON COLUMN "football"."team_profile_versions"."association_id" IS 'Affiliation sportive si connue.';

COMMENT ON COLUMN "football"."team_profile_versions"."valid_from" IS 'Début de validité déclaré par la source, si connu.';

COMMENT ON COLUMN "football"."team_profile_versions"."valid_to" IS 'Fin de validité déclarée.';

COMMENT ON COLUMN "football"."team_profile_versions"."from_year" IS 'Année de validité native si la date précise est inconnue.';

COMMENT ON COLUMN "football"."team_profile_versions"."to_year" IS 'Année de fin native.';

COMMENT ON COLUMN "football"."team_profile_versions"."from_phases" IS 'Codes de phase fournisseur de début, ordre conservé.';

COMMENT ON COLUMN "football"."team_profile_versions"."to_phases" IS 'Codes de phase fournisseur de fin.';

COMMENT ON COLUMN "football"."team_profile_versions"."inherit_team_external_id" IS 'Identifiant d’héritage natif ; rapprochement contrôlé.';

COMMENT ON COLUMN "football"."team_profile_versions"."is_placeholder" IS 'Identité temporaire explicitement indiquée par la source.';

COMMENT ON COLUMN "football"."team_profile_versions"."is_national" IS 'Indicateur natif d’équipe nationale.';

COMMENT ON COLUMN "football"."team_profile_versions"."slug" IS 'Identifiant textuel de navigation ; les anciennes routes restent résolues par public_aliases.';

COMMENT ON COLUMN "football"."team_profile_versions"."team_type" IS 'Club, sélection nationale, équipe représentative ou type inconnu.';

COMMENT ON COLUMN "football"."team_profile_versions"."gender" IS 'Catégorie sportive déclarée : men, women, mixed ou unknown.';

COMMENT ON COLUMN "football"."team_profile_versions"."age_category" IS 'Catégorie d’âge déclarée ; ne pas la déduire sans preuve.';

COMMENT ON COLUMN "football"."team_profile_versions"."country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."team_profile_versions"."founded_year" IS 'Année de fondation lorsqu’elle est sourcée.';

COMMENT ON COLUMN "football"."team_profile_versions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."team_profile_versions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."team_profile_versions"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."team_profile_versions"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."profile_context" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."team_profile_versions"."country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "football"."association_profile_versions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "association_id" bigint NOT NULL,
  "source_record_id" bigint,
  "observed_at" timestamptz NOT NULL,
  "display_name" text,
  "short_name" text,
  "official_name" text,
  "international_name" text,
  "country_code_source" text,
  "team_code_source" text,
  "image_asset_id" bigint,
  "valid_from" date,
  "valid_to" date,
  "from_year" integer,
  "to_year" integer,
  "from_phases" text[],
  "to_phases" text[],
  "inherit_team_external_id" text,
  "is_placeholder" boolean,
  "is_national" boolean,
  "federation_code" text,
  "country_id" bigint,
  "confederation_code" text,
  "recorded_from_gen" bigint NOT NULL,
  "recorded_to_gen" bigint,
  "variant_key" text NOT NULL,
  "is_canonical" boolean NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "profile_context" text NOT NULL,
  "relation_code" text DEFAULT 'football.association_profile_versions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "provenance_kind" text NOT NULL,
  "country_revision_id" bigint,
  CONSTRAINT "football_association_profile_versions_pk" PRIMARY KEY ("id"),
  CONSTRAINT "football_association_profile_versions_sv_natural_0_g_65033fbd3d" UNIQUE ("association_id", "source_record_id", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_association_profile_versions_sv_profile_actor_uq" UNIQUE ("id", "association_id"),
  CONSTRAINT "football_association_profile_versions_sv_profile_generation_uq" UNIQUE ("association_id", "profile_context", "variant_key", "recorded_from_gen"),
  CONSTRAINT "football_association_profile_versions_validity_ck" CHECK (valid_to>=valid_from),
  CONSTRAINT "football_association_profile_versions_sv_interval_ck" CHECK (recorded_to_gen IS NULL OR recorded_to_gen > recorded_from_gen),
  CONSTRAINT "football_association_profile_versions_sv_relation_binding_ck" CHECK (relation_code = 'football.association_profile_versions'),
  CONSTRAINT "football_association_profile_versions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "football_association_profile_versions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "football_association_profile_versions_sv_provider_ob_74a6546f7e" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "football_association_profile_versions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL)),
  CONSTRAINT "football_association_profile_versions_sv_country_rev_98b1c5f08e" CHECK ((country_revision_id IS NULL AND (country_id IS NULL)) OR (country_revision_id IS NOT NULL AND country_id IS NOT NULL)),
  CONSTRAINT "football_association_profile_versions_sv_variant_key_227e0becbd" CHECK (btrim(variant_key) <> ''),
  CONSTRAINT "football_association_profile_versions_sv_profile_con_06d06ec076" CHECK (btrim(profile_context) <> '')
);

COMMENT ON TABLE "football"."association_profile_versions" IS 'Versions observées des noms, codes, emblèmes et affiliations d’un association. Grain physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (association_id, profile_context), variante variant_key ; sélection canonique (association_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante. Grain: Ligne physique : une observation de profil immuable identifiée par id, PK (id) ; clé logique (association_id, profile_context), variante variant_key ; sélection canonique (association_id, profile_context) ; intervalle de connaissance [recorded_from_gen, recorded_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "football"."association_profile_versions"."id" IS 'Identifiant interne de la ligne, jamais substitué aux identifiants publics existants.';

COMMENT ON COLUMN "football"."association_profile_versions"."association_id" IS 'Identité canonique observée.';

COMMENT ON COLUMN "football"."association_profile_versions"."source_record_id" IS 'Métadonnée de l’observation d’origine ; les valeurs et variantes utiles restent dans les faits SQL typés après suppression des fichiers.';

COMMENT ON COLUMN "football"."association_profile_versions"."observed_at" IS 'Date de récupération effective.';

COMMENT ON COLUMN "football"."association_profile_versions"."display_name" IS 'Nom affiché dans cette version.';

COMMENT ON COLUMN "football"."association_profile_versions"."short_name" IS 'Nom court natif.';

COMMENT ON COLUMN "football"."association_profile_versions"."official_name" IS 'Nom officiel natif.';

COMMENT ON COLUMN "football"."association_profile_versions"."international_name" IS 'Nom international natif.';

COMMENT ON COLUMN "football"."association_profile_versions"."country_code_source" IS 'Code pays natif, sans assimilation automatique à un ISO.';

COMMENT ON COLUMN "football"."association_profile_versions"."team_code_source" IS 'Code fournisseur observé.';

COMMENT ON COLUMN "football"."association_profile_versions"."image_asset_id" IS 'Emblème ou portrait référencé.';

COMMENT ON COLUMN "football"."association_profile_versions"."valid_from" IS 'Début de validité déclaré par la source, si connu.';

COMMENT ON COLUMN "football"."association_profile_versions"."valid_to" IS 'Fin de validité déclarée.';

COMMENT ON COLUMN "football"."association_profile_versions"."from_year" IS 'Année de validité native si la date précise est inconnue.';

COMMENT ON COLUMN "football"."association_profile_versions"."to_year" IS 'Année de fin native.';

COMMENT ON COLUMN "football"."association_profile_versions"."from_phases" IS 'Codes de phase fournisseur de début, ordre conservé.';

COMMENT ON COLUMN "football"."association_profile_versions"."to_phases" IS 'Codes de phase fournisseur de fin.';

COMMENT ON COLUMN "football"."association_profile_versions"."inherit_team_external_id" IS 'Identifiant d’héritage natif ; rapprochement contrôlé.';

COMMENT ON COLUMN "football"."association_profile_versions"."is_placeholder" IS 'Identité temporaire explicitement indiquée par la source.';

COMMENT ON COLUMN "football"."association_profile_versions"."is_national" IS 'Indicateur natif d’équipe nationale.';

COMMENT ON COLUMN "football"."association_profile_versions"."federation_code" IS 'Code de la fédération sportive, distinct d’un ISO.';

COMMENT ON COLUMN "football"."association_profile_versions"."country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "football"."association_profile_versions"."confederation_code" IS 'Code de la confédération sportive.';

COMMENT ON COLUMN "football"."association_profile_versions"."recorded_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "football"."association_profile_versions"."recorded_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "football"."association_profile_versions"."variant_key" IS 'Discriminant stable fournisseur/contexte ; jamais un nouvel identifiant à chaque réponse.';

COMMENT ON COLUMN "football"."association_profile_versions"."is_canonical" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."is_deleted" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."profile_context" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "football"."association_profile_versions"."country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "analytics"."aggregation_builds" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "dataset_snapshot_id" bigint NOT NULL,
  "transform_version" text NOT NULL,
  "status" text DEFAULT 'building' NOT NULL,
  "started_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "finished_at" timestamptz,
  "metrics_contract_version" text NOT NULL,
  "error" jsonb,
  "competition_season_revision_id" bigint NOT NULL,
  "catalog_snapshot_id" bigint NOT NULL,
  "representation_version" text NOT NULL,
  "code_commit" text NOT NULL,
  "code_content_sha256" text NOT NULL,
  "dependencies_sha256" text NOT NULL,
  "environment_sha256" text NOT NULL,
  CONSTRAINT "analytics_aggregation_builds_pk" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_aggregation_builds_id_competition_season_id_uq" UNIQUE ("id", "competition_season_id"),
  CONSTRAINT "analytics_aggregation_builds_error_kind_ck" CHECK (jsonb_typeof(error) = 'object'),
  CONSTRAINT "analytics_aggregation_builds_status_ck" CHECK (status IN ('building', 'validating', 'ready', 'failed')),
  CONSTRAINT "analytics_aggregation_builds_finished_at_after_started_at_ck" CHECK (finished_at >= started_at),
  CONSTRAINT "analytics_aggregation_builds_error_bounded_ck" CHECK (octet_length(error::text)<=16384),
  CONSTRAINT "analytics_aggregation_builds_sv_code_content_sha256_ck" CHECK (code_content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "analytics_aggregation_builds_sv_dependencies_sha256_ck" CHECK (dependencies_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "analytics_aggregation_builds_sv_environment_sha256_ck" CHECK (environment_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE "analytics"."aggregation_builds" IS 'Calculs cohérents d’agrégats pour une édition. Grain: Une construction pour une édition.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."id" IS 'Identifiant interne stable de cette ligne ; le contrat public utilise ses identifiants externes.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."competition_season_id" IS 'Référence SQL vers football.competition_seasons(id, revision_id).';

COMMENT ON COLUMN "analytics"."aggregation_builds"."dataset_snapshot_id" IS 'Référence SQL vers ingest.dataset_snapshots(id).';

COMMENT ON COLUMN "analytics"."aggregation_builds"."transform_version" IS 'Version de la transformation de données.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."started_at" IS 'Instant UTC « started_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."finished_at" IS 'Instant UTC « finished_at » dans le cycle décrit par le grain de cette table ; aucune date de sens différent substituée.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."metrics_contract_version" IS 'Version des définitions et règles d’agrégation appliquées.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."error" IS 'Configuration ou diagnostic technique borné ; jamais une réponse ou sous-arbre source.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."competition_season_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."catalog_snapshot_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."representation_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."code_commit" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."code_content_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."dependencies_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."aggregation_builds"."environment_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "analytics"."publication_versions" (
  "competition_season_id" bigint NOT NULL,
  "build_id" bigint NOT NULL,
  "published_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "catalog_snapshot_id" bigint NOT NULL,
  "representation_version" text NOT NULL,
  "published_from_gen" bigint NOT NULL,
  "published_to_gen" bigint,
  "relation_code" text DEFAULT 'analytics.publication_versions' NOT NULL,
  "contract_version" text NOT NULL,
  "transform_version" text NOT NULL,
  "transform_code_sha256" text NOT NULL,
  "source_id" bigint,
  "source_record_id" bigint,
  "provenance_kind" text NOT NULL,
  CONSTRAINT "analytics_publication_versions_sv_pk" PRIMARY KEY ("competition_season_id", "published_from_gen"),
  CONSTRAINT "analytics_publication_versions_sv_interval_ck" CHECK (published_to_gen IS NULL OR published_to_gen > published_from_gen),
  CONSTRAINT "analytics_publication_versions_sv_relation_binding_ck" CHECK (relation_code = 'analytics.publication_versions'),
  CONSTRAINT "analytics_publication_versions_sv_code_binding_ck" CHECK (contract_version <> '' AND transform_version <> '' AND transform_code_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "analytics_publication_versions_sv_provenance_kind_ck" CHECK (provenance_kind IN ('provider','manual','derived')),
  CONSTRAINT "analytics_publication_versions_sv_provider_observation_ck" CHECK (provenance_kind <> 'provider' OR (source_id IS NOT NULL AND source_record_id IS NOT NULL)),
  CONSTRAINT "analytics_publication_versions_sv_provenance_pair_ck" CHECK ((source_id IS NULL) = (source_record_id IS NULL))
);

COMMENT ON TABLE "analytics"."publication_versions" IS 'Version active de l’ensemble des agrégats d’une édition. Grain physique : un pointeur de publication daté, PK (competition_season_id, published_from_gen) ; clé logique (competition_season_id) ; intervalle de connaissance [published_from_gen, published_to_gen), fin NULL pour la version courante. Grain: Ligne physique : un pointeur de publication daté, PK (competition_season_id, published_from_gen) ; clé logique (competition_season_id) ; intervalle de connaissance [published_from_gen, published_to_gen), fin NULL pour la version courante.';

COMMENT ON COLUMN "analytics"."publication_versions"."competition_season_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."publication_versions"."build_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."publication_versions"."published_at" IS 'Publication déclarée ou activation, selon le grain de cette table.';

COMMENT ON COLUMN "analytics"."publication_versions"."catalog_snapshot_id" IS 'Instantané scellé des seules identités et métadonnées communes utilisées par cette édition ; réutilisé si ces dépendances restent identiques.';

COMMENT ON COLUMN "analytics"."publication_versions"."representation_version" IS 'Version du contrat de sérialisation et du format compact.';

COMMENT ON COLUMN "analytics"."publication_versions"."published_from_gen" IS 'Première génération de connaissance, incluse ; allouée après verrou transactionnel global.';

COMMENT ON COLUMN "analytics"."publication_versions"."published_to_gen" IS 'Fin exclusive de connaissance ; seule fermeture unique autorisée.';

COMMENT ON COLUMN "analytics"."publication_versions"."relation_code" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."publication_versions"."contract_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."publication_versions"."transform_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."publication_versions"."transform_code_sha256" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."publication_versions"."source_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."publication_versions"."source_record_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."publication_versions"."provenance_kind" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "analytics"."match_summary" (
  "build_id" bigint NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "match_id" bigint NOT NULL,
  "match_date" date,
  "kickoff_at" timestamptz,
  "status" text NOT NULL,
  "home_team_id" bigint,
  "away_team_id" bigint,
  "home_label" text,
  "away_label" text,
  "home_goals" integer,
  "away_goals" integer,
  "score_scope" text,
  "home_shootout_goals" integer,
  "away_shootout_goals" integer,
  "computed_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "match_revision_id" bigint NOT NULL,
  CONSTRAINT "analytics_match_summary_pk" PRIMARY KEY ("build_id", "match_id"),
  CONSTRAINT "analytics_match_summary_home_goals_nonnegative_ck" CHECK (home_goals >= 0),
  CONSTRAINT "analytics_match_summary_away_goals_nonnegative_ck" CHECK (away_goals >= 0),
  CONSTRAINT "analytics_match_summary_home_shootout_goals_nonnegative_ck" CHECK (home_shootout_goals >= 0),
  CONSTRAINT "analytics_match_summary_away_shootout_goals_nonnegative_ck" CHECK (away_shootout_goals >= 0)
);

COMMENT ON TABLE "analytics"."match_summary" IS 'Projection pour les cartes de match, obtenue depuis les faits canoniques. Grain: Construction × match.';

COMMENT ON COLUMN "analytics"."match_summary"."build_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."match_summary"."competition_season_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."match_summary"."match_id" IS 'Référence SQL vers football.matches(id, revision_id).';

COMMENT ON COLUMN "analytics"."match_summary"."match_date" IS 'Date civile connue du match ; une heure inconnue ne crée pas un instant minuit fictif.';

COMMENT ON COLUMN "analytics"."match_summary"."kickoff_at" IS 'Instant UTC du coup d’envoi, uniquement lorsque l’heure est connue.';

COMMENT ON COLUMN "analytics"."match_summary"."status" IS 'État explicite de l’objet, limité aux valeurs du CHECK de cette table.';

COMMENT ON COLUMN "analytics"."match_summary"."home_team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "analytics"."match_summary"."away_team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "analytics"."match_summary"."home_label" IS 'Libellé domicile figé dans la publication, y compris participant encore inconnu.';

COMMENT ON COLUMN "analytics"."match_summary"."away_label" IS 'Libellé extérieur figé dans la publication.';

COMMENT ON COLUMN "analytics"."match_summary"."home_goals" IS 'Score domicile du scope explicite de ce résumé.';

COMMENT ON COLUMN "analytics"."match_summary"."away_goals" IS 'Score extérieur du même scope.';

COMMENT ON COLUMN "analytics"."match_summary"."score_scope" IS 'Portée du score : mi-temps, 90 minutes, après prolongation, séance ou total hors séance.';

COMMENT ON COLUMN "analytics"."match_summary"."home_shootout_goals" IS 'Tirs au but réussis par l’équipe domicile, séparés du score joué.';

COMMENT ON COLUMN "analytics"."match_summary"."away_shootout_goals" IS 'Tirs au but réussis par l’équipe extérieure.';

COMMENT ON COLUMN "analytics"."match_summary"."computed_at" IS 'Instant de calcul effectif du résultat dérivé.';

COMMENT ON COLUMN "analytics"."match_summary"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "analytics"."player_competition_team_stats" (
  "build_id" bigint NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "appearances" integer,
  "starts" integer,
  "minutes_played" double precision,
  "goals" integer,
  "assists" integer,
  "shots" integer,
  "shots_on_target" integer,
  "passes_completed" integer,
  "passes_attempted" integer,
  "xg" double precision,
  "xa" double precision,
  "goals_prevented" double precision,
  "provider_rating_weighted" double precision,
  "computed_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "analytics_player_competition_team_stats_pk" PRIMARY KEY ("build_id", "player_id", "team_id"),
  CONSTRAINT "analytics_player_competition_team_stats_appearances_n_de84478b1" CHECK (appearances >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_starts_nonnegative_ck" CHECK (starts >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_minutes_playe_66b5f8490" CHECK (minutes_played >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_goals_nonnegative_ck" CHECK (goals >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_assists_nonnegative_ck" CHECK (assists >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_shots_nonnegative_ck" CHECK (shots >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_shots_on_targ_cff806d10" CHECK (shots_on_target >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_passes_comple_ca6c9abc4" CHECK (passes_completed >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_passes_attemp_b72cf3363" CHECK (passes_attempted >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_xg_nonnegative_ck" CHECK (xg >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_xa_nonnegative_ck" CHECK (xa >= 0),
  CONSTRAINT "analytics_player_competition_team_stats_starts_bounded_ck" CHECK (starts <= appearances)
);

COMMENT ON TABLE "analytics"."player_competition_team_stats" IS 'Totaux joueur calculés sur périodes compatibles et participation prouvée. Grain: Construction × joueur × équipe.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."build_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."competition_season_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."appearances" IS 'Participations prouvées, sans compter automatiquement tous les joueurs listés.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."starts" IS 'Titularisations prouvées.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."minutes_played" IS 'Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."goals" IS 'Buts observés dans le grain et la période de cette table ; zéro est une observation.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."assists" IS 'Passes décisives attribuées par le fournisseur dans cette période.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."shots" IS 'Nombre de tirs observés selon la définition source.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."shots_on_target" IS 'Tirs cadrés observés selon la définition source.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."passes_completed" IS 'Passes réussies observées.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."passes_attempted" IS 'Passes tentées observées, dénominateur des taux.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."xg" IS 'Buts attendus de la source ; probabilité pour un tir, total pour une participation/période.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."xa" IS 'Passes décisives attendues ; une valeur indisponible reste indisponible.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."goals_prevented" IS 'Buts évités selon le modèle gardien du fournisseur ; valeur signée.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."provider_rating_weighted" IS 'Moyenne de la note fournisseur pondérée selon le contrat et sa couverture.';

COMMENT ON COLUMN "analytics"."player_competition_team_stats"."computed_at" IS 'Instant de calcul effectif du résultat dérivé.';

CREATE TABLE "analytics"."player_competition_stats" (
  "build_id" bigint NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "appearances" integer,
  "starts" integer,
  "minutes_played" double precision,
  "goals" integer,
  "assists" integer,
  "shots" integer,
  "shots_on_target" integer,
  "passes_completed" integer,
  "passes_attempted" integer,
  "xg" double precision,
  "xa" double precision,
  "goals_prevented" double precision,
  "provider_rating_weighted" double precision,
  "computed_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "analytics_player_competition_stats_pk" PRIMARY KEY ("build_id", "player_id"),
  CONSTRAINT "analytics_player_competition_stats_appearances_nonnegative_ck" CHECK (appearances >= 0),
  CONSTRAINT "analytics_player_competition_stats_starts_nonnegative_ck" CHECK (starts >= 0),
  CONSTRAINT "analytics_player_competition_stats_minutes_played_non_0d703d372" CHECK (minutes_played >= 0),
  CONSTRAINT "analytics_player_competition_stats_goals_nonnegative_ck" CHECK (goals >= 0),
  CONSTRAINT "analytics_player_competition_stats_assists_nonnegative_ck" CHECK (assists >= 0),
  CONSTRAINT "analytics_player_competition_stats_shots_nonnegative_ck" CHECK (shots >= 0),
  CONSTRAINT "analytics_player_competition_stats_shots_on_target_no_8a2fe1f17" CHECK (shots_on_target >= 0),
  CONSTRAINT "analytics_player_competition_stats_passes_completed_n_715a4544c" CHECK (passes_completed >= 0),
  CONSTRAINT "analytics_player_competition_stats_passes_attempted_n_bff7c2584" CHECK (passes_attempted >= 0),
  CONSTRAINT "analytics_player_competition_stats_xg_nonnegative_ck" CHECK (xg >= 0),
  CONSTRAINT "analytics_player_competition_stats_xa_nonnegative_ck" CHECK (xa >= 0),
  CONSTRAINT "analytics_player_competition_stats_starts_bounded_ck" CHECK (starts <= appearances)
);

COMMENT ON TABLE "analytics"."player_competition_stats" IS 'Totaux joueur calculés sur périodes compatibles et participation prouvée. Grain: Construction × joueur, toutes équipes de l’édition réunies.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."build_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."player_competition_stats"."competition_season_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."player_competition_stats"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "analytics"."player_competition_stats"."appearances" IS 'Participations prouvées, sans compter automatiquement tous les joueurs listés.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."starts" IS 'Titularisations prouvées.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."minutes_played" IS 'Durée effectivement renseignée en minutes ; NULL ne devient pas zéro ni preuve d’absence de participation.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."goals" IS 'Buts observés dans le grain et la période de cette table ; zéro est une observation.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."assists" IS 'Passes décisives attribuées par le fournisseur dans cette période.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."shots" IS 'Nombre de tirs observés selon la définition source.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."shots_on_target" IS 'Tirs cadrés observés selon la définition source.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."passes_completed" IS 'Passes réussies observées.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."passes_attempted" IS 'Passes tentées observées, dénominateur des taux.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."xg" IS 'Buts attendus de la source ; probabilité pour un tir, total pour une participation/période.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."xa" IS 'Passes décisives attendues ; une valeur indisponible reste indisponible.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."goals_prevented" IS 'Buts évités selon le modèle gardien du fournisseur ; valeur signée.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."provider_rating_weighted" IS 'Moyenne de la note fournisseur pondérée selon le contrat et sa couverture.';

COMMENT ON COLUMN "analytics"."player_competition_stats"."computed_at" IS 'Instant de calcul effectif du résultat dérivé.';

CREATE TABLE "analytics"."team_competition_stats" (
  "build_id" bigint NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "matches_played" integer,
  "wins" integer,
  "draws" integer,
  "losses" integer,
  "goals_for" integer,
  "goals_against" integer,
  "xg_for" double precision,
  "xg_against" double precision,
  "points_calculated" integer,
  "computed_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "analytics_team_competition_stats_pk" PRIMARY KEY ("build_id", "team_id"),
  CONSTRAINT "analytics_team_competition_stats_matches_played_nonnegative_ck" CHECK (matches_played >= 0),
  CONSTRAINT "analytics_team_competition_stats_wins_nonnegative_ck" CHECK (wins >= 0),
  CONSTRAINT "analytics_team_competition_stats_draws_nonnegative_ck" CHECK (draws >= 0),
  CONSTRAINT "analytics_team_competition_stats_losses_nonnegative_ck" CHECK (losses >= 0),
  CONSTRAINT "analytics_team_competition_stats_goals_for_nonnegative_ck" CHECK (goals_for >= 0),
  CONSTRAINT "analytics_team_competition_stats_goals_against_nonnegative_ck" CHECK (goals_against >= 0),
  CONSTRAINT "analytics_team_competition_stats_xg_for_nonnegative_ck" CHECK (xg_for >= 0),
  CONSTRAINT "analytics_team_competition_stats_xg_against_nonnegative_ck" CHECK (xg_against >= 0)
);

COMMENT ON TABLE "analytics"."team_competition_stats" IS 'Totaux équipe calculés pour une édition. Grain: Construction × équipe.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."build_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."team_competition_stats"."competition_season_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."team_competition_stats"."team_id" IS 'Référence SQL vers football.teams(id).';

COMMENT ON COLUMN "analytics"."team_competition_stats"."matches_played" IS 'Rencontres jouées éligibles dans cette édition.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."wins" IS 'Victoires observées/calculées dans le périmètre de cette table.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."draws" IS 'Matchs nuls dans ce périmètre.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."losses" IS 'Défaites dans ce périmètre.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."goals_for" IS 'Buts marqués dans ce périmètre.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."goals_against" IS 'Buts encaissés dans ce périmètre.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."xg_for" IS 'xG produits connus dans le périmètre de l’équipe.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."xg_against" IS 'xG concédés connus dans ce périmètre.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."points_calculated" IS 'Points issus des résultats ; ne remplace pas un classement officiel incluant sanctions.';

COMMENT ON COLUMN "analytics"."team_competition_stats"."computed_at" IS 'Instant de calcul effectif du résultat dérivé.';

CREATE TABLE "analytics"."competition_summary" (
  "build_id" bigint NOT NULL,
  "competition_season_id" bigint NOT NULL,
  "teams_count" integer,
  "matches_count" integer,
  "finished_matches_count" integer,
  "players_count" integer,
  "goals" integer,
  "computed_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "analytics_competition_summary_pk" PRIMARY KEY ("build_id"),
  CONSTRAINT "analytics_competition_summary_teams_count_nonnegative_ck" CHECK (teams_count >= 0),
  CONSTRAINT "analytics_competition_summary_matches_count_nonnegative_ck" CHECK (matches_count >= 0),
  CONSTRAINT "analytics_competition_summary_finished_matches_count__f06838c3d" CHECK (finished_matches_count >= 0),
  CONSTRAINT "analytics_competition_summary_players_count_nonnegative_ck" CHECK (players_count >= 0),
  CONSTRAINT "analytics_competition_summary_goals_nonnegative_ck" CHECK (goals >= 0)
);

COMMENT ON TABLE "analytics"."competition_summary" IS 'Vue d’ensemble d’une édition avec couverture de chaque indicateur. Grain: Une ligne par construction.';

COMMENT ON COLUMN "analytics"."competition_summary"."build_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."competition_summary"."competition_season_id" IS 'Référence SQL vers analytics.aggregation_builds(id, competition_season_id).';

COMMENT ON COLUMN "analytics"."competition_summary"."teams_count" IS 'Nombre de « teams » du périmètre de cette ligne ; absence distincte de zéro.';

COMMENT ON COLUMN "analytics"."competition_summary"."matches_count" IS 'Nombre de « matches » du périmètre de cette ligne ; absence distincte de zéro.';

COMMENT ON COLUMN "analytics"."competition_summary"."finished_matches_count" IS 'Nombre de « finished matches » du périmètre de cette ligne ; absence distincte de zéro.';

COMMENT ON COLUMN "analytics"."competition_summary"."players_count" IS 'Nombre de « players » du périmètre de cette ligne ; absence distincte de zéro.';

COMMENT ON COLUMN "analytics"."competition_summary"."goals" IS 'Buts observés dans le grain et la période de cette table ; zéro est une observation.';

COMMENT ON COLUMN "analytics"."competition_summary"."computed_at" IS 'Instant de calcul effectif du résultat dérivé.';

CREATE TABLE "analytics"."player_search" (
  "player_id" bigint NOT NULL,
  "display_name" text NOT NULL,
  "search_text" text NOT NULL,
  "search_vector" tsvector NOT NULL,
  "birth_date" date,
  "nationality_country_id" bigint,
  "primary_position_code" text,
  "computed_at" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "nationality_country_revision_id" bigint,
  "primary_position_definition_version" text,
  CONSTRAINT "analytics_player_search_pk" PRIMARY KEY ("player_id"),
  CONSTRAINT "analytics_player_search_sv_nationality_country_revis_87adcc31c2" CHECK ((nationality_country_revision_id IS NULL AND (nationality_country_id IS NULL)) OR (nationality_country_revision_id IS NOT NULL AND nationality_country_id IS NOT NULL)),
  CONSTRAINT "analytics_player_search_sv_primary_position_definiti_09aa48ce7a" CHECK ((primary_position_code IS NULL) = (primary_position_definition_version IS NULL)),
  CONSTRAINT "analytics_player_search_sv_primary_position_definiti_8761ce7d03" CHECK (primary_position_definition_version IS NULL OR (btrim(primary_position_definition_version) <> ''))
);

COMMENT ON TABLE "analytics"."player_search" IS 'Projection légère pour rechercher des joueurs. Grain: Un joueur.';

COMMENT ON COLUMN "analytics"."player_search"."player_id" IS 'Référence SQL vers football.players(id).';

COMMENT ON COLUMN "analytics"."player_search"."display_name" IS 'Nom d’affichage observé ou sélectionné pour cette identité.';

COMMENT ON COLUMN "analytics"."player_search"."search_text" IS 'Texte préparé pour la recherche, issu des identités/alias retenus.';

COMMENT ON COLUMN "analytics"."player_search"."search_vector" IS 'Vecteur plein texte PostgreSQL généré de search_text avec dictionnaire simple.';

COMMENT ON COLUMN "analytics"."player_search"."birth_date" IS 'Date de naissance connue de la personne.';

COMMENT ON COLUMN "analytics"."player_search"."nationality_country_id" IS 'Référence SQL vers football.countries(id, revision_id).';

COMMENT ON COLUMN "analytics"."player_search"."primary_position_code" IS 'Référence SQL vers football.positions(code, definition_version).';

COMMENT ON COLUMN "analytics"."player_search"."computed_at" IS 'Instant de calcul effectif du résultat dérivé.';

COMMENT ON COLUMN "analytics"."player_search"."nationality_country_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."player_search"."primary_position_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "analytics"."metric_totals" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "build_id" bigint NOT NULL,
  "subject_kind" text NOT NULL,
  "match_id" bigint,
  "player_id" bigint,
  "team_id" bigint,
  "metric_code" text NOT NULL,
  "numeric_value" numeric,
  "observed_count" bigint NOT NULL,
  "eligible_count" bigint,
  "eligible_minutes" numeric,
  "numerator" numeric,
  "denominator" numeric,
  "coverage_state" text NOT NULL,
  "match_revision_id" bigint,
  "metric_definition_version" text NOT NULL,
  CONSTRAINT "analytics_metric_totals_pk" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_metric_totals_subject_metric_uq" UNIQUE NULLS NOT DISTINCT ("build_id", "subject_kind", "match_id", "player_id", "team_id", "metric_code"),
  CONSTRAINT "analytics_metric_totals_coverage_counts_ck" CHECK (observed_count>=0 AND eligible_count>=0 AND observed_count<=eligible_count),
  CONSTRAINT "analytics_metric_totals_subject_kind_ck" CHECK (subject_kind IN ('competition','match','player','player_team','team')),
  CONSTRAINT "analytics_metric_totals_typed_subject_ck" CHECK ((subject_kind='competition' AND num_nonnulls(match_id,player_id,team_id)=0) OR (subject_kind='match' AND match_id IS NOT NULL AND num_nonnulls(player_id,team_id)=0) OR (subject_kind='player' AND player_id IS NOT NULL AND num_nonnulls(match_id,team_id)=0) OR (subject_kind='player_team' AND match_id IS NULL AND player_id IS NOT NULL AND team_id IS NOT NULL) OR (subject_kind='team' AND team_id IS NOT NULL AND num_nonnulls(match_id,player_id)=0)),
  CONSTRAINT "analytics_metric_totals_sv_match_revision_id_pair_ck" CHECK ((match_revision_id IS NULL AND (match_id IS NULL)) OR (match_revision_id IS NOT NULL AND match_id IS NOT NULL)),
  CONSTRAINT "analytics_metric_totals_sv_metric_definition_version_a91415e7f8" CHECK (btrim(metric_definition_version) <> '')
);

COMMENT ON TABLE "analytics"."metric_totals" IS 'Totaux secondaires et couverture explicites d’une construction publiée. Grain: Build × sujet typé × métrique.';

COMMENT ON COLUMN "analytics"."metric_totals"."id" IS 'Identifiant interne de la ligne, jamais substitué aux identifiants publics existants.';

COMMENT ON COLUMN "analytics"."metric_totals"."build_id" IS 'Construction immuable.';

COMMENT ON COLUMN "analytics"."metric_totals"."subject_kind" IS 'competition, match, player, player_team ou team.';

COMMENT ON COLUMN "analytics"."metric_totals"."match_id" IS 'Match si le sujet est une carte de rencontre.';

COMMENT ON COLUMN "analytics"."metric_totals"."player_id" IS 'Joueur du total.';

COMMENT ON COLUMN "analytics"."metric_totals"."team_id" IS 'Équipe du total.';

COMMENT ON COLUMN "analytics"."metric_totals"."metric_code" IS 'Métrique ou indicateur de couverture enregistré.';

COMMENT ON COLUMN "analytics"."metric_totals"."numeric_value" IS 'Valeur calculée ; NULL si non disponible.';

COMMENT ON COLUMN "analytics"."metric_totals"."observed_count" IS 'Observations couvertes.';

COMMENT ON COLUMN "analytics"."metric_totals"."eligible_count" IS 'Observations éligibles selon le contrat ; NULL si ce nombre reste inconnu.';

COMMENT ON COLUMN "analytics"."metric_totals"."eligible_minutes" IS 'Minutes éligibles propres à cette métrique.';

COMMENT ON COLUMN "analytics"."metric_totals"."numerator" IS 'Somme des numérateurs connus.';

COMMENT ON COLUMN "analytics"."metric_totals"."denominator" IS 'Somme des dénominateurs connus.';

COMMENT ON COLUMN "analytics"."metric_totals"."coverage_state" IS 'available, partial, unavailable ou unknown.';

COMMENT ON COLUMN "analytics"."metric_totals"."match_revision_id" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

COMMENT ON COLUMN "analytics"."metric_totals"."metric_definition_version" IS 'Valeur typée du contrat de versions sélectives ; aucune copie documentaire.';

CREATE TABLE "analytics"."catalog_publication" (
  "singleton" boolean DEFAULT true NOT NULL,
  "catalog_snapshot_id" bigint NOT NULL,
  "representation_version" text NOT NULL,
  "published_at" timestamptz NOT NULL,
  CONSTRAINT "analytics_catalog_publication_pk" PRIMARY KEY ("singleton"),
  CONSTRAINT "analytics_catalog_publication_singleton_ck" CHECK (singleton IS TRUE)
);

COMMENT ON TABLE "analytics"."catalog_publication" IS 'Version publiée des identités et métadonnées communes à toutes les éditions. Grain: Un pointeur global actif.';

COMMENT ON COLUMN "analytics"."catalog_publication"."singleton" IS 'Clé singleton toujours true.';

COMMENT ON COLUMN "analytics"."catalog_publication"."catalog_snapshot_id" IS 'Instantané SQL scellé du référentiel commun.';

COMMENT ON COLUMN "analytics"."catalog_publication"."representation_version" IS 'Version de sérialisation des métadonnées.';

COMMENT ON COLUMN "analytics"."catalog_publication"."published_at" IS 'Activation atomique avec les éditions touchées.';

ALTER TABLE "ingest"."sources" ADD CONSTRAINT "ingest_sources_upstream_source_id_fk" FOREIGN KEY ("upstream_source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."source_datasets" ADD CONSTRAINT "ingest_source_datasets_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."source_documents" ADD CONSTRAINT "ingest_source_documents_dataset_id_source_id_fk" FOREIGN KEY ("dataset_id", "source_id") REFERENCES "ingest"."source_datasets" ("id", "source_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."source_documents" ADD CONSTRAINT "ingest_source_documents_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "ingest"."import_runs" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "ingest_source_documents_content_sha256_idx" ON "ingest"."source_documents" USING btree ("content_sha256" ASC);

CREATE UNIQUE INDEX "ingest_source_documents_sv_http_request_content_idx" ON "ingest"."source_documents" USING btree ("dataset_id" ASC, "request_fingerprint" ASC, "content_sha256" ASC) WHERE origin_kind = 'http_response';

ALTER TABLE "ingest"."source_records" ADD CONSTRAINT "ingest_source_records_document_id_source_id_fk" FOREIGN KEY ("document_id", "source_id") REFERENCES "ingest"."source_documents" ("id", "source_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."document_lineage" ADD CONSTRAINT "ingest_document_lineage_derived_document_id_fk" FOREIGN KEY ("derived_document_id") REFERENCES "ingest"."source_documents" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."document_lineage" ADD CONSTRAINT "ingest_document_lineage_parent_document_id_fk" FOREIGN KEY ("parent_document_id") REFERENCES "ingest"."source_documents" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "ingest_document_lineage_parent_document_id_derived_do_77500dee2" ON "ingest"."document_lineage" USING btree ("parent_document_id" ASC, "derived_document_id" ASC);

ALTER TABLE "ingest"."resource_fetches" ADD CONSTRAINT "ingest_resource_fetches_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingest"."import_runs" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."resource_fetches" ADD CONSTRAINT "ingest_resource_fetches_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."resource_fetches" ADD CONSTRAINT "ingest_resource_fetches_document_id_source_id_fk" FOREIGN KEY ("document_id", "source_id") REFERENCES "ingest"."source_documents" ("id", "source_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "ingest_resource_fetches_source_id_request_fingerprint_4d06f729a" ON "ingest"."resource_fetches" USING btree ("source_id" ASC, "request_fingerprint" ASC, "requested_at" DESC, "id" DESC);

ALTER TABLE "ingest"."dataset_snapshot_documents" ADD CONSTRAINT "ingest_dataset_snapshot_documents_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "ingest"."dataset_snapshots" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."dataset_snapshot_documents" ADD CONSTRAINT "ingest_dataset_snapshot_documents_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "ingest"."source_documents" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."quality_issues" ADD CONSTRAINT "ingest_quality_issues_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingest"."import_runs" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."quality_issues" ADD CONSTRAINT "ingest_quality_issues_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "ingest_quality_issues_severity_detected_at_id_idx" ON "ingest"."quality_issues" USING btree ("severity" ASC, "detected_at" ASC, "id" ASC) WHERE status = 'open';

ALTER TABLE "ingest"."identity_candidates" ADD CONSTRAINT "ingest_identity_candidates_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."identity_candidates" ADD CONSTRAINT "ingest_identity_candidates_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_document_id_source_id_fk" FOREIGN KEY ("document_id", "source_id") REFERENCES "ingest"."source_documents" ("id", "source_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_sv_relation_code_contract_vers_0e14cc4af3" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."match_coverage" ADD CONSTRAINT "ingest_match_coverage_sv_source_id_source_record_id__4e45ae96af" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "ingest_match_coverage_coverage_state_checked_at_match_id_idx" ON "ingest"."match_coverage" USING btree ("coverage_state" ASC, "checked_at" ASC, "match_id" ASC);

CREATE UNIQUE INDEX "ingest_match_coverage_sv_variant_current_idx" ON "ingest"."match_coverage" USING btree ("match_id" ASC, "source_id" ASC, "feature_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "ingest_match_coverage_sv_canonical_current_idx" ON "ingest"."match_coverage" USING btree ("match_id" ASC, "feature_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "ingest"."field_contracts" ADD CONSTRAINT "ingest_field_contracts_sv_relation_code_contract_ver_b45b99309f" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."document_reconciliations" ADD CONSTRAINT "ingest_document_reconciliations_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ingest"."reconciliation_runs" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."document_reconciliations" ADD CONSTRAINT "ingest_document_reconciliations_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "ingest"."source_documents" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."cleanup_items" ADD CONSTRAINT "ingest_cleanup_items_reconciliation_run_id_fk" FOREIGN KEY ("reconciliation_run_id") REFERENCES "ingest"."reconciliation_runs" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."cleanup_items" ADD CONSTRAINT "ingest_cleanup_items_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "ingest"."source_documents" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."collection_jobs" ADD CONSTRAINT "ingest_collection_jobs_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "ingest_collection_jobs_pro_pending_claim_idx" ON "ingest"."collection_jobs" USING btree ("priority" ASC, "available_at" ASC, "source_id" ASC, "endpoint" ASC, "params" ASC) WHERE state = 'pending';

CREATE INDEX "ingest_collection_jobs_pro_running_expiry_idx" ON "ingest"."collection_jobs" USING btree ("lease_expires_at" ASC) WHERE state = 'running';

ALTER TABLE "ingest"."dirty_editions" ADD CONSTRAINT "ingest_dirty_editions_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_competition_id_fk" FOREIGN KEY ("competition_id", "competition_revision_id") REFERENCES "football"."competitions" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_venue_id_fk" FOREIGN KEY ("venue_id", "venue_revision_id") REFERENCES "football"."venues" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_coach_id_fk" FOREIGN KEY ("coach_id", "coach_revision_id") REFERENCES "football"."coaches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_profile_version_id_player_id_fk" FOREIGN KEY ("profile_version_id", "player_id") REFERENCES "football"."player_profile_versions" ("id", "player_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_sv_relation_code_contract_vers_f94ff4a100" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "ingest"."public_aliases" ADD CONSTRAINT "ingest_public_aliases_sv_source_id_source_record_id__464a1eaac7" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "ingest_public_aliases_sv_current_idx" ON "ingest"."public_aliases" USING btree ("route_kind" ASC, "public_key" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."countries" ADD CONSTRAINT "football_countries_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."countries" ADD CONSTRAINT "football_countries_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."countries" ADD CONSTRAINT "football_countries_sv_relation_code_contract_version_45494cfdbf" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."countries" ADD CONSTRAINT "football_countries_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."countries" ADD CONSTRAINT "football_countries_sv_source_id_source_record_id_sou_52c9dff644" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_countries_sv_natural_0_variant_current_idx" ON "football"."countries" USING btree ("iso2" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_countries_sv_natural_0_canonical_current_idx" ON "football"."countries" USING btree ("iso2" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_countries_sv_natural_1_variant_current_idx" ON "football"."countries" USING btree ("iso3" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_countries_sv_natural_1_canonical_current_idx" ON "football"."countries" USING btree ("iso3" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_countries_sv_variant_current_idx" ON "football"."countries" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_countries_sv_canonical_current_idx" ON "football"."countries" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."associations" ADD CONSTRAINT "football_associations_country_id_fk" FOREIGN KEY ("country_id", "country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."positions" ADD CONSTRAINT "football_positions_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."positions" ADD CONSTRAINT "football_positions_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."positions" ADD CONSTRAINT "football_positions_sv_relation_code_contract_version_8da17264b7" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."positions" ADD CONSTRAINT "football_positions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."positions" ADD CONSTRAINT "football_positions_sv_source_id_source_record_id_sou_30ad130c7a" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_positions_sv_current_idx" ON "football"."positions" USING btree ("code" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."periods" ADD CONSTRAINT "football_periods_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."periods" ADD CONSTRAINT "football_periods_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."periods" ADD CONSTRAINT "football_periods_sv_relation_code_contract_version_r_35e7343ca2" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."periods" ADD CONSTRAINT "football_periods_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."periods" ADD CONSTRAINT "football_periods_sv_source_id_source_record_id_sourc_b1c0d4d034" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_periods_sv_current_idx" ON "football"."periods" USING btree ("code" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."venues" ADD CONSTRAINT "football_venues_country_id_fk" FOREIGN KEY ("country_id", "country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venues" ADD CONSTRAINT "football_venues_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venues" ADD CONSTRAINT "football_venues_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venues" ADD CONSTRAINT "football_venues_sv_relation_code_contract_version_re_0ab377157a" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venues" ADD CONSTRAINT "football_venues_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venues" ADD CONSTRAINT "football_venues_sv_source_id_source_record_id_source_records_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_venues_sv_variant_current_idx" ON "football"."venues" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_venues_sv_canonical_current_idx" ON "football"."venues" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_nationality_country_id_fk" FOREIGN KEY ("nationality_country_id", "nationality_country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_sv_relation_code_contract_version_r_edceb74867" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coaches" ADD CONSTRAINT "football_coaches_sv_source_id_source_record_id_sourc_382ffbe37a" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_coaches_sv_variant_current_idx" ON "football"."coaches" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_coaches_sv_canonical_current_idx" ON "football"."coaches" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_country_id_fk" FOREIGN KEY ("country_id", "country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_sv_relation_code_contract_vers_029ca21826" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competitions" ADD CONSTRAINT "football_competitions_sv_source_id_source_record_id__79976f94dd" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_competitions_sv_natural_0_variant_current_idx" ON "football"."competitions" USING btree ("slug" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competitions_sv_natural_0_canonical_current_idx" ON "football"."competitions" USING btree ("slug" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_competitions_sv_variant_current_idx" ON "football"."competitions" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competitions_sv_canonical_current_idx" ON "football"."competitions" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."competition_seasons" ADD CONSTRAINT "football_competition_seasons_competition_id_fk" FOREIGN KEY ("competition_id", "competition_revision_id") REFERENCES "football"."competitions" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_seasons" ADD CONSTRAINT "football_competition_seasons_sv_recorded_from_gen_da_6973e17826" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_seasons" ADD CONSTRAINT "football_competition_seasons_sv_recorded_to_gen_data_15f92d12a9" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_seasons" ADD CONSTRAINT "football_competition_seasons_sv_relation_code_contra_a8f54cc1e4" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_seasons" ADD CONSTRAINT "football_competition_seasons_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_seasons" ADD CONSTRAINT "football_competition_seasons_sv_source_id_source_rec_273a980217" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_competition_seasons_sv_natural_0_variant_current_idx" ON "football"."competition_seasons" USING btree ("competition_id" ASC, "season_key" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_seasons_sv_natural_0_canonical_current_idx" ON "football"."competition_seasons" USING btree ("competition_id" ASC, "season_key" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_competition_seasons_sv_variant_current_idx" ON "football"."competition_seasons" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_seasons_sv_canonical_current_idx" ON "football"."competition_seasons" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_parent_stage_id_competiti_eb6dbca0e" FOREIGN KEY ("parent_stage_id", "competition_season_id", "parent_stage_revision_id") REFERENCES "football"."competition_stages" ("id", "competition_season_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_sv_recorded_from_gen_dat_463a4aaa6e" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_sv_recorded_to_gen_datas_9b7e826636" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_sv_relation_code_contrac_0141c58d1d" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_stages" ADD CONSTRAINT "football_competition_stages_sv_source_id_source_reco_1ebf9fd51c" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_competition_stages_sv_natural_0_variant_current_idx" ON "football"."competition_stages" USING btree ("competition_season_id" ASC, "stage_key" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_stages_sv_natural_0_canonical_current_idx" ON "football"."competition_stages" USING btree ("competition_season_id" ASC, "stage_key" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_competition_stages_sv_natural_1_variant_current_idx" ON "football"."competition_stages" USING btree ("id" ASC, "competition_season_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_stages_sv_natural_1_canonical_current_idx" ON "football"."competition_stages" USING btree ("id" ASC, "competition_season_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_competition_stages_sv_variant_current_idx" ON "football"."competition_stages" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_stages_sv_canonical_current_idx" ON "football"."competition_stages" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."competition_groups" ADD CONSTRAINT "football_competition_groups_stage_id_competition_season_id_fk" FOREIGN KEY ("stage_id", "competition_season_id", "stage_revision_id") REFERENCES "football"."competition_stages" ("id", "competition_season_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_groups" ADD CONSTRAINT "football_competition_groups_sv_recorded_from_gen_dat_f4af4d896c" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_groups" ADD CONSTRAINT "football_competition_groups_sv_recorded_to_gen_datas_90f93f986f" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_groups" ADD CONSTRAINT "football_competition_groups_sv_relation_code_contrac_85a95a46e9" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_groups" ADD CONSTRAINT "football_competition_groups_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_groups" ADD CONSTRAINT "football_competition_groups_sv_source_id_source_reco_68fb522565" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_competition_groups_sv_natural_0_variant_current_idx" ON "football"."competition_groups" USING btree ("stage_id" ASC, "group_key" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_groups_sv_natural_0_canonical_current_idx" ON "football"."competition_groups" USING btree ("stage_id" ASC, "group_key" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_competition_groups_sv_natural_1_variant_current_idx" ON "football"."competition_groups" USING btree ("id" ASC, "stage_id" ASC, "competition_season_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_groups_sv_natural_1_canonical_current_idx" ON "football"."competition_groups" USING btree ("id" ASC, "stage_id" ASC, "competition_season_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_competition_groups_sv_variant_current_idx" ON "football"."competition_groups" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_groups_sv_canonical_current_idx" ON "football"."competition_groups" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."teams" ADD CONSTRAINT "football_teams_country_id_fk" FOREIGN KEY ("country_id", "country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."teams" ADD CONSTRAINT "football_teams_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."teams" ADD CONSTRAINT "football_teams_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_sv_recorded_from_gen_data_ce41f7c9f8" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_sv_recorded_to_gen_datase_ab05e2e388" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_sv_relation_code_contract_c893d98603" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_teams" ADD CONSTRAINT "football_competition_teams_sv_source_id_source_recor_04a7b96a27" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_competition_teams_team_id_competition_season_id_idx" ON "football"."competition_teams" USING btree ("team_id" ASC, "competition_season_id" ASC);

CREATE UNIQUE INDEX "football_competition_teams_sv_variant_current_idx" ON "football"."competition_teams" USING btree ("competition_season_id" ASC, "team_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_competition_teams_sv_canonical_current_idx" ON "football"."competition_teams" USING btree ("competition_season_id" ASC, "team_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."players" ADD CONSTRAINT "football_players_nationality_country_id_fk" FOREIGN KEY ("nationality_country_id", "nationality_country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."players" ADD CONSTRAINT "football_players_primary_position_code_fk" FOREIGN KEY ("primary_position_code", "primary_position_definition_version") REFERENCES "football"."positions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_sv_nationality_coun_9e69dcc629" FOREIGN KEY ("nationality_country_id", "nationality_country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_sv_primary_position_6ee6c7d787" FOREIGN KEY ("primary_position_code", "primary_position_definition_version") REFERENCES "football"."positions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_sv_recorded_from_ge_f3ce392e05" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_sv_recorded_to_gen__49a68e1de8" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_sv_relation_code_co_615148ec35" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_profile_versions" ADD CONSTRAINT "football_player_profile_versions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_player_profile_versions_player_id_observed_at_id_idx" ON "football"."player_profile_versions" USING btree ("player_id" ASC, "observed_at" DESC, "id" DESC);

CREATE UNIQUE INDEX "football_player_profile_versions_sv_natural_0_varian_b412e957e1" ON "football"."player_profile_versions" USING btree ("source_id" ASC, "external_profile_version_id" ASC, "profile_content_sha256" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_profile_versions_sv_natural_0_canoni_1135793f83" ON "football"."player_profile_versions" USING btree ("source_id" ASC, "external_profile_version_id" ASC, "profile_content_sha256" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_player_profile_versions_sv_variant_current_idx" ON "football"."player_profile_versions" USING btree ("player_id" ASC, "profile_context" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_profile_versions_sv_canonical_current_idx" ON "football"."player_profile_versions" USING btree ("player_id" ASC, "profile_context" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."position_mappings" ADD CONSTRAINT "football_position_mappings_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."position_mappings" ADD CONSTRAINT "football_position_mappings_position_code_fk" FOREIGN KEY ("position_code", "position_definition_version") REFERENCES "football"."positions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."position_mappings" ADD CONSTRAINT "football_position_mappings_sv_recorded_from_gen_data_b70009d5c1" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."position_mappings" ADD CONSTRAINT "football_position_mappings_sv_recorded_to_gen_datase_854a35ce70" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."position_mappings" ADD CONSTRAINT "football_position_mappings_sv_relation_code_contract_998854d327" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."position_mappings" ADD CONSTRAINT "football_position_mappings_sv_source_id_source_recor_6b0041981b" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_position_mappings_sv_current_idx" ON "football"."position_mappings" USING btree ("source_id" ASC, "raw_position_code" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_sv_recorded_from_ge_64aa9b231c" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_sv_recorded_to_gen__321bb77fe8" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_sv_relation_code_co_4986391520" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_player_team_memberships_player_id_observed_from_idx" ON "football"."player_team_memberships" USING btree ("player_id" ASC, "observed_from" ASC);

CREATE UNIQUE INDEX "football_player_team_memberships_sv_variant_current_idx" ON "football"."player_team_memberships" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_team_memberships_sv_canonical_current_idx" ON "football"."player_team_memberships" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."team_aliases" ADD CONSTRAINT "football_team_aliases_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_aliases" ADD CONSTRAINT "football_team_aliases_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_aliases" ADD CONSTRAINT "football_team_aliases_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_aliases" ADD CONSTRAINT "football_team_aliases_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_aliases" ADD CONSTRAINT "football_team_aliases_sv_relation_code_contract_vers_d23a7877a4" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_aliases" ADD CONSTRAINT "football_team_aliases_sv_source_id_source_record_id__bf2e069ad5" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_team_aliases_team_id_idx" ON "football"."team_aliases" USING btree ("team_id" ASC);

CREATE UNIQUE INDEX "football_team_aliases_sv_natural_0_variant_current_idx" ON "football"."team_aliases" USING btree ("team_id" ASC, "alias" ASC, "language_code" ASC, "source_id" ASC, "valid_from" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_aliases_sv_natural_0_canonical_current_idx" ON "football"."team_aliases" USING btree ("team_id" ASC, "alias" ASC, "language_code" ASC, "source_id" ASC, "valid_from" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_team_aliases_sv_variant_current_idx" ON "football"."team_aliases" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_aliases_sv_canonical_current_idx" ON "football"."team_aliases" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."competition_source_ids" ADD CONSTRAINT "football_competition_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_source_ids" ADD CONSTRAINT "football_competition_source_ids_competition_id_fk" FOREIGN KEY ("competition_id", "competition_revision_id") REFERENCES "football"."competitions" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_source_ids" ADD CONSTRAINT "football_competition_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_source_ids" ADD CONSTRAINT "football_competition_source_ids_sv_recorded_from_gen_6137a9c639" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_source_ids" ADD CONSTRAINT "football_competition_source_ids_sv_recorded_to_gen_d_6511a5a19d" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."competition_source_ids" ADD CONSTRAINT "football_competition_source_ids_sv_relation_code_con_0b05071f98" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_competition_source_ids_competition_id_idx" ON "football"."competition_source_ids" USING btree ("competition_id" ASC);

CREATE UNIQUE INDEX "football_competition_source_ids_sv_current_idx" ON "football"."competition_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."team_source_ids" ADD CONSTRAINT "football_team_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_source_ids" ADD CONSTRAINT "football_team_source_ids_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_source_ids" ADD CONSTRAINT "football_team_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_source_ids" ADD CONSTRAINT "football_team_source_ids_sv_recorded_from_gen_datase_74e032a278" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_source_ids" ADD CONSTRAINT "football_team_source_ids_sv_recorded_to_gen_dataset__85249261f5" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_source_ids" ADD CONSTRAINT "football_team_source_ids_sv_relation_code_contract_v_6f816f4fca" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_team_source_ids_team_id_idx" ON "football"."team_source_ids" USING btree ("team_id" ASC);

CREATE UNIQUE INDEX "football_team_source_ids_sv_current_idx" ON "football"."team_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."player_source_ids" ADD CONSTRAINT "football_player_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_source_ids" ADD CONSTRAINT "football_player_source_ids_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_source_ids" ADD CONSTRAINT "football_player_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_source_ids" ADD CONSTRAINT "football_player_source_ids_sv_recorded_from_gen_data_fc1770447a" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_source_ids" ADD CONSTRAINT "football_player_source_ids_sv_recorded_to_gen_datase_cd5636c326" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_source_ids" ADD CONSTRAINT "football_player_source_ids_sv_relation_code_contract_8936b61a90" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_player_source_ids_player_id_idx" ON "football"."player_source_ids" USING btree ("player_id" ASC);

CREATE UNIQUE INDEX "football_player_source_ids_sv_current_idx" ON "football"."player_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."association_source_ids" ADD CONSTRAINT "football_association_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_source_ids" ADD CONSTRAINT "football_association_source_ids_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_source_ids" ADD CONSTRAINT "football_association_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_source_ids" ADD CONSTRAINT "football_association_source_ids_sv_recorded_from_gen_5ed9784e43" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_source_ids" ADD CONSTRAINT "football_association_source_ids_sv_recorded_to_gen_d_5e6da52895" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_source_ids" ADD CONSTRAINT "football_association_source_ids_sv_relation_code_con_e1a1a1bb8c" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_association_source_ids_association_id_idx" ON "football"."association_source_ids" USING btree ("association_id" ASC);

CREATE UNIQUE INDEX "football_association_source_ids_sv_current_idx" ON "football"."association_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."venue_source_ids" ADD CONSTRAINT "football_venue_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venue_source_ids" ADD CONSTRAINT "football_venue_source_ids_venue_id_fk" FOREIGN KEY ("venue_id", "venue_revision_id") REFERENCES "football"."venues" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venue_source_ids" ADD CONSTRAINT "football_venue_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venue_source_ids" ADD CONSTRAINT "football_venue_source_ids_sv_recorded_from_gen_datas_853835d0ad" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venue_source_ids" ADD CONSTRAINT "football_venue_source_ids_sv_recorded_to_gen_dataset_3238973a75" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."venue_source_ids" ADD CONSTRAINT "football_venue_source_ids_sv_relation_code_contract__8dd534865c" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_venue_source_ids_venue_id_idx" ON "football"."venue_source_ids" USING btree ("venue_id" ASC);

CREATE UNIQUE INDEX "football_venue_source_ids_sv_current_idx" ON "football"."venue_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."coach_source_ids" ADD CONSTRAINT "football_coach_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coach_source_ids" ADD CONSTRAINT "football_coach_source_ids_coach_id_fk" FOREIGN KEY ("coach_id", "coach_revision_id") REFERENCES "football"."coaches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coach_source_ids" ADD CONSTRAINT "football_coach_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coach_source_ids" ADD CONSTRAINT "football_coach_source_ids_sv_recorded_from_gen_datas_3aaf1d81f0" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coach_source_ids" ADD CONSTRAINT "football_coach_source_ids_sv_recorded_to_gen_dataset_924cbfbe6f" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."coach_source_ids" ADD CONSTRAINT "football_coach_source_ids_sv_relation_code_contract__7d08951b22" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_coach_source_ids_coach_id_idx" ON "football"."coach_source_ids" USING btree ("coach_id" ASC);

CREATE UNIQUE INDEX "football_coach_source_ids_sv_current_idx" ON "football"."coach_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_stage_id_competition_season_id_fk" FOREIGN KEY ("stage_id", "competition_season_id", "stage_revision_id") REFERENCES "football"."competition_stages" ("id", "competition_season_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_group_id_stage_id_competition_season_id_fk" FOREIGN KEY ("group_id", "stage_id", "competition_season_id", "group_revision_id") REFERENCES "football"."competition_groups" ("id", "stage_id", "competition_season_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_venue_id_fk" FOREIGN KEY ("venue_id", "venue_revision_id") REFERENCES "football"."venues" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_sv_relation_code_contract_version_r_2ae8cc5c17" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."matches" ADD CONSTRAINT "football_matches_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_matches_competition_season_id_match_date_id_idx" ON "football"."matches" USING btree ("competition_season_id" ASC, "match_date" DESC, "id" DESC);

CREATE INDEX "football_matches_match_date_status_id_idx" ON "football"."matches" USING btree ("match_date" ASC, "status" ASC, "id" ASC);

CREATE UNIQUE INDEX "football_matches_sv_variant_current_idx" ON "football"."matches" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_matches_sv_canonical_current_idx" ON "football"."matches" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."match_source_ids" ADD CONSTRAINT "football_match_source_ids_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_source_ids" ADD CONSTRAINT "football_match_source_ids_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_source_ids" ADD CONSTRAINT "football_match_source_ids_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_source_ids" ADD CONSTRAINT "football_match_source_ids_sv_recorded_from_gen_datas_3b1d452565" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_source_ids" ADD CONSTRAINT "football_match_source_ids_sv_recorded_to_gen_dataset_5a66977e8f" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_source_ids" ADD CONSTRAINT "football_match_source_ids_sv_relation_code_contract__1e6559f837" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_match_source_ids_match_id_idx" ON "football"."match_source_ids" USING btree ("match_id" ASC);

CREATE UNIQUE INDEX "football_match_source_ids_sv_current_idx" ON "football"."match_source_ids" USING btree ("source_id" ASC, "external_id" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_coach_id_fk" FOREIGN KEY ("coach_id", "coach_revision_id") REFERENCES "football"."coaches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_sv_relation_code_contract_versi_0717091192" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_teams" ADD CONSTRAINT "football_match_teams_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_match_teams_team_id_match_id_idx" ON "football"."match_teams" USING btree ("team_id" ASC, "match_id" ASC) WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX "football_match_teams_sv_natural_0_variant_current_idx" ON "football"."match_teams" USING btree ("match_id" ASC, "team_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_teams_sv_natural_0_canonical_current_idx" ON "football"."match_teams" USING btree ("match_id" ASC, "team_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_match_teams_sv_variant_current_idx" ON "football"."match_teams" USING btree ("match_id" ASC, "side" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_teams_sv_canonical_current_idx" ON "football"."match_teams" USING btree ("match_id" ASC, "side" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."match_scores" ADD CONSTRAINT "football_match_scores_match_id_side_fk" FOREIGN KEY ("match_id", "side", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "side", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_scores" ADD CONSTRAINT "football_match_scores_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_scores" ADD CONSTRAINT "football_match_scores_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_scores" ADD CONSTRAINT "football_match_scores_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_scores" ADD CONSTRAINT "football_match_scores_sv_relation_code_contract_vers_da21b42b07" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_scores" ADD CONSTRAINT "football_match_scores_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_match_scores_sv_variant_current_idx" ON "football"."match_scores" USING btree ("match_id" ASC, "side" ASC, "score_scope" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_scores_sv_canonical_current_idx" ON "football"."match_scores" USING btree ("match_id" ASC, "side" ASC, "score_scope" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "football_match_lineups_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "football_match_lineups_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "football_match_lineups_sv_recorded_from_gen_dataset__3c97843dc7" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "football_match_lineups_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "football_match_lineups_sv_relation_code_contract_ver_31217aaa32" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_lineups" ADD CONSTRAINT "football_match_lineups_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_match_lineups_sv_variant_current_idx" ON "football"."match_lineups" USING btree ("match_id" ASC, "team_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_lineups_sv_canonical_current_idx" ON "football"."match_lineups" USING btree ("match_id" ASC, "team_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_profile_version_id_player_id_fk" FOREIGN KEY ("profile_version_id", "player_id") REFERENCES "football"."player_profile_versions" ("id", "player_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_position_code_fk" FOREIGN KEY ("position_code", "position_definition_version") REFERENCES "football"."positions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_source_id_raw_position_code_po_5b3997f77" FOREIGN KEY ("source_id", "raw_position_code", "position_mapping_version") REFERENCES "football"."position_mappings" ("source_id", "raw_position_code", "mapping_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_sv_recorded_from_gen_dataset__97b20cb775" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_sv_relation_code_contract_ver_f3c3bcd04a" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_players" ADD CONSTRAINT "football_match_players_sv_source_id_raw_position_cod_d20ac20ff0" FOREIGN KEY ("source_id", "raw_position_code", "position_mapping_version", "position_code", "position_definition_version") REFERENCES "football"."position_mappings" ("source_id", "raw_position_code", "mapping_version", "position_code", "position_definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_match_players_player_id_match_id_idx" ON "football"."match_players" USING btree ("player_id" ASC, "match_id" ASC);

CREATE UNIQUE INDEX "football_match_players_sv_natural_0_variant_current_idx" ON "football"."match_players" USING btree ("match_id" ASC, "player_id" ASC, "team_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_players_sv_natural_0_canonical_current_idx" ON "football"."match_players" USING btree ("match_id" ASC, "player_id" ASC, "team_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_match_players_sv_variant_current_idx" ON "football"."match_players" USING btree ("match_id" ASC, "player_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_players_sv_canonical_current_idx" ON "football"."match_players" USING btree ("match_id" ASC, "player_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_numerator_code_fk" FOREIGN KEY ("numerator_code", "numerator_definition_version") REFERENCES "football"."metric_definitions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_denominator_code_fk" FOREIGN KEY ("denominator_code", "denominator_definition_version") REFERENCES "football"."metric_definitions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_sv_recorded_from_gen_dat_0aec767513" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_sv_recorded_to_gen_datas_d6b0be80de" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_sv_relation_code_contrac_e64afb5233" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."metric_definitions" ADD CONSTRAINT "football_metric_definitions_sv_source_id_source_reco_bcf6134006" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_metric_definitions_sv_current_idx" ON "football"."metric_definitions" USING btree ("code" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."source_metric_mappings" ADD CONSTRAINT "football_source_metric_mappings_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."source_metric_mappings" ADD CONSTRAINT "football_source_metric_mappings_metric_code_fk" FOREIGN KEY ("metric_code", "metric_definition_version") REFERENCES "football"."metric_definitions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."source_metric_mappings" ADD CONSTRAINT "football_source_metric_mappings_sv_recorded_from_gen_0db08775bf" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."source_metric_mappings" ADD CONSTRAINT "football_source_metric_mappings_sv_recorded_to_gen_d_d4187ff638" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."source_metric_mappings" ADD CONSTRAINT "football_source_metric_mappings_sv_relation_code_con_eda3974750" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."source_metric_mappings" ADD CONSTRAINT "football_source_metric_mappings_sv_source_id_source__9bf23b59b1" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_source_metric_mappings_sv_current_idx" ON "football"."source_metric_mappings" USING btree ("source_id" ASC, "family_code" ASC, "raw_key" ASC) WHERE recorded_to_gen IS NULL;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_match_id_player_id_team_id_fk" FOREIGN KEY ("match_id", "player_id", "team_id", "match_player_revision_id") REFERENCES "football"."match_players" ("match_id", "player_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_sv_recorded_from_gen_dat_008fe7a8bd" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_sv_recorded_to_gen_datas_6e54fb2aeb" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_sv_relation_code_contrac_473d2bcee5" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_stats" ADD CONSTRAINT "football_player_match_stats_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_player_match_stats_player_id_period_code_match_id_idx" ON "football"."player_match_stats" USING btree ("player_id" ASC, "period_code" ASC, "match_id" ASC);

CREATE UNIQUE INDEX "football_player_match_stats_sv_variant_current_idx" ON "football"."player_match_stats" USING btree ("match_id" ASC, "player_id" ASC, "period_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_match_stats_sv_canonical_current_idx" ON "football"."player_match_stats" USING btree ("match_id" ASC, "player_id" ASC, "period_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_sv_recorded_from_gen_datas_dfd03c0275" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_sv_recorded_to_gen_dataset_6693cb4260" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_sv_relation_code_contract__e5eb997f61" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_stats" ADD CONSTRAINT "football_team_match_stats_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_team_match_stats_team_id_period_code_match_id_idx" ON "football"."team_match_stats" USING btree ("team_id" ASC, "period_code" ASC, "match_id" ASC);

CREATE UNIQUE INDEX "football_team_match_stats_sv_variant_current_idx" ON "football"."team_match_stats" USING btree ("match_id" ASC, "team_id" ASC, "period_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_match_stats_sv_canonical_current_idx" ON "football"."team_match_stats" USING btree ("match_id" ASC, "team_id" ASC, "period_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_keeper_id_fk" FOREIGN KEY ("keeper_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_player_profile_version_id_player_id_fk" FOREIGN KEY ("player_profile_version_id", "player_id") REFERENCES "football"."player_profile_versions" ("id", "player_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_keeper_profile_version_id_keeper_id_fk" FOREIGN KEY ("keeper_profile_version_id", "keeper_id") REFERENCES "football"."player_profile_versions" ("id", "player_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_sv_relation_code_contract_version_rel_0b9184316b" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."shots" ADD CONSTRAINT "football_shots_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_shots_match_id_idx" ON "football"."shots" USING btree ("match_id" ASC);

CREATE INDEX "football_shots_player_id_match_id_idx" ON "football"."shots" USING btree ("player_id" ASC, "match_id" ASC) WHERE player_id IS NOT NULL;

CREATE UNIQUE INDEX "football_shots_sv_natural_0_variant_current_idx" ON "football"."shots" USING btree ("source_id" ASC, "match_id" ASC, "external_shot_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_shots_sv_natural_0_canonical_current_idx" ON "football"."shots" USING btree ("source_id" ASC, "match_id" ASC, "external_shot_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_shots_sv_variant_current_idx" ON "football"."shots" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_shots_sv_canonical_current_idx" ON "football"."shots" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_match_id_player_id_team_id_fk" FOREIGN KEY ("match_id", "player_id", "team_id", "match_player_revision_id") REFERENCES "football"."match_players" ("match_id", "player_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_sv_recorded_from_gen__6bc2b489cd" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_sv_recorded_to_gen_da_5d7c1c9f10" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_sv_relation_code_cont_ea86b05fbc" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_advanced" ADD CONSTRAINT "football_player_match_advanced_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_player_match_advanced_player_id_period_code__f96697137" ON "football"."player_match_advanced" USING btree ("player_id" ASC, "period_code" ASC, "match_id" ASC);

CREATE UNIQUE INDEX "football_player_match_advanced_sv_variant_current_idx" ON "football"."player_match_advanced" USING btree ("match_id" ASC, "player_id" ASC, "period_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_match_advanced_sv_canonical_current_idx" ON "football"."player_match_advanced" USING btree ("match_id" ASC, "player_id" ASC, "period_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_sv_recorded_from_gen_da_650150fb65" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_sv_recorded_to_gen_data_271604b630" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_sv_relation_code_contra_7eb4d7d75a" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_advanced" ADD CONSTRAINT "football_team_match_advanced_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_team_match_advanced_team_id_period_code_match_id_idx" ON "football"."team_match_advanced" USING btree ("team_id" ASC, "period_code" ASC, "match_id" ASC);

CREATE UNIQUE INDEX "football_team_match_advanced_sv_variant_current_idx" ON "football"."team_match_advanced" USING btree ("match_id" ASC, "team_id" ASC, "period_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_match_advanced_sv_canonical_current_idx" ON "football"."team_match_advanced" USING btree ("match_id" ASC, "team_id" ASC, "period_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_related_player_id_fk" FOREIGN KEY ("related_player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_events" ADD CONSTRAINT "football_match_events_sv_match_id_source_id_feature__b755fa8806" FOREIGN KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen") REFERENCES "ingest"."match_coverage" ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_momentum" ADD CONSTRAINT "football_match_momentum_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_momentum" ADD CONSTRAINT "football_match_momentum_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_momentum" ADD CONSTRAINT "football_match_momentum_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_momentum" ADD CONSTRAINT "football_match_momentum_sv_match_id_source_id_featur_94bc9ad5bd" FOREIGN KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen") REFERENCES "ingest"."match_coverage" ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_networks" ADD CONSTRAINT "football_pass_networks_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_networks" ADD CONSTRAINT "football_pass_networks_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_networks" ADD CONSTRAINT "football_pass_networks_sv_recorded_from_gen_dataset__d3576cc8ac" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_networks" ADD CONSTRAINT "football_pass_networks_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_networks" ADD CONSTRAINT "football_pass_networks_sv_relation_code_contract_ver_af45a6b5ad" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_networks" ADD CONSTRAINT "football_pass_networks_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_pass_networks_sv_natural_0_variant_current_idx" ON "football"."pass_networks" USING btree ("match_id" ASC, "team_id" ASC, "window_kind" ASC, "from_seconds" ASC, "until_seconds" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_pass_networks_sv_natural_0_canonical_current_idx" ON "football"."pass_networks" USING btree ("match_id" ASC, "team_id" ASC, "window_kind" ASC, "from_seconds" ASC, "until_seconds" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_pass_networks_sv_variant_current_idx" ON "football"."pass_networks" USING btree ("match_id" ASC, "team_id" ASC, "window_kind" ASC, "from_seconds" ASC, "until_seconds" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_pass_networks_sv_canonical_current_idx" ON "football"."pass_networks" USING btree ("match_id" ASC, "team_id" ASC, "window_kind" ASC, "from_seconds" ASC, "until_seconds" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."pass_network_nodes" ADD CONSTRAINT "football_pass_network_nodes_network_id_fk" FOREIGN KEY ("network_id") REFERENCES "football"."pass_networks" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE "football"."pass_network_nodes" ADD CONSTRAINT "football_pass_network_nodes_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."pass_network_edges" ADD CONSTRAINT "football_pass_network_edges_network_id_from_player_id_fk" FOREIGN KEY ("network_id", "from_player_id") REFERENCES "football"."pass_network_nodes" ("network_id", "player_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE "football"."pass_network_edges" ADD CONSTRAINT "football_pass_network_edges_network_id_to_player_id_fk" FOREIGN KEY ("network_id", "to_player_id") REFERENCES "football"."pass_network_nodes" ("network_id", "player_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_sv_recorded_from_gen_dataset_89eff967ec" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_sv_relation_code_contract_ve_7fc0dfc1e1" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_heatmaps" ADD CONSTRAINT "football_match_heatmaps_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_match_heatmaps_sv_natural_0_variant_current_idx" ON "football"."match_heatmaps" USING btree ("match_id" ASC, "team_id" ASC, "player_id" ASC, "period_code" ASC, "map_kind" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_heatmaps_sv_natural_0_canonical_current_idx" ON "football"."match_heatmaps" USING btree ("match_id" ASC, "team_id" ASC, "player_id" ASC, "period_code" ASC, "map_kind" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_match_heatmaps_sv_variant_current_idx" ON "football"."match_heatmaps" USING btree ("match_id" ASC, "team_id" ASC, "player_id" ASC, "period_code" ASC, "map_kind" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_match_heatmaps_sv_canonical_current_idx" ON "football"."match_heatmaps" USING btree ("match_id" ASC, "team_id" ASC, "player_id" ASC, "period_code" ASC, "map_kind" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_coach_id_fk" FOREIGN KEY ("coach_id", "coach_revision_id") REFERENCES "football"."coaches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_sv_recorded_from_gen_dat_2f8a87c199" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_sv_recorded_to_gen_datas_fe9cef784b" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_sv_relation_code_contrac_905377f0ff" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_coach_tenures" ADD CONSTRAINT "football_team_coach_tenures_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_team_coach_tenures_team_id_valid_from_idx" ON "football"."team_coach_tenures" USING btree ("team_id" ASC, "valid_from" ASC);

CREATE UNIQUE INDEX "football_team_coach_tenures_sv_variant_current_idx" ON "football"."team_coach_tenures" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_coach_tenures_sv_canonical_current_idx" ON "football"."team_coach_tenures" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."honour_definitions" ADD CONSTRAINT "football_honour_definitions_competition_id_fk" FOREIGN KEY ("competition_id", "competition_revision_id") REFERENCES "football"."competitions" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."honour_definitions" ADD CONSTRAINT "football_honour_definitions_sv_recorded_from_gen_dat_a62016d637" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."honour_definitions" ADD CONSTRAINT "football_honour_definitions_sv_recorded_to_gen_datas_8160f96d22" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."honour_definitions" ADD CONSTRAINT "football_honour_definitions_sv_relation_code_contrac_c3c56e95c2" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."honour_definitions" ADD CONSTRAINT "football_honour_definitions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."honour_definitions" ADD CONSTRAINT "football_honour_definitions_sv_source_id_source_reco_01b8fc3a36" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_honour_definitions_sv_natural_0_variant_current_idx" ON "football"."honour_definitions" USING btree ("code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_honour_definitions_sv_natural_0_canonical_current_idx" ON "football"."honour_definitions" USING btree ("code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_honour_definitions_sv_variant_current_idx" ON "football"."honour_definitions" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_honour_definitions_sv_canonical_current_idx" ON "football"."honour_definitions" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_honour_id_fk" FOREIGN KEY ("honour_id", "honour_revision_id") REFERENCES "football"."honour_definitions" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_sv_recorded_from_gen_dataset_211f081c26" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_sv_relation_code_contract_ve_b93c7eba65" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_honours" ADD CONSTRAINT "football_player_honours_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_player_honours_sv_natural_0_variant_current_idx" ON "football"."player_honours" USING btree ("player_id" ASC, "honour_id" ASC, "edition_key" ASC, "outcome" ASC, "team_id" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_honours_sv_natural_0_canonical_current_idx" ON "football"."player_honours" USING btree ("player_id" ASC, "honour_id" ASC, "edition_key" ASC, "outcome" ASC, "team_id" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_player_honours_sv_variant_current_idx" ON "football"."player_honours" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_honours_sv_canonical_current_idx" ON "football"."player_honours" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_honour_id_fk" FOREIGN KEY ("honour_id", "honour_revision_id") REFERENCES "football"."honour_definitions" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_sv_recorded_from_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_sv_recorded_to_gen_dataset_snapshots_fk" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_sv_relation_code_contract_vers_091bec67f8" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_honours" ADD CONSTRAINT "football_team_honours_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_team_honours_sv_natural_0_variant_current_idx" ON "football"."team_honours" USING btree ("team_id" ASC, "honour_id" ASC, "edition_key" ASC, "outcome" ASC, "variant_key" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_honours_sv_natural_0_canonical_current_idx" ON "football"."team_honours" USING btree ("team_id" ASC, "honour_id" ASC, "edition_key" ASC, "outcome" ASC) NULLS NOT DISTINCT WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_team_honours_sv_variant_current_idx" ON "football"."team_honours" USING btree ("id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_honours_sv_canonical_current_idx" ON "football"."team_honours" USING btree ("id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."standing_snapshots" ADD CONSTRAINT "football_standing_snapshots_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."standing_snapshots" ADD CONSTRAINT "football_standing_snapshots_stage_id_competition_season_id_fk" FOREIGN KEY ("stage_id", "competition_season_id", "stage_revision_id") REFERENCES "football"."competition_stages" ("id", "competition_season_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."standing_snapshots" ADD CONSTRAINT "football_standing_snapshots_group_id_stage_id_competi_f64b0944f" FOREIGN KEY ("group_id", "stage_id", "competition_season_id", "group_revision_id") REFERENCES "football"."competition_groups" ("id", "stage_id", "competition_season_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."standing_snapshots" ADD CONSTRAINT "football_standing_snapshots_source_id_source_record_id_fk" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."standing_snapshots" ADD CONSTRAINT "football_standing_snapshots_sv_recorded_from_gen_dat_d648faf338" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_standing_snapshots_competition_season_id_obs_2e324ca49" ON "football"."standing_snapshots" USING btree ("competition_season_id" ASC, "observed_at" DESC, "id" DESC);

ALTER TABLE "football"."standing_rows" ADD CONSTRAINT "football_standing_rows_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "football"."standing_snapshots" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."standing_rows" ADD CONSTRAINT "football_standing_rows_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."ranking_systems" ADD CONSTRAINT "football_ranking_systems_sv_recorded_from_gen_datase_2eaa049988" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."ranking_snapshots" ADD CONSTRAINT "football_ranking_snapshots_system_id_subject_kind_fk" FOREIGN KEY ("system_id", "subject_kind") REFERENCES "football"."ranking_systems" ("id", "subject_kind") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."ranking_snapshots" ADD CONSTRAINT "football_ranking_snapshots_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "ingest"."source_documents" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."ranking_snapshots" ADD CONSTRAINT "football_ranking_snapshots_sv_recorded_from_gen_data_56271677bf" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "football_ranking_snapshots_system_id_published_at_id_idx" ON "football"."ranking_snapshots" USING btree ("system_id" ASC, "published_at" DESC NULLS LAST, "id" DESC);

ALTER TABLE "football"."team_ranking_entries" ADD CONSTRAINT "football_team_ranking_entries_snapshot_id_subject_kind_fk" FOREIGN KEY ("snapshot_id", "subject_kind") REFERENCES "football"."ranking_snapshots" ("id", "subject_kind") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_ranking_entries" ADD CONSTRAINT "football_team_ranking_entries_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_ranking_entries" ADD CONSTRAINT "football_team_ranking_entries_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_ranking_components" ADD CONSTRAINT "football_team_ranking_components_snapshot_id_team_id_fk" FOREIGN KEY ("snapshot_id", "team_id") REFERENCES "football"."team_ranking_entries" ("snapshot_id", "team_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_ranking_entries" ADD CONSTRAINT "football_association_ranking_entries_snapshot_id_subj_203386287" FOREIGN KEY ("snapshot_id", "subject_kind") REFERENCES "football"."ranking_snapshots" ("id", "subject_kind") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_ranking_entries" ADD CONSTRAINT "football_association_ranking_entries_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_ranking_entries" ADD CONSTRAINT "football_association_ranking_entries_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_ranking_components" ADD CONSTRAINT "football_association_ranking_components_snapshot_id_a_4f9cdbb37" FOREIGN KEY ("snapshot_id", "association_id") REFERENCES "football"."association_ranking_entries" ("snapshot_id", "association_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_metric_code_fk" FOREIGN KEY ("metric_code", "metric_definition_version") REFERENCES "football"."metric_definitions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_match_id_player__ce4af89a9f" FOREIGN KEY ("match_id", "player_id", "team_id", "match_player_revision_id") REFERENCES "football"."match_players" ("match_id", "player_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_sv_recorded_from_b2acf1260b" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_sv_recorded_to_g_e6e4f1e403" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_sv_relation_code_728ccb3f5f" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."player_match_metric_values" ADD CONSTRAINT "football_player_match_metric_values_sv_source_id_sou_1409e98f9a" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_player_match_metric_values_sv_variant_current_idx" ON "football"."player_match_metric_values" USING btree ("match_id" ASC, "player_id" ASC, "period_code" ASC, "family_code" ASC, "metric_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_player_match_metric_values_sv_canonical_current_idx" ON "football"."player_match_metric_values" USING btree ("match_id" ASC, "player_id" ASC, "period_code" ASC, "family_code" ASC, "metric_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_metric_code_fk" FOREIGN KEY ("metric_code", "metric_definition_version") REFERENCES "football"."metric_definitions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_period_code_fk" FOREIGN KEY ("period_code", "period_definition_version") REFERENCES "football"."periods" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_match_id_team_id_fk" FOREIGN KEY ("match_id", "team_id", "match_team_revision_id") REFERENCES "football"."match_teams" ("match_id", "team_id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_sv_recorded_from_g_7f58f148a9" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_sv_recorded_to_gen_111c92d7bd" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_sv_relation_code_c_63d6e251b9" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_match_metric_values" ADD CONSTRAINT "football_team_match_metric_values_sv_source_id_sourc_f2c511c7e6" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_team_match_metric_values_sv_variant_current_idx" ON "football"."team_match_metric_values" USING btree ("match_id" ASC, "team_id" ASC, "period_code" ASC, "family_code" ASC, "metric_code" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_match_metric_values_sv_canonical_current_idx" ON "football"."team_match_metric_values" USING btree ("match_id" ASC, "team_id" ASC, "period_code" ASC, "family_code" ASC, "metric_code" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."match_heatmap_cells" ADD CONSTRAINT "football_match_heatmap_cells_heatmap_id_fk" FOREIGN KEY ("heatmap_id") REFERENCES "football"."match_heatmaps" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_previous_match_id_fk" FOREIGN KEY ("previous_match_id", "previous_match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_home_team_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_away_team_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_home_image_asset_id_fk" FOREIGN KEY ("home_image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_away_image_asset_id_fk" FOREIGN KEY ("away_image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_sv_match_id_source_id_fea_8ba4929553" FOREIGN KEY ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen") REFERENCES "ingest"."match_coverage" ("match_id", "source_id", "feature_code", "variant_key", "recorded_from_gen") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_h2h_entries" ADD CONSTRAINT "football_match_h2h_entries_sv_source_id_source_recor_d8a524c561" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_observation_details" ADD CONSTRAINT "football_match_observation_details_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_observation_details" ADD CONSTRAINT "football_match_observation_details_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."match_observation_details" ADD CONSTRAINT "football_match_observation_details_sv_recorded_from__b000818524" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_sv_country_id_countries_fk" FOREIGN KEY ("country_id", "country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_sv_recorded_from_gen__bd66f910d2" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_sv_recorded_to_gen_da_f299fd9bf1" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_sv_relation_code_cont_28a9efc856" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."team_profile_versions" ADD CONSTRAINT "football_team_profile_versions_sv_source_id_source_r_9cc2d04542" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_team_profile_versions_sv_natural_0_variant_current_idx" ON "football"."team_profile_versions" USING btree ("team_id" ASC, "source_record_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_profile_versions_sv_natural_0_canonica_674cc75c60" ON "football"."team_profile_versions" USING btree ("team_id" ASC, "source_record_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_team_profile_versions_sv_variant_current_idx" ON "football"."team_profile_versions" USING btree ("team_id" ASC, "profile_context" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_team_profile_versions_sv_canonical_current_idx" ON "football"."team_profile_versions" USING btree ("team_id" ASC, "profile_context" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "football"."associations" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "ingest"."source_records" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "ingest"."media_assets" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_sv_country_id__6bd74b4891" FOREIGN KEY ("country_id", "country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_sv_recorded_fr_325271d6ad" FOREIGN KEY ("recorded_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_sv_recorded_to_d7b6024d5c" FOREIGN KEY ("recorded_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_sv_relation_co_180f989475" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "football"."association_profile_versions" ADD CONSTRAINT "football_association_profile_versions_sv_source_id_s_e25275c61a" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "football_association_profile_versions_sv_natural_0_v_d499b52381" ON "football"."association_profile_versions" USING btree ("association_id" ASC, "source_record_id" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_association_profile_versions_sv_natural_0_c_7c3e692e06" ON "football"."association_profile_versions" USING btree ("association_id" ASC, "source_record_id" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

CREATE UNIQUE INDEX "football_association_profile_versions_sv_variant_current_idx" ON "football"."association_profile_versions" USING btree ("association_id" ASC, "profile_context" ASC, "variant_key" ASC) WHERE recorded_to_gen IS NULL;

CREATE UNIQUE INDEX "football_association_profile_versions_sv_canonical_current_idx" ON "football"."association_profile_versions" USING btree ("association_id" ASC, "profile_context" ASC) WHERE recorded_to_gen IS NULL AND is_canonical;

ALTER TABLE "analytics"."aggregation_builds" ADD CONSTRAINT "analytics_aggregation_builds_competition_season_id_fk" FOREIGN KEY ("competition_season_id", "competition_season_revision_id") REFERENCES "football"."competition_seasons" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."aggregation_builds" ADD CONSTRAINT "analytics_aggregation_builds_dataset_snapshot_id_fk" FOREIGN KEY ("dataset_snapshot_id") REFERENCES "ingest"."dataset_snapshots" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."aggregation_builds" ADD CONSTRAINT "analytics_aggregation_builds_sv_catalog_snapshot_id__f69472e772" FOREIGN KEY ("catalog_snapshot_id") REFERENCES "ingest"."dataset_snapshots" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_build_id_competition_s_f172d792b" FOREIGN KEY ("build_id", "competition_season_id") REFERENCES "analytics"."aggregation_builds" ("id", "competition_season_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_catalog_snapshot_id_fk" FOREIGN KEY ("catalog_snapshot_id") REFERENCES "ingest"."dataset_snapshots" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_sv_published_from_gen_cd9d4989f4" FOREIGN KEY ("published_from_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_sv_published_to_gen_d_5a057e144b" FOREIGN KEY ("published_to_gen") REFERENCES "ingest"."dataset_snapshots" ("generation") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_sv_relation_code_cont_41b234f393" FOREIGN KEY ("relation_code", "contract_version") REFERENCES "ingest"."relation_contracts" ("relation_code", "contract_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_sv_source_id_sources_fk" FOREIGN KEY ("source_id") REFERENCES "ingest"."sources" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."publication_versions" ADD CONSTRAINT "analytics_publication_versions_sv_source_id_source_r_1bce13d845" FOREIGN KEY ("source_id", "source_record_id") REFERENCES "ingest"."source_records" ("source_id", "id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE UNIQUE INDEX "analytics_publication_versions_sv_publication_current_idx" ON "analytics"."publication_versions" USING btree ("competition_season_id" ASC) WHERE published_to_gen IS NULL;

ALTER TABLE "analytics"."match_summary" ADD CONSTRAINT "analytics_match_summary_build_id_competition_season_id_fk" FOREIGN KEY ("build_id", "competition_season_id") REFERENCES "analytics"."aggregation_builds" ("id", "competition_season_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."match_summary" ADD CONSTRAINT "analytics_match_summary_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."match_summary" ADD CONSTRAINT "analytics_match_summary_home_team_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."match_summary" ADD CONSTRAINT "analytics_match_summary_away_team_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "analytics_match_summary_build_id_match_date_match_id_idx" ON "analytics"."match_summary" USING btree ("build_id" ASC, "match_date" DESC, "match_id" DESC);

ALTER TABLE "analytics"."player_competition_team_stats" ADD CONSTRAINT "analytics_player_competition_team_stats_build_id_comp_42efbe50b" FOREIGN KEY ("build_id", "competition_season_id") REFERENCES "analytics"."aggregation_builds" ("id", "competition_season_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_competition_team_stats" ADD CONSTRAINT "analytics_player_competition_team_stats_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_competition_team_stats" ADD CONSTRAINT "analytics_player_competition_team_stats_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_competition_stats" ADD CONSTRAINT "analytics_player_competition_stats_build_id_competiti_756192c31" FOREIGN KEY ("build_id", "competition_season_id") REFERENCES "analytics"."aggregation_builds" ("id", "competition_season_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_competition_stats" ADD CONSTRAINT "analytics_player_competition_stats_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "analytics_player_competition_stats_build_id_goals_player_id_idx" ON "analytics"."player_competition_stats" USING btree ("build_id" ASC, "goals" DESC NULLS LAST, "player_id" ASC);

ALTER TABLE "analytics"."team_competition_stats" ADD CONSTRAINT "analytics_team_competition_stats_build_id_competition_88c4c4e60" FOREIGN KEY ("build_id", "competition_season_id") REFERENCES "analytics"."aggregation_builds" ("id", "competition_season_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."team_competition_stats" ADD CONSTRAINT "analytics_team_competition_stats_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."competition_summary" ADD CONSTRAINT "analytics_competition_summary_build_id_competition_season_id_fk" FOREIGN KEY ("build_id", "competition_season_id") REFERENCES "analytics"."aggregation_builds" ("id", "competition_season_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_search" ADD CONSTRAINT "analytics_player_search_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_search" ADD CONSTRAINT "analytics_player_search_nationality_country_id_fk" FOREIGN KEY ("nationality_country_id", "nationality_country_revision_id") REFERENCES "football"."countries" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."player_search" ADD CONSTRAINT "analytics_player_search_primary_position_code_fk" FOREIGN KEY ("primary_position_code", "primary_position_definition_version") REFERENCES "football"."positions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE INDEX "analytics_player_search_search_vector_idx" ON "analytics"."player_search" USING gin ("search_vector");

ALTER TABLE "analytics"."metric_totals" ADD CONSTRAINT "analytics_metric_totals_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "analytics"."aggregation_builds" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."metric_totals" ADD CONSTRAINT "analytics_metric_totals_match_id_fk" FOREIGN KEY ("match_id", "match_revision_id") REFERENCES "football"."matches" ("id", "revision_id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."metric_totals" ADD CONSTRAINT "analytics_metric_totals_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "football"."players" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."metric_totals" ADD CONSTRAINT "analytics_metric_totals_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "football"."teams" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."metric_totals" ADD CONSTRAINT "analytics_metric_totals_metric_code_fk" FOREIGN KEY ("metric_code", "metric_definition_version") REFERENCES "football"."metric_definitions" ("code", "definition_version") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

ALTER TABLE "analytics"."catalog_publication" ADD CONSTRAINT "analytics_catalog_publication_catalog_snapshot_id_fk" FOREIGN KEY ("catalog_snapshot_id") REFERENCES "ingest"."dataset_snapshots" ("id") MATCH SIMPLE ON UPDATE NO ACTION ON DELETE RESTRICT NOT DEFERRABLE;

CREATE VIEW "ingest"."match_coverage_current" AS SELECT * FROM "ingest"."match_coverage" WHERE "recorded_to_gen" IS NULL AND "is_canonical";

CREATE VIEW "ingest"."public_aliases_current" AS SELECT * FROM "ingest"."public_aliases" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."countries_current" AS SELECT * FROM "football"."countries" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."positions_current" AS SELECT * FROM "football"."positions" WHERE "recorded_to_gen" IS NULL;

CREATE VIEW "football"."periods_current" AS SELECT * FROM "football"."periods" WHERE "recorded_to_gen" IS NULL;

CREATE VIEW "football"."venues_current" AS SELECT * FROM "football"."venues" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."coaches_current" AS SELECT * FROM "football"."coaches" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."competitions_current" AS SELECT * FROM "football"."competitions" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."competition_seasons_current" AS SELECT * FROM "football"."competition_seasons" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."competition_stages_current" AS SELECT * FROM "football"."competition_stages" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."competition_groups_current" AS SELECT * FROM "football"."competition_groups" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."competition_teams_current" AS SELECT * FROM "football"."competition_teams" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."player_profile_versions_current" AS SELECT * FROM "football"."player_profile_versions" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."position_mappings_current" AS SELECT * FROM "football"."position_mappings" WHERE "recorded_to_gen" IS NULL;

CREATE VIEW "football"."player_team_memberships_current" AS SELECT * FROM "football"."player_team_memberships" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."team_aliases_current" AS SELECT * FROM "football"."team_aliases" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."competition_source_ids_current" AS SELECT * FROM "football"."competition_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."team_source_ids_current" AS SELECT * FROM "football"."team_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."player_source_ids_current" AS SELECT * FROM "football"."player_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."association_source_ids_current" AS SELECT * FROM "football"."association_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."venue_source_ids_current" AS SELECT * FROM "football"."venue_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."coach_source_ids_current" AS SELECT * FROM "football"."coach_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."matches_current" AS SELECT * FROM "football"."matches" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."match_source_ids_current" AS SELECT * FROM "football"."match_source_ids" WHERE "recorded_to_gen" IS NULL AND NOT "is_deleted";

CREATE VIEW "football"."match_teams_current" AS SELECT * FROM "football"."match_teams" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."match_scores_current" AS SELECT * FROM "football"."match_scores" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."match_lineups_current" AS SELECT * FROM "football"."match_lineups" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."match_players_current" AS SELECT * FROM "football"."match_players" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."metric_definitions_current" AS SELECT * FROM "football"."metric_definitions" WHERE "recorded_to_gen" IS NULL;

CREATE VIEW "football"."source_metric_mappings_current" AS SELECT * FROM "football"."source_metric_mappings" WHERE "recorded_to_gen" IS NULL;

CREATE VIEW "football"."player_match_stats_current" AS SELECT * FROM "football"."player_match_stats" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."team_match_stats_current" AS SELECT * FROM "football"."team_match_stats" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."shots_current" AS SELECT * FROM "football"."shots" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."player_match_advanced_current" AS SELECT * FROM "football"."player_match_advanced" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."team_match_advanced_current" AS SELECT * FROM "football"."team_match_advanced" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."pass_networks_current" AS SELECT * FROM "football"."pass_networks" WHERE "recorded_to_gen" IS NULL AND "is_canonical";

CREATE VIEW "football"."match_heatmaps_current" AS SELECT * FROM "football"."match_heatmaps" WHERE "recorded_to_gen" IS NULL AND "is_canonical";

CREATE VIEW "football"."team_coach_tenures_current" AS SELECT * FROM "football"."team_coach_tenures" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."honour_definitions_current" AS SELECT * FROM "football"."honour_definitions" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."player_honours_current" AS SELECT * FROM "football"."player_honours" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."team_honours_current" AS SELECT * FROM "football"."team_honours" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."player_match_metric_values_current" AS SELECT * FROM "football"."player_match_metric_values" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."team_match_metric_values_current" AS SELECT * FROM "football"."team_match_metric_values" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."team_profile_versions_current" AS SELECT * FROM "football"."team_profile_versions" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "football"."association_profile_versions_current" AS SELECT * FROM "football"."association_profile_versions" WHERE "recorded_to_gen" IS NULL AND "is_canonical" AND NOT "is_deleted";

CREATE VIEW "analytics"."publication_versions_current" AS SELECT * FROM "analytics"."publication_versions" WHERE "published_to_gen" IS NULL;
