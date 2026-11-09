"use client";
import React, { useMemo, useState } from "react";
import { Segments } from "./UI.jsx";
import {
  cohortTraits,
  roleAssessments,
  SCOUT_METRICS,
  similarPlayers,
} from "../services/scouting.js";
import { normalizeText } from "../services/format.js";
import { percentile } from "../services/player-profile.js";
import { aggregateSeason, seasonMetric } from "../services/season-player.js";
import { number } from "../services/format.js";
import { advancedMetric } from "./PlayerAdvancedStats.jsx";
import {
  fmt,
  Gauge,
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
import {
  FAKE_SECURITY_ROWS,
  FakeBadge,
  fakePreviousSeason,
  PlayStyleCard,
  TeamContextCard,
} from "./PlayerScoutDemo.jsx";
import { RankingTrigger } from "./RankingDialog.jsx";
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
    // PitchAPI has no fouls or ball losses per player: those rows are fake.
    {
      id: "security",
      title: "Sécurité de balle",
      keys: ["duelsLost"],
      fake: FAKE_SECURITY_ROWS,
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
const total = (profile, key) => {
  const stat = profile.stats?.[key];
  return stat?.count ? stat.sum : null;
};
const shortDate = (value) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString(
        "fr-FR",
        { day: "2-digit", month: "2-digit", timeZone: "UTC" },
      )
    : "—";

function Card({ title, text, actions, children }) {
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <div>
          <h3>{title}</h3>
          {text && <p>{text}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Pending({ ready, children }) {
  return ready ? (
    children
  ) : (
    <p className={s.note} role="status">
      Chargement des joueurs du même poste…
    </p>
  );
}

function SeasonKpis({ profile, season, scope, onScope }) {
  const competitions = useMemo(() => {
    const names = new Map();
    for (const row of profile.rows)
      if (row.league) names.set(row.league, (names.get(row.league) || 0) + 1);
    return [...names].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [profile.rows]);
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
  const contributions = (goals ?? 0) + (assists ?? 0);
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
      "Note moyenne",
      subject.rating == null ? "—" : number(subject.rating, 2),
      subject.rating == null ? null : "sur 10",
    ],
    [
      "Min. par but ou PD",
      contributions ? `${number(subject.minutes / contributions)}′` : "—",
      contributions ? `${number(contributions)} contributions` : null,
    ],
  ];
  return (
    <section className={s.block}>
      <div className={s.sectionHead}>
        <div>
          <h2>Saison {season}</h2>
          <p>{profile.teams.join(" · ")}</p>
        </div>
        {competitions.length > 1 && (
          <Segments
            label="Compétition"
            value={scope}
            onChange={onScope}
            items={[
              ["all", "Toutes"],
              ...competitions.slice(0, 4).map((name) => [name, name]),
            ]}
          />
        )}
      </div>
      <div className={s.kpis}>
        {kpis.map(([title, value, note]) => (
          <div className={s.kpi} key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            {note && <small>{note}</small>}
          </div>
        ))}
      </div>
    </section>
  );
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
    (goals.count > 0 || assists.count > 0) &&
      `Production : ${fmt(goals.value ?? 0, 2)} but et ${fmt(assists.value ?? 0, 2)} passe décisive par 90 min${profile.rating != null ? `, note moyenne ${fmt(profile.rating, 2)}` : ""}.`,
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

function RecentForm({ profile, matches, onTab }) {
  const index = useMemo(
    () => new Map((matches || []).map((match) => [match.id, match])),
    [matches],
  );
  const recent = [...profile.rows]
    .filter((row) => Number.isFinite(row.rating))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(-10);
  const average =
    recent.reduce((sum, row) => sum + row.rating, 0) / (recent.length || 1);
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
          width={380}
          height={210}
          points={recent.map((row) => ({
            x: shortDate(row.date),
            y: row.rating,
            row,
          }))}
          domain={[
            Math.min(5, Math.floor(Math.min(...recent.map((r) => r.rating)))),
            10,
          ]}
          ticks={[6, 7, 8, 9, 10]}
          labelEvery={2}
          format={(value) => fmt(value, value % 1 ? 1 : 0)}
          reference={{ y: average, label: `Moy. ${fmt(average, 2)}` }}
          ariaLabel="Note des derniers matchs"
          tip={(point) => (
            <TipBody
              title={opponent(point.row) || shortDate(point.row.date)}
              rows={[
                ["Date", shortDate(point.row.date)],
                ["Note", fmt(point.row.rating, 1)],
                [
                  "Buts / PD",
                  `${point.row.goals ?? 0} / ${point.row.assists ?? 0}`,
                ],
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
  team,
  competition = "all",
  onCompetition,
  children,
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
  const roles = roleAssessments(profile, cohorts).sort(
    (a, b) => (b.value ?? -1) - (a.value ?? -1),
  );
  const best = roles.find((role) => role.value != null);
  const families = scoutFamilies(group).map((section) => {
    const ranked = section.keys.map((key) => metrics.get(key)).filter(Boolean);
    return {
      ...section,
      value: ranked.length
        ? Math.round(
            ranked.reduce((sum, item) => sum + item.percentile, 0) /
              ranked.length,
          )
        : null,
    };
  });
  const traits = cohortTraits(profile, cohorts);
  const enoughMinutes = profile.minutes >= cohorts.minMinutes;
  return (
    <div className={s.overview}>
      <SeasonKpis
        profile={profile}
        season={season}
        scope={competition}
        onScope={onCompetition}
      />
      <div className={`${s.block} ${s.grid2}`} ref={comparisonRef}>
        <Card
          title="Profil statistique"
          text={`Centiles par 90 min face aux ${profile.role?.peers || "joueurs du même poste"} des compétitions sélectionnées${ready && peers ? ` (${peers} joueurs, ${cohorts.minMinutes} min minimum)` : ""}.`}
        >
          <Pending ready={ready}>
            {enoughMinutes ? (
              <>
                <div className={s.pizzaWrap}>
                  <PercentilePizza items={pizza} cohort={peers} />
                </div>
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
          </Pending>
        </Card>
        <div className={s.stack}>
          <Card
            title="Indice Vega par rôle"
            text="Moyenne des centiles des indicateurs de chaque rôle, sur 100."
          >
            <Pending ready={ready}>
              {best ? (
                <div className={s.gaugeRow}>
                  <Gauge value={Math.round(best.value)} label={best.label} />
                  <ul className={s.roles}>
                    {roles.map((role) => (
                      <li key={role.id}>
                        <span>{role.label}</span>
                        <b>
                          {role.value == null ? "—" : Math.round(role.value)}
                        </b>
                        <div>
                          <PercentileBar
                            value={
                              role.value == null ? 0 : Math.round(role.value)
                            }
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className={s.note}>
                  Aucun indice de rôle calculable sur cette période.
                </p>
              )}
            </Pending>
          </Card>
          <Card
            title="Scores par compétence"
            text="Synthèse sur 100 des indicateurs classés de chaque famille."
          >
            <Pending ready={ready}>
              <div className={s.skills}>
                {families.map((family) => (
                  <div className={s.skill} key={family.id}>
                    <span>{family.title}</span>
                    <strong>{family.value ?? "—"}</strong>
                    <PercentileBar value={family.value ?? 0} />
                  </div>
                ))}
              </div>
            </Pending>
          </Card>
        </div>
      </div>
      <div className={`${s.block} ${s.grid3}`}>
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
      </div>
      <div className={`${s.block} ${s.grid3}`}>
        <RecentForm profile={profile} matches={matches} onTab={onTab} />
        <PlayStyleCard />
        <TeamContextCard team={team} />
      </div>
      {children}
    </div>
  );
}

const ratingTone = (rating) =>
  rating >= 9
    ? 90
    : rating >= 8
      ? 70
      : rating >= 7
        ? 50
        : rating >= 6
          ? 30
          : 10;

/** Version C match log: rating curve and one row per published appearance. */
export function PlayerGames({ profile, matches }) {
  const index = useMemo(
    () => new Map((matches || []).map((match) => [match.id, match])),
    [matches],
  );
  const rows = [...profile.rows].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const rated = [...rows]
    .reverse()
    .filter((row) => Number.isFinite(row.rating));
  const average =
    rated.reduce((sum, row) => sum + row.rating, 0) / (rated.length || 1);
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
              {competitions.map(({ name, split }) => {
                const contributions =
                  (total(split, "goals") ?? 0) + (total(split, "assists") ?? 0);
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
                      {contributions
                        ? `${number(split.minutes / contributions)}′`
                        : "—"}
                    </td>
                    <td className={s.num}>
                      {split.rating == null ? "—" : fmt(split.rating, 2)}
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
                y: row.rating,
                row,
              }))}
              domain={[
                Math.min(
                  5,
                  Math.floor(Math.min(...rated.map((r) => r.rating))),
                ),
                10,
              ]}
              ticks={[6, 7, 8, 9, 10]}
              labelEvery={Math.max(1, Math.ceil(rated.length / 15))}
              reference={{ y: average, label: `Moyenne ${fmt(average, 2)}` }}
              ariaLabel="Note par match"
              tip={(point) => (
                <TipBody
                  title={`${opponent(point.row).name} · ${shortDate(point.row.date)}`}
                  rows={[
                    ["Compétition", point.row.league || "—"],
                    ["Note", fmt(point.row.rating, 1)],
                    [
                      "Buts / PD",
                      `${point.row.goals ?? 0} / ${point.row.assists ?? 0}`,
                    ],
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
                      {Number.isFinite(row.rating) ? (
                        <PercentileBadge
                          value={ratingTone(row.rating)}
                          label={fmt(row.rating, 1)}
                          title={`Note ${fmt(row.rating, 1)} sur 10`}
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
  const size = cohorts.groups.get(group)?.profiles.length || 0;
  if (!ready)
    return (
      <p className={s.note} role="status">
        Chargement des joueurs du même poste…
      </p>
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
                      <th>Indicateur</th>
                      <th className={s.num}>{MODE_LABELS[mode]}</th>
                      <th className={s.num}>Médiane / 90</th>
                      <th>Position dans la cohorte</th>
                      <th className={s.num}>Centile</th>
                      <th className={s.num}>Rang</th>
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
                    {(section.fake || []).map((metric) => (
                      <tr key={metric.key}>
                        <th scope="row">
                          {metric.label}
                          {metric.inverted && (
                            <span style={{ color: "var(--muted)" }}>
                              {" "}
                              · moins = mieux
                            </span>
                          )}{" "}
                          <FakeBadge short />
                        </th>
                        <td className={s.num}>
                          {fmt(
                            mode === "total"
                              ? (metric.value * profile.minutes) / 90
                              : mode === "perMatch"
                                ? (metric.value * profile.minutes) /
                                  90 /
                                  profile.matches
                                : metric.value,
                            mode === "per90" ? metric.decimals : 1,
                          )}
                        </td>
                        <td className={s.num} style={{ color: "var(--muted)" }}>
                          {fmt(metric.dist[2], metric.decimals)}
                        </td>
                        <td className={s.barCell}>
                          <PercentileBar value={metric.percentile} />
                        </td>
                        <td className={s.num}>
                          <PercentileBadge
                            value={metric.percentile}
                            label={String(metric.percentile)}
                          />
                        </td>
                        <td className={s.num}>
                          {Math.max(
                            1,
                            Math.round(
                              ((100 - metric.percentile) / 100) * size,
                            ),
                          )}
                          e
                          <span style={{ color: "var(--muted-light)" }}>
                            {" "}
                            / {size}
                          </span>
                        </td>
                      </tr>
                    ))}
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
    {
      id: "previous",
      label: "Saison précédente",
      detail: "Données fictives",
      name: `${profile.name} · saison précédente`,
      fake: true,
      values: fakePreviousSeason(base),
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
            fake: auto.fake,
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
      <p className={s.note} role="status">
        Chargement des joueurs du même poste…
      </p>
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
                {item.label} {item.fake && <FakeBadge short />}
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
                  {column.name} {column.fake && <FakeBadge short />}
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
    <div className={s.tableCard} style={{ alignSelf: "start" }}>
      <div className="table-scroll">
        <table className="data-table" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              <th>Indicateur</th>
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
                  <th scope="row">{label(key)}</th>
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
              <th>Indicateur</th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={s.num}
                  style={{ "--tone": column.color }}
                >
                  <div className={s.compareHead}>
                    <strong>
                      {column.name} {column.fake && <FakeBadge short />}
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
                    <th scope="row">{label(key)}</th>
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
              <th scope="row">Moyenne des centiles</th>
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
