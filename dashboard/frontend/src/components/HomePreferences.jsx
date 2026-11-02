"use client";

import React, { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { Media, Modal } from "./UI.jsx";
import { normalizeText } from "../model.js";
import {
  FEATURED_LEAGUE_IDS,
  countryLabel,
} from "../services/competition-selector.js";

function CompetitionPicker({ f, competitions, onClose }) {
  const [selected, setSelected] = useState(
    () => new Set(f.preferences.favoriteLeagueIds),
  );
  const [query, setQuery] = useState("");
  const search = normalizeText(query).trim();
  const visible = competitions.filter((c) =>
    normalizeText(
      [c.name, c.country, countryLabel(c.country)].filter(Boolean).join(" "),
    ).includes(search),
  );

  function save(ids) {
    f.savePreferences({ favoriteLeagueIds: ids, onboardingComplete: true });
    if (ids.length && f.focus === "europe") f.changeFocus("all");
    if (
      ids.length &&
      f.filters.league !== "all" &&
      !ids.includes(f.filters.league)
    )
      f.setFilters((current) => ({ ...current, league: "all", match: "all" }));
    onClose();
  }

  return (
    <Modal
      title="Personnaliser votre accueil"
      className="home-preferences-modal"
      onClose={onClose}
      footer={
        <>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => save([])}
          >
            Suivre toutes les compétitions
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!selected.size}
            onClick={() => save([...selected])}
          >
            Enregistrer {selected.size ? "(" + selected.size + ")" : ""}
          </button>
        </>
      }
    >
      <p>
        Choisissez les compétitions qui vous intéressent pour retrouver leurs
        matchs et performances sur l’accueil.
      </p>
      <p className="home-preferences-storage">
        Votre sélection est enregistrée sur cet appareil. Elle reste modifiable
        à tout moment.
      </p>
      <div className="filter-input-wrap home-preferences-search">
        <Icon name="search" />
        <input
          aria-label="Rechercher une compétition"
          type="search"
          placeholder="Rechercher une compétition ou un pays…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {[
        [
          "Championnats à la une",
          visible
            .filter((c) => FEATURED_LEAGUE_IDS.includes(c.id))
            .sort(
              (a, b) =>
                FEATURED_LEAGUE_IDS.indexOf(a.id) -
                FEATURED_LEAGUE_IDS.indexOf(b.id),
            ),
        ],
        [
          "Autres compétitions",
          visible.filter((c) => !FEATURED_LEAGUE_IDS.includes(c.id)),
        ],
      ].map(([title, items]) =>
        items.length ? (
          <section className="home-competition-section" key={title}>
            <h3>{title}</h3>
            <div
              className="home-competition-list"
              role="group"
              aria-label="Compétitions à suivre"
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
        <p>Aucune compétition ne correspond à cette recherche.</p>
      )}
    </Modal>
  );
}

export default function HomePreferences({ f }) {
  const [editorOpen, setEditorOpen] = useState(false);
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
  const favorites = f.preferences.favoriteLeagueIds;
  const open =
    editorOpen || (f.preferencesReady && !f.preferences.onboardingComplete);

  function close() {
    if (!f.preferences.onboardingComplete)
      f.savePreferences({ onboardingComplete: true });
    setEditorOpen(false);
  }

  return (
    <>
      <section className="home-personalization" aria-label="Vos compétitions">
        <div>
          <strong>Votre accueil</strong>
          <span>
            {favorites.length
              ? favorites.length +
                " compétition" +
                (favorites.length > 1 ? "s" : "") +
                " suivie" +
                (favorites.length > 1 ? "s" : "")
              : "Toutes les compétitions"}
          </span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setEditorOpen(true)}
        >
          <Icon name="trophy" /> Personnaliser
        </button>
      </section>
      {open && (
        <CompetitionPicker f={f} competitions={competitions} onClose={close} />
      )}
    </>
  );
}
