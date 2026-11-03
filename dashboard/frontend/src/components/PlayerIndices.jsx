"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import {
  buildCohorts,
  customIndex,
  ROLE_PROFILES,
  SCOUT_METRICS,
  SCOUTING_VERSION,
} from "../services/scouting.js";
import { cleanIndex } from "../services/research-storage.js";
import { number } from "../services/format.js";
import { Card, Empty, Modal, Pager } from "./UI.jsx";
import { BookmarkButton, MetricInfo, SavedViews } from "./ResearchUI.jsx";

export default function PlayerIndices({ rows, profiles }) {
  const f = useFootball(),
    r = useResearch(),
    config = r.data.settings.index;
  const [expanded, setExpanded] = useState(false),
    [explain, setExplain] = useState(null),
    [method, setMethod] = useState(false),
    [minimum, setMinimum] = useState(""),
    [includeUnknown, setIncludeUnknown] = useState(false),
    [page, setPage] = useState(1);
  const cohorts = useMemo(
    () => buildCohorts(profiles, config.minMinutes),
    [profiles, config.minMinutes],
  );
  const results = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            !config.groups?.length ||
            config.groups.includes(row.profile.role?.group),
        )
        .map((row) => ({
          row,
          index: customIndex(row.profile, cohorts, config),
        }))
        .sort(
          (a, b) =>
            (b.index.value ?? -1) - (a.index.value ?? -1) ||
            a.row.name.localeCompare(b.row.name, "fr"),
        ),
    [rows, cohorts, config],
  );
  const visible = results.filter(
    (item) =>
      (includeUnknown || item.index.value != null) &&
      (minimum === "" ||
        (item.index.value != null && item.index.value >= Number(minimum))),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(visible.length / 20)));
  const setConfig = (patch) => {
    r.setSettings({ index: cleanIndex({ ...config, ...patch }) });
    setPage(1);
  };
  const updateWeight = (i, patch) =>
    setConfig({
      weights: config.weights.map((item, n) =>
        i === n ? { ...item, ...patch } : item,
      ),
    });
  return (
    <Card
      title="Indice personnalisé"
      action={
        <>
          <SavedViews />
          <button
            className="button button-secondary"
            onClick={() => setMethod(true)}
          >
            Méthode
          </button>
        </>
      }
    >
      <div className="research-toolbar">
        <label>
          Profil
          <select
            aria-label="Profil d’indice"
            value=""
            onChange={(e) => {
              const role = ROLE_PROFILES.find(
                (item) => item.id === e.target.value,
              );
              setConfig({
                name: role.label,
                groups: role.groups,
                weights: role.keys.map((key) => ({
                  key,
                  weight: 1,
                  direction: "max",
                })),
              });
            }}
          >
            <option value="" disabled>
              Choisir un profil
            </option>
            {ROLE_PROFILES.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modèle enregistré
          <select
            aria-label="Modèle d’indice enregistré"
            value=""
            onChange={(e) =>
              setConfig(
                r.data.templates.find((item) => item.id === e.target.value),
              )
            }
          >
            <option value="" disabled>
              Choisir
            </option>
            {r.data.templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button-secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          Personnaliser
        </button>
        <label>
          Score minimum
          <input
            type="number"
            aria-label="Indice minimum"
            min="0"
            max="100"
            value={minimum}
            onChange={(e) => {
              setMinimum(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeUnknown}
            onChange={(e) => setIncludeUnknown(e.target.checked)}
          />
          Inclure les indices indisponibles
        </label>
      </div>
      {expanded && (
        <section className="research-editor" aria-label="Éditeur de l’indice">
          <div className="research-toolbar">
            <label>
              Nom
              <input
                aria-label="Nom de l’indice"
                value={config.name}
                maxLength={60}
                onChange={(e) => setConfig({ name: e.target.value })}
              />
            </label>
            <label>
              Minutes minimum
              <input
                type="number"
                aria-label="Minutes minimum de l’indice"
                min="0"
                max="9000"
                step="90"
                value={config.minMinutes}
                onChange={(e) =>
                  setConfig({ minMinutes: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label>
              Poste
              <select
                aria-label="Poste de l’indice"
                value={
                  config.groups?.length === 1
                    ? config.groups[0]
                    : config.groups?.length
                      ? "compatible"
                      : "all"
                }
                onChange={(e) =>
                  setConfig({
                    groups: e.target.value === "all" ? [] : [e.target.value],
                  })
                }
              >
                <option value="all">Tous les postes</option>
                <option value="compatible" disabled>
                  Postes du profil
                </option>
                {[
                  ["G", "Gardien"],
                  ["D", "Défenseur"],
                  ["M", "Milieu"],
                  ["O", "Milieu offensif"],
                  ["F", "Attaquant"],
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              onClick={() =>
                r.update((previous) => ({
                  ...previous,
                  templates: [
                    ...previous.templates,
                    { ...config, id: `index-${Date.now()}` },
                  ],
                }))
              }
            >
              Enregistrer le modèle
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table research-weight-table">
              <thead>
                <tr>
                  <th>Indicateur</th>
                  <th>Objectif</th>
                  <th>Importance</th>
                  <th>Retirer</th>
                </tr>
              </thead>
              <tbody>
                {config.weights.map((weight, i) => (
                  <tr key={weight.key}>
                    <td>
                      <select
                        aria-label={`Indicateur ${i + 1} de l’indice`}
                        value={weight.key}
                        onChange={(e) =>
                          updateWeight(i, { key: e.target.value })
                        }
                      >
                        {Object.entries(SCOUT_METRICS)
                          .filter(
                            ([key, definition]) =>
                              definition.rankable &&
                              (key === weight.key ||
                                !config.weights.some((w) => w.key === key)),
                          )
                          .map(([key, definition]) => (
                            <option key={key} value={key}>
                              {definition.label}
                            </option>
                          ))}
                      </select>
                      <MetricInfo metric={weight.key} />
                    </td>
                    <td>
                      <select
                        aria-label={`Objectif pour ${SCOUT_METRICS[weight.key].label}`}
                        value={weight.direction}
                        onChange={(e) =>
                          updateWeight(i, { direction: e.target.value })
                        }
                      >
                        <option value="max">Maximiser</option>
                        <option value="min">Minimiser</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label={`Importance de ${SCOUT_METRICS[weight.key].label}`}
                        min="0"
                        max="100"
                        step=".5"
                        value={weight.weight}
                        onChange={(e) =>
                          updateWeight(i, {
                            weight: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Retirer ${SCOUT_METRICS[weight.key].label} de l’indice`}
                        onClick={() =>
                          setConfig({
                            weights: config.weights.filter((_, n) => n !== i),
                          })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="inline-link"
            onClick={() => {
              const key = Object.keys(SCOUT_METRICS).find(
                (key) =>
                  SCOUT_METRICS[key].rankable &&
                  !config.weights.some((w) => w.key === key),
              );
              if (key)
                setConfig({
                  weights: [
                    ...config.weights,
                    { key, weight: 1, direction: "max" },
                  ],
                });
            }}
          >
            Ajouter un indicateur
          </button>
        </section>
      )}
      <div className="research-context">
        <strong>{config.name}</strong>
        <span>
          {number(results.filter((item) => item.index.value != null).length)} /{" "}
          {number(results.length)} joueurs évaluables · {config.minMinutes} min
          · centiles au poste
        </span>
      </div>
      {visible.length ? (
        <>
          <div className="table-scroll">
            <table className="data-table research-index-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Joueur</th>
                  <th>Poste</th>
                  <th>Minutes</th>
                  <th>Indice / 100</th>
                  <th>Détail</th>
                </tr>
              </thead>
              <tbody>
                {visible
                  .slice((current - 1) * 20, current * 20)
                  .map((item, i) => (
                    <tr
                      key={item.row.playerId}
                      data-player-id={item.row.playerId}
                    >
                      <td>{(current - 1) * 20 + i + 1}</td>
                      <th>
                        <Link
                          href={f.href("/joueurs/", {
                            id: item.row.playerId,
                            q: "",
                          })}
                        >
                          {item.row.name}
                        </Link>
                        <small>{item.row.team}</small>
                      </th>
                      <td>{item.row.position}</td>
                      <td>{number(item.row.profile.minutes)}</td>
                      <td className="research-index-score">
                        {number(item.index.value, 1)}
                      </td>
                      <td>
                        <span className="research-row-actions">
                          <button
                            className="inline-link"
                            onClick={() => setExplain(item)}
                          >
                            Contributions
                          </button>
                          <BookmarkButton
                            kind="players"
                            id={item.row.playerId}
                            name={item.row.name}
                            season={f.season}
                            compact
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={current}
            total={Math.max(1, Math.ceil(visible.length / 20))}
            onChange={setPage}
          />
        </>
      ) : (
        <Empty>
          Aucun indice calculable pour ces critères. Réduisez les minutes ou
          élargissez les compétitions ; chaque indicateur requiert 30 pairs et
          une couverture complète.
        </Empty>
      )}
      {explain && (
        <Modal
          title={`${explain.row.name} · ${config.name}`}
          onClose={() => setExplain(null)}
        >
          <p>{explain.index.reason}</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Indicateur</th>
                  <th>Valeur / 90 ou %</th>
                  <th>Pairs</th>
                  <th>Centile</th>
                  <th>Poids</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {explain.index.parts.map((part) => (
                  <tr key={part.key}>
                    <th>
                      {SCOUT_METRICS[part.key].label}{" "}
                      {part.direction === "min" ? "↓" : "↑"}
                    </th>
                    <td>{number(part.value, 2)}</td>
                    <td>{part.peers}</td>
                    <td>{number(part.percentile)}</td>
                    <td>{number(part.share * 100)} %</td>
                    <td>{number(part.contribution, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <strong>Indice : {number(explain.index.value, 2)} / 100</strong>
        </Modal>
      )}
      {method && (
        <Modal
          title="Calcul de l’indice personnalisé"
          onClose={() => setMethod(false)}
        >
          <p>
            Somme des centiles pondérés, divisée par la somme des poids. Pour un
            objectif à minimiser, le centile est remplacé par 100 − centile.
          </p>
          <p>
            Les joueurs sont comparés au même poste, dans la saison et les
            compétitions choisies. Chaque statistique doit couvrir tous les
            matchs joués ; au moins 30 pairs et le minimum de minutes sont
            requis. Une mesure absente rend l’indice indisponible.
          </p>
          <p>
            Les profils décrivent des dimensions statistiques. Ils ne
            constituent pas une attribution tactique, une projection de
            transfert ou le classement Ballon d’Or validé.
          </p>
          <small>{SCOUTING_VERSION}</small>
        </Modal>
      )}
    </Card>
  );
}
