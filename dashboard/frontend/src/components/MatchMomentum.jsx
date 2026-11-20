"use client";
/* « Qui a dominé, minute par minute » (approved mock-up B, 20 Nov 2026): one panel per period,
 * each with its sides' share of the pressure; the minutes as faint columns under their 5-minute
 * average, blue above for the home side, orange below for the away side; the goals in a lane
 * above with scorer and score. Drawn at its measured width; the panels stack on a phone. */
import React, { useId, useState } from "react";
import { Card } from "./UI.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import useBoxWidth from "../hooks/useBoxWidth.js";
import { momentumPanels } from "../services/match-momentum.js";
import s from "./MatchMomentum.module.css";
import t from "./MatchTabs.module.css";

const HOME = "var(--momentum-home)", AWAY = "var(--momentum-away)";
const GAP = 40, PHONE = 600, ROW = 18, CHAR = 6.6;

/** Goal labels in rows, so that two close goals never write over each other. */
function goalRows(goals, x, width) {
  const ends = [];
  return goals.map((g) => {
    const text = `${g.label} ${g.player || ""}${g.ownGoal ? " (c.s.c.)" : ""} ${g.score.join("–")}`;
    const span = text.length * CHAR + 16;
    const gx = x(g.slot);
    const left = gx + span > width;
    const from = left ? gx - span : gx, to = left ? gx : gx + span;
    let row = ends.findIndex((end) => end < from);
    if (row < 0) row = ends.length;
    ends[row] = to + 8;
    return { ...g, gx, left, row };
  });
}

/** A minute's x: the middle of its slot, every slot the same width. */
const slotX = (panel, width) => (minute) => (panel.points.findIndex((p) => p.minute === minute) + 0.5) * (width / panel.points.length);
const laneOf = (placed) => (placed.length ? Math.max(...placed.map((g) => g.row)) * ROW + ROW + 8 : 8);

function Panel({ match, panel, goals, width, phone, labels, at, onPick, onLeave, lane: shared }) {
  const clip = useId().replace(/:/g, "");
  const n = panel.points.length;
  const slot = width / n;
  const x = slotX(panel, width);
  const placed = goalRows(goals, x, width);
  const lane = shared ?? laneOf(placed);
  const plot = phone ? 150 : 200;
  const top = lane, mid = top + plot / 2, height = top + plot + 22;
  const y = (v) => mid - (v / 100) * (plot / 2 - 4);
  const bar = Math.max(1.5, slot - 2);
  const line = panel.points.map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const area = `${line} L${x(panel.points[n - 1].minute).toFixed(1)},${mid} L${x(panel.points[0].minute).toFixed(1)},${mid} Z`;
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor((event.clientX - box.left) / slot)));
    onPick(panel.points[i], event);
  };
  const share = panel.share;
  return (
    <section data-panel className={s.panel} style={{ width }}>
      <header className={s.head}>
        <span data-panel-title className={s.title}>{panel.label}</span>
        {share && (
          <span className={s.share}>
            <span data-share>
              {match.home.name} {share.home} % · {share.away} % {match.away.name}
            </span>
            <span className={s.shareBar} aria-hidden="true">
              <i style={{ flexGrow: share.home, background: HOME }} />
              <i style={{ flexGrow: share.away, background: AWAY }} />
            </span>
          </span>
        )}
      </header>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width, height }}
        className={s.svg}
        role="img"
        aria-label={`${panel.label} : pression offensive minute par minute`}
        data-x0="0"
        data-slot={slot}
        data-top={top}
        data-plot-height={plot}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={onLeave}
      >
        <defs>
          <clipPath id={`${clip}u`}><rect x="0" y="0" width={width} height={mid} /></clipPath>
          <clipPath id={`${clip}d`}><rect x="0" y={mid} width={width} height={height - mid} /></clipPath>
        </defs>
        <g data-plot>
          <rect x="0" y={top} width={width} height={plot} fill="transparent" />
          {[50, -50].map((v) => (
            <line key={v} x1="0" x2={width} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="2 4" />
          ))}
          <line x1="0" x2={width} y1={mid} y2={mid} stroke="var(--border-strong)" />
          {panel.points.map((p) => {
            if (!p.value) return null;
            const home = p.value > 0, h = Math.abs(y(p.value) - mid), bx = x(p.minute) - bar / 2;
            const r = Math.min(2, bar / 2, h);
            const d = home
              ? `M${bx},${mid}V${mid - h + r}Q${bx},${mid - h} ${bx + r},${mid - h}H${bx + bar - r}Q${bx + bar},${mid - h} ${bx + bar},${mid - h + r}V${mid}Z`
              : `M${bx},${mid}V${mid + h - r}Q${bx},${mid + h} ${bx + r},${mid + h}H${bx + bar - r}Q${bx + bar},${mid + h} ${bx + bar},${mid + h - r}V${mid}Z`;
            return <path key={p.minute} data-column d={d} fill={home ? HOME : AWAY} opacity={at && at.minute === p.minute ? 0.75 : 0.3} />;
          })}
          {[
            [`${clip}u`, HOME],
            [`${clip}d`, AWAY],
          ].map(([id, color]) => (
            <g key={id} clipPath={`url(#${id})`} data-average>
              <path d={area} fill={color} opacity="0.55" />
              <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            </g>
          ))}
          {labels && (
            <>
              <text x="2" y={top + 12} className={s.side}>▲ {match.home.name}</text>
              <text x="2" y={top + plot - 6} className={s.side}>▼ {match.away.name}</text>
            </>
          )}
          {panel.ticks.map((m) => {
            const tx = x(m);
            const anchor = tx < 12 ? "start" : tx > width - 16 ? "end" : "middle";
            return (
              <text key={m} x={tx} y={height - 6} textAnchor={anchor} className={s.tick}>
                {m}′
              </text>
            );
          })}
          {placed.map((g, i) => {
            const cy = 9 + g.row * ROW;
            return (
              <g key={i} data-goal>
                <line x1={g.gx} x2={g.gx} y1={cy + 6} y2={top + plot} stroke="var(--ink)" strokeOpacity="0.45" strokeDasharray="3 3" />
                <circle cx={g.gx} cy={cy} r="5" fill={g.side === "home" ? HOME : AWAY} stroke="var(--surface)" strokeWidth="2" />
                <text x={g.left ? g.gx - 10 : g.gx + 10} y={cy + 4} textAnchor={g.left ? "end" : "start"} className={s.goal}>
                  <tspan className={s.goalHead}>{g.label} {g.player || ""}{g.ownGoal ? " (c.s.c.)" : ""}</tspan>
                  <tspan className={s.goalScore}> {g.score.join("–")}</tspan>
                </text>
              </g>
            );
          })}
          {at && panel.points.some((p) => p.minute === at.minute) && (
            <line x1={x(at.minute)} x2={x(at.minute)} y1={top} y2={top + plot} stroke="var(--ink-strong)" strokeWidth="1.25" />
          )}
        </g>
      </svg>
    </section>
  );
}

export default function MatchMomentum({ match, points, events }) {
  const data = momentumPanels(points, events, { homeId: match.home.id });
  const [ref, measured] = useBoxWidth(900);
  const [at, setAt] = useState(null);
  const bubble = useHoverBubble({ width: 220, follow: true });
  if (!data) return null;
  const { panels, goals } = data;
  const phone = measured < PHONE;
  const slots = panels.reduce((a, p) => a + p.points.length, 0);
  const free = measured - (phone ? 0 : GAP * (panels.length - 1));
  const widthOf = (p) => Math.floor(phone ? measured : (free * p.points.length) / slots);
  const side = (v) => (v > 0 ? match.home.name : match.away.name);
  // Side by side, every panel keeps the same goal lane: their zero lines stay level.
  const lane = phone
    ? undefined
    : Math.max(...panels.map((p, i) => {
        const w = widthOf(p);
        return laneOf(goalRows(goals.filter((g) => g.panel === i), slotX(p, w), w));
      }));
  const pick = (point, event) => {
    setAt(point);
    bubble.show(event.currentTarget, (
      <div data-momentum-card>
        <p className={t.bubbleHead}>{point.label}</p>
        <p className={s.cardRow}>
          {point.value ? (
            <>
              <span><i className={s.key} style={{ background: point.value > 0 ? HOME : AWAY }} />{side(point.value)}</span>
              <b>{Math.abs(point.value)} / 100</b>
            </>
          ) : (
            <span>Équilibre</span>
          )}
        </p>
        <p className={`${s.cardRow} ${s.cardMuted}`}>
          <span>Moyenne 5 min</span>
          <span>{Math.round(point.avg) ? `${side(point.avg)} ${Math.abs(Math.round(point.avg))}` : "Équilibre"}</span>
        </p>
      </div>
    ), event);
  };
  const leave = () => {
    setAt(null);
    bubble.hide();
  };
  return (
    <Card title="Qui a dominé, minute par minute">
      <div ref={ref} data-chart="momentum" className={`${s.chart} ${phone ? s.stacked : ""}`.trim()}>
        {panels.map((panel, i) => (
          <Panel
            key={panel.key}
            match={match}
            panel={panel}
            goals={goals.filter((g) => g.panel === i)}
            width={widthOf(panel)}
            phone={phone}
            labels={phone || i === 0}
            lane={lane}
            at={at}
            onPick={pick}
            onLeave={leave}
          />
        ))}
      </div>
      {bubble.bubble}
    </Card>
  );
}
