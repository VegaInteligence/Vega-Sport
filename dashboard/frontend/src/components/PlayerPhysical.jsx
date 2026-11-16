"use client";
/* The « Physique » tab: the player's tracked matches of the season (/api/players/{id}/physical),
 * per competition, his figures per 90 minutes placed among the players of his role tracked
 * there, his top speed match by match and his distance split by pace. */
import React, { useId, useState } from "react";
import { Segments, Skeleton } from "./UI.jsx";
import { DistributionStrip, fmt, LineChart, PercentileBadge, SegmentBar, TipBody } from "./PlayerScoutCharts.jsx";
import { number } from "../services/format.js";
import { PHYSICAL_ROWS, physicalValue, speedZones, usePlayerPhysical } from "../services/profile-blocks.js";
import s from "./PlayerScout.module.css";

const dayMonth = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function Metrics({ block }) {
  const heading = useId();
  return (
    <section className={s.panel} aria-labelledby={heading}>
      <div className={s.panelTitle}>
        <h3 id={heading}>Indicateurs physiques</h3>
        <p>
          {block.cohort
            ? `Comparé aux ${block.cohort.label} suivis 450 min ou plus (${number(block.cohort.players)} joueurs) · bande P25–P75, trait : médiane`
            : `Moins de 450 minutes suivies ou trop peu de joueurs à son poste : valeurs sans comparaison`}
        </p>
      </div>
      <div className={s.distRows}>
        {block.metrics.map((metric) => {
          const row = PHYSICAL_ROWS[metric.key];
          const scaled = (v) => (v == null ? null : v * row.scale);
          const strip = metric.percentile != null && [metric.p10, metric.p25, metric.median, metric.p75, metric.p90].every((v) => v != null);
          return (
            <div className={s.distRow} key={metric.key}>
              <div className={s.distLabel}>
                <strong>{row.label}</strong>
                <small>
                  {row.unit}
                  {metric.median != null && block.cohort ? ` · médiane ${physicalValue(metric.key, metric.median)}` : ""}
                </small>
              </div>
              <div>
                {strip && (
                  <DistributionStrip
                    showLabels={false}
                    metric={{
                      label: row.label,
                      value: scaled(metric.value),
                      percentile: metric.percentile,
                      decimals: row.digits,
                      dist: [metric.p10, metric.p25, metric.median, metric.p75, metric.p90].map(scaled),
                    }}
                  />
                )}
              </div>
              <span className={s.distValue}>{physicalValue(metric.key, metric.value)}</span>
              {metric.percentile != null ? <PercentileBadge value={metric.percentile} /> : <span />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TopSpeed({ block }) {
  const heading = useId();
  const points = block.games.filter((g) => g.topSpeed != null).map((g) => ({ x: dayMonth(g.date), y: g.topSpeed, game: g }));
  const median = block.metrics.find((m) => m.key === "topSpeed")?.median;
  const left = block.games.length - points.length;
  if (points.length < 2) return null;
  const low = Math.floor(Math.min(...points.map((p) => p.y), median ?? Infinity) - 1);
  const high = Math.ceil(Math.max(...points.map((p) => p.y), median ?? -Infinity) + 1);
  return (
    <section className={s.panel} aria-labelledby={heading}>
      <div className={s.panelTitle}>
        <h3 id={heading}>Vitesse de pointe par match</h3>
        <p>
          km/h · pointe de la saison {fmt(block.maxSpeed, 1)}
          {median != null && block.cohort ? ` · pointillés : médiane du poste ${fmt(median, 1)}` : ""}
          {left ? ` · ${left} match${left > 1 ? "s" : ""} sans vitesse retenue` : ""}
        </p>
      </div>
      <div className={s.panelBody}>
        <LineChart
          width={520}
          points={points}
          domain={[low, high]}
          ticks={Array.from({ length: high - low + 1 }, (_, i) => low + i).filter((v, i, all) => all.length <= 8 || i % 2 === 0)}
          labelEvery={Math.max(1, Math.ceil(points.length / 8))}
          reference={median != null && block.cohort ? { y: median, label: "Médiane" } : undefined}
          format={(v) => fmt(v, 1)}
          ariaLabel="Vitesse de pointe par match"
          tip={(point) => (
            <TipBody
              title={`${point.game.opponent || "Match"} · ${dayMonth(point.game.date)}`}
              rows={[
                ["Vitesse max.", `${fmt(point.y, 1)} km/h`],
                ["Minutes", number(point.game.minutes)],
                ["Distance", `${fmt(point.game.distance / 1000, 1)} km`],
              ]}
            />
          )}
        />
      </div>
    </section>
  );
}

function Zones({ block }) {
  const heading = useId();
  const zones = speedZones(block.metrics);
  if (!zones) return null;
  return (
    <section className={s.panel} aria-labelledby={heading}>
      <div className={s.panelTitle}>
        <h3 id={heading}>Distance par allure</h3>
        <p>m / 90 min</p>
      </div>
      <div className={s.panelBody}>
        <SegmentBar items={zones.map((z) => ({ ...z, range: "par 90 min" }))} format={(v) => `${number(v, 0)} m`} />
      </div>
    </section>
  );
}

export default function PlayerPhysical({ id, season }) {
  const physical = usePlayerPhysical(id, season);
  const [chosen, setChosen] = useState(null);
  const blocks = physical.value?.competitions || [];
  const block = blocks.find((b) => b.name === chosen) || blocks[0];
  return (
    <div className={s.block}>
      <div className={s.sectionHead}>
        <div>
          <h2>Physique</h2>
          <p>
            {block
              ? `${block.name} · ${number(block.matches)} match${block.matches > 1 ? "s" : ""} suivi${block.matches > 1 ? "s" : ""}, ${number(block.minutes)} min${block.tracked != null && block.finished && block.tracked < block.finished ? ` · suivi sur ${number(block.tracked)} des ${number(block.finished)} matchs de la compétition` : ""}`
              : "Distances, sprints et vitesse de pointe des matchs suivis"}
          </p>
        </div>
        {blocks.length > 1 && (
          <Segments label="Compétition" value={block.name} items={blocks.map((b) => [b.name, b.name])} onChange={setChosen} />
        )}
      </div>
      {physical.loading ? (
        <Skeleton label="Chargement du suivi physique…" lines={3} />
      ) : physical.error ? (
        <p className={s.note} role="alert">
          Suivi physique indisponible. <button onClick={physical.retry}>Réessayer</button>
        </p>
      ) : !block ? (
        <p className={s.note}>
          Aucun de ses matchs de la saison n’a de suivi physique : seules certaines compétitions sont suivies.
        </p>
      ) : (
        <div className={s.grid2}>
          <Metrics block={block} />
          <div className={s.stack}>
            <TopSpeed block={block} />
            <Zones block={block} />
          </div>
        </div>
      )}
    </div>
  );
}
