"use client";
import React, { useEffect, useMemo, useRef } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadDiscipline } from "../services/player-discipline.js";
import {
  compactGeneration,
  readPlayerDiscipline,
  supportsCompactRead,
} from "../services/compact-reads.js";
import styles from "./PlayerDiscipline.module.css";

export default function PlayerDiscipline({ id, rows = [], matches = [] }) {
  const f = useFootball();
  const { selected, requested } = useMemo(() => {
    const ids = new Set(rows.map((row) => row.matchId).filter(Boolean));
    const byId = new Map(
      matches
        .filter((match) => ids.has(match.id))
        .map((match) => [match.id, match]),
    );
    return { selected: [...byId.values()], requested: ids.size };
  }, [rows, matches]);
  const key = selected
    .map((match) => match.id)
    .sort()
    .join(",");
  const compact = supportsCompactRead(f.manifest, "discipline"),
    nativeIds = selected
      .map((match) => match.id)
      .filter((value) => /^m_[A-Za-z0-9]{6}$/.test(value)),
    generation = compactGeneration(f.manifest),
    enabled = Boolean(
      id &&
      (compact
        ? nativeIds.length
        : selected.length && f.client && f.statusKnown),
    );
  const resource = useResource(
    compact
      ? `compact-discipline:${f.season}:${id}:${nativeIds.slice().sort().join(",")}:${generation}`
      : `player-discipline:${f.client?.id}:${id}:${key}:${generation}`,
    ({ signal }) =>
      (compact
        ? readPlayerDiscipline(f.manifest, f.season, id, nativeIds, { signal })
        : loadDiscipline(f.client, selected, id, 3, { signal })
      ).catch((error) => {
        if (error.status === 409)
          void Promise.resolve()
            .then(() => f.refreshManifest?.())
            .catch(() => {});
        throw error;
      }),
    enabled,
  );
  const lastManifest = useRef(f.manifest);
  useEffect(() => {
    const revalidated = lastManifest.current !== f.manifest;
    lastManifest.current = f.manifest;
    // Event publications can change independently of the core generation.
    // Reuse the Provider's visible/focus refresh cadence; do not add a timer.
    if (compact && enabled && revalidated)
      void resource.revalidate().catch(() => {});
  }, [f.manifest, compact, enabled, resource.revalidate]);
  const data = resource.value;
  const covered = data?.covered || 0;
  if (!requested) return null;
  return (
    <section className={styles.discipline} aria-label="Discipline">
      <h3>Cartons</h3>
      {(!compact && selected.length > 0 && !f.statusKnown) ||
      (enabled && resource.loading) ? (
        <p role="status">Chargement des événements…</p>
      ) : data && covered ? (
        <>
          <dl className={styles.counts}>
            <div>
              <dt>
                <i className={styles.yellow} aria-hidden="true" />
                Jaunes
              </dt>
              <dd>{data.yellow}</dd>
            </div>
            <div>
              <dt>
                <i className={styles.red} aria-hidden="true" />
                Rouges directs
              </dt>
              <dd>{data.directRed}</dd>
            </div>
            <div>
              <dt>
                <i className={styles.double} aria-hidden="true" />
                Deuxièmes jaunes
              </dt>
              <dd>{data.secondYellow}</dd>
            </div>
          </dl>
          <p>
            Cartons relevés dans les événements disponibles sur {covered} des{" "}
            {requested} matchs.
          </p>
          <p>
            Décompte par événements : un rouge apparié à un deuxième jaune au
            même instant n’est pas compté comme rouge direct.
          </p>
        </>
      ) : (
        <p>Événements disciplinaires indisponibles pour ces matchs.</p>
      )}
      {(resource.error || resource.refreshError) && (
        <p role="alert">
          {resource.error || resource.refreshError}{" "}
          <button onClick={resource.retry}>Réessayer</button>
        </p>
      )}
    </section>
  );
}
