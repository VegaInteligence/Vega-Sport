import { createHash } from "node:crypto";
import { buildArchiveSeason } from "./archive.js";
import { normalizeText } from "./archive-text.js";

export const ARCHIVE_PROJECTION_REVISION = 1;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function archivePublication(sourceFence) {
  const editions = sourceFence?.editions || [];
  const expected = sourceFence?.expected_scopes || [];
  const missing = expected.some(
    (scope) => !editions.some((edition) => edition.scope === scope),
  );
  const reason = missing
    ? "missing_expected_source"
    : !editions.length
      ? "missing_edition"
      : editions.some(
            (e) => e.response_status != null && e.response_status !== 200,
          )
        ? "source_unavailable"
        : null;
  const sources = Object.fromEntries(
    editions.map((e) => [
      e.scope,
      { digest: e.source_digest, publishedAt: e.updated_at },
    ]),
  );
  return {
    ready: !reason,
    reason,
    version: createHash("sha256")
      .update(
        JSON.stringify(canonical([ARCHIVE_PROJECTION_REVISION, sourceFence])),
      )
      .digest("hex"),
    sourceDigests: Object.fromEntries(
      editions.map((e) => [e.scope, e.source_digest]),
    ),
    sources,
  };
}

function fields(row, keys) {
  const missing = new Set(row.missing || []);
  return Object.fromEntries(
    keys.filter((key) => !missing.has(key)).map((key) => [key, row[key]]),
  );
}

function resultMatch(row) {
  const match = fields(row, [
    "date",
    "dateNote",
    "round",
    "team1",
    "team2",
    "status",
  ]);
  const missing = new Set(row.missing || []),
    nulls = new Set(row.null_groups || []);
  if (!missing.has("score")) {
    match.score = nulls.has("score")
      ? null
      : Object.fromEntries(
          ["et", "final", "ft", "p"]
            .filter((key) => !missing.has(`score.${key}`))
            .map((key) => [key, row[`score_${key}`]]),
        );
  }
  if (!missing.has("sourceFields")) {
    match.sourceFields = nulls.has("sourceFields")
      ? null
      : Object.fromEntries(
          ["neutral", "nonmatch"]
            .filter((key) => !missing.has(`sourceFields.${key}`))
            .map((key) => [key, row[`sourceFields_${key}`]]),
        );
  }
  return match;
}

/** Exactly the browser's historical matcher, with unused provenance removed. */
export function archiveEditionRecord(row, season) {
  const results = new Map(
    (row.result_headers || []).map((header) => [
      header.record_no,
      {
        ...fields(header, ["id", "name", "country"]),
        matches: [],
      },
    ]),
  );
  for (const match of row.result_matches || [])
    results.get(match.parent_no)?.matches.push(resultMatch(match));
  const goals = new Map(
    (row.goal_headers || []).map((header) => [
      header.record_no,
      {
        ...fields(header, ["id", "name", "country", "calendarYear"]),
        events: [],
      },
    ]),
  );
  for (const event of row.goal_events || [])
    goals
      .get(event.parent_no)
      ?.events.push(
        fields(event, [
          "date",
          "match",
          "minute",
          "player",
          "score",
          "scoreDisagreement",
          "sourceSeason",
          "team",
        ]),
      );
  const edition = buildArchiveSeason(
    { season, competitions: [...results.values()] },
    { season, competitions: [...goals.values()] },
  );
  for (const match of edition.matches) delete match.raw;
  const counts = new Map(
    edition.competitions.map((c) => [
      c.id,
      { matches: 0, withGoals: 0, goals: 0 },
    ]),
  );
  let resultsCount = 0,
    withGoals = 0,
    goalCount = 0;
  for (const match of edition.matches) {
    const count = counts.get(match.competitionId),
      goals = match.goals?.length || 0;
    count.matches++;
    count.withGoals += Number(goals > 0);
    count.goals += goals;
    resultsCount += Number(
      match.score.every((score) => Number.isInteger(score) && score >= 0),
    );
    withGoals += Number(goals > 0);
    goalCount += goals;
  }
  edition.competitions = edition.competitions.map((c) => ({
    ...c,
    ...counts.get(c.id),
  }));
  edition.summary = {
    matches: edition.matches.length,
    results: resultsCount,
    withGoals,
    goals: goalCount,
    competitions: edition.competitions.length,
  };
  return edition;
}

/** A normalized, exact read model. Only publisher/maintenance code builds it. */
export function buildArchiveProjection(row, season) {
  const publication = archivePublication(row.source_fence);
  if (!publication.ready) return { season, ...publication };
  const edition = archiveEditionRecord(row, season);
  const matches = edition.matches.map(({ goals, raw, ...match }, ordinal) => ({
    ordinal,
    match_key: match.key,
    competition_id: match.competitionId ?? null,
    search_teams: normalizeText(`${match.team1} ${match.team2}`),
    // Queries reject control characters; this delimiter cannot create a match
    // spanning two player names that archiveRows().some() would not accept.
    search_players: (goals || [])
      .map((goal) => normalizeText(goal.player))
      .join("\u001f"),
    listing: {
      ...match,
      hasGoals: Boolean(goals?.length),
      goalCount: goals?.length || 0,
    },
    goals,
  }));
  return {
    season,
    ...publication,
    revision: ARCHIVE_PROJECTION_REVISION,
    source_fence: row.source_fence,
    competitions: edition.competitions,
    summary: edition.summary,
    matches,
  };
}
