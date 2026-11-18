-- The two World Cup family media bindings require specific family artwork provenance (VI-27).
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.family_artwork_qualifications (
    competition_id integer NOT NULL REFERENCES core.competitions(id),
    asset_id integer NOT NULL REFERENCES core.assets(id),
    certificate jsonb NOT NULL CHECK (certificate ->> 'asset_role' = 'competition_logo' AND certificate ->> 'competition_identity_only' = 'true'),
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (competition_id, asset_id)
);
REVOKE ALL ON core.family_artwork_qualifications FROM PUBLIC, vega_collect, vega_read;
GRANT SELECT, INSERT ON core.family_artwork_qualifications TO vega_collect;

CREATE FUNCTION core.family_artwork_requires_proof(competition integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS(
        SELECT 1 FROM core.provider_ids
        WHERE entity_type='competition' AND entity_id=competition AND
          ((provider='vega' AND provider_key='cup:open-cups:world-cup-history') OR
           (provider='pitchapi' AND provider_key='l_1XLtP0'))
    )
$$;
REVOKE ALL ON FUNCTION core.family_artwork_requires_proof(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.family_artwork_requires_proof(integer) TO vega_collect;

-- Keep a previously accepted family logo and let the rest of an old writer's update proceed.
CREATE FUNCTION core.require_family_artwork_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.logo_asset_id IS NOT NULL AND NEW.logo_asset_id IS DISTINCT FROM OLD.logo_asset_id
       AND core.family_artwork_requires_proof(NEW.id)
       AND NOT EXISTS (SELECT 1 FROM core.family_artwork_qualifications q
                       WHERE q.competition_id=NEW.id AND q.asset_id=NEW.logo_asset_id) THEN
        NEW.logo_asset_id := OLD.logo_asset_id;
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION core.require_family_artwork_proof() FROM PUBLIC;
CREATE TRIGGER preserve_scope_of_world_cup_artwork BEFORE UPDATE OF logo_asset_id ON core.competitions
FOR EACH ROW EXECUTE FUNCTION core.require_family_artwork_proof();

-- Store.entity initially inserts the image before it creates the PitchAPI provider binding.
CREATE FUNCTION core.check_new_world_cup_artwork_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE core.competitions c SET logo_asset_id=NULL
    WHERE c.id=NEW.entity_id AND c.logo_asset_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.family_artwork_qualifications q
                      WHERE q.competition_id=c.id AND q.asset_id=c.logo_asset_id);
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION core.check_new_world_cup_artwork_binding() FROM PUBLIC;
CREATE TRIGGER check_new_world_cup_artwork_binding AFTER INSERT ON core.provider_ids
FOR EACH ROW WHEN (NEW.entity_type='competition' AND
    ((NEW.provider='vega' AND NEW.provider_key='cup:open-cups:world-cup-history') OR
     (NEW.provider='pitchapi' AND NEW.provider_key='l_1XLtP0')))
EXECUTE FUNCTION core.check_new_world_cup_artwork_binding();

-- Exact RDS family + source URL + image digest observations from the 18 November audit.
WITH confirmed(provider, key, family, url, sha) AS (VALUES
    ('vega', 'cup:open-cups:world-cup-history', 64,
     'https://img.thesports.com/football/competition/da617cd58cd9cffaae0daec865457fb5.png',
     '27eb02a79c3a0f5964d889705d6c70150f0157234089da32b8858dbee0f1a2cd'),
    ('pitchapi', 'l_1XLtP0', 198,
     'https://cdn.pitchapi.dev/images/leagues/676031121ec155fbaa398a16b88b1f94e51f9c1eabf90087480b70b59c7ec04d.webp',
     '676031121ec155fbaa398a16b88b1f94e51f9c1eabf90087480b70b59c7ec04d')
), changed AS (
    UPDATE core.competitions c SET logo_asset_id=NULL, updated_at=now()
    FROM confirmed f, core.provider_ids p, core.assets a
    WHERE c.id=f.family AND p.entity_type='competition' AND p.provider::text=f.provider AND p.provider_key=f.key
      AND p.entity_id=c.id AND a.id=c.logo_asset_id AND a.source_url=f.url AND a.sha256=decode(f.sha,'hex')
    RETURNING c.id
), versions AS (
    SELECT 'competition_season'::ops.resource_kind AS kind, cs.id FROM core.competition_seasons cs WHERE cs.competition_id IN (SELECT id FROM changed)
    UNION ALL SELECT 'home'::ops.resource_kind, 1 WHERE EXISTS (SELECT 1 FROM changed)
)
INSERT INTO ops.resource_versions(resource_kind,resource_id) SELECT kind,id FROM versions
ON CONFLICT (resource_kind,resource_id) DO UPDATE
SET version=ops.resource_versions.version+1, updated_at=now();
