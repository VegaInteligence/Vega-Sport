"use client";
/* « En forme » on /joueurs (VI-39, mock-up validated 20 Nov 2026): the players rising or falling
   over their last ten matches, and those whose playing time is rising, on the page's season
   and competitions. */
import Link from "next/link";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { compactScope, directoryScopeIds } from "../services/compact-reads.js";
import { usePlayerForm } from "../services/player-form.js";
import { Empty, Grade, Media, Skeleton } from "./UI.jsx";
import r from "./PlayerReplacements.module.css";
import s from "./PlayerFormTrends.module.css";

function Curve({ values, low, high, falling }) {
  const w = 128,
    h = 30,
    pad = 3;
  const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - low) / (high - low || 1)) * (h - pad * 2);
  const line = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  const last = values.length - 1;
  return (
    <svg
      className={`${s.curve} ${falling ? s.falling : ""}`}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
    >
      <line className={s.split} x1={x(4.5)} x2={x(4.5)} y1="0" y2={h} />
      <path
        className={s.area}
        d={`${line} L${x(last).toFixed(1)} ${h} L${x(0).toFixed(1)} ${h} Z`}
      />
      <path className={s.line} d={line} />
      <circle className={s.end} cx={x(last)} cy={y(values[last])} r="2.8" />
    </svg>
  );
}

const gap = (value, unit = "") =>
  `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${unit}`;

/** The list of one trend; Performances' « Forme » filter chooses it (PlayerDirectory). */
export default function PlayerFormTrends({ trend = "up" }) {
  const f = useFootball();
  const leagues = compactScope(
    directoryScopeIds(f.manifest, f.season, f.focus, f.filters),
  );
  const read = usePlayerForm(f.season, leagues);
  const data = read.value;
  const minutes = trend === "minutes";
  const rows = data?.[trend] || [];
  return (
    <div className={r.root}>
      {read.error ? (
        <div role="alert" className="notice notice-warning">
          {String(read.error)} <button onClick={read.retry}>Réessayer</button>
        </div>
      ) : !data ? (
        <Skeleton
          data-page-loading=""
          kind="table"
          lines={8}
          label="Chargement des tendances…"
        />
      ) : !rows.length ? (
        <Empty>Aucun joueur dans ces compétitions.</Empty>
      ) : (
        <div className={`${r.listCard} ${s.scroll}`}>
          <table className={`data-table ${s.table}`}>
            <thead>
              <tr>
                <th>Joueur</th>
                <th>
                  {minutes
                    ? "Minutes · 10 derniers matchs"
                    : "Note · 10 derniers matchs"}
                </th>
                <th className={s.num}>{minutes ? "Avant" : "5 précédents"}</th>
                <th className={s.num}>5 derniers</th>
                <th className={s.num}>Écart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const delta = row.delta;
                return (
                  <tr key={row.id} data-form-row={row.id} data-gap={delta}>
                    <td>
                      <Link
                        className={r.who}
                        href={f.href("/joueurs/", { id: row.id, q: "" })}
                      >
                        <Media
                          name={row.name}
                          url={row.image_url}
                          className="crest"
                        />
                        <span>
                          <strong>{row.name}</strong>
                          <small>
                            {[row.position, row.team?.name]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      {minutes ? (
                        <Curve values={row.minutes} low={0} high={90} />
                      ) : (
                        <Curve
                          values={row.grades}
                          low={20}
                          high={90}
                          falling={delta < 0}
                        />
                      )}
                    </td>
                    <td className={s.num}>
                      {minutes
                        ? `${row.minutes_before}′`
                        : Math.round(row.grade_before)}
                    </td>
                    <td className={s.num}>
                      {minutes ? (
                        `${row.minutes_last}′`
                      ) : (
                        <Grade value={row.grade_last} />
                      )}
                    </td>
                    <td className={s.num}>
                      <span
                        className={`${r.delta} ${delta > 0 ? r.good : r.bad}`}
                      >
                        {gap(delta, minutes ? "′" : "")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
