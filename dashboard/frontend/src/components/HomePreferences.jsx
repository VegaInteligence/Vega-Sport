"use client";

import React, { useMemo, useState } from "react";
import { normalizeText } from "../model.js";
import { inEuropeFocus } from "../../../shared/competition-scope.js";
import {
  competitionCountryLabel,
  competitionLabel,
  orderedCompetitions,
} from "../services/competition-selector.js";

/**
 * The choice being made in a competitions picker (the home's settings panel, the account's window): the chosen ids,
 * the search, the competitions it leaves, and whether the choice is the Top 7 Europe + UEFA preset.
 */
export function useCompetitionDraft(competitions, initialIds) {
  const [selected, setSelected] = useState(() => new Set(initialIds));
  const [query, setQuery] = useState("");
  const search = normalizeText(query).trim();
  const visible = competitions.filter((c) =>
    normalizeText(
      [c.name, c.country, competitionCountryLabel(c)].filter(Boolean).join(" "),
    ).includes(search),
  );
  const europe = competitions.filter(inEuropeFocus).map((c) => c.id);
  const isEurope =
    selected.size === europe.length && europe.every((id) => selected.has(id));
  const toggle = (id) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return {
    selected,
    setSelected,
    query,
    setQuery,
    visible,
    europe,
    isEurope,
    toggle,
  };
}

/** The draft saved: one selection owns the whole home scope (the former single-league and Europe constraints go). */
export function applyCompetitionDraft(f, draft) {
  const ids = [...draft.selected];
  f.changeFocus(draft.isEurope && ids.length ? "europe" : "all");
  f.setFilters((current) => ({ ...current, league: "all", match: "all" }));
  f.savePreferences({ favoriteLeagueIds: ids, onboardingComplete: true });
}

/** « 3 sélectionnées », or « Toutes les compétitions » when nothing is chosen. */
export const draftCount = (draft) =>
  draft.selected.size
    ? `${draft.selected.size} sélectionnée${draft.selected.size > 1 ? "s" : ""}`
    : "Toutes les compétitions";

/** The competitions the home follows: every competition of the manifest, the ids in force and their name. */
export function useHomeCompetitions(f) {
  const competitions = useMemo(() => {
    const byId = new Map();
    for (const season of f.manifest.seasons || [])
      for (const chunk of season.chunks || [])
        for (const competition of chunk.competitions || [])
          if (!byId.has(competition.id)) byId.set(competition.id, competition);
    if (!byId.size)
      for (const competition of f.competitions)
        byId.set(competition.id, competition);
    return orderedCompetitions([...byId.values()]);
  }, [f.manifest, f.competitions]);
  const ids =
    f.filters.league !== "all"
      ? [f.filters.league]
      : f.preferences.favoriteLeagueIds.length
        ? f.preferences.favoriteLeagueIds
        : f.focus === "europe"
          ? competitions.filter(inEuropeFocus).map((c) => c.id)
          : [];
  const effectiveIds =
    f.focus === "europe"
      ? ids.filter((id) =>
          inEuropeFocus(competitions.find((c) => c.id === id) || { id }),
        )
      : ids;
  const europe = competitions.filter(inEuropeFocus);
  const isEurope =
    effectiveIds.length === europe.length &&
    europe.every((c) => effectiveIds.includes(c.id));
  const label =
    ids.length && !effectiveIds.length
      ? "Aucune compétition"
      : isEurope && effectiveIds.length
        ? "Top 7 Europe + UEFA"
        : effectiveIds.length === 1
          ? competitionLabel(
              competitions.find((c) => c.id === effectiveIds[0]) || {
                name: "1 compétition",
              },
            )
          : effectiveIds.length
            ? `${effectiveIds.length} compétitions`
            : "Toutes les compétitions";
  const active = effectiveIds.length > 0 || ids.length > 0;
  return { competitions, ids, label, active };
}
