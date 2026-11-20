import React, { useState } from "react";
import { Crest, fmtNum, MatchRowLink, useBoxWidth } from "./ClubScoutUI.jsx";
import s from "./PointsRace.module.css";

// The club's points against its expected points (mock-up B, validated by the user on 20 Nov 2026): the two running
// totals with the gap between them, then each match's points against its xPts. Drawn at the size they are shown.

/** Round ticks: 0 and steps of 5, 10 or 20 up to the top, at most five lines. */
function ticksFor(top) {
  const step = [2, 5, 10, 20, 50].find((v) => top / v <= 4) || 100;
  const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(v);
  if (out.at(-1) < top) out.push(out.at(-1) + step);
  return out;
}

function cumulative(rows) {
  let p = 0,
    x = 0;
  return rows.map((row, i) => {
    p += row.points;
    x += row.xpts;
    return { i, row, points: p, xpts: x, gap: p - x };
  });
}

const matchLabel = (row) =>
  `${row.side === "home" ? "vs" : "à"} ${row.opponent.name} ${row.gf}–${row.ga}`;

/** The two running totals, the room between them shaded, their values written at the end. */
export function PointsRaceLines({ rows, height = 240 }) {
  // Drawn at the width shown: its text stays 10–11 px on a phone too.
  const [ref, W] = useBoxWidth(640);
  const [active, setActive] = useState(null);
  const data = cumulative(rows.filter((r) => r.xpts != null));
  if (!data.length) return null;
  const n = data.length,
    m = { t: 14, r: 92, b: 24, l: 30 };
  const ticks = ticksFor(
    Math.max(...data.map((d) => Math.max(d.points, d.xpts))),
  );
  const top = ticks.at(-1);
  const x = (i) => m.l + (n === 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
  const y = (v) => m.t + (1 - v / top) * (height - m.t - m.b);
  const path = (key) =>
    data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[key])}`).join("");
  const last = data.at(-1);
  const ahead = last.gap >= 0;
  const a = active == null ? null : data[active];
  return (
    <figure ref={ref} className={s.figure}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className={s.svg}
        role="img"
        aria-label={`Points ${last.points}, points attendus ${fmtNum(last.xpts, 1)}, écart ${fmtNum(last.gap, 1, true)}`}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const vx = ((e.clientX - box.left) / box.width) * W;
          setActive(
            Math.max(
              0,
              Math.min(
                n - 1,
                Math.round(((vx - m.l) / (W - m.l - m.r)) * (n - 1)),
              ),
            ),
          );
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.l}
              x2={W - m.r}
              y1={y(t)}
              y2={y(t)}
              className={s.grid}
            />
            <text
              x={m.l - 6}
              y={y(t) + 3.5}
              textAnchor="end"
              className={s.axis}
            >
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          n <= 12 || i % Math.ceil(n / 10) === 0 || i === n - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor="middle"
              className={s.axis}
            >
              J{i + 1}
            </text>
          ) : null,
        )}
        {/* The gap, segment by segment: blue where the club is ahead of its xPts, red where behind. */}
        {data.slice(1).map((d, k) => {
          const p = data[k];
          const up = d.gap + p.gap >= 0;
          return (
            <polygon
              key={k}
              className={up ? s.ahead : s.behind}
              points={`${x(k)},${y(p.points)} ${x(k + 1)},${y(d.points)} ${x(k + 1)},${y(d.xpts)} ${x(k)},${y(p.xpts)}`}
            />
          );
        })}
        <path d={path("xpts")} className={s.xptsLine} />
        <path d={path("points")} className={s.pointsLine} />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(d.points)}
            r={active === i ? 4.5 : 2.5}
            className={s.dot}
          />
        ))}
        {a && (
          <line
            x1={x(a.i)}
            x2={x(a.i)}
            y1={m.t}
            y2={height - m.b}
            className={s.cursor}
          />
        )}
        {/* Direct labels at the end: no legend to decode. */}
        <text
          x={x(n - 1) + 8}
          y={y(last.points) + (ahead ? -2 : 10)}
          className={s.endPoints}
        >
          {last.points} pts
        </text>
        <text
          x={x(n - 1) + 8}
          y={y(last.xpts) + (ahead ? 12 : -2)}
          className={s.endXpts}
        >
          {fmtNum(last.xpts, 1)} xPts
        </text>
        <text
          x={x(n - 1) + 8}
          y={(y(last.points) + y(last.xpts)) / 2 + 4}
          className={ahead ? s.endGapUp : s.endGapDown}
        >
          {fmtNum(last.gap, 1, true)}
        </text>
      </svg>
      <figcaption className={s.caption}>
        {a ? (
          <>
            <b>J{a.i + 1}</b> {matchLabel(a.row)} · {a.row.points} pt
            {a.row.points > 1 ? "s" : ""} pour {fmtNum(a.row.xpts, 2)} xPts ·
            cumul {a.points} pts / {fmtNum(a.xpts, 1)} xPts
          </>
        ) : (
          <>
            <span className={s.keyPoints}>Points</span>
            <span className={s.keyXpts}>Points attendus</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** Each match, the points taken against the points its chances were worth. */
/** Each match on its own row, as tall as a row of the table beside it (mock-up A, 20 Nov 2026): round, home or
 * away, the opponent's crest and name, the score, the result, a 0–3 gauge filled to the points taken with the
 * match's xPts as a tick, and the gap; the row opens the match. */
export function PointsPerMatch({ rows }) {
  const data = rows.filter((r) => r.xpts != null);
  if (!data.length) return null;
  return (
    <figure className={s.figure}>
      <figcaption className={s.title}>Match par match</figcaption>
      <div className={s.rowsHead} aria-hidden="true">
        <span>J</span>
        <span>Adversaire</span>
        <span>Score</span>
        <span />
        <span>Pts · xPts</span>
        <span>Écart</span>
      </div>
      <ol className={s.rows}>
        {data.map((row) => {
          const round = rows.indexOf(row) + 1,
            gap = row.points - row.xpts;
          return (
            <li key={row.match?.id || round}>
              <MatchRowLink match={row.match} className={s.rowLink}>
                <span
                  className={s.row}
                  data-match-row=""
                  data-points={row.points}
                  data-xpts={row.xpts}
                  title={`J${round} · ${matchLabel(row)} · ${row.points} pts pour ${fmtNum(row.xpts, 2)} xPts`}
                >
                  <span className={s.round}>J{round}</span>
                  <span className={s.opponent}>
                    <small>{row.side === "home" ? "dom." : "ext."}</small>
                    <Crest club={row.opponent} />
                    <b>{row.opponent.name}</b>
                  </span>
                  <span className={s.score}>
                    {row.gf}–{row.ga}
                  </span>
                  <b className={s.result} data-r={row.result}>
                    {row.result}
                  </b>
                  <span className={s.gauge} data-gauge="">
                    <span data-fill="" style={{ width: `${(row.points / 3) * 100}%` }} />
                    <i data-tick="" style={{ left: `${(row.xpts / 3) * 100}%` }} />
                  </span>
                  <span className={s.gap} data-gap="" data-down={gap < 0 || undefined}>
                    {fmtNum(gap, 1, true)}
                  </span>
                </span>
              </MatchRowLink>
            </li>
          );
        })}
      </ol>
      <figcaption className={s.caption}>
        <span className={s.keyFill}>Points pris (sur 3)</span>
        <span className={s.keyTick}>xPts du match</span>
      </figcaption>
    </figure>
  );
}
