"use client";
import React, { useMemo } from "react";
import { AsyncState } from "./UI.jsx";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { json, useResource } from "../services/resources.js";
import { cupWorkerSnapshot } from "../services/cup-worker-client.js";
import { WORLD_CUP_ID } from "../services/cup-catalog.js";
import { normalizeOpenCup } from "../services/cup-matches.js";
import { attachNativeMatches, nativeKnockoutMatches, nativeSingleKnockoutMatches } from "../services/knockout-bracket.js";
import { FEATURED_EUROPE_IDS } from "../services/competition-selector.js";

export default function NativeKnockoutBracket({ competition, season, matches, rounds }) {
  const f = useFootball();
  const worldCup = competition.id === WORLD_CUP_ID;
  const resource = useResource("knockout:" + competition.id + ":" + season, async () => {
    if (worldCup) {
      try {
        const data = await cupWorkerSnapshot("open-cups", "world-cup-history", season, "/api/open-cups?competition=world-cup-history&season=" + encodeURIComponent(season));
        return { matches: normalizeOpenCup(data.matches) };
      } catch (error) {
        if (rounds && Object.keys(rounds).length) return { rounds };
        throw error;
      }
    }
    if (rounds && Object.keys(rounds).length) return { rounds };
    const data = await json("/api/matchdays?competition=" + encodeURIComponent(competition.id) + "&season=" + encodeURIComponent(season));
    return { rounds: data.matches || {} };
  });
  const bracketMatches = useMemo(() => {
    if (!resource.value) return [];
    return worldCup && resource.value.matches ? attachNativeMatches(resource.value.matches, matches) : FEATURED_EUROPE_IDS.includes(competition.id) ? nativeKnockoutMatches(matches, resource.value.rounds) : nativeSingleKnockoutMatches(matches, resource.value.rounds);
  }, [worldCup, competition.id, matches, resource.value]);
  const hrefForMatch = (id, status) => f.href("/matchs/", {
    tab: status === "scheduled" ? "upcoming" : "results",
    id,
    competition: competition.id,
    sourceSeason: season,
  });
  return <AsyncState resource={resource}>{() => <>
    <KnockoutBracket matches={bracketMatches} hrefForMatch={hrefForMatch} />
  </>}</AsyncState>;
}
