"use client";
/* The « Analyses » tab, all on one page: who dominated minute by minute, how each team played,
 * the two halves, the players whose actions weighed most, the pass networks and where each team
 * (or player) acted. Everything answers the pointer: a minute, a player, a zone. */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Empty, Media, Segments, Skeleton } from "./UI.jsx";
import { Term } from "./Hint.jsx";
import { useHoverBubble } from "./HoverCard.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import useMatchSection from "../hooks/useMatchSection.js";
import MatchMomentum from "./MatchMomentum.jsx";
import { playerRows, styleGroups, teamStatsByPeriod } from "../services/match-tabs.js";
import { number } from "../services/format.js";
import s from "./MatchTabs.module.css";

const HOME = "var(--home)", AWAY = "var(--away)";

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

// The pitch drawn at 6 units a metre and shown at that size (no enlargement): 105 x 68 m.
const PM = 6, PAD = 14;
const NW = 105 * PM + 2 * PAD, NH = 68 * PM + 2 * PAD;
const nx = (x) => PAD + x * PM;
// The team attacks to the right: its right flank (y near 0) is at the foot of the drawing.
const ny = (y) => PAD + (68 - y) * PM;
const lastName = (name) => String(name || "").split(" ").at(-1);
const clock = (seconds) => `${Math.round(seconds / 60)}′`;

function PitchMarks() {
  const box = (x, w, h) => <rect x={nx(x)} y={ny(34 + h / 2)} width={w * PM} height={h * PM} className={s.pitchLine} />;
  return (
    <g>
      <rect x={PAD} y={PAD} width={105 * PM} height={68 * PM} className={s.pitchLine} />
      <line x1={nx(52.5)} x2={nx(52.5)} y1={PAD} y2={NH - PAD} className={s.pitchLine} />
      <circle cx={nx(52.5)} cy={ny(34)} r={9.15 * PM} className={s.pitchLine} />
      {box(0, 16.5, 40.3)}
      {box(105 - 16.5, 16.5, 40.3)}
      {box(0, 5.5, 18.3)}
      {box(105 - 5.5, 5.5, 18.3)}
    </g>
  );
}

// Each pair once, both directions summed; the strongest first.
function pairs(edges) {
  const byPair = new Map();
  for (const e of edges) {
    const key = [e.from.id, e.to.id].sort().join("|");
    const pair = byPair.get(key) || { a: e.from.id, b: e.to.id, passes: 0 };
    pair.passes += e.passes;
    byPair.set(key, pair);
  }
  return [...byPair.values()].sort((x, y) => y.passes - x.passes);
}

// Discs that would cover each other are pushed apart, a few units at most.
function spread(points) {
  const out = points.map((p) => ({ ...p }));
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, need = a.r + b.r + 3;
        if (d >= need) continue;
        const push = (need - d) / 2, ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    if (!moved) break;
  }
  return out;
}

// Each name below its disc, else above, right or left: the first place that covers no disc and no name.
function placeLabels(points) {
  const taken = points.map((p) => ({ x0: p.x - p.r, x1: p.x + p.r, y0: p.y - p.r, y1: p.y + p.r }));
  const hit = (b) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
  return points.map((p) => {
    const w = p.label.length * 6.6 + 4, h = 14;
    const spots = [
      [p.x, p.y + p.r + 13, "middle"],
      [p.x, p.y - p.r - 5, "middle"],
      [p.x + p.r + 4, p.y + 4, "start"],
      [p.x - p.r - 4, p.y + 4, "end"],
    ];
    const box = ([x, y, anchor]) => {
      const x0 = anchor === "middle" ? x - w / 2 : anchor === "start" ? x : x - w;
      return { x0, x1: x0 + w, y0: y - 11, y1: y - 11 + h };
    };
    const spot = spots.find((sp) => !hit(box(sp))) || spots[0];
    taken.push(box(spot));
    return { x: spot[0], y: spot[1], anchor: spot[2] };
  });
}

function Network({ network, side, links }) {
  const [focus, setFocus] = useState(null);
  const bubble = useHoverBubble({ width: 240 });
  const color = side === "home" ? HOME : AWAY;
  const all = network.nodes || [];
  const placed = all.filter((n) => Number.isFinite(n.avg_x) && Number.isFinite(n.avg_y));
  const unplaced = all.filter((n) => !placed.includes(n));
  const ids = new Set(placed.map((n) => n.player.id));
  const everyPair = pairs((network.edges || []).filter((e) => ids.has(e.from.id) && ids.has(e.to.id)));
  const shown = links === "all" ? everyPair.filter((p) => p.passes >= 2) : everyPair.slice(0, Number(links));
  const maxPair = Math.max(1, ...shown.map((p) => p.passes));
  const touches = (n) => (n.passes || 0) + (n.passes_received || 0);
  const maxNode = Math.max(1, ...placed.map(touches));
  const points = spread(placed.map((n) => ({ id: n.player.id, x: nx(n.avg_x), y: ny(n.avg_y), r: 11 + (7 * touches(n)) / maxNode })));
  const at = new Map(points.map((p) => [p.id, p]));
  const labels = placeLabels(points.map((p, i) => ({ ...p, label: lastName(placed[i].player.name) })));
  const total = (network.edges || []).reduce((sum, e) => sum + e.passes, 0);
  const partner = (id) => {
    const best = everyPair.find((p) => p.a === id || p.b === id);
    if (!best) return "—";
    const other = placed.find((n) => n.player.id === (best.a === id ? best.b : best.a));
    return `${lastName(other?.player.name)} (${best.passes})`;
  };
  const until = network.window?.until_seconds;
  return (
    <div className={s.network}>
      <p className={s.networkHead}>
        <b>{network.team?.name}</b>
        <span>{until ? `0–${clock(until)}` : "match entier"} · {number(total)} passes</span>
      </p>
      <svg className={s.pitchSvg} viewBox={`0 0 ${NW} ${NH}`} style={{ maxWidth: NW }} role="img" aria-label={`Réseau de passes de ${network.team?.name || ""}`}>
        <PitchMarks />
        {shown.map((p) => {
          const a = at.get(p.a), b = at.get(p.b);
          const lit = !focus || p.a === focus || p.b === focus;
          return (
            <line key={`${p.a}|${p.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeLinecap="round"
              strokeOpacity={lit ? 0.25 + (0.65 * p.passes) / maxPair : 0.06}
              strokeWidth={1.5 + (7 * p.passes) / maxPair} />
          );
        })}
        {placed.map((n, i) => {
          const pt = points[i], label = labels[i];
          const lit = !focus || focus === n.player.id || shown.some((p) => (p.a === focus && p.b === n.player.id) || (p.b === focus && p.a === n.player.id));
          const detail = (
            <>
              <p className={s.bubbleHead}>{n.player.name}</p>
              <div className={s.bubbleLine}><span>Passes données</span><b>{number(n.passes)}</b></div>
              <div className={s.bubbleLine}><span>Passes reçues</span><b>{number(n.passes_received)}</b></div>
              <div className={s.bubbleLine}><span>Partenaire principal</span><b>{partner(n.player.id)}</b></div>
            </>
          );
          return (
            <g key={n.player.id} tabIndex={0} className={s.node} opacity={lit ? 1 : 0.25}
              onMouseEnter={(event) => { setFocus(n.player.id); bubble.show(event.currentTarget, detail); }}
              onMouseLeave={() => { setFocus(null); bubble.hide(); }}
              onFocus={(event) => { setFocus(n.player.id); bubble.show(event.currentTarget, detail); }}
              onBlur={() => { setFocus(null); bubble.hide(); }}>
              <circle cx={pt.x} cy={pt.y} r={pt.r} className={s.nodeDisc} stroke={color} />
              <text x={pt.x} y={pt.y + 4} textAnchor="middle" className={s.nodeNumber}>{n.player.shirt_number ?? ""}</text>
              <text x={label.x} y={label.y} textAnchor={label.anchor} className={s.nodeName}>{lastName(n.player.name)}</text>
            </g>
          );
        })}
      </svg>
      <ol className={s.networkRoster}>
        {[...placed].sort((a, b) => touches(b) - touches(a)).map((n) => (
          <li key={n.player.id} onMouseEnter={() => setFocus(n.player.id)} onMouseLeave={() => setFocus(null)}>
            <b style={{ borderColor: color }}>{n.player.shirt_number ?? ""}</b>
            <span>{lastName(n.player.name)}</span>
            <em>{number(touches(n))}</em>
          </li>
        ))}
      </ol>
      {unplaced.length > 0 && <p className={s.muted}>Sans position : {unplaced.map((n) => lastName(n.player.name)).join(", ")}</p>}
      {bubble.bubble}
    </div>
  );
}

function Networks({ match, networks }) {
  const [links, setLinks] = useState("12");
  if (!networks?.length) return null;
  const sideOf = (n) => (n.team?.id === match.home.id ? "home" : "away");
  return (
    <Card
      title={<Term label="Réseaux de passes" hint="Position moyenne de chaque joueur et passes échangées dans les deux sens, jusqu’au premier changement de chaque équipe. Chaque équipe attaque vers la droite.">Réseaux de passes</Term>}
      action={
        <Segments
          label="Liens affichés"
          value={links}
          onChange={setLinks}
          items={[["6", "6 liens"], ["12", "12 liens"], ["all", "Tous"]]}
        />
      }
    >
      <div className={s.grid2}>
        {[...networks].sort((a) => (sideOf(a) === "home" ? -1 : 1)).map((n) => (
          <Network key={n.team?.id} network={n} side={sideOf(n)} links={links} />
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
  const loading = [momentum, stats, advanced, network, heat].every((r) => r.loading && !r.data);
  if (loading) return <Skeleton label="Chargement des analyses…" lines={5} />;
  const nothing = !momentum.data?.points?.length && !advanced.data?.teams?.length && !network.data?.networks?.length && !heat.data?.teams?.length && !periods.FirstHalf;
  if (nothing) return <Empty>Aucune analyse disponible pour ce match.</Empty>;
  return (
    <div className={s.stack}>
      <MatchMomentum match={match} points={momentum.data?.points} events={events.data?.events} />
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
