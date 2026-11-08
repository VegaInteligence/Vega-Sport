"use client";
import React, { useMemo, useState } from "react";
import { Segments } from "./UI.jsx";
import {
  cohortTraits,
  roleAssessments,
  SCOUT_METRICS,
} from "../services/scouting.js";
import {
  aggregateSeason,
  seasonMetric,
  seasonSections,
} from "../services/season-player.js";
import { number } from "../services/format.js";
import { advancedMetric } from "./PlayerAdvancedStats.jsx";
import {
  fmt,
  Gauge,
  LineChart,
  PercentileBadge,
  PercentileBar,
  PercentilePizza,
  TipBody,
  ToneLegend,
  toneClass,
} from "./PlayerScoutCharts.jsx";
import s from "./PlayerScout.module.css";

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

function SeasonKpis({ profile, season }) {
  const competitions = useMemo(() => {
    const names = new Map();
    for (const row of profile.rows)
      if (row.league) names.set(row.league, (names.get(row.league) || 0) + 1);
    return [...names].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [profile.rows]);
  const [scope, setScope] = useState("all");
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
            onChange={setScope}
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
            <span>{label(item.key)}</span>
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
  children,
}) {
  const group = profile.role?.group;
  const peers = cohorts.groups.get(group)?.profiles.length || 0;
  const metrics = useMemo(() => {
    const keys = new Set([
      ...(PIZZA_KEYS[group] || PIZZA_KEYS.O),
      ...seasonSections(group).flatMap((section) => section.keys),
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
  const families = seasonSections(group).map((section) => {
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
      <SeasonKpis profile={profile} season={season} />
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
            title="Indices de rôle"
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
            title="Scores par famille"
            text="Centile moyen des indicateurs classés de chaque famille."
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
        <RecentForm profile={profile} matches={matches} onTab={onTab} />
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
  return (
    <div className={s.overview}>
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
