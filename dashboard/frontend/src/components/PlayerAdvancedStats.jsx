"use client";
import React, { useMemo, useState } from "react";
import { Segments } from "./UI.jsx";
import {
  rankMetric,
  roleAssessments,
  SCOUT_METRICS,
} from "../services/scouting.js";
import { seasonMetric, seasonSections } from "../services/season-player.js";
import {
  DistributionStrip,
  fmt,
  ordinal,
  PercentileBadge,
  PercentileBar,
  RadarChart,
  SeriesLegend,
  ToneLegend,
  toneClass,
} from "./PlayerScoutCharts.jsx";
import s from "./PlayerScout.module.css";

const VIEWS = [
  ["synthesis", "Synthèse du rôle"],
  ["telemetry", "Télémétrie"],
  ["distribution", "Distribution complète"],
];
const UNITS = [
  ["per90", "Par 90 min"],
  ["total", "Totaux"],
];
const MINUTES = [450, 900, 1350, 1800];
const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

function quantile(sorted, p) {
  const index = (sorted.length - 1) * p,
    low = Math.floor(index),
    high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const metricLabel = (key) => {
  const definition = SCOUT_METRICS[key];
  return definition.ratio ? `${definition.label} (%)` : definition.label;
};

/** One ranked metric against the player's position cohort, or null when the
 *  coverage or the cohort size does not allow a reliable rank. */
export function advancedMetric(profile, key, cohorts) {
  const definition = SCOUT_METRICS[key];
  const values = cohorts.groups.get(profile.role?.group)?.distributions[key];
  if (!definition?.rankable || !values?.length) return null;
  const ranked = rankMetric(profile, key, cohorts);
  if (ranked.percentile == null) return null;
  const inverted = Boolean(definition.lowerIsBetter);
  const better = values.filter((value) =>
    inverted ? value < ranked.value : value > ranked.value,
  ).length;
  const unit = definition.unit || "";
  return {
    key,
    label: metricLabel(key),
    value: ranked.value,
    total: seasonMetric(profile, key, "total").value,
    percentile: inverted ? 100 - ranked.percentile : ranked.percentile,
    rank: better + 1,
    peers: values.length,
    dist: QUANTILES.map((p) => quantile(values, p)),
    decimals: unit ? 1 : 2,
    unit,
    inverted,
  };
}

function DistRow({ metric }) {
  const format = (value) => fmt(value, metric.decimals, { unit: metric.unit });
  return (
    <div className={s.distRow}>
      <div className={s.distLabel}>
        <strong>
          {metric.label}
          {metric.unit ? "" : " / 90"}
        </strong>
        <small>
          Médiane {format(metric.dist[2])} · {ordinal(metric.rank)} sur{" "}
          {metric.peers}
          {metric.inverted ? " · moins = mieux" : ""}
        </small>
      </div>
      <DistributionStrip metric={metric} />
      <span className={s.distValue}>{format(metric.value)}</span>
      <PercentileBadge value={metric.percentile} />
    </div>
  );
}

function Panel({ title, text, children, body = true }) {
  return (
    <section className={s.panel}>
      <div className={s.panelTitle}>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
      </div>
      {body ? <div className={s.panelBody}>{children}</div> : children}
    </section>
  );
}

function Synthesis({ profile, cohorts, sections, metrics }) {
  const roles = roleAssessments(profile, cohorts).filter(
    (role) => role.value != null,
  );
  const series = [
    {
      name: profile.name,
      values: Object.fromEntries(
        roles.map((role) => [role.id, Math.round(role.value)]),
      ),
      color: "var(--mq-series-1)",
    },
    {
      name: "Médiane du poste (P50)",
      values: Object.fromEntries(roles.map((role) => [role.id, 50])),
      dashed: true,
    },
  ];
  const keyMetrics = sections
    .slice(0, 2)
    .flatMap((section) => section.keys)
    .map((key) => metrics.get(key))
    .filter(Boolean);
  return (
    <>
      <div className={s.cols2}>
        <Panel
          title="Empreinte du rôle"
          text="Indices de rôle sur 100, face à la médiane du poste"
        >
          {roles.length ? (
            <>
              {roles.length >= 3 && (
                <>
                  <RadarChart
                    axes={roles.map((role) => ({
                      key: role.id,
                      label: role.label,
                    }))}
                    series={series}
                    size={400}
                    showValues={false}
                  />
                  <SeriesLegend series={series} />
                </>
              )}
              <ul className={s.roles} style={{ marginTop: 14 }}>
                {roles.map((role) => (
                  <li key={role.id}>
                    <span>{role.label}</span>
                    <b>{Math.round(role.value)}</b>
                    <div>
                      <PercentileBar value={Math.round(role.value)} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={s.note}>
              Les indicateurs de ce poste ne couvrent pas tous les matchs joués
              : aucun indice de rôle n’est calculable.
            </p>
          )}
        </Panel>
        <Panel
          title="Distribution du poste"
          text="Bande P25–P75 · trait : médiane"
          body={false}
        >
          <div className={s.distRows}>
            {keyMetrics.length ? (
              keyMetrics.map((metric) => (
                <DistRow key={metric.key} metric={metric} />
              ))
            ) : (
              <p className={s.panelBody}>Aucun indicateur classable.</p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Telemetry({ sections, metrics, unit }) {
  return (
    <div className={s.pillarsWrap}>
      <div className={s.pillars}>
        {sections.map((section) => {
          const items = section.keys
            .map((key) => metrics.get(key))
            .filter(Boolean);
          if (!items.length) return null;
          const average = Math.round(
            items.reduce((sum, item) => sum + item.percentile, 0) /
              items.length,
          );
          return (
            <section
              className={s.pillar}
              key={section.id}
              aria-label={section.title}
            >
              <div className={s.pillarHead}>
                <strong>{section.title}</strong>
                <PercentileBadge value={average} label={`Moy. P${average}`} />
              </div>
              <div className={s.tiles}>
                {items.map((item) => {
                  const value =
                    unit === "total" && !item.unit ? item.total : item.value;
                  return (
                    <div
                      className={`${s.tile} ${toneClass(item.percentile)}`}
                      key={item.key}
                    >
                      <span title={item.label}>{item.label}</span>
                      <div className={s.tileFoot}>
                        <strong>
                          {fmt(
                            value,
                            unit === "total" && !item.unit
                              ? SCOUT_METRICS[item.key].decimals || 0
                              : item.decimals,
                            { unit: item.unit },
                          )}
                        </strong>
                        <small>
                          <b>P{item.percentile}</b> · {ordinal(item.rank)}/
                          {item.peers}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Distribution({ sections, metrics }) {
  const [family, setFamily] = useState("all");
  const [sort, setSort] = useState("family");
  const grouped = sort === "family";
  const rows = sections
    .filter((section) => family === "all" || section.id === family)
    .flatMap((section) =>
      section.keys
        .map((key) => metrics.get(key))
        .filter(Boolean)
        .map((metric) => ({ ...metric, section })),
    );
  if (sort === "desc") rows.sort((a, b) => b.percentile - a.percentile);
  if (sort === "asc") rows.sort((a, b) => a.percentile - b.percentile);
  return (
    <>
      <div className={s.toolbar}>
        <Segments
          label="Famille d’indicateurs"
          value={family}
          onChange={setFamily}
          items={[
            ["all", "Tout"],
            ...sections.map((section) => [section.id, section.title]),
          ]}
        />
        <label className={s.control} style={{ display: "flex", gap: 8 }}>
          Tri
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="family">Par famille</option>
            <option value="desc">Centile décroissant</option>
            <option value="asc">Centile croissant</option>
          </select>
        </label>
      </div>
      <section className={s.panel}>
        <div className={s.distRows}>
          {rows.map((metric, index) => (
            <React.Fragment key={metric.key}>
              {grouped &&
                (index === 0 ||
                  rows[index - 1].section.id !== metric.section.id) && (
                  <div className={s.distGroup}>{metric.section.title}</div>
                )}
              <DistRow metric={metric} />
            </React.Fragment>
          ))}
        </div>
      </section>
    </>
  );
}

export default function PlayerAdvancedStats({
  profile,
  cohorts,
  minMinutes,
  onMinMinutes,
  ready = true,
}) {
  const [view, setView] = useState("synthesis");
  const [unit, setUnit] = useState("per90");
  const role = profile.role;
  const cohort = cohorts.groups.get(role?.group);
  const sections = useMemo(
    () =>
      seasonSections(role?.group).map((section) => ({
        ...section,
        keys: section.keys.filter((key) => SCOUT_METRICS[key]?.rankable),
      })),
    [role?.group],
  );
  const metrics = useMemo(() => {
    const result = new Map();
    for (const section of sections)
      for (const key of section.keys) {
        const metric = advancedMetric(profile, key, cohorts);
        if (metric) result.set(key, metric);
      }
    return result;
  }, [profile, cohorts, sections]);
  const peers = cohort?.profiles.length || 0;
  const enoughMinutes = profile.minutes >= minMinutes;
  const enoughPeers = peers >= cohorts.minPeers;
  return (
    <section className={s.advanced} aria-label="Statistiques avancées">
      <div className={s.panelHead}>
        <div>
          <h2>Stats avancées</h2>
          <p>
            Centiles, rangs et distributions par 90 minutes face aux joueurs du
            même poste, sur les compétitions et dates sélectionnées.
          </p>
        </div>
      </div>
      <div className={s.context} role="group" aria-label="Référentiel">
        <div className={s.control}>
          Poste évalué
          <strong>{role?.label || "Poste inconnu"}</strong>
        </div>
        <label className={s.control}>
          Minutes minimum
          <select
            value={minMinutes}
            onChange={(event) => onMinMinutes(Number(event.target.value))}
          >
            {[...new Set([...MINUTES, minMinutes])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value} min
                </option>
              ))}
          </select>
        </label>
        <div className={s.control}>
          Unité
          <Segments
            label="Unité des valeurs"
            value={unit}
            onChange={setUnit}
            items={UNITS}
          />
        </div>
        <div className={s.sample}>
          <span>
            {ready ? (
              <>
                Échantillon : <b>{peers} joueurs</b>
              </>
            ) : (
              "Échantillon en cours de chargement"
            )}
            {role?.peers ? ` · ${role.peers}` : ""} · {minMinutes} min minimum
          </span>
          <span className={s.scale}>
            P0
            <i />
            P100
          </span>
        </div>
      </div>
      {!ready ? (
        <p className={s.notice} role="status">
          Chargement de la cohorte du poste…
        </p>
      ) : !role ? (
        <p className={s.notice}>
          Le poste de ce joueur n’est pas renseigné : aucune cohorte de
          comparaison n’est disponible.
        </p>
      ) : !enoughMinutes ? (
        <p className={s.notice}>
          {profile.minutes} minutes jouées sur la période : un classement fiable
          demande au moins {minMinutes} minutes.
        </p>
      ) : !enoughPeers ? (
        <p className={s.notice}>
          {peers} joueurs comparables seulement : il en faut au moins{" "}
          {cohorts.minPeers}. Élargissez les compétitions ou baissez le minimum
          de minutes.
        </p>
      ) : (
        <>
          <div className={s.subnav}>
            <Segments
              label="Vue des statistiques avancées"
              value={view}
              onChange={setView}
              items={VIEWS}
            />
            <ToneLegend />
          </div>
          {view === "synthesis" && (
            <Synthesis
              profile={profile}
              cohorts={cohorts}
              sections={sections}
              metrics={metrics}
            />
          )}
          {view === "telemetry" && (
            <Telemetry sections={sections} metrics={metrics} unit={unit} />
          )}
          {view === "distribution" && (
            <Distribution sections={sections} metrics={metrics} />
          )}
          <p className={s.note}>
            Source : statistiques de match PitchAPI. Un indicateur n’est classé
            que s’il est renseigné sur tous les matchs joués ; les xA ne sont
            pas classés car les valeurs nulles sont absentes de la source.
          </p>
        </>
      )}
    </section>
  );
}
