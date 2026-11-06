import React from "react";
import { playerBio } from "../services/player-bio.js";
import styles from "./PlayerBio.module.css";

export default function PlayerBio({ id }) {
  const bio = playerBio(id);
  if (!bio) return null;
  return (
    <section className={styles.panel} aria-label="Identité du joueur">
      <h3>Identité</h3>
      <dl className={styles.grid}>
        <div>
          <dt>Nom complet</dt>
          <dd>{bio.fullName}</dd>
        </div>
        <div>
          <dt>Taille</dt>
          <dd>{bio.height}</dd>
        </div>
        <div>
          <dt>Nationalité</dt>
          <dd>{bio.nationality}</dd>
        </div>
        <div>
          <dt>Pied fort</dt>
          <dd>{bio.foot}</dd>
        </div>
        <div>
          <dt>Poste</dt>
          <dd>{bio.position}</dd>
        </div>
      </dl>
      <details className="player-profile-source">
        <summary>Sources de l’identité</summary>
        <ul>
          <li>
            <a href={bio.heightSource} target="_blank" rel="noreferrer">
              LaLiga · nom et taille
            </a>
          </li>
          <li>
            <a href={bio.identitySource} target="_blank" rel="noreferrer">
              UEFA · pied fort
            </a>
          </li>
          <li>
            <a href={bio.nationalitySource} target="_blank" rel="noreferrer">
              UEFA · nationalité
            </a>
          </li>
          <li>
            <a href={bio.positionSource} target="_blank" rel="noreferrer">
              Transfermarkt · poste
            </a>
          </li>
        </ul>
      </details>
    </section>
  );
}
