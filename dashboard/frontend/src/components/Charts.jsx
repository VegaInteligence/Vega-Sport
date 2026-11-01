import React from "react";
import { isNumber, number } from "../services/format.js";
import { Empty } from "./UI.jsx";
const compact = (v) =>
  isNumber(v)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v)
    : "—";
const colors = ["light-dark(#1d6fd6, #3b8eff)", "light-dark(#53687f, #9cc7ff)"];
function bounds(values) {
  const hi = values.reduce((max, v) => Math.max(max, v), 1);
  return { max: hi * 1.05, ticks: [0, hi / 4, hi / 2, (hi * 3) / 4, hi] };
}
export function ScatterPlot({
  appearances = [],
  xKey = "xg",
  yKey = "xa",
  xLabel = "xG",
  yLabel = "xA",
  onPlayer = () => {},
}) {
  const valid = appearances.filter(
    (r) => isNumber(r[xKey]) && isNumber(r[yKey]),
  );
  if (!valid.length)
    return (
      <Empty>
        Graphique indisponible : aucune paire de mesures renseignée.
      </Empty>
    );
  const shown =
      valid.length > 1200
        ? Array.from(
            { length: 1200 },
            (_, i) => valid[Math.floor((i * valid.length) / 1200)],
          )
        : valid,
    x = bounds(valid.map((r) => r[xKey])),
    y = bounds(valid.map((r) => r[yKey]));
  return (
    <figure className="chart-figure">
      <svg
        className="scatter-chart"
        viewBox="0 0 640 310"
        role="img"
        aria-label={`${xLabel} et ${yLabel} par apparition`}
      >
        <title>{`${xLabel} et ${yLabel}`}</title>
        <desc>
          {valid.length} apparitions avec les deux mesures renseignées
        </desc>
        {y.ticks.map((v, i) => (
          <g key={i}>
            <line
              x1="44"
              y1={260 - (v / y.max) * 225}
              x2="615"
              y2={260 - (v / y.max) * 225}
              stroke="light-dark(#dedee0, #2a2a2c)"
            />
            <text
              className="chart-tick"
              x="38"
              y={264 - (v / y.max) * 225}
              textAnchor="end"
              fill="light-dark(#606062, #9e9ea0)"
              fontSize="10"
            >
              {number(v, 1)}
            </text>
          </g>
        ))}
        {x.ticks.map((v, i) => (
          <text
            key={i}
            className="chart-tick"
            x={44 + (v / x.max) * 570}
            y="280"
            fill="light-dark(#606062, #9e9ea0)"
            fontSize="10"
          >
            {number(v, 1)}
          </text>
        ))}
        <text
          className="chart-axis"
          x="44"
          y="15"
          fill="light-dark(#606062, #9e9ea0)"
          fontSize="11"
        >
          {yLabel === "xA" ? "Passes décisives attendues · xA" : yLabel}
        </text>
        <text
          className="chart-axis"
          x="615"
          y="305"
          textAnchor="end"
          fill="light-dark(#606062, #9e9ea0)"
          fontSize="11"
        >
          {xLabel === "xG" ? "Buts attendus · xG" : xLabel}
        </text>
        {shown.map((r, i) => (
          <circle
            key={`${r.id}:${i}`}
            className="chart-point"
            data-open-player={r.id}
            cx={44 + (r[xKey] / x.max) * 570}
            cy={260 - (r[yKey] / y.max) * 225}
            r="3.2"
            fill={colors[0]}
            stroke="light-dark(#eaeaec, #18181a)"
            strokeWidth="0.7"
            opacity=".65"
            role="button"
            tabIndex="0"
            onClick={() => onPlayer(r.id)}
            onKeyDown={(e) => {
              if (["Enter", " "].includes(e.key)) {
                e.preventDefault();
                onPlayer(r.id);
              }
            }}
            aria-label={`${r.name} · ${r.team} · ${xLabel} : ${compact(r[xKey])} · ${yLabel} : ${compact(r[yKey])}`}
          >
            <title>{`${r.name} · ${r.team} · ${xLabel} : ${compact(r[xKey])} · ${yLabel} : ${compact(r[yKey])}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption>
        {number(valid.length)} avec les deux mesures · {shown.length} points
        affichés · {number(appearances.length - valid.length)} apparitions sans
        les deux mesures.
      </figcaption>
    </figure>
  );
}
const shotText = (s) =>
  `${s.playerName || "Joueur inconnu"} · ${number(s.minute)}′ · ${s.isOwnGoal ? "But contre son camp" : s.isGoal ? "But" : s.type || "Tir"} · xG : ${isNumber(s.xg) ? compact(s.xg) : "Non renseigné"}`;
const eventId = (match, s) =>
  s.playerId ? `${match.id}:${s.playerId}` : undefined;
function Point({ match, shot, x, y, onPlayer }) {
  const id = eventId(match, shot);
  return (
    <circle
      className="chart-point shot-point"
      data-open-player={id}
      cx={x}
      cy={y}
      r={shot.isGoal ? 6 : 4}
      fill={
        shot.isGoal
          ? colors[shot.teamId === match.home.id ? 0 : 1]
          : "transparent"
      }
      stroke={colors[shot.teamId === match.home.id ? 0 : 1]}
      role={id ? "button" : undefined}
      tabIndex={id ? 0 : undefined}
      aria-label={shotText(shot)}
      onClick={() => id && onPlayer(id)}
      onKeyDown={(e) => {
        if (id && ["Enter", " "].includes(e.key)) {
          e.preventDefault();
          onPlayer(id);
        }
      }}
    >
      <title>{shotText(shot)}</title>
    </circle>
  );
}
export function ShotMap({ match, teamId = "all", onPlayer = () => {} }) {
  if (match.coverage?.shots === false || !match.shots?.length)
    return <Empty>Données de tirs indisponibles.</Empty>;
  const shots = match.shots.filter(
      (s) => teamId === "all" || s.teamId === teamId,
    ),
    located = shots.filter((s) => isNumber(s.x) && isNumber(s.y));
  if (!located.length) return <Empty>Coordonnées de tirs indisponibles.</Empty>;
  return (
    <figure className="chart-figure">
      <div className="chart-legend">
        {["home", "away"]
          .filter((side) => teamId === "all" || match[side].id === teamId)
          .map((side) => (
            <span key={side}>
              <i
                className="legend-dot"
                style={{ background: colors[side === "home" ? 0 : 1] }}
              />
              {match[side].name}
            </span>
          ))}
      </div>
      <svg
        viewBox="0 0 660 443"
        role="img"
        aria-label={`Carte des tirs · ${match.home.name} et ${match.away.name}`}
      >
        <title>{`Carte des tirs · ${match.home.name} — ${match.away.name}`}</title>
        <desc>
          Coordonnées du fournisseur, buts en plein et autres tirs en contour.
        </desc>
        <rect
          x="26"
          y="22"
          width="608"
          height="394"
          fill="light-dark(#ebebed, #18181a)"
          stroke="light-dark(#d0d0d2, #3d3d3f)"
        />
        <path
          d="M330 22v394M26 102h96v234H26M634 102h-96v234h96"
          fill="none"
          stroke="light-dark(#d0d0d2, #3d3d3f)"
        />
        <circle
          cx="330"
          cy="219"
          r="53"
          fill="none"
          stroke="light-dark(#d0d0d2, #3d3d3f)"
        />
        {located.map((s, i) => (
          <Point
            key={s.id || i}
            match={match}
            shot={s}
            x={26 + (s.x / 105) * 608}
            y={22 + (s.y / 68) * 394}
            onPlayer={onPlayer}
          />
        ))}
      </svg>
      <figcaption>
        {shots.filter((s) => !isNumber(s.xg)).length} xG absent ·{" "}
        {shots.length - located.length} coordonnées absentes
      </figcaption>
    </figure>
  );
}
export function XgTimeline({ match, teamId = "all", onPlayer = () => {} }) {
  if (match.coverage?.shots === false || !match.shots?.length)
    return <Empty>Données de tirs indisponibles.</Empty>;
  const selected = match.shots.filter(
      (s) => teamId === "all" || s.teamId === teamId,
    ),
    valid = selected
      .filter((s) => isNumber(s.xg) && isNumber(s.minute) && !s.isOwnGoal)
      .sort((a, b) => a.minute - b.minute);
  if (!valid.length) return <Empty>xG indisponibles.</Empty>;
  const sides = ["home", "away"].filter(
      (side) => teamId === "all" || match[side].id === teamId,
    ),
    series = sides.map((side) => {
      let total = 0;
      return {
        side,
        events: valid
          .filter((s) => s.teamId === match[side].id)
          .map((s) => ({ shot: s, total: (total += s.xg) })),
        get total() {
          return total;
        },
      };
    }),
    rawMax = Math.max(1, ...series.map((s) => s.total)) * 1.1,
    step =
      rawMax <= 1
        ? 0.25
        : rawMax <= 3
          ? 0.5
          : rawMax <= 6
            ? 1
            : Math.ceil(rawMax / 4),
    max = Math.ceil(rawMax / step) * step,
    ticks = Array.from(
      { length: Math.round(max / step) + 1 },
      (_, i) => i * step,
    ),
    duration = Math.ceil(Math.max(90, ...valid.map((s) => s.minute)) / 15) * 15,
    timeStep = Math.max(15, Math.ceil(duration / 6 / 15) * 15),
    timeTicks = Array.from(
      { length: Math.floor(duration / timeStep) + 1 },
      (_, i) => i * timeStep,
    ),
    differs = series.some(
      (s) =>
        isNumber(match[s.side].xg) &&
        Math.abs(s.total - match[s.side].xg) > 0.02,
    );
  return (
    <figure className="chart-figure">
      <svg
        className="xg-timeline"
        viewBox="0 0 640 280"
        role="img"
        aria-label={`xG cumulés · ${match.home.name} et ${match.away.name}`}
      >
        <title>{`xG cumulés · ${match.home.name} — ${match.away.name}`}</title>
        <desc>Somme des xG renseignés, hors buts contre son camp.</desc>
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1="44"
              x2="614"
              y1={245 - (value / max) * 220}
              y2={245 - (value / max) * 220}
              stroke="light-dark(#dadadc, #303032)"
            />
            <text
              className="chart-tick"
              x="34"
              y={249 - (value / max) * 220}
              textAnchor="end"
              fill="light-dark(#666668, #9a9a9c)"
              fontSize="11"
            >
              {compact(value)}
            </text>
          </g>
        ))}
        {timeTicks.map((value) => (
          <text
            key={value}
            className="chart-tick"
            x={44 + (value / duration) * 570}
            y="268"
            textAnchor="middle"
            fill="light-dark(#666668, #9a9a9c)"
            fontSize="11"
          >
            {value}′
          </text>
        ))}
        <text
          className="chart-axis"
          x="44"
          y="13"
          fill="light-dark(#666668, #9a9a9c)"
          fontSize="10"
        >
          xG cumulés · tirs
        </text>
        {series.map(({ side, events }, i) => (
          <g key={side}>
            <path
              d={`M44 245 ${events.map((e) => `H${44 + (e.shot.minute / duration) * 570} V${245 - (e.total / max) * 220}`).join(" ")}`}
              stroke={colors[side === "home" ? 0 : 1]}
              strokeWidth="2"
              fill="none"
            />
            {events.map((e, j) => (
              <Point
                key={e.shot.id || j}
                match={match}
                shot={e.shot}
                x={44 + (e.shot.minute / duration) * 570}
                y={245 - (e.total / max) * 220}
                onPlayer={onPlayer}
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.side}>
            <i
              className="legend-dot"
              style={{ background: colors[s.side === "home" ? 0 : 1] }}
            />
            {match[s.side].name} <strong>{compact(s.total)} xG</strong>
          </span>
        ))}
      </div>
      <figcaption>
        xG cumulés des tirs renseignés, hors CSC
        {differs ? " · total distinct du xG d’équipe" : ""}.
        {selected.length > valid.length && (
          <> {selected.length - valid.length} événement exclu.</>
        )}
      </figcaption>
    </figure>
  );
}
