-- The Turkish second division (TFF 1. Lig, PitchAPI l_1BFfna) has Turkey for its country: PitchAPI
-- writes "INT", which made its matches read as international ones (no league, no level, no
-- table). The collect now writes the reviewed country (store.COMPETITION_COUNTRIES); this fixes
-- the row before its next collect.
INSERT INTO core.countries(code) VALUES ('TUR') ON CONFLICT DO NOTHING;
UPDATE core.competitions c SET country_code = 'TUR', updated_at = now()
FROM core.provider_ids p
WHERE p.entity_type = 'competition' AND p.provider = 'pitchapi' AND p.provider_key = 'l_1BFfna' AND p.entity_id = c.id
  AND c.country_code IS DISTINCT FROM 'TUR';
