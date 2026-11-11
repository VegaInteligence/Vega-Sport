"use client";
import React, {
  lazy,
  useCallback,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  roleAssessments,
  SCOUT_METRICS,
} from "../services/scouting.js";
import { number } from "../services/format.js";
import { Segments } from "./UI.jsx";
import {
  BookmarkButton,
  ComparePlayerButton,
  MetricInfo,
  ReportButton,
  ResearchTabs,
} from "./ResearchUI.jsx";
import PlayerHonours, { usePlayerHonours } from "./PlayerHonours.jsx";
import PlayerOverviewRadar from "./PlayerOverviewRadar.jsx";
import PlayerProfileFilters from "./PlayerProfileFilters.jsx";
import PlayerScoutRail, { PlayerScoutStrip } from "./PlayerScoutRail.jsx";
import PlayerAdvancedStats from "./PlayerAdvancedStats.jsx";
import PlayerScoutOverview, {
  PlayerGames,
  PlayerScoutCompare,
  PlayerScoutStats,
} from "./PlayerScoutOverview.jsx";
import PlayerScoutCareer from "./PlayerScoutCareer.jsx";
import { FakePhysical } from "./PlayerScoutDemo.jsx";
import PlayerPresenceCard from "./PlayerPresenceCard.jsx";
import { chartTokens } from "./PlayerScoutCharts.jsx";
import scout from "./PlayerScout.module.css";
import { nationalFlagCode } from "../services/national-flags.js";
import MessiGoats from "./MessiGoats.jsx";
import { levelPeerClubs, useEuropeLevels } from "../services/club-scout.js";
import { RankingProvider, RankingTrigger } from "./RankingDialog.jsx";
import { PlayerLevelBar, PlayerRankingDialog } from "./PlayerRanking.jsx";
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

const Similarity = lazy(() => import("./PlayerSimilarity.jsx"));
const Projection = lazy(() => import("./PlayerProjection.jsx"));
const SeasonShots = lazy(() => import("./SeasonShots.jsx"));
const SeasonStats = lazy(() => import("./PlayerSeasonStats.jsx"));
const CareerStats = lazy(() => import("./PlayerCareerStats.jsx"));
const PerformanceStats = lazy(() =>
  import("./PlayerSeasonStats.jsx").then(({ PlayerPerformanceStats }) => ({
    default: PlayerPerformanceStats,
  })),
);
// Same tabs, order and names as mock-up C.
const TABS = [
  ["overview", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["advanced", "Stats avancées"],
  ["physical", "Physique"],
  ["compare", "Comparaison"],
  ["similar", "Profils similaires"],
  ["evolution", "Carrière et marché"],
  ["projection", "Projection"],
  ["games", "Matchs"],
];
// Tabs whose content ignores the competition and date filters.
const UNFILTERED_VIEWS = new Set([
  "stats",
  "evolution",
  "physical",
  "projection",
]);
const HISTORY_TABS = TABS.slice(0, 2);
const STAT_MODES = [
  ["total", "Totaux"],
  ["per90", "Par 90 min"],
  ["perMatch", "Par match"],
];

function profileTeam(rows, teams, season, includeSelection = false) {
  const minutes = new Map();
  for (const row of rows)
    if (row.teamId)
      minutes.set(
        row.teamId,
        (minutes.get(row.teamId) || 0) + (row.minutes || 0),
      );
  const known = new Map((teams || []).map((item) => [item.id, item]));
  let selection = null;
  for (const [teamId] of [...minutes].sort((a, b) => b[1] - a[1])) {
    const info = known.get(teamId);
    const name = info?.name || rows.find((row) => row.teamId === teamId)?.team;
    if (!name) continue;
    const team = { id: teamId, name, imageUrl: info?.imageUrl };
    if (!nationalFlagCode(name, season)) return team;
    if (includeSelection) selection ||= team;
  }
  return selection;
}

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
                  <RankingTrigger target={{ type: "metric", key }}>
                    {SCOUT_METRICS[key].label}
                  </RankingTrigger>
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
/** Identity rail beside the tabbed analysis, plus its compact scrolling strip. */
function ProfileLayout({
  id,
  identity,
  profile,
  record,
  season,
  team,
  playingTime,
  vega,
  actions,
  stripActions,
  onTab,
  children,
}) {
  const railRef = useRef(null);
  const fallbackUrl = id === MESSI_ID ? MESSI_PORTRAIT : undefined;
  const showIdentity = Boolean(identity.name);
  return (
    <>
      {showIdentity && (
        <PlayerScoutStrip
          railRef={railRef}
          identity={identity}
          profile={profile}
          team={team}
          actions={stripActions}
        />
      )}
      <div className={scout.layout}>
        <div ref={railRef}>
          <PlayerScoutRail
            id={id}
            identity={identity}
            fallbackUrl={fallbackUrl}
            showIdentity={showIdentity}
            profile={profile}
            record={record}
            season={season}
            team={team}
            playingTime={playingTime}
            vega={vega}
            actions={actions}
            onTab={onTab}
          />
        </div>
        <div className={scout.main}>{children}</div>
      </div>
    </>
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
  const team = useMemo(
    () => profileTeam(profile.rows, f.data?.teams, f.season),
    [profile.rows, f.data?.teams, f.season],
  );
  const role = profile.role?.label;
  const profiles = useMemo(
    () => allProfiles || aggregateSeasonPlayers(scopeRows),
    [allProfiles, scopeRows],
  );
  const [mode, setMode] = useState("total"),
    [minMinutes, setMinMinutes] = useState(450),
    [keys] = useState(Object.keys(SCOUT_METRICS));
  const requestedView = params?.get("playerView");
  const view = TABS.some(([key]) => key === requestedView)
    ? requestedView
    : "overview";
  const [overviewScope, setOverviewScope] = useState(null);
  const scopeKey = `${id}:${f.season}`;
  const competition =
    view === "overview" &&
    overviewScope?.key === scopeKey &&
    profile.rows.some((row) => row.league === overviewScope.competition)
      ? overviewScope.competition
      : "all";
  const timeRows = useMemo(
    () =>
      competition === "all"
        ? rows
        : rows.filter((row) => row.league === competition),
    [rows, competition],
  );
  const timeTeam = useMemo(() => {
    if (competition === "all" && team) return team;
    return (
      profileTeam(timeRows, f.data?.teams, f.season, true) ||
      profileTeam(
        (f.data?.appearances || []).filter((row) => row.playerId === id),
        f.data?.teams,
        f.season,
        true,
      )
    );
  }, [
    competition,
    team,
    timeRows,
    f.data?.teams,
    f.data?.appearances,
    f.season,
    id,
  ]);
  const playingTime = { rows: timeRows, team: timeTeam, competition };
  const comparisonMinutes =
    view === "overview" ? MIN_SEASON_MINUTES : minMinutes;
  // Peers restricted to the clubs closest to the player's club in level.
  const [level, setLevel] = useState(true);
  const europe = useEuropeLevels(level);
  const levelPeers = useMemo(
    () =>
      level && europe.status === "ready" && team
        ? levelPeerClubs(europe.value, team.id)
        : null,
    [level, europe, team],
  );
  const scopedProfiles = useMemo(
    () =>
      levelPeers
        ? profiles.filter(
            (peer) =>
              peer.id === profile.id ||
              (peer.teamIds || []).some((teamId) => levelPeers.ids.has(teamId)),
          )
        : profiles,
    [profiles, levelPeers, profile.id],
  );
  const cohorts = useMemo(
    () => buildCohorts(scopedProfiles, comparisonMinutes),
    [scopedProfiles, comparisonMinutes],
  );
  const [rankingKey, setRankingKey] = useState(null);
  const openRanking = useCallback(
    (target) => target?.type === "metric" && setRankingKey(target.key),
    [],
  );
  const change = (next) => {
    const url = new URL(window.location.href);
    url.searchParams.set("playerView", next);
    if (next !== "overview") setOverviewScope(null);
    if (next === "stats") {
      url.searchParams.delete("performanceCompetition");
      url.searchParams.delete("performanceSeason");
    }
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const cohort = cohorts.groups.get(profile.role?.group);
  // Rail « Indice Vega »: best role index and its rank among the cohort.
  const vega = useMemo(() => {
    if (!comparisonsReady || !profile.matches) return null;
    const best = roleAssessments(profile, cohorts).find(
      (role) => role.value != null,
    );
    if (!best) return null;
    const scores = (cohorts.groups.get(profile.role?.group)?.profiles || [])
      .filter((peer) => peer.id !== profile.id)
      .map(
        (peer) =>
          roleAssessments(peer, cohorts).find((role) => role.id === best.id)
            ?.value,
      )
      .filter((value) => value != null);
    return {
      value: Math.round(best.value),
      label: best.label,
      rank: scores.filter((value) => value > best.value).length + 1,
      of: scores.length + 1,
    };
  }, [comparisonsReady, profile, cohorts]);
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
    <div data-page-loading="" className="loading-state" role="status">
      Chargement des saisons…
    </div>
  );
  const palmares = (honours.loading || honours.value?.groups?.length > 0) && (
    <section className={`${scout.block} ${scout.palmares}`}>
      <div className={scout.sectionHead}>
        <h2>Palmarès</h2>
      </div>
      <PlayerHonours
        key={id}
        name={identity.name || undefined}
        result={honours}
      />
    </section>
  );
  const historyOverview = (
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
      <div className={scout.overview}>{palmares}</div>
    </div>
  );
  const overview = (
    <PlayerScoutOverview
      profile={profile}
      cohorts={cohorts}
      ready={comparisonsReady}
      season={f.season}
      matches={f.data?.matches}
      comparisonRef={comparisonRef}
      onTab={change}
      team={team?.name}
      competition={competition}
      onCompetition={(value) =>
        setOverviewScope({ key: scopeKey, competition: value })
      }
    >
      {palmares}
    </PlayerScoutOverview>
  );
  if (!profile.matches) {
    const historyView = view === "stats" ? "stats" : "overview";
    return (
      <article
        className={`research-player-profile player-profile-flat ${chartTokens}`}
      >
        <MessiGoats id={id} />
        <ProfileLayout
          id={id}
          identity={identity}
          profile={profile}
          record={record}
          season={f.season}
          team={team}
          playingTime={playingTime}
          onTab={change}
        >
          <ResearchTabs
            animated
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
            {historyView === "overview" && <PlayerProfileFilters />}
            {historyView === "stats" ? (
              <>
                <Suspense fallback={historyLoading}>
                  <PerformanceStats id={id} />
                </Suspense>
                {rows.length > 0 && <PlayerPresenceCard id={id} rows={rows} />}
              </>
            ) : (
              historyOverview
            )}
          </div>
        </ProfileLayout>
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
  const playerActions = (
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
  );
  return (
    <RankingProvider value={comparisonsReady ? openRanking : null}>
    <article
      className={`research-player-profile player-profile-flat ${chartTokens}`}
    >
      <MessiGoats id={id} />
      <ProfileLayout
        id={id}
        identity={identity}
        profile={profile}
        record={record}
        season={f.season}
        team={team}
        playingTime={playingTime}
        vega={vega}
        onTab={change}
        actions={playerActions}
        stripActions={
          <div className="research-toolbar">
            <ComparePlayerButton profile={profile} season={f.season} />
          </div>
        }
      >
        <ResearchTabs
          animated
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
          {!UNFILTERED_VIEWS.has(view) && <PlayerProfileFilters />}
          {COHORT_VIEWS.has(view) && (
            <PlayerLevelBar
              level={level}
              onLevel={setLevel}
              state={level ? europe : { status: "ready" }}
              peers={levelPeers}
              team={team}
            />
          )}
          {view === "similar" && cohortControls}
          <Suspense
            fallback={
              <div data-page-loading="" className="loading-state" role="status">
                Chargement de l’analyse…
              </div>
            }
          >
            {view === "overview" && overview}
            {view === "advanced" && (
              <PlayerAdvancedStats
                profile={profile}
                cohorts={cohorts}
                minMinutes={minMinutes}
                onMinMinutes={setMinMinutes}
                ready={comparisonsReady}
              />
            )}
            {view === "stats" && (
              <>
                <div className={scout.overview} ref={comparisonRef}>
                  <div className={scout.sectionHead}>
                    <div>
                      <h2>Statistiques détaillées</h2>
                      <p>
                        Valeur, médiane, centile et rang face aux{" "}
                        {profile.role?.peers || "joueurs du même poste"} ·
                        saison {f.season}
                      </p>
                    </div>
                    <div className="research-toolbar">
                      <Segments
                        label="Calcul des statistiques du joueur"
                        value={mode}
                        onChange={setMode}
                        items={STAT_MODES}
                      />
                    </div>
                  </div>
                </div>
                {cohortControls}
                <PlayerScoutStats
                  profile={profile}
                  cohorts={cohorts}
                  mode={mode}
                  ready={comparisonsReady}
                />
                <div className={`${scout.block} ${scout.grid2}`}>
                  <section className={scout.card} ref={shotsRef}>
                    {deferredShots && !shotDetails.value ? (
                      shotDetails.error ? (
                        <p role="alert">
                          {shotDetails.error}{" "}
                          <button onClick={shotDetails.retry}>Réessayer</button>
                        </p>
                      ) : (
                        <p
                          role="status"
                          data-page-loading=""
                          className="loading-state"
                        >
                          Chargement des tirs de la saison…
                        </p>
                      )
                    ) : (
                      <Suspense fallback={historyLoading}>
                        <SeasonShots
                          key={id}
                          title="Carte des tirs"
                          shots={shots}
                          legacyPitchApi={
                            f.manifest?.storage === "aws-relational"
                          }
                        />
                      </Suspense>
                    )}
                  </section>
                  <PlayerPresenceCard id={id} rows={rows} />
                </div>
              </>
            )}
            {view === "similar" &&
              (comparisonsReady ? (
                <Similarity profile={profile} cohorts={cohorts} />
              ) : (
                <p className="notice" role="status">
                  Chargement des joueurs du même poste…
                </p>
              ))}
            {view === "evolution" && (
              <PlayerScoutCareer
                key={id}
                id={id}
                profile={profile}
                team={team}
                season={f.season}
              >
                {palmares}
              </PlayerScoutCareer>
            )}
            {view === "physical" && <FakePhysical />}
            {view === "projection" && (
              <Projection
                profile={profile}
                profiles={profiles}
                team={team}
                ready={comparisonsReady}
              />
            )}
            {view === "games" && (
              <PlayerGames profile={profile} matches={f.data?.matches} />
            )}
            {view === "compare" && (
              <PlayerScoutCompare
                profile={profile}
                cohorts={cohorts}
                ready={comparisonsReady}
              />
            )}
          </Suspense>
        </div>
      </ProfileLayout>
      {rankingKey && (
        <PlayerRankingDialog
          profile={profile}
          cohorts={cohorts}
          metricKey={rankingKey}
          onClose={() => setRankingKey(null)}
        />
      )}
    </article>
    </RankingProvider>
  );
}
const COHORT_VIEWS = new Set([
  "overview",
  "advanced",
  "stats",
  "similar",
  "compare",
]);
