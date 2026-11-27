"use client";

import Icon from "./Icon.jsx";
import { useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { Media } from "./UI.jsx";
import SettingsPicker from "./SettingsPicker.jsx";
import {
  applyCompetitionDraft,
  draftCount,
  useCompetitionDraft,
  useHomeCompetitions,
} from "./HomePreferences.jsx";
import { competitionCountryLabel, competitionGroups } from "../services/competition-selector.js";
import { competitionSearchText, normalizeCompetitionQuery } from "../services/cup-catalog.js";

export const EUROPE_SCOPE = "europe";

function choiceLabel(competitions, value) {
  if (value === EUROPE_SCOPE) return "Top 7 Europe + UEFA";
  return competitions.find((competition) => competition.id === value)?.name;
}

export function CompetitionsPane({
  competitions,
  ids,
  close,
  onApply,
  single = false,
  allLabel = "Toutes",
  europePreset = "selection",
}) {
  const f = useFootball();
  const detailedCompetitions = useMemo(() => {
    const catalog = f?.allCatalog || [];
    const byId = new Map(catalog.map((item) => [item.id, item]));
    const byName = new Map();
    for (const item of catalog) byName.set(item.name, byName.has(item.name) ? null : item);
    return competitions.map((competition) => {
      const metadata = byId.get(competition.id) || byName.get(competition.name);
      return metadata ? { ...metadata, ...competition } : competition;
    });
  }, [competitions, f?.allCatalog]);
  const draft = useCompetitionDraft(detailedCompetitions, ids);
  const current = competitions.find((competition) => draft.selected.has(competition.id));
  const unavailable = single && (current?.disabled || (!current && !allLabel));
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
        {(allLabel || europePreset) && (
          <div
            className="home-settings-presets"
            role="group"
            aria-label="Sélections de compétitions"
          >
            {allLabel && (
              <button type="button" aria-pressed={selected.size === 0} onClick={() => setSelected(new Set())}>
                {allLabel}
              </button>
            )}
            {europePreset && (
              <button
                type="button"
                aria-pressed={europePreset === "scope" ? selected.has(EUROPE_SCOPE) : isEurope && selected.size > 0}
                onClick={() => setSelected(new Set(europePreset === "scope" ? [EUROPE_SCOPE] : europe))}
              >
                Top 7 Europe + UEFA
              </button>
            )}
          </div>
        )}
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
            disabled={competition.disabled}
            onClick={() => single ? setSelected(new Set([competition.id])) : toggle(competition.id)}
          >
            {selected.has(competition.id) && (
              <Icon name="check" className="home-settings-check" />
            )}
            <Media name={competition.name} url={competition.imageUrl} />
            <strong>{competition.name}</strong>
            {competition.detail ? <small>{competition.detail}</small> :
              (competition.country || competition.country_code || competition.countryCode || competition.id.startsWith("l_")) && (
                <small>{competitionCountryLabel(competition)}</small>
              )}
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
          {single && selected.size === 1
            ? choiceLabel(competitions, [...selected][0])
            : draftCount(draft)}
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
          disabled={unavailable}
          onClick={() => {
            onApply(draft);
            close(true);
          }}
        >
          Appliquer
        </button>
      </div>
    </>
  );
}

export function CompetitionPicker({
  competitions,
  value = "all",
  onChange,
  label = "Compétition",
  summary,
  allLabel = "Toutes",
  topEurope = false,
  disabled = false,
  controlId,
  selectedIds,
  bare = false,
}) {
  const text = summary || choiceLabel(competitions, value) || "Toutes les compétitions";
  const initial = selectedIds?.length ? selectedIds : value === "all" ? [] : [value];
  return (
    <SettingsPicker
      pane="competitions"
      icon="filters"
      label={label}
      text={text}
      disabled={disabled}
      controlId={controlId}
      value={value}
      bare={bare}
    >
      {(close) => (
        <CompetitionsPane
          competitions={competitions}
          ids={initial}
          close={close}
          single
          allLabel={allLabel}
          europePreset={topEurope ? "scope" : null}
          onApply={({ selected }) => {
            if (selected.size === initial.length && initial.every((id) => selected.has(id))) return;
            onChange([...selected][0] || "all");
          }}
        />
      )}
    </SettingsPicker>
  );
}

export function FollowedCompetitionsPicker({ f, trigger }) {
  const { competitions, ids, label } = useHomeCompetitions(f);
  return (
    <SettingsPicker
      pane="competitions"
      icon="filters"
      label={trigger?.label || "Compétitions suivies"}
      text={trigger?.text || label}
      triggerClassName={trigger?.className}
    >
      {(close) => (
        <CompetitionsPane
          competitions={competitions}
          ids={ids}
          close={close}
          onApply={(draft) => applyCompetitionDraft(f, draft)}
        />
      )}
    </SettingsPicker>
  );
}

/* The competition page's choice of competition (§ 82, piste B): the home's panel of tiles, with the page's lists in
   its track (« À la une » or « Mes compétitions », then « Toutes », grouped by country as the former « Toutes les
   compétitions » page was), the search over every competition, and a tile that opens its page at once. It replaces
   the row of ten cards and the directory page. */
export function CompetitionSwitcher({ lists, current, onPick, label = "Compétition", bare = true }) {
  const all = lists[lists.length - 1];
  const chosen = all.competitions.find((competition) => competition.id === current?.id) || current;
  return (
    <SettingsPicker
      pane="competitions"
      icon="filters"
      label={label}
      text={chosen?.name || "Choisir"}
      bare={bare}
      value={chosen?.id}
    >
      {(close) => (
        <SwitcherPane
          lists={lists}
          current={chosen}
          onPick={(id) => {
            close();
            if (id !== chosen?.id) onPick(id);
          }}
        />
      )}
    </SettingsPicker>
  );
}

function SwitcherPane({ lists, current, onPick }) {
  const [list, setList] = useState(
    () => (lists.find((entry) => entry.competitions.some((competition) => competition.id === current?.id)) || lists[0]).key,
  );
  const [query, setQuery] = useState("");
  const search = normalizeCompetitionQuery(query).trim();
  const shown = lists.find((entry) => entry.key === list) || lists[0];
  const every = lists[lists.length - 1];
  // A search looks through every competition, whatever list is shown.
  const found = search
    ? every.competitions.filter((competition) =>
        // Same search as the former directory: the other names too (Carabao Cup, Copa del Rey, Mondial), Codex on #262.
        competitionSearchText(competition, competitionCountryLabel(competition)).includes(search),
      )
    : null;
  const groups = !found && shown.grouped ? competitionGroups(shown.competitions) : null;
  const tile = (competition) => (
    <button
      key={competition.id}
      type="button"
      className="home-settings-tile"
      data-league={competition.id}
      aria-pressed={competition.id === current?.id}
      onClick={() => onPick(competition.id)}
    >
      {competition.id === current?.id && <Icon name="check" className="home-settings-check" />}
      <Media name={competition.name} url={competition.imageUrl} />
      <strong>{competition.name}</strong>
      <small>{competition.detail || competitionCountryLabel(competition)}</small>
    </button>
  );
  return (
    <div className="competition-switcher">
      <div className="home-settings-tools">
        {lists.length > 1 && (
          <div className="home-settings-presets" role="group" aria-label="Listes de compétitions">
            {lists.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={!search && entry.key === shown.key}
                onClick={() => {
                  setList(entry.key);
                  setQuery("");
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
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
      {groups ? (
        <div className="home-settings-tiles competition-switcher-groups">
          {groups.map((group) => (
            <section key={group.key} className="competition-switcher-country" aria-label={group.label}>
              <h3>{group.label}</h3>
              <div className="competition-switcher-tiles" role="group" aria-label={group.label}>
                {group.competitions.map(tile)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="home-settings-tiles" role="group" aria-label="Compétitions">
          {(found || shown.competitions).map(tile)}
          {!(found || shown.competitions).length && (
            <p className="home-settings-empty">Aucune compétition pour cette recherche.</p>
          )}
        </div>
      )}
    </div>
  );
}
