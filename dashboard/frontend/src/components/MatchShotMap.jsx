"use client";
/* The Résumé's shot map (FAILURE_MODES § 63): one pitch, each team on its side (the home team attacks the left goal,
 * the away team the right one), a choice of the period among those with shots, and the shoot-out drawn on the goal
 * seen from the pitch, with a team choice. Each mark tells its shot on hover; there is no list under the map (hugo, 25 Nov). */
import React, { useState } from "react";
import { Card, Empty, Segments } from "./UI.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { ShotCard, eventId, shotText } from "./Charts.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { isNumber } from "../services/format.js";
import { SHOOTOUT, shotGoal, shotPeriods, shotsOf } from "../services/match-shots.js";

export { SHOT_PERIODS, shotPeriods, shotsOf } from "../services/match-shots.js";

const SIDE_COLOR = { home: "var(--home)", away: "var(--away)" };
const sideOf = (match, shot) => (shot.teamId === match.away.id ? "away" : "home");
const LINE = "light-dark(#d0d0d2, #3d3d3f)";

// The pitch at 6 units a metre (105 × 68 m), a margin around it.
const M = 6, PAD = 12, W = 105 * M + 2 * PAD, H = 68 * M + 2 * PAD;
const px = (x) => PAD + x * M, py = (y) => PAD + y * M;

function PitchLines() {
  const box = (x, w, h) => <rect x={px(x)} y={py(34 - h / 2)} width={w * M} height={h * M} />;
  return (
    <g fill="none" stroke={LINE} strokeWidth="1.2">
      <rect x={px(0)} y={py(0)} width={105 * M} height={68 * M} fill="light-dark(#ebebed, #18181a)" />
      <line data-halfway="" x1={px(52.5)} x2={px(52.5)} y1={py(0)} y2={py(68)} />
      <circle cx={px(52.5)} cy={py(34)} r={9.15 * M} />
      {box(0, 16.5, 40.32)}
      {box(105 - 16.5, 16.5, 40.32)}
      {box(0, 5.5, 18.32)}
      {box(105 - 5.5, 5.5, 18.32)}
      <circle cx={px(11)} cy={py(34)} r="2" fill={LINE} />
      <circle cx={px(94)} cy={py(34)} r="2" fill={LINE} />
    </g>
  );
}

/** One shot, sized by its xG: a goal filled, a shot on target half filled, another in outline. */
function Shot({ match, shot, x, y, r, onPlayer, bubble, label, data }) {
  const id = eventId(match, shot);
  const color = SIDE_COLOR[sideOf(match, shot)];
  const show = (event) => bubble.show(event.currentTarget, <ShotCard match={match} shot={shot} />);
  return (
    <g>
      <circle
        className="chart-point shot-point"
        {...data}
        cx={x}
        cy={y}
        r={r}
        fill={color}
        fillOpacity={shot.isGoal ? 0.95 : shot.isOnTarget && !shot.isBlocked ? 0.35 : 0}
        stroke={color}
        strokeWidth={shot.isGoal ? 2 : 1.5}
        role={id ? "button" : "img"}
        tabIndex={0}
        aria-label={shotText(shot)}
        onMouseEnter={show}
        onMouseLeave={bubble.hide}
        onFocus={show}
        onBlur={bubble.hide}
        onClick={() => id && onPlayer(id)}
        onKeyDown={(e) => {
          if (e.key === "Escape") bubble.hide();
          else if (id && ["Enter", " "].includes(e.key)) {
            e.preventDefault();
            onPlayer(id);
          }
        }}
      />
      {label && (
        <text x={x} y={y + 4} textAnchor="middle" className="match-shot-kick-number" pointerEvents="none">
          {label}
        </text>
      )}
    </g>
  );
}

/** Each team on its side: the home team's shots mirrored onto the left goal, the away team's on the right one. */
function ShotPitch({ match, shots, onPlayer }) {
  const bubble = useHoverBubble({ width: 240 });
  const located = shots.filter((s) => isNumber(s.x) && isNumber(s.y));
  if (!located.length) return <Empty>Coordonnées de tirs indisponibles.</Empty>;
  // Goals last, so a goal is never hidden under a miss.
  const order = [...located].sort((a, b) => Number(a.isGoal) - Number(b.isGoal) || (b.xg ?? 0) - (a.xg ?? 0));
  return (
    <>
      <svg
        className="match-shot-pitch"
        data-chart="match-shot-map"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Carte des tirs · ${match.home.name} à gauche, ${match.away.name} à droite`}
      >
        <PitchLines />
        {order.map((s, i) => {
          const side = sideOf(match, s);
          const x = side === "home" ? 105 - s.x : s.x;
          const y = side === "home" ? 68 - s.y : s.y;
          return (
            <Shot
              key={s.id || i}
              match={match}
              shot={s}
              x={px(x)}
              y={py(y)}
              r={4 + Math.sqrt(Math.max(0, s.xg ?? 0.02)) * 14}
              onPlayer={onPlayer}
              bubble={bubble}
              data={{ "data-side": side }}
            />
          );
        })}
      </svg>
      {bubble.bubble}
    </>
  );
}

// The goal seen from the pitch: 7.32 m between the posts (y 30.34 to 37.66), the bar at 2.44 m, at 60 units a metre.
const G = 60, GY0 = 26.4, GY1 = 41.6, GZ = 3.4, GPAD = 16;
const GW = (GY1 - GY0) * G + 2 * GPAD, GH = GZ * G + 2 * GPAD;
// Facing the goal the pitch's y runs from right (small) to left (large).
const gx = (y) => GPAD + (GY1 - Math.min(GY1, Math.max(GY0, y))) * G;
const gz = (z) => GPAD + (GZ - Math.min(GZ, Math.max(0, z))) * G;

/** The shoot-out on the goal: one numbered mark per kick, where it crossed the line. */
function GoalMouth({ match, kicks, onPlayer }) {
  const bubble = useHoverBubble({ width: 240 });
  // Where each kick crossed the line, in either spelling (§ 63.7).
  const placed = kicks.map((k) => ({ kick: k, goal: shotGoal(k) })).filter((p) => p.goal);
  if (!kicks.length) return <Empty>Aucun tir au but pour cette équipe.</Empty>;
  return (
    <>
      <svg className="match-goal-mouth" data-chart="goal-mouth" viewBox={`0 0 ${GW} ${GH}`} role="img" aria-label="Les tirs au but sur la cage">
        <line x1={GPAD / 2} x2={GW - GPAD / 2} y1={gz(0)} y2={gz(0)} stroke={LINE} strokeWidth="2" />
        <rect x={gx(37.66)} y={gz(2.44)} width={7.32 * G} height={2.44 * G} fill="light-dark(#ebebed, #18181a)" />
        <g stroke="light-dark(#e2e2e4, #2a2a2d)" strokeWidth="1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <line key={"v" + i} x1={gx(37.66 - (i * 7.32) / 7)} x2={gx(37.66 - (i * 7.32) / 7)} y1={gz(2.44)} y2={gz(0)} />
          ))}
          {[1, 2].map((i) => (
            <line key={"h" + i} x1={gx(37.66)} x2={gx(30.34)} y1={gz((i * 2.44) / 3)} y2={gz((i * 2.44) / 3)} />
          ))}
        </g>
        <path
          d={`M${gx(37.66)} ${gz(0)}V${gz(2.44)}H${gx(30.34)}V${gz(0)}`}
          fill="none"
          stroke="light-dark(#9a9aa0, #c8c8cc)"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        {placed.map(({ kick: k, goal }) => (
          <Shot
            key={k.id || k.order}
            match={match}
            shot={k}
            x={gx(goal.y)}
            y={gz(goal.z)}
            r={12}
            onPlayer={onPlayer}
            bubble={bubble}
            label={k.order}
            data={{ "data-kick": k.order, "data-side": sideOf(match, k) }}
          />
        ))}
      </svg>
      {bubble.bubble}
    </>
  );
}

export default function MatchShotMap({ match }) {
  const f = useFootball();
  const [period, setPeriod] = useState("all");
  const [team, setTeam] = useState("all");
  if (match.coverage?.shots === false || !match.shots?.length)
    return (
      <Card title="Carte des tirs" className="match-shots-card">
        <Empty>Données de tirs indisponibles.</Empty>
      </Card>
    );
  const periods = shotPeriods(match.shots);
  const current = periods.some(([key]) => key === period) ? period : "all";
  const shootout = current === SHOOTOUT;
  // The kicks keep their order (1, 2, 3…), whichever team is shown.
  const kicks = shootout ? shotsOf(match.shots, SHOOTOUT).map((k, i) => ({ ...k, order: i + 1 })) : [];
  const shown = shootout
    ? kicks.filter((k) => team === "all" || k.teamId === team)
    : shotsOf(match.shots, current).sort((a, b) => (a.minute ?? Infinity) - (b.minute ?? Infinity));
  const openPlayer = (id) => f.setPlayer(id);
  return (
    <Card
      title="Carte des tirs"
      className="match-shots-card"
      action={
        periods.length > 1 && (
          <Segments
            label="Période des tirs"
            value={current}
            onChange={setPeriod}
            items={periods}
          />
        )
      }
    >
      {shootout ? (
        <div className="match-shot-shootout-head">
          <Segments
            label="Équipe des tirs au but"
            value={team}
            onChange={setTeam}
            items={[
              ["all", "Les deux"],
              [match.home.id, match.home.name],
              [match.away.id, match.away.name],
            ]}
          />
        </div>
      ) : (
        <div className="match-shot-sides" aria-hidden="true">
          <span className="is-home">
            <i style={{ background: SIDE_COLOR.home }} />
            {match.home.name}
          </span>
          <span className="is-away">
            {match.away.name}
            <i style={{ background: SIDE_COLOR.away }} />
          </span>
        </div>
      )}
      {shootout ? (
        <GoalMouth match={match} kicks={shown} onPlayer={openPlayer} />
      ) : (
        <ShotPitch match={match} shots={shown} onPlayer={openPlayer} />
      )}
      <div className="match-shot-legend">
        {shootout ? (
          <>
            <span><i className="is-goal" /> Réussi</span>
            <span><i className="is-on" /> Arrêté</span>
            <span><i /> Manqué</span>
          </>
        ) : (
          <>
            <span><i className="is-goal" /> But</span>
            <span><i className="is-on" /> Cadré</span>
            <span><i /> Non cadré</span>
            <span>Taille : xG</span>
          </>
        )}
      </div>
    </Card>
  );
}
