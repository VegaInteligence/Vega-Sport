import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";

export async function relationalPlayerMarketValuesRoute(req, path, params) {
  if (path !== "/api/player-market-values") return null;
  if (!["GET", "HEAD"].includes(req.method))
    reject(405, "Méthode non autorisée.");
  validateParams(params, ["id"]);
  const id = params.get("id");
  if (!/^p_[A-Za-z0-9]{6}$/.test(id ?? ""))
    reject(400, "Identifiant invalide.");

  // Constrain the document primary key as well as the published player ID.
  const [row] = await query(
    `SELECT snapshot_path, history
       FROM statarena_app.player_market_value_history
      WHERE identity_path = snapshot_path || '!/vega/' || $1 || '.json'
        AND player_id = $1`,
    [id],
  );
  const digest = row?.snapshot_path.split("/").at(-1).slice(0, -4) ?? "empty";
  return send(req, {
    data: { currency: "EUR", source: "Transfermarkt", history: row?.history ?? [] },
  }, 200, {
    etag: `W/"player-market-values-v1-${id}-${digest}"`,
    ttl: row ? 300 : 60,
  });
}
