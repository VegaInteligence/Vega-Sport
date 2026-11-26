/**
 * GET /api/player-form?season=[&leagues=][&limit=] — the « En forme » tab of /joueurs (VI-39),
 * computed on read on the page's scope (its season and competitions), finished matches only:
 *
 * - `up` / `down`: a player's last ten graded matches (20 minutes or more) in two windows of five.
 *   A window's grade is the season grade's definition on its matches, the grade of the
 *   minutes-weighted mean z: 100 / (1 + 10^(−z/4)); delta = last − before. Eligible with ten such
 *   matches, FORM_WINDOW_MINUTES in each window and the last within FORM_RECENT_DAYS of the
 *   scope's latest finished match (`as_of`). Rises the largest first, falls the largest first; a
 *   player at 0 is in neither. `grades`: the ten match grades, oldest first.
 * - `minutes`: the last ten finished matches of the scope played by the player's latest club (a
 *   national team never counts), an absence at 0 minutes; the last five against the five before.
 *   Kept from MINUTES_LAST minutes in the last five and a gap of MINUTES_GAP; never a player who
 *   played for another club within those ten matches' span (a transfer is no rise).
 * Only matches within FORM_SPAN_DAYS of `as_of` are read.
 */
import { reject, validateParams } from "../http.mjs";
import { createDataVersions } from "../data-versions.mjs";
import { bindValue, idScopeWhere, parseReadScope, resolveEditions } from "../publication.mjs";
import { ROLE_LABEL } from "./rankings.mjs";

export const FORM_LIMIT = 50, FORM_DEFAULT = 20, FORM_WINDOW_MINUTES = 225, FORM_RECENT_DAYS = 30,
  FORM_SPAN_DAYS = 150, MINUTES_LAST = 180, MINUTES_GAP = 90;

const grade = (z) => 100 / (1 + 10 ** (-z / 4));
const tenth = (v) => Math.round(v * 10) / 10;
const put = (o, k, v) => (v === null || v === undefined ? o : ((o[k] = v), o));

function identity(r) {
  const row = { id: r.player_id, name: r.name };
  put(row, "image_url", r.image_url);
  put(row, "position", r.role ? (ROLE_LABEL[r.role] ?? r.role) : null);
  if (r.team_id) row.team = { id: r.team_id, name: r.team };
  return row;
}

// The statements' relations (FAILURE_MODES_OPTIMISATIONS.md GH137A); the body ({ data }) and former tag unchanged.
export const FORM_SPEC = { family: "player-form", data: true, ttl: 300, maxBytes: 512 * 1024,
  reads: ["api.season_keys", "api.edition_keys", "api.team_finished_matches", "api.player_identities", "api.player_season_roles",
    "api.team_identities", "api.player_form_grades", "api.player_form_minutes"] };

export function createPlayerFormRoute(read, { versioned = createDataVersions(read) } = {}) {
  return async (req, path, params) => (path === "/api/player-form" ? versioned(req, params, FORM_SPEC, (guarded) => form(guarded, params)) : undefined);
}

/** The « En forme » answer, read with `read`. */
async function form(read, params) {
  {
    validateParams(params, ["season", "leagues", "limit"]);
    const scope = parseReadScope(params);
    const rawLimit = params.get("limit");
    if (rawLimit !== null && (!/^\d{1,2}$/.test(rawLimit) || +rawLimit < 1 || +rawLimit > FORM_LIMIT)) reject(400, "Paramètre invalide.");
    const limit = rawLimit === null ? FORM_DEFAULT : Number(rawLimit);
    const editions = await resolveEditions(read, scope);
    const empty = { season: scope.season, up: [], down: [], minutes: [] };
    if (editions.seasonId === null || (scope.leagueIds !== null && !editions.ids.length)) return empty;

    // Each statement binds its own values: a value one of them leaves unread has no type.
    const statement = (build) => {
      const values = [];
      const bind = (value) => bindValue(values, value);
      const inScope = (alias) => idScopeWhere(alias, scope, editions, values);
      const asOf = `(SELECT max(t.match_date) FROM api.team_finished_matches t WHERE ${inScope("t")})`;
      const season = bind(editions.seasonId);
      const card = (alias) => `c.player_id, c.name, c.image_url, r.role, tc.team_id, tc.name AS team
        FROM ${alias} JOIN api.player_identities c ON c.player_key=${alias}.player_key
        LEFT JOIN api.player_season_roles r ON r.season_id=${season}::smallint AND r.player_key=${alias}.player_key
        LEFT JOIN api.team_identities tc ON tc.team_key=${alias}.team_key`;
      return read(build({ bind, inScope, asOf, card }), values);
    };
    const [rows, minutes] = await Promise.all([
      statement(({ bind, inScope, asOf, card }) =>
        `WITH a AS (SELECT ${asOf} AS d),
              g AS (SELECT f.player_key, f.team_key, f.minutes, f.z, f.match_date, f.kickoff_at, f.match_key
                    FROM api.player_form_grades f, a
                    WHERE ${inScope("f")} AND f.minutes >= 20 AND f.match_date >= a.d - ${bind(FORM_SPAN_DAYS)}::int),
              r AS (SELECT g.*, row_number() OVER (PARTITION BY player_key ORDER BY match_date DESC, kickoff_at DESC NULLS LAST, match_key DESC) AS n FROM g),
              w AS MATERIALIZED (
                SELECT player_key, count(*) AS c, max(match_date) AS last_date,
                  sum(z * minutes) FILTER (WHERE n <= 5) / nullif(sum(minutes) FILTER (WHERE n <= 5), 0) AS z_last,
                  sum(z * minutes) FILTER (WHERE n > 5) / nullif(sum(minutes) FILTER (WHERE n > 5), 0) AS z_before,
                  sum(minutes) FILTER (WHERE n <= 5) AS m_last, sum(minutes) FILTER (WHERE n > 5) AS m_before,
                  array_agg(z ORDER BY n DESC) AS zs, (array_agg(team_key ORDER BY n))[1] AS team_key
                FROM r WHERE n <= 10 GROUP BY player_key),
              e AS MATERIALIZED (
                SELECT w.*, 100 / (1 + power(10, -z_last / 4)) - 100 / (1 + power(10, -z_before / 4)) AS delta
                FROM w, a WHERE c = 10 AND m_last >= ${bind(FORM_WINDOW_MINUTES)} AND m_before >= ${bind(FORM_WINDOW_MINUTES)} AND last_date >= a.d - ${bind(FORM_RECENT_DAYS)}::int),
              pick AS ((SELECT 'up' AS list, e.* FROM e WHERE delta > 0 ORDER BY delta DESC, player_key LIMIT ${bind(limit)})
                       UNION ALL (SELECT 'down', e.* FROM e WHERE delta < 0 ORDER BY delta ASC, player_key LIMIT ${bind(limit)}))
         SELECT pick.list, pick.z_last, pick.z_before, pick.zs, (SELECT d FROM a)::text AS as_of, ${card("pick")}
         ORDER BY pick.list, CASE WHEN pick.list = 'up' THEN -pick.delta ELSE pick.delta END, pick.player_key`,
      ),
      statement(({ bind, inScope, asOf, card }) =>
        `WITH a AS (SELECT ${asOf} AS d),
              tm AS (SELECT t.team_key, t.match_key, t.match_date,
                       row_number() OVER (PARTITION BY t.team_key ORDER BY t.match_date DESC, t.kickoff_at DESC NULLS LAST, t.match_key DESC) AS n
                     FROM api.team_finished_matches t, a WHERE ${inScope("t")} AND t.match_date >= a.d - ${bind(FORM_SPAN_DAYS)}::int),
              last10 AS (SELECT * FROM tm WHERE n <= 10),
              clubs AS MATERIALIZED (SELECT team_key, min(match_date) AS start FROM last10 GROUP BY team_key HAVING count(*) = 10),
              seen AS MATERIALIZED (
                SELECT s.player_key, s.team_key, s.match_key, s.match_date, s.kickoff_at, s.minutes
                FROM api.player_form_minutes s, a
                WHERE ${inScope("s")} AND s.match_date >= a.d - ${bind(FORM_SPAN_DAYS)}::int AND s.team_is_national IS NOT TRUE),
              latest AS (SELECT DISTINCT ON (player_key) player_key, team_key FROM seen WHERE minutes > 0
                         ORDER BY player_key, match_date DESC, kickoff_at DESC NULLS LAST, match_key DESC),
              grid AS (SELECT l.player_key, l.team_key, t.n, coalesce(s.minutes, 0) AS minutes
                       FROM latest l JOIN clubs USING (team_key) JOIN last10 t USING (team_key)
                       LEFT JOIN seen s ON s.player_key = l.player_key AND s.team_key = l.team_key AND s.match_key = t.match_key),
              sums AS (SELECT player_key, team_key, sum(minutes) FILTER (WHERE n <= 5)::int AS m_last,
                         sum(minutes) FILTER (WHERE n > 5)::int AS m_before, array_agg(minutes ORDER BY n DESC) AS ms
                       FROM grid GROUP BY player_key, team_key),
              pick AS (SELECT u.* FROM sums u JOIN clubs USING (team_key)
                       WHERE u.m_last >= ${bind(MINUTES_LAST)} AND u.m_last - u.m_before >= ${bind(MINUTES_GAP)}
                         AND NOT EXISTS (SELECT 1 FROM seen o WHERE o.player_key = u.player_key AND o.team_key <> u.team_key
                                         AND o.minutes > 0 AND o.match_date >= clubs.start)
                       ORDER BY u.m_last - u.m_before DESC, u.player_key LIMIT ${bind(limit)})
         SELECT pick.m_last, pick.m_before, pick.ms, (SELECT d FROM a)::text AS as_of, ${card("pick")}
         ORDER BY pick.m_last - pick.m_before DESC, pick.player_key`,
      ),
    ]);
    const data = { season: scope.season };
    put(data, "as_of", rows[0]?.as_of ?? minutes[0]?.as_of);
    const trend = (list) =>
      rows.filter((r) => r.list === list).map((r) => {
        const last = grade(r.z_last), before = grade(r.z_before);
        return { ...identity(r), grade_last: tenth(last), grade_before: tenth(before), delta: tenth(last - before), grades: r.zs.map((z) => tenth(grade(z))) };
      });
    data.up = trend("up");
    data.down = trend("down");
    data.minutes = minutes.map((r) => ({ ...identity(r), minutes_last: r.m_last, minutes_before: r.m_before, delta: r.m_last - r.m_before, minutes: r.ms }));
    return data;
  }
}
