"use client";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { ClubFacts } from "./ClubProfile.jsx";
import ClubRanking from "./ClubRanking.jsx";

/**
 * Coach, stadium, foundation and UEFA ranking: external reads, so they only
 * start once the section approaches the viewport.
 */
export default function ClubInformation({ dossier }) {
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
          />
          <ClubRanking clubId={dossier.id} />
        </>
      )}
    </div>
  );
}
