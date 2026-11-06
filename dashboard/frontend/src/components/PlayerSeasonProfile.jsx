"use client";
import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  playerSnapshot,
  rankMetric,
  SCOUT_METRICS,
  similarPlayers,
} from "../services/scouting.js";
import {
  comparisonKey,
  playerSelection,
} from "../services/research-storage.js";
import { date, normalizeText, number } from "../services/format.js";
import { Card, Empty, Media, Segments } from "./UI.jsx";
import {
  BookmarkButton,
  ComparePlayerButton,
  MetricInfo,
  MetricPicker,
  ReportButton,
  ResearchTabs,
} from "./ResearchUI.jsx";
import PlayerHonours, {
  PlayerHonoursSource,
  usePlayerHonours,
} from "./PlayerHonours.jsx";
import PlayerBio from "./PlayerBio.jsx";
import PlayerDiscipline from "./PlayerDiscipline.jsx";
import { playerOpponent } from "./PlayerFixture.jsx";
import PerformanceContext from "./PerformanceContext.jsx";
import MessiGoats from "./MessiGoats.jsx";
import { MESSI_ID } from "../services/player-honours.js";
import { playerBio } from "../services/player-bio.js";
import { primeResource, useResource } from "../services/resources.js";
import {
  MESSI_PORTRAIT,
  resolvePlayerIdentity,
} from "../services/player-identity.js";

const Evolution = lazy(() => import("./PlayerEvolution.jsx"));
const Similarity = lazy(() => import("./PlayerSimilarity.jsx"));
const SeasonShots = lazy(() => import("./SeasonShots.jsx"));
const SeasonStats = lazy(() => import("./PlayerSeasonStats.jsx"));
const TABS = [
  ["overview", "Vue d’ensemble"],
  ["stats", "Statistiques"],
  ["similar", "Profils similaires"],
  ["evolution", "Évolution"],
  ["compare", "Comparer"],
  ["matches", "Matchs"],
];
const OVERVIEW_GROUPS = [
  ["summary", "Essentiel"],
  ["attack", "Attaque"],
  ["creation", "Création"],
  ["defence", "Défense"],
];
const OVERVIEW_METRICS = {
  summary: ["goals", "assists", "shotsOnTarget", "xg"],
  attack: ["goals", "shots", "shotsOnTarget", "xg"],
  creation: ["assists", "chancesCreated", "passesFinalThird", "passesAccurate"],
  defence: ["recoveries", "interceptions", "tackles", "duelsWon"],
};
const KEEPER_METRICS = [
  "saves",
  "goalsPrevented",
  "passesAccurate",
  "passAccuracy",
];
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
    if (knownIdentity.name && knownIdentity.imageUrl)
      void primeResource(identityKey, () => knownIdentity);
  }, [identityKey, knownIdentity]);
  const missingIdentity = useResource(
    identityKey,
    async () =>
      (await f.client.request(`players/${encodeURIComponent(id)}`)).data,
    Boolean(f.client && (!knownIdentity.name || !knownIdentity.imageUrl)),
  );
  const identity = useMemo(
    () =>
      resolvePlayerIdentity(
        id,
        profile,
        f.data?.appearances,
        missingIdentity.value,
      ),
    [id, profile, f.data?.appearances, missingIdentity.value],
  );
  const honours = usePlayerHonours(id, identity.name);
  const role = playerBio(id)?.position || profile.role?.label;
  const profiles = useMemo(
    () => allProfiles || aggregateSeasonPlayers(scopeRows),
    [allProfiles, scopeRows],
  );
  const [mode, setMode] = useState("total"),
    [minMinutes, setMinMinutes] = useState(450),
    [keys, setKeys] = useState(Object.keys(SCOUT_METRICS)),
    [overviewGroup, setOverviewGroup] = useState("summary");
  const cohorts = useMemo(
    () => buildCohorts(profiles, minMinutes),
    [profiles, minMinutes],
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
  if (!profile.matches) {
    return (
      <Card className="player-season-card research-player-profile">
        <MessiGoats id={id} />
        {identity.name && (
          <PlayerProfileHeading
            id={id}
            identity={identity}
            role={role}
            honours={honours}
          />
        )}
        <PlayerBio id={id} />
        <Empty>
          Aucune performance avec des minutes connues pour ces filtres.
        </Empty>
        <PlayerHonoursSource url={honours.value?.sourceUrl} />
      </Card>
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
  const figures =
    profile.role?.group === "G" && overviewGroup === "summary"
      ? KEEPER_METRICS
      : OVERVIEW_METRICS[overviewGroup];
  return (
    <Card className="player-season-card research-player-profile">
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
      <div className="research-stat-strip">
        <div>
          <button
            type="button"
            className="player-match-count"
            onClick={() => change("matches")}
            aria-label={`Voir les ${number(profile.matches)} matchs joués`}
          >
            <span>Matchs joués</span>
            <strong>{number(profile.matches)}</strong>
          </button>
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
          <span>Note moyenne</span>
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
        {view === "stats" && (
          <>
            <Suspense
              fallback={
                <div className="loading-state" role="status">
                  Chargement des saisons…
                </div>
              }
            >
              <SeasonStats id={id} />
            </Suspense>
            <div className="season-section-heading">
              <h3>Statistiques détaillées</h3>
              <span>{f.season}</span>
            </div>
          </>
        )}
        {view === "stats" && (
          <div className="research-toolbar">
            <Segments
              label="Calcul des statistiques du joueur"
              value={mode}
              onChange={setMode}
              items={STAT_MODES}
            />
          </div>
        )}
        {["stats", "similar"].includes(view) && (
          <div className="research-context">
            <span>
              {number(cohort?.profiles.length || 0)} joueurs au même poste · au
              moins {minMinutes} min
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
              <div className="research-toolbar player-overview-controls">
                <Segments
                  label="Statistiques à afficher"
                  value={overviewGroup}
                  onChange={setOverviewGroup}
                  items={OVERVIEW_GROUPS}
                />
                <Segments
                  label="Calcul des statistiques du joueur"
                  value={mode}
                  onChange={setMode}
                  items={STAT_MODES}
                />
              </div>
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
              <div className="player-profile-facts">
                <PlayerBio id={id} />
                <PlayerDiscipline id={id} season={f.season} />
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
                  {profile.rows.slice(0, 5).map((row) => {
                    const match = f.data.matches.find(
                      (m) => m.id === row.matchId,
                    );
                    const opponent = playerOpponent(match, row.teamId);
                    return (
                      <button
                        className="season-match"
                        key={row.id}
                        onClick={() => f.setPlayer(row.id)}
                      >
                        <span>
                          <strong>{opponent?.name || "Match"}</strong>
                          <small>{date(row.date)}</small>
                        </span>
                        <span>
                          {number(row.minutes)} min
                          <small>Note {number(row.rating, 2)}</small>
                        </span>
                      </button>
                    );
                  })}
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
                            <th>
                              <PerformanceContext
                                leagueIds={[split.leagueId]}
                                league={split.name}
                              />
                            </th>
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
              <SeasonShots
                key={id}
                shots={shots}
                legacyPitchApi={f.manifest?.storage === "aws-relational"}
              />
            </>
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
        </Suspense>
      </div>
      <PlayerHonoursSource url={honours.value?.sourceUrl} />
    </Card>
  );
}
