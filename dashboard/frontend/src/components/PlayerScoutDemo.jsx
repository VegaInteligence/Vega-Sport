"use client";
/* Placeholder blocks of the player profile (mock-up C).
 *
 * PitchAPI and Transfermarkt do not publish these values yet, so each block
 * below shows the mock-up C example and wears a « Données fictives » badge.
 * Replace a block with real data once its source is connected (Linear
 * ORI-11 to ORI-16), then delete it from this file. */
import React from "react";
import * as D from "../../app/maquettes/_shared/data.js";
import {
  MarketPanel as MockMarketPanel,
  Physical as MockPhysical,
} from "../../app/maquettes/joueur-b/PlayerPageB.jsx";
import sA from "../../app/maquettes/joueur-a/page-a.module.css";
import {
  dateFr,
  fmt,
  HeatmapPitch,
  InjuryTimeline,
  injuryTotals,
  Legend,
  LineChart,
  PercentileBar,
  TipBody,
} from "./PlayerScoutCharts.jsx";
import s from "./PlayerScout.module.css";

const FAKE_TITLE =
  "Exemple repris de la maquette C : à remplacer dès que la source est branchée.";

/** Visible marker on every value that is not real data. */
export function FakeBadge({ short = false }) {
  return (
    <span className={s.fakeBadge} title={FAKE_TITLE}>
      {short ? "Fictif" : "Données fictives"}
    </span>
  );
}

/** Whole area made of placeholder data, framed so it cannot pass for real. */
export function FakeZone({ text, children }) {
  return (
    <div className={s.fakeZone}>
      <p className={s.fakeBanner}>
        <FakeBadge />
        <span>{text}</span>
      </p>
      {children}
    </div>
  );
}

function FakeCard({ title, text, children }) {
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <div>
          <h3>{title}</h3>
          {text && <p>{text}</p>}
        </div>
        <FakeBadge />
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ rail */

const availability = injuryTotals(D.INJURIES, D.PLAYER.season);

/** Facts of the identity rail that no source publishes yet. */
export const FAKE_FACTS = [
  { label: "Âge", value: `${D.PLAYER.age} ans`, note: D.PLAYER.birthDate },
  {
    label: "Taille",
    value: `${fmt(D.PLAYER.height / 100, 2)} m`,
    note: `${D.PLAYER.weight} kg`,
  },
  { label: "Pied fort", value: D.PLAYER.foot, note: "Droit utilisé à 14 %" },
  {
    label: "Fin de contrat",
    value: "06/2031",
    note: `Clause ${D.PLAYER.releaseClause}`,
  },
].map((item) => ({ ...item, fake: true }));

export const FAKE_VALUE = {
  amount: `${D.PLAYER.value} M€`,
  trend: `+${fmt(D.PLAYER.valueTrend, 1)} %`,
  range: `${D.MARKET.range[0]}–${D.MARKET.range[1]} M€`,
  history: D.VALUE_HISTORY.map((point) => point.value),
};

export const FAKE_POTENTIAL = D.PLAYER.potential;

export const FAKE_AVAILABILITY = availability;

/* -------------------------------------------------------------- overview */

export function PlayStyleCard() {
  return (
    <FakeCard title="Profil de jeu">
      <div className={sA.styles}>
        {D.PLAY_STYLE.map((item) => (
          <div key={item.label}>
            <strong>{item.label}</strong>
            <p>{item.text}</p>
          </div>
        ))}
      </div>
    </FakeCard>
  );
}

export function TeamContextCard({ team }) {
  return (
    <FakeCard
      title="Contexte d’équipe"
      text={`Style ${team ? `de ${team}` : "de l’équipe"}, sur 100`}
    >
      <div className={sA.teamScores}>
        {D.TEAM_STYLE.scores.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className={sA.bars}>
        {D.TEAM_STYLE.traits.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <b>{item.value} %</b>
            <div style={{ gridColumn: "1 / -1" }}>
              <PercentileBar value={item.value} />
            </div>
          </div>
        ))}
      </div>
      <p className={s.note} style={{ marginTop: 12 }}>
        Reçoit{" "}
        <b style={{ color: "var(--ink-strong)" }}>
          +{D.SEASON.relativeParticipation} %
        </b>{" "}
        de passes de plus que la moyenne de son équipe.
      </p>
    </FakeCard>
  );
}

/* ------------------------------------------------------------ statistics */

/** Ball-security rows PitchAPI does not publish per player. */
export const FAKE_SECURITY_ROWS = ["foulsDrawn", "dispossessed", "fouls"].map(
  (key) => D.METRIC[key],
);

export function HeatmapCard() {
  return (
    <FakeCard
      title="Zones de présence"
      text="Ballons touchés, attaque vers la droite"
    >
      <HeatmapPitch grid={D.HEATMAP} />
      <p className={s.note} style={{ marginTop: 12 }}>
        71 % des ballons touchés dans le couloir droit, dont 38 % dans le
        dernier tiers. Repique vers l’axe dans 6 actions sur 10.
      </p>
    </FakeCard>
  );
}

/* ------------------------------------------------------------ comparison */

/** Previous-season percentiles: a stable offset of the current ones. */
export function fakePreviousSeason(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value], index) => [
      key,
      value == null
        ? null
        : Math.max(1, Math.min(99, value - 6 + ((index * 7) % 11))),
    ]),
  );
}

/* --------------------------------------------------------------- career */

export const FAKE_CAREER_STAGE = D.PLAYER.careerStage;

export function FakeMarket() {
  return (
    <FakeZone text="Valeur, revente, clause et intérêts : en attente de Transfermarkt.">
      <MockMarketPanel wide />
    </FakeZone>
  );
}

export function VegaIndexHistoryCard() {
  return (
    <FakeCard
      title="Évolution de l’indice Vega"
      text="Niveau saison par saison au poste principal"
    >
      <LineChart
        width={520}
        points={D.EVOLUTION.map((row) => ({
          x: row.season.replace(/^20/, ""),
          y: row.index,
          row,
        }))}
        domain={[50, 100]}
        ticks={[50, 60, 70, 80, 90, 100]}
        ariaLabel="Indice Vega par saison"
        tip={(point) => (
          <TipBody
            title={point.row.season}
            rows={[
              ["Indice", point.y],
              ["Minutes", fmt(point.row.minutes)],
            ]}
          />
        )}
      />
    </FakeCard>
  );
}

export function ValueHistoryCard() {
  return (
    <FakeCard title="Valeur marchande" text="Estimation en millions d’euros">
      <LineChart
        width={520}
        points={D.VALUE_HISTORY.map((row) => ({ x: row.date, y: row.value }))}
        domain={[0, 300]}
        ticks={[0, 100, 200, 300]}
        labelEvery={2}
        format={(value) => `${fmt(value)} M€`}
        ariaLabel="Valeur marchande estimée"
      />
    </FakeCard>
  );
}

export function InjuriesSection() {
  return (
    <section className={s.block}>
      <div className={s.sectionHead}>
        <div>
          <h2>
            Blessures et suspensions <FakeBadge />
          </h2>
          <p>
            {availability.count} absences · {availability.weeks} semaines
            cumulées · {availability.missed} matchs manqués ·{" "}
            {availability.current} jour cette saison
          </p>
        </div>
        <Legend
          items={[
            ["swatch", "Blessure", "var(--mq-neg-2)"],
            ["swatch", "Suspension", "var(--muted-light)"],
          ]}
        />
      </div>
      <div className={s.card} style={{ marginBottom: 12 }}>
        <InjuryTimeline seasons={D.INJURY_SEASONS} injuries={D.INJURIES} />
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
                <th className={s.num}>Matchs manqués</th>
              </tr>
            </thead>
            <tbody>
              {D.INJURIES.map((item) => (
                <tr key={item.start}>
                  <th scope="row">{item.season}</th>
                  <td>{item.label}</td>
                  <td>{dateFr(item.start)}</td>
                  <td>{dateFr(item.end)}</td>
                  <td className={s.num}>{item.missed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------ whole fake tabs */

export function FakePhysical() {
  return (
    <FakeZone text="Aucune source de suivi physique (vitesse, distances) n’est branchée : exemple de la maquette.">
      <MockPhysical />
    </FakeZone>
  );
}
