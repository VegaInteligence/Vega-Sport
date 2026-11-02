import React, { useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadSeason } from "../season_data.js";
import { seasonLabel } from "../services/format.js";
import { competitionLabel } from "../services/competition-selector.js";
import CompetitionStandings from "./CompetitionStandings.jsx";
import { Card, Empty } from "./UI.jsx";

async function matchFixtures(f, competition, season) {
  const key = `${competition.id}:${season}`;
  const cached = f.client.fixtures.get(key);
  const scoped = Object.assign(Object.create(f.client), {
    browseMode: "catalog",
    competitionId: competition.id,
    season,
    // Reuse completed fixtures without consuming another page's pending entry.
    fixtures: new Map(cached?.matches ? [[key, cached]] : []),
    catalog: [
      competition,
      ...f.client.catalog.filter((c) => c.id !== competition.id),
    ],
  });
  await scoped.loadFixtures();
  let value = scoped.fixtures.get(key);
  if (value.source === "snapshot" && !value.matches.length) {
    const bucket = seasonLabel(season);
    const available = f.manifest.seasons
      .find((s) => s.id === bucket)
      ?.chunks.some((c) => c.leagueId === competition.id);
    if (available) {
      // A deep-linked match can belong to a season outside the global page
      // filter. Fetch only its competition snapshot, using the shared cache.
      scoped.data = await loadSeason(
        f.manifest,
        bucket,
        fetch,
        new Set([competition.id]),
      );
      value = {
        matches: scoped.localFixtures(competition.id, season),
        source: "snapshot",
      };
      scoped.fixtures.set(key, value);
    }
  }
  return value;
}

export default function MatchStandings({ match }) {
  const f = useFootball();
  const competition = useMemo(() => {
    const catalog = f.catalog.find((c) => c.id === match.leagueId);
    const entries = f.manifest.seasons.flatMap((s) =>
      s.chunks.flatMap((c) =>
        (c.competitions || []).filter((item) => item.id === match.leagueId),
      ),
    );
    const known =
      catalog ||
      entries[0] ||
      f.data.competitions.find((c) => c.id === match.leagueId);
    return {
      ...known,
      id: match.leagueId,
      name: known?.name || match.league || "Compétition",
      seasons: [
        ...new Set([
          ...(catalog?.seasons || []),
          ...entries.flatMap((c) => c.seasons || []),
        ]),
      ]
        .sort()
        .reverse(),
    };
  }, [
    f.catalog,
    f.manifest,
    f.data.competitions,
    match.leagueId,
    match.league,
  ]);
  const season = match.season;
  const fixtures = useResource(
    `match-standings:${f.client.id}:${competition.id}:${season}`,
    () => matchFixtures(f, competition, season),
    Boolean(competition.id && season && f.statusKnown),
  );
  if (!competition.id || !season)
    return (
      <Card title="Classement">
        <Empty>
          La compétition ou la saison de ce match n’est pas renseignée.
        </Empty>
      </Card>
    );
  return (
    <Card
      title={competitionLabel(competition)}
      action={<span className="data-source-tag">{season}</span>}
      className="match-standings-card"
    >
      <CompetitionStandings
        competition={competition}
        season={season}
        matches={fixtures.value?.matches || []}
        source={fixtures.value?.source}
        fixturesLoading={fixtures.loading}
        fixturesError={fixtures.error}
        onRetry={fixtures.retry}
        highlightTeams={[match.home, match.away]}
      />
    </Card>
  );
}
