"use client";
import React, { useMemo } from "react";
import { AsyncState } from "./UI.jsx";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { json, useResource } from "../services/resources.js";
import { WORLD_CUP_ID } from "../services/cup-catalog.js";
import { normalizeOpenCup } from "../services/cup-matches.js";
import { attachNativeMatches, nativeKnockoutMatches } from "../services/knockout-bracket.js";

export default function NativeKnockoutBracket({ competition, season, matches }) {
  const f = useFootball();
  const worldCup = competition.id === WORLD_CUP_ID;
  const resource = useResource("knockout:" + competition.id + ":" + season, async () => {
    if (worldCup) {
      const data = await json("/api/open-cups?competition=world-cup-history&season=" + encodeURIComponent(season));
      return { matches: normalizeOpenCup(data.matches) };
    }
    const data = await json("/api/matchdays?competition=" + encodeURIComponent(competition.id) + "&season=" + encodeURIComponent(season));
    return { rounds: data.matches || {} };
  });
  const bracketMatches = useMemo(() => {
    if (!resource.value) return [];
    return worldCup ? attachNativeMatches(resource.value.matches, matches) : nativeKnockoutMatches(matches, resource.value.rounds);
  }, [worldCup, matches, resource.value]);
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
