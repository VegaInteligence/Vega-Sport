-- Project only verified Vega links from the active, immutable source archive.
CREATE OR REPLACE VIEW statarena_app.player_market_value_history AS
SELECT link.document->>'vega_player_id' AS player_id,
       active.value->>'path' AS snapshot_path,
       link.document_path AS identity_path,
       source.document->'history' AS history
  FROM statarena.state AS active
  JOIN statarena.current_file_documents AS link
    ON link.source_path = active.value->>'path'
   AND link.document->>'kind' = 'vega_market_value_identity'
  JOIN statarena.current_file_documents AS source
    ON source.source_path = link.source_path
   AND source.document_path = link.source_path || '!/source/' ||
       (link.document->>'source_player_id') || '.json'
   AND source.document->>'kind' = 'source_market_value_history'
 WHERE active.name = 'player_market_value_snapshot_v1';

GRANT SELECT ON statarena_app.player_market_value_history TO statarena_runtime;
