-- The reader's search of one of our clubs on the provider (a unit keyed by our team's id):
-- a club no vote reaches (its players are not in the snapshot) is found by its name and
-- confirmed by its squad.
SET LOCAL lock_timeout = '3s';
ALTER TABLE ops.transfermarkt_reads DROP CONSTRAINT transfermarkt_reads_kind_check,
  ADD CONSTRAINT transfermarkt_reads_kind_check CHECK (kind IN ('profile', 'values', 'transfers', 'injuries', 'squad', 'club', 'search'));
