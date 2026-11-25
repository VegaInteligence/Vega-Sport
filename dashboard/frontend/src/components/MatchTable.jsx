"use client";
/* The match's « Classement » tab (FAILURE_MODES § 63): the competition's table, then, where the base replays the
 * season to its end, its projection, as the competition page shows them. */
import React, { useMemo } from "react";
import { Card } from "./UI.jsx";
import MatchStandings from "./MatchStandings.jsx";
import SeasonProjection from "./SeasonProjection.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useSeasonProjection } from "../services/forecasts.js";
import { seasonLabel } from "../services/format.js";

export default function MatchTable({ match }) {
  const f = useFootball();
  const season = seasonLabel(match.season || f.season);
  const projection = useSeasonProjection(match.leagueId, season);
  const competition = useMemo(() => {
    const known = f.catalog.find((c) => c.id === match.leagueId) || f.data.competitions.find((c) => c.id === match.leagueId);
    return { ...known, id: match.leagueId, name: known?.name || match.league || "Compétition" };
  }, [f.catalog, f.data.competitions, match.leagueId, match.league]);
  return (
    <div className="match-table-view">
      <MatchStandings match={match} />
      {projection && (
        <Card
          title="Projection de fin de saison"
          className="match-projection-card"
          action={<span className="data-source-tag">{season}</span>}
        >
          <SeasonProjection projection={projection} competition={competition} season={season} />
        </Card>
      )}
    </div>
  );
}
