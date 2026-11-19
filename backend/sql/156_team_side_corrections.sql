-- Each match side a reviewed correction moved to the club that played (vega/sources/identity.py SIDE_CORRECTIONS,
-- docs/calculs/09-audit-2026-11/FAILURE_MODES.md §39): FC Barcelona's fifteen matches stored on Ecuador's Barcelona SC.
-- One row per side, written once by the identity pass under the collection role, which may only add to it. The clubs
-- are named by their ids and PitchAPI keys, not by foreign keys: a later merge of either club never rewrites the record.
-- To go back: the row names the side and the club it was on.
SET LOCAL lock_timeout = '3s';

CREATE TABLE core.team_side_corrections (
    match_id integer NOT NULL,
    season_id smallint NOT NULL,
    side text NOT NULL CHECK (side IN ('home', 'away')),
    from_team integer NOT NULL,
    to_team integer NOT NULL CHECK (to_team <> from_team),
    from_key text NOT NULL,
    to_key text NOT NULL,
    correction text NOT NULL,
    proof_sha256 text NOT NULL CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, side),
    FOREIGN KEY (match_id, season_id) REFERENCES core.matches(id, season_id)
);
REVOKE ALL ON core.team_side_corrections FROM PUBLIC, vega_collect, vega_read;
GRANT SELECT, INSERT ON core.team_side_corrections TO vega_collect;
GRANT SELECT ON core.team_side_corrections TO vega_calc;
