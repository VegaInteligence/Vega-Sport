-- Typed selective-inline integrity; no payload copies or universal row registry.

CREATE OR REPLACE FUNCTION "ingest"."selected_at"(g bigint, from_gen bigint, to_gen bigint) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog IMMUTABLE PARALLEL SAFE
AS $orion_pro$
SELECT from_gen <= g AND (to_gen IS NULL OR g < to_gen)
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."selected_at"(bigint, bigint, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."assert_draft_generation"(g bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.generation=g AND s.status='draft' AND s.xmin::text=((pg_current_xact_id()::text::numeric % 4294967296)::text)) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Generation must be draft and owned by the current transaction';
    END IF;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."assert_draft_generation"(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."begin_generation"(snapshot_key text, transform_version text, source_priority_version text, knowledge_cutoff_at timestamptz DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE g bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.xmin::text=((pg_current_xact_id()::text::numeric % 4294967296)::text)) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A retained transaction has exactly one generation';
    END IF;
    IF btrim(snapshot_key)='' OR btrim(transform_version)='' OR btrim(source_priority_version)='' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Generation contract identifiers must be nonempty';
    END IF;
    g := nextval('ingest.commit_generation_seq'::regclass);
    INSERT INTO ingest.dataset_snapshots(snapshot_key,transform_version,source_priority_version,knowledge_cutoff_at,generation)
      VALUES (snapshot_key,transform_version,source_priority_version,knowledge_cutoff_at,g);
    RETURN g;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."begin_generation"(text, text, text, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."seal_generation"(g bigint, manifest text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    PERFORM ingest.assert_draft_generation(g);
    IF manifest IS NULL OR manifest !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A sealed generation requires its manifest digest';
    END IF;
    UPDATE ingest.dataset_snapshots SET status='sealed', manifest_sha256=manifest, sealed_at=CURRENT_TIMESTAMP WHERE generation=g;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."seal_generation"(bigint, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_dataset_snapshots"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Generation receipts cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        IF NEW.status <> 'draft' OR NEW.sealed_at IS NOT NULL OR NEW.manifest_sha256 IS NOT NULL
           OR NEW.generation <> currval('ingest.commit_generation_seq'::regclass)
           OR EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.generation >= NEW.generation OR s.xmin::text=((pg_current_xact_id()::text::numeric % 4294967296)::text)) THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Allocate one draft generation after the global transaction lock';
        END IF;
    ELSE
        PERFORM ingest.assert_draft_generation(OLD.generation);
        IF ROW(NEW."id",NEW."snapshot_key",NEW."transform_version",NEW."source_priority_version",NEW."created_at",NEW."knowledge_cutoff_at",NEW."generation") IS DISTINCT FROM ROW(OLD."id",OLD."snapshot_key",OLD."transform_version",OLD."source_priority_version",OLD."created_at",OLD."knowledge_cutoff_at",OLD."generation") OR NEW.status <> 'sealed' THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Only sealing an owned draft generation is allowed';
        END IF;
        PERFORM ingest.validate_generation(OLD.generation);
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_dataset_snapshots"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."dataset_snapshots"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_dataset_snapshots"();

CREATE OR REPLACE FUNCTION "ingest"."pro_generation_commit"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.id=NEW.id AND s.status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A retained generation must be sealed before commit';
    END IF;
    PERFORM ingest.validate_generation(NEW.generation);
    RETURN NULL;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_generation_commit"() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "pro_generation_commit" AFTER INSERT ON "ingest"."dataset_snapshots" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_generation_commit"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_source_records"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_source_records"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."source_records"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_source_records"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_document_lineage"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_document_lineage"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."document_lineage"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_document_lineage"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_resource_fetches"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_resource_fetches"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."resource_fetches"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_resource_fetches"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_match_coverage"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."source_id",NEW."feature_code",NEW."coverage_state",NEW."http_status",NEW."error_code",NEW."observed_row_count",NEW."document_id",NEW."checked_at",NEW."is_stale",NEW."data_revision",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."collection_state",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_record_id",NEW."provenance_kind",NEW."match_revision_id") IS DISTINCT FROM ROW(OLD."match_id",OLD."source_id",OLD."feature_code",OLD."coverage_state",OLD."http_status",OLD."error_code",OLD."observed_row_count",OLD."document_id",OLD."checked_at",OLD."is_stale",OLD."data_revision",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."collection_state",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_record_id",OLD."provenance_kind",OLD."match_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_match_coverage"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."match_coverage"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_match_coverage"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_relation_contracts"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_relation_contracts"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."relation_contracts"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_relation_contracts"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_field_contracts"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_field_contracts"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."field_contracts"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_field_contracts"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_schema_migrations"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_schema_migrations"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."schema_migrations"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_schema_migrations"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_ingest_public_aliases"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."route_kind",NEW."public_key",NEW."player_id",NEW."team_id",NEW."competition_id",NEW."match_id",NEW."association_id",NEW."venue_id",NEW."coach_id",NEW."profile_version_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."competition_revision_id",NEW."match_revision_id",NEW."venue_revision_id",NEW."coach_revision_id") IS DISTINCT FROM ROW(OLD."route_kind",OLD."public_key",OLD."player_id",OLD."team_id",OLD."competition_id",OLD."match_id",OLD."association_id",OLD."venue_id",OLD."coach_id",OLD."profile_version_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."competition_revision_id",OLD."match_revision_id",OLD."venue_revision_id",OLD."coach_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_ingest_public_aliases"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."public_aliases"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_ingest_public_aliases"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_countries"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."name",NEW."iso2",NEW."iso3",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."id",OLD."name",OLD."iso2",OLD."iso3",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_countries"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."countries"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_countries"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_positions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."code",NEW."label",NEW."family",NEW."definition",NEW."definition_version",NEW."recorded_from_gen",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."code",OLD."label",OLD."family",OLD."definition",OLD."definition_version",OLD."recorded_from_gen",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_positions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."positions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_positions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_periods"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."code",NEW."label",NEW."sequence_no",NEW."is_aggregate",NEW."definition",NEW."definition_version",NEW."recorded_from_gen",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."code",OLD."label",OLD."sequence_no",OLD."is_aggregate",OLD."definition",OLD."definition_version",OLD."recorded_from_gen",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_periods"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."periods"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_periods"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_venues"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."name",NEW."city",NEW."country_id",NEW."latitude",NEW."longitude",NEW."capacity",NEW."capacity_as_of",NEW."opened_year",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."country_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."name",OLD."city",OLD."country_id",OLD."latitude",OLD."longitude",OLD."capacity",OLD."capacity_as_of",OLD."opened_year",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."country_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_venues"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."venues"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_venues"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_coaches"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."display_name",NEW."birth_date",NEW."nationality_country_id",NEW."image_asset_id",NEW."created_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."nationality_country_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."display_name",OLD."birth_date",OLD."nationality_country_id",OLD."image_asset_id",OLD."created_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."nationality_country_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_coaches"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."coaches"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_coaches"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_competitions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."name",NEW."slug",NEW."competition_type",NEW."association_id",NEW."country_id",NEW."gender",NEW."age_category",NEW."image_asset_id",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."country_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."name",OLD."slug",OLD."competition_type",OLD."association_id",OLD."country_id",OLD."gender",OLD."age_category",OLD."image_asset_id",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."country_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_competitions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."competitions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_competitions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_competition_seasons"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."competition_id",NEW."season_key",NEW."label",NEW."start_date",NEW."end_date",NEW."status",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."competition_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."competition_id",OLD."season_key",OLD."label",OLD."start_date",OLD."end_date",OLD."status",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."competition_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_competition_seasons"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."competition_seasons"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_competition_seasons"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_competition_stages"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."competition_season_id",NEW."parent_stage_id",NEW."stage_key",NEW."stage_type",NEW."name",NEW."sequence_no",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."competition_season_revision_id",NEW."parent_stage_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."competition_season_id",OLD."parent_stage_id",OLD."stage_key",OLD."stage_type",OLD."name",OLD."sequence_no",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."competition_season_revision_id",OLD."parent_stage_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_competition_stages"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."competition_stages"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_competition_stages"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_competition_groups"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."competition_season_id",NEW."stage_id",NEW."group_key",NEW."name",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."stage_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."competition_season_id",OLD."stage_id",OLD."group_key",OLD."name",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."stage_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_competition_groups"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."competition_groups"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_competition_groups"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_competition_teams"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."competition_season_id",NEW."team_id",NEW."entered_on",NEW."exited_on",NEW."status",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."competition_season_revision_id") IS DISTINCT FROM ROW(OLD."competition_season_id",OLD."team_id",OLD."entered_on",OLD."exited_on",OLD."status",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."competition_season_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_competition_teams"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."competition_teams"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_competition_teams"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_profile_versions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."player_id",NEW."external_profile_version_id",NEW."display_name",NEW."image_asset_id",NEW."observed_at",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."short_name",NEW."country_code_source",NEW."raw_position_code",NEW."shirt_number",NEW."birth_date",NEW."height_cm",NEW."dominant_foot",NEW."profile_content_sha256",NEW."nationality_country_id",NEW."primary_position_code",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."profile_context",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."nationality_country_revision_id",NEW."primary_position_definition_version",NEW."raw_position_code_state",NEW."raw_position_code_source_number",NEW."shirt_number_state",NEW."shirt_number_source_number") IS DISTINCT FROM ROW(OLD."id",OLD."player_id",OLD."external_profile_version_id",OLD."display_name",OLD."image_asset_id",OLD."observed_at",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."short_name",OLD."country_code_source",OLD."raw_position_code",OLD."shirt_number",OLD."birth_date",OLD."height_cm",OLD."dominant_foot",OLD."profile_content_sha256",OLD."nationality_country_id",OLD."primary_position_code",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."profile_context",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."nationality_country_revision_id",OLD."primary_position_definition_version",OLD."raw_position_code_state",OLD."raw_position_code_source_number",OLD."shirt_number_state",OLD."shirt_number_source_number")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_profile_versions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_profile_versions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_profile_versions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_position_mappings"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."raw_position_code",NEW."mapping_version",NEW."position_code",NEW."status",NEW."evidence",NEW."recorded_from_gen",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_record_id",NEW."provenance_kind",NEW."position_definition_version") IS DISTINCT FROM ROW(OLD."source_id",OLD."raw_position_code",OLD."mapping_version",OLD."position_code",OLD."status",OLD."evidence",OLD."recorded_from_gen",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_record_id",OLD."provenance_kind",OLD."position_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_position_mappings"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."position_mappings"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_position_mappings"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_team_memberships"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."player_id",NEW."team_id",NEW."membership_type",NEW."valid_from",NEW."valid_to",NEW."date_precision",NEW."observed_from",NEW."observed_to",NEW."evidence_kind",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."id",OLD."player_id",OLD."team_id",OLD."membership_type",OLD."valid_from",OLD."valid_to",OLD."date_precision",OLD."observed_from",OLD."observed_to",OLD."evidence_kind",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_team_memberships"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_team_memberships"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_team_memberships"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_aliases"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."team_id",NEW."alias",NEW."language_code",NEW."source_id",NEW."valid_from",NEW."valid_to",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_record_id",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."id",OLD."team_id",OLD."alias",OLD."language_code",OLD."source_id",OLD."valid_from",OLD."valid_to",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_record_id",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_aliases"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_aliases"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_aliases"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_competition_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."competition_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."competition_revision_id") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."competition_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."competition_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_competition_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."competition_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_competition_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."team_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."team_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."player_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."player_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_association_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."association_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."association_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_association_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."association_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_association_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_venue_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."venue_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."venue_revision_id") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."venue_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."venue_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_venue_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."venue_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_venue_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_coach_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."coach_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."coach_revision_id") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."coach_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."coach_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_coach_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."coach_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_coach_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_matches"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."competition_season_id",NEW."stage_id",NEW."group_id",NEW."round_label",NEW."round_number",NEW."leg_number",NEW."tie_key",NEW."match_date",NEW."kickoff_at",NEW."kickoff_precision",NEW."source_timezone",NEW."status",NEW."publication_state",NEW."venue_id",NEW."neutral_venue",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."competition_season_revision_id",NEW."stage_revision_id",NEW."group_revision_id",NEW."venue_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."competition_season_id",OLD."stage_id",OLD."group_id",OLD."round_label",OLD."round_number",OLD."leg_number",OLD."tie_key",OLD."match_date",OLD."kickoff_at",OLD."kickoff_precision",OLD."source_timezone",OLD."status",OLD."publication_state",OLD."venue_id",OLD."neutral_venue",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."competition_season_revision_id",OLD."stage_revision_id",OLD."group_revision_id",OLD."venue_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_matches"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."matches"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_matches"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_source_ids"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."external_id",NEW."match_id",NEW."first_seen_at",NEW."source_record_id",NEW."recorded_from_gen",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_revision_id") IS DISTINCT FROM ROW(OLD."source_id",OLD."external_id",OLD."match_id",OLD."first_seen_at",OLD."source_record_id",OLD."recorded_from_gen",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_source_ids"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_source_ids"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_source_ids"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_teams"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."side",NEW."team_id",NEW."participant_label",NEW."coach_id",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_revision_id",NEW."coach_revision_id") IS DISTINCT FROM ROW(OLD."match_id",OLD."side",OLD."team_id",OLD."participant_label",OLD."coach_id",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_revision_id",OLD."coach_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_teams"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_teams"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_teams"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_scores"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."side",NEW."score_scope",NEW."goals",NEW."score_basis",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id") IS DISTINCT FROM ROW(OLD."match_id",OLD."side",OLD."score_scope",OLD."goals",OLD."score_basis",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_scores"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_scores"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_scores"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_lineups"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."team_id",NEW."formation",NEW."confirmed",NEW."lineup_type",NEW."published_at",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id") IS DISTINCT FROM ROW(OLD."match_id",OLD."team_id",OLD."formation",OLD."confirmed",OLD."lineup_type",OLD."published_at",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_lineups"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_lineups"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_lineups"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_players"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."player_id",NEW."team_id",NEW."profile_version_id",NEW."is_starter",NEW."squad_status",NEW."played",NEW."participation_evidence",NEW."shirt_number",NEW."raw_position_code",NEW."position_code",NEW."position_mapping_version",NEW."raw_pitch_x",NEW."raw_pitch_y",NEW."coordinate_frame",NEW."is_captain",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id",NEW."position_definition_version",NEW."raw_position_code_state",NEW."raw_position_code_source_number",NEW."shirt_number_state",NEW."shirt_number_source_number") IS DISTINCT FROM ROW(OLD."match_id",OLD."player_id",OLD."team_id",OLD."profile_version_id",OLD."is_starter",OLD."squad_status",OLD."played",OLD."participation_evidence",OLD."shirt_number",OLD."raw_position_code",OLD."position_code",OLD."position_mapping_version",OLD."raw_pitch_x",OLD."raw_pitch_y",OLD."coordinate_frame",OLD."is_captain",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id",OLD."position_definition_version",OLD."raw_position_code_state",OLD."raw_position_code_source_number",OLD."shirt_number_state",OLD."shirt_number_source_number")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_players"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_players"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_players"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_metric_definitions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."code",NEW."label",NEW."definition",NEW."unit",NEW."scope",NEW."aggregation",NEW."minimum",NEW."maximum",NEW."allows_negative",NEW."numerator_code",NEW."denominator_code",NEW."definition_version",NEW."recorded_from_gen",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."numerator_definition_version",NEW."denominator_definition_version") IS DISTINCT FROM ROW(OLD."code",OLD."label",OLD."definition",OLD."unit",OLD."scope",OLD."aggregation",OLD."minimum",OLD."maximum",OLD."allows_negative",OLD."numerator_code",OLD."denominator_code",OLD."definition_version",OLD."recorded_from_gen",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."numerator_definition_version",OLD."denominator_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_metric_definitions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."metric_definitions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_metric_definitions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_source_metric_mappings"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."source_id",NEW."family_code",NEW."raw_key",NEW."mapping_version",NEW."metric_code",NEW."parse_rule",NEW."period_rule",NEW."definition_notes",NEW."recorded_from_gen",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_record_id",NEW."provenance_kind",NEW."metric_definition_version") IS DISTINCT FROM ROW(OLD."source_id",OLD."family_code",OLD."raw_key",OLD."mapping_version",OLD."metric_code",OLD."parse_rule",OLD."period_rule",OLD."definition_notes",OLD."recorded_from_gen",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_record_id",OLD."provenance_kind",OLD."metric_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_source_metric_mappings"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."source_metric_mappings"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_source_metric_mappings"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_match_stats"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."player_id",NEW."period_code",NEW."team_id",NEW."goals",NEW."assists",NEW."shots",NEW."shots_on_target",NEW."chances_created",NEW."big_chances_created",NEW."passes_completed",NEW."passes_attempted",NEW."passes_final_third",NEW."defensive_actions",NEW."interceptions",NEW."tackles",NEW."recoveries",NEW."duels_won",NEW."duels_lost",NEW."aerial_duels_won",NEW."aerial_duels_attempted",NEW."touches",NEW."touches_box",NEW."clearances",NEW."blocks",NEW."dribbles_completed",NEW."dribbles_attempted",NEW."saves",NEW."xg",NEW."non_penalty_xg",NEW."xa",NEW."xgot",NEW."minutes_played",NEW."provider_rating",NEW."goals_prevented",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_player_revision_id",NEW."period_definition_version") IS DISTINCT FROM ROW(OLD."match_id",OLD."player_id",OLD."period_code",OLD."team_id",OLD."goals",OLD."assists",OLD."shots",OLD."shots_on_target",OLD."chances_created",OLD."big_chances_created",OLD."passes_completed",OLD."passes_attempted",OLD."passes_final_third",OLD."defensive_actions",OLD."interceptions",OLD."tackles",OLD."recoveries",OLD."duels_won",OLD."duels_lost",OLD."aerial_duels_won",OLD."aerial_duels_attempted",OLD."touches",OLD."touches_box",OLD."clearances",OLD."blocks",OLD."dribbles_completed",OLD."dribbles_attempted",OLD."saves",OLD."xg",OLD."non_penalty_xg",OLD."xa",OLD."xgot",OLD."minutes_played",OLD."provider_rating",OLD."goals_prevented",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_player_revision_id",OLD."period_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_match_stats"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_match_stats"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_match_stats"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_match_stats"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."team_id",NEW."period_code",NEW."shots",NEW."shots_on_target",NEW."shots_off_target",NEW."shots_blocked",NEW."corners",NEW."offsides",NEW."fouls",NEW."yellow_cards",NEW."red_cards",NEW."passes_completed",NEW."passes_attempted",NEW."crosses_completed",NEW."crosses_attempted",NEW."tackles",NEW."interceptions",NEW."recoveries",NEW."duels_won",NEW."saves",NEW."touches_box",NEW."xg",NEW."non_penalty_xg",NEW."xgot",NEW."possession_pct",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id",NEW."period_definition_version") IS DISTINCT FROM ROW(OLD."match_id",OLD."team_id",OLD."period_code",OLD."shots",OLD."shots_on_target",OLD."shots_off_target",OLD."shots_blocked",OLD."corners",OLD."offsides",OLD."fouls",OLD."yellow_cards",OLD."red_cards",OLD."passes_completed",OLD."passes_attempted",OLD."crosses_completed",OLD."crosses_attempted",OLD."tackles",OLD."interceptions",OLD."recoveries",OLD."duels_won",OLD."saves",OLD."touches_box",OLD."xg",OLD."non_penalty_xg",OLD."xgot",OLD."possession_pct",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id",OLD."period_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_match_stats"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_match_stats"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_match_stats"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_shots"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."match_id",NEW."team_id",NEW."player_id",NEW."external_shot_id",NEW."period_code",NEW."minute",NEW."minute_added",NEW."x_m",NEW."y_m",NEW."coordinate_frame",NEW."pitch_length_m",NEW."pitch_width_m",NEW."xg",NEW."xgot",NEW."outcome",NEW."body_part",NEW."situation",NEW."is_goal",NEW."is_own_goal",NEW."is_on_target",NEW."is_inside_box",NEW."goal_crossed_y",NEW."goal_crossed_z",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."keeper_id",NEW."blocked_x",NEW."blocked_y",NEW."is_blocked",NEW."is_saved_off_line",NEW."source_shot_type",NEW."source_event_type",NEW."source_ordinal",NEW."player_profile_version_id",NEW."keeper_profile_version_id",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id",NEW."period_definition_version") IS DISTINCT FROM ROW(OLD."id",OLD."match_id",OLD."team_id",OLD."player_id",OLD."external_shot_id",OLD."period_code",OLD."minute",OLD."minute_added",OLD."x_m",OLD."y_m",OLD."coordinate_frame",OLD."pitch_length_m",OLD."pitch_width_m",OLD."xg",OLD."xgot",OLD."outcome",OLD."body_part",OLD."situation",OLD."is_goal",OLD."is_own_goal",OLD."is_on_target",OLD."is_inside_box",OLD."goal_crossed_y",OLD."goal_crossed_z",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."keeper_id",OLD."blocked_x",OLD."blocked_y",OLD."is_blocked",OLD."is_saved_off_line",OLD."source_shot_type",OLD."source_event_type",OLD."source_ordinal",OLD."player_profile_version_id",OLD."keeper_profile_version_id",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id",OLD."period_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_shots"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."shots"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_shots"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_match_advanced"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."player_id",NEW."period_code",NEW."team_id",NEW."progressive_passes",NEW."passes_into_box",NEW."key_passes",NEW."through_balls",NEW."crosses",NEW."switches",NEW."carries",NEW."progressive_carries",NEW."carries_into_final_third",NEW."carries_into_box",NEW."take_ons",NEW."take_ons_won",NEW."miscontrols",NEW."dispossessed",NEW."sca",NEW."gca",NEW."second_assists",NEW."xt_total",NEW."vaep_total",NEW."vaep_offensive",NEW."vaep_defensive",NEW."pv_total",NEW."pv_offensive",NEW."pv_defensive",NEW."progressive_pass_distance",NEW."carry_distance",NEW."progressive_carry_distance",NEW."xag",NEW."xg_chain",NEW."xg_buildup",NEW."provider_model_version",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."sca_pass_live",NEW."sca_pass_dead",NEW."sca_take_on",NEW."sca_shot",NEW."sca_foul_drawn",NEW."sca_defensive",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_player_revision_id",NEW."period_definition_version") IS DISTINCT FROM ROW(OLD."match_id",OLD."player_id",OLD."period_code",OLD."team_id",OLD."progressive_passes",OLD."passes_into_box",OLD."key_passes",OLD."through_balls",OLD."crosses",OLD."switches",OLD."carries",OLD."progressive_carries",OLD."carries_into_final_third",OLD."carries_into_box",OLD."take_ons",OLD."take_ons_won",OLD."miscontrols",OLD."dispossessed",OLD."sca",OLD."gca",OLD."second_assists",OLD."xt_total",OLD."vaep_total",OLD."vaep_offensive",OLD."vaep_defensive",OLD."pv_total",OLD."pv_offensive",OLD."pv_defensive",OLD."progressive_pass_distance",OLD."carry_distance",OLD."progressive_carry_distance",OLD."xag",OLD."xg_chain",OLD."xg_buildup",OLD."provider_model_version",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."sca_pass_live",OLD."sca_pass_dead",OLD."sca_take_on",OLD."sca_shot",OLD."sca_foul_drawn",OLD."sca_defensive",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_player_revision_id",OLD."period_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_match_advanced"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_match_advanced"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_match_advanced"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_match_advanced"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."team_id",NEW."period_code",NEW."opponent_passes",NEW."defensive_actions",NEW."high_turnovers",NEW."counterpress_regains_5s",NEW."final_third_entries",NEW."box_entries",NEW."buildup_attacks",NEW."direct_attacks",NEW."challenges",NEW."aerials",NEW."aerials_won",NEW."xt_total",NEW."vaep_total",NEW."vaep_offensive",NEW."vaep_defensive",NEW."pv_total",NEW."pv_offensive",NEW."pv_defensive",NEW."ppda",NEW."field_tilt",NEW."possession_pct",NEW."avg_action_x",NEW."avg_defensive_action_x",NEW."ball_recovery_time_seconds",NEW."passes_per_sequence",NEW."sequence_time_seconds",NEW."direct_speed",NEW."provider_model_version",NEW."coordinate_frame",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id",NEW."period_definition_version") IS DISTINCT FROM ROW(OLD."match_id",OLD."team_id",OLD."period_code",OLD."opponent_passes",OLD."defensive_actions",OLD."high_turnovers",OLD."counterpress_regains_5s",OLD."final_third_entries",OLD."box_entries",OLD."buildup_attacks",OLD."direct_attacks",OLD."challenges",OLD."aerials",OLD."aerials_won",OLD."xt_total",OLD."vaep_total",OLD."vaep_offensive",OLD."vaep_defensive",OLD."pv_total",OLD."pv_offensive",OLD."pv_defensive",OLD."ppda",OLD."field_tilt",OLD."possession_pct",OLD."avg_action_x",OLD."avg_defensive_action_x",OLD."ball_recovery_time_seconds",OLD."passes_per_sequence",OLD."sequence_time_seconds",OLD."direct_speed",OLD."provider_model_version",OLD."coordinate_frame",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id",OLD."period_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_match_advanced"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_match_advanced"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_match_advanced"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_events"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p.recorded_from_gen INTO parent_generation FROM "ingest"."match_coverage" p WHERE p."match_id" = NEW."match_id" AND p."source_id" = NEW."source_id" AND p."feature_code" = NEW."feature_code" AND p."variant_key" = NEW."variant_key" AND p."recorded_from_gen" = NEW."recorded_from_gen";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_events"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_events"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_events"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_momentum"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p.recorded_from_gen INTO parent_generation FROM "ingest"."match_coverage" p WHERE p."match_id" = NEW."match_id" AND p."source_id" = NEW."source_id" AND p."feature_code" = NEW."feature_code" AND p."variant_key" = NEW."variant_key" AND p."recorded_from_gen" = NEW."recorded_from_gen";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_momentum"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_momentum"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_momentum"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_pass_networks"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."match_id",NEW."team_id",NEW."window_kind",NEW."from_seconds",NEW."until_seconds",NEW."centralization",NEW."coordinate_frame",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."match_id",OLD."team_id",OLD."window_kind",OLD."from_seconds",OLD."until_seconds",OLD."centralization",OLD."coordinate_frame",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_pass_networks"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."pass_networks"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_pass_networks"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_pass_network_nodes"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p.recorded_from_gen INTO parent_generation FROM "football"."pass_networks" p WHERE p."id" = NEW."network_id";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_pass_network_nodes"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."pass_network_nodes"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_pass_network_nodes"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_pass_network_edges"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p.recorded_from_gen INTO parent_generation FROM "football"."pass_networks" p WHERE p."id" = NEW."network_id";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_pass_network_edges"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."pass_network_edges"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_pass_network_edges"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_heatmaps"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."match_id",NEW."team_id",NEW."player_id",NEW."period_code",NEW."map_kind",NEW."grid_columns",NEW."grid_rows",NEW."cell_length_m",NEW."cell_width_m",NEW."coordinate_frame",NEW."actions",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."cells_state",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."match_team_revision_id",NEW."period_definition_version") IS DISTINCT FROM ROW(OLD."id",OLD."match_id",OLD."team_id",OLD."player_id",OLD."period_code",OLD."map_kind",OLD."grid_columns",OLD."grid_rows",OLD."cell_length_m",OLD."cell_width_m",OLD."coordinate_frame",OLD."actions",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."cells_state",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."match_team_revision_id",OLD."period_definition_version")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_heatmaps"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_heatmaps"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_heatmaps"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_coach_tenures"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."team_id",NEW."coach_id",NEW."role",NEW."valid_from",NEW."valid_to",NEW."date_precision",NEW."observed_at",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."coach_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."team_id",OLD."coach_id",OLD."role",OLD."valid_from",OLD."valid_to",OLD."date_precision",OLD."observed_at",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."coach_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_coach_tenures"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_coach_tenures"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_coach_tenures"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_honour_definitions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."code",NEW."name",NEW."honour_type",NEW."competition_id",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind",NEW."competition_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."code",OLD."name",OLD."honour_type",OLD."competition_id",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind",OLD."competition_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_honour_definitions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."honour_definitions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_honour_definitions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_honours"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."player_id",NEW."honour_id",NEW."competition_season_id",NEW."season_label",NEW."edition_key",NEW."outcome",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."team_id",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."honour_revision_id",NEW."competition_season_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."player_id",OLD."honour_id",OLD."competition_season_id",OLD."season_label",OLD."edition_key",OLD."outcome",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."team_id",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."honour_revision_id",OLD."competition_season_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_honours"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_honours"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_honours"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_honours"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."team_id",NEW."honour_id",NEW."competition_season_id",NEW."season_label",NEW."edition_key",NEW."outcome",NEW."source_id",NEW."source_record_id",NEW."canonical_policy_version",NEW."data_revision",NEW."quality_flags",NEW."updated_at",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."provenance_kind",NEW."honour_revision_id",NEW."competition_season_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."team_id",OLD."honour_id",OLD."competition_season_id",OLD."season_label",OLD."edition_key",OLD."outcome",OLD."source_id",OLD."source_record_id",OLD."canonical_policy_version",OLD."data_revision",OLD."quality_flags",OLD."updated_at",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."provenance_kind",OLD."honour_revision_id",OLD."competition_season_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_honours"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_honours"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_honours"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_standing_snapshots"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    PERFORM ingest.assert_draft_generation(NEW.recorded_from_gen);
    IF EXISTS (SELECT 1 FROM "football"."standing_snapshots" prior WHERE prior."source_record_id" IS NOT DISTINCT FROM NEW."source_record_id" AND prior."competition_season_id" IS NOT DISTINCT FROM NEW."competition_season_id" AND prior."stage_id" IS NOT DISTINCT FROM NEW."stage_id" AND prior."group_id" IS NOT DISTINCT FROM NEW."group_id" AND prior."group_label" IS NOT DISTINCT FROM NEW."group_label" AND prior."scope" IS NOT DISTINCT FROM NEW."scope" AND (prior.recorded_from_gen >= NEW.recorded_from_gen OR prior."data_revision" >= NEW."data_revision")) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Same-grain corrections require strictly increasing revision and generation';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_standing_snapshots"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."standing_snapshots"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_standing_snapshots"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_standing_rows"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p0."recorded_from_gen" INTO parent_generation FROM "football"."standing_snapshots" p0 WHERE p0."id" = NEW."snapshot_id";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact append-only parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_standing_rows"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."standing_rows"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_standing_rows"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_ranking_systems"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    PERFORM ingest.assert_draft_generation(NEW.recorded_from_gen);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_ranking_systems"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."ranking_systems"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_ranking_systems"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_ranking_snapshots"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    PERFORM ingest.assert_draft_generation(NEW.recorded_from_gen);
    IF EXISTS (SELECT 1 FROM "football"."ranking_snapshots" prior WHERE prior."system_id" IS NOT DISTINCT FROM NEW."system_id" AND prior."edition_key" IS NOT DISTINCT FROM NEW."edition_key" AND (prior.recorded_from_gen >= NEW.recorded_from_gen OR prior."revision" >= NEW."revision")) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Same-grain corrections require strictly increasing revision and generation';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_ranking_snapshots"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."ranking_snapshots"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_ranking_snapshots"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_ranking_entries"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p0."recorded_from_gen" INTO parent_generation FROM "football"."ranking_snapshots" p0 WHERE p0."id" = NEW."snapshot_id" AND p0."subject_kind" = NEW."subject_kind";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact append-only parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_ranking_entries"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_ranking_entries"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_ranking_entries"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_ranking_components"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p1."recorded_from_gen" INTO parent_generation FROM "football"."team_ranking_entries" p0 JOIN "football"."ranking_snapshots" p1 ON p1."id" = p0."snapshot_id" AND p1."subject_kind" = p0."subject_kind" WHERE p0."snapshot_id" = NEW."snapshot_id" AND p0."team_id" = NEW."team_id";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact append-only parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_ranking_components"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_ranking_components"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_ranking_components"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_association_ranking_entries"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p0."recorded_from_gen" INTO parent_generation FROM "football"."ranking_snapshots" p0 WHERE p0."id" = NEW."snapshot_id" AND p0."subject_kind" = NEW."subject_kind";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact append-only parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_association_ranking_entries"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."association_ranking_entries"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_association_ranking_entries"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_association_ranking_components"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p1."recorded_from_gen" INTO parent_generation FROM "football"."association_ranking_entries" p0 JOIN "football"."ranking_snapshots" p1 ON p1."id" = p0."snapshot_id" AND p1."subject_kind" = p0."subject_kind" WHERE p0."snapshot_id" = NEW."snapshot_id" AND p0."association_id" = NEW."association_id";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact append-only parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_association_ranking_components"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."association_ranking_components"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_association_ranking_components"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_player_match_metric_values"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."player_id",NEW."team_id",NEW."period_code",NEW."family_code",NEW."metric_code",NEW."value_kind",NEW."numeric_value",NEW."text_value",NEW."boolean_value",NEW."numerator",NEW."denominator",NEW."source_display",NEW."source_record_id",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."provenance_kind",NEW."metric_definition_version",NEW."period_definition_version",NEW."match_player_revision_id") IS DISTINCT FROM ROW(OLD."match_id",OLD."player_id",OLD."team_id",OLD."period_code",OLD."family_code",OLD."metric_code",OLD."value_kind",OLD."numeric_value",OLD."text_value",OLD."boolean_value",OLD."numerator",OLD."denominator",OLD."source_display",OLD."source_record_id",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."provenance_kind",OLD."metric_definition_version",OLD."period_definition_version",OLD."match_player_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_player_match_metric_values"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."player_match_metric_values"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_player_match_metric_values"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_match_metric_values"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."match_id",NEW."team_id",NEW."period_code",NEW."family_code",NEW."metric_code",NEW."value_kind",NEW."numeric_value",NEW."text_value",NEW."boolean_value",NEW."numerator",NEW."denominator",NEW."source_display",NEW."source_record_id",NEW."revision_id",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."provenance_kind",NEW."metric_definition_version",NEW."period_definition_version",NEW."match_team_revision_id") IS DISTINCT FROM ROW(OLD."match_id",OLD."team_id",OLD."period_code",OLD."family_code",OLD."metric_code",OLD."value_kind",OLD."numeric_value",OLD."text_value",OLD."boolean_value",OLD."numerator",OLD."denominator",OLD."source_display",OLD."source_record_id",OLD."revision_id",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."provenance_kind",OLD."metric_definition_version",OLD."period_definition_version",OLD."match_team_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_match_metric_values"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_match_metric_values"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_match_metric_values"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_heatmap_cells"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p.recorded_from_gen INTO parent_generation FROM "football"."match_heatmaps" p WHERE p."id" = NEW."heatmap_id";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_heatmap_cells"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_heatmap_cells"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_heatmap_cells"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_h2h_entries"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    SELECT p.recorded_from_gen INTO parent_generation FROM "ingest"."match_coverage" p WHERE p."match_id" = NEW."match_id" AND p."source_id" = NEW."source_id" AND p."feature_code" = NEW."feature_code" AND p."variant_key" = NEW."variant_key" AND p."recorded_from_gen" = NEW."recorded_from_gen";
    IF parent_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact typed collection parent'; END IF;
    PERFORM ingest.assert_draft_generation(parent_generation);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_h2h_entries"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_h2h_entries"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_h2h_entries"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_match_observation_details"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_generation bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed observations and collection children are immutable';
    END IF;
    PERFORM ingest.assert_draft_generation(NEW.recorded_from_gen);
    IF EXISTS (SELECT 1 FROM "football"."match_observation_details" prior WHERE prior."source_record_id" IS NOT DISTINCT FROM NEW."source_record_id" AND (prior.recorded_from_gen >= NEW.recorded_from_gen OR prior."recorded_from_gen" >= NEW."recorded_from_gen")) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Same-grain corrections require strictly increasing revision and generation';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_match_observation_details"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."match_observation_details"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_match_observation_details"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_team_profile_versions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."team_id",NEW."source_record_id",NEW."observed_at",NEW."display_name",NEW."short_name",NEW."official_name",NEW."international_name",NEW."country_code_source",NEW."team_code_source",NEW."image_asset_id",NEW."association_id",NEW."valid_from",NEW."valid_to",NEW."from_year",NEW."to_year",NEW."from_phases",NEW."to_phases",NEW."inherit_team_external_id",NEW."is_placeholder",NEW."is_national",NEW."slug",NEW."team_type",NEW."gender",NEW."age_category",NEW."country_id",NEW."founded_year",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."profile_context",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."provenance_kind",NEW."country_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."team_id",OLD."source_record_id",OLD."observed_at",OLD."display_name",OLD."short_name",OLD."official_name",OLD."international_name",OLD."country_code_source",OLD."team_code_source",OLD."image_asset_id",OLD."association_id",OLD."valid_from",OLD."valid_to",OLD."from_year",OLD."to_year",OLD."from_phases",OLD."to_phases",OLD."inherit_team_external_id",OLD."is_placeholder",OLD."is_national",OLD."slug",OLD."team_type",OLD."gender",OLD."age_category",OLD."country_id",OLD."founded_year",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."profile_context",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."provenance_kind",OLD."country_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_team_profile_versions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."team_profile_versions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_team_profile_versions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_football_association_profile_versions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."recorded_from_gen");
        IF NEW."recorded_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."id",NEW."association_id",NEW."source_record_id",NEW."observed_at",NEW."display_name",NEW."short_name",NEW."official_name",NEW."international_name",NEW."country_code_source",NEW."team_code_source",NEW."image_asset_id",NEW."valid_from",NEW."valid_to",NEW."from_year",NEW."to_year",NEW."from_phases",NEW."to_phases",NEW."inherit_team_external_id",NEW."is_placeholder",NEW."is_national",NEW."federation_code",NEW."country_id",NEW."confederation_code",NEW."recorded_from_gen",NEW."variant_key",NEW."is_canonical",NEW."is_deleted",NEW."profile_context",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."provenance_kind",NEW."country_revision_id") IS DISTINCT FROM ROW(OLD."id",OLD."association_id",OLD."source_record_id",OLD."observed_at",OLD."display_name",OLD."short_name",OLD."official_name",OLD."international_name",OLD."country_code_source",OLD."team_code_source",OLD."image_asset_id",OLD."valid_from",OLD."valid_to",OLD."from_year",OLD."to_year",OLD."from_phases",OLD."to_phases",OLD."inherit_team_external_id",OLD."is_placeholder",OLD."is_national",OLD."federation_code",OLD."country_id",OLD."confederation_code",OLD."recorded_from_gen",OLD."variant_key",OLD."is_canonical",OLD."is_deleted",OLD."profile_context",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."provenance_kind",OLD."country_revision_id")
           OR OLD."recorded_to_gen" IS NOT NULL OR NEW."recorded_to_gen" IS NULL
           OR NEW."recorded_to_gen" <= OLD."recorded_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."recorded_to_gen");
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_football_association_profile_versions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "football"."association_profile_versions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_football_association_profile_versions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_publication_versions"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Retained typed versions cannot be deleted';
    ELSIF TG_OP='INSERT' THEN
        PERFORM ingest.assert_draft_generation(NEW."published_from_gen");
        IF NEW."published_to_gen" IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A new typed version must have an open interval';
        END IF;
    ELSE
        IF ROW(NEW."competition_season_id",NEW."build_id",NEW."published_at",NEW."catalog_snapshot_id",NEW."representation_version",NEW."published_from_gen",NEW."relation_code",NEW."contract_version",NEW."transform_version",NEW."transform_code_sha256",NEW."source_id",NEW."source_record_id",NEW."provenance_kind") IS DISTINCT FROM ROW(OLD."competition_season_id",OLD."build_id",OLD."published_at",OLD."catalog_snapshot_id",OLD."representation_version",OLD."published_from_gen",OLD."relation_code",OLD."contract_version",OLD."transform_version",OLD."transform_code_sha256",OLD."source_id",OLD."source_record_id",OLD."provenance_kind")
           OR OLD."published_to_gen" IS NOT NULL OR NEW."published_to_gen" IS NULL
           OR NEW."published_to_gen" <= OLD."published_from_gen" THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Typed values are immutable; an open interval closes once';
        END IF;
        PERFORM ingest.assert_draft_generation(NEW."published_to_gen");
    END IF;
    IF TG_OP='INSERT' AND NOT EXISTS (
        SELECT 1 FROM analytics.aggregation_builds b JOIN ingest.dataset_snapshots s ON s.id=b.dataset_snapshot_id
        JOIN ingest.dataset_snapshots c ON c.id=b.catalog_snapshot_id
        WHERE b.id=NEW.build_id AND b.competition_season_id=NEW.competition_season_id AND b.status='ready'
          AND s.status='sealed' AND c.status='sealed' AND b.catalog_snapshot_id=NEW.catalog_snapshot_id
          AND b.representation_version=NEW.representation_version
    ) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Publication requires its ready build, edition, sealed catalogue and representation';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_publication_versions"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."publication_versions"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_publication_versions"();

CREATE OR REPLACE FUNCTION "ingest"."pro_graph_lock"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_graph_lock"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."pro_graph_commit"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
IF EXISTS (WITH RECURSIVE nodes AS (SELECT s.id AS id,s.upstream_source_id AS parent FROM "ingest"."sources" s WHERE TRUE),
      walk(root,node,path) AS (
        SELECT id,parent,ARRAY[id] FROM nodes WHERE parent IS NOT NULL
        UNION ALL SELECT w.root,n.parent,w.path||n.id FROM walk w JOIN nodes n ON n.id=w.node
          WHERE w.node IS NOT NULL AND NOT w.node=ANY(w.path)
      ) SELECT 1 FROM walk WHERE node=ANY(path)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Acyclic provenance required: ingest.sources'; END IF;
IF EXISTS (WITH RECURSIVE nodes AS (SELECT s.derived_document_id AS id,s.parent_document_id AS parent FROM "ingest"."document_lineage" s WHERE TRUE),
      walk(root,node,path) AS (
        SELECT id,parent,ARRAY[id] FROM nodes WHERE parent IS NOT NULL
        UNION ALL SELECT w.root,n.parent,w.path||n.id FROM walk w JOIN nodes n ON n.id=w.node
          WHERE w.node IS NOT NULL AND NOT w.node=ANY(w.path)
      ) SELECT 1 FROM walk WHERE node=ANY(path)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Acyclic provenance required: ingest.document_lineage'; END IF;
    RETURN NULL;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_graph_commit"() FROM PUBLIC;

CREATE TRIGGER "pro_graph_lock" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."sources"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_graph_lock"();

CREATE CONSTRAINT TRIGGER "pro_graph_commit" AFTER INSERT OR UPDATE OR DELETE ON "ingest"."sources" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_graph_commit"();

CREATE TRIGGER "pro_graph_lock" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."document_lineage"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_graph_lock"();

CREATE CONSTRAINT TRIGGER "pro_graph_commit" AFTER INSERT OR UPDATE OR DELETE ON "ingest"."document_lineage" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_graph_commit"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_source_documents"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Source receipt metadata cannot be deleted';
    END IF;
    IF ROW(NEW."id",NEW."dataset_id",NEW."source_id",NEW."storage_provider",NEW."storage_bucket",NEW."storage_key",NEW."storage_version",NEW."content_sha256",NEW."byte_length",NEW."content_type",NEW."encoding",NEW."retrieved_at",NEW."source_updated_at",NEW."source_published_at",NEW."source_url",NEW."legacy_object_path",NEW."import_run_id",NEW."origin_kind",NEW."request_fingerprint") IS DISTINCT FROM ROW(OLD."id",OLD."dataset_id",OLD."source_id",OLD."storage_provider",OLD."storage_bucket",OLD."storage_key",OLD."storage_version",OLD."content_sha256",OLD."byte_length",OLD."content_type",OLD."encoding",OLD."retrieved_at",OLD."source_updated_at",OLD."source_published_at",OLD."source_url",OLD."legacy_object_path",OLD."import_run_id",OLD."origin_kind",OLD."request_fingerprint") THEN
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
          AND d.semantic_sha256 ~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Legacy retention requires its accepted document reconciliation audit';
    END IF;
    IF NEW.retention_state='deleted' AND NOT EXISTS (
        SELECT 1 FROM ingest.cleanup_items c JOIN ingest.document_reconciliations d
          ON d.run_id=c.reconciliation_run_id AND d.document_id=c.document_id
        JOIN ingest.reconciliation_runs r ON r.id=c.reconciliation_run_id
        WHERE c.document_id=OLD.id AND r.status='accepted' AND r.finished_at IS NOT NULL
          AND r.missing_records=0 AND r.different_fields=0 AND r.unverified_records=0
          AND d.status='accepted' AND d.records_expected=d.records_linked AND d.unmapped_fields=0 AND d.mismatches=0
          AND d.semantic_sha256 ~ '^[0-9a-f]{64}$' AND c.status IN ('deleted','verified')
          AND c.deleted_at=NEW.deleted_at AND c.verified_at IS NOT NULL AND c.verified_at>=c.deleted_at
          AND c.storage_version IS NOT DISTINCT FROM OLD.storage_version
          AND (OLD.byte_length IS NULL OR c.bytes_before=OLD.byte_length) AND btrim(c.reason)<>''
    ) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A deleted legacy receipt requires its verified cleanup audit';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_source_documents"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE UPDATE OR DELETE ON "ingest"."source_documents"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_source_documents"();

CREATE OR REPLACE FUNCTION "ingest"."validate_aggregation_build"(build_key bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE b analytics.aggregation_builds%ROWTYPE; g bigint;
BEGIN
    SELECT * INTO b FROM analytics.aggregation_builds WHERE id=build_key FOR UPDATE;
    IF b.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown typed aggregation build'; END IF;
    SELECT generation INTO g FROM ingest.dataset_snapshots WHERE id=b.dataset_snapshot_id AND status='sealed';
    IF g IS NULL OR NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots WHERE id=b.catalog_snapshot_id AND status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Aggregation requires sealed dataset and catalogue snapshots';
    END IF;
IF EXISTS (SELECT 1 FROM analytics.match_summary q
      LEFT JOIN football.matches m ON m.id=q.match_id AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted"
      LEFT JOIN football.match_teams h ON h.match_id=m.id AND h.side='home' AND ingest.selected_at(g,h."recorded_from_gen",h."recorded_to_gen") AND h."is_canonical" AND NOT h."is_deleted"
      LEFT JOIN football.match_teams a ON a.match_id=m.id AND a.side='away' AND ingest.selected_at(g,a."recorded_from_gen",a."recorded_to_gen") AND a."is_canonical" AND NOT a."is_deleted"
      WHERE q.build_id=b.id AND (m.id IS NULL OR m.competition_season_id<>b.competition_season_id OR m.publication_state<>'published'
        OR q.competition_season_id<>b.competition_season_id OR q.status IS DISTINCT FROM m.status
        OR q.match_date IS DISTINCT FROM m.match_date OR q.kickoff_at IS DISTINCT FROM m.kickoff_at
        OR q.home_team_id IS DISTINCT FROM h.team_id OR q.away_team_id IS DISTINCT FROM a.team_id
        OR q.home_label IS DISTINCT FROM h.participant_label OR q.away_label IS DISTINCT FROM a.participant_label)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build match summaries must match selected edition, status and participants at its dataset snapshot'; END IF;
IF EXISTS (SELECT 1 FROM football.matches m WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND NOT EXISTS
                (SELECT 1 FROM analytics.match_summary q WHERE q.build_id=b.id AND q.match_id=m.id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A ready build must cover every selected published match in its edition'; END IF;
IF EXISTS (SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM analytics.competition_summary q WHERE q.build_id=b.id AND q.competition_season_id=b.competition_season_id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A ready build requires its edition summary'; END IF;
IF EXISTS (SELECT 1 FROM analytics.match_summary q WHERE q.build_id=b.id AND (
          q.home_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='home' AND s.score_scope=q.score_scope AND ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND s."is_canonical" AND NOT s."is_deleted") OR
          q.away_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='away' AND s.score_scope=q.score_scope AND ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND s."is_canonical" AND NOT s."is_deleted") OR
          q.home_shootout_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='home' AND s.score_scope='shootout' AND ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND s."is_canonical" AND NOT s."is_deleted") OR
          q.away_shootout_goals IS DISTINCT FROM (SELECT s.goals FROM football.match_scores s WHERE s.match_id=q.match_id AND s.side='away' AND s.score_scope='shootout' AND ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND s."is_canonical" AND NOT s."is_deleted")
        )) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build scores must match selected typed scores at its dataset snapshot'; END IF;
IF EXISTS (SELECT 1 FROM football.match_teams t JOIN football.matches m ON m.id=t.match_id
      WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted" AND t.team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM football.competition_teams engagement WHERE engagement.competition_season_id=b.competition_season_id
          AND engagement.team_id=t.team_id AND ingest.selected_at(g,engagement."recorded_from_gen",engagement."recorded_to_gen") AND engagement."is_canonical" AND NOT engagement."is_deleted")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A ready build requires each selected participant''s explicit edition engagement'; END IF;
IF EXISTS (SELECT 1 FROM analytics.competition_summary q WHERE q.build_id=b.id AND (
        (q.matches_count IS NOT NULL AND q.matches_count<>(SELECT count(*) FROM football.matches m WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted")) OR
        (q.finished_matches_count IS NOT NULL AND q.finished_matches_count<>(SELECT count(*) FROM football.matches m WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND m.status='finished')) OR
        (q.teams_count IS NOT NULL AND q.teams_count<>(SELECT count(*) FROM football.competition_teams engagement WHERE engagement.competition_season_id=b.competition_season_id AND ingest.selected_at(g,engagement."recorded_from_gen",engagement."recorded_to_gen") AND engagement."is_canonical" AND NOT engagement."is_deleted")) OR
        (q.players_count IS NOT NULL AND q.players_count<>(SELECT count(DISTINCT p.player_id) FROM football.match_players p JOIN football.matches m ON m.id=p.match_id WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND ingest.selected_at(g,p."recorded_from_gen",p."recorded_to_gen") AND p."is_canonical" AND NOT p."is_deleted"))
    )) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build summary counters must match the selected edition inputs'; END IF;
IF EXISTS (SELECT 1 FROM "analytics"."player_competition_team_stats" q WHERE q.build_id=b.id AND (q.competition_season_id<>b.competition_season_id OR NOT EXISTS (SELECT 1 FROM football.match_players p JOIN football.matches m ON m.id=p.match_id WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND ingest.selected_at(g,p."recorded_from_gen",p."recorded_to_gen") AND p."is_canonical" AND NOT p."is_deleted" AND p.player_id=q.player_id AND p.team_id=q.team_id))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build output membership must match its edition snapshot: analytics.player_competition_team_stats'; END IF;
IF EXISTS (SELECT 1 FROM "analytics"."player_competition_stats" q WHERE q.build_id=b.id AND (q.competition_season_id<>b.competition_season_id OR NOT EXISTS (SELECT 1 FROM football.match_players p JOIN football.matches m ON m.id=p.match_id WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND ingest.selected_at(g,p."recorded_from_gen",p."recorded_to_gen") AND p."is_canonical" AND NOT p."is_deleted" AND p.player_id=q.player_id))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build output membership must match its edition snapshot: analytics.player_competition_stats'; END IF;
IF EXISTS (SELECT 1 FROM "analytics"."team_competition_stats" q WHERE q.build_id=b.id AND (q.competition_season_id<>b.competition_season_id OR NOT EXISTS (SELECT 1 FROM football.match_teams t JOIN football.matches m ON m.id=t.match_id WHERE m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted" AND t.team_id=q.team_id))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Build output membership must match its edition snapshot: analytics.team_competition_stats'; END IF;
IF EXISTS (SELECT 1 FROM analytics.metric_totals q WHERE q.build_id=b.id AND q.match_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM football.matches m WHERE m.id=q.match_id AND m.competition_season_id=b.competition_season_id AND m.publication_state='published' AND ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Metric totals cannot reference a match outside their build snapshot'; END IF;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."validate_aggregation_build"(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_aggregation_builds"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN
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
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_aggregation_builds"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."aggregation_builds"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_aggregation_builds"();

CREATE OR REPLACE FUNCTION "ingest"."pro_validate_ready_build"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF NEW.status='ready' THEN
        IF NEW.finished_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A ready build requires its completion timestamp'; END IF;
        PERFORM ingest.validate_aggregation_build(NEW.id);
    END IF;
    RETURN NULL;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_validate_ready_build"() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER "pro_ready_build" AFTER INSERT OR UPDATE ON "analytics"."aggregation_builds" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_validate_ready_build"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_match_summary"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_status text;
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_match_summary"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."match_summary"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_match_summary"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_player_competition_team_stats"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_status text;
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_player_competition_team_stats"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."player_competition_team_stats"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_player_competition_team_stats"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_player_competition_stats"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_status text;
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_player_competition_stats"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."player_competition_stats"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_player_competition_stats"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_team_competition_stats"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_status text;
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_team_competition_stats"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."team_competition_stats"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_team_competition_stats"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_competition_summary"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_status text;
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_competition_summary"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."competition_summary"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_competition_summary"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_analytics_metric_totals"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE parent_status text;
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_analytics_metric_totals"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."metric_totals"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_analytics_metric_totals"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_catalog_publication"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF btrim(NEW.representation_version)='' OR NOT EXISTS
      (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.id=NEW.catalog_snapshot_id AND s.status='sealed') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A catalogue publication requires a sealed snapshot and representation';
    END IF;
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_catalog_publication"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "analytics"."catalog_publication"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_catalog_publication"();

CREATE OR REPLACE FUNCTION "ingest"."pro_guard_snapshot_documents"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
DECLARE g bigint;
BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Snapshot document inputs are immutable'; END IF;
    SELECT generation INTO g FROM ingest.dataset_snapshots WHERE id=NEW.snapshot_id;
    IF g IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Missing exact dataset snapshot'; END IF;
    PERFORM ingest.assert_draft_generation(g);
    RETURN NEW;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."pro_guard_snapshot_documents"() FROM PUBLIC;

CREATE TRIGGER "pro_typed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ingest"."dataset_snapshot_documents"
FOR EACH ROW EXECUTE FUNCTION "ingest"."pro_guard_snapshot_documents"();

CREATE OR REPLACE FUNCTION "ingest"."claim_collection_job"(worker text, lease_seconds integer) RETURNS SETOF ingest.collection_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
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
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."claim_collection_job"(text, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."complete_collection_job"(source_key bigint, endpoint_key text, params_key text, worker text, target_state text, claimed_attempt integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    IF target_state IS NULL OR target_state NOT IN ('pending','done','unavailable') OR claimed_attempt IS NULL OR claimed_attempt<=0 THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A queue completion requires its target state and claimed attempt';
    END IF;
    UPDATE ingest.collection_jobs job SET state=target_state,lease_owner=NULL,lease_expires_at=NULL
      WHERE job.source_id=source_key AND job.endpoint=endpoint_key AND job.params=params_key
        AND job.state='running' AND job.lease_owner=worker AND job.attempts=claimed_attempt
        AND job.lease_expires_at>statement_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Queue lease ownership, attempt or expiry no longer matches'; END IF;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."complete_collection_job"(bigint, text, text, text, text, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION "ingest"."validate_generation"(g bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog 
AS $orion_pro$
BEGIN
    PERFORM pg_advisory_xact_lock(20261104,1);
    IF NOT EXISTS (SELECT 1 FROM ingest.dataset_snapshots s WHERE s.generation=g AND s.status IN ('draft','sealed') AND s.xmin::text=((pg_current_xact_id()::text::numeric % 4294967296)::text)) THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Validation requires this transaction generation receipt';
    END IF;
IF EXISTS (SELECT 1 FROM "ingest"."match_coverage" a JOIN "ingest"."match_coverage" b ON a."match_id" = b."match_id" AND a."source_id" = b."source_id" AND a."feature_code" = b."feature_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."match_id",a."source_id",a."feature_code",a."variant_key",a."recorded_from_gen") < ROW(b."match_id",b."source_id",b."feature_code",b."variant_key",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: ingest.match_coverage / ingest_match_coverage_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."match_coverage" a JOIN "ingest"."match_coverage" b ON a."match_id" = b."match_id" AND a."feature_code" = b."feature_code" WHERE ROW(a."match_id",a."source_id",a."feature_code",a."variant_key",a."recorded_from_gen") < ROW(b."match_id",b."source_id",b."feature_code",b."variant_key",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: ingest.match_coverage / ingest_match_coverage_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."match_coverage" fresh JOIN "ingest"."match_coverage" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."feature_code" IS NOT DISTINCT FROM old."feature_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."source_id",old."feature_code",old."coverage_state",old."http_status",old."error_code",old."observed_row_count",old."document_id",old."is_stale",old."variant_key",old."is_canonical",old."collection_state",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_record_id",old."provenance_kind",old."match_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."source_id",fresh."feature_code",fresh."coverage_state",fresh."http_status",fresh."error_code",fresh."observed_row_count",fresh."document_id",fresh."is_stale",fresh."variant_key",fresh."is_canonical",fresh."collection_state",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_record_id",fresh."provenance_kind",fresh."match_revision_id") AND NOT EXISTS ((SELECT "event_seq","event_type","period_code","minute","minute_added","second","team_id","player_id","related_player_id","is_penalty","is_own_goal","source_event_id","source_ordinal","source_record_id","canonical_policy_version","quality_flags","score_home","score_away","match_revision_id","match_team_revision_id","period_definition_version" FROM "football"."match_events" WHERE "match_id" = old."match_id" AND "source_id" = old."source_id" AND "feature_code" = old."feature_code" AND "variant_key" = old."variant_key" AND "recorded_from_gen" = old."recorded_from_gen" EXCEPT SELECT "event_seq","event_type","period_code","minute","minute_added","second","team_id","player_id","related_player_id","is_penalty","is_own_goal","source_event_id","source_ordinal","source_record_id","canonical_policy_version","quality_flags","score_home","score_away","match_revision_id","match_team_revision_id","period_definition_version" FROM "football"."match_events" WHERE "match_id" = fresh."match_id" AND "source_id" = fresh."source_id" AND "feature_code" = fresh."feature_code" AND "variant_key" = fresh."variant_key" AND "recorded_from_gen" = fresh."recorded_from_gen") UNION ALL (SELECT "event_seq","event_type","period_code","minute","minute_added","second","team_id","player_id","related_player_id","is_penalty","is_own_goal","source_event_id","source_ordinal","source_record_id","canonical_policy_version","quality_flags","score_home","score_away","match_revision_id","match_team_revision_id","period_definition_version" FROM "football"."match_events" WHERE "match_id" = fresh."match_id" AND "source_id" = fresh."source_id" AND "feature_code" = fresh."feature_code" AND "variant_key" = fresh."variant_key" AND "recorded_from_gen" = fresh."recorded_from_gen" EXCEPT SELECT "event_seq","event_type","period_code","minute","minute_added","second","team_id","player_id","related_player_id","is_penalty","is_own_goal","source_event_id","source_ordinal","source_record_id","canonical_policy_version","quality_flags","score_home","score_away","match_revision_id","match_team_revision_id","period_definition_version" FROM "football"."match_events" WHERE "match_id" = old."match_id" AND "source_id" = old."source_id" AND "feature_code" = old."feature_code" AND "variant_key" = old."variant_key" AND "recorded_from_gen" = old."recorded_from_gen")) AND NOT EXISTS ((SELECT "series_code","sample_index","minute","period_code","value","source_record_id","canonical_policy_version","quality_flags","match_revision_id","period_definition_version" FROM "football"."match_momentum" WHERE "match_id" = old."match_id" AND "source_id" = old."source_id" AND "feature_code" = old."feature_code" AND "variant_key" = old."variant_key" AND "recorded_from_gen" = old."recorded_from_gen" EXCEPT SELECT "series_code","sample_index","minute","period_code","value","source_record_id","canonical_policy_version","quality_flags","match_revision_id","period_definition_version" FROM "football"."match_momentum" WHERE "match_id" = fresh."match_id" AND "source_id" = fresh."source_id" AND "feature_code" = fresh."feature_code" AND "variant_key" = fresh."variant_key" AND "recorded_from_gen" = fresh."recorded_from_gen") UNION ALL (SELECT "series_code","sample_index","minute","period_code","value","source_record_id","canonical_policy_version","quality_flags","match_revision_id","period_definition_version" FROM "football"."match_momentum" WHERE "match_id" = fresh."match_id" AND "source_id" = fresh."source_id" AND "feature_code" = fresh."feature_code" AND "variant_key" = fresh."variant_key" AND "recorded_from_gen" = fresh."recorded_from_gen" EXCEPT SELECT "series_code","sample_index","minute","period_code","value","source_record_id","canonical_policy_version","quality_flags","match_revision_id","period_definition_version" FROM "football"."match_momentum" WHERE "match_id" = old."match_id" AND "source_id" = old."source_id" AND "feature_code" = old."feature_code" AND "variant_key" = old."variant_key" AND "recorded_from_gen" = old."recorded_from_gen")) AND NOT EXISTS ((SELECT "entry_ordinal","previous_match_id","external_match_id","match_date","time_utc_source","status_source","home_team_id","away_team_id","home_label","away_label","home_score","away_score","source_record_id","home_image_asset_id","away_image_asset_id","match_revision_id","previous_match_revision_id" FROM "football"."match_h2h_entries" WHERE "match_id" = old."match_id" AND "source_id" = old."source_id" AND "feature_code" = old."feature_code" AND "variant_key" = old."variant_key" AND "recorded_from_gen" = old."recorded_from_gen" EXCEPT SELECT "entry_ordinal","previous_match_id","external_match_id","match_date","time_utc_source","status_source","home_team_id","away_team_id","home_label","away_label","home_score","away_score","source_record_id","home_image_asset_id","away_image_asset_id","match_revision_id","previous_match_revision_id" FROM "football"."match_h2h_entries" WHERE "match_id" = fresh."match_id" AND "source_id" = fresh."source_id" AND "feature_code" = fresh."feature_code" AND "variant_key" = fresh."variant_key" AND "recorded_from_gen" = fresh."recorded_from_gen") UNION ALL (SELECT "entry_ordinal","previous_match_id","external_match_id","match_date","time_utc_source","status_source","home_team_id","away_team_id","home_label","away_label","home_score","away_score","source_record_id","home_image_asset_id","away_image_asset_id","match_revision_id","previous_match_revision_id" FROM "football"."match_h2h_entries" WHERE "match_id" = fresh."match_id" AND "source_id" = fresh."source_id" AND "feature_code" = fresh."feature_code" AND "variant_key" = fresh."variant_key" AND "recorded_from_gen" = fresh."recorded_from_gen" EXCEPT SELECT "entry_ordinal","previous_match_id","external_match_id","match_date","time_utc_source","status_source","home_team_id","away_team_id","home_label","away_label","home_score","away_score","source_record_id","home_image_asset_id","away_image_asset_id","match_revision_id","previous_match_revision_id" FROM "football"."match_h2h_entries" WHERE "match_id" = old."match_id" AND "source_id" = old."source_id" AND "feature_code" = old."feature_code" AND "variant_key" = old."variant_key" AND "recorded_from_gen" = old."recorded_from_gen"))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: ingest.match_coverage'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."public_aliases" a JOIN "ingest"."public_aliases" b ON a."route_kind" = b."route_kind" AND a."public_key" = b."public_key" WHERE ROW(a."route_kind",a."public_key",a."recorded_from_gen") < ROW(b."route_kind",b."public_key",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: ingest.public_aliases / ingest_public_aliases_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."public_aliases" fresh JOIN "ingest"."public_aliases" old ON fresh."route_kind" IS NOT DISTINCT FROM old."route_kind" AND fresh."public_key" IS NOT DISTINCT FROM old."public_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."route_kind",old."public_key",old."player_id",old."team_id",old."competition_id",old."match_id",old."association_id",old."venue_id",old."coach_id",old."profile_version_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."competition_revision_id",old."match_revision_id",old."venue_revision_id",old."coach_revision_id") IS NOT DISTINCT FROM ROW(fresh."route_kind",fresh."public_key",fresh."player_id",fresh."team_id",fresh."competition_id",fresh."match_id",fresh."association_id",fresh."venue_id",fresh."coach_id",fresh."profile_version_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."competition_revision_id",fresh."match_revision_id",fresh."venue_revision_id",fresh."coach_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: ingest.public_aliases'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" a JOIN "football"."countries" b ON a."iso2" = b."iso2" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.countries / football_countries_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" a JOIN "football"."countries" b ON a."iso2" = b."iso2" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.countries / football_countries_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" a JOIN "football"."countries" b ON a."iso3" = b."iso3" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.countries / football_countries_sv_natural_1_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" a JOIN "football"."countries" b ON a."iso3" = b."iso3" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.countries / football_countries_sv_natural_1_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" a JOIN "football"."countries" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.countries / football_countries_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" a JOIN "football"."countries" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.countries / football_countries_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."countries" fresh JOIN "football"."countries" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."name",old."iso2",old."iso3",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."id",fresh."name",fresh."iso2",fresh."iso3",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.countries'; END IF;
IF EXISTS (SELECT 1 FROM "football"."positions" a JOIN "football"."positions" b ON a."code" = b."code" WHERE ROW(a."code",a."definition_version") < ROW(b."code",b."definition_version") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.positions / football_positions_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."positions" fresh JOIN "football"."positions" old ON fresh."code" IS NOT DISTINCT FROM old."code" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."code",old."label",old."family",old."definition",old."definition_version",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."code",fresh."label",fresh."family",fresh."definition",fresh."definition_version",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.positions'; END IF;
IF EXISTS (SELECT 1 FROM "football"."periods" a JOIN "football"."periods" b ON a."code" = b."code" WHERE ROW(a."code",a."definition_version") < ROW(b."code",b."definition_version") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.periods / football_periods_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."periods" fresh JOIN "football"."periods" old ON fresh."code" IS NOT DISTINCT FROM old."code" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."code",old."label",old."sequence_no",old."is_aggregate",old."definition",old."definition_version",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."code",fresh."label",fresh."sequence_no",fresh."is_aggregate",fresh."definition",fresh."definition_version",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.periods'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venues" a JOIN "football"."venues" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.venues / football_venues_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venues" a JOIN "football"."venues" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.venues / football_venues_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venues" fresh JOIN "football"."venues" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."name",old."city",old."country_id",old."latitude",old."longitude",old."capacity",old."capacity_as_of",old."opened_year",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."country_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."name",fresh."city",fresh."country_id",fresh."latitude",fresh."longitude",fresh."capacity",fresh."capacity_as_of",fresh."opened_year",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."country_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.venues'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coaches" a JOIN "football"."coaches" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.coaches / football_coaches_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coaches" a JOIN "football"."coaches" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.coaches / football_coaches_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coaches" fresh JOIN "football"."coaches" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."display_name",old."birth_date",old."nationality_country_id",old."image_asset_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."nationality_country_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."display_name",fresh."birth_date",fresh."nationality_country_id",fresh."image_asset_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."nationality_country_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.coaches'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competitions" a JOIN "football"."competitions" b ON a."slug" = b."slug" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competitions / football_competitions_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competitions" a JOIN "football"."competitions" b ON a."slug" = b."slug" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competitions / football_competitions_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competitions" a JOIN "football"."competitions" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competitions / football_competitions_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competitions" a JOIN "football"."competitions" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competitions / football_competitions_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competitions" fresh JOIN "football"."competitions" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."name",old."slug",old."competition_type",old."association_id",old."country_id",old."gender",old."age_category",old."image_asset_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."country_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."name",fresh."slug",fresh."competition_type",fresh."association_id",fresh."country_id",fresh."gender",fresh."age_category",fresh."image_asset_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."country_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.competitions'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_seasons" a JOIN "football"."competition_seasons" b ON a."competition_id" = b."competition_id" AND a."season_key" = b."season_key" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_seasons / football_competition_seasons_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_seasons" a JOIN "football"."competition_seasons" b ON a."competition_id" = b."competition_id" AND a."season_key" = b."season_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_seasons / football_competition_seasons_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_seasons" a JOIN "football"."competition_seasons" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_seasons / football_competition_seasons_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_seasons" a JOIN "football"."competition_seasons" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_seasons / football_competition_seasons_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_seasons" fresh JOIN "football"."competition_seasons" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."competition_id",old."season_key",old."label",old."start_date",old."end_date",old."status",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."competition_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."competition_id",fresh."season_key",fresh."label",fresh."start_date",fresh."end_date",fresh."status",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."competition_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.competition_seasons'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" a JOIN "football"."competition_stages" b ON a."competition_season_id" = b."competition_season_id" AND a."stage_key" = b."stage_key" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_stages / football_competition_stages_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" a JOIN "football"."competition_stages" b ON a."competition_season_id" = b."competition_season_id" AND a."stage_key" = b."stage_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_stages / football_competition_stages_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" a JOIN "football"."competition_stages" b ON a."id" = b."id" AND a."competition_season_id" = b."competition_season_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_stages / football_competition_stages_sv_natural_1_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" a JOIN "football"."competition_stages" b ON a."id" = b."id" AND a."competition_season_id" = b."competition_season_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_stages / football_competition_stages_sv_natural_1_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" a JOIN "football"."competition_stages" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_stages / football_competition_stages_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" a JOIN "football"."competition_stages" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_stages / football_competition_stages_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" fresh JOIN "football"."competition_stages" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."competition_season_id",old."parent_stage_id",old."stage_key",old."stage_type",old."name",old."sequence_no",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."competition_season_revision_id",old."parent_stage_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."competition_season_id",fresh."parent_stage_id",fresh."stage_key",fresh."stage_type",fresh."name",fresh."sequence_no",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."competition_season_revision_id",fresh."parent_stage_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.competition_stages'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" a JOIN "football"."competition_groups" b ON a."stage_id" = b."stage_id" AND a."group_key" = b."group_key" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_groups / football_competition_groups_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" a JOIN "football"."competition_groups" b ON a."stage_id" = b."stage_id" AND a."group_key" = b."group_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_groups / football_competition_groups_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" a JOIN "football"."competition_groups" b ON a."id" = b."id" AND a."stage_id" = b."stage_id" AND a."competition_season_id" = b."competition_season_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_groups / football_competition_groups_sv_natural_1_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" a JOIN "football"."competition_groups" b ON a."id" = b."id" AND a."stage_id" = b."stage_id" AND a."competition_season_id" = b."competition_season_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_groups / football_competition_groups_sv_natural_1_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" a JOIN "football"."competition_groups" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_groups / football_competition_groups_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" a JOIN "football"."competition_groups" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_groups / football_competition_groups_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" fresh JOIN "football"."competition_groups" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."competition_season_id",old."stage_id",old."group_key",old."name",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."stage_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."competition_season_id",fresh."stage_id",fresh."group_key",fresh."name",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."stage_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.competition_groups'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_teams" a JOIN "football"."competition_teams" b ON a."competition_season_id" = b."competition_season_id" AND a."team_id" = b."team_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_teams / football_competition_teams_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_teams" a JOIN "football"."competition_teams" b ON a."competition_season_id" = b."competition_season_id" AND a."team_id" = b."team_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_teams / football_competition_teams_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_teams" fresh JOIN "football"."competition_teams" old ON fresh."competition_season_id" IS NOT DISTINCT FROM old."competition_season_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."competition_season_id",old."team_id",old."entered_on",old."exited_on",old."status",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."competition_season_revision_id") IS NOT DISTINCT FROM ROW(fresh."competition_season_id",fresh."team_id",fresh."entered_on",fresh."exited_on",fresh."status",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."competition_season_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.competition_teams'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" a JOIN "football"."player_profile_versions" b ON a."source_id" = b."source_id" AND a."external_profile_version_id" = b."external_profile_version_id" AND a."profile_content_sha256" = b."profile_content_sha256" AND a."variant_key" = b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_profile_versions / football_player_profile_versions_sv_natural_0_varian_b412e957e1'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" a JOIN "football"."player_profile_versions" b ON a."source_id" = b."source_id" AND a."external_profile_version_id" = b."external_profile_version_id" AND a."profile_content_sha256" = b."profile_content_sha256" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_profile_versions / football_player_profile_versions_sv_natural_0_canoni_1135793f83'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" a JOIN "football"."player_profile_versions" b ON a."player_id" = b."player_id" AND a."profile_context" = b."profile_context" AND a."variant_key" = b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_profile_versions / football_player_profile_versions_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" a JOIN "football"."player_profile_versions" b ON a."player_id" = b."player_id" AND a."profile_context" = b."profile_context" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_profile_versions / football_player_profile_versions_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" fresh JOIN "football"."player_profile_versions" old ON fresh."player_id" IS NOT DISTINCT FROM old."player_id" AND fresh."profile_context" IS NOT DISTINCT FROM old."profile_context" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."player_id",old."external_profile_version_id",old."display_name",old."image_asset_id",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."short_name",old."country_code_source",old."raw_position_code",old."shirt_number",old."birth_date",old."height_cm",old."dominant_foot",old."profile_content_sha256",old."nationality_country_id",old."primary_position_code",old."variant_key",old."is_canonical",old."is_deleted",old."profile_context",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."nationality_country_revision_id",old."primary_position_definition_version",old."raw_position_code_state",old."raw_position_code_source_number",old."shirt_number_state",old."shirt_number_source_number") IS NOT DISTINCT FROM ROW(fresh."player_id",fresh."external_profile_version_id",fresh."display_name",fresh."image_asset_id",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."short_name",fresh."country_code_source",fresh."raw_position_code",fresh."shirt_number",fresh."birth_date",fresh."height_cm",fresh."dominant_foot",fresh."profile_content_sha256",fresh."nationality_country_id",fresh."primary_position_code",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."profile_context",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."nationality_country_revision_id",fresh."primary_position_definition_version",fresh."raw_position_code_state",fresh."raw_position_code_source_number",fresh."shirt_number_state",fresh."shirt_number_source_number")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_profile_versions'; END IF;
IF EXISTS (SELECT 1 FROM "football"."position_mappings" a JOIN "football"."position_mappings" b ON a."source_id" = b."source_id" AND a."raw_position_code" = b."raw_position_code" WHERE ROW(a."source_id",a."raw_position_code",a."mapping_version") < ROW(b."source_id",b."raw_position_code",b."mapping_version") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.position_mappings / football_position_mappings_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."position_mappings" fresh JOIN "football"."position_mappings" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."raw_position_code" IS NOT DISTINCT FROM old."raw_position_code" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."raw_position_code",old."mapping_version",old."position_code",old."status",old."evidence",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_record_id",old."provenance_kind",old."position_definition_version") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."raw_position_code",fresh."mapping_version",fresh."position_code",fresh."status",fresh."evidence",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_record_id",fresh."provenance_kind",fresh."position_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.position_mappings'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_team_memberships" a JOIN "football"."player_team_memberships" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_team_memberships / football_player_team_memberships_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_team_memberships" a JOIN "football"."player_team_memberships" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_team_memberships / football_player_team_memberships_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_team_memberships" fresh JOIN "football"."player_team_memberships" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."player_id",old."team_id",old."membership_type",old."valid_from",old."valid_to",old."date_precision",old."observed_from",old."observed_to",old."evidence_kind",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."id",fresh."player_id",fresh."team_id",fresh."membership_type",fresh."valid_from",fresh."valid_to",fresh."date_precision",fresh."observed_from",fresh."observed_to",fresh."evidence_kind",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_team_memberships'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_aliases" a JOIN "football"."team_aliases" b ON a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."alias" IS NOT DISTINCT FROM b."alias" AND a."language_code" IS NOT DISTINCT FROM b."language_code" AND a."source_id" IS NOT DISTINCT FROM b."source_id" AND a."valid_from" IS NOT DISTINCT FROM b."valid_from" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_aliases / football_team_aliases_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_aliases" a JOIN "football"."team_aliases" b ON a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."alias" IS NOT DISTINCT FROM b."alias" AND a."language_code" IS NOT DISTINCT FROM b."language_code" AND a."source_id" IS NOT DISTINCT FROM b."source_id" AND a."valid_from" IS NOT DISTINCT FROM b."valid_from" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_aliases / football_team_aliases_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_aliases" a JOIN "football"."team_aliases" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_aliases / football_team_aliases_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_aliases" a JOIN "football"."team_aliases" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_aliases / football_team_aliases_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_aliases" fresh JOIN "football"."team_aliases" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."team_id",old."alias",old."language_code",old."source_id",old."valid_from",old."valid_to",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_record_id",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."id",fresh."team_id",fresh."alias",fresh."language_code",fresh."source_id",fresh."valid_from",fresh."valid_to",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_record_id",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_aliases'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_source_ids" a JOIN "football"."competition_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.competition_source_ids / football_competition_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_source_ids" fresh JOIN "football"."competition_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."competition_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."competition_revision_id") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."competition_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."competition_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.competition_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_source_ids" a JOIN "football"."team_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_source_ids / football_team_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_source_ids" fresh JOIN "football"."team_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."team_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."team_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_source_ids" a JOIN "football"."player_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_source_ids / football_player_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_source_ids" fresh JOIN "football"."player_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."player_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."player_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_source_ids" a JOIN "football"."association_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.association_source_ids / football_association_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_source_ids" fresh JOIN "football"."association_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."association_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."association_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.association_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venue_source_ids" a JOIN "football"."venue_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.venue_source_ids / football_venue_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venue_source_ids" fresh JOIN "football"."venue_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."venue_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."venue_revision_id") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."venue_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."venue_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.venue_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coach_source_ids" a JOIN "football"."coach_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.coach_source_ids / football_coach_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coach_source_ids" fresh JOIN "football"."coach_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."coach_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."coach_revision_id") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."coach_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."coach_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.coach_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" a JOIN "football"."matches" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.matches / football_matches_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" a JOIN "football"."matches" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.matches / football_matches_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" fresh JOIN "football"."matches" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."competition_season_id",old."stage_id",old."group_id",old."round_label",old."round_number",old."leg_number",old."tie_key",old."match_date",old."kickoff_at",old."kickoff_precision",old."source_timezone",old."status",old."publication_state",old."venue_id",old."neutral_venue",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."competition_season_revision_id",old."stage_revision_id",old."group_revision_id",old."venue_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."competition_season_id",fresh."stage_id",fresh."group_id",fresh."round_label",fresh."round_number",fresh."leg_number",fresh."tie_key",fresh."match_date",fresh."kickoff_at",fresh."kickoff_precision",fresh."source_timezone",fresh."status",fresh."publication_state",fresh."venue_id",fresh."neutral_venue",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."competition_season_revision_id",fresh."stage_revision_id",fresh."group_revision_id",fresh."venue_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.matches'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_source_ids" a JOIN "football"."match_source_ids" b ON a."source_id" = b."source_id" AND a."external_id" = b."external_id" WHERE ROW(a."source_id",a."external_id",a."recorded_from_gen") < ROW(b."source_id",b."external_id",b."recorded_from_gen") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_source_ids / football_match_source_ids_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_source_ids" fresh JOIN "football"."match_source_ids" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."external_id" IS NOT DISTINCT FROM old."external_id" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."external_id",old."match_id",old."first_seen_at",old."source_record_id",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_revision_id") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."external_id",fresh."match_id",fresh."first_seen_at",fresh."source_record_id",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.match_source_ids'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" a JOIN "football"."match_teams" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_teams / football_match_teams_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" a JOIN "football"."match_teams" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_teams / football_match_teams_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" a JOIN "football"."match_teams" b ON a."match_id" = b."match_id" AND a."side" = b."side" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_teams / football_match_teams_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" a JOIN "football"."match_teams" b ON a."match_id" = b."match_id" AND a."side" = b."side" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_teams / football_match_teams_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" fresh JOIN "football"."match_teams" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."side" IS NOT DISTINCT FROM old."side" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."side",old."team_id",old."participant_label",old."coach_id",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_revision_id",old."coach_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."side",fresh."team_id",fresh."participant_label",fresh."coach_id",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_revision_id",fresh."coach_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.match_teams'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_scores" a JOIN "football"."match_scores" b ON a."match_id" = b."match_id" AND a."side" = b."side" AND a."score_scope" = b."score_scope" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_scores / football_match_scores_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_scores" a JOIN "football"."match_scores" b ON a."match_id" = b."match_id" AND a."side" = b."side" AND a."score_scope" = b."score_scope" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_scores / football_match_scores_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_scores" fresh JOIN "football"."match_scores" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."side" IS NOT DISTINCT FROM old."side" AND fresh."score_scope" IS NOT DISTINCT FROM old."score_scope" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."side",old."score_scope",old."goals",old."score_basis",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."side",fresh."score_scope",fresh."goals",fresh."score_basis",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.match_scores'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_lineups" a JOIN "football"."match_lineups" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_lineups / football_match_lineups_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_lineups" a JOIN "football"."match_lineups" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_lineups / football_match_lineups_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_lineups" fresh JOIN "football"."match_lineups" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."team_id",old."formation",old."confirmed",old."lineup_type",old."published_at",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."team_id",fresh."formation",fresh."confirmed",fresh."lineup_type",fresh."published_at",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.match_lineups'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" a JOIN "football"."match_players" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."team_id" = b."team_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_players / football_match_players_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" a JOIN "football"."match_players" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."team_id" = b."team_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_players / football_match_players_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" a JOIN "football"."match_players" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_players / football_match_players_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" a JOIN "football"."match_players" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_players / football_match_players_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" fresh JOIN "football"."match_players" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."player_id" IS NOT DISTINCT FROM old."player_id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."player_id",old."team_id",old."profile_version_id",old."is_starter",old."squad_status",old."played",old."participation_evidence",old."shirt_number",old."raw_position_code",old."position_code",old."position_mapping_version",old."raw_pitch_x",old."raw_pitch_y",old."coordinate_frame",old."is_captain",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id",old."position_definition_version",old."raw_position_code_state",old."raw_position_code_source_number",old."shirt_number_state",old."shirt_number_source_number") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."player_id",fresh."team_id",fresh."profile_version_id",fresh."is_starter",fresh."squad_status",fresh."played",fresh."participation_evidence",fresh."shirt_number",fresh."raw_position_code",fresh."position_code",fresh."position_mapping_version",fresh."raw_pitch_x",fresh."raw_pitch_y",fresh."coordinate_frame",fresh."is_captain",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id",fresh."position_definition_version",fresh."raw_position_code_state",fresh."raw_position_code_source_number",fresh."shirt_number_state",fresh."shirt_number_source_number")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.match_players'; END IF;
IF EXISTS (SELECT 1 FROM "football"."metric_definitions" a JOIN "football"."metric_definitions" b ON a."code" = b."code" WHERE ROW(a."code",a."definition_version") < ROW(b."code",b."definition_version") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.metric_definitions / football_metric_definitions_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."metric_definitions" fresh JOIN "football"."metric_definitions" old ON fresh."code" IS NOT DISTINCT FROM old."code" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."code",old."label",old."definition",old."unit",old."scope",old."aggregation",old."minimum",old."maximum",old."allows_negative",old."numerator_code",old."denominator_code",old."definition_version",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."numerator_definition_version",old."denominator_definition_version") IS NOT DISTINCT FROM ROW(fresh."code",fresh."label",fresh."definition",fresh."unit",fresh."scope",fresh."aggregation",fresh."minimum",fresh."maximum",fresh."allows_negative",fresh."numerator_code",fresh."denominator_code",fresh."definition_version",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."numerator_definition_version",fresh."denominator_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.metric_definitions'; END IF;
IF EXISTS (SELECT 1 FROM "football"."source_metric_mappings" a JOIN "football"."source_metric_mappings" b ON a."source_id" = b."source_id" AND a."family_code" = b."family_code" AND a."raw_key" = b."raw_key" WHERE ROW(a."source_id",a."family_code",a."raw_key",a."mapping_version") < ROW(b."source_id",b."family_code",b."raw_key",b."mapping_version") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.source_metric_mappings / football_source_metric_mappings_sv_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."source_metric_mappings" fresh JOIN "football"."source_metric_mappings" old ON fresh."source_id" IS NOT DISTINCT FROM old."source_id" AND fresh."family_code" IS NOT DISTINCT FROM old."family_code" AND fresh."raw_key" IS NOT DISTINCT FROM old."raw_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."source_id",old."family_code",old."raw_key",old."mapping_version",old."metric_code",old."parse_rule",old."period_rule",old."definition_notes",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_record_id",old."provenance_kind",old."metric_definition_version") IS NOT DISTINCT FROM ROW(fresh."source_id",fresh."family_code",fresh."raw_key",fresh."mapping_version",fresh."metric_code",fresh."parse_rule",fresh."period_rule",fresh."definition_notes",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_record_id",fresh."provenance_kind",fresh."metric_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.source_metric_mappings'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_stats" a JOIN "football"."player_match_stats" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."period_code" = b."period_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_match_stats / football_player_match_stats_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_stats" a JOIN "football"."player_match_stats" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."period_code" = b."period_code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_match_stats / football_player_match_stats_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_stats" fresh JOIN "football"."player_match_stats" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."player_id" IS NOT DISTINCT FROM old."player_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."player_id",old."period_code",old."team_id",old."goals",old."assists",old."shots",old."shots_on_target",old."chances_created",old."big_chances_created",old."passes_completed",old."passes_attempted",old."passes_final_third",old."defensive_actions",old."interceptions",old."tackles",old."recoveries",old."duels_won",old."duels_lost",old."aerial_duels_won",old."aerial_duels_attempted",old."touches",old."touches_box",old."clearances",old."blocks",old."dribbles_completed",old."dribbles_attempted",old."saves",old."xg",old."non_penalty_xg",old."xa",old."xgot",old."minutes_played",old."provider_rating",old."goals_prevented",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_player_revision_id",old."period_definition_version") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."player_id",fresh."period_code",fresh."team_id",fresh."goals",fresh."assists",fresh."shots",fresh."shots_on_target",fresh."chances_created",fresh."big_chances_created",fresh."passes_completed",fresh."passes_attempted",fresh."passes_final_third",fresh."defensive_actions",fresh."interceptions",fresh."tackles",fresh."recoveries",fresh."duels_won",fresh."duels_lost",fresh."aerial_duels_won",fresh."aerial_duels_attempted",fresh."touches",fresh."touches_box",fresh."clearances",fresh."blocks",fresh."dribbles_completed",fresh."dribbles_attempted",fresh."saves",fresh."xg",fresh."non_penalty_xg",fresh."xa",fresh."xgot",fresh."minutes_played",fresh."provider_rating",fresh."goals_prevented",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_player_revision_id",fresh."period_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_match_stats'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_stats" a JOIN "football"."team_match_stats" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."period_code" = b."period_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_match_stats / football_team_match_stats_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_stats" a JOIN "football"."team_match_stats" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."period_code" = b."period_code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_match_stats / football_team_match_stats_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_stats" fresh JOIN "football"."team_match_stats" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."team_id",old."period_code",old."shots",old."shots_on_target",old."shots_off_target",old."shots_blocked",old."corners",old."offsides",old."fouls",old."yellow_cards",old."red_cards",old."passes_completed",old."passes_attempted",old."crosses_completed",old."crosses_attempted",old."tackles",old."interceptions",old."recoveries",old."duels_won",old."saves",old."touches_box",old."xg",old."non_penalty_xg",old."xgot",old."possession_pct",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id",old."period_definition_version") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."team_id",fresh."period_code",fresh."shots",fresh."shots_on_target",fresh."shots_off_target",fresh."shots_blocked",fresh."corners",fresh."offsides",fresh."fouls",fresh."yellow_cards",fresh."red_cards",fresh."passes_completed",fresh."passes_attempted",fresh."crosses_completed",fresh."crosses_attempted",fresh."tackles",fresh."interceptions",fresh."recoveries",fresh."duels_won",fresh."saves",fresh."touches_box",fresh."xg",fresh."non_penalty_xg",fresh."xgot",fresh."possession_pct",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id",fresh."period_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_match_stats'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" a JOIN "football"."shots" b ON a."source_id" = b."source_id" AND a."match_id" = b."match_id" AND a."external_shot_id" = b."external_shot_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.shots / football_shots_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" a JOIN "football"."shots" b ON a."source_id" = b."source_id" AND a."match_id" = b."match_id" AND a."external_shot_id" = b."external_shot_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.shots / football_shots_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" a JOIN "football"."shots" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.shots / football_shots_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" a JOIN "football"."shots" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.shots / football_shots_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" fresh JOIN "football"."shots" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."match_id",old."team_id",old."player_id",old."external_shot_id",old."period_code",old."minute",old."minute_added",old."x_m",old."y_m",old."coordinate_frame",old."pitch_length_m",old."pitch_width_m",old."xg",old."xgot",old."outcome",old."body_part",old."situation",old."is_goal",old."is_own_goal",old."is_on_target",old."is_inside_box",old."goal_crossed_y",old."goal_crossed_z",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."keeper_id",old."blocked_x",old."blocked_y",old."is_blocked",old."is_saved_off_line",old."source_shot_type",old."source_event_type",old."source_ordinal",old."player_profile_version_id",old."keeper_profile_version_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id",old."period_definition_version") IS NOT DISTINCT FROM ROW(fresh."id",fresh."match_id",fresh."team_id",fresh."player_id",fresh."external_shot_id",fresh."period_code",fresh."minute",fresh."minute_added",fresh."x_m",fresh."y_m",fresh."coordinate_frame",fresh."pitch_length_m",fresh."pitch_width_m",fresh."xg",fresh."xgot",fresh."outcome",fresh."body_part",fresh."situation",fresh."is_goal",fresh."is_own_goal",fresh."is_on_target",fresh."is_inside_box",fresh."goal_crossed_y",fresh."goal_crossed_z",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."keeper_id",fresh."blocked_x",fresh."blocked_y",fresh."is_blocked",fresh."is_saved_off_line",fresh."source_shot_type",fresh."source_event_type",fresh."source_ordinal",fresh."player_profile_version_id",fresh."keeper_profile_version_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id",fresh."period_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.shots'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_advanced" a JOIN "football"."player_match_advanced" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."period_code" = b."period_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_match_advanced / football_player_match_advanced_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_advanced" a JOIN "football"."player_match_advanced" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."period_code" = b."period_code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_match_advanced / football_player_match_advanced_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_advanced" fresh JOIN "football"."player_match_advanced" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."player_id" IS NOT DISTINCT FROM old."player_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."player_id",old."period_code",old."team_id",old."progressive_passes",old."passes_into_box",old."key_passes",old."through_balls",old."crosses",old."switches",old."carries",old."progressive_carries",old."carries_into_final_third",old."carries_into_box",old."take_ons",old."take_ons_won",old."miscontrols",old."dispossessed",old."sca",old."gca",old."second_assists",old."xt_total",old."vaep_total",old."vaep_offensive",old."vaep_defensive",old."pv_total",old."pv_offensive",old."pv_defensive",old."progressive_pass_distance",old."carry_distance",old."progressive_carry_distance",old."xag",old."xg_chain",old."xg_buildup",old."provider_model_version",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."sca_pass_live",old."sca_pass_dead",old."sca_take_on",old."sca_shot",old."sca_foul_drawn",old."sca_defensive",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_player_revision_id",old."period_definition_version") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."player_id",fresh."period_code",fresh."team_id",fresh."progressive_passes",fresh."passes_into_box",fresh."key_passes",fresh."through_balls",fresh."crosses",fresh."switches",fresh."carries",fresh."progressive_carries",fresh."carries_into_final_third",fresh."carries_into_box",fresh."take_ons",fresh."take_ons_won",fresh."miscontrols",fresh."dispossessed",fresh."sca",fresh."gca",fresh."second_assists",fresh."xt_total",fresh."vaep_total",fresh."vaep_offensive",fresh."vaep_defensive",fresh."pv_total",fresh."pv_offensive",fresh."pv_defensive",fresh."progressive_pass_distance",fresh."carry_distance",fresh."progressive_carry_distance",fresh."xag",fresh."xg_chain",fresh."xg_buildup",fresh."provider_model_version",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."sca_pass_live",fresh."sca_pass_dead",fresh."sca_take_on",fresh."sca_shot",fresh."sca_foul_drawn",fresh."sca_defensive",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_player_revision_id",fresh."period_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_match_advanced'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_advanced" a JOIN "football"."team_match_advanced" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."period_code" = b."period_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_match_advanced / football_team_match_advanced_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_advanced" a JOIN "football"."team_match_advanced" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."period_code" = b."period_code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_match_advanced / football_team_match_advanced_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_advanced" fresh JOIN "football"."team_match_advanced" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."team_id",old."period_code",old."opponent_passes",old."defensive_actions",old."high_turnovers",old."counterpress_regains_5s",old."final_third_entries",old."box_entries",old."buildup_attacks",old."direct_attacks",old."challenges",old."aerials",old."aerials_won",old."xt_total",old."vaep_total",old."vaep_offensive",old."vaep_defensive",old."pv_total",old."pv_offensive",old."pv_defensive",old."ppda",old."field_tilt",old."possession_pct",old."avg_action_x",old."avg_defensive_action_x",old."ball_recovery_time_seconds",old."passes_per_sequence",old."sequence_time_seconds",old."direct_speed",old."provider_model_version",old."coordinate_frame",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id",old."period_definition_version") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."team_id",fresh."period_code",fresh."opponent_passes",fresh."defensive_actions",fresh."high_turnovers",fresh."counterpress_regains_5s",fresh."final_third_entries",fresh."box_entries",fresh."buildup_attacks",fresh."direct_attacks",fresh."challenges",fresh."aerials",fresh."aerials_won",fresh."xt_total",fresh."vaep_total",fresh."vaep_offensive",fresh."vaep_defensive",fresh."pv_total",fresh."pv_offensive",fresh."pv_defensive",fresh."ppda",fresh."field_tilt",fresh."possession_pct",fresh."avg_action_x",fresh."avg_defensive_action_x",fresh."ball_recovery_time_seconds",fresh."passes_per_sequence",fresh."sequence_time_seconds",fresh."direct_speed",fresh."provider_model_version",fresh."coordinate_frame",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id",fresh."period_definition_version")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_match_advanced'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_networks" a JOIN "football"."pass_networks" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."window_kind" IS NOT DISTINCT FROM b."window_kind" AND a."from_seconds" IS NOT DISTINCT FROM b."from_seconds" AND a."until_seconds" IS NOT DISTINCT FROM b."until_seconds" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.pass_networks / football_pass_networks_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_networks" a JOIN "football"."pass_networks" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."window_kind" IS NOT DISTINCT FROM b."window_kind" AND a."from_seconds" IS NOT DISTINCT FROM b."from_seconds" AND a."until_seconds" IS NOT DISTINCT FROM b."until_seconds" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.pass_networks / football_pass_networks_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_networks" a JOIN "football"."pass_networks" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."window_kind" IS NOT DISTINCT FROM b."window_kind" AND a."from_seconds" IS NOT DISTINCT FROM b."from_seconds" AND a."until_seconds" IS NOT DISTINCT FROM b."until_seconds" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.pass_networks / football_pass_networks_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_networks" a JOIN "football"."pass_networks" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."window_kind" IS NOT DISTINCT FROM b."window_kind" AND a."from_seconds" IS NOT DISTINCT FROM b."from_seconds" AND a."until_seconds" IS NOT DISTINCT FROM b."until_seconds" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.pass_networks / football_pass_networks_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_networks" fresh JOIN "football"."pass_networks" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."window_kind" IS NOT DISTINCT FROM old."window_kind" AND fresh."from_seconds" IS NOT DISTINCT FROM old."from_seconds" AND fresh."until_seconds" IS NOT DISTINCT FROM old."until_seconds" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."team_id",old."window_kind",old."from_seconds",old."until_seconds",old."centralization",old."coordinate_frame",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."team_id",fresh."window_kind",fresh."from_seconds",fresh."until_seconds",fresh."centralization",fresh."coordinate_frame",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id") AND NOT EXISTS ((SELECT "player_id","avg_x","avg_y","passes","passes_received","degree","strength","betweenness","clustering" FROM "football"."pass_network_nodes" WHERE "network_id" = old."id" EXCEPT SELECT "player_id","avg_x","avg_y","passes","passes_received","degree","strength","betweenness","clustering" FROM "football"."pass_network_nodes" WHERE "network_id" = fresh."id") UNION ALL (SELECT "player_id","avg_x","avg_y","passes","passes_received","degree","strength","betweenness","clustering" FROM "football"."pass_network_nodes" WHERE "network_id" = fresh."id" EXCEPT SELECT "player_id","avg_x","avg_y","passes","passes_received","degree","strength","betweenness","clustering" FROM "football"."pass_network_nodes" WHERE "network_id" = old."id")) AND NOT EXISTS ((SELECT "from_player_id","to_player_id","passes" FROM "football"."pass_network_edges" WHERE "network_id" = old."id" EXCEPT SELECT "from_player_id","to_player_id","passes" FROM "football"."pass_network_edges" WHERE "network_id" = fresh."id") UNION ALL (SELECT "from_player_id","to_player_id","passes" FROM "football"."pass_network_edges" WHERE "network_id" = fresh."id" EXCEPT SELECT "from_player_id","to_player_id","passes" FROM "football"."pass_network_edges" WHERE "network_id" = old."id"))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.pass_networks'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" a JOIN "football"."match_heatmaps" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."player_id" IS NOT DISTINCT FROM b."player_id" AND a."period_code" IS NOT DISTINCT FROM b."period_code" AND a."map_kind" IS NOT DISTINCT FROM b."map_kind" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_heatmaps / football_match_heatmaps_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" a JOIN "football"."match_heatmaps" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."player_id" IS NOT DISTINCT FROM b."player_id" AND a."period_code" IS NOT DISTINCT FROM b."period_code" AND a."map_kind" IS NOT DISTINCT FROM b."map_kind" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_heatmaps / football_match_heatmaps_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" a JOIN "football"."match_heatmaps" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."player_id" IS NOT DISTINCT FROM b."player_id" AND a."period_code" IS NOT DISTINCT FROM b."period_code" AND a."map_kind" IS NOT DISTINCT FROM b."map_kind" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_heatmaps / football_match_heatmaps_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" a JOIN "football"."match_heatmaps" b ON a."match_id" IS NOT DISTINCT FROM b."match_id" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."player_id" IS NOT DISTINCT FROM b."player_id" AND a."period_code" IS NOT DISTINCT FROM b."period_code" AND a."map_kind" IS NOT DISTINCT FROM b."map_kind" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.match_heatmaps / football_match_heatmaps_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" fresh JOIN "football"."match_heatmaps" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."player_id" IS NOT DISTINCT FROM old."player_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."map_kind" IS NOT DISTINCT FROM old."map_kind" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."team_id",old."player_id",old."period_code",old."map_kind",old."grid_columns",old."grid_rows",old."cell_length_m",old."cell_width_m",old."coordinate_frame",old."actions",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."cells_state",old."variant_key",old."is_canonical",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."match_team_revision_id",old."period_definition_version") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."team_id",fresh."player_id",fresh."period_code",fresh."map_kind",fresh."grid_columns",fresh."grid_rows",fresh."cell_length_m",fresh."cell_width_m",fresh."coordinate_frame",fresh."actions",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."cells_state",fresh."variant_key",fresh."is_canonical",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."match_team_revision_id",fresh."period_definition_version") AND NOT EXISTS ((SELECT "cell_ordinal","column_index","row_index","action_count" FROM "football"."match_heatmap_cells" WHERE "heatmap_id" = old."id" EXCEPT SELECT "cell_ordinal","column_index","row_index","action_count" FROM "football"."match_heatmap_cells" WHERE "heatmap_id" = fresh."id") UNION ALL (SELECT "cell_ordinal","column_index","row_index","action_count" FROM "football"."match_heatmap_cells" WHERE "heatmap_id" = fresh."id" EXCEPT SELECT "cell_ordinal","column_index","row_index","action_count" FROM "football"."match_heatmap_cells" WHERE "heatmap_id" = old."id"))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.match_heatmaps'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_coach_tenures" a JOIN "football"."team_coach_tenures" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_coach_tenures / football_team_coach_tenures_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_coach_tenures" a JOIN "football"."team_coach_tenures" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_coach_tenures / football_team_coach_tenures_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_coach_tenures" fresh JOIN "football"."team_coach_tenures" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."team_id",old."coach_id",old."role",old."valid_from",old."valid_to",old."date_precision",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."coach_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."team_id",fresh."coach_id",fresh."role",fresh."valid_from",fresh."valid_to",fresh."date_precision",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."coach_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_coach_tenures'; END IF;
IF EXISTS (SELECT 1 FROM "football"."honour_definitions" a JOIN "football"."honour_definitions" b ON a."code" = b."code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.honour_definitions / football_honour_definitions_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."honour_definitions" a JOIN "football"."honour_definitions" b ON a."code" = b."code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.honour_definitions / football_honour_definitions_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."honour_definitions" a JOIN "football"."honour_definitions" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.honour_definitions / football_honour_definitions_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."honour_definitions" a JOIN "football"."honour_definitions" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.honour_definitions / football_honour_definitions_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."honour_definitions" fresh JOIN "football"."honour_definitions" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."code",old."name",old."honour_type",old."competition_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind",old."competition_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."code",fresh."name",fresh."honour_type",fresh."competition_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind",fresh."competition_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.honour_definitions'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" a JOIN "football"."player_honours" b ON a."player_id" IS NOT DISTINCT FROM b."player_id" AND a."honour_id" IS NOT DISTINCT FROM b."honour_id" AND a."edition_key" IS NOT DISTINCT FROM b."edition_key" AND a."outcome" IS NOT DISTINCT FROM b."outcome" AND a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_honours / football_player_honours_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" a JOIN "football"."player_honours" b ON a."player_id" IS NOT DISTINCT FROM b."player_id" AND a."honour_id" IS NOT DISTINCT FROM b."honour_id" AND a."edition_key" IS NOT DISTINCT FROM b."edition_key" AND a."outcome" IS NOT DISTINCT FROM b."outcome" AND a."team_id" IS NOT DISTINCT FROM b."team_id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_honours / football_player_honours_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" a JOIN "football"."player_honours" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_honours / football_player_honours_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" a JOIN "football"."player_honours" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_honours / football_player_honours_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" fresh JOIN "football"."player_honours" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."player_id",old."honour_id",old."competition_season_id",old."season_label",old."edition_key",old."outcome",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."team_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."honour_revision_id",old."competition_season_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."player_id",fresh."honour_id",fresh."competition_season_id",fresh."season_label",fresh."edition_key",fresh."outcome",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."team_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."honour_revision_id",fresh."competition_season_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_honours'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" a JOIN "football"."team_honours" b ON a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."honour_id" IS NOT DISTINCT FROM b."honour_id" AND a."edition_key" IS NOT DISTINCT FROM b."edition_key" AND a."outcome" IS NOT DISTINCT FROM b."outcome" AND a."variant_key" IS NOT DISTINCT FROM b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_honours / football_team_honours_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" a JOIN "football"."team_honours" b ON a."team_id" IS NOT DISTINCT FROM b."team_id" AND a."honour_id" IS NOT DISTINCT FROM b."honour_id" AND a."edition_key" IS NOT DISTINCT FROM b."edition_key" AND a."outcome" IS NOT DISTINCT FROM b."outcome" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_honours / football_team_honours_sv_natural_0_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" a JOIN "football"."team_honours" b ON a."id" = b."id" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_honours / football_team_honours_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" a JOIN "football"."team_honours" b ON a."id" = b."id" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_honours / football_team_honours_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" fresh JOIN "football"."team_honours" old ON fresh."id" IS NOT DISTINCT FROM old."id" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."id",old."team_id",old."honour_id",old."competition_season_id",old."season_label",old."edition_key",old."outcome",old."source_id",old."source_record_id",old."canonical_policy_version",old."quality_flags",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."provenance_kind",old."honour_revision_id",old."competition_season_revision_id") IS NOT DISTINCT FROM ROW(fresh."id",fresh."team_id",fresh."honour_id",fresh."competition_season_id",fresh."season_label",fresh."edition_key",fresh."outcome",fresh."source_id",fresh."source_record_id",fresh."canonical_policy_version",fresh."quality_flags",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."provenance_kind",fresh."honour_revision_id",fresh."competition_season_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_honours'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_metric_values" a JOIN "football"."player_match_metric_values" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."period_code" = b."period_code" AND a."family_code" = b."family_code" AND a."metric_code" = b."metric_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_match_metric_values / football_player_match_metric_values_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_metric_values" a JOIN "football"."player_match_metric_values" b ON a."match_id" = b."match_id" AND a."player_id" = b."player_id" AND a."period_code" = b."period_code" AND a."family_code" = b."family_code" AND a."metric_code" = b."metric_code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.player_match_metric_values / football_player_match_metric_values_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_metric_values" fresh JOIN "football"."player_match_metric_values" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."player_id" IS NOT DISTINCT FROM old."player_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."family_code" IS NOT DISTINCT FROM old."family_code" AND fresh."metric_code" IS NOT DISTINCT FROM old."metric_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."player_id",old."team_id",old."period_code",old."family_code",old."metric_code",old."value_kind",old."numeric_value",old."text_value",old."boolean_value",old."numerator",old."denominator",old."source_display",old."source_record_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."provenance_kind",old."metric_definition_version",old."period_definition_version",old."match_player_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."player_id",fresh."team_id",fresh."period_code",fresh."family_code",fresh."metric_code",fresh."value_kind",fresh."numeric_value",fresh."text_value",fresh."boolean_value",fresh."numerator",fresh."denominator",fresh."source_display",fresh."source_record_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."provenance_kind",fresh."metric_definition_version",fresh."period_definition_version",fresh."match_player_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.player_match_metric_values'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_metric_values" a JOIN "football"."team_match_metric_values" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."period_code" = b."period_code" AND a."family_code" = b."family_code" AND a."metric_code" = b."metric_code" AND a."variant_key" = b."variant_key" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_match_metric_values / football_team_match_metric_values_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_metric_values" a JOIN "football"."team_match_metric_values" b ON a."match_id" = b."match_id" AND a."team_id" = b."team_id" AND a."period_code" = b."period_code" AND a."family_code" = b."family_code" AND a."metric_code" = b."metric_code" WHERE ROW(a."revision_id") < ROW(b."revision_id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_match_metric_values / football_team_match_metric_values_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_metric_values" fresh JOIN "football"."team_match_metric_values" old ON fresh."match_id" IS NOT DISTINCT FROM old."match_id" AND fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."period_code" IS NOT DISTINCT FROM old."period_code" AND fresh."family_code" IS NOT DISTINCT FROM old."family_code" AND fresh."metric_code" IS NOT DISTINCT FROM old."metric_code" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."match_id",old."team_id",old."period_code",old."family_code",old."metric_code",old."value_kind",old."numeric_value",old."text_value",old."boolean_value",old."numerator",old."denominator",old."source_display",old."source_record_id",old."variant_key",old."is_canonical",old."is_deleted",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."provenance_kind",old."metric_definition_version",old."period_definition_version",old."match_team_revision_id") IS NOT DISTINCT FROM ROW(fresh."match_id",fresh."team_id",fresh."period_code",fresh."family_code",fresh."metric_code",fresh."value_kind",fresh."numeric_value",fresh."text_value",fresh."boolean_value",fresh."numerator",fresh."denominator",fresh."source_display",fresh."source_record_id",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."provenance_kind",fresh."metric_definition_version",fresh."period_definition_version",fresh."match_team_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_match_metric_values'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_profile_versions" a JOIN "football"."team_profile_versions" b ON a."team_id" = b."team_id" AND a."source_record_id" = b."source_record_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_profile_versions / football_team_profile_versions_sv_natural_0_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_profile_versions" a JOIN "football"."team_profile_versions" b ON a."team_id" = b."team_id" AND a."source_record_id" = b."source_record_id" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_profile_versions / football_team_profile_versions_sv_natural_0_canonica_674cc75c60'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_profile_versions" a JOIN "football"."team_profile_versions" b ON a."team_id" = b."team_id" AND a."profile_context" = b."profile_context" AND a."variant_key" = b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_profile_versions / football_team_profile_versions_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_profile_versions" a JOIN "football"."team_profile_versions" b ON a."team_id" = b."team_id" AND a."profile_context" = b."profile_context" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.team_profile_versions / football_team_profile_versions_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_profile_versions" fresh JOIN "football"."team_profile_versions" old ON fresh."team_id" IS NOT DISTINCT FROM old."team_id" AND fresh."profile_context" IS NOT DISTINCT FROM old."profile_context" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."team_id",old."source_record_id",old."display_name",old."short_name",old."official_name",old."international_name",old."country_code_source",old."team_code_source",old."image_asset_id",old."association_id",old."valid_from",old."valid_to",old."from_year",old."to_year",old."from_phases",old."to_phases",old."inherit_team_external_id",old."is_placeholder",old."is_national",old."slug",old."team_type",old."gender",old."age_category",old."country_id",old."founded_year",old."variant_key",old."is_canonical",old."is_deleted",old."profile_context",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."provenance_kind",old."country_revision_id") IS NOT DISTINCT FROM ROW(fresh."team_id",fresh."source_record_id",fresh."display_name",fresh."short_name",fresh."official_name",fresh."international_name",fresh."country_code_source",fresh."team_code_source",fresh."image_asset_id",fresh."association_id",fresh."valid_from",fresh."valid_to",fresh."from_year",fresh."to_year",fresh."from_phases",fresh."to_phases",fresh."inherit_team_external_id",fresh."is_placeholder",fresh."is_national",fresh."slug",fresh."team_type",fresh."gender",fresh."age_category",fresh."country_id",fresh."founded_year",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."profile_context",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."provenance_kind",fresh."country_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.team_profile_versions'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_profile_versions" a JOIN "football"."association_profile_versions" b ON a."association_id" = b."association_id" AND a."source_record_id" = b."source_record_id" AND a."variant_key" = b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.association_profile_versions / football_association_profile_versions_sv_natural_0_v_d499b52381'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_profile_versions" a JOIN "football"."association_profile_versions" b ON a."association_id" = b."association_id" AND a."source_record_id" = b."source_record_id" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.association_profile_versions / football_association_profile_versions_sv_natural_0_c_7c3e692e06'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_profile_versions" a JOIN "football"."association_profile_versions" b ON a."association_id" = b."association_id" AND a."profile_context" = b."profile_context" AND a."variant_key" = b."variant_key" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.association_profile_versions / football_association_profile_versions_sv_variant_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_profile_versions" a JOIN "football"."association_profile_versions" b ON a."association_id" = b."association_id" AND a."profile_context" = b."profile_context" WHERE ROW(a."id") < ROW(b."id") AND a."recorded_from_gen" < COALESCE(b."recorded_to_gen",9223372036854775807) AND b."recorded_from_gen" < COALESCE(a."recorded_to_gen",9223372036854775807) AND (a."recorded_from_gen"=g OR a."recorded_to_gen"=g OR b."recorded_from_gen"=g OR b."recorded_to_gen"=g) AND a.is_canonical AND b.is_canonical) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: football.association_profile_versions / football_association_profile_versions_sv_canonical_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_profile_versions" fresh JOIN "football"."association_profile_versions" old ON fresh."association_id" IS NOT DISTINCT FROM old."association_id" AND fresh."profile_context" IS NOT DISTINCT FROM old."profile_context" AND fresh."variant_key" IS NOT DISTINCT FROM old."variant_key" WHERE fresh."recorded_from_gen"=g AND old."recorded_to_gen"=g AND ROW(old."association_id",old."source_record_id",old."display_name",old."short_name",old."official_name",old."international_name",old."country_code_source",old."team_code_source",old."image_asset_id",old."valid_from",old."valid_to",old."from_year",old."to_year",old."from_phases",old."to_phases",old."inherit_team_external_id",old."is_placeholder",old."is_national",old."federation_code",old."country_id",old."confederation_code",old."variant_key",old."is_canonical",old."is_deleted",old."profile_context",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."provenance_kind",old."country_revision_id") IS NOT DISTINCT FROM ROW(fresh."association_id",fresh."source_record_id",fresh."display_name",fresh."short_name",fresh."official_name",fresh."international_name",fresh."country_code_source",fresh."team_code_source",fresh."image_asset_id",fresh."valid_from",fresh."valid_to",fresh."from_year",fresh."to_year",fresh."from_phases",fresh."to_phases",fresh."inherit_team_external_id",fresh."is_placeholder",fresh."is_national",fresh."federation_code",fresh."country_id",fresh."confederation_code",fresh."variant_key",fresh."is_canonical",fresh."is_deleted",fresh."profile_context",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."provenance_kind",fresh."country_revision_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: football.association_profile_versions'; END IF;
IF EXISTS (SELECT 1 FROM "analytics"."publication_versions" a JOIN "analytics"."publication_versions" b ON a."competition_season_id" = b."competition_season_id" WHERE ROW(a."competition_season_id",a."published_from_gen") < ROW(b."competition_season_id",b."published_from_gen") AND a."published_from_gen" < COALESCE(b."published_to_gen",9223372036854775807) AND b."published_from_gen" < COALESCE(a."published_to_gen",9223372036854775807) AND (a."published_from_gen"=g OR a."published_to_gen"=g OR b."published_from_gen"=g OR b."published_to_gen"=g)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Historical interval overlap: analytics.publication_versions / analytics_publication_versions_sv_publication_current_idx'; END IF;
IF EXISTS (SELECT 1 FROM "analytics"."publication_versions" fresh JOIN "analytics"."publication_versions" old ON fresh."competition_season_id" IS NOT DISTINCT FROM old."competition_season_id" WHERE fresh."published_from_gen"=g AND old."published_to_gen"=g AND ROW(old."competition_season_id",old."build_id",old."catalog_snapshot_id",old."representation_version",old."relation_code",old."contract_version",old."transform_version",old."transform_code_sha256",old."source_id",old."source_record_id",old."provenance_kind") IS NOT DISTINCT FROM ROW(fresh."competition_season_id",fresh."build_id",fresh."catalog_snapshot_id",fresh."representation_version",fresh."relation_code",fresh."contract_version",fresh."transform_version",fresh."transform_code_sha256",fresh."source_id",fresh."source_record_id",fresh."provenance_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Identical typed reimport must reuse the retained version: analytics.publication_versions'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."match_coverage" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: ingest.match_coverage / ingest_match_coverage_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."public_aliases" child JOIN "football"."competitions" anchor ON anchor."id" = child."competition_id" AND anchor."revision_id" = child."competition_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."competition_id" IS NOT NULL AND child."competition_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."association_id" IS NOT DISTINCT FROM anchor."association_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: ingest.public_aliases / ingest_public_aliases_competition_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."public_aliases" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: ingest.public_aliases / ingest_public_aliases_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."public_aliases" child JOIN "football"."venues" anchor ON anchor."id" = child."venue_id" AND anchor."revision_id" = child."venue_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."venue_id" IS NOT NULL AND child."venue_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."venues" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: ingest.public_aliases / ingest_public_aliases_venue_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "ingest"."public_aliases" child JOIN "football"."coaches" anchor ON anchor."id" = child."coach_id" AND anchor."revision_id" = child."coach_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."coach_id" IS NOT NULL AND child."coach_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."coaches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: ingest.public_aliases / ingest_public_aliases_coach_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venues" child JOIN "football"."countries" anchor ON anchor."id" = child."country_id" AND anchor."revision_id" = child."country_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."country_id" IS NOT NULL AND child."country_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."countries" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.venues / football_venues_country_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coaches" child JOIN "football"."countries" anchor ON anchor."id" = child."nationality_country_id" AND anchor."revision_id" = child."nationality_country_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."nationality_country_id" IS NOT NULL AND child."nationality_country_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."countries" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.coaches / football_coaches_nationality_country_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competitions" child JOIN "football"."countries" anchor ON anchor."id" = child."country_id" AND anchor."revision_id" = child."country_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."country_id" IS NOT NULL AND child."country_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."countries" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competitions / football_competitions_country_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_seasons" child JOIN "football"."competitions" anchor ON anchor."id" = child."competition_id" AND anchor."revision_id" = child."competition_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_id" IS NOT NULL AND child."competition_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."association_id" IS NOT DISTINCT FROM anchor."association_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competition_seasons / football_competition_seasons_competition_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" child JOIN "football"."competition_seasons" anchor ON anchor."id" = child."competition_season_id" AND anchor."revision_id" = child."competition_season_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_season_id" IS NOT NULL AND child."competition_season_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_seasons" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competition_stages / football_competition_stages_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_stages" child JOIN "football"."competition_stages" anchor ON anchor."id" = child."parent_stage_id" AND anchor."competition_season_id" = child."competition_season_id" AND anchor."revision_id" = child."parent_stage_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."parent_stage_id" IS NOT NULL AND child."competition_season_id" IS NOT NULL AND child."parent_stage_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_stages" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."parent_stage_id" IS NOT DISTINCT FROM anchor."parent_stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competition_stages / football_competition_stages_parent_stage_id_competiti_eb6dbca0e'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_groups" child JOIN "football"."competition_stages" anchor ON anchor."id" = child."stage_id" AND anchor."competition_season_id" = child."competition_season_id" AND anchor."revision_id" = child."stage_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."stage_id" IS NOT NULL AND child."competition_season_id" IS NOT NULL AND child."stage_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_stages" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."parent_stage_id" IS NOT DISTINCT FROM anchor."parent_stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competition_groups / football_competition_groups_stage_id_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_teams" child JOIN "football"."competition_seasons" anchor ON anchor."id" = child."competition_season_id" AND anchor."revision_id" = child."competition_season_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_season_id" IS NOT NULL AND child."competition_season_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_seasons" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competition_teams / football_competition_teams_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" child JOIN "football"."countries" anchor ON anchor."id" = child."nationality_country_id" AND anchor."revision_id" = child."nationality_country_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."nationality_country_id" IS NOT NULL AND child."nationality_country_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."countries" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_profile_versions / football_player_profile_versions_sv_nationality_coun_9e69dcc629'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_profile_versions" child JOIN "football"."positions" anchor ON anchor."code" = child."primary_position_code" AND anchor."definition_version" = child."primary_position_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."primary_position_code" IS NOT NULL AND child."primary_position_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."positions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_profile_versions / football_player_profile_versions_sv_primary_position_6ee6c7d787'; END IF;
IF EXISTS (SELECT 1 FROM "football"."position_mappings" child JOIN "football"."positions" anchor ON anchor."code" = child."position_code" AND anchor."definition_version" = child."position_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."position_code" IS NOT NULL AND child."position_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."positions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.position_mappings / football_position_mappings_position_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."competition_source_ids" child JOIN "football"."competitions" anchor ON anchor."id" = child."competition_id" AND anchor."revision_id" = child."competition_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."competition_id" IS NOT NULL AND child."competition_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."association_id" IS NOT DISTINCT FROM anchor."association_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.competition_source_ids / football_competition_source_ids_competition_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."venue_source_ids" child JOIN "football"."venues" anchor ON anchor."id" = child."venue_id" AND anchor."revision_id" = child."venue_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."venue_id" IS NOT NULL AND child."venue_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."venues" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.venue_source_ids / football_venue_source_ids_venue_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."coach_source_ids" child JOIN "football"."coaches" anchor ON anchor."id" = child."coach_id" AND anchor."revision_id" = child."coach_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."coach_id" IS NOT NULL AND child."coach_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."coaches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.coach_source_ids / football_coach_source_ids_coach_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" child JOIN "football"."competition_seasons" anchor ON anchor."id" = child."competition_season_id" AND anchor."revision_id" = child."competition_season_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_season_id" IS NOT NULL AND child."competition_season_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_seasons" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.matches / football_matches_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" child JOIN "football"."competition_stages" anchor ON anchor."id" = child."stage_id" AND anchor."competition_season_id" = child."competition_season_id" AND anchor."revision_id" = child."stage_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."stage_id" IS NOT NULL AND child."competition_season_id" IS NOT NULL AND child."stage_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_stages" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."parent_stage_id" IS NOT DISTINCT FROM anchor."parent_stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.matches / football_matches_stage_id_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" child JOIN "football"."competition_groups" anchor ON anchor."id" = child."group_id" AND anchor."stage_id" = child."stage_id" AND anchor."competition_season_id" = child."competition_season_id" AND anchor."revision_id" = child."group_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."group_id" IS NOT NULL AND child."stage_id" IS NOT NULL AND child."competition_season_id" IS NOT NULL AND child."group_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_groups" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.matches / football_matches_group_id_stage_id_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."matches" child JOIN "football"."venues" anchor ON anchor."id" = child."venue_id" AND anchor."revision_id" = child."venue_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."venue_id" IS NOT NULL AND child."venue_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."venues" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.matches / football_matches_venue_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_source_ids" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_source_ids / football_match_source_ids_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_teams / football_match_teams_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_teams" child JOIN "football"."coaches" anchor ON anchor."id" = child."coach_id" AND anchor."revision_id" = child."coach_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."coach_id" IS NOT NULL AND child."coach_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."coaches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_teams / football_match_teams_coach_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_scores" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."side" = child."side" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."side" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_scores / football_match_scores_match_id_side_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_lineups" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_lineups / football_match_lineups_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_players / football_match_players_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" child JOIN "football"."player_profile_versions" anchor ON anchor."id" = child."profile_version_id" AND anchor."player_id" = child."player_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."profile_version_id" IS NOT NULL AND child."player_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."player_profile_versions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."profile_context" IS NOT DISTINCT FROM anchor."profile_context")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_players / football_match_players_profile_version_id_player_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" child JOIN "football"."positions" anchor ON anchor."code" = child."position_code" AND anchor."definition_version" = child."position_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."position_code" IS NOT NULL AND child."position_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."positions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_players / football_match_players_position_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" child JOIN "football"."position_mappings" anchor ON anchor."source_id" = child."source_id" AND anchor."raw_position_code" = child."raw_position_code" AND anchor."mapping_version" = child."position_mapping_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."source_id" IS NOT NULL AND child."raw_position_code" IS NOT NULL AND child."position_mapping_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."position_mappings" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."source_id" IS NOT DISTINCT FROM anchor."source_id" AND selected_parent."raw_position_code" IS NOT DISTINCT FROM anchor."raw_position_code" AND selected_parent."position_code" IS NOT DISTINCT FROM anchor."position_code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_players / football_match_players_source_id_raw_position_code_po_5b3997f77'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_players" child JOIN "football"."position_mappings" anchor ON anchor."source_id" = child."source_id" AND anchor."raw_position_code" = child."raw_position_code" AND anchor."mapping_version" = child."position_mapping_version" AND anchor."position_code" = child."position_code" AND anchor."position_definition_version" = child."position_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."source_id" IS NOT NULL AND child."raw_position_code" IS NOT NULL AND child."position_mapping_version" IS NOT NULL AND child."position_code" IS NOT NULL AND child."position_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."position_mappings" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."source_id" IS NOT DISTINCT FROM anchor."source_id" AND selected_parent."raw_position_code" IS NOT DISTINCT FROM anchor."raw_position_code" AND selected_parent."position_code" IS NOT DISTINCT FROM anchor."position_code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_players / football_match_players_sv_source_id_raw_position_cod_d20ac20ff0'; END IF;
IF EXISTS (SELECT 1 FROM "football"."metric_definitions" child JOIN "football"."metric_definitions" anchor ON anchor."code" = child."numerator_code" AND anchor."definition_version" = child."numerator_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."numerator_code" IS NOT NULL AND child."numerator_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."metric_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.metric_definitions / football_metric_definitions_numerator_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."metric_definitions" child JOIN "football"."metric_definitions" anchor ON anchor."code" = child."denominator_code" AND anchor."definition_version" = child."denominator_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."denominator_code" IS NOT NULL AND child."denominator_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."metric_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.metric_definitions / football_metric_definitions_denominator_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."source_metric_mappings" child JOIN "football"."metric_definitions" anchor ON anchor."code" = child."metric_code" AND anchor."definition_version" = child."metric_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."metric_code" IS NOT NULL AND child."metric_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."metric_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.source_metric_mappings / football_source_metric_mappings_metric_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_stats" child JOIN "football"."match_players" anchor ON anchor."match_id" = child."match_id" AND anchor."player_id" = child."player_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_player_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."player_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_player_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_players" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."position_code" IS NOT DISTINCT FROM anchor."position_code" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_stats / football_player_match_stats_match_id_player_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_stats" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_stats / football_player_match_stats_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_stats" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_stats / football_team_match_stats_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_stats" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_stats / football_team_match_stats_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.shots / football_shots_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.shots / football_shots_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" child JOIN "football"."player_profile_versions" anchor ON anchor."id" = child."player_profile_version_id" AND anchor."player_id" = child."player_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."player_profile_version_id" IS NOT NULL AND child."player_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."player_profile_versions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."profile_context" IS NOT DISTINCT FROM anchor."profile_context")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.shots / football_shots_player_profile_version_id_player_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" child JOIN "football"."player_profile_versions" anchor ON anchor."id" = child."keeper_profile_version_id" AND anchor."player_id" = child."keeper_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."keeper_profile_version_id" IS NOT NULL AND child."keeper_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."player_profile_versions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."profile_context" IS NOT DISTINCT FROM anchor."profile_context")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.shots / football_shots_keeper_profile_version_id_keeper_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_advanced" child JOIN "football"."match_players" anchor ON anchor."match_id" = child."match_id" AND anchor."player_id" = child."player_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_player_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."player_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_player_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_players" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."position_code" IS NOT DISTINCT FROM anchor."position_code" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_advanced / football_player_match_advanced_match_id_player_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_advanced" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_advanced / football_player_match_advanced_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_advanced" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_advanced / football_team_match_advanced_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_advanced" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_advanced / football_team_match_advanced_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_events" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_events / football_match_events_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_events" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_events / football_match_events_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_events" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_events / football_match_events_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_events" child JOIN "ingest"."match_coverage" anchor ON anchor."match_id" = child."match_id" AND anchor."source_id" = child."source_id" AND anchor."feature_code" = child."feature_code" AND anchor."variant_key" = child."variant_key" AND anchor."recorded_from_gen" = child."recorded_from_gen" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."source_id" IS NOT NULL AND child."feature_code" IS NOT NULL AND child."variant_key" IS NOT NULL AND child."recorded_from_gen" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ingest"."match_coverage" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."source_id" IS NOT DISTINCT FROM anchor."source_id" AND selected_parent."feature_code" IS NOT DISTINCT FROM anchor."feature_code" AND selected_parent."variant_key" IS NOT DISTINCT FROM anchor."variant_key")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_events / football_match_events_sv_match_id_source_id_feature__b755fa8806'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_momentum" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_momentum / football_match_momentum_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_momentum" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_momentum / football_match_momentum_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_momentum" child JOIN "ingest"."match_coverage" anchor ON anchor."match_id" = child."match_id" AND anchor."source_id" = child."source_id" AND anchor."feature_code" = child."feature_code" AND anchor."variant_key" = child."variant_key" AND anchor."recorded_from_gen" = child."recorded_from_gen" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."source_id" IS NOT NULL AND child."feature_code" IS NOT NULL AND child."variant_key" IS NOT NULL AND child."recorded_from_gen" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ingest"."match_coverage" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."source_id" IS NOT DISTINCT FROM anchor."source_id" AND selected_parent."feature_code" IS NOT DISTINCT FROM anchor."feature_code" AND selected_parent."variant_key" IS NOT DISTINCT FROM anchor."variant_key")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_momentum / football_match_momentum_sv_match_id_source_id_featur_94bc9ad5bd'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_networks" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.pass_networks / football_pass_networks_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."pass_network_nodes" child JOIN "football"."pass_networks" anchor ON anchor."id" = child."network_id" WHERE EXISTS (SELECT 1 FROM "football"."pass_networks" selection_parent_0 WHERE selection_parent_0."id" = child."network_id" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."network_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."pass_networks" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id" AND selected_parent."window_kind" IS NOT DISTINCT FROM anchor."window_kind" AND selected_parent."from_seconds" IS NOT DISTINCT FROM anchor."from_seconds" AND selected_parent."until_seconds" IS NOT DISTINCT FROM anchor."until_seconds")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.pass_network_nodes / football_pass_network_nodes_network_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_heatmaps / football_match_heatmaps_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmaps" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_heatmaps / football_match_heatmaps_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_coach_tenures" child JOIN "football"."coaches" anchor ON anchor."id" = child."coach_id" AND anchor."revision_id" = child."coach_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."coach_id" IS NOT NULL AND child."coach_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."coaches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_coach_tenures / football_team_coach_tenures_coach_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."honour_definitions" child JOIN "football"."competitions" anchor ON anchor."id" = child."competition_id" AND anchor."revision_id" = child."competition_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_id" IS NOT NULL AND child."competition_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."association_id" IS NOT DISTINCT FROM anchor."association_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.honour_definitions / football_honour_definitions_competition_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" child JOIN "football"."honour_definitions" anchor ON anchor."id" = child."honour_id" AND anchor."revision_id" = child."honour_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."honour_id" IS NOT NULL AND child."honour_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."honour_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_honours / football_player_honours_honour_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" child JOIN "football"."competition_seasons" anchor ON anchor."id" = child."competition_season_id" AND anchor."revision_id" = child."competition_season_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_season_id" IS NOT NULL AND child."competition_season_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_seasons" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_honours / football_player_honours_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" child JOIN "football"."honour_definitions" anchor ON anchor."id" = child."honour_id" AND anchor."revision_id" = child."honour_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."honour_id" IS NOT NULL AND child."honour_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."honour_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_honours / football_team_honours_honour_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" child JOIN "football"."competition_seasons" anchor ON anchor."id" = child."competition_season_id" AND anchor."revision_id" = child."competition_season_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."competition_season_id" IS NOT NULL AND child."competition_season_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_seasons" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_honours / football_team_honours_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."standing_snapshots" child JOIN "football"."competition_seasons" anchor ON anchor."id" = child."competition_season_id" AND anchor."revision_id" = child."competition_season_revision_id" WHERE child."recorded_from_gen" <= g AND NOT EXISTS (SELECT 1 FROM "football"."standing_snapshots" newer_observation_0 WHERE child."source_record_id" IS NOT DISTINCT FROM newer_observation_0."source_record_id" AND child."competition_season_id" IS NOT DISTINCT FROM newer_observation_0."competition_season_id" AND child."stage_id" IS NOT DISTINCT FROM newer_observation_0."stage_id" AND child."group_id" IS NOT DISTINCT FROM newer_observation_0."group_id" AND child."group_label" IS NOT DISTINCT FROM newer_observation_0."group_label" AND child."scope" IS NOT DISTINCT FROM newer_observation_0."scope" AND newer_observation_0."recorded_from_gen" <= g AND newer_observation_0."recorded_from_gen" > child."recorded_from_gen") AND child."competition_season_id" IS NOT NULL AND child."competition_season_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_seasons" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_id" IS NOT DISTINCT FROM anchor."competition_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.standing_snapshots / football_standing_snapshots_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."standing_snapshots" child JOIN "football"."competition_stages" anchor ON anchor."id" = child."stage_id" AND anchor."competition_season_id" = child."competition_season_id" AND anchor."revision_id" = child."stage_revision_id" WHERE child."recorded_from_gen" <= g AND NOT EXISTS (SELECT 1 FROM "football"."standing_snapshots" newer_observation_0 WHERE child."source_record_id" IS NOT DISTINCT FROM newer_observation_0."source_record_id" AND child."competition_season_id" IS NOT DISTINCT FROM newer_observation_0."competition_season_id" AND child."stage_id" IS NOT DISTINCT FROM newer_observation_0."stage_id" AND child."group_id" IS NOT DISTINCT FROM newer_observation_0."group_id" AND child."group_label" IS NOT DISTINCT FROM newer_observation_0."group_label" AND child."scope" IS NOT DISTINCT FROM newer_observation_0."scope" AND newer_observation_0."recorded_from_gen" <= g AND newer_observation_0."recorded_from_gen" > child."recorded_from_gen") AND child."stage_id" IS NOT NULL AND child."competition_season_id" IS NOT NULL AND child."stage_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_stages" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."parent_stage_id" IS NOT DISTINCT FROM anchor."parent_stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.standing_snapshots / football_standing_snapshots_stage_id_competition_season_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."standing_snapshots" child JOIN "football"."competition_groups" anchor ON anchor."id" = child."group_id" AND anchor."stage_id" = child."stage_id" AND anchor."competition_season_id" = child."competition_season_id" AND anchor."revision_id" = child."group_revision_id" WHERE child."recorded_from_gen" <= g AND NOT EXISTS (SELECT 1 FROM "football"."standing_snapshots" newer_observation_0 WHERE child."source_record_id" IS NOT DISTINCT FROM newer_observation_0."source_record_id" AND child."competition_season_id" IS NOT DISTINCT FROM newer_observation_0."competition_season_id" AND child."stage_id" IS NOT DISTINCT FROM newer_observation_0."stage_id" AND child."group_id" IS NOT DISTINCT FROM newer_observation_0."group_id" AND child."group_label" IS NOT DISTINCT FROM newer_observation_0."group_label" AND child."scope" IS NOT DISTINCT FROM newer_observation_0."scope" AND newer_observation_0."recorded_from_gen" <= g AND newer_observation_0."recorded_from_gen" > child."recorded_from_gen") AND child."group_id" IS NOT NULL AND child."stage_id" IS NOT NULL AND child."competition_season_id" IS NOT NULL AND child."group_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."competition_groups" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.standing_snapshots / football_standing_snapshots_group_id_stage_id_competi_f64b0944f'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_metric_values" child JOIN "football"."metric_definitions" anchor ON anchor."code" = child."metric_code" AND anchor."definition_version" = child."metric_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."metric_code" IS NOT NULL AND child."metric_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."metric_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_metric_values / football_player_match_metric_values_metric_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_metric_values" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_metric_values / football_player_match_metric_values_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_metric_values" child JOIN "football"."match_players" anchor ON anchor."match_id" = child."match_id" AND anchor."player_id" = child."player_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_player_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."player_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_player_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_players" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."position_code" IS NOT DISTINCT FROM anchor."position_code" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.player_match_metric_values / football_player_match_metric_values_match_id_player__ce4af89a9f'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_metric_values" child JOIN "football"."metric_definitions" anchor ON anchor."code" = child."metric_code" AND anchor."definition_version" = child."metric_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."metric_code" IS NOT NULL AND child."metric_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."metric_definitions" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_metric_values / football_team_match_metric_values_metric_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_metric_values" child JOIN "football"."periods" anchor ON anchor."code" = child."period_code" AND anchor."definition_version" = child."period_definition_version" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."period_code" IS NOT NULL AND child."period_definition_version" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."periods" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."code" IS NOT DISTINCT FROM anchor."code")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_metric_values / football_team_match_metric_values_period_code_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_metric_values" child JOIN "football"."match_teams" anchor ON anchor."match_id" = child."match_id" AND anchor."team_id" = child."team_id" AND anchor."revision_id" = child."match_team_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."match_id" IS NOT NULL AND child."team_id" IS NOT NULL AND child."match_team_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_teams" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."side" IS NOT DISTINCT FROM anchor."side" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_match_metric_values / football_team_match_metric_values_match_id_team_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_heatmap_cells" child JOIN "football"."match_heatmaps" anchor ON anchor."id" = child."heatmap_id" WHERE EXISTS (SELECT 1 FROM "football"."match_heatmaps" selection_parent_0 WHERE selection_parent_0."id" = child."heatmap_id" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."heatmap_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."match_heatmaps" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."team_id" IS NOT DISTINCT FROM anchor."team_id" AND selected_parent."player_id" IS NOT DISTINCT FROM anchor."player_id" AND selected_parent."period_code" IS NOT DISTINCT FROM anchor."period_code" AND selected_parent."map_kind" IS NOT DISTINCT FROM anchor."map_kind")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_heatmap_cells / football_match_heatmap_cells_heatmap_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_h2h_entries" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_h2h_entries / football_match_h2h_entries_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_h2h_entries" child JOIN "football"."matches" anchor ON anchor."id" = child."previous_match_id" AND anchor."revision_id" = child."previous_match_revision_id" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."previous_match_id" IS NOT NULL AND child."previous_match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_h2h_entries / football_match_h2h_entries_previous_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_h2h_entries" child JOIN "ingest"."match_coverage" anchor ON anchor."match_id" = child."match_id" AND anchor."source_id" = child."source_id" AND anchor."feature_code" = child."feature_code" AND anchor."variant_key" = child."variant_key" AND anchor."recorded_from_gen" = child."recorded_from_gen" WHERE EXISTS (SELECT 1 FROM "ingest"."match_coverage" selection_parent_0 WHERE selection_parent_0."match_id" = child."match_id" AND selection_parent_0."source_id" = child."source_id" AND selection_parent_0."feature_code" = child."feature_code" AND selection_parent_0."variant_key" = child."variant_key" AND selection_parent_0."recorded_from_gen" = child."recorded_from_gen" AND ingest.selected_at(g,selection_parent_0."recorded_from_gen",selection_parent_0."recorded_to_gen") AND selection_parent_0."is_canonical") AND child."match_id" IS NOT NULL AND child."source_id" IS NOT NULL AND child."feature_code" IS NOT NULL AND child."variant_key" IS NOT NULL AND child."recorded_from_gen" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ingest"."match_coverage" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND selected_parent."match_id" IS NOT DISTINCT FROM anchor."match_id" AND selected_parent."source_id" IS NOT DISTINCT FROM anchor."source_id" AND selected_parent."feature_code" IS NOT DISTINCT FROM anchor."feature_code" AND selected_parent."variant_key" IS NOT DISTINCT FROM anchor."variant_key")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_h2h_entries / football_match_h2h_entries_sv_match_id_source_id_fea_8ba4929553'; END IF;
IF EXISTS (SELECT 1 FROM "football"."match_observation_details" child JOIN "football"."matches" anchor ON anchor."id" = child."match_id" AND anchor."revision_id" = child."match_revision_id" WHERE child."recorded_from_gen" <= g AND NOT EXISTS (SELECT 1 FROM "football"."match_observation_details" newer_observation_0 WHERE child."source_record_id" IS NOT DISTINCT FROM newer_observation_0."source_record_id" AND newer_observation_0."recorded_from_gen" <= g AND newer_observation_0."recorded_from_gen" > child."recorded_from_gen") AND child."match_id" IS NOT NULL AND child."match_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."matches" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id" AND selected_parent."competition_season_id" IS NOT DISTINCT FROM anchor."competition_season_id" AND selected_parent."group_id" IS NOT DISTINCT FROM anchor."group_id" AND selected_parent."stage_id" IS NOT DISTINCT FROM anchor."stage_id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.match_observation_details / football_match_observation_details_match_id_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_profile_versions" child JOIN "football"."countries" anchor ON anchor."id" = child."country_id" AND anchor."revision_id" = child."country_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."country_id" IS NOT NULL AND child."country_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."countries" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.team_profile_versions / football_team_profile_versions_sv_country_id_countries_fk'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_profile_versions" child JOIN "football"."countries" anchor ON anchor."id" = child."country_id" AND anchor."revision_id" = child."country_revision_id" WHERE ingest.selected_at(g,child."recorded_from_gen",child."recorded_to_gen") AND child."is_canonical" AND NOT child."is_deleted" AND child."country_id" IS NOT NULL AND child."country_revision_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "football"."countries" selected_parent WHERE ingest.selected_at(g,selected_parent."recorded_from_gen",selected_parent."recorded_to_gen") AND selected_parent."is_canonical" AND NOT selected_parent."is_deleted" AND selected_parent."id" IS NOT DISTINCT FROM anchor."id")) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected parent membership differs at generation: football.association_profile_versions / football_association_profile_versions_sv_country_id__6bd74b4891'; END IF;
IF EXISTS (SELECT 1 FROM football.matches m WHERE ingest.selected_at(g,m."recorded_from_gen",m."recorded_to_gen") AND m."is_canonical" AND NOT m."is_deleted" AND m.publication_state='published' AND (
        (SELECT count(*) FROM football.match_teams t WHERE t.match_id=m.id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted") <> 2 OR
        NOT EXISTS (SELECT 1 FROM football.match_teams t WHERE t.match_id=m.id AND t.side='home' AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted") OR
        NOT EXISTS (SELECT 1 FROM football.match_teams t WHERE t.match_id=m.id AND t.side='away' AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted") OR
        EXISTS (SELECT 1 FROM football.match_teams t WHERE t.match_id=m.id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted" AND t.team_id IS NULL
            AND (m.status NOT IN ('not_started','postponed','canceled','unknown') OR t.participant_label IS NULL OR btrim(t.participant_label)='')) OR
        (SELECT count(DISTINCT t.team_id) FROM football.match_teams t WHERE t.match_id=m.id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted") <
        (SELECT count(t.team_id) FROM football.match_teams t WHERE t.match_id=m.id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted")
    )) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A published match requires two valid, distinct participants'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_match_stats" f WHERE ingest.selected_at(g,f."recorded_from_gen",f."recorded_to_gen") AND f."is_canonical" AND NOT f."is_deleted" AND (SELECT count(*) FROM football.match_teams t WHERE t.match_id=f.match_id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted" AND t.team_id IS NOT NULL) <> 2) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Accepted facts require two known match teams: football.player_match_stats'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_match_stats" f WHERE ingest.selected_at(g,f."recorded_from_gen",f."recorded_to_gen") AND f."is_canonical" AND NOT f."is_deleted" AND (SELECT count(*) FROM football.match_teams t WHERE t.match_id=f.match_id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted" AND t.team_id IS NOT NULL) <> 2) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Accepted facts require two known match teams: football.team_match_stats'; END IF;
IF EXISTS (SELECT 1 FROM "football"."shots" f WHERE ingest.selected_at(g,f."recorded_from_gen",f."recorded_to_gen") AND f."is_canonical" AND NOT f."is_deleted" AND (SELECT count(*) FROM football.match_teams t WHERE t.match_id=f.match_id AND ingest.selected_at(g,t."recorded_from_gen",t."recorded_to_gen") AND t."is_canonical" AND NOT t."is_deleted" AND t.team_id IS NOT NULL) <> 2) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Accepted facts require two known match teams: football.shots'; END IF;
IF EXISTS (SELECT 1 FROM ingest.match_coverage fresh WHERE fresh.recorded_from_gen=g AND fresh.is_canonical
            AND fresh.coverage_state IN ('failed','invalid','pending','not_requested')) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A failed or partial request cannot become an accepted canonical collection'; END IF;
IF EXISTS (SELECT 1 FROM ingest.match_coverage fresh JOIN ingest.match_coverage prior
            ON prior.match_id=fresh.match_id AND prior.feature_code=fresh.feature_code AND prior.recorded_to_gen=g AND prior.is_canonical
            WHERE fresh.recorded_from_gen=g AND fresh.is_canonical AND fresh.collection_state IN ('absent','unavailable')
            AND prior.collection_state IN ('present','empty')) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='An absent/unavailable request cannot clear an accepted collection'; END IF;
IF EXISTS (SELECT 1 FROM ingest.match_coverage p WHERE p.recorded_from_gen=g AND p.feature_code='events' AND (SELECT count(*) FROM "football"."match_events" c WHERE c."match_id" = p."match_id" AND c."source_id" = p."source_id" AND c."feature_code" = p."feature_code" AND c."variant_key" = p."variant_key" AND c."recorded_from_gen" = p."recorded_from_gen") <> COALESCE(p.observed_row_count,0)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Collection child count differs from its full typed parent: football.match_events'; END IF;
IF EXISTS (SELECT 1 FROM ingest.match_coverage p WHERE p.recorded_from_gen=g AND p.feature_code='momentum' AND (SELECT count(*) FROM "football"."match_momentum" c WHERE c."match_id" = p."match_id" AND c."source_id" = p."source_id" AND c."feature_code" = p."feature_code" AND c."variant_key" = p."variant_key" AND c."recorded_from_gen" = p."recorded_from_gen") <> COALESCE(p.observed_row_count,0)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Collection child count differs from its full typed parent: football.match_momentum'; END IF;
IF EXISTS (SELECT 1 FROM ingest.match_coverage p WHERE p.recorded_from_gen=g AND p.feature_code='h2h' AND (SELECT count(*) FROM "football"."match_h2h_entries" c WHERE c."match_id" = p."match_id" AND c."source_id" = p."source_id" AND c."feature_code" = p."feature_code" AND c."variant_key" = p."variant_key" AND c."recorded_from_gen" = p."recorded_from_gen") <> COALESCE(p.observed_row_count,0)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Collection child count differs from its full typed parent: football.match_h2h_entries'; END IF;
IF EXISTS (SELECT 1 FROM ingest.match_coverage p WHERE ingest.selected_at(g,p."recorded_from_gen",p."recorded_to_gen") AND p.feature_code='shots' AND (SELECT count(*) FROM football.shots s WHERE ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND NOT s."is_deleted" AND s.match_id=p.match_id AND s.source_id=p.source_id AND s.variant_key=p.variant_key) <> COALESCE(p.observed_row_count,0)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Shot count differs from selected source/variant coverage'; END IF;
IF EXISTS (SELECT 1 FROM football.shots s WHERE ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND s."is_canonical" AND NOT s."is_deleted" AND NOT EXISTS (SELECT 1 FROM ingest.match_coverage p WHERE ingest.selected_at(g,p."recorded_from_gen",p."recorded_to_gen") AND p."is_canonical" AND p.feature_code='shots' AND p.match_id=s.match_id AND p.source_id=s.source_id AND p.variant_key=s.variant_key AND p.collection_state='present')) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Canonical shots require the selected complete source/variant family'; END IF;
IF EXISTS (SELECT 1 FROM football.match_heatmap_cells c JOIN football.match_heatmaps p ON p.id=c.heatmap_id
            WHERE p.recorded_from_gen=g AND (p.cells_state <> 'available' OR c.column_index >= p.grid_columns OR c.row_index >= p.grid_rows)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Heatmap cells must be present and bounded by their exact parent grid'; END IF;
IF EXISTS (SELECT 1 FROM football.match_heatmaps p WHERE p.recorded_from_gen=g AND p.cells_state='available'
            AND NOT EXISTS (SELECT 1 FROM football.match_heatmap_cells c WHERE c.heatmap_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='An available heatmap has at least one typed cell'; END IF;
IF EXISTS (WITH RECURSIVE nodes AS (SELECT s.id AS id,s.parent_stage_id AS parent FROM football.competition_stages s WHERE ingest.selected_at(g,s."recorded_from_gen",s."recorded_to_gen") AND s."is_canonical" AND NOT s."is_deleted"),
      walk(root,node,path) AS (
        SELECT id,parent,ARRAY[id] FROM nodes WHERE parent IS NOT NULL
        UNION ALL SELECT w.root,n.parent,w.path||n.id FROM walk w JOIN nodes n ON n.id=w.node
          WHERE w.node IS NOT NULL AND NOT w.node=ANY(w.path)
      ) SELECT 1 FROM walk WHERE node=ANY(path)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected competition stages must be acyclic'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_honours" f JOIN football.honour_definitions h ON h.id=f.honour_id AND ingest.selected_at(g,h."recorded_from_gen",h."recorded_to_gen") AND h."is_canonical" AND NOT h."is_deleted" LEFT JOIN football.competition_seasons cs ON cs.id=f.competition_season_id AND ingest.selected_at(g,cs."recorded_from_gen",cs."recorded_to_gen") AND cs."is_canonical" AND NOT cs."is_deleted" WHERE ingest.selected_at(g,f."recorded_from_gen",f."recorded_to_gen") AND f."is_canonical" AND NOT f."is_deleted" AND ((f.competition_season_id IS NOT NULL AND h.competition_id IS NOT NULL AND cs.competition_id IS DISTINCT FROM h.competition_id) OR h.honour_type <> 'team')) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Honour edition/type disagrees with selected definition: football.team_honours'; END IF;
IF EXISTS (SELECT 1 FROM "football"."player_honours" f JOIN football.honour_definitions h ON h.id=f.honour_id AND ingest.selected_at(g,h."recorded_from_gen",h."recorded_to_gen") AND h."is_canonical" AND NOT h."is_deleted" LEFT JOIN football.competition_seasons cs ON cs.id=f.competition_season_id AND ingest.selected_at(g,cs."recorded_from_gen",cs."recorded_to_gen") AND cs."is_canonical" AND NOT cs."is_deleted" WHERE ingest.selected_at(g,f."recorded_from_gen",f."recorded_to_gen") AND f."is_canonical" AND NOT f."is_deleted" AND ((f.competition_season_id IS NOT NULL AND h.competition_id IS NOT NULL AND cs.competition_id IS DISTINCT FROM h.competition_id))) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Honour edition/type disagrees with selected definition: football.player_honours'; END IF;
IF EXISTS (SELECT 1 FROM "football"."team_ranking_entries" e JOIN football.ranking_snapshots s ON s.id=e.snapshot_id
              JOIN ingest.source_records r ON r.id=e.source_record_id WHERE s.recorded_from_gen=g AND NOT EXISTS (
                WITH RECURSIVE documents(id) AS (SELECT s.source_document_id UNION
                  SELECT l.parent_document_id FROM ingest.document_lineage l JOIN documents d ON l.derived_document_id=d.id)
                SELECT 1 FROM documents WHERE id=r.document_id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ranking entry source record requires the snapshot document or declared ancestor lineage: football.team_ranking_entries'; END IF;
IF EXISTS (SELECT 1 FROM "football"."association_ranking_entries" e JOIN football.ranking_snapshots s ON s.id=e.snapshot_id
              JOIN ingest.source_records r ON r.id=e.source_record_id WHERE s.recorded_from_gen=g AND NOT EXISTS (
                WITH RECURSIVE documents(id) AS (SELECT s.source_document_id UNION
                  SELECT l.parent_document_id FROM ingest.document_lineage l JOIN documents d ON l.derived_document_id=d.id)
                SELECT 1 FROM documents WHERE id=r.document_id)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ranking entry source record requires the snapshot document or declared ancestor lineage: football.association_ranking_entries'; END IF;
END;
$orion_pro$;
REVOKE ALL ON FUNCTION "ingest"."validate_generation"(bigint) FROM PUBLIC;
