-- A second yellow card is its own provider event (followed by the red card it causes):
-- main counts both. Until now the v2 normalizer refused the whole events family of a
-- match with one; it now keeps it as second_yellow.
ALTER TYPE core.event_type ADD VALUE IF NOT EXISTS 'second_yellow';

-- Cards of a player in a match (legacy /api/read/discipline). Compared as text: the new
-- enum value cannot be named in the transaction that adds it.
CREATE VIEW api.player_cards AS
SELECT e.season_id, e.match_id, e.seq, e.player_id, e.event_type::text AS event_type,
  e.minute, e.minute_added, e.period::text AS period
FROM core.match_events e
WHERE e.player_id IS NOT NULL AND e.event_type::text IN ('yellow_card', 'second_yellow', 'red_card');
