"use client";

import React, { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { Media, Modal } from "./UI.jsx";
import { normalizeText } from "../model.js";
import { inEuropeFocus } from "../../../shared/competition-scope.js";
import {
  competitionCountryLabel,
  competitionGroups,
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

function CompetitionPicker({ f, competitions, initialIds, onClose }) {
  const draft = useCompetitionDraft(competitions, initialIds);
  const {
    selected,
    setSelected,
    query,
    setQuery,
    visible,
    europe,
    isEurope,
    toggle,
  } = draft;

  function apply() {
    applyCompetitionDraft(f, draft);
    onClose();
  }

  return (
    <Modal
      title="Compétitions"
      className="home-preferences-modal"
      onClose={onClose}
      footer={
        <>
          <span className="competition-selection-count" role="status">
            {draftCount(draft)}
          </span>
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={apply}
          >
            Appliquer
          </button>
        </>
      }
    >
      <div
        className="competition-presets"
        role="group"
        aria-label="Sélections de compétitions"
      >
        <button
          type="button"
          className="competition-scope-button"
          aria-pressed={selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          Toutes les compétitions
        </button>
        <button
          type="button"
          className="competition-scope-button"
          aria-pressed={isEurope && selected.size > 0}
          onClick={() => setSelected(new Set(europe))}
        >
          Top 7 Europe + UEFA
        </button>
      </div>
      <div className="filter-input-wrap home-preferences-search">
        <Icon name="search" />
        <input
          aria-label="Rechercher une compétition"
          type="search"
          placeholder="Compétition ou pays…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {competitionGroups(visible).map((group) => (
        <section
          className="home-competition-section"
          key={group.key}
          aria-label={group.label}
        >
          <h3>{group.label}</h3>
          <div
            className="home-competition-list"
            role="group"
            aria-label={group.label}
          >
            {group.competitions.map((competition) => (
              <label className="home-competition-option" key={competition.id}>
                <input
                  type="checkbox"
                  checked={selected.has(competition.id)}
                  onChange={() => toggle(competition.id)}
                />
                <Media name={competition.name} url={competition.imageUrl} />
                <span>
                  <strong>{competition.name}</strong>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
      {!visible.length && (
        <p className="empty-state">Aucune compétition pour cette recherche.</p>
      )}
    </Modal>
  );
}

/**
 * The competitions' window, opened from a button: the account's plain word (`trigger`: { className, text, label }), or
 * the players' filters. The home page uses its settings bar instead (HomeSettings.jsx, FAILURE_MODES § 77).
 */
export default function HomePreferences({ f, trigger = null }) {
  const [open, setOpen] = useState(false);
  const { competitions, ids, label, active } = useHomeCompetitions(f);
  return (
    <>
      {trigger ? (
        <button
          type="button"
          className={trigger.className}
          aria-label={trigger.label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {trigger.text}
        </button>
      ) : (
        <button
          type="button"
          id="home-competition-filter"
          className={`button button-secondary home-filter-button${active ? " is-active" : ""}`}
          aria-label={`Filtrer les compétitions : ${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={label}
          onClick={() => setOpen(true)}
        >
          <Icon name="filters" />
          <span>{active ? label : "Filtrer"}</span>
        </button>
      )}
      {open && (
        <CompetitionPicker
          f={f}
          competitions={competitions}
          initialIds={ids}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
