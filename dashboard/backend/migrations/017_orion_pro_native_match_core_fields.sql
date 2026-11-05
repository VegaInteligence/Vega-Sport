-- Separately approved six typed core fields; no new table, JSONB or history.

-- Exact016 parent: 12d63eaab6f4d610de3f2ff4efc0dcd71059c4d2e489a5f30d62d2a8498fd087.

ALTER TABLE "football"."match_observation_details" ADD COLUMN "source_referee_label" text;

COMMENT ON COLUMN "football"."match_observation_details"."source_referee_label" IS 'Exact source referee label';

ALTER TABLE "football"."match_observation_details" ADD COLUMN "source_referee_state" text DEFAULT 'unrecorded' NOT NULL;

COMMENT ON COLUMN "football"."match_observation_details"."source_referee_state" IS 'Explicit source presence for source_referee_label; unrecorded is unknown, not absence';

ALTER TABLE "football"."match_observation_details" ADD CONSTRAINT "match_observation_source_referee_state_ck" CHECK ((source_referee_state IN ('unrecorded','absent','null') AND source_referee_label IS NULL) OR (source_referee_state='value' AND source_referee_label IS NOT NULL));

ALTER TABLE "football"."match_observation_details" ADD COLUMN "source_has_playoff" boolean;

COMMENT ON COLUMN "football"."match_observation_details"."source_has_playoff" IS 'Exact source playoff indicator';

ALTER TABLE "football"."match_observation_details" ADD COLUMN "source_has_playoff_state" text DEFAULT 'unrecorded' NOT NULL;

COMMENT ON COLUMN "football"."match_observation_details"."source_has_playoff_state" IS 'Explicit source presence for source_has_playoff; unrecorded is unknown, not absence';

ALTER TABLE "football"."match_observation_details" ADD CONSTRAINT "match_observation_source_has_playoff_state_ck" CHECK ((source_has_playoff_state IN ('unrecorded','absent','null') AND source_has_playoff IS NULL) OR (source_has_playoff_state='value' AND source_has_playoff IS NOT NULL));

ALTER TABLE "football"."match_observation_details" ADD COLUMN "source_league_image_url" text;

COMMENT ON COLUMN "football"."match_observation_details"."source_league_image_url" IS 'Exact observed league image URL; independent of media delivery';

ALTER TABLE "football"."match_observation_details" ADD COLUMN "source_league_image_url_state" text DEFAULT 'unrecorded' NOT NULL;

COMMENT ON COLUMN "football"."match_observation_details"."source_league_image_url_state" IS 'Explicit source presence for source_league_image_url; unrecorded is unknown, not absence';

ALTER TABLE "football"."match_observation_details" ADD CONSTRAINT "match_observation_source_league_image_url_state_ck" CHECK ((source_league_image_url_state IN ('unrecorded','absent','null') AND source_league_image_url IS NULL) OR (source_league_image_url_state='value' AND source_league_image_url IS NOT NULL));

CREATE OR REPLACE FUNCTION ingest.native107_no_publication_downgrade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $native107$
DECLARE
 incoming integer;
BEGIN
 SELECT CASE
  WHEN b.metrics_contract_version='orion_pro_native107_core_v1' AND b.transform_version='orion_pro_publish_native107_core_v1' THEN 2
  WHEN b.metrics_contract_version='orion_pro_native107_v1' AND b.transform_version='orion_pro_publish_native107_v1' THEN 1
  ELSE 0 END INTO incoming FROM analytics.aggregation_builds b WHERE b.id=NEW.build_id;
 IF EXISTS (SELECT 1 FROM analytics.publication_versions p JOIN analytics.aggregation_builds b ON b.id=p.build_id
     WHERE p.competition_season_id=NEW.competition_season_id AND p.published_to_gen=NEW.published_from_gen
       AND (CASE
        WHEN b.metrics_contract_version='orion_pro_native107_core_v1' AND b.transform_version='orion_pro_publish_native107_core_v1' THEN 2
        WHEN b.metrics_contract_version='orion_pro_native107_v1' AND b.transform_version='orion_pro_publish_native107_v1' THEN 1
        ELSE 0 END)>coalesce(incoming,0)) THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='native107: publication cannot downgrade to the previous contract';
 END IF;
 RETURN NEW;
END;
$native107$;
REVOKE ALL ON FUNCTION ingest.native107_no_publication_downgrade() FROM PUBLIC;
