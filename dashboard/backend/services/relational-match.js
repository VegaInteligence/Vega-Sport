import { cache, canonical, query } from "./postgres.js";

const families = new Map(
  Object.entries({
    "": "match",
    shots: "shots",
    momentum: "momentum",
    events: "events",
    players: "players",
    "players/halves": "player_halves",
    lineups: "lineups",
    h2h: "h2h",
    stats: "stats",
    advanced: "advanced_teams",
    "advanced/players": "advanced_players",
    "advanced/network": "pass_networks",
    heatmaps: "heatmaps",
  }),
);

const nestedFamilies = [
  [/^shots\/(s_[A-Za-z0-9]{6})$/, "single_shot"],
  [/^players\/(p_[A-Za-z0-9]{6})$/, "single_player"],
  [/^players\/(p_[A-Za-z0-9]{6})\/halves$/, "single_halves"],
  [/^players\/(p_[A-Za-z0-9]{6})\/shots$/, "player_shots"],
  [/^advanced\/players\/(p_[A-Za-z0-9]{6})$/, "single_advanced"],
];

// Keys include the committed source digest. TTL bounds retention only. Each
// request checks current metadata before consulting the representation cache.
const representations = cache(32 * 1024 * 1024, {
  name: "match_representation",
  maxEntryBytes: 2 * 1024 * 1024,
});

async function readVersioned(key, options, metadata, read, first) {
  const { head, withMeta, deferBody } = options;
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = (!attempt && first) || (await metadata())[0];
    if (!current) return null;
    if (head)
      return {
        ...(deferBody && {
          readBody: () =>
            readVersioned(key, { withMeta: true }, metadata, read, current),
        }),
        status: current.status,
        etag: `W/"match-v1-${current.version}"`,
      };
    const load = async () => {
      const [row] = await read(current.version);
      if (row) return row.body;
      const changed = new Error("Match publication changed while loading");
      changed.code = "ESTALE";
      throw changed;
    };
    try {
      const body =
        current.status !== 200
          ? await load()
          : await representations(
              key + "/" + current.version,
              load,
              15 * 60 * 1000,
            );
      return withMeta
        ? {
            value: body,
            status: current.status,
            etag: `W/"match-v1-${current.version}"`,
          }
        : body;
    } catch (error) {
      if (error.code !== "ESTALE" || attempt > 0) throw error;
    }
  }
}

export async function relationalResource(endpoint, params = {}, options = {}) {
  const match = /^\/matches\/(m_[A-Za-z0-9]{6})(?:\/(.+))?$/.exec(endpoint);
  if (!match) return null;
  const suffix = match[2] || "";
  let family = families.get(suffix),
    subject = "";
  if (!family) {
    for (const [pattern, nestedFamily] of nestedFamilies) {
      const nested = pattern.exec(suffix);
      if (nested) {
        family = nestedFamily;
        subject = nested[1];
        break;
      }
    }
  }
  if (!family) return null;
  const variant = canonical(params),
    values = [match[1], variant, family, subject];
  const where =
    "FROM statarena_app.match_families f WHERE match_id=$1 AND params=$2 AND family=$3 AND subject_id=$4";
  return readVersioned(
    endpoint + "?" + variant,
    options,
    () => query("SELECT status,source_digest AS version " + where, values),
    (version) =>
      query(
        "SELECT statarena_app.detail_response(f) AS body " +
          where +
          " AND source_digest=$5",
        [...values, version],
      ),
  );
}

export async function relationalMatchObservation(id, options = {}) {
  return readVersioned(
    "/archive/matches/" + id,
    options,
    () =>
      query(
        "SELECT 200 AS status,version FROM statarena_app.match_detail_versions WHERE match_id=$1",
        [id],
      ),
    (version) =>
      query(
        `SELECT statarena_app.detail_context(c) ||
              jsonb_build_object('endpoints', (
               SELECT jsonb_object_agg(f.family, statarena_app.detail_response(f))
               FROM statarena_app.match_families f WHERE f.match_id=c.match_id AND f.params='{}' AND f.subject_id=''
              )) AS body
       FROM statarena_app.match_detail_versions v JOIN statarena_app.match_details c USING (match_id)
       WHERE v.match_id=$1 AND v.version=$2`,
        [id, version],
      ),
  );
}
