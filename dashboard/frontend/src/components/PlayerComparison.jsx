"use client";
import React, { useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
  finishedAppearances,
} from "../services/season-player.js";
import { playerDirectoryScope } from "../services/player-directory.js";
import { EMPTY_ADVANCED } from "../services/advanced-filters.js";
import {
  buildCohorts,
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
import { useResource } from "../services/resources.js";
import {
  compactQuery,
  compactScope,
  playerReadParams,
  readCompactPages,
  supportsCompactRead,
} from "../services/compact-reads.js";
import { isNumber, number } from "../services/format.js";
import { EUROPE_FOCUS_IDS } from "../../../shared/competition-scope.js";
import { AsyncState, Empty, Media, Modal } from "./UI.jsx";
import { MetricInfo, MetricPicker, ReportButton } from "./ResearchUI.jsx";
import { COLORS } from "./ResearchCharts.jsx";
import c from "./PlayerComparison.module.css";
import CompetitionOptions from "./CompetitionOptions.jsx";

export async function comparisonSamples(f, entries, { signal } = {}) {
  const routing = await playerRoutes(
      f.manifest,
      { players: entries.map((entry) => entry.id) },
      fetch,
      { signal },
    ),
    cohorts = new Map();
  return Promise.all(
    entries.map(async (entry) => {
      const available = routing.routes[entry.id]?.[entry.season] || [],
        selectedIds = available.filter(
          (id) =>
            (entry.scope.league === "all" || entry.scope.league === id) &&
            (!entry.scope.leagues?.length ||
              entry.scope.leagues.includes(id)) &&
            (entry.scope.focus !== "europe" || EUROPE_FOCUS_IDS.has(id)),
        ),
        context = {
          ...EMPTY_ADVANCED,
          role: entry.scope.role,
          venue: entry.scope.venue,
          result: entry.scope.result,
          from: entry.scope.from,
          to: entry.scope.to,
        },
        empty = {
          ...entry,
          profile: { ...aggregateSeason([], entry.id), name: entry.name },
          profiles: [],
          available,
        };
      if (supportsCompactRead(f.manifest, "players")) {
        const params = {
            ...playerReadParams(
              {
                ...f,
                season: entry.season,
                focus: entry.scope.focus,
                filters: {
                  league: "all",
                  leagues: selectedIds,
                  query: "",
                  minutes: 0,
                  basis: "total",
                  match: "all",
                  advanced: context,
                },
              },
              { cohort: true, limit: 100 },
            ),
            leagues: compactScope(selectedIds),
          },
          key = compactQuery(params);
        if (!cohorts.has(key))
          cohorts.set(
            key,
            readCompactPages("players", params, { signal }).then((value) =>
              value.pages.flatMap((page) =>
                page.players.map((row) => row.profile),
              ),
            ),
          );
        const profiles = await cohorts.get(key);
        return {
          ...entry,
          profile:
            profiles.find((profile) => profile.id === entry.id) ||
            empty.profile,
          profiles,
          available,
          competitionNames: [
            ...new Set(profiles.flatMap((profile) => profile.leagues || [])),
          ],
        };
      }
      const loaded = new Set(
          f.data.competitions.map((competition) => competition.id),
        ),
        canReuse =
          !f.compactMode &&
          entry.season === f.season &&
          selectedIds.every((id) => loaded.has(id)),
        data = canReuse
          ? f.data
          : (
              await loadPlayerSeason(
                f.manifest,
                entry.id,
                entry.season,
                "all",
                routing,
                { signal },
              )
            ).data;
      if (!data) return empty;
      const scoped = playerDirectoryScope(
          data.appearances.filter((row) => selectedIds.includes(row.leagueId)),
          entry.season,
          {
            league: entry.scope.league,
            query: "",
            minutes: 0,
            match: "all",
            advanced: context,
          },
          new Map(data.matches.map((match) => [match.id, match])),
        ),
        // The compared season counts finished matches, reused or loaded alike (VI-23 stage 7, §16.1).
        rows = finishedAppearances(data, scoped),
        profiles = aggregateSeasonPlayers(rows);
      return {
        ...entry,
        profile:
          profiles.find((profile) => profile.id === entry.id) || empty.profile,
        profiles,
        available,
        competitionNames: [...new Set(rows.map((row) => row.league))],
      };
    }),
  );
}

const BASES = [
  ["perMatch", "Par match"],
  ["per90", "Par 90"],
  ["total", "Totaux"],
  ["centiles", "Centiles"],
];

/** A player's card: who, which season and competitions, his matches, minutes and note. */
function PlayerCard({
  entry,
  index,
  sample,
  seasons,
  competitions,
  onChange,
  onRemove,
}) {
  const profile = sample?.profile;
  return (
    <article
      className={c.card}
      style={{ "--c": COLORS[index % 4] }}
      data-comparison-player={entry.id}
    >
      <div className={c.identity}>
        <Media
          name={entry.name}
          url={entry.imageUrl}
          className={`crest ${c.avatar}`}
        />
        <span>
          <strong>
            {entry.name}
            {entry.replaces && <span className={c.tag}>À remplacer</span>}
          </strong>
          <small>
            {[profile?.role?.label, profile?.teams?.[0]]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
      </div>
      <button
        className={c.remove}
        aria-label={`Retirer ${entry.name} ${entry.season} de la comparaison`}
        onClick={onRemove}
      >
        ×
      </button>
      <div className={c.picks}>
        <select
          aria-label={`Saison de ${entry.name} ${index + 1}`}
          value={entry.season}
          onChange={(e) =>
            onChange({ season: e.target.value, scope: DEFAULT_SAMPLE })
          }
        >
          {seasons.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <select
          aria-label={`Compétition de ${entry.name} ${index + 1}`}
          value={entry.scope.league}
          onChange={(e) =>
            onChange({
              scope: { ...entry.scope, league: e.target.value, leagues: [] },
            })
          }
        >
          <option value="all">Toutes ses compétitions</option>
          <CompetitionOptions competitions={competitions} />
        </select>
      </div>
      <dl className={c.facts}>
        <div>
          <dt>Matchs</dt>
          <dd>{profile ? number(profileValue(profile, "matches"), 0) : "—"}</dd>
        </div>
        <div>
          <dt>Minutes</dt>
          <dd>{profile ? number(profileValue(profile, "minutes"), 0) : "—"}</dd>
        </div>
        <div>
          <dt>Note</dt>
          <dd>
            {profile && isNumber(profileValue(profile, "grade"))
              ? number(profileValue(profile, "grade"), 0)
              : "—"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

/** Centiles among each player's role on the chosen axes; an axis read on hover, focus or tap. */
function ComparisonRadar({
  keys,
  samples,
  centiles,
  withMedian,
  active,
  onActive,
}) {
  const W = 460,
    H = 360,
    cx = 230,
    cy = 185,
    R = 125,
    n = keys.length;
  const at = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)];
  };
  const polygon = (values) =>
    values
      .map((v, i) =>
        at(i, v ?? 0)
          .map((x) => x.toFixed(1))
          .join(","),
      )
      .join(" ");
  const ring = (k) => polygon(keys.map(() => k));
  return (
    <figure className={c.radar} data-comparison-radar="">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Profils en centiles au poste"
      >
        {[25, 50, 75, 100].map((k) => (
          <polygon key={k} className={c.grid} points={ring(k)} />
        ))}
        {withMedian && <polygon className={c.median} points={ring(50)} />}
        {samples.map((sample, i) => (
          <polygon
            key={i}
            points={polygon(keys.map((key) => centiles[i][key]))}
            style={{ "--c": COLORS[i % 4] }}
            className={c.series}
          />
        ))}
        {keys.map((key, i) => {
          const [x, y] = at(i, 122);
          const on = active === key;
          return (
            <g
              key={key}
              className={`${c.axis} ${on ? c.axisOn : ""}`}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              aria-label={`${SCOUT_METRICS[key].label} : ${samples.map((sample, n) => `${sample.name} ${centiles[n][key] ?? "—"}`).join(", ")}`}
              data-radar-axis={key}
              onMouseEnter={() => onActive(key)}
              onFocus={() => onActive(key)}
              onClick={() => onActive(on ? null : key)}
            >
              <text x={x} y={y + 4} textAnchor="middle">
                {SCOUT_METRICS[key].short ||
                  SCOUT_METRICS[key].label.split(" · ")[0]}
              </text>
              {on && (
                <text x={x} y={y + 19} textAnchor="middle">
                  {samples.map((sample, n) => (
                    <tspan
                      key={n}
                      dx={n ? 6 : 0}
                      style={{ fill: COLORS[n % 4] }}
                    >
                      {centiles[n][key] ?? "—"}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function ComparisonContent({
  samples,
  basis,
  keys,
  withMedian,
  minMinutes,
  active,
  onActive,
}) {
  const cohorts = useMemo(
    () => samples.map((item) => buildCohorts(item.profiles, minMinutes)),
    [samples, minMinutes],
  );
  const value = (item, i, key) =>
    basis === "centiles"
      ? rankMetric(item.profile, key, cohorts[i]).percentile
      : profileValue(item.profile, key, basis);
  const digits = basis === "centiles" ? 0 : basis === "total" ? 0 : 2;
  const centiles = samples.map((sample, i) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        rankMetric(sample.profile, key, cohorts[i]).percentile,
      ]),
    ),
  );
  const peerMedian = (item, i, key) =>
    basis === "centiles"
      ? 50
      : median(
          (cohorts[i].groups.get(item.profile.role?.group)?.profiles || [])
            .filter((p) => rankMetric(p, key, cohorts[i]).percentile != null)
            .map((p) => profileValue(p, key, basis)),
        );
  const reference = samples.findIndex((sample) => sample.replaces);
  const rows = keys.map((key) => {
    const values = samples.map((item, i) => value(item, i, key));
    const medians = samples.map((item, i) => peerMedian(item, i, key));
    const known = values.filter(isNumber);
    const best = known.length ? values.indexOf(Math.max(...known)) : -1;
    const max = Math.max(...known, ...medians.filter(isNumber), 0) * 1.1 || 1;
    return { key, values, medians, best, max };
  });
  const leads = rows.filter((row) => row.best >= 0);
  const table = (
    <div className={c.tableWrap}>
      <table className={c.table}>
        <caption className="sr-only">
          Comparaison des joueurs et de leurs saisons
        </caption>
        <thead>
          <tr>
            <th scope="col">Indicateur</th>
            {samples.map((item, i) => (
              <th scope="col" key={i}>
                <span className={c.dot} style={{ "--c": COLORS[i % 4] }} />
                {item.name}
                <small>{item.season}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, values, medians, best, max }) => (
            <tr
              key={key}
              className={active === key ? c.rowOn : ""}
              data-comparison-row={key}
            >
              <th scope="row">
                {SCOUT_METRICS[key].label}
                <MetricInfo metric={key} />
              </th>
              {samples.map((item, i) => {
                const result = rankMetric(item.profile, key, cohorts[i]);
                const v = values[i];
                const delta =
                  reference >= 0 &&
                  i !== reference &&
                  isNumber(v) &&
                  isNumber(values[reference])
                    ? v - values[reference]
                    : null;
                return (
                  <td key={i}>
                    <div
                      className={`${c.cell} ${i === best ? c.best : ""}`}
                      style={{ "--c": COLORS[i % 4] }}
                    >
                      <span className={c.value}>
                        <b>
                          {number(v, digits)}
                          {SCOUT_METRICS[key].unit && basis !== "centiles"
                            ? ` ${SCOUT_METRICS[key].unit}`
                            : ""}
                        </b>
                        {delta !== null && (
                          <span className={delta >= 0 ? c.up : c.down}>
                            {delta >= 0 ? "+" : "−"}
                            {number(Math.abs(delta), digits)}
                          </span>
                        )}
                        {result.count < item.profile.matches && (
                          <span
                            className={c.warn}
                            title="Matchs avec la mesure"
                          >
                            ⚠ {result.count}/{item.profile.matches}
                          </span>
                        )}
                      </span>
                      <span
                        className={c.bar}
                        style={{
                          "--w": `${isNumber(v) ? (100 * v) / max : 0}%`,
                          "--m": `${isNumber(medians[i]) ? (100 * medians[i]) / max : 0}%`,
                        }}
                        title={
                          withMedian
                            ? `Médiane au poste : ${number(medians[i], digits)} · ${number(result.peers)} pairs`
                            : undefined
                        }
                      >
                        <i />
                        {withMedian && isNumber(medians[i]) && <u />}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      {keys.length >= 3 && (
        <div className={c.overview}>
          <ComparisonRadar
            keys={keys}
            samples={samples}
            centiles={centiles}
            withMedian={withMedian}
            active={active}
            onActive={onActive}
          />
          <div className={c.leads}>
            <h3>Qui mène</h3>
            {leads.map(({ key, values, best }) => {
              const second = values
                .filter((v, i) => i !== best && isNumber(v))
                .sort((a, b) => b - a)[0];
              return (
                <button
                  key={key}
                  type="button"
                  className={`${c.lead} ${active === key ? c.leadOn : ""}`}
                  style={{ "--c": COLORS[best % 4] }}
                  onClick={() => onActive(active === key ? null : key)}
                  data-comparison-lead={key}
                >
                  <span>{SCOUT_METRICS[key].label}</span>
                  <span className={c.who}>
                    <span className={c.dot} />
                    {samples[best].name}
                  </span>
                  <em>
                    {isNumber(second)
                      ? `+${number(values[best] - second, digits)}`
                      : ""}
                  </em>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {table}
      <div className={c.footer}>
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
    [minMinutes, setMinMinutes] = useState(450),
    [active, setActive] = useState(null);
  const keys = r.data.settings.comparisonMetrics;
  const entries = r.data.comparison;
  const resource = useResource(
    `comparison:${f.client.id}:${entries.map(comparisonKey).join("|")}`,
    ({ signal }) => comparisonSamples(f, entries, { signal }),
    entries.length >= 2,
  );
  const change = (index, patch) =>
    r.update((previous) => ({
      ...previous,
      comparison: previous.comparison.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  const preset = Object.entries(METRIC_PRESETS).find(
    ([, item]) =>
      item.keys.length === keys.length &&
      item.keys.every((key, i) => key === keys[i]),
  )?.[0];
  const competitionsOf = (i, entry) =>
    (resource.value?.[i]?.available || [entry.scope.league])
      .filter((id) => id !== "all")
      .map((id) => ({
        id,
        name: "Compétition archivée",
        ...f.manifest.seasons
          .flatMap((s) => s.chunks.flatMap((chunk) => chunk.competitions || []))
          .find((item) => item.id === id),
      }));
  return (
    <Modal
      title="Comparer les joueurs"
      onClose={onClose}
      className={`research-wide-dialog ${c.dialog}`}
    >
      {entries.length < 2 ? (
        <Empty>Sélectionnez au moins deux joueurs ou saisons.</Empty>
      ) : (
        <div className={c.body}>
          <div className={c.cards}>
            {entries.map((entry, i) => (
              <PlayerCard
                key={comparisonKey(entry)}
                entry={entry}
                index={i}
                sample={resource.value?.[i]}
                seasons={f.manifest.seasons.map((s) => s.id)}
                competitions={competitionsOf(i, entry)}
                onChange={(patch) => change(i, patch)}
                onRemove={() => r.toggleComparison(entry)}
              />
            ))}
          </div>
          <div className={c.toolbar}>
            <div
              role="group"
              aria-label="Valeurs de comparaison"
              className="segmented-control"
            >
              {BASES.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={basis === id}
                  onClick={() => setBasis(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              role="group"
              aria-label="Modèle de comparaison"
              className="segmented-control"
            >
              {Object.entries(METRIC_PRESETS).map(([id, item]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={preset === id}
                  onClick={() =>
                    r.setSettings({ comparisonMetrics: item.keys })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className={c.toolbarEnd}>
              <button
                type="button"
                className={c.pill}
                aria-pressed={withMedian}
                onClick={() => setWithMedian((v) => !v)}
              >
                Médiane au poste
              </button>
              <label className={c.minutes}>
                Minutes min.
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
              <MetricPicker
                label="Axes et indicateurs"
                value={keys}
                onChange={(comparisonMetrics) =>
                  r.setSettings({ comparisonMetrics })
                }
              />
            </div>
          </div>
          <AsyncState resource={resource}>
            {(samples) => (
              <ComparisonContent
                samples={samples}
                basis={basis}
                keys={keys}
                withMedian={withMedian}
                minMinutes={minMinutes}
                active={active}
                onActive={setActive}
              />
            )}
          </AsyncState>
        </div>
      )}
    </Modal>
  );
}
