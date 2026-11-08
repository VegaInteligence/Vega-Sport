"use client";
import React, { useMemo, useState } from "react";
import {
  Activity,
  Brain,
  CalendarDays,
  ChartNoAxesColumn,
  Compass,
  Crosshair,
  FileDown,
  Fingerprint,
  GitCompareArrows,
  HeartPulse,
  LayoutGrid,
  Play,
  Star,
  Target,
  TrendingUp,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { Segments } from "../../../src/components/UI.jsx";
import { Avatar, Crest, Flag, MockShell, useTab } from "../_shared/ui.jsx";
import {
  dateFr,
  DistributionStrip,
  fmt,
  injuryTotals,
  InjuryTimeline,
  Legend,
  LineChart,
  ordinal,
  PercentileBadge,
  RadarChart,
  SegmentBar,
  SeriesLegend,
  Sparkline,
  TipBody,
  toneClass,
} from "../_shared/charts.jsx";
import * as D from "../_shared/data.js";
import s from "./page-b.module.css";

const NAV = [
  [
    "Performance",
    [
      ["synthese", "Synthèse", LayoutGrid],
      ["telemetrie", "Télémétrie", Activity],
      ["distribution", "Distribution", ChartNoAxesColumn],
      ["physique", "Physique", Zap],
      ["matchs", "Matchs", CalendarDays],
    ],
  ],
  [
    "Contexte",
    [
      ["comparer", "Comparer", GitCompareArrows],
      ["similaires", "Profils similaires", Users],
      ["carriere", "Carrière et marché", TrendingUp],
      ["projection", "Projection", Target],
    ],
  ],
];
const TABS = NAV.flatMap(([, items]) =>
  items.map(([key, label]) => [key, label]),
);

/** Evaluated position and benchmark change the peer group, hence the centiles. */
const POSITIONS = {
  AD: {
    label: "Ailier droit",
    sizes: { top5: 148, liga: 31, ucl: 46 },
    shift: {},
  },
  MO: {
    label: "Milieu offensif",
    sizes: { top5: 121, liga: 27, ucl: 38 },
    shift: {
      finishing: 2,
      creation: -3,
      progression: 1,
      passing: -6,
      defending: 3,
      threat: 2,
      linkup: -6,
      pressing: 2,
    },
  },
  AG: {
    label: "Ailier gauche",
    sizes: { top5: 152, liga: 33, ucl: 44 },
    shift: {
      finishing: -2,
      creation: -1,
      progression: -2,
      passing: -1,
      defending: -1,
      threat: -2,
      dribbling: -2,
    },
  },
};
const COHORT_SHIFT = { top5: 0, liga: 3, ucl: -4 };
export const COHORT_LABELS = {
  top5: "5 grands championnats",
  liga: "LaLiga 2026/27",
  ucl: "Ligue des champions",
};
const clamp = (value) => Math.max(1, Math.min(100, Math.round(value)));
const SERIES = [
  "var(--mq-series-1)",
  "var(--mq-series-2)",
  "var(--mq-series-3)",
  "var(--muted)",
];
const shortDate = (value) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
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

/** Evaluated position, benchmark and unit: one row scoping every panel below. */
export function useAnalysis() {
  const [position, setPosition] = useState("AD");
  const [cohort, setCohort] = useState("top5");
  const [mode, setMode] = useState("per90");
  const ctx = useMemo(() => {
    const config = POSITIONS[position];
    const size = config.sizes[cohort];
    const adjust = (percentile, category) =>
      clamp(percentile + COHORT_SHIFT[cohort] + (config.shift[category] || 0));
    const metric = (key) => {
      const base = D.METRIC[key];
      const percentile = adjust(base.percentile, base.category);
      return { ...base, percentile, rank: D.cohortRank(percentile, size) };
    };
    return { position, config, cohort, size, mode, adjust, metric };
  }, [position, cohort, mode]);
  return { ctx, setPosition, setCohort, setMode };
}

export function ContextBar({ analysis }) {
  const { ctx, setPosition, setCohort, setMode } = analysis;
  const { position, cohort, mode } = ctx;
  return (
    <div className={s.context} role="group" aria-label="Contexte d’analyse">
      <label className={s.control}>
        Poste évalué
        <select
          value={position}
          onChange={(event) => setPosition(event.target.value)}
        >
          {Object.entries(POSITIONS).map(([key, item]) => (
            <option key={key} value={key}>
              {key} · {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className={s.control}>
        Référentiel
        <select
          value={cohort}
          onChange={(event) => setCohort(event.target.value)}
        >
          {Object.entries(COHORT_LABELS).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className={s.control}>
        Saison
        <select defaultValue="2026/27">
          <option>2026/27</option>
          <option disabled>2025/26</option>
          <option disabled>2024/25</option>
        </select>
      </label>
      <div className={s.control}>
        Unité
        <Segments
          label="Unité des valeurs"
          value={mode}
          onChange={setMode}
          items={[
            ["per90", "Par 90 min"],
            ["total", "Totaux"],
          ]}
        />
      </div>
      <div className={s.sample}>
        <span>
          Échantillon : <b>{ctx.size} joueurs</b> ·{" "}
          {ctx.config.label.toLowerCase()} · 450 min minimum
        </span>
        <span className={s.scale}>
          P0
          <i />
          P100
        </span>
      </div>
    </div>
  );
}

export default function PlayerPageB() {
  const [tab, setTab] = useTab(TABS);
  const analysis = useAnalysis();
  const { ctx } = analysis;
  const label = TABS.find(([key]) => key === tab)[1];
  return (
    <MockShell version="B" title="Console analyste" className={s.page}>
      <IdentityStrip />
      <ContextBar analysis={analysis} />
      <div className={s.body}>
        <nav className={s.nav} aria-label="Sections du profil">
          {NAV.map(([group, items]) => (
            <div
              className={s.navGroup}
              key={group}
              role="tablist"
              aria-label={group}
              aria-orientation="vertical"
            >
              <span>{group}</span>
              {items.map(([key, text, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls="player-b-panel"
                  className={s.navItem}
                  onClick={() => setTab(key)}
                >
                  <Icon aria-hidden="true" />
                  {text}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div
          className={s.main}
          id="player-b-panel"
          role="tabpanel"
          aria-label={label}
        >
          {tab === "synthese" && <Synthesis ctx={ctx} onTab={setTab} />}
          {tab === "telemetrie" && <Telemetry ctx={ctx} />}
          {tab === "distribution" && <Distribution ctx={ctx} />}
          {tab === "physique" && <Physical />}
          {tab === "matchs" && <Matches />}
          {tab === "comparer" && <Compare ctx={ctx} />}
          {tab === "similaires" && <Similar />}
          {tab === "carriere" && <CareerMarket />}
          {tab === "projection" && <Projection />}
        </div>
      </div>
    </MockShell>
  );
}

export function PanelHead({ title, text, children }) {
  return (
    <div className={s.panelHead}>
      <div>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      {children}
    </div>
  );
}

export function Panel({
  title,
  icon: Icon,
  text,
  children,
  actions,
  body = true,
}) {
  return (
    <section className={s.panel}>
      <div className={s.panelTitle}>
        <h3>
          {Icon && <Icon aria-hidden="true" />}
          {title}
        </h3>
        {text && <p>{text}</p>}
        {actions}
      </div>
      {body ? <div className={s.panelBody}>{children}</div> : children}
    </section>
  );
}

/* ----------------------------------------------------------- identity strip */

export function IdentityStrip({ className = "" }) {
  const p = D.PLAYER;
  return (
    <div className={`${s.strip} ${className}`}>
      <div className={s.who}>
        <Avatar src={p.image} name={p.name} size={40} />
        <h1>{p.name}</h1>
        <span className={s.pos} title={p.position}>
          {p.positionCode}
        </span>
      </div>
      <dl className={s.facts}>
        <div>
          <dt>Âge</dt>
          <dd>
            {p.age} ans <small>· {p.foot.toLowerCase()}</small>
          </dd>
        </div>
        <div>
          <dt>Club</dt>
          <dd>
            <Crest src={p.crest} size={16} />
            {p.club}
          </dd>
        </div>
        <div>
          <dt>Valeur</dt>
          <dd>
            {p.value} M€ <small>est.</small>
          </dd>
        </div>
        <div>
          <dt>Contrat</dt>
          <dd>{p.contract}</dd>
        </div>
        <div>
          <dt>Sélection</dt>
          <dd>
            {p.nationalities.map((nation) => (
              <Flag key={nation.code} code={nation.code} title={nation.name} />
            ))}
            {p.international.caps} sél.
          </dd>
        </div>
        <div>
          <dt>Indice Vega</dt>
          <dd className={s.levels}>
            <span>
              Niveau <b>{p.vegaIndex}</b>
            </span>
            <span>
              Potentiel <b>{p.potential}</b>
            </span>
            <span>
              Adéquation <b>{p.fit} %</b>
            </span>
          </dd>
        </div>
      </dl>
      <div className={s.stripActions}>
        <button type="button" className="button button-secondary">
          <FileDown size={15} /> PDF
        </button>
        <button type="button" className="button button-secondary">
          <Play size={15} /> Vidéos
        </button>
        <button type="button" className="button button-primary">
          <Star size={15} /> Suivre
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- synthesis */

const KEY_METRICS = [
  "goals",
  "npxg",
  "shots",
  "touchesBox",
  "assists",
  "dribbles",
  "offensiveDuels",
  "aerials",
  "passesReceived",
];

export function DistRow({ metric }) {
  return (
    <div className={s.distRow}>
      <div className={s.distLabel}>
        <strong>
          {metric.label}
          {metric.unit ? "" : " / 90"}
        </strong>
        <small>
          Médiane{" "}
          {fmt(metric.dist[2], metric.decimals, {
            signed: metric.signed,
            unit: metric.unit,
          })}
          {metric.rank ? ` · ${ordinal(metric.rank)}` : ""}
        </small>
      </div>
      <DistributionStrip metric={metric} />
      <span className={s.distValue}>
        {fmt(metric.value, metric.decimals, {
          signed: metric.signed,
          unit: metric.unit,
        })}
      </span>
      <PercentileBadge value={metric.percentile} />
    </div>
  );
}

export function Synthesis({ ctx, onTab, extras = true }) {
  const dims = D.ROLE_DIMENSIONS.map((dim) => ({
    ...dim,
    value: ctx.adjust(dim.value, dim.key),
  }));
  const axes = dims.map((dim) => ({ key: dim.key, label: dim.label }));
  const series = [
    {
      name: "Lamine Yamal",
      values: Object.fromEntries(dims.map((dim) => [dim.key, dim.value])),
      color: SERIES[0],
    },
    {
      name: "Médiane du poste (P50)",
      values: Object.fromEntries(dims.map((dim) => [dim.key, 50])),
      dashed: true,
    },
  ];
  const availability = injuryTotals(D.INJURIES, D.PLAYER.season);
  return (
    <>
      <PanelHead
        title="Synthèse"
        text={`Profil de ${ctx.config.label.toLowerCase()} comparé à ${ctx.size} joueurs · ${COHORT_LABELS[ctx.cohort]}`}
      />
      <div className={s.cols2}>
        <Panel
          title="Empreinte du rôle"
          icon={Fingerprint}
          text="6 dimensions fonctionnelles"
          body={false}
        >
          <div className={s.panelBody}>
            <RadarChart axes={axes} series={series} size={400} />
            <SeriesLegend series={series} />
          </div>
          <div className={s.dims}>
            {dims.map((dim) => (
              <div key={dim.key} className={toneClass(dim.value)}>
                <span>{dim.label}</span>
                <b>P{dim.value}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Distribution du championnat"
          icon={ChartNoAxesColumn}
          text="Bande P25–P75 · trait : médiane"
          body={false}
        >
          <div className={s.distRows}>
            {KEY_METRICS.map((key) => (
              <DistRow key={key} metric={ctx.metric(key)} />
            ))}
          </div>
        </Panel>
      </div>
      {extras && (
        <div className={s.cols3}>
          <Panel title="Lecture rapide" icon={Brain}>
            <ul className={s.bullets}>
              {D.SCOUT_SUMMARY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Indice par poste" icon={Compass} body={false}>
            <div className={s.tableScroll}>
              <table className="data-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Poste</th>
                    <th>Indice</th>
                    <th className={s.num}>Rang</th>
                  </tr>
                </thead>
                <tbody>
                  {D.ROLE_SCORES.map((role) => (
                    <tr
                      key={role.code}
                      className={
                        role.code === ctx.position ? s.highlight : undefined
                      }
                    >
                      <th scope="row">
                        {role.code} · {role.role}
                      </th>
                      <td>
                        <span className={s.inlineBar}>
                          <i style={{ width: `${role.score}%` }} />
                        </span>
                        <b style={{ color: "var(--ink-strong)" }}>
                          {role.score}
                        </b>
                      </td>
                      <td className={s.num}>
                        {ordinal(role.rank)} / {role.of}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title="Forme et disponibilité"
            icon={HeartPulse}
            actions={
              <button
                type="button"
                className="button button-ghost"
                onClick={() => onTab("matchs")}
              >
                Matchs
              </button>
            }
          >
            <div className={s.miniStats}>
              <div>
                <span>Note moyenne</span>
                <strong>{fmt(D.SEASON.rating, 2)}</strong>
                <small>/ 10</small>
              </div>
              <div>
                <span>5 derniers matchs</span>
                <Sparkline
                  values={D.MATCHES.slice(-5).map((match) => match.rating)}
                  width={110}
                  height={30}
                />
              </div>
              <div>
                <span>Temps de jeu</span>
                <strong>{D.SEASON.minutesShare} %</strong>
                <small>des minutes</small>
              </div>
              <div>
                <span>Absences depuis 2023</span>
                <strong>{availability.count}</strong>
                <small>{availability.weeks} sem.</small>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- telemetry */

const PILLAR_ICONS = {
  technical: Crosshair,
  tactical: Compass,
  physical: Zap,
  mental: Brain,
};

export function Telemetry({ ctx }) {
  const factor = ctx.mode === "total" ? D.SEASON.minutes / 90 : 1;
  return (
    <>
      <PanelHead
        title="Télémétrie"
        text={`Quatre piliers · référentiel ${COHORT_LABELS[ctx.cohort]} · ${ctx.config.label.toLowerCase()} · ${ctx.size} joueurs`}
      />
      <div className={s.pillarsWrap}>
        <div className={s.pillars}>
          {D.TELEMETRY.map((pillar) => {
            const Icon = PILLAR_ICONS[pillar.key];
            const items = [
              ...(pillar.physical || []).map((key) => {
                const metric = D.PHYSICAL.find((item) => item.key === key);
                const percentile = clamp(
                  metric.percentile + COHORT_SHIFT[ctx.cohort],
                );
                return {
                  label: metric.label,
                  value: fmt(metric.value, metric.decimals, {
                    signed: metric.signed,
                  }),
                  percentile,
                  rank: D.cohortRank(percentile, ctx.size),
                };
              }),
              ...(pillar.metrics || []).map((key) => {
                const metric = ctx.metric(key);
                const scaled =
                  metric.unit === "%" ? metric.value : metric.value * factor;
                return {
                  label: metric.label,
                  value: fmt(
                    scaled,
                    ctx.mode === "total" && metric.unit !== "%"
                      ? 0
                      : metric.decimals,
                    {
                      signed: metric.signed,
                      unit: metric.unit,
                    },
                  ),
                  percentile: metric.percentile,
                  rank: metric.rank,
                };
              }),
              ...(pillar.custom || []).map((item) => ({
                label: `${item.label} (${item.note})`,
                value: item.value,
                percentile: clamp(item.percentile + COHORT_SHIFT[ctx.cohort]),
                rank: D.cohortRank(
                  clamp(item.percentile + COHORT_SHIFT[ctx.cohort]),
                  ctx.size,
                ),
              })),
            ];
            const average = Math.round(
              items.reduce((sum, item) => sum + item.percentile, 0) /
                items.length,
            );
            return (
              <section
                className={s.pillar}
                key={pillar.key}
                aria-label={pillar.label}
              >
                <div className={s.pillarHead}>
                  <strong>
                    <Icon aria-hidden="true" />
                    {pillar.label}
                  </strong>
                  <PercentileBadge value={average} label={`Moy. P${average}`} />
                </div>
                <div className={s.tiles}>
                  {items.map((item) => (
                    <div
                      className={`${s.tile} ${toneClass(item.percentile)}`}
                      key={item.label}
                    >
                      <span title={item.label}>{item.label}</span>
                      <div className={s.tileFoot}>
                        <strong>{item.value}</strong>
                        <small>
                          <b>P{item.percentile}</b> · {ordinal(item.rank)}/
                          {ctx.size}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <p className={s.note}>
        Valeurs{" "}
        {ctx.mode === "total" ? "totales sur la saison" : "par 90 minutes"} ;
        les données physiques et mentales sont toujours exprimées par match.
        Teinte bleue au-dessus de la médiane, orange en dessous.
      </p>
    </>
  );
}

/* ------------------------------------------------------------- distribution */

export function Distribution({ ctx }) {
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("family");
  const metrics = D.METRICS.filter(
    (metric) => category === "all" || metric.category === category,
  ).map((metric) => ctx.metric(metric.key));
  if (sort === "desc") metrics.sort((a, b) => b.percentile - a.percentile);
  if (sort === "asc") metrics.sort((a, b) => a.percentile - b.percentile);
  const grouped = sort === "family";
  return (
    <>
      <PanelHead
        title="Distribution"
        text={`${D.METRICS.length} indicateurs par 90 min · ${COHORT_LABELS[ctx.cohort]}`}
      >
        <div className={s.toolbar}>
          <Segments
            label="Famille d’indicateurs"
            value={category}
            onChange={setCategory}
            items={[["all", "Tout"], ...Object.entries(D.CATEGORIES)]}
          />
          <label
            className={s.control}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
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
      </PanelHead>
      <section className={s.panel}>
        <div className={s.distRows}>
          {metrics.map((metric, index) => (
            <React.Fragment key={metric.key}>
              {grouped &&
                (index === 0 ||
                  metrics[index - 1].category !== metric.category) && (
                  <div
                    className={s.distRow}
                    style={{
                      background: "var(--surface-raised)",
                      padding: "8px 16px",
                    }}
                  >
                    <span
                      className={s.note}
                      style={{
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {D.CATEGORIES[metric.category]}
                    </span>
                  </div>
                )}
              <DistRow metric={metric} />
            </React.Fragment>
          ))}
        </div>
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- physical */

export function Physical() {
  return (
    <>
      <PanelHead
        title="Physique"
        text="Suivi optique · 15 matchs · comparé aux ailiers de LaLiga"
      />
      <div className={s.cols2even}>
        <Panel
          title="Indicateurs physiques"
          icon={Zap}
          text="Bande P25–P75 · trait : médiane"
          body={false}
        >
          <div className={s.distRows}>
            {D.PHYSICAL.map((metric) => (
              <div className={s.distRow} key={metric.key}>
                <div className={s.distLabel}>
                  <strong>{metric.label}</strong>
                  <small>
                    {metric.unit} · médiane{" "}
                    {fmt(metric.dist[2], metric.decimals, {
                      signed: metric.signed,
                    })}
                  </small>
                </div>
                <DistributionStrip metric={metric} />
                <span className={s.distValue}>
                  {fmt(metric.value, metric.decimals, {
                    signed: metric.signed,
                  })}
                </span>
                <PercentileBadge value={metric.percentile} />
              </div>
            ))}
          </div>
        </Panel>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Panel
            title="Vitesse de pointe par match"
            icon={Activity}
            text="km/h · pointillés : médiane 33,0"
          >
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
              reference={{ y: 33, label: "Médiane" }}
              ariaLabel="Vitesse de pointe par match"
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
          </Panel>
          <Panel
            title="Distance par zone de vitesse"
            icon={ChartNoAxesColumn}
            text="km / 90 min"
          >
            <SegmentBar
              items={D.SPEED_ZONES}
              format={(value) => `${fmt(value, 2)} km`}
            />
          </Panel>
          <Panel title="Lecture" icon={Brain}>
            <ul className={s.bullets}>
              <li>
                Explosivité d’élite : accélérations au 93e centile, vitesse de
                pointe au 90e.
              </li>
              <li>
                Volume global modeste (41e centile) et intensité en baisse de 18
                % après la pause.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ matches */

export function CompetitionPanel() {
  return (
    <Panel title="Par compétition" icon={ChartNoAxesColumn} body={false}>
      <div className={s.tableScroll}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Compétition</th>
              <th className={s.num}>MJ</th>
              <th className={s.num}>Min</th>
              <th className={s.num}>Buts</th>
              <th className={s.num}>PD</th>
              <th className={s.num}>xG</th>
              <th className={s.num}>xA</th>
              <th className={s.num}>Min / B+PD</th>
              <th className={s.num}>Note</th>
            </tr>
          </thead>
          <tbody>
            {D.COMPETITIONS.map((row) => (
              <tr key={row.name}>
                <th scope="row">
                  <span className={s.cell}>
                    {row.flag ? (
                      <Flag code={row.flag} />
                    ) : (
                      <Crest src={row.crest} size={16} />
                    )}
                    {row.name}
                  </span>
                </th>
                <td className={s.num}>{row.matches}</td>
                <td className={s.num}>{fmt(row.minutes)}</td>
                <td className={s.num}>{row.goals}</td>
                <td className={s.num}>{row.assists}</td>
                <td className={s.num}>{fmt(row.xg, 2)}</td>
                <td className={s.num}>{fmt(row.xa, 2)}</td>
                <td className={s.num}>
                  {fmt(row.minutes / (row.goals + row.assists))}′
                </td>
                <td className={s.num}>
                  {row.rating ? fmt(row.rating, 2) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Matches() {
  const maxContribution = Math.max(
    ...D.MATCHES.map((match) => match.xg + match.xa),
  );
  return (
    <>
      <PanelHead title="Matchs" text="Saison 2026/27 · club et sélection" />
      <CompetitionPanel />
      <Panel
        title="Journal des matchs"
        icon={CalendarDays}
        text="Barre : xG + xA du match"
        body={false}
      >
        <div className={s.tableScroll}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Comp.</th>
                <th>Adversaire</th>
                <th>Score</th>
                <th className={s.num}>Min</th>
                <th className={s.num}>B</th>
                <th className={s.num}>PD</th>
                <th>xG + xA</th>
                <th className={s.num}>Tirs</th>
                <th className={s.num}>Drib.</th>
                <th className={s.num}>V. max</th>
                <th className={s.num}>Note</th>
              </tr>
            </thead>
            <tbody>
              {[...D.MATCHES].reverse().map((match) => (
                <tr key={match.date}>
                  <td className={s.muted}>{shortDate(match.date)}</td>
                  <td>
                    <Crest
                      src={COMPETITION_CRESTS[match.competition]}
                      size={16}
                      alt={match.competition}
                    />
                  </td>
                  <th scope="row">
                    {match.opponent}{" "}
                    <span className={s.muted}>
                      ({match.venue === "home" ? "D" : "E"})
                    </span>
                  </th>
                  <td>
                    <b
                      style={{
                        color:
                          match.result === "W"
                            ? "var(--ink-strong)"
                            : "var(--muted)",
                      }}
                    >
                      {match.score}
                    </b>
                  </td>
                  <td className={s.num}>{match.minutes}′</td>
                  <td className={`${s.num} ${match.goals ? s.best : s.muted}`}>
                    {match.goals}
                  </td>
                  <td
                    className={`${s.num} ${match.assists ? s.best : s.muted}`}
                  >
                    {match.assists}
                  </td>
                  <td>
                    <span className={s.inlineBar}>
                      <i
                        style={{
                          width: `${((match.xg + match.xa) / maxContribution) * 100}%`,
                        }}
                      />
                    </span>
                    {fmt(match.xg + match.xa, 2)}
                  </td>
                  <td className={s.num}>{match.shots}</td>
                  <td className={s.num}>{match.dribbles}</td>
                  <td className={s.num}>{fmt(match.topSpeed, 1)}</td>
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
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ compare */

const COMPARE_POOL = [
  ...D.PEERS.map((peer) => ({
    ...peer,
    sub: `${peer.club} · ${peer.age} ans`,
  })),
  ...D.AUTO_COMPARISONS.map((item) => ({ ...item, sub: item.detail })),
];
const COMPARE_GROUPS = [
  ["finishing", ["goals", "goalsMinusXg", "shots"]],
  ["creation", ["assists", "xa", "passesIntoBox", "crosses"]],
  [
    "progression",
    ["dribbles", "progressiveCarries", "offensiveDuels", "passesReceived"],
  ],
  ["defending", ["defActions"]],
];

export function Compare({ ctx }) {
  const [columns, setColumns] = useState(["olise", "raphinha"]);
  const chosen = columns.map((id) =>
    COMPARE_POOL.find((item) => item.id === id),
  );
  const players = [
    {
      id: "self",
      name: "Lamine Yamal",
      sub: `FC Barcelona · ${D.PLAYER.age} ans`,
      image: D.PLAYER.image,
      values: Object.fromEntries(
        D.PIZZA.map((key) => [key, ctx.metric(key).percentile]),
      ),
    },
    ...chosen,
  ];
  const toggle = (id) =>
    setColumns((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 3
          ? [...current, id]
          : current,
    );
  const averages = players.map((player) =>
    Math.round(
      D.PIZZA.reduce((sum, key) => sum + player.values[key], 0) /
        D.PIZZA.length,
    ),
  );
  return (
    <>
      <PanelHead
        title="Comparer"
        text="Centiles par 90 min sur les mêmes indicateurs · jusqu’à quatre colonnes"
      >
        <div className={s.toolbar}>
          <div
            className={s.quick}
            role="group"
            aria-label="Comparaisons rapides"
          >
            {D.AUTO_COMPARISONS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={columns.includes(item.id)}
                disabled={!columns.includes(item.id) && columns.length >= 3}
                onClick={() => toggle(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Ajouter un joueur"
            value=""
            disabled={columns.length >= 3}
            onChange={(event) => toggle(event.target.value)}
          >
            <option value="" disabled>
              {columns.length >= 3
                ? "Quatre colonnes au maximum"
                : "Ajouter un joueur…"}
            </option>
            {D.PEERS.filter((peer) => !columns.includes(peer.id)).map(
              (peer) => (
                <option key={peer.id} value={peer.id}>
                  {peer.name} — {peer.club}
                </option>
              ),
            )}
          </select>
        </div>
      </PanelHead>
      <section className={`${s.panel} ${s.compareTable}`}>
        <div className={s.tableScroll}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Indicateur</th>
                {players.map((player, index) => (
                  <th
                    key={player.id}
                    className={s.num}
                    style={{ "--tone": SERIES[index] }}
                  >
                    <div className={s.compareHead}>
                      <span className={s.cell}>
                        <Avatar
                          src={player.image}
                          name={player.name}
                          size={26}
                        />
                        {index > 0 && (
                          <button
                            type="button"
                            className={s.removeButton}
                            aria-label={`Retirer ${player.name}`}
                            onClick={() => toggle(player.id)}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </span>
                      <strong>{player.name}</strong>
                      <small>{player.sub}</small>
                      <i />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            {COMPARE_GROUPS.map(([category, keys]) => (
              <tbody key={category}>
                <tr className={s.groupRow}>
                  <th colSpan={players.length + 1}>{D.CATEGORIES[category]}</th>
                </tr>
                {keys.map((key) => {
                  const best = Math.max(
                    ...players.map((player) => player.values[key]),
                  );
                  return (
                    <tr key={key}>
                      <th scope="row">{D.METRIC[key].label}</th>
                      {players.map((player, index) => (
                        <td key={player.id} className={s.num}>
                          <span className={s.compareCell}>
                            {index === 0 && (
                              <small>
                                {fmt(
                                  D.METRIC[key].value,
                                  D.METRIC[key].decimals,
                                  {
                                    signed: D.METRIC[key].signed,
                                    unit: D.METRIC[key].unit,
                                  },
                                )}
                              </small>
                            )}
                            <span
                              className={
                                player.values[key] === best
                                  ? s.bestBadge
                                  : undefined
                              }
                            >
                              <PercentileBadge
                                value={player.values[key]}
                                label={String(player.values[key])}
                              />
                            </span>
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            ))}
            <tbody>
              <tr className={s.highlight}>
                <th scope="row">Moyenne des centiles</th>
                {averages.map((value, index) => (
                  <td
                    key={players[index].id}
                    className={`${s.num} ${value === Math.max(...averages) ? s.best : ""}`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className={s.note}>
        Cerclé : meilleure valeur de la ligne. Les colonnes « Saison précédente
        », « Joueur médian » et « Sa saison en LDC » se comparent au même
        référentiel.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ similar */

function Similar() {
  const [maxAge, setMaxAge] = useState("all");
  const [maxValue, setMaxValue] = useState("all");
  const rows = D.SIMILAR.filter(
    (item) =>
      (maxAge === "all" || item.age <= Number(maxAge)) &&
      (maxValue === "all" || item.value <= Number(maxValue)),
  );
  return (
    <>
      <PanelHead
        title="Profils similaires"
        text="Distance entre profils de centiles · tous championnats européens"
      >
        <div className={s.toolbar}>
          <select
            aria-label="Âge maximum"
            value={maxAge}
            onChange={(event) => setMaxAge(event.target.value)}
          >
            <option value="all">Tous les âges</option>
            <option value="21">21 ans et moins</option>
            <option value="24">24 ans et moins</option>
          </select>
          <select
            aria-label="Valeur maximum"
            value={maxValue}
            onChange={(event) => setMaxValue(event.target.value)}
          >
            <option value="all">Toutes les valeurs</option>
            <option value="50">50 M€ et moins</option>
            <option value="100">100 M€ et moins</option>
          </select>
        </div>
      </PanelHead>
      <section className={s.panel}>
        <div className={s.tableScroll}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th className={s.num}>Âge</th>
                <th>Club</th>
                <th>Championnat</th>
                <th className={s.num}>Valeur</th>
                <th>Similarité</th>
                <th>Points communs</th>
                <th>Écart principal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.name}>
                  <th scope="row">
                    <span className={s.cell}>
                      <Avatar src={item.image} name={item.name} size={28} />
                      {item.name}
                    </span>
                  </th>
                  <td className={s.num}>{item.age}</td>
                  <td>
                    <span className={s.cell}>
                      <Crest src={item.crest} size={16} />
                      {item.club}
                    </span>
                  </td>
                  <td>
                    <span className={s.cell}>
                      <Flag code={item.flag} />
                      {item.league}
                    </span>
                  </td>
                  <td className={s.num}>{item.value} M€</td>
                  <td>
                    <span className={s.inlineBar}>
                      <i style={{ width: `${item.similarity}%` }} />
                    </span>
                    <b style={{ color: "var(--ink-strong)" }}>
                      {item.similarity} %
                    </b>
                  </td>
                  <td>
                    <div className={s.chips}>
                      {item.traits.map((trait) => (
                        <span key={trait}>{trait}</span>
                      ))}
                    </div>
                  </td>
                  <td className={s.muted}>{item.gap}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className={s.muted}>
                    Aucun profil ne correspond à ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ----------------------------------------------------------- career & market */

export function CareerKpis() {
  const totals = D.CAREER.reduce(
    (sum, row) => ({
      matches: sum.matches + row.matches,
      minutes: sum.minutes + row.minutes,
      goals: sum.goals + row.goals,
      assists: sum.assists + row.assists,
    }),
    { matches: 0, minutes: 0, goals: 0, assists: 0 },
  );
  const kpis = [
    ["Club actuel", D.PLAYER.club],
    ["Fin de contrat", D.PLAYER.contract],
    ["Valeur", `${D.PLAYER.value} M€ est.`, true],
    ["Matchs en club", totals.matches],
    ["Minutes en club", fmt(totals.minutes)],
    ["Buts · PD", `${totals.goals} B · ${totals.assists} PD`],
    ["Stade de carrière", D.PLAYER.careerStage, true],
    [
      "Sélection",
      `${D.NATIONAL_CAREER.caps} sél. · ${D.NATIONAL_CAREER.goals} B`,
    ],
  ];
  return (
    <div className={s.kpiStrip}>
      {kpis.map(([label, value, accent]) => (
        <div key={label}>
          <span>{label}</span>
          <strong className={accent ? s.kpiAccent : undefined}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function MarketPanel({ wide = false }) {
  return (
    <Panel title="Marché et faisabilité" icon={Wallet}>
      <div
        className={s.market}
        style={
          wide
            ? { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }
            : undefined
        }
      >
        <div>
          <span>Estimation</span>
          <strong>
            {D.PLAYER.value} M€{" "}
            <Sparkline
              values={D.VALUE_HISTORY.map((point) => point.value)}
              width={64}
              height={20}
            />
          </strong>
          <small>
            Fourchette {D.MARKET.range[0]}–{D.MARKET.range[1]} M€ · +
            {fmt(D.PLAYER.valueTrend, 1)} % sur 6 mois
          </small>
        </div>
        <div>
          <span>Potentiel de revente</span>
          <strong>{D.MARKET.resale}</strong>
          <small>{D.MARKET.resaleNote}</small>
        </div>
        <div>
          <span>Continuité du temps de jeu</span>
          <strong>{D.MARKET.continuity} %</strong>
          <small>des minutes disponibles depuis 2024</small>
        </div>
        <div>
          <span>Pic de carrière attendu</span>
          <strong>{D.MARKET.peakAge}</strong>
          <small>Meilleure saison à ce jour : {D.MARKET.peakSeason}</small>
        </div>
        <div>
          <span>Clause et représentant</span>
          <strong>{D.PLAYER.releaseClause}</strong>
          <small>{D.PLAYER.agent}</small>
        </div>
        <div>
          <span>Intérêts signalés</span>
          <strong>{D.MARKET.interest.length} clubs</strong>
          <small>{D.MARKET.interest.join(", ")}</small>
        </div>
      </div>
    </Panel>
  );
}

function CareerMarket() {
  const availability = injuryTotals(D.INJURIES, D.PLAYER.season);
  return (
    <>
      <PanelHead
        title="Carrière et marché"
        text="Trajectoire, valeur et disponibilité"
      />
      <CareerKpis />
      <div className={s.cols2}>
        <Panel
          title="Progression de carrière"
          icon={TrendingUp}
          text={`${D.CAREER.length} saisons suivies`}
          body={false}
        >
          <div className={s.tableScroll}>
            <table className="data-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Saison</th>
                  <th>Club</th>
                  <th className={s.num}>MJ · min · B</th>
                  <th>Indice</th>
                </tr>
              </thead>
              <tbody>
                {D.CAREER.map((row) => {
                  const index = D.EVOLUTION.find(
                    (item) => item.season === row.season,
                  )?.index;
                  return (
                    <tr
                      key={row.season}
                      className={row.current ? s.highlight : undefined}
                    >
                      <th scope="row">{row.season}</th>
                      <td>
                        <span className={s.cell}>
                          <Crest src={row.crest} size={16} />
                          {row.club}
                        </span>
                      </td>
                      <td className={s.num}>
                        {row.matches} J · {fmt(row.minutes)}′ · {row.goals} B
                      </td>
                      <td>
                        <span className={s.inlineBar}>
                          <i style={{ width: `${index}%` }} />
                        </span>
                        <b style={{ color: "var(--ink-strong)" }}>{index}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <MarketPanel />
      </div>
      <div className={s.cols2even}>
        <Panel
          title="Valeur marchande"
          icon={Wallet}
          text="Estimation Vega, M€"
        >
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
        </Panel>
        <Panel
          title="Évolution de l’indice"
          icon={Activity}
          text="Indice Vega par saison"
        >
          <LineChart
            width={520}
            points={D.EVOLUTION.map((row) => ({
              x: row.season.replace(/^20/, ""),
              y: row.index,
            }))}
            domain={[50, 100]}
            ticks={[50, 75, 100]}
            ariaLabel="Indice Vega par saison"
          />
        </Panel>
      </div>
      <Panel
        title="Blessures et suspensions"
        icon={HeartPulse}
        text={`${availability.count} absences · ${availability.weeks} semaines · ${availability.missed} matchs manqués`}
        actions={
          <Legend
            items={[
              ["swatch", "Blessure", "var(--mq-neg-2)"],
              ["swatch", "Suspension", "var(--muted-light)"],
            ]}
          />
        }
      >
        <InjuryTimeline seasons={D.INJURY_SEASONS} injuries={D.INJURIES} />
      </Panel>
      <Panel
        title="Historique détaillé"
        icon={CalendarDays}
        text="Par saison, toutes compétitions"
        body={false}
      >
        <div className={s.tableScroll}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Saison</th>
                <th>Club</th>
                <th>Compétitions jouées</th>
                <th className={s.num}>Matchs</th>
                <th className={s.num}>Tit.</th>
                <th className={s.num}>Minutes</th>
                <th className={s.num}>Buts</th>
                <th className={s.num}>PD</th>
                <th className={s.num}>Cartons</th>
              </tr>
            </thead>
            <tbody>
              {D.CAREER.map((row) => (
                <tr key={row.season}>
                  <th scope="row">{row.season}</th>
                  <td>
                    <span className={s.cell}>
                      <Crest src={row.crest} size={16} />
                      {row.club}
                    </span>
                  </td>
                  <td>
                    <div className={s.chips}>
                      {row.competitions.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </td>
                  <td className={s.num}>{row.matches}</td>
                  <td className={s.num}>{row.starts}</td>
                  <td className={s.num}>{fmt(row.minutes)}</td>
                  <td className={s.num}>{row.goals}</td>
                  <td className={s.num}>{row.assists}</td>
                  <td className={s.num}>
                    {row.yellow ? `${row.yellow} J` : "—"}
                    {row.red ? ` · ${row.red} R` : ""}
                  </td>
                </tr>
              ))}
              {D.INJURIES.length > 0 && (
                <tr>
                  <td colSpan={9} className={s.muted}>
                    Dernière absence : {D.INJURIES[0].label.toLowerCase()} du{" "}
                    {dateFr(D.INJURIES[0].start)} au {dateFr(D.INJURIES[0].end)}
                    .
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* --------------------------------------------------------------- projection */

function Projection() {
  const [leagueId, setLeagueId] = useState("pl");
  const league = D.LEAGUES.find((item) => item.id === leagueId);
  const [club, setClub] = useState(league.clubs[0]);
  const current = D.LEAGUES.find((item) => item.current);
  const choose = (id) => {
    setLeagueId(id);
    setClub(D.LEAGUES.find((item) => item.id === id).clubs[0]);
  };
  const squad = [
    ...(D.SQUADS[club] || []).map(([name, index]) => ({ name, index })),
    { name: "Lamine Yamal (projeté)", index: league.index, self: true },
  ].sort((a, b) => b.index - a.index);
  return (
    <>
      <PanelHead
        title="Projection"
        text="Niveau estimé dans chaque championnat, ajustements et concurrence au poste · modèle fictif"
      />
      <Panel
        title="Matrice de projection"
        icon={Target}
        text="Cliquez sur une ligne"
        body={false}
      >
        <div className={s.tableScroll}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Championnat</th>
                <th>Coefficient</th>
                <th className={s.num}>Indice projeté</th>
                <th className={s.num}>Écart</th>
                <th className={s.num}>B + PD / 90</th>
                <th className={s.num}>Titularisation</th>
                <th>Ajustement principal</th>
              </tr>
            </thead>
            <tbody>
              {D.LEAGUES.map((item) => (
                <tr
                  key={item.id}
                  className={item.id === leagueId ? s.highlight : undefined}
                  onClick={() => choose(item.id)}
                  style={{ cursor: "pointer" }}
                >
                  <th scope="row">
                    <span className={s.cell}>
                      <Flag code={item.flag} />
                      {item.name}
                      {item.current && (
                        <span className={s.muted}>· actuel</span>
                      )}
                    </span>
                  </th>
                  <td>
                    <span className={s.inlineBar}>
                      <i style={{ width: `${item.strength}%` }} />
                    </span>
                    {item.strength}
                  </td>
                  <td className={`${s.num} ${s.best}`}>{item.index}</td>
                  <td className={`${s.num} ${s.muted}`}>
                    {item.current
                      ? "—"
                      : fmt(item.index - current.index, 0, { signed: true })}
                  </td>
                  <td className={s.num}>{fmt(item.ga90, 2)}</td>
                  <td className={s.num}>{item.start} %</td>
                  <td className={s.muted}>{item.adjustments[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className={s.cols2even}>
        <Panel title={`Projection · ${league.name}`} icon={Compass}>
          <div className={s.miniStats} style={{ marginBottom: 16 }}>
            <div>
              <span>Indice projeté</span>
              <strong>{league.index}</strong>
              <small>actuel {current.index}</small>
            </div>
            <div>
              <span>B + PD / 90</span>
              <strong>{fmt(league.ga90, 2)}</strong>
              <small>actuel {fmt(current.ga90, 2)}</small>
            </div>
            <div>
              <span>Titularisation</span>
              <strong>{league.start} %</strong>
            </div>
            <div>
              <span>Coefficient</span>
              <strong>{league.strength}</strong>
              <small>/ 100</small>
            </div>
          </div>
          <ul className={s.bullets}>
            {league.adjustments.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Concurrence au poste"
          icon={Users}
          body={false}
          actions={
            <select
              aria-label="Club cible"
              value={club}
              onChange={(event) => setClub(event.target.value)}
            >
              {league.clubs.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          }
        >
          <div className={s.tableScroll}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Ailiers droits · {club}</th>
                  <th>Indice</th>
                </tr>
              </thead>
              <tbody>
                {squad.map((row) => (
                  <tr
                    key={row.name}
                    className={row.self ? s.highlight : undefined}
                  >
                    <th scope="row" className={row.self ? s.best : undefined}>
                      {row.name}
                    </th>
                    <td>
                      <span className={s.inlineBar}>
                        <i style={{ width: `${row.index}%` }} />
                      </span>
                      <b style={{ color: "var(--ink-strong)" }}>{row.index}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
