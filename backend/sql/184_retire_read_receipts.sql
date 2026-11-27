-- GH137R.3 (docs/calculs/09-audit-2026-11/FAILURE_MODES_OPTIMISATIONS.md): the read receipts of 183 are retired. In
-- production no conditional request ever met a current receipt (review of 27 Nov 2026): the five reads answer by their
-- own statements, as before 183. What 183 added goes: the scoped marks' triggers and function, the receipts, their
-- discovery cursors, the functions reading and writing them, the worker's right to read as vega_read. What stays: 182
-- as it is (the whole-table marks, ops.scoped_data_version behind api.data_version), api.matchday_editions and 183's
-- api.matchday_rounds (the matchdays read).
-- Not marked online: dropping a trigger takes an ACCESS EXCLUSIVE lock on its table (core.matches, core.match_events
-- and three more, which the writers write), so the services are stopped while it applies.

-- The read API keeps reading meanwhile. Every table lock this file needs, taken together or not at all: taken in turn,
-- a read holding one of these tables and asking for another would wait on this transaction while it waits on the read
-- (a deadlock: one of the two cancelled), and every read arriving behind a waiting exclusive request would queue.
-- NOWAIT asks without queueing, the block's failure releases what it had taken, and it is asked again 50 ms later. After
-- 10 s of that, one ordinary request: a wait rather than a Deploy failed with its services stopped.
DO $$
DECLARE
  attempts integer := 0;
BEGIN
  LOOP
    BEGIN
      LOCK TABLE core.matches, core.match_events, core.league_player_seasons, core.player_transfers,
        ops.transfermarkt_reads, ops.read_receipts, ops.read_receipt_discovery IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempts := attempts + 1;
      IF attempts >= 200 THEN
        LOCK TABLE core.matches, core.match_events, core.league_player_seasons, core.player_transfers,
          ops.transfermarkt_reads, ops.read_receipts, ops.read_receipt_discovery IN ACCESS EXCLUSIVE MODE;
        EXIT;
      END IF;
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
END
$$;

DO $$
DECLARE
  relation text;
  name text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['core.matches', 'core.match_events', 'core.league_player_seasons',
    'core.player_transfers', 'ops.transfermarkt_reads']
  LOOP
    FOREACH name IN ARRAY ARRAY['vega_scope_insert', 'vega_scope_update', 'vega_scope_delete', 'vega_scope_truncate']
    LOOP
      -- A partitioned table's row triggers go with their partitions' copies.
      EXECUTE format('DROP TRIGGER %I ON %s', name, relation);
    END LOOP;
  END LOOP;
END
$$;
DROP FUNCTION ops.mark_scoped_change();

DROP FUNCTION api.read_receipt(text,text,text);
DROP FUNCTION ops.put_read_receipt(text,text,text,text[],text[],text);
DROP FUNCTION ops.check_read_receipts(text,integer);
DROP FUNCTION ops.missing_history_receipts(text[],integer);
DROP FUNCTION ops.discover_read_receipts(text,integer);
DROP FUNCTION ops.receipt_version(text[],text[]);
DROP FUNCTION api.player_transfer_scope(text);
DROP TABLE ops.read_receipts;
DROP TABLE ops.read_receipt_discovery;

-- 183 gave it for the preparation alone (SET LOCAL ROLE vega_read).
REVOKE vega_read FROM vega_calc;

-- The scoped marks and their folded counts: nothing reads a scope any more (api.data_version asks none), and no
-- trigger writes one. The whole-table rows (scope '') stay as they are: every version a reader holds stays right.
DELETE FROM ops.data_changes WHERE scope <> '';
DELETE FROM ops.data_versions WHERE scope <> '';
