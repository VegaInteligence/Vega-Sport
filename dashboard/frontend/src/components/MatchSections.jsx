import React, { useState } from "react";
import {
  Card,
  Empty,
  AsyncState,
  StructuredData,
  Segments,
  Media,
} from "./UI.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { ProfileDialog } from "./PlayerDetails.jsx";
import { useResource, download, json } from "../services/resources.js";
import DataExplorer from "./DataExplorer.jsx";
import PlayerMetrics, { periodLabel } from "./PlayerMetrics.jsx";
import { MATCH_SECTIONS, number, isNumber } from "../services/format.js";
import { ShotMap, XgTimeline } from "./Charts.jsx";
import { MatchLink } from "./MatchLink.jsx";
export function Lineups({ payload }) {
  const [profile, setProfile] = useState(null);
  return (
    <>
      <div className="lineup-grid">
        {["home", "away"].map((side) => {
          const lineup = payload[side],
            team = payload[side + "_team"] || {};
          if (!lineup)
            return (
              <Empty key={side}>
                Composition absente : {team.name || side}
              </Empty>
            );
          return (
            <section className="lineup-team" key={side}>
              <div className="lineup-title">
                <Media name={team.name} url={team.image_url} />
                <h3>{team.name}</h3>
                <strong>{lineup.formation || "—"}</strong>
              </div>
              <p>
                {lineup.confirmed === true
                  ? "Composition confirmée"
                  : lineup.confirmed === false
                    ? lineup.starters?.length || lineup.subs?.length
                      ? "Composition prévisionnelle"
                      : "Composition non renseignée"
                    : "Confirmation non renseignée"}
              </p>
              <div
                className="formation-pitch"
                role="img"
                aria-label={`Placement des titulaires de ${team.name}`}
              >
                <div className="formation-center" />
                {(lineup.starters || [])
                  .filter(
                    (p) =>
                      isNumber(p.pitch_x) &&
                      isNumber(p.pitch_y) &&
                      p.pitch_x >= 0 &&
                      p.pitch_x <= 1 &&
                      p.pitch_y >= 0 &&
                      p.pitch_y <= 1,
                  )
                  .map((p, i) => (
                    <span
                      className="formation-player"
                      key={p.player_id || i}
                      style={{
                        left: `${8 + p.pitch_y * 84}%`,
                        top: `${8 + (1 - p.pitch_x) * 78}%`,
                      }}
                    >
                      <b>{p.shirt_number || "•"}</b>
                      <small>
                        {p.name}
                        {p.is_captain ? " ©" : ""}
                      </small>
                    </span>
                  ))}
              </div>
              {[
                ["starters", "Titulaires"],
                ["subs", "Remplaçants"],
              ].map(([key, label]) => (
                <details
                  className="data-record"
                  key={key}
                  open={key === "starters"}
                >
                  <summary>
                    {label} · {lineup[key]?.length || 0}
                  </summary>
                  <div className="lineup-list">
                    {(lineup[key] || []).map((p, i) => (
                      <div key={p.player_id || i}>
                        <span className="shirt-number">
                          {p.shirt_number || "—"}
                        </span>
                        <span>{p.name}</span>
                        {p.player_id && (
                          <button
                            className="inline-link"
                            aria-label={`Fiche de ${p.name}`}
                            onClick={() => setProfile(p.player_id)}
                          >
                            Fiche
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </section>
          );
        })}
      </div>
      {profile && (
        <ProfileDialog
          id={profile}
          kind="players"
          onClose={() => setProfile(null)}
        />
      )}
    </>
  );
}
export function TeamStats({ match, payload }) {
  const periods = payload.periods || [],
    [selected, setSelected] = useState("");
  const period = periods.find((p) => p.period === selected) || periods[0];
  if (!period) return <Empty>Statistiques absentes.</Empty>;
  return (
    <>
      {match.coverage?.teamStatsReliable === false && (
        <p className="notice notice-warning">
          Statistiques d’équipe incohérentes ; interpréter les données sources
          avec prudence.
        </p>
      )}
      <label>
        Période
        <select
          aria-label="Période des statistiques"
          value={period.period}
          onChange={(e) => setSelected(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p.period} value={p.period}>
              {p.period}
            </option>
          ))}
        </select>
      </label>
      <StructuredData value={period.groups || period} />
    </>
  );
}
export function PlayerStats({
  match,
  payload,
  section = "players",
  initialPlayer,
  initialPeriod,
}) {
  const players = Array.isArray(payload) ? payload : payload.players || [],
    [selected, setSelected] = useState(initialPlayer || ""),
    [period, setPeriod] = useState(initialPeriod || "");
  const row = players.find((p) => p.player?.id === selected) || players[0];
  if (!row) return <Empty>Statistiques joueurs absentes.</Empty>;
  const periods = row.periods || [],
    chosen = periods.find((p) => p.period === period) || periods[0];
  return (
    <>
      {match.coverage?.teamStatsReliable === false && (
        <p className="notice notice-warning">
          Incohérences possibles dans les statistiques sources.
        </p>
      )}
      <div className="table-toolbar">
        <label>
          Joueur
          <select
            aria-label="Joueur des statistiques"
            value={row.player.id}
            onChange={(e) => {
              setSelected(e.target.value);
              setPeriod("");
            }}
          >
            {players.map((p) => (
              <option key={p.player.id} value={p.player.id}>
                {p.player.name}
              </option>
            ))}
          </select>
        </label>
        {periods.length > 0 && (
          <label>
            Période
            <select
              aria-label="Mi-temps"
              value={chosen.period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {periodLabel(p.period)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <h3>{row.player.name} · toutes les métriques</h3>
      <PlayerMetrics row={chosen || row} />
    </>
  );
}
export function normalizeShots(payload) {
  return (payload.periods || [])
    .flatMap((p) => p.shots || [])
    .map((s) => ({
      id: s.id,
      playerId: s.player?.id,
      playerName: s.player?.name,
      teamId: s.team_id,
      x: s.x,
      y: s.y,
      xg: s.expected_goals,
      xgot: s.expected_goals_on_target,
      minute: s.minute,
      type: s.is_own_goal ? "OwnGoal" : s.event_type,
      isGoal: ["Goal", "OwnGoal"].includes(s.event_type),
      isOwnGoal: s.is_own_goal === true || s.event_type === "OwnGoal",
    }));
}
export function Shots({ match, payload, onPlayer = () => {} }) {
  const shots = normalizeShots(payload),
    normalized = { ...match, shots };
  return (
    <>
      <div className="data-chart-grid">
        <ShotMap match={normalized} onPlayer={onPlayer} />
        <XgTimeline match={normalized} onPlayer={onPlayer} />
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Minute</th>
              <th>Joueur</th>
              <th>Événement</th>
              <th>xG</th>
              <th>xGOT</th>
            </tr>
          </thead>
          <tbody>
            {shots.map((s, i) => (
              <tr key={s.id || i}>
                <td>{number(s.minute)}′</td>
                <td>{s.playerName}</td>
                <td>{s.isOwnGoal ? "CSC" : s.type}</td>
                <td>{number(s.xg, 3)}</td>
                <td>{number(s.xgot, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function Events({ payload }) {
  const events = payload.events || [];
  if (!events.length) return <Empty>Aucun événement renseigné.</Empty>;
  return (
    <ol className="event-timeline">
      {events.map((e, i) => (
        <li key={e.id || i}>
          <strong className="event-minute">
            {number(e.minute)}
            {e.minute_added ? `+${number(e.minute_added)}` : ""}′
          </strong>
          <span className="event-marker" />
          <div>
            <strong>
              {e.is_own_goal
                ? "But contre son camp"
                : {
                    Goal: "But",
                    Substitution: "Remplacement",
                    YellowCard: "Carton jaune",
                    RedCard: "Carton rouge",
                  }[e.event_type] || e.event_type}
            </strong>
            <p>
              {e.player?.name}
              {e.sub_in_player ? ` → ${e.sub_in_player.name}` : ""}
              {e.is_penalty ? " · Penalty" : ""}
              {e.is_own_goal ? " · CSC" : ""}
            </p>
          </div>
          {e.score_home != null && e.score_away != null && (
            <span className="score">
              {number(e.score_home)}–{number(e.score_away)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
export function Momentum({ match, payload }) {
  const points = (payload.points || []).filter(
    (p) => isNumber(p.minute) && isNumber(p.value),
  );
  if (!points.length) return <Empty>Momentum indisponible.</Empty>;
  const limit = Math.max(...points.map((p) => Math.abs(p.value)), 0.01),
    duration = Math.max(90, ...points.map((p) => p.minute));
  return (
    <figure className="chart-figure">
      <svg
        viewBox="0 0 720 240"
        role="img"
        aria-label="Pression minute par minute"
      >
        <line
          x1="30"
          y1="110"
          x2="700"
          y2="110"
          stroke="light-dark(#707072, #5a5a5c)"
        />
        {points.map((p, i) => {
          const height = (Math.abs(p.value) / limit) * 82;
          return (
            <rect
              key={i}
              x={30 + (p.minute / duration) * 660}
              y={p.value >= 0 ? 110 - height : 110}
              width={Math.max(2, 640 / points.length)}
              height={height}
              fill={
                p.value >= 0
                  ? "light-dark(#1d6fd6, #3b8eff)"
                  : "light-dark(#53687f, #9cc7ff)"
              }
            >
              <title>{`${number(p.minute)}′ : ${number(p.value, 3)}`}</title>
            </rect>
          );
        })}
        <text x="30" y="20" fill="light-dark(#1d6fd6, #3b8eff)">
          {match.home.name}
        </text>
        <text x="30" y="230" fill="light-dark(#53687f, #9cc7ff)">
          {match.away.name}
        </text>
      </svg>
    </figure>
  );
}
export function Heatmap({ match, payload, initialSelection = "" }) {
  const [selection, setSelection] = useState(initialSelection),
    entries = [
      ...(payload.teams || []).map((x) => ({
        ...x,
        key: `team:${x.team.id}`,
        label: x.team.name,
      })),
      ...(payload.players || []).map((x) => ({
        ...x,
        key: x.player.id,
        label: x.player.name,
      })),
    ];
  const chosen = entries.find((x) => x.key === selection) || entries[0];
  if (!chosen) return <Empty>Carte d’activité indisponible.</Empty>;
  const length = Number(payload.grid?.length) || 16,
    width = Number(payload.grid?.width) || 12,
    cells = (chosen.cells || []).filter(
      (c) =>
        Array.isArray(c) &&
        c.length >= 3 &&
        c.every(isNumber) &&
        c[0] >= 0 &&
        c[0] < length &&
        c[1] >= 0 &&
        c[1] < width &&
        c[2] >= 0,
    ),
    max = Math.max(1, ...cells.map((c) => c[2]));
  return (
    <>
      <div className="table-toolbar">
        <label>
          Équipe ou joueur
          <select
            value={chosen.key}
            onChange={(e) => setSelection(e.target.value)}
          >
            {entries.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <span>
          {number(chosen.actions)} actions ·{" "}
          {payload.grid?.frame === "home_ltr"
            ? "Repère du domicile"
            : "Repère de l’équipe"}
        </span>
      </div>
      <figure className="chart-figure">
        <svg
          viewBox="0 0 680 450"
          role="img"
          aria-label={`Carte d’activité de ${chosen.label}`}
        >
          <rect
            x="20"
            y="20"
            width="640"
            height="400"
            fill="light-dark(#eaeaec, #19191b)"
            stroke="light-dark(#707072, #565658)"
          />
          {cells.map(([x, y, n], i) => (
            <rect
              key={i}
              x={20 + (x / length) * 640}
              y={20 + (y / width) * 400}
              width={640 / length}
              height={400 / width}
              fill="light-dark(#1d6fd6, #3b8eff)"
              fillOpacity={0.12 + (n / max) * 0.8}
            >
              <title>{`${n} actions · cellule ${x}, ${y}`}</title>
            </rect>
          ))}
          <path
            d="M340 20v400M20 140h100v160H20M660 140H560v160h100"
            fill="none"
            stroke="light-dark(#6a6a6c, #959597)"
          />
        </svg>
      </figure>
    </>
  );
}
export function PassNetworks({ payload }) {
  const networks = payload.networks || [];
  if (!networks.length) return <Empty>Réseau indisponible.</Empty>;
  return (
    <div className="lineup-grid">
      {networks.map((network, i) => {
        const nodes = (network.nodes || []).filter(
            (n) => isNumber(n.avg_x) && isNumber(n.avg_y),
          ),
          byId = new Map(nodes.map((n) => [n.player.id, n])),
          color = i
            ? "light-dark(#53687f, #9cc7ff)"
            : "light-dark(#1d6fd6, #3b8eff)";
        return (
          <figure className="chart-figure" key={network.team?.id || i}>
            <h3>{network.team?.name}</h3>
            <svg
              viewBox="0 0 400 310"
              role="img"
              aria-label={`Réseau de passes de ${network.team?.name}`}
            >
              <rect
                x="15"
                y="15"
                width="370"
                height="250"
                fill="light-dark(#eaeaec, #1a1a1c)"
                stroke="light-dark(#707072, #505052)"
              />
              {(network.edges || [])
                .filter(
                  (e) =>
                    byId.has(e.from?.id) &&
                    byId.has(e.to?.id) &&
                    isNumber(e.passes),
                )
                .map((e, j) => {
                  const from = byId.get(e.from.id),
                    to = byId.get(e.to.id);
                  return (
                    <line
                      key={j}
                      x1={15 + (from.avg_x / 105) * 370}
                      y1={15 + (from.avg_y / 68) * 250}
                      x2={15 + (to.avg_x / 105) * 370}
                      y2={15 + (to.avg_y / 68) * 250}
                      stroke={color}
                      strokeWidth={Math.min(8, Math.max(1, e.passes / 3))}
                    >
                      <title>{`${from.player.name} → ${to.player.name} : ${e.passes} passes`}</title>
                    </line>
                  );
                })}
              {nodes.map((n) => (
                <g key={n.player.id}>
                  <circle
                    cx={15 + (n.avg_x / 105) * 370}
                    cy={15 + (n.avg_y / 68) * 250}
                    r={Math.min(13, 6 + (Number(n.passes) || 0) / 15)}
                    fill={color}
                  >
                    <title>{`${n.player.name} · ${number(n.passes)} passes`}</title>
                  </circle>
                  <text
                    x={15 + (n.avg_x / 105) * 370}
                    y={35 + (n.avg_y / 68) * 250}
                    textAnchor="middle"
                    fill="light-dark(#2e2e30, #e2e2e4)"
                    fontSize="8"
                  >
                    {n.player.name}
                  </text>
                </g>
              ))}
            </svg>
            <figcaption>
              Jusqu’au premier remplacement
              {isNumber(network.window?.until_seconds)
                ? ` (${number(network.window.until_seconds / 60, 1)} min)`
                : ""}
              .
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
export function SectionContent({
  match,
  section,
  payload,
  onPlayer,
  initialPlayer,
  initialPeriod,
  initialSelection,
}) {
  if (payload == null) return <Empty>Données non renseignées.</Empty>;
  switch (section) {
    case "lineups":
      return <Lineups payload={payload} />;
    case "stats":
      return <TeamStats match={match} payload={payload} />;
    case "players":
    case "players/halves":
      return (
        <PlayerStats
          match={match}
          payload={payload}
          section={section}
          initialPlayer={initialPlayer}
          initialPeriod={initialPeriod}
        />
      );
    case "shots":
      return match.coverage?.shots === false ? (
        <Empty>Données de tirs indisponibles.</Empty>
      ) : (
        <Shots match={match} payload={payload} onPlayer={onPlayer} />
      );
    case "events":
      return <Events payload={payload} />;
    case "momentum":
      return <Momentum match={match} payload={payload} />;
    case "heatmaps":
      return (
        <Heatmap
          match={match}
          payload={payload}
          initialSelection={initialSelection}
        />
      );
    case "advanced/network":
      return <PassNetworks payload={payload} />;
    case "h2h":
      return (
        <>
          <StructuredData
            value={Object.fromEntries(
              Object.entries(payload).filter(([k]) => k !== "recent_matches"),
            )}
          />
          {(payload.recent_matches || []).map((m, i) => (
            <MatchLink key={m.id || m.match?.id || i} match={m} />
          ))}
        </>
      );
    default:
      return <StructuredData value={payload} />;
  }
}
export function MatchSections({
  match,
  showNavigation = true,
  initialSection = "lineups",
}) {
  const f = useFootball(),
    [section, setSection] = useState(initialSection),
    [mode, setMode] = useState("analysis"),
    [version, setVersion] = useState(0);
  const result = useResource(
    `section:${match.id}:${section}:${f.configured}:${version}`,
    async () => {
      if (section === "archive")
        return {
          data: await json(`/api/archive/matches/${match.id}`),
          source: "snapshot",
        };
      await f.client.ensureEndpoint(match, section, version > 0);
      const entry = f.client.payloads.get(`${match.id}:${section}`);
      if (entry.error) throw new Error(entry.error);
      return entry;
    },
    f.statusKnown,
  );
  return (
    <Card
      title={showNavigation ? "Données détaillées du match" : "Compositions"}
      className="match-archive-card"
    >
      {showNavigation && (
        <div className="archive-select">
          <label htmlFor="match-data-section">Type de données</label>
          <select
            id="match-data-section"
            aria-label="Données détaillées du match"
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              setVersion(0);
            }}
          >
            {MATCH_SECTIONS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value="archive">Archive complète</option>
          </select>
          <span>{MATCH_SECTIONS.length} analyses</span>
        </div>
      )}
      <AsyncState
        resource={{ ...result, retry: () => setVersion((v) => v + 1) }}
      >
        {(value) => (
          <div className="archive-payload" data-section={section}>
            <div className="table-toolbar">
              <span>
                {value.source === "snapshot" ? "Archive collectée" : "PitchAPI"}
              </span>
              <button
                className="button button-secondary"
                onClick={() =>
                  download(
                    `statarena-${match.id}-${section.replaceAll("/", "-")}.json`,
                    JSON.stringify(
                      {
                        source: value.source,
                        matchId: match.id,
                        section,
                        data: value.data,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                Télécharger JSON
              </button>
            </div>
            {value.warning && <p role="status">{value.warning}</p>}
            {showNavigation && section !== "archive" && (
              <Segments
                label="Affichage des données du match"
                value={mode}
                items={[
                  ["analysis", "Analyse"],
                  ["source", "Données sources"],
                ]}
                onChange={setMode}
              />
            )}
            {section === "archive" || mode === "source" ? (
              <DataExplorer key={section} value={value.data} />
            ) : (
              <SectionContent
                key={match.id + section}
                match={match}
                section={section}
                payload={value.data}
                onPlayer={f.setPlayer}
              />
            )}
          </div>
        )}
      </AsyncState>
    </Card>
  );
}
