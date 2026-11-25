"use client";
/* The match's « Classement » tab (FAILURE_MODES § 63): the competition's own block, as its page shows it (the edition's
 * head, then Classement, Matchs, Tableau and Projection where the competition has them), for the match's season.
 * A competition the site does not collect itself (a cup read from the cup index) keeps the table of the match. */
import React, { useMemo } from "react";
import MatchStandings from "./MatchStandings.jsx";
import CompetitionEdition from "./CompetitionEdition.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { findCompetition } from "../services/cup-catalog.js";
import { mergeCompetitionSeasons } from "../services/competition-selector.js";
import { seasonLabel } from "../services/format.js";

export default function MatchTable({ match }) {
  const f = useFootball();
  const season = seasonLabel(match.season || f.season);
  // The catalogue's entry with every season the manifest knows, as the competitions page builds it.
  const competition = useMemo(() => {
    const known = findCompetition(f.allCatalog || f.catalog, match.leagueId);
    if (!known || known.source || known.sourceKey) return null;
    const archived = f.manifest.seasons.flatMap((s) =>
      s.chunks
        .filter((chunk) => chunk.leagueId === known.id)
        .flatMap(
          (chunk) =>
            chunk.competitions?.find((item) => item.id === known.id)?.seasons ||
            chunk.meta?.catalogSeasons ||
            chunk.meta?.seasons ||
            [],
        ),
    );
    return { ...known, seasons: mergeCompetitionSeasons(known.seasons || [], archived) };
  }, [f.allCatalog, f.catalog, f.manifest, match.leagueId]);
  if (!competition) return <MatchStandings match={match} />;
  return (
    <div className="match-table-view">
      <CompetitionEdition
        key={competition.id + ":" + season}
        competition={competition}
        initialSeason={season}
        initialView="standings"
        embedded
      />
    </div>
  );
}
