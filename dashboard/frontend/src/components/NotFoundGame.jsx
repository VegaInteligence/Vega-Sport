"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { SHOTS, goals, takePenalty } from "../services/penalty-shootout.js";
import styles from "./NotFoundGame.module.css";

// The scene in SVG units. Goal positions run 0–1 across and 0–1 upwards.
const VIEW = { width: 400, height: 250 },
  GOAL = { left: 60, top: 34, width: 280, height: 126 },
  GROUND = GOAL.top + GOAL.height,
  SPOT = { x: 200, y: 222 },
  // Height of the standing keeper's chest, the point his dive is aimed with.
  KEEPER_CHEST = 0.32;
const sceneX = (x) => GOAL.left + x * GOAL.width;
const sceneY = (y) => GROUND - y * GOAL.height;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const NET = [
  ...Array.from(
    { length: 13 },
    (_, i) => `M${80 + i * 20} ${GOAL.top}V${GROUND}`,
  ),
  ...Array.from({ length: 6 }, (_, i) => `M${GOAL.left} ${52 + i * 18}H340`),
].join("");
const CALLS = {
  goal: "But !",
  saved: "Arrêté !",
  post: "Poteau !",
  bar: "Barre !",
  wide: "À côté !",
  over: "Au-dessus !",
};
const STEPS = {
  ArrowLeft: [-0.1, 0],
  ArrowRight: [0.1, 0],
  ArrowUp: [0, 0.1],
  ArrowDown: [0, -0.1],
};
const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;
const verdict = (scored) =>
  scored === SHOTS
    ? `Sans-faute : ${scored} sur ${SHOTS}.`
    : scored > SHOTS / 2
      ? `Séance gagnée : ${scored} sur ${SHOTS}.`
      : `Le gardien l’emporte : ${scored} sur ${SHOTS}.`;

/** The 404 page's penalty shoot-out: five shots against the keeper. */
export default function NotFoundGame() {
  const id = useId();
  const scene = useRef(null);
  // Starts beside the keeper, where the cross-hair is easy to see.
  const [aim, setAim] = useState({ x: 0.8, y: 0.6 });
  // The penalty being played, kept until the next one may be taken.
  const [shot, setShot] = useState(null);
  const [results, setResults] = useState([]);
  const landed = Boolean(shot) && results.length > shot.index;
  const over = !shot && results.length === SHOTS;
  const ready = !shot && !over;
  const scored = goals(results);

  useEffect(() => {
    if (!shot) return;
    const land = setTimeout(
      () =>
        setResults((previous) =>
          previous.length === shot.index
            ? [...previous, shot.outcome]
            : previous,
        ),
      520,
    );
    const next = setTimeout(() => setShot(null), 1750);
    return () => {
      clearTimeout(land);
      clearTimeout(next);
    };
  }, [shot]);

  function shoot(target) {
    if (!ready) return;
    setAim(target);
    setShot({ ...takePenalty(target), index: results.length });
  }
  function restart() {
    setShot(null);
    setResults([]);
  }
  function pointed(event) {
    const box = scene.current.getBoundingClientRect(),
      x = ((event.clientX - box.left) / box.width) * VIEW.width,
      y = ((event.clientY - box.top) / box.height) * VIEW.height;
    return {
      x: clamp((x - GOAL.left) / GOAL.width, 0.03, 0.97),
      y: clamp((GROUND - y) / GOAL.height, 0.03, 0.97),
    };
  }
  function onKeyDown(event) {
    const step = STEPS[event.key];
    if (step) {
      event.preventDefault();
      if (ready)
        setAim((previous) => ({
          x: clamp(previous.x + step[0], 0.05, 0.95),
          y: clamp(previous.y + step[1], 0.05, 0.95),
        }));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (over) restart();
      else shoot(aim);
    }
  }

  // A shot on the frame stops on it; one off target stays in the picture.
  const ball = shot
    ? {
        x: sceneX(
          shot.outcome === "post"
            ? Math.round(shot.ball.x)
            : clamp(shot.ball.x, -0.16, 1.16),
        ),
        y: sceneY(shot.outcome === "bar" ? 1 : Math.min(shot.ball.y, 1.2)),
        scale: 0.62,
      }
    : { ...SPOT, scale: 1 };
  const dive = shot
    ? {
        x: sceneX(shot.keeper.x) - SPOT.x,
        y: (KEEPER_CHEST - shot.keeper.y) * GOAL.height,
        turn: (shot.keeper.x - 0.5) * 160,
      }
    : { x: 0, y: 0, turn: 0 };
  const tally = `${plural(scored, "but")} en ${plural(results.length, "tir")}`;
  const message = landed
    ? `${CALLS[shot.outcome]} ${tally}.`
    : over
      ? verdict(scored)
      : results.length
        ? `Tir ${results.length + 1} sur ${SHOTS}`
        : "À vous de tirer.";
  const tone = landed ? (shot.outcome === "goal" ? "goal" : "miss") : undefined;

  return (
    <section className={styles.game} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <h2 id={`${id}-title`} className={styles.title}>
            Tirs au but
          </h2>
          <p className={styles.lead}>
            Cette page est hors-jeu. Vous avez {SHOTS} tirs pour battre le
            gardien.
          </p>
        </div>
        <div className={styles.series} role="img" aria-label={tally}>
          {Array.from({ length: SHOTS }, (_, index) => (
            <span
              key={index}
              className={styles.mark}
              data-result={
                results[index] && (results[index] === "goal" ? "goal" : "miss")
              }
            />
          ))}
        </div>
      </header>
      <div
        className={styles.pitch}
        role="application"
        tabIndex={0}
        aria-label="Cage des tirs au but"
        aria-describedby={`${id}-help`}
        data-ready={ready || undefined}
        onKeyDown={onKeyDown}
        onClick={(event) => shoot(pointed(event))}
        onPointerMove={(event) => {
          if (ready && event.pointerType === "mouse") setAim(pointed(event));
        }}
      >
        <svg
          ref={scene}
          className={styles.scene}
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <path
            className={styles.markings}
            d={`M0 ${GROUND}H400M40 ${GROUND}L4 206H396L360 ${GROUND}`}
          />
          <circle className={styles.spot} cx={SPOT.x} cy={SPOT.y} r="2.5" />
          <path className={styles.net} d={NET} />
          <g transform={`translate(${SPOT.x} ${GROUND})`}>
            <g
              className={`${styles.keeper}${shot ? ` ${styles.moving}` : ""}`}
              style={{
                transform: `translate(${dive.x}px, ${dive.y}px) rotate(${dive.turn}deg)`,
              }}
            >
              <path className={styles.limbs} d="M-6 -2L-5 -30M6 -2L5 -30" />
              <path
                className={styles.sleeves}
                d="M-9 -57L-23 -70M9 -57L23 -70"
              />
              <rect
                className={styles.shirt}
                x="-11"
                y="-62"
                width="22"
                height="34"
                rx="6"
              />
              <circle className={styles.skin} cy="-71" r="8" />
              <circle className={styles.skin} cx="-25" cy="-72" r="5" />
              <circle className={styles.skin} cx="25" cy="-72" r="5" />
            </g>
          </g>
          <path
            className={styles.frame}
            d={`M${GOAL.left} ${GROUND}V${GOAL.top}H340V${GROUND}`}
          />
          {ready && (
            <g
              className={styles.reticle}
              transform={`translate(${sceneX(aim.x)} ${sceneY(aim.y)})`}
            >
              <circle r="9" />
              <path d="M-14 0H-5M5 0H14M0 -14V-5M0 5V14" />
            </g>
          )}
          <g
            className={`${styles.ball}${shot ? ` ${styles.moving}` : ""}`}
            style={{
              transform: `translate(${ball.x}px, ${ball.y}px) scale(${ball.scale})`,
            }}
          >
            <circle className={styles.leather} r="9" />
            <path
              className={styles.panel}
              d="M0 -4.2L4 -1.3L2.5 3.4H-2.5L-4 -1.3Z"
            />
          </g>
        </svg>
        {landed && (
          <span className={styles.call} data-tone={tone} aria-hidden="true">
            {CALLS[shot.outcome]}
          </span>
        )}
      </div>
      <div className={styles.footer}>
        <p className={styles.status} role="status">
          {message}
        </p>
        {over && (
          <button
            type="button"
            className="button button-secondary"
            onClick={restart}
          >
            Rejouer
          </button>
        )}
      </div>
      <p id={`${id}-help`} className={styles.help}>
        Cliquez ou touchez la cage pour tirer. Au clavier&nbsp;: flèches pour
        viser, Entrée pour tirer.
      </p>
    </section>
  );
}
