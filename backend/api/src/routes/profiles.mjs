/**
 * GET /api/players/{id}, GET /api/teams/{id} and GET /api/competitions — the profiles and
 * the competition catalogue the site reads today through the legacy provider proxy
 * (`{data}`; legacy /api/pitchapi/players/{id}, /teams/{id}, /leagues), from
 * api.player_profiles, api.team_profiles (031) and api.competitions (016).
 *
 * Differences with the legacy read: a field without a value is omitted; a competition
 * carries no `is_free` (a plan of the source, not a fact of the competition); team
 * profiles are served (legacy: none was kept).
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";

const PLAYER = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))$/,
  TEAM = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const put = (o, k, v) => (v === null || v === undefined ? o : ((o[k] = v), o));

function respond(req, data) {
  const etag = `W/"profile-v1-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 300 });
  return send(req, { data }, 200, { etag, ttl: 300, maxBytes: 2 * 1024 * 1024 });
}

export function createProfileRoute(read) {
  return async (req, path, params) => {
    const player = path.match(PLAYER), team = path.match(TEAM);
    if (player || team) {
      validateParams(params, []);
      const [r] = player
        ? await read("SELECT * FROM api.player_profiles WHERE player_id=api.internal_id('player',$1)", [player[1]])
        : await read("SELECT * FROM api.team_profiles WHERE team_id=api.internal_id('team',$1)", [team[1]]);
      if (!r) reject(404, "Donnée indisponible.");
      const data = { id: r.public_id, name: r.name };
      for (const k of ["short_name", "country_code", "image_url", "position_id"]) put(data, k, r[k]);
      if (player) put(data, "shirt_number", r.shirt_number === null ? null : String(r.shirt_number));
      return respond(req, data);
    }
    if (path === "/api/competitions") {
      validateParams(params, []);
      const rows = await read("SELECT * FROM api.competitions ORDER BY name, id");
      return respond(req, {
        leagues: rows.map((c) => put(put({ id: c.id, name: c.name, seasons: [...(c.seasons || [])].sort() }, "image_url", c.image_url), "country_code", c.country)),
      });
    }
    return null;
  };
}
