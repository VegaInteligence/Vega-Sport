"use client";
import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFootball } from "../hooks/FootballContext.jsx";
import useActorRead from "../hooks/useActorRead.js";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import { actorReadParams } from "../services/actor-reads.js";
import { compactGeneration, readCompact } from "../services/compact-reads.js";
import { useResearch } from "../hooks/ResearchContext.jsx";
import {
  aggregateSeason,
  aggregateSeasonPlayers,
  MIN_SEASON_MINUTES,
  seasonMetric,
} from "../services/season-player.js";
import {
  buildCohorts,
  playerSnapshot,
  rankMetric,
  SCOUT_METRICS,
  similarPlayers,
} from "../services/scouting.js";
import {
  comparisonKey,
  playerSelection,
} from "../services/research-storage.js";
import { normalizeText, number } from "../services/format.js";
import { Media, Segments } from "./UI.jsx";
import {
  BookmarkButton,
  ComparePlayerButton,
  MetricInfo,
  MetricPicker,
  ReportButton,
  ResearchTabs,
} from "./ResearchUI.jsx";
import PlayerHonours, { usePlayerHonours } from "./PlayerHonours.jsx";
import PlayerOverviewRadar from "./PlayerOverviewRadar.jsx";
import PlayerBio from "./PlayerBio.jsx";
import MessiGoats from "./MessiGoats.jsx";
import { MESSI_ID } from "../services/player-honours.js";
import {
  cachedResource,
  primeResource,
  useResource,
} from "../services/resources.js";
import {
  MESSI_PORTRAIT,
  loadSummaryIdentity,
  resolvePlayerIdentity,
} from "../services/player-identity.js";

const Evolution = lazy(() => import("./PlayerEvolution.jsx"));
const Similarity = lazy(() => import("./PlayerSimilarity.jsx"));
const SeasonShots = lazy(() => import("./SeasonShots.jsx"));
const SeasonStats = lazy(() => import("./PlayerSeasonStats.jsx"));
const CareerStats = lazy(() => import("./PlayerCareerStats.jsx"));
const PerformanceStats = lazy(() =>
  import("./PlayerSeasonStats.jsx").then(({ PlayerPerformanceStats }) => ({
    default: PlayerPerformanceStats,
  })),
);
const TABS = [
  ["overview", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["similar", "Profils similaires"],
  ["evolution", "Évolution"],
  ["compare", "Comparer"],
];
const HISTORY_TABS = TABS.slice(0, 2);
const STAT_MODES = [
  ["total", "Totaux"],
  ["per90", "Par 90 min"],
  ["perMatch", "Par match"],
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
            <th title="Un centile proche de 100 indique une place parmi les meilleurs joueurs du même poste sur cet indicateur.">
              Centile au poste
            </th>
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
function ProfileComparison({ profile, profiles, cohorts }) {
  const f = useFootball(),
    r = useResearch(),
    [search, setSearch] = useState("");
  const needle = normalizeText(search).trim();
  const suggestions = useMemo(
    () =>
      cohorts ? similarPlayers(profile, cohorts, 4).map((s) => s.profile) : [],
    [profile, cohorts],
  );
  const candidates = useMemo(
    () =>
      needle.length >= 2
        ? profiles
            .filter(
              (p) =>
                p.id !== profile.id && normalizeText(p.name).includes(needle),
            )
            .sort((a, b) => b.minutes - a.minutes)
            .slice(0, 8)
        : suggestions,
    [profiles, profile.id, needle, suggestions],
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
      {needle.length < 2 && candidates.length > 0 && (
        <p className="club-note">Profils statistiques proches au même poste</p>
      )}
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

function PlayerProfileHeading({ id, identity, role, honours, children }) {
  return (
    <div className="season-player-heading">
      <div className="season-player-identity">
        <Media
          name={identity.name}
          url={identity.imageUrl}
          fallbackUrl={id === MESSI_ID ? MESSI_PORTRAIT : undefined}
          className="player-avatar season-player-portrait"
        />
        <div>
          <h2>{identity.name}</h2>
          {role && <p>{role}</p>}
        </div>
      </div>
      <PlayerHonours key={id} name={identity.name} result={honours} />
      {children}
    </div>
  );
}

export default function PlayerSeasonProfile({
  id,
  rows,
  scopeRows,
  profiles: allProfiles,
  comparisonsReady = true,
  onNeedComparisons,
  radarComparison,
}) {
  const f = useFootball(),
    params = useSearchParams();
  const profile = useMemo(() => aggregateSeason(rows, id), [rows, id]);
  const knownIdentity = useMemo(
    () => resolvePlayerIdentity(id, profile, f.data?.appearances),
    [id, profile, f.data?.appearances],
  );
  const identityKey = `player-identity:${id}`;
  useEffect(() => {
    // Changing competitions can remount the profile with a different dataset.
    if (knownIdentity.name)
      void primeResource(identityKey, () => knownIdentity);
  }, [identityKey, knownIdentity]);
  const publishedProfile = useResource(
    `player-record:${id}`,
    async () => {
      try {
        return (await f.client.request(`players/${encodeURIComponent(id)}`))
          .data;
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
    Boolean(f.client && /^p_[A-Za-z0-9]{6}$/.test(id)),
  );
  const record = publishedProfile.value;
  const storedIdentity = cachedResource(identityKey);
  const generation = compactGeneration(f.manifest);
  const seasons = [
    f.season,
    ...(f.manifest?.seasons || []).map((s) => s.id),
  ].filter((season, index, all) => season && all.indexOf(season) === index);
  const relationalIdentity = useResource(
    `player-summary-identity:${id}:${seasons.join(",")}:${generation}`,
    ({ signal }) =>
      loadSummaryIdentity(id, seasons, generation, readCompact, signal),
    Boolean(
      !knownIdentity.name &&
      !record?.name &&
      !storedIdentity?.name &&
      seasons.length &&
      /^p_[A-Za-z0-9]{6}$/.test(id || ""),
    ),
  );
  const summaryIdentity = relationalIdentity.value;
  useEffect(() => {
    if (summaryIdentity?.name)
      void primeResource(identityKey, () => summaryIdentity);
  }, [identityKey, summaryIdentity]);
  const identity = useMemo(
    () =>
      resolvePlayerIdentity(id, profile, f.data?.appearances, {
        name: record?.name || storedIdentity?.name || summaryIdentity?.name,
        image_url:
          record?.image_url ||
          record?.imageUrl ||
          storedIdentity?.imageUrl ||
          summaryIdentity?.imageUrl,
      }),
    [id, profile, f.data?.appearances, record, storedIdentity, summaryIdentity],
  );
  const honours = usePlayerHonours(id, identity.name);
  const role = profile.role?.label;
  const profiles = useMemo(
    () => allProfiles || aggregateSeasonPlayers(scopeRows),
    [allProfiles, scopeRows],
  );
  const [mode, setMode] = useState("total"),
    [minMinutes, setMinMinutes] = useState(450),
    [keys, setKeys] = useState(Object.keys(SCOUT_METRICS));
  const requestedView = params?.get("playerView");
  const view = TABS.some(([key]) => key === requestedView)
    ? requestedView
    : "overview";
  const comparisonMinutes =
    view === "overview" ? MIN_SEASON_MINUTES : minMinutes;
  const cohorts = useMemo(
    () => buildCohorts(profiles, comparisonMinutes),
    [profiles, comparisonMinutes],
  );
  const change = (next) => {
    const url = new URL(window.location.href);
    url.searchParams.set("playerView", next);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const cohort = cohorts.groups.get(profile.role?.group);
  const performanceSeason = params?.get("performanceSeason");
  const showCurrentShots =
    view === "stats" &&
    (performanceSeason == null || performanceSeason === f.season);
  const [comparisonRef, comparisonVisible] = useVisibleIntent(
    `${id}:${f.season}:${view}`,
    ["overview", "stats"].includes(view),
  );
  useEffect(() => {
    if (comparisonVisible) onNeedComparisons?.();
  }, [comparisonVisible, onNeedComparisons]);
  const [shotsRef, shotsVisible] = useVisibleIntent(
    `${id}:${f.season}:shots`,
    showCurrentShots,
  );
  const deferredShots = f.manifest?.capabilities?.actorSummary === true;
  const shotDetails = useActorRead(
    f.manifest,
    "player",
    actorReadParams(f.manifest, "player", {
      id,
      season: f.season,
      leagues: f.actorScope || "all",
      include: "shots",
    }),
    {
      enabled: deferredShots && showCurrentShots && shotsVisible,
      refreshManifest: f.refreshManifest,
    },
  );
  const shotMatches = deferredShots
    ? shotDetails.value?.matches || []
    : f.data.matches;
  const matchIds = useMemo(
    () => new Set(profile.rows.map((row) => row.matchId)),
    [profile.rows],
  );
  const shots = useMemo(
    () =>
      showCurrentShots
        ? shotMatches
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
    [showCurrentShots, shotMatches, matchIds, id],
  );
  const historyLoading = (
    <div className="loading-state" role="status">
      Chargement des saisons…
    </div>
  );
  const overview = (
    <div className="player-overview">
      <Suspense fallback={historyLoading}>
        <SeasonStats id={id} season={f.season} />
      </Suspense>
      <div className="player-overview-comparison">
        <div ref={comparisonRef}>
          <PlayerOverviewRadar
            profile={profile}
            cohorts={cohorts}
            comparison={
              radarComparison || (!comparisonsReady ? { loading: true } : null)
            }
          />
        </div>
        <Suspense fallback={historyLoading}>
          <CareerStats id={id} season={f.season} overview />
        </Suspense>
      </div>
    </div>
  );
  if (!profile.matches) {
    const historyView = view === "stats" ? "stats" : "overview";
    return (
      <article className="research-player-profile player-profile-flat">
        <MessiGoats id={id} />
        {identity.name ? (
          <PlayerProfileHeading
            id={id}
            identity={identity}
            role={role}
            honours={honours}
          />
        ) : (
          <PlayerHonours key={id} result={honours} />
        )}
        <PlayerBio profile={record} />
        <ResearchTabs
          label="Analyse du joueur"
          value={historyView}
          items={HISTORY_TABS}
          onChange={change}
          panelId="player-profile-panel"
        />
        <div
          id="player-profile-panel"
          role="tabpanel"
          aria-label={
            historyView === "stats" ? "Statistiques" : "Vue d’ensemble"
          }
        >
          {historyView === "stats" ? (
            <Suspense fallback={historyLoading}>
              <PerformanceStats id={id} />
            </Suspense>
          ) : (
            overview
          )}
        </div>
      </article>
    );
  }
  const metricTable = (
    <PlayerMetricTable
      profile={profile}
      keys={keys}
      mode={mode}
      cohorts={cohorts}
    />
  );
  const cohortControls = (
    <div className="research-context">
      <span>
        {number(cohort?.profiles.length || 0)} joueurs au même poste · au moins{" "}
        {minMinutes} min
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
  );
  return (
    <article className="research-player-profile player-profile-flat">
      <MessiGoats id={id} />
      <PlayerProfileHeading
        id={id}
        identity={identity}
        role={role}
        honours={honours}
      >
        <div className="research-toolbar">
          <BookmarkButton
            kind="players"
            id={id}
            name={profile.name}
            imageUrl={profile.imageUrl}
            season={f.season}
          />
          <ComparePlayerButton profile={profile} season={f.season} />
          <ReportButton
            title={`${profile.name} · ${f.season}`}
            context={`${profile.teams.join(" · ")} · ${profile.matches} matchs · ${profile.minutes} minutes · minimum de cohorte ${minMinutes} min`}
            data={playerSnapshot(profile, f.season)}
          >
            {metricTable}
          </ReportButton>
        </div>
      </PlayerProfileHeading>
      <PlayerBio profile={record} />
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
        {view === "similar" && cohortControls}
        <Suspense
          fallback={
            <div className="loading-state" role="status">
              Chargement de l’analyse…
            </div>
          }
        >
          {view === "overview" && overview}
          {view === "stats" && (
            <PerformanceStats id={id}>
              <div className="season-section-heading" ref={comparisonRef}>
                <h3>Analyse détaillée</h3>
                <span>{f.season}</span>
              </div>
              <div className="research-toolbar">
                <Segments
                  label="Calcul des statistiques du joueur"
                  value={mode}
                  onChange={setMode}
                  items={STAT_MODES}
                />
              </div>
              {cohortControls}
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
              <section>
                <h3>Postes observés</h3>
                <div className="table-scroll">
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
                </div>
              </section>
              <section ref={shotsRef}>
                {deferredShots && !shotDetails.value ? (
                  shotDetails.error ? (
                    <p role="alert">
                      {shotDetails.error}{" "}
                      <button onClick={shotDetails.retry}>Réessayer</button>
                    </p>
                  ) : (
                    <p role="status" className="loading-state">
                      Chargement des tirs de la saison…
                    </p>
                  )
                ) : (
                  <Suspense fallback={historyLoading}>
                    <SeasonShots
                      key={id}
                      shots={shots}
                      legacyPitchApi={f.manifest?.storage === "aws-relational"}
                    />
                  </Suspense>
                )}
              </section>
            </PerformanceStats>
          )}
          {view === "similar" && (
            <Similarity profile={profile} cohorts={cohorts} />
          )}
          {view === "evolution" && (
            <Evolution key={id} id={id} profile={profile} />
          )}
          {view === "compare" && (
            <ProfileComparison
              profile={profile}
              profiles={profiles}
              cohorts={cohorts}
            />
          )}
        </Suspense>
      </div>
    </article>
  );
}
