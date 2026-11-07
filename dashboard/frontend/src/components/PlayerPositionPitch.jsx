import React from "react";
import { number } from "../services/format.js";
import ObservedValue from "./PlayerObservedValue.jsx";
import styles from "./PlayerPositionPitch.module.css";

export default function PlayerPositionPitch({ positions = [] }) {
  const mapped = positions.filter(
    (position) => Number.isFinite(position.x) && Number.isFinite(position.y),
  );
  return (
    <section
      className={styles.card}
      aria-labelledby="player-position-pitch-title"
    >
      <div className={styles.heading}>
        <h4 id="player-position-pitch-title">Postes joués</h4>
        <p>Buts par poste renseigné sur la feuille de match.</p>
      </div>
      {positions.length ? (
        <div className={styles.content}>
          <div className={styles.pitchWrap}>
            <div className={styles.direction} aria-hidden="true">
              ↑ Attaque
            </div>
            <div
              className={styles.pitch}
              role="img"
              aria-label="Schéma des lignes jouées, attaque vers le haut"
            >
              <svg
                className={styles.markings}
                viewBox="0 0 100 140"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect x="5" y="4" width="90" height="132" />
                <path d="M5 70 H95 M25 4 V23 H75 V4 M36 4 V12 H64 V4 M25 136 V117 H75 V136 M36 136 V128 H64 V136" />
                <circle cx="50" cy="70" r="12" />
                <circle cx="50" cy="70" r="0.8" className={styles.spot} />
                <circle cx="50" cy="17" r="0.8" className={styles.spot} />
                <circle cx="50" cy="123" r="0.8" className={styles.spot} />
              </svg>
              {mapped.map((position) => (
                <div
                  key={position.key}
                  className={styles.marker}
                  data-scored={position.goals.value > 0 ? "true" : undefined}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                >
                  <span className={styles.markerLabel}>
                    {position.shortLabel}
                  </span>
                  <strong>
                    <ObservedValue
                      {...position.goals}
                      total={position.matches}
                    />
                  </strong>
                </div>
              ))}
              {!mapped.length && (
                <p className={styles.pitchEmpty}>
                  Position sur le terrain indisponible
                </p>
              )}
            </div>
          </div>
          <div className={styles.list}>
            <div className={styles.tableScroll}>
              <table aria-label="Statistiques par poste joué">
                <thead>
                  <tr>
                    <th scope="col">Poste</th>
                    <th scope="col">Matchs</th>
                    <th scope="col">Buts</th>
                    <th scope="col">Passes déc.</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.key}>
                      <th scope="row">
                        <span className={styles.rowLabel}>
                          {position.label}
                        </span>
                      </th>
                      <td>{number(position.matches)}</td>
                      <td>
                        <ObservedValue
                          {...position.goals}
                          total={position.matches}
                        />
                      </td>
                      <td>
                        <ObservedValue
                          {...position.assists}
                          total={position.matches}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <p className={styles.empty}>
          Aucun poste renseigné pour les matchs collectés.
        </p>
      )}
    </section>
  );
}
