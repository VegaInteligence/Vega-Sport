import { createHash } from "node:crypto";
import { cache, query } from "./postgres.js";

const representations = cache(24 * 1024 * 1024, {
  name: "catalog_representation",
  maxEntryBytes: 4 * 1024 * 1024,
});
const editionWhere =
  "FROM statarena_app.catalog_editions c WHERE c.catalog=$1 AND c.scope=$2 AND c.edition=$3";

function result(value, version, scope, { head, withMeta }, status = 200) {
  if (!head && !withMeta) return value;
  const hash = createHash("sha256")
    .update(JSON.stringify([scope, version]))
    .digest("hex");
  const etag = `W/"catalog-v1-${hash}"`;
  return head ? { status, etag } : { value, status, etag };
}

// The retention TTL never determines freshness. Metadata is checked for each
// request, and the representation must be loaded at the same publication version.
async function versioned(scope, options, metadata, read) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const meta = await metadata();
    if (!meta) return null;
    const status = meta.status === undefined ? 200 : meta.status;
    if (options.head) return result(null, meta.version, scope, options, status);
    const load = async () => {
      const row = await read(meta);
      if (!row || row.version !== meta.version) {
        const error = new Error("Catalog publication changed while reading");
        error.code = "ESTALE";
        throw error;
      }
      return row.body;
    };
    try {
      const value =
        status === 200
          ? await representations(
              JSON.stringify([scope, meta.version]),
              load,
              15 * 60 * 1000,
            )
          : await load();
      return result(value, meta.version, scope, options, status);
    } catch (error) {
      if (error.code !== "ESTALE" || attempt > 0) throw error;
    }
  }
}

async function edition(catalog, scope, label, options, transform = null) {
  const values = [catalog, scope, label];
  return versioned(
    values,
    options,
    async () => {
      const [row] = await query(
        "SELECT resource_id,response_status AS status,source_digest AS version " +
          editionWhere,
        values,
      );
      return row;
    },
    async (meta) => {
      const [row] = await query(
        "SELECT c.source_digest AS version,statarena_app.catalog_response(c) AS body FROM statarena_app.catalog_editions c WHERE resource_id=$1 AND source_digest=$2",
        [meta.resource_id, meta.version],
      );
      if (row && transform) row.body = transform(row.body);
      return row;
    },
  );
}

function publicArchiveIndex(body) {
  return {
    ...body,
    seasons: body.seasons.map(({ path, ...season }) => season),
  };
}

function publicCupIndex(body) {
  return {
    ...body,
    competitions: body.competitions.map((comp) => ({
      ...comp,
      tables: Object.fromEntries(
        Object.entries(comp.tables).map(([kind, ref]) => [
          kind,
          { rows: ref.rows },
        ]),
      ),
    })),
  };
}

function nativeSnapshot(body) {
  if (!body.roundsChecked) return body;
  return {
    ...body,
    roundsChecked: Object.fromEntries(
      Object.entries(body.roundsChecked).map(([id, entry]) => [
        id,
        entry.value,
      ]),
    ),
  };
}

export async function getProfile(kind, id = null, options = {}) {
  if (!["players", "teams", "leagues"].includes(kind)) return null;
  return edition("profile", kind, id || "", options);
}

async function rankingClub(club, options) {
  const { head } = options;
  const [row] = await query(
    `SELECT idx.source_digest || refs.source_digest || coalesce(vals.digest,'') AS version,
    vals.pending ${
      head
        ? ""
        : `,jsonb_build_object('rows',
    CASE WHEN link.metric_label IS NULL THEN NULL ELSE vals.rows END) AS body`
    }
  FROM statarena_app.catalog_editions idx
  JOIN statarena_app.catalog_editions refs ON refs.catalog='club-links' AND refs.scope='' AND refs.edition=''
  LEFT JOIN statarena_app.cat_club_links_links link ON link.resource_id=refs.resource_id AND link.metric_label=$1
  LEFT JOIN LATERAL (
    SELECT string_agg(c.source_digest,'' ORDER BY i.position) AS digest,
        count(*) FILTER(WHERE c.resource_id IS NULL)::int AS pending
        ${
          head
            ? ""
            : `,coalesce(jsonb_agg(jsonb_build_object(
        'edition',statarena_app.read_cat_ranking_index_editions(i)-'path',
        'row',CASE WHEN r.record_no IS NULL THEN NULL ELSE statarena_app.read_cat_ranking_uefa_clubs_rows(r) END)
        ORDER BY i.position),'[]'::jsonb) AS rows`
        }
    FROM statarena_app.cat_ranking_index_editions i
    LEFT JOIN statarena_app.catalog_editions c ON c.catalog='ranking' AND c.scope=i.kind AND c.edition=i.edition
    ${head ? "" : `LEFT JOIN statarena_app.cat_ranking_uefa_clubs_rows r ON r.resource_id=c.resource_id AND r."entityId"=link."entityId"`}
    WHERE i.resource_id=idx.resource_id AND i.kind='uefa-clubs' AND i.provider='UEFA'
  ) vals ON link.metric_label IS NOT NULL
  WHERE idx.catalog='ranking-index' AND idx.scope='' AND idx.edition=''`,
    [club],
  );
  if (row?.pending) throw new Error("Ranking edition has not been published");
  return row
    ? result(row.body, row.version, ["rankingClub", club], options)
    : null;
}

function openCupSnapshot(body) {
  return {
    ...body,
    matches: body.matches.map((match) => {
      if (!Object.hasOwn(match, "scoreVector")) return match;
      const { scoreVector, ...other } = match;
      return { ...other, score: scoreVector };
    }),
  };
}

async function clubLink(club, options) {
  const { head } = options;
  const [row] = await query(
    `SELECT c.source_digest AS version, ${
      head
        ? "1 AS present"
        : `jsonb_build_object('links',coalesce((
    SELECT jsonb_build_object(l.metric_label,statarena_app.read_cat_club_links_links(l))
    FROM statarena_app.cat_club_links_links l WHERE l.resource_id=c.resource_id AND l.metric_label=$1
  ),'{}'::jsonb)) AS body`
    } FROM statarena_app.catalog_editions c
  WHERE c.catalog='club-links' AND c.scope='' AND c.edition='' ${head ? "AND $1::text IS NOT NULL" : ""}`,
    [club],
  );
  return row
    ? result(row.body, row.version, ["club-links", club], options)
    : null;
}

async function cupTable(p, options) {
  const { head } = options;
  if (!["results", "fixtures", "goals"].includes(p.kind)) return null;
  // Immutable worker tables become visible only through their published competition index.
  const [row] = await query(
    `WITH ref AS (
    SELECT left(w."tables_${p.kind === "goals" ? "results" : p.kind}_sha256",20) AS digest
    FROM statarena_app.cat_cup_worker_index_competitions w
    WHERE w.folder=$1 AND w.season=$2 AND $3<>'goals'
  )
  SELECT c.source_digest AS version,${head ? "1 AS present" : "statarena_app.catalog_response(c)->'rows' AS body"}
    FROM statarena_app.catalog_editions c
   WHERE c.scope=$1 AND c.catalog=CASE WHEN EXISTS(SELECT 1 FROM ref WHERE digest IS NOT NULL) THEN 'worker-' ELSE 'supp-' END || $3
     AND c.edition=$2||coalesce((SELECT ':'||digest FROM ref),'')`,
    [p.competition, p.season, p.kind],
  );
  return row
    ? result(
        row.body,
        row.version,
        ["cup-table", p.competition, p.season, p.kind],
        options,
      )
    : null;
}

async function supplementalRecord(head) {
  const [row] =
    await query(`SELECT encode(sha256(convert_to(idxmeta.source_digest || coalesce(string_agg(r.source_digest||f.source_digest||g.source_digest,'' ORDER BY comp.position),''),'UTF8')),'hex') AS version,
    count(*) FILTER (WHERE comp.record_no IS NOT NULL AND (r.resource_id IS NULL OR f.resource_id IS NULL OR g.resource_id IS NULL))::int AS pending
    ${
      head
        ? ""
        : `,jsonb_build_object('meta',statarena_app.read_cat_supp_index(idx)->'meta','competitions',
    coalesce(jsonb_agg((statarena_app.read_cat_supp_index_competitions(comp)-'tables'-'season') ||
      jsonb_build_object('results',statarena_app.catalog_response(r)->'rows','fixtures',statarena_app.catalog_response(f)->'rows',
      'goals',statarena_app.catalog_response(g)->'rows') ORDER BY comp.position)
      FILTER(WHERE comp.record_no IS NOT NULL),'[]'::jsonb)) AS body`
    }
    FROM statarena_app.cat_supp_index idx
    JOIN statarena_app.catalog_editions idxmeta USING(resource_id)
    LEFT JOIN statarena_app.cat_supp_index_competitions comp ON comp.resource_id=idx.resource_id
    LEFT JOIN statarena_app.catalog_editions r ON r.catalog='supp-results' AND r.scope=comp.folder AND r.edition=comp.season
    LEFT JOIN statarena_app.catalog_editions f ON f.catalog='supp-fixtures' AND f.scope=comp.folder AND f.edition=comp.season
    LEFT JOIN statarena_app.catalog_editions g ON g.catalog='supp-goals' AND g.scope=comp.folder AND g.edition=comp.season
    GROUP BY idx.resource_id,idx.record_no,idxmeta.source_digest`);
  if (row?.pending)
    throw new Error("Supplemental competition has not been published");
  return row;
}

export async function getCatalog(kind, params = {}, options = {}) {
  const p = params;
  switch (kind) {
    case "archives/index":
      return edition("archive-index", p.kind, "", options, publicArchiveIndex);
    case "archives/season":
      return edition("archive-season", p.kind, p.season, options);
    case "rankings/index":
      return edition("ranking-index", "", "", options, (body) => ({
        ...body,
        editions: body.editions.map(({ path, ...edition }) => edition),
      }));
    case "rankings/edition":
      return edition("ranking", p.kind, p.edition, options);
    case "rankings/associations":
      return edition("ranking", "uefa-associations", p.year + ".uefa", options);
    case "rankings/club":
      return rankingClub(p.club, options);
    case "club-links":
      return clubLink(p.club, options);
    case "matchdays":
      return edition("matchdays", p.competition, p.season, options);
    case "cup-index":
      return edition("cup-index", p.kind, "", options, publicCupIndex);
    case "cup-snapshot": {
      if (
        ![
          "native",
          "open-cups",
          "standings",
          "nations-results",
          "openligadb",
        ].includes(p.kind)
      )
        return null;
      const transform =
        p.kind === "native"
          ? nativeSnapshot
          : p.kind === "open-cups"
            ? openCupSnapshot
            : null;
      return edition(
        "cup-" + p.kind,
        p.competition,
        p.season,
        options,
        transform,
      );
    }
    case "cup-table":
      return cupTable(p, options);
    case "supplemental":
      return versioned(
        "supplemental",
        options,
        () => supplementalRecord(true),
        () => supplementalRecord(false),
      );
    default:
      return null;
  }
}
