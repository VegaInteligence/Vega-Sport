"use client";
import React, { useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
} from "../services/season-player.js";
import { playerDirectoryScope } from "../services/player-directory.js";
import { EMPTY_ADVANCED } from "../services/advanced-filters.js";
import {
  buildCohorts,
  metricAxes,
  median,
  METRIC_PRESETS,
  profileValue,
  rankMetric,
  SCOUT_METRICS,
} from "../services/scouting.js";
import { comparisonKey, DEFAULT_SAMPLE } from "../services/research-storage.js";
import {
  loadPlayerSeason,
  playerRoutes,
} from "../services/scouting-history.js";
import { useResource, download } from "../services/resources.js";
import { csvString } from "../model.js";
import { isNumber, number } from "../services/format.js";
import { EUROPE_FOCUS_IDS } from "../../../shared/competition-scope.js";
import { AsyncState, Empty, Modal, Segments } from "./UI.jsx";
import { MetricInfo, MetricPicker, ReportButton } from "./ResearchUI.jsx";
import { ResearchRadar } from "./ResearchCharts.jsx";

export async function comparisonSamples(f, entries) {
  const routing = await playerRoutes(f.manifest);
  return Promise.all(
    entries.map(async (entry) => {
      const available = routing.routes[entry.id]?.[entry.season] || [];
      const selectedIds = available.filter(
        (id) =>
          (entry.scope.league === "all" || entry.scope.league === id) &&
          (entry.scope.focus !== "europe" || EUROPE_FOCUS_IDS.has(id)),
      );
      const loaded = new Set(f.data.competitions.map((c) => c.id));
      const canReuse =
        entry.season === f.season && selectedIds.every((id) => loaded.has(id));
      const data = canReuse
        ? f.data
        : (await loadPlayerSeason(f.manifest, entry.id, entry.season)).data;
      const empty = {
        ...entry,
        profile: { ...aggregateSeason([], entry.id), name: entry.name },
        profiles: [],
        available,
      };
      if (!data) return empty;
      const context = {
        ...EMPTY_ADVANCED,
        role: entry.scope.role,
        venue: entry.scope.venue,
        result: entry.scope.result,
        from: entry.scope.from,
        to: entry.scope.to,
      };
      const rows = playerDirectoryScope(
        data.appearances.filter((row) => selectedIds.includes(row.leagueId)),
        entry.season,
        {
          league: entry.scope.league,
          query: "",
          minutes: 0,
          match: "all",
          advanced: context,
        },
        new Map(data.matches.map((m) => [m.id, m])),
      );
      const profiles = aggregateSeasonPlayers(rows);
      return {
        ...entry,
        profile: profiles.find((p) => p.id === entry.id) || empty.profile,
        profiles,
        available,
        competitionNames: [...new Set(rows.map((row) => row.league))],
      };
    }),
  );
}

function ComparisonContent({ samples, basis, keys, withMedian, minMinutes }) {
  const cohorts = useMemo(
    () => samples.map((item) => buildCohorts(item.profiles, minMinutes)),
    [samples, minMinutes],
  );
  const value = (item, i, key) =>
    basis === "centiles"
      ? rankMetric(item.profile, key, cohorts[i]).percentile
      : profileValue(item.profile, key, basis);
  const table = (
    <div className="table-scroll">
      <table className="data-table research-comparison-table">
        <caption className="sr-only">
          Comparaison des joueurs et de leurs saisons
        </caption>
        <thead>
          <tr>
            <th scope="col">Indicateur</th>
            {samples.map((item, i) => (
              <th scope="col" key={i}>
                {item.name}
                <small>
                  {item.season} · {item.profile.role?.label || "Poste inconnu"}
                </small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ["matches", "Matchs"],
            ["minutes", "Minutes jouées"],
            ["rating", "Note"],
          ].map(([key, label]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              {samples.map((item, i) => (
                <td key={i}>
                  {number(
                    profileValue(item.profile, key),
                    key === "rating" ? 2 : 0,
                  )}
                </td>
              ))}
            </tr>
          ))}
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row">
                {SCOUT_METRICS[key].label}
                <MetricInfo metric={key} />
              </th>
              {samples.map((item, i) => {
                const result = rankMetric(item.profile, key, cohorts[i]);
                const peerMedian =
                  basis === "centiles"
                    ? result.percentile == null
                      ? null
                      : 50
                    : median(
                        (
                          cohorts[i].groups.get(item.profile.role?.group)
                            ?.profiles || []
                        )
                          .filter(
                            (p) =>
                              rankMetric(p, key, cohorts[i]).percentile != null,
                          )
                          .map((p) => profileValue(p, key, basis)),
                      );
                return (
                  <td key={i}>
                    {number(value(item, i, key), basis === "centiles" ? 0 : 2)}
                    {SCOUT_METRICS[key].unit && basis !== "centiles"
                      ? ` ${SCOUT_METRICS[key].unit}`
                      : ""}
                    <small>
                      {result.count}/{item.profile.matches} matchs renseignés
                    </small>
                    {withMedian && (
                      <small>
                        Médiane au poste : {number(peerMedian, 2)} ·{" "}
                        {number(result.peers)} pairs
                      </small>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const exportRows = [
    "indicateur",
    ...samples.map((s) => `${s.name} ${s.season}`),
  ];
  return (
    <>
      {keys.length >= 3 && (
        <ResearchRadar
          title="Comparaison en centiles au poste"
          context={`${minMinutes} minutes minimum ; cohortes propres aux compétitions de chaque colonne`}
          axes={metricAxes(keys)}
          series={[
            ...samples.map((sample, i) => ({
              name: `${sample.name} ${sample.season}`,
              values: Object.fromEntries(
                keys.map((key) => [
                  key,
                  rankMetric(sample.profile, key, cohorts[i]).percentile,
                ]),
              ),
            })),
            ...(withMedian && samples.length < 4
              ? [
                  {
                    name: "Médiane au poste",
                    values: Object.fromEntries(
                      keys
                        .filter((key) => SCOUT_METRICS[key].rankable)
                        .map((key) => [key, 50]),
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {table}
      <div className="research-toolbar">
        <button
          className="button button-secondary"
          onClick={() =>
            download(
              "statarena-comparaison-joueurs.csv",
              csvString(
                exportRows,
                keys.map((key) => [
                  SCOUT_METRICS[key].label,
                  ...samples.map((sample, i) => value(sample, i, key)),
                ]),
              ),
              "text/csv;charset=utf-8",
            )
          }
        >
          Exporter CSV
        </button>
        <ReportButton
          title="Comparaison de joueurs"
          context={`${basis} · ${minMinutes} minutes minimum · ${samples.map((item) => item.season).join(" / ")}`}
          data={samples.map((item, i) => ({
            id: item.id,
            name: item.name,
            season: item.season,
            scope: item.scope,
            minutes: item.profile.minutes,
            metrics: Object.fromEntries(
              keys.map((key) => [
                key,
                {
                  value: value(item, i, key),
                  ...rankMetric(item.profile, key, cohorts[i]),
                },
              ]),
            ),
          }))}
        >
          {table}
        </ReportButton>
      </div>
    </>
  );
}

export default function PlayerComparison({ onClose }) {
  const f = useFootball(),
    r = useResearch();
  const [basis, setBasis] = useState(f.filters.basis || "perMatch"),
    [withMedian, setWithMedian] = useState(true),
    [minMinutes, setMinMinutes] = useState(450);
  const keys = r.data.settings.comparisonMetrics;
  const entries = r.data.comparison;
  const resource = useResource(
    `comparison:${f.client.id}:${entries.map(comparisonKey).join("|")}`,
    () => comparisonSamples(f, entries),
    entries.length >= 2,
  );
  const change = (index, patch) =>
    r.update((previous) => ({
      ...previous,
      comparison: previous.comparison.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  return (
    <Modal
      title="Comparer les joueurs"
      onClose={onClose}
      className="research-wide-dialog"
    >
      {entries.length < 2 ? (
        <Empty>Sélectionnez au moins deux joueurs ou saisons.</Empty>
      ) : (
        <>
          <div className="research-comparison-picks">
            {entries.map((entry, i) => (
              <div key={i}>
                <strong>{entry.name}</strong>
                <label>
                  Saison
                  <select
                    aria-label={`Saison de ${entry.name} ${i + 1}`}
                    value={entry.season}
                    onChange={(e) =>
                      change(i, {
                        season: e.target.value,
                        scope: DEFAULT_SAMPLE,
                      })
                    }
                  >
                    {f.manifest.seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Compétition
                  <select
                    aria-label={`Compétition de ${entry.name} ${i + 1}`}
                    value={entry.scope.league}
                    onChange={(e) =>
                      change(i, {
                        scope: { ...entry.scope, league: e.target.value },
                      })
                    }
                  >
                    <option value="all">Toutes ses compétitions</option>
                    {(resource.value?.[i]?.available || [entry.scope.league])
                      .filter((id) => id !== "all")
                      .map((id) => (
                        <option key={id} value={id}>
                          {f.manifest.seasons
                            .flatMap((s) =>
                              s.chunks.flatMap((c) => c.competitions || []),
                            )
                            .find((c) => c.id === id)?.name ||
                            "Compétition archivée"}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="inline-link"
                  onClick={() => r.toggleComparison(entry)}
                >
                  Retirer
                </button>
              </div>
            ))}
          </div>
          <div className="research-toolbar">
            <Segments
              label="Valeurs de comparaison"
              value={basis}
              onChange={setBasis}
              items={[
                ["perMatch", "Par match"],
                ["per90", "Par 90"],
                ["total", "Totaux"],
                ["centiles", "Centiles"],
              ]}
            />
            <label>
              Modèle
              <select
                aria-label="Modèle de comparaison"
                value=""
                onChange={(e) =>
                  r.setSettings({
                    comparisonMetrics: METRIC_PRESETS[e.target.value].keys,
                  })
                }
              >
                <option value="" disabled>
                  Choisir un modèle
                </option>
                {Object.entries(METRIC_PRESETS).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <MetricPicker
              label="Axes et indicateurs"
              value={keys}
              onChange={(comparisonMetrics) =>
                r.setSettings({ comparisonMetrics })
              }
            />
            <label>
              <input
                type="checkbox"
                checked={withMedian}
                onChange={(e) => setWithMedian(e.target.checked)}
              />
              Médiane au poste
            </label>
            <label>
              Minutes minimum
              <input
                type="number"
                aria-label="Minutes minimum des pairs"
                min="0"
                max="9000"
                step="90"
                value={minMinutes}
                onChange={(e) =>
                  setMinMinutes(
                    Math.max(0, Math.min(9000, Number(e.target.value) || 0)),
                  )
                }
              />
            </label>
          </div>
          <AsyncState resource={resource}>
            {(samples) => (
              <ComparisonContent
                samples={samples}
                basis={basis}
                keys={keys}
                withMedian={withMedian}
                minMinutes={minMinutes}
              />
            )}
          </AsyncState>
        </>
      )}
    </Modal>
  );
}
