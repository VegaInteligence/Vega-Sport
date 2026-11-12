-- A player's passing partners over a season (pass networks): the passes he gave to and
-- received from each team-mate, summed over his matches. The source's network covers a
-- match up to its first substitution, so these are counts within that window.
CREATE VIEW api.player_pass_partners AS
SELECT s.season_id, s.player_id AS player_key, x.partner AS partner_key, api.public_id('player', x.partner) AS partner_id,
  p.name AS partner_name, ph.source_url AS partner_image_url,
  sum(x.given)::integer AS given, sum(x.received)::integer AS received, count(DISTINCT s.match_id)::integer AS matches
FROM core.player_match_stats s
JOIN core.pass_network_edges e ON e.season_id = s.season_id AND e.match_id = s.match_id
  AND (e.from_player_id = s.player_id OR e.to_player_id = s.player_id)
CROSS JOIN LATERAL (
  SELECT CASE WHEN e.from_player_id = s.player_id THEN e.to_player_id ELSE e.from_player_id END AS partner,
    CASE WHEN e.from_player_id = s.player_id THEN coalesce(e.passes, 0) ELSE 0 END AS given,
    CASE WHEN e.to_player_id = s.player_id THEN coalesce(e.passes, 0) ELSE 0 END AS received
) x
JOIN core.players p ON p.id = x.partner
LEFT JOIN core.assets ph ON ph.id = p.photo_asset_id
WHERE e.from_player_id <> e.to_player_id
GROUP BY s.season_id, s.player_id, x.partner, p.name, ph.source_url;

GRANT SELECT ON api.player_pass_partners TO vega_read;
