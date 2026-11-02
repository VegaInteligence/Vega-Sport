"use client";

import React, { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { Media, Modal } from "./UI.jsx";
import { normalizeText } from "../model.js";
import { EUROPE_FOCUS_IDS } from "../../../shared/competition-scope.js";
import {
  FEATURED_LEAGUE_IDS,
  countryLabel,
} from "../services/competition-selector.js";

function CompetitionPicker({ f, competitions, initialIds, onClose }) {
  const [selected, setSelected] = useState(() => new Set(initialIds));
  const [query, setQuery] = useState("");
  const search = normalizeText(query).trim();
  const visible = competitions.filter((c) =>
    normalizeText(
      [c.name, c.country, countryLabel(c.country)].filter(Boolean).join(" "),
    ).includes(search),
  );
  const europe = competitions
    .filter((c) => EUROPE_FOCUS_IDS.has(c.id))
    .map((c) => c.id);
  const isEurope =
    selected.size === europe.length && europe.every((id) => selected.has(id));

  function apply() {
    const ids = [...selected];
    // One selection owns the whole home scope. Remove the former single-league
    // and Europe constraints before applying the saved custom/all selection.
    f.changeFocus(isEurope && ids.length ? "europe" : "all");
    f.setFilters((current) => ({ ...current, league: "all", match: "all" }));
    f.savePreferences({ favoriteLeagueIds: ids, onboardingComplete: true });
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
            {selected.size
              ? `${selected.size} sélectionnée${selected.size > 1 ? "s" : ""}`
              : "Toutes les compétitions"}
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
      {[
        [
          "Championnats",
          visible
            .filter((c) => FEATURED_LEAGUE_IDS.includes(c.id))
            .sort(
              (a, b) =>
                FEATURED_LEAGUE_IDS.indexOf(a.id) -
                FEATURED_LEAGUE_IDS.indexOf(b.id),
            ),
        ],
        [
          "Coupes européennes",
          visible.filter(
            (c) =>
              EUROPE_FOCUS_IDS.has(c.id) && !FEATURED_LEAGUE_IDS.includes(c.id),
          ),
        ],
        [
          "Autres compétitions",
          visible.filter((c) => !EUROPE_FOCUS_IDS.has(c.id)),
        ],
      ].map(([title, items]) =>
        items.length ? (
          <section className="home-competition-section" key={title}>
            <h3>{title}</h3>
            <div
              className="home-competition-list"
              role="group"
              aria-label={title}
            >
              {items.map((competition) => (
                <label className="home-competition-option" key={competition.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(competition.id)}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(competition.id))
                          next.delete(competition.id);
                        else next.add(competition.id);
                        return next;
                      })
                    }
                  />
                  <Media name={competition.name} url={competition.imageUrl} />
                  <span>
                    <strong>{competition.name}</strong>
                    <small>{countryLabel(competition.country)}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null,
      )}
      {!visible.length && (
        <p className="empty-state">Aucune compétition pour cette recherche.</p>
      )}
    </Modal>
  );
}

export default function HomePreferences({ f }) {
  const [open, setOpen] = useState(false);
  const competitions = useMemo(() => {
    const byId = new Map();
    for (const season of f.manifest.seasons || [])
      for (const chunk of season.chunks || [])
        for (const competition of chunk.competitions || [])
          if (!byId.has(competition.id)) byId.set(competition.id, competition);
    if (!byId.size)
      for (const competition of f.competitions)
        byId.set(competition.id, competition);
    return [...byId.values()].sort(
      (a, b) =>
        (a.name || "").localeCompare(b.name || "", "fr") ||
        (a.country || "").localeCompare(b.country || "", "fr"),
    );
  }, [f.manifest, f.competitions]);
  const ids =
    f.filters.league !== "all"
      ? [f.filters.league]
      : f.preferences.favoriteLeagueIds.length
        ? f.preferences.favoriteLeagueIds
        : f.focus === "europe"
          ? competitions
              .filter((c) => EUROPE_FOCUS_IDS.has(c.id))
              .map((c) => c.id)
          : [];
  const effectiveIds =
    f.focus === "europe" ? ids.filter((id) => EUROPE_FOCUS_IDS.has(id)) : ids;
  const europe = competitions.filter((c) => EUROPE_FOCUS_IDS.has(c.id));
  const isEurope =
    effectiveIds.length === europe.length &&
    europe.every((c) => effectiveIds.includes(c.id));
  const label =
    ids.length && !effectiveIds.length
      ? "Aucune compétition"
      : isEurope && effectiveIds.length
        ? "Top 7 Europe + UEFA"
        : effectiveIds.length === 1
          ? competitions.find((c) => c.id === effectiveIds[0])?.name ||
            "1 compétition"
          : effectiveIds.length
            ? `${effectiveIds.length} compétitions`
            : "Toutes les compétitions";

  return (
    <div className="filter-field home-competition-filter">
      <span className="sr-only" id="home-competition-label">
        Compétitions
      </span>
      <button
        type="button"
        id="home-competition-filter"
        className="filter-input-wrap home-competition-trigger"
        aria-label={`Compétitions : ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="trophy" />
        <span>{label}</span>
        <Icon name="chevron" className="select-chevron" />
      </button>
      {open && (
        <CompetitionPicker
          f={f}
          competitions={competitions}
          initialIds={ids}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
