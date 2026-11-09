"use client";
import React, { useId, useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import useCompactRead from "../hooks/useCompactRead.js";
import useVisibleIntent from "../hooks/useVisibleIntent.js";
import {
  compactGeneration,
  supportsCompactRead,
} from "../services/compact-reads.js";
import { number } from "../services/format.js";
import { HeatmapPitch } from "./PlayerScoutCharts.jsx";
import s from "./PlayerScout.module.css";

export default function PlayerPresenceCard({ id, rows }) {
  const f = useFootball();
  const heading = useId();
  const matches = useMemo(
    () =>
      [
        ...new Set(
          rows
            .filter(
              (row) =>
                row.playerId === id &&
                (row.minutes == null || row.minutes > 0) &&
                /^m_[A-Za-z0-9]{6}$/.test(row.matchId),
            )
            .map((row) => row.matchId),
        ),
      ]
        .sort()
        .join(","),
    [id, rows],
  );
  const meta = f.data?.meta;
  const generation = compactGeneration(f.manifest);
  const ready =
    Boolean(matches) &&
    supportsCompactRead(f.manifest, "presence") &&
    meta?.complete === true &&
    meta.actor?.kind === "player" &&
    meta.actor.id === id &&
    meta.currentSeason === f.season &&
    meta.generation === generation;
  const [ref, visible] = useVisibleIntent(
    `${id}:${f.season}:${matches}`,
    ready,
  );
  const presence = useCompactRead(
    "presence",
    { player: id, season: f.season, matches, generation },
    { enabled: visible, refreshManifest: f.refreshManifest },
  );
  const data = ready ? presence.value?.data : null;
  const singleMatch = data?.requested === 1;
  let content = (
    <p className={s.note}>
      {data?.requested
        ? singleMatch
          ? "Aucune carte exploitable pour ce match."
          : `Aucune carte exploitable sur ${number(data.requested)} matchs examinés.`
        : "Aucune carte disponible sur ce périmètre."}
    </p>
  );
  if (data?.cells?.length) {
    const grid = Array.from({ length: data.width }, () =>
      Array(data.length).fill(0),
    );
    for (const [x, y, actions] of data.cells) grid[y][x] = actions;
    content = (
      <>
        <HeatmapPitch grid={grid} />
        <p className={s.note} style={{ marginTop: 12 }}>
          {number(data.actions)}{" "}
          {data.actions === 1 ? "action localisée" : "actions localisées"} ·{" "}
          {number(data.covered)} sur {number(data.requested)}{" "}
          {singleMatch ? "match couvert" : "matchs couverts"}
        </p>
      </>
    );
  } else if (ready && presence.error) {
    content = (
      <p className={s.note} role="alert">
        Carte indisponible. <button onClick={presence.retry}>Réessayer</button>
      </p>
    );
  } else if (ready && !data) {
    content = (
      <p className={s.note} role="status">
        Chargement des zones de présence…
      </p>
    );
  }
  return (
    <section className={s.card} ref={ref} aria-labelledby={heading}>
      <div className={s.cardHead}>
        <div>
          <h3 id={heading}>Zones de présence</h3>
          <p>Actions localisées par PitchAPI · attaque vers la droite</p>
        </div>
      </div>
      {content}
    </section>
  );
}
