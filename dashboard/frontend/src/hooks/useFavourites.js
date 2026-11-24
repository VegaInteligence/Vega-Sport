"use client";
import { useMemo } from "react";
import { useResearch } from "./ResearchContext.jsx";
import { favouriteSets } from "../services/preference-effects.js";

/** The visitor's favourite clubs and players (every list), as preference-effects.js reads them. */
export default function useFavourites() {
  const research = useResearch();
  const lists = research?.data?.lists;
  return useMemo(() => favouriteSets(lists), [lists]);
}
