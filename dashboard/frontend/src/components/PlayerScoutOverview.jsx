"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Segments, Skeleton } from "./UI.jsx";
import { useCardFold } from "./PhoneFold.jsx";
import {
  cohortTraits,
  rankMetric,
  roleAssessments,
  SCOUT_METRICS,
  similarPlayers,
} from "../services/scouting.js";
import { normalizeText } from "../services/format.js";
import { percentile } from "../services/player-profile.js";
import {
  aggregateSeason,
  contributionRate,
  seasonMetric,
} from "../services/season-player.js";
import { number } from "../services/format.js";
import { gradeTone, seasonGrade } from "../services/grades.js";
import { advancedMetric } from "./PlayerAdvancedStats.jsx";
import {
  fmt,
  LineChart,
  PercentileBadge,
  PercentileBar,
  PercentilePizza,
  RadarChart,
  SeriesLegend,
  TipBody,
  ToneLegend,
  toneClass,
} from "./PlayerScoutCharts.jsx";
import { PlayStyleCard } from "./PlayerStyleCards.jsx";
import { clubStyles as c } from "./ClubScoutUI.jsx";
import { Hint, Term } from "./Hint.jsx";
import { explain } from "../services/glossary.js";
import { seasonShort } from "../services/previous-season.js";
import usePreviousSeason from "../hooks/usePreviousSeason.js";
import { RankingTrigger } from "./RankingDialog.jsx";
import PlayerSwap from "./PlayerSwap.jsx";
import s from "./PlayerScout.module.css";

/** Metric families of mock-up C, filled with the PitchAPI indicators. */
export function scoutFamilies(group) {
  const families = [
    {
      id: "finishing",
      title: "Finition",
      keys: [
        "goals",
        "xg",
        "npxg",
        "xgot",
        "shots",
        "shotsOnTarget",
        "touchesBox",
      ],
    },
    {
      id: "creation",
      title: "Création",
      keys: ["assists", "xa", "chancesCreated", "bigChancesCreated"],
    },
    {
      id: "progression",
      title: "Progression",
      keys: ["dribbles", "passesFinalThird", "touches"],
    },
    {
      id: "passing",
      title: "Passe",
      keys: ["passesAccurate", "passesAttempted", "passAccuracy"],
    },
    {
      id: "defending",
      title: "Défense",
      keys: [
        "defensiveActions",
        "tackles",
        "interceptions",
        "recoveries",
        "duelsWon",
        "duelRate",
        "clearances",
        "blocks",
      ],
    },
    {
      id: "security",
      title: "Sécurité de balle",
      keys: ["duelsLost", "dispossessed", "wasFouled", "fouls"],
    },
  ];
  return group === "G"
    ? [
        { id: "keeper", title: "Gardien", keys: ["saves", "goalsPrevented"] },
        ...families,
      ]
    : families;
}

/** Pizza axes per position line, ordered by phase of play. */
const PIZZA_KEYS = {
  G: [
    "saves",
    "goalsPrevented",
    "passesAccurate",
    "passAccuracy",
    "touches",
    "recoveries",
    "clearances",
  ],
  D: [
    "chancesCreated",
    "passesFinalThird",
    "passesAccurate",
    "passAccuracy",
    "touches",
    "duelsWon",
    "duelRate",
    "tackles",
    "interceptions",
    "recoveries",
    "clearances",
    "blocks",
  ],
  M: [
    "goals",
    "xg",
    "chancesCreated",
    "passesFinalThird",
    "dribbles",
    "passesAccurate",
    "passAccuracy",
    "touches",
    "duelsWon",
    "tackles",
    "interceptions",
    "recoveries",
  ],
  O: [
    "goals",
    "xg",
    "shots",
    "shotsOnTarget",
    "touchesBox",
    "assists",
    "chancesCreated",
    "bigChancesCreated",
    "passesFinalThird",
    "dribbles",
    "duelsWon",
    "recoveries",
  ],
};
PIZZA_KEYS.F = PIZZA_KEYS.O;

const SHORT = {
  xg: "xG",
  shotsOnTarget: "Tirs cadrés",
  touchesBox: "Ballons dans la surface",
  bigChancesCreated: "Grosses occasions",
  passesFinalThird: "Passes dernier tiers",
  duelRate: "Duels gagnés %",
  goalsPrevented: "Buts évités",
};
const label = (key) => SHORT[key] || SCOUT_METRICS[key]?.label || key;
// A statistic's sentence: by its full name, else its short one, else its definition.
const metricHint = (key) =>
  explain(SCOUT_METRICS[key]?.label) || explain(label(key)) || SCOUT_METRICS[key]?.description || null;
const total = (profile, key) => {
  const stat = profile.stats?.[key];
  return stat?.count ? stat.sum : null;
};
/** A match's goals and assists in a grade tooltip: an unknown one is « — », never 0 (VI-23 stage 7, §16.3). */
const observed = (value) => (Number.isFinite(value) ? value : "—");
const goalsAndAssists = (row) =>
  `${observed(row.goals)} / ${observed(row.assists)}`;
const shortDate = (value) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString(
        "fr-FR",
        { day: "2-digit", month: "2-digit", timeZone: "UTC" },
      )
    : "—";

/** `fold`: on a phone the card shows closed, its heading alone (PhoneFold). */
function Card({ title, text, actions, children, fold = false }) {
  const f = useCardFold(fold, title);
  return (
    <section className={s.card} {...f.section}>
      <div className={s.cardHead} {...f.head}>
        <div>
          <h3>
            <Term>{title}</Term>
          </h3>
          {text && <p className={f.part || undefined}>{text}</p>}
        </div>
        {actions}
        {f.button}
      </div>
      {f.wrap(children)}
    </section>
  );
}

function Pending({ ready, children }) {
  return ready ? (
    children
  ) : (
    <Skeleton label="Chargement des joueurs du même poste…" lines={2} />
  );
}

/** The season's six figures, for every competition or the one picked in the bar. */
function SeasonKpis({ profile, season, scope }) {
  const subject = useMemo(
    () =>
      scope === "all"
        ? profile
        : aggregateSeason(
            profile.rows.filter((row) => row.league === scope),
            profile.id,
          ),
    [scope, profile],
  );
  const goals = total(subject, "goals");
  const assists = total(subject, "assists");
  const xg = seasonMetric(subject, "xg", "total");
  const xa = seasonMetric(subject, "xa", "total");
  // Only on goals and assists known on every match (VI-23 N9): an unknown one is no zero.
  const rate = contributionRate(subject);
  const partial = (metric) =>
    metric.count > 0 && metric.count < subject.matches ? " (partiel)" : "";
  const kpis = [
    [
      "Matchs",
      number(subject.matches),
      subject.knownStarts > 0
        ? `${number(subject.starts)} titularisations`
        : null,
    ],
    [
      "Minutes",
      number(subject.minutes),
      subject.matches
        ? `${number(subject.minutes / subject.matches)} min par match`
        : null,
    ],
    [
      "Buts",
      goals == null ? "—" : number(goals),
      xg.count ? `xG ${number(xg.value, 2)}${partial(xg)}` : null,
    ],
    [
      "Passes décisives",
      assists == null ? "—" : number(assists),
      xa.count ? `xA ${number(xa.value, 2)}${partial(xa)}` : null,
    ],
    [
      "Note Vega",
      subject.grade == null ? "—" : number(subject.grade, 0),
      subject.grade == null ? null : "sur 100",
    ],
    [
      "Min. par but ou PD",
      rate ? `${number(rate.minutes)}′` : "—",
      rate ? `${number(rate.count)} contributions` : null,
    ],
  ];
  return (
    <section className={s.block} aria-label={`Saison ${season}`}>
      <div className={s.kpis}>
        {kpis.map(([title, value, note]) => (
          <div className={s.kpi} key={title}>
            <span>
              <Term>{title}</Term>
            </span>
            <strong>{value}</strong>
            {note && <small>{note}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A family's score out of 100: the mean centile of its ranked indicators. */
function familyScores(target, cohorts, group) {
  return scoutFamilies(group).map((section) => {
    const centiles = section.keys
      .map((key) => {
        const definition = SCOUT_METRICS[key];
        if (!definition?.rankable) return null;
        const ranked = rankMetric(target, key, cohorts);
        if (ranked.percentile == null) return null;
        return definition.lowerIsBetter ? 100 - ranked.percentile : ranked.percentile;
      })
      .filter((value) => value != null);
    return {
      ...section,
      label: section.title,
      value: centiles.length
        ? Math.round(centiles.reduce((sum, value) => sum + value, 0) / centiles.length)
        : null,
    };
  });
}

/** `own`'s items with their rank among the same items of `others` (higher is better). */
function withRanks(own, others) {
  return own.map((item) => {
    if (item.value == null) return item;
    const values = others
      .map((list) => list.find((other) => other.id === item.id)?.value)
      .filter((value) => value != null);
    return {
      ...item,
      rank: 1 + values.filter((value) => value > item.value).length,
      of: values.length + 1,
    };
  });
}

/** The club card's phase bars, for a player's roles or skills: name, rank, bar, value. */
function RankedBars({ items }) {
  return (
    <div className={s.roleBars}>
      {items.map((item) => (
        <div className={s.roleBar} key={item.id}>
          <span>
            <Term>{item.label}</Term>
            <small>
              {item.rank
                ? `${item.rank === 1 ? "1er" : `${item.rank}e`} sur ${number(item.of)}`
                : "non classé"}
            </small>
          </span>
          {item.value == null ? <span /> : <PercentileBar value={Math.round(item.value)} />}
          <strong>{item.value == null ? "—" : Math.round(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

// Plain-language tags from the player's centiles at his position, like the club's
// style tags: a tag needs the indicator in his position's top fifth.
const STYLE_TAGS = [
  ["goals", "Marque beaucoup"],
  ["touchesBox", "Présent dans la surface"],
  ["shots", "Tente souvent sa chance"],
  ["shotsOnTarget", "Cadre ses tirs"],
  ["dribbles", "Dribbleur"],
  ["chancesCreated", "Crée des occasions"],
  ["passesFinalThird", "Fait avancer le jeu"],
  ["passAccuracy", "Passe sûre"],
  ["touches", "Très impliqué dans le jeu"],
  ["duelRate", "Gagne ses duels"],
  ["recoveries", "Récupérateur"],
  ["interceptions", "Lit les trajectoires"],
  ["tackles", "Tacleur"],
  ["clearances", "Solide dans sa surface"],
  ["saves", "Beaucoup d’arrêts"],
  ["goalsPrevented", "Évite des buts"],
];
export function playerStyleTags(metrics, limit = 6) {
  return STYLE_TAGS.map(([key, tag]) => ({ tag, percentile: metrics.get(key)?.percentile }))
    .filter((item) => item.percentile != null && item.percentile >= 80)
    .sort((a, b) => b.percentile - a.percentile)
    .slice(0, limit)
    .map((item) => item.tag);
}

function TraitList({ items, metrics }) {
  if (!items.length)
    return <p className={s.note}>Aucun indicateur classable.</p>;
  return (
    <ul className={s.traits}>
      {items.map((item) => {
        const metric = metrics.get(item.key);
        const percentile = metric?.percentile ?? item.percentile;
        return (
          <li key={item.key} className={toneClass(percentile)}>
            <span>
              <RankingTrigger target={{ type: "metric", key: item.key }}>
                {label(item.key)}
              </RankingTrigger>
              <Hint text={metricHint(item.key)} label={label(item.key)} />
            </span>
            <small>
              {fmt(item.value, metric?.decimals ?? 2, { unit: metric?.unit })}
              {metric?.unit ? "" : " /90"}
            </small>
            <PercentileBadge value={percentile} />
          </li>
        );
      })}
    </ul>
  );
}

const ordinalP = (value) => `P${Math.round(value)}`;

/** Plain-language summary written from the player's own figures. */
function ScoutReading({ profile, best, traits }) {
  const goals = seasonMetric(profile, "goals", "per90");
  const assists = seasonMetric(profile, "assists", "per90");
  // Only the rates the player's matches know (VI-23 N8): an unknown one is not a zero.
  const production = [
    goals.value != null && `${fmt(goals.value, 2)} but`,
    assists.value != null && `${fmt(assists.value, 2)} passe décisive`,
  ].filter(Boolean);
  const lines = [
    best &&
      `Meilleur rôle : ${best.label.toLowerCase()}, indice ${Math.round(best.value)} sur 100 face aux ${profile.role?.peers || "joueurs du même poste"}.`,
    traits.high.length > 0 &&
      `Points forts : ${traits.high
        .slice(0, 2)
        .map(
          (item) =>
            `${label(item.key).toLowerCase()} (${ordinalP(item.percentile)})`,
        )
        .join(" et ")}.`,
    production.length > 0 &&
      `Production : ${production.join(" et ")} par 90 min${profile.grade != null ? `, note Vega ${fmt(profile.grade, 0)} sur 100` : ""}.`,
    traits.low.length > 0 &&
      `Point de vigilance : ${label(traits.low[0].key).toLowerCase()} (${ordinalP(traits.low[0].percentile)}).`,
  ].filter(Boolean);
  if (!lines.length)
    return <p className={s.note}>Pas assez de données classées.</p>;
  return (
    <ul className={s.summary}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** Phones draw the narrow frame; a wider screen gives the chart its whole row. */
function useNarrow(query = "(max-width: 640px)") {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

function RecentForm({ profile, matches, onTab, wide = false }) {
  const narrow = useNarrow();
  const frame = wide && !narrow ? { width: 1000, height: 230 } : { width: 380, height: 210 };
  const index = useMemo(
    () => new Map((matches || []).map((match) => [match.id, match])),
    [matches],
  );
  const recent = [...profile.rows]
    .filter((row) => Number.isFinite(row.grade))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(-10);
  // The period's grade: the grade of its minutes-weighted mean z (grades.js).
  const average = seasonGrade(recent).grade ?? 50;
  const opponent = (row) => {
    const match = index.get(row.matchId);
    if (!match?.home || !match?.away) return row.league || "";
    const home = match.home.id === row.teamId;
    const other = home ? match.away : match.home;
    const score = [match.home.score, match.away.score].every(Number.isFinite)
      ? ` · ${match.home.score}-${match.away.score}`
      : "";
    return `${home ? "vs" : "à"} ${other.name}${score}`;
  };
  return (
    <Card
      title="Forme récente"
      text={`Note des ${recent.length} derniers matchs notés`}
      actions={
        onTab && (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => onTab("games")}
          >
            Tous les matchs
          </button>
        )
      }
    >
      {recent.length >= 2 ? (
        <LineChart
          width={frame.width}
          height={frame.height}
          points={recent.map((row) => ({
            x: shortDate(row.date),
            y: row.grade,
            row,
          }))}
          domain={[0, 100]}
          ticks={[25, 50, 75, 100]}
          labelEvery={2}
          format={(value) => fmt(value, 0)}
          reference={{ y: average, label: `Moy. ${fmt(average, 0)}` }}
          ariaLabel="Note des derniers matchs"
          tip={(point) => (
            <TipBody
              title={opponent(point.row) || shortDate(point.row.date)}
              rows={[
                ["Date", shortDate(point.row.date)],
                ["Note Vega", fmt(point.row.grade, 0)],
                ["Buts / PD", goalsAndAssists(point.row)],
                ["Minutes", point.row.minutes],
              ]}
            />
          )}
        />
      ) : (
        <p className={s.note}>Pas assez de matchs notés sur la période.</p>
      )}
    </Card>
  );
}

/** Version C overview: season figures, percentile profile, role indices,
 *  strengths and recent form, all from published appearances. */
export default function PlayerScoutOverview({
  profile,
  cohorts,
  ready,
  season,
  matches,
  comparisonRef,
  onTab,
  competition = "all",
}) {
  const group = profile.role?.group;
  const peers = cohorts.groups.get(group)?.profiles.length || 0;
  const metrics = useMemo(() => {
    const keys = new Set([
      ...(PIZZA_KEYS[group] || PIZZA_KEYS.O),
      ...scoutFamilies(group).flatMap((section) => section.keys),
    ]);
    const result = new Map();
    for (const key of keys) {
      const metric = advancedMetric(profile, key, cohorts);
      if (metric) result.set(key, metric);
    }
    return result;
  }, [profile, cohorts, group]);
  const pizza = (PIZZA_KEYS[group] || PIZZA_KEYS.O)
    .filter((key) => SCOUT_METRICS[key]?.rankable)
    .map((key) => {
      const ranked = metrics.get(key);
      const value = seasonMetric(profile, key, "per90").value;
      return {
        key,
        label: label(key),
        value: ranked?.value ?? value,
        percentile: ranked?.percentile ?? null,
        rank: ranked?.rank,
        peers: ranked?.peers,
        decimals: SCOUT_METRICS[key].unit ? 1 : 2,
        unit: SCOUT_METRICS[key].unit || "",
      };
    });
  // Each role index with the player's rank among the peers of his position.
  const roles = useMemo(() => {
    const own = roleAssessments(profile, cohorts);
    const others = (cohorts.groups.get(group)?.profiles || [])
      .filter((peer) => peer.id !== profile.id)
      .map((peer) => roleAssessments(peer, cohorts));
    return withRanks(own, others).sort(
      (a, b) => (b.value ?? -1) - (a.value ?? -1),
    );
  }, [profile, cohorts, group]);
  const best = roles.find((role) => role.value != null);
  // Each skill score with the player's rank among the peers of his position.
  const families = useMemo(() => {
    const own = familyScores(profile, cohorts, group);
    const others = (cohorts.groups.get(group)?.profiles || [])
      .filter((peer) => peer.id !== profile.id)
      .map((peer) => familyScores(peer, cohorts, group));
    return withRanks(own, others);
  }, [profile, cohorts, group]);
  const traits = cohortTraits(profile, cohorts);
  const tags = playerStyleTags(metrics);
  const enoughMinutes = profile.minutes >= cohorts.minMinutes;
  return (
    <div className={s.overview}>
      <SeasonKpis
        profile={profile}
        season={season}
        scope={competition}
      />
      <div className={s.block} ref={comparisonRef}>
        <Card
          title="Profil statistique"
          text={`Centiles par 90 min face aux ${profile.role?.peers || "joueurs du même poste"} des compétitions sélectionnées${ready && peers ? ` (${peers} joueurs, ${cohorts.minMinutes} min minimum)` : ""}.`}
        >
          <Pending ready={ready}>
            <div className={s.profileGrid}>
              <div>
                {enoughMinutes ? (
                  <>
                    <PercentilePizza items={pizza} cohort={peers} size={520} />
                    <ToneLegend />
                    <p className={s.note} style={{ marginTop: 8 }}>
                      Un tiret signale un indicateur non classé : il doit être
                      renseigné sur tous les matchs joués et partagé par au moins{" "}
                      {cohorts.minPeers} joueurs.
                    </p>
                  </>
                ) : (
                  <p className={s.note}>
                    {number(profile.minutes)} minutes jouées : les centiles
                    demandent au moins {cohorts.minMinutes} minutes.
                  </p>
                )}
              </div>
              <div className={s.profileSide}>
                <div>
                  <h4 className={s.subTitle}>Indice Vega par rôle</h4>
                  {best ? (
                    <RankedBars items={roles} />
                  ) : (
                    <p className={s.note}>
                      Aucun indice de rôle calculable sur cette période.
                    </p>
                  )}
                </div>
                <div>
                  <h4 className={s.subTitle}>Scores par compétence</h4>
                  {families.some((family) => family.value != null) ? (
                    <RankedBars items={families} />
                  ) : (
                    <p className={s.note}>
                      Aucun score de compétence calculable sur cette période.
                    </p>
                  )}
                </div>
              </div>
            </div>
            {(tags.length > 0 || onTab) && (
              <div className={s.profileTags}>
                <div className={c.tags}>
                  {tags.map((tag) => (
                    <span key={tag} className={c.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                {onTab && (
                  <button
                    type="button"
                    className={s.profileLink}
                    onClick={() => onTab("advanced")}
                  >
                    Voir les stats avancées →
                  </button>
                )}
              </div>
            )}
          </Pending>
        </Card>
      </div>
      <div className={`${s.block} ${s.grid4}`}>
        <Card title="Points forts" text="Centiles les plus élevés">
          <Pending ready={ready}>
            <TraitList items={traits.high} metrics={metrics} />
          </Pending>
        </Card>
        <Card title="Points faibles" text="Centiles les plus bas">
          <Pending ready={ready}>
            <TraitList items={traits.low} metrics={metrics} />
          </Pending>
        </Card>
        <Card
          title="Lecture du scout"
          text="Synthèse des chiffres de la période"
        >
          <Pending ready={ready}>
            <ScoutReading profile={profile} best={best} traits={traits} />
          </Pending>
        </Card>
        <PlayStyleCard id={profile.id} season={season} />
      </div>
      <div className={s.block}>
        <RecentForm profile={profile} matches={matches} onTab={onTab} wide />
      </div>
    </div>
  );
}

// The badge's shade by the grade's tail share of full matches (grades.js): 10 to 90.
const gradeShade = (grade) => [10, 30, 50, 70, 90][gradeTone(grade) - 1];

/** Version C match log: Vega grade curve and one row per published appearance. */
/**
 * The Matchs tab. « Par compétition » sums the profile's (finished) matches; the period's table and
 * its grade plot list `logRows`, every played observation (VI-23 stage 6, §15).
 */
export function PlayerGames({ profile, matches, logRows = profile.rows }) {
  const index = useMemo(
    () => new Map((matches || []).map((match) => [match.id, match])),
    [matches],
  );
  const rows = [...logRows].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const rated = [...rows]
    .reverse()
    .filter((row) => Number.isFinite(row.grade));
  const average = seasonGrade(rated).grade ?? 50;
  const opponent = (row) => {
    const match = index.get(row.matchId);
    if (!match?.home || !match?.away) return { name: "—" };
    const home = match.home.id === row.teamId;
    const other = home ? match.away : match.home;
    const own = home ? match.home : match.away;
    const scored = Number.isFinite(own.score) && Number.isFinite(other.score);
    return {
      name: other.name,
      venue: home ? "D" : "E",
      score: scored ? `${match.home.score}-${match.away.score}` : null,
      result: scored
        ? own.score > other.score
          ? "V"
          : own.score < other.score
            ? "D"
            : "N"
        : null,
    };
  };
  const cell = (row, key, decimals = 0) =>
    Number.isFinite(row[key]) ? fmt(row[key], decimals) : "—";
  const competitions = [
    ...new Set(profile.rows.map((row) => row.league).filter(Boolean)),
  ]
    .map((name) => ({
      name,
      split: aggregateSeason(
        profile.rows.filter((row) => row.league === name),
        profile.id,
      ),
    }))
    .sort((a, b) => b.split.minutes - a.split.minutes);
  const sum = (split, key, decimals = 0) => {
    const metric = seasonMetric(split, key, "total");
    return metric.count ? fmt(metric.value, decimals) : "—";
  };
  return (
    <div className={s.overview}>
      <div className={`${s.block} ${s.tableCard}`}>
        <div className={s.tableHead}>
          <h3>Par compétition</h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th><Term>Compétition</Term></th>
                <th className={s.num}><Term>MJ</Term></th>
                <th className={s.num}><Term>Min</Term></th>
                <th className={s.num}><Term>Buts</Term></th>
                <th className={s.num}><Term>PD</Term></th>
                <th className={s.num}><Term>xG</Term></th>
                <th className={s.num}><Term>xA</Term></th>
                <th className={s.num}><Term>Min / B+PD</Term></th>
                <th className={s.num}><Term>Note Vega</Term></th>
              </tr>
            </thead>
            <tbody>
              {competitions.map(({ name, split }) => {
                const rate = contributionRate(split);
                return (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td className={s.num}>{number(split.matches)}</td>
                    <td className={s.num}>{number(split.minutes)}</td>
                    <td className={s.num}>{sum(split, "goals")}</td>
                    <td className={s.num}>{sum(split, "assists")}</td>
                    <td className={s.num}>{sum(split, "xg", 2)}</td>
                    <td className={s.num}>{sum(split, "xa", 2)}</td>
                    <td className={s.num}>
                      {rate ? `${number(rate.minutes)}′` : "—"}
                    </td>
                    <td className={s.num}>
                      {split.grade == null ? "—" : fmt(split.grade, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className={s.block}>
        <Card
          title="Note par match"
          text={`${rated.length} matchs notés · pointillés : moyenne de la période`}
        >
          {rated.length >= 2 ? (
            <LineChart
              width={900}
              height={200}
              points={rated.map((row) => ({
                x: shortDate(row.date),
                y: row.grade,
                row,
              }))}
              domain={[0, 100]}
              ticks={[25, 50, 75, 100]}
              labelEvery={Math.max(1, Math.ceil(rated.length / 15))}
              reference={{ y: average, label: `Moyenne ${fmt(average, 0)}` }}
              ariaLabel="Note par match"
              tip={(point) => (
                <TipBody
                  title={`${opponent(point.row).name} · ${shortDate(point.row.date)}`}
                  rows={[
                    ["Compétition", point.row.league || "—"],
                    ["Note Vega", fmt(point.row.grade, 0)],
                    ["Buts / PD", goalsAndAssists(point.row)],
                  ]}
                />
              )}
            />
          ) : (
            <p className={s.note}>Pas assez de matchs notés sur la période.</p>
          )}
        </Card>
      </div>
      <div className={`${s.block} ${s.tableCard}`}>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">Matchs de la période</caption>
            <thead>
              <tr>
                <th><Term>Date</Term></th>
                <th><Term>Compétition</Term></th>
                <th><Term>Adversaire</Term></th>
                <th><Term>Résultat</Term></th>
                <th className={s.num}><Term>Min</Term></th>
                <th className={s.num}><Term>B</Term></th>
                <th className={s.num}><Term>PD</Term></th>
                <th className={s.num}><Term>xG</Term></th>
                <th className={s.num}><Term>xA</Term></th>
                <th className={s.num}><Term>Tirs</Term></th>
                <th className={s.num}><Term>Dribbles</Term></th>
                <th className={s.num}><Term>Note Vega</Term></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const other = opponent(row);
                return (
                  <tr key={row.matchId}>
                    <td>{shortDate(row.date)}</td>
                    <td>{row.league || "—"}</td>
                    <td>
                      {other.venue && (
                        <span style={{ color: "var(--muted)" }}>
                          {other.venue === "D" ? "vs " : "à "}
                        </span>
                      )}
                      {other.name}
                    </td>
                    <td>
                      {other.score ? `${other.result} · ${other.score}` : "—"}
                    </td>
                    <td className={s.num}>{row.minutes}′</td>
                    <td className={s.num}>{cell(row, "goals")}</td>
                    <td className={s.num}>{cell(row, "assists")}</td>
                    <td className={s.num}>{cell(row, "xg", 2)}</td>
                    <td className={s.num}>{cell(row, "xa", 2)}</td>
                    <td className={s.num}>{cell(row, "shots")}</td>
                    <td className={s.num}>{cell(row, "dribbles")}</td>
                    <td className={s.num}>
                      {Number.isFinite(row.grade) ? (
                        <PercentileBadge
                          value={gradeShade(row.grade)}
                          label={fmt(row.grade, 0)}
                          title={`Note Vega ${fmt(row.grade, 0)} sur 100`}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const MODE_LABELS = {
  total: "Total",
  per90: "Par 90 ou %",
  perMatch: "Par match ou %",
};

/** Version C statistics: one table per family with value, median, a
 *  percentile bar, the percentile and the rank in the position cohort. */
export function PlayerScoutStats({ profile, cohorts, mode, ready }) {
  const group = profile.role?.group;
  const sections = scoutFamilies(group);
  if (!ready)
    return (
      <Skeleton label="Chargement des joueurs du même poste…" lines={2} />
    );
  return (
    <div className={s.overview}>
      <div className={s.block}>
        <ToneLegend />
      </div>
      {sections.map((section) => {
        const rows = section.keys.filter((key) => SCOUT_METRICS[key]);
        const ranked = rows
          .map((key) => advancedMetric(profile, key, cohorts))
          .filter(Boolean);
        const average = ranked.length
          ? Math.round(
              ranked.reduce((sum, item) => sum + item.percentile, 0) /
                ranked.length,
            )
          : null;
        return (
          <section className={s.block} key={section.id}>
            <div className={s.sectionHead}>
              <h2>{section.title}</h2>
              <p>
                {average == null ? "Non classé" : `Centile moyen ${average}`}
              </p>
            </div>
            <div className={s.tableCard}>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th><Term>Indicateur</Term></th>
                      <th className={s.num}>{MODE_LABELS[mode]}</th>
                      <th className={s.num}><Term>Médiane / 90</Term></th>
                      <th><Term>Position dans la cohorte</Term></th>
                      <th className={s.num}><Term>Centile</Term></th>
                      <th className={s.num}><Term>Rang</Term></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((key) => {
                      const definition = SCOUT_METRICS[key];
                      const metric = advancedMetric(profile, key, cohorts);
                      const value = seasonMetric(profile, key, mode).value;
                      const decimals =
                        mode === "total" && !definition.ratio
                          ? definition.decimals || 0
                          : definition.unit
                            ? 1
                            : 2;
                      return (
                        <tr key={key}>
                          <th scope="row">
                            {metric ? (
                              <RankingTrigger target={{ type: "metric", key }}>
                                {label(key)}
                              </RankingTrigger>
                            ) : (
                              label(key)
                            )}
                            <Hint text={metricHint(key)} label={label(key)} />
                            {definition.lowerIsBetter && (
                              <span style={{ color: "var(--muted)" }}>
                                {" "}
                                · moins = mieux
                              </span>
                            )}
                          </th>
                          <td className={s.num}>
                            {fmt(value, decimals, {
                              unit: definition.unit || "",
                            })}
                          </td>
                          <td
                            className={s.num}
                            style={{ color: "var(--muted)" }}
                          >
                            {metric
                              ? fmt(metric.dist[2], metric.decimals, {
                                  unit: metric.unit,
                                })
                              : "—"}
                          </td>
                          <td className={s.barCell}>
                            {metric ? (
                              <PercentileBar value={metric.percentile} />
                            ) : (
                              <span style={{ color: "var(--muted-light)" }}>
                                Non classé
                              </span>
                            )}
                          </td>
                          <td className={s.num}>
                            {metric ? (
                              <PercentileBadge
                                value={metric.percentile}
                                label={String(metric.percentile)}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={s.num}>
                            {metric ? (
                              <>
                                {metric.rank === 1 ? "1er" : `${metric.rank}e`}
                                <span style={{ color: "var(--muted-light)" }}>
                                  {" "}
                                  / {metric.peers}
                                </span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

const SERIES = [
  "var(--mq-series-1)",
  "var(--mq-series-2)",
  "var(--mq-series-3)",
];
const COMPARE_VIEWS = [
  ["radar", "Radar"],
  ["table", "Côte à côte"],
];

/** Version C comparison: automatic comparisons, up to two peers from the
 *  position cohort, then a radar or a side-by-side table. */
export function PlayerScoutCompare({ profile, cohorts, ready }) {
  const group = profile.role?.group;
  const peers = cohorts.groups.get(group)?.profiles || [];
  const suggestions = useMemo(
    () => similarPlayers(profile, cohorts, 6).map((item) => item.profile),
    [profile, cohorts],
  );
  const [chosen, setChosen] = useState(null);
  const [autoId, setAutoId] = useState(null);
  const [view, setView] = useState("radar");
  const [search, setSearch] = useState("");
  const keys = (PIZZA_KEYS[group] || PIZZA_KEYS.O).filter(
    (key) => advancedMetric(profile, key, cohorts) != null,
  );
  const percentiles = (player) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        advancedMetric(player, key, cohorts)?.percentile ?? null,
      ]),
    );
  const base = percentiles(profile);
  // His previous season, read once asked for: same group, competitions and minutes floor.
  const previous = usePreviousSeason({
    profile,
    group,
    keys,
    minMinutes: cohorts.minMinutes,
    enabled: autoId === "previous",
    percentileOf: (player, key, pool) => advancedMetric(player, key, pool)?.percentile ?? null,
  });
  const before = previous.result;
  // Second competition by minutes: the player's own season there.
  const competition = useMemo(() => {
    const minutes = new Map();
    for (const row of profile.rows)
      if (row.league)
        minutes.set(row.league, (minutes.get(row.league) || 0) + row.minutes);
    const name = [...minutes].sort((a, b) => b[1] - a[1])[1]?.[0];
    if (!name) return null;
    const split = aggregateSeason(
      profile.rows.filter((row) => row.league === name),
      profile.id,
    );
    const pool = (key) => cohorts.groups.get(group)?.distributions[key];
    // A single competition rarely reaches the cohort's minutes floor: rank
    // its per-90 values directly against the same distribution.
    const values = Object.fromEntries(
      keys.map((key) => {
        const metric = seasonMetric(split, key, "per90");
        const values = pool(key);
        if (
          !values?.length ||
          metric.value == null ||
          metric.count !== split.matches
        )
          return [key, null];
        const p = percentile(values, metric.value);
        return [key, SCOUT_METRICS[key].lowerIsBetter ? 100 - p : p];
      }),
    );
    return { name, profile: split, values };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, cohorts, group, keys.join()]);
  const autos = [
    previous.season && {
      id: "previous",
      label: "Saison précédente",
      detail: before?.profile
        ? `${seasonShort(previous.season)} · ${number(before.profile.matches)} matchs · ${number(before.profile.minutes)} min${before.enough ? "" : ` · moins de ${number(cohorts.minMinutes)} min, non classé`}`
        : autoId !== "previous"
          ? seasonShort(previous.season)
          : previous.error
            ? "Saison précédente indisponible"
            : before?.missing
              ? `${seasonShort(previous.season)} · absent de ces compétitions à ce poste`
              : "Chargement…",
      name: `${profile.name} · ${seasonShort(previous.season)}`,
      values: before?.profile && before.enough ? before.values : {},
    },
    {
      id: "median",
      label: "Joueur médian",
      detail: profile.role?.peers || "Même poste",
      name: "Joueur médian du poste",
      dashed: true,
      values: Object.fromEntries(keys.map((key) => [key, 50])),
    },
    competition && {
      id: "competition",
      label: `Sa saison en ${competition.name}`,
      detail: `${number(competition.profile.matches)} matchs · ${number(competition.profile.minutes)} min${competition.profile.minutes < cohorts.minMinutes ? " · petit échantillon" : ""}`,
      name: `${profile.name} · ${competition.name}`,
      values: competition.values,
    },
  ].filter(Boolean);
  const auto = autos.find((item) => item.id === autoId);
  const limit = auto ? 1 : 2;
  const selected = (chosen ?? suggestions.slice(0, 1).map((p) => p.id))
    .map((id) => peers.find((item) => item.id === id))
    .filter(Boolean)
    .slice(0, limit);
  const ids = selected.map((item) => item.id);
  const needle = normalizeText(search).trim();
  const matches =
    needle.length >= 2
      ? peers
          .filter(
            (item) =>
              item.id !== profile.id &&
              !ids.includes(item.id) &&
              normalizeText(item.name).includes(needle),
          )
          .slice(0, 6)
      : [];
  const columns = [
    {
      id: profile.id,
      name: profile.name,
      sub: `${profile.teams.join(" · ")} · ${number(profile.minutes)} min · joueur de base`,
      values: base,
    },
    ...(auto
      ? [
          {
            id: auto.id,
            name: auto.name,
            sub: auto.detail,
            values: auto.values,
            dashed: auto.dashed,
            onRemove: () => setAutoId(null),
          },
        ]
      : []),
    ...selected.map((player) => ({
      id: player.id,
      name: player.name,
      sub: `${player.teams.join(" · ")} · ${number(player.minutes)} min`,
      values: percentiles(player),
      onRemove: () => setChosen(ids.filter((value) => value !== player.id)),
    })),
  ].map((column, index) => ({ ...column, color: SERIES[index] }));
  // The radar only plots axes ranked for every column: an unranked metric
  // must not read as a zero.
  const shared = keys.filter((key) =>
    columns.every((column) => column.values[key] != null),
  );
  const series = columns.map((column) => ({
    name: column.name,
    color: column.color,
    dashed: column.dashed,
    values: Object.fromEntries(shared.map((key) => [key, column.values[key]])),
  }));
  if (!ready)
    return (
      <Skeleton label="Chargement des joueurs du même poste…" lines={2} />
    );
  return (
    <div className={s.overview}>
      <div className={s.viewSwitch}>
        <Segments
          label="Affichage de la comparaison"
          value={view}
          onChange={setView}
          items={COMPARE_VIEWS}
        />
        <p>
          {view === "radar"
            ? "Superposition de trois profils au maximum"
            : `Centiles par 90 min face aux ${peers.length} ${profile.role?.peers || "joueurs du même poste"}`}
        </p>
      </div>
      <section className={s.block}>
        <div className={s.sectionHead}>
          <div>
            <h2>Comparaisons automatiques</h2>
            <p>Un clic remplace le premier joueur comparé</p>
          </div>
        </div>
        <div className={s.autoGrid}>
          {autos.map((item) => (
            <button
              type="button"
              key={item.id}
              className={s.autoButton}
              aria-pressed={autoId === item.id}
              onClick={() => setAutoId(autoId === item.id ? null : item.id)}
            >
              <span>
                {item.label}
              </span>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>
      </section>
      <section className={s.block}>
        <div className={s.sectionHead}>
          <div>
            <h2>Joueurs comparés</h2>
            <p>Jusqu’à trois profils</p>
          </div>
        </div>
        <div className={s.slots}>
          {columns.map((column) => (
            <div
              className={s.slot}
              key={column.id}
              style={{ "--tone": column.color }}
            >
              <div>
                <strong>
                  {column.name}
                </strong>
                <small>{column.sub}</small>
              </div>
              {column.onRemove && (
                <button
                  type="button"
                  className="button button-ghost"
                  aria-label={`Retirer ${column.name}`}
                  onClick={column.onRemove}
                >
                  Retirer
                </button>
              )}
            </div>
          ))}
          {columns.length < 3 && (
            <div className={s.slotSearch}>
              <input
                type="search"
                aria-label="Rechercher un joueur à comparer"
                placeholder="Ajouter un joueur du même poste…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className={s.quickPicks}>
                {(matches.length
                  ? matches
                  : suggestions.filter((item) => !ids.includes(item.id))
                )
                  .slice(0, 5)
                  .map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setChosen([...ids, item.id]);
                        setSearch("");
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
              </div>
              {!matches.length && needle.length < 2 && (
                <p className={s.note}>Profils proches suggérés</p>
              )}
            </div>
          )}
        </div>
      </section>
      <PlayerSwap player={profile} others={selected} />
      {keys.length < 3 ? (
        <p className={`${s.block} ${s.note}`}>
          Pas assez d’indicateurs classés pour comparer ce joueur.
        </p>
      ) : view === "radar" ? (
        <section className={`${s.block} ${s.grid2}`}>
          <Card
            title="Radar de centiles"
            text={`${shared.length} indicateurs classés pour tous les profils comparés`}
          >
            {shared.length >= 3 ? (
              <>
                <RadarChart
                  axes={shared.map((key) => ({ key, label: label(key) }))}
                  series={series}
                  showValues={false}
                  size={460}
                />
                <SeriesLegend series={series} />
              </>
            ) : (
              <p className={s.note}>
                Moins de trois indicateurs sont classés pour tous ces profils :
                comparez-les côte à côte.
              </p>
            )}
          </Card>
          <PercentileTable columns={columns} keys={keys} />
        </section>
      ) : (
        <SideBySide profile={profile} cohorts={cohorts} columns={columns} />
      )}
    </div>
  );
}

function bestOf(values) {
  const known = values.filter((value) => value != null);
  return known.length ? Math.max(...known) : null;
}

function PercentileTable({ columns, keys }) {
  return (
    <div className={`${s.tableCard} ${s.fillTable}`}>
      <div className="table-scroll">
        <table className="data-table" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              <th><Term>Indicateur</Term></th>
              {columns.map((column) => (
                <th key={column.id} className={s.num}>
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const values = columns.map((column) => column.values[key]);
              const best = bestOf(values);
              return (
                <tr key={key}>
                  <th scope="row">
                    {label(key)}
                    <Hint text={metricHint(key)} label={label(key)} />
                  </th>
                  {values.map((value, index) => (
                    <td
                      key={columns[index].id}
                      className={s.num}
                      style={
                        value != null && value === best
                          ? { color: "var(--ink-strong)", fontWeight: 700 }
                          : undefined
                      }
                    >
                      {value ?? "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** « Côte à côte »: every family of indicators, one column per profile. */
function SideBySide({ profile, cohorts, columns }) {
  const families = scoutFamilies(profile.role?.group)
    .map((family) => ({
      ...family,
      keys: family.keys.filter((key) =>
        columns.some((column) => column.values[key] != null),
      ),
    }))
    .filter((family) => family.keys.length);
  const averages = columns.map((column) => {
    const known = Object.values(column.values).filter((v) => v != null);
    return known.length
      ? Math.round(known.reduce((sum, v) => sum + v, 0) / known.length)
      : null;
  });
  const best = bestOf(averages);
  return (
    <section className={`${s.block} ${s.tableCard}`}>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th><Term>Indicateur</Term></th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={s.num}
                  style={{ "--tone": column.color }}
                >
                  <div className={s.compareHead}>
                    <strong>
                      {column.name}
                    </strong>
                    <small>{column.sub}</small>
                    <i />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          {families.map((family) => (
            <tbody key={family.id}>
              <tr className={s.groupRow}>
                <th colSpan={columns.length + 1}>{family.title}</th>
              </tr>
              {family.keys.map((key) => {
                const values = columns.map((column) => column.values[key]);
                const top = bestOf(values);
                const own = advancedMetric(profile, key, cohorts);
                return (
                  <tr key={key}>
                    <th scope="row">
                    {label(key)}
                    <Hint text={metricHint(key)} label={label(key)} />
                  </th>
                    {values.map((value, index) => (
                      <td key={columns[index].id} className={s.num}>
                        <span className={s.compareCell}>
                          {index === 0 && own && (
                            <small>
                              {fmt(own.value, own.decimals, { unit: own.unit })}
                            </small>
                          )}
                          {value == null ? (
                            "—"
                          ) : (
                            <span
                              className={
                                value === top ? s.bestBadge : undefined
                              }
                            >
                              <PercentileBadge
                                value={value}
                                label={String(value)}
                              />
                            </span>
                          )}
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
              <th scope="row"><Term>Moyenne des centiles</Term></th>
              {averages.map((value, index) => (
                <td
                  key={columns[index].id}
                  className={s.num}
                  style={
                    value != null && value === best
                      ? { color: "var(--ink-strong)", fontWeight: 700 }
                      : undefined
                  }
                >
                  {value ?? "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
