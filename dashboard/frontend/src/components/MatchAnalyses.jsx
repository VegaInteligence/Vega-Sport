"use client";
/* The « Analyses » tab, all on one page: who dominated minute by minute, how each team played,
 * the two halves, the players whose actions weighed most, the pass networks and where each team
 * (or player) acted. Everything answers the pointer: a minute, a player, a zone. */
import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, Empty, Media, Segments, Skeleton } from "./UI.jsx";
import { Term } from "./Hint.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import { playerRows, styleGroups, teamStatsByPeriod } from "../services/match-tabs.js";
import { number } from "../services/format.js";
import s from "./MatchTabs.module.css";

const HOME = "var(--home)", AWAY = "var(--away)";

/* ---------------------------------------------------------- momentum */

function Momentum({ match, points, goals }) {
  const svgRef = useRef(null);
  const [at, setAt] = useState(null);
  const bubble = useHoverBubble({ width: 220, follow: true });
  if (!points?.length) return null;
  const W = 1200, H = 210, mid = H / 2, last = Math.max(90, ...points.map((p) => p.minute));
  const x = (m) => 14 + (m / last) * (W - 28);
  const pick = (event) => {
    const box = svgRef.current.getBoundingClientRect();
    const vx = ((event.clientX - box.left) / box.width) * W;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.minute) - vx) < Math.abs(x(best.minute) - vx)) best = p;
    setAt(best);
    const side = best.value >= 0 ? match.home.name : match.away.name;
    bubble.show(svgRef.current, (
      <>
        <p className={s.bubbleHead}>{Math.round(best.minute)}′</p>
        <p className={s.bubbleNote}>
          {best.value === 0 ? "Équilibre" : `${side} pousse : ${Math.abs(best.value)} sur 100`}
        </p>
      </>
    ), event);
  };
  return (
    <Card title="Qui a dominé, minute par minute">
      <p className={s.muted}>
        Pression offensive de chaque équipe : au-dessus {match.home.name}, en dessous {match.away.name}. Survolez ou touchez une minute.
      </p>
      <svg
        ref={svgRef}
        className={s.chart}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Pression offensive minute par minute"
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => {
          setAt(null);
          bubble.hide();
        }}
      >
        <line x1="14" x2={W - 14} y1={mid} y2={mid} className={s.axis} />
        <line x1={x(45)} x2={x(45)} y1="0" y2={H} className={s.axis} />
        <text x={x(45) + 5} y="13" className="chart-tick">Mi-temps</text>
        {points.map((p) => {
          const h = (Math.abs(p.value) / 100) * (mid - 16), home = p.value >= 0;
          return (
            <rect
              key={p.minute}
              x={x(p.minute) - 4.5}
              y={home ? mid - h : mid}
              width="9"
              height={Math.max(1, h)}
              fill={home ? HOME : AWAY}
              opacity={at && at.minute !== p.minute ? 0.45 : 0.9}
            />
          );
        })}
        {goals.map((g, i) => (
          <g key={i}>
            <line x1={x(g.minute)} x2={x(g.minute)} y1="18" y2={H - 18} className={s.goalLine} />
            <text x={x(g.minute)} y={g.side === "home" ? 14 : H - 4} textAnchor="middle" className="chart-tick">
              ⚽ {g.minute}′
            </text>
          </g>
        ))}
      </svg>
      <div className={s.legend}>
        <span><i className={s.dot} style={{ background: HOME }} /> {match.home.name} pousse</span>
        <span><i className={s.dot} style={{ background: AWAY }} /> {match.away.name} pousse</span>
      </div>
      {bubble.bubble}
    </Card>
  );
}

/* ------------------------------------------------------------- style */

function Style({ match, teams }) {
  const groups = styleGroups(teams, match);
  if (!groups) return null;
  return (
    <Card title="Comment chaque équipe a joué" className={s.fillCard}>
      <p className={s.muted}>Le meilleur des deux en plein. Chaque ligne a son « i ».</p>
      <div className={s.mirror}>
        {groups.map((group) => (
          <React.Fragment key={group.title}>
            <p className={s.groupTitle}>{group.title}</p>
            {group.rows.map((row) => {
              const max = Math.max(Math.abs(row.home), Math.abs(row.away)) || 1;
              const homeBetter = row.lower ? row.home < row.away : row.home > row.away;
              const awayBetter = row.lower ? row.away < row.home : row.away > row.home;
              return (
                <div className={s.mirrorRow} key={row.label}>
                  <b className={s.homeText} style={{ opacity: homeBetter ? 1 : 0.65 }}>{number(row.home, row.digits || 0)}{row.unit || ""}</b>
                  <span className={`${s.bar} ${s.barLeft}`}><i style={{ width: `${(Math.max(0, row.home) / max) * 100}%`, background: HOME, opacity: homeBetter ? 1 : 0.4 }} /></span>
                  <span className={s.mirrorName}><Term hint={row.hint}>{row.label}</Term></span>
                  <span className={s.bar}><i style={{ width: `${(Math.max(0, row.away) / max) * 100}%`, background: AWAY, opacity: awayBetter ? 1 : 0.4 }} /></span>
                  <b className={s.awayText} style={{ opacity: awayBetter ? 1 : 0.65 }}>{number(row.away, row.digits || 0)}{row.unit || ""}</b>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ halves */

const HALF_ROWS = [
  ["Buts attendus · xG", "expected_goals", 2],
  ["Tirs", "total_shots"],
  ["Tirs cadrés", "ShotsOnTarget"],
  ["Possession", "BallPossesion", 0, " %"],
  ["Passes", "passes"],
  ["Ballons dans la surface adverse", "touches_opp_box"],
  ["Corners", "corners"],
];

function Halves({ match, periods }) {
  if (!periods.FirstHalf || !periods.SecondHalf) return null;
  const rows = HALF_ROWS.filter(([, key]) => periods.FirstHalf[key] || periods.SecondHalf[key]);
  const v = (period, key, side, digits, unit = "") => {
    const value = periods[period]?.[key]?.[side];
    return value == null ? "—" : `${number(value, digits || 0)}${unit}`;
  };
  return (
    <Card title="Première et deuxième mi-temps">
      <div className="table-scroll">
        <table className={`data-table ${s.halves}`}>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" colSpan={2}>1re mi-temps</th>
              <th scope="col" colSpan={2}>2e mi-temps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, digits, unit]) => (
              <tr key={key}>
                <th scope="row"><Term>{label}</Term></th>
                {["FirstHalf", "SecondHalf"].map((period) => (
                  <React.Fragment key={period}>
                    <td><span className={s.homeText}>{v(period, key, "home", digits, unit)}</span></td>
                    <td><span className={s.awayText}>{v(period, key, "away", digits, unit)}</span></td>
                  </React.Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.legend}>
        <span><i className={s.dot} style={{ background: HOME }} /> {match.home.name}</span>
        <span><i className={s.dot} style={{ background: AWAY }} /> {match.away.name}</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------- action values */

function Values({ match, players, images }) {
  const f = useFootball();
  const bubble = useHoverBubble({ width: 260 });
  const top = [...(players || [])]
    .filter((p) => p.possession_value?.vaep_total != null)
    .sort((a, b) => b.possession_value.vaep_total - a.possession_value.vaep_total)
    .slice(0, 6);
  if (!top.length) return null;
  const max = Math.max(...top.map((p) => p.possession_value.vaep_total), 0.01);
  return (
    <Card
      className={s.fillCard}
      title={<Term label="Valeur des actions" hint="Ce que toutes ses actions ont changé aux chances de son équipe de marquer et d’encaisser.">Les actions qui ont pesé le plus</Term>}
    >
      <p className={s.muted}>Survolez un joueur pour le détail, cliquez pour sa fiche.</p>
      <div className={s.valueList}>
      {top.map((p) => {
        const v = p.possession_value, home = p.team_id === match.home.id;
        const detail = (
          <>
            <p className={s.bubbleHead}>{p.player.name}</p>
            <div className={s.bubbleLine}><span>En attaque</span><b>{number(v.vaep_offensive, 2)}</b></div>
            <div className={s.bubbleLine}><span>En défense</span><b>{number(v.vaep_defensive, 2)}</b></div>
            <div className={s.bubbleLine}><span>Actions</span><b>{number(p.actions)}</b></div>
            {p.creation?.sca != null && <div className={s.bubbleLine}><span>Actions menant à un tir</span><b>{number(p.creation.sca)}</b></div>}
            {p.passing?.progressive_passes != null && <div className={s.bubbleLine}><span>Passes vers l’avant</span><b>{number(p.passing.progressive_passes)}</b></div>}
          </>
        );
        return (
          <Link
            key={p.player.id}
            className={s.valueRow}
            href={f.href("/joueurs/", { id: p.player.id })}
            onMouseEnter={(event) => bubble.show(event.currentTarget, detail)}
            onMouseLeave={bubble.hide}
            onFocus={(event) => bubble.show(event.currentTarget, detail)}
            onBlur={bubble.hide}
          >
            <Media name={p.player.name} url={images.get(p.player.id)} className={`player-avatar ${s.subAvatar}`} />
            <span>
              <b>{p.player.name}</b>
              <small className={home ? s.homeText : s.awayText}>{home ? match.home.name : match.away.name}</small>
            </span>
            <span className={s.bar}>
              <i style={{ width: `${(Math.max(0, v.vaep_offensive) / max) * 100}%`, background: home ? HOME : AWAY }} />
              <i style={{ width: `${(Math.max(0, v.vaep_defensive) / max) * 100}%`, background: "var(--good, #34d399)" }} />
            </span>
            <strong>{number(v.vaep_total, 2)}</strong>
          </Link>
        );
      })}
      </div>
      <div className={s.legend}>
        <span><i className={s.dot} style={{ background: HOME }} /> en attaque</span>
        <span><i className={s.dot} style={{ background: "var(--good, #34d399)" }} /> en défense</span>
      </div>
      {bubble.bubble}
    </Card>
  );
}

/* ---------------------------------------------------------- networks */

const NW = 420, NH = 272;
const nx = (x) => 10 + (x / 105) * (NW - 20);
// The team attacks to the right: its right flank (y near 0) is at the foot of the drawing.
const ny = (y) => 10 + (1 - y / 68) * (NH - 20);

function Network({ network, side, threshold }) {
  const [focus, setFocus] = useState(null);
  const bubble = useHoverBubble({ width: 240 });
  const color = side === "home" ? HOME : AWAY;
  const nodes = network.nodes || [];
  const pos = new Map(nodes.map((n) => [n.player.id, n]));
  const edges = (network.edges || []).filter((e) => e.passes >= threshold && pos.has(e.from.id) && pos.has(e.to.id));
  const maxEdge = Math.max(1, ...edges.map((e) => e.passes));
  const maxNode = Math.max(1, ...nodes.map((n) => (n.passes || 0) + (n.passes_received || 0)));
  const partner = (id) => {
    const linked = (network.edges || []).filter((e) => e.from.id === id || e.to.id === id).sort((a, b) => b.passes - a.passes)[0];
    return linked ? `${(linked.from.id === id ? linked.to : linked.from).name} (${linked.passes})` : "—";
  };
  return (
    <div>
      <svg className={s.pitchSvg} viewBox={`0 0 ${NW} ${NH}`} role="img" aria-label={`Réseau de passes de ${network.team?.name || ""}`}>
        <rect x="10" y="10" width={NW - 20} height={NH - 20} className={s.pitchLine} />
        <line x1={NW / 2} x2={NW / 2} y1="10" y2={NH - 10} className={s.pitchLine} />
        {edges.map((e, i) => {
          const a = pos.get(e.from.id), b = pos.get(e.to.id);
          const lit = !focus || e.from.id === focus || e.to.id === focus;
          return (
            <line
              key={i}
              x1={nx(a.avg_x)} y1={ny(a.avg_y)} x2={nx(b.avg_x)} y2={ny(b.avg_y)}
              stroke={color}
              strokeOpacity={lit ? 0.2 + (0.7 * e.passes) / maxEdge : 0.05}
              strokeWidth={1 + (5 * e.passes) / maxEdge}
            />
          );
        })}
        {nodes.map((n) => {
          const r = 7 + (10 * ((n.passes || 0) + (n.passes_received || 0))) / maxNode;
          const lit = !focus || focus === n.player.id || edges.some((e) => (e.from.id === focus && e.to.id === n.player.id) || (e.to.id === focus && e.from.id === n.player.id));
          const detail = (
            <>
              <p className={s.bubbleHead}>{n.player.name}</p>
              <div className={s.bubbleLine}><span>Passes données</span><b>{number(n.passes)}</b></div>
              <div className={s.bubbleLine}><span>Passes reçues</span><b>{number(n.passes_received)}</b></div>
              <div className={s.bubbleLine}><span>Partenaire principal</span><b>{partner(n.player.id)}</b></div>
            </>
          );
          return (
            <g
              key={n.player.id}
              tabIndex={0}
              className={s.node}
              opacity={lit ? 1 : 0.3}
              onMouseEnter={(event) => { setFocus(n.player.id); bubble.show(event.currentTarget, detail); }}
              onMouseLeave={() => { setFocus(null); bubble.hide(); }}
              onFocus={(event) => { setFocus(n.player.id); bubble.show(event.currentTarget, detail); }}
              onBlur={() => { setFocus(null); bubble.hide(); }}
            >
              <circle cx={nx(n.avg_x)} cy={ny(n.avg_y)} r={r} className={s.nodeDisc} stroke={color} />
              <text x={nx(n.avg_x)} y={ny(n.avg_y) + 3.5} textAnchor="middle" className={s.nodeNumber}>{n.player.shirt_number ?? ""}</text>
              <text x={nx(n.avg_x)} y={ny(n.avg_y) + r + 11} textAnchor="middle" className={s.nodeName}>{String(n.player.name || "").split(" ").at(-1)}</text>
            </g>
          );
        })}
      </svg>
      <p className={s.muted}>{network.team?.name} · survolez un joueur pour ses liens</p>
      {bubble.bubble}
    </div>
  );
}

function Networks({ match, networks }) {
  const [threshold, setThreshold] = useState(4);
  if (!networks?.length) return null;
  const sideOf = (n) => (n.team?.id === match.home.id ? "home" : "away");
  return (
    <Card
      title={<Term label="Réseaux de passes" hint="Position moyenne de chaque joueur et passes échangées, jusqu’au premier changement de chaque équipe.">Réseaux de passes</Term>}
      action={
        <Segments
          label="Passes au moins"
          value={String(threshold)}
          onChange={(value) => setThreshold(Number(value))}
          items={[["2", "2 passes ou plus"], ["4", "4 ou plus"], ["8", "8 ou plus"]]}
        />
      }
    >
      <p className={s.muted}>Chaque équipe attaque vers la droite. Les traits sont les passes échangées.</p>
      <div className={s.grid2}>
        {[...networks].sort((a, b) => (sideOf(a) === "home" ? -1 : 1)).map((n) => (
          <Network key={n.team?.id} network={n} side={sideOf(n)} threshold={threshold} />
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ zones */

function Zone({ map, side }) {
  const bubble = useHoverBubble({ width: 200, follow: true });
  const [hover, setHover] = useState(null);
  const cells = map?.cells || [];
  const total = cells.reduce((t, c) => t + c[2], 0) || 1;
  const max = Math.max(1, ...cells.map((c) => c[2]));
  const cw = (NW - 20) / 16, ch = (NH - 20) / 12;
  const rgb = side === "home" ? "var(--home)" : "var(--away)";
  return (
    <svg className={s.pitchSvg} viewBox={`0 0 ${NW} ${NH}`} role="img" aria-label="Zones d’activité" onPointerLeave={() => { setHover(null); bubble.hide(); }}>
      {cells.map(([x, y, value]) => (
        <rect
          key={`${x}:${y}`}
          x={10 + x * cw}
          y={10 + (11 - y) * ch}
          width={cw}
          height={ch}
          fill={rgb}
          fillOpacity={(value / max) * 0.9}
          stroke={hover === `${x}:${y}` ? "#fff" : "none"}
          onPointerMove={(event) => {
            setHover(`${x}:${y}`);
            bubble.show(event.currentTarget, (
              <>
                <p className={s.bubbleHead}>{number((100 * value) / total, 1)} % des actions</p>
                <p className={s.bubbleNote}>{number(value)} action{value > 1 ? "s" : ""} dans cette zone</p>
              </>
            ), event);
          }}
        />
      ))}
      <rect x="10" y="10" width={NW - 20} height={NH - 20} className={s.pitchLine} pointerEvents="none" />
      <line x1={NW / 2} x2={NW / 2} y1="10" y2={NH - 10} className={s.pitchLine} pointerEvents="none" />
      {bubble.bubble}
    </svg>
  );
}

function Zones({ match, heat }) {
  const [choice, setChoice] = useState({ home: "team", away: "team" });
  if (!heat?.teams?.length) return null;
  const pick = (side) => {
    const team = heat.teams.find((t) => t.side === side);
    if (choice[side] === "team") return team;
    return (heat.players || []).find((p) => p.side === side && p.player?.id === choice[side]) || team;
  };
  const options = (side) => (heat.players || []).filter((p) => p.side === side && p.actions > 0).sort((a, b) => b.actions - a.actions);
  return (
    <Card title={<Term label="Zones d’activité" hint="Où l’équipe, ou un joueur, a touché le ballon pendant le match.">Zones d’activité</Term>}>
      <p className={s.muted}>Chaque équipe attaque vers la droite. Choisissez un joueur, survolez une zone pour sa part des actions.</p>
      <div className={s.grid2}>
        {["home", "away"].map((side) => (
          <div key={side}>
            <label className={s.zoneSelect}>
              <span className={side === "home" ? s.homeText : s.awayText}>{side === "home" ? match.home.name : match.away.name}</span>
              <select value={choice[side]} onChange={(event) => setChoice((c) => ({ ...c, [side]: event.target.value }))} aria-label={`Zones de ${side === "home" ? match.home.name : match.away.name}`}>
                <option value="team">Toute l’équipe</option>
                {options(side).map((p) => (
                  <option key={p.player.id} value={p.player.id}>{p.player.name} · {p.actions} actions</option>
                ))}
              </select>
            </label>
            <Zone map={pick(side)} side={side} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- page */

export default function MatchAnalyses({ match }) {
  const momentum = useMatchSection(match, "momentum");
  const events = useMatchSection(match, "events");
  const stats = useMatchSection(match, "stats");
  const advanced = useMatchSection(match, "advanced");
  const advancedPlayers = useMatchSection(match, "advanced/players");
  const network = useMatchSection(match, "advanced/network");
  const heat = useMatchSection(match, "heatmaps");
  const players = useMatchSection(match, "players");
  const periods = teamStatsByPeriod(stats.data);
  const images = useMemo(() => new Map(playerRows(players.data).map((r) => [r.id, r.imageUrl])), [players.data]);
  const goals = (events.data?.events || [])
    .filter((e) => e.event_type === "goal")
    .map((e) => ({ minute: e.minute, side: e.team_id === match.home.id ? (e.is_own_goal ? "away" : "home") : e.is_own_goal ? "home" : "away" }));
  const loading = [momentum, stats, advanced, network, heat].every((r) => r.loading && !r.data);
  if (loading) return <Skeleton label="Chargement des analyses…" lines={5} />;
  const nothing = !momentum.data?.points?.length && !advanced.data?.teams?.length && !network.data?.networks?.length && !heat.data?.teams?.length && !periods.FirstHalf;
  if (nothing) return <Empty>Aucune analyse disponible pour ce match.</Empty>;
  return (
    <div className={s.stack}>
      <Momentum match={match} points={momentum.data?.points} goals={goals} />
      <div className={`${s.grid2} ${s.balanced}`}>
        <Style match={match} teams={advanced.data?.teams} />
        <div className={s.stack}>
          <Halves match={match} periods={periods} />
          <Values match={match} players={advancedPlayers.data?.players} images={images} />
        </div>
      </div>
      <Networks match={match} networks={network.data?.networks} />
      <Zones match={match} heat={heat.data} />
    </div>
  );
}
