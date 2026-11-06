"use client";
import React, { useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResource } from "../services/resources.js";
import { loadDiscipline } from "../services/player-discipline.js";
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
  const enabled = Boolean(id && selected.length && f.client && f.statusKnown);
  const resource = useResource(
    `player-discipline:${f.client?.id}:${id}:${key}`,
    () => loadDiscipline(f.client, selected, id),
    enabled,
  );
  const data = resource.value;
  const covered = data?.covered || 0;
  if (!requested) return null;
  return (
    <section className={styles.discipline} aria-label="Discipline">
      <h3>Cartons</h3>
      {selected.length > 0 &&
      (!f.statusKnown || (enabled && resource.loading)) ? (
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
        </>
      ) : (
        <p>Événements disciplinaires indisponibles pour ces matchs.</p>
      )}
    </section>
  );
}
