"use client";
/* The « Physique » tab: his match load of the season (every player: minutes, starts, rest
 * between matches, the last four weeks) and, where his competition is tracked
 * (/api/players/{id}/physical), his figures per 90 minutes placed among the players of his
 * role, his top speed match by match and his distance split by pace. */
import React, { useId, useMemo, useState } from "react";
import { Segments, Skeleton } from "./UI.jsx";
import {
  CalendarColumns,
  DistributionStrip,
  fmt,
  Legend,
  LineChart,
  PercentileBadge,
  SegmentBar,
  TipBody,
} from "./PlayerScoutCharts.jsx";
import { number } from "../services/format.js";
import {
  LOAD_WINDOW_DAYS,
  matchLoad,
  PHYSICAL_ROWS,
  physicalValue,
  SHORT_REST_DAYS,
  speedZones,
  usePlayerPhysical,
} from "../services/profile-blocks.js";
import { Term } from "./Hint.jsx";
import s from "./PlayerScout.module.css";

const dayMonth = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function Metrics({ block }) {
  const heading = useId();
  return (
    <section className={s.panel} aria-labelledby={heading}>
      <div className={s.panelTitle}>
        <h3 id={heading}>
          <Term>Indicateurs physiques</Term>
        </h3>
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
                <strong>
                  <Term>{row.label}</Term>
                </strong>
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
        <h3 id={heading}>
          <Term>Vitesse de pointe par match</Term>
        </h3>
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
        <h3 id={heading}>
          <Term>Distance par allure</Term>
        </h3>
        <p>m / 90 min</p>
      </div>
      <div className={s.panelBody}>
        <SegmentBar items={zones.map((z) => ({ ...z, range: "par 90 min" }))} format={(v) => `${number(v, 0)} m`} />
      </div>
    </section>
  );
}

const days = (n) => `${number(n, n % 1 ? 1 : 0)} jour${n >= 2 ? "s" : ""}`;

function MatchLoad({ load }) {
  const heading = useId();
  if (!load)
    return <p className={s.note}>Aucun match joué sur cette sélection.</p>;
  const kpis = [
    ["Matchs joués", number(load.matches), load.starts == null ? "" : `${number(load.starts)} titulaire${load.starts > 1 ? "s" : ""}`],
    ["Minutes", number(load.minutes), `${number(load.perMatch, 0)} par match`],
    ["Matchs complets", number(load.full), "90 minutes ou plus"],
    ["Repos médian", load.restMedian == null ? "—" : days(load.restMedian), "entre deux matchs joués"],
    ["Enchaînements courts", number(load.shortRest), `${SHORT_REST_DAYS} jours ou moins après le précédent`],
    [`${LOAD_WINDOW_DAYS} derniers jours`, `${number(load.recent.minutes)} min`, `${number(load.recent.matches)} match${load.recent.matches > 1 ? "s" : ""} jusqu’au ${dayMonth(load.recent.until)}`],
  ];
  return (
    <>
      <div className={`${s.kpiStrip} ${s.loadStrip}`}>
        {kpis.map(([label, value, note]) => (
          <div key={label}>
            <span>
              <Term>{label}</Term>
            </span>
            <strong>{value}</strong>
            {note && <small>{note}</small>}
          </div>
        ))}
      </div>
      {load.games.length >= 2 && (
        <section className={s.panel} aria-labelledby={heading}>
          <div className={s.panelTitle}>
            <h3 id={heading}>
              <Term>Minutes par match</Term>
            </h3>
            <Legend
              items={[
                ["swatchColumn", "Titulaire"],
                ["swatchColumnOff", "Remplaçant"],
                ["swatchRest", `≤ ${SHORT_REST_DAYS} j de repos`],
              ]}
            />
          </div>
          <div className={s.panelBody}>
            <CalendarColumns
              games={load.games.map((game) => ({ ...game, value: game.minutes }))}
              tickLabel={(v) => (v ? `${v}′` : "0")}
              shortRest={SHORT_REST_DAYS}
              windowDays={LOAD_WINDOW_DAYS}
              ariaLabel="Minutes jouées par match, à leur date"
              tip={(game) => (
                <TipBody
                  title={`${game.league || "Match"} · ${dayMonth(game.date)}`}
                  rows={[
                    ["Minutes", number(game.minutes)],
                    ["Titulaire", game.starter == null ? "—" : game.starter ? "oui" : "non"],
                    ["Repos avant", game.rest == null ? "—" : days(game.rest)],
                  ]}
                />
              )}
            />
          </div>
        </section>
      )}
    </>
  );
}

export default function PlayerPhysical({ id, season, rows }) {
  const physical = usePlayerPhysical(id, season);
  const load = useMemo(() => matchLoad(rows), [rows]);
  const [chosen, setChosen] = useState(null);
  const blocks = physical.value?.competitions || [];
  const block = blocks.find((b) => b.name === chosen) || blocks[0];
  return (
    <>
      {block && (
        <div className={s.block}>
          <div className={s.sectionHead}>
            <div>
              <h2>
                <Term>Suivi physique</Term>
              </h2>
              <p>
                {`${block.name} · ${number(block.matches)} match${block.matches > 1 ? "s" : ""} suivi${block.matches > 1 ? "s" : ""}, ${number(block.minutes)} min${block.tracked != null && block.finished && block.tracked < block.finished ? ` · suivi sur ${number(block.tracked)} des ${number(block.finished)} matchs de la compétition` : ""}`}
              </p>
            </div>
            {blocks.length > 1 && (
              <Segments label="Compétition" value={block.name} items={blocks.map((b) => [b.name, b.name])} onChange={setChosen} />
            )}
          </div>
          <div className={s.grid2}>
            <Metrics block={block} />
            <div className={s.stack}>
              <TopSpeed block={block} />
              <Zones block={block} />
            </div>
          </div>
        </div>
      )}
      <div className={s.block}>
        <div className={s.sectionHead}>
          <div>
            <h2>
            <Term>Charge de matchs</Term>
          </h2>
            <p>
              Temps de jeu et récupération sur les matchs de la sélection
              {physical.loading
                ? ""
                : physical.error
                  ? " · suivi des distances et de la vitesse indisponible"
                  : !block
                    ? " · aucun de ses matchs de la saison n’a de suivi des distances et de la vitesse, qui ne couvre que certaines compétitions"
                    : ""}
            </p>
          </div>
        </div>
        <MatchLoad load={load} />
      </div>
    </>
  );
}
