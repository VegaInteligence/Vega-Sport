import React, { useEffect, useMemo, useState } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, isNumber, number } from "../services/format.js";
import { countAdvanced } from "../services/advanced-filters.js";
import {
  aggregateSeason,
  createSeasonPeerBuilder,
  MIN_SEASON_MINUTES,
  MIN_SEASON_PEERS,
  SEASON_METRICS,
  seasonMetric,
  seasonSections,
} from "../services/season-player.js";
import { Card, Empty, Media, Segments } from "./UI.jsx";

const MODES = [
  ["total", "Totaux"],
  ["perMatch", "Par match"],
  ["per90", "Par 90 minutes"],
];

function metricText(metric, result, mode) {
  if (!isNumber(result.value)) return "—";
  const decimals = metric.ratio
    ? 1
    : mode === "total"
      ? metric.decimals || 0
      : 2;
  return `${number(result.value, decimals)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function SeasonMetric({ profile, metricKey, mode, comparison }) {
  const definition = SEASON_METRICS[metricKey];
  const value = seasonMetric(profile, metricKey, mode);
  const ranking = comparison?.metrics?.[metricKey];
  const incomplete = value.count < profile.matches;
  return (
    <li className="season-metric">
      <span className="season-metric-name">
        {definition.label}
        {incomplete && (
          <small>
            {value.count
              ? `${number(value.count)} / ${number(profile.matches)} matchs renseignés`
              : "Non renseigné"}
          </small>
        )}
      </span>
      <strong>{metricText(definition, value, mode)}</strong>
      {ranking?.percentile != null && (
        <span
          className="season-percentile"
          title={`Centile parmi ${number(ranking.peers)} joueurs du même poste`}
        >
          {number(ranking.percentile)}
          <small>e centile</small>
        </span>
      )}
    </li>
  );
}

function RecentMatches({ profile, matches, onPlayer }) {
  const byId = useMemo(
    () => new Map(matches.map((match) => [match.id, match])),
    [matches],
  );
  return (
    <section className="season-recent">
      <div className="season-section-heading">
        <h3>Derniers matchs</h3>
        <span>Ouvrir une performance</span>
      </div>
      <div className="season-match-list">
        {profile.rows.slice(0, 5).map((row) => {
          const match = byId.get(row.matchId);
          const fixture =
            match?.home?.name && match?.away?.name
              ? `${match.home.name} ${number(match.home.score)} – ${number(match.away.score)} ${match.away.name}`
              : row.team || "Match";
          return (
            <button
              key={row.id || row.matchId}
              className="season-match"
              onClick={() => onPlayer(row.id)}
            >
              <span>
                <strong>{fixture}</strong>
                <small>
                  {row.league} · {date(row.date)}
                </small>
              </span>
              <span>
                {number(row.minutes)} min
                {isNumber(row.rating) && (
                  <small>Note {number(row.rating, 2)}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function PlayerSeasonProfile({ id, rows, scopeRows }) {
  const f = useFootball();
  const [mode, setMode] = useState("perMatch");
  const [comparison, setComparison] = useState(null);
  const profile = useMemo(() => aggregateSeason(rows, id), [rows, id]);
  useEffect(() => {
    setComparison(null);
    if (!profile.role || profile.minutes < MIN_SEASON_MINUTES) return;
    let builder = createSeasonPeerBuilder(scopeRows, profile);
    let active = true,
      handle;
    const idle = window.requestIdleCallback;
    const schedule = (callback) =>
      idle
        ? idle(callback, { timeout: 500 })
        : setTimeout(() => callback(null), 0);
    const cancel = window.cancelIdleCallback || clearTimeout;
    const run = (deadline) => {
      const stop = performance.now() + 8;
      let done = false;
      do {
        done = builder.step(1000);
      } while (
        !done &&
        performance.now() < stop &&
        (!deadline || deadline.didTimeout || deadline.timeRemaining() > 1)
      );
      if (done) {
        const result = builder.result();
        builder = null;
        if (active) setComparison(result);
      } else if (active) handle = schedule(run);
    };
    handle = schedule(run);
    return () => {
      active = false;
      cancel(handle);
    };
  }, [scopeRows, profile]);

  if (!profile.matches)
    return (
      <Card title="Fiche joueur" className="player-season-card">
        <Empty>
          Aucune performance avec des minutes connues pour ces filtres.
        </Empty>
      </Card>
    );
  const league = f.competitions.find((item) => item.id === f.filters.league);
  const figures =
    profile.role?.group === "G"
      ? ["saves", "goalsPrevented", "passesAccurate", "passAccuracy"]
      : ["goals", "assists", "xg", "xa"];
  const comparisonText = !profile.role
    ? "Poste non renseigné : comparaison par poste indisponible."
    : profile.minutes < MIN_SEASON_MINUTES
      ? `Moins de ${number(MIN_SEASON_MINUTES)} minutes jouées : centiles non affichés.`
      : !comparison
        ? "Calcul de la comparaison par poste…"
        : comparison.peers < MIN_SEASON_PEERS
          ? "Pas assez de joueurs du même poste dans ce périmètre pour calculer des centiles."
          : `Centiles par 90 minutes ou en %, parmi les ${profile.role.peers} ayant au moins ${number(MIN_SEASON_MINUTES)} minutes et une statistique renseignée pour tous leurs matchs.`;
  return (
    <Card className="player-season-card">
      <div className="season-player-heading">
        <div className="season-player-identity">
          <Media
            name={profile.name}
            url={profile.imageUrl}
            className="player-avatar season-player-portrait"
          />
          <div>
            <p className="season-player-kicker">
              Fiche joueur · saison {f.season}
            </p>
            <h2>{profile.name}</h2>
            <p>
              {[profile.role?.label, profile.teams.join(" · ")]
                .filter(Boolean)
                .join(" · ") || "Équipe non renseignée"}
            </p>
          </div>
        </div>
        <div className="season-player-sample">
          <strong>
            {number(profile.matches)}{" "}
            <span>match{profile.matches > 1 ? "s" : ""}</span>
          </strong>
          <strong>
            {number(profile.minutes)} <span>minutes</span>
          </strong>
          {isNumber(profile.rating) && (
            <strong>
              {number(profile.rating, 2)}{" "}
              <span>
                note PitchAPI moyenne
                {profile.ratingCount < profile.matches
                  ? ` · ${number(profile.ratingCount)} / ${number(profile.matches)} matchs`
                  : ""}
              </span>
            </strong>
          )}
        </div>
      </div>
      <div className="season-player-toolbar">
        <p>
          {league
            ? league.name
            : f.focus === "europe"
              ? "Top 7 Europe + UEFA"
              : "Toutes les compétitions chargées"}
          {f.filters.minutes > 1
            ? ` · ${number(f.filters.minutes)} min ou plus par match`
            : ""}
          {countAdvanced(f.filters.advanced) > 0
            ? " · Filtres avancés appliqués"
            : ""}
        </p>
        <Segments
          label="Calcul des statistiques du joueur"
          value={mode}
          items={MODES}
          onChange={setMode}
        />
      </div>
      <div className="season-player-figures">
        {figures.map((key) => {
          const metric = SEASON_METRICS[key],
            value = seasonMetric(profile, key, mode);
          return (
            <div key={key}>
              <span>{metric.label}</span>
              <strong>{metricText(metric, value, mode)}</strong>
              {value.count < profile.matches && (
                <small>
                  {value.count
                    ? `${number(value.count)} / ${number(profile.matches)} matchs`
                    : "Non renseigné"}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <section className="season-player-profile">
        <div className="season-section-heading">
          <h3>Profil de saison</h3>
          <span role="status">{comparisonText}</span>
        </div>
        <div className="season-profile-grid">
          {seasonSections(profile.role?.group).map((section) => (
            <section key={section.id} className="season-profile-section">
              <h4>{section.title}</h4>
              <ul>
                {section.keys.map((key) => (
                  <SeasonMetric
                    key={key}
                    profile={profile}
                    metricKey={key}
                    mode={mode}
                    comparison={comparison}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="season-data-note">
          Les valeurs absentes ne comptent pas comme zéro. Les moyennes et les
          valeurs par 90 utilisent uniquement les matchs où la statistique et
          les minutes sont renseignées.
          {profile.unknownMinutes > 0 &&
            ` ${number(profile.unknownMinutes)} performance(s) sans minutes connues ne sont pas incluses.`}
        </p>
      </section>
      <RecentMatches
        profile={profile}
        matches={f.data.matches}
        onPlayer={f.setPlayer}
      />
    </Card>
  );
}
