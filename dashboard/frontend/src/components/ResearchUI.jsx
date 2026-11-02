"use client";
import React, { useId, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { SCOUT_METRICS, SCOUTING_VERSION } from "../services/scouting.js";
import {
  cleanResearch,
  comparisonKey,
  playerSelection,
} from "../services/research-storage.js";
import { download } from "../services/resources.js";
import { number } from "../services/format.js";
import { Card, Empty, Modal } from "./UI.jsx";
import Icon from "./Icon.jsx";

export function ResearchTabs({ label, value, items, onChange, panelId }) {
  const id = useId(),
    refs = useRef([]);
  return (
    <div className="research-tabs" role="tablist" aria-label={label}>
      {items.map(([key, title], i) => (
        <button
          key={key}
          ref={(node) => {
            refs.current[i] = node;
          }}
          type="button"
          role="tab"
          id={`${id}-${key}`}
          aria-controls={panelId}
          aria-selected={key === value}
          tabIndex={key === value ? 0 : -1}
          onClick={() => onChange(key)}
          onKeyDown={(event) => {
            let next;
            if (event.key === "ArrowRight") next = (i + 1) % items.length;
            if (event.key === "ArrowLeft")
              next = (i + items.length - 1) % items.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = items.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              onChange(items[next][0]);
              refs.current[next]?.focus();
            }
          }}
        >
          {title}
        </button>
      ))}
    </div>
  );
}

export function MetricInfo({ metric, observed, total }) {
  const [open, setOpen] = useState(false);
  const definition = SCOUT_METRICS[metric];
  if (!definition) return null;
  return (
    <>
      <button
        type="button"
        className="metric-info"
        aria-label={`Définition de ${definition.label}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="info" />
      </button>
      {open && (
        <Modal title={definition.label} onClose={() => setOpen(false)}>
          <p>{definition.description}</p>
          <dl className="research-definition">
            <div>
              <dt>Calcul</dt>
              <dd>
                {definition.ratio
                  ? "Rapport des sommes observées"
                  : "Total, moyenne ou valeur par 90 minutes observées"}
              </dd>
            </div>
            {observed != null && (
              <div>
                <dt>Couverture</dt>
                <dd>
                  {number(observed)} / {number(total)} matchs
                </dd>
              </div>
            )}
            <div>
              <dt>Centiles</dt>
              <dd>
                {definition.rankable
                  ? "Même poste, minimum de minutes et statistique renseignée pour tous les matchs joués. Les ex æquo partagent le rang médian."
                  : "Non calculés : les valeurs absentes empêchent une distribution fiable."}
              </dd>
            </div>
          </dl>
        </Modal>
      )}
    </>
  );
}

export function MetricPicker({
  label = "Indicateurs",
  value,
  onChange,
  includeMeta = false,
}) {
  const [open, setOpen] = useState(false);
  const all = [
    ...(includeMeta
      ? [
          ["matches", { label: "Matchs" }],
          ["minutes", { label: "Minutes moyennes" }],
          ["rating", { label: "Note" }],
        ]
      : []),
    ...Object.entries(SCOUT_METRICS),
  ];
  return (
    <>
      <button className="button button-secondary" onClick={() => setOpen(true)}>
        <Icon name="filters" />
        {label}
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          <div className="research-checklist">
            {all.map(([key, definition]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={value.includes(key)}
                  disabled={value.length === 1 && value[0] === key}
                  onChange={() =>
                    onChange(
                      value.includes(key)
                        ? value.filter((x) => x !== key)
                        : [...value, key],
                    )
                  }
                />
                {definition.label}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

export function BookmarkButton({
  kind,
  id,
  name,
  imageUrl,
  season,
  compact = false,
}) {
  const research = useResearch();
  const selected = research.isFavorite(kind, id);
  return (
    <button
      type="button"
      className={`research-bookmark${selected ? " is-saved" : ""}${compact ? " icon-button" : " button button-secondary"}`}
      disabled={!research.ready}
      aria-pressed={selected}
      aria-label={`${selected ? "Retirer" : "Enregistrer"} ${name} ${selected ? "de" : "dans"} ${research.currentList.name}`}
      onClick={() =>
        research.toggleFavorite({ kind, id, name, imageUrl, season })
      }
    >
      <Icon name="bookmark" />
      {!compact && (selected ? "Enregistré" : "Enregistrer")}
    </button>
  );
}

export function ComparePlayerButton({ profile, season, compact = false }) {
  const research = useResearch();
  const f = useFootball(),
    entry = playerSelection(profile, f, season);
  const selected = research.isComparing(entry);
  return (
    <button
      className={compact ? "icon-button" : "button button-secondary"}
      aria-pressed={selected}
      aria-label={`${selected ? "Retirer" : "Comparer"} ${profile.name} · ${season}`}
      disabled={!research.ready}
      onClick={() => research.toggleComparison(entry)}
    >
      <Icon name="compare" />
      {!compact && (selected ? "Dans la comparaison" : "Comparer")}
    </button>
  );
}

export function ResearchComparisonTray({ performanceComparison = false }) {
  const r = useResearch(),
    f = useFootball();
  if (
    !r.data.comparison.length ||
    r.comparing ||
    (performanceComparison &&
      f.comparison.length &&
      r.comparisonKind === "performances")
  )
    return null;
  return (
    <aside
      className="compare-tray research-compare-tray"
      aria-label="Comparaison de joueurs"
    >
      <strong>{r.data.comparison.length}/4</strong>
      {r.data.comparison.map((item) => (
        <span className="compare-pill" key={comparisonKey(item)}>
          {item.name}
          <small>{item.season}</small>
          <button
            aria-label={`Retirer ${item.name} ${item.season} de la comparaison`}
            onClick={() => r.toggleComparison(item)}
          >
            ×
          </button>
        </span>
      ))}
      <button
        className="button button-primary"
        disabled={r.data.comparison.length < 2}
        onClick={() => r.setComparing(true)}
      >
        Comparer
      </button>
      <button
        className="button button-ghost"
        onClick={() =>
          r.update((previous) => ({ ...previous, comparison: [] }))
        }
      >
        Vider
      </button>
    </aside>
  );
}

export function SavedViews() {
  const r = useResearch();
  const [open, setOpen] = useState(false),
    [name, setName] = useState("");
  return (
    <>
      <button className="button button-secondary" onClick={() => setOpen(true)}>
        <Icon name="save" />
        Recherches
      </button>
      {open && (
        <Modal title="Recherches enregistrées" onClose={() => setOpen(false)}>
          <form
            className="research-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              const view = {
                id: `view-${Date.now()}`,
                name: name.trim(),
                query: window.location.search,
                settings: r.data.settings,
              };
              r.update((previous) => ({
                ...previous,
                views: [...previous.views, view],
              }));
              setName("");
            }}
          >
            <input
              aria-label="Nom de la recherche"
              placeholder="Nom de la recherche"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <button className="button button-primary">
              Enregistrer cette vue
            </button>
          </form>
          <ul className="research-saved-list">
            {r.data.views.map((view) => (
              <li key={view.id}>
                <button
                  className="inline-link"
                  onClick={() => {
                    r.setSettings(view.settings);
                    window.history.replaceState(
                      null,
                      "",
                      "/joueurs?" + view.query,
                    );
                    setOpen(false);
                  }}
                >
                  {view.name}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Supprimer la recherche ${view.name}`}
                  onClick={() =>
                    r.update((previous) => ({
                      ...previous,
                      views: previous.views.filter(
                        (item) => item.id !== view.id,
                      ),
                    }))
                  }
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
          {!r.data.views.length && <Empty>Aucune recherche enregistrée.</Empty>}
        </Modal>
      )}
    </>
  );
}

export function ResearchLists({ kind = "players" }) {
  const r = useResearch(),
    f = useFootball();
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  const input = useRef();
  const entries = r.currentList.entries.filter((item) => item.kind === kind);
  return (
    <Card
      title="Mes listes"
      action={
        <>
          <button
            className="button button-secondary"
            onClick={() =>
              download(
                "statarena-recherches.json",
                JSON.stringify(r.data, null, 2),
              )
            }
          >
            <Icon name="download" />
            Exporter JSON
          </button>
          <button
            className="button button-secondary"
            onClick={() => input.current.click()}
          >
            Importer
          </button>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="Importer des recherches"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 10 * 1024 * 1024)
                  throw new Error("Le fichier dépasse 10 Mo.");
                const imported = cleanResearch(JSON.parse(await file.text()));
                // Keep existing lists when importing; imported names are independently removable.
                r.update((previous) => ({
                  ...previous,
                  lists: [
                    ...previous.lists,
                    ...imported.lists.map((list, i) => ({
                      ...list,
                      id: `import-${Date.now()}-${i}`,
                    })),
                  ],
                  templates: [...previous.templates, ...imported.templates],
                  views: [...previous.views, ...imported.views],
                }));
                setError("");
              } catch (issue) {
                setError(
                  issue instanceof SyntaxError
                    ? "Ce fichier n’est pas un JSON valide."
                    : issue.message,
                );
              }
              event.target.value = "";
            }}
          />
        </>
      }
    >
      <div className="research-toolbar">
        <label>
          Liste
          <select
            aria-label="Liste active"
            value={r.data.activeList}
            onChange={(e) =>
              r.update((previous) => ({
                ...previous,
                activeList: e.target.value,
              }))
            }
          >
            {r.data.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} (
                {list.entries.filter((item) => item.kind === kind).length})
              </option>
            ))}
          </select>
        </label>
        <form
          className="research-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            const list = {
              id: `list-${Date.now()}`,
              name: name.trim(),
              entries: [],
            };
            r.update((previous) => ({
              ...previous,
              lists: [...previous.lists, list],
              activeList: list.id,
            }));
            setName("");
          }}
        >
          <input
            aria-label="Nom de la liste"
            placeholder="Nouvelle liste"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="button button-secondary">Créer une liste</button>
        </form>
        {r.data.lists.length > 1 && (
          <button
            className="button button-ghost"
            onClick={() =>
              r.update((previous) => ({
                ...previous,
                lists: previous.lists.filter(
                  (list) => list.id !== previous.activeList,
                ),
              }))
            }
          >
            Supprimer cette liste
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="notice notice-warning">
          {error}
        </p>
      )}
      {entries.length ? (
        <ul className="research-saved-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={f.href(
                  kind === "players"
                    ? "/joueurs/"
                    : kind === "clubs"
                      ? "/clubs/"
                      : "/matchs/",
                  {
                    id: entry.id,
                    season: entry.season || f.season,
                    league: "all",
                    q: "",
                    rmin: "",
                    stats: "",
                  },
                )}
              >
                {entry.name}
                <small>{entry.season}</small>
              </Link>
              <BookmarkButton {...entry} compact />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          Aucun{" "}
          {kind === "players" ? "joueur" : kind === "clubs" ? "club" : "match"}{" "}
          dans cette liste.
        </Empty>
      )}
    </Card>
  );
}

export function ReportButton({ title, context, children, data }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button button-secondary" onClick={() => setOpen(true)}>
        <Icon name="download" />
        Rapport
      </button>
      {open &&
        createPortal(
          <div className="research-print-root">
            <Modal title={title} onClose={() => setOpen(false)}>
              <article className="research-report">
                <header>
                  <strong>STATARENA</strong>
                  <p>{context}</p>
                  <small>
                    {new Date().toLocaleDateString("fr-FR")} ·{" "}
                    {SCOUTING_VERSION}
                  </small>
                </header>
                {children}
              </article>
              <div className="research-toolbar no-print">
                <button
                  className="button button-primary"
                  onClick={() => window.print()}
                >
                  Imprimer / PDF
                </button>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    download(
                      "statarena-rapport.json",
                      JSON.stringify(
                        {
                          version: SCOUTING_VERSION,
                          title,
                          context,
                          generatedAt: new Date().toISOString(),
                          data,
                        },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  Exporter JSON
                </button>
              </div>
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}
