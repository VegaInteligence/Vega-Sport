import Link from "next/link";
import React from "react";
import Icon from "./Icon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number, date, isNumber } from "../services/format.js";
import { Modal, Rating, Media, StructuredData, AsyncState } from "./UI.jsx";
import { useResource, json } from "../services/resources.js";
export const metrics = [
  ["minutes", "Minutes"],
  ["rating", "Note PitchAPI"],
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
  ["goalsPrevented", "Buts évités (PitchAPI)"],
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
    <Modal title="Fiche PitchAPI" onClose={onClose}>
      <AsyncState resource={resource}>
        {(value) => <StructuredData value={value} />}
      </AsyncState>
    </Modal>
  );
}
const performanceGroups = [
  {
    title: "Attaque & création",
    icon: "target",
    fields: [
      ["xg", "Buts attendus · xG"],
      ["xa", "Passes attendues · xA"],
      ["shotsOnTarget", "Tirs cadrés"],
      ["chancesCreated", "Occasions créées"],
      ["bigChancesCreated", "Grosses occasions créées"],
      ["touchesBox", "Ballons dans la surface"],
    ],
  },
  {
    title: "Ballon & distribution",
    icon: "activity",
    fields: [
      ["passesAccurate", "Passes réussies"],
      ["passesAttempted", "Passes tentées"],
      ["touches", "Ballons touchés"],
      ["passesFinalThird", "Passes dernier tiers"],
      ["dribbles", "Dribbles réussis"],
    ],
  },
  {
    title: "Défense & duels",
    icon: "shield",
    fields: [
      ["defensiveActions", "Actions défensives"],
      ["tackles", "Tacles"],
      ["interceptions", "Interceptions"],
      ["recoveries", "Récupérations"],
      ["duelsWon", "Duels gagnés"],
      ["duelsLost", "Duels perdus"],
      ["clearances", "Dégagements"],
      ["blocks", "Tirs bloqués"],
    ],
  },
];
function PerformanceMetrics({ fields, row }) {
  return (
    <dl className="performance-stat-list">
      {fields.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd className={!isNumber(row[key]) ? "missing-value" : ""}>
            {number(
              row[key],
              ["xg", "xa", "xgot", "npxg", "goalsPrevented"].includes(key)
                ? 2
                : 0,
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function PlayerDialog() {
  const f = useFootball(),
    row = f.byAppearance.get(f.player);
  if (!row) return null;
  const match = f.data.matches.find((m) => m.id === row.matchId);
  const side =
    match && (match.home.id === row.teamId ? match.home : match.away);
  const keeperFields = [
    ["saves", "Arrêts"],
    ["goalsPrevented", "Buts évités · PitchAPI"],
  ];
  const close = () => f.setPlayer(null);
  return (
    <Modal
      title={row.name}
      onClose={close}
      className="player-performance"
      header={
        <div className="performance-hero">
          <Media
            name={row.name}
            url={row.imageUrl}
            className="player-avatar performance-portrait"
          />
          <div className="performance-identity">
            <div className="performance-context">
              {row.league}
              <span>·</span>
              {date(row.date)}
            </div>
            <h2>{row.name}</h2>
            <div className="performance-team">
              {side && <Media name={side.name} url={side.imageUrl} />}
              {row.team}
              {row.shirtNumber && (
                <span className="shirt-badge">N° {row.shirtNumber}</span>
              )}
            </div>
          </div>
          <div className="performance-rating">
            <span>Note PitchAPI</span>
            <strong>
              {number(row.rating, 2)}
              <small>/10</small>
            </strong>
          </div>
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
              aria-label="Toutes les performances"
              href={f.href("/joueurs/", { id: row.playerId })}
              onClick={close}
            >
              Performances
              <Icon name="external" />
            </Link>
            <Link
              className="button button-primary"
              href={f.href("/matchs/", { id: row.matchId })}
              onClick={close}
            >
              Explorer le match
              <Icon name="arrow" />
            </Link>
          </div>
        </>
      }
    >
      {match && (
        <div className="performance-fixture">
          <span>
            {row.starter === true
              ? "Titulaire"
              : row.starter === false
                ? "Remplaçant"
                : "Participation"}
          </span>
          <div>
            <span>{match.home.name}</span>
            <b>
              {number(match.home.score)} <i>–</i> {number(match.away.score)}
            </b>
            <span>{match.away.name}</span>
          </div>
        </div>
      )}
      {!row.statsReliable && (
        <p role="status" className="notice notice-warning">
          Statistiques partielles : les valeurs suspectes restent absentes.
        </p>
      )}
      <section
        className="performance-kpis"
        aria-label="Chiffres clés du joueur"
      >
        {[
          ["minutes", "Minutes", "timer"],
          ["goals", "Buts", "goal"],
          ["assists", "Passes décisives", "arrow"],
          ["shots", "Tirs", "target"],
        ].map(([key, label, icon]) => (
          <div key={key}>
            <Icon name={icon} />
            <strong>{number(row[key])}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>
      <div className="performance-groups">
        {performanceGroups.map((group) => (
          <section className="performance-group" key={group.title}>
            <h3>
              <Icon name={group.icon} />
              {group.title}
            </h3>
            <PerformanceMetrics fields={group.fields} row={row} />
          </section>
        ))}
        <section className="performance-group performance-quality">
          <h3>
            <Icon name="ball" />
            Qualité des occasions
          </h3>
          <PerformanceMetrics
            fields={[
              ["npxg", "xG hors penalty"],
              ["xgot", "xG cadrés · xGOT"],
            ]}
            row={row}
          />
          <details
            className="performance-keeper"
            open={isNumber(row.saves) || isNumber(row.goalsPrevented)}
          >
            <summary>
              Gardien
              <Icon name="chevron" />
            </summary>
            <PerformanceMetrics fields={keeperFields} row={row} />
          </details>
        </section>
      </div>
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
