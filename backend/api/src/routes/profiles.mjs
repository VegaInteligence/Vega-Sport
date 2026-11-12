/**
 * GET /api/players/{id}, GET /api/teams/{id} and GET /api/competitions — the profiles and
 * the competition catalogue the site reads today through the legacy provider proxy
 * (`{data}`; legacy /api/pitchapi/players/{id}, /teams/{id}, /leagues), from
 * api.player_profiles, api.team_profiles (031) and api.competitions (016).
 *
 * GET /api/players/{id}/partners?season= — the player's passing partners of a season
 * (api.player_pass_partners, 079): the passes given to and received from each team-mate
 * in the pass networks, the most exchanged first.
 *
 * GET /api/players/{id}/similar?season= — the players whose whole statistical profile of
 * the season is the closest to his (vega/embedding.py, 081): the nearest on the learnt
 * axes, each with a similarity from 100 (the same profile) to 0 (as far as his median
 * distance to the season's other players).
 *
 * Differences with the legacy read: a field without a value is omitted; a competition
 * carries no `is_free` (a plan of the source, not a fact of the competition); team
 * profiles are served (legacy: none was kept).
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { ROLE_LABEL } from "./rankings.mjs";

const PLAYER = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))$/,
  TEAM = /^\/api\/teams\/(t_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const PARTNERS = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/partners$/;
const PARTNER_COUNT = 5;
const SIMILAR = /^\/api\/players\/(p_(?:[A-Za-z0-9]{6}|v\d{7}))\/similar$/;
const SIMILAR_COUNT = 8;
const DIMENSIONS = 10;
const SQUARES = Array.from({ length: DIMENSIONS }, (_, i) => `power(o.e${i + 1}-me.e${i + 1},2)`).join("+");

/** 100 for the same profile, 0 from the median distance between the player and the others. */
export const similarity = (distance, median) => (median > 0 ? Math.max(0, Math.round(100 * (1 - distance / median))) : 0);
const put = (o, k, v) => (v === null || v === undefined ? o : ((o[k] = v), o));

function respond(req, data) {
  const etag = `W/"profile-v1-${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 300 });
  return send(req, { data }, 200, { etag, ttl: 300, maxBytes: 2 * 1024 * 1024 });
}

export function createProfileRoute(read) {
  return async (req, path, params) => {
    const partners = path.match(PARTNERS);
    if (partners) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      const rows = await read(
        `SELECT partner_id, partner_name, partner_image_url, given, received, matches FROM api.player_pass_partners
         WHERE season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND player_key=api.internal_id('player',$1)
         ORDER BY given+received DESC, partner_name, partner_id LIMIT ${PARTNER_COUNT}`,
        [partners[1], season],
      );
      if (!rows.length) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: partners[1], season,
        partners: rows.map((r) => put({ id: r.partner_id, name: r.partner_name, given: r.given, received: r.received, matches: r.matches }, "image_url", r.partner_image_url)),
      });
    }
    const similar = path.match(SIMILAR);
    if (similar) {
      validateParams(params, ["season"]);
      const season = params.get("season");
      if (!/^\d{4}\/\d{4}$/.test(season || "")) reject(400, "Paramètre invalide.");
      // The distances are computed on the vectors alone; only the nearest are then named.
      const rows = await read(
        `WITH me AS (SELECT * FROM api.player_embedding_vectors
                     WHERE season_id=(SELECT k.season_id FROM api.season_keys k WHERE k.season=$2) AND player_key=api.internal_id('player',$1)),
              d AS (SELECT o.season_id, o.player_key, sqrt(${SQUARES}) AS distance FROM api.player_embedding_vectors o
                    JOIN me ON o.season_id=me.season_id AND o.women=me.women AND o.player_key<>me.player_key),
              m AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) AS median, count(*)::int AS players FROM d),
              n AS (SELECT * FROM d ORDER BY distance, player_key LIMIT ${SIMILAR_COUNT})
         SELECT p.player_id, p.name, p.image_url, p.minutes, p.role, p.team_id, p.team, p.score, n.distance, m.median, m.players
         FROM n CROSS JOIN m JOIN api.player_embedding_people p ON p.season_id=n.season_id AND p.player_key=n.player_key
         ORDER BY n.distance, n.player_key`,
        [similar[1], season],
      );
      if (!rows.length) reject(404, "Donnée indisponible.");
      return respond(req, {
        id: similar[1], season, compared: rows[0].players,
        similar: rows.map((r) => {
          const row = { id: r.player_id, name: r.name, similarity: similarity(r.distance, r.median), minutes: r.minutes };
          put(row, "image_url", r.image_url);
          put(row, "role", r.role);
          put(row, "position", r.role ? (ROLE_LABEL[r.role] ?? r.role) : null);
          if (r.team_id) row.team = { id: r.team_id, name: r.team };
          put(row, "score", r.score === null || r.score === undefined ? null : Math.round(r.score * 10) / 10);
          return row;
        }),
      });
    }
    const player = path.match(PLAYER), team = path.match(TEAM);
    if (player || team) {
      validateParams(params, []);
      const [r] = player
        ? await read("SELECT * FROM api.player_profiles WHERE player_id=api.internal_id('player',$1)", [player[1]])
        : await read("SELECT * FROM api.team_profiles WHERE team_id=api.internal_id('team',$1)", [team[1]]);
      if (!r) reject(404, "Donnée indisponible.");
      const data = { id: r.public_id, name: r.name };
      for (const k of ["short_name", "country_code", "image_url", "position_id"]) put(data, k, r[k]);
      if (player) {
        put(data, "shirt_number", r.shirt_number === null ? null : String(r.shirt_number));
        put(data, "birth_date", r.birth_date);
        put(data, "height_cm", r.height_cm);
      }
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
