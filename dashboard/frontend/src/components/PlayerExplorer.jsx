"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { useResearch } from "../hooks/ResearchContext.jsx";
import { profileValue, SCOUT_METRICS } from "../services/scouting.js";
import { isNumber, number } from "../services/format.js";
import { Card, Empty, Pager, Segments } from "./UI.jsx";
import {
  BookmarkButton,
  ComparePlayerButton,
  MetricInfo,
  SavedViews,
} from "./ResearchUI.jsx";

export default function PlayerExplorer({ rows, mode, onMode }) {
  const f = useFootball(),
    r = useResearch();
  const { x: xKey, y: yKey } = r.data.settings.scatter;
  const [view, setView] = useState("scatter"),
    [highlight, setHighlight] = useState("all"),
    [selected, setSelected] = useState(null),
    [xMin, setXMin] = useState(""),
    [yMin, setYMin] = useState(""),
    [page, setPage] = useState(1);
  const teams = useMemo(
    () =>
      [
        ...new Map(
          rows.flatMap((row) =>
            row.profile.teamIds.map((id) => [
              id,
              f.data.teams.find((t) => t.id === id)?.name || row.team,
            ]),
          ),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1], "fr")),
    [rows, f.data.teams],
  );
  const points = useMemo(
    () =>
      rows
        .map((row) => ({
          row,
          x: profileValue(row.profile, xKey, mode),
          y: profileValue(row.profile, yKey, mode),
        }))
        .filter(
          (p) =>
            isNumber(p.x) &&
            (view === "distribution" || isNumber(p.y)) &&
            (xMin === "" || p.x >= Number(xMin)) &&
            (view === "distribution" || yMin === "" || p.y >= Number(yMin)),
        ),
    [rows, xKey, yKey, mode, view, xMin, yMin],
  );
  const range = (key) =>
    points.reduce(
      (a, p) => [Math.min(a[0], p[key]), Math.max(a[1], p[key])],
      [0, 0.01],
    );
  const [xLow, xHigh] = range("x"),
    [yLow, yHigh] = view === "distribution" ? [0, 1] : range("y");
  const x = (v) => 65 + ((v - xLow) / (xHigh - xLow || 1)) * 550,
    y = (v) => 320 - ((v - yLow) / (yHigh - yLow || 1)) * 260;
  const sampled =
    points.length <= 1500
      ? points
      : points.filter((_, i) => i % Math.ceil(points.length / 1500) === 0);
  const selectedPoint = points.find((p) => p.row.playerId === selected);
  const bins = Array.from({ length: 16 }, () => 0);
  for (const p of points)
    bins[Math.min(15, Math.floor(((p.x - xLow) / (xHigh - xLow || 1)) * 16))]++;
  const maxBin = Math.max(1, ...bins);
  const axis = (key, value) => (
    <label>
      {key === "x" ? "Axe X" : "Axe Y"}
      <select
        aria-label={`Indicateur de l’axe ${key.toUpperCase()}`}
        value={value}
        disabled={key === "y" && view === "distribution"}
        onChange={(e) => {
          r.setSettings({
            scatter: { ...r.data.settings.scatter, [key]: e.target.value },
          });
          setPage(1);
        }}
      >
        {Object.entries(SCOUT_METRICS).map(([id, definition]) => (
          <option key={id} value={id}>
            {definition.label}
          </option>
        ))}
      </select>
      <MetricInfo metric={value} />
    </label>
  );
  return (
    <Card title="Explorateur statistique" action={<SavedViews />}>
      <div className="research-toolbar">
        {axis("x", xKey)}
        {axis("y", yKey)}
        <label>
          Club mis en avant
          <select
            aria-label="Club mis en avant"
            value={highlight}
            onChange={(e) => setHighlight(e.target.value)}
          >
            <option value="all">Tous les clubs</option>
            {teams.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum X
          <input
            type="number"
            aria-label="Minimum de l’axe X"
            value={xMin}
            onChange={(e) => {
              setXMin(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {view === "scatter" && (
          <label>
            Minimum Y
            <input
              type="number"
              aria-label="Minimum de l’axe Y"
              value={yMin}
              onChange={(e) => {
                setYMin(e.target.value);
                setPage(1);
              }}
            />
          </label>
        )}
      </div>
      <div className="research-toolbar">
        <Segments
          label="Type de graphique"
          value={view}
          onChange={setView}
          items={[
            ["scatter", "Deux axes"],
            ["distribution", "Distribution"],
          ]}
        />
        <Segments
          label="Base du graphique"
          value={mode}
          onChange={onMode}
          items={[
            ["perMatch", "Par match"],
            ["per90", "Par 90"],
          ]}
        />
        <span role="status">
          {number(points.length)} joueurs avec les mesures ·{" "}
          {view === "scatter" && sampled.length < points.length
            ? `${number(sampled.length)} points affichés`
            : f.season}
        </span>
      </div>
      {points.length ? (
        <figure className="research-chart research-scatter">
          <svg
            viewBox="0 0 680 390"
            role="img"
            aria-label={`${SCOUT_METRICS[xKey].label}${view === "scatter" ? ` et ${SCOUT_METRICS[yKey].label}` : " · distribution des joueurs"}`}
          >
            <title>
              STATARENA · {f.season} · {mode}
            </title>
            <desc>
              {points.length} joueurs. Une ligne par joueur. Les mesures
              absentes sont exclues.
            </desc>
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <line
                  x1="65"
                  x2="615"
                  y1={60 + i * 65}
                  y2={60 + i * 65}
                  className="radar-grid"
                />
                <text
                  x="55"
                  y={60 + i * 65}
                  textAnchor="end"
                  className="research-chart-label"
                >
                  {view === "distribution"
                    ? number((maxBin * (4 - i)) / 4)
                    : number(yHigh - ((yHigh - yLow) * i) / 4, 1)}
                </text>
                <text
                  x={65 + i * 137.5}
                  y="343"
                  textAnchor="middle"
                  className="research-chart-label"
                >
                  {number(xLow + ((xHigh - xLow) * i) / 4, 2)}
                </text>
              </g>
            ))}
            {view === "scatter"
              ? sampled.map((p) => (
                  <circle
                    key={p.row.playerId}
                    cx={x(p.x)}
                    cy={y(p.y)}
                    r={selected === p.row.playerId ? 6 : 3}
                    fill="var(--accent)"
                    fillOpacity={
                      highlight === "all" ||
                      p.row.profile.teamIds.includes(highlight)
                        ? 0.7
                        : 0.12
                    }
                    onClick={() => setSelected(p.row.playerId)}
                  >
                    <title>
                      {p.row.name} · {number(p.x, 2)} / {number(p.y, 2)}
                    </title>
                  </circle>
                ))
              : bins.map((count, i) => (
                  <rect
                    key={i}
                    x={66 + i * 34.375}
                    y={320 - (count / maxBin) * 260}
                    width="32"
                    height={(count / maxBin) * 260}
                    fill="var(--accent)"
                    fillOpacity=".7"
                  >
                    <title>
                      {number(xLow + ((xHigh - xLow) * i) / 16, 2)} à{" "}
                      {number(xLow + ((xHigh - xLow) * (i + 1)) / 16, 2)} :{" "}
                      {count} joueurs
                    </title>
                  </rect>
                ))}
            <text
              x="340"
              y="376"
              textAnchor="middle"
              className="research-chart-label"
            >
              {SCOUT_METRICS[xKey].label}
            </text>
            <text x="65" y="25" className="research-chart-label">
              {view === "scatter"
                ? SCOUT_METRICS[yKey].label
                : "Nombre de joueurs"}
            </text>
          </svg>
        </figure>
      ) : (
        <Empty>Aucun joueur avec ces mesures et seuils.</Empty>
      )}
      {selectedPoint && (
        <div className="research-selection">
          <Link
            href={f.href("/joueurs/", {
              id: selectedPoint.row.playerId,
              q: "",
            })}
          >
            {selectedPoint.row.name}
          </Link>
          <span>
            {number(selectedPoint.x, 2)} / {number(selectedPoint.y, 2)}
          </span>
          <ComparePlayerButton
            profile={selectedPoint.row.profile}
            season={f.season}
          />
          <BookmarkButton
            kind="players"
            id={selectedPoint.row.playerId}
            name={selectedPoint.row.name}
            season={f.season}
          />
          <button
            className="icon-button"
            aria-label="Fermer la sélection du graphique"
            onClick={() => setSelected(null)}
          >
            ×
          </button>
        </div>
      )}
      <details className="research-details">
        <summary>Données du graphique</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th>{SCOUT_METRICS[xKey].label}</th>
                {view === "scatter" && <th>{SCOUT_METRICS[yKey].label}</th>}
                <th>Sélectionner</th>
              </tr>
            </thead>
            <tbody>
              {points
                .slice(
                  (Math.min(page, Math.max(1, Math.ceil(points.length / 20))) -
                    1) *
                    20,
                  Math.min(page, Math.max(1, Math.ceil(points.length / 20))) *
                    20,
                )
                .map((p) => (
                  <tr key={p.row.playerId}>
                    <th>
                      <Link
                        href={f.href("/joueurs/", {
                          id: p.row.playerId,
                          q: "",
                        })}
                      >
                        {p.row.name}
                      </Link>
                    </th>
                    <td>{number(p.x, 2)}</td>
                    {view === "scatter" && <td>{number(p.y, 2)}</td>}
                    <td>
                      <button
                        className="inline-link"
                        onClick={() => setSelected(p.row.playerId)}
                      >
                        Mettre en avant
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pager
          page={Math.min(page, Math.max(1, Math.ceil(points.length / 20)))}
          total={Math.max(1, Math.ceil(points.length / 20))}
          onChange={setPage}
        />
      </details>
    </Card>
  );
}
