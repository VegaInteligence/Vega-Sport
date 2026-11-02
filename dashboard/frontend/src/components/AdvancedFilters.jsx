import React, { useEffect, useId, useState } from "react";
import Icon from "./Icon.jsx";
import { Segments } from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import {
  CONDITION_METRICS,
  MAX_CONDITIONS,
  POSITIONS,
  RESULTS,
  ROLES,
  VENUES,
  countAdvanced,
} from "../services/advanced-filters.js";

/** Number input that keeps what is being typed ("7," or "0.") and only
 *  publishes complete numbers. */
function NumberField({ value, onChange, ...props }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (Number.parseFloat(text.replace(",", ".")) !== value)
      setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number.parseFloat(e.target.value.replace(",", "."));
        onChange(Number.isFinite(parsed) ? parsed : null);
      }}
      {...props}
    />
  );
}

export function AdvancedToggle({ open, onToggle, controls }) {
  const f = useFootball(),
    count = countAdvanced(f.filters.advanced);
  return (
    <button
      type="button"
      className="competition-scope-button advanced-toggle"
      aria-expanded={open}
      aria-controls={controls}
      aria-pressed={count > 0}
      onClick={onToggle}
    >
      <Icon name="filters" />
      Filtres avancés
      {count > 0 && <span className="advanced-count">{count}</span>}
    </button>
  );
}

export function AdvancedPanel({ id }) {
  const f = useFootball(),
    advanced = f.filters.advanced,
    base = useId();
  const update = (change) =>
    f.setFilters((v) => ({
      ...v,
      advanced: { ...v.advanced, ...change(v.advanced) },
    }));
  const used = new Set(advanced.conditions.map((c) => c.key));
  return (
    <div className="advanced-panel" id={id}>
      <div className="advanced-field advanced-position-field">
        <span className="advanced-label" id={`${base}-pos`}>
          Position
        </span>
        <div
          className="segmented-control"
          role="group"
          aria-labelledby={`${base}-pos`}
        >
          <button
            type="button"
            aria-pressed={advanced.positions.length === 0}
            onClick={() => update(() => ({ positions: [] }))}
          >
            Tous les postes
          </button>
          {POSITIONS.map(([key, label]) => {
            const on = advanced.positions.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  update((a) => ({
                    positions: on
                      ? a.positions.filter((p) => p !== key)
                      : [...a.positions, key],
                  }))
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="advanced-field">
        <span className="advanced-label">Statut</span>
        <Segments
          label="Statut dans le match"
          value={advanced.role}
          items={ROLES}
          onChange={(role) => update(() => ({ role }))}
        />
      </div>
      <div className="advanced-field">
        <span className="advanced-label">Lieu</span>
        <Segments
          label="Lieu du match"
          value={advanced.venue}
          items={VENUES}
          onChange={(venue) => update(() => ({ venue }))}
        />
      </div>
      <div className="advanced-field">
        <span className="advanced-label">Résultat de l’équipe</span>
        <Segments
          label="Résultat de l’équipe"
          value={advanced.result}
          items={RESULTS}
          onChange={(result) => update(() => ({ result }))}
        />
      </div>
      <div className="advanced-field">
        <label className="advanced-label" htmlFor={`${base}-rating`}>
          Note moyenne minimale
        </label>
        <NumberField
          id={`${base}-rating`}
          className="advanced-input"
          min="0"
          max="10"
          step="0.1"
          placeholder="Ex. 7"
          value={advanced.rating}
          onChange={(rating) => update(() => ({ rating }))}
        />
      </div>
      <div className="advanced-field">
        <span className="advanced-label">Période</span>
        <div className="advanced-dates">
          <input
            type="date"
            className="advanced-input"
            aria-label="Depuis le"
            value={advanced.from}
            max={advanced.to || undefined}
            onChange={(e) => update(() => ({ from: e.target.value }))}
          />
          <span aria-hidden="true">→</span>
          <input
            type="date"
            className="advanced-input"
            aria-label="Jusqu’au"
            value={advanced.to}
            min={advanced.from || undefined}
            onChange={(e) => update(() => ({ to: e.target.value }))}
          />
        </div>
      </div>
      <div className="advanced-field advanced-conditions">
        <span className="advanced-label">
          {f.filters.basis === "per90"
            ? "Statistiques moyennes par 90 minutes"
            : "Statistiques moyennes par match"}
        </span>
        {advanced.conditions.map((condition, index) => (
          <div className="advanced-condition" key={index}>
            <select
              className="advanced-input"
              aria-label={`Statistique ${index + 1}`}
              value={condition.key}
              onChange={(e) =>
                update((a) => ({
                  conditions: a.conditions.map((c, i) =>
                    i === index ? { ...c, key: e.target.value } : c,
                  ),
                }))
              }
            >
              {CONDITION_METRICS.map(([key, label]) => (
                <option
                  key={key}
                  value={key}
                  disabled={key !== condition.key && used.has(key)}
                >
                  {label}
                </option>
              ))}
            </select>
            <span aria-hidden="true">≥</span>
            <NumberField
              className="advanced-input"
              aria-label={`Valeur minimale de la statistique ${index + 1}`}
              min="0"
              step="any"
              value={condition.min}
              onChange={(min) =>
                min !== null &&
                update((a) => ({
                  conditions: a.conditions.map((c, i) =>
                    i === index ? { ...c, min } : c,
                  ),
                }))
              }
            />
            <button
              type="button"
              className="advanced-remove"
              aria-label={`Retirer la condition ${index + 1}`}
              onClick={() =>
                update((a) => ({
                  conditions: a.conditions.filter((_, i) => i !== index),
                }))
              }
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        {advanced.conditions.length < MAX_CONDITIONS && (
          <button
            type="button"
            className="inline-link advanced-add"
            onClick={() =>
              update((a) => ({
                conditions: [
                  ...a.conditions,
                  {
                    key:
                      CONDITION_METRICS.find(([key]) => !used.has(key))?.[0] ||
                      "goals",
                    min: 1,
                  },
                ],
              }))
            }
          >
            + Ajouter une condition
          </button>
        )}
      </div>
    </div>
  );
}
