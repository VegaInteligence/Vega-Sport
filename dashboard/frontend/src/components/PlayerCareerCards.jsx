"use client";
/* The career tab's Vega index season by season and the player's injuries: real data,
 * in the cards and charts the placeholders used (PlayerScoutDemo.jsx). */
import React from "react";
import { useCardFold } from "./PhoneFold.jsx";
import { Skeleton } from "./UI.jsx";
import { dateFr, fmt, InjuryTimeline, Legend, LineChart, TipBody } from "./PlayerScoutCharts.jsx";
import { availability, injuryRows, usePlayerInjuries, usePowerHistory } from "../services/player-availability.js";
import s from "./PlayerScout.module.css";

function FoldCard({ title, text, children }) {
  const f = useCardFold(true, title);
  return (
    <section className={s.card} {...f.section}>
      <div className={s.cardHead} {...f.head}>
        <div>
          <h3>{title}</h3>
          {text && <p className={f.part}>{text}</p>}
        </div>
        {f.button}
      </div>
      {f.wrap(children)}
    </section>
  );
}

export function VegaIndexHistory({ id }) {
  const history = usePowerHistory(id);
  const rows = history.value || [];
  const low = Math.max(0, Math.floor(Math.min(50, ...rows.map((r) => r.score)) / 10) * 10);
  return (
    <FoldCard title="Évolution de l’indice Vega" text="Score Vega sur 100, saison par saison">
      {history.loading ? (
        <Skeleton label="Chargement de l’indice par saison…" lines={4} />
      ) : rows.length < 2 ? (
        <p className={s.note}>{rows.length ? `Une seule saison classée : ${fmt(rows[0].score)} en ${rows[0].season}.` : "Pas encore de saison classée."}</p>
      ) : (
        <LineChart
          width={520}
          points={rows.map((row) => ({ x: row.season.replace(/^20(\d\d)\/20(\d\d)$/, "$1/$2"), y: row.score, row }))}
          domain={[low, 100]}
          ticks={Array.from({ length: (100 - low) / 10 + 1 }, (_, i) => low + i * 10)}
          ariaLabel="Indice Vega par saison"
          tip={(point) => (
            <TipBody
              title={point.row.season}
              rows={[
                ["Indice", fmt(point.y)],
                ["Rang", point.row.rank ? `${point.row.rank}e${point.row.provisional ? " (provisoire)" : ""}` : "—"],
                ["Club", point.row.team || "—"],
                ["Minutes", fmt(point.row.minutes)],
              ]}
            />
          )}
        />
      )}
    </FoldCard>
  );
}

export function PlayerInjuries({ id }) {
  const injuries = usePlayerInjuries(id);
  const rows = injuries.value ? injuryRows(injuries.value) : null;
  const totals = rows ? availability(rows) : null;
  const seasons = rows ? [...new Set(rows.map((r) => r.season))].sort().reverse().slice(0, 6) : [];
  const missed = rows ? rows.reduce((t, r) => t + (r.missed || 0), 0) : 0;
  return (
    <section className={s.block}>
      <div className={s.sectionHead}>
        <div>
          <h2>Blessures</h2>
          <p>
            {injuries.loading
              ? "Absences relevées saison par saison"
              : injuries.error
                ? "Historique indisponible."
                : !rows
                  ? "Historique pas encore relevé pour ce joueur."
                  : rows.length
                    ? `${rows.length} absence${rows.length > 1 ? "s" : ""} relevée${rows.length > 1 ? "s" : ""} · ${fmt(totals.weeks)} semaine${totals.weeks > 1 ? "s" : ""} d’arrêt sur douze mois · ${fmt(missed)} match${missed > 1 ? "s" : ""} manqué${missed > 1 ? "s" : ""}`
                    : "Aucune blessure relevée."}
          </p>
        </div>
        {rows?.length ? <Legend items={[["swatch", "Blessure", "var(--mq-neg-2)"]]} /> : null}
      </div>
      {injuries.loading ? (
        <Skeleton label="Chargement des blessures…" lines={3} />
      ) : rows?.length ? (
        <>
          <div className={s.card} style={{ marginBottom: 12 }}>
            <InjuryTimeline seasons={seasons} injuries={rows} />
          </div>
          <div className={s.tableCard}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Saison</th>
                    <th>Motif</th>
                    <th>Du</th>
                    <th>Au</th>
                    <th className={s.num}>Jours</th>
                    <th className={s.num}>Matchs manqués</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={`${item.start}:${item.label}`}>
                      <th scope="row">{item.season}</th>
                      <td>{item.label}</td>
                      <td>{dateFr(item.start)}</td>
                      <td>{item.ongoing ? "en cours" : dateFr(item.end)}</td>
                      <td className={s.num}>{fmt(item.days)}</td>
                      <td className={s.num}>{fmt(item.missed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
