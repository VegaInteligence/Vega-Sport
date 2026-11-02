import Link from "next/link";
import React, { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, date, isNumber } from "../services/format.js";
import { Modal, Rating, Media, AsyncState, Segments } from "./UI.jsx";
import DataExplorer from "./DataExplorer.jsx";
import PlayerData from "./PlayerData.jsx";
import { useResource, json } from "../services/resources.js";
import {
  keyFigures,
  matchRatingRank,
  MIN_PEER_MINUTES,
  performanceProfile,
  positionOf,
} from "../services/player-profile.js";
export const metrics = [
  ["minutes", "Minutes"],
  ["rating", "Note"],
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
export function ProfileDialog({ id, kind, onClose }) {
  const resource = useResource(`profile:${kind}:${id}`, async () => {
    try {
      return (await json(`/api/archive/profiles/${kind}/${id}`)).data;
    } catch {
      return (await json(`/api/pitchapi/${kind}/${id}`)).data;
    }
  });
  return (
    <Modal title="Fiche détaillée" onClose={onClose}>
      <AsyncState resource={resource}>
        {(value) => <DataExplorer value={value} />}
      </AsyncState>
    </Modal>
  );
}
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
    row = f.byAppearance.get(f.player),
    appearances = f.data.appearances;
  const profile = useMemo(
      () => (row ? performanceProfile(row, appearances) : null),
      [row, appearances],
    ),
    rank = useMemo(
      () => (row ? matchRatingRank(row, appearances) : null),
      [row, appearances],
    );
  if (!row) return null;
  const match = f.data.matches.find((m) => m.id === row.matchId);
  const competition = f.data.competitions.find((c) => c.id === row.leagueId);
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
            {isNumber(row.rating) && (
              <div
                className={`pc-rating${row.rating >= 8 ? " is-high" : row.rating < 6 ? " is-low" : ""}`}
              >
                <strong>{number(row.rating, 2)}</strong>
                <span>Note</span>
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
              className="button button-ghost"
              href={f.href("/joueurs/", { id: row.playerId, q: "" })}
              onClick={close}
            >
              Fiche joueur
            </Link>
            <Link
              className="button button-primary"
              href={f.href("/matchs/", { id: row.matchId })}
              onClick={close}
            >
              Voir le match
              <Icon name="arrow" />
            </Link>
          </div>
        </>
      }
    >
      <div className="pc-tabs">
        <Segments
          label="Vue de la performance"
          value={view}
          onChange={setView}
          items={[
            ["overview", "Synthèse"],
            ["stats", "Toutes les stats"],
            ["data", "Données brutes"],
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
    rows = f.comparison.map((id) => f.byAppearance.get(id)).filter(Boolean);
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
                  <th>Indicateur</th>
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
                          ["xg", "xa", "rating", "goalsPrevented"].includes(key)
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
