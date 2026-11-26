"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { Media } from "./UI.jsx";
import {
  applyCompetitionDraft,
  draftCount,
  useCompetitionDraft,
  useHomeCompetitions,
} from "./HomePreferences.jsx";
import { competitionCountryLabel } from "../services/competition-selector.js";

// The home page's settings bar (FAILURE_MODES § 77, piste B of https://claude.ai/artifact/DPfYC6jW2ooKwPGzmaGsdD):
// the season and the competitions in one track, and one panel under it that slides from one to the other, as the
// site's bar does (§ 76). No country: it is automatic, chosen in the account's settings (hugo, 26 Nov 2026).
// On a phone the panel is a sheet from the bottom over a veil (home-pills.css).

const KEYS = ["season", "competitions"];

function SeasonPane({ f, close }) {
  return (
    <div className="home-settings-seasons" role="group" aria-label="Saison">
      {f.manifest.seasons.map((season) => (
        <button
          key={season.id}
          type="button"
          className="home-settings-season"
          aria-pressed={season.id === f.season}
          onClick={() => {
            if (season.id !== f.season) f.changeSeason(season.id);
            close(true);
          }}
        >
          {season.id}
        </button>
      ))}
    </div>
  );
}

function CompetitionsPane({ f, competitions, ids, close }) {
  const draft = useCompetitionDraft(competitions, ids);
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
  return (
    <>
      <div className="home-settings-tools">
        <div
          className="home-settings-presets"
          role="group"
          aria-label="Sélections de compétitions"
        >
          <button
            type="button"
            aria-pressed={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            Toutes
          </button>
          <button
            type="button"
            aria-pressed={isEurope && selected.size > 0}
            onClick={() => setSelected(new Set(europe))}
          >
            Top 7 Europe + UEFA
          </button>
        </div>
        <label className="home-settings-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Rechercher une compétition"
            placeholder="Compétition ou pays…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div
        className="home-settings-tiles"
        role="group"
        aria-label="Compétitions"
      >
        {visible.map((competition) => (
          <button
            key={competition.id}
            type="button"
            className="home-settings-tile"
            data-league={competition.id}
            aria-pressed={selected.has(competition.id)}
            onClick={() => toggle(competition.id)}
          >
            {selected.has(competition.id) && (
              <Icon name="check" className="home-settings-check" />
            )}
            <Media name={competition.name} url={competition.imageUrl} />
            <strong>{competition.name}</strong>
            <small>{competitionCountryLabel(competition)}</small>
          </button>
        ))}
        {!visible.length && (
          <p className="home-settings-empty">
            Aucune compétition pour cette recherche.
          </p>
        )}
      </div>
      <div className="home-settings-foot">
        <span className="home-settings-count" role="status">
          {draftCount(draft)}
        </span>
        <button
          type="button"
          className="home-settings-action"
          onClick={() => close(true)}
        >
          Annuler
        </button>
        <button
          type="button"
          className="home-settings-action is-filled"
          onClick={() => {
            applyCompetitionDraft(f, draft);
            close(true);
          }}
        >
          Appliquer
        </button>
      </div>
    </>
  );
}

export default function HomeSettings({ f }) {
  const { competitions, ids, label } = useHomeCompetitions(f);
  const [open, setOpen] = useState(null);
  const [from, setFrom] = useState(null);
  const root = useRef(null),
    panel = useRef(null),
    pane = useRef(null),
    segments = useRef({});

  const close = (focus = false) => {
    const key = open;
    setOpen(null);
    setFrom(null);
    if (focus && key) segments.current[key]?.focus({ preventScroll: true });
  };
  const toggle = (key) => {
    setFrom(open);
    setOpen(open === key ? null : key);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  });

  // The panel takes its pane's height, so moving from one setting to the other glides (home-pills.css).
  useLayoutEffect(() => {
    const box = panel.current,
      inner = pane.current;
    if (!box || !inner) return undefined;
    const fit = () => (box.style.height = `${inner.offsetHeight}px`);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [open]);

  const slide =
    from && open && from !== open
      ? KEYS.indexOf(open) > KEYS.indexOf(from)
        ? " is-from-right"
        : " is-from-left"
      : "";

  return (
    <div className="home-settings-root" ref={root}>
      <div
        className="home-settings"
        role="group"
        aria-label="Réglages de la page"
      >
        <button
          type="button"
          ref={(node) => (segments.current.season = node)}
          className="home-settings-segment"
          data-key="season"
          aria-haspopup="dialog"
          aria-expanded={open === "season"}
          aria-label={`Saison : ${f.season}`}
          onClick={() => toggle("season")}
        >
          <Icon name="calendar" />
          <span>{f.season}</span>
          <Icon name="chevron" className="home-settings-chevron" />
        </button>
        <button
          type="button"
          ref={(node) => (segments.current.competitions = node)}
          className="home-settings-segment"
          data-key="competitions"
          aria-haspopup="dialog"
          aria-expanded={open === "competitions"}
          aria-label={`Compétitions : ${label}`}
          title={label}
          onClick={() => toggle("competitions")}
        >
          <Icon name="filters" />
          <span>{label}</span>
          <Icon name="chevron" className="home-settings-chevron" />
        </button>
      </div>
      {open && (
        <>
          <div
            className="home-settings-veil"
            aria-hidden="true"
            onClick={() => close()}
          />
          <div
            ref={panel}
            className="home-settings-panel"
            data-pane={open}
            role="dialog"
            aria-label={open === "season" ? "Saison" : "Compétitions"}
          >
            <div ref={pane} key={open} className={`home-settings-pane${slide}`}>
              {open === "season" ? (
                <SeasonPane f={f} close={close} />
              ) : (
                <CompetitionsPane
                  f={f}
                  competitions={competitions}
                  ids={ids}
                  close={close}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
