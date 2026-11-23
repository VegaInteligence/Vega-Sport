import Link from "next/link";
import React, { Suspense, lazy, useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, date, isNumber } from "../services/format.js";
import { Modal, Media, Segments, Skeleton } from "./UI.jsx";
import { GRADE_HIGH, GRADE_LOW } from "../services/grades.js";
import PlayerData from "./PlayerData.jsx";
import MessiGoats from "./MessiGoats.jsx";
import {
  keyFigures,
  matchGradeRank,
  MIN_PEER_MINUTES,
  performanceProfile,
  positionOf,
} from "../services/player-profile.js";
import { finishedReadAppearances } from "../services/season-player.js";
import { Term } from "./Hint.jsx";
// His match (moments, shots, activity zone) is read only once a dialog opens.
const PlayerMatchSections = lazy(() => import("./PlayerMatchSections.jsx"));
/** True on the page of that very match, where « Voir le match » would lead nowhere. */
const onMatchPage = (matchId) =>
  typeof window !== "undefined" &&
  /^\/matchs\/?$/.test(window.location.pathname) &&
  new URLSearchParams(window.location.search).get("id") === matchId;
export const metrics = [
  ["minutes", "Minutes"],
  ["grade", "Note Vega"],
  ["goals", "Buts"],
  ["assists", "Passes décisives"],
  ["xg", "xG"],
  ["xa", "xA"],
  ["shots", "Tirs"],
  ["chancesCreated", "Occasions créées"],
  ["passesAccurate", "Passes réussies"],
  ["passesAttempted", "Passes tentées"],
  ["touches", "Ballons touchés"],
  ["defensiveActions", "Actions défensives"],
  ["interceptions", "Interceptions"],
  ["duelsWon", "Duels gagnés"],
  ["saves", "Arrêts"],
  ["goalsPrevented", "Buts évités"],
];
const ordinal = (n) => (n === 1 ? "1re" : `${n}e`);
const tier = (p) =>
  p >= 90 ? "is-elite" : p >= 70 ? "is-strong" : p >= 40 ? "is-mid" : "is-low";
const figure = (value, decimals, unit = "") =>
  isNumber(value) ? `${number(value, decimals)}${unit}` : "—";
function ProfileSection({ section, peers }) {
  return (
    <section className="pc-section">
      <h4>{section.title}</h4>
      <ul>
        {section.metrics.map((m) => (
          <li key={m.key}>
            <span className="pc-metric-label">{m.label}</span>
            <strong className="pc-metric-value">
              {figure(m.value, m.decimals, m.unit)}
            </strong>
            <span
              className={`pc-bar ${m.percentile == null ? "is-empty" : tier(m.percentile)}`}
              title={
                m.percentile == null
                  ? "Centile indisponible"
                  : `Au-dessus de ${m.percentile} % des ${peers}`
              }
            >
              <i style={{ width: `${m.percentile ?? 0}%` }} />
            </span>
            <span
              className={`pc-pct ${m.percentile == null ? "" : tier(m.percentile)}`}
            >
              {m.percentile ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function PlayerDialog() {
  const f = useFootball(),
    [view, setView] = useState("overview"),
    remote = f.performanceSummary,
    row = remote ? remote.value?.data.row : f.byAppearance.get(f.player),
    appearances = f.performanceData.appearances;
  // The opened performance is shown whatever its match's status, and ranked among the season's
  // finished performances (VI-23 stage 7, §16.1); its match rank reads every observation.
  const peers = useMemo(
    () => (f.compactMode ? [] : finishedReadAppearances(f.performanceData)),
    [f.compactMode, f.performanceData],
  );
  const profile = useMemo(
      () =>
        remote
          ? remote.value?.data.profile
          : row
            ? performanceProfile(row, peers)
            : null,
      [row, peers, remote],
    ),
    rank = useMemo(
      () =>
        remote
          ? remote.value?.data.rank
          : row && !f.compactMode
            ? matchGradeRank(row, appearances)
            : null,
      [row, appearances, remote, f.compactMode],
    );
  if (!row && f.player && f.deferredPerformance) {
    const state = f.deferredPerformance;
    if (state.loading)
      return (
        <Modal title="Performance du joueur" onClose={() => f.setPlayer(null)}>
          <Skeleton label="Chargement de la performance…" lines={2} />
        </Modal>
      );
    return (
      <Modal title="Performance du joueur" onClose={() => f.setPlayer(null)}>
        <div role="alert">
          {state.error || "Cette performance est indisponible."}
          {state.error && <button onClick={state.retry}>Réessayer</button>}
        </div>
      </Modal>
    );
  }
  if (!row) return null;
  const match =
    remote?.value?.data.match ||
    f.performanceData.matches.find((m) => m.id === row.matchId);
  const competition =
    remote?.value?.data.competition ||
    f.performanceData.competitions.find((c) => c.id === row.leagueId);
  const line = positionOf(row);
  const close = () => f.setPlayer(null);
  const role =
    row.starter === true
      ? "Titulaire"
      : row.starter === false
        ? "Entré en jeu"
        : "Participation";
  return (
    <Modal
      title={row.name}
      onClose={close}
      className="player-performance"
      header={
        <div className="pc-head">
          <div className="pc-hero">
            <Media
              name={row.name}
              url={row.imageUrl}
              className="player-avatar pc-portrait"
            />
            <div className="pc-identity">
              <h2>{row.name}</h2>
              <p className="pc-meta">
                <span className="pc-club">
                  <span>Club lors de ce match :</span>
                  {match && (
                    <Media
                      name={row.team}
                      url={
                        (match.home.id === row.teamId ? match.home : match.away)
                          .imageUrl
                      }
                    />
                  )}
                  {row.team}
                </span>
                {line && <span>{line.label}</span>}
                {row.shirtNumber && <span>N° {row.shirtNumber}</span>}
              </p>
            </div>
            {isNumber(row.grade) && (
              <div
                className={`pc-rating${row.grade >= GRADE_HIGH ? " is-high" : row.grade < GRADE_LOW ? " is-low" : ""}`}
                title="Note Vega du match sur 100 : 50 est un match ordinaire du poste"
              >
                <strong>{number(row.grade, 0)}</strong>
                <span>Note Vega</span>
                {rank && rank.total > 1 && (
                  <small>
                    {rank.rank === 1
                      ? "Meilleure note du match"
                      : `${ordinal(rank.rank)} note sur ${rank.total}`}
                  </small>
                )}
              </div>
            )}
          </div>
          {match && (
            <div className="pc-fixture">
              <span className="pc-fixture-competition">
                {competition && (
                  <Media name={competition.name} url={competition.imageUrl} />
                )}
                {row.league}
                <span>{date(row.date)}</span>
              </span>
              <span className="pc-fixture-score">
                {[match.home, match.away].map((team, i) => (
                  <React.Fragment key={team.id}>
                    {i === 1 && (
                      <b>
                        {number(match.home.score)}
                        <i>–</i>
                        {number(match.away.score)}
                      </b>
                    )}
                    <span
                      className={`pc-fixture-team${team.id === row.teamId ? " is-own" : ""}${i ? " away" : ""}`}
                    >
                      <Media name={team.name} url={team.imageUrl} />
                      {team.name}
                    </span>
                  </React.Fragment>
                ))}
              </span>
              <span className="pc-fixture-role">
                {role}
                {isNumber(row.minutes) && <b>{number(row.minutes)} min</b>}
              </span>
            </div>
          )}
        </div>
      }
      footer={
        <>
          <button
            className="button button-secondary"
            onClick={() => f.toggle(row.id)}
          >
            <Icon name={f.comparison.includes(row.id) ? "check" : "players"} />
            {f.comparison.includes(row.id)
              ? "Retirer de la comparaison"
              : "Comparer ce joueur"}
          </button>
          <div className="performance-links">
            <Link
              className={`button ${onMatchPage(row.matchId) ? "button-primary" : "button-ghost"}`}
              href={f.href("/joueurs/", { id: row.playerId, q: "" })}
              onClick={close}
            >
              Fiche joueur
            </Link>
            {!onMatchPage(row.matchId) && (
              <Link
                className="button button-primary"
                href={f.href("/matchs/", { id: row.matchId })}
                onClick={close}
              >
                Voir le match
                <Icon name="arrow" />
              </Link>
            )}
          </div>
        </>
      }
    >
      <MessiGoats id={row.playerId} />
      <div className="pc-tabs">
        <Segments
          label="Vue de la performance"
          value={view}
          onChange={setView}
          items={[
            ["overview", "Synthèse"],
            ["stats", "Toutes les stats"],
          ]}
        />
      </div>
      {!row.statsReliable && (
        <p role="status" className="notice notice-warning">
          Certaines statistiques sont signalées comme incohérentes.
        </p>
      )}
      {view !== "overview" ? (
        <PlayerData key={row.id} row={row} mode={view} />
      ) : (
        <>
          <dl className="pc-figures">
            {keyFigures(row).map((k) => (
              <div key={k.key}>
                <dt>{k.label}</dt>
                <dd className={isNumber(k.value) ? "" : "is-missing"}>
                  {figure(k.value, k.decimals, k.unit)}
                </dd>
              </div>
            ))}
          </dl>
          {row.matchId && row.playerId && (
            <Suspense fallback={null}>
              <PlayerMatchSections match={match} row={row} />
            </Suspense>
          )}
          {profile.sections.length > 0 && (
            <section
              className="pc-profile"
              aria-label="Profil de la performance"
            >
              <header>
                <h3>Profil de la performance</h3>
                <p>
                  {profile.peers >= 30
                    ? `Centile parmi ${number(profile.peers)} performances de ${profile.line.peers} cette saison, ${MIN_PEER_MINUTES} min ou plus.`
                    : "Échantillon trop réduit pour situer cette performance."}
                  {profile.peers >= 30 &&
                    isNumber(row.minutes) &&
                    row.minutes < MIN_PEER_MINUTES &&
                    ` Avec ${number(row.minutes)} min jouées, les volumes sont mécaniquement plus bas.`}
                </p>
              </header>
              <div className="pc-sections">
                {profile.sections.map((section) => (
                  <ProfileSection
                    key={section.id}
                    section={section}
                    peers={profile.line.peers}
                  />
                ))}
              </div>
              {profile.missing.length > 0 && (
                <p className="pc-missing">
                  Non renseignés : {profile.missing.join(", ")}.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
export function Comparison() {
  const f = useFootball(),
    rows = f.comparisonRows;
  return (
    <>
      {rows.length > 0 && (
        <aside
          className="compare-tray"
          aria-label="Joueurs sélectionnés pour comparaison"
        >
          <span>
            Comparer <strong>{rows.length}/3</strong>
          </span>
          {rows.map((r) => (
            <span className="compare-pill" key={r.id}>
              {r.name}
              <button
                aria-label={`Retirer ${r.name}`}
                onClick={() => f.toggle(r.id)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="button button-primary"
            disabled={rows.length < 2}
            onClick={() => f.setComparing(true)}
          >
            Comparer
          </button>
          <button
            className="button button-ghost"
            aria-label="Vider la comparaison"
            onClick={() => f.setComparison([])}
          >
            Vider
          </button>
        </aside>
      )}
      {f.comparing && (
        <Modal
          title="Comparaison de performances"
          onClose={() => f.setComparing(false)}
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th><Term>Indicateur</Term></th>
                  {rows.map((r) => (
                    <th key={r.id}>
                      {r.name}
                      <br />
                      {r.team}
                      <br />
                      {date(r.date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map(([key, label]) => (
                  <tr key={key}>
                    <th>{label}</th>
                    {rows.map((r) => (
                      <td key={r.id}>
                        {number(
                          r[key],
                          ["xg", "xa", "goalsPrevented"].includes(key)
                            ? 2
                            : 0,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
