"use client";
import React, { lazy, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
  seasonMetric,
} from "../services/season-player.js";
import {
  buildCohorts,
  metricAxes,
  playerSnapshot,
  cohortTraits,
  METRIC_PRESETS,
  profileValue,
  rankMetric,
  roleAssessments,
  SCOUT_METRICS,
} from "../services/scouting.js";
import {
  comparisonKey,
  playerSelection,
} from "../services/research-storage.js";
import { date, number } from "../services/format.js";
import { Card, Empty, Media, Segments } from "./UI.jsx";
import {
  BookmarkButton,
  ComparePlayerButton,
  MetricInfo,
  MetricPicker,
  ReportButton,
  ResearchTabs,
} from "./ResearchUI.jsx";
import { ResearchRadar } from "./ResearchCharts.jsx";

const Evolution = lazy(() => import("./PlayerEvolution.jsx"));
const Similarity = lazy(() => import("./PlayerSimilarity.jsx"));
const SeasonShots = lazy(() => import("./SeasonShots.jsx"));
const PlayerData = lazy(() => import("./PlayerData.jsx"));
const TABS = [
  ["overview", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["similar", "Profils similaires"],
  ["evolution", "Évolution"],
  ["compare", "Comparer"],
  ["matches", "Matchs"],
  ["data", "Données"],
];

export function PlayerMetricTable({ profile, keys, mode, cohorts }) {
  return (
    <div className="table-scroll">
      <table className="data-table research-player-metrics">
        <caption className="sr-only">
          Statistiques de saison, couverture et centiles au poste
        </caption>
        <thead>
          <tr>
            <th>Indicateur</th>
            <th>
              {mode === "total"
                ? "Total"
                : mode === "per90"
                  ? "Par 90 ou %"
                  : "Par match ou %"}
            </th>
            <th>Matchs renseignés</th>
            <th>Médiane / 90 ou %</th>
            <th>Centile</th>
            <th>Pairs</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const value = seasonMetric(profile, key, mode),
              rank = rankMetric(profile, key, cohorts);
            return (
              <tr key={key} data-metric={key}>
                <th scope="row">
                  {SCOUT_METRICS[key].label}
                  <MetricInfo
                    metric={key}
                    observed={value.count}
                    total={profile.matches}
                  />
                </th>
                <td>
                  {number(
                    value.value,
                    mode === "total" && !SCOUT_METRICS[key].ratio
                      ? SCOUT_METRICS[key].decimals || 0
                      : 2,
                  )}
                  {SCOUT_METRICS[key].unit ? ` ${SCOUT_METRICS[key].unit}` : ""}
                </td>
                <td>
                  {value.count} / {profile.matches}
                </td>
                <td>{number(rank.median, 2)}</td>
                <td>{number(rank.percentile)}</td>
                <td>{rank.peers || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function ProfileComparison({ profile, profiles }) {
  const f = useFootball(),
    r = useResearch(),
    [search, setSearch] = useState("");
  const candidates = useMemo(
    () =>
      search.length >= 2
        ? profiles
            .filter(
              (p) =>
                p.id !== profile.id &&
                p.name
                  .toLocaleLowerCase("fr")
                  .includes(search.toLocaleLowerCase("fr")),
            )
            .slice(0, 8)
        : [],
    [profiles, profile.id, search],
  );
  const seasons = f.manifest.seasons
    .map((s) => s.id)
    .filter((s) => s < f.season)
    .sort()
    .reverse();
  return (
    <>
      <div className="research-toolbar">
        <ComparePlayerButton profile={profile} season={f.season} />
        {seasons[0] && (
          <button
            className="button button-secondary"
            onClick={() => {
              const additions = [
                playerSelection(profile, f),
                playerSelection(profile, f, seasons[0]),
              ];
              const values = [
                ...new Map(
                  [...r.data.comparison, ...additions].map((item) => [
                    comparisonKey(item),
                    item,
                  ]),
                ).values(),
              ];
              if (values.length > 4) {
                r.setMessage("Libérez deux places dans la comparaison.");
                return;
              }
              r.update((previous) => ({ ...previous, comparison: values }));
              r.setComparisonKind("players");
              r.setComparing(true);
            }}
          >
            Comparer à {seasons[0]}
          </button>
        )}
        <button
          className="button button-primary"
          disabled={r.data.comparison.length < 2}
          onClick={() => r.setComparing(true)}
        >
          Ouvrir la comparaison ({r.data.comparison.length}/4)
        </button>
      </div>
      <label className="research-search">
        Joueur à comparer
        <input
          type="search"
          aria-label="Rechercher un joueur à comparer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom du joueur…"
        />
      </label>
      <div className="research-saved-list">
        {candidates.map((candidate) => (
          <div className="research-selection" key={candidate.id}>
            <span>
              <strong>{candidate.name}</strong>
              <small>{candidate.teams.join(" · ")}</small>
            </span>
            <ComparePlayerButton profile={candidate} season={f.season} />
          </div>
        ))}
      </div>
    </>
  );
}
export default function PlayerSeasonProfile({
  id,
  rows,
  scopeRows,
  profiles: allProfiles,
  onSource,
}) {
  const f = useFootball(),
    params = useSearchParams();
  const profile = useMemo(() => aggregateSeason(rows, id), [rows, id]);
  const profiles = useMemo(
    () => allProfiles || aggregateSeasonPlayers(scopeRows),
    [allProfiles, scopeRows],
  );
  const [mode, setMode] = useState("total"),
    [minMinutes, setMinMinutes] = useState(450),
    [keys, setKeys] = useState(Object.keys(SCOUT_METRICS)),
    [preset, setPreset] = useState("overview");
  const cohorts = useMemo(
    () => buildCohorts(profiles, minMinutes),
    [profiles, minMinutes],
  );
  const traits = useMemo(
    () => cohortTraits(profile, cohorts),
    [profile, cohorts],
  );
  const roles = useMemo(
    () => roleAssessments(profile, cohorts),
    [profile, cohorts],
  );
  const requestedView = params?.get("playerView");
  const view = TABS.some(([key]) => key === requestedView)
    ? requestedView
    : "overview";
  const change = (next) => {
    const url = new URL(window.location.href);
    url.searchParams.set("playerView", next);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const metricKeys =
    profile.role?.group === "G" && preset === "overview"
      ? METRIC_PRESETS.keeper.keys
      : METRIC_PRESETS[preset].keys;
  const rankings = Object.fromEntries(
    metricKeys.map((key) => [
      key,
      rankMetric(profile, key, cohorts).percentile,
    ]),
  );
  const cohort = cohorts.groups.get(profile.role?.group);
  const matchIds = useMemo(
    () => new Set(profile.rows.map((row) => row.matchId)),
    [profile.rows],
  );
  const shots = useMemo(
    () =>
      view === "stats"
        ? f.data.matches
            .filter((m) => matchIds.has(m.id))
            .flatMap((m) =>
              (m.shots || [])
                .filter((s) => s.playerId === id)
                .map((s) => ({
                  ...s,
                  matchId: m.id,
                  date: m.date,
                  leagueId: m.leagueId,
                  season: m.season,
                })),
            )
        : [],
    [view, f.data.matches, matchIds, id],
  );
  const splits = useMemo(() => {
    const leagues = new Map();
    for (const row of profile.rows) {
      if (!leagues.has(row.leagueId)) leagues.set(row.leagueId, []);
      leagues.get(row.leagueId).push(row);
    }
    return [...leagues].map(([leagueId, values]) => ({
      leagueId,
      name: values[0].league,
      profile: aggregateSeason(values, id),
    }));
  }, [profile.rows, id]);
  if (!profile.matches)
    return (
      <Card title="Fiche joueur">
        <Empty>
          Aucune performance avec des minutes connues pour ces filtres.
        </Empty>
      </Card>
    );
  const metricTable = (
    <PlayerMetricTable
      profile={profile}
      keys={keys}
      mode={mode}
      cohorts={cohorts}
    />
  );
  const figures =
    profile.role?.group === "G"
      ? ["saves", "goalsPrevented", "passesAccurate", "passAccuracy"]
      : ["goals", "assists", "xg", "xa"];
  return (
    <Card className="player-season-card research-player-profile">
      <div className="season-player-heading">
        <div className="season-player-identity">
          <Media
            name={profile.name}
            url={profile.imageUrl}
            className="player-avatar season-player-portrait"
          />
          <div>
            <h2>{profile.name}</h2>
            <p>
              {[profile.role?.label, profile.teams.join(" · ")]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="research-toolbar">
          <BookmarkButton
            kind="players"
            id={id}
            name={profile.name}
            imageUrl={profile.imageUrl}
            season={f.season}
          />
          <ComparePlayerButton profile={profile} season={f.season} />
          <button className="button button-secondary" onClick={onSource}>
            Fiche détaillée
          </button>
          <ReportButton
            title={`${profile.name} · ${f.season}`}
            context={`${profile.teams.join(" · ")} · ${profile.matches} matchs · ${profile.minutes} minutes · minimum de cohorte ${minMinutes} min`}
            data={playerSnapshot(profile, f.season)}
          >
            {metricTable}
          </ReportButton>
        </div>
      </div>
      <div className="research-stat-strip">
        <div>
          <span>Matchs</span>
          <strong>{number(profile.matches)}</strong>
        </div>
        <div>
          <span>Minutes</span>
          <strong>{number(profile.minutes)}</strong>
        </div>
        <div>
          <span>Titularisations</span>
          <strong>{profile.knownStarts ? number(profile.starts) : "—"}</strong>
        </div>
        <div>
          <span>Note</span>
          <strong>{number(profile.rating, 2)}</strong>
        </div>
      </div>
      <ResearchTabs
        label="Analyse du joueur"
        value={view}
        items={TABS}
        onChange={change}
        panelId="player-profile-panel"
      />
      <div
        id="player-profile-panel"
        role="tabpanel"
        aria-label={TABS.find(([key]) => key === view)[1]}
      >
        {["overview", "stats"].includes(view) && (
          <div className="research-toolbar">
            <Segments
              label="Calcul des statistiques du joueur"
              value={mode}
              onChange={setMode}
              items={[
                ["total", "Totaux"],
                ["per90", "Par 90"],
                ["perMatch", "Par match"],
              ]}
            />
            <label>
              Modèle du radar
              <select
                aria-label="Modèle du profil joueur"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                {Object.entries(METRIC_PRESETS).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {["overview", "stats", "similar"].includes(view) && (
          <div className="research-context">
            <span>
              {number(cohort?.profiles.length || 0)} pairs au poste ·{" "}
              {minMinutes} minutes minimum
            </span>
            <label>
              Minutes minimum
              <input
                type="number"
                aria-label="Minutes minimum de la cohorte"
                min="0"
                max="9000"
                step="90"
                value={minMinutes}
                onChange={(e) =>
                  setMinMinutes(
                    Math.max(0, Math.min(9000, Number(e.target.value) || 0)),
                  )
                }
              />
            </label>
          </div>
        )}
        <Suspense
          fallback={
            <div className="loading-state" role="status">
              Chargement de l’analyse…
            </div>
          }
        >
          {view === "overview" && (
            <>
              <div className="season-player-figures">
                {figures.map((key) => {
                  const result = seasonMetric(profile, key, mode);
                  return (
                    <div key={key}>
                      <span>
                        {SCOUT_METRICS[key].label}
                        <MetricInfo
                          metric={key}
                          observed={result.count}
                          total={profile.matches}
                        />
                      </span>
                      <strong>
                        {number(
                          result.value,
                          mode === "total" && !SCOUT_METRICS[key].ratio
                            ? SCOUT_METRICS[key].decimals || 0
                            : 2,
                        )}
                      </strong>
                      {result.count < profile.matches && (
                        <small>
                          {result.count}/{profile.matches} matchs renseignés
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="research-two-columns">
                <ResearchRadar
                  title={`${profile.name} · centiles au poste`}
                  axes={metricAxes(metricKeys)}
                  series={[
                    { name: profile.name, values: rankings },
                    {
                      name: "Médiane au poste",
                      values: Object.fromEntries(
                        metricKeys
                          .filter((key) => rankings[key] != null)
                          .map((key) => [key, 50]),
                      ),
                    },
                  ]}
                  context={`${f.season}, ${profile.role?.label}, ${minMinutes} minutes minimum`}
                />
                <div>
                  <h3>Traits statistiques</h3>
                  {traits.high.length ? (
                    <div className="research-traits">
                      {[
                        ["Centiles élevés", traits.high],
                        ["Centiles bas", traits.low],
                      ].map(([title, values]) => (
                        <section key={title}>
                          <h4>{title}</h4>
                          <dl>
                            {values.map((item) => (
                              <div key={item.key}>
                                <dt>{SCOUT_METRICS[item.key].label}</dt>
                                <dd>
                                  {number(item.percentile)}
                                  <small>e centile</small>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <Empty>
                      Échantillon insuffisant pour situer ce joueur. Élargissez
                      les compétitions ou ajustez les minutes.
                    </Empty>
                  )}
                  {roles.some((role) => role.value != null) && (
                    <section>
                      <h3>Dimensions par profil</h3>
                      <div className="research-role-scores">
                        {roles
                          .filter((role) => role.value != null)
                          .map((role) => (
                            <div
                              key={role.id}
                              title={role.keys
                                .map((key) => SCOUT_METRICS[key].label)
                                .join(" · ")}
                            >
                              <span>{role.label}</span>
                              <meter min="0" max="100" value={role.value} />
                              <strong>{number(role.value)}</strong>
                            </div>
                          ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
              <section className="season-recent">
                <div className="season-section-heading">
                  <h3>Dernières performances</h3>
                  <button
                    className="inline-link"
                    onClick={() => change("matches")}
                  >
                    Tous les matchs →
                  </button>
                </div>
                <div className="season-match-list">
                  {profile.rows.slice(0, 5).map((row) => (
                    <button
                      className="season-match"
                      key={row.id}
                      onClick={() => f.setPlayer(row.id)}
                    >
                      <span>
                        <strong>
                          {row.team} · {row.league}
                        </strong>
                        <small>{date(row.date)}</small>
                      </span>
                      <span>
                        {number(row.minutes)} min
                        <small>Note {number(row.rating, 2)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
          {view === "stats" && (
            <>
              <div className="research-toolbar">
                <MetricPicker
                  label="Indicateurs affichés"
                  value={keys}
                  onChange={setKeys}
                />
                <button
                  className="inline-link"
                  onClick={() => setKeys(Object.keys(SCOUT_METRICS))}
                >
                  Tous les indicateurs
                </button>
              </div>
              {metricTable}
              <div className="research-two-columns">
                <section>
                  <h3>Par compétition</h3>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Compétition</th>
                          <th>Matchs</th>
                          <th>Minutes</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {splits.map((split) => (
                          <tr key={split.leagueId}>
                            <th>{split.name}</th>
                            <td>{number(split.profile.matches)}</td>
                            <td>{number(split.profile.minutes)}</td>
                            <td>{number(split.profile.rating, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section>
                  <h3>Postes observés</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Poste</th>
                        <th>Minutes</th>
                        <th>Part du temps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...profile.positions]
                        .sort((a, b) => b[1].minutes - a[1].minutes)
                        .map(([key, item]) => (
                          <tr key={key}>
                            <th>{key}</th>
                            <td>{number(item.minutes)}</td>
                            <td>
                              {number((item.minutes / profile.minutes) * 100)} %
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </section>
              </div>
              <h3>Tirs de la saison</h3>
              <SeasonShots
                shots={shots}
                title={`${profile.name} · tirs de la saison`}
              />
            </>
          )}
          {view === "similar" && (
            <Similarity profile={profile} cohorts={cohorts} />
          )}
          {view === "evolution" && <Evolution id={id} profile={profile} />}
          {view === "compare" && (
            <ProfileComparison profile={profile} profiles={profiles} />
          )}
          {view === "matches" && (
            <div className="research-context">
              <span>
                {number(profile.matches)} matchs joués ·{" "}
                {profile.unknownMinutes
                  ? `${profile.unknownMinutes} observations sans minutes connues`
                  : f.season}
              </span>
            </div>
          )}
          {view === "data" && <PlayerData row={profile.rows[0]} mode="data" />}
        </Suspense>
      </div>
    </Card>
  );
}
