"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { date, isNumber, number } from "../services/format.js";
import { shotOutcome, shotPosition } from "../services/season-shots.js";
import Icon from "./Icon.jsx";
import { Empty } from "./UI.jsx";
import styles from "./SeasonShots.module.css";

const PITCH_LENGTH = 105;
const PITCH_WIDTH = 68;
const HALF_PITCH = PITCH_LENGTH / 2;
const FILTERS = [
  { value: "all", label: "Tous les tirs", color: styles.all },
  { value: "But", label: "Buts", color: styles.goal },
  { value: "Cadré sans but", label: "Cadrés sans but", color: styles.target },
  { value: "Non cadré", label: "Non cadrés", color: styles.miss },
  { value: "Bloqué", label: "Bloqués", color: styles.blocked },
  { value: "Poteau", label: "Poteaux", color: styles.post },
  {
    value: "Contre son camp",
    label: "Contre son camp",
    color: styles.own,
    optional: true,
  },
  {
    value: "Résultat inconnu",
    label: "Résultat inconnu",
    color: styles.unknown,
    optional: true,
  },
];
const COLORS = new Map(FILTERS.map(({ value, color }) => [value, color]));
const distanceLabel = (pos) =>
  pos?.distance != null ? `${number(pos.distance, 1)}\u00a0m` : "—";
const minuteLabel = (minute) => (isNumber(minute) ? `${number(minute)}′` : "");

function PitchEnd() {
  return (
    <>
      <path
        className={styles.stripes}
        d="M0 3.75h68M0 18.75h68M0 33.75h68M0 48.75h68"
      />
      <path
        className={styles.lines}
        d="M13.84 0v16.5h40.32V0M24.84 0v5.5h18.32V0M26.69 16.5a9.15 9.15 0 0 0 14.62 0M30.34 0v-2h7.32v2"
      />
      <circle className={styles.pitchSpot} cx="34" cy="11" r=".23" />
    </>
  );
}

function ShotMap({
  placed,
  selected,
  count,
  directionKnown,
  halfPitch,
  select,
}) {
  const depth = halfPitch ? HALF_PITCH : PITCH_LENGTH;
  const keyboardShot = selected?.point ? selected : placed[0];
  const selectedPoint = selected?.point;
  return (
    <figure className={styles.figure}>
      <div className={styles.pitchHeader}>
        <span>{halfPitch ? "Demi-terrain offensif" : "Terrain complet"}</span>
        {directionKnown ? (
          <span className={styles.direction}>
            But attaqué <Icon name="arrow" />
          </span>
        ) : (
          placed.length > 0 && <span>Sens d’attaque non renseigné</span>
        )}
      </div>
      <div className={styles.plot}>
        <svg
          className={styles.pitch}
          viewBox={`-3 -4 ${PITCH_WIDTH + 6} ${depth + 8}`}
          role="group"
          aria-label="Carte des tirs"
        >
          <g aria-hidden="true">
            <rect className={styles.field} width={PITCH_WIDTH} height={depth} />
            <PitchEnd />
            {halfPitch ? (
              <path
                className={styles.lines}
                d="M24.85 52.5a9.15 9.15 0 0 1 18.3 0"
              />
            ) : (
              <>
                <g transform="translate(0 105) scale(1 -1)">
                  <PitchEnd />
                </g>
                <path className={styles.lines} d="M0 52.5h68" />
                <circle className={styles.lines} cx="34" cy="52.5" r="9.15" />
              </>
            )}
            <circle className={styles.pitchSpot} cx="34" cy="52.5" r=".23" />
            <rect className={styles.lines} width={PITCH_WIDTH} height={depth} />
          </g>
          {placed.map((entry) => {
            const { key, shot, outcome, pos, point } = entry;
            const label = [
              shot.date && date(shot.date),
              minuteLabel(shot.minute),
              outcome,
              pos.distance != null && `${distanceLabel(pos)} du but`,
              isNumber(shot.xg) && `xG ${number(shot.xg, 2)}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <g
                key={key}
                className={`${styles.marker} ${COLORS.get(outcome)}`}
                role="button"
                tabIndex={keyboardShot === entry ? 0 : -1}
                aria-label={label}
                aria-pressed={selected === entry}
                onClick={() => select(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(entry);
                  }
                }}
              >
                <circle
                  className={styles.hit}
                  cx={point.cx}
                  cy={point.cy}
                  r="2.7"
                />
                <circle className={styles.dot} {...point} />
              </g>
            );
          })}
          {selectedPoint && (
            <g
              className={COLORS.get(selected.outcome)}
              pointerEvents="none"
              aria-hidden="true"
            >
              <circle
                className={styles.halo}
                cx={selectedPoint.cx}
                cy={selectedPoint.cy}
                r={selectedPoint.r + 0.82}
              />
              <circle className={styles.dot} {...selectedPoint} />
            </g>
          )}
        </svg>
        {!placed.length && (
          <p className={styles.plotEmpty}>
            {count
              ? "Positions indisponibles pour ces tirs"
              : "Aucun tir pour ce résultat"}
          </p>
        )}
      </div>
      <figcaption>
        <span>
          {number(placed.length)} / {number(count)} tirs placés
        </span>
        <span>Taille des points selon le xG renseigné</span>
      </figcaption>
    </figure>
  );
}

function ShotInspector({ entries, selected, select }) {
  const f = useFootball();
  const index = entries.indexOf(selected);
  const shot = selected?.shot;
  const match =
    shot?.matchId && f.data.matches.find(({ id }) => id === shot.matchId);
  const matchLabel =
    match?.home?.name && match.away?.name
      ? `${match.home.name} – ${match.away.name}`
      : null;
  return (
    <aside className={styles.inspector} aria-label="Détail du tir">
      <div className={styles.inspectorHeader}>
        <span aria-live="polite">
          {shot
            ? `Tir ${number(index + 1)} sur ${number(entries.length)}`
            : "Détail du tir"}
          {shot && (
            <span className="sr-only">{` · ${selected.outcome} ${minuteLabel(shot.minute)}`}</span>
          )}
        </span>
        {entries.length > 1 && (
          <div
            className={styles.navigation}
            role="group"
            aria-label="Parcourir les tirs"
          >
            <button
              type="button"
              aria-label="Tir précédent"
              disabled={index <= 0}
              onClick={() => select(entries[index - 1])}
            >
              <Icon name="back" />
            </button>
            <button
              type="button"
              aria-label="Tir suivant"
              disabled={index >= entries.length - 1}
              onClick={() => select(entries[index + 1])}
            >
              <Icon name="arrow" />
            </button>
          </div>
        )}
      </div>
      {shot ? (
        <>
          <div className={styles.event}>
            <div className={styles.outcome}>
              <span
                className={`${styles.swatch} ${COLORS.get(selected.outcome)}`}
                aria-hidden="true"
              />
              <strong>{selected.outcome}</strong>
            </div>
            {minuteLabel(shot.minute) && (
              <span className={styles.minute}>{minuteLabel(shot.minute)}</span>
            )}
          </div>
          <div className={styles.match}>
            {matchLabel && <strong>{matchLabel}</strong>}
            <span>{date(shot.date)}</span>
          </div>
          <dl className={styles.metrics}>
            <div>
              <dt>Distance au but</dt>
              <dd>{distanceLabel(selected.pos)}</dd>
            </div>
            <div>
              <dt>xG du tir</dt>
              <dd>{number(shot.xg, 2)}</dd>
            </div>
          </dl>
          {!selected.point && (
            <p className={styles.positionNote}>
              Position non renseignée sur la carte.
            </p>
          )}
          {shot.matchId && (
            <Link
              className={styles.matchLink}
              href={f.href("/matchs/", {
                id: shot.matchId,
                competition: shot.leagueId,
                sourceSeason: shot.season,
              })}
              prefetch={false}
            >
              Voir le match <Icon name="arrow" />
            </Link>
          )}
        </>
      ) : (
        <p className={styles.positionNote}>
          Choisissez un autre résultat pour explorer les tirs.
        </p>
      )}
    </aside>
  );
}

export default function SeasonShots({
  shots: sourceShots,
  title = "Tirs de la saison",
  legacyPitchApi = false,
}) {
  const shots = useMemo(
    () =>
      sourceShots.map((source, index) => {
        const shot =
          legacyPitchApi && !source.coordinateFrame && !source.coordinate_frame
            ? { ...source, coordinateFrame: "acting_ltr" }
            : source;
        const pos = shotPosition(shot);
        return {
          key: `${shot.matchId}:${shot.id || index}`,
          shot,
          pos,
          outcome: shotOutcome(shot),
          point: pos && {
            cx: pos.y * PITCH_WIDTH,
            cy: (1 - pos.x) * PITCH_LENGTH,
            r: isNumber(shot.xg)
              ? 0.68 + 0.92 * Math.sqrt(Math.max(0, Math.min(1, shot.xg)))
              : 0.76,
          },
        };
      }),
    [sourceShots, legacyPitchApi],
  );
  const [filter, setFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState(null);
  if (!shots.length)
    return (
      <section className={styles.shots} aria-label={title}>
        <h3>{title}</h3>
        <Empty>Aucun tir collecté dans ce périmètre.</Empty>
      </section>
    );

  const counts = new Map([["all", shots.length]]);
  for (const { outcome } of shots)
    counts.set(outcome, (counts.get(outcome) || 0) + 1);

  const availableFilters = FILTERS.filter(
    ({ value, optional }) => !optional || counts.has(value),
  );
  const active = availableFilters.some(({ value }) => value === filter)
    ? filter
    : "all";
  const filtered =
    active === "all"
      ? shots
      : shots.filter(({ outcome }) => outcome === active);
  const selected =
    filtered.find(({ key }) => key === selectedKey) || filtered[0];
  const select = ({ key }) => setSelectedKey(key);
  const positioned = shots.filter(({ point }) => point);
  const placed =
    active === "all" ? positioned : filtered.filter(({ point }) => point);
  const directionKnown =
    positioned.length > 0 && positioned.every(({ pos }) => pos.verified);
  const halfPitch =
    directionKnown && positioned.every(({ pos }) => pos.x >= 0.5);
  const goals = filtered.filter(({ outcome }) => outcome === "But").length;
  const xgEligible = filtered.filter(({ shot }) => !shot.isOwnGoal);
  const knownXg = xgEligible.filter(({ shot }) => isNumber(shot.xg));
  const totalXg = knownXg.length
    ? knownXg.reduce((total, { shot }) => total + shot.xg, 0)
    : null;
  const hasDistance = positioned.some(({ pos }) => pos.distance != null);
  const usesReferencePitch = positioned.some(
    ({ pos }) => pos.distance != null && pos.approximate,
  );

  return (
    <section className={styles.shots} aria-label={title}>
      <div className={styles.heading}>
        <div>
          <h3>{title}</h3>
          <p>Sélectionnez un point pour afficher le détail du tir.</p>
        </div>
        <dl className={styles.totals} aria-label="Bilan des tirs affichés">
          <div>
            <dt>Tirs</dt>
            <dd>{number(filtered.length)}</dd>
          </div>
          <div>
            <dt>Buts</dt>
            <dd>{number(goals)}</dd>
          </div>
          <div>
            <dt>xG cumulés</dt>
            <dd>{number(totalXg, 2)}</dd>
            {knownXg.length < xgEligible.length && (
              <small>
                {knownXg.length} / {xgEligible.length} tirs renseignés
              </small>
            )}
          </div>
        </dl>
      </div>
      <div
        className={styles.filters}
        role="group"
        aria-label="Résultat des tirs"
      >
        {availableFilters.map(({ value, label, color }) => (
          <button
            className={styles.filter}
            key={value}
            type="button"
            aria-pressed={active === value}
            onClick={() => setFilter(value)}
          >
            <span className={`${styles.swatch} ${color}`} aria-hidden="true" />
            {label}
            <span className={styles.count}>
              {number(counts.get(value) || 0)}
            </span>
          </button>
        ))}
      </div>
      <div className={styles.layout}>
        <ShotMap
          placed={placed}
          selected={selected}
          count={filtered.length}
          directionKnown={directionKnown}
          halfPitch={halfPitch}
          select={select}
        />
        <ShotInspector entries={filtered} selected={selected} select={select} />
      </div>
      {hasDistance && (
        <p className={styles.note}>
          Distance calculée jusqu’au centre du but attaqué.
          {usesReferencePitch &&
            " Référence de 105 × 68 m lorsque les dimensions du terrain sont inconnues."}
        </p>
      )}
    </section>
  );
}
