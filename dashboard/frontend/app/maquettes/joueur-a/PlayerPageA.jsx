"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Bookmark, FileDown, Plus, X } from "lucide-react";
import { Segments } from "../../../src/components/UI.jsx";
import {
  Avatar,
  Crest,
  Flag,
  MockShell,
  Tabs,
  useTab,
} from "../_shared/ui.jsx";
import {
  dateFr,
  fmt,
  Gauge,
  HeatmapPitch,
  injuryTotals,
  InjuryTimeline,
  Legend,
  LineChart,
  ordinal,
  PercentileBadge,
  PercentileBar,
  PercentilePizza,
  PositionsPitch,
  RadarChart,
  SegmentBar,
  SeriesLegend,
  ShotMap,
  Sparkline,
  TipBody,
  ToneLegend,
  toneClass,
} from "../_shared/charts.jsx";
import * as D from "../_shared/data.js";
import s from "./page-a.module.css";

const TABS = [
  ["apercu", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["physique", "Physique"],
  ["comparer", "Comparaison"],
  ["similaires", "Profils similaires"],
  ["carriere", "Carrière"],
  ["projection", "Projection"],
  ["matchs", "Matchs"],
];

const COLORS = [
  "var(--mq-series-1)",
  "var(--mq-series-2)",
  "var(--mq-series-3)",
];
const shortDate = (value) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const ratingPercentile = (rating) =>
  rating >= 9
    ? 90
    : rating >= 8
      ? 70
      : rating >= 7
        ? 50
        : rating >= 6
          ? 30
          : 10;
const COMPETITION_CRESTS = {
  LaLiga: D.CRESTS.laliga,
  "Ligue des champions": D.CRESTS.ucl,
};

export default function PlayerPageA() {
  const [tab, setTab] = useTab(TABS);
  const [compared, setCompared] = useState(["previous"]);
  const openComparison = (id) => {
    setCompared([id]);
    setTab("comparer");
  };
  return (
    <MockShell version="A" title="Fiche scout">
      <Link className={s.back} href="/joueurs/">
        ← Tous les joueurs
      </Link>
      <div className={s.layout}>
        <IdentityRail onTab={setTab} />
        <div className={s.main}>
          <Tabs
            label="Analyse du joueur"
            items={TABS}
            value={tab}
            onChange={setTab}
            panelId="player-a-panel"
          />
          <div
            id="player-a-panel"
            role="tabpanel"
            aria-label={TABS.find(([key]) => key === tab)[1]}
          >
            {tab === "apercu" && <Overview onTab={setTab} />}
            {tab === "stats" && <Statistics />}
            {tab === "physique" && <Physical />}
            {tab === "comparer" && (
              <Comparison selected={compared} onSelect={setCompared} />
            )}
            {tab === "similaires" && <Similar onCompare={openComparison} />}
            {tab === "carriere" && <Career />}
            {tab === "projection" && <Projection />}
            {tab === "matchs" && <Matches />}
          </div>
        </div>
      </div>
    </MockShell>
  );
}

/* ------------------------------------------------------------ identity rail */

export function IdentityRail({ onTab }) {
  const p = D.PLAYER;
  const availability = injuryTotals(D.INJURIES, D.PLAYER.season);
  return (
    <aside className={s.rail} aria-label="Identité du joueur">
      <div className={s.identity}>
        <div className={s.portrait}>
          <Avatar src={p.image} name={p.name} size={104} />
          <span className={s.portraitCrest}>
            <Crest src={p.crest} size={24} alt={p.club} />
          </span>
        </div>
        <div>
          <h1 className={s.name}>{p.name}</h1>
          <p className={s.role}>{p.position}</p>
          <p className={s.roleAlt}>{p.secondary.join(" · ")}</p>
        </div>
        <div className={s.nations}>
          {p.nationalities.map((nation) => (
            <span key={nation.code}>
              <Flag code={nation.code} />
              {nation.name}
            </span>
          ))}
        </div>
        <div className={s.chips}>
          <span className={s.chip}>
            <Crest src={p.crest} size={14} />
            {p.clubShort}
          </span>
          <span className={s.chip}>
            <Crest src={D.CRESTS.laliga} size={14} />
            {p.league}
          </span>
          <span className={s.chip}>N° {p.shirt}</span>
        </div>
      </div>
      <div className={s.railSection}>
        <dl className={s.facts}>
          <div>
            <dt>Âge</dt>
            <dd>{p.age} ans</dd>
            <small>{p.birthDate}</small>
          </div>
          <div>
            <dt>Taille</dt>
            <dd>{fmt(p.height / 100, 2)} m</dd>
            <small>{p.weight} kg</small>
          </div>
          <div>
            <dt>Pied fort</dt>
            <dd>{p.foot}</dd>
            <small>Droit utilisé à 14 %</small>
          </div>
          <div>
            <dt>Fin de contrat</dt>
            <dd>06/2031</dd>
            <small>Clause {p.releaseClause}</small>
          </div>
          <div>
            <dt>Sélection</dt>
            <dd>{p.international.caps} sél.</dd>
            <small>
              {p.international.goals} buts · {p.international.team}
            </small>
          </div>
          <div>
            <dt>Temps de jeu</dt>
            <dd>{D.SEASON.minutesShare} %</dd>
            <small>des minutes du club</small>
          </div>
        </dl>
      </div>
      <div className={s.railSection}>
        <p className={s.railTitle}>
          Valeur estimée <span>modèle Vega</span>
        </p>
        <div className={s.valueRow}>
          <span className={s.valueAmount}>{p.value} M€</span>
          <Sparkline values={D.VALUE_HISTORY.map((point) => point.value)} />
        </div>
        <p className={s.valueMeta}>
          <span className={s.up}>+{fmt(p.valueTrend, 1)} %</span> sur 6 mois ·
          fourchette {D.MARKET.range[0]}–{D.MARKET.range[1]} M€
        </p>
      </div>
      <div className={s.railSection}>
        <p className={s.railTitle}>
          Indice Vega <span>sur 100</span>
        </p>
        <div className={s.indexRow}>
          <div>
            <strong>{p.vegaIndex}</strong>
            <span>Niveau actuel</span>
          </div>
          <div>
            <strong>{p.potential}</strong>
            <span>Potentiel</span>
          </div>
          <div>
            <strong>2e</strong>
            <span>sur 148 ailiers</span>
          </div>
        </div>
      </div>
      <div className={s.railSection}>
        <p className={s.railTitle}>
          Postes occupés <span>2026/27</span>
        </p>
        <PositionsPitch positions={D.POSITIONS} total={D.SEASON.minutes} />
      </div>
      <div className={s.railSection}>
        <p className={s.railTitle}>
          Disponibilité <span>depuis 2023</span>
        </p>
        <div className={s.indexRow}>
          <div>
            <strong>{availability.count}</strong>
            <span>absences</span>
          </div>
          <div>
            <strong>{availability.weeks} sem.</strong>
            <span>d’arrêt cumulé</span>
          </div>
          <div>
            <strong>{availability.current} j</strong>
            <span>cette saison</span>
          </div>
        </div>
        <button
          type="button"
          className={s.railLink}
          onClick={() => onTab("carriere")}
        >
          Historique des blessures →
        </button>
      </div>
      <div className={s.railSection}>
        <div className={s.actions}>
          <button type="button" className="button button-primary">
            <Bookmark size={15} /> Suivre le joueur
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onTab("comparer")}
          >
            <ArrowLeftRight size={15} /> Comparer
          </button>
          <button type="button" className="button button-secondary">
            <FileDown size={15} /> Rapport PDF
          </button>
        </div>
      </div>
    </aside>
  );
}

/* --------------------------------------------------------------- overview */

const SCOPES = [
  ["all", "Toutes"],
  ["LaLiga", "LaLiga"],
  ["Ligue des champions", "LDC"],
];

export function Overview({ onTab }) {
  const [scope, setScope] = useState("all");
  const row =
    scope === "all"
      ? D.SEASON
      : D.COMPETITIONS.find((item) => item.name === scope);
  const contributions = row.goals + row.assists;
  const kpis = [
    [
      "Matchs",
      row.matches,
      scope === "all"
        ? `${D.SEASON.starts} titularisations`
        : `${fmt(row.minutes / row.matches)} min par match`,
    ],
    [
      "Minutes",
      fmt(row.minutes),
      scope === "all"
        ? `${D.SEASON.minutesShare} % du temps de jeu`
        : `${fmt(row.minutes / 90, 1)} matchs complets`,
    ],
    ["Buts", row.goals, `xG ${fmt(row.xg, 2)}`],
    ["Passes décisives", row.assists, `xA ${fmt(row.xa, 2)}`],
    ["Note moyenne", fmt(row.rating, 2), "sur 10"],
    [
      "Min. par but ou PD",
      `${fmt(row.minutes / contributions)}′`,
      `${contributions} contributions`,
    ],
  ];
  const pizza = D.PIZZA.map((key) => ({
    ...D.METRIC[key],
    rank: D.cohortRank(D.METRIC[key].percentile, D.COHORTS.top5.size),
  }));
  const recent = D.MATCHES.slice(-10);
  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Saison 2026/27</h2>
            <p className={s.sub}>FC Barcelona · matchs de club</p>
          </div>
          <Segments
            label="Compétition"
            value={scope}
            onChange={setScope}
            items={SCOPES}
          />
        </div>
        <div className={s.kpis}>
          {kpis.map(([label, value, note]) => (
            <div className={s.kpi} key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{note}</small>
            </div>
          ))}
        </div>
      </section>

      <section className={`${s.section} ${s.grid2}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Profil statistique</h3>
              <p className={s.sub}>
                Centiles par 90 min face aux {D.COHORTS.top5.size} ailiers des
                cinq grands championnats (450 min minimum).
              </p>
            </div>
          </div>
          <div className={s.pizzaWrap}>
            <PercentilePizza items={pizza} cohort={D.COHORTS.top5.size} />
          </div>
          <ToneLegend />
          <p className={s.note} style={{ marginTop: 8 }}>
            Un 94 signifie que le joueur fait mieux que 94 % des ailiers de la
            cohorte. Survolez un secteur pour la valeur par 90 min et le rang.
          </p>
        </div>
        <div className={s.stack}>
          <div className={s.card}>
            <div className={s.cardHead}>
              <div>
                <h3>Indice Vega par rôle</h3>
                <p className={s.sub}>
                  Score de performance dans ses meilleurs rôles et rang dans la
                  cohorte.
                </p>
              </div>
            </div>
            <div className={s.gaugeRow}>
              <Gauge value={D.PLAYER.vegaIndex} label="Ailier droit" />
              <ul className={s.roles}>
                {D.ROLE_SCORES.map((role) => (
                  <li
                    key={role.code}
                    className={role.primary ? s.primaryRole : undefined}
                  >
                    <span>{role.role}</span>
                    <b>{role.score}</b>
                    <div className={s.meter}>
                      <div style={{ width: `${role.score}%` }} />
                    </div>
                    <small>
                      {ordinal(role.rank)} sur {role.of}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className={s.card}>
            <div className={s.cardHead}>
              <div>
                <h3>Scores par compétence</h3>
                <p className={s.sub}>
                  Synthèse sur 100 des indicateurs de chaque famille.
                </p>
              </div>
            </div>
            <div className={s.skills}>
              {D.SKILLS.map((skill) => (
                <div className={s.skill} key={skill.label}>
                  <span>{skill.label}</span>
                  <strong>{skill.value}</strong>
                  <PercentileBar value={skill.value} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${s.section} ${s.grid3}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3>Points forts</h3>
            <span className={s.sub}>{D.STRENGTHS.length} critères</span>
          </div>
          <TraitList items={D.STRENGTHS} />
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3>Points faibles</h3>
            <span className={s.sub}>{D.WEAKNESSES.length} critères</span>
          </div>
          <TraitList items={D.WEAKNESSES} />
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3>Lecture du scout</h3>
          </div>
          <ul className={s.summary}>
            {D.SCOUT_SUMMARY.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${s.section} ${s.grid3}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Forme récente</h3>
              <p className={s.sub}>Note des 10 derniers matchs</p>
            </div>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => onTab("matchs")}
            >
              Tous les matchs
            </button>
          </div>
          <LineChart
            width={380}
            height={210}
            points={recent.map((match) => ({
              x: match.code,
              y: match.rating,
              match,
            }))}
            domain={[6, 10]}
            ticks={[6, 7, 8, 9, 10]}
            format={(value) => fmt(value, value % 1 ? 1 : 0)}
            reference={{
              y: D.SEASON.rating,
              label: `Moy. ${fmt(D.SEASON.rating, 2)}`,
            }}
            ariaLabel="Note des dix derniers matchs"
            tip={(point) => (
              <TipBody
                title={`${point.match.opponent} · ${point.match.score}`}
                rows={[
                  ["Date", shortDate(point.match.date)],
                  ["Note", fmt(point.match.rating, 1)],
                  [
                    "Buts / PD",
                    `${point.match.goals} / ${point.match.assists}`,
                  ],
                ]}
              />
            )}
          />
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3>Profil de jeu</h3>
          </div>
          <div className={s.styles}>
            {D.PLAY_STYLE.map((item) => (
              <div key={item.label}>
                <strong>{item.label}</strong>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Contexte d’équipe</h3>
              <p className={s.sub}>Style du FC Barcelona, sur 100</p>
            </div>
          </div>
          <div className={s.teamScores}>
            {D.TEAM_STYLE.scores.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className={s.bars}>
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
        </div>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Palmarès</h2>
          <span className={s.sub}>8 titres</span>
        </div>
        <Trophies />
      </section>
    </>
  );
}

export function TraitList({ items }) {
  return (
    <ul className={s.traits}>
      {items.map((item) => {
        const metric = D.METRIC[item.metric];
        return (
          <li key={item.label} className={toneClass(metric.percentile)}>
            <span>{item.label}</span>
            <small>
              {fmt(metric.value, metric.decimals, { unit: metric.unit })}
              {metric.unit ? "" : " /90"}
            </small>
            <PercentileBadge value={metric.percentile} />
          </li>
        );
      })}
    </ul>
  );
}

export function Trophies() {
  return (
    <div className={s.trophies}>
      {D.HONOURS.map((item) => (
        <div className={s.trophy} key={item.label}>
          <img src={item.image} alt="" />
          <span>{item.label}</span>
          {item.count > 1 && <b>×{item.count}</b>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- statistics */

const MODES = [
  ["per90", "Par 90 min"],
  ["total", "Totaux"],
];

export function Statistics() {
  const [mode, setMode] = useState("per90");
  const [cohort, setCohort] = useState("top5");
  const size = D.COHORTS[cohort].size;
  const shift = (p) =>
    cohort === "liga"
      ? Math.min(100, p + 3)
      : cohort === "ucl"
        ? Math.max(1, p - 4)
        : p;
  const scale = (metric, value) =>
    mode === "total" && metric.unit !== "%"
      ? (value * D.SEASON.minutes) / 90
      : value;
  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Statistiques détaillées</h2>
            <p className={s.sub}>
              {D.COHORTS[cohort].label} · {size} joueurs · 450 min minimum ·
              saison 2026/27
            </p>
          </div>
          <div className={s.toolbar}>
            <Segments
              label="Calcul"
              value={mode}
              onChange={setMode}
              items={MODES}
            />
            <label className={s.field}>
              Référentiel
              <select
                value={cohort}
                onChange={(event) => setCohort(event.target.value)}
              >
                {Object.entries(D.COHORTS).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <ToneLegend />
      </section>
      <div className={s.statsGrid}>
        {Object.entries(D.CATEGORIES).map(([category, label]) => {
          const metrics = D.METRICS.filter(
            (metric) => metric.category === category,
          );
          return (
            <section key={category}>
              <div className={s.sectionHead}>
                <h2>{label}</h2>
                <span className={s.sub}>
                  Centile moyen{" "}
                  {Math.round(
                    metrics.reduce(
                      (sum, metric) => sum + shift(metric.percentile),
                      0,
                    ) / metrics.length,
                  )}
                </span>
              </div>
              <div className={s.tableWrap}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Indicateur</th>
                      <th className={s.num}>
                        {mode === "total" ? "Total" : "Par 90 ou %"}
                      </th>
                      <th className={s.num}>Médiane</th>
                      <th>Position dans la cohorte</th>
                      <th className={s.num}>Centile</th>
                      <th className={s.num}>Rang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => {
                      const percentile = shift(metric.percentile);
                      const decimals =
                        mode === "total" && metric.unit !== "%"
                          ? metric.decimals > 1
                            ? 1
                            : 0
                          : metric.decimals;
                      return (
                        <tr key={metric.key}>
                          <th scope="row" className={s.metricCell}>
                            {metric.label}
                            {metric.inverted && (
                              <span className={s.sub}> · moins = mieux</span>
                            )}
                          </th>
                          <td className={s.num}>
                            {fmt(scale(metric, metric.value), decimals, {
                              signed: metric.signed,
                              unit: metric.unit,
                            })}
                          </td>
                          <td
                            className={s.num}
                            style={{ color: "var(--muted)" }}
                          >
                            {fmt(scale(metric, metric.dist[2]), decimals, {
                              signed: metric.signed,
                              unit: metric.unit,
                            })}
                          </td>
                          <td className={s.barCell}>
                            <PercentileBar value={percentile} />
                          </td>
                          <td className={s.num}>
                            <PercentileBadge value={percentile} prefix="" />
                          </td>
                          <td className={s.num}>
                            {ordinal(D.cohortRank(percentile, size))}
                            <span style={{ color: "var(--muted-light)" }}>
                              {" "}
                              / {size}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        <section className={s.grid2even}>
          <div className={s.card}>
            <div className={s.cardHead}>
              <div>
                <h3>Carte des tirs</h3>
                <p className={s.sub}>
                  {D.SHOTS.length} tirs · taille selon les xG
                </p>
              </div>
              <Legend
                items={[
                  ["swatchDot", "But", "var(--accent)"],
                  ["swatchRing", "Arrêté"],
                  ["swatchRing", "Non cadré ou contré"],
                ]}
              />
            </div>
            <ShotMap shots={D.SHOTS} />
            <div className={s.shotStats}>
              {[
                [D.SEASON.shots, "Tirs"],
                [D.SEASON.shotsOnTarget, "Cadrés"],
                [D.SEASON.goals, "Buts"],
                [fmt(D.SEASON.xg, 2), "xG"],
                [fmt(D.SEASON.xg / D.SEASON.shots, 2), "xG par tir"],
              ].map(([value, label]) => (
                <div key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={s.card}>
            <div className={s.cardHead}>
              <div>
                <h3>Zones de présence</h3>
                <p className={s.sub}>Ballons touchés, attaque vers la droite</p>
              </div>
            </div>
            <HeatmapPitch grid={D.HEATMAP} />
            <p className={s.note} style={{ marginTop: 12 }}>
              71 % des ballons touchés dans le couloir droit, dont 38 % dans le
              dernier tiers. Repique vers l’axe dans 6 actions sur 10.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- physical */

export function Physical() {
  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Profil physique</h2>
            <p className={s.sub}>
              Suivi optique · 15 matchs · comparé aux ailiers de LaLiga
            </p>
          </div>
          <ToneLegend />
        </div>
        <div className={s.physGrid}>
          {D.PHYSICAL.map((metric) => (
            <div className={s.physTile} key={metric.key}>
              <span>{metric.label}</span>
              <div className={s.physValue}>
                <strong>
                  {fmt(metric.value, metric.decimals, {
                    signed: metric.signed,
                  })}
                  <small>{metric.unit}</small>
                </strong>
                <PercentileBadge value={metric.percentile} />
              </div>
              <PercentileBar value={metric.percentile} />
            </div>
          ))}
        </div>
      </section>
      <section className={`${s.section} ${s.grid2even}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Vitesse maximale par match</h3>
              <p className={s.sub}>
                km/h · ligne pointillée : médiane des ailiers
              </p>
            </div>
          </div>
          <LineChart
            width={520}
            points={D.MATCHES.map((match) => ({
              x: match.code,
              y: match.topSpeed,
              match,
            }))}
            domain={[30, 36]}
            ticks={[30, 32, 34, 36]}
            labelEvery={2}
            format={(value) => fmt(value, 0)}
            reference={{ y: 33, label: "Médiane 33,0" }}
            ariaLabel="Vitesse maximale par match"
            tip={(point) => (
              <TipBody
                title={`${point.match.opponent} · ${shortDate(point.match.date)}`}
                rows={[
                  ["Vitesse max.", `${fmt(point.y, 1)} km/h`],
                  ["Minutes", point.match.minutes],
                ]}
              />
            )}
          />
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Répartition de la distance</h3>
              <p className={s.sub}>km par 90 min selon la vitesse</p>
            </div>
          </div>
          <SegmentBar
            items={D.SPEED_ZONES}
            format={(value) => `${fmt(value, 2)} km`}
          />
          <ul className={s.summary} style={{ marginTop: 18 }}>
            <li>
              Profil explosif : 93e centile en accélérations et 90e en vitesse
              de pointe.
            </li>
            <li>
              Volume total dans la moyenne basse (41e centile) : il économise
              ses courses sans ballon.
            </li>
            <li>
              L’intensité baisse de 18 % après la pause, un point à surveiller
              dans un championnat plus rythmé.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------- comparison */

const COMPARE_OPTIONS = [
  ...D.AUTO_COMPARISONS.map((item) => ({ ...item, sub: item.detail })),
  ...D.PEERS.map((peer) => ({
    ...peer,
    sub: `${peer.club} · ${peer.age} ans`,
  })),
];
const BASE = {
  name: "Lamine Yamal",
  values: Object.fromEntries(
    D.PIZZA.map((key) => [key, D.METRIC[key].percentile]),
  ),
};

export function Comparison({ selected, onSelect }) {
  const chosen = selected
    .map((id) => COMPARE_OPTIONS.find((option) => option.id === id))
    .filter(Boolean);
  const series = [
    { ...BASE, color: COLORS[0] },
    ...chosen.map((option, i) => ({
      name: option.name,
      values: option.values,
      color: COLORS[i + 1],
      dashed: option.id === "median",
    })),
  ];
  const axes = D.PIZZA.map((key) => ({ key, label: D.METRIC[key].label }));
  const replace = (index, id) =>
    onSelect(selected.map((value, i) => (i === index ? id : value)));
  const nextFree = COMPARE_OPTIONS.find(
    (option) => !selected.includes(option.id),
  );
  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Comparaisons automatiques</h2>
            <p className={s.sub}>Un clic remplace le premier joueur comparé</p>
          </div>
        </div>
        <div className={s.autoGrid}>
          {D.AUTO_COMPARISONS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={s.autoButton}
              aria-pressed={selected.includes(item.id)}
              onClick={() =>
                onSelect([
                  item.id,
                  ...selected.slice(1).filter((id) => id !== item.id),
                ])
              }
            >
              {item.label}
              <small>{item.detail}</small>
            </button>
          ))}
        </div>
      </section>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Joueurs comparés</h2>
          <span className={s.sub}>Jusqu’à trois profils</span>
        </div>
        <div className={s.slots}>
          <div className={s.slot} style={{ "--tone": COLORS[0] }}>
            <Avatar src={D.PLAYER.image} name={D.PLAYER.name} size={32} />
            <div>
              <strong>Lamine Yamal</strong>
              <small>Ailier droit · saison 2026/27 · joueur de base</small>
            </div>
            <span />
          </div>
          {chosen.map((option, index) => (
            <div
              className={s.slot}
              key={option.id}
              style={{
                "--tone":
                  option.id === "median" ? "var(--muted)" : COLORS[index + 1],
              }}
            >
              <Avatar src={option.image} name={option.name} size={32} />
              <label className={s.field}>
                <span className="sr-only">Joueur {index + 2}</span>
                <select
                  value={option.id}
                  onChange={(event) => replace(index, event.target.value)}
                >
                  {COMPARE_OPTIONS.filter(
                    (item) =>
                      item.id === option.id || !selected.includes(item.id),
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {item.sub}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={s.iconButton}
                aria-label={`Retirer ${option.name}`}
                onClick={() =>
                  onSelect(selected.filter((id) => id !== option.id))
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
          {selected.length < 2 && nextFree && (
            <button
              type="button"
              className={`button button-secondary ${s.addButton}`}
              onClick={() => onSelect([...selected, nextFree.id])}
            >
              <Plus size={15} /> Ajouter un joueur
            </button>
          )}
        </div>
      </section>
      <section className={`${s.section} ${s.grid2even}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Radar de centiles</h3>
              <p className={s.sub}>Mêmes axes que le profil statistique</p>
            </div>
          </div>
          <RadarChart
            axes={axes}
            series={series}
            showValues={false}
            size={460}
          />
          <SeriesLegend series={series} />
        </div>
        <div className={s.tableWrap} style={{ alignSelf: "start" }}>
          <table className="data-table" style={{ minWidth: 420 }}>
            <thead>
              <tr>
                <th>Indicateur</th>
                {series.map((item) => (
                  <th key={item.name} className={s.num}>
                    {item.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axes.map((axis) => {
                const best = Math.max(
                  ...series.map((item) => item.values[axis.key] ?? 0),
                );
                return (
                  <tr key={axis.key}>
                    <th scope="row" className={s.metricCell}>
                      {axis.label}
                    </th>
                    {series.map((item) => (
                      <td
                        key={item.name}
                        className={`${s.num} ${item.values[axis.key] === best ? s.best : ""}`}
                      >
                        {item.values[axis.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- similar */

export function Similar({ onCompare }) {
  const [age, setAge] = useState("all");
  const [value, setValue] = useState("all");
  const [league, setLeague] = useState("all");
  const leagues = [...new Set(D.SIMILAR.map((item) => item.league))];
  const rows = D.SIMILAR.filter(
    (item) =>
      (age === "all" || item.age <= Number(age)) &&
      (value === "all" || item.value <= Number(value)) &&
      (league === "all" || item.league === league),
  );
  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Profils similaires</h2>
            <p className={s.sub}>
              Distance entre profils de centiles, tous championnats européens
            </p>
          </div>
          <div className={s.toolbar}>
            <label className={s.field}>
              Âge
              <select
                value={age}
                onChange={(event) => setAge(event.target.value)}
              >
                <option value="all">Tous</option>
                <option value="21">21 ans et moins</option>
                <option value="24">24 ans et moins</option>
              </select>
            </label>
            <label className={s.field}>
              Valeur
              <select
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="all">Toutes</option>
                <option value="50">50 M€ et moins</option>
                <option value="100">100 M€ et moins</option>
              </select>
            </label>
            <label className={s.field}>
              Championnat
              <select
                value={league}
                onChange={(event) => setLeague(event.target.value)}
              >
                <option value="all">Tous</option>
                {leagues.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {rows.length ? (
          <div className={s.similarGrid}>
            {rows.map((item) => {
              const peer = D.PEERS.find(
                (candidate) => candidate.name === item.name,
              );
              return (
                <article className={s.similar} key={item.name}>
                  <div className={s.similarHead}>
                    <Avatar src={item.image} name={item.name} size={40} />
                    <div style={{ minWidth: 0 }}>
                      <strong>{item.name}</strong>
                      <small>
                        <Flag code={item.flag} /> {item.age} ans · {item.club}
                      </small>
                    </div>
                    <div className={s.similarScore}>
                      <b>{item.similarity} %</b>
                      <span>similarité</span>
                    </div>
                  </div>
                  <PercentileBar value={item.similarity} />
                  <div className={s.similarMeta}>
                    <span>
                      Valeur <b>{item.value} M€</b>
                    </span>
                    <span>{item.league}</span>
                  </div>
                  <div className={s.tags}>
                    {item.traits.map((trait) => (
                      <span key={trait}>{trait}</span>
                    ))}
                  </div>
                  <p className={s.gap}>Écart principal : {item.gap}</p>
                  {peer && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => onCompare(peer.id)}
                    >
                      <ArrowLeftRight size={15} /> Comparer
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className={s.note}>Aucun profil ne correspond à ces filtres.</p>
        )}
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- career */

export function Career() {
  const totals = D.CAREER.reduce(
    (sum, row) => ({
      matches: sum.matches + row.matches,
      starts: sum.starts + row.starts,
      minutes: sum.minutes + row.minutes,
      goals: sum.goals + row.goals,
      assists: sum.assists + row.assists,
      yellow: sum.yellow + row.yellow,
      red: sum.red + row.red,
    }),
    {
      matches: 0,
      starts: 0,
      minutes: 0,
      goals: 0,
      assists: 0,
      yellow: 0,
      red: 0,
    },
  );
  const availability = injuryTotals(D.INJURIES, D.PLAYER.season);
  return (
    <>
      <section className={`${s.section} ${s.grid2even}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Évolution de l’indice Vega</h3>
              <p className={s.sub}>
                Niveau saison par saison au poste principal
              </p>
            </div>
          </div>
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
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Valeur marchande</h3>
              <p className={s.sub}>Estimation Vega en millions d’euros</p>
            </div>
          </div>
          <LineChart
            width={520}
            points={D.VALUE_HISTORY.map((row) => ({
              x: row.date,
              y: row.value,
            }))}
            domain={[0, 300]}
            ticks={[0, 100, 200, 300]}
            labelEvery={2}
            format={(value) => `${fmt(value)} M€`}
            ariaLabel="Valeur marchande estimée"
          />
        </div>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Saison par saison</h2>
          <span className={s.sub}>Toutes compétitions de club</span>
        </div>
        <div className={s.tableWrap}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Saison</th>
                <th>Club</th>
                <th>Compétitions</th>
                <th className={s.num}>MJ</th>
                <th className={s.num}>Tit.</th>
                <th className={s.num}>Min</th>
                <th className={s.num}>Buts</th>
                <th className={s.num}>PD</th>
                <th className={s.num}>Cartons</th>
                <th className={s.num}>Note</th>
              </tr>
            </thead>
            <tbody>
              {D.CAREER.map((row) => (
                <tr key={row.season}>
                  <th scope="row">{row.season}</th>
                  <td>
                    <span className={s.cell}>
                      <Crest src={row.crest} size={18} />
                      {row.club}
                    </span>
                  </td>
                  <td>
                    <div className={s.compChips}>
                      {row.competitions.map((competition) => (
                        <span key={competition}>{competition}</span>
                      ))}
                    </div>
                  </td>
                  <td className={s.num}>{row.matches}</td>
                  <td className={s.num}>{row.starts}</td>
                  <td className={s.num}>{fmt(row.minutes)}</td>
                  <td className={s.num}>{row.goals}</td>
                  <td className={s.num}>{row.assists}</td>
                  <td className={s.num}>
                    {row.yellow} / {row.red}
                  </td>
                  <td className={s.num}>{fmt(row.rating, 2)}</td>
                </tr>
              ))}
              <tr className={s.totalRow}>
                <th scope="row">Total</th>
                <td>FC Barcelona</td>
                <td />
                <td className={s.num}>{totals.matches}</td>
                <td className={s.num}>{totals.starts}</td>
                <td className={s.num}>{fmt(totals.minutes)}</td>
                <td className={s.num}>{totals.goals}</td>
                <td className={s.num}>{totals.assists}</td>
                <td className={s.num}>
                  {totals.yellow} / {totals.red}
                </td>
                <td />
              </tr>
              <tr>
                <th scope="row">Sélection</th>
                <td>
                  <span className={s.cell}>
                    <Flag code={D.NATIONAL_CAREER.flag} />
                    {D.NATIONAL_CAREER.team}
                  </span>
                </td>
                <td>
                  <div className={s.compChips}>
                    {D.NATIONAL_CAREER.tournaments.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </td>
                <td className={s.num}>{D.NATIONAL_CAREER.caps}</td>
                <td className={s.num}>—</td>
                <td className={s.num}>{fmt(D.NATIONAL_CAREER.minutes)}</td>
                <td className={s.num}>{D.NATIONAL_CAREER.goals}</td>
                <td className={s.num}>{D.NATIONAL_CAREER.assists}</td>
                <td className={s.num}>—</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Blessures et suspensions</h2>
            <p className={s.sub}>
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
        <div className={s.tableWrap}>
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
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Palmarès</h2>
        </div>
        <Trophies />
      </section>
    </>
  );
}

/* ------------------------------------------------------------- projection */

export function Projection() {
  const [leagueId, setLeagueId] = useState("pl");
  const league = D.LEAGUES.find((item) => item.id === leagueId);
  const [club, setClub] = useState(league.clubs[0]);
  const current = D.LEAGUES.find((item) => item.current);
  const chooseLeague = (id) => {
    setLeagueId(id);
    setClub(D.LEAGUES.find((item) => item.id === id).clubs[0]);
  };
  const squad = useMemo(
    () =>
      [
        ...(D.SQUADS[club] || []).map(([name, index]) => ({ name, index })),
        { name: "Lamine Yamal (projeté)", index: league.index, self: true },
      ].sort((a, b) => b.index - a.index),
    [club, league.index],
  );
  const indexDelta = league.index - current.index;
  return (
    <>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Projeter Lamine Yamal ailleurs</h2>
            <p className={s.sub}>
              Niveau estimé, ajustements physiques et concurrence au poste dans
              le club visé. Modèle fictif.
            </p>
          </div>
          <div className={s.toolbar}>
            <label className={s.field}>
              Championnat
              <select
                value={leagueId}
                onChange={(event) => chooseLeague(event.target.value)}
              >
                {D.LEAGUES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.current ? " (actuel)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              Club
              <select
                value={club}
                onChange={(event) => setClub(event.target.value)}
              >
                {league.clubs.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className={s.projTiles}>
          <div className={s.projTile}>
            <span>Indice Vega projeté</span>
            <strong>{league.index}</strong>
            <small>
              {indexDelta === 0
                ? "Identique"
                : `${indexDelta > 0 ? "+" : ""}${indexDelta}`}{" "}
              par rapport à LaLiga ({current.index})
            </small>
          </div>
          <div className={s.projTile}>
            <span>Buts et passes décisives par 90 min</span>
            <strong>{fmt(league.ga90, 2)}</strong>
            <small>Actuellement {fmt(current.ga90, 2)}</small>
          </div>
          <div className={s.projTile}>
            <span>Probabilité d’être titulaire</span>
            <strong>{league.start} %</strong>
            <small>Selon la concurrence au poste</small>
          </div>
        </div>
      </section>
      <section className={`${s.section} ${s.grid2even}`}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Ajustements attendus</h3>
              <p className={s.sub}>
                Coefficient du championnat : {league.strength} / 100
              </p>
            </div>
          </div>
          <ul className={s.adjustments}>
            {league.adjustments.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className={s.tableWrap} style={{ alignSelf: "start" }}>
          <table className="data-table" style={{ minWidth: 380 }}>
            <caption className="sr-only">Concurrence au poste</caption>
            <thead>
              <tr>
                <th>Ailiers droits · {club}</th>
                <th className={s.num}>Indice</th>
                <th className={s.num}>Écart</th>
              </tr>
            </thead>
            <tbody>
              {squad.map((row) => (
                <tr
                  key={row.name}
                  className={row.self ? s.selectedRow : undefined}
                >
                  <th scope="row" className={row.self ? s.best : s.metricCell}>
                    {row.name}
                  </th>
                  <td className={s.num}>{row.index}</td>
                  <td className={s.num}>
                    {row.self
                      ? "—"
                      : fmt(league.index - row.index, 0, { signed: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Tous les championnats</h2>
          <span className={s.sub}>
            Cliquez sur une ligne pour la sélectionner
          </span>
        </div>
        <div className={s.tableWrap}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Championnat</th>
                <th className={s.num}>Coefficient</th>
                <th className={s.num}>Indice projeté</th>
                <th className={s.num}>B + PD / 90</th>
                <th className={s.num}>Titularisation</th>
                <th>Principal ajustement</th>
              </tr>
            </thead>
            <tbody>
              {D.LEAGUES.map((item) => (
                <tr
                  key={item.id}
                  className={item.id === leagueId ? s.selectedRow : undefined}
                  onClick={() => chooseLeague(item.id)}
                  style={{ cursor: "pointer" }}
                >
                  <th scope="row">
                    <span className={s.cell}>
                      <Flag code={item.flag} />
                      {item.name}
                    </span>
                  </th>
                  <td className={s.num}>{item.strength}</td>
                  <td className={s.num}>{item.index}</td>
                  <td className={s.num}>{fmt(item.ga90, 2)}</td>
                  <td className={s.num}>{item.start} %</td>
                  <td style={{ color: "var(--muted)" }}>
                    {item.adjustments[0]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- matches */

export function Matches() {
  const rows = [...D.MATCHES].reverse();
  return (
    <>
      <section className={s.section}>
        <div className={s.card}>
          <div className={s.cardHead}>
            <div>
              <h3>Note par match</h3>
              <p className={s.sub}>
                Saison 2026/27 · ligne pointillée : moyenne de la saison
              </p>
            </div>
          </div>
          <LineChart
            width={900}
            height={200}
            points={D.MATCHES.map((match) => ({
              x: match.code,
              y: match.rating,
              match,
            }))}
            domain={[6, 10]}
            ticks={[6, 7, 8, 9, 10]}
            reference={{
              y: D.SEASON.rating,
              label: `Moyenne ${fmt(D.SEASON.rating, 2)}`,
            }}
            ariaLabel="Note par match"
            tip={(point) => (
              <TipBody
                title={`${point.match.opponent} · ${point.match.score}`}
                rows={[
                  ["Date", shortDate(point.match.date)],
                  ["Note", fmt(point.match.rating, 1)],
                  [
                    "Buts / PD",
                    `${point.match.goals} / ${point.match.assists}`,
                  ],
                  [
                    "xG / xA",
                    `${fmt(point.match.xg, 2)} / ${fmt(point.match.xa, 2)}`,
                  ],
                ]}
              />
            )}
          />
        </div>
      </section>
      <section className={s.section}>
        <div className={s.tableWrap}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Compétition</th>
                <th>Adversaire</th>
                <th>Résultat</th>
                <th className={s.num}>Min</th>
                <th className={s.num}>B</th>
                <th className={s.num}>PD</th>
                <th className={s.num}>xG</th>
                <th className={s.num}>xA</th>
                <th className={s.num}>Tirs</th>
                <th className={s.num}>Dribbles</th>
                <th className={s.num}>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((match) => (
                <tr key={match.date}>
                  <td>{shortDate(match.date)}</td>
                  <td>
                    <span className={s.cell}>
                      <Crest
                        src={COMPETITION_CRESTS[match.competition]}
                        size={16}
                      />
                      {match.competition === "LaLiga" ? "LaLiga" : "LDC"}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: "var(--muted)" }}>
                      {match.venue === "home" ? "vs" : "à"}
                    </span>{" "}
                    {match.opponent}
                  </td>
                  <td>
                    <span className={s.cell}>
                      <span
                        className={`${s.result} ${s[`result${match.result}`]}`}
                      >
                        {{ W: "V", D: "N", L: "D" }[match.result]}
                      </span>
                      {match.score}
                    </span>
                  </td>
                  <td className={s.num}>{match.minutes}′</td>
                  <td className={s.num}>{match.goals || "—"}</td>
                  <td className={s.num}>{match.assists || "—"}</td>
                  <td className={s.num}>{fmt(match.xg, 2)}</td>
                  <td className={s.num}>{fmt(match.xa, 2)}</td>
                  <td className={s.num}>{match.shots}</td>
                  <td className={s.num}>{match.dribbles}</td>
                  <td className={s.num}>
                    <PercentileBadge
                      value={ratingPercentile(match.rating)}
                      label={fmt(match.rating, 1)}
                      title={`Note ${fmt(match.rating, 1)} sur 10`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
