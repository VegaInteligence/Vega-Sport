"use client";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { ClubFacts } from "./ClubProfile.jsx";
import ClubRanking from "./ClubRanking.jsx";

/**
 * Coach, stadium, foundation and UEFA ranking: external reads, so they only
 * start once the section approaches the viewport. The club's page (§ 86) adds
 * what its identity column held: the squad's figures (`squad`) to the facts,
 * the competitions played (`competitions`, a node) above the UEFA ranking.
 */
export default function ClubInformation({ dossier, squad = [], competitions = null }) {
  const f = useFootball();
  const [ref, visible] = useVisibleIntent(`${dossier.id}:${f.season}`);
  const matches = dossier.allRows.map((row) => row.match);
  return (
    <div className="club-overview-info" ref={ref}>
      {visible && (
        <>
          <ClubFacts
            club={{
              id: dossier.id,
              name: dossier.name,
              imageUrl: dossier.imageUrl,
              country: dossier.country,
            }}
            matches={matches}
            more={squad}
          />
          <ClubRanking
            clubId={dossier.id}
            title={competitions ? "Compétitions et rang européen" : undefined}
            before={competitions}
          />
        </>
      )}
    </div>
  );
}
